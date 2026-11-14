# API contract

All responses are JSON. Time is UTC (`2026-11-14T12:00:00Z`), angles are degrees, azimuth is from north clockwise. `site` is an id from the list (`site01`) or custom coordinates `custom:-89.5,0` (latitude, east longitude).

The same shapes are stored as static files in `data/`, so the frontend can work with no server:

| Live endpoint | Static file |
|---|---|
| `GET /api/sites` | `data/sites.json` |
| `GET /api/timeline?site=..&start=..&end=..&step=60&height_m=2` | `data/timeline/<site>.json` (one year, 1 hour step) |
| `GET /api/summary?site=..&start=..&end=..&height_m=2` | computed in the browser from the timeline, or `data/summary/<site>.json` for preset periods |
| `GET /api/compare?sites=a,b,c&start=..&end=..` | array of summaries |
| `GET /api/horizon?site=..&height_m=2` | `data/horizon/<site>.json` |
| `GET /api/terrain?site=..&size_km=10` | `data/terrain/<site>.json` + `.bin` |
| `GET /api/sky?site=..&time=..` | derived from the timeline |
| `GET /api/health` | - |

Mock files with the final shapes are in `data/mock/`. Numbers for the Sun and the Earth in the mocks are real (JPL Horizons, smooth sphere, point 89.5 S, 0 E).

## sites

```json
[{"id": "site04", "name": "Shackleton rim", "lat": null, "lon": null, "elevation_m": null,
  "source": "LOLA 5 m site model (PGDA, Barker et al. 2021)", "has_5m": true}]
```

Coordinates are taken from the centre of each PGDA GeoTIFF, never typed by hand. `null` here marks values that the backend fills in.

## timeline

```json
{
  "site": {"id": "custom", "lat": -89.5, "lon": 0.0, "terrain": false},
  "height_m": 2,
  "times": ["2026-11-14T00:00:00Z", "2026-11-14T12:00:00Z"],
  "sun":   {"az": [126.627, 120.534], "el": [1.258, 1.303], "horizon_el": [-0.087, -0.087], "visible_fraction": [1.0, 1.0]},
  "earth": {"az": [358.773, 358.078], "el": [-4.149, -3.622], "horizon_el": [-0.087, -0.087], "visible": [false, false], "distance_km": [405675, 405382]},
  "source": "NAIF SPICE de440s; validated against JPL Horizons"
}
```

`horizon_el` is the terrain elevation angle in the direction of the body at that moment. The body is visible when its upper limb is above `horizon_el`.

## summary

```json
{
  "site": {"id": "site04", "name": "Shackleton rim"},
  "period": {"start": "2026-12-01T00:00:00Z", "end": "2026-12-31T00:00:00Z"},
  "sun":   {"lit_percent": 0, "longest_dark_h": 0, "longest_lit_h": 0, "max_el": 0, "next_sunset": null, "hours_to_sunset": null},
  "earth": {"visible_percent": 0, "next_earthset": null, "hours_to_earthset": null, "windows": [{"start": "..", "end": ".."}]}
}
```

## horizon

```json
{"site": "site04", "height_m": 2, "step_deg": 0.5, "elevation_deg": [0.41, 0.44, "... 720 values, index 0 = north, clockwise"]}
```

## terrain

```json
{"site": "site04", "n": 512, "size_m": 10000, "step_m": 19.57, "center": {"lat": null, "lon": null},
 "min_h": null, "max_h": null, "file": "terrain/site04.bin"}
```

`.bin`: n x n float32, little endian, metres in the local frame (x east, y up, z south), row 0 is the north edge.

## sky

```json
{"time": "2026-11-14T12:00:00Z",
 "sun":   {"dir": [0.861, 0.0227, 0.508], "angular_radius_deg": 0.266, "visible_fraction": 1.0},
 "earth": {"dir": [-0.0335, -0.0632, -0.997], "angular_radius_deg": 0.90, "visible": false}}
```
