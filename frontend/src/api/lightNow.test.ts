import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { demHeight, lightAt, lightMap, makeDem, sunAt } from './lightNow'

const repo = resolve(import.meta.dirname, '../../..')
const data = (p: string) => resolve(repo, 'data', p)
const has = existsSync(data('dem240.bin')) && existsSync(data('ephem/year.bin'))
const buf = (p: string) => {
  const b = readFileSync(data(p))
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.length)
}
const json = (p: string) => JSON.parse(readFileSync(data(p), 'utf8'))

describe.skipIf(!has)('Now layer of the map', () => {
  const dm = json('dem240.json')
  const ym = json('ephem/year.json')
  const dem = has ? makeDem(dm, buf('dem240.bin')) : null!
  const table = has ? new Float32Array(buf('ephem/year.bin')) : null!
  const start = Date.parse(ym.start)
  const sun = (t: number) => sunAt(table, ym.stride, start, ym.step_h, ym.n, t)

  it('agrees with the backend browser port (same 240 m terrain) at the 10 sites, 91 moments each', async () => {
    const { createComputer } = await import(/* @vite-ignore */ pathToFileURL(data('ephem/compute.mjs')).href)
    const comp = createComputer(ym, buf('ephem/year.bin'), buf('ephem/sun_distance.bin'), dm, buf('dem240.bin'))
    let agree = 0
    let total = 0
    for (const s of json('sites.json')) {
      const r = comp.compute(s.lat, s.lon, 2)
      const g = demHeight(dem, s.x_m, s.y_m)
      for (let i = 0; i < ym.n; i += 97) {
        const f = lightAt(dem, s.x_m, s.y_m, g, sun(start + i * 3_600_000))
        if (f > 0 === r.sun.visible_fraction[i] > 0) agree++
        total++
      }
    }
    // one ray per moment instead of 720 directions and 24 strips across the disc: only the grazing moments differ
    expect(agree / total).toBeGreaterThan(0.98)
  })

  it('the light moves with time', () => {
    const a = lightMap(dem, sun(start), { thin: 8, sunRadiusDeg: 0.266, eyeM: 2, moonRadiusM: 1_737_400 })
    const b = lightMap(dem, sun(start + 7 * 86_400_000), { thin: 8, sunRadiusDeg: 0.266, eyeM: 2, moonRadiusM: 1_737_400 })
    let changed = 0
    for (let i = 0; i < a.length; i++) if (a[i] > 0 !== b[i] > 0) changed++
    expect(changed / a.length).toBeGreaterThan(0.05)
  })
})
