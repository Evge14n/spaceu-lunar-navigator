import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Site } from '../../api'
import { centreOf, formatLatLon, framingFor, hasPosition, moveSelection, nearestSite, pickLabels, sortSites, spreadDeg } from './sitePicker'

const site = (id: string, name: string, lat: number | null, lon: number | null, extra: Partial<Site> = {}): Site => ({
  id,
  name,
  lat,
  lon,
  elevation_m: 1000,
  source: 'test',
  has_5m: true,
  ...extra,
})

const SITES: Site[] = [
  site('site04', 'Shackleton rim', -89.68643, 197.0629, { nasa_avg_illumination_percent: 87.1 }),
  site('site01', 'Connecting ridge', -89.47485, 222.5569, { nasa_avg_illumination_percent: 88.4, elevation_m: 1947.4 }),
  site('dm2', 'Nobile rim 2', -83.72496, 59.4201, { nasa_avg_illumination_percent: 70.2, elevation_m: 1221.5 }),
  site('nowhere', 'No coordinates yet', null, null, { has_5m: false, mock: true }),
]

describe('which site a tap means', () => {
  it('picks the nearest by great-circle distance', () => {
    const near = nearestSite(SITES, -89.6, 197.5)
    expect(near?.site.id).toBe('site04')
    expect(near?.km).toBeLessThan(10)
  })

  it('handles the 0 / 360 wrap: 359.9 E is next to 0.1 E, not half a Moon away', () => {
    const two = [site('a', 'A', -80, 0.1), site('b', 'B', -80, 180)]
    const near = nearestSite(two, -80, 359.9)
    expect(near?.site.id).toBe('a')
    expect(near?.km).toBeLessThan(12) // 0.2 deg of longitude at 80 S
  })

  it('works at the pole, where every longitude meets', () => {
    const two = [site('a', 'A', -89.9, 0), site('b', 'B', -85, 180)]
    expect(nearestSite(two, -90, 123.4)?.site.id).toBe('a')
  })

  it('ignores sites without coordinates, and gives null when none are placed', () => {
    expect(nearestSite([SITES[3]], -89, 0)).toBeNull()
    expect(nearestSite([], -89, 0)).toBeNull()
    expect(nearestSite(SITES, -83.7, 59.4)?.site.id).toBe('dm2')
  })

  it('hasPosition keeps the typed coordinates', () => {
    expect(SITES.filter(hasPosition)).toHaveLength(3)
    expect(hasPosition(SITES[3])).toBe(false)
  })
})

describe('order of the list', () => {
  it('defaults to the order of data/sites.json, which is the site numbering', () => {
    expect(sortSites(SITES).map((s) => s.id)).toEqual(SITES.map((s) => s.id))
    expect(sortSites([...SITES].reverse()).map((s) => s.id)).toEqual(SITES.map((s) => s.id).reverse())
  })

  it('can sort by name, by illumination and by elevation, and keeps every site', () => {
    expect(sortSites(SITES, 'name').map((s) => s.name[0])).toEqual(['C', 'N', 'N', 'S'])
    expect(sortSites(SITES, 'lit').map((s) => s.id)[0]).toBe('site01')
    expect(sortSites(SITES, 'elevation').map((s) => s.id)[0]).toBe('site01')
    // a site with no number sorts last, it is never dropped
    expect(sortSites(SITES, 'lit')).toHaveLength(SITES.length)
    expect(sortSites(SITES, 'lit').map((s) => s.id)).toContain('nowhere')
  })

  it('does not change the array it is given', () => {
    const before = SITES.map((s) => s.id)
    sortSites(SITES, 'lit')
    expect(SITES.map((s) => s.id)).toEqual(before)
  })
})

describe('framing the cluster, measured from the data', () => {
  it('the centre of the ten sites is near the south pole', () => {
    const c = centreOf(SITES)!
    expect(c.lat).toBeLessThan(-85)
    expect(spreadDeg(SITES, c)).toBeGreaterThan(0)
  })

  it('a tighter cluster needs a closer camera', () => {
    const tight = [site('a', 'A', -89.9, 0), site('b', 'B', -89.8, 90)]
    const wide = [site('a', 'A', -80, 0), site('b', 'B', -80, 180)]
    expect(framingFor(tight).distance).toBeLessThan(framingFor(wide).distance)
  })

  it('puts the farthest site where it was asked to, inside the frame', () => {
    const f = framingFor(SITES, 32, 0.62)
    const theta = (f.spreadDeg * Math.PI) / 180
    const offset = Math.atan(Math.sin(theta) / (f.distance - Math.cos(theta)))
    const half = (16 * Math.PI) / 180
    expect(offset / half).toBeCloseTo(0.62, 2)
    expect(offset).toBeLessThan(half) // still on the screen
  })

  it('never puts the camera inside the Moon, or further than the limit', () => {
    const one = [site('a', 'A', -89.5, 0)]
    expect(framingFor(one).distance).toBeGreaterThanOrEqual(1.12)
    const scattered = [site('a', 'A', 0, 0), site('b', 'B', 0, 180), site('c', 'C', 90, 0)]
    expect(framingFor(scattered).distance).toBeLessThanOrEqual(8)
  })

  it('reads the real site list the same way', () => {
    const path = resolve(import.meta.dirname, '../../../../data/sites.json')
    if (!existsSync(path)) return
    const real = JSON.parse(readFileSync(path, 'utf8')) as Site[]
    const f = framingFor(real)
    expect(f.lat).toBeLessThan(-85) // the ten sites sit around the pole
    expect(f.spreadDeg).toBeGreaterThan(1)
    expect(f.spreadDeg).toBeLessThan(15)
    expect(f.distance).toBeGreaterThan(1.12)
    expect(f.distance).toBeLessThan(4)
  })
})

describe('labels that do not sit on top of each other', () => {
  const at = (id: string, x: number, y: number, priority = 1, front = true) => ({ id, x, y, front, priority, width: 80 })

  it('drops a label that collides with a stronger one', () => {
    const keep = pickLabels([at('a', 100, 100, 3), at('b', 110, 104, 1)])
    expect([...keep]).toEqual(['a'])
  })

  it('keeps labels that are far enough apart', () => {
    const keep = pickLabels([at('a', 100, 100), at('b', 300, 100), at('c', 100, 200)])
    expect(keep.size).toBe(3)
  })

  it('never labels the far side of the globe', () => {
    expect(pickLabels([at('a', 100, 100, 3, false)]).size).toBe(0)
  })

  it('the selected label wins over the hovered one, and both over the rest', () => {
    const keep = pickLabels([at('plain', 100, 100, 1), at('hover', 104, 100, 2), at('selected', 108, 100, 3)])
    expect([...keep]).toEqual(['selected'])
  })

  it('drops labels pushed outside the stage', () => {
    expect(pickLabels([at('a', -5, 100), at('b', 50, 400)], { stageWidth: 300, stageHeight: 300 }).size).toBe(0)
  })
})

describe('coordinates and keyboard', () => {
  it('writes south and east the way the sheets do, and turns 280 E into 80 W', () => {
    expect(formatLatLon(-89.68643, 197.0629, 2)).toBe('89.69° S / 197.06° E')
    expect(formatLatLon(17, 59, 1)).toBe('17.0° N / 59.0° E')
    expect(formatLatLon(0, 0, 1)).toBe('0.0° N / 0.0° E')
  })

  it('arrow keys walk the list and stop at its ends', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    expect(moveSelection(ids, null, 'ArrowRight')).toBe('a')
    expect(moveSelection(ids, 'a', 'ArrowRight')).toBe('b')
    expect(moveSelection(ids, 'b', 'ArrowLeft')).toBe('a')
    expect(moveSelection(ids, 'a', 'ArrowLeft')).toBeNull()
    expect(moveSelection(ids, 'a', 'ArrowDown', 3)).toBe('d')
    expect(moveSelection(ids, 'd', 'ArrowUp', 3)).toBe('a')
    expect(moveSelection(ids, 'e', 'ArrowDown', 3)).toBeNull()
    expect(moveSelection(ids, 'a', 'Enter')).toBeNull()
    expect(moveSelection([], null, 'ArrowRight')).toBeNull()
  })
})
