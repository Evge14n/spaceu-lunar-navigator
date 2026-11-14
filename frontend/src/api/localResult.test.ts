// The in-browser point calculation, end to end on the real files: the backend's port
// (data/ephem/compute.mjs) -> our Timeline -> our summary, against data/ephem/test_vectors.json.

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { summarize, timesMs } from './compute'
import { toLocalResult, type ComputeResult } from './localResult'

const data = resolve(import.meta.dirname, '../../../data')
const has = existsSync(resolve(data, 'ephem/test_vectors.json')) && existsSync(resolve(data, 'dem240.bin'))
const buf = (p: string) => {
  const b = readFileSync(resolve(data, p))
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}

interface Vec {
  id: string
  lat: number
  lon: number
  height_m: number
  ground_m: number
  mask_deg: number[]
  moments: { index: number; sun: { az: number; el: number; horizon_el: number; visible_fraction: number }; earth: { az: number; el: number; visible_fraction: number; distance_km: number } }[]
  year: { lit_percent: number; earth_visible_percent: number; longest_dark_h: number }
}

describe.skipIf(!has)('custom points computed in the browser match the backend test vectors', () => {
  it('13 points: mask, 24 moments and the year', async () => {
    const tv = JSON.parse(readFileSync(resolve(data, 'ephem/test_vectors.json'), 'utf8')) as { tolerance: { angle_deg: number; visible_fraction: number; percent: number }; points: Vec[] }
    const yearMeta = JSON.parse(readFileSync(resolve(data, 'ephem/year.json'), 'utf8'))
    const demMeta = JSON.parse(readFileSync(resolve(data, 'dem240.json'), 'utf8'))
    const mod = await import(/* @vite-ignore */ pathToFileURL(resolve(data, 'ephem/compute.mjs')).href)
    const c = mod.createComputer(yearMeta, buf(yearMeta.file), buf(yearMeta.sun_distance.file), demMeta, buf(demMeta.file))
    const times = Array.from({ length: c.count }, (_, i) => c.timeOf(i).getTime())
    const tol = tv.tolerance
    expect(tv.points.length).toBeGreaterThanOrEqual(13)
    for (const p of tv.points) {
      const r = c.compute(p.lat, p.lon, p.height_m) as ComputeResult
      const L = toLocalResult(`custom:${p.lat},${p.lon}`, p.lat, p.lon, p.height_m, times, r)
      expect(L.ground, p.id).toBeCloseTo(p.ground_m, 1)
      for (let a = 0; a < 720; a += 37) expect(Math.abs(L.horizon.elevation_deg[a] - p.mask_deg[a]), p.id).toBeLessThanOrEqual(tol.angle_deg + 0.0006)
      for (const m of p.moments) {
        const i = m.index
        expect(Math.abs(L.timeline.sun.el[i] - m.sun.el), p.id).toBeLessThanOrEqual(tol.angle_deg + 0.0006)
        expect(Math.abs(L.timeline.sun.az[i] - m.sun.az), p.id).toBeLessThanOrEqual(tol.angle_deg + 0.0006)
        expect(Math.abs(L.timeline.sun.visible_fraction[i] - m.sun.visible_fraction), p.id).toBeLessThanOrEqual(tol.visible_fraction)
        expect(Math.abs(L.timeline.earth.el[i] - m.earth.el), p.id).toBeLessThanOrEqual(tol.angle_deg + 0.0006)
        expect(L.timeline.earth.visible[i], p.id).toBe(m.earth.visible_fraction > 0)
      }
      // our own summary over the whole year agrees with the backend's year numbers
      const ms = timesMs(L.timeline)
      const s = summarize(L.timeline, { id: p.id, name: p.id }, ms[0], ms[ms.length - 1])
      expect(Math.abs(s.sun.lit_percent - p.year.lit_percent), p.id).toBeLessThanOrEqual(0.06)
      expect(Math.abs(s.earth.visible_percent - p.year.earth_visible_percent), p.id).toBeLessThanOrEqual(0.06)
      expect(Math.abs(s.sun.longest_dark_h - p.year.longest_dark_h), p.id).toBeLessThanOrEqual(1)
    }
  }, 60_000)
})
