"""Candidate landing sites: the ten LOLA 5 m site models published by NASA PGDA.

Nothing here is typed by hand except the names, which are copied from the PGDA README.
Each site model is a 16 to 30 km wide tile, and its geometric centre is usually not
the place of interest (the centre of the "Shackleton rim" tile lies on the crater
wall with 11 % average sunlight). The point of a site is therefore chosen by a rule
applied to NASA data:

    the pixel with the highest average illumination in the NASA LOLA illumination map
    (Mazarico et al. 2011, 2016 release; 60 m pixels, 120 m for the one tile north of
    85 S), at least 3 km from the edge of the tile.

The centre of the tile is kept in `tile_center` for reference.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

import numpy as np

from . import config, terrain

SOURCE_5M = "LOLA 5 m site model (PGDA, Barker et al. 2021)"
ILLUMINATION_MAPS = ("AVGVISIB_85S_060M_201608.TIF", "AVGVISIB_75S_120M_201608.TIF")
ILLUMINATION_SCALE = 0.00004  # map value = DN * scale, 1.0 = always lit
WINDOW_M = 60.0  # one pixel of the 60 m map; larger values average several pixels
EDGE_MARGIN_M = 3000.0


@dataclass(frozen=True)
class SiteModel:
    id: str
    pgda: str  # directory / file prefix on pgda.gsfc.nasa.gov/data/LOLA_5mpp/
    name: str  # as in the PGDA README


SITE_MODELS = (
    SiteModel("site01", "Site01", "Connecting ridge"),
    SiteModel("site04", "Site04", "Shackleton rim"),
    SiteModel("site06", "Site06", "Nobile rim 1"),
    SiteModel("site07", "Site07", "Peak near Shackleton"),
    SiteModel("site11", "Site11", "de Gerlache rim"),
    SiteModel("site20", "Site20", "Leibnitz beta plateau"),
    SiteModel("site23", "Site23", "Malapert massif"),
    SiteModel("haworth", "Haworth", "Haworth"),
    SiteModel("shoemaker", "Shoemaker", "Shoemaker"),
    SiteModel("dm2", "DM2", "Nobile rim 2"),
)

# For contrast with the pole: the Apollo 11 Lunar Module. Coordinates from the NASA NSSDCA
# table "Apollo Landing Site Coordinates" (Wagner et al. 2017, Mean Earth/Polar Axis, DE421).
APOLLO_11 = {
    "id": "apollo11",
    "name": "Apollo 11 (Tranquility Base)",
    "lat": 0.67416,
    "lon": 23.47314,
    "source": "NASA NSSDCA, Apollo Landing Site Coordinates (Wagner et al. 2017); smooth sphere horizon",
}


def best_lit_point(tile: terrain.Grid, vis: terrain.Grid) -> tuple[float, float, float] | None:
    """Map x, y (m) of the best-lit window inside the tile and its mean illumination (0..1).

    Returns None when the tile is not fully inside the illumination map.
    """
    x_min, y_min, x_max, y_max = tile.bounds
    vx_min, vy_min, vx_max, vy_max = vis.bounds
    if x_min < vx_min or y_min < vy_min or x_max > vx_max or y_max > vy_max:
        return None
    w = max(1, round(WINDOW_M / vis.step))
    c0 = int(np.ceil((x_min + EDGE_MARGIN_M - vis.x0) / vis.step))
    c1 = int(np.floor((x_max - EDGE_MARGIN_M - vis.x0) / vis.step))
    r0 = int(np.ceil((vis.y0 - (y_max - EDGE_MARGIN_M)) / vis.step))
    r1 = int(np.floor((vis.y0 - (y_min + EDGE_MARGIN_M)) / vis.step))
    sub = vis.data[r0 : r1 + 1, c0 : c1 + 1].astype(float)
    sub[sub == vis.nodata] = np.nan
    # mean over w x w windows (top-left corner indexing)
    acc = np.zeros((sub.shape[0] - w + 1, sub.shape[1] - w + 1))
    for dr in range(w):
        for dc in range(w):
            acc += sub[dr : dr + acc.shape[0], dc : dc + acc.shape[1]]
    acc /= w * w
    r, c = np.unravel_index(np.nanargmax(acc), acc.shape)
    x = vis.x0 + (c0 + c + (w - 1) / 2.0) * vis.step
    y = vis.y0 - (r0 + r + (w - 1) / 2.0) * vis.step
    return float(x), float(y), float(acc[r, c] * vis.scale)


def build_sites() -> list[dict]:
    """Derive the site list from the raw NASA rasters (needs the raw data folder)."""
    out = []
    for model in SITE_MODELS:
        tile = terrain.load_geotiff(terrain.site_tiff_path(model.pgda))
        x_min, y_min, x_max, y_max = tile.bounds
        cx, cy = (x_min + x_max) / 2.0, (y_min + y_max) / 2.0
        for map_name in ILLUMINATION_MAPS:
            vis = terrain.load_geotiff(map_name, ILLUMINATION_SCALE)
            best = best_lit_point(tile, vis)
            if best is not None:
                break
        else:
            raise ValueError(f"{model.pgda} is outside every illumination map")
        x, y, mean_lit = best
        window_m = max(1, round(WINDOW_M / vis.step)) * vis.step
        lat, lon = terrain.xy_to_latlon(x, y)
        c_lat, c_lon = terrain.xy_to_latlon(cx, cy)
        out.append(
            {
                "id": model.id,
                "name": model.name,
                "lat": round(float(lat), 5),
                "lon": round(float(lon), 4),
                "elevation_m": round(float(tile.sample(x, y)), 1),
                "source": SOURCE_5M,
                "has_5m": True,
                "pgda_model": model.pgda,
                "x_m": x,
                "y_m": y,
                "point_rule": f"best-lit {window_m:.0f} m pixel of {map_name} inside the 5 m tile",
                "nasa_avg_illumination_percent": round(100.0 * mean_lit, 1),
                "tile_center": {"lat": round(float(c_lat), 5), "lon": round(float(c_lon), 4)},
                "tile_size_km": round((x_max - x_min) / 1000.0, 1),
            }
        )
    return out


def load_sites() -> list[dict]:
    """The committed site list (`data/sites.json`)."""
    return json.loads((config.DATA_DIR / "sites.json").read_text("utf-8"))


def find_site(site_id: str) -> dict:
    for site in load_sites():
        if site["id"] == site_id:
            return site
    raise KeyError(site_id)


def model_name(site_id: str) -> str | None:
    """PGDA directory name of a site id, or None for custom points."""
    for model in SITE_MODELS:
        if model.id == site_id:
            return model.pgda
    return None
