"""Visibility of the Sun and the Earth over a terrain horizon, and the numbers derived from it.

Definitions (docs/API.md, docs/VALIDATION.md):

* a body is *visible* when any part of its disc is above the terrain horizon - the rule
  of the NASA LOLA illumination maps;
* `visible_fraction` is the share of the area of the disc above the horizon. The disc is
  cut into vertical strips and every strip is compared with the horizon mask at its own
  azimuth, so a ridge that covers only one side of the Sun is handled;
* percentages are shares of the time samples; durations and event times are refined
  by bisection to better than one minute.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from . import config, ephem, horizon

N_STRIPS = 24
BODIES = (("sun", "SUN", config.SUN_RADIUS_KM), ("earth", "EARTH", config.EARTH_RADIUS_KM))
EVENT_TOLERANCE_S = 30.0


@dataclass
class Observer:
    """A point on the Moon with its horizon mask."""

    lat: float
    lon: float
    ground_m: float = 0.0  # ground above the 1737.4 km sphere
    height_m: float = 2.0  # instrument above the ground
    mask: np.ndarray = field(default_factory=lambda: horizon.flat_mask(2.0))
    terrain: bool = False
    site_id: str = "custom"
    name: str = "Custom point"

    @property
    def elevation_m(self) -> float:
        return self.ground_m + self.height_m


def disc_fraction_flat(el_deg, radius_deg, horizon_deg) -> np.ndarray:
    """Visible share of a disc cut by a straight horizontal horizon (closed form)."""
    s = np.clip((np.asarray(el_deg) - np.asarray(horizon_deg)) / np.asarray(radius_deg), -1.0, 1.0)
    return 1.0 - (np.arccos(s) - s * np.sqrt(1.0 - s * s)) / np.pi


def disc_fraction(az_deg, el_deg, radius_deg, mask_deg: np.ndarray, n_strips: int = N_STRIPS) -> np.ndarray:
    """Visible share of the disc of a body above the horizon mask (0..1), per time sample."""
    az = np.atleast_1d(np.asarray(az_deg, dtype=float))[:, None]
    el = np.atleast_1d(np.asarray(el_deg, dtype=float))[:, None]
    rad = np.atleast_1d(np.asarray(radius_deg, dtype=float))[:, None]
    offs = (np.arange(n_strips) + 0.5) / n_strips * 2.0 - 1.0  # strip centres in units of the radius
    half = rad * np.sqrt(1.0 - offs**2)  # half-height of each strip
    cos_el = np.maximum(np.cos(np.radians(el)), 1e-6)
    hor = horizon.interpolate(mask_deg, az + offs * rad / cos_el)
    seen = np.clip(el + half - hor, 0.0, 2.0 * half)
    return seen.sum(axis=1) / (2.0 * half).sum(axis=1)


def sky_state(obs: Observer, ets: np.ndarray) -> dict:
    """Azimuth, elevation, horizon and visible fraction of the Sun and the Earth at `ets`."""
    out = {}
    for key, body, radius_km in BODIES:
        az, el, dist = ephem.azel_from_vectors(
            ephem.body_vectors(body, ets), obs.lat, obs.lon, obs.elevation_m
        )
        radius = np.degrees(np.arcsin(radius_km / dist))
        out[key] = {
            "az": az,
            "el": el,
            "distance_km": dist,
            "angular_radius": radius,
            "horizon_el": horizon.interpolate(obs.mask, az),
            "visible_fraction": disc_fraction(az, el, radius, obs.mask),
        }
    return out


def _visible_at(obs: Observer, key: str, et: float) -> bool:
    body, radius_km = next((b, r) for k, b, r in BODIES if k == key)
    az, el, dist = ephem.azel_from_vectors(
        ephem.body_vectors(body, np.array([et])), obs.lat, obs.lon, obs.elevation_m
    )
    radius = np.degrees(np.arcsin(radius_km / dist))
    return bool(disc_fraction(az, el, radius, obs.mask)[0] > 0.0)


def intervals(
    obs: Observer, key: str, ets: np.ndarray, visible: np.ndarray
) -> list[tuple[float, float, bool]]:
    """Split [ets[0], ets[-1]] into (start_et, end_et, is_visible) with refined boundaries."""
    out = []
    start = float(ets[0])
    state = bool(visible[0])
    for i in np.flatnonzero(visible[1:] != visible[:-1]):
        lo, hi = float(ets[i]), float(ets[i + 1])
        while hi - lo > EVENT_TOLERANCE_S:
            mid = 0.5 * (lo + hi)
            if _visible_at(obs, key, mid) == state:
                lo = mid
            else:
                hi = mid
        event = 0.5 * (lo + hi)
        out.append((start, event, state))
        start, state = event, not state
    out.append((start, float(ets[-1]), state))
    return out


def _hours(seconds: float) -> float:
    return round(seconds / 3600.0, 1)


def _iso(et: float) -> str:
    return ephem.iso_z(ephem.et_to_datetime(et))


def summarize(obs: Observer, ets: np.ndarray, state: dict) -> dict:
    """The `summary` object of docs/API.md for the period covered by `ets`."""
    out = {
        "site": {"id": obs.site_id, "name": obs.name},
        "period": {"start": _iso(ets[0]), "end": _iso(ets[-1])},
        "height_m": obs.height_m,
    }
    for key in ("sun", "earth"):
        visible = state[key]["visible_fraction"] > 0.0
        parts = intervals(obs, key, ets, visible)
        lit = [end - start for start, end, vis in parts if vis]
        dark = [end - start for start, end, vis in parts if not vis]
        next_set = next((end for start, end, vis in parts[:-1] if vis), None)
        common = {
            "percent": round(100.0 * float(visible.mean()), 1),
            "longest_visible_h": _hours(max(lit, default=0.0)),
            "longest_hidden_h": _hours(max(dark, default=0.0)),
            "next_set": None if next_set is None else _iso(next_set),
            "hours_to_set": None if next_set is None else _hours(next_set - ets[0]),
            "windows": [{"start": _iso(a), "end": _iso(b)} for a, b, vis in parts if vis],
        }
        if key == "sun":
            out["sun"] = {
                "lit_percent": common["percent"],
                "longest_dark_h": common["longest_hidden_h"],
                "longest_lit_h": common["longest_visible_h"],
                "max_el": round(float(state["sun"]["el"].max()), 3),
                "mean_visible_fraction": round(float(state["sun"]["visible_fraction"].mean()), 3),
                "next_sunset": common["next_set"],
                "hours_to_sunset": common["hours_to_set"],
                "windows": common["windows"],
            }
        else:
            out["earth"] = {
                "visible_percent": common["percent"],
                "longest_visible_h": common["longest_visible_h"],
                "longest_hidden_h": common["longest_hidden_h"],
                "next_earthset": common["next_set"],
                "hours_to_earthset": common["hours_to_set"],
                "windows": common["windows"],
            }
    return out


def _rounded(values, digits: int) -> list:
    return [round(float(v), digits) for v in values]


def _fractions(values) -> list:
    """Three decimals, but a visible sliver never rounds down to 0 (0 must mean hidden)."""
    return [0.0 if v <= 0.0 else max(round(float(v), 3), 0.001) for v in values]


def timeline(obs: Observer, times: list, state: dict, source: str) -> dict:
    """The `timeline` object of docs/API.md."""
    sun, earth = state["sun"], state["earth"]
    return {
        "site": {
            "id": obs.site_id,
            "lat": obs.lat,
            "lon": obs.lon,
            "elevation_m": round(obs.ground_m, 1),
            "terrain": obs.terrain,
        },
        "height_m": obs.height_m,
        "times": [ephem.iso_z(t) for t in times],
        "sun": {
            "az": _rounded(sun["az"], 3),
            "el": _rounded(sun["el"], 3),
            "horizon_el": _rounded(sun["horizon_el"], 3),
            "visible_fraction": _fractions(sun["visible_fraction"]),
        },
        "earth": {
            "az": _rounded(earth["az"], 3),
            "el": _rounded(earth["el"], 3),
            "horizon_el": _rounded(earth["horizon_el"], 3),
            "visible": [bool(v > 0.0) for v in earth["visible_fraction"]],
            "visible_fraction": _fractions(earth["visible_fraction"]),
            "distance_km": [int(round(float(v))) for v in earth["distance_km"]],
        },
        "source": source,
    }


def sky(obs: Observer, time, state: dict, index: int = 0) -> dict:
    """The `sky` object of docs/API.md: unit directions in the three.js scene axes."""
    out = {"time": ephem.iso_z(ephem.parse_utc(time))}
    for key in ("sun", "earth"):
        body = state[key]
        direction = ephem.scene_direction(body["az"][index], body["el"][index])
        out[key] = {
            "dir": _rounded(direction, 4),
            "az": round(float(body["az"][index]), 3),
            "el": round(float(body["el"][index]), 3),
            "angular_radius_deg": round(float(body["angular_radius"][index]), 3),
            "horizon_el": round(float(body["horizon_el"][index]), 3),
            "visible_fraction": _fractions(body["visible_fraction"][index : index + 1])[0],
        }
    out["earth"]["visible"] = bool(state["earth"]["visible_fraction"][index] > 0.0)
    out["earth"]["distance_km"] = int(round(float(state["earth"]["distance_km"][index])))
    return out
