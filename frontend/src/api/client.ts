// Data layer. Reads static JSON next to the site; for custom coordinates calls the live API.
//
// One switch, VITE_DATA (in .env or the build command):
//   auto (default) - use ./data/ (real files from backend/) when data/sites.json has real coordinates,
//                    otherwise fall back to ./mock/ (frontend/public/mock, same shapes)
//   real           - always ./data/
//   mock           - always ./mock/
// VITE_API_URL (optional): live FastAPI, used only for custom coordinates ("custom:-89.5,0").

import type { DataSource, Horizon, Site, Summary, Terrain, TerrainMeta, Timeline } from './types'
import { summarize, timesMs } from './compute'

const env = import.meta.env
const MODE = ((env.VITE_DATA as string | undefined) ?? 'auto') as 'auto' | DataSource
const BASE = env.BASE_URL.endsWith('/') ? env.BASE_URL : env.BASE_URL + '/'
export const API_URL = ((env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '')

const cache = new Map<string, Promise<unknown>>()

export class DataError extends Error {
  url: string
  constructor(message: string, url: string) {
    super(message)
    this.url = url
  }
}

async function getJson<T>(url: string): Promise<T> {
  let p = cache.get(url) as Promise<T> | undefined
  if (!p) {
    p = fetch(url).then(async (r) => {
      if (!r.ok) throw new DataError(`${r.status} ${r.statusText}`, url)
      return (await r.json()) as T
    })
    p.catch(() => cache.delete(url))
    cache.set(url, p)
  }
  return p
}

function hasRealSites(x: unknown): boolean {
  return (
    Array.isArray(x) &&
    x.some((s: Site) => typeof s.lat === 'number' && typeof s.lon === 'number' && !s.mock)
  )
}

interface Manifest {
  files: Set<string>
  layers: Set<string>
}
let manifestPromise: Promise<Manifest> | null = null

function manifest(): Promise<Manifest> {
  if (!manifestPromise) {
    manifestPromise = getJson<{ files: string[]; layers?: string[] }>(`${BASE}data-manifest.json`)
      .then((m) => ({ files: new Set(m.files), layers: new Set(m.layers ?? []) }))
      .catch(() => ({ files: new Set<string>(), layers: new Set<string>() }))
  }
  return manifestPromise
}

/** Files present in data/ (written at build time by vite.config.ts). */
export async function dataFiles(): Promise<Set<string>> {
  return (await manifest()).files
}

let sourcePromise: Promise<DataSource> | null = null

/** Which data the site is showing. Resolved once per page load. */
export function dataSource(): Promise<DataSource> {
  if (!sourcePromise) {
    sourcePromise =
      MODE !== 'auto'
        ? Promise.resolve(MODE)
        : dataFiles()
            .then((files) => (files.has('sites.json') ? getJson<Site[]>(`${BASE}data/sites.json`) : []))
            .then((s) => (hasRealSites(s) ? ('real' as const) : ('mock' as const)))
            .catch(() => 'mock' as const)
  }
  return sourcePromise
}

/** URL of a static file; with real data, refuses files the build did not publish (no 404 in the console). */
async function staticUrl(path: string): Promise<string> {
  const src = await dataSource()
  if (src === 'real' && !(await dataFiles()).has(path)) throw new DataError(`data/${path} is not published yet`, path)
  return `${BASE}${src === 'real' ? 'data' : 'mock'}/${path}`
}

export function isCustom(siteId: string): boolean {
  return siteId.startsWith('custom:')
}

/** "custom:-89.5,0" for given coordinates. */
export function customId(lat: number, lon: number): string {
  return `custom:${Math.round(lat * 1e4) / 1e4},${Math.round(lon * 1e4) / 1e4}`
}

/** Site list. With real data, sites whose timeline is not published yet are left out. */
export async function getSites(): Promise<Site[]> {
  const sites = await getJson<Site[]>(await staticUrl('sites.json'))
  if ((await dataSource()) !== 'real') return sites
  const files = await dataFiles()
  return sites.filter((s) => s.lat !== null && s.lon !== null && files.has(`timeline/${s.id}.json`))
}

/** Full timeline for a site. Static file for listed sites, live API for custom coordinates. */
export async function getTimeline(siteId: string, start?: string, end?: string): Promise<Timeline> {
  if (isCustom(siteId)) {
    if (!API_URL) throw new DataError('Custom coordinates need the live API (VITE_API_URL is not set)', '')
    const q = new URLSearchParams({ site: siteId, step: '60', height_m: '2' })
    if (start) q.set('start', start)
    if (end) q.set('end', end)
    return getJson<Timeline>(`${API_URL}/api/timeline?${q}`)
  }
  return getJson<Timeline>(await staticUrl(`timeline/${siteId}.json`))
}

export async function getHorizon(siteId: string): Promise<Horizon> {
  if (isCustom(siteId)) {
    if (!API_URL) throw new DataError('Custom coordinates need the live API (VITE_API_URL is not set)', '')
    return getJson<Horizon>(`${API_URL}/api/horizon?site=${encodeURIComponent(siteId)}&height_m=2`)
  }
  return getJson<Horizon>(await staticUrl(`horizon/${siteId}.json`))
}

const terrainCache = new Map<string, Promise<Terrain>>()

/** Terrain tile: metadata JSON + n x n float32 little-endian heights. */
export function getTerrain(siteId: string): Promise<Terrain> {
  let p = terrainCache.get(siteId)
  if (!p) {
    p = (async () => {
      if (isCustom(siteId)) throw new DataError('3D terrain is available for listed sites only', '')
      const metaUrl = await staticUrl(`terrain/${siteId}.json`)
      const meta = await getJson<TerrainMeta>(metaUrl)
      const binUrl = await staticUrl(meta.file.replace(/^terrain\//, 'terrain/'))
      const r = await fetch(binUrl)
      if (!r.ok) throw new DataError(`${r.status} ${r.statusText}`, binUrl)
      const buf = await r.arrayBuffer()
      const heights = new Float32Array(buf)
      if (heights.length !== meta.n * meta.n)
        throw new DataError(`terrain has ${heights.length} values, expected ${meta.n * meta.n}`, binUrl)
      return { meta, heights }
    })()
    p.catch(() => terrainCache.delete(siteId))
    terrainCache.set(siteId, p)
  }
  return p
}

/** URL of the illumination map layer (data/illumination.png), or null when it is not published yet. */
export async function getIlluminationLayer(): Promise<{ url: string; meta: IlluminationMeta } | null> {
  try {
    if (!(await dataFiles()).has('illumination.json')) return null
    const meta = await getJson<IlluminationMeta>(`${BASE}data/illumination.json`)
    // a lighter WebP copy of the same picture when it is up to date (scripts/make_layers.py)
    const web = (await manifest()).layers.has('illumination.webp')
    return { url: web ? `${BASE}layers/illumination.webp` : `${BASE}data/${meta.file ?? 'illumination.png'}`, meta }
  } catch {
    return null
  }
}

/** Expected next to illumination.png: polar stereographic extent in km (x east, y towards 0 E). */
export interface IlluminationMeta {
  file?: string
  x_km: [number, number]
  y_km: [number, number]
  source?: string
  lat_limit?: number
  legend?: { percent: number; grey: number }[]
}

/**
 * Whole-year summaries of every listed site (index of sites, Accuracy).
 * Real data: data/summary/compare_1y.json from the backend. Mock: computed from the mock timelines.
 */
export async function getYearSummaries(): Promise<Summary[]> {
  if ((await dataSource()) === 'real' && (await dataFiles()).has('summary/compare_1y.json'))
    return getJson<Summary[]>(`${BASE}data/summary/compare_1y.json`)
  const sites = await getSites()
  const tls = await Promise.all(sites.map((s) => getTimeline(s.id)))
  return tls.map((tl, i) => {
    const ms = timesMs(tl)
    return summarize(tl, { id: sites[i].id, name: sites[i].name }, ms[0], ms[ms.length - 1])
  })
}

/** Validation results published by the backend (data/validation.json), or null while it is not there. */
export async function getValidation(): Promise<Record<string, unknown> | null> {
  if ((await dataSource()) !== 'real' || !(await dataFiles()).has('validation.json')) return null
  return getJson<Record<string, unknown>>(`${BASE}data/validation.json`)
}
