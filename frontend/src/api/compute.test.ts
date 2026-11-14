import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  dirFromAzEl,
  earthRadiusDeg,
  formatHours,
  horizonAt,
  HOUR,
  nextSet,
  nextTransition,
  periodPresets,
  runs,
  skyAt,
  summarize,
} from './compute'
import type { Timeline } from './types'

const repo = resolve(import.meta.dirname, '../../..')
const readJson = <T,>(p: string): T => JSON.parse(readFileSync(resolve(repo, p), 'utf8')) as T

/** Synthetic timeline: hourly, sun visibility given by a pattern string ("1" up, "0" down). */
function synth(pattern: string, earthPattern = pattern): Timeline {
  const n = pattern.length
  const t0 = Date.parse('2026-12-01T00:00:00Z')
  const times = Array.from({ length: n }, (_, i) => new Date(t0 + i * HOUR).toISOString().replace('.000Z', 'Z'))
  const up = [...pattern].map((c) => c === '1')
  const eup = [...earthPattern].map((c) => c === '1')
  return {
    site: { id: 't', lat: -89, lon: 0, terrain: true },
    height_m: 2,
    times,
    sun: {
      az: times.map((_, i) => (i * 0.5) % 360),
      el: up.map((u) => (u ? 1 : -1)),
      horizon_el: times.map(() => 0),
      visible_fraction: up.map((u) => (u ? 1 : 0)),
    },
    earth: {
      az: times.map(() => 0),
      el: eup.map((u) => (u ? 2 : -3)),
      horizon_el: times.map(() => 0),
      visible: eup,
      distance_km: times.map(() => 384400),
    },
    source: 'test',
  }
}

describe('dirFromAzEl', () => {
  it('matches the conventions: north is -z, east is +x, up is +y', () => {
    const n = dirFromAzEl(0, 0)
    expect(n[0]).toBeCloseTo(0)
    expect(n[2]).toBeCloseTo(-1)
    expect(dirFromAzEl(90, 0)[0]).toBeCloseTo(1)
    expect(dirFromAzEl(0, 90)[1]).toBeCloseTo(1)
  })
  it('reproduces data/mock/sky.json (Horizons Sun, 2026-11-14 12:00 UT)', () => {
    const sky = readJson<{ sun: { dir: number[] }; earth: { dir: number[] } }>('data/mock/sky.json')
    const s = dirFromAzEl(120.534441, 1.30262)
    const e = dirFromAzEl(358.078065, -3.621837)
    s.forEach((v, i) => expect(v).toBeCloseTo(sky.sun.dir[i], 3))
    e.forEach((v, i) => expect(v).toBeCloseTo(sky.earth.dir[i], 3))
  })
})

describe('runs and summary', () => {
  it('groups equal flags', () => {
    expect(runs([true, true, false, true])).toEqual([
      { value: true, i0: 0, i1: 1 },
      { value: false, i0: 2, i1: 2 },
      { value: true, i0: 3, i1: 3 },
    ])
  })

  it('computes lit %, longest dark/lit and Earth windows for a period', () => {
    //            0123456789
    const tl = synth('1110000111', '0011000000')
    const s = summarize(tl, { id: 't', name: 'T' }, Date.parse(tl.times[0]), Date.parse(tl.times[9]))
    expect(s.sun.lit_percent).toBe(60)
    expect(s.sun.longest_dark_h).toBe(4)
    expect(s.sun.longest_lit_h).toBe(3)
    expect(s.sun.max_el).toBe(1)
    expect(s.earth.visible_percent).toBe(20)
    expect(s.earth.windows).toEqual([{ start: tl.times[2], end: tl.times[3] }])
  })

  it('interpolates the sunset between samples on the margin', () => {
    const tl = synth('1100')
    // margin at i=1: 1 + 0.266 = 1.266, at i=2: -1 + 0.266 = -0.734 -> crossing at 1 + 1.266/2 h
    const s = summarize(tl, { id: 't', name: 'T' }, Date.parse(tl.times[0]), Date.parse(tl.times[3]))
    expect(s.sun.hours_to_sunset).toBeCloseTo(1 + 1.266 / 2, 1)
  })

  it('next sunset when the Sun is down at the start is the one after the next sunrise', () => {
    const tl = synth('0011100')
    const t0 = Date.parse(tl.times[0])
    const set = nextSet(tl, 'sun', t0)
    expect(set).not.toBeNull()
    expect((set! - t0) / HOUR).toBeGreaterThan(4)
    expect((set! - t0) / HOUR).toBeLessThan(5)
  })

  it('reports no sunset when the Sun never sets in the data', () => {
    const tl = synth('1111')
    const tr = nextTransition(tl, 'sun', Date.parse(tl.times[0]))
    expect(tr).toEqual({ up: true, at: null, hours: null })
  })

  it('matches the shape and numbers of data/mock (smooth sphere: Sun up, Earth down)', () => {
    const tl = readJson<Timeline>('data/mock/timeline.json')
    const ref = readJson<{ sun: { lit_percent: number; max_el: number }; earth: { visible_percent: number } }>(
      'data/mock/summary.json',
    )
    const s = summarize(tl, { id: 'custom', name: 'Test point' }, Date.parse(tl.times[0]), Date.parse(tl.times[3]))
    expect(s.sun.lit_percent).toBe(ref.sun.lit_percent)
    expect(s.sun.max_el).toBeCloseTo(ref.sun.max_el, 3)
    expect(s.earth.visible_percent).toBe(ref.earth.visible_percent)
    expect(s.sun.next_sunset).toBeNull()
  })

  it('returns zeros when the period has no samples', () => {
    const tl = synth('11')
    const s = summarize(tl, { id: 't', name: 'T' }, Date.parse('2030-01-01'), Date.parse('2030-01-02'))
    expect(s.sun.lit_percent).toBe(0)
    expect(s.earth.windows).toEqual([])
  })
})

describe('periodPresets', () => {
  it('finds the darkest 30 days', () => {
    const n = 24 * 90
    const pattern = Array.from({ length: n }, (_, i) => (i >= 24 * 40 && i < 24 * 70 ? '0' : '1')).join('')
    const tl = synth(pattern)
    const p = periodPresets([tl]).find((x) => x.label === 'Darkest 30 days')!
    expect((p.from - Date.parse(tl.times[0])) / HOUR).toBe(24 * 40)
    expect(periodPresets([tl]).map((x) => x.label)).toEqual(['2 weeks', '30 days', 'Darkest 30 days', 'Whole year'])
  })
})

describe('skyAt and helpers', () => {
  it('interpolates azimuth across north without jumping', () => {
    const tl = synth('11')
    tl.sun.az = [359, 1]
    const sky = skyAt(tl, Date.parse(tl.times[0]) + HOUR / 2)
    expect(sky.sun.az).toBeCloseTo(0, 5)
  })
  it('horizonAt wraps and interpolates', () => {
    const e = Array.from({ length: 720 }, (_, i) => (i === 719 ? 1 : 0))
    expect(horizonAt(e, 0.5, 359.75)).toBeCloseTo(0.5)
    expect(horizonAt(e, 0.5, 359.5)).toBeCloseTo(1)
    expect(horizonAt(e, 0.5, -0.5)).toBeCloseTo(1)
  })
  it('Earth angular radius is about 0.95 deg at 384 400 km', () => {
    expect(earthRadiusDeg(384400)).toBeCloseTo(0.95, 2)
  })
  it('formats hours', () => {
    expect(formatHours(null)).toBe('not in data')
    expect(formatHours(0.5)).toBe('30 min')
    expect(formatHours(30)).toBe('30 h')
    expect(formatHours(50)).toBe('2 d 2 h')
    expect(formatHours(71.7)).toBe('3 d 0 h')
    expect(formatHours(0.999)).toBe('1 h')
  })
  it('longest run never exceeds the period', () => {
    const tl = synth('1'.repeat(49))
    const s = summarize(tl, { id: 't', name: 'T' }, Date.parse(tl.times[0]), Date.parse(tl.times[48]))
    expect(s.sun.longest_lit_h).toBe(48)
  })
  it('state between samples follows the interpolated crossing', () => {
    const tl = synth('1100')
    // crossing at about 1.63 h; at 1.9 h the Sun is already down
    const t = Date.parse(tl.times[0]) + 1.9 * HOUR
    const tr = nextTransition(tl, 'sun', t)
    expect(tr.up).toBe(false)
  })
})

describe('frontend mock files keep the API shapes', () => {
  it('every mock site has timeline, horizon and terrain of the right size', () => {
    const sites = readJson<{ id: string }[]>('frontend/public/mock/sites.json')
    expect(sites.length).toBeGreaterThanOrEqual(2)
    for (const s of sites) {
      const tl = readJson<Timeline>(`frontend/public/mock/timeline/${s.id}.json`)
      const n = tl.times.length
      for (const k of ['az', 'el', 'horizon_el', 'visible_fraction'] as const) expect(tl.sun[k]).toHaveLength(n)
      for (const k of ['az', 'el', 'horizon_el', 'visible', 'distance_km'] as const) expect(tl.earth[k]).toHaveLength(n)
      const hz = readJson<{ elevation_deg: number[] }>(`frontend/public/mock/horizon/${s.id}.json`)
      expect(hz.elevation_deg).toHaveLength(720)
      const tm = readJson<{ n: number }>(`frontend/public/mock/terrain/${s.id}.json`)
      const bin = readFileSync(resolve(repo, `frontend/public/mock/terrain/${s.id}.bin`))
      expect(bin.byteLength).toBe(tm.n * tm.n * 4)
    }
  })
})
