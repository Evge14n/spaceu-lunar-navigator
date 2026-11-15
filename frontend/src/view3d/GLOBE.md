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
| `globe/modelSource.ts` | one cached load of the GLB, shared by both sheets |
| `globe/localGround.ts` | the model's own triangles around a point, in the local frame |
| `globe/StandOnGlobe.tsx` | sheet 04 standing on the globe: ground, sky, camera, HUD |
| `globe/calibrate.ts` | measuring how much the model exaggerates its relief, and undoing it |
| `globe/fit.ts` | which mesh is the globe, how to scale it, where to put the camera |
| `globe/useCustomSite.ts` + `globe/custom.worker.ts` | the above, off the main thread, cached |

Pure modules are unit tested: `frame.test.ts`, `tile.test.ts`, `route.test.ts`, and
`published.test.ts`, which checks the mask and the tile against the files the backend published.

## The model file

Put it at **`frontend/public/moon/moon.glb`** (`public/models/moon.glb` also works). It is copied
to the site as is and is loaded only on `#/globe`, lazily, inside the three.js chunk.

What the page does with it, and what it therefore assumes (all of it in `globe/fit.ts`):

- **Scale.** Every *mesh* is measured on its own, from its vertices. Meshes more than 3× the
  median radius are dropped (a sky dome, a backdrop plane), and so are meshes with under 2 % of
  the triangles of the most detailed one while being larger than the median (a coarse huge shell).
  What is left is normalised together — a globe cut into tiles still comes out whole — so that its
  radius is 1 scene unit = **1737.4 km**. Metres, kilometres or radii in the file all work;
  cameras, lights and empties are ignored. A model that is not a whole globe (a crop, a flat tile)
  does not work.
- **Centre.** The centre of what was kept is moved to the origin, so an off-centre export is fine.
- **Camera.** The view distance is computed from the fitted radius and the shape of the window
  (on a phone held upright the width is the tight side), and the near and far planes follow from
  it, so the globe always arrives fully in frame.
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

### When nothing shows up

Add `?debug` to the address **before the `#`** (the sheets rewrite what comes after it), for
example `…/#/globe` → `…/?debug#/globe`, and the console gets one `[globe]` report: the node and
mesh list with each mesh's triangle count, bounding box, bounding sphere and whether it was dropped,
then the radius and the scale that were applied, then the fitted camera distance and planes.

Two failures look identical on screen (a black stage) and are told apart there:

- **the file is empty.** A Blender export with nothing selected is about 130 bytes and contains a
  scene and no nodes at all. The page now detects this, falls back to the sphere and says so.
- **the model is inside something huge.** Handled by the mesh rules above; the report shows which
  meshes were dropped and why.

Two more safety nets: every material is drawn on both faces, so a globe with flipped normals is
still visible, and a weak ambient light keeps the night side dark rather than pure black.

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

## Standing on the globe (sheet 04, a point of your own)

A point of your own is no longer drawn on a little tile of its own: sheet 04 puts you on the model
itself. `localGround.ts` takes the model's triangles within 45° of the point (30° on phones — all
a camera from 2 m to a few hundred kilometres up can see), turns them into the local frame
(x east, y up, z south) and puts the ground under your feet at the origin.

- **Floating origin.** The transform runs in float64 here, once per point, and only the result is
  written as float32. Keeping the globe at its true place and translating in the shader would
  cancel 1 737 400 against 1 737 400 in float32: a quarter of a metre of wobble, which at eye
  level is several degrees. The camera never leaves the origin; the globe moves under it.
- **Depth.** One frame holds ground 2 m away and a limb 1 300 km away, so this canvas asks for a
  **logarithmic depth buffer**. Per-frame near and far cannot cover eight orders of magnitude at
  once, and both ends are needed in the same picture. The prepared-site scene keeps its ordinary
  depth buffer.
- **Where the camera's feet are.** The ray from the Moon's centre straight up is intersected with
  the triangles, so the eye sits exactly 2 m over the surface you see, not over a resampled grid.
- **What is not there.** Terrain does not cast shadows on terrain in this scene (the lit side is
  the Lambert term and the curvature, which is correct for day and night but not for a mountain's
  shadow). Nothing is added to the ground to make it look finer than the model is.

## What the model really gives, measured

Measured on the NASA SVS 14959 source (`Moon_NASA_LRO_8k_Topo_Small.glb`, 81.5 MB, the file the
8 MB build is made from):

| | |
|---|---|
| vertices / triangles | 2 021 340 / 1 015 808 |
| mean spacing on the ground | **4.33 km** (`sqrt(4 pi R^2 / N)`, printed in the caption for whatever file is loaded) |
| texture | 8k, about 1.3 km per texel |
| relief in the file | −30.7 km to +31.0 km, p1 to p99 ±17 km |
| LOLA, for comparison | −9.1 km to +10.8 km |

So the model is **about three times vertically exaggerated** — it is made to be looked at. Left
alone it would make every skyline three times too steep and every lit percentage wrong.

### Undoing the exaggeration

`calibrate.ts` samples the model and `data/dem240.bin` (real LOLA, 240 m, already in the project)
at the same places over the south polar cap and compares them:

- if the two shapes agree (correlation ≥ 0.5) it fits a least squares line, scale and offset;
- if they do not — and at 4.33 km against 240 m they usually do not — it matches the **amplitude**
  instead: `scale = sd(LOLA) / sd(model)`, offset 0, because the model's own median radius already
  stands for the 1737.4 km sphere. Fitting a line through weakly correlated pairs would drag the
  slope towards zero; the spread of a field is a real measurement either way.

Measured on the SVS source: **scale 0.3272** (correlation 0.17, so the amplitude branch), which
agrees with the ±31 km / ±10 km reading of the raw radii. The factor is measured once, kept in
`localStorage`, and applied to the drawn ground *and* to the horizon mask, so the picture and the
HUD cannot drift apart.

### How well the picture and the HUD agree

The skyline you see and the mask the HUD uses come from the same heights by two different roads
(triangles vs a resampled grid). Measured on the SVS model, three azimuths per point, after
calibration: **0.3° at the equator, 1.2° at mid latitudes**. `localGround.test.ts` holds a
synthetic model to 0.3°.

Right at the pole an equirectangular grid degenerates (its cells converge) and the two roads can
differ by degrees — which does not arise in the app, because south of 83° S a point of your own
goes through the LOLA 240 m path (`route.ts`), tile and all.

### The orientation is still yours to confirm

I tried to measure the model's orientation the same way — 288 candidate orientations (six polar
axes × 24 spins × mirrored or not), each scored against LOLA over the polar cap. The best scored
only 0.38, which is not enough to trust. At 4.33 km the model simply does not carry the polar
relief that LOLA has, so this test cannot settle it. **Use the three markers above**: they are
the way to know that a tap on the globe gives the right coordinates.
