"""Tests 2 and 3 of docs/VALIDATION.md: the tables of data/validation/ and what they say."""

from __future__ import annotations

import json

import numpy as np
import pytest

from backend import config, sites, terrain, validate

DIR = config.DATA_DIR / "validation"
HAS_60M = (config.RAW_DIR / f"{validate.LDEM_60M}.img").exists()
needs_60m = pytest.mark.skipif(
    not HAS_60M, reason="the 60 m LOLA model is not downloaded (python -m backend.fetch_data validation)"
)


@pytest.fixture(scope="module")
def summary() -> dict:
    return json.loads((DIR / "summary.json").read_text("utf-8"))


@pytest.fixture(scope="module")
def pixels() -> list[dict]:
    return validate.read_csv(DIR / "test2_pixels.csv")


def test_summary_follows_from_the_tables(summary):
    assert json.loads(json.dumps(validate.build_summary())) == summary


def test_sample_is_the_planned_one(pixels):
    assert len(pixels) == validate.PER_STRATUM * len(validate.STRATA) == 480
    assert len({(p["row"], p["col"]) for p in pixels}) == 480
    for low, high in validate.STRATA:
        if high == 0.0:
            n = sum(p["nasa"] == 0.0 for p in pixels)
        else:
            n = sum(low * 100 < p["nasa"] <= high * 100 for p in pixels)
        assert n == validate.PER_STRATUM
    lat = np.array([float(terrain.xy_to_latlon(p["x_m"], p["y_m"])[0]) for p in pixels])
    assert lat.max() <= validate.LAT_LIMIT
    psr = validate.read_csv(DIR / "test3_psr.csv")
    assert len(psr) == validate.N_PSR and 60 < sum(p["interior"] for p in psr) < validate.N_PSR


def test_map_configuration_reproduces_the_nasa_sun_map(summary):
    got = summary["test2_sun"]["map_config"]
    assert got["n"] == 480 and abs(got["bias_pp"]) < 1.0 and got["mae_pp"] < 1.5 and got["correlation"] > 0.99
    assert got["median_abs_pp"] < 0.5
    assert summary["test2_sun_within_pp"]["5"] > 90.0
    # where the NASA map is locally smooth the agreement is twice better: the rest is single pixels
    smooth = summary["test2_sun_by_smoothness"]["smooth"]
    assert smooth["n"] > 350 and smooth["mae_pp"] < 0.8 and smooth["correlation"] > 0.995
    assert summary["test2_sun_by_smoothness"]["rough"]["mae_pp"] > 2.0 * smooth["mae_pp"]


def test_map_configuration_reproduces_the_nasa_earth_map(summary):
    got = summary["test2_earth"]["map_config"]
    assert abs(got["bias_pp"]) < 0.5 and got["mae_pp"] < 1.0 and got["correlation"] > 0.99
    assert summary["test2_earth_within_pp"]["5"] > 95.0


def test_permanent_shadow_stays_dark(summary):
    for name in ("map_config", "product"):
        got = summary["test3_psr"][name]
        assert got["interior_zero"] == got["interior_n"] > 60  # no exception away from the edges
        assert got["zero"] >= got["n"] - 2
    # the exceptions are edge pixels, and they are listed
    assert all(not r["interior"] for r in summary["test3_psr_not_zero"])
    assert len(summary["test3_psr_not_zero"]) == 2


def test_every_difference_between_the_map_and_the_product_is_measured(summary):
    effects = summary["test2_sun_effects"]
    assert effects["other_cycle"]["mean_abs_pp"] < 0.3  # which 18.6 years: does not matter
    assert -0.2 < effects["range_400km"]["mean_pp"] <= 0.0  # terrain beyond 150 km: almost nothing
    assert effects["range_400km"]["max_abs_pp"] < 2.0
    assert abs(effects["one_year"]["mean_pp"]) < 1.0 and effects["one_year"]["max_abs_pp"] < 5.0
    assert 1.0 < effects["eye_2m"]["mean_pp"] < 4.0  # two metres above the ground see more Sun
    assert effects["dem_20m"]["mean_pp"] < -2.0  # the ground of a finer model is darker
    # the model matters more than anything else: the map is reproduced with the model it was made from
    by_model = {k: summary["test2_sun"][k]["mae_pp"] for k in ("map_config", "dem_20m_mean", "dem_20m")}
    assert by_model["map_config"] < by_model["dem_20m_mean"] < by_model["dem_20m"]


def test_sites_against_the_map(summary):
    rows = validate.read_csv(DIR / "sites.csv")
    listed = json.loads((config.DATA_DIR / "sites.json").read_text("utf-8"))
    assert [r["id"] for r in rows] == [s["id"] for s in listed]
    for row, site in zip(rows, listed, strict=True):
        stored = json.loads((config.DATA_DIR / "summary" / f"{site['id']}.json").read_text("utf-8"))
        assert row["nasa"] == site["nasa_avg_illumination_percent"]
        assert row["published_1y_2m"] == stored["sun"]["lit_percent"]
    sites = summary["sites"]
    assert sites["published_1y_2m"]["max_abs_pp"] < 6.5 and sites["published_1y_2m"]["mae_pp"] < 3.5
    assert sites["cycle_0m_60m_dem"]["mae_pp"] < 3.0  # the configuration of the map
    assert sites["cycle_0m"]["bias_pp"] < -20.0  # the ground of the 5 m models: see VALIDATION.md


def test_accuracy_file_follows_from_the_tables(summary):
    stored = json.loads((config.DATA_DIR / "validation.json").read_text("utf-8"))
    assert json.loads(json.dumps(validate.build_accuracy())) == stored
    assert stored["horizons"]["samples"] == 1210 and stored["horizons"]["passed"]
    assert stored["horizons"]["max_angle_deg"] < stored["horizons"]["target_deg"] / 100.0
    assert stored["nasa_map"]["pixels"] == 480 and stored["psr"]["pixels"] == validate.N_PSR
    assert stored["psr"]["interior_never_lit"] == stored["psr"]["interior_pixels"]
    assert stored["psr"]["exceptions"] == summary["test3_psr_not_zero"]
    assert "{" not in " ".join(stored["limits"]) and len(stored["limits"]) >= 6


def test_accuracy_file_explains_every_site():
    stored = json.loads((config.DATA_DIR / "validation.json").read_text("utf-8"))
    rows = stored["sites"]["rows"]
    listed = json.loads((config.DATA_DIR / "sites.json").read_text("utf-8"))
    assert [r["id"] for r in rows] == [s["id"] for s in listed]
    for row, site in zip(rows, listed, strict=True):
        ours = json.loads((config.DATA_DIR / "summary" / f"{site['id']}.json").read_text("utf-8"))
        assert row["ours_year_percent"] == ours["sun"]["lit_percent"]
        assert row["nasa_percent"] == site["nasa_avg_illumination_percent"]
        assert row["difference_pp"] == round(row["ours_year_percent"] - row["nasa_percent"], 1)
        # the map configuration and the three effects lead from the map to our number
        steps = ("map_configuration_difference_pp", "height_effect_pp", "model_effect_pp", "year_effect_pp")
        assert abs(sum(row[k] for k in steps) - row["difference_pp"]) < 0.15
        assert row["height_effect_pp"] >= 0.0  # a higher eye never sees less
        assert f"{row['map_configuration_percent']:.1f} %" in row["explanation"]
    assert stored["sites"]["max_abs_difference_pp"] == max(abs(r["difference_pp"]) for r in rows)


def test_caption_of_the_browser_estimate_is_the_measured_one():
    stored = json.loads((config.DATA_DIR / "validation.json").read_text("utf-8"))["browser"]
    measured = json.loads((DIR / "browser.json").read_text("utf-8"))["pixels"]
    assert stored["lit_percent"] == measured["lit_percent"]
    for value in (
        measured["lit_percent"]["median_abs"],
        measured["lit_percent"]["p90_abs"],
        measured["lit_percent_by_band_of_full"][-1]["median_abs"],
    ):
        assert f"{value:.1f} pp" in stored["caption"]
    assert f"{measured['longest_dark_within_h']['24']:.0f} % of points" in stored["caption"]
    assert measured["lit_percent"]["max_abs"] > 20.0 and "tens of pp" in stored["caption"]


def test_terrain_orientation_in_the_accuracy_file():
    stored = json.loads((config.DATA_DIR / "validation.json").read_text("utf-8"))["terrain_orientation"]
    rows = json.loads((DIR / "orientation.json").read_text("utf-8"))["rows"]
    assert stored["rows"] == rows and stored["site_models"] == len(rows) == 10
    assert stored["rms_m"] == [min(r["rms_m"] for r in rows), max(r["rms_m"] for r in rows)]
    # every site model on its own tells the right orientation from the seven wrong ones
    assert all(r["rms_m"] < 5.0 and r["other_min_rms_m"] > 100.0 * r["rms_m"] for r in rows)


@pytest.mark.raw
def test_orientation_table_is_reproduced_from_the_rasters():
    stored = json.loads((DIR / "orientation.json").read_text("utf-8"))
    assert json.loads(json.dumps(validate.orientation_check())) == stored


def _patch(flag: np.ndarray, row: int, col: int) -> set:
    """Pixels of the flagged patch that contains (row, col), 4-connected."""
    seen, todo = {(row, col)}, [(row, col)]
    while todo:
        r, c = todo.pop()
        for step in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            p = (r + step[0], c + step[1])
            if p not in seen and flag[p]:
                seen.add(p)
                todo.append(p)
    return seen


@pytest.mark.raw
@needs_60m
def test_the_two_shadow_exceptions_are_what_the_note_says(summary):
    psr = terrain.load_geotiff(validate.PSR_MAP, validate.PSR_SCALE)
    flag = (psr.data * validate.PSR_SCALE + validate.PSR_OFFSET) > 0.5
    vis = terrain.load_geotiff(validate.SUN_MAP, sites.ILLUMINATION_SCALE)
    lit = 100.0 * vis.data.astype(float) * vis.scale
    model = validate.surface_of("60m").grids[0]

    def look(row: int, col: int):
        win = (slice(row - 4, row + 5), slice(col - 4, col + 5))
        x, y = validate.pixel_centres(
            vis, rows=np.arange(row - 2, row + 3)[:, None], cols=np.arange(col - 2, col + 3)[None, :]
        )
        heights = model.sample(x + 0.0 * y, y + 0.0 * x)
        return len(_patch(flag, row, col)), lit[win][~flag[win]], heights - heights[2, 2]

    small, rim = summary["test3_psr_not_zero"]
    assert small["map_config"] > 20.0 and rim["map_config"] == 0.0 and 0.0 < rim["product"] < 0.05

    size, around, heights = look(small["row"], small["col"])
    assert size == 4  # a patch of four pixels
    assert 25.0 < np.median(around) < 35.0  # on a plain that is about 30 % lit on the map
    assert abs(small["map_config"] - np.median(around)) < 3.0  # and we give it what its surroundings get
    assert np.abs(heights).max() <= 7.0  # no hollow in the 60 m model: within 7 m across 300 m

    size, around, heights = look(rim["row"], rim["col"])
    assert 200 < size < 300  # about 1 km2 of shadow (3600 m2 per pixel)
    assert np.abs(heights).max() > 40.0  # on a slope


@pytest.mark.raw
def test_sample_is_reproduced_from_the_nasa_maps(pixels):
    again = validate.sample_pixels()
    assert [(p["row"], p["col"]) for p in again] == [(p["row"], p["col"]) for p in pixels]
    assert np.allclose([p["nasa"] for p in again], [p["nasa"] for p in pixels], atol=1e-3)
    psr = validate.read_csv(DIR / "test3_psr.csv")
    assert [(p["row"], p["col"]) for p in validate.sample_psr()] == [(p["row"], p["col"]) for p in psr]


@pytest.mark.raw
@needs_60m
def test_table_rows_are_reproduced_from_the_rasters(pixels):
    rows = pixels[40::160]  # three pixels of different bands
    for name in ("map_config", "one_year", "product"):
        for row, value in zip(rows, validate.run_config(rows, name), strict=True):
            assert abs(value - row[name]) < 2e-3, (name, row["row"], row["col"])
    for row, value in zip(rows, validate.run_config(rows, "map_config", "EARTH"), strict=True):
        assert abs(value - row["earth_map_config"]) < 2e-3
