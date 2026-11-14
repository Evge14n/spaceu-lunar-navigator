"""Live API: the same numbers and shapes as the static files of `data/`."""

from __future__ import annotations

import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend import api, config, ephem, horizon, precompute

DATA = config.DATA_DIR
pytestmark = pytest.mark.skipif(not (DATA / "sites.json").exists(), reason="data/ is not generated yet")
client = TestClient(api.app)


def load(path: str):
    return json.loads((DATA / path).read_text("utf-8"))


@pytest.fixture
def no_rasters(monkeypatch):
    """The API as deployed without the 1.6 GB of elevation rasters."""
    monkeypatch.setattr(api, "rasters_available", lambda: False)
    api.observer.cache_clear()
    yield
    api.observer.cache_clear()


def test_health_and_sites():
    body = client.get("/api/health").json()
    assert body["status"] == "ok" and body["sites"] == 10
    assert client.get("/api/sites").json() == load("sites.json")


def test_timeline_of_a_listed_site_is_the_static_file(no_rasters):
    assert client.get("/api/timeline", params={"site": "site04"}).json() == load("timeline/site04.json")


def test_summary_and_compare_are_the_static_files(no_rasters):
    got = client.get("/api/summary", params={"site": "site23"}).json()
    assert got["site"].pop("terrain") is True
    assert got == load("summary/site23.json")
    month = {"start": precompute.PERIOD_START, "end": "2026-12-14T00:00:00Z"}
    got = client.get("/api/compare", params={"sites": "site01,site04,shoemaker", **month}).json()
    for row in got:
        assert row["site"].pop("terrain") is True
    assert got == [load(f"summary/{s}_30d.json") for s in ("site01", "site04", "shoemaker")]


def test_horizon_and_terrain_of_a_listed_site(no_rasters):
    got = client.get("/api/horizon", params={"site": "site07"}).json()
    assert got.pop("terrain") is True
    assert got == load("horizon/site07.json")
    meta = client.get("/api/terrain", params={"site": "site07"}).json()
    assert meta.pop("url") == "/api/terrain.bin?site=site07&size_km=10"
    assert meta == load("terrain/site07.json")
    raw = client.get("/api/terrain.bin", params={"site": "site07"})
    assert raw.headers["content-type"] == "application/octet-stream"
    assert raw.content == (DATA / "terrain" / "site07.bin").read_bytes()


def test_stored_mast_heights_need_no_rasters(no_rasters):
    got = client.get("/api/horizon", params={"site": "site04", "height_m": 10}).json()
    assert got.pop("terrain") is True
    assert got == load("horizon/site04_h10.json")
    summary = client.get("/api/summary", params={"site": "site04", "height_m": 10}).json()
    row = next(e for e in load("summary/heights.json") if e["site"]["id"] == "site04")["heights"][3]
    assert summary["height_m"] == 10.0 == row["height_m"]
    for body in ("sun", "earth"):
        assert {k: summary[body][k] for k in row[body]} == row[body]
    base = load("summary/site04.json")
    assert summary["sun"]["lit_percent"] > base["sun"]["lit_percent"]
    assert summary["sun"]["longest_dark_h"] < base["sun"]["longest_dark_h"]


def test_sky_is_a_sample_of_the_timeline(no_rasters):
    tl = load("timeline/site04.json")
    i = 1234
    sky = client.get("/api/sky", params={"site": "site04", "time": tl["times"][i]}).json()
    assert sky["time"] == tl["times"][i]
    for body in ("sun", "earth"):
        for key in ("az", "el", "horizon_el"):
            assert sky[body][key] == tl[body][key][i]
        az, el = np.radians(sky[body]["az"]), np.radians(sky[body]["el"])
        expected = [np.cos(el) * np.sin(az), np.sin(el), -np.cos(el) * np.cos(az)]  # x east, y up, z south
        assert sky[body]["dir"] == pytest.approx(expected, abs=1e-4)
    assert sky["sun"]["visible_fraction"] == tl["sun"]["visible_fraction"][i]
    assert sky["earth"]["visible"] == tl["earth"]["visible"][i]
    assert sky["earth"]["distance_km"] == tl["earth"]["distance_km"][i]
    assert sky["sun"]["irradiance_w_m2"] == pytest.approx(
        1361.0 * sky["sun"]["visible_fraction"], rel=0.04, abs=1.0
    )
    assert sky["sun"]["angular_radius_deg"] == pytest.approx(0.27, abs=0.01)
    assert sky["earth"]["angular_radius_deg"] == pytest.approx(0.95, abs=0.08)


def test_custom_point_without_rasters_is_an_honest_smooth_sphere(no_rasters):
    params = {
        "site": "custom:-89.5,0",
        "start": "2026-11-14T00:00:00Z",
        "end": "2026-11-16T00:00:00Z",
        "step": 720,
    }
    tl = client.get("/api/timeline", params=params).json()
    assert tl["site"] == {"id": "custom", "lat": -89.5, "lon": 0.0, "elevation_m": 0.0, "terrain": False}
    assert len(tl["times"]) == 5 and "smooth sphere" in tl["source"]
    assert set(tl["sun"]["horizon_el"]) == {round(horizon.smooth_sphere_dip(2.0), 3)}
    ref = ephem.sun_earth(-89.5, 0.0, 2.0, tl["times"])
    assert tl["sun"]["el"] == pytest.approx(ref["sun"]["el"], abs=6e-4)
    assert tl["earth"]["az"] == pytest.approx(ref["earth"]["az"], abs=6e-4)
    # the mock timeline was made from JPL Horizons for the same point (smooth sphere, 2 m)
    mock = load("mock/timeline.json")
    i = mock["times"].index(tl["times"][1])
    assert tl["sun"]["el"][1] == pytest.approx(mock["sun"]["el"][i], abs=2e-3)
    assert tl["earth"]["az"][1] == pytest.approx(mock["earth"]["az"][i], abs=2e-3)
    hor = client.get("/api/horizon", params={"site": "custom:-89.5,0"}).json()
    assert hor["terrain"] is False and len(hor["elevation_deg"]) == 720
    assert client.get("/api/terrain", params={"site": "custom:-89.5,0"}).status_code == 404


def test_a_point_far_from_the_pole_still_gets_the_ephemeris(no_rasters):
    # Apollo 11 landing site (0.674 N, 23.473 E): the Sun climbs high, the Earth never sets
    got = client.get("/api/summary", params={"site": "custom:0.674,23.473"}).json()
    assert got["site"]["terrain"] is False
    assert 48.0 < got["sun"]["lit_percent"] < 52.0 and got["sun"]["max_el"] > 85.0
    assert got["earth"]["visible_percent"] == 100.0 and got["earth"]["next_earthset"] is None


def test_errors(no_rasters):
    assert client.get("/api/timeline", params={"site": "nowhere"}).status_code == 404
    assert client.get("/api/timeline", params={"site": "custom:north,3"}).status_code == 422
    assert client.get("/api/timeline", params={"site": "custom:-95,3"}).status_code == 422
    assert client.get("/api/timeline", params={"site": "site04", "step": 1}).status_code == 422  # too many
    assert client.get("/api/timeline", params={"site": "site04", "start": "yesterday"}).status_code == 422
    bad = {"site": "site04", "start": "2027-01-01T00:00:00Z", "end": "2026-01-01T00:00:00Z"}
    assert client.get("/api/timeline", params=bad).status_code == 422
    assert client.get("/api/sky", params={"site": "site04", "time": "noon"}).status_code == 422
    assert client.get("/api/timeline", params={"site": "site04", "height_m": -1}).status_code == 422
    # another instrument height needs a new horizon mask, which needs the rasters
    assert client.get("/api/horizon", params={"site": "site04", "height_m": 7}).status_code == 503
    assert client.get("/api/compare", params={"sites": ","}).status_code == 422


def test_cors_allows_the_static_site():
    got = client.get("/api/health", headers={"Origin": "https://evge14n.github.io"})
    assert got.headers["access-control-allow-origin"] == "*"


@pytest.mark.raw
def test_custom_point_with_rasters_uses_the_terrain():
    api.observer.cache_clear()
    site = load("sites.json")[1]  # Shackleton rim
    name = f"custom:{site['lat']},{site['lon']}"
    got = client.get("/api/summary", params={"site": name}).json()
    stored = load(f"summary/{site['id']}.json")
    assert got["site"] == {"id": "custom", "name": "Custom point", "terrain": True}
    # the same point through the 20 m model instead of the 5 m one
    assert got["sun"]["lit_percent"] == pytest.approx(stored["sun"]["lit_percent"], abs=4.0)
    assert got["earth"]["visible_percent"] == pytest.approx(stored["earth"]["visible_percent"], abs=4.0)
    hor = client.get("/api/horizon", params={"site": name}).json()
    assert hor["terrain"] is True
    assert (
        np.abs(np.array(hor["elevation_deg"]) - load(f"horizon/{site['id']}.json")["elevation_deg"]).mean()
        < 0.5
    )
    meta = client.get("/api/terrain", params={"site": name, "size_km": 4}).json()
    assert meta["n"] == 512 and meta["size_m"] == 4000.0
    assert len(client.get("/api/terrain.bin", params={"site": name, "size_km": 4}).content) == 512 * 512 * 4
    # a higher mast sees more Sun
    high = client.get("/api/summary", params={"site": "site04", "height_m": 10}).json()
    assert high["height_m"] == 10 and high["sun"]["lit_percent"] >= stored["sun"]["lit_percent"]
    # outside the elevation models the answer is still honest
    far = client.get("/api/timeline", params={"site": "custom:10,10", "end": "2026-11-15T00:00:00Z"}).json()
    assert far["site"]["terrain"] is False
