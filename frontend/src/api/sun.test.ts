import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fromLatLon, localAzEl, meToScene, sunDirectionAt, toLatLon, type SunTable, type Vec3 } from './sun'
import type { Timeline } from './types'

const repo = resolve(import.meta.dirname, '../../..')
const data = (p: string) => resolve(repo, 'data', p)
const has = existsSync(data('ephem/year.bin'))

function table(): SunTable {
  const meta = JSON.parse(readFileSync(data('ephem/year.json'), 'utf8'))
  const b = readFileSync(data(meta.file))
  return { table: new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)), stride: meta.stride, startMs: Date.parse(meta.start), stepH: meta.step_h, n: meta.n }
}

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const angle = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180)

describe('Sun direction for the globe', () => {
  it('scene axes keep the frame right-handed, near side towards +z, north up', () => {
    const [x, y, z] = [meToScene([1, 0, 0]), meToScene([0, 1, 0]), meToScene([0, 0, 1])]
    expect(cross(x, y)).toEqual(z)
    expect(meToScene(fromLatLon(0, 0))).toEqual([0, 0, 1])
    expect(meToScene(fromLatLon(90, 0))[1]).toBeCloseTo(1, 12)
  })

  it('latitude and longitude round trip', () => {
    const [la, lo] = toLatLon(fromLatLon(-89.68643, 197.0629))
    expect(la).toBeCloseTo(-89.68643, 9)
    expect(lo).toBeCloseTo(197.0629, 7)
  })

  it.skipIf(!has)('gives the timeline Sun at the sites (50 moments each, within 0.01 deg; parallax is under 0.001 deg)', () => {
    const t = table()
    const sites = JSON.parse(readFileSync(data('sites.json'), 'utf8')) as { id: string; lat: number; lon: number }[]
    for (const s of sites) {
      const tl = JSON.parse(readFileSync(data(`timeline/${s.id}.json`), 'utf8')) as Timeline
      for (let k = 0; k < 50; k++) {
        const i = Math.floor((k * (tl.times.length - 1)) / 49)
        const { az, el } = localAzEl(sunDirectionAt(t, Date.parse(tl.times[i])), s.lat, s.lon)
        expect(Math.abs(el - tl.sun.el[i]), `${s.id} ${tl.times[i]} el`).toBeLessThan(0.01)
        expect(angle(az, tl.sun.az[i]), `${s.id} ${tl.times[i]} az`).toBeLessThan(0.01)
      }
    }
  })

  it.skipIf(!has)('between two hours the direction is interpolated and stays a unit vector', () => {
    const t = table()
    const v = sunDirectionAt(t, t.startMs + 1.5 * 3_600_000)
    expect(Math.hypot(...v)).toBeCloseTo(1, 12)
    // the sub-solar point at the pole hugs the equator: |lat| < 1.6 deg (axis tilt 1.54 deg)
    expect(Math.abs(toLatLon(v)[0])).toBeLessThan(1.6)
  })
})
