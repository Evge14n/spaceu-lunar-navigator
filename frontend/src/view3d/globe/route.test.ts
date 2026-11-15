import { describe, expect, it } from 'vitest'
import { customId, isCustom } from '../../api'
import { dataPath, parseCustomId } from './route'

describe('which pipeline a site goes through', () => {
  it('every listed site keeps the static files it had before', () => {
    for (const id of ['site01', 'site04', 'site06', 'site07', 'site11', 'site20', 'site23', 'haworth', 'shoemaker', 'dm2']) {
      expect(isCustom(id), id).toBe(false)
      expect(parseCustomId(id), id).toBeNull()
      expect(dataPath(id), id).toBe('static')
    }
    expect(dataPath(null)).toBe('static')
    expect(dataPath('')).toBe('static')
  })

  it('a point inside the 240 m polar grid keeps the data layer, and only borrows the tile', () => {
    expect(dataPath('custom:-89.45,222.7')).toBe('browser-polar')
    expect(dataPath('custom:-83,0')).toBe('browser-polar')
  })

  it('anywhere else on the Moon is computed by the globe pipeline', () => {
    expect(dataPath('custom:-82.9,0')).toBe('browser-globe')
    expect(dataPath('custom:0.67416,23.47314')).toBe('browser-globe') // Apollo 11
    expect(dataPath('custom:17,59')).toBe('browser-globe')
  })

  it('reads the id the data layer writes, and refuses a broken one', () => {
    const id = customId(-12.3456789, 300.123456)
    expect(parseCustomId(id)).toEqual({ lat: -12.3457, lon: 300.1235 })
    expect(parseCustomId('custom:')).toBeNull()
    expect(parseCustomId('custom:abc,2')).toBeNull()
    expect(parseCustomId('custom:-120,2')).toBeNull()
  })
})
