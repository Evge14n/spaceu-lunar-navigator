import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { atHeight, summarize, timesMs } from './compute'
import type { HeightRow, Horizon, Timeline } from './types'

const repo = resolve(import.meta.dirname, '../../..')
const data = (p: string) => resolve(repo, 'data', p)
const readJson = <T,>(p: string): T => JSON.parse(readFileSync(data(p), 'utf8')) as T
const rows = existsSync(data('summary/heights.json')) ? readJson<HeightRow[]>('summary/heights.json') : []

describe('instrument height', () => {
  it.skipIf(rows.length === 0).each(rows.map((r) => r.site.id))('%s: the timeline over the 1, 5 and 10 m masks gives the backend year at that height', (id) => {
    const tl = readJson<Timeline>(`timeline/${id}.json`)
    const ms = timesMs(tl)
    const row = rows.find((r) => r.site.id === id)!
    for (const h of row.heights) {
      if (h.height_m === 2) continue
      const mask = readJson<Horizon>(`horizon/${id}_h${h.height_m}.json`)
      const s = summarize(atHeight(tl, mask), { id, name: id }, ms[0], ms[ms.length - 1])
      // the backend follows the horizon across the width of the disc; here it is taken at the centre
      expect(Math.abs(s.sun.lit_percent - h.sun.lit_percent), `${id} ${h.height_m} m sun`).toBeLessThan(1)
      expect(Math.abs(s.earth.visible_percent - h.earth.visible_percent), `${id} ${h.height_m} m earth`).toBeLessThan(1)
    }
  })

  it.skipIf(rows.length === 0)('a higher mast never sees less Sun', () => {
    for (const r of rows) {
      const tl = readJson<Timeline>(`timeline/${r.site.id}.json`)
      const ms = timesMs(tl)
      const lit = [1, 5, 10].map((h) => summarize(atHeight(tl, readJson<Horizon>(`horizon/${r.site.id}_h${h}.json`)), r.site, ms[0], ms[ms.length - 1]).sun.lit_percent)
      expect(lit[0]).toBeLessThanOrEqual(lit[1] + 0.01)
      expect(lit[1]).toBeLessThanOrEqual(lit[2] + 0.01)
    }
  })
})
