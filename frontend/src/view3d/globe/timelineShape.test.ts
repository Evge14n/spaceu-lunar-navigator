// A point of your own must give the sheets exactly what a listed site gives them: the same shape,
// the same fields, the same kinds of value. The sheets then need no special case, which is why
// the Timeline, Compare and Map sheets work for a custom point at all.

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { localTimeline, type Ephem } from '../../api/local'
import { summarize, timesMs, skyAt, type Timeline } from '../../api'
import { terrainMark } from '../../format'
import { MASK_SIZE, MASK_STEP_DEG, sphereDipDeg } from './mask'

const repo = resolve(import.meta.dirname, '../../../..')
const staticTimeline = resolve(repo, 'data/timeline/site04.json')
const has = existsSync(staticTimeline)

/** A day of hourly samples with the Sun going round and the Earth sitting still: enough for shape. */
function ephemeris(n = 48): Ephem {
  const times: number[] = []
  const sun = new Float64Array(n * 3)
  const earth = new Float64Array(n * 3)
  const start = Date.parse('2026-11-14T00:00:00Z')
  for (let i = 0; i < n; i++) {
    times.push(start + i * 3_600_000)
    const a = (i / n) * 2 * Math.PI
    sun[3 * i] = Math.cos(a)
    sun[3 * i + 1] = Math.sin(a)
    sun[3 * i + 2] = 0.02
    earth[3 * i] = 384_400
    earth[3 * i + 1] = 1000
    earth[3 * i + 2] = 2000
  }
  return { times, sun, earth }
}

function customTimeline(lat = 17, lon = 59): Timeline {
  const mask = new Float32Array(MASK_SIZE).fill(sphereDipDeg(0, 2))
  mask[180] = 3.5 // a hill due east, so horizon_el is not a constant
  return localTimeline(ephemeris(), lat, lon, mask, 2, 0, MASK_STEP_DEG)
}

describe('a custom point gives the sheets the same timeline shape', () => {
  const mine = customTimeline()

  it.skipIf(!has)('has exactly the fields of a published timeline', () => {
    const published = JSON.parse(readFileSync(staticTimeline, 'utf8')) as Timeline
    expect(Object.keys(mine).sort()).toEqual(expect.arrayContaining(Object.keys(published).filter((k) => k !== 'mock').sort()))
    expect(Object.keys(mine.sun).sort()).toEqual(Object.keys(published.sun).sort())
    expect(Object.keys(mine.earth).sort()).toEqual(Object.keys(published.earth).sort())
    expect(Object.keys(mine.site).sort()).toEqual(Object.keys(published.site).sort())
    for (const key of ['az', 'el', 'horizon_el', 'visible_fraction'] as const) {
      expect(typeof mine.sun[key][0], `sun.${key}`).toBe(typeof published.sun[key][0])
    }
    expect(typeof mine.earth.visible[0]).toBe(typeof published.earth.visible[0])
    expect(typeof mine.earth.distance_km[0]).toBe(typeof published.earth.distance_km[0])
    expect(typeof mine.times[0]).toBe('string')
    expect(mine.times[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  })

  it('every array has one value per sample', () => {
    const n = mine.times.length
    for (const a of [mine.sun.az, mine.sun.el, mine.sun.horizon_el, mine.sun.visible_fraction]) expect(a).toHaveLength(n)
    for (const a of [mine.earth.az, mine.earth.el, mine.earth.horizon_el, mine.earth.visible, mine.earth.distance_km]) expect(a).toHaveLength(n)
  })

  it('the sheets can run their own maths on it', () => {
    const ms = timesMs(mine)
    const sum = summarize(mine, { id: mine.site.id, name: 'Your point' }, ms[0], ms[ms.length - 1])
    expect(sum.sun.lit_percent).toBeGreaterThanOrEqual(0)
    expect(sum.sun.lit_percent).toBeLessThanOrEqual(100)
    expect(Number.isFinite(sum.sun.longest_dark_h)).toBe(true)
    expect(Array.isArray(sum.earth.windows)).toBe(true)
    const sky = skyAt(mine, ms[3] + 1_800_000, ms)
    expect(sky.sun.dir).toHaveLength(3)
    expect(Math.hypot(...sky.sun.dir)).toBeCloseTo(1, 9)
    expect(sky.earth.angular_radius_deg).toBeGreaterThan(0.5)
  })

  it('azimuths are 0..360 and elevations -90..90, as the contract says', () => {
    for (const az of [...mine.sun.az, ...mine.earth.az]) {
      expect(az).toBeGreaterThanOrEqual(0)
      expect(az).toBeLessThan(360)
    }
    for (const el of [...mine.sun.el, ...mine.earth.el]) expect(Math.abs(el)).toBeLessThanOrEqual(90)
  })

  it('a number resting on a coarse model is marked, and a published one is not', () => {
    const globe = { ...mine, source: 'Computed in your browser: NAIF SPICE vectors every hour and relief read from the globe model itself' }
    expect(terrainMark(globe)).toBe('coarse terrain')
    const polar = { ...mine, source: 'Computed in your browser: NAIF SPICE vectors every hour and the LOLA 240 m elevation model' }
    expect(terrainMark(polar)).toBe('coarse terrain, 240 m')
    const sphere = { ...mine, site: { ...mine.site, terrain: false } }
    expect(terrainMark(sphere)).toBe('smooth sphere')
    expect(terrainMark({ ...mine, source: 'NAIF SPICE DE440; horizon from LOLA 5 m site models' })).toBeNull()
  })
})
