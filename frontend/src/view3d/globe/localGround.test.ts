import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { applyMat3, dirFromLatLon, latLonFromDir, modelMatrix, MOON_RADIUS_M, type Mat3 } from './frame'
import { baseRadiusOf, buildLocalGround, horizonFromGeometry, localBasis, localMatrix } from './localGround'
import { fitModel } from './fit'
import { sampleModelHeights } from './modelHeights'
import { equirectField } from './heights'
import { horizonMaskAt, MASK_STEP_DEG } from './mask'
import { fitLine, IDENTITY_CALIBRATION, calibrateAgainst, SHAPE_R, usable } from './calibrate'
import type { MoonModel } from './modelSource'

const POINTS: [number, number][] = [
  [0, 0],
  [17, 59],
  [-45.5, 212.25],
  [-89.5, 0],
  [60, 359],
]

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

describe('standing at a point: the local frame', () => {
  it('up is the radial direction at that latitude and longitude', () => {
    for (const [lat, lon] of POINTS) {
      const { up } = localBasis(lat, lon)
      const radial = dirFromLatLon(lat, lon)
      expect(dot(up, radial)).toBeCloseTo(1, 12)
      const [la, lo] = latLonFromDir(up)
      expect(la).toBeCloseTo(lat, 9)
      if (Math.abs(lat) < 89.99) expect(Math.abs(((lo - lon + 540) % 360) - 180)).toBeCloseTo(0, 6)
    }
  })

  it('east, north and up are orthonormal and right-handed', () => {
    for (const [lat, lon] of POINTS) {
      const { east, north, up } = localBasis(lat, lon)
      for (const v of [east, north, up]) expect(Math.hypot(...v)).toBeCloseTo(1, 12)
      expect(dot(east, north)).toBeCloseTo(0, 12)
      expect(dot(east, up)).toBeCloseTo(0, 12)
      expect(dot(north, up)).toBeCloseTo(0, 12)
      // east x north = up (a right-handed set on the sphere)
      const c = cross(east, north)
      expect(dot(c, up)).toBeCloseTo(1, 12)
    }
  })

  it('the local matrix sends up to +y, north to -z (south is +z) and east to +x', () => {
    for (const [lat, lon] of POINTS) {
      const M = localMatrix(lat, lon)
      const { east, north, up } = localBasis(lat, lon)
      const near = (v: number[], want: number[]) => v.forEach((x, i) => expect(x).toBeCloseTo(want[i], 9))
      near(applyMat3(M, up), [0, 1, 0])
      near(applyMat3(M, north), [0, 0, -1]) // north is -z, because +z is south
      near(applyMat3(M, east), [1, 0, 0])
    }
  })

  it('north on the globe reads as azimuth 0 and east as 90 in the local frame', () => {
    const [lat, lon] = [-12.5, 143]
    const M = localMatrix(lat, lon)
    const az = (v: number[]) => ((Math.atan2(v[0], -v[2]) * 180) / Math.PI + 360) % 360
    expect(az(applyMat3(M, localBasis(lat, lon).north))).toBeCloseTo(0, 6)
    expect(az(applyMat3(M, localBasis(lat, lon).east))).toBeCloseTo(90, 6)
  })
})

/** A globe model with relief we control: a unit sphere with two Gaussian massifs. */
function syntheticModel(bumps: { lat: number; lon: number; heightM: number; widthDeg: number }[], segments = 320): MoonModel {
  const geo = new THREE.SphereGeometry(1, segments, segments / 2)
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const v = new THREE.Vector3()
  const centres = bumps.map((b) => new THREE.Vector3(...dirFromLatLon(b.lat, b.lon)))
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize()
    let h = 0
    for (let k = 0; k < bumps.length; k++) {
      const angle = (Math.acos(Math.max(-1, Math.min(1, v.dot(centres[k])))) * 180) / Math.PI
      h += bumps[k].heightM * Math.exp(-(angle * angle) / (2 * bumps[k].widthDeg * bumps[k].widthDeg))
    }
    v.multiplyScalar(1 + h / MOON_RADIUS_M)
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  pos.needsUpdate = true
  const mesh = new THREE.Mesh(geo)
  mesh.name = 'Moon'
  const root = new THREE.Group()
  root.add(mesh)
  root.updateMatrixWorld(true)
  const fit = fitModel(root)
  return { object: root, fit, url: 'test://moon.glb', vertices: fit.vertices, spacingM: 0, texture: null }
}

const IDENTITY: Mat3 = modelMatrix('scene', 0)

describe('the ground under your feet', () => {
  const model = syntheticModel([{ lat: 10, lon: 20, heightM: 3000, widthDeg: 4 }])

  it('the model sphere level is found, not assumed', () => {
    // fitModel normalises the highest peak to 1, so the plain of a model with a 3 km massif
    // sits 3 km below that: the sphere level is the median radius, not the fitted one
    // (the peak the fit normalised to 1 is sampled a little off its very top, hence the 4 digits)
    expect(baseRadiusOf(model)).toBeCloseTo(1 - 3000 / MOON_RADIUS_M, 4)
  })

  it('the surface at the point sits at the origin, with the camera 2 m above it', () => {
    const g = buildLocalGround(model, { latDeg: -30, lonDeg: 140, rotation: IDENTITY, calibration: IDENTITY_CALIBRATION, capDeg: 20 })
    const pos = g.geometry.getAttribute('position') as THREE.BufferAttribute
    // the ground straight below the camera is at y = 0 (to a few metres, the size of a triangle)
    let nearest = Infinity
    let nearestY = 0
    for (let i = 0; i < pos.count; i++) {
      const d = Math.hypot(pos.getX(i), pos.getZ(i))
      if (d < nearest) {
        nearest = d
        nearestY = pos.getY(i)
      }
    }
    expect(Math.abs(nearestY)).toBeLessThan(50)
    expect(g.triangles).toBeGreaterThan(100)
    expect(g.keptFraction).toBeLessThan(0.2) // only the cap, not the whole Moon
  })

  it('floating origin: a point of the globe goes to the local frame and back', () => {
    const [lat, lon] = [-30, 140]
    const g = buildLocalGround(model, { latDeg: lat, lonDeg: lon, rotation: IDENTITY, calibration: IDENTITY_CALIBRATION, capDeg: 20 })
    const M = localMatrix(lat, lon)
    const r0 = MOON_RADIUS_M + g.groundM
    const pos = g.geometry.getAttribute('position') as THREE.BufferAttribute
    // invert: local -> globe frame -> latitude and longitude
    const inv: Mat3 = [M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]]
    for (const i of [0, 37, 500, pos.count - 1]) {
      const local = [pos.getX(i), pos.getY(i) + r0, pos.getZ(i)]
      const globe = applyMat3(inv, local as [number, number, number])
      const [la, lo] = latLonFromDir(globe)
      // the vertex must be inside the cap it was kept for, and come back as a real place
      const sep = Math.acos(Math.max(-1, Math.min(1, dot(dirFromLatLon(la, lo), dirFromLatLon(lat, lon)))))
      // a triangle is kept when any corner is inside the cap, so the others may be just outside
      expect((sep * 180) / Math.PI).toBeLessThan(23)
      expect(Math.hypot(...globe) / MOON_RADIUS_M).toBeCloseTo(1, 2)
    }
  })

  it('heights keep their metres: a 3 km massif is 3 km above the plain', () => {
    const g = buildLocalGround(model, { latDeg: 10, lonDeg: 20, rotation: IDENTITY, calibration: IDENTITY_CALIBRATION, capDeg: 15 })
    expect(g.groundM).toBeGreaterThan(2800)
    expect(g.groundM).toBeLessThan(3100)
  })

  it('the calibration rescales the relief it is given', () => {
    const half = { ...IDENTITY_CALIBRATION, scale: 0.5, n: 1000, r: 0.99 }
    const full = buildLocalGround(model, { latDeg: 10, lonDeg: 20, rotation: IDENTITY, calibration: IDENTITY_CALIBRATION, capDeg: 15 })
    const halved = buildLocalGround(model, { latDeg: 10, lonDeg: 20, rotation: IDENTITY, calibration: half, capDeg: 15 })
    // half the relief, give or take the tilt of the kilometre-wide triangle under your feet
    expect(halved.groundM / full.groundM).toBeGreaterThan(0.45)
    expect(halved.groundM / full.groundM).toBeLessThan(0.55)
  })
})

describe('what is drawn and what the HUD computes agree', () => {
  // the same model through both paths: triangles for the eye, a sampled grid for the mask
  const model = syntheticModel([
    { lat: 2, lon: 12, heightM: 4000, widthDeg: 3 },
    { lat: -6, lon: 4, heightM: 2500, widthDeg: 5 },
  ])
  const [lat, lon] = [0, 8]

  it('the skyline of the rendered ground matches the computed mask at three azimuths', () => {
    const grid = sampleModelHeights(model.object, IDENTITY, model.fit.centre, model.fit.scale)
    expect(grid, 'the synthetic model has relief').not.toBeNull()
    const field = equirectField(grid!, 'model')
    const mask = horizonMaskAt(field, lat, lon, 2)
    const ground = buildLocalGround(model, { latDeg: lat, lonDeg: lon, rotation: IDENTITY, calibration: IDENTITY_CALIBRATION, capDeg: 20 })
    const azimuths = [63, 90, 200] // towards the first massif, towards the second, and away
    const drawn = horizonFromGeometry(ground.geometry, azimuths, 2)
    for (let k = 0; k < azimuths.length; k++) {
      const computed = mask.elevationDeg[Math.round(azimuths[k] / MASK_STEP_DEG) % mask.elevationDeg.length]
      // The mask walks a ray over a grid resampled from the model; the picture is the triangles
      // themselves, and a triangle is a flat chord under the sphere, which cuts the skyline a
      // little low. 0.3 deg covers that spread here and still catches a real disagreement.
      expect(Math.abs(drawn[k] - computed), `azimuth ${azimuths[k]}: drawn ${drawn[k].toFixed(3)} vs mask ${computed.toFixed(3)}`).toBeLessThan(0.3)
    }
  })
})

describe('calibrating the model against LOLA', () => {
  it('recovers a scale and an offset that were put in', () => {
    const pairs: [number, number][] = []
    for (let i = 0; i < 500; i++) {
      const x = Math.sin(i) * 9000
      pairs.push([x, 0.33 * x + 120])
    }
    const c = fitLine(pairs)
    expect(c.method).toBe('line')
    expect(c.scale).toBeCloseTo(0.33, 6)
    expect(c.offset).toBeCloseTo(120, 3)
    expect(c.r).toBeCloseTo(1, 6)
    expect(usable(c)).toBe(true)
  })

  it('an exaggerated model is measured as exaggerated', () => {
    const truth = { id: 'lola240' as const, label: 'truth', pixelM: 240, heightAt: (la: number, lo: number) => 2000 * Math.sin(la / 3) + 800 * Math.cos(lo / 5) }
    const exaggerated = { ...truth, id: 'model' as const, label: 'model', heightAt: (la: number, lo: number) => 3 * truth.heightAt(la, lo) }
    const c = calibrateAgainst(exaggerated, truth)
    expect(c.scale).toBeCloseTo(1 / 3, 3)
    expect(c.r).toBeCloseTo(1, 6)
    expect(usable(c)).toBe(true)
  })

  it('shapes that only roughly match still give the exaggeration away', () => {
    // what the real model does: the same landscape, three times too tall, and blurred so much that
    // point by point it barely correlates. The line would be meaningless; the amplitude is not.
    const truth = { id: 'lola240' as const, label: 'truth', pixelM: 240, heightAt: (la: number, lo: number) => 1500 * Math.sin(la / 2) + 1500 * Math.cos(lo / 3) }
    // same kind of landscape and the same spread, three times too tall, but at its own
    // wavelengths - so it barely correlates point by point, exactly like the real model
    const blurred = {
      ...truth,
      id: 'model' as const,
      label: 'model',
      heightAt: (la: number, lo: number) => 3 * (1500 * Math.sin(la * 1.7 + 3.1) + 1500 * Math.cos(lo * 0.9 + 1.3)),
    }
    const c = calibrateAgainst(blurred, truth)
    expect(c.method).toBe('amplitude')
    expect(Math.abs(c.r)).toBeLessThan(SHAPE_R)
    expect(c.scale).toBeGreaterThan(0.28)
    expect(c.scale).toBeLessThan(0.4)
    expect(c.offset).toBe(0)
    expect(usable(c)).toBe(true)
  })

  it('a factor that makes no sense is refused', () => {
    expect(usable({ ...IDENTITY_CALIBRATION, method: 'amplitude', scale: 100, n: 4000 })).toBe(false)
    expect(usable({ ...IDENTITY_CALIBRATION, method: 'line', scale: 0.3, r: 0.1, n: 4000 })).toBe(false)
  })
})
