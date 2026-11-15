// Horizon mask for any point on the Moon: the elevation angle of the skyline in 720 directions
// (index 0 = north, clockwise, 0.5 deg apart), the same shape as data/horizon/<site>.json.
//
// This is the algorithm of docs/BROWSER_COMPUTE.md step 3, written against a HeightField instead
// of the polar grid, so it works at any latitude:
//
//   u = cos(g) * up + sin(g) * dir,  r = R + height(u),  t = (r cos g - r_obs) / (r sin g)
//   mask = atan(max over the ray of t)
//
// The curvature of the Moon is inside that formula: on a smooth sphere it gives the dip of the
// horizon, -0.087 deg for an eye 2 m above the ground. Pure, and heavy: run it in a Worker.

import { enu, type Vec3 } from '../../api/local'
import { toLatLon } from '../../api'
import { MOON_RADIUS_M } from './frame'
import type { HeightField } from './heights'

export const MASK_STEP_DEG = 0.5
export const MASK_SIZE = 720

export interface MaskResult {
  /** 720 elevation angles in degrees, index 0 = north, clockwise */
  elevationDeg: Float32Array
  /** share of the ray samples that fell outside the height source */
  missing: number
  groundM: number
}

/**
 * Distances along a ray, metres, exactly as docs/BROWSER_COMPUTE.md step 3: the first sample one
 * pixel away (a grid says nothing about what is closer), then every half pixel out to maxM. For
 * the 240 m polar grid this is the backend's own 240, 360, 480 ... 150 000 m.
 */
export function rayDistances(pixelM: number, maxM = 150_000): Float32Array {
  const first = Math.max(60, Math.min(pixelM, 20_000))
  const step = first / 2
  const out: number[] = []
  for (let s = first; s <= maxM; s += step) out.push(s)
  return new Float32Array(out)
}

/** The horizon of a smooth sphere seen from `eyeM` above the ground, degrees (always negative). */
export function sphereDipDeg(groundM: number, eyeM: number): number {
  const r = MOON_RADIUS_M + groundM
  return (-Math.acos(Math.min(1, r / (r + eyeM))) * 180) / Math.PI
}

export function horizonMaskAt(field: HeightField, latDeg: number, lonDeg: number, eyeM = 2, maxM = 150_000): MaskResult {
  const raw = field.heightAt(latDeg, lonDeg)
  const groundM = Number.isFinite(raw) ? raw : 0
  const dip = sphereDipDeg(groundM, eyeM)
  const elevationDeg = new Float32Array(MASK_SIZE)
  if (field.id === 'sphere') {
    elevationDeg.fill(dip)
    return { elevationDeg, missing: 0, groundM }
  }
  const { e, n, u } = enu(latDeg, lonDeg)
  const rObs = MOON_RADIUS_M + groundM + eyeM
  const dist = rayDistances(field.pixelM, maxM)
  // cos / sin of the central angle do not depend on the azimuth: compute them once
  const cg = new Float64Array(dist.length)
  const sg = new Float64Array(dist.length)
  for (let j = 0; j < dist.length; j++) {
    const g = dist[j] / MOON_RADIUS_M
    cg[j] = Math.cos(g)
    sg[j] = Math.sin(g)
  }
  let missing = 0
  let total = 0
  const p: Vec3 = [0, 0, 0]
  for (let a = 0; a < MASK_SIZE; a++) {
    const az = (a * MASK_STEP_DEG * Math.PI) / 180
    const sa = Math.sin(az)
    const ca = Math.cos(az)
    const dx = e[0] * sa + n[0] * ca
    const dy = e[1] * sa + n[1] * ca
    const dz = e[2] * sa + n[2] * ca
    let best = -Infinity
    for (let j = 0; j < dist.length; j++) {
      p[0] = u[0] * cg[j] + dx * sg[j]
      p[1] = u[1] * cg[j] + dy * sg[j]
      p[2] = u[2] * cg[j] + dz * sg[j]
      const [la, lo] = toLatLon(p)
      const h = field.heightAt(la, lo)
      total++
      if (!Number.isFinite(h)) {
        missing++
        continue
      }
      const r = MOON_RADIUS_M + h
      const t = (r * cg[j] - rObs) / (r * sg[j])
      if (t > best) best = t
    }
    // a ray that found no data at all sees the smooth sphere
    elevationDeg[a] = best === -Infinity ? dip : (Math.atan(best) * 180) / Math.PI
  }
  return { elevationDeg, missing: total ? missing / total : 1, groundM }
}
