"""Test 1: Sun and Earth positions against JPL Horizons (fixture, runs offline)."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from backend import config, ephem

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "horizons.json").read_text("utf-8"))
TOLERANCE_DEG = 0.01  # agreed target; the measured maximum is about 100 times smaller


def angle_diff(a, b):
    return (np.asarray(a) - np.asarray(b) + 180.0) % 360.0 - 180.0


def deviations(point: dict, body: str) -> dict[str, float]:
    rows = point[body]
    ours = ephem.sun_earth(point["lat"], point["lon"], point["alt_km"] * 1000.0, [r["utc"] for r in rows])[
        body
    ]
    el_ref = np.array([r["el"] for r in rows])
    d_el = ours["el"] - el_ref
    # Azimuth difference projected on the sky (a raw azimuth difference blows up at zenith).
    d_az = angle_diff(ours["az"], [r["az"] for r in rows]) * np.cos(np.radians(el_ref))
    d_range = ours["distance_km"] - np.array([r["range_km"] for r in rows])
    return {
        "az": float(np.abs(d_az).max()),
        "el": float(np.abs(d_el).max()),
        "range_km": float(np.abs(d_range).max()),
    }


@pytest.mark.parametrize("point", FIXTURE["points"], ids=lambda p: p["label"])
@pytest.mark.parametrize("body", ["sun", "earth"])
def test_matches_horizons(point, body):
    dev = deviations(point, body)
    assert dev["az"] < TOLERANCE_DEG
    assert dev["el"] < TOLERANCE_DEG
    # Range: Horizons prints 14 significant digits of au; allow 1e-7 relative plus 1 km.
    assert dev["range_km"] < 1.0 + 1e-7 * point[body][0]["range_km"]


def test_reference_epoch_from_the_brief():
    """The numbers written down before the hackathon (Horizons query of 12 Nov 2026)."""
    out = ephem.sun_earth(-89.5, 0.0, 0.0, ["2026-11-14T12:00:00Z"])
    assert out["sun"]["az"][0] == pytest.approx(120.534441, abs=1e-4)
    assert out["sun"]["el"][0] == pytest.approx(1.302620, abs=1e-4)
    assert out["earth"]["az"][0] == pytest.approx(358.078065, abs=1e-4)
    assert out["earth"]["el"][0] == pytest.approx(-3.621837, abs=1e-4)
    assert out["earth"]["distance_km"][0] == pytest.approx(0.0027098 * config.AU_KM, rel=2e-5)


def test_earth_parallax_matters():
    """Dropping the site vector moves the Earth by about a quarter of a degree."""
    ets = ephem.to_et(["2026-11-14T12:00:00Z"])
    vec = ephem.body_vectors("EARTH", ets)
    _, el_topo, _ = ephem.azel_from_vectors(vec, -89.5, 0.0, 0.0)
    east, north, up = ephem.local_frame(-89.5, 0.0)
    el_geo = np.degrees(np.arcsin(vec[0] @ up / np.linalg.norm(vec[0])))
    assert 0.2 < abs(el_geo - el_topo[0]) < 0.3


def test_local_frame_is_orthonormal_and_right_handed():
    for lat, lon in [(-89.99, 10.0), (-85.0, 222.0), (0.0, 0.0), (45.0, -120.0)]:
        east, north, up = ephem.local_frame(lat, lon)
        assert np.allclose(np.cross(east, north), up, atol=1e-12)
        assert abs(east @ north) < 1e-12 and abs(east @ up) < 1e-12
        # north points towards increasing latitude
        step = ephem.site_vector(lat + 1e-4, lon, 1.0) - ephem.site_vector(lat, lon, 1.0)
        assert step @ north > 0


def test_subsolar_point_has_sun_at_zenith():
    ets = ephem.to_et(["2027-03-01T00:00:00Z"])
    v = ephem.body_vectors("SUN", ets)[0]
    lat = np.degrees(np.arcsin(v[2] / np.linalg.norm(v)))
    lon = np.degrees(np.arctan2(v[1], v[0]))
    _, el, _ = ephem.azel_from_vectors(v, lat, lon, 0.0)
    assert el[0] > 89.999


def test_scene_direction_axes():
    # north on the horizon -> -z, east -> +x, zenith -> +y
    assert np.allclose(ephem.scene_direction(0.0, 0.0), [0, 0, -1], atol=1e-12)
    assert np.allclose(ephem.scene_direction(90.0, 0.0), [1, 0, 0], atol=1e-12)
    assert np.allclose(ephem.scene_direction(0.0, 90.0), [0, 1, 0], atol=1e-12)
    # the documented example of docs/API.md (sky.json mock)
    d = ephem.scene_direction(120.534441, 1.302620)
    assert np.allclose(d, [0.8611, 0.0227, 0.5079], atol=1e-4)


def test_time_grid_inclusive():
    grid = ephem.time_grid("2026-11-14T00:00:00Z", "2026-11-14T12:00:00Z", 720)
    assert [ephem.iso_z(t) for t in grid] == ["2026-11-14T00:00:00Z", "2026-11-14T12:00:00Z"]
