"""Download reference azimuth/elevation/range from JPL Horizons and store them as a fixture.

Run once (network needed):  python -m backend.tests.make_horizons_fixture
The fixture `fixtures/horizons.json` is committed, so the tests themselves run offline.

Horizons settings: observer `coord@301` (a point on the Moon given as east longitude,
latitude, altitude in km above the 1737.4 km sphere), airless apparent azimuth and
elevation (quantity 4) and observer range (quantity 20), angles in degrees.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import requests

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
FIXTURE = Path(__file__).parent / "fixtures" / "horizons.json"
AU_KM = 149597870.7

# (label, latitude, east longitude, altitude above the sphere in km)
POINTS = [
    ("pole_89.5S_0E", -89.5, 0.0, 0.0),
    ("ridge_89.45S_222.6E", -89.45, 222.6, 1.5),
    ("south_85S_123E", -85.0, 123.0, 0.0),
    ("south_88S_60W", -88.0, -60.0, -2.0),
    ("equator_0.67N_23.47E", 0.67, 23.47, 0.0),
]
BODIES = {"sun": "10", "earth": "399"}
START, STOP, STEP = "2026-11-14 00:00", "2027-11-14 00:00", "73 h"


def fetch(body_id: str, lat: float, lon: float, alt_km: float) -> list[dict]:
    params = {
        "format": "text",
        "COMMAND": f"'{body_id}'",
        "CENTER": "'coord@301'",
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{lon},{lat},{alt_km}'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "START_TIME": f"'{START}'",
        "STOP_TIME": f"'{STOP}'",
        "STEP_SIZE": f"'{STEP}'",
        "QUANTITIES": "'4,20'",
        "ANG_FORMAT": "'DEG'",
        "CSV_FORMAT": "'YES'",
        "CAL_FORMAT": "'CAL'",
        "TIME_DIGITS": "'MINUTES'",
    }
    for attempt in range(5):
        resp = requests.get(
            API, params=params, timeout=120, headers={"User-Agent": "spaceu-lunar-navigator-tests"}
        )
        if resp.status_code == 200 and "$$SOE" in resp.text:
            break
        time.sleep(5 * (attempt + 1))
    else:
        raise RuntimeError(f"Horizons failed: {resp.status_code} {resp.text[:300]}")
    text = resp.text
    assert "DE441" in text, "unexpected ephemeris source"
    rows = []
    months = {m: i + 1 for i, m in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split())}
    for line in text.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines():
        cells = [c.strip() for c in line.split(",")]
        date, hhmm = cells[0].split()
        y, mon, d = date.split("-")
        rows.append(
            {
                "utc": f"{y}-{months[mon]:02d}-{d}T{hhmm}:00Z",
                "az": float(cells[3]),
                "el": float(cells[4]),
                "range_km": float(cells[5]) * AU_KM,
            }
        )
    return rows


def main() -> None:
    out = {
        "source": "JPL Horizons API, observer coord@301, quantities 4 and 20, ephemeris DE441",
        "retrieved": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "points": [],
    }
    for label, lat, lon, alt in POINTS:
        entry = {"label": label, "lat": lat, "lon": lon, "alt_km": alt}
        for name, body_id in BODIES.items():
            entry[name] = fetch(body_id, lat, lon, alt)
            print(label, name, len(entry[name]))
            time.sleep(1)
        out["points"].append(entry)
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print("written", FIXTURE)


if __name__ == "__main__":
    main()
