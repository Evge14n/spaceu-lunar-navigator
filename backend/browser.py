"""Reference implementation of docs/BROWSER_COMPUTE.md: any point near the south pole
computed from two small files, the way a web page does it without a server.

    data/ephem/year.bin           hourly Sun and Earth vectors for the year (float32)
    data/ephem/sun_distance.bin   distance of the Sun at the same moments (float32)
    data/dem240.bin               elevation model, 240 m pixels (int16)

The code follows the document step by step and uses nothing but these files, so its
output (`data/ephem/test_vectors.json`) is what a JavaScript port has to reproduce.
It is deliberately simpler than `horizon.py` + `metrics.py`: one coarse elevation model
instead of 5 m / 20 m / 80 m / 120 m ones. What that costs is measured by `compare()`
and reported in docs/VALIDATION.md.

    python -m backend.browser files      # the three files (needs kernels and rasters)
    python -m backend.browser vectors    # test_vectors.json (needs only the three files)
    python -m backend.browser compare    # data/validation/browser_*.csv, browser.json (8 minutes)
    python -m backend.browser summary    # browser.json again from the two tables
"""

from __future__ import annotations

import csv
import json
import math
import sys
from functools import cache

import numpy as np

from . import config, precompute

R_M = config.MOON_RADIUS_M
EPHEM_DIR = config.DATA_DIR / "ephem"
VALIDATION_DIR = config.DATA_DIR / "validation"
RECORD = ("sun_x", "sun_y", "sun_z", "earth_x_km", "earth_y_km", "earth_z_km")

DEM_SOURCE = "ldem_75s_120m"  # 2 x 2 pixels of it make one 240 m pixel
DEM_BLOCK = 2
N_AZIMUTH = 720
RAY_FIRST_M = 240.0  # one pixel of the model: nothing closer can be told from the point itself
RAY_STEP_M = 120.0
RAY_MAX_M = 150_000.0
N_STRIPS = 24
HEIGHT_M = 2.0
LAT_LIMIT = -85.0  # south of it the 240 m model covers at least 60 km of terrain in every direction

CUSTOM_POINTS = (
    {"id": "custom1", "name": "Custom point near site 01", "lat": -89.45, "lon": 222.7},
    {"id": "custom2", "name": "Custom point at 87.5 S, 60 E", "lat": -87.5, "lon": 60.0},
    {"id": "custom3", "name": "Custom point at 85.5 S, 350 E", "lat": -85.5, "lon": 350.0},
)
N_MOMENTS = 24  # moments per point in the test vectors, evenly spread over the year


# ---- the two files -------------------------------------------------------------------------


def build_ephemeris() -> tuple[np.ndarray, np.ndarray, dict]:
    """Hourly apparent vectors of the Sun and the Earth from the centre of the Moon (SPICE).

    Returns the table of year.bin, the column of sun_distance.bin and the description.
    """
    from . import ephem

    times = ephem.time_grid(precompute.PERIOD_START, precompute.PERIOD_END, precompute.STEP_MIN)
    ets = ephem.to_et(times)
    sun = ephem.body_vectors("SUN", ets)
    earth = ephem.body_vectors("EARTH", ets)
    dist = np.linalg.norm(sun, axis=1)
    table = np.column_stack([sun / dist[:, None], earth]).astype("<f4")
    meta = {
        "file": "ephem/year.bin",
        "dtype": "float32, little-endian",
        "n": len(times),
        "stride": len(RECORD),
        "record": list(RECORD),
        "start": precompute.PERIOD_START,
        "end": precompute.PERIOD_END,
        "step_h": precompute.STEP_MIN / 60.0,
        "sun_distance": {
            "file": "ephem/sun_distance.bin",
            "dtype": "float32, little-endian",
            "n": len(times),
            "unit": "km, from the centre of the Moon",
        },
        "paths": "file names are relative to data/",
        "frame": "MOON_ME (x towards the mean Earth direction, z the north pole), origin at the centre "
        "of the Moon",
        "content": "sample i is the moment start + i * step_h. sun_x..z: unit vector to the Sun; "
        "earth_x..z_km: position of the centre of the Earth. "
        "Apparent positions (light time and stellar aberration, LT+S), as in backend/ephem.py",
        "constants": {
            "moon_radius_km": config.MOON_RADIUS_KM,
            "sun_radius_km": config.SUN_RADIUS_KM,
            "earth_radius_km": config.EARTH_RADIUS_KM,
            "au_km": config.AU_KM,
            "solar_constant_w_m2": config.SOLAR_CONSTANT_W_M2,
        },
        "source": "NAIF SPICE kernels de440s.bsp, moon_pa_de440_200625.bpc, moon_de440_250416.tf, "
        "pck00011.tpc, naif0012.tls",
        "algorithm": "docs/BROWSER_COMPUTE.md",
    }
    return table, dist.astype("<f4"), meta


def build_dem() -> tuple[np.ndarray, dict]:
    """The 240 m elevation model on the pixel grid of data/illumination.png."""
    from . import terrain

    src = terrain.load_ldem(DEM_SOURCE)
    layer = json.loads((config.DATA_DIR / "illumination.json").read_text("utf-8"))
    size = layer["width"]
    n = size * DEM_BLOCK // 2  # source pixels from the pole to the edge
    rows, cols = src.data.shape
    if src.step * DEM_BLOCK != layer["pixel_m"] or layer["height"] != size:
        raise ValueError("the elevation model does not fit the grid of the map layer")
    part = src.data[rows // 2 - n : rows // 2 + n, cols // 2 - n : cols // 2 + n]
    if (part == src.nodata).any():
        raise ValueError("missing values inside the elevation model")
    metres = part.astype(float).reshape(size, DEM_BLOCK, size, DEM_BLOCK).mean(axis=(1, 3)) * src.scale
    data = np.round(metres).astype("<i2")
    edge = n * src.step
    meta = {
        "file": "dem240.bin",
        "dtype": "int16, little-endian",
        "n": size,
        "width": size,
        "height": size,
        "pixel_m": src.step * DEM_BLOCK,
        "x_km": [-edge / 1000.0, edge / 1000.0],
        "y_km": [-edge / 1000.0, edge / 1000.0],
        "first_pixel_centre_m": [-edge + src.step * DEM_BLOCK / 2.0, edge - src.step * DEM_BLOCK / 2.0],
        "lat_limit": layer["lat_limit"],
        "unit": "metres above the sphere of 1737.4 km",
        "min_m": int(data.min()),
        "max_m": int(data.max()),
        "order": "row by row; row 0 is y max, column 0 is x min: the pixel grid of illumination.png",
        "projection": layer["projection"],
        "source": f"NASA LOLA elevation model {DEM_SOURCE.upper()} (PDS LOLA GDR), "
        f"{src.step:g} m pixels averaged to {src.step * DEM_BLOCK:g} m",
        "algorithm": "docs/BROWSER_COMPUTE.md",
    }
    return data, meta


def step_files() -> None:
    table, dist, meta = build_ephemeris()
    EPHEM_DIR.mkdir(parents=True, exist_ok=True)
    (EPHEM_DIR / "year.bin").write_bytes(table.tobytes())
    (EPHEM_DIR / "sun_distance.bin").write_bytes(dist.tobytes())
    precompute.write_json(EPHEM_DIR / "year.json", meta, indent=1)
    data, meta = build_dem()
    (config.DATA_DIR / "dem240.bin").write_bytes(data.tobytes())
    precompute.write_json(config.DATA_DIR / "dem240.json", meta, indent=1)


@cache
def load_ephemeris() -> dict:
    meta = json.loads((EPHEM_DIR / "year.json").read_text("utf-8"))
    table = np.frombuffer((EPHEM_DIR / "year.bin").read_bytes(), dtype="<f4").astype(float)
    table = table.reshape(meta["n"], meta["stride"])
    dist = np.frombuffer((EPHEM_DIR / "sun_distance.bin").read_bytes(), dtype="<f4").astype(float)
    return {
        "meta": meta,
        "sun_km": table[:, 0:3] * dist[:, None],
        "earth_km": table[:, 3:6],
    }


@cache
def load_dem() -> dict:
    meta = json.loads((config.DATA_DIR / "dem240.json").read_text("utf-8"))
    data = np.frombuffer((config.DATA_DIR / "dem240.bin").read_bytes(), dtype="<i2")
    return {
        "data": data.reshape(meta["height"], meta["width"]).astype(float),
        "x0": meta["first_pixel_centre_m"][0],
        "y0": meta["first_pixel_centre_m"][1],
        "step": meta["pixel_m"],
    }


# ---- the algorithm of docs/BROWSER_COMPUTE.md -----------------------------------------------


def local_frame(lat_deg: float, lon_deg: float):
    """Step 1: unit vectors east, north, up at the point, in MOON_ME."""
    lat, lon = math.radians(lat_deg), math.radians(lon_deg)
    east = np.array([-math.sin(lon), math.cos(lon), 0.0])
    north = np.array([-math.sin(lat) * math.cos(lon), -math.sin(lat) * math.sin(lon), math.cos(lat)])
    up = np.array([math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)])
    return east, north, up


def dem_height(dem: dict, x, y) -> np.ndarray:
    """Step 2: bilinear height (m) at map coordinates; NaN outside the model."""
    data = dem["data"]
    rows, cols = data.shape
    fc = (np.asarray(x, dtype=float) - dem["x0"]) / dem["step"]
    fr = (dem["y0"] - np.asarray(y, dtype=float)) / dem["step"]
    inside = (fc >= 0.0) & (fr >= 0.0) & (fc <= cols - 1) & (fr <= rows - 1)
    c = np.clip(np.floor(fc), 0, cols - 2).astype(int)
    r = np.clip(np.floor(fr), 0, rows - 2).astype(int)
    tx, ty = fc - c, fr - r
    top = data[r, c] * (1.0 - tx) + data[r, c + 1] * tx
    bottom = data[r + 1, c] * (1.0 - tx) + data[r + 1, c + 1] * tx
    return np.where(inside, top * (1.0 - ty) + bottom * ty, np.nan)


def horizon_mask(
    dem: dict, lat_deg: float, lon_deg: float, height_m: float = HEIGHT_M, first_m: float = RAY_FIRST_M
) -> dict:
    """Step 3: elevation of the skyline in 720 azimuths (index 0 north, clockwise)."""
    east, north, up = local_frame(lat_deg, lon_deg)
    ground = float(dem_height(dem, 2.0 * R_M * up[1] / (1.0 - up[2]), 2.0 * R_M * up[0] / (1.0 - up[2])))
    if math.isnan(ground):
        raise ValueError("the point is outside the elevation model")
    r_obs = R_M + ground + height_m
    az = 2.0 * math.pi * np.arange(N_AZIMUTH) / N_AZIMUTH
    along = np.sin(az)[:, None] * east + np.cos(az)[:, None] * north  # (720, 3) directions of the rays
    dist = np.arange(first_m, RAY_MAX_M + RAY_STEP_M / 2.0, RAY_STEP_M)
    cg, sg = np.cos(dist / R_M), np.sin(dist / R_M)
    u = cg[None, :, None] * up + sg[None, :, None] * along[:, None, :]  # unit vectors of the ray points
    k = 2.0 * R_M / (1.0 - u[..., 2])
    z = dem_height(dem, k * u[..., 1], k * u[..., 0])
    r = R_M + z
    tan_el = (r * cg - r_obs) / (r * sg)
    seen = ~np.isnan(tan_el)
    best = np.where(seen, tan_el, -np.inf).max(axis=1)
    dip = -math.acos((R_M + ground) / r_obs)  # smooth sphere, for a ray with no data at all
    best = np.where(np.isfinite(best), best, math.tan(dip))
    return {
        "elevation_deg": np.degrees(np.arctan(best)),
        "ground_m": ground,
        "missing_fraction": 1.0 - float(seen.mean()),
    }


def interpolate(mask_deg: np.ndarray, az_deg) -> np.ndarray:
    pos = (np.asarray(az_deg, dtype=float) % 360.0) / (360.0 / mask_deg.size)
    i0 = np.floor(pos).astype(int) % mask_deg.size
    frac = pos - np.floor(pos)
    return mask_deg[i0] * (1.0 - frac) + mask_deg[(i0 + 1) % mask_deg.size] * frac


def body_sky(position_km: np.ndarray, radius_km: float, lat_deg, lon_deg, elevation_m, mask_deg) -> dict:
    """Steps 4 and 5: azimuth, elevation, angular radius and visible share of the disc."""
    east, north, up = local_frame(lat_deg, lon_deg)
    v = position_km - (config.MOON_RADIUS_KM + elevation_m / 1000.0) * up
    dist = np.linalg.norm(v, axis=1)
    el = np.degrees(np.arcsin(np.clip(v @ up / dist, -1.0, 1.0)))
    az = np.degrees(np.arctan2(v @ east, v @ north)) % 360.0
    rad = np.degrees(np.arcsin(radius_km / dist))
    seen = np.zeros_like(el)
    total = np.zeros_like(el)
    cos_el = np.maximum(np.cos(np.radians(el)), 1e-6)
    for strip in range(N_STRIPS):
        off = (strip + 0.5) / N_STRIPS * 2.0 - 1.0  # centre of the strip in units of the radius
        half = rad * math.sqrt(1.0 - off * off)
        hor = interpolate(mask_deg, az + off * rad / cos_el)
        seen += np.clip(el + half - hor, 0.0, 2.0 * half)
        total += 2.0 * half
    return {
        "az": az,
        "el": el,
        "horizon_el": interpolate(mask_deg, az),  # the skyline at the azimuth of the centre of the disc
        "distance_km": dist,
        "angular_radius": rad,
        "visible_fraction": seen / total,
    }


def longest_run_h(flags: np.ndarray, step_h: float) -> float:
    """The longest run of consecutive true samples, in hours (each sample stands for one step)."""
    best = run = 0
    for flag in flags:
        run = run + 1 if flag else 0
        best = max(best, run)
    return min(best, len(flags) - 1) * step_h  # never longer than the period


def compute(lat_deg: float, lon_deg: float, height_m: float = HEIGHT_M, first_m: float = RAY_FIRST_M) -> dict:
    """Everything for one point: the mask, the sky of every hour and the numbers of the year."""
    eph = load_ephemeris()
    hor = horizon_mask(load_dem(), lat_deg, lon_deg, height_m, first_m)
    mask = hor["elevation_deg"]
    elevation = hor["ground_m"] + height_m
    sun = body_sky(eph["sun_km"], config.SUN_RADIUS_KM, lat_deg, lon_deg, elevation, mask)
    earth = body_sky(eph["earth_km"], config.EARTH_RADIUS_KM, lat_deg, lon_deg, elevation, mask)
    sun["irradiance_w_m2"] = (
        config.SOLAR_CONSTANT_W_M2 * (config.AU_KM / sun["distance_km"]) ** 2 * sun["visible_fraction"]
    )
    step_h = eph["meta"]["step_h"]
    hours = (eph["meta"]["n"] - 1) * step_h
    lit, link = sun["visible_fraction"] > 0.0, earth["visible_fraction"] > 0.0
    mean_w = float(sun["irradiance_w_m2"].mean())
    return {
        **hor,
        "sun": sun,
        "earth": earth,
        "year": {
            "lit_percent": round(100.0 * float(lit.mean()), 2),
            "longest_dark_h": longest_run_h(~lit, step_h),
            "longest_lit_h": longest_run_h(lit, step_h),
            "mean_irradiance_w_m2": round(mean_w, 1),
            "energy_kwh_m2": round(mean_w * hours / 1000.0, 1),
            "earth_visible_percent": round(100.0 * float(link.mean()), 2),
            "longest_earth_hidden_h": longest_run_h(~link, step_h),
        },
    }


# ---- test vectors for the JavaScript port ---------------------------------------------------


def test_points() -> list[dict]:
    listed = json.loads((config.DATA_DIR / "sites.json").read_text("utf-8"))
    return [{k: s[k] for k in ("id", "name", "lat", "lon")} for s in listed] + list(CUSTOM_POINTS)


def test_vectors() -> dict:
    eph = load_ephemeris()["meta"]
    stride = (eph["n"] - 1) // N_MOMENTS
    indices = [stride // 2 + stride * k for k in range(N_MOMENTS)]
    points = []
    for point in test_points():
        got = compute(point["lat"], point["lon"])
        moments = []
        for i in indices:
            sun, earth = got["sun"], got["earth"]
            moments.append(
                {
                    "index": i,
                    "sun": {
                        "az": round(float(sun["az"][i]), 4),
                        "el": round(float(sun["el"][i]), 4),
                        "horizon_el": round(float(sun["horizon_el"][i]), 4),
                        "angular_radius_deg": round(float(sun["angular_radius"][i]), 5),
                        "visible_fraction": round(float(sun["visible_fraction"][i]), 4),
                        "irradiance_w_m2": round(float(sun["irradiance_w_m2"][i]), 1),
                    },
                    "earth": {
                        "az": round(float(earth["az"][i]), 4),
                        "el": round(float(earth["el"][i]), 4),
                        "horizon_el": round(float(earth["horizon_el"][i]), 4),
                        "angular_radius_deg": round(float(earth["angular_radius"][i]), 5),
                        "visible_fraction": round(float(earth["visible_fraction"][i]), 4),
                        "distance_km": round(float(earth["distance_km"][i]), 1),
                    },
                }
            )
        points.append(
            {
                **point,
                "height_m": HEIGHT_M,
                "ground_m": round(got["ground_m"], 3),
                "missing_fraction": round(got["missing_fraction"], 4),
                "mask_deg": [round(float(v), 4) for v in got["elevation_deg"]],
                "moments": moments,
                "year": got["year"],
            }
        )
    return {
        "algorithm": "docs/BROWSER_COMPUTE.md, computed by backend/browser.py from data/ephem/year.bin, "
        "data/ephem/sun_distance.bin and data/dem240.bin only",
        "tolerance": {
            "angle_deg": 0.001,
            "visible_fraction": 0.002,
            "percent": 0.05,
            "hours": 0,
            "irradiance_w_m2": 0.1,
        },
        "check": "node data/ephem/check.mjs runs data/ephem/compute.mjs against this file",
        "moment_time": "start + index * step_h of data/ephem/year.json",
        "points": points,
    }


def step_vectors() -> None:
    precompute.write_json(EPHEM_DIR / "test_vectors.json", test_vectors())


# ---- what the coarse model costs ------------------------------------------------------------


def _stats(ours, ref) -> dict:
    d = np.asarray(ours, dtype=float) - np.asarray(ref, dtype=float)
    return {
        "n": int(d.size),
        "bias": round(float(d.mean()), 2),
        "mae": round(float(np.abs(d).mean()), 2),
        "rmse": round(float(np.sqrt((d**2).mean())), 2),
        "median_abs": round(float(np.median(np.abs(d))), 2),
        "p90_abs": round(float(np.percentile(np.abs(d), 90)), 2),
        "max_abs": round(float(np.abs(d).max()), 2),
    }


def _write_csv(path, rows: list[dict]) -> None:
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


STUDY_FIRST_M = (
    120.0,
    240.0,
    480.0,
)  # the first ray sample: the choice of RAY_FIRST_M is measured, not assumed
BANDS = ((0.0, 0.0), (0.0, 25.0), (25.0, 50.0), (50.0, 70.0), (70.0, 100.0))  # lit percent, full computation
PAIRS = (  # (key in the summaries, column of the full computation, column of the browser algorithm)
    ("lit_percent", "lit_full", "lit_browser"),
    ("longest_dark_h", "dark_h_full", "dark_h_browser"),
    ("earth_visible_percent", "earth_full", "earth_browser"),
    ("longest_earth_hidden_h", "earth_hidden_h_full", "earth_hidden_h_browser"),
)


def _pair_columns(full: dict, year: dict) -> dict:
    return {
        "lit_full": full["sun"]["lit_percent"],
        "lit_browser": year["lit_percent"],
        "dark_h_full": full["sun"]["longest_dark_h"],
        "dark_h_browser": year["longest_dark_h"],
        "earth_full": full["earth"]["visible_percent"],
        "earth_browser": year["earth_visible_percent"],
        "earth_hidden_h_full": full["earth"]["longest_hidden_h"],
        "earth_hidden_h_browser": year["longest_earth_hidden_h"],
    }


def _pair_stats(rows: list[dict]) -> dict:
    return {key: _stats([r[b] for r in rows], [r[a] for r in rows]) for key, a, b in PAIRS}


def _within(rows: list[dict], full: str, ours: str, limits) -> dict:
    d = np.abs(np.array([r[ours] for r in rows]) - np.array([r[full] for r in rows]))
    return {f"{t:g}": round(100.0 * float((d <= t).mean()), 1) for t in limits}


def _read_csv(path) -> list[dict]:
    with open(path, encoding="utf-8") as fh:
        return [
            {k: v if k == "id" else int(v) if k in ("row", "col") else float(v) for k, v in row.items()}
            for row in csv.DictReader(fh)
        ]


def compare_tables() -> None:
    """The browser algorithm against the full computation of the same year, eye at 2 m.

    The ten listed sites (full: the published summaries, 5 m site models) and the random
    pixels of Test 2 (full: the 20 m model, computed here; needs kernels and rasters).
    """
    from . import ephem, horizon, metrics, terrain

    listed = json.loads((config.DATA_DIR / "sites.json").read_text("utf-8"))
    site_rows = []
    for site in listed:
        full = json.loads((config.DATA_DIR / "summary" / f"{site['id']}.json").read_text("utf-8"))
        got = compute(site["lat"], site["lon"])
        site_rows.append(
            {
                "id": site["id"],
                "lat": site["lat"],
                "lon": site["lon"],
                "ground_5m_model": site["elevation_m"],
                "ground_240m_model": round(got["ground_m"], 1),
                "missing_fraction": round(got["missing_fraction"], 4),
                **_pair_columns(full, got["year"]),
                "nasa_map": site["nasa_avg_illumination_percent"],
            }
        )
    _write_csv(VALIDATION_DIR / "browser_sites.csv", site_rows)

    surface = terrain.default_surface()
    ets = ephem.to_et(ephem.time_grid(precompute.PERIOD_START, precompute.PERIOD_END, precompute.STEP_MIN))
    with open(VALIDATION_DIR / "test2_pixels.csv", encoding="utf-8") as fh:
        pixels = list(csv.DictReader(fh))
    pixel_rows = []
    for p in pixels:
        lat, lon = (float(v) for v in terrain.xy_to_latlon(float(p["x_m"]), float(p["y_m"])))
        hor = horizon.horizon_mask(surface, lat, lon, HEIGHT_M)
        obs = metrics.Observer(lat, lon, hor["ground_m"], HEIGHT_M, hor["elevation_deg"], terrain=True)
        full = metrics.summarize(obs, ets, metrics.sky_state(obs, ets))
        row = {
            "row": int(p["row"]),
            "col": int(p["col"]),
            "lat": round(lat, 5),
            "lon": round(lon, 5),
            "nasa": float(p["nasa"]),
            "product": float(p["product"]),
        }
        for first in STUDY_FIRST_M:
            got = compute(lat, lon, first_m=first)
            if first == RAY_FIRST_M:
                row.update(
                    missing_fraction=round(got["missing_fraction"], 4), **_pair_columns(full, got["year"])
                )
            else:
                row[f"lit_browser_first{first:g}"] = got["year"]["lit_percent"]
        pixel_rows.append(row)
    _write_csv(VALIDATION_DIR / "browser_pixels.csv", pixel_rows)


def compare_summary() -> dict:
    """Every number about the browser algorithm in docs/VALIDATION.md, from the two tables."""
    site_rows = _read_csv(VALIDATION_DIR / "browser_sites.csv")
    pixel_rows = _read_csv(VALIDATION_DIR / "browser_pixels.csv")

    def band(lo: float, hi: float) -> list[dict]:
        if hi == 0.0:
            return [r for r in pixel_rows if r["lit_full"] == 0.0]
        return [r for r in pixel_rows if lo < r["lit_full"] <= hi]

    def first_column(first: float) -> str:
        return "lit_browser" if first == RAY_FIRST_M else f"lit_browser_first{first:g}"

    summary = {
        "what": "the browser algorithm (one 240 m model) against the full computation; eye at 2 m, "
        f"{precompute.PERIOD_START} .. {precompute.PERIOD_END}, hourly; differences are browser minus full",
        "units": {"lit_percent": "pp", "earth_visible_percent": "pp", "longest_dark_h": "h"},
        "algorithm": {
            "first_sample_m": RAY_FIRST_M,
            "step_m": RAY_STEP_M,
            "range_m": RAY_MAX_M,
            "azimuths": N_AZIMUTH,
            "strips": N_STRIPS,
        },
        "sites": {
            "full": "the published summaries: 5 m site models, then the 20, 80 and 120 m models",
            "n": len(site_rows),
            **_pair_stats(site_rows),
        },
        "pixels": {
            "full": "the 20 m model, then the 80 and 120 m models (what the live API does for custom "
            "coordinates); the sample of Test 2: random pixels of the NASA map inside 85 S, "
            "80 per band of its value",
            "n": len(pixel_rows),
            **_pair_stats(pixel_rows),
            "lit_percent_within_pp": _within(pixel_rows, "lit_full", "lit_browser", (1, 2, 5, 10, 20)),
            "longest_dark_within_h": _within(pixel_rows, "dark_h_full", "dark_h_browser", (6, 24, 72, 168)),
            "earth_visible_within_pp": _within(pixel_rows, "earth_full", "earth_browser", (1, 2, 5, 10, 20)),
            "lit_percent_by_band_of_full": [
                {
                    "band": "0" if hi == 0.0 else f"{lo:g}-{hi:g}",
                    **_stats([r["lit_browser"] for r in band(lo, hi)], [r["lit_full"] for r in band(lo, hi)]),
                }
                for lo, hi in BANDS
            ],
            "longest_dark_h_by_band_of_full": [
                {
                    "band": "0" if hi == 0.0 else f"{lo:g}-{hi:g}",
                    "median_full_h": round(float(np.median([r["dark_h_full"] for r in band(lo, hi)])), 1),
                    **_stats(
                        [r["dark_h_browser"] for r in band(lo, hi)], [r["dark_h_full"] for r in band(lo, hi)]
                    ),
                    "within_24h": _within(band(lo, hi), "dark_h_full", "dark_h_browser", (24,))["24"],
                }
                for lo, hi in BANDS
            ],
            "lit_percent_worst": [
                {k: r[k] for k in ("row", "col", "lat", "lon", "lit_full", "lit_browser", "nasa")}
                for r in sorted(pixel_rows, key=lambda r: -abs(r["lit_browser"] - r["lit_full"]))[:6]
            ],
            "lit_percent_vs_nasa_map": _stats(
                [r["lit_browser"] for r in pixel_rows], [r["nasa"] for r in pixel_rows]
            ),
            "full_vs_column_product_max_abs": round(
                float(max(abs(r["lit_full"] - r["product"]) for r in pixel_rows)), 2
            ),
        },
        "first_sample_study": [
            {
                "first_sample_m": first,
                **_stats([r[first_column(first)] for r in pixel_rows], [r["lit_full"] for r in pixel_rows]),
                "within_pp": _within(pixel_rows, "lit_full", first_column(first), (2, 5, 10)),
            }
            for first in STUDY_FIRST_M
        ],
    }
    return summary


def compare() -> dict:
    compare_tables()
    return step_summary()


def step_summary() -> dict:
    summary = compare_summary()
    precompute.write_json(VALIDATION_DIR / "browser.json", summary, indent=1)
    return summary


def main(argv: list[str]) -> int:
    what = argv[0] if argv else ""
    if what == "files":
        step_files()
    elif what == "vectors":
        step_vectors()
    elif what == "compare":
        print(json.dumps(compare(), indent=1))
    elif what == "summary":
        print(json.dumps(step_summary(), indent=1))
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
