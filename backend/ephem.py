"""Sun and Earth as seen from a point on the Moon (NAIF SPICE).

Conventions (docs/ARCHITECTURE.md): UTC in, degrees out, azimuth from north clockwise,
east longitude, planetocentric latitude, sphere of 1737.4 km, frame MOON_ME.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from datetime import UTC, datetime, timedelta

import numpy as np
import spiceypy as spice

from . import config

_loaded = False


def load_kernels(kernel_dir=None) -> None:
    """Load the five generic kernels once per process."""
    global _loaded
    if _loaded:
        return
    folder = config.KERNEL_DIR if kernel_dir is None else kernel_dir
    for name in config.KERNELS:
        path = folder / name
        if not path.exists():
            raise FileNotFoundError(
                f"SPICE kernel {path} is missing; run `python -m backend.fetch_data kernels`"
            )
        spice.furnsh(str(path).replace("\\", "/"))
    _loaded = True


def parse_utc(value: str | datetime) -> datetime:
    """ISO 8601 string (with Z or offset) or datetime -> timezone-aware UTC datetime."""
    if isinstance(value, datetime):
        dt = value
    else:
        dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def iso_z(dt: datetime) -> str:
    """UTC datetime -> `2026-11-14T12:00:00Z`."""
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def time_grid(start: str | datetime, end: str | datetime, step_min: float) -> list[datetime]:
    """Inclusive grid of UTC datetimes from start to end."""
    t0, t1 = parse_utc(start), parse_utc(end)
    if t1 < t0:
        raise ValueError("end is before start")
    if step_min <= 0:
        raise ValueError("step must be positive")
    n = int(np.floor((t1 - t0).total_seconds() / (step_min * 60.0) + 1e-9)) + 1
    return [t0 + timedelta(minutes=step_min * i) for i in range(n)]


def to_et(times: Iterable[str | datetime] | np.ndarray) -> np.ndarray:
    """UTC times -> SPICE ephemeris time (TDB seconds past J2000)."""
    load_kernels()
    if isinstance(times, np.ndarray) and times.dtype.kind == "f":
        return times.astype(float)
    out = []
    for t in times:
        dt = parse_utc(t)
        out.append(spice.str2et(dt.strftime("%Y-%m-%dT%H:%M:%S.%f")))
    return np.array(out, dtype=float)


def et_to_datetime(et: float) -> datetime:
    """Ephemeris time -> UTC datetime rounded to the second."""
    load_kernels()
    text = spice.et2utc(float(et), "ISOC", 0)
    return datetime.fromisoformat(text).replace(tzinfo=UTC)


def body_vectors(body: str, ets: np.ndarray) -> np.ndarray:
    """Apparent position of `body` from the centre of the Moon in MOON_ME, km, (n, 3)."""
    load_kernels()
    ets = np.atleast_1d(np.asarray(ets, dtype=float))
    out = np.empty((ets.size, 3))
    for i, et in enumerate(ets):
        out[i], _ = spice.spkpos(body, float(et), config.FRAME, config.ABCORR, "MOON")
    return out


def site_vector(lat_deg: float, lon_deg: float, radius_km: float) -> np.ndarray:
    """Body-fixed Cartesian vector of a point at planetocentric lat/lon and radius, km."""
    lat, lon = np.radians(lat_deg), np.radians(lon_deg)
    return radius_km * np.array([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])


def local_frame(lat_deg: float, lon_deg: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Unit vectors east, north, up of the local frame (sphere), in MOON_ME.

    Defined analytically from the longitude, so it stays valid arbitrarily close to
    the pole (at exactly +-90 deg "north" points along the given meridian).
    """
    lat, lon = np.radians(lat_deg), np.radians(lon_deg)
    east = np.array([-np.sin(lon), np.cos(lon), 0.0])
    north = np.array([-np.sin(lat) * np.cos(lon), -np.sin(lat) * np.sin(lon), np.cos(lat)])
    up = np.array([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])
    return east, north, up


def azel_from_vectors(
    vectors_km: np.ndarray, lat_deg: float, lon_deg: float, elevation_m: float = 0.0
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Topocentric azimuth, elevation (deg) and distance (km) of Moon-centred vectors.

    The site vector is subtracted (parallax): about 0.26 deg for the Earth, 2.4 arcsec
    for the Sun. `elevation_m` is the height of the observer above the 1737.4 km sphere.
    """
    r_site = site_vector(lat_deg, lon_deg, config.MOON_RADIUS_KM + elevation_m / 1000.0)
    east, north, up = local_frame(lat_deg, lon_deg)
    s = np.atleast_2d(vectors_km) - r_site
    dist = np.linalg.norm(s, axis=1)
    u = s / dist[:, None]
    el = np.degrees(np.arcsin(np.clip(u @ up, -1.0, 1.0)))
    az = np.degrees(np.arctan2(u @ east, u @ north)) % 360.0
    return az, el, dist


def sun_earth(
    lat_deg: float,
    lon_deg: float,
    elevation_m: float,
    times: Sequence[str | datetime] | np.ndarray,
) -> dict[str, dict[str, np.ndarray]]:
    """Azimuth, elevation, distance and angular radius of the Sun and the Earth.

    `times` is a sequence of UTC datetimes / ISO strings or an array of ephemeris times.
    Returns `{"sun": {...}, "earth": {...}}` with numpy arrays `az`, `el` (deg),
    `distance_km` and `angular_radius` (deg).
    """
    ets = to_et(times)
    out = {}
    for key, body, radius in (
        ("sun", "SUN", config.SUN_RADIUS_KM),
        ("earth", "EARTH", config.EARTH_RADIUS_KM),
    ):
        az, el, dist = azel_from_vectors(body_vectors(body, ets), lat_deg, lon_deg, elevation_m)
        out[key] = {
            "az": az,
            "el": el,
            "distance_km": dist,
            "angular_radius": np.degrees(np.arcsin(radius / dist)),
        }
    return out


def scene_direction(az_deg, el_deg) -> np.ndarray:
    """Unit vector in the three.js scene axes (x east, y up, z south)."""
    az, el = np.radians(az_deg), np.radians(el_deg)
    return np.stack([np.cos(el) * np.sin(az), np.sin(el), -np.cos(el) * np.cos(az)], axis=-1)
