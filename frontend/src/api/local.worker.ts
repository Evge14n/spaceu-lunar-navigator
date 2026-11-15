// Web Worker: computes any point off the main thread with the backend's own browser port
// (data/ephem/compute.mjs, checked against data/ephem/test_vectors.json by data/ephem/check.mjs;
// algorithm in docs/BROWSER_COMPUTE.md). Here we only load the files and turn the result into the
// same Timeline and Horizon shapes as the static files, so every sheet works for the point.
// Input: { lat, lon, heightM, base } ; output: { timeline, horizon, ground, year } or { error }.
// Also the "Now" layer of the map: input { kind: 'light', id, t, thin, base } ; output { kind: 'light', id, t, m, data } or { kind: 'light', id, error }.

import { LIGHT_DEFAULTS, lightMap, makeDem, sunAt, type Dem } from './lightNow'
import { toLocalResult, type ComputeResult } from './localResult'

interface Computer {
  compute: (lat: number, lon: number, heightM?: number) => ComputeResult
  timeOf: (i: number) => Date
  count: number
}

let cache: Promise<Computer> | null = null
/** raw files kept for the light layer: the Sun table and the 240 m grid */
let raw: { table: Float32Array; stride: number; start: number; stepH: number; count: number; dem: Dem } | null = null

async function load(base: string): Promise<Computer> {
  const j = async (p: string) => {
    const r = await fetch(base + p)
    if (!r.ok) throw new Error(`${p}: ${r.status}`)
    return r.json()
  }
  const bin = async (p: string) => {
    const r = await fetch(base + p)
    if (!r.ok) throw new Error(`${p}: ${r.status}`)
    return r.arrayBuffer()
  }
  const [yearMeta, demMeta] = await Promise.all([j('ephem/year.json'), j('dem240.json')])
  const [yearBin, sunBin, demBin] = await Promise.all([bin(yearMeta.file), bin(yearMeta.sun_distance.file), bin(demMeta.file)])
  raw = {
    table: new Float32Array(yearBin.slice(0)),
    stride: yearMeta.stride,
    start: Date.parse(yearMeta.start),
    stepH: yearMeta.step_h,
    count: yearMeta.n,
    dem: makeDem(demMeta, demBin.slice(0)),
  }
  const mod = (await import(/* @vite-ignore */ base + 'ephem/compute.mjs')) as {
    createComputer: (...a: unknown[]) => Computer
  }
  return mod.createComputer(yearMeta, yearBin, sunBin, demMeta, demBin)
}

type Msg = { kind?: undefined; lat: number; lon: number; heightM: number; base: string } | { kind: 'light'; id: number; t: number; thin: number; base: string }

self.onmessage = async (ev: MessageEvent<Msg>) => {
  if (ev.data.kind === 'light') {
    const { id, t, thin, base } = ev.data
    try {
      if (!cache) cache = load(base)
      await cache
      const r = raw!
      const sun = sunAt(r.table, r.stride, r.start, r.stepH, r.count, t)
      const data = lightMap(r.dem, sun, { ...LIGHT_DEFAULTS, thin })
      ;(self as unknown as Worker).postMessage({ kind: 'light', id, t, m: Math.ceil(r.dem.n / thin), data }, [data.buffer])
    } catch (e) {
      cache = null
      ;(self as unknown as Worker).postMessage({ kind: 'light', id, error: (e as Error).message || 'calculation failed' })
    }
    return
  }
  const { lat, lon, heightM, base } = ev.data
  try {
    if (!cache) cache = load(base)
    const c = await cache
    const r = c.compute(lat, lon, heightM)
    const times = Array.from({ length: c.count }, (_, i) => c.timeOf(i).getTime())
    ;(self as unknown as Worker).postMessage(toLocalResult(`custom:${lat},${lon}`, lat, lon, heightM, times, r))
  } catch (e) {
    cache = null
    const msg = (e as Error).message || 'calculation failed'
    ;(self as unknown as Worker).postMessage({ error: /outside|model|grid/i.test(msg) ? 'This point is outside the terrain model (north of 83° S)' : msg })
  }
}
