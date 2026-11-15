// The globe pipeline against what the backend published, so a wrong sign or a swapped axis cannot
// pass. Runs only when data/ is there (it is in the repo; skipped elsewhere).
//
// 1. The horizon mask from data/dem240.bin against data/ephem/test_vectors.json, which
//    backend/browser.py wrote from the same grid with the algorithm of docs/BROWSER_COMPUTE.md.
// 2. The terrain tile from the same grid against data/terrain/<site>.bin, the 20 m tile of the
//    5 m NASA site model: a coarse version of the same landscape, not a different one.

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { polarField } from './heights'
import { horizonMaskAt } from './mask'
import { buildTile } from './tile'
import type { Dem } from '../../api/local'

const repo = resolve(import.meta.dirname, '../../../..')
const data = (p: string) => resolve(repo, 'data', p)
const has = existsSync(data('dem240.bin')) && existsSync(data('ephem/test_vectors.json'))

function dem(): { dem: Dem; pixelM: number } {
  const meta = JSON.parse(readFileSync(data('dem240.json'), 'utf8'))
  const b = readFileSync(data(meta.file))
  const h = new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length))
  return { dem: { n: meta.n, x0: meta.x_km[0], x1: meta.x_km[1], y0: meta.y_km[0], y1: meta.y_km[1], h }, pixelM: meta.pixel_m }
}

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]
}

describe.skipIf(!has)('against the files the backend published', () => {
  const { dem: grid, pixelM } = dem()
  const field = polarField(grid, pixelM)
  const vectors = JSON.parse(readFileSync(data('ephem/test_vectors.json'), 'utf8')) as {
    points: { id?: string; lat: number; lon: number; height_m: number; ground_m: number; missing_fraction?: number; mask_deg: number[] }[]
  }
  const cases = vectors.points

  it('knows the height of the ground at every test point (within a metre)', () => {
    for (const c of cases) {
      expect(Math.abs(field.heightAt(c.lat, c.lon) - c.ground_m), `${c.id ?? ''} ${c.lat},${c.lon}`).toBeLessThan(1)
    }
  })

  // Same grid, same rays, same formula as backend/browser.py, so this is not an approximation:
  // every one of the 13 x 720 angles must match the published file to its last written digit.
  // About 0.4 s per point here, and the same in the browser's worker.
  it('reproduces the published horizon mask to the rounding of the file (1e-4 deg)', { timeout: 120_000 }, () => {
    const all: number[] = []
    for (const c of cases) {
      const m = horizonMaskAt(field, c.lat, c.lon, c.height_m)
      expect(m.elevationDeg).toHaveLength(c.mask_deg.length)
      const diff = c.mask_deg.map((v, i) => Math.abs(m.elevationDeg[i] - v))
      all.push(...diff)
      expect(Math.max(...diff), `${c.id ?? ''} ${c.lat},${c.lon}`).toBeLessThan(1e-4)
      expect(m.missing).toBeCloseTo(c.missing_fraction ?? 0, 2)
    }
    expect(quantile(all, 0.5)).toBeLessThan(1e-4)
  })

  it('builds the same landscape as the published 20 m tile, only coarser', { timeout: 60_000 }, () => {
    for (const id of ['site04', 'site23', 'haworth']) {
      const meta = JSON.parse(readFileSync(data(`terrain/${id}.json`), 'utf8')) as {
        n: number
        size_m: number
        center: { lat: number; lon: number }
      }
      const b = readFileSync(data(`terrain/${id}.bin`))
      const truth = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length))
      const n = 65
      const mine = buildTile(field, { latDeg: meta.center.lat, lonDeg: meta.center.lon, sizeM: meta.size_m, n })
      let sum = 0
      let sumT = 0
      let sumM = 0
      let sumTM = 0
      let sumT2 = 0
      let sumM2 = 0
      let count = 0
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          // the same place in the published tile: both grids cover size_m, row 0 north, col 0 west
          const rr = Math.round((r * (meta.n - 1)) / (n - 1))
          const cc = Math.round((c * (meta.n - 1)) / (n - 1))
          const t = truth[rr * meta.n + cc]
          const m = mine.heights[r * n + c]
          sum += (t - m) ** 2
          sumT += t
          sumM += m
          sumTM += t * m
          sumT2 += t * t
          sumM2 += m * m
          count++
        }
      }
      const rms = Math.sqrt(sum / count)
      const cov = sumTM / count - (sumT / count) * (sumM / count)
      const corr = cov / Math.sqrt((sumT2 / count - (sumT / count) ** 2) * (sumM2 / count - (sumM / count) ** 2))
      // a 240 m grid cannot hold a 20 m landscape, but it must be the same one: a wrong orientation
      // (north and south swapped, east and west swapped) drops the correlation far below this
      expect(corr, `${id} correlation`).toBeGreaterThan(0.99)
      expect(rms, `${id} rms`).toBeLessThan(120)
    }
  })
})
