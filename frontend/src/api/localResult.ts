// Turns the result of data/ephem/compute.mjs into the shapes of the static files (Timeline, Horizon).
// Pure, so it is tested in Node against data/ephem/test_vectors.json (localResult.test.ts).

import type { Horizon, Timeline } from './types'

type Arr = ArrayLike<number>
export interface ComputeResult {
  ground_m: number
  mask: Arr
  missing_fraction: number
  sun: { az: Arr; el: Arr; horizon_el: Arr; distance_km: Arr; angular_radius: Arr; visible_fraction: Arr; irradiance_w_m2?: Arr }
  earth: { az: Arr; el: Arr; horizon_el: Arr; distance_km: Arr; angular_radius: Arr; visible_fraction: Arr }
  year: {
    lit_percent: number
    longest_dark_h: number
    longest_lit_h: number
    mean_irradiance_w_m2: number
    energy_kwh_m2: number
    earth_visible_percent: number
    longest_earth_hidden_h: number
  }
}

export interface LocalResult {
  timeline: Timeline
  horizon: Horizon
  ground: number
  missing: number
  year: ComputeResult['year']
}

const r3 = (v: number) => Math.round(v * 1000) / 1000

export function toLocalResult(id: string, lat: number, lon: number, heightM: number, times: number[], r: ComputeResult): LocalResult {
  const n = times.length
  const list = (a: Arr) => Array.from({ length: n }, (_, i) => r3(a[i]))
  const timeline: Timeline = {
    site: { id, lat, lon, terrain: true },
    height_m: heightM,
    times: times.map((t) => new Date(t).toISOString().replace('.000Z', 'Z')),
    sun: {
      az: list(r.sun.az),
      el: list(r.sun.el),
      horizon_el: list(r.sun.horizon_el),
      // keep the exact value so a thin crescent still counts as visible (not rounded to 0)
      visible_fraction: Array.from({ length: n }, (_, i) => r.sun.visible_fraction[i]),
    },
    earth: {
      az: list(r.earth.az),
      el: list(r.earth.el),
      horizon_el: list(r.earth.horizon_el),
      visible: Array.from({ length: n }, (_, i) => r.earth.visible_fraction[i] > 0),
      distance_km: Array.from({ length: n }, (_, i) => Math.round(r.earth.distance_km[i])),
    },
    source: 'Computed in your browser: NAIF SPICE vectors every hour and the LOLA 240 m elevation model (docs/BROWSER_COMPUTE.md)',
  }
  const horizon: Horizon = { site: id, height_m: heightM, step_deg: 360 / r.mask.length, elevation_deg: Array.from(r.mask, (v) => r3(v)) }
  return { timeline, horizon, ground: r.ground_m, missing: r.missing_fraction, year: r.year }
}
