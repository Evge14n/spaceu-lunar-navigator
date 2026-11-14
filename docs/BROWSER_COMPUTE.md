# Computing any point in the browser

The ten listed sites are precomputed with the full method (`data/horizon`, `data/timeline`, `data/summary`). For any other point near the south pole the page can compute the same quantities by itself, without a server, from three small files:

| File | Size | Content |
|---|---|---|
| `data/ephem/year.bin` + `year.json` | 210 kB | direction to the Sun and position of the Earth, every hour of the year |
| `data/ephem/sun_distance.bin` | 35 kB | distance of the Sun at the same moments |
| `data/dem240.bin` + `dem240.json` | 6.3 MB | elevation model, 240 m pixels, on the pixel grid of `data/illumination.png` |

A ready port of the algorithm is `data/ephem/compute.mjs` (no dependencies, about 40 ms per point in Node). `data/ephem/test_vectors.json` holds the expected results for 13 points, and `node data/ephem/check.mjs` compares the port with them. The reference implementation is `backend/browser.py`; it reads only the three files above.

```js
import { createComputer } from "./compute.mjs";

const json = (path) => fetch(path).then((r) => r.json());
const binary = (path) => fetch(path).then((r) => r.arrayBuffer());
const [yearMeta, demMeta] = await Promise.all([json("data/ephem/year.json"), json("data/dem240.json")]);
const [yearBin, sunDistanceBin, demBin] = await Promise.all([
  binary("data/" + yearMeta.file),               // ephem/year.bin
  binary("data/" + yearMeta.sun_distance.file),  // ephem/sun_distance.bin
  binary("data/" + demMeta.file),                // dem240.bin
]);
const computer = createComputer(yearMeta, yearBin, sunDistanceBin, demMeta, demBin);
const result = computer.compute(-89.45, 222.7); // latitude, east longitude, [eye height in m, default 2]

result.ground_m;               // ground above the 1737.4 km sphere, m
result.mask;                   // Float64Array(720): skyline elevation, deg; index = azimuth / 0.5
result.missing_fraction;       // share of the ray samples that fell outside the model
result.sun.az[i], result.sun.el[i], result.sun.visible_fraction[i], result.sun.irradiance_w_m2[i];
result.sun.horizon_el[i];      // the skyline at the azimuth of the centre of the disc
result.earth.az[i], result.earth.el[i], result.earth.visible_fraction[i], result.earth.distance_km[i];
result.year;                   // lit_percent, longest_dark_h, longest_lit_h, mean_irradiance_w_m2,
                               // energy_kwh_m2, earth_visible_percent, longest_earth_hidden_h
computer.timeOf(i);            // Date of sample i (i = 0 .. 8760)
```

`compute` throws when the point is outside the model (north of 83° S).

## The files

**`ephem/year.bin`** is a little-endian `float32` array of `n * stride` = 8761 × 6 values. Sample `i` is the moment `start + i * step_h` (`2026-11-14T00:00:00Z`, 1 hour). One record:

| Index | Name | Meaning |
|---|---|---|
| 0, 1, 2 | `sun_x`, `sun_y`, `sun_z` | unit vector from the centre of the Moon to the Sun |
| 3, 4, 5 | `earth_x_km`, `earth_y_km`, `earth_z_km` | position of the centre of the Earth, km |

**`ephem/sun_distance.bin`** is a little-endian `float32` array of 8761 distances from the centre of the Moon to the Sun in km, for the same moments. It is needed for the parallax of the Sun (0.0007° at most), for the angular size of the disc and for the irradiance.

The frame is MOON_ME (x towards the mean Earth direction, z towards the north pole), origin at the centre of the Moon. The positions are apparent ones (light time and stellar aberration, `LT+S`), taken from the NAIF SPICE kernels exactly as `backend/ephem.py` does. `year.json` describes both files (`file`, `n`, `stride`, `record`, `start`, `end`, `step_h`, `sun_distance`; file names are relative to `data/`) and carries the constants: `moon_radius_km` 1737.4, `sun_radius_km` 695700, `earth_radius_km` 6378.137, `au_km` 149597870.7, `solar_constant_w_m2` 1361. A `float32` keeps the directions to 0.00001°.

**`dem240.bin`** is a little-endian `int16` array of `n * n` = 1772 × 1772 heights in metres above the sphere of 1737.4 km, row by row. It is the south polar stereographic grid of `data/illumination.png`: row 0 is the largest `y`, column 0 the smallest `x`, and the centre of pixel (row `r`, column `c`) is

```
x = -212520 + 240 * c      (metres, towards 90 E)
y =  212520 - 240 * r      (metres, towards 0 E)
```

`dem240.json` gives the same as `first_pixel_centre_m` and `pixel_m`, and the outer edges of the grid as `x_km` and `y_km` (±212.64 km). The grid ends at 83° S. It is the NASA LOLA model `LDEM_75S_120M` averaged 2 × 2.

## The algorithm

Angles are in radians inside the formulas; `R` = 1 737 400 m.

**1. Local axes.** For latitude `lat` and east longitude `lon`, in MOON_ME:

```
east  = (-sin lon,            cos lon,           0      )
north = (-sin lat * cos lon, -sin lat * sin lon, cos lat)
up    = ( cos lat * cos lon,  cos lat * sin lon, sin lat)
```

Azimuth is counted from north through east: a direction `d` has `az = atan2(d·east, d·north)` and `el = asin(d·up)`.

**2. Map coordinates and the height of the ground.** A unit vector `u` from the centre of the Moon lands on the map at

```
k = 2R / (1 - u.z)        x = k * u.y        y = k * u.x
```

(for a point given by latitude and longitude this is `rho = 2R * tan((90° + lat) / 2)`, `x = rho * sin lon`, `y = rho * cos lon`). The height there is the bilinear interpolation of the four surrounding pixels: with `fc = (x - x0) / 240` and `fr = (y0 - y) / 240` (`x0`, `y0` = `first_pixel_centre_m`), `c = floor(fc)`, `r = floor(fr)`, the weights are `fc - c` and `fr - r`. A position with `fc` or `fr` outside `0 .. 1771` has no data. The ground of the point itself is `ground = height(up)`, and the eye is at the radius `r_obs = R + ground + eye_height` (2 m by default).

**3. Horizon mask: the skyline in 720 azimuths.** For azimuth `az_a = a * 0.5°`, `a = 0 .. 719`, the ray leaves the point along the great circle in the direction `dir = sin(az_a) * east + cos(az_a) * north`. It is sampled at the distances `s_j = 240, 360, 480, ... 150 000 m` (1249 samples, every 120 m). With the central angle `g = s_j / R`:

```
u     = cos(g) * up + sin(g) * dir        (unit vector of the terrain point)
r     = R + height(u)
t     = (r * cos(g) - r_obs) / (r * sin(g))     (tangent of the elevation of that terrain point)
mask[a] = atan(max over j of t)
```

The curvature of the Moon is inside the formula: on a smooth sphere the result is the dip of the horizon, −0.087° for an eye at 2 m. Samples that fall outside the model are skipped and counted (`missing_fraction`); a ray with no sample at all gets the dip of a smooth sphere, `-acos((R + ground) / r_obs)`. The first sample is one pixel away from the point because a 240 m model cannot tell what is closer; starting at 120 m or at 480 m gives larger errors (see Accuracy).

**4. Where a body is in the sky.** For each hour take the position `P` of the body in km (Sun: unit vector times distance; Earth: as stored). The point itself is at `S = (R_km + (ground + eye_height) / 1000) * up`. With `v = P - S` (this subtraction is the parallax: for the Earth it changes the elevation by about 0.26°):

```
distance = |v|
el       = asin(v·up / distance)
az       = atan2(v·east, v·north)            (0 .. 360°)
radius   = asin(body_radius_km / distance)   (angular radius of the disc: Sun 0.27°, Earth about 0.95°)
```

**5. Visible share of the disc.** The disc is cut into 24 vertical strips. For strip `k = 0 .. 23`:

```
off   = (k + 0.5) / 24 * 2 - 1                       (centre of the strip, in units of the radius)
half  = radius * sqrt(1 - off²)                      (half of the height of the strip)
hor   = mask at the azimuth  az + off * radius / max(cos el, 1e-6)
seen  = clamp(el + half - hor, 0, 2 * half)
```

`visible_fraction = sum(seen) / sum(2 * half)`. The mask at an arbitrary azimuth is the linear interpolation between the two neighbouring samples, periodic over 360° (`position = (azimuth mod 360) / 0.5`). The body is "visible" when `visible_fraction > 0`, that is when any part of the disc is above the terrain: the definition used by the NASA illumination maps. `horizon_el` is the mask at the azimuth of the centre of the disc.

**6. Sunlight.** `irradiance = 1361 W/m² * (au_km / distance)² * visible_fraction` on a surface that faces the Sun.

**7. Numbers of the year**, from the 8761 hourly samples:

- `lit_percent` and `earth_visible_percent`: share of the samples with `visible_fraction > 0`.
- `longest_dark_h`, `longest_lit_h`, `longest_earth_hidden_h`: the longest run of consecutive samples in that state, times one hour (never more than 8760).
- `mean_irradiance_w_m2`: mean over the samples; `energy_kwh_m2 = mean * 8760 / 1000`.

A timeline, a sky view or a rise and set list for the point follow from the same per-hour arrays.

## Test vectors

`data/ephem/test_vectors.json` is written by `python -m backend.browser vectors` with exactly this algorithm. For the ten listed sites and three other points (`points`) it has:

- `lat`, `lon`, `height_m`, `ground_m`, `missing_fraction`;
- `mask_deg`: the 720 values of the horizon mask;
- `moments`: 24 samples spread over the year (`index` into `year.bin`), each with `sun` and `earth`: `az`, `el`, `horizon_el`, `angular_radius_deg`, `visible_fraction`, plus `irradiance_w_m2` for the Sun and `distance_km` for the Earth. They include day, night and the disc partly behind the terrain;
- `year`: the numbers of step 7.

`tolerance` in the file is what a port must meet: 0.001° for angles and the mask, 0.002 for visible fractions, 0.05 pp for percentages, 0.1 W/m² for irradiance, whole hours exactly. `compute.mjs` differs from the file by 0.00005° at most (the rounding of the stored values).

## Accuracy

The page should say that a custom point is an estimate. A 240 m pixel is an average: a summit or a narrow ridge is lower in it than in reality and its neighbours are higher, so a sharp summit can lose most of its light, while a point just below a crest can gain light it does not have. Slopes, plains and crater floors are reproduced well.

Measured against the full computation of the same year (20 m model near the point, 80 m and 120 m farther out, eye at 2 m) at 480 randomly drawn points inside 85° S, see Test 4 in [VALIDATION.md](VALIDATION.md). Differences are estimate minus full computation:

| Quantity | Median | Mean absolute | 9 points in 10 within | Largest |
|---|---|---|---|---|
| Lit share of the year | 0.4 pp | 2.1 pp | 5.7 pp | 43 pp |
| Earth visible share of the year | 0.1 pp | 1.6 pp | 3.9 pp | 43 pp |
| Longest night | 1.7 h | 134 h | 110 h | 5710 h |

The lit share is within 1 pp for 62 % of the points, within 5 pp for 89 % and within 10 pp for 95 %. By how well lit the point really is:

| Lit share by the full computation | Points | Median difference | 9 in 10 within | Largest | Longest night within a day |
|---|---|---|---|---|---|
| 0 % (never lit) | 78 | 0.0 pp | 0.0 pp | 5.9 pp | 95 % |
| up to 25 % | 158 | 0.3 pp | 4.9 pp | 27 pp | 81 % |
| 25 to 50 % | 92 | 0.4 pp | 4.1 pp | 29 pp | 84 % |
| 50 to 70 % | 78 | 1.0 pp | 11.6 pp | 24 pp | 72 % |
| above 70 % | 74 | 2.5 pp | 6.9 pp | 43 pp | 66 % |

The longest night is within a day of the full computation for 80 % of the points. Its large errors come from mostly dark points where the estimate finds a few sunlit hours that split one long night in two.

The ten listed sites are the hardest case: most of them are well-lit ridges, crater rims and summits, exactly what a 240 m pixel flattens. Against their 5 m models the estimate is off by 2.0 pp in the median and 6.2 pp on average, and by 39 pp at the summit of the Malapert massif (46 % instead of 85 %). The page keeps the precomputed files for them.

A caption that says this in one sentence is in `data/validation.json` (`browser.caption`), built from the same numbers.

Where it works: the model covers latitudes south of 83° S; south of 85° S every ray has at least 60 km of terrain. Between 85° S and 83° S a part of the horizon falls outside the model (`missing_fraction` up to 0.24 at the listed site at 83.7° S) and the result is less certain. North of 83° S there is no data: `compute` throws.
