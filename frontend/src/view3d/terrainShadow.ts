// Shadows cast by the terrain, computed through horizons (no three.js shadow map: with the Sun
// 1-2 degrees up a shadow map gives acne and light leaks along every ridge).
//
// Once per tile (in a Web Worker): for every cell of a G x G grid over the tile, the elevation angle
// of the terrain horizon in N azimuths (a ray over the height grid out to the tile edge).
// Every frame (cheap): a cell is lit when the top of the Sun's disc is above the horizon in the Sun's
// azimuth (linear between the two nearest directions); the part of the disc above it gives the penumbra.
// Beyond the tile the horizon of the site (data/horizon/<id>.json, 720 directions, out to 150 km)
// is the lower bound for every cell.
//
// Frame: the tile's own (x east, y up, z south), row 0 = north edge. Tile heights are relative to the
// site and already include the curvature of the Moon (docs/API.md), so the elevation of a terrain
// point Q seen from P in this frame is simply atan((hQ - hP) / d), and the Sun's elevation is the one
// at the site (the timeline). No pure function here touches the DOM, so all of it is unit tested.

export interface TileGrid {
  n: number
  stepM: number
  heights: Float32Array
}

export interface HorizonGrid {
  /** cells per side */
  g: number
  /** azimuths, 0 = north, clockwise, 360 / nAz apart */
  nAz: number
  /** g * g * nAz angles in degrees, cell row 0 = north edge */
  deg: Float32Array
}

const RAD = Math.PI / 180

/** Distances along a ray, in tile samples: one sample at a time near the point, then 6 % longer steps. */
export function rayDistances(maxSamples: number, growth = 0.06): Float32Array {
  const out: number[] = []
  let s = 1
  while (s <= maxSamples * 1.5) {
    out.push(s)
    s += Math.max(1, s * growth)
  }
  return new Float32Array(out)
}

function bilinear(h: Float32Array, n: number, r: number, c: number): number {
  const r0 = Math.floor(r)
  const c0 = Math.floor(c)
  const r1 = Math.min(r0 + 1, n - 1)
  const c1 = Math.min(c0 + 1, n - 1)
  const fr = r - r0
  const fc = c - c0
  const a = h[r0 * n + c0] * (1 - fc) + h[r0 * n + c1] * fc
  const b = h[r1 * n + c0] * (1 - fc) + h[r1 * n + c1] * fc
  return a * (1 - fr) + b * fr
}

/** Height at a tile position in samples (row, column), bilinear. */
export function heightAt(t: TileGrid, r: number, c: number): number {
  return bilinear(t.heights, t.n, Math.min(Math.max(r, 0), t.n - 1), Math.min(Math.max(c, 0), t.n - 1))
}

const dirCache = new Map<number, [Float64Array, Float64Array]>()
function directions(nAz: number): [Float64Array, Float64Array] {
  let d = dirCache.get(nAz)
  if (!d) {
    const s = new Float64Array(nAz)
    const c = new Float64Array(nAz)
    for (let k = 0; k < nAz; k++) {
      s[k] = Math.sin((k * 360 * RAD) / nAz)
      c[k] = Math.cos((k * 360 * RAD) / nAz)
    }
    d = [s, c]
    dirCache.set(nAz, d)
  }
  return d
}

/**
 * Horizon from one point of the tile, in nAz directions, degrees; -90 where the ray leaves the tile at once.
 * eyeM: how far above the ground the point is (the instrument height; also keeps the ground from shading itself).
 */
export function horizonAtPoint(
  t: TileGrid,
  r: number,
  c: number,
  nAz: number,
  eyeM: number,
  dist: Float32Array,
  maxH: number,
  out: Float32Array = new Float32Array(nAz),
  outOffset = 0,
): Float32Array {
  const { n, stepM, heights } = t
  const h0 = heightAt(t, r, c) + eyeM
  const lim = n - 1
  const [sinA, cosA] = directions(nAz)
  for (let k = 0; k < nAz; k++) {
    const dc = sinA[k]
    const dr = -cosA[k]
    let best = -Infinity
    for (let i = 0; i < dist.length; i++) {
      const s = dist[i]
      const rr = r + dr * s
      const cc = c + dc * s
      if (rr < 0 || cc < 0 || rr > lim || cc > lim) break
      const d = s * stepM
      // nothing further along can rise above what we already have
      if ((maxH - h0) / d <= best) break
      const tan = (bilinear(heights, n, rr, cc) - h0) / d
      if (tan > best) best = tan
    }
    out[outOffset + k] = best === -Infinity ? -90 : Math.atan(best) / RAD
  }
  return out
}

/** Tile position (row, column in samples) of the centre of grid cell (gr, gc). */
export function cellToTile(n: number, g: number, gr: number, gc: number): [number, number] {
  return [((gr + 0.5) / g) * (n - 1), ((gc + 0.5) / g) * (n - 1)]
}

/** Horizons for a g x g grid of cells. Rows [row0, row1) only, so the work can be split. */
export function horizonGrid(t: TileGrid, g: number, nAz: number, eyeM: number, row0 = 0, row1 = g): Float32Array {
  let maxH = -Infinity
  for (let i = 0; i < t.heights.length; i++) if (t.heights[i] > maxH) maxH = t.heights[i]
  const dist = rayDistances(t.n)
  const out = new Float32Array((row1 - row0) * g * nAz)
  for (let gr = row0; gr < row1; gr++)
    for (let gc = 0; gc < g; gc++) {
      const [r, c] = cellToTile(t.n, g, gr, gc)
      horizonAtPoint(t, r, c, nAz, eyeM, dist, maxH, out, ((gr - row0) * g + gc) * nAz)
    }
  return out
}

/** Share of a disc of angular radius `radius` whose centre is `el` degrees up, above a line at `hor` degrees. */
export function discFraction(el: number, hor: number, radius: number): number {
  const x = (el - hor) / radius
  if (x >= 1) return 1
  if (x <= -1) return 0
  return (Math.acos(-x) + x * Math.sqrt(1 - x * x)) / Math.PI
}

/** Linear interpolation in a ring of nAz angles at azimuth az (degrees). */
export function ringAt(values: ArrayLike<number>, offset: number, nAz: number, az: number): number {
  const f = ((((az % 360) + 360) % 360) / 360) * nAz
  const k0 = Math.floor(f) % nAz
  const k1 = (k0 + 1) % nAz
  const w = f - Math.floor(f)
  return values[offset + k0] * (1 - w) + values[offset + k1] * w
}

/** Horizon of the whole site (720 values from data/horizon) at azimuth az. */
export function maskAt(mask: ArrayLike<number> | null, az: number): number {
  return mask ? ringAt(mask, 0, mask.length, az) : -90
}

/**
 * Lit share of the Sun's disc for every cell (0..255), written into `out` with texture rows
 * (row 0 = south edge, as three.js samples a DataTexture with v up).
 */
export function litCells(hz: HorizonGrid, mask: ArrayLike<number> | null, sunAz: number, sunEl: number, sunRadius: number, out: Uint8Array): Uint8Array {
  const { g, nAz, deg } = hz
  const floor = maskAt(mask, sunAz)
  const f = ((((sunAz % 360) + 360) % 360) / 360) * nAz
  const k0 = Math.floor(f) % nAz
  const k1 = (k0 + 1) % nAz
  const w = f - Math.floor(f)
  for (let gr = 0; gr < g; gr++) {
    const row = (g - 1 - gr) * g
    for (let gc = 0; gc < g; gc++) {
      const o = (gr * g + gc) * nAz
      let h = deg[o + k0] * (1 - w) + deg[o + k1] * w
      if (floor > h) h = floor
      out[row + gc] = Math.round(255 * discFraction(sunEl, h, sunRadius))
    }
  }
  return out
}

/** Lit share of the Sun's disc at one tile position: the same rule as litCells, for tests and the site marker. */
export function litAtPoint(t: TileGrid, r: number, c: number, nAz: number, eyeM: number, mask: ArrayLike<number> | null, sunAz: number, sunEl: number, sunRadius: number): number {
  let maxH = -Infinity
  for (let i = 0; i < t.heights.length; i++) if (t.heights[i] > maxH) maxH = t.heights[i]
  const ring = horizonAtPoint(t, r, c, nAz, eyeM, rayDistances(t.n), maxH)
  const h = Math.max(ringAt(ring, 0, nAz, sunAz), maskAt(mask, sunAz))
  return discFraction(sunEl, h, sunRadius)
}
