"""Horizon mask: geometry on synthetic terrain with known answers."""

from __future__ import annotations

import math

import numpy as np
import pytest

from backend import config, ephem, horizon, terrain
from backend.tests.conftest import synthetic_grid

R = config.MOON_RADIUS_M
FLAT = terrain.Surface([synthetic_grid(lambda x, y: 0 * x, half_m=200000.0, step=400.0)])


def test_smooth_sphere_gives_the_dip_of_the_horizon():
    for h in (2.0, 10.0, 1000.0):
        result = horizon.horizon_mask(FLAT, -89.2, 77.0, height_m=h)
        expected = -math.degrees(math.sqrt(2 * h / R))  # small-angle formula
        assert result["elevation_deg"] == pytest.approx(expected, rel=2e-3)
        assert result["elevation_deg"] == pytest.approx(horizon.smooth_sphere_dip(h), abs=2e-4)
        assert result["missing_fraction"] == 0.0
    assert horizon.smooth_sphere_dip(2.0) == pytest.approx(-0.0869, abs=1e-4)
    assert horizon.flat_mask(2.0) == pytest.approx(horizon.smooth_sphere_dip(2.0))


def gaussian_hill(cx, cy, height, sigma):
    return lambda x, y: height * np.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * sigma**2))


def independent_elevation(func, lat, lon, ground, height, az_deg, max_range=150000.0):
    """Skyline in one azimuth by plain vector algebra on the analytic surface (no rasters)."""
    east, north, up = ephem.local_frame(lat, lon)
    obs = (R + ground + height) * up
    d = math.sin(math.radians(az_deg)) * east + math.cos(math.radians(az_deg)) * north
    s = np.arange(5.0, max_range, 2.0)
    u = np.cos(s / R)[:, None] * up + np.sin(s / R)[:, None] * d
    x, y = terrain.unit_to_xy(u)
    point = (R + func(x, y))[:, None] * u - obs
    el = np.degrees(np.arcsin(point @ up / np.linalg.norm(point, axis=1)))
    return float(el.max())


def test_hill_matches_independent_vector_computation():
    lat, lon = -89.0, 0.0
    x0, y0 = terrain.latlon_to_xy(lat, lon)
    # at longitude 0 local east is +x of the map and local north is +y
    func = gaussian_hill(x0 + 20000.0, y0 + 5000.0, 3000.0, 3000.0)
    surface = terrain.Surface([synthetic_grid(func, half_m=200000.0, step=100.0)])
    ground = float(surface.elevation(lat, lon)[0])
    result = horizon.horizon_mask(surface, lat, lon, height_m=2.0)
    mask = result["elevation_deg"]
    for az in (0.0, 45.0, 70.0, 76.0, 80.0, 90.0, 180.0, 270.0):
        expected = independent_elevation(func, lat, lon, ground, 2.0, az)
        assert mask[int(az / horizon.STEP_DEG)] == pytest.approx(expected, abs=0.01), az
    # the hill is in the east-north-east; nothing in the west
    peak_az = np.argmax(mask) * horizon.STEP_DEG
    assert peak_az == pytest.approx(math.degrees(math.atan2(20000.0, 5000.0)), abs=1.0)
    assert mask[int(270 / horizon.STEP_DEG)] == pytest.approx(horizon.smooth_sphere_dip(2.0), abs=0.01)
    assert 7.0 < mask.max() < 8.5  # about atan(3000 / 20600) minus curvature


def test_azimuth_convention_does_not_depend_on_longitude():
    """A hill placed geographically north-east of the site is seen at azimuth 45 at any longitude."""
    for lat, lon in [(-88.0, 0.0), (-88.0, 135.0), (-86.5, 291.0)]:
        east, north, up = ephem.local_frame(lat, lon)
        target = up + (15000.0 / R) * (east + north) / math.sqrt(2)
        cx, cy = terrain.unit_to_xy(target / np.linalg.norm(target))
        surface = terrain.Surface(
            [synthetic_grid(gaussian_hill(cx, cy, 2000.0, 1500.0), half_m=250000.0, step=150.0)]
        )
        mask = horizon.horizon_mask(surface, lat, lon, height_m=2.0, max_range_m=40000.0)["elevation_deg"]
        assert np.argmax(mask) * horizon.STEP_DEG == pytest.approx(45.0, abs=0.5)


def test_higher_instrument_sees_a_lower_horizon():
    func = gaussian_hill(3000.0, 30000.0, 500.0, 800.0)
    surface = terrain.Surface([synthetic_grid(func, half_m=100000.0, step=50.0)])
    low = horizon.horizon_mask(surface, -89.0, 0.0, height_m=2.0, max_range_m=30000.0)["elevation_deg"]
    high = horizon.horizon_mask(surface, -89.0, 0.0, height_m=10.0, max_range_m=30000.0)["elevation_deg"]
    assert (high <= low + 1e-9).all() and (low - high).max() > 0.05


def test_missing_data_is_reported_not_hidden():
    small = terrain.Surface([synthetic_grid(lambda x, y: 0 * x, half_m=40000.0, step=200.0)])
    result = horizon.horizon_mask(small, -89.5, 0.0)
    assert 0.0 < result["missing_fraction"] < 1.0
    with pytest.raises(ValueError):
        horizon.horizon_mask(small, -80.0, 0.0)


def test_interpolate_is_periodic():
    mask = np.arange(720, dtype=float)
    assert horizon.interpolate(mask, [0.0, 0.25, 359.5, 359.75, 360.0, -0.5]) == pytest.approx(
        [0.0, 0.5, 719.0, 359.5, 0.0, 719.0]
    )


@pytest.mark.raw
def test_published_masks_are_reproduced_from_the_rasters():
    """`data/horizon/*.json` is exactly what the code computes from the NASA rasters."""
    import json

    from backend import precompute, sites

    for site in sites.load_sites():
        stored = json.loads((config.DATA_DIR / "horizon" / f"{site['id']}.json").read_text("utf-8"))
        result = horizon.horizon_mask(
            precompute.site_surface(site), site["lat"], site["lon"], stored["height_m"], site["elevation_m"]
        )
        assert result["missing_fraction"] == 0.0
        assert len(stored["elevation_deg"]) == 720 and stored["step_deg"] == 0.5
        assert np.abs(np.array(stored["elevation_deg"]) - result["elevation_deg"]).max() < 6e-4
