"""Live API with the shapes of docs/API.md.

    uvicorn backend.api:app --port 8000

Listed sites are served from the horizon masks stored in `data/` (only the SPICE kernels
are needed). Custom coordinates and other instrument heights need the NASA elevation
rasters (`python -m backend.fetch_data rasters`); without them a custom point is computed
on a smooth sphere and marked `"terrain": false`.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache

import numpy as np
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware

from . import config, ephem, horizon, metrics, precompute, sites, terrain

MAX_SAMPLES = 20000  # per request: two years at one hour
MAX_HEIGHT_M = 100.0
SITE_TOKEN = re.compile(r"custom:-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?|[A-Za-z0-9_]+")
SOURCE_FLAT = (
    "NAIF SPICE (de440s, moon_pa_de440_200625, MOON_ME, LT+S), validated against JPL Horizons; "
    "no elevation data for this point: smooth sphere horizon"
)

app = FastAPI(
    title="Lunar Landing Site Navigator API",
    description="Sun and Earth visibility at lunar south polar sites from NASA SPICE kernels "
    "and LOLA elevation models.",
    version="1.0.0",
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])


def rasters_available() -> bool:
    return (config.RAW_DIR / f"{terrain.LDEM_NEAR}.img").exists()


def _stored_mask(site_id: str, height_m: float) -> np.ndarray | None:
    suffix = "" if height_m == precompute.HEIGHT_M else f"_h{height_m:g}"
    path = config.DATA_DIR / "horizon" / f"{site_id}{suffix}.json"
    if not path.exists():
        return None
    stored = json.loads(path.read_text("utf-8"))
    return np.asarray(stored["elevation_deg"], dtype=float) if stored["height_m"] == height_m else None


@lru_cache(maxsize=256)
def observer(site: str, height_m: float) -> metrics.Observer:
    """Observer for a site id or `custom:lat,lon`."""
    if not 0.0 <= height_m <= MAX_HEIGHT_M:
        raise HTTPException(422, f"height_m must be between 0 and {MAX_HEIGHT_M:g}")
    if site.startswith("custom:"):
        if not SITE_TOKEN.fullmatch(site):
            raise HTTPException(422, "custom site must look like custom:-89.5,0 (latitude, east longitude)")
        lat, lon = (float(v) for v in site[len("custom:") :].split(","))
        if not -90.0 <= lat <= 90.0 or not -360.0 <= lon <= 360.0:
            raise HTTPException(422, "latitude must be within -90..90 and longitude within -360..360")
        lon %= 360.0
        if rasters_available():
            try:
                result = horizon.horizon_mask(terrain.default_surface(), lat, lon, height_m)
                return metrics.Observer(
                    lat, lon, round(result["ground_m"], 1), height_m, result["elevation_deg"], terrain=True
                )
            except ValueError:
                pass  # outside the elevation models
        return metrics.Observer(lat, lon, 0.0, height_m, horizon.flat_mask(height_m), terrain=False)
    try:
        record = sites.find_site(site)
    except KeyError:
        raise HTTPException(404, f"unknown site '{site}'; see /api/sites") from None
    mask = _stored_mask(site, height_m)
    if mask is None:
        if not rasters_available():
            raise HTTPException(
                503,
                f"no stored horizon for height_m={height_m:g} and the elevation rasters are not installed",
            )
        mask = horizon.horizon_mask(
            precompute.site_surface(record), record["lat"], record["lon"], height_m, record["elevation_m"]
        )["elevation_deg"]
    return precompute.observer_for(record, mask, height_m)


def grid(start: str | None, end: str | None, step_min: float):
    try:
        times = ephem.time_grid(start or precompute.PERIOD_START, end or precompute.PERIOD_END, step_min)
    except ValueError as err:
        raise HTTPException(422, f"bad time range: {err}") from None
    if len(times) > MAX_SAMPLES:
        raise HTTPException(422, f"too many samples ({len(times)}); the limit is {MAX_SAMPLES}")
    if len(times) < 2:
        raise HTTPException(422, "the period must contain at least two samples")
    return times, ephem.to_et(times)


def source_of(obs: metrics.Observer) -> str:
    return precompute.SOURCE if obs.terrain else SOURCE_FLAT


@app.get("/api/health")
def health() -> dict:
    ephem.load_kernels()
    return {
        "status": "ok",
        "sites": len(sites.load_sites()),
        "kernels": list(config.KERNELS),
        "custom_terrain": rasters_available(),
        "period": {"start": precompute.PERIOD_START, "end": precompute.PERIOD_END},
    }


@app.get("/api/sites")
def get_sites() -> list[dict]:
    return sites.load_sites()


@app.get("/api/timeline")
def get_timeline(
    site: str,
    start: str | None = None,
    end: str | None = None,
    step: float = Query(60.0, ge=1.0, le=1440.0, description="minutes"),
    height_m: float = 2.0,
) -> dict:
    obs = observer(site, height_m)
    times, ets = grid(start, end, step)
    return metrics.timeline(obs, times, metrics.sky_state(obs, ets), source_of(obs))


def _summary(site: str, start: str | None, end: str | None, height_m: float) -> dict:
    obs = observer(site, height_m)
    _, ets = grid(start, end, precompute.STEP_MIN)
    out = metrics.summarize(obs, ets, metrics.sky_state(obs, ets))
    out["site"]["terrain"] = obs.terrain
    return out


@app.get("/api/summary")
def get_summary(site: str, start: str | None = None, end: str | None = None, height_m: float = 2.0) -> dict:
    return _summary(site, start, end, height_m)


@app.get("/api/compare")
def get_compare(
    sites: str = Query(..., description="comma separated ids, e.g. site01,site04,custom:-89.5,0"),
    start: str | None = None,
    end: str | None = None,
    height_m: float = 2.0,
) -> list[dict]:
    names = SITE_TOKEN.findall(sites)
    if not names or len(names) > 12:
        raise HTTPException(422, "give 1 to 12 sites")
    return [_summary(name, start, end, height_m) for name in names]


@app.get("/api/horizon")
def get_horizon(site: str, height_m: float = 2.0) -> dict:
    obs = observer(site, height_m)
    out = precompute.horizon_object(obs.site_id, obs.mask, height_m)
    out["terrain"] = obs.terrain
    return out


def _tile(site: str, size_km: float):
    """Metadata and heights of the local terrain tile, from `data/` when it is stored there."""
    if not 1.0 <= size_km <= 40.0:
        raise HTTPException(422, "size_km must be between 1 and 40")
    obs = observer(site, precompute.HEIGHT_M)
    stored = config.DATA_DIR / "terrain" / f"{obs.site_id}.json"
    if not site.startswith("custom:") and size_km * 1000.0 == precompute.TILE_SIZE_M and stored.exists():
        meta = json.loads(stored.read_text("utf-8"))
        return meta, np.fromfile(config.DATA_DIR / meta["file"], dtype="<f4")
    if not obs.terrain or not rasters_available():
        raise HTTPException(404, "no elevation data for this point (terrain: false)")
    surface = terrain.default_surface(sites.model_name(obs.site_id))
    heights, z0 = terrain.local_tile(surface, obs.lat, obs.lon, precompute.TILE_N, size_km * 1000.0)
    if np.isnan(heights).any():
        raise HTTPException(404, "the tile reaches beyond the elevation data")
    meta = terrain.tile_metadata(obs.site_id, obs.lat, obs.lon, heights, z0, size_km * 1000.0)
    return meta, heights.astype("<f4").ravel()


@app.get("/api/terrain")
def get_terrain(site: str, size_km: float = 10.0) -> dict:
    meta, _ = _tile(site, size_km)
    meta["url"] = f"/api/terrain.bin?site={site}&size_km={size_km:g}"
    return meta


@app.get("/api/terrain.bin")
def get_terrain_bin(site: str, size_km: float = 10.0) -> Response:
    _, heights = _tile(site, size_km)
    return Response(heights.tobytes(), media_type="application/octet-stream")


@app.get("/api/sky")
def get_sky(site: str, time: str, height_m: float = 2.0) -> dict:
    obs = observer(site, height_m)
    try:
        ets = ephem.to_et([time])
    except ValueError as err:
        raise HTTPException(422, f"bad time: {err}") from None
    return metrics.sky(obs, time, metrics.sky_state(obs, ets))
