"""Tests 2 and 3 of docs/VALIDATION.md: our illumination against the NASA LOLA maps.

    python -m backend.validate            # writes data/validation/*.csv and summary.json
    python -m backend.validate summary    # only summary.json, from the tables (seconds)
    python -m backend.validate orientation   # data/validation/orientation.json (a minute)
    python -m backend.validate accuracy   # data/validation.json for the Accuracy screen (seconds)

Test 2. The NASA map `AVGVISIB_85S_060M_201608` gives, for every 60 m pixel, the share of
hourly timesteps of an 18.6-year lunar nutation cycle in which any part of the solar disc
is visible from the surface (computed by the LOLA team from a 60 m elevation model).
We compute the same quantity with our own code at the centres of sampled pixels in the
configuration of the map (60 m LOLA model, eye on the surface, hourly, 18.6 years), then
change one thing at a time (another cycle, eye 2 m above the ground, terrain to 400 km, one
year, the 20 m model) to see what each of the differences between the map and our
product costs.

Test 3. Pixels flagged as permanently shadowed in `LPSR_85S_060M_201608` must get zero.

The sample is drawn with a fixed seed, so the run is reproducible.
"""

from __future__ import annotations

import csv
import json
import sys
import time
from functools import cache
from pathlib import Path

import numpy as np

from . import config, ephem, horizon, metrics, precompute, sites, terrain

SUN_MAP = "AVGVISIB_85S_060M_201608.TIF"
EARTH_MAP = "AVGVISIB_85S_060M_201608_EARTH.TIF"
PSR_MAP = "LPSR_85S_060M_201608.TIF"
PSR_SCALE, PSR_OFFSET = 0.000025, 0.5  # from the PDS label: 1 = permanent shadow
LDEM_60M = "ldem_75s_60m"  # the 60 m LOLA model of the PDS archive (`fetch_data validation`)

CYCLE_DAYS = 6798.38  # lunar nodal (nutation) cycle, 18.61 years
CYCLE_START = precompute.PERIOD_START  # the cycle that starts with the product year
OTHER_START = "2008-01-01T00:00:00Z"  # another cycle, to see how much the choice matters
LAT_LIMIT = -85.0  # the 85S maps are complete inside this circle
SEED = 20261114
STRATA = ((0.0, 0.0), (0.0, 0.10), (0.10, 0.25), (0.25, 0.50), (0.50, 0.70), (0.70, 1.0))
PER_STRATUM = 80
N_PSR = 150
PSR_INTERIOR_PIXELS = 10  # "interior": every pixel within 600 m is also permanently shadowed
WITHIN_PP = (0.5, 1.0, 2.0, 5.0, 10.0, 20.0)
SMOOTH_PP = 5.0  # the map is "locally smooth" where a pixel is within 5 pp of the median of its 3 x 3

OUT_DIR = config.DATA_DIR / "validation"
HORIZONS_FIXTURE = Path(__file__).parent / "tests" / "fixtures" / "horizons.json"


@cache
def vectors(body: str, start: str, days: float, step_h: float = 1.0) -> np.ndarray:
    """Moon-centred apparent vectors of a body on an hourly grid (shared by all points)."""
    et0 = float(ephem.to_et([start])[0])
    ets = et0 + 3600.0 * step_h * np.arange(int(days * 24.0 / step_h) + 1)
    return ephem.body_vectors(body, ets)


@cache
def surface_of(kind: str) -> terrain.Surface:
    """Elevation models of the configurations; all of them have pixels on the grid of the map."""
    far = terrain.load_ldem(terrain.LDEM_FAR)
    if kind == "60m":  # the 60 m LOLA model, the closest published one to the model of the map
        return terrain.Surface([terrain.load_ldem(LDEM_60M), far])
    if kind == "20m_mean":  # 3 x 3 mean of the 20 m model: 60 m pixels that keep small craters
        near = terrain.load_ldem(terrain.LDEM_NEAR).block_mean(3)
        return terrain.Surface([near, terrain.load_ldem(terrain.LDEM_MID), far])
    return terrain.default_surface()  # "20m": what the API uses for custom coordinates


def visible_percent(
    mask: np.ndarray, lat: float, lon: float, elevation_m: float, body_km: np.ndarray, radius_km
):
    """Share of the samples (percent) in which any part of the disc is above the mask."""
    az, el, dist = ephem.azel_from_vectors(body_km, lat, lon, elevation_m)
    radius = np.degrees(np.arcsin(radius_km / dist))
    visible = el - radius > mask.max()  # the whole disc is above the highest point of the horizon
    unsure = ~visible & (el + radius > mask.min())
    if unsure.any():
        visible[unsure] = metrics.disc_fraction(az[unsure], el[unsure], radius[unsure], mask) > 0.0
    return 100.0 * float(visible.mean())


def point_result(
    x: float,
    y: float,
    surface: terrain.Surface,
    height_m: float,
    body: str,
    start: str,
    days: float,
    range_m: float = horizon.MAX_RANGE_M,
):
    lat, lon = (float(v) for v in terrain.xy_to_latlon(x, y))
    result = horizon.horizon_mask(surface, lat, lon, height_m, max_range_m=range_m)
    radius = dict((b, r) for _, b, r in metrics.BODIES)[body]
    return visible_percent(
        result["elevation_deg"], lat, lon, result["ground_m"] + height_m, vectors(body, start, days), radius
    )


def pixel_centres(grid: terrain.Grid, rows: np.ndarray, cols: np.ndarray):
    return grid.x0 + grid.step * cols, grid.y0 - grid.step * rows


def inside_limit(grid: terrain.Grid) -> np.ndarray:
    rows, cols = grid.data.shape
    x, y = np.meshgrid(grid.x0 + grid.step * np.arange(cols), grid.y0 - grid.step * np.arange(rows))
    rho = 2.0 * config.MOON_RADIUS_M * np.tan(np.radians(90.0 + LAT_LIMIT) / 2.0)
    return x * x + y * y <= rho * rho


def sample_pixels() -> list[dict]:
    """Stratified random sample of the NASA map: the same number of pixels in each band of its value."""
    vis = terrain.load_geotiff(SUN_MAP, sites.ILLUMINATION_SCALE)
    value = vis.data * vis.scale
    ok = inside_limit(vis) & (vis.data != vis.nodata)
    rng = np.random.default_rng(SEED)
    out = []
    for low, high in STRATA:
        band = ok & ((value == 0.0) if high == 0.0 else (value > low) & (value <= high))
        idx = rng.choice(np.flatnonzero(band), PER_STRATUM, replace=False)
        rows, cols = np.unravel_index(np.sort(idx), value.shape)
        xs, ys = pixel_centres(vis, cols=cols, rows=rows)
        for r, c, x, y in zip(rows, cols, xs, ys, strict=True):
            around = 100.0 * float(np.median(value[r - 1 : r + 2, c - 1 : c + 2]))
            out.append(
                {
                    "row": int(r),
                    "col": int(c),
                    "x_m": float(x),
                    "y_m": float(y),
                    "nasa": 100.0 * float(value[r, c]),
                    "nasa_3x3_median": round(around, 3),
                }
            )
    return out


def sample_psr() -> list[dict]:
    """Random permanently shadowed pixels; `interior` marks those with only shadow within 600 m."""
    psr = terrain.load_geotiff(PSR_MAP, PSR_SCALE)
    flag = (psr.data * PSR_SCALE + PSR_OFFSET) > 0.5
    k = PSR_INTERIOR_PIXELS
    # every pixel of the (2k+1)^2 window is shadowed: window sum from a summed-area table
    table = np.pad(flag.astype(np.int32), ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    n = flag.shape[0]
    full = np.zeros_like(flag)
    win = table[2 * k + 1 :, 2 * k + 1 :] - table[: n - 2 * k, 2 * k + 1 :] - table[2 * k + 1 :, : n - 2 * k]
    win = win + table[: n - 2 * k, : n - 2 * k]
    full[k : n - k, k : n - k] = win == (2 * k + 1) ** 2
    rng = np.random.default_rng(SEED + 1)
    idx = rng.choice(np.flatnonzero(flag & inside_limit(psr)), N_PSR, replace=False)
    rows, cols = np.unravel_index(np.sort(idx), flag.shape)
    xs, ys = pixel_centres(psr, cols=cols, rows=rows)
    return [
        {"row": int(r), "col": int(c), "x_m": float(x), "y_m": float(y), "interior": bool(full[r, c])}
        for r, c, x, y in zip(rows, cols, xs, ys, strict=True)
    ]


def stats(ours, nasa) -> dict:
    ours, nasa = np.asarray(ours, dtype=float), np.asarray(nasa, dtype=float)
    d = ours - nasa
    varies = d.size > 2 and ours.std() > 0.0 and nasa.std() > 0.0
    return {
        "n": int(d.size),
        "bias_pp": round(float(d.mean()), 2),
        "mae_pp": round(float(np.abs(d).mean()), 2),
        "rmse_pp": round(float(np.sqrt((d**2).mean())), 2),
        "median_abs_pp": round(float(np.median(np.abs(d))), 2),
        "p90_abs_pp": round(float(np.percentile(np.abs(d), 90)), 2),
        "max_abs_pp": round(float(np.abs(d).max()), 2),
        "correlation": round(float(np.corrcoef(ours, nasa)[0, 1]), 4) if varies else None,
    }


CONFIGS = {
    # name: (surface, eye height m, start, days[, how far the terrain is looked at, m])
    "map_config": ("60m", 0.0, CYCLE_START, CYCLE_DAYS),
    "other_cycle": ("60m", 0.0, OTHER_START, CYCLE_DAYS),
    "eye_2m": ("60m", 2.0, CYCLE_START, CYCLE_DAYS),
    "range_400km": ("60m", 0.0, CYCLE_START, CYCLE_DAYS, horizon.FAR_RANGE_M),  # terrain beyond 150 km
    "one_year": ("60m", 0.0, CYCLE_START, 365.0),
    "dem_20m_mean": ("20m_mean", 0.0, CYCLE_START, CYCLE_DAYS),
    "dem_20m": ("20m", 0.0, CYCLE_START, CYCLE_DAYS),
    "product": ("20m", 2.0, CYCLE_START, 365.0),
}


def run_config(points: list[dict], name: str, body: str = "SUN") -> list[float]:
    kind, height, start, days, *far = CONFIGS[name]
    return [
        point_result(p["x_m"], p["y_m"], surface_of(kind), height, body, start, days, *far) for p in points
    ]


def write_csv(path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def compute_tables() -> None:
    """The heavy part (about 25 minutes): fills the three tables of data/validation/."""
    # ---- Test 2: Sun --------------------------------------------------------------------
    points = sample_pixels()
    nasa = [p["nasa"] for p in points]
    for name in CONFIGS:
        t0 = time.time()
        ours = run_config(points, name)
        for p, v in zip(points, ours, strict=True):
            p[name] = round(v, 3)
        print(f"sun {name}: {stats(ours, nasa)}  ({time.time() - t0:.0f} s)", flush=True)

    # ---- Test 2b: Earth (the same pixels, map configuration) ---------------------------
    earth = terrain.load_geotiff(EARTH_MAP, sites.ILLUMINATION_SCALE)
    nasa_earth = [100.0 * float(earth.data[p["row"], p["col"]]) * earth.scale for p in points]
    ours = run_config(points, "map_config", "EARTH")
    for p, n, v in zip(points, nasa_earth, ours, strict=True):
        p["nasa_earth"] = round(n, 3)
        p["earth_map_config"] = round(v, 3)
    print(f"earth map_config: {stats(ours, nasa_earth)}", flush=True)
    for p in points:
        p["nasa"] = round(p["nasa"], 3)
    write_csv(OUT_DIR / "test2_pixels.csv", points)

    # ---- Test 3: permanent shadow -------------------------------------------------------
    psr = sample_psr()
    for name in ("map_config", "product"):
        ours = run_config(psr, name)
        for p, v in zip(psr, ours, strict=True):
            p[name] = round(v, 3)
        print(f"psr {name}: zero in {sum(v == 0.0 for v in ours)} of {len(ours)}", flush=True)
    write_csv(OUT_DIR / "test3_psr.csv", psr)

    # ---- the published sites against the map -------------------------------------------
    rows = []
    for site in sites.load_sites():
        stored = json.loads((config.DATA_DIR / "summary" / f"{site['id']}.json").read_text("utf-8"))
        row = {
            "id": site["id"],
            "nasa": site["nasa_avg_illumination_percent"],
            "published_1y_2m": stored["sun"]["lit_percent"],
        }
        surface = precompute.site_surface(site)
        for label, model, height in (
            ("cycle_2m", surface, 2.0),  # the published configuration over the whole cycle
            ("cycle_0m", surface, 0.0),  # eye on the ground of the 5 m model
            ("cycle_0m_60m_dem", surface_of("60m"), 0.0),  # the configuration of the map
            ("cycle_2m_60m_dem", surface_of("60m"), 2.0),
        ):
            row[label] = round(
                point_result(site["x_m"], site["y_m"], model, height, "SUN", CYCLE_START, CYCLE_DAYS), 2
            )
        rows.append(row)
        print(row, flush=True)
    write_csv(OUT_DIR / "sites.csv", rows)


def read_csv(path) -> list[dict]:
    """A table of data/validation/ with numbers as numbers."""

    def value(text: str):
        if text in ("True", "False"):
            return text == "True"
        try:
            return int(text)
        except ValueError:
            try:
                return float(text)
            except ValueError:
                return text

    with open(path, encoding="utf-8") as fh:
        return [{k: value(v) for k, v in row.items()} for row in csv.DictReader(fh)]


def within(ours, ref, limits=WITHIN_PP) -> dict:
    """Share (percent) of the points whose difference is not larger than each limit."""
    d = np.abs(np.asarray(ours, dtype=float) - np.asarray(ref, dtype=float))
    return {f"{t:g}": round(100.0 * float((d <= t).mean()), 1) for t in limits}


def worst(rows: list[dict], ours: str, ref: str, extra: tuple, n: int) -> list[dict]:
    order = sorted(rows, key=lambda r: -abs(r[ours] - r[ref]))[:n]
    return [{k: r[k] for k in ("row", "col", ref, ours, *extra)} for r in order]


def build_summary() -> dict:
    """Every number of docs/VALIDATION.md, derived from the three tables."""
    points = read_csv(OUT_DIR / "test2_pixels.csv")
    psr = read_csv(OUT_DIR / "test3_psr.csv")
    site_rows = read_csv(OUT_DIR / "sites.csv")

    def column(name: str, rows: list[dict] = points) -> list[float]:
        return [r[name] for r in rows]

    def subset(sel: list[dict]) -> dict:
        return stats(column("map_config", sel), column("nasa", sel))

    def effect(name: str, base: str) -> dict:
        d = np.array(column(name)) - np.array(column(base))
        return {
            "against": base,
            "mean_pp": round(float(d.mean()), 2),
            "mean_abs_pp": round(float(np.abs(d).mean()), 2),
            "max_abs_pp": round(float(np.abs(d).max()), 2),
            "changed_percent": round(100.0 * float((d != 0.0).mean()), 1),
        }

    def psr_stats(name: str) -> dict:
        ours = column(name, psr)
        inner = [r[name] for r in psr if r["interior"]]
        return {
            "n": len(ours),
            "zero": int(sum(v == 0.0 for v in ours)),
            "max_percent": round(max(ours), 3),
            "mean_percent": round(float(np.mean(ours)), 4),
            "interior_n": len(inner),
            "interior_zero": int(sum(v == 0.0 for v in inner)),
            "interior_max_percent": round(max(inner), 3) if inner else None,
        }

    smooth = [p for p in points if abs(p["nasa"] - p["nasa_3x3_median"]) <= SMOOTH_PP]
    rough = [p for p in points if abs(p["nasa"] - p["nasa_3x3_median"]) > SMOOTH_PP]
    return {
        "nasa_maps": {"sun": SUN_MAP, "earth": EARTH_MAP, "psr": PSR_MAP},
        "models": {"60m": LDEM_60M, "20m_mean": f"{terrain.LDEM_NEAR}, 3 x 3 mean", "20m": terrain.LDEM_NEAR},
        "cycle": {"start": CYCLE_START, "days": CYCLE_DAYS, "step_h": 1.0, "other_start": OTHER_START},
        "sample": {"seed": SEED, "per_stratum": PER_STRATUM, "strata": STRATA, "lat_limit": LAT_LIMIT},
        "configs": {
            k: {
                "dem": v[0],
                "eye_m": v[1],
                "start": v[2],
                "days": v[3],
                "range_km": (v[4] if len(v) > 4 else horizon.MAX_RANGE_M) / 1000.0,
            }
            for k, v in CONFIGS.items()
        },
        "test2_sun": {name: stats(column(name), column("nasa")) for name in CONFIGS},
        "test2_sun_within_pp": within(column("map_config"), column("nasa")),
        "test2_sun_effects": {
            **{name: effect(name, "map_config") for name in CONFIGS if name not in ("map_config", "product")},
            "product": effect("product", "dem_20m"),
        },
        "test2_sun_by_band": {
            f"{low * 100:g}-{high * 100:g}": subset(
                [
                    p
                    for p in points
                    if (p["nasa"] == 0.0 if high == 0.0 else low * 100 < p["nasa"] <= high * 100)
                ]
            )
            for low, high in STRATA
        },
        "test2_sun_by_smoothness": {
            "threshold_pp": SMOOTH_PP,
            "smooth": subset(smooth),
            "rough": subset(rough),
        },
        "test2_sun_worst": worst(
            points, "map_config", "nasa", ("nasa_3x3_median", "eye_2m", "dem_20m_mean"), 6
        ),
        "test2_earth": {"map_config": stats(column("earth_map_config"), column("nasa_earth"))},
        "test2_earth_within_pp": within(column("earth_map_config"), column("nasa_earth")),
        "test2_earth_worst": worst(points, "earth_map_config", "nasa_earth", (), 3),
        "test3_psr": {name: psr_stats(name) for name in ("map_config", "product")},
        "test3_psr_not_zero": [
            {k: r[k] for k in ("row", "col", "interior", "map_config", "product")}
            for r in psr
            if r["map_config"] > 0.0 or r["product"] > 0.0
        ],
        "sites": {
            key: stats(column(key, site_rows), column("nasa", site_rows))
            for key in ("published_1y_2m", "cycle_2m", "cycle_0m", "cycle_0m_60m_dem", "cycle_2m_60m_dem")
        },
    }


ORIENTATIONS = {
    "as read": lambda x, y: (x, y),
    "flip y": lambda x, y: (x, -y),
    "flip x": lambda x, y: (-x, y),
    "rotate 180": lambda x, y: (-x, -y),
    "transpose": lambda x, y: (y, x),
    "anti-transpose": lambda x, y: (-y, -x),
    "rotate 90": lambda x, y: (y, -x),
    "rotate 270": lambda x, y: (-y, x),
}


def orientation_rms(model: str) -> dict:
    """RMS height difference (m) between the 20 m LDEM and a 5 m site model, per orientation.

    The PDS label of the LDEM does not say which way the lines and samples run. The 5 m site
    models are georeferenced GeoTIFFs, read independently of our LDEM reader, so the LDEM
    agrees with them only when it is read the right way round.
    """
    ldem = terrain.load_ldem(terrain.LDEM_NEAR)
    tile = terrain.load_geotiff(terrain.site_tiff_path(model)).block_mean(4)
    rows, cols = tile.data.shape
    x, y = np.meshgrid(tile.x0 + tile.step * np.arange(cols), tile.y0 - tile.step * np.arange(rows))
    return {
        name: float(np.sqrt(np.nanmean((ldem.sample(*turn(x, y)) - tile.data) ** 2)))
        for name, turn in ORIENTATIONS.items()
    }


def orientation_check() -> dict:
    """The orientation test over the 5 m models of all listed sites (needs the rasters)."""
    rows = []
    for site in sites.load_sites():
        rms = orientation_rms(site["pgda_model"])
        others = [v for k, v in rms.items() if k != "as read"]
        rows.append(
            {
                "id": site["id"],
                "model": site["pgda_model"],
                "rms_m": round(rms["as read"], 1),
                "other_min_rms_m": round(min(others)),
                "other_max_rms_m": round(max(others)),
            }
        )
    return {
        "what": "RMS height difference between the 20 m polar model as we read it and the georeferenced "
        "5 m site model averaged to 20 m, and the same for the seven other ways to orient the raster",
        "rows": rows,
    }


def horizons_check() -> dict:
    """Test 1: our Sun and Earth directions against the stored answers of JPL Horizons."""
    fixture = json.loads(HORIZONS_FIXTURE.read_text("utf-8"))
    out = {
        "source": fixture["source"],
        "retrieved": fixture["retrieved"],
        "points": len(fixture["points"]),
        "moments_per_point": len(fixture["points"][0]["sun"]),
        "samples": 0,
        "target_deg": 0.01,
    }
    for body in ("sun", "earth"):
        worst_angle = worst_range = 0.0
        for point in fixture["points"]:
            rows = point[body]
            ours = ephem.sun_earth(
                point["lat"], point["lon"], point["alt_km"] * 1000.0, [r["utc"] for r in rows]
            )[body]
            el = np.array([r["el"] for r in rows])
            d_az = (ours["az"] - np.array([r["az"] for r in rows]) + 180.0) % 360.0 - 180.0
            d_az *= np.cos(np.radians(el))  # on the sky: a raw azimuth difference blows up at the zenith
            worst_angle = max(worst_angle, float(np.abs(d_az).max()), float(np.abs(ours["el"] - el).max()))
            d_range = ours["distance_km"] - np.array([r["range_km"] for r in rows])
            worst_range = max(worst_range, float(np.abs(d_range).max()))
            out["samples"] += len(rows)
        out[body] = {"max_angle_deg": round(worst_angle, 7), "max_range_km": round(worst_range, 2)}
    out["max_angle_deg"] = max(out["sun"]["max_angle_deg"], out["earth"]["max_angle_deg"])
    out["passed"] = out["max_angle_deg"] < out["target_deg"]
    # the same two numbers under the names the Accuracy page reads
    out["max_diff_deg"] = out["max_angle_deg"]
    out["sun_max_diff_deg"] = out["sun"]["max_angle_deg"]
    return out


LIMITS = (
    "Light is geometric: no light scattered or reflected from lit slopes, the solar disc is uniformly "
    "bright.",
    "The elevation models have errors of their own: metres in height, and a summit narrower than a pixel "
    "(5 m at the listed sites, 20 m elsewhere near the pole) is not in the model.",
    "Terrain farther than 150 km is ignored; counting it to 400 km changes the yearly percentage by "
    "{far_mean} pp on average and by {far_max} pp at most.",
    "The numbers are for an instrument 2 m above the ground. On the ground itself a point of a fine model "
    "is lit far less often; a mast adds light (see the mast table).",
    "One year (2026-11-14 .. 2027-11-14) is not the 18.6-year mean of the NASA maps: over the same pixels "
    "it differs by {year_mean} pp on average.",
    "Percentages are shares of hourly samples: a sunrise is known to the hour in the browser estimate and "
    "to 30 seconds in the precomputed files.",
    "A custom point is estimated in the browser from a 240 m model: half of the points are within "
    "{browser_median} pp of the full computation and nine in ten within {browser_p90} pp; on well-lit "
    "ridges (above 70 %) half are within {ridge_median} pp, and a sharp summit can be off by tens of pp "
    "(largest difference measured: {browser_max} pp). The listed sites use the full computation.",
)


def build_accuracy() -> dict:
    """data/validation.json: what the Accuracy screen shows, taken from the tables and summaries."""
    summary = build_summary()
    browser = json.loads((OUT_DIR / "browser.json").read_text("utf-8"))
    turned = json.loads((OUT_DIR / "orientation.json").read_text("utf-8"))["rows"]
    names = {s["id"]: s["name"] for s in sites.load_sites()}
    site_rows = []
    for r in read_csv(OUT_DIR / "sites.csv"):
        # from the map to our number in four steps that add up to the difference
        as_map = round(r["cycle_0m_60m_dem"], 1)
        height = round(r["cycle_2m_60m_dem"] - r["cycle_0m_60m_dem"], 1) + 0.0  # no "-0.0"
        model = round(r["cycle_2m"] - r["cycle_2m_60m_dem"], 1) + 0.0
        year = round(r["published_1y_2m"] - r["cycle_2m"], 1) + 0.0
        site_rows.append(
            {
                "id": r["id"],
                "name": names[r["id"]],
                "ours_year_percent": r["published_1y_2m"],
                "nasa_percent": r["nasa"],
                "difference_pp": round(r["published_1y_2m"] - r["nasa"], 1),
                "map_configuration_percent": as_map,
                "map_configuration_difference_pp": round(as_map - r["nasa"], 1),
                "height_effect_pp": height,
                "model_effect_pp": model,
                "year_effect_pp": year,
                "explanation": (
                    f"Computed the way the map was (60 m model, on the surface, 18.6 years) this point "
                    f"gets {as_map:.1f} %, {as_map - r['nasa']:+.1f} pp from the map. An instrument 2 m "
                    f"above the ground: {height:+.1f} pp. The 5 m model of the site instead of the 60 m "
                    f"one: {model:+.1f} pp. This year instead of the 18.6-year mean: {year:+.1f} pp."
                ),
            }
        )
    sun, earth = summary["test2_sun"]["map_config"], summary["test2_earth"]["map_config"]
    effects = summary["test2_sun_effects"]
    pixels = browser["pixels"]
    ridges = pixels["lit_percent_by_band_of_full"][-1]  # where the full computation gives above 70 %
    night = pixels["longest_dark_within_h"]
    numbers = {
        "far_mean": f"{effects['range_400km']['mean_pp']:+.2f}",
        "far_max": f"{effects['range_400km']['max_abs_pp']:.1f}",
        "year_mean": f"{effects['one_year']['mean_pp']:+.2f}",
        "browser_median": f"{pixels['lit_percent']['median_abs']:.1f}",
        "browser_p90": f"{pixels['lit_percent']['p90_abs']:.1f}",
        "browser_max": f"{pixels['lit_percent']['max_abs']:.0f}",
        "ridge_median": f"{ridges['median_abs']:.1f}",
    }
    return {
        "details": "docs/VALIDATION.md",
        "period": {"start": precompute.PERIOD_START, "end": precompute.PERIOD_END, "step_h": 1.0},
        "horizons": {
            "title": "Sun and Earth directions against JPL Horizons",
            "what": "Azimuth and elevation of the Sun and the Earth for five points on the Moon over "
            "the year, compared with NASA JPL Horizons (observer on the lunar surface, airless apparent "
            "positions). samples: compared positions = moments_per_point x points x two bodies.",
            **horizons_check(),
        },
        "terrain_orientation": {
            "title": "The elevation model is read the right way round",
            "what": "The label of the polar elevation model does not say which way its lines and samples "
            "run. NASA's 5 m site models are georeferenced independently, so the polar model agrees with "
            "them only in the right orientation. rms_m: smallest and largest RMS height difference over "
            "the site models as we read it; other_rms_m: the same over the seven other orientations.",
            "site_models": len(turned),
            "rms_m": [min(r["rms_m"] for r in turned), max(r["rms_m"] for r in turned)],
            "other_rms_m": [
                min(r["other_min_rms_m"] for r in turned),
                max(r["other_max_rms_m"] for r in turned),
            ],
            "rows": turned,
        },
        "nasa_map": {
            "title": "Illumination against the NASA LOLA map",
            "what": "Share of time with any part of the solar disc visible, hourly over 18.6 years, "
            "recomputed with our code on the 60 m LOLA model at randomly drawn pixels of the NASA map "
            f"{SUN_MAP} (80 pixels per band of its value, inside 85 S).",
            "pixels": sun["n"],
            "bias_pp": sun["bias_pp"],
            "mean_abs_pp": sun["mae_pp"],
            "median_abs_pp": sun["median_abs_pp"],
            "max_abs_pp": sun["max_abs_pp"],
            "correlation": sun["correlation"],
            "within_pp": summary["test2_sun_within_pp"],
            "earth": {
                "what": f"The same pixels and method for the visibility of the Earth, map {EARTH_MAP}.",
                "pixels": earth["n"],
                "bias_pp": earth["bias_pp"],
                "mean_abs_pp": earth["mae_pp"],
                "median_abs_pp": earth["median_abs_pp"],
                "max_abs_pp": earth["max_abs_pp"],
                "correlation": earth["correlation"],
                "within_pp": summary["test2_earth_within_pp"],
            },
        },
        "sites": {
            "title": "The ten sites: our year against the NASA map",
            "what": "ours_year_percent: lit share of 2026-11-14 .. 2027-11-14 for an instrument 2 m above "
            "the ground, 5 m site models. nasa_percent: the NASA map, 18.6 years, on the surface of a 60 m "
            "model. The two are not the same quantity; map_configuration_percent is our code in the "
            "configuration of the map, and the three effects lead from it to our number (rounded, so the "
            "sum can be 0.1 pp off).",
            "rows": site_rows,
            "mean_abs_difference_pp": summary["sites"]["published_1y_2m"]["mae_pp"],
            "max_abs_difference_pp": summary["sites"]["published_1y_2m"]["max_abs_pp"],
            "map_configuration_mean_abs_difference_pp": summary["sites"]["cycle_0m_60m_dem"]["mae_pp"],
            "note": "The site points were chosen as the best-lit pixels of the map, and a maximum picked "
            "from a noisy map is on average higher than a recomputation: in the configuration of the map "
            f"our numbers are {-summary['sites']['cycle_0m_60m_dem']['bias_pp']:.1f} pp lower on average.",
        },
        "psr": {
            "title": "Permanently shadowed regions stay dark",
            "what": f"Pixels flagged as permanently shadowed in the NASA map {PSR_MAP} must never see the "
            "Sun in our computation (60 m model, on the surface, 18.6 years).",
            "pixels": summary["test3_psr"]["map_config"]["n"],
            "never_lit": summary["test3_psr"]["map_config"]["zero"],
            "interior_pixels": summary["test3_psr"]["map_config"]["interior_n"],
            "interior_never_lit": summary["test3_psr"]["map_config"]["interior_zero"],
            "interior_definition": f"every pixel within {PSR_INTERIOR_PIXELS * 60} m is also flagged",
            "product_never_lit": summary["test3_psr"]["product"]["zero"],
            "exceptions": summary["test3_psr_not_zero"],
            "note": "Two pixels of 150 are not dark, both on the edge of a shadowed patch. One patch is "
            "only four pixels, on a plain that is about 30 % lit, and the published 60 m model shows no "
            "hollow there (heights within 7 m across 300 m): what shades it on the map is not in the "
            "model. The other is on the rim of a shadowed area of about 1 km2, on a slope; on the surface "
            "it stays dark, and an instrument 2 m above the ground sees the Sun for two hours a year.",
        },
        "browser": {
            "title": "Custom points computed in the browser",
            "what": "Any point is computed on the page from a 240 m elevation model. Compared with the "
            "full computation (20 m model) of the same year at the pixels of the map test.",
            "pixels": pixels["n"],
            "lit_percent": pixels["lit_percent"],
            "lit_percent_within_pp": pixels["lit_percent_within_pp"],
            "longest_dark_h": pixels["longest_dark_h"],
            "longest_dark_within_h": pixels["longest_dark_within_h"],
            "earth_visible_percent": pixels["earth_visible_percent"],
            "earth_visible_within_pp": pixels["earth_visible_within_pp"],
            "lit_percent_by_band_of_full": pixels["lit_percent_by_band_of_full"],
            "longest_dark_h_by_band_of_full": pixels["longest_dark_h_by_band_of_full"],
            "listed_sites_lit_percent": browser["sites"]["lit_percent"],
            "caption": "Estimate from a 240 m terrain model. Against the full computation the lit share "
            f"of the year differs by {numbers['browser_median']} pp for a typical point and by less than "
            f"{numbers['browser_p90']} pp for nine points in ten; on well-lit ridges (above 70 %) it is "
            f"typically {numbers['ridge_median']} pp, and a sharp summit can be off by tens of pp. The "
            f"longest night is within a day for {night['24']:.0f} % of points.",
        },
        "limits": [text.format(**numbers) for text in LIMITS],
    }


def main(argv: list[str]) -> int:
    if argv[:1] == ["accuracy"]:  # needs data/validation/browser.json (python -m backend.browser compare)
        precompute.write_json(config.DATA_DIR / "validation.json", build_accuracy(), indent=1)
        return 0
    if argv[:1] == ["orientation"]:
        precompute.write_json(OUT_DIR / "orientation.json", orientation_check(), indent=1)
        return 0
    if argv[:1] != ["summary"]:  # `summary`: only rebuild summary.json from the tables
        compute_tables()
    precompute.write_json(OUT_DIR / "summary.json", build_summary(), indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
