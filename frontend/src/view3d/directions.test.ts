import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { dirFromAzEl } from '../api'

// Conventions (docs/ARCHITECTURE.md): x = east, y = up, z = south.
// Azimuth from north, clockwise. 0 = north, 90 = east.

describe('dirFromAzEl', () => {
  it('north on the horizon points to -z', () => {
    const [x, y, z] = dirFromAzEl(0, 0)
    expect(x).toBeCloseTo(0)
    expect(y).toBeCloseTo(0)
    expect(z).toBeCloseTo(-1)
  })

  it('east on the horizon points to +x', () => {
    const [x, y, z] = dirFromAzEl(90, 0)
    expect(x).toBeCloseTo(1)
    expect(y).toBeCloseTo(0)
    expect(z).toBeCloseTo(0)
  })

  it('south on the horizon points to +z', () => {
    const [x, , z] = dirFromAzEl(180, 0)
    expect(x).toBeCloseTo(0)
    expect(z).toBeCloseTo(1)
  })

  it('west on the horizon points to -x', () => {
    const [x, , z] = dirFromAzEl(270, 0)
    expect(x).toBeCloseTo(-1)
    expect(z).toBeCloseTo(0)
  })

  it('elevation 90 points straight up', () => {
    const [x, y, z] = dirFromAzEl(123, 90)
    expect(x).toBeCloseTo(0)
    expect(y).toBeCloseTo(1)
    expect(z).toBeCloseTo(0)
  })

  it('elevation raises y, negative elevation lowers it', () => {
    expect(dirFromAzEl(45, 30)[1]).toBeCloseTo(0.5)
    expect(dirFromAzEl(45, -30)[1]).toBeCloseTo(-0.5)
  })

  it('always returns a unit vector', () => {
    for (const az of [0, 37, 90, 181, 270, 359]) {
      for (const el of [-45, 0, 1.5, 30, 89]) {
        const [x, y, z] = dirFromAzEl(az, el)
        expect(Math.hypot(x, y, z)).toBeCloseTo(1)
      }
    }
  })
})

describe('terrain orientation', () => {
  // Same steps as useTerrainGeometry in Scene.tsx: row 0 of the grid must end up on the north edge (z < 0).
  it('first plane row (row 0) lands at z = -size/2', () => {
    const size = 1000
    const g = new THREE.PlaneGeometry(size, size, 1, 1)
    g.rotateX(-Math.PI / 2)
    const pos = g.attributes.position
    // vertex 0 is the top-left corner of the plane, i.e. the first row
    expect(pos.getZ(0)).toBeCloseTo(-size / 2)
    // vertex 0 is also the west corner (x < 0)
    expect(pos.getX(0)).toBeCloseTo(-size / 2)
  })
})