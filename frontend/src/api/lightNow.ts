// Light and shadow at one moment for the whole south polar map ("Now" layer of sheet 01).
// Same geometry as data/ephem/compute.mjs (docs/BROWSER_COMPUTE.md: local axes, stereographic map,
// rays along great circles, tangent t = (r cos g - r_obs) / (r sin g)), but for one moment we only need
// one ray per map cell: the one towards the Sun. The terrain is the 240 m grid (data/dem240), so hills
// smaller than a few hundred metres cast no shadow here. Pure functions; run in the Web Worker.

const RAD = Math.PI / 180

export interface Dem {
  n: number
  pixelM: number
  /** centre of pixel (0, 0): x (towards 90 E), y (towards 0 E), metres */
  x0: number
  y0: number
  heights: Int16Array
  maxH: number
}

export interface LightOptions {
  /** every k-th pixel of the 240 m grid (2 = 480 m) */
  thin: number
  sunRadiusDeg: number
  eyeM: number
  moonRadiusM: number
}

export const LIGHT_DEFAULTS: LightOptions = { thin: 2, sunRadiusDeg: 0.266, eyeM: 2, moonRadiusM: 1_737_400 }

export function makeDem(meta: { width: number; pixel_m: number; first_pixel_centre_m: [number, number] }, buf: ArrayBuffer): Dem {
  const heights = new Int16Array(buf)
  let maxH = -Infinity
  for (let i = 0; i < heights.length; i++) if (heights[i] > maxH) maxH = heights[i]
  return { n: meta.width, pixelM: meta.pixel_m, x0: meta.first_pixel_centre_m[0], y0: meta.first_pixel_centre_m[1], heights, maxH }
}

/** Unit vector to the Sun at time t (ms), linear between the hourly records of year.bin, normalised. */
export function sunAt(table: Float32Array, stride: number, startMs: number, stepH: number, count: number, t: number): [number, number, number] {
  const f = Math.min(Math.max((t - startMs) / (stepH * 3_600_000), 0), count - 1)
  const i = Math.min(Math.floor(f), count - 2)
  const w = f - i
  const a = i * stride
  const b = a + stride
  const v: [number, number, number] = [0, 1, 2].map((k) => table[a + k] * (1 - w) + table[b + k] * w) as [number, number, number]
  const l = Math.hypot(...v)
  return [v[0] / l, v[1] / l, v[2] / l]
}

/** Distances of the ray samples, metres: 240 m apart near the point, then 4 % longer steps, out to 150 km. */
function rayDistances(pixelM: number): Float64Array {
  const d: number[] = []
  let s = pixelM
  while (s <= 150_000) {
    d.push(s)
    s += Math.max(pixelM, s * 0.04)
  }
  return new Float64Array(d)
}

function discFraction(el: number, hor: number, radius: number): number {
  const x = (el - hor) / radius
  if (x >= 1) return 1
  if (x <= -1) return 0
  return (Math.acos(-x) + x * Math.sqrt(1 - x * x)) / Math.PI
}

interface Ray {
  dist: Float64Array
  cosG: Float64Array
  sinG: Float64Array
}
const rays = new Map<number, Ray>()
function ray(pixelM: number, R: number): Ray {
  let r = rays.get(pixelM)
  if (!r) {
    const dist = rayDistances(pixelM)
    r = { dist, cosG: dist.map((d) => Math.cos(d / R)), sinG: dist.map((d) => Math.sin(d / R)) }
    rays.set(pixelM, r)
  }
  return r
}

/** Bilinear height (m) at map coordinates x, y (m); NaN outside the grid. */
export function demHeight(dem: Dem, x: number, y: number): number {
  const { n, pixelM, x0, y0, heights } = dem
  const fc = (x - x0) / pixelM
  const fr = (y0 - y) / pixelM
  if (!(fc >= 0 && fr >= 0 && fc <= n - 1 && fr <= n - 1)) return NaN
  const c0 = Math.min(Math.floor(fc), n - 2)
  const r0 = Math.min(Math.floor(fr), n - 2)
  const tx = fc - c0
  const ty = fr - r0
  const i = r0 * n + c0
  return (heights[i] * (1 - tx) + heights[i + 1] * tx) * (1 - ty) + (heights[i + n] * (1 - tx) + heights[i + n + 1] * tx) * ty
}

/** Lit share of the Sun's disc (0..1) seen from map point (x, y), `ground` m above the sphere. */
export function lightAt(dem: Dem, x: number, y: number, ground: number, sun: [number, number, number], opt: LightOptions = LIGHT_DEFAULTS): number {
  const R = opt.moonRadiusM
  const { dist, cosG, sinG } = ray(dem.pixelM, R)
  const rTop = R + dem.maxH
  const rad = opt.sunRadiusDeg
  const [sx, sy, sz] = sun
  // inverse stereographic: q = (1 + u.z) / (1 - u.z), k = 2R / (1 - u.z), x = k u.y, y = k u.x
  const q = (x * x + y * y) / (4 * R * R)
  const uz = (q - 1) / (q + 1)
  const kk = (2 * R) / (1 - uz)
  const ux = y / kk
  const uy = x / kk
  const sinEl = sx * ux + sy * uy + sz * uz
  const el = Math.asin(sinEl) / RAD
  if (el + rad < -5) return 0
  // horizontal direction to the Sun
  let dx = sx - sinEl * ux
  let dy = sy - sinEl * uy
  let dz = sz - sinEl * uz
  const dl = Math.hypot(dx, dy, dz)
  dx /= dl
  dy /= dl
  dz /= dl
  const rObs = R + ground + opt.eyeM
  const tanTop = Math.tan((el + rad) * RAD)
  const tanBottom = Math.tan((el - rad) * RAD)
  let best = -Infinity
  for (let j = 0; j < dist.length; j++) {
    const cg = cosG[j]
    const sg = sinG[j]
    // nothing further along can rise above what decides the answer
    if ((rTop * cg - rObs) / (rTop * sg) < Math.max(best, tanBottom)) break
    const vz = cg * uz + sg * dz
    const kv = (2 * R) / (1 - vz)
    const h = demHeight(dem, kv * (cg * uy + sg * dy), kv * (cg * ux + sg * dx))
    if (Number.isNaN(h)) break
    const r = R + h
    const t = (r * cg - rObs) / (r * sg)
    if (t > best) {
      best = t
      if (best >= tanTop) return 0
    }
  }
  return discFraction(el, best === -Infinity ? -90 : Math.atan(best) / RAD, rad)
}

/**
 * Lit share of the Sun's disc (0..255) for every k-th pixel of the grid, rows as in the map
 * (row 0 = largest y, the top of the picture). Size: ceil(n / thin) squared.
 */
export function lightMap(dem: Dem, sun: [number, number, number], opt: LightOptions = LIGHT_DEFAULTS, out?: Uint8Array, row0 = 0, row1?: number): Uint8Array {
  const { n, pixelM, x0, y0, heights } = dem
  const k = opt.thin
  const m = Math.ceil(n / k)
  const r1 = row1 ?? m
  const res = out ?? new Uint8Array((r1 - row0) * m)
  for (let rr = row0; rr < r1; rr++)
    for (let cc = 0; cc < m; cc++) {
      const row = rr * k
      const col = cc * k
      res[(rr - row0) * m + cc] = Math.round(255 * lightAt(dem, x0 + col * pixelM, y0 - row * pixelM, heights[row * n + col], sun, opt))
    }
  return res
}
