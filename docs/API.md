# API contract

All responses are JSON. Time is UTC (`2026-11-14T12:00:00Z`), angles are degrees, azimuth is from north clockwise. `site` is an id from the list (`site01`) or custom coordinates `custom:-89.5,0` (latitude, east longitude).

The same shapes are stored as static files in `data/`, so the frontend can work with no server:

| Live endpoint | Static file |
|---|---|
| `GET /api/sites` | `data/sites.json` |
| `GET /api/timeline?site=..&start=..&end=..&step=60&height_m=2` | `data/timeline/<site>.json` (2026-11-14 .. 2027-11-14, 1 hour step, 8761 samples) |
| `GET /api/summary?site=..&start=..&end=..&height_m=2` | computed in the browser from the timeline, or `data/summary/<site>.json` (the whole year) and `data/summary/<site>_30d.json` (first 30 days) |
| `GET /api/compare?sites=a,b,c&start=..&end=..` | array of summaries: `data/summary/compare_1y.json`, `data/summary/compare_30d.json` |
| `GET /api/horizon?site=..&height_m=2` | `data/horizon/<site>.json` |
| `GET /api/terrain?site=..&size_km=10` | `data/terrain/<site>.json` + `.bin` |
| `GET /api/sky?site=..&time=..` | derived from the timeline |
| `GET /api/health` | - |
| - | `data/illumination.json` + `data/illumination.png` (map layer) |

Mock files with the same shapes are in `data/mock/`. Numbers for the Sun and the Earth in the mocks are real (JPL Horizons, smooth sphere, point 89.5 S, 0 E).

## sites

```json
[{"id": "site04", "name": "Shackleton rim", "lat": -89.68643, "lon": 197.0629, "elevation_m": 1729.2,
  "source": "LOLA 5 m site model (PGDA, Barker et al. 2021)", "has_5m": true,
  "pgda_model": "Site04", "x_m": -2790.0, "y_m": -9090.0,
  "point_rule": "best-lit 60 m pixel of AVGVISIB_85S_060M_201608.TIF inside the 5 m tile",
  "nasa_avg_illumination_percent": 87.1,
  "tile_center": {"lat": -89.76681, "lon": 188.1301}, "tile_size_km": 16.0}]
```

Coordinates are never typed by hand. Each site is one of the NASA 5 m site models; the point inside the model is chosen by a rule (`point_rule`): the best-lit pixel of the NASA average illumination map inside the 5 m tile, at least 3 km from its edge. The geometric centre of the tile is kept as `tile_center`; it is not used as the site because the tiles are centred on regions, not on landing points (the centre of `Site04` is on the inner wall of Shackleton). `x_m`, `y_m` are the polar stereographic coordinates of the point (see `illumination.json`), `elevation_m` is the height of the ground above the 1737.4 km sphere, `nasa_avg_illumination_percent` is the value of the NASA map at the point (18.6-year average, surface level).

## timeline

```json
{
  "site": {"id": "site04", "lat": -89.68643, "lon": 197.0629, "elevation_m": 1729.2, "terrain": true},
  "height_m": 2.0,
  "times": ["2026-11-14T00:00:00Z", "2026-11-14T01:00:00Z"],
  "sun":   {"az": [126.627, 120.534], "el": [1.258, 1.303], "horizon_el": [-0.087, -0.087], "visible_fraction": [1.0, 1.0]},
  "earth": {"az": [358.773, 358.078], "el": [-4.149, -3.622], "horizon_el": [-0.087, -0.087], "visible": [false, false],
            "visible_fraction": [0.0, 0.0], "distance_km": [405675, 405382]},
  "source": "NAIF SPICE ...; horizon from LOLA elevation models ..."
}
```

`az`, `el` are for the centre of the disc as seen from `height_m` above the ground at the site. `horizon_el` is the terrain elevation angle in the direction of the body at that moment. `visible_fraction` is the share of the disc area above the terrain (0..1, the horizon is followed along the width of the disc); a sliver never rounds down to 0, so `visible_fraction > 0` means "any part of the disc is visible". `earth.visible` is the same test for the Earth. `terrain: false` means that no elevation data was available and the horizon is the one of a smooth sphere (`-0.087` degrees at 2 m).

## summary

```json
{
  "site": {"id": "site04", "name": "Shackleton rim"},
  "period": {"start": "2026-11-14T00:00:00Z", "end": "2027-11-14T00:00:00Z"},
  "height_m": 2.0,
  "sun":   {"lit_percent": 86.4, "longest_dark_h": 81.5, "longest_lit_h": 1907.5, "max_el": 1.835,
            "mean_visible_fraction": 0.822, "next_sunset": "2027-01-31T04:25:05Z", "hours_to_sunset": 1876.4,
            "windows": [{"start": "2026-11-14T00:00:00Z", "end": "2027-01-31T04:25:05Z"}]},
  "earth": {"visible_percent": 52.2, "longest_visible_h": 342.8, "longest_hidden_h": 323.1,
            "next_earthset": "2026-12-01T03:42:53Z", "hours_to_earthset": 411.7,
            "windows": [{"start": "2026-11-16T20:52:44Z", "end": "2026-12-01T03:42:53Z"}]}
}
```

`lit_percent` and `visible_percent` are the share of the samples of the period in which any part of the disc is visible, so counting the timeline in the browser gives the same number. The moments of rise and set (`windows`, `next_sunset`, `next_earthset`, the longest intervals) are refined between samples to 30 seconds. `next_*` and `hours_to_*` are counted from the start of the period and are `null` when the body does not set (or is not up) within it. An interval cut by the end of the period is counted up to the end.

## horizon

```json
{"site": "site04", "height_m": 2.0, "step_deg": 0.5, "elevation_deg": [0.41, 0.44, "... 720 values, index 0 = north, clockwise"]}
```

## terrain

```json
{"site": "site04", "n": 512, "size_m": 10000.0, "step_m": 19.569, "center": {"lat": -89.68643, "lon": 197.0629},
 "center_elevation_m": 1729.2, "min_h": -3700.6, "max_h": 43.8, "file": "terrain/site04.bin"}
```

`.bin`: n x n float32, little endian, metres in the local frame (x east, y up, z south), row 0 is the north edge, column 0 is the west edge. Heights are relative to the ground at the site (the centre is 0) and include the curvature of the Moon (7 m down at 5 km).

## sky

```json
{"time": "2026-11-14T12:00:00Z",
 "sun":   {"dir": [0.861, 0.0227, 0.508], "az": 120.534, "el": 1.303, "horizon_el": -0.087,
           "angular_radius_deg": 0.266, "visible_fraction": 1.0},
 "earth": {"dir": [-0.0335, -0.0632, -0.997], "az": 358.078, "el": -3.622, "horizon_el": -0.087,
           "angular_radius_deg": 0.90, "visible_fraction": 0.0, "visible": false, "distance_km": 405382}}
```

`dir` is the unit vector to the body in the local frame of the terrain tile (x east, y up, z south).

## illumination (map layer)

```json
{"file": "illumination.png", "x_km": [-212.64, 212.64], "y_km": [-212.64, 212.64],
 "width": 1772, "height": 1772, "pixel_m": 240.0, "lat_limit": -83.0,
 "projection": "south polar stereographic ...", "value": "... grey = 255*sqrt(value)",
 "legend": [{"percent": 50, "grey": 180}], "source": "NASA LOLA average illumination map ..."}
```

The PNG is an 8-bit grey image of the NASA average illumination map (share of time any part of the solar disc is visible). South polar stereographic projection of the 1737.4 km sphere: `rho = 2R*tan((90+lat)/2)`, `x = rho*sin(lon)`, `y = rho*cos(lon)`; image row 0 is `y` max, column 0 is `x` min. A site is drawn at `x_m`, `y_m` from `sites.json`.
