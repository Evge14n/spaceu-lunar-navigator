// One place for number and unit formats, so every screen reads the same: 89.9 %, 1.45°, 5 d 17 h, 14 NOV 2026.

import type { Site } from './api'
export { formatHours as hours } from './api'

export const pct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? 'n/a' : `${v.toFixed(digits)} %`
export const deg = (v: number | null | undefined, digits = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? 'n/a' : `${v.toFixed(digits)}°`
export const signed = (v: number, digits = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
export const dayMon = (t: number) => {
  const d = new Date(t)
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`
}
export const dateUtc = (t: number) => `${dayMon(t)} ${new Date(t).getUTCFullYear()}`
export const dateTimeUtc = (t: number) => `${dateUtc(t)} ${new Date(t).toISOString().slice(11, 16)} UTC`

/** Site number as on the map: position in sites.json, two digits. */
export const siteNo = (sites: Site[] | null | undefined, id: string | null) => {
  const i = sites?.findIndex((s) => s.id === id) ?? -1
  return i < 0 ? '--' : String(i + 1).padStart(2, '0')
}

export const latLon = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(4)}° ${lat <= 0 ? 'S' : 'N'} / ${(((lon % 360) + 360) % 360).toFixed(4)}° E`

/** "Site 01 Connecting ridge" or "Your point 89.4500° S / 222.7000° E". */
export const siteTitle = (sites: Site[] | null | undefined, id: string | null) => {
  if (id?.startsWith('custom:')) {
    const [la, lo] = id.slice(7).split(',').map(Number)
    return `Your point ${latLon(la, lo)}`
  }
  const s = sites?.find((x) => x.id === id)
  return `Site ${siteNo(sites, id)} ${s?.name ?? ''}`
}
