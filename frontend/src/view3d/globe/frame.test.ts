import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { fromLatLon, type Vec3 } from '../../api'
import {
  applyMat3,
  dirFromLatLon,
  distanceKm,
  GLOBE_RADIUS,
  latLonFromDir,
  latLonFromPoint,
  meFromScene,
  modelMatrix,
  MOON_RADIUS_KM,
  normalizeLon,
  pointFromLatLon,
  sceneFromMe,
  transposeMat3,
} from './frame'

const POINTS: [number, number][] = [
  [0, 0],
  [17, 59],
  [-89.68643, 197.0629],
  [45.5, 359.9],
  [-12.25, 180],
  [89, 300],
  [-85.3, 37.0989],
]

const angleBetween = (a: Vec3, b: Vec3) =>
  (Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180) / Math.PI

describe('globe frame', () => {
  it('scene axes: x = 90 E, y = north, z = 0 E', () => {
    expect(dirFromLatLon(0, 0).map((v) => +v.toFixed(12))).toEqual([0, 0, 1])
    expect(dirFromLatLon(0, 90).map((v) => +v.toFixed(12))).toEqual([1, 0, 0])
    expect(dirFromLatLon(90, 0).map((v) => +v.toFixed(12))).toEqual([0, 1, 0])
    expect(dirFromLatLon(-90, 0)[1]).toBeCloseTo(-1, 12)
  })

  it('lat/lon -> scene direction -> lat/lon round trips', () => {
    for (const [lat, lon] of POINTS) {
      const [la, lo] = latLonFromDir(dirFromLatLon(lat, lon))
      expect(la, `${lat},${lon} lat`).toBeCloseTo(lat, 9)
      expect(normalizeLon(lo - lon) < 180 ? normalizeLon(lo - lon) : normalizeLon(lo - lon) - 360).toBeCloseTo(0, 7)
    }
  })

  it('the scene <-> MOON_ME swap is its own inverse both ways', () => {
    for (const [lat, lon] of POINTS) {
      const me = fromLatLon(lat, lon)
      expect(meFromScene(sceneFromMe(me)).map((v) => +v.toFixed(12))).toEqual(me.map((v) => +v.toFixed(12)))
    }
  })

  it('the model rotation is orthonormal, so its inverse is its transpose', () => {
    for (const m of [modelMatrix('scene'), modelMatrix('me'), modelMatrix('me', 37), modelMatrix('scene', -120)]) {
      const inv = transposeMat3(m)
      for (const [lat, lon] of POINTS) {
        const v = dirFromLatLon(lat, lon)
        const back = applyMat3(inv, applyMat3(m, v))
        // acos loses half the digits next to 1: 1e-5 deg is 0.3 m on the Moon
        expect(angleBetween(v, back)).toBeLessThan(1e-5)
      }
    }
  })

  it('the "me" model rotation puts a MOON_ME-authored model into the scene frame', () => {
    // a model vertex stored in MOON_ME at 0 N 0 E is (1, 0, 0); after the rotation it must face +z
    const placed = applyMat3(modelMatrix('me'), fromLatLon(0, 0))
    expect(placed.map((v) => +v.toFixed(12))).toEqual([0, 0, 1])
    expect(applyMat3(modelMatrix('me'), fromLatLon(90, 0)).map((v) => +v.toFixed(12))).toEqual([0, 1, 0])
  })

  it('a spin of the model turns longitudes, not latitudes', () => {
    const spun = applyMat3(modelMatrix('scene', 90), dirFromLatLon(0, 0))
    const [lat, lon] = latLonFromDir(spun)
    expect(lat).toBeCloseTo(0, 9)
    expect(normalizeLon(lon)).toBeCloseTo(90, 6)
  })

  it('elevation lifts a point along its own direction', () => {
    const p = pointFromLatLon(-89.68643, 197.0629, 1729.2)
    const r = Math.hypot(...p)
    expect(r).toBeCloseTo(GLOBE_RADIUS * (1 + 1729.2 / (MOON_RADIUS_KM * 1000)), 12)
    const [lat, lon] = latLonFromPoint(p)
    expect(lat).toBeCloseTo(-89.68643, 8)
    expect(lon).toBeCloseTo(197.0629, 6)
  })

  it('distanceKm matches the great circle (pole to equator = a quarter circumference)', () => {
    expect(distanceKm(90, 0, 0, 0)).toBeCloseTo((Math.PI / 2) * MOON_RADIUS_KM, 6)
    expect(distanceKm(-89.5, 0, -89.5, 180)).toBeCloseTo(((1 * Math.PI) / 180) * MOON_RADIUS_KM, 6)
  })
})

/**
 * The pick itself: put a camera somewhere, project a known point of the globe to a pixel, then do
 * what the page does with a tap - raycast that pixel at the globe and convert the hit to lat/lon.
 */
describe('pick a pixel on the globe', () => {
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(GLOBE_RADIUS, 256, 128))
  sphere.updateMatrixWorld(true)
  const camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.01, 100)
  const raycaster = new THREE.Raycaster()

  const pick = (ndc: THREE.Vector2) => {
    raycaster.setFromCamera(ndc, camera)
    const hit = raycaster.intersectObject(sphere, false)[0]
    return hit ? latLonFromPoint([hit.point.x, hit.point.y, hit.point.z]) : null
  }

  for (const [lat, lon] of POINTS) {
    it(`a tap on ${lat}, ${lon} comes back as the same point`, () => {
      const d = dirFromLatLon(lat, lon)
      // look at the globe from above that very point, 4 radii out, with an arbitrary roll
      camera.position.set(d[0] * 4, d[1] * 4, d[2] * 4)
      camera.up.set(0.3, 0.9, 0.1).normalize()
      camera.lookAt(0, 0, 0)
      camera.updateMatrixWorld(true)
      const p = new THREE.Vector3(...pointFromLatLon(lat, lon)).project(camera)
      const got = pick(new THREE.Vector2(p.x, p.y))
      expect(got, 'the ray must hit the globe').not.toBeNull()
      // a sphere of 256 x 128 segments is a polyhedron: its facets sit up to ~0.7 deg inside the
      // true sphere, so the hit is within a few km of the point on the sphere - a pin-sized error
      expect(distanceKm(got![0], got![1], lat, lon)).toBeLessThan(5)
    })
  }

  it('a tap on empty sky picks nothing', () => {
    camera.position.set(0, 0, 4)
    camera.up.set(0, 1, 0)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    expect(pick(new THREE.Vector2(0.99, 0.99))).toBeNull()
  })

  it('the near side faces a camera on +z and the south pole is down on the screen', () => {
    camera.position.set(0, 0, 4)
    camera.up.set(0, 1, 0)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    const centre = pick(new THREE.Vector2(0, 0))!
    expect(distanceKm(centre[0], centre[1], 0, 0)).toBeLessThan(5)
    const south = new THREE.Vector3(...pointFromLatLon(-90, 0)).project(camera)
    expect(south.y).toBeLessThan(0)
  })
})
