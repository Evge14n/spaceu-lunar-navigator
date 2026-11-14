// Types follow docs/API.md exactly. Change them only together with the contract.

export interface Site {
  id: string
  name: string
  lat: number | null
  lon: number | null
  elevation_m: number | null
  source: string
  has_5m: boolean
  mock?: boolean
}

export interface Timeline {
  site: { id: string; lat: number; lon: number; terrain: boolean }
  height_m: number
  times: string[]
  sun: { az: number[]; el: number[]; horizon_el: number[]; visible_fraction: number[] }
  earth: {
    az: number[]
    el: number[]
    horizon_el: number[]
    visible: boolean[]
    distance_km: (number | null)[]
  }
  source: string
  mock?: boolean
}

export interface Window {
  start: string
  end: string
}

export interface Summary {
  site: { id: string; name: string }
  period: { start: string; end: string }
  sun: {
    lit_percent: number
    longest_dark_h: number
    longest_lit_h: number
    max_el: number
    next_sunset: string | null
    hours_to_sunset: number | null
  }
  earth: {
    visible_percent: number
    next_earthset: string | null
    hours_to_earthset: number | null
    windows: Window[]
  }
}

export interface Horizon {
  site: string
  height_m: number
  step_deg: number
  /** 720 values, index 0 = north, clockwise */
  elevation_deg: number[]
  mock?: boolean
}

export interface TerrainMeta {
  site: string
  n: number
  size_m: number
  step_m: number
  center: { lat: number | null; lon: number | null }
  min_h: number | null
  max_h: number | null
  file: string
  mock?: boolean
}

export interface Terrain {
  meta: TerrainMeta
  /** n x n heights in metres, row 0 = north edge */
  heights: Float32Array
}

export interface SkyBody {
  az: number
  el: number
  /** unit vector in the scene frame: x east, y up, z south */
  dir: [number, number, number]
  angular_radius_deg: number
  horizon_el: number
}

export interface Sky {
  time: string
  sun: SkyBody & { visible_fraction: number }
  earth: SkyBody & { visible: boolean; distance_km: number | null }
}

export type DataSource = 'real' | 'mock'
