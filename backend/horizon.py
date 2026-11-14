"""Terrain horizon mask: elevation angle of the skyline for 720 azimuths around a point.

For every azimuth a ray is marched along the great circle that leaves the site in that
direction. A terrain point at arc distance s (central angle g = s / R) with radius r is
seen from the observer (radius r0 = R + ground + instrument height) at the elevation

    e = atan2(r cos g - r0, r sin g)

so the curvature of the Moon is included exactly. The mask is the maximum of e along
the ray. Sampling (distance from the site -> step, elevation model used first):

    5 m .. 3 km     step 5 m    5 m site model, then LDEM 20 m
    3 km .. 30 km   step 20 m   LDEM 20 m, then 80 m
    30 km .. 150 km step 80 m   LDEM 80 m, then 120 m

Where a model has no data the next coarser one is used. On a smooth sphere the result
is the dip of the horizon, -sqrt(2 h / R) = -0.087 deg for h = 2 m.
"""

from __future__ import annotations

import math

import numpy as np
from numba import njit

from . import config, ephem, terrain

R_M = config.MOON_RADIUS_M
N_AZIMUTH = 720
STEP_DEG = 360.0 / N_AZIMUTH
MAX_RANGE_M = 150_000.0

# (first distance, last distance, step) in metres
SEGMENTS = ((5.0, 3000.0, 5.0), (3020.0, 30000.0, 20.0), (30080.0, MAX_RANGE_M, 80.0))

_EMPTY = np.full((2, 2), -32768, dtype=np.int16)
_EMPTY_PARAMS = np.array([0.0, 0.0, 1.0, 1.0, -32768.0])


@njit(cache=True, nogil=True)
def _height(data, p, x, y):
    """Bilinear height at map x, y; NaN outside or on missing data. p = x0, y0, step, scale, nodata."""
    rows, cols = data.shape
    fc = (x - p[0]) / p[2]
    fr = (p[1] - y) / p[2]
    if not (fc >= 0.0 and fr >= 0.0 and fc <= cols - 1 and fr <= rows - 1):
        return np.nan
    c = min(int(fc), cols - 2)
    r = min(int(fr), rows - 2)
    tx = fc - c
    ty = fr - r
    v00 = data[r, c]
    v01 = data[r, c + 1]
    v10 = data[r + 1, c]
    v11 = data[r + 1, c + 1]
    if v00 == p[4] or v01 == p[4] or v10 == p[4] or v11 == p[4]:
        return np.nan
    return p[3] * ((v00 * (1 - tx) + v01 * tx) * (1 - ty) + (v10 * (1 - tx) + v11 * tx) * ty)


@njit(cache=True, nogil=True)
def _march(g0, p0, g1, p1, g2, p2, g3, p3, east, north, up, r_obs, dist, tan_el):
    """Update `tan_el` (per azimuth) with the terrain seen at the distances `dist`.

    Returns the number of samples for which no raster had data.
    """
    n_az = tan_el.size
    cg = np.cos(dist / R_M)
    sg = np.sin(dist / R_M)
    missing = 0
    for a in range(n_az):
        az = 2.0 * math.pi * a / n_az
        sa, ca = math.sin(az), math.cos(az)
        dx = sa * east[0] + ca * north[0]
        dy = sa * east[1] + ca * north[1]
        dz = sa * east[2] + ca * north[2]
        best = tan_el[a]
        for j in range(dist.size):
            ux = cg[j] * up[0] + sg[j] * dx
            uy = cg[j] * up[1] + sg[j] * dy
            uz = cg[j] * up[2] + sg[j] * dz
            k = 2.0 * R_M / (1.0 - uz)
            x = k * uy
            y = k * ux
            z = _height(g0, p0, x, y)
            if math.isnan(z):
                z = _height(g1, p1, x, y)
                if math.isnan(z):
                    z = _height(g2, p2, x, y)
                    if math.isnan(z):
                        z = _height(g3, p3, x, y)
                        if math.isnan(z):
                            missing += 1
                            continue
            r = R_M + z
            t = (r * cg[j] - r_obs) / (r * sg[j])
            if t > best:
                best = t
        tan_el[a] = best
    return missing


def _slots(grids: list[terrain.Grid]):
    """Pad the fallback chain to four (array, params) pairs for the compiled kernel."""
    out = []
    for grid in grids[:4]:
        out += [grid.data, np.array([grid.x0, grid.y0, grid.step, grid.scale, grid.nodata], dtype=float)]
    while len(out) < 8:
        out += [_EMPTY, _EMPTY_PARAMS]
    return out


def smooth_sphere_dip(height_m: float) -> float:
    """Horizon elevation (deg) on a sphere with no relief for an eye `height_m` above it."""
    return -math.degrees(math.acos(R_M / (R_M + height_m)))


def horizon_mask(
    surface: terrain.Surface,
    lat_deg: float,
    lon_deg: float,
    height_m: float = 2.0,
    ground_m: float | None = None,
    n_azimuth: int = N_AZIMUTH,
    max_range_m: float = MAX_RANGE_M,
) -> dict:
    """Horizon mask of a point `height_m` above the local ground.

    Returns `{"elevation_deg": array(n_azimuth), "ground_m": .., "missing_fraction": ..}`;
    index 0 looks north, the azimuth grows clockwise (east = n_azimuth / 4).
    """
    if ground_m is None:
        ground_m = float(surface.elevation(lat_deg, lon_deg)[0])
    if math.isnan(ground_m):
        raise ValueError("no elevation data at the site")
    east, north, up = ephem.local_frame(lat_deg, lon_deg)
    r_obs = R_M + ground_m + height_m
    tan_el = np.full(n_azimuth, -np.inf)
    grids = sorted(surface.grids, key=lambda g: g.step)
    if len(grids) > 4:
        raise ValueError("at most four elevation models are supported")
    missing = total = 0
    for first, last, step in SEGMENTS:
        if first > max_range_m:
            break
        dist = np.arange(first, min(last, max_range_m) + step / 2.0, step)
        # Models not finer than the step come first (finest first), then the finer ones.
        chain = [g for g in grids if g.step >= step] + [g for g in reversed(grids) if g.step < step]
        missing += _march(*_slots(chain), east, north, up, r_obs, dist, tan_el)
        total += dist.size * n_azimuth
    if not np.isfinite(tan_el).all():
        raise ValueError("no elevation data along at least one azimuth")
    return {
        "elevation_deg": np.degrees(np.arctan(tan_el)),
        "ground_m": ground_m,
        "missing_fraction": missing / total,
    }


def flat_mask(height_m: float = 2.0, n_azimuth: int = N_AZIMUTH) -> np.ndarray:
    """Mask of a smooth sphere (used when no terrain is available: `terrain: false`)."""
    return np.full(n_azimuth, smooth_sphere_dip(height_m))


def interpolate(mask_deg: np.ndarray, az_deg) -> np.ndarray:
    """Mask elevation at arbitrary azimuths (linear between the samples, periodic)."""
    n = mask_deg.size
    pos = (np.asarray(az_deg, dtype=float) % 360.0) / (360.0 / n)
    i0 = np.floor(pos).astype(int) % n
    frac = pos - np.floor(pos)
    return mask_deg[i0] * (1.0 - frac) + mask_deg[(i0 + 1) % n] * frac
