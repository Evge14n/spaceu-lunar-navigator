# Architecture

## Idea in one line

Everything the demo shows is **computed in advance and served as static files**. The live API adds custom coordinates and arbitrary dates, but the site works without it.

```
NASA data                     backend/ (Python)                       data/ (static)               frontend/ (React)
SPICE kernels ──┐             ephem.py    Sun/Earth az, el            sites.json                   Map      (2D south pole)
LOLA DEM 20 m ──┼──►          terrain.py  DEM reader, local frame ──► horizon/<site>.json     ──►  Compare  (table)
LOLA 5 m sites  │             horizon.py  720-azimuth horizon mask    timeline/<site>.json         Timeline (chart + slider)
Illumination ───┘             metrics.py  lit %, darkness, windows    summary/<site>.json          View3D   (three.js)
maps                          precompute.py  writes data/             terrain/<site>.bin + .json   Why      (explanations)
JPL Horizons ─► tests only    api.py      FastAPI, same JSON shapes   illumination.png
```

Hosting: **GitHub Pages** serves `frontend/dist` together with `data/`. The FastAPI service (Render, free plan) is optional; the frontend calls it only for custom coordinates and falls back to static files.

## Why static first

- A finalist demo from last year returns 404 today. Static files on Pages stay up.
- Judges open the link once. A free server that sleeps after 15 minutes is a risk at exactly that moment.
- The horizon mask is the slow part and is computed once per site anyway.

## Backend modules

| Module | Responsibility |
|---|---|
| `ephem.py` | Loads kernels. `sun_earth(lat, lon, h, times)` returns azimuth and elevation of the Sun and the Earth in the local east-north-up frame. SPICE `spkpos`, frame `MOON_ME`, correction `LT+S`. The site vector is subtracted for the Earth (parallax about 0.26 deg). |
| `terrain.py` | Reads LOLA polar stereographic DEMs (raw int16 PDS3 and GeoTIFF), converts lat/lon to pixel and back, cuts a local tile and converts it to east-north-up with curvature. |
| `horizon.py` | For a site and an instrument height: elevation angle of the terrain for 720 azimuths (0.5 deg step), rays out to 150 km, fine step near, coarse step far. numba. |
| `metrics.py` | Visible fraction of the solar disc, lit percentage, longest lit and dark periods, Earth visibility windows, next sunset and Earthset (bisection). |
| `precompute.py` | Runs everything for the site list for one year at a 1 hour step and writes `data/`. |
| `api.py` | FastAPI with the endpoints from `docs/API.md`. Reads the same cached files, computes custom points on demand. |
| `tests/` | Test 1: positions against JPL Horizons. Test 2: lit % against the LOLA average illumination map. Test 3: zero light inside permanently shadowed regions. |

## Conventions (everyone must follow)

- Time: UTC, ISO 8601 with `Z`.
- Angles: degrees. Azimuth from north, clockwise (0 north, 90 east).
- Longitude: east positive. Latitude: south negative.
- Lunar radius: 1737.4 km. Frame: `MOON_ME`.
- "Sun visible" means any part of the disc is above the terrain, the same rule as the NASA illumination maps. We also give the visible fraction of the disc.
- 3D scene axes (three.js): **x = east, y = up, z = south**. Direction to a body with azimuth A and elevation E: `x = cosE*sinA, y = sinE, z = -cosE*cosA`.
- Terrain tile: `terrain/<site>.bin` is an N x N grid of float32 heights in metres in the local frame, row 0 is the north edge; `terrain/<site>.json` describes it: `{"n": 512, "size_m": 10000, "step_m": 19.57, "center": {"lat": .., "lon": ..}, "min_h": .., "max_h": ..}`.

## Frontend

React + Vite + TypeScript. One data layer `src/api/` that first reads static files from `data/` and, for custom coordinates, calls the live API. Screens:

1. **Map**: south pole from above, illumination layer, site markers, custom coordinates.
2. **Compare**: 2 to 4 sites and a date range, table of metrics, best value highlighted.
3. **Timeline**: Sun and Earth elevation over time against the terrain horizon, shaded windows, time slider.
4. **View3D**: terrain around the site, Sun and Earth in the sky in true directions, driven by the slider.
5. **Why**: short explanations for students and the public.

## What we do not build

Thermal model, scattered light, relay satellites, DSN ground stations, a mobile app, an AI chat, our own illumination map of the whole pole.
