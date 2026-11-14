"""The files and the algorithm for computing any point in the browser (docs/BROWSER_COMPUTE.md)."""

from __future__ import annotations

import csv
import json
import math
import shutil
import subprocess

import numpy as np
import pytest

from backend import browser, config, ephem, horizon, metrics, precompute, terrain

from .conftest import synthetic_grid

DATA = config.DATA_DIR


def load(path: str):
    return json.loads((DATA / path).read_text("utf-8"))


def read_csv(path: str) -> list[dict]:
    with open(DATA / path, encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def close(a, b, tol: float) -> bool:
    """Equal JSON values, numbers within `tol`."""
    if isinstance(a, dict):
        return isinstance(b, dict) and a.keys() == b.keys() and all(close(a[k], b[k], tol) for k in a)
    if isinstance(a, list):
        return (
            isinstance(b, list)
            and len(a) == len(b)
            and all(close(x, y, tol) for x, y in zip(a, b, strict=True))
        )
    if isinstance(a, int | float) and not isinstance(a, bool):
        return isinstance(b, int | float) and abs(a - b) <= tol
    return a == b


def year_ets() -> np.ndarray:
    return ephem.to_et(ephem.time_grid(precompute.PERIOD_START, precompute.PERIOD_END, precompute.STEP_MIN))


# ---- the two files --------------------------------------------------------------------------


def test_ephemeris_file_is_reproduced_from_the_kernels():
    table, distance, meta = browser.build_ephemeris()
    assert meta == load("ephem/year.json")
    assert table.tobytes() == (DATA / "ephem" / "year.bin").read_bytes()
    assert distance.tobytes() == (DATA / "ephem" / "sun_distance.bin").read_bytes()
    assert table.shape == (8761, 6) and meta["stride"] == 6 and meta["step_h"] == 1.0
    # the Earth is 147.1 to 152.1 million km from the Sun, the Moon up to 0.41 million km nearer or farther
    assert distance.shape == (8761,) and 146.6e6 < distance.min() < distance.max() < 152.6e6
    assert np.abs(np.linalg.norm(table[:, :3].astype(float), axis=1) - 1.0).max() < 1e-6  # unit vectors
    # file names are relative to data/, where the page fetches them
    assert (DATA / meta["file"]).is_file() and (DATA / meta["sun_distance"]["file"]).is_file()


def test_ephemeris_file_keeps_the_directions_to_a_hundred_thousandth_of_a_degree():
    eph = browser.load_ephemeris()
    ets = year_ets()
    for key, body, limit_km in (("sun_km", "SUN", 20.0), ("earth_km", "EARTH", 0.05)):
        exact = ephem.body_vectors(body, ets)
        stored = eph[key]
        assert np.abs(stored - exact).max() < limit_km  # float32: 7 significant digits
        cos = (stored * exact).sum(axis=1) / np.linalg.norm(stored, axis=1) / np.linalg.norm(exact, axis=1)
        assert np.degrees(np.arccos(np.clip(cos, -1.0, 1.0))).max() < 1e-5


def test_elevation_file_has_the_grid_of_the_map_layer():
    meta, layer = load("dem240.json"), load("illumination.json")
    dem = browser.load_dem()
    assert dem["data"].shape == (layer["height"], layer["width"]) == (1772, 1772)
    assert (DATA / "dem240.bin").stat().st_size == 1772 * 1772 * 2
    assert meta["pixel_m"] == layer["pixel_m"] == 240.0
    assert meta["x_km"] == layer["x_km"] and meta["y_km"] == layer["y_km"]
    assert (meta["min_m"], meta["max_m"]) == (dem["data"].min(), dem["data"].max())
    # the pole is the common corner of the four central pixels
    assert dem["x0"] + 240.0 * (1772 / 2 - 0.5) == 0.0 and dem["y0"] - 240.0 * (1772 / 2 - 0.5) == 0.0


def test_elevation_file_gives_the_heights_of_the_sites():
    """The 240 m model against the ground of the 5 m site models: a mean of 240 m cannot be a summit."""
    dem = browser.load_dem()
    for site in load("sites.json"):
        x, y = (float(v) for v in terrain.latlon_to_xy(site["lat"], site["lon"]))
        assert abs(float(browser.dem_height(dem, x, y)) - site["elevation_m"]) < 25.0, site["id"]
    assert math.isnan(float(browser.dem_height(dem, 213_000.0, 0.0)))


@pytest.mark.raw
def test_elevation_file_is_reproduced_from_the_rasters():
    data, meta = browser.build_dem()
    assert meta == load("dem240.json")
    assert data.tobytes() == (DATA / "dem240.bin").read_bytes()


# ---- the algorithm --------------------------------------------------------------------------


def test_local_frame_is_the_one_of_the_backend():
    for lat, lon in ((-89.45, 222.7), (-85.5, 350.0), (0.67, 23.47)):
        for ours, theirs in zip(browser.local_frame(lat, lon), ephem.local_frame(lat, lon), strict=True):
            assert np.allclose(ours, theirs, atol=1e-15)


def test_mask_of_a_flat_model_is_the_dip_of_the_horizon():
    flat = {"data": np.zeros((1772, 1772)), "x0": -212520.0, "y0": 212520.0, "step": 240.0}
    got = browser.horizon_mask(flat, -89.0, 40.0, 2.0)
    assert got["ground_m"] == 0.0 and got["missing_fraction"] == 0.0
    assert np.abs(got["elevation_deg"] - horizon.smooth_sphere_dip(2.0)).max() < 1e-4
    assert abs(horizon.smooth_sphere_dip(2.0) + 0.0869) < 1e-4


def test_mask_of_a_hill_agrees_with_the_full_ray_march():
    def hill(x, y):
        return 1500.0 * np.exp(-((x - 12000.0) ** 2 + (y - 5000.0) ** 2) / (2.0 * 3000.0**2))

    grid = synthetic_grid(hill, half_m=60000.0, step=240.0)
    dem = {"data": grid.data.astype(float), "x0": grid.x0, "y0": grid.y0, "step": grid.step}
    lat, lon = -89.9, 300.0
    ours = browser.horizon_mask(dem, lat, lon, 2.0)
    full = horizon.horizon_mask(terrain.Surface([grid]), lat, lon, 2.0, max_range_m=50000.0)
    assert abs(ours["ground_m"] - full["ground_m"]) < 1e-6
    assert ours["elevation_deg"].max() > 5.0  # the hill is there
    assert np.abs(ours["elevation_deg"] - full["elevation_deg"]).max() < 0.02
    assert ours["missing_fraction"] > 0.5  # most of the 150 km lies outside this small model


def test_mask_outside_the_model_is_refused():
    with pytest.raises(ValueError):
        browser.horizon_mask(browser.load_dem(), -80.0, 10.0)


def test_sky_from_the_files_agrees_with_spice_for_the_same_mask():
    """Same mask, same point: only the float32 rounding of year.bin separates the two."""
    eph = browser.load_ephemeris()
    hor = browser.horizon_mask(browser.load_dem(), -88.8, 123.0)
    obs = metrics.Observer(-88.8, 123.0, hor["ground_m"], 2.0, hor["elevation_deg"], terrain=True)
    full = metrics.sky_state(obs, year_ets())
    for key, radius in (("sun", config.SUN_RADIUS_KM), ("earth", config.EARTH_RADIUS_KM)):
        ours = browser.body_sky(eph[f"{key}_km"], radius, obs.lat, obs.lon, obs.elevation_m, obs.mask)
        d_az = np.abs((ours["az"] - full[key]["az"] + 180.0) % 360.0 - 180.0)
        assert d_az.max() < 2e-5 and np.abs(ours["el"] - full[key]["el"]).max() < 2e-5
        assert np.abs(ours["angular_radius"] - full[key]["angular_radius"]).max() < 1e-6
        assert np.abs(ours["visible_fraction"] - full[key]["visible_fraction"]).max() < 1e-3
        assert ((ours["visible_fraction"] > 0) == (full[key]["visible_fraction"] > 0)).mean() > 0.9995


def test_longest_run_counts_samples_and_never_exceeds_the_period():
    flags = np.array([1, 0, 0, 0, 1, 0, 0, 1, 1], dtype=bool)
    assert browser.longest_run_h(~flags, 1.0) == 3.0 and browser.longest_run_h(flags, 0.5) == 1.0
    assert browser.longest_run_h(np.ones(8761, dtype=bool), 1.0) == 8760.0
    assert browser.longest_run_h(np.zeros(5, dtype=bool), 1.0) == 0.0


def test_year_numbers_follow_from_the_hourly_samples():
    got = browser.compute(-89.45, 222.7)
    lit = got["sun"]["visible_fraction"] > 0
    assert got["year"]["lit_percent"] == round(100.0 * lit.mean(), 2)
    assert got["year"]["longest_dark_h"] + got["year"]["longest_lit_h"] <= 8760.0
    mean_w = got["sun"]["irradiance_w_m2"].mean()
    assert got["year"]["energy_kwh_m2"] == round(mean_w * 8760.0 / 1000.0, 1)
    assert 1300.0 < got["sun"]["irradiance_w_m2"].max() < 1420.0
    assert (got["sun"]["irradiance_w_m2"][~lit] == 0.0).all()


# ---- test vectors and the JavaScript port ---------------------------------------------------


def test_test_vectors_are_reproduced_from_the_two_files():
    stored = load("ephem/test_vectors.json")
    assert close(json.loads(json.dumps(browser.test_vectors())), stored, 2e-4)
    points = stored["points"]
    assert [p["id"] for p in points[:10]] == [s["id"] for s in load("sites.json")]
    assert len(points) == 13 and all(len(p["moments"]) == 24 and len(p["mask_deg"]) == 720 for p in points)
    indices = [m["index"] for m in points[0]["moments"]]
    assert indices == sorted(set(indices)) and 0 < indices[0] and indices[-1] < 8760
    assert indices[-1] - indices[0] > 8000  # the moments cover the year


def test_test_vectors_show_both_day_and_night():
    """The reference is useless for a port if it only has trivial cases."""
    moments = [m for p in load("ephem/test_vectors.json")["points"] for m in p["moments"]]
    for body in ("sun", "earth"):
        fractions = np.array([m[body]["visible_fraction"] for m in moments])
        assert (fractions == 0.0).sum() > 20 and (fractions == 1.0).sum() > 20
    partial = [m for m in moments if 0.0 < m["sun"]["visible_fraction"] < 1.0]
    assert len(partial) >= 5  # the disc partly behind the terrain


def test_javascript_port_reproduces_the_test_vectors():
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node.js is not installed")
    run = subprocess.run(
        [node, str(DATA / "ephem" / "check.mjs")], capture_output=True, text=True, timeout=300, check=False
    )
    assert run.returncode == 0, run.stdout + run.stderr
    report = json.loads(run.stdout)
    assert report["points"] == 13 and report["failed"] == []
    assert report["worst"]["angle_deg"] < 1e-3 and report["worst"]["hours"] == 0


# ---- what the coarse model costs (docs/VALIDATION.md, Test 4) -------------------------------


def test_comparison_summary_follows_from_its_tables():
    summary = load("validation/browser.json")
    assert json.loads(json.dumps(browser.compare_summary())) == summary
    for name, path in (
        ("sites", "validation/browser_sites.csv"),
        ("pixels", "validation/browser_pixels.csv"),
    ):
        rows = [
            {k: float(v) for k, v in r.items() if k.endswith(("_full", "_browser")) or "first" in k}
            for r in read_csv(path)
        ]
        assert summary[name]["n"] == len(rows)
        for key, stats in browser._pair_stats(rows).items():
            assert summary[name][key] == stats, (name, key)
    assert len(read_csv("validation/browser_sites.csv")) == 10
    assert len(read_csv("validation/browser_pixels.csv")) == len(read_csv("validation/test2_pixels.csv"))
    assert summary["algorithm"]["first_sample_m"] == browser.RAY_FIRST_M


def test_comparison_rows_are_reproduced_from_the_two_files():
    rows = read_csv("validation/browser_pixels.csv")
    for row in rows[:: len(rows) // 6]:
        year = browser.compute(float(row["lat"]), float(row["lon"]))["year"]
        assert abs(year["lit_percent"] - float(row["lit_browser"])) < 0.02
        assert year["longest_dark_h"] == float(row["dark_h_browser"])
        assert abs(year["earth_visible_percent"] - float(row["earth_browser"])) < 0.02
    for row in read_csv("validation/browser_sites.csv"):
        year = browser.compute(float(row["lat"]), float(row["lon"]))["year"]
        assert abs(year["lit_percent"] - float(row["lit_browser"])) < 0.02


@pytest.mark.raw
def test_comparison_full_values_are_reproduced_from_the_rasters():
    rows = read_csv("validation/browser_pixels.csv")
    surface, ets = terrain.default_surface(), year_ets()
    for row in rows[:: len(rows) // 4]:
        lat, lon = float(row["lat"]), float(row["lon"])
        hor = horizon.horizon_mask(surface, lat, lon, 2.0)
        obs = metrics.Observer(lat, lon, hor["ground_m"], 2.0, hor["elevation_deg"], terrain=True)
        full = metrics.summarize(obs, ets, metrics.sky_state(obs, ets))
        assert abs(full["sun"]["lit_percent"] - float(row["lit_full"])) < 0.02
        assert abs(full["sun"]["longest_dark_h"] - float(row["dark_h_full"])) < 0.2


def test_what_the_coarse_model_costs():
    """The facts quoted in docs/VALIDATION.md and data/validation.json."""
    summary = load("validation/browser.json")
    lit = summary["pixels"]["lit_percent"]
    assert lit["median_abs"] < 1.0 and lit["mae"] < 3.0 and abs(lit["bias"]) < 2.0
    assert summary["pixels"]["lit_percent_within_pp"]["5"] > 85.0
    assert summary["pixels"]["full_vs_column_product_max_abs"] < 0.1
    # the listed sites are summits of 5 m models: there the coarse model is at its worst
    assert summary["sites"]["lit_percent"]["max_abs"] > 20.0
    study = {s["first_sample_m"]: s["mae"] for s in summary["first_sample_study"]}
    assert study[browser.RAY_FIRST_M] == min(study.values())
