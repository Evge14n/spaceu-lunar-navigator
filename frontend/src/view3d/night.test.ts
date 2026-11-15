import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HOUR, timesMs } from '../api/compute'
import type { Timeline } from '../api/types'
import { nightAt } from './night'

const repo = resolve(import.meta.dirname, '../../..')
const data = (p: string) => resolve(repo, 'data', p)
const sites = existsSync(data('sites.json'))
  ? (JSON.parse(readFileSync(data('sites.json'), 'utf8')) as { id: string }[]).filter((s) => existsSync(data(`timeline/${s.id}.json`)))
  : []

describe('night on the Horizon sheet', () => {
  it.skipIf(!sites.length)('every site: night exactly when the disc is hidden, and the jump lands on the next lit sample', () => {
    let nights = 0
    for (const s of sites) {
      const tl = JSON.parse(readFileSync(data(`timeline/${s.id}.json`), 'utf8')) as Timeline
      const ms = timesMs(tl)
      // 120 moments over the year, on the half hour so they sit between samples
      for (let j = 0; j < 120; j++) {
        const i = Math.floor(((j + 0.5) * (ms.length - 1)) / 120)
        const t = ms[i]
        const n = nightAt(tl, t, ms)
        expect(n === null, `${s.id} ${tl.times[i]}`).toBe(tl.sun.visible_fraction[i] > 0)
        if (!n || n.jumpTo === null) continue
        nights++
        const k = ms.indexOf(n.jumpTo)
        expect(k, `${s.id} ${tl.times[i]} jump on a sample`).toBeGreaterThan(i)
        expect(tl.sun.visible_fraction[k]).toBeGreaterThan(0)
        // nothing lit in between: it is the NEXT sunrise
        for (let m = i; m < k; m++) expect(tl.sun.visible_fraction[m], `${s.id} ${tl.times[m]}`).toBe(0)
        expect(n.riseAt!).toBeGreaterThan(t)
        expect(n.riseAt!).toBeLessThanOrEqual(n.jumpTo)
        expect(n.jumpTo - n.riseAt!).toBeLessThanOrEqual(HOUR)
        // after the jump it is day
        expect(nightAt(tl, n.jumpTo, ms)).toBeNull()
      }
    }
    expect(nights).toBeGreaterThan(50)
  })

  it.skipIf(!sites.length)('the case from the phone report: site 07 (site23), 4 JUL 2027 05:00, Sun 4.77° below is night with a sunrise ahead', () => {
    const tl = JSON.parse(readFileSync(data('timeline/site23.json'), 'utf8')) as Timeline
    const n = nightAt(tl, Date.parse('2027-07-04T05:00:00Z'))
    expect(n).not.toBeNull()
    expect(n!.riseIn).toMatch(/^\d+ (d \d+ h|h|min)$/)
    expect(nightAt(tl, n!.jumpTo!)).toBeNull()
  })
})
