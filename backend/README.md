# Backend

Python code that turns NASA data into the numbers the site shows: where the Sun and the Earth are in the sky of a lunar site, what the mountains around it hide, and how that adds up over a year.

```
NAIF SPICE kernels ──► ephem.py ───────────────┐
                                               ├─► metrics.py ─► precompute.py ─► data/*.json, *.bin
LOLA elevation models ─► terrain.py ─► horizon.py ┘                    │
LOLA illumination maps ─► sites.py (site points), validate.py          └─► api.py (FastAPI, same shapes)

ephem.py + terrain.py ─► browser.py ─► data/ephem/*, data/dem240.* (any point computed in the browser)
```

| File | What it does |
|---|---|
| `ephem.py` | Apparent position of the Sun and the Earth from a point on the Moon: azimuth, elevation, distance, angular radius (SPICE, frame `MOON_ME`, light time and aberration) |
| `terrain.py` | Reads the LOLA polar elevation models (PDS `.img` and the 5 m GeoTIFFs), polar stereographic projection, local 10 km terrain tiles with the curvature of the Moon |
| `horizon.py` | Horizon mask of a point: the highest terrain elevation angle in 720 azimuths, rays out to 150 km |
| `sites.py` | The ten sites: NASA 5 m site models and the rule that picks the point inside each |
| `metrics.py` | Visible share of the solar and Earth discs above the mask, lit and visible percentages, rise and set moments, longest darkness, sunlight on a panel in W/m2 |
| `precompute.py` | Writes everything in `data/` |
| `validate.py` | Compares our illumination with the NASA LOLA maps (docs/VALIDATION.md) and writes `data/validation.json` for the Accuracy screen |
| `browser.py` | Files and reference implementation of the computation a browser does for any point (docs/BROWSER_COMPUTE.md), its test vectors and its comparison with the full computation |
| `api.py` | The live API of docs/API.md |
| `fetch_data.py` | Downloads the NASA inputs from their official addresses |

## Setup

Python 3.11 or newer.

```
python -m venv venv
venv/Scripts/activate            # Linux, macOS: source venv/bin/activate
pip install -r backend/requirements.txt
python -m backend.fetch_data kernels      # 46 MB of SPICE kernels
```

All commands are run from the root of the repository. The kernels are enough for the tests, for the API with the listed sites and for recomputing the timelines from the stored horizon masks.

Folders (override with environment variables):

| Variable | Default | Content |
|---|---|---|
| `LUNAR_KERNEL_DIR` | `backend/kernels` | SPICE kernels. SPICE does not accept long or non-ASCII paths: if the repository is in such a folder, point this variable to a short one (`C:/sp`) |
| `LUNAR_RAW_DIR` | `backend/raw` | NASA rasters, 1.6 GB, needed only to recompute `data/` from scratch and for custom coordinates |
| `LUNAR_DATA_DIR` | `data` | the precomputed files |

## Tests

```
python -m pytest -c backend/pyproject.toml backend
ruff check --config backend/pyproject.toml backend
```

Tests marked `raw` need the rasters and are skipped without them. The test of `ephem.py` against JPL Horizons runs offline on answers saved from the Horizons API (`tests/fixtures/horizons.json`, written by `tests/make_horizons_fixture.py`). What is tested and what the measured errors are: [docs/VALIDATION.md](../docs/VALIDATION.md).

## Recomputing the data

```
python -m backend.fetch_data rasters      # 1.6 GB: LDEM 20/80/120 m, ten 5 m site models, illumination maps
python -m backend.precompute all          # about 15 seconds
python -m backend.precompute timeline --sites site04,site23     # one step, some sites
python -m backend.fetch_data validation   # 465 MB: the 60 m LOLA model, used only by the next line
python -m backend.validate                # about 20 minutes, writes data/validation/
python -m backend.browser files           # data/ephem/year.bin, sun_distance.bin, data/dem240.bin
python -m backend.browser vectors         # data/ephem/test_vectors.json
python -m backend.browser compare         # about 8 minutes: the browser algorithm against the full one
python -m backend.validate accuracy       # data/validation.json from the tables above
node data/ephem/check.mjs                 # the JavaScript port against the test vectors
```

Steps of `precompute`: `sites` → `terrain` → `horizon` → `timeline` → `map` → `heights` → `reference`. The period (2026-11-14 .. 2027-11-14), the step (1 hour) and the instrument height (2 m) are constants at the top of `precompute.py`. `heights` repeats the year with the instrument at 1, 5 and 10 m (`data/summary/heights.json`), `reference` computes the same year for the Apollo 11 site near the equator (`data/reference/apollo11.json`). The output is deterministic: the tests recompute the files and compare them with what is committed.

## API

```
uvicorn backend.api:app --port 8000
```

Interactive documentation is at `http://localhost:8000/docs`. Examples:

```
/api/sites
/api/timeline?site=site04&start=2026-12-01T00:00:00Z&end=2026-12-31T00:00:00Z&step=60
/api/summary?site=custom:-89.45,222.7
/api/compare?sites=site01,site04,site23
/api/horizon?site=site04&height_m=10
/api/sky?site=site04&time=2026-12-25T12:00:00Z
```

The frontend uses the API only for custom coordinates (`VITE_API_URL=http://localhost:8000`); everything else on the site is static files.

- Listed sites with the instrument at 1, 2, 5 or 10 m use the stored horizon masks and need only the kernels.
- Custom coordinates and other instrument heights compute a new horizon mask (0.1 to 0.4 s) and need the rasters. Custom points use the 20 m elevation model near the pole, 80 m and 120 m farther out (to 75 S).
- Without the rasters, or outside the elevation models, a custom point is computed on a smooth sphere and the answer says so: `"terrain": false`. The positions of the Sun and the Earth are still exact, but no mountain hides them.

## Method in short

1. **Sun and Earth.** `spkpos` gives the apparent vector from the centre of the Moon in the body-fixed frame `MOON_ME` (kernels `de440s`, `moon_pa_de440_200625`). The vector of the site is subtracted, the rest is projected on the local east, north and up.
2. **Terrain.** Heights are above the 1737.4 km sphere. A point of the map is `x = rho*sin(lon)`, `y = rho*cos(lon)`, `rho = 2R*tan((90+lat)/2)`; row 0 of every raster is the largest `y`.
3. **Horizon.** From the instrument (2 m above the ground) a ray goes along a great circle in each of 720 azimuths. For a terrain point at angular distance `g` and radius `r` the elevation angle is `atan2(r*cos(g) - r0, r*sin(g))`; the mask keeps the largest one. The step along the ray is 5 m to 3 km, 20 m to 30 km, 80 m to 150 km. The finest model that has data at the point is used.
4. **Visibility.** The disc of the Sun (radius about 0.27 degrees) or the Earth (about 0.95 degrees) is cut into 24 vertical strips, each compared with the mask at its own azimuth. The body is visible when any part of the disc is above the terrain, which is the rule of the NASA illumination maps.
5. **Numbers.** Percentages are shares of hourly samples. Rise and set moments are refined between samples by bisection to 30 seconds.
6. **Power.** Sunlight on a surface that faces the Sun is `1361 W/m2 * (1 au / distance)^2 * visible share of the disc`; the energy of a period is its mean times the length of the period. Electric power is that times the area of the panel and the efficiency of the cells.

## Limits

- The Moon is a sphere of 1737.4 km in the geometry of the horizon (as in all LOLA products); heights come from the elevation models.
- Light is geometric: no scattering, no light reflected from lit slopes, no penumbra model beyond the visible share of the disc. The disc is uniformly bright (no limb darkening).
- The panel is assumed to follow the Sun; dust, temperature and degradation of the cells are not modelled.
- The Earth is "visible" when any part of its disc is above the terrain. A radio link to a particular ground station needs more than that.
- Terrain farther than 150 km is not considered. Measured on 480 random points with rays to 400 km: 0.04 pp less light on average, 0.9 pp at most.
- A point computed in the browser uses one 240 m model and is an estimate; its measured error is in docs/BROWSER_COMPUTE.md.
