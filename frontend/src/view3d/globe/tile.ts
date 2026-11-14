// A local terrain tile for any point, in the shape the 3D scene already draws (docs/API.md):
// n x n float32 heights, row 0 = the north edge, column 0 = the west edge, metres in the local
// frame (x east, y up, z south), relative to the ground at the centre, curvature of the Moon
// included. Pure: the heights come from a HeightField, whatever its source is.

import { enu, type Vec3 } from '../../api/local'
import { toLatLon } from '../../api'
import type { HeightField } from './heights'
import { MOON_RADIUS_M } from './frame'

export interface TileSpec {
  latDeg: number
  lonDeg: number
  /** width of the tile on the ground, metres */
  sizeM: number
  /** samples per side; step_m = sizeM / (n - 1), as in data/terrain/<site>.json */
  n: number
}

export interface LocalTile {
  heights: Float32Array
  /** height of the centre above the 1737.4 km sphere, metres */
  groundM: number
  minH: number
  maxH: number
  /** share of the samples the height source had no data for */
  missing: number
}

/** Height above the sphere at a given east / north offset (metres) from the centre point. */
export function offsetLatLon(latDeg: number, lonDeg: number, eastM: number, northM: number): [number, number] {
  const d = Math.hypot(eastM, northM)
  if (d === 0) return [latDeg, lonDeg]
  const { e, n, u } = enu(latDeg, lonDeg)
  const g = d / MOON_RADIUS_M
  const ux = eastM / d
  const uy = northM / d
  const dir: Vec3 = [e[0] * ux + n[0] * uy, e[1] * ux + n[1] * uy, e[2] * ux + n[2] * uy]
  const cg = Math.cos(g)
  const sg = Math.sin(g)
  return toLatLon([u[0] * cg + dir[0] * sg, u[1] * cg + dir[1] * sg, u[2] * cg + dir[2] * sg])
}

/**
 * Sample the field around the point.
 *
 * The height stored for a sample is its height above the tangent plane of the centre:
 * `(R + h) * cos(g) - (R + ground)`, which is where the curvature of the Moon enters
 * (7.2 m down at 5 km, as docs/API.md says for the precomputed tiles).
 */
export function buildTile(field: HeightField, spec: TileSpec): LocalTile {
  const { latDeg, lonDeg, sizeM, n } = spec
  const step = sizeM / (n - 1)
  const half = (n - 1) / 2
  const { e, n: north, u } = enu(latDeg, lonDeg)
  const raw = field.heightAt(latDeg, lonDeg)
  const groundM = Number.isFinite(raw) ? raw : 0
  const heights = new Float32Array(n * n)
  let minH = Infinity
  let maxH = -Infinity
  let missing = 0
  for (let r = 0; r < n; r++) {
    // row 0 is the north edge: north offset falls as the row index grows
    const northM = (half - r) * step
    for (let c = 0; c < n; c++) {
      const eastM = (c - half) * step
      const d = Math.hypot(eastM, northM)
      let h: number
      if (d === 0) h = groundM
      else {
        const g = d / MOON_RADIUS_M
        const ux = eastM / d
        const uy = northM / d
        const cg = Math.cos(g)
        const sg = Math.sin(g)
        const p: Vec3 = [
          u[0] * cg + (e[0] * ux + north[0] * uy) * sg,
          u[1] * cg + (e[1] * ux + north[1] * uy) * sg,
          u[2] * cg + (e[2] * ux + north[2] * uy) * sg,
        ]
        const [la, lo] = toLatLon(p)
        h = field.heightAt(la, lo)
      }
      if (!Number.isFinite(h)) {
        h = groundM
        missing++
      }
      const g = d / MOON_RADIUS_M
      const y = (MOON_RADIUS_M + h) * Math.cos(g) - (MOON_RADIUS_M + groundM)
      heights[r * n + c] = y
      if (y < minH) minH = y
      if (y > maxH) maxH = y
    }
  }
  return { heights, groundM, minH, maxH, missing: missing / (n * n) }
}

/**
 * How wide the tile should be for a given source. A 10 km tile is what the prepared sites use and
 * what an eye 2 m above the ground can see (the smooth-sphere horizon is 2.4 km away); for a
 * coarse whole-Moon grid a wider tile is the only way to show more than two pixels of relief.
 */
export function tileSizeM(pixelM: number): number {
  if (!Number.isFinite(pixelM)) return 10_000
  return Math.round(Math.min(30_000, Math.max(10_000, 8 * pixelM)) / 100) * 100
}

/** Samples per side: enough to draw, never more than the screen can use. */
export function tileSamples(small = false): number {
  return small ? 97 : 129
}
