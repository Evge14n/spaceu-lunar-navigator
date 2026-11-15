// Terrain tile, horizon mask and (where the data layer cannot) the sky for a point of your own.
// The work runs in custom.worker.ts; this hook only caches it per point and hands the result to
// the scene in the shapes of docs/API.md, with one extra field: `coarse`, which says where the
// heights came from so the page can never present them as LOLA 20 m data.

import { useEffect, useState } from 'react'
import type { Horizon, Terrain, TerrainMeta, Timeline } from '../../api'
import type { Calibration } from './calibrate'
import type { HeightSourceId } from './heights'
import { MASK_STEP_DEG } from './mask'
import { tileSamples } from './tile'
import { modelGrid, modelGridMessage } from './modelGrid'
import { dataPath, parseCustomId } from './route'

export interface CoarseInfo {
  sourceId: HeightSourceId
  /** one line naming the source, for the caption under the scene */
  label: string
  /** ground sample distance of the source, metres, or null for a smooth sphere */
  pixelM: number | null
  /** distance between the samples of the tile we built, metres */
  stepM: number
  /** share of the tile and of the horizon rays with no data */
  missing: number
  /** how the model's relief was rescaled to LOLA, when it had to be (calibrate.ts) */
  calibration: Calibration | null
}

export interface CustomTerrainMeta extends TerrainMeta {
  coarse: CoarseInfo
}

export interface CustomSite {
  terrain: Terrain
  horizon: Horizon
  /** the whole year for this point, or null when the data layer provides it */
  timeline: Timeline | null
  coarse: CoarseInfo
  /** height of the ground above the 1737.4 km sphere, metres */
  groundM: number
}

interface WorkerReply {
  error?: string
  heights: Float32Array
  mask: Float32Array
  n: number
  sizeM: number
  stepM: number
  groundM: number
  minH: number
  maxH: number
  tileMissing: number
  maskMissing: number
  sourceId: HeightSourceId
  label: string
  pixelM: number | null
  calibration: Calibration | null
  timeline: Timeline | null
}

const cache = new Map<string, Promise<CustomSite>>()
const CALIBRATION_KEY = 'spaceu.globe.calibration.v1'

/** The measurement is the same for every point, so it is kept between visits. Storage may fail. */
export function loadCalibration(): Calibration | null {
  try {
    const raw = window.localStorage.getItem(CALIBRATION_KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as Calibration
    return Number.isFinite(c?.scale) && Number.isFinite(c?.offset) ? c : null
  } catch {
    return null
  }
}

export function saveCalibration(c: Calibration) {
  try {
    window.localStorage.setItem(CALIBRATION_KEY, JSON.stringify(c))
  } catch {
    /* private mode: it is measured again next time */
  }
}
const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/?$/, '/')
const EYE_M = 2

function compute(siteId: string, lat: number, lon: number, needSky: boolean, n: number): Promise<CustomSite> {
  return new Promise<CustomSite>((resolve, reject) => {
    const w = new Worker(new URL('./custom.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<WorkerReply>) => {
      w.terminate()
      const d = e.data
      if (d.error) return reject(new Error(d.error))
      if (d.calibration) saveCalibration(d.calibration)
      const coarse: CoarseInfo = {
        sourceId: d.sourceId,
        label: d.label,
        pixelM: d.pixelM,
        stepM: d.stepM,
        missing: Math.max(d.tileMissing, d.maskMissing),
        calibration: d.calibration ?? null,
      }
      const meta: CustomTerrainMeta = {
        site: siteId,
        n: d.n,
        size_m: d.sizeM,
        step_m: d.stepM,
        center: { lat, lon },
        min_h: d.minH,
        max_h: d.maxH,
        file: '',
        coarse,
      }
      resolve({
        terrain: { meta, heights: d.heights },
        horizon: { site: siteId, height_m: EYE_M, step_deg: MASK_STEP_DEG, elevation_deg: Array.from(d.mask) },
        timeline: d.timeline,
        coarse,
        groundM: d.groundM,
      })
    }
    w.onerror = (e) => {
      w.terminate()
      reject(new Error(e.message || 'the point could not be computed'))
    }
    // the globe sheet may already have read heights off the model: send a copy with the request
    const modelGrid = modelGridMessage()
    w.postMessage(
      { lat, lon, heightM: EYE_M, n, dataBase: `${BASE}data/`, siteBase: BASE, needSky, modelGrid, calibration: loadCalibration() },
      modelGrid ? [modelGrid.data.buffer] : [],
    )
  })
}

export interface CustomSiteState {
  data: CustomSite | null
  error: Error | null
  loading: boolean
}

/**
 * Null siteId, or a listed site, means "nothing to do here": sheet 04 keeps its static files.
 * `needSky` is false for points the data layer already computes (see route.ts).
 */
/**
 * The same work the hook does, for callers outside React: the data layer asks for this when a
 * sheet wants a point of its own that the 240 m polar grid does not cover (api/client.ts).
 * One worker run per point, shared with the hook through the same cache.
 */
export function computeCustomSite(siteId: string, opts: { needSky?: boolean; samples?: number } = {}): Promise<CustomSite> {
  const c = parseCustomId(siteId)
  if (!c) return Promise.reject(new Error(`${siteId} is not a point of your own`))
  const needSky = opts.needSky ?? dataPath(siteId) === 'browser-globe'
  const n = opts.samples ?? tileSamples(typeof window !== 'undefined' && window.innerWidth < 700)
  const key = `${siteId}|${n}|${needSky}|${modelGrid() ? 'model' : 'published'}`
  let p = cache.get(key)
  if (!p) {
    p = compute(siteId, c.lat, c.lon, needSky, n)
    p.catch(() => cache.delete(key))
    cache.set(key, p)
  }
  return p
}

export function useCustomSite(siteId: string | null): CustomSiteState {
  const [state, setState] = useState<CustomSiteState>({ data: null, error: null, loading: false })
  useEffect(() => {
    const c = parseCustomId(siteId)
    if (!siteId || !c) {
      setState({ data: null, error: null, loading: false })
      return
    }
    let live = true
    setState({ data: null, error: null, loading: true })
    const p = computeCustomSite(siteId)
    p.then(
      (data) => live && setState({ data, error: null, loading: false }),
      (error: Error) => live && setState({ data: null, error, loading: false }),
    )
    return () => {
      live = false
    }
  }, [siteId])
  return state
}
