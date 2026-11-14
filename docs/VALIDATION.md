# Validation

Every number on the site comes from two inputs, the positions of the Sun and the Earth and the shape of the terrain, and one computation, the skyline around a point. This document compares each of them with an independent NASA source, says by how much they differ and why.

| # | What is checked | Against | Result |
|---|---|---|---|
| 1 | Directions of the Sun and the Earth from a point on the Moon | JPL Horizons | 1210 compared positions, largest difference 0.000027° |
| 1b | The elevation model is read the right way round | NASA 5 m site models (georeferenced independently) | 1.2 to 2.3 m RMS as we read it, 425 to 9345 m in the seven other orientations |
| 1c | Skyline computation | terrain with a known answer | the dip of a smooth sphere to 0.0002°, a hill to 0.01° |
| 2 | Share of time a point is lit | NASA LOLA map of average illumination, 480 random pixels | mean difference −0.51 pp, mean absolute 1.08 pp, median 0.26 pp, correlation 0.9957 |
| 2b | Share of time the Earth is visible | NASA LOLA map of Earth visibility, same pixels | mean −0.06 pp, mean absolute 0.71 pp, median 0.10 pp, correlation 0.9958 |
| 3 | Permanently shadowed regions stay dark | NASA LOLA map of permanent shadow, 150 random pixels | 149 of 150 never lit; all 92 pixels inside a shadowed region never lit |
| - | The ten listed sites | the same NASA map | our year is 2.9 pp higher on average; split into its causes below |
| 4 | The estimate a browser makes for any point (240 m model) | our full computation | median difference 0.4 pp, nine points in ten within 5.7 pp, largest 43 pp |

pp = percentage points. All numbers below are stored in `data/validation/` and rebuilt by the commands at the end; the tests in `backend/tests/` recompute them. `data/validation.json` is the short version shown on the Accuracy sheet of the site.

## Definitions

- **Lit**: any part of the solar disc is above the terrain. This is the definition of the NASA maps. The Sun is a uniform disc of radius 695 700 km; only geometry is counted, no scattered or reflected light.
- **Period**: the site shows one year, 2026-11-14 to 2027-11-14 (UTC). The NASA maps are means over 18.6 years (one cycle of the lunar nodes).
- **Eye height**: the site computes for an instrument 2 m above the ground; the NASA maps are computed on the surface.
- **Full computation**: skyline in 720 azimuths out to 150 km from the finest model available: the 5 m model within 3 km of a listed site, the 20 m model within 30 km, the 80 m model beyond (the 120 m model where the 80 m one ends).

## Test 1. Sun and Earth against JPL Horizons

Our positions come from the NAIF SPICE kernels (`de440s.bsp`, lunar orientation `moon_pa_de440_200625.bpc`, frame MOON_ME), apparent positions with light time and stellar aberration. The reference is the NASA JPL Horizons service queried for an observer on the lunar surface (`coord@301`, airless apparent azimuth and elevation, quantity 4, and range, quantity 20; Horizons used DE441). The answers were saved on 2026-11-14 (`backend/tests/fixtures/horizons.json`) so the test runs offline.

Five points: 89.5° S 0° E, a ridge at 89.45° S 222.6° E 1.5 km above the sphere, 85° S 123° E, 88° S 60° W 2 km below the sphere, and the Apollo 11 site near the equator. 121 moments each, every 73 hours across the whole year, for the Sun and for the Earth: 5 × 121 × 2 = 1210 compared positions.

| Body | Largest difference in direction | Largest difference in distance |
|---|---|---|
| Sun | 0.0000014° | 0.18 km |
| Earth | 0.0000269° | 0.18 km |

The target was 0.01°. The azimuth difference is measured on the sky (multiplied by the cosine of the elevation). For scale: the Sun moves 0.5° per hour and its disc is 0.53° wide, so the ephemeris contributes nothing visible to the errors below. A second check (`test_reference_epoch_from_the_brief`) reproduces four angles written down from Horizons two days before the event to 0.0001°. Leaving out the position of the point on the Moon (the parallax) would move the Earth by a quarter of a degree; the test `test_earth_parallax_matters` holds that.

## Test 1b. The elevation model is read the right way round

The PDS label of the LOLA polar models gives the map scale but not which way lines and samples run, and a mirrored or rotated terrain would still produce plausible pictures. NASA's 5 m site models are GeoTIFFs with their own georeferencing, read by a different reader. The 20 m polar model is sampled at the pixel centres of each 5 m model (averaged to 20 m) in all eight possible orientations:

| Site model | RMS as we read it, m | Smallest RMS of the seven other orientations, m | Largest, m |
|---|---|---|---|
| Site01 | 1.3 | 425 | 2249 |
| Site04 | 2.3 | 814 | 2500 |
| Site06 | 2.0 | 4846 | 9345 |
| Site07 | 1.3 | 917 | 2698 |
| Site11 | 1.3 | 1282 | 2555 |
| Site20 | 1.5 | 3389 | 8882 |
| Site23 | 1.7 | 747 | 6312 |
| Haworth | 1.4 | 1073 | 3191 |
| Shoemaker | 1.2 | 699 | 2241 |
| DM2 | 2.3 | 623 | 4384 |

Every site model on its own separates the right orientation from the wrong ones by a factor of more than 250. The same test fixes the map projection: the formulas are also compared with PROJ (`test_projection_matches_proj`), and the 80 m and 120 m models agree with the 20 m one at 4000 random points (`test_coarser_ldems_agree_with_the_20_m_one`).

## Test 1c. The skyline on terrain with a known answer

- A smooth sphere must give the dip of the horizon, `-acos(R / (R + h))`: −0.0869° for an eye at 2 m. The ray march returns it for 2 m, 10 m and 1000 m to 0.0002°.
- A Gaussian hill 3 km high, 20 km away: the skyline in eight azimuths agrees to 0.01° with a separate computation by plain vector algebra on the analytic surface (2 m steps, no rasters), the summit is in the right azimuth, and nothing appears on the opposite side.
- A hill placed geographically north-east of the point is seen at azimuth 45° at three different longitudes (the azimuth convention does not depend on where the point is), a higher instrument sees a lower horizon, and samples outside the model are reported, not hidden.

## Test 2. Illumination against the NASA map

**Reference.** `AVGVISIB_85S_060M_201608.TIF` (NASA GSFC PGDA, LOLA team): for each 60 m pixel within 85° S, the share of hourly time steps of 18.6 years in which any part of the solar disc is visible from the surface, computed from a 60 m LOLA elevation model.

**Sample.** 480 pixels inside 85° S drawn with a fixed seed: 80 in each of six bands of the map value (exactly 0, up to 10 %, 10 to 25 %, 25 to 50 %, 50 to 70 %, above 70 %). Bands are used because a plain random sample would be almost all dark floor and gentle slope and would say little about ridges, which is where landing sites are.

**Method.** We compute the same quantity with our own code at the centre of each pixel, first in the configuration of the map (the 60 m LOLA model of the PDS archive `ldem_75s_60m`, eye on the surface, hourly steps over 18.6 years, 163 161 moments), then change one thing at a time. The differences are ours minus the map:

| Configuration | Model | Eye | Days | Terrain to | Mean | Mean abs. | Median abs. | 9 in 10 within | Largest | Correlation |
|---|---|---|---|---|---|---|---|---|---|---|
| `map_config` | 60 m | 0 m | 6798 | 150 km | −0.51 | 1.08 | 0.26 | 3.15 | 28.3 | 0.9957 |
| `other_cycle` (starts 2008) | 60 m | 0 m | 6798 | 150 km | −0.60 | 1.14 | 0.33 | 3.26 | 28.5 | 0.9956 |
| `range_400km` | 60 m | 0 m | 6798 | 400 km | −0.55 | 1.10 | 0.27 | 3.21 | 28.3 | 0.9957 |
| `one_year` | 60 m | 0 m | 365 | 150 km | −0.06 | 1.23 | 0.63 | 2.90 | 26.8 | 0.9957 |
| `eye_2m` | 60 m | 2 m | 6798 | 150 km | +1.89 | 2.06 | 0.39 | 6.45 | 26.7 | 0.9936 |
| `dem_20m_mean` | 20 m, 3 × 3 mean | 0 m | 6798 | 150 km | −0.98 | 1.59 | 0.29 | 3.86 | 47.1 | 0.9873 |
| `dem_20m` | 20 m | 0 m | 6798 | 150 km | −4.92 | 5.08 | 0.66 | 17.46 | 59.9 | 0.9381 |
| `product` (what the site does) | 20 m | 2 m | 365 | 150 km | +1.35 | 2.26 | 0.89 | 6.46 | 23.6 | 0.9911 |

**Result.** Computed the way the map was, our code reproduces it: 63 % of the pixels are within 0.5 pp, 74 % within 1 pp, 84 % within 2 pp, 95 % within 5 pp, 99 % within 10 pp.

**What each difference between the map and the site costs** (change against `map_config` at the same pixels):

| Change | Mean | Mean abs. | Largest | Pixels that change |
|---|---|---|---|---|
| Another 18.6-year cycle | −0.09 | 0.10 | 0.6 | 84 % |
| Terrain to 400 km instead of 150 km | −0.04 | 0.04 | 0.9 | 18 % |
| One year instead of 18.6 | +0.45 | 0.66 | 2.7 | 84 % |
| Eye 2 m above the ground | +2.40 | 2.40 | 31.3 | 84 % |
| 20 m model averaged to 60 m instead of the 60 m model | −0.47 | 1.13 | 47.4 | 83 % |
| 20 m model, on the surface | −4.41 | 4.55 | 58.3 | 84 % |
| 20 m model: eye at 2 m and one year instead of the surface and 18.6 years | +6.26 | 6.32 | 61.9 | 84 % |

What this says:

- The choice of the cycle and the 150 km limit do not matter (0.1 pp and 0.04 pp).
- The year 2026-27 is on average 0.45 pp brighter than the 18.6-year mean at these pixels, 2.7 pp at most.
- The height of the eye matters most. Two metres add 2.4 pp on average and up to 31 pp, because near the pole the Sun stays within a few degrees of the horizon and a rise of a metre nearby is enough to hide it.
- For the same reason a finer model gives less light on the surface (−4.4 pp at 20 m): it contains small rises that a 60 m average smooths away. On the surface the result depends on the pixel size of the model more than on anything else; at 2 m the effect of the fine relief largely cancels (+6.3 pp). This is why the site computes for an instrument at 2 m and says so.

**By how well lit the pixel is on the map** (`map_config`):

| Map value, % | Pixels | Mean | Mean abs. | Median abs. | 9 in 10 within | Largest |
|---|---|---|---|---|---|---|
| 0 | 80 | +0.14 | 0.14 | 0.00 | 0.00 | 11.0 |
| 0 to 10 | 80 | −0.08 | 0.52 | 0.12 | 1.02 | 6.3 |
| 10 to 25 | 80 | −0.28 | 0.58 | 0.29 | 1.21 | 5.2 |
| 25 to 50 | 80 | −0.11 | 0.53 | 0.25 | 1.23 | 3.7 |
| 50 to 70 | 80 | −0.63 | 1.50 | 0.95 | 3.88 | 8.2 |
| 70 to 100 | 80 | −2.09 | 3.24 | 1.88 | 6.47 | 28.3 |

The error grows with the illumination, and above 70 % we are 2.1 pp below the map on average. The best-lit pixels are places where the map itself changes by tens of pp from one pixel to the next. Splitting the sample by whether the map is locally smooth (the pixel is within 5 pp of the median of its 3 × 3 neighbourhood) shows it:

| Map around the pixel | Pixels | Mean | Mean abs. | Median abs. | Largest | Correlation |
|---|---|---|---|---|---|---|
| smooth | 383 | −0.24 | 0.59 | 0.18 | 16.5 | 0.9973 |
| not smooth | 97 | −1.56 | 3.04 | 1.95 | 28.3 | 0.9583 |

We did not tune anything to close this gap. Its likely source is the elevation model: `ldem_75s_60m` is the 60 m model of the PDS archive, and we do not know that it is the exact grid the map was computed from (the archive has no 60 m product cut at 85° S). Where the result hangs on a metre of height, two griddings of the same laser shots give different answers. The row `dem_20m_mean` supports this: another 60 m average of the same terrain moves individual pixels by up to 47 pp while the mean barely changes.

**The six largest differences** (percent):

| Pixel (row, column) | Map | Median of the map 3 × 3 | Ours, `map_config` | Ours, eye 2 m | Ours, 20 m averaged |
|---|---|---|---|---|---|
| 1036, 3871 | 74.6 | 49.1 | 46.3 | 47.9 | 56.6 |
| 2669, 2212 | 71.9 | 68.1 | 55.5 | 72.9 | 53.3 |
| 2724, 2350 | 74.2 | 63.7 | 61.0 | 81.3 | 64.9 |
| 2577, 2499 | 72.2 | 50.4 | 59.7 | 73.9 | 54.8 |
| 2867, 4464 | 0.0 | 0.2 | 11.0 | 11.3 | 11.2 |
| 2729, 2343 | 72.3 | 54.5 | 61.8 | 81.7 | 60.7 |

- Five of the six are bright pixels whose neighbours on the map are 4 to 25 pp darker. In the first one we agree with the neighbourhood (46 % against a median of 49 %), not with the pixel. In the other four, raising the eye by 2 m takes our value to or above the map: the result there hangs on a metre of height.
- Pixel 2867, 4464 is **not explained**. The map gives exactly 0 inside a zero patch of irregular shape; we get 11 % in every configuration, and the elevation model shows a gentle slope there with nothing that could shade it. We left it as it is.

## Test 2b. Earth visibility against the NASA map

`AVGVISIB_85S_060M_201608_EARTH.TIF` is the same product for the Earth (share of time any part of the Earth's disc is visible). Same 480 pixels, configuration of the map:

| Mean | Mean abs. | Median abs. | 9 in 10 within | Largest | Correlation |
|---|---|---|---|---|---|
| −0.06 | 0.71 | 0.10 | 1.82 | 23.6 | 0.9958 |

77 % of the pixels are within 0.5 pp, 86 % within 1 pp, 90 % within 2 pp, 97.5 % within 5 pp. The Earth test is sensitive to the parallax and to the size of the disc (about 1.9° wide), which the Sun test is not. The three largest differences are single pixels where the Earth just grazes the skyline: 9.1 % on the map against 32.6 % ours, 0 % against 20.4 %, 24.8 % against 6.4 %. The Earth stays in one small patch of the polar sky and only wanders in it with the libration, so a small difference of the skyline in that one direction changes the share a lot; we did not look for a further cause.

## Test 3. Permanently shadowed regions

`LPSR_85S_060M_201608.TIF` flags the pixels that the LOLA team found never lit. 150 flagged pixels inside 85° S were drawn at random (fixed seed); 92 of them are interior pixels (every pixel within 600 m is also flagged).

| Configuration | Never lit | Interior, never lit | Largest value |
|---|---|---|---|
| `map_config` (60 m, surface, 18.6 years) | 149 of 150 | 92 of 92 | 29.5 % |
| `product` (20 m, eye 2 m, one year) | 148 of 150 | 92 of 92 | 3.0 % |

The two exceptions are both on the edge of a shadowed patch:

- Pixel 2970, 4539 (29.5 % in the configuration of the map, 3.0 % as the site computes). The patch is only four pixels, on a plain that the map shows about 30 % lit around it (median 30.7 % of the unflagged pixels in a 9 × 9 window). The 60 m model has no hollow there: the heights in a 5 × 5 window are within 7 m of the centre. Whatever shades these four pixels on the map is not in the published model, and our code gives the pixel what its surroundings get.
- Pixel 4202, 4286 (0 % in the configuration of the map, 0.023 % as the site computes: two hours in the year). It is on the rim of a shadowed area of about 1 km² (258 pixels), on a slope of about 20 m per 60 m pixel. On the surface it stays dark; an instrument 2 m above it sees the Sun for two hours.

`test_the_two_shadow_exceptions_are_what_the_note_says` recomputes these facts from the rasters.

## The ten listed sites against the map

The site shows, for each listed point, the lit share of the year 2026-27 for an instrument at 2 m, computed from the 5 m model of the site. The NASA map at the same point is an 18.6-year mean on the surface from a 60 m model. The table leads from one to the other; all values are percent or pp:

| Site | NASA map | Ours, the way the map was computed | Difference | + eye at 2 m | + 5 m model instead of 60 m | + this year instead of 18.6 | Shown on the site | Difference to the map |
|---|---|---|---|---|---|---|---|---|
| Connecting ridge (`site01`) | 88.4 | 85.5 | −2.9 | +4.5 | −0.6 | +0.6 | 89.9 | +1.5 |
| Shackleton rim (`site04`) | 87.1 | 85.5 | −1.6 | +3.8 | −3.2 | +0.3 | 86.4 | −0.7 |
| Nobile rim 1 (`site06`) | 83.1 | 80.5 | −2.6 | +7.3 | +0.2 | +0.4 | 88.4 | +5.3 |
| Peak near Shackleton (`site07`) | 86.0 | 83.6 | −2.4 | +4.6 | −0.4 | +0.3 | 88.1 | +2.1 |
| de Gerlache rim (`site11`) | 82.7 | 82.3 | −0.4 | +2.2 | −0.5 | +0.9 | 84.9 | +2.2 |
| Leibnitz beta plateau (`site20`) | 74.7 | 68.4 | −6.3 | +11.1 | −1.8 | +1.5 | 79.2 | +4.5 |
| Malapert massif (`site23`) | 81.9 | 81.3 | −0.6 | +2.7 | −0.7 | +1.6 | 84.9 | +3.0 |
| Haworth (`haworth`) | 70.5 | 69.6 | −0.9 | +5.8 | −0.3 | +1.4 | 76.4 | +5.9 |
| Shoemaker (`shoemaker`) | 59.2 | 59.1 | −0.1 | +1.0 | 0.0 | +1.2 | 61.2 | +2.0 |
| Nobile rim 2 (`dm2`) | 53.9 | 49.8 | −4.1 | +4.1 | 0.0 | +1.6 | 55.5 | +1.6 |

(The four steps add up to the last column to 0.1 pp, the rounding of the terms.)

- The number on the site is on average 2.7 pp above the map (mean absolute 2.9 pp, largest 5.9 pp). The cause is the 2 m of height: +1.0 to +11.1 pp, on average +4.7 pp. The year adds 0.3 to 1.6 pp; the 5 m model instead of the 60 m one changes −3.2 to +0.2 pp.
- Computed the way the map was, we are below the map at every site, by 2.2 pp on average. That is larger than the −0.51 pp of the random sample for a reason that has nothing to do with these ten points being special terrain: each of them was chosen as the best-lit pixel of the map within its site model (at least 3 km from the edge of the model), and the largest value picked from a noisy map is on average higher than a recomputation of the same pixel. The band table above shows the same for all pixels above 70 % (−2.1 pp).
- On the surface, the 5 m model gives 35 to 56 % at these points (32 pp below the map on average): a 5 m model resolves rises of a metre a few pixels away, which a 60 m average does not contain. A number "on the surface" of a 5 m model describes the model's pixel, not a lander; this is the strongest reason for the 2 m convention and for the mast table on the site (at the Shackleton rim point the longest night shrinks from 150 h at 1 m to 64 h at 10 m).

A plausibility check outside the pole: at the Apollo 11 site, computed without terrain, the Sun is up 51.4 % of the year and the longest night is 353.4 h; half a synodic month is 354.4 h.

## Test 4. The browser estimate against the full computation

For a point that is not listed, the page computes by itself from a 240 m elevation model and an hourly ephemeris (`docs/BROWSER_COMPUTE.md`). This test measures what that simplification costs, so that the caption under such a point is honest.

**Reference.** The full computation for the same year and the same eye height of 2 m, at the 480 pixels of Test 2 (20 m model near the point, 80 m and 120 m farther out), and the published numbers of the ten listed sites (5 m model). Differences are estimate minus full computation.

| Quantity | Mean | Mean abs. | Median abs. | 9 in 10 within | Largest |
|---|---|---|---|---|---|
| Lit share of the year, pp | +1.15 | 2.14 | 0.41 | 5.67 | 43.0 |
| Earth visible share of the year, pp | +1.20 | 1.59 | 0.06 | 3.86 | 43.4 |
| Longest night, h | −126 | 134 | 1.7 | 110 | 5710 |
| Longest time without the Earth, h | −206 | 233 | 0.6 | 41 | 8265 |

The lit share is within 1 pp for 62 % of the points, within 2 pp for 75 %, within 5 pp for 89 %, within 10 pp for 95 % and within 20 pp for 98 %. The longest night is within 6 h for 64 % of the points, within a day for 80 %, within a week for 92 %.

**By how well lit the point is in the full computation:**

| Lit share, % | Points | Mean, pp | Mean abs., pp | Median abs., pp | 9 in 10 within, pp | Largest, pp | Typical longest night, h | Its median error, h | 9 in 10 within, h | Within a day |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 78 | +0.12 | 0.12 | 0.00 | 0.00 | 5.9 | 8760 | 0.0 | 0 | 95 % |
| up to 25 | 158 | +1.78 | 1.79 | 0.30 | 4.89 | 27.1 | 2729 | 1.4 | 812 | 81 % |
| 25 to 50 | 92 | +1.87 | 1.89 | 0.40 | 4.10 | 28.6 | 519 | 2.9 | 31 | 84 % |
| 50 to 70 | 78 | +2.82 | 3.26 | 1.02 | 11.55 | 23.7 | 384 | 5.5 | 116 | 72 % |
| above 70 | 74 | −1.75 | 4.13 | 2.51 | 6.89 | 43.0 | 220 | 13.4 | 136 | 66 % |

What goes wrong and where:

- A 240 m pixel is an average. A summit or a narrow crest is lower in it than in reality and loses light; a point just below a crest is higher than in reality and gains light. That is why the mean is positive below 70 % and negative above.
- The largest errors of the sample are next to each other on the summit ridge of the Malapert massif: 82.6 % in the full computation against 39.6 % in the estimate, 81.9 % against 42.9 %, and about a kilometre away the opposite, 32.2 % against 60.8 %.
- The large errors of the longest night (thousands of hours) are mostly dark points where the estimate finds a few sunlit hours that cut one long night in two; the mean is dominated by them, the median is under two hours.
- Against the NASA map the estimate has a mean absolute difference of 3.2 pp (median 1.3 pp, largest 39.6 pp) at the same pixels, where the full computation has 2.3 pp.

**The ten listed sites are the hardest case**, because they are crests and summits. The estimate against the published numbers (5 m model):

| Site | Lit share: published | estimate | Longest night, h: published | estimate | Earth visible: published | estimate | Rays outside the model |
|---|---|---|---|---|---|---|---|
| `site01` | 89.9 | 86.6 | 137 | 182 | 56.7 | 56.7 | 0 % |
| `site04` | 86.4 | 89.1 | 82 | 69 | 52.2 | 51.7 | 0 % |
| `site06` | 88.4 | 80.9 | 227 | 338 | 66.0 | 60.2 | 9 % |
| `site07` | 88.1 | 88.7 | 136 | 137 | 58.3 | 61.6 | 0 % |
| `site11` | 84.9 | 77.2 | 252 | 309 | 61.0 | 60.9 | 0 % |
| `site20` | 79.2 | 79.3 | 362 | 361 | 59.3 | 61.3 | 8 % |
| `site23` | 84.9 | 46.2 | 273 | 603 | 60.5 | 45.3 | 8 % |
| `haworth` | 76.4 | 77.6 | 355 | 315 | 65.2 | 67.7 | 4 % |
| `shoemaker` | 61.2 | 61.3 | 498 | 498 | 45.0 | 45.0 | 1 % |
| `dm2` | 55.5 | 55.5 | 359 | 360 | 81.8 | 82.5 | 24 % |

Median difference of the lit share 2.0 pp, mean absolute 6.2 pp, largest 38.8 pp (the summit of the Malapert massif); longest night: median 26 h, mean absolute 60 h, largest 330 h. The page therefore keeps the precomputed files for the listed sites and uses the estimate only for other points.

**One choice was made on this sample:** where the ray starts. A 240 m model cannot say what is closer than a pixel, and the first sample decides how much of the point's own pixel counts as an obstacle.

| First sample at | Mean, pp | Mean abs., pp | Median abs., pp | 9 in 10 within, pp | Largest, pp | Within 5 pp |
|---|---|---|---|---|---|---|
| 120 m | +0.14 | 2.52 | 0.45 | 7.37 | 49.4 | 85.0 % |
| 240 m (used) | +1.15 | 2.14 | 0.41 | 5.67 | 43.0 | 89.2 % |
| 480 m | +2.15 | 2.40 | 0.46 | 7.27 | 29.7 | 84.8 % |

240 m has the smallest mean absolute error and the smallest 90th percentile. It was chosen on the 480 random points, not on the listed sites.

**Where the estimate is valid.** The 240 m grid ends at 83° S. South of 85° S every ray has at least 60 km of terrain. Between 85° S and 83° S a part of the skyline falls outside the model (the last column above; 24 % at the listed point at 83.7° S) and is treated as open sky, which can only add light. North of 83° S nothing is computed.

**The port.** The JavaScript module `data/ephem/compute.mjs` is compared by Node with test vectors written by the Python reference for 13 points (`data/ephem/test_vectors.json`): 720 mask values, 24 moments and the numbers of the year per point. The largest difference is 0.00005° (the rounding of the stored values).

## Limits

- Light is geometric: no light scattered or reflected from lit slopes, the solar disc is uniformly bright, no thermal or power model behind "lit".
- The elevation models have errors of their own, metres in height, and anything narrower than a pixel (5 m at the listed sites, 20 m elsewhere near the pole) is not in them. On crests this is the main uncertainty: Test 2 shows single pixels changing by tens of pp between two models of the same terrain.
- Terrain farther than 150 km is ignored: −0.04 pp on average, 0.9 pp at most when it is counted to 400 km.
- The numbers are for an instrument 2 m above the ground, not for the ground itself.
- One year is not the 18.6-year mean: +0.45 pp on average at the sampled pixels, up to 2.7 pp.
- The listed points are the best-lit pixels of the NASA map inside each NASA 5 m site model, at least 3 km from its edge. They are not official landing coordinates.
- Percentages are shares of time samples. The browser estimate knows a sunrise to the hour; the precomputed files refine it to 30 seconds.
- The validation sample is 480 + 150 pixels inside 85° S. Outside 85° S the full computation was not compared with a map.
- One pixel of Test 2 (2867, 4464) and one of Test 3 (2970, 4539) disagree with the NASA maps for a reason we could not find in the published elevation models.

## How to reproduce

```
python -m backend.fetch_data kernels      # SPICE kernels, 46 MB
python -m backend.fetch_data rasters      # LOLA models and maps, 1.6 GB
python -m backend.fetch_data validation   # the 60 m model for Test 2, 465 MB

python -m pytest -c backend/pyproject.toml backend   # all tests; those that need the rasters are skipped without them
python -m backend.validate                # Tests 2, 2b, 3 and the sites: about 20 minutes, one process
python -m backend.validate orientation    # Test 1b
python -m backend.browser compare         # Test 4: about 8 minutes
python -m backend.validate accuracy       # data/validation.json from the tables
node data/ephem/check.mjs                 # the JavaScript port against the test vectors
```

| File | Content |
|---|---|
| `backend/tests/fixtures/horizons.json` | the saved answers of JPL Horizons (Test 1) |
| `data/validation/orientation.json` | Test 1b |
| `data/validation/test2_pixels.csv` | every sampled pixel: map values and ours in the eight configurations |
| `data/validation/test3_psr.csv` | the permanently shadowed pixels |
| `data/validation/sites.csv` | the ten sites in five configurations |
| `data/validation/summary.json` | every number of Tests 2, 2b, 3 and of the site table |
| `data/validation/browser_pixels.csv`, `browser_sites.csv`, `browser.json` | Test 4 |
| `data/validation.json` | the short version for the Accuracy sheet |

Sources: NAIF generic kernels (`naif.jpl.nasa.gov`), JPL Horizons (`ssd.jpl.nasa.gov`), LOLA gridded elevation models in the PDS Geosciences Node (`pds-geosciences.wustl.edu`, `lrolol_1xxx/data/lola_gdr/polar`), illumination maps and 5 m site models of the NASA GSFC Planetary Geodesy Data Archive (`pgda.gsfc.nasa.gov`, products `MoonIllumination` and `LOLA_5mpp`).
