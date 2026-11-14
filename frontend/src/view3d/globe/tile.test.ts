import { describe, expect, it } from 'vitest'
import { buildTile, offsetLatLon, tileSizeM } from './tile'
import { equirectField, sphereField, type HeightField } from './heights'
import { horizonMaskAt, MASK_SIZE, MASK_STEP_DEG, rayDistances, sphereDipDeg } from './mask'
import { distanceKm, MOON_RADIUS_M } from './frame'

/** A field we can predict: height is a chosen function of latitude and east longitude. */
const fieldOf = (f: (lat: number, lon: number) => number, pixelM = 240): HeightField => ({
  id: 'global',
  label: 'test',
  pixelM,
  heightAt: f,
})

describe('local tile around any point', () => {
  const lat = -12.5
  const lon = 143.25
  const n = 51
  const sizeM = 10_000
  const step = sizeM / (n - 1)

  it('row 0 is the north edge and column 0 the west edge', () => {
    // a ramp that rises to the north: the tile must be highest in row 0
    const north = buildTile(fieldOf((la) => la * 1e5), { latDeg: lat, lonDeg: lon, sizeM, n })
    expect(north.heights[0]).toBeGreaterThan(north.heights[(n - 1) * n])
    // the north edge is level across the tile (the small difference is the meridians converging)
    expect(Math.abs(north.heights[0] - north.heights[n - 1])).toBeLessThan(1)

    // a ramp that rises to the east: the tile must be highest in the last column
    const east = buildTile(fieldOf((_, lo) => lo * 1e5), { latDeg: lat, lonDeg: lon, sizeM, n })
    expect(east.heights[n - 1]).toBeGreaterThan(east.heights[0])
    // the west edge is level to within a thousandth of the east-west difference
    const span = east.heights[n - 1] - east.heights[0]
    expect(Math.abs(east.heights[0] - east.heights[(n - 1) * n])).toBeLessThan(Math.abs(span) * 0.002)
  })

  it('a sample sits where the grid says it does (x east, z south, metres)', () => {
    const r = 10
    const c = 40
    const [la, lo] = offsetLatLon(lat, lon, (c - (n - 1) / 2) * step, ((n - 1) / 2 - r) * step)
    const km = distanceKm(lat, lon, la, lo)
    const expected = Math.hypot((c - (n - 1) / 2) * step, ((n - 1) / 2 - r) * step) / 1000
    expect(km).toBeCloseTo(expected, 6)
    expect(la).toBeGreaterThan(lat) // row 10 of 51 is north of the centre
    expect(lo).toBeGreaterThan(lon) // column 40 of 51 is east of it
  })

  it('curvature: flat ground drops by d^2 / 2R away from the centre', () => {
    const flat = buildTile(fieldOf(() => 0), { latDeg: lat, lonDeg: lon, sizeM, n })
    expect(flat.heights[((n - 1) / 2) * n + (n - 1) / 2]).toBeCloseTo(0, 9)
    for (const [r, c] of [
      [0, (n - 1) / 2],
      [(n - 1) / 2, 0],
      [0, 0],
    ]) {
      const d = Math.hypot((c - (n - 1) / 2) * step, ((n - 1) / 2 - r) * step)
      const drop = -(d * d) / (2 * MOON_RADIUS_M)
      expect(flat.heights[r * n + c], `drop at ${d} m`).toBeCloseTo(drop, 3)
    }
    // the documented number of docs/API.md: 7 m down at 5 km
    expect(-flat.heights[((n - 1) / 2) * n]).toBeCloseTo(7.19, 2)
  })

  it('heights are relative to the ground at the centre', () => {
    const t = buildTile(fieldOf(() => 1500), { latDeg: lat, lonDeg: lon, sizeM, n })
    expect(t.groundM).toBe(1500)
    expect(t.heights[((n - 1) / 2) * n + (n - 1) / 2]).toBeCloseTo(0, 6)
  })

  it('works at the south pole, where longitudes meet', () => {
    const t = buildTile(fieldOf(() => 0), { latDeg: -89.995, lonDeg: 0, sizeM, n })
    expect(t.missing).toBe(0)
    expect(Number.isFinite(t.minH)).toBe(true)
  })

  it('a missing sample falls back to the ground and is counted', () => {
    const t = buildTile(fieldOf((la) => (la > -12.5 ? NaN : 0)), { latDeg: lat, lonDeg: lon, sizeM, n })
    expect(t.missing).toBeGreaterThan(0.4)
    expect(t.missing).toBeLessThan(0.6)
    expect(t.heights.every((v) => Number.isFinite(v))).toBe(true)
  })

  it('tile width follows the source: 10 km for fine data, wider for a coarse grid', () => {
    expect(tileSizeM(240)).toBe(10_000)
    expect(tileSizeM(Number.POSITIVE_INFINITY)).toBe(10_000)
    expect(tileSizeM(1900)).toBe(15_200)
    expect(tileSizeM(20_000)).toBe(30_000)
  })
})

describe('horizon mask for any point', () => {
  it('a smooth sphere gives the dip of the instrument in every direction', () => {
    const m = horizonMaskAt(sphereField(), -45, 10, 2)
    expect(m.elevationDeg).toHaveLength(MASK_SIZE)
    expect(m.elevationDeg[0]).toBeCloseTo(-0.0869, 4)
    expect(Math.max(...m.elevationDeg)).toBeCloseTo(Math.min(...m.elevationDeg), 9)
    expect(sphereDipDeg(0, 2)).toBeCloseTo(-0.0869, 4)
  })

  it('flat ground of a real grid also gives the dip (the curvature is in the formula)', () => {
    const m = horizonMaskAt(fieldOf(() => 0), 20, 200, 2)
    for (const v of m.elevationDeg) expect(v).toBeCloseTo(-0.0869, 3)
  })

  for (const [azimuth, eastM, northM] of [
    [90, 20_000, 0],
    [0, 0, 20_000],
    [225, -14_142, -14_142],
  ]) {
    it(`a 2 km summit 20 km away at azimuth ${azimuth} shows up there, at the angle it subtends`, () => {
      const lat = 5
      const lon = 100
      const peakM = 2000
      const sigmaKm = 3
      const [plat, plon] = offsetLatLon(lat, lon, eastM, northM)
      // a round summit, like the mountain of api/local.test.ts, so the peak azimuth is sharp
      const field = fieldOf((la, lo) => peakM * Math.exp(-(distanceKm(la, lo, plat, plon) ** 2) / (2 * sigmaKm * sigmaKm)), 240)
      const m = horizonMaskAt(field, lat, lon, 2, 60_000)
      let peak = 0
      for (let i = 1; i < m.elevationDeg.length; i++) if (m.elevationDeg[i] > m.elevationDeg[peak]) peak = i
      const off = Math.abs(((peak * MASK_STEP_DEG - azimuth + 540) % 360) - 180)
      expect(off, 'azimuth of the summit').toBeLessThanOrEqual(MASK_STEP_DEG)
      // atan((h - eye) / d) less the curvature drop of 115 m at 20 km. The skyline is a little
      // higher than that: on a summit 3 km wide the steepest line of sight grazes the near flank,
      // half a kilometre closer, which is worth 0.06 deg here.
      const d = Math.hypot(eastM, northM)
      const expected = (Math.atan((peakM - 2 - (d * d) / (2 * MOON_RADIUS_M)) / d) * 180) / Math.PI
      expect(m.elevationDeg[peak]).toBeGreaterThan(expected - 0.02)
      expect(m.elevationDeg[peak]).toBeLessThan(expected + 0.1)
      // a quarter turn away the skyline is the smooth sphere again
      expect(m.elevationDeg[(peak + 180) % MASK_SIZE]).toBeCloseTo(-0.0869, 2)
    })
  }

  it('rays start one pixel out and reach 150 km', () => {
    const d = rayDistances(240)
    expect(d[0]).toBe(240)
    expect(d[d.length - 1]).toBeLessThanOrEqual(150_000)
    expect(d[d.length - 1]).toBeGreaterThan(140_000)
    expect(d.length).toBeLessThan(1400)
  })

  it('samples outside the source are counted, and such a ray falls back to the sphere', () => {
    const half = fieldOf((_, lo) => (lo > 100 ? NaN : 0))
    const m = horizonMaskAt(half, 0, 100, 2, 60_000)
    expect(m.missing).toBeGreaterThan(0.3)
    expect(m.elevationDeg[180]).toBeCloseTo(-0.0869, 3) // due east: no data at all
  })
})

describe('whole-Moon grid sampling', () => {
  const width = 360
  const height = 180
  const data = new Int16Array(width * height)
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) data[r * width + c] = r * 10 + c
  const g = equirectField({ width, height, data, northLat: 90, southLat: -90, westLon: 0, scale: 1, offset: 0, label: 'test' })

  it('row 0 is the north edge, column 0 the west edge, and longitude wraps', () => {
    expect(g.heightAt(89.5, 0.5)).toBeCloseTo(0, 6)
    expect(g.heightAt(89.5, 1.5)).toBeCloseTo(1, 6)
    expect(g.heightAt(88.5, 0.5)).toBeCloseTo(10, 6)
    // halfway between two columns is their mean, and 360 is 0 again
    expect(g.heightAt(89.5, 1.0)).toBeCloseTo(0.5, 6)
    expect(g.heightAt(89.5, 360.5)).toBeCloseTo(g.heightAt(89.5, 0.5), 6)
    expect(g.heightAt(89.5, -0.5)).toBeCloseTo(359, 6) // = 359.5 E, the centre of the last column
  })

  it('the pixel size is the one of the grid', () => {
    expect(g.pixelM).toBeCloseTo((Math.PI * MOON_RADIUS_M) / 180, 3)
  })
})
