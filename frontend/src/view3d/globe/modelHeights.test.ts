import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { sampleModelHeights } from './modelHeights'
import { modelGrid, modelGridMessage } from './modelGrid'
import { equirectField } from './heights'
import { dirFromLatLon, GLOBE_RADIUS, modelMatrix, MOON_RADIUS_M } from './frame'

/** A globe mesh in the scene frame, optionally with a round 4 km massif at (lat, lon). */
function globe(bump: { lat: number; lon: number; heightM: number; widthDeg: number } | null, segments = 160) {
  const geo = new THREE.SphereGeometry(GLOBE_RADIUS, segments, segments / 2)
  if (bump) {
    const pos = geo.getAttribute('position') as THREE.BufferAttribute
    const centre = new THREE.Vector3(...dirFromLatLon(bump.lat, bump.lon))
    const v = new THREE.Vector3()
    const cosW = Math.cos((bump.widthDeg * Math.PI) / 180)
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize()
      const c = v.dot(centre)
      const h = c > cosW ? bump.heightM * ((c - cosW) / (1 - cosW)) : 0
      v.multiplyScalar(GLOBE_RADIUS * (1 + h / MOON_RADIUS_M))
      pos.setXYZ(i, v.x, v.y, v.z)
    }
    pos.needsUpdate = true
  }
  return new THREE.Mesh(geo)
}

const fit = { centre: new THREE.Vector3(0, 0, 0), scale: 1 }

describe('heights read out of the globe model', () => {
  it('a textured ball has no relief, and says so', () => {
    expect(sampleModelHeights(globe(null), modelMatrix('scene'), fit.centre, fit.scale)).toBeNull()
    expect(modelGrid()).toBeNull()
    expect(modelGridMessage()).toBeNull()
  })

  it('a displaced model gives back the massif it carries, at the right place', () => {
    const bump = { lat: 17, lon: 59, heightM: 4000, widthDeg: 12 }
    const grid = sampleModelHeights(globe(bump), modelMatrix('scene'), fit.centre, fit.scale)
    expect(grid, 'the model has relief').not.toBeNull()
    expect(grid!.spreadM).toBeGreaterThan(300)
    const field = equirectField(grid!, 'model')
    expect(field.id).toBe('model')
    // at the summit, half way out, and on the other side of the Moon
    expect(field.heightAt(bump.lat, bump.lon)).toBeGreaterThan(3500)
    expect(field.heightAt(bump.lat, bump.lon + 6)).toBeGreaterThan(1000)
    expect(field.heightAt(bump.lat, bump.lon + 6)).toBeLessThan(3000)
    expect(Math.abs(field.heightAt(-bump.lat, bump.lon + 180))).toBeLessThan(50)
  })

  it('the cached copy is independent, so transferring it to a worker keeps the cache', () => {
    sampleModelHeights(globe({ lat: 0, lon: 0, heightM: 5000, widthDeg: 20 }), modelMatrix('scene'), fit.centre, fit.scale)
    const a = modelGridMessage()!
    a.data[0] = 12345
    expect(modelGrid()!.data[0]).not.toBe(12345)
  })

  it('a model stored in MOON_ME axes lands in the right place once it is turned', () => {
    // the same massif, but the mesh is built in MOON_ME and the page turns it with modelMatrix('me')
    const geo = new THREE.SphereGeometry(GLOBE_RADIUS, 160, 80)
    const pos = geo.getAttribute('position') as THREE.BufferAttribute
    const v = new THREE.Vector3()
    const target = new THREE.Vector3(Math.cos(0) * Math.cos(0), 0, Math.sin(0)) // 0 N 0 E in MOON_ME is (1,0,0)
    target.set(1, 0, 0)
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize()
      const c = v.dot(target)
      const h = c > Math.cos(0.2) ? 4000 * ((c - Math.cos(0.2)) / (1 - Math.cos(0.2))) : 0
      v.multiplyScalar(GLOBE_RADIUS * (1 + h / MOON_RADIUS_M))
      pos.setXYZ(i, v.x, v.y, v.z)
    }
    pos.needsUpdate = true
    const grid = sampleModelHeights(new THREE.Mesh(geo), modelMatrix('me'), fit.centre, fit.scale)
    const field = equirectField(grid!, 'model')
    expect(field.heightAt(0, 0)).toBeGreaterThan(3500)
    expect(Math.abs(field.heightAt(0, 180))).toBeLessThan(50)
  })
})
