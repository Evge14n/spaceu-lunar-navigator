import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { cameraDistanceFor, cameraPlanes, fitModel, measureMeshes, OUTLIER } from './fit'
import { GLOBE_RADIUS } from './frame'

/** A sphere mesh of `radius` at `at`, named, like one object of an export. */
function ball(name: string, radius: number, at: [number, number, number] = [0, 0, 0], segments = 16) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, segments, segments / 2))
  m.name = name
  m.position.set(...at)
  return m
}

const scene = (...children: THREE.Object3D[]) => {
  const s = new THREE.Group()
  for (const c of children) s.add(c)
  s.updateMatrixWorld(true)
  return s
}

describe('normalising a model to the globe', () => {
  it('scales the Moon to one radius, whatever units the file is in', () => {
    for (const r of [1, 1737.4, 1_737_400, 0.001]) {
      const fit = fitModel(scene(ball('Moon', r)))
      expect(fit.ok).toBe(true)
      expect(fit.chosen).toBe('Moon')
      // a 16-segment ball is a touch inside its true radius; the fit must be within a percent
      expect(Math.abs(fit.radius / r - 1)).toBeLessThan(0.01)
      expect(fit.radius * fit.scale).toBeCloseTo(GLOBE_RADIUS, 6)
    }
  })

  it('an off-centre model gives the centre to subtract', () => {
    const fit = fitModel(scene(ball('Moon', 2, [10, -4, 7])))
    expect(fit.centre.x).toBeCloseTo(10, 3)
    expect(fit.centre.y).toBeCloseTo(-4, 3)
    expect(fit.centre.z).toBeCloseTo(7, 3)
  })

  it('a huge outlier mesh is dropped, and the Moon still fills the frame', () => {
    // the case this is all for: a backdrop 40 times the size of the globe in the same file.
    // Normalising on everything would scale the Moon to 1/40 of the screen - a black stage.
    const backdrop = ball('Backdrop', 40, [0, 0, -30], 8)
    const fit = fitModel(scene(ball('Moon', 1.2), backdrop, ball('Flagpole', 0.05, [1, 0, 0], 6)))
    expect(fit.ok).toBe(true)
    expect(fit.chosen).toBe('Moon')
    expect(fit.meshes.find((m) => m.name === 'Backdrop')?.dropped).toBe(true)
    expect(fit.meshes.find((m) => m.name === 'Moon')?.dropped).toBe(false)
    expect(1.2 * fit.scale).toBeCloseTo(GLOBE_RADIUS, 3)
  })

  it('the largest mesh that is not an outlier wins, even when the small ones outnumber it', () => {
    const fit = fitModel(scene(ball('Moon', 2), ball('a', 1, [3, 0, 0]), ball('b', 1, [-3, 0, 0]), ball('c', 0.9, [0, 3, 0])))
    expect(fit.chosen).toBe('Moon')
    expect(fit.meshes.every((m) => !m.dropped)).toBe(true) // 2 is not 3x the median of 1
  })

  it('the outlier rule is a multiple of the median, not of the largest', () => {
    const fit = fitModel(scene(ball('Moon', 1), ball('small', 1, [4, 0, 0]), ball('sky', OUTLIER * 1 + 0.5, [0, 0, 0], 8)))
    expect(fit.meshes.find((m) => m.name === 'sky')?.dropped).toBe(true)
    expect(fit.chosen).toBe('Moon')
  })

  it('cameras, lights and empties are not measured', () => {
    const s = scene(ball('Moon', 1), new THREE.PerspectiveCamera(), new THREE.DirectionalLight(), new THREE.Object3D())
    expect(measureMeshes(s)).toHaveLength(1)
    expect(fitModel(s).chosen).toBe('Moon')
  })

  it('an empty export falls back instead of drawing nothing', () => {
    // exactly the file we were given: one scene, no nodes, no meshes (132 bytes out of Blender)
    const fit = fitModel(new THREE.Group())
    expect(fit.ok).toBe(false)
    expect(fit.reason).toMatch(/no meshes/)
    expect(fit.triangles).toBe(0)
    // a file with nothing but a camera and a light is the same case
    const lit = fitModel(scene(new THREE.PerspectiveCamera(), new THREE.AmbientLight()))
    expect(lit.ok).toBe(false)
  })

  it('a mesh with no triangles at all does not pass for a globe', () => {
    const empty = new THREE.Mesh(new THREE.BufferGeometry())
    empty.name = 'Empty'
    expect(fitModel(scene(empty)).ok).toBe(false)
  })

  it('a nested, scaled and rotated model is measured in its own units', () => {
    const inner = ball('Moon', 1)
    const holder = new THREE.Group()
    holder.add(inner)
    holder.scale.setScalar(3)
    holder.rotation.set(0.4, 1.1, -0.7)
    holder.position.set(5, 0, 0)
    const fit = fitModel(scene(holder))
    expect(fit.radius).toBeCloseTo(3, 1) // the group's scale counts, the root's placement does not
    expect(fit.radius * fit.scale).toBeCloseTo(GLOBE_RADIUS, 6)
  })

  it('a coarse backdrop is dropped even when it is the only other mesh', () => {
    // two meshes: the median is useless (it sits between them), so the triangle count decides.
    // This is the shape of a real Blender export: Moon + sky dome + camera + light.
    const moon = ball('Moon', 1737400, [3 * 1737400, 0, -2 * 1737400], 128)
    const dome = ball('Backdrop', 40 * 1737400, [0, 0, 0], 8)
    const fit = fitModel(scene(moon, dome, new THREE.PerspectiveCamera(), new THREE.DirectionalLight()))
    expect(fit.chosen).toBe('Moon')
    expect(fit.meshes.find((m) => m.name === 'Backdrop')?.dropped).toBe(true)
    expect(fit.radius).toBeCloseTo(1737400, -1)
    expect(fit.radius * fit.scale).toBeCloseTo(GLOBE_RADIUS, 6)
    // and the centre of the Moon, not of the file, is what gets subtracted
    expect(fit.centre.x).toBeCloseTo(3 * 1737400, -2)
  })

  it('trusts the vertices, not a bounding sphere left on the geometry', () => {
    // GLTFLoader presets boundingSphere from the accessor min/max, i.e. the sphere around the
    // box: 1.73x too big for a ball. Taking it would draw the globe at 58 % of its size.
    const moon = ball('Moon', 1, [0, 0, 0], 64)
    const box = new THREE.Box3().setFromBufferAttribute(moon.geometry.getAttribute('position') as THREE.BufferAttribute)
    moon.geometry.boundingSphere = box.getBoundingSphere(new THREE.Sphere()) // radius sqrt(3)
    const fit = fitModel(scene(moon))
    expect(fit.radius).toBeLessThan(1.02)
    expect(fit.radius * fit.scale).toBeCloseTo(GLOBE_RADIUS, 6)
  })

  it('a globe cut into tiles comes out whole', () => {
    // four caps of the same ball, each a mesh of its own
    const tiles = [0, 1, 2, 3].map((i) => {
      const g = new THREE.SphereGeometry(1, 48, 24, (i * Math.PI) / 2, Math.PI / 2)
      const m = new THREE.Mesh(g)
      m.name = `tile${i}`
      return m
    })
    const fit = fitModel(scene(...tiles))
    expect(fit.ok).toBe(true)
    expect(fit.meshes.every((m) => !m.dropped)).toBe(true)
    expect(fit.radius).toBeGreaterThan(0.98)
    expect(fit.radius).toBeLessThan(1.1)
    expect(Math.hypot(fit.centre.x, fit.centre.y, fit.centre.z)).toBeLessThan(0.1)
  })

  it('counts the triangles of the whole model', () => {
    const fit = fitModel(scene(ball('Moon', 1, [0, 0, 0], 16), ball('a', 0.5, [2, 0, 0], 8)))
    expect(fit.triangles).toBeGreaterThan(200)
  })
})

describe('putting the camera where the globe fits', () => {
  it('a wide window is limited by the height, a tall one by the width', () => {
    const wide = cameraDistanceFor(1, 32, 16 / 9)
    const tall = cameraDistanceFor(1, 32, 9 / 16)
    expect(tall).toBeGreaterThan(wide)
    // the globe is inside the frame both ways: half-angle of the sphere < half the field
    for (const [d, aspect] of [
      [wide, 16 / 9],
      [tall, 9 / 16],
    ]) {
      const halfV = (32 * Math.PI) / 360
      const halfH = Math.atan(Math.tan(halfV) * aspect)
      const seen = Math.asin(1 / d)
      expect(seen).toBeLessThan(halfV)
      expect(seen).toBeLessThan(halfH)
    }
  })

  it('leaves a margin rather than touching the edges', () => {
    const d = cameraDistanceFor(1, 32, 1)
    expect(d).toBeGreaterThan(1 / Math.sin((32 * Math.PI) / 360))
    expect(d).toBeLessThan(1.5 / Math.sin((32 * Math.PI) / 360))
  })

  it('near and far hold the globe, its surface and the stars beyond it', () => {
    const d = cameraDistanceFor(GLOBE_RADIUS, 32, 16 / 9)
    const { near, far } = cameraPlanes(GLOBE_RADIUS, d)
    expect(near).toBeGreaterThan(0)
    expect(near).toBeLessThan(d - GLOBE_RADIUS) // the near side of the globe is in front of us
    expect(far).toBeGreaterThan(d + GLOBE_RADIUS * 20)
    expect(far / near).toBeLessThan(1e5) // depth precision: no z-fighting on the surface
  })
})
