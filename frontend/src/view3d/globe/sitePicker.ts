// The rules behind the site picker on #/globe: which site a tap means, how to order them, how far
// the camera has to be for the ten of them to come apart, and which labels fit on the screen.
// Pure, no three.js, no DOM - so every rule is unit tested (sitePicker.test.ts).

import type { Site } from '../../api'
import { distanceKm } from './frame'

/** A site we can actually put on the globe. */
export type PlacedSite = Site & { lat: number; lon: number }

export const hasPosition = (s: Site): s is PlacedSite => typeof s.lat === 'number' && typeof s.lon === 'number'

export type SortKey = 'id' | 'name' | 'lit' | 'elevation'

/** Default order is the order of data/sites.json (by id), which is the numbering the sheets show. */
export function sortSites(sites: Site[], key: SortKey = 'id', litOf?: (s: Site) => number | null | undefined): Site[] {
  const copy = [...sites]
  const num = (v: number | null | undefined) => (typeof v === 'number' ? v : Number.NEGATIVE_INFINITY)
  switch (key) {
    case 'name':
      return copy.sort((a, b) => a.name.localeCompare(b.name))
    case 'lit':
      return copy.sort((a, b) => {
        const la = litOf ? litOf(a) : a.nasa_avg_illumination_percent
        const lb = litOf ? litOf(b) : b.nasa_avg_illumination_percent
        return num(lb) - num(la) || a.id.localeCompare(b.id)
      })
    case 'elevation':
      return copy.sort((a, b) => num(b.elevation_m) - num(a.elevation_m) || a.id.localeCompare(b.id))
    default:
      // "By number": the site numbers 01..10 are positions in sites.json, as on the map
      return copy
  }
}

/** The listed site closest to a point on the sphere, by great-circle distance. */
export function nearestSite(sites: Site[], latDeg: number, lonDeg: number): { site: PlacedSite; km: number } | null {
  let best: { site: PlacedSite; km: number } | null = null
  for (const s of sites) {
    if (!hasPosition(s)) continue
    const km = distanceKm(latDeg, lonDeg, s.lat, s.lon)
    if (!best || km < best.km) best = { site: s, km }
  }
  return best
}

/** Mean direction of the sites, as a point on the sphere: where the camera should look. */
export function centreOf(sites: Site[]): { lat: number; lon: number } | null {
  let x = 0
  let y = 0
  let z = 0
  let n = 0
  for (const s of sites) {
    if (!hasPosition(s)) continue
    const p = (s.lat * Math.PI) / 180
    const l = (s.lon * Math.PI) / 180
    x += Math.cos(p) * Math.cos(l)
    y += Math.cos(p) * Math.sin(l)
    z += Math.sin(p)
    n++
  }
  if (!n) return null
  const len = Math.hypot(x, y, z)
  if (len < 1e-9) return { lat: -90, lon: 0 } // scattered all over: look at the pole
  return { lat: (Math.asin(z / len) * 180) / Math.PI, lon: (((Math.atan2(y, x) * 180) / Math.PI) % 360 + 360) % 360 }
}

/** Half-angle of the cap that holds every site, as seen from the centre of the Moon, in degrees. */
export function spreadDeg(sites: Site[], centre: { lat: number; lon: number }): number {
  let max = 0
  for (const s of sites) {
    if (!hasPosition(s)) continue
    const km = distanceKm(centre.lat, centre.lon, s.lat, s.lon)
    const deg = (km / 1737.4) * (180 / Math.PI)
    if (deg > max) max = deg
  }
  return max
}

export interface Framing {
  lat: number
  lon: number
  /** camera distance in globe radii */
  distance: number
  spreadDeg: number
}

/**
 * Where to put the camera so that the sites fill a chosen share of the frame instead of sitting on
 * top of each other. A point `theta` away from the point under the camera, seen from `d` radii,
 * appears `atan(sin theta / (d - cos theta))` off centre; set that to the share of the half-field
 * we want and solve for d. The spread is measured from the sites, never assumed.
 */
export function framingFor(sites: Site[], fovDeg = 32, fill = 0.62, minDistance = 1.12, maxDistance = 8): Framing {
  const centre = centreOf(sites) ?? { lat: -90, lon: 0 }
  const spread = spreadDeg(sites, centre)
  const half = ((fovDeg / 2) * Math.PI) / 180
  const target = Math.max(0.02, Math.min(half * 0.95, half * fill))
  const theta = Math.max((0.15 * Math.PI) / 180, (spread * Math.PI) / 180)
  const d = Math.cos(theta) + Math.sin(theta) / Math.tan(target)
  return { lat: centre.lat, lon: centre.lon, distance: Math.min(maxDistance, Math.max(minDistance, d)), spreadDeg: spread }
}

export interface LabelCandidate {
  id: string
  /** pixels from the left and top of the stage */
  x: number
  y: number
  /** true when the marker is on the near side of the globe */
  front: boolean
  /** bigger wins a collision: selected 3, hovered 2, the rest 1 */
  priority: number
  /** label width in pixels (the text is measured by the caller) */
  width: number
}

/**
 * Which labels to draw. The far side of the globe never shows one; after that the strongest label
 * wins any overlap, and the one it covers is dropped rather than drawn on top of it.
 */
export function pickLabels(items: LabelCandidate[], opts: { height?: number; padding?: number; stageWidth?: number; stageHeight?: number } = {}): Set<string> {
  const h = opts.height ?? 18
  const pad = opts.padding ?? 4
  const kept: { x0: number; x1: number; y0: number; y1: number }[] = []
  const out = new Set<string>()
  const order = [...items].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
  for (const it of order) {
    if (!it.front) continue
    if (opts.stageWidth !== undefined && (it.x < 0 || it.x > opts.stageWidth)) continue
    if (opts.stageHeight !== undefined && (it.y < 0 || it.y > opts.stageHeight)) continue
    const box = { x0: it.x - it.width / 2 - pad, x1: it.x + it.width / 2 + pad, y0: it.y - h - pad, y1: it.y + pad }
    const clash = kept.some((k) => box.x0 < k.x1 && box.x1 > k.x0 && box.y0 < k.y1 && box.y1 > k.y0)
    if (clash) continue
    kept.push(box)
    out.add(it.id)
  }
  return out
}

/** "89.6864° S / 197.0629° E", the way the sheets write coordinates. */
export function formatLatLon(lat: number, lon: number, digits = 4): string {
  // east longitude 0..360, the same notation as the map and the rest of the site
  const east = ((lon % 360) + 360) % 360
  return `${Math.abs(lat).toFixed(digits)}° ${lat < 0 ? 'S' : 'N'} / ${east.toFixed(digits)}° E`
}

/** Move the selection with the arrow keys; returns the id to select, or null if nothing changes. */
export function moveSelection(ids: string[], current: string | null, key: string, columns = 3): string | null {
  if (!ids.length) return null
  const i = current ? ids.indexOf(current) : -1
  const step: Record<string, number> = { ArrowRight: 1, ArrowDown: columns, ArrowLeft: -1, ArrowUp: -columns }
  if (!(key in step)) return null
  if (i < 0) return ids[0]
  const next = i + step[key]
  if (next < 0 || next >= ids.length) return null
  return ids[next]
}
