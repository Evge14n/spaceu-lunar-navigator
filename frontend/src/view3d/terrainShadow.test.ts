import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cellToTile, discFraction, horizonGrid, litAtPoint, litCells, type TileGrid } from './terrainShadow'

const repo = resolve(import.meta.dirname, '../../..')
const data = (p: string) => resolve(repo, 'data', p)
const readJson = <T,>(p: string): T => JSON.parse(readFileSync(data(p), 'utf8')) as T

interface Tl {
  times: string[]
  sun: { az: number[]; el: number[]; visible_fraction: number[] }
}

function tile(id: string): TileGrid {
  const meta = readJson<{ n: number; step_m: number; file: string }>(`terrain/${id}.json`)
  const b = readFileSync(data(meta.file))
  return { n: meta.n, stepM: meta.step_m, heights: new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)) }
}

const sites = existsSync(data('sites.json'))
  ? readJson<{ id: string }[]>('sites.json').filter((s) => existsSync(data(`terrain/${s.id}.json`)) && existsSync(data(`timeline/${s.id}.json`)))
  : []

/** 25 lit and 25 dark moments spread over the year (all 50 from one kind when the site has no other). */
function moments(tl: Tl): number[] {
  const lit: number[] = []
  const dark: number[] = []
  tl.sun.visible_fraction.forEach((f, i) => (f > 0 ? lit : dark).push(i))
  const pick = (xs: number[], k: number) => Array.from({ length: Math.min(k, xs.length) }, (_, j) => xs[Math.floor(((j + 0.5) * xs.length) / Math.min(k, xs.length))])
  const d = pick(dark, 25)
  return [...pick(lit, 50 - d.length), ...d]
}

describe('terrain shadows', () => {
  it('disc fraction', () => {
    expect(discFraction(1, 0, 0.25)).toBe(1)
    expect(discFraction(-1, 0, 0.25)).toBe(0)
    expect(discFraction(0.5, 0.5, 0.25)).toBeCloseTo(0.5, 6)
    // centre a quarter of the radius above the line: 0.6575 of the area (circular segment)
    expect(discFraction(0.0625, 0, 0.25)).toBeCloseTo(0.6575, 3)
  })

  it.skipIf(sites.length === 0).each(sites.map((s) => s.id))('%s: the site in the scene is lit exactly when the timeline sees the Sun (50 moments)', (id) => {
    const t = tile(id)
    const tl = readJson<Tl>(`timeline/${id}.json`)
    const mask = readJson<{ elevation_deg: number[] }>(`horizon/${id}.json`).elevation_deg
    const c = (t.n - 1) / 2
    const bad: string[] = []
    for (const i of moments(tl)) {
      const f = litAtPoint(t, c, c, 64, 2, mask, tl.sun.az[i], tl.sun.el[i], 0.266)
      if (f > 0 !== tl.sun.visible_fraction[i] > 0) bad.push(`${tl.times[i]} scene ${f.toFixed(3)} timeline ${tl.sun.visible_fraction[i]}`)
    }
    expect(bad).toEqual([])
  })

  it.skipIf(sites.length === 0)('the grid uses the same rule as one point, and shadows move with the Sun', () => {
    const t = tile(sites[0].id)
    const mask = readJson<{ elevation_deg: number[] }>(`horizon/${sites[0].id}.json`).elevation_deg
    const g = 24
    const deg = horizonGrid(t, g, 64, 2)
    const hz = { g, nAz: 64, deg }
    const a = litCells(hz, mask, 30, 1.2, 0.266, new Uint8Array(g * g))
    for (const [gr, gc] of [[3, 5], [12, 12], [20, 7]]) {
      const [r, c] = cellToTile(t.n, g, gr, gc)
      const one = litAtPoint(t, r, c, 64, 2, mask, 30, 1.2, 0.266)
      expect(a[(g - 1 - gr) * g + gc]).toBe(Math.round(255 * one))
    }
    const b = litCells(hz, mask, 210, 1.2, 0.266, new Uint8Array(g * g))
    let changed = 0
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed++
    expect(changed).toBeGreaterThan(g * g * 0.05)
  })
})
