// The globe model is made to be looked at, not measured: NASA SVS exaggerates the relief so that
// mountains read at globe size. Measured on SVS 14959 (Moon_NASA_LRO_8k_Topo), the heights run
// from -30.7 km to +31.0 km, where LOLA runs from -9.1 km to +10.8 km - about three times too much.
// Standing on that would put every skyline three times too high and every lit percentage wrong.
//
// So the model is calibrated against real data before it is used: heights from the model and from
// data/dem240.bin (NASA LOLA, 240 m, already in this project) are sampled at the same places and
// a straight line is fitted through the pairs. The result travels with the point (useCustomSite)
// and is applied to both the rendered ground and the horizon mask, so the two cannot disagree.
//
// Pure functions; the sampling takes two HeightFields and does not fetch anything itself.

import type { HeightField } from './heights'

export interface Calibration {
  /** model height x metres becomes scale * x + offset metres */
  scale: number
  offset: number
  /** correlation of the two sources over the sample: how much the line is worth */
  r: number
  /** metres left over after the fit (root mean square) */
  rmsM: number
  /** pairs the line was fitted through */
  n: number
  /** what it was fitted against */
  against: string
}

export const IDENTITY_CALIBRATION: Calibration = { scale: 1, offset: 0, r: 0, rmsM: 0, n: 0, against: 'not calibrated' }

/** Least squares through (x, y) pairs. */
export function fitLine(pairs: [number, number][]): Calibration {
  const n = pairs.length
  if (n < 8) return { ...IDENTITY_CALIBRATION, n }
  let sx = 0
  let sy = 0
  for (const [x, y] of pairs) {
    sx += x
    sy += y
  }
  const mx = sx / n
  const my = sy / n
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (const [x, y] of pairs) {
    sxx += (x - mx) ** 2
    syy += (y - my) ** 2
    sxy += (x - mx) * (y - my)
  }
  if (sxx <= 0 || syy <= 0) return { ...IDENTITY_CALIBRATION, n }
  const scale = sxy / sxx
  const offset = my - scale * mx
  const r = sxy / Math.sqrt(sxx * syy)
  let sse = 0
  for (const [x, y] of pairs) sse += (y - (scale * x + offset)) ** 2
  return { scale, offset, r, rmsM: Math.sqrt(sse / n), n, against: 'LOLA 240 m (data/dem240.bin)' }
}

/**
 * Sample both sources on a spiral over the area the truth covers (the south polar cap) and fit.
 * A spiral, not random points, so the same model always gives the same answer.
 */
export function calibrateAgainst(model: HeightField, truth: HeightField, latLimit = -84, samples = 4000): Calibration {
  const pairs: [number, number][] = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < samples; i++) {
    // even over the cap: sin of the latitude spread linearly between the pole and the limit
    const f = (i + 0.5) / samples
    const lat = -90 + (90 + latLimit) * f
    const lon = ((i * golden * 180) / Math.PI) % 360
    const a = model.heightAt(lat, lon)
    const b = truth.heightAt(lat, lon)
    if (Number.isFinite(a) && Number.isFinite(b)) pairs.push([a, b])
  }
  return fitLine(pairs)
}

/** Is this fit worth applying? A weak correlation means the two do not describe the same place. */
export function usable(c: Calibration): boolean {
  return c.n >= 200 && c.r > 0.5 && c.scale > 0.05 && c.scale < 20
}

/** A height field with the calibration applied, so everything downstream sees true metres. */
export function calibrated(field: HeightField, c: Calibration): HeightField {
  if (c.scale === 1 && c.offset === 0) return field
  const factor = Math.round(c.scale * 100) / 100
  return {
    ...field,
    label: `${field.label}, relief rescaled to LOLA (x ${factor})`,
    heightAt: (lat, lon) => {
      const h = field.heightAt(lat, lon)
      return Number.isFinite(h) ? c.scale * h + c.offset : h
    },
  }
}
