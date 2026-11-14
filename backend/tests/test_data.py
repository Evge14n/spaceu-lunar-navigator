"""The committed files in `data/` are what the code computes, and have the shapes of docs/API.md."""

from __future__ import annotations

import json

import numpy as np
import pytest

from backend import config, ephem, metrics, precompute, sites, terrain

DATA = config.DATA_DIR
SITES = json.loads((DATA / "sites.json").read_text("utf-8")) if (DATA / "sites.json").exists() else []
pytestmark = pytest.mark.skipif(not SITES, reason="data/ is not generated yet")


def load(path: str):
    return json.loads((DATA / path).read_text("utf-8"))


def test_site_list():
    assert [s["id"] for s in SITES] == [m.id for m in sites.SITE_MODELS]
    for site, model in zip(SITES, sites.SITE_MODELS, strict=True):
        assert site["name"] == model.name and site["has_5m"] is True
        assert -90.0 < site["lat"] < -83.0 and 0.0 <= site["lon"] < 360.0
        assert {"id", "name", "lat", "lon", "elevation_m", "source", "has_5m"} <= set(site)
        # the published lat/lon are the map point x_m, y_m
        x, y = terrain.latlon_to_xy(site["lat"], site["lon"])
        assert abs(x - site["x_m"]) < 1.0 and abs(y - site["y_m"]) < 1.0


@pytest.mark.parametrize("site", SITES, ids=lambda s: s["id"])
def test_static_files_have_the_contract_shapes(site):
    sid = site["id"]
    hor = load(f"horizon/{sid}.json")
    assert hor["site"] == sid and hor["height_m"] == 2.0 and hor["step_deg"] == 0.5
    assert len(hor["elevation_deg"]) == 720 and all(-10.0 < v < 30.0 for v in hor["elevation_deg"])

    meta = load(f"terrain/{sid}.json")
    assert (
        meta["site"] == sid
        and meta["n"] == 512
        and meta["size_m"] == 10000.0
        and meta["file"] == f"terrain/{sid}.bin"
    )
    assert meta["center"] == {"lat": site["lat"], "lon": site["lon"]}
    heights = np.fromfile(DATA / meta["file"], dtype="<f4")
    assert heights.size == 512 * 512 and np.isfinite(heights).all()
    assert float(heights.min()) == pytest.approx(meta["min_h"], abs=0.06)
    assert float(heights.max()) == pytest.approx(meta["max_h"], abs=0.06)
    # the site stands on its own ground: the centre of the tile is at height 0 (within one cell of slope)
    centre = heights.reshape(512, 512)[255:257, 255:257]
    assert abs(float(centre.mean())) < 15.0

    tl = load(f"timeline/{sid}.json")
    n = len(tl["times"])
    assert (
        n == 8761 and tl["times"][0] == precompute.PERIOD_START and tl["times"][-1] == precompute.PERIOD_END
    )
    assert tl["site"]["id"] == sid and tl["site"]["terrain"] is True and tl["height_m"] == 2.0
    assert (tl["site"]["lat"], tl["site"]["lon"]) == (site["lat"], site["lon"])
    for body, keys in (
        ("sun", ("az", "el", "horizon_el", "visible_fraction")),
        ("earth", ("az", "el", "horizon_el", "visible", "distance_km")),
    ):
        for key in keys:
            assert len(tl[body][key]) == n, (body, key)
    assert min(tl["sun"]["visible_fraction"]) == 0.0 and max(tl["sun"]["visible_fraction"]) == 1.0


@pytest.mark.parametrize("site", SITES, ids=lambda s: s["id"])
def test_timeline_and_summary_are_reproduced(site):
    """Recompute the year from the stored horizon mask (needs only the SPICE kernels)."""
    sid = site["id"]
    mask = load(f"horizon/{sid}.json")
    obs = precompute.observer_for(site, mask["elevation_deg"], mask["height_m"])
    times = ephem.time_grid(precompute.PERIOD_START, precompute.PERIOD_END, precompute.STEP_MIN)
    ets = ephem.to_et(times)
    state = metrics.sky_state(obs, ets)
    assert metrics.timeline(obs, times, state, precompute.SOURCE) == load(f"timeline/{sid}.json")
    assert metrics.summarize(obs, ets, state) == load(f"summary/{sid}.json")
    n = 30 * 24 + 1
    part = {k: {f: v[:n] for f, v in body.items()} for k, body in state.items()}
    month = metrics.summarize(obs, ets[:n], part)
    assert month == load(f"summary/{sid}_30d.json")
    assert month in load("summary/compare_30d.json")


def test_summary_agrees_with_counting_the_timeline_samples():
    """What the browser computes from the timeline equals the stored summary percentages."""
    for site in SITES:
        tl = load(f"timeline/{site['id']}.json")
        summary = load(f"summary/{site['id']}.json")
        lit = 100.0 * np.mean(np.array(tl["sun"]["visible_fraction"]) > 0)
        seen = 100.0 * np.mean(tl["earth"]["visible"])
        assert summary["sun"]["lit_percent"] == pytest.approx(lit, abs=0.051)
        assert summary["earth"]["visible_percent"] == pytest.approx(seen, abs=0.051)
        assert summary["sun"]["max_el"] == pytest.approx(max(tl["sun"]["el"]), abs=1e-3)


def test_mast_heights_are_reproduced_and_help():
    """data/summary/heights.json: the year with the instrument at 1, 2, 5 and 10 m."""
    table = load("summary/heights.json")
    assert [row["site"]["id"] for row in table] == [s["id"] for s in SITES]
    ets = ephem.to_et(ephem.time_grid(precompute.PERIOD_START, precompute.PERIOD_END, precompute.STEP_MIN))
    for site, entry in zip(SITES, table, strict=True):
        rows = entry["heights"]
        assert [r["height_m"] for r in rows] == [1.0, 2.0, 5.0, 10.0]
        assert entry["period"] == {"start": precompute.PERIOD_START, "end": precompute.PERIOD_END}
        assert rows[1] == precompute.height_row(load(f"summary/{site['id']}.json"))
        # a higher instrument looks over more of the terrain: never less Sun, never less Earth
        for low, high in zip(rows[:-1], rows[1:], strict=True):
            assert high["sun"]["lit_percent"] >= low["sun"]["lit_percent"]
            assert high["sun"]["energy_kwh_m2"] >= low["sun"]["energy_kwh_m2"]
            assert high["earth"]["visible_percent"] >= low["earth"]["visible_percent"]
        for height in precompute.EXTRA_HEIGHTS_M:
            mask = load(f"horizon/{site['id']}_h{height:g}.json")
            base = load(f"horizon/{site['id']}.json")
            assert mask["site"] == site["id"] and mask["height_m"] == height
            diff = np.array(mask["elevation_deg"]) - np.array(base["elevation_deg"])
            # the horizon sinks when the instrument rises (and the other way round)
            assert (diff <= 0.0011).all() if height > 2.0 else (diff >= -0.0011).all()
    # recompute two sites from the stored masks (needs only the SPICE kernels)
    for site, entry in list(zip(SITES, table, strict=True))[:2]:
        mask = load(f"horizon/{site['id']}_h10.json")
        obs = precompute.observer_for(site, mask["elevation_deg"], 10.0)
        again = precompute.height_row(metrics.summarize(obs, ets, metrics.sky_state(obs, ets)))
        assert again == entry["heights"][3]


def test_apollo_reference():
    """data/reference/apollo11.json: an equatorial site for contrast (two weeks of night)."""
    ref = load("reference/apollo11.json")
    assert ref == precompute.reference_summary()
    assert ref["site"]["terrain"] is False and (ref["site"]["lat"], ref["site"]["lon"]) == (0.67416, 23.47314)
    assert 49.0 < ref["sun"]["lit_percent"] < 52.0
    assert 350.0 < ref["sun"]["longest_dark_h"] < 356.0  # half a synodic month is 354.4 h
    assert ref["sun"]["max_el"] > 88.0 and ref["earth"]["visible_percent"] == 100.0
    # the best polar ridges have a longest night several times shorter than the equator
    nights = sorted(load(f"summary/{s['id']}.json")["sun"]["longest_dark_h"] for s in SITES)
    assert nights[0] < ref["sun"]["longest_dark_h"] / 4.0 and nights[2] < ref["sun"]["longest_dark_h"] / 2.0
    best = max(load(f"summary/{s['id']}.json")["sun"]["energy_kwh_m2"] for s in SITES)
    assert best > 1.5 * ref["sun"]["energy_kwh_m2"]


@pytest.mark.raw
def test_mast_horizons_are_reproduced_from_the_rasters():
    from backend import horizon

    site = SITES[1]
    result = horizon.horizon_mask(
        precompute.site_surface(site), site["lat"], site["lon"], 10.0, site["elevation_m"]
    )
    assert precompute.horizon_object(site["id"], result["elevation_deg"], 10.0) == load(
        f"horizon/{site['id']}_h10.json"
    )


@pytest.mark.raw
def test_sites_and_terrain_are_reproduced_from_the_rasters():
    assert sites.build_sites() == SITES
    for site in SITES[:3]:
        heights, z0 = terrain.local_tile(
            precompute.site_surface(site), site["lat"], site["lon"], precompute.TILE_N, precompute.TILE_SIZE_M
        )
        stored = np.fromfile(DATA / "terrain" / f"{site['id']}.bin", dtype="<f4").reshape(512, 512)
        assert np.array_equal(heights, stored)
        assert z0 == pytest.approx(site["elevation_m"], abs=0.3)


def test_illumination_layer():
    meta_path = DATA / "illumination.json"
    if not meta_path.exists():
        pytest.skip("map layer is not generated yet")
    from PIL import Image

    meta = load("illumination.json")
    grey = np.asarray(Image.open(DATA / meta["file"]))
    assert grey.shape == (meta["height"], meta["width"]) and grey.dtype == np.uint8
    edge = meta["width"] * meta["pixel_m"] / 2000.0
    assert meta["x_km"] == [-edge, edge] and meta["y_km"] == [-edge, edge]
    # the edge of the layer is at (or just beyond) the stated latitude
    lat, _ = terrain.xy_to_latlon(edge * 1000.0, 0.0)
    assert meta["lat_limit"] <= lat < meta["lat_limit"] + 0.02
    # every site is inside the layer and on a pixel much brighter than the typical one
    pixel_km = meta["pixel_m"] / 1000.0
    for site in SITES:
        col = int((site["x_m"] / 1000.0 - meta["x_km"][0]) / pixel_km)
        row = int((meta["y_km"][1] - site["y_m"] / 1000.0) / pixel_km)
        assert 0 <= row < meta["height"] and 0 <= col < meta["width"]
        assert grey[row, col] > np.percentile(grey, 90), site["id"]


@pytest.mark.raw
def test_illumination_layer_is_reproduced_from_the_nasa_map():
    from PIL import Image

    grey, meta = precompute.illumination_layer()
    assert meta == load("illumination.json")
    assert np.array_equal(grey, np.asarray(Image.open(DATA / meta["file"])))
    # spot check against the source raster: the pixel of the first site
    vis = terrain.load_geotiff(precompute.MAP_SOURCE, sites.ILLUMINATION_SCALE)
    site = SITES[0]
    col = int((site["x_m"] - meta["x_km"][0] * 1000.0) / meta["pixel_m"])
    row = int((meta["y_km"][1] * 1000.0 - site["y_m"]) / meta["pixel_m"])
    x = meta["x_km"][0] * 1000.0 + (col + 0.5) * meta["pixel_m"]
    y = meta["y_km"][1] * 1000.0 - (row + 0.5) * meta["pixel_m"]
    # the centre of a 2 x 2 block: bilinear sampling there is the mean of the four source pixels
    assert (grey[row, col] / 255.0) ** 2 == pytest.approx(float(vis.sample(x, y)), abs=0.01)
