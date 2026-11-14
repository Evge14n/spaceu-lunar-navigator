// Where the height of the ground comes from for a point the backend never precomputed.
// One interface, three sources, picked at runtime and always named in the interface:
//
//   lola240  - inside data/dem240.bin (south of 83 S): the real LOLA model, 240 m pixels.
//              The same file the rest of the site already computes custom points from.
//   global   - an optional whole-Moon height grid at public/moon/height.json (format below).
//              Coarse (kilometres per pixel), but real relief anywhere on the Moon.
//   sphere   - nothing is published for this point: a smooth sphere of 1737.4 km.
//              This is the "terrain": false case of docs/API.md, not an invention.
//
// Heights are metres above the 1737.4 km sphere, exactly like dem240 and the ephemeris code.
// Pure functions (the loaders are at the bottom and are the only part that fetches).

import { demAt, stereo, type Dem } from '../../api/local'
import { MOON_RADIUS_KM } from './frame'

export type HeightSourceId = 'lola240' | 'global' | 'sphere'

export interface HeightField {
  id: HeightSourceId
  /** one line for the caption under the scene */
  label: string
  /** nominal ground sample distance, metres (Infinity for the smooth sphere) */
  pixelM: number
  /** metres above the 1737.4 km sphere, NaN where the source has no data */
  heightAt(latDeg: number, lonDeg: number): number
}

export const sphereField = (): HeightField => ({
  id: 'sphere',
  label: 'smooth sphere of 1737.4 km: no elevation model is published for this point',
  pixelM: Number.POSITIVE_INFINITY,
  heightAt: () => 0,
})

/** data/dem240.bin: south polar stereographic, 240 m (docs/BROWSER_COMPUTE.md). */
export function polarField(dem: Dem, pixelM = 240): HeightField {
  return {
    id: 'lola240',
    label: `NASA LOLA elevation model, ${pixelM} m pixels (the same grid the Map sheet computes from)`,
    pixelM,
    heightAt(lat, lon) {
      const [x, y] = stereo(lat, lon)
      return demAt(dem, x, y)
    },
  }
}

/**
 * Whole-Moon grid, plate carree (equirectangular). `data` is row-major, row 0 at `northLat`,
 * column 0 at `westLon`, heights in metres after `scale` and `offset`.
 */
export interface EquirectGrid {
  width: number
  height: number
  data: Int16Array | Float32Array | Uint16Array
  northLat: number
  southLat: number
  westLon: number
  scale: number
  offset: number
  label: string
}

export function equirectField(g: EquirectGrid): HeightField {
  const dLat = (g.northLat - g.southLat) / g.height
  const dLon = 360 / g.width
  const pixelM = (dLat * Math.PI * MOON_RADIUS_KM * 1000) / 180
  const at = (r: number, c: number) => g.data[r * g.width + ((c % g.width) + g.width) % g.width] * g.scale + g.offset
  return {
    id: 'global',
    label: g.label,
    pixelM,
    heightAt(lat, lon) {
      const fr = Math.min(Math.max((g.northLat - lat) / dLat - 0.5, 0), g.height - 1)
      const fc = ((((lon - g.westLon) % 360) + 360) % 360) / dLon - 0.5
      const r0 = Math.floor(fr)
      const c0 = Math.floor(fc)
      const r1 = Math.min(r0 + 1, g.height - 1)
      const a = fr - r0
      const b = fc - c0
      const top = at(r0, c0) * (1 - b) + at(r0, c0 + 1) * b
      const bot = at(r1, c0) * (1 - b) + at(r1, c0 + 1) * b
      return top * (1 - a) + bot * a
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Loaders (fetch; used inside the Web Worker)
// ---------------------------------------------------------------------------------------------

/** South of this latitude dem240 has data for the whole 150 km of the rays (docs/BROWSER_COMPUTE.md). */
export const DEM240_LAT_LIMIT = -83

export interface GlobalHeightMeta {
  file: string
  width: number
  height: number
  /** "int16" (raw little-endian .bin) or "rg8" (lossless image, height = R * 256 + G) */
  dtype?: 'int16' | 'rg8'
  scale_m?: number
  offset_m?: number
  north_lat?: number
  south_lat?: number
  west_lon?: number
  source?: string
}

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url}: ${r.status}`)
  return r.arrayBuffer()
}

/** data/dem240.json + .bin, or null when they are not published. */
export async function loadPolarField(dataBase: string): Promise<HeightField | null> {
  try {
    const meta = (await (await fetch(`${dataBase}dem240.json`)).json()) as {
      file: string
      n: number
      pixel_m: number
      x_km: [number, number]
      y_km: [number, number]
    }
    const buf = await fetchBuffer(dataBase + meta.file)
    const dem: Dem = { n: meta.n, x0: meta.x_km[0], x1: meta.x_km[1], y0: meta.y_km[0], y1: meta.y_km[1], h: new Int16Array(buf) }
    return polarField(dem, meta.pixel_m)
  } catch {
    return null
  }
}

/** public/moon/height.json + its data file, or null when the project does not ship one. */
export async function loadGlobalField(siteBase: string): Promise<HeightField | null> {
  try {
    const r = await fetch(`${siteBase}moon/height.json`)
    if (!r.ok) return null
    const meta = (await r.json()) as GlobalHeightMeta
    const url = `${siteBase}moon/${meta.file}`
    const dtype = meta.dtype ?? (meta.file.endsWith('.bin') ? 'int16' : 'rg8')
    let data: Int16Array | Uint16Array
    if (dtype === 'int16') {
      data = new Int16Array(await fetchBuffer(url))
    } else {
      const bmp = await createImageBitmap(await (await fetch(url)).blob())
      const canvas = new OffscreenCanvas(bmp.width, bmp.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(bmp, 0, 0)
      const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data
      data = new Uint16Array(bmp.width * bmp.height)
      for (let i = 0; i < data.length; i++) data[i] = px[i * 4] * 256 + px[i * 4 + 1]
      bmp.close()
    }
    if (data.length < meta.width * meta.height) return null
    return equirectField({
      width: meta.width,
      height: meta.height,
      data,
      northLat: meta.north_lat ?? 90,
      southLat: meta.south_lat ?? -90,
      westLon: meta.west_lon ?? 0,
      scale: meta.scale_m ?? 1,
      offset: meta.offset_m ?? 0,
      label: meta.source ?? 'whole-Moon height grid (public/moon/height.json)',
    })
  } catch {
    return null
  }
}

/**
 * The best field available for this point: the real polar model inside its grid, a published
 * whole-Moon grid outside it, a smooth sphere when neither is there.
 */
export async function bestField(latDeg: number, lonDeg: number, dataBase: string, siteBase: string): Promise<HeightField> {
  if (latDeg <= DEM240_LAT_LIMIT) {
    const polar = await loadPolarField(dataBase)
    if (polar && Number.isFinite(polar.heightAt(latDeg, lonDeg))) return polar
  }
  return (await loadGlobalField(siteBase)) ?? sphereField()
}
