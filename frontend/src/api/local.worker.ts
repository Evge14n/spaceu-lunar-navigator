// Web Worker: computes the horizon mask and the hourly timeline for any point, off the main thread.
// Input: { lat, lon, heightM, base } ; output: { timeline, horizon } or { error }.

import { horizonMask, localTimeline, maskToHorizon, demAt, stereo, type Dem, type Ephem } from './local'

interface EphemMeta {
  file: string
  start: string
  step_h: number
  n: number
  dtype?: string
}
interface DemMeta {
  file: string
  n: number
  x_km: [number, number]
  y_km: [number, number]
  dtype?: string
}

let cache: Promise<{ eph: Ephem; dem: Dem }> | null = null

async function load(base: string) {
  const j = async <T,>(p: string) => {
    const r = await fetch(base + p)
    if (!r.ok) throw new Error(`${p}: ${r.status}`)
    return (await r.json()) as T
  }
  const bin = async (p: string) => {
    const r = await fetch(base + p)
    if (!r.ok) throw new Error(`${p}: ${r.status}`)
    return r.arrayBuffer()
  }
  const em = await j<EphemMeta>('ephem/year.json')
  const dm = await j<DemMeta>('dem240.json')
  const [eb, db] = await Promise.all([bin(em.file), bin(dm.file)])
  const f = new Float32Array(eb)
  const n = em.n
  const sun = new Float32Array(n * 3)
  const earth = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    sun.set(f.subarray(6 * i, 6 * i + 3), 3 * i)
    earth.set(f.subarray(6 * i + 3, 6 * i + 6), 3 * i)
  }
  const t0 = Date.parse(em.start)
  const times = Array.from({ length: n }, (_, i) => t0 + i * em.step_h * 3_600_000)
  const h = dm.dtype === 'float32' ? new Float32Array(db) : new Int16Array(db)
  const dem: Dem = { n: dm.n, x0: dm.x_km[0], x1: dm.x_km[1], y0: dm.y_km[0], y1: dm.y_km[1], h }
  return { eph: { times, sun, earth }, dem }
}

self.onmessage = async (ev: MessageEvent<{ lat: number; lon: number; heightM: number; base: string }>) => {
  const { lat, lon, heightM, base } = ev.data
  try {
    if (!cache) cache = load(base)
    const { eph, dem } = await cache
    const [x, y] = stereo(lat, lon)
    const ground = demAt(dem, x, y)
    if (!Number.isFinite(ground)) throw new Error('This point is outside the terrain grid')
    const mask = horizonMask(dem, lat, lon, heightM)
    const id = `custom:${lat},${lon}`
    const timeline = localTimeline(eph, lat, lon, mask, heightM, ground)
    timeline.site.id = id
    ;(self as unknown as Worker).postMessage({ timeline, horizon: maskToHorizon(id, mask, heightM), ground })
  } catch (e) {
    cache = null
    ;(self as unknown as Worker).postMessage({ error: (e as Error).message })
  }
}
