"""Visible fraction of a disc, visibility intervals and the summary numbers."""

from __future__ import annotations

import numpy as np
import pytest

from backend import ephem, horizon, metrics


def flat(value: float) -> np.ndarray:
    return np.full(720, value)


def test_disc_fraction_limits_and_half():
    r = 0.266
    az = [100.0] * 5
    el = [-1.0, -r - 1e-6, 0.0, r + 1e-6, 5.0]
    assert metrics.disc_fraction(az, el, r, flat(0.0)) == pytest.approx([0.0, 0.0, 0.5, 1.0, 1.0], abs=1e-9)


def test_disc_fraction_matches_the_closed_form_for_a_flat_horizon():
    r = 0.266
    el = np.linspace(-0.3, 0.3, 61)
    got = metrics.disc_fraction(np.full(61, 10.0), el, r, flat(0.02))
    expected = metrics.disc_fraction_flat(el, r, 0.02)
    assert np.abs(got - expected).max() < 0.004
    # closed form spot checks: quarter of the radius above the horizon
    assert metrics.disc_fraction_flat(r * 0.5, r, 0.0) == pytest.approx(0.8045, abs=1e-4)


def test_ridge_covering_one_side_of_the_disc():
    """Terrain that is high west of azimuth 100 and low east of it hides half of a disc centred there."""
    mask = np.where(np.arange(720) * 0.5 < 100.0, 5.0, -5.0)
    mask[200] = 0.0  # the sample at azimuth 100 itself: linear ramp, symmetric about the disc centre
    frac = metrics.disc_fraction([100.0], [0.0], 0.266, mask)
    assert frac[0] == pytest.approx(0.5, abs=0.01)
    assert metrics.disc_fraction([103.0], [0.0], 0.266, mask)[0] == 1.0
    assert metrics.disc_fraction([97.0], [0.0], 0.266, mask)[0] == 0.0


def test_sky_state_on_a_smooth_sphere_matches_ephem():
    obs = metrics.Observer(lat=-89.5, lon=0.0, ground_m=0.0, height_m=2.0)
    ets = ephem.to_et(["2026-11-14T12:00:00Z"])
    state = metrics.sky_state(obs, ets)
    assert state["sun"]["az"][0] == pytest.approx(120.5344, abs=1e-3)
    assert state["sun"]["el"][0] == pytest.approx(1.3026, abs=1e-3)
    assert state["sun"]["horizon_el"][0] == pytest.approx(-0.087, abs=1e-3)
    assert state["sun"]["visible_fraction"][0] == 1.0
    assert state["earth"]["el"][0] == pytest.approx(-3.6218, abs=1e-3)
    assert state["earth"]["visible_fraction"][0] == 0.0
    assert state["sun"]["angular_radius"][0] == pytest.approx(0.2693, abs=2e-3)


@pytest.fixture(scope="module")
def month():
    """Two lunar days at a mid-latitude point on a smooth sphere: clean sunrises and sunsets."""
    obs = metrics.Observer(lat=-45.0, lon=10.0, ground_m=0.0, height_m=2.0, site_id="t", name="Test")
    times = ephem.time_grid("2026-11-14T00:00:00Z", "2027-01-13T00:00:00Z", 60)
    ets = ephem.to_et(times)
    return obs, times, ets, metrics.sky_state(obs, ets)


def test_event_times_are_refined_to_the_limb_crossing(month):
    obs, _, ets, state = month
    visible = state["sun"]["visible_fraction"] > 0
    parts = metrics.intervals(obs, "sun", ets, visible)
    assert len(parts) >= 3
    assert parts[0][0] == ets[0] and parts[-1][1] == ets[-1]
    for (_, end, vis), (start, _, vis_next) in zip(parts[:-1], parts[1:], strict=True):
        assert end == start and vis != vis_next
        # at the event the upper limb is on the horizon: within 30 s of motion (0.5 deg per hour)
        s = metrics.sky_state(obs, np.array([end]))["sun"]
        assert abs(s["el"][0] + s["angular_radius"][0] - s["horizon_el"][0]) < 0.01


def test_summary_numbers(month):
    obs, times, ets, state = month
    summary = metrics.summarize(obs, ets, state)
    sun, earth = summary["sun"], summary["earth"]
    assert summary["period"] == {"start": "2026-11-14T00:00:00Z", "end": "2027-01-13T00:00:00Z"}
    assert summary["site"] == {"id": "t", "name": "Test"}
    # contract keys (docs/API.md)
    assert {
        "lit_percent",
        "longest_dark_h",
        "longest_lit_h",
        "max_el",
        "next_sunset",
        "hours_to_sunset",
    } <= set(sun)
    assert {"visible_percent", "next_earthset", "hours_to_earthset", "windows"} <= set(earth)
    # a lunar day is 29.53 d: the Sun is up for about half of it
    assert 48.0 < sun["lit_percent"] < 53.0
    assert 340.0 < sun["longest_dark_h"] < 365.0
    # lit time by intervals agrees with the share of samples
    lit_h = sum(
        (ephem.parse_utc(w["end"]) - ephem.parse_utc(w["start"])).total_seconds() / 3600
        for w in sun["windows"]
    )
    assert lit_h / 1440.0 * 100.0 == pytest.approx(sun["lit_percent"], abs=0.3)
    # the first sunset after the start is the end of the first lit window
    first_lit = sun["windows"][0]
    assert sun["next_sunset"] == first_lit["end"]
    hours = (ephem.parse_utc(first_lit["end"]) - times[0]).total_seconds() / 3600
    assert sun["hours_to_sunset"] == pytest.approx(hours, abs=0.06)
    # from the near side the Earth never sets
    assert earth["visible_percent"] == 100.0 and earth["next_earthset"] is None
    assert earth["windows"] == [{"start": "2026-11-14T00:00:00Z", "end": "2027-01-13T00:00:00Z"}]
    assert sun["max_el"] == pytest.approx(float(state["sun"]["el"].max()), abs=1e-3)


def test_timeline_and_sky_shapes(month):
    obs, times, ets, state = month
    tl = metrics.timeline(obs, times, state, "test")
    n = len(times)
    assert tl["times"][0] == "2026-11-14T00:00:00Z" and len(tl["times"]) == n == 1441
    assert set(tl["sun"]) == {"az", "el", "horizon_el", "visible_fraction"}
    assert {"az", "el", "horizon_el", "visible", "distance_km"} <= set(tl["earth"])
    assert all(len(v) == n for body in ("sun", "earth") for v in tl[body].values())
    assert tl["site"]["terrain"] is False and tl["height_m"] == 2.0
    assert all(isinstance(v, bool) for v in tl["earth"]["visible"])
    # "hidden" is exactly 0 and a visible sliver never rounds to 0
    raw = state["sun"]["visible_fraction"]
    assert [v > 0 for v in tl["sun"]["visible_fraction"]] == list(raw > 0)
    sky = metrics.sky(obs, times[12], {k: {f: v[12:13] for f, v in b.items()} for k, b in state.items()})
    assert np.allclose(
        sky["sun"]["dir"], ephem.scene_direction(state["sun"]["az"][12], state["sun"]["el"][12]), atol=1e-4
    )
    assert {"dir", "az", "el", "angular_radius_deg", "horizon_el", "visible_fraction"} <= set(sky["sun"])
    assert {"visible", "distance_km"} <= set(sky["earth"])


def test_fraction_rounding_keeps_slivers():
    assert metrics._fractions([0.0, 0.0002, 0.4996, 1.0]) == [0.0, 0.001, 0.5, 1.0]


def test_horizon_height_changes_visibility():
    """Raising the horizon by 2 degrees hides a Sun that sits 1.3 degrees up."""
    ets = ephem.to_et(["2026-11-14T12:00:00Z"])
    low = metrics.Observer(lat=-89.5, lon=0.0, mask=horizon.flat_mask(2.0))
    high = metrics.Observer(lat=-89.5, lon=0.0, mask=flat(2.0))
    assert metrics.sky_state(low, ets)["sun"]["visible_fraction"][0] == 1.0
    assert metrics.sky_state(high, ets)["sun"]["visible_fraction"][0] == 0.0
