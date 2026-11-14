"""Compute everything the static demo needs and write it to `data/`.

    python -m backend.precompute                 # all steps, all sites
    python -m backend.precompute sites           # data/sites.json (site points from NASA rasters)
    python -m backend.precompute terrain         # data/terrain/<site>.bin + .json
    python -m backend.precompute horizon         # data/horizon/<site>.json
    python -m backend.precompute timeline        # data/timeline/<site>.json and data/summary/
    python -m backend.precompute map             # data/illumination.png + .json
    python -m backend.precompute timeline --sites site01,site04

Needs the SPICE kernels and the raw NASA rasters (`python -m backend.fetch_data ...`).
One process, one core.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np

from . import config, ephem, horizon, metrics, sites, terrain

PERIOD_START = "2026-11-14T00:00:00Z"
PERIOD_END = "2027-11-14T00:00:00Z"
STEP_MIN = 60
HEIGHT_M = 2.0
PRESETS = {"30d": 30 * 24, "1y": None}  # hours from the start; None = the whole timeline
TILE_N = 512
TILE_SIZE_M = 10000.0
SOURCE = (
    "NAIF SPICE (de440s, moon_pa_de440_200625, MOON_ME, LT+S), validated against JPL Horizons; "
    "horizon from LOLA elevation models (5 m PGDA site model, LDEM 20/80/120 m)"
)
MAP_SOURCE = "AVGVISIB_75S_120M_201608.TIF"
MAP_LAT_LIMIT = -83.0  # the northernmost site is at 83.7 S
MAP_BLOCK = 2  # source pixels averaged into one image pixel


def write_json(path: Path, obj, indent: int | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, indent=indent, separators=None if indent else (",", ":"), allow_nan=False)
    path.write_text(text + "\n", encoding="utf-8", newline="\n")


def site_surface(site: dict) -> terrain.Surface:
    return terrain.default_surface(site.get("pgda_model"))


def observer_for(site: dict, mask: np.ndarray, height_m: float = HEIGHT_M) -> metrics.Observer:
    return metrics.Observer(
        lat=site["lat"],
        lon=site["lon"],
        ground_m=site["elevation_m"],
        height_m=height_m,
        mask=np.asarray(mask, dtype=float),
        terrain=True,
        site_id=site["id"],
        name=site["name"],
    )


def horizon_object(site_id: str, mask: np.ndarray, height_m: float) -> dict:
    return {
        "site": site_id,
        "height_m": height_m,
        "step_deg": 360.0 / mask.size,
        "elevation_deg": [round(float(v), 3) for v in mask],
    }


def step_sites(_selected) -> None:
    write_json(config.DATA_DIR / "sites.json", sites.build_sites(), indent=1)


def step_terrain(selected: list[dict]) -> None:
    for site in selected:
        heights, z0 = terrain.local_tile(site_surface(site), site["lat"], site["lon"], TILE_N, TILE_SIZE_M)
        if np.isnan(heights).any():
            raise ValueError(f"{site['id']}: holes in the terrain tile")
        out = config.DATA_DIR / "terrain"
        out.mkdir(parents=True, exist_ok=True)
        heights.astype("<f4").tofile(out / f"{site['id']}.bin")
        meta = terrain.tile_metadata(site["id"], site["lat"], site["lon"], heights, z0, TILE_SIZE_M)
        write_json(out / f"{site['id']}.json", meta)


def step_horizon(selected: list[dict]) -> None:
    for site in selected:
        result = horizon.horizon_mask(
            site_surface(site), site["lat"], site["lon"], HEIGHT_M, site["elevation_m"]
        )
        if result["missing_fraction"] > 0:
            print(f"  {site['id']}: {result['missing_fraction']:.2%} of the ray samples had no data")
        obj = horizon_object(site["id"], result["elevation_deg"], HEIGHT_M)
        write_json(config.DATA_DIR / "horizon" / f"{site['id']}.json", obj)


def step_timeline(selected: list[dict]) -> None:
    times = ephem.time_grid(PERIOD_START, PERIOD_END, STEP_MIN)
    ets = ephem.to_et(times)
    compare = {name: [] for name in PRESETS}
    for site in selected:
        mask = json.loads((config.DATA_DIR / "horizon" / f"{site['id']}.json").read_text("utf-8"))
        obs = observer_for(site, mask["elevation_deg"], mask["height_m"])
        state = metrics.sky_state(obs, ets)
        write_json(
            config.DATA_DIR / "timeline" / f"{site['id']}.json", metrics.timeline(obs, times, state, SOURCE)
        )
        for name, hours in PRESETS.items():
            n = len(times) if hours is None else hours * 60 // STEP_MIN + 1
            part = {k: {f: v[:n] for f, v in body.items()} for k, body in state.items()}
            summary = metrics.summarize(obs, ets[:n], part)
            compare[name].append(summary)
            suffix = "" if hours is None else f"_{name}"
            write_json(config.DATA_DIR / "summary" / f"{site['id']}{suffix}.json", summary)
    if len(selected) == len(sites.load_sites()):
        for name, rows in compare.items():
            write_json(config.DATA_DIR / "summary" / f"compare_{name}.json", rows)


def illumination_layer() -> tuple[np.ndarray, dict]:
    """Grey image (uint8, row 0 = y max) of the NASA average illumination map and its description."""
    vis = terrain.load_geotiff(MAP_SOURCE, sites.ILLUMINATION_SCALE)
    half = 2.0 * config.MOON_RADIUS_M * np.tan(np.radians(90.0 + MAP_LAT_LIMIT) / 2.0)
    n = int(np.ceil(half / (vis.step * MAP_BLOCK))) * MAP_BLOCK  # source pixels from the pole to the edge
    rows, cols = vis.data.shape
    dn = vis.data[rows // 2 - n : rows // 2 + n, cols // 2 - n : cols // 2 + n]
    if (dn == vis.nodata).any():
        raise ValueError("missing values inside the map layer")
    size = 2 * n // MAP_BLOCK
    value = dn.astype(float).reshape(size, MAP_BLOCK, size, MAP_BLOCK).mean(axis=(1, 3)) * vis.scale
    grey = np.round(255.0 * np.sqrt(np.clip(value, 0.0, 1.0))).astype(np.uint8)
    edge_km = n * vis.step / 1000.0
    meta = {
        "file": "illumination.png",
        "x_km": [-edge_km, edge_km],
        "y_km": [-edge_km, edge_km],
        "width": size,
        "height": size,
        "pixel_m": vis.step * MAP_BLOCK,
        "lat_limit": MAP_LAT_LIMIT,
        "projection": "south polar stereographic, sphere 1737.4 km, true scale at the pole: "
        "rho = 2R*tan((90+lat)/2), x = rho*sin(lon) (towards 90 E), y = rho*cos(lon) (towards 0 E); "
        "image row 0 is y max, column 0 is x min",
        "value": "share of time any part of the solar disc is visible, 0..1; grey = 255*sqrt(value)",
        "legend": [
            {"percent": p, "grey": int(round(255.0 * np.sqrt(p / 100.0)))} for p in (0, 10, 25, 50, 75, 100)
        ],
        "source": f"NASA LOLA average illumination map {MAP_SOURCE.split('.')[0]} "
        "(PGDA, Mazarico et al. 2011), 18.6-year average, 120 m pixels averaged to 240 m",
    }
    return grey, meta


def step_map(_selected) -> None:
    from PIL import Image

    grey, meta = illumination_layer()
    Image.fromarray(grey, "L").save(config.DATA_DIR / "illumination.png", optimize=True)
    write_json(config.DATA_DIR / "illumination.json", meta, indent=1)


STEPS = {
    "sites": step_sites,
    "terrain": step_terrain,
    "horizon": step_horizon,
    "timeline": step_timeline,
    "map": step_map,
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("step", nargs="?", default="all", choices=["all", *STEPS])
    parser.add_argument("--sites", default="", help="comma separated site ids (default: all)")
    args = parser.parse_args(argv)
    for name in STEPS if args.step == "all" else [args.step]:
        t0 = time.time()
        selected = [] if name == "sites" else sites.load_sites()
        if args.sites:
            wanted = set(args.sites.split(","))
            selected = [s for s in selected if s["id"] in wanted]
        STEPS[name](selected)
        print(f"{name}: {time.time() - t0:.1f} s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
