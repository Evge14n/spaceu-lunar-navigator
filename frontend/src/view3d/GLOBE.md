# The globe sheet: what it does, what the model must be, what is coarse

`#/globe` is sheet 00: the whole Moon, lit by the Sun of the chosen moment. Tap anywhere (or type
coordinates) and "Open 3D view here" opens sheet 04 standing on that point, with the same scene,
the same HUD, the same slider and Play, the same shadows as one of the ten prepared sites.

Files, all under `src/view3d/`:

| File | What it is |
|---|---|
| `GlobePage.tsx` | the sheet: pin, coordinates, site markers, time slider, orientation check |
| `globe/GlobeScene.tsx` | the three.js scene: model or sphere, Sun light, markers, tap to pick |
| `globe/frame.ts` | lat/lon ↔ scene directions, the inverse transform a tap needs, the constants |
| `globe/heights.ts` | where the height of the ground comes from, in four tiers |
| `globe/modelHeights.ts` + `globe/modelGrid.ts` | relief read out of the model's own vertices, kept for sheet 04 |
| `globe/tile.ts` | the local terrain tile for any point (row 0 north, curvature included) |
| `globe/mask.ts` | the 720-direction horizon mask for any point |
| `globe/route.ts` | which pipeline a site id goes through |
| `globe/useCustomSite.ts` + `globe/custom.worker.ts` | the above, off the main thread, cached |

Pure modules are unit tested: `frame.test.ts`, `tile.test.ts`, `route.test.ts`, and
`published.test.ts`, which checks the mask and the tile against the files the backend published.

## The model file

Put it at **`frontend/public/moon/moon.glb`** (`public/models/moon.glb` also works). It is copied
to the site as is and is loaded only on `#/globe`, lazily, inside the three.js chunk.

What the page does with it, and what it therefore assumes:

- **Scale.** The bounding sphere of the loaded scene is measured and the model is scaled so that
  its radius is 1 scene unit = **1737.4 km**. Metres, kilometres or radii in the file all work; a
  model that is not a whole globe (a crop, a flattened tile) does not.
- **Centre.** The bounding sphere centre is moved to the origin, so an off-centre export is fine.
- **Orientation.** The scene frame is the one of `src/api/sun.ts`: **x = 0° N 90° E, y = north
  pole, z = 0° N 0° E** (the near side faces a camera on +z). `GLOBE_MODEL_FRAME` in
  `globe/frame.ts` says which frame the file itself is in — `'scene'` (already y-up, the default)
  or `'me'` (the MOON_ME axes: x to 0° E, y to 90° E, z to the north pole) — and
  `GLOBE_MODEL_SPIN_DEG` turns it about the polar axis if its longitudes are offset. The data is
  never rotated, only the model.
- **Relief.** Whatever displacement the file carries is what you see; the page does not stretch it.
  `GLOBE_RELIEF_EXAGGERATION` only affects what the page draws itself (pins, markers). Real lunar
  relief is 0.6 % of the radius, so a model with true heights looks like a smooth ball — that is
  correct, not a bug.
- **Compression.** meshopt and Draco are both decoded out of the box: three ships the Draco
  decoder and the build emits it next to the site (about 840 kB that is fetched only if a model
  actually needs it). meshopt is still the lighter choice.
- **If the file is missing or unreadable**: a plain sphere stands in (textured from
  `public/moon/moon.webp`, `moon.jpg`, or `moon-1024.webp` on phones, if any of them is there),
  with a small notice. Nothing else on the sheet changes: the Sun, the picking and the coordinates
  all work on the stand-in.

### Checking the orientation

The sheet has an orientation control: **Show the markers** puts a coloured dot at three known
places, and the two groups of buttons try the axes and the spin without a rebuild (the choice is
remembered in `localStorage`, in a `try`/`catch`).

| Dot | Place | Must land on |
|---|---|---|
| green | Shackleton rim, −89.68643, 197.0629 | the rim of Shackleton, at the south pole |
| pink | 0° N 0° E | centre of the near side (Sinus Medii), facing the camera |
| yellow | Mare Crisium, about 17° N 59° E | the near side, towards +x |

When all three are right, a tap gives the right coordinates. Write the working combination into
`GLOBE_MODEL_FRAME` and `GLOBE_MODEL_SPIN_DEG` so everyone gets it without touching the buttons.

## Where the heights of a custom point come from

The Sun and the Earth are exact for any point on the Moon: they come from
`data/ephem/year.bin` (hourly MOON_ME vectors, checked against JPL Horizons). The **ground** is
the part that depends on what is published, and the page always says which of three tiers it used:

| Tier | When | What you get | How the sheet labels it |
|---|---|---|---|
| `lola240` | latitude ≤ −83° (inside `data/dem240.bin`) | the real LOLA model, 240 m pixels, 10 × 10 km tile, full 150 km horizon mask | "LOLA 240 m terrain" |
| `global` | a whole-Moon grid is published at `public/moon/height.json` | real relief anywhere, kilometres per pixel, wider tile | "Coarse terrain from the global model" + a notice |
| `model` | the globe sheet was open and `moon.glb` turned out to be a displaced mesh | the model's own relief, about one sample per several kilometres | "Coarse terrain from the global model" + a notice naming the model |
| `sphere` | none of the above | smooth sphere of 1737.4 km; the skyline is the geometric horizon | "No elevation model for this point" + a notice |

It is never called LOLA 20 m data, which is what the ten prepared sites have.

About the `model` tier: when the globe sheet is open, every vertex of the loaded GLB is read into
an equirectangular grid (`modelHeights.ts`) — latitude, longitude and metres above the sphere —
and kept for the rest of the session, so sheet 04 can use it without loading the GLB again. Two
things to know. A GLB that is a sphere with a texture carries no heights: all its vertices sit at
the same radius, the spread comes out below `MIN_RELIEF_M` (300 m) and the grid is dropped. And
even a displaced mesh of a few hundred thousand vertices is several kilometres per sample, so it
shows massifs and crater walls, never a ridge you could land next to. Opening
`#/horizon?site=custom:…` from a shared link without passing through the globe sheet falls back to
the next tier, because nothing has read the model yet.

### The optional whole-Moon height grid

Drop two files into `frontend/public/moon/` and every point on the Moon gets real (coarse) relief:

```json
// height.json
{ "file": "height.bin", "width": 2048, "height": 1024, "dtype": "int16",
  "scale_m": 1, "offset_m": 0, "north_lat": 90, "south_lat": -90, "west_lon": 0,
  "source": "NASA LOLA LDEM, 2048 x 1024, about 5.3 km per pixel" }
```

- `dtype: "int16"` — a raw little-endian `int16` array, row-major, row 0 at `north_lat`, column 0
  at `west_lon`, heights in metres above the 1737.4 km sphere after `scale_m` and `offset_m`.
  2048 × 1024 is 4 MB.
- `dtype: "rg8"` — any lossless image the browser can decode (PNG, WebP) with the height packed as
  `R * 256 + G`; smaller, decoded with `createImageBitmap` + `OffscreenCanvas`.
- Longitude wraps, latitude is clamped, sampling is bilinear.

A 2048 × 1024 grid is 5.3 km per pixel at the equator: good for crater walls and massifs, blind to
anything smaller. The tile widens with the pixel (`tileSizeM`), so you see relief instead of two
flat pixels, and the page says how many metres a sample is.

## Weight budget

- Everything the globe adds: **8 MB at most**, the less the better. Pages serves it without a CDN.
- Texture 2k–4k (WebP or KTX2). Add `moon-1024.webp` as well: phones load it first.
- Geometry decimated and compressed with meshopt:
  `npx @gltf-transform/cli optimize in.glb out.glb --compress meshopt --texture-compress webp`.
- A global height grid, if you ship one, counts against the same 8 MB (int16 2048 × 1024 = 4 MB).

## Lazy loading and phones

- `GlobePage` is a lazy route in `hiddenRoutes`; the map sheet imports nothing from it, so the
  first screen is unchanged. three.js stays in the chunk it already shared with sheet 04.
- The GLB is fetched only after `#/globe` is open, and only if it exists (one `HEAD` first).
- Under 700 px: fewer sphere segments (96 × 48), device pixel ratio capped at 1.5, a 97 × 97 tile
  instead of 129 × 129, and the shadow grid the 3D sheet already drops to 128.

## The ten sites

`data/sites.json` (already loaded by `useSites()`), drawn as blue dots, the selected one amber.
Tapping a dot selects that prepared site, so the 3D view opens with its full-quality precomputed
data instead of a custom point; so does picking a point within 5 km of one. All ten are within
85 km of the pole and overlap at intro zoom — the **South pole** button turns the globe to them.

## Sources to cite on the page

LRO LOLA / LROC data are NASA products, free to use; name the exact product the model and any
height grid were made from (for example `LDEM_64` or the LROC WAC mosaic) in the caption, as the
other sheets do in their footers.
