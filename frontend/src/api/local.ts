// In-browser calculation for any point (no server): Sun and Earth directions from hourly
// ephemeris vectors in MOON_ME, the horizon mask from a coarse polar DEM, and a Timeline in
// the same shape as data/timeline/<site>.json, so every sheet works for a custom point.
// Pure functions; the heavy part runs in a Web Worker (local.worker.ts). Tested in local.test.ts.

import { dirFromAzEl, earthRadiusDeg, SUN_RADIUS_DEG } from './compute'
import type { Horizon, Timeline } from './types'

export const R_MOON_KM = 1737.4
const D2R = Math.PI / 180

export type Vec3 = [number, number, number]

/** Local east, north, up unit vectors at (lat, lon) on a sphere, MOON_ME frame. */
export function enu(latDeg: number, lonDeg: number): { e: Vec3; n: Vec3; u: Vec3 } {
  const p = latDeg * D2R
  const l = lonDeg * D2R
  return {
    e: [-Math.sin(l), Math.cos(l), 0],
    n: [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)],
    u: [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)],
  }
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** Azimuth (from north, clockwise) and elevation of a direction vector seen from (lat, lon). */
export function azEl(dir: Vec3, frame: { e: Vec3; n: Vec3; u: Vec3 }): [number, number] {
  const len = Math.hypot(dir[0], dir[1], dir[2])
  const x = dot(dir, frame.e) / len
  const y = dot(dir, frame.n) / len
  const z = dot(dir, frame.u) / len
  const az = ((Math.atan2(x, y) / D2R) % 360 + 360) % 360
  return [az, Math.asin(Math.max(-1, Math.min(1, z))) / D2R]
}

/** Site position in km, MOON_ME, from lat, lon and height above the sphere (m). */
export function sitePos(latDeg: number, lonDeg: number, heightM: number): Vec3 {
  const r = R_MOON_KM + heightM / 1000
  const p = latDeg * D2R
  const l = lonDeg * D2R
  return [r * Math.cos(p) * Math.cos(l), r * Math.cos(p) * Math.sin(l), r * Math.sin(p)]
}

/** South polar stereographic (km): x towards 90 E, y towards 0 E. */
export function stereo(latDeg: number, lonDeg: number): [number, number] {
  const rho = 2 * R_MOON_KM * Math.tan(Math.PI / 4 + (latDeg * D2R) / 2)
  return [rho * Math.sin(lonDeg * D2R), rho * Math.cos(lonDeg * D2R)]
}

export interface Dem {
  n: number
  /** plane coordinates of the grid edges, km: column 0 at x0, row 0 at y1 (north-up image) */
  x0: number
  x1: number
  y0: number
  y1: number
  /** heights above the sphere, metres, row-major */
  h: Int16Array | Float32Array
}

/** Bilinear height (m) at plane point (x, y) km; NaN outside the grid. */
export function demAt(d: Dem, x: number, y: number): number {
  const fx = ((x - d.x0) / (d.x1 - d.x0)) * d.n - 0.5
  const fy = ((d.y1 - y) / (d.y1 - d.y0)) * d.n - 0.5
  const c = Math.floor(fx)
  const r = Math.floor(fy)
  if (c < 0 || r < 0 || c >= d.n - 1 || r >= d.n - 1) return NaN
  const a = fx - c
  const b = fy - r
  const i = r * d.n + c
  return (d.h[i] * (1 - a) + d.h[i + 1] * a) * (1 - b) + (d.h[i + d.n] * (1 - a) + d.h[i + d.n + 1] * a) * b
}

/**
 * Horizon mask: terrain elevation angle (deg) for 720 azimuths, rays out to maxKm,
 * Moon curvature included, instrument heightM above the local ground.
 */
export function horizonMask(d: Dem, latDeg: number, lonDeg: number, heightM = 2, maxKm = 150, stepDeg = 0.5): Float32Array {
  const [x, y] = stereo(latDeg, lonDeg)
  const rho = Math.hypot(x, y)
  // local north points away from the south pole in this projection; east is north turned clockwise
  const nx = rho > 1e-6 ? x / rho : Math.sin(lonDeg * D2R)
  const ny = rho > 1e-6 ? y / rho : Math.cos(lonDeg * D2R)
  const ex = ny
  const ey = -nx
  // stereographic scale factor (plane km per ground km), about 1.00 to 1.004 here
  const k = 2 / (1 + Math.sin(-latDeg * D2R))
  const h0 = demAt(d, x, y)
  const eye = (Number.isFinite(h0) ? h0 : 0) + heightM
  const nAz = Math.round(360 / stepDeg)
  const out = new Float32Array(nAz)
  const cell = ((d.x1 - d.x0) / d.n) // km
  for (let i = 0; i < nAz; i++) {
    const a = i * stepDeg * D2R
    const dx = Math.cos(a) * nx + Math.sin(a) * ex
    const dy = Math.cos(a) * ny + Math.sin(a) * ey
    let best = -90
    let s = cell
    while (s <= maxKm) {
      const h = demAt(d, x + dx * s * k, y + dy * s * k)
      if (Number.isFinite(h)) {
        const drop = (s * s) / (2 * R_MOON_KM) // km, curvature
        const el = Math.atan2((h - eye) / 1000 - drop, s) / D2R
        if (el > best) best = el
      }
      s += s < 10 ? cell : s < 40 ? 2 * cell : 4 * cell
    }
    // smooth sphere fallback: the geometric horizon of the instrument
    const flat = -Math.acos(R_MOON_KM / (R_MOON_KM + heightM / 1000)) / D2R
    // the smooth-sphere dip only when the ray found no terrain at all (a ridge can see below it)
    out[i] = best > -90 ? best : flat
  }
  return out
}

export interface Ephem {
  /** UTC ms of each sample */
  times: number[]
  /** unit vector to the Sun, MOON_ME, per sample */
  sun: Float32Array | Float64Array // n*3
  /** position of the Earth, km, MOON_ME from the Moon's centre, per sample */
  earth: Float32Array | Float64Array // n*3
}

function horizonAtArr(mask: Float32Array, stepDeg: number, az: number): number {
  const n = mask.length
  const xx = (((az % 360) + 360) % 360) / stepDeg
  const i = Math.floor(xx) % n
  const f = xx - Math.floor(xx)
  return mask[i] * (1 - f) + mask[(i + 1) % n] * f
}

function discFraction(el: number, horizon: number, r: number): number {
  const h = Math.max(-1, Math.min(1, (el - horizon) / r))
  return (Math.acos(-h) - -h * Math.sqrt(1 - h * h)) / Math.PI
}

/** Timeline for any point, same shape as the static files. */
export function localTimeline(eph: Ephem, latDeg: number, lonDeg: number, mask: Float32Array, heightM: number, groundM: number, stepDeg = 0.5): Timeline {
  const frame = enu(latDeg, lonDeg)
  const pos = sitePos(latDeg, lonDeg, groundM + heightM)
  const n = eph.times.length
  const T: Timeline = {
    site: { id: `custom:${latDeg},${lonDeg}`, lat: latDeg, lon: lonDeg, elevation_m: groundM, terrain: true },
    height_m: heightM,
    times: eph.times.map((t) => new Date(t).toISOString().replace('.000Z', 'Z')),
    sun: { az: [], el: [], horizon_el: [], visible_fraction: [] },
    earth: { az: [], el: [], horizon_el: [], visible: [], visible_fraction: [], distance_km: [] },
    source: 'Computed in your browser: NAIF SPICE vectors (hourly) and a 240 m LOLA terrain grid',
  }
  for (let i = 0; i < n; i++) {
    const s: Vec3 = [eph.sun[3 * i], eph.sun[3 * i + 1], eph.sun[3 * i + 2]]
    const E: Vec3 = [eph.earth[3 * i] - pos[0], eph.earth[3 * i + 1] - pos[1], eph.earth[3 * i + 2] - pos[2]]
    const [saz, sel] = azEl(s, frame)
    const [eaz, eel] = azEl(E, frame)
    const dist = Math.hypot(E[0], E[1], E[2])
    const sh = horizonAtArr(mask, stepDeg, saz)
    const eh = horizonAtArr(mask, stepDeg, eaz)
    T.sun.az.push(+saz.toFixed(3))
    T.sun.el.push(+sel.toFixed(3))
    T.sun.horizon_el.push(+sh.toFixed(3))
    T.sun.visible_fraction.push(+discFraction(sel, sh, SUN_RADIUS_DEG).toFixed(3))
    T.earth.az.push(+eaz.toFixed(3))
    T.earth.el.push(+eel.toFixed(3))
    T.earth.horizon_el.push(+eh.toFixed(3))
    const ef = discFraction(eel, eh, earthRadiusDeg(dist))
    T.earth.visible.push(ef > 0)
    T.earth.visible_fraction?.push(+ef.toFixed(3))
    T.earth.distance_km.push(Math.round(dist))
  }
  return T
}

export function maskToHorizon(id: string, mask: Float32Array, heightM: number, stepDeg = 0.5): Horizon {
  return { site: id, height_m: heightM, step_deg: stepDeg, elevation_deg: Array.from(mask, (v) => +v.toFixed(3)) }
}

/** Unit vector of a direction for the 3D scene (re-exported for convenience). */
export { dirFromAzEl }
