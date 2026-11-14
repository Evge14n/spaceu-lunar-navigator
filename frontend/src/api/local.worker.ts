// Web Worker: computes any point off the main thread with the backend's own browser port
// (data/ephem/compute.mjs, checked against data/ephem/test_vectors.json by data/ephem/check.mjs;
// algorithm in docs/BROWSER_COMPUTE.md). Here we only load the files and turn the result into the
// same Timeline and Horizon shapes as the static files, so every sheet works for the point.
// Input: { lat, lon, heightM, base } ; output: { timeline, horizon, ground, year } or { error }.

import { toLocalResult, type ComputeResult } from './localResult'

interface Computer {
  compute: (lat: number, lon: number, heightM?: number) => ComputeResult
  timeOf: (i: number) => Date
  count: number
}

let cache: Promise<Computer> | null = null

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
  const mod = (await import(/* @vite-ignore */ base + 'ephem/compute.mjs')) as {
    createComputer: (...a: unknown[]) => Computer
  }
  return mod.createComputer(yearMeta, yearBin, sunBin, demMeta, demBin)
}

self.onmessage = async (ev: MessageEvent<{ lat: number; lon: number; heightM: number; base: string }>) => {
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
