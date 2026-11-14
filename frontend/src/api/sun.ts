// Direction to the Sun in the Moon's own frame (MOON_ME) at any moment of the computed year, from
// data/ephem/year.bin (format: docs/BROWSER_COMPUTE.md). For the intro globe (src/view3d/GLOBE.md).

import { useEffect, useState } from 'react'
import { dataFiles, dataSource } from './client'

export type Vec3 = [number, number, number]

export interface SunTable {
  /** n x stride float32: sun_x, sun_y, sun_z (unit), earth_x_km, earth_y_km, earth_z_km */
  table: Float32Array
  stride: number
  startMs: number
  stepH: number
  n: number
}

/** Unit vector to the Sun in MOON_ME at time t (ms): linear between the two hourly records, normalised; clamped to the year. */
export function sunDirectionAt(s: SunTable, t: number): Vec3 {
  const f = Math.min(Math.max((t - s.startMs) / (s.stepH * 3_600_000), 0), s.n - 1)
  const i = Math.min(Math.floor(f), s.n - 2)
  const w = f - i
  const a = i * s.stride
  const b = a + s.stride
  const x = s.table[a] * (1 - w) + s.table[b] * w
  const y = s.table[a + 1] * (1 - w) + s.table[b + 1] * w
  const z = s.table[a + 2] * (1 - w) + s.table[b + 2] * w
  const l = Math.hypot(x, y, z)
  return [x / l, y / l, z / l]
}

/** Unit vector from the Moon's centre to latitude / east longitude (degrees), MOON_ME. */
export function fromLatLon(latDeg: number, lonDeg: number): Vec3 {
  const la = (latDeg * Math.PI) / 180
  const lo = (lonDeg * Math.PI) / 180
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]
}

/** Latitude and east longitude (0..360) of a MOON_ME direction: for the Sun, the sub-solar point. */
export function toLatLon(v: Vec3): [number, number] {
  const lat = (Math.asin(Math.max(-1, Math.min(1, v[2]))) * 180) / Math.PI
  const lon = (((Math.atan2(v[1], v[0]) * 180) / Math.PI) % 360 + 360) % 360
  return [lat, lon]
}

/**
 * MOON_ME to a y-up three.js scene: x = 90 E, y = north pole, z = 0 E (the near side faces +z).
 * A cyclic swap of the axes, so the frame stays right-handed and no mirror is introduced.
 */
export function meToScene(v: Vec3): Vec3 {
  return [v[1], v[2], v[0]]
}

/** Elevation and azimuth (degrees, from north through east) of direction d seen from lat/lon, ignoring parallax. */
export function localAzEl(d: Vec3, latDeg: number, lonDeg: number): { az: number; el: number } {
  const la = (latDeg * Math.PI) / 180
  const lo = (lonDeg * Math.PI) / 180
  const east: Vec3 = [-Math.sin(lo), Math.cos(lo), 0]
  const north: Vec3 = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)]
  const up = fromLatLon(latDeg, lonDeg)
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const az = ((Math.atan2(dot(d, east), dot(d, north)) * 180) / Math.PI + 360) % 360
  return { az, el: (Math.asin(Math.max(-1, Math.min(1, dot(d, up)))) * 180) / Math.PI }
}

let tablePromise: Promise<SunTable | null> | null = null

/** data/ephem/year.json + year.bin (210 kB), loaded once; null when they are not published. */
export function loadSunTable(): Promise<SunTable | null> {
  if (!tablePromise) {
    const base = `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}data/`
    tablePromise = (async () => {
      if ((await dataSource()) !== 'real' || !(await dataFiles()).has('ephem/year.json')) return null
      const meta = await (await fetch(base + 'ephem/year.json')).json()
      const r = await fetch(base + meta.file)
      if (!r.ok) throw new Error(`${meta.file}: ${r.status}`)
      return { table: new Float32Array(await r.arrayBuffer()), stride: meta.stride, startMs: Date.parse(meta.start), stepH: meta.step_h, n: meta.n }
    })()
    tablePromise.catch(() => (tablePromise = null))
  }
  return tablePromise
}

/**
 * Unit vector to the Sun in MOON_ME at timeMs (null while loading or when the ephemeris is not published).
 * For a three.js globe with y up use meToScene(v); for the sub-solar point toLatLon(v).
 */
export function useSunDirection(timeMs: number): Vec3 | null {
  const [table, setTable] = useState<SunTable | null>(null)
  useEffect(() => {
    let live = true
    loadSunTable().then((t) => live && setTable(t), () => undefined)
    return () => {
      live = false
    }
  }, [])
  return table ? sunDirectionAt(table, timeMs) : null
}
