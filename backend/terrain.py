"""LOLA south polar elevation models: readers, map projection and local terrain tiles.

All rasters are in the same projection: south polar stereographic, sphere of
1737.4 km, true scale at the pole, longitude 0 pointing "up" (towards +y):

    rho = 2 R tan((90 + lat) / 2)      x = rho sin(lon)      y = rho cos(lon)

Row 0 of every raster is the northernmost-in-image row (largest y), column 0 has the
smallest x. For the GeoTIFFs this comes from their geotransform; for the raw PDS3
`.img` files the label does not state it, so `tests/test_terrain.py` proves it by
comparing the raw file with the georeferenced 5 m site models.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import cache, lru_cache
from pathlib import Path

import numpy as np
from numba import njit

from . import config, ephem

R_M = config.MOON_RADIUS_M

SITE_TIFF = "sites/{name}_final_adj_5mpp_surf.tif"
LDEM_NEAR = "ldem_85s_20m"  # 20 m/pixel, 85 S .. pole
LDEM_MID = "ldem_80s_80m"  # 80 m/pixel, 80 S .. pole
LDEM_FAR = "ldem_75s_120m"  # 120 m/pixel, 75 S .. pole


def latlon_to_xy(lat_deg, lon_deg):
    """Planetocentric latitude / east longitude (deg) -> polar stereographic x, y (m)."""
    rho = 2.0 * R_M * np.tan(np.radians(90.0 + np.asarray(lat_deg, dtype=float)) / 2.0)
    lon = np.radians(lon_deg)
    return rho * np.sin(lon), rho * np.cos(lon)


def xy_to_latlon(x, y):
    """Polar stereographic x, y (m) -> latitude, east longitude in [0, 360) (deg)."""
    x, y = np.asarray(x, dtype=float), np.asarray(y, dtype=float)
    lat = -90.0 + np.degrees(2.0 * np.arctan(np.hypot(x, y) / (2.0 * R_M)))
    lon = np.degrees(np.arctan2(x, y)) % 360.0
    return lat, lon


def unit_to_xy(u):
    """Unit vectors in MOON_ME (..., 3) -> polar stereographic x, y (m)."""
    u = np.asarray(u, dtype=float)
    k = 2.0 * R_M / (1.0 - u[..., 2])
    return k * u[..., 1], k * u[..., 0]


@njit(cache=True, nogil=True)
def _bilinear(data, x0, y0, step, scale, nodata, xs, ys, out):
    rows, cols = data.shape
    for i in range(xs.size):
        fc = (xs[i] - x0) / step
        fr = (y0 - ys[i]) / step
        if not (fc >= 0.0 and fr >= 0.0 and fc <= cols - 1 and fr <= rows - 1):
            out[i] = np.nan
            continue
        c = min(int(fc), cols - 2)
        r = min(int(fr), rows - 2)
        tx = fc - c
        ty = fr - r
        v00 = data[r, c]
        v01 = data[r, c + 1]
        v10 = data[r + 1, c]
        v11 = data[r + 1, c + 1]
        if v00 == nodata or v01 == nodata or v10 == nodata or v11 == nodata:
            out[i] = np.nan
            continue
        out[i] = scale * ((v00 * (1 - tx) + v01 * tx) * (1 - ty) + (v10 * (1 - tx) + v11 * tx) * ty)


@dataclass(frozen=True)
class Grid:
    """A square-pixel raster of heights above the 1737.4 km sphere.

    `x0`, `y0` are the map coordinates of the centre of pixel (row 0, column 0);
    x grows with the column, y decreases with the row. Height = value * `scale` (m).
    Missing float values are NaN; `nodata` marks missing integer values.
    """

    name: str
    data: np.ndarray
    x0: float
    y0: float
    step: float
    scale: float = 1.0
    nodata: float = -32768.0

    @property
    def bounds(self) -> tuple[float, float, float, float]:
        """Outer edges: x_min, y_min, x_max, y_max (m)."""
        rows, cols = self.data.shape
        h = self.step / 2.0
        return (
            self.x0 - h,
            self.y0 - (rows - 1) * self.step - h,
            self.x0 + (cols - 1) * self.step + h,
            self.y0 + h,
        )

    def sample(self, x, y) -> np.ndarray:
        """Bilinear height (m) at map coordinates; NaN outside the raster or on missing data."""
        xs = np.ascontiguousarray(np.asarray(x, dtype=float).ravel())
        ys = np.ascontiguousarray(np.asarray(y, dtype=float).ravel())
        out = np.empty(xs.size)
        _bilinear(self.data, self.x0, self.y0, self.step, self.scale, self.nodata, xs, ys, out)
        return out.reshape(np.shape(x))

    def sample_latlon(self, lat_deg, lon_deg) -> np.ndarray:
        return self.sample(*latlon_to_xy(lat_deg, lon_deg))

    def block_mean(self, factor: int) -> Grid:
        """Average `factor` x `factor` pixels (float rasters); NaN if any input is missing."""
        rows, cols = self.data.shape
        r, c = rows // factor, cols // factor
        data = self.data[: r * factor, : c * factor].astype(np.float32)
        data = data.reshape(r, factor, c, factor).mean(axis=(1, 3)) * np.float32(self.scale)
        shift = (factor - 1) / 2.0 * self.step
        return Grid(
            f"{self.name}/x{factor}",
            np.ascontiguousarray(data, dtype=np.float32),
            self.x0 + shift,
            self.y0 - shift,
            self.step * factor,
        )


def _label_value(text: str, key: str) -> str:
    match = re.search(rf"^\s*{key}\s*=\s*\"?([^\s\"<]+)", text, flags=re.MULTILINE)
    if match is None:
        raise ValueError(f"{key} not found in the PDS label")
    return match.group(1)


@cache
def load_ldem(name: str = LDEM_NEAR) -> Grid:
    """Read a LOLA polar gridded record (PDS3 `.img` + `.lbl`) from the raw data folder.

    The label gives: 16-bit little-endian integers, HEIGHT = DN * SCALING_FACTOR metres,
    pixel registration, projection origin at LINE/SAMPLE_PROJECTION_OFFSET (0-based
    pixel coordinates of the pole). Orientation (y up, x right) is verified by a test.
    """
    img, lbl = config.RAW_DIR / f"{name}.img", config.RAW_DIR / f"{name}.lbl"
    if not img.exists() or not lbl.exists():
        raise FileNotFoundError(f"{img} is missing; run `python -m backend.fetch_data rasters`")
    text = lbl.read_text("latin-1")
    lines, samples = int(_label_value(text, "LINES")), int(_label_value(text, "LINE_SAMPLES"))
    if _label_value(text, "SAMPLE_TYPE") != "LSB_INTEGER" or _label_value(text, "SAMPLE_BITS") != "16":
        raise ValueError("unexpected sample type in the PDS label")
    if float(_label_value(text, "OFFSET")) != R_M:
        raise ValueError("unexpected reference radius in the PDS label")
    step = float(_label_value(text, "MAP_SCALE"))
    scale = float(_label_value(text, "SCALING_FACTOR"))
    line0 = float(_label_value(text, "LINE_PROJECTION_OFFSET"))
    sample0 = float(_label_value(text, "SAMPLE_PROJECTION_OFFSET"))
    if img.stat().st_size != lines * samples * 2:
        raise ValueError(f"{img} has an unexpected size (download not finished?)")
    data = np.fromfile(img, dtype="<i2").reshape(lines, samples)
    return Grid(name, data, -sample0 * step, line0 * step, step, scale)


@lru_cache(maxsize=4)
def load_geotiff(path: str | Path, scale: float = 1.0) -> Grid:
    """Read band 1 of a PGDA GeoTIFF in the south polar stereographic projection."""
    import rasterio

    path = Path(path)
    if not path.is_absolute():
        path = config.RAW_DIR / path
    with rasterio.open(path) as src:
        proj = src.crs.to_dict()
        ok = (
            proj.get("proj") == "stere"
            and float(proj.get("lat_0", 0)) == -90.0
            and float(proj.get("lon_0", 1)) == 0.0
            and float(proj.get("R", 0)) == R_M
        )
        t = src.transform
        if not ok or t.b != 0 or t.d != 0 or t.a != -t.e:
            raise ValueError(f"{path.name}: unexpected projection {src.crs} / transform {t}")
        data = src.read(1)
        nodata = src.nodata
    if data.dtype.kind == "f":
        if nodata is not None and not np.isnan(nodata):
            data[data == nodata] = np.nan
        nodata = -32768.0  # never matches a float height; missing values are NaN
    return Grid(path.stem, np.ascontiguousarray(data), t.c + t.a / 2.0, t.f - t.a / 2.0, t.a, scale, nodata)


def site_tiff_path(name: str) -> Path:
    return config.RAW_DIR / SITE_TIFF.format(name=name)


class Surface:
    """Elevation lookup over several rasters, finest first; the first valid value wins."""

    def __init__(self, grids: list[Grid]):
        if not grids:
            raise ValueError("no rasters")
        self.grids = grids

    def elevation_xy(self, x, y) -> np.ndarray:
        out = self.grids[0].sample(x, y)
        for grid in self.grids[1:]:
            missing = np.isnan(out)
            if not missing.any():
                break
            out[missing] = grid.sample(
                np.asarray(x, dtype=float)[missing], np.asarray(y, dtype=float)[missing]
            )
        return out

    def elevation(self, lat_deg, lon_deg) -> np.ndarray:
        """Height above the sphere (m) at lat/lon; NaN where no raster has data."""
        x, y = latlon_to_xy(lat_deg, lon_deg)
        return self.elevation_xy(np.atleast_1d(x), np.atleast_1d(y))


@lru_cache(maxsize=16)
def default_surface(site_name: str | None = None) -> Surface:
    """5 m site model (if any) -> LDEM 20 m -> 80 m -> 120 m.

    One site model (DM2) lies outside the 20 m LDEM, which stops at 85 S; there the
    5 m model averaged to 20 m takes the place of the LDEM.
    """
    grids = []
    near = load_ldem(LDEM_NEAR)
    if site_name is not None:
        tile = load_geotiff(site_tiff_path(site_name))
        grids.append(tile)
        x_min, y_min, x_max, y_max = tile.bounds
        nx_min, ny_min, nx_max, ny_max = near.bounds
        if x_min < nx_min or y_min < ny_min or x_max > nx_max or y_max > ny_max:
            near = tile.block_mean(4)
    grids.append(near)
    for name in (LDEM_MID, LDEM_FAR):
        grids.append(load_ldem(name))
    return Surface(grids)


def local_tile(surface: Surface, lat_deg: float, lon_deg: float, n: int = 512, size_m: float = 10000.0):
    """Terrain around a point in the local east-north-up frame, with curvature.

    Returns `(heights, center_elevation_m)`. `heights` is (n, n) float32: row 0 is the
    north edge, column 0 the west edge, nodes are `size_m / (n - 1)` apart and the
    value is the height (m) above the plane tangent to the sphere through the ground
    point of the site. A flat sphere therefore drops by d^2 / 2R (7 m at 5 km).
    """
    east, north, up = ephem.local_frame(lat_deg, lon_deg)
    z0 = float(surface.elevation(lat_deg, lon_deg)[0])
    if np.isnan(z0):
        raise ValueError("no elevation data at the centre of the tile")
    r0 = R_M + z0
    axis = np.linspace(-size_m / 2.0, size_m / 2.0, n)
    e, nn = np.meshgrid(axis, axis[::-1])
    horiz2 = e**2 + nn**2
    u = np.zeros_like(e)
    # Solve |r0*up + e*E + n*N + u*U| = R + z(lat, lon of that point) by fixed-point iteration.
    for _ in range(4):
        p = e[..., None] * east + nn[..., None] * north + (r0 + u)[..., None] * up
        p /= np.linalg.norm(p, axis=-1, keepdims=True)
        x, y = unit_to_xy(p)
        z = surface.elevation_xy(x, y)
        u = np.sqrt((R_M + z) ** 2 - horiz2) - r0
    return u.astype(np.float32), z0


def tile_metadata(
    site_id: str, lat: float, lon: float, heights: np.ndarray, z0: float, size_m: float
) -> dict:
    n = heights.shape[0]
    return {
        "site": site_id,
        "n": n,
        "size_m": size_m,
        "step_m": round(size_m / (n - 1), 3),
        "center": {"lat": round(lat, 6), "lon": round(lon, 6)},
        "center_elevation_m": round(z0, 1),
        "min_h": round(float(np.nanmin(heights)), 1),
        "max_h": round(float(np.nanmax(heights)), 1),
        "file": f"terrain/{site_id}.bin",
    }
