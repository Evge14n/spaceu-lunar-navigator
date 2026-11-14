# Intro globe: what is ready and how to plug the model in

For Anastasiia Sh. The globe itself (the LRO Moon model, the scene, the camera) is yours; this note only lists the place and the data prepared for it.

## The place

- Route `#/globe` -> `src/view3d/GlobePage.tsx`. It is registered in `hiddenRoutes` (`src/routes.ts`): it opens by link but is not in the navigation and not the first screen.
- The page already has the sheet frame (stamp, title, the dark plate `.stage` like on 04 Horizon) and a status line with the sub-solar point. Replace the `<div className="stage-loading">` inside `.stage` with your `<Canvas>`.
- When the model is ready and within the budget below, add it to `routes` (number `00`, or as a block on the map sheet). Do not make it the default route before that: the map is the landing sheet and its first load must not get heavier.

## Direction to the Sun at any hour

```ts
import { meToScene, toLatLon, useSunDirection } from '../api'

const sunMe = useSunDirection(timeMs)   // [x, y, z] unit vector in MOON_ME, or null while loading
const sunScene = sunMe && meToScene(sunMe)
// <directionalLight position={sunScene.map((v) => v * 10)} />   the Sun is at infinity: only the direction matters
```

- Source: `data/ephem/year.json` + `data/ephem/year.bin` (210 kB, loaded once). Format in `docs/BROWSER_COMPUTE.md`: `n` = 8761 records of 6 little-endian `float32`, one per hour from `start` = 2026-11-14T00:00Z; values 0-2 are the unit vector from the Moon's centre to the Sun, 3-5 the Earth's position in km. Apparent positions (light time and aberration, as the rest of the site), checked against JPL Horizons (Accuracy sheet).
- `useSunDirection` interpolates linearly between the two hourly records and normalises; times outside the year are clamped to its ends. The pure function behind it is `sunDirectionAt(table, t)` in `src/api/sun.ts`.
- Test: `src/api/sun.test.ts` converts this direction to azimuth and elevation at all 10 sites, 50 moments each, and matches the published timelines within 0.01 degrees.
- The global time is `t` from `useAppState()` (the same time slider as the other sheets), so the globe can share the moment with Timeline and Horizon.

## Axes: MOON_ME to your scene

MOON_ME (mean Earth / polar axes): origin at the centre, `x` towards 0 N 0 E (the mean direction to the Earth, centre of the near side), `z` towards the north pole, `y` towards 0 N 90 E.

For a three.js scene with `y` up: `meToScene([x, y, z]) = [y, z, x]`, i.e.

| scene | MOON_ME | on the Moon |
|---|---|---|
| +x | +y | 0 N 90 E (east limb seen from Earth) |
| +y | +z | north pole (south pole is -y) |
| +z | +x | 0 N 0 E, centre of the near side, faces a camera on +z |

It is a cyclic swap, so the frame stays right-handed (no mirror). Test: same file.

**Check the orientation of the GLB itself** (models from LRO data come in different conventions): put a small marker at `meToScene(fromLatLon(lat, lon))` for

- site 02 Shackleton rim, -89.68643, 197.0629: must sit on the rim of Shackleton crater at the south pole;
- 0 N 0 E: centre of the near side (Sinus Medii);
- Mare Crisium, about 17 N 59 E: on the +x side of the near side.

If one of them is off, rotate the model (not the data) until all three match.

## The ten sites

`data/sites.json` (already loaded by `useSites()`): `id`, `name`, `lat` (deg, negative = south), `lon` (deg east, 0..360), `elevation_m` (above the 1737.4 km sphere), plus `x_m`, `y_m` in the south polar stereographic map. The number shown everywhere (01-10) is the order in the file (`siteNo` in `src/format.ts`). Position on a globe of radius `r`: `meToScene(fromLatLon(lat, lon))` times `r * (1 + elevation_m / 1_737_400)`. All ten are within 85 km of the pole, so at globe scale they form one cluster: a callout or a zoom to the pole reads better than ten markers.

## Weight budget (the model is for the web)

- The whole globe download at most **8 MB**, the less the better (Pages serves it without a CDN cache warm-up; phones on mobile data).
- Texture 2k-4k (2048 x 1024 is plenty at intro size; 4096 x 2048 only if you zoom in), WebP or KTX2.
- Geometry decimated (a sphere with a height map, or a few hundred thousand triangles at most), compressed with **meshopt** (small decoder: `three/examples/jsm/libs/meshopt_decoder.module.js`, set with `gltfLoader.setMeshoptDecoder`) or **Draco** (needs `DRACOLoader` and its decoder files next to the site). One way: `npx @gltf-transform/cli optimize in.glb out.glb --compress meshopt --texture-compress webp` (check the flags with `--help` for your version).
- Put the file in `frontend/public/models/` (it is copied to the site as is), not in `data/`.

## Lazy loading, so the first screen does not get heavier

- `GlobePage` is a lazy route; nothing on the map sheet should import from it.
- Load the GLB only on `#/globe` (`useLoader(GLTFLoader, url)` inside `<Suspense>`), and keep three.js in its own chunk as `Scene.tsx` does (`lazy(() => import(...))`).
- Before the globe becomes a first screen: model compressed within the budget, Lighthouse of the map sheet not worse than now (mobile 95-99), and a still picture (or the stage text) while the model loads.

## Sources to cite on the page

LRO LOLA / LROC data are NASA products, free to use; name the exact product the model was made from (for example a LOLA DEM or the LROC WAC mosaic) in the caption, as the other sheets do in their footers.
