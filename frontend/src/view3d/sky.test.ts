import { describe, expect, it } from 'vitest'
import { skyAt, timesMs } from '../api'
import type { Timeline } from '../api'

const HOUR = 3_600_000
const t0 = Date.UTC(2026, 10, 14, 0, 0, 0)

function makeTl(): Timeline {
  const times = [0, 1, 2].map((i) => new Date(t0 + i * HOUR).toISOString().replace('.000Z', 'Z'))
  return {
    site: { id: 'test', lat: -89.5, lon: 0, terrain: false },
    height_m: 2,
    times,
    sun: {
      az: [350, 10, 90], // 350 -> 10 crosses north
      el: [0, 10, 20],
      horizon_el: [0, 0, 0],
      visible_fraction: [0, 1, 1],
    },
    earth: {
      az: [90, 90, 90],
      el: [5, 5, 5],
      horizon_el: [0, 0, 0],
      visible: [true, true, true],
      distance_km: [384_400, 384_400, 384_400],
    },
    source: 'test',
    mock: true,
  }
}

describe('skyAt', () => {
  const tl = makeTl()
  const ms = timesMs(tl)

  it('returns the sample values exactly on a sample time', () => {
    const s = skyAt(tl, ms[1], ms)
    expect(s.sun.az).toBeCloseTo(10)
    expect(s.sun.el).toBeCloseTo(10)
  })

  it('interpolates elevation linearly between samples', () => {
    const s = skyAt(tl, ms[1] + 0.5 * HOUR, ms)
    expect(s.sun.el).toBeCloseTo(15)
  })

  it('interpolates azimuth across 0/360 the short way (350 -> 10 passes through 0)', () => {
    const s = skyAt(tl, ms[0] + 0.5 * HOUR, ms)
    const az = ((s.sun.az % 360) + 360) % 360
    // must be ~0 (north), not ~180
    expect(Math.min(az, 360 - az)).toBeLessThan(1)
  })

  it('clamps outside the data range', () => {
    expect(skyAt(tl, ms[0] - 5 * HOUR, ms).sun.el).toBeCloseTo(0)
    expect(skyAt(tl, ms[2] + 5 * HOUR, ms).sun.el).toBeCloseTo(20)
  })

  it('dir points the right way: east, 5 deg up for the Earth', () => {
    const [x, y, z] = skyAt(tl, ms[1], ms).earth.dir
    expect(x).toBeGreaterThan(0.99 * Math.cos((5 * Math.PI) / 180))
    expect(y).toBeCloseTo(Math.sin((5 * Math.PI) / 180))
    expect(Math.abs(z)).toBeLessThan(1e-6)
  })

  it('dir of the Sun at az~0 points to -z (north)', () => {
    const s = skyAt(tl, ms[0] + 0.5 * HOUR, ms)
    expect(s.sun.dir[2]).toBeLessThan(0)
  })

  it('uses the nearest sample for visible_fraction (no interpolation)', () => {
    expect(skyAt(tl, ms[0] + 0.4 * HOUR, ms).sun.visible_fraction).toBe(0)
    expect(skyAt(tl, ms[0] + 0.6 * HOUR, ms).sun.visible_fraction).toBe(1)
  })

  it('dir is a unit vector', () => {
    for (const k of [0, 0.3, 1, 1.7, 2]) {
      const s = skyAt(tl, ms[0] + k * HOUR, ms)
      for (const d of [s.sun.dir, s.earth.dir]) expect(Math.hypot(...d)).toBeCloseTo(1)
    }
  })
})