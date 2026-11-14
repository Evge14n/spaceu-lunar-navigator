"""Build a richer mock dataset for the frontend in the final data/ layout.

Sun and Earth positions are REAL (JPL Horizons, observer on the Moon, smooth sphere).
Terrain and horizon masks are SYNTHETIC (random hills), so lit % is NOT real.
Every file carries "mock": true. Output: frontend/public/mock/
Run: python -P -E frontend/scripts/make_mock.py   (needs numpy)
"""
import json, math, os, sys, urllib.parse, urllib.request
import numpy as np

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "mock")
START, STOP = "2026-11-01 00:00", "2027-01-31 00:00"
SITES = [  # mock points, not official landing sites
    ("mockA", "Mock site A (ridge)", -89.5, 0.0, 0.4),
    ("mockB", "Mock site B (crater rim)", -88.8, 120.0, 1.0),
    ("mockC", "Mock site C (plain)", -87.5, -60.0, 1.6),
    ("mockD", "Mock site D (valley)", -86.0, 30.0, 2.6),
]
R_SUN, R_MOON = 695700.0, 1737.4
AU = 149597870.7
CACHE = os.path.join(os.path.dirname(__file__), ".horizons_cache")


def horizons(body, lat, lon):
    os.makedirs(CACHE, exist_ok=True)
    fn = os.path.join(CACHE, f"{body}_{lat}_{lon}.txt")
    if not os.path.exists(fn):
        q = {
            "format": "text", "COMMAND": f"'{body}'", "CENTER": "'coord@301'",
            "COORD_TYPE": "'GEODETIC'", "SITE_COORD": f"'{lon},{lat},0'",
            "EPHEM_TYPE": "'OBSERVER'", "START_TIME": f"'{START}'", "STOP_TIME": f"'{STOP}'",
            "STEP_SIZE": "'1 h'", "QUANTITIES": "'4,20'", "CSV_FORMAT": "'YES'",
            "ANG_FORMAT": "'DEG'", "TIME_DIGITS": "'MINUTES'",
        }
        url = "https://ssd.jpl.nasa.gov/api/horizons.api?" + urllib.parse.urlencode(q, safe="'@,")
        req = urllib.request.Request(url, headers={"User-Agent": "spaceu-mock-builder"})
        with urllib.request.urlopen(req, timeout=120) as r:
            open(fn, "wb").write(r.read())
    txt = open(fn, encoding="utf-8").read()
    body_txt = txt.split("$$SOE")[1].split("$$EOE")[0]
    times, az, el, dist = [], [], [], []
    for line in body_txt.strip().splitlines():
        p = [s.strip() for s in line.split(",")]
        # Date, (flag), (flag), Azi, Elev, delta, deldot
        t = p[0]
        a, e, d = float(p[3]), float(p[4]), float(p[5])  # Date, solar flag, lunar flag, Azi, Elev, delta
        dt = __import__("datetime").datetime.strptime(t, "%Y-%b-%d %H:%M")
        times.append(dt.strftime("%Y-%m-%dT%H:%M:%SZ"))
        az.append(a); el.append(e); dist.append(d * AU)
    return times, np.array(az), np.array(el), np.array(dist)


def disc_fraction(el, horizon, r):
    """Visible fraction of a disc of angular radius r whose centre is at el, above a flat local horizon."""
    h = np.clip((el - horizon) / r, -1, 1)
    return (np.arccos(-h) - (-h) * np.sqrt(1 - h * h)) / math.pi


def make_terrain(seed, relief, n=128, size_m=10000.0):
    rng = np.random.default_rng(seed)
    x = np.linspace(-size_m / 2, size_m / 2, n)
    X, Z = np.meshgrid(x, x)  # row 0 = north edge -> z (south) negative
    Z = Z  # rows go north->south: z from -size/2 to +size/2
    H = np.zeros_like(X)
    for _ in range(14):
        cx, cz = rng.uniform(-size_m / 2, size_m / 2, 2)
        s = rng.uniform(600, 2500)
        H += rng.uniform(-1, 1) * relief * 40 * np.exp(-((X - cx) ** 2 + (Z - cz) ** 2) / (2 * s * s))
    H -= H[n // 2, n // 2]  # site at 0 m
    return H.astype(np.float32), size_m / (n - 1)


def horizon_from(H, step, height, relief, seed):
    n = H.shape[0]
    c = n // 2
    rng = np.random.default_rng(seed + 100)
    az = np.arange(720) * 0.5
    out = np.zeros(720)
    for i, a in enumerate(np.radians(az)):
        best = -1e9
        for k in range(2, c - 1):
            d = k * step
            ex, ez = math.sin(a) * d, -math.cos(a) * d  # east, south
            col = int(round(c + ex / step)); row = int(round(c + ez / step))
            if 0 <= row < n and 0 <= col < n:
                h = H[row, col] - height - (d * d) / (2 * R_MOON * 1000)
                best = max(best, math.degrees(math.atan2(h, d)))
        out[i] = best
    # far-field ridges (beyond the tile), smooth in azimuth
    far = np.zeros(720)
    for _ in range(6):
        c0 = rng.uniform(0, 360); w = rng.uniform(10, 60); amp = rng.uniform(0, relief)
        dd = (az - c0 + 180) % 360 - 180
        far += amp * np.exp(-(dd ** 2) / (2 * w * w))
    curv = -math.degrees(math.acos(R_MOON / (R_MOON + height / 1000)))
    return np.round(np.maximum(np.maximum(out, far + curv), curv), 3)


def main():
    os.makedirs(os.path.join(OUT, "timeline"), exist_ok=True)
    os.makedirs(os.path.join(OUT, "horizon"), exist_ok=True)
    os.makedirs(os.path.join(OUT, "terrain"), exist_ok=True)
    sites = []
    for idx, (sid, name, lat, lon, relief) in enumerate(SITES):
        ts, saz, sel, sdist = horizons("10", lat, lon)
        te, eaz, eel, edist = horizons("399", lat, lon)
        assert ts == te
        H, step = make_terrain(idx + 1, relief)
        hz = horizon_from(H, step, 2.0, relief, idx + 1)
        H.tofile(os.path.join(OUT, "terrain", f"{sid}.bin"))
        json.dump({"mock": True, "site": sid, "n": H.shape[0], "size_m": 10000, "step_m": round(step, 3),
                   "center": {"lat": lat, "lon": lon}, "min_h": round(float(H.min()), 1),
                   "max_h": round(float(H.max()), 1), "file": f"terrain/{sid}.bin"},
                  open(os.path.join(OUT, "terrain", f"{sid}.json"), "w"))
        json.dump({"mock": True, "site": sid, "height_m": 2, "step_deg": 0.5, "elevation_deg": hz.tolist()},
                  open(os.path.join(OUT, "horizon", f"{sid}.json"), "w"))
        idx_s = np.round(saz * 2).astype(int) % 720
        idx_e = np.round(eaz * 2).astype(int) % 720
        shz, ehz = hz[idx_s], hz[idx_e]
        r_sun = np.degrees(np.arcsin(R_SUN / sdist))
        r_earth = np.degrees(np.arcsin(6371.0 / edist))
        vf = np.round(disc_fraction(sel, shz, r_sun), 3)
        ev = (eel + r_earth) > ehz
        tl = {"mock": True, "site": {"id": sid, "lat": lat, "lon": lon, "terrain": True}, "height_m": 2,
              "times": ts,
              "sun": {"az": np.round(saz, 3).tolist(), "el": np.round(sel, 3).tolist(),
                      "horizon_el": shz.tolist(), "visible_fraction": vf.tolist()},
              "earth": {"az": np.round(eaz, 3).tolist(), "el": np.round(eel, 3).tolist(),
                        "horizon_el": ehz.tolist(), "visible": ev.tolist(),
                        "distance_km": np.round(edist).astype(int).tolist()},
              "source": "MOCK: Sun/Earth from JPL Horizons coord@301 (smooth sphere); horizon is synthetic"}
        json.dump(tl, open(os.path.join(OUT, "timeline", f"{sid}.json"), "w"), separators=(",", ":"))
        sites.append({"mock": True, "id": sid, "name": name, "lat": lat, "lon": lon, "elevation_m": 0,
                      "source": "mock point, synthetic terrain", "has_5m": False})
        print(sid, len(ts), "lit%", round(float((vf > 0).mean() * 100), 1), "earth%", round(float(ev.mean() * 100), 1))
    json.dump(sites, open(os.path.join(OUT, "sites.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
