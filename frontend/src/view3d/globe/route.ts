// Which pipeline a site on sheet 04 goes through. Pure, so the rule is testable (route.test.ts).
//
//   'static'        a listed site: data/terrain, data/horizon, data/timeline, exactly as before.
//   'browser-polar' your own point inside the 240 m polar grid: the data layer already computes
//                   its timeline and horizon (api/local.worker.ts), we only build the terrain tile.
//   'browser-globe' your own point anywhere else: everything is computed here, from the globe's
//                   height source and the ephemeris.

import { isCustom } from '../../api'
import { DEM240_LAT_LIMIT } from './heights'

export type DataPath = 'static' | 'browser-polar' | 'browser-globe'

/** Latitude and east longitude of "custom:lat,lon", or null when the id is not one. */
export function parseCustomId(siteId: string | null | undefined): { lat: number; lon: number } | null {
  if (!siteId || !isCustom(siteId)) return null
  const [lat, lon] = siteId.slice('custom:'.length).split(',').map(Number)
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90) return null
  return { lat, lon }
}

export function dataPath(siteId: string | null | undefined): DataPath {
  const c = parseCustomId(siteId)
  if (!c) return 'static'
  return c.lat <= DEM240_LAT_LIMIT ? 'browser-polar' : 'browser-globe'
}
