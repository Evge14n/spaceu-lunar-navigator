// Everything a point the backend never saw needs for the 3D view, off the main thread:
// the best height source available (heights.ts), a local terrain tile (tile.ts), the 720-direction
// horizon mask (mask.ts) and, when the data layer cannot do it, the Sun and the Earth for the
// whole year (api/local.ts, the same pure code the Map sheet uses for polar points).
//
// In: { lat, lon, heightM, n, dataBase, siteBase, needSky }
// Out: { tile..., mask, source..., timeline? } or { error }

import { localTimeline, type Ephem } from '../../api/local'
import { bestField, type EquirectGrid, type HeightField } from './heights'
import { horizonMaskAt, MASK_STEP_DEG } from './mask'
import { buildTile, tileSizeM } from './tile'

interface Request {
  lat: number
  lon: number
  heightM: number
  n: number
  dataBase: string
  siteBase: string
  needSky: boolean
  /** heights read off the globe model, when the globe sheet has them (modelHeights.ts) */
  modelGrid?: EquirectGrid | null
}

let fields: Promise<HeightField> | null = null
let fieldKey = ''
let ephemeris: Promise<Ephem | null> | null = null

/** data/ephem/year.bin: hourly Sun unit vectors and Earth positions, MOON_ME (docs/BROWSER_COMPUTE.md). */
async function loadEphemeris(dataBase: string): Promise<Ephem | null> {
  try {
    const meta = (await (await fetch(`${dataBase}ephem/year.json`)).json()) as {
      file: string
      n: number
      stride: number
      start: string
      step_h: number
    }
    const r = await fetch(dataBase + meta.file)
    if (!r.ok) return null
    const all = new Float32Array(await r.arrayBuffer())
    const n = meta.n
    const sun = new Float64Array(n * 3)
    const earth = new Float64Array(n * 3)
    const times = new Array<number>(n)
    const start = Date.parse(meta.start)
    for (let i = 0; i < n; i++) {
      const a = i * meta.stride
      sun[3 * i] = all[a]
      sun[3 * i + 1] = all[a + 1]
      sun[3 * i + 2] = all[a + 2]
      earth[3 * i] = all[a + 3]
      earth[3 * i + 1] = all[a + 4]
      earth[3 * i + 2] = all[a + 5]
      times[i] = start + i * meta.step_h * 3_600_000
    }
    return { times, sun, earth }
  } catch {
    return null
  }
}

self.onmessage = async (ev: MessageEvent<Request>) => {
  const { lat, lon, heightM, n, dataBase, siteBase, needSky, modelGrid } = ev.data
  const post = (msg: Record<string, unknown>, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer)
  try {
    // the heavy files (dem240 is 6.3 MB) are kept while the worker lives
    const key = `${lat <= -83 ? 'polar' : 'global'}|${dataBase}|${siteBase}|${modelGrid ? modelGrid.width : 0}`
    if (!fields || fieldKey !== key) {
      fieldKey = key
      fields = bestField(lat, lon, dataBase, siteBase, modelGrid)
    }
    const field = await fields
    const sizeM = tileSizeM(field.pixelM)
    const tile = buildTile(field, { latDeg: lat, lonDeg: lon, sizeM, n })
    const mask = horizonMaskAt(field, lat, lon, heightM)

    let timeline = null
    if (needSky) {
      if (!ephemeris) ephemeris = loadEphemeris(dataBase)
      const eph = await ephemeris
      if (!eph) throw new Error('the ephemeris files are not published yet')
      timeline = localTimeline(eph, lat, lon, mask.elevationDeg, heightM, mask.groundM, MASK_STEP_DEG)
      timeline.site.terrain = field.id !== 'sphere'
      timeline.source =
        field.id === 'sphere'
          ? 'Computed in your browser: NAIF SPICE vectors every hour; no elevation model here, so the horizon is a smooth sphere'
          : `Computed in your browser: NAIF SPICE vectors every hour and ${field.label}`
    }

    post(
      {
        heights: tile.heights,
        mask: mask.elevationDeg,
        n,
        sizeM,
        stepM: sizeM / (n - 1),
        groundM: mask.groundM,
        minH: tile.minH,
        maxH: tile.maxH,
        tileMissing: tile.missing,
        maskMissing: mask.missing,
        sourceId: field.id,
        label: field.label,
        pixelM: Number.isFinite(field.pixelM) ? field.pixelM : null,
        timeline,
      },
      [tile.heights.buffer, mask.elevationDeg.buffer],
    )
  } catch (e) {
    fields = null
    post({ error: (e as Error).message || 'the point could not be computed' })
  }
}