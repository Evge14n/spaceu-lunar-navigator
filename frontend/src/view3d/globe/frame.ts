// The globe's frame: latitude / east longitude <-> directions in the three.js scene, and the
// inverse of that transform, which is what a click on the globe needs (src/view3d/GLOBE.md).
//
// Conventions (docs/ARCHITECTURE.md): east longitude positive, south latitude negative, angles in
// degrees. Scene axes of the globe sheet (api/sun.ts, meToScene): x = 0 N 90 E, y = north pole,
// z = 0 N 0 E, so the near side faces a camera on +z. A cyclic swap of MOON_ME, right-handed,
// no mirror. Pure functions only: no three.js, no DOM, so all of it is unit tested (frame.test.ts).

import { fromLatLon, meToScene, toLatLon, type Vec3 } from '../../api'

/** Lunar radius used everywhere in this project (docs/ARCHITECTURE.md). */
export const MOON_RADIUS_KM = 1737.4
export const MOON_RADIUS_M = MOON_RADIUS_KM * 1000

/**
 * The globe is drawn as a unit sphere: scene units are lunar radii. Keeping the numbers near 1
 * keeps the depth buffer honest on phones, where a 1.7e6 metre sphere with a 2 m pin does not fit.
 */
export const GLOBE_RADIUS = 1
export const KM_PER_UNIT = MOON_RADIUS_KM / GLOBE_RADIUS

/**
 * How much the relief of the model is stretched. The GLB carries its own displacement, so this is
 * only applied to what we draw ourselves (the fallback sphere and the pins): 1 = true shape.
 * A real lunar relief of 10 km is 0.6 % of the radius, invisible at intro size; 20 reads well.
 */
export const GLOBE_RELIEF_EXAGGERATION = 1

/**
 * Which axes the GLB itself was authored in. Models made from LRO products come both ways.
 *  'scene' - already y up, 0 E towards +z (what three.js exporters of this project produce);
 *  'me'    - the MOON_ME axes as they are: x to 0 E, y to 90 E, z to the north pole.
 * Verify with the three markers of GLOBE.md before changing it, and rotate the model, not the data.
 * The globe sheet has a small orientation control that tries the options without a rebuild.
 */
export type ModelFrame = 'scene' | 'me'
export const GLOBE_MODEL_FRAME: ModelFrame = 'scene'
/** Extra turn of the model about the polar axis, degrees, if its longitudes are offset. */
export const GLOBE_MODEL_SPIN_DEG = 0

/** Row-major 3 x 3 matrix. */
export type Mat3 = [number, number, number, number, number, number, number, number, number]

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

export function applyMat3(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ]
}

export function transposeMat3(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]
}

/**
 * Rotation applied to the loaded model so that its surface lands in the scene frame above.
 * Orthonormal, determinant +1, so its inverse is its transpose.
 */
export function modelMatrix(frame: ModelFrame = GLOBE_MODEL_FRAME, spinDeg = GLOBE_MODEL_SPIN_DEG): Mat3 {
  // columns = where the model's own x, y, z axes end up in the scene
  const base: Mat3 =
    frame === 'me'
      ? // model x (0 E) -> scene z, model y (90 E) -> scene x, model z (north) -> scene y
        [0, 1, 0, 0, 0, 1, 1, 0, 0]
      : IDENTITY
  if (!spinDeg) return base
  const a = (spinDeg * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  const spin: Mat3 = [c, 0, s, 0, 1, 0, -s, 0, c] // about the scene y axis (the polar axis)
  // spin * base
  const out = new Array(9).fill(0) as number[]
  for (let r = 0; r < 3; r++)
    for (let c2 = 0; c2 < 3; c2++) out[r * 3 + c2] = spin[r * 3] * base[c2] + spin[r * 3 + 1] * base[3 + c2] + spin[r * 3 + 2] * base[6 + c2]
  return out as Mat3
}

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

/** Scene direction (unit) of a MOON_ME direction. */
export const sceneFromMe = meToScene

/** MOON_ME direction of a scene direction: the inverse of meToScene ([x, y, z] -> [z, x, y]). */
export function meFromScene(v: Vec3): Vec3 {
  return [v[2], v[0], v[1]]
}

/** Unit direction in the scene of a point on the Moon. */
export function dirFromLatLon(latDeg: number, lonDeg: number): Vec3 {
  return sceneFromMe(fromLatLon(latDeg, lonDeg))
}

/** Latitude and east longitude (0..360) of a scene direction; the length is ignored. */
export function latLonFromDir(v: Vec3): [number, number] {
  return toLatLon(meFromScene(norm(v)))
}

/**
 * Point on the globe in scene units. `elevationM` (metres above the 1737.4 km sphere) is drawn
 * with GLOBE_RELIEF_EXAGGERATION; `liftUnits` pushes pins clear of the surface.
 */
export function pointFromLatLon(latDeg: number, lonDeg: number, elevationM = 0, liftUnits = 0): Vec3 {
  const r = GLOBE_RADIUS * (1 + (elevationM * GLOBE_RELIEF_EXAGGERATION) / MOON_RADIUS_M) + liftUnits
  const d = dirFromLatLon(latDeg, lonDeg)
  return [d[0] * r, d[1] * r, d[2] * r]
}

/**
 * The inverse of the globe's transform: a point hit by a ray (scene units, any radius) back to
 * latitude and east longitude. `centre` is the globe's world position, [0, 0, 0] on this sheet.
 */
export function latLonFromPoint(p: Vec3, centre: Vec3 = [0, 0, 0]): [number, number] {
  return latLonFromDir([p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]])
}

/** East longitude written the way the rest of the project does: 0..360. */
export function normalizeLon(lonDeg: number): number {
  return ((lonDeg % 360) + 360) % 360
}

/** Round as `customId` does (4 decimals, about 3 m), so the id and the pin always agree. */
export function roundCoord(v: number): number {
  return Math.round(v * 1e4) / 1e4
}

/** Great-circle distance in km between two points of the sphere. */
export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const a = fromLatLon(aLat, aLon)
  const b = fromLatLon(bLat, bLon)
  const d = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))
  return Math.acos(d) * MOON_RADIUS_KM
}

/** What the page needs to know about the model, without importing three.js into the page chunk. */
export type ModelSummary =
  | { kind: 'loading' }
  | { kind: 'model'; url: string; triangles: number }
  | { kind: 'sphere'; reason: string; textured: boolean }

/**
 * The three checks of GLOBE.md: drop a marker at each and the model is oriented correctly only
 * when all three land where they should.
 */
export const ORIENTATION_MARKERS: { lat: number; lon: number; label: string; hint: string }[] = [
  { lat: -89.68643, lon: 197.0629, label: 'Shackleton rim', hint: 'on the rim of Shackleton, at the south pole' },
  { lat: 0, lon: 0, label: '0° N 0° E', hint: 'centre of the near side (Sinus Medii), facing the camera' },
  { lat: 17, lon: 59, label: 'Mare Crisium', hint: 'near side, towards +x' },
]
