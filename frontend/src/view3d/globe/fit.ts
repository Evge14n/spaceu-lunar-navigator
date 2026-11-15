// Making a loaded GLB into the globe: which mesh is the Moon, how much to scale it, where to put
// the camera. Separate from the scene because it is the part that goes wrong with a real file and
// the part worth testing (fit.test.ts).
//
// Why not the whole scene: an export often carries more than the globe - a camera, a light, an
// empty, a sky dome, a backdrop plane, a stray cube. The bounding box of everything would scale
// the Moon down to a dot inside it. So every mesh is measured on its own and two rules throw the
// rest away: a mesh much larger than the median of the others is not the globe, and neither is a
// mesh with almost no triangles (a sky dome is huge and coarse, a globe is the detailed thing in
// the file). What is left is normalised together, so a globe cut into tiles still comes out whole.

import * as THREE from 'three'
import { GLOBE_RADIUS } from './frame'

export interface MeshFit {
  name: string
  triangles: number
  /** bounding sphere of this mesh alone, in the model's own units */
  radius: number
  centre: [number, number, number]
  box: { min: [number, number, number]; max: [number, number, number] }
  /** dropped as an outlier (more than OUTLIER x the median radius) */
  dropped: boolean
}

export interface ModelFit {
  /** is there a mesh we can show at all? */
  ok: boolean
  /** why not, for the notice on the page */
  reason: string | null
  /** multiply the model by this and its radius becomes GLOBE_RADIUS */
  scale: number
  /** centre of the chosen mesh, in the model's own units, to be subtracted before scaling */
  centre: THREE.Vector3
  /** radius of the chosen mesh, in the model's own units */
  radius: number
  chosen: string | null
  meshes: MeshFit[]
  triangles: number
}

/** A mesh whose bounding sphere is more than this many times the median is not the globe. */
export const OUTLIER = 3
/** Nor is a mesh with less than this share of the triangles of the most detailed one. */
export const MIN_TRIANGLE_SHARE = 0.02

const triple = (v: THREE.Vector3): [number, number, number] => [v.x, v.y, v.z]

interface Measured {
  info: MeshFit
  mesh: THREE.Mesh
  /** the mesh's transform relative to the root of the model */
  rel: THREE.Matrix4
}

function collect(object: THREE.Object3D): Measured[] {
  object.updateWorldMatrix(false, true)
  const inv = new THREE.Matrix4().copy(object.matrixWorld).invert()
  const out: Measured[] = []
  object.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return // cameras, lights, bones and empties measure nothing
    const pos = mesh.geometry?.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!pos || pos.count === 0) return
    const index = mesh.geometry.getIndex()
    const rel = new THREE.Matrix4().copy(inv).multiply(mesh.matrixWorld)
    const box = new THREE.Box3().setFromBufferAttribute(pos).applyMatrix4(rel)
    // The sphere has to come from the vertices, not from the box: the sphere around the box of a
    // ball is 1.73 times too big, and the globe would be drawn at 58 % of the frame it should
    // fill. GLTFLoader presets boundingSphere from the accessor min/max, which is exactly that
    // box, so recompute it here instead of trusting it.
    mesh.geometry.computeBoundingSphere()
    const sphere = (mesh.geometry.boundingSphere ?? box.getBoundingSphere(new THREE.Sphere())).clone().applyMatrix4(rel)
    out.push({
      mesh,
      rel,
      info: {
        name: mesh.name || '(unnamed)',
        triangles: Math.round((index ? index.count : pos.count) / 3),
        radius: sphere.radius,
        centre: triple(sphere.center),
        box: { min: triple(box.min), max: triple(box.max) },
        dropped: false,
      },
    })
  })
  return out
}

/** Measure every mesh of the model on its own, in the model's own coordinates. */
export function measureMeshes(object: THREE.Object3D): MeshFit[] {
  return collect(object).map((m) => m.info)
}

/** Exact radius around `centre` over the vertices of these meshes (tight for several meshes). */
function radiusAround(items: Measured[], centre: THREE.Vector3): number {
  const v = new THREE.Vector3()
  let max = 0
  for (const { mesh, rel } of items) {
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const d = v.fromBufferAttribute(pos, i).applyMatrix4(rel).distanceTo(centre)
      if (d > max) max = d
    }
  }
  return max
}

/**
 * The globe is the largest mesh that is not an outlier; everything else is ignored.
 * With no mesh at all (an empty export, a file of cameras and lights) `ok` is false and the page
 * falls back to the plain sphere.
 */
export function fitModel(object: THREE.Object3D): ModelFit {
  const items = collect(object)
  const meshes = items.map((m) => m.info)
  const triangles = meshes.reduce((s, m) => s + m.triangles, 0)
  const empty = {
    ok: false as const,
    scale: 1,
    centre: new THREE.Vector3(),
    radius: 0,
    chosen: null,
    meshes,
    triangles,
  }
  if (!meshes.length) return { ...empty, reason: 'the model has no meshes in it' }

  const radii = meshes.map((m) => m.radius).sort((a, b) => a - b)
  const mid = radii.length >> 1
  const median = radii.length % 2 ? radii[mid] : (radii[mid - 1] + radii[mid]) / 2
  const maxTriangles = meshes.reduce((t, m) => Math.max(t, m.triangles), 0)
  const kept: Measured[] = []
  for (const item of items) {
    const m = item.info
    const usable = m.radius > 0 && Number.isFinite(m.radius) && m.triangles > 0
    const huge = median > 0 && m.radius > OUTLIER * median
    const sparse = maxTriangles > 0 && m.triangles < MIN_TRIANGLE_SHARE * maxTriangles && m.radius > median
    m.dropped = !usable || huge || sparse
    if (!m.dropped) kept.push(item)
  }
  if (!kept.length) return { ...empty, reason: 'no mesh of the model has a size we can use' }

  const biggest = kept.reduce((a, b) => (b.info.radius > a.info.radius ? b : a))
  let centre = new THREE.Vector3(...biggest.info.centre)
  let radius = biggest.info.radius
  if (kept.length > 1) {
    // a globe cut into tiles: the middle of everything kept, then the true distance to the
    // farthest vertex. Adding up per-mesh spheres would come out about twice too big, because
    // the sphere of a tile is centred on its box, not on the globe.
    const box = new THREE.Box3()
    for (const k of kept) box.union(new THREE.Box3(new THREE.Vector3(...k.info.box.min), new THREE.Vector3(...k.info.box.max)))
    centre = box.getCenter(new THREE.Vector3())
    radius = radiusAround(kept, centre)
  }

  return {
    ok: true,
    reason: null,
    scale: GLOBE_RADIUS / radius,
    centre,
    radius,
    chosen: biggest.info.name,
    meshes,
    triangles,
  }
}

/**
 * How far the camera has to be for a sphere of `radius` to fit in the frame, both ways.
 * On a phone held upright the width is the tight one, so the horizontal field is checked too.
 */
export function cameraDistanceFor(radius: number, fovDeg: number, aspect: number, margin = 1.18): number {
  const vFov = (fovDeg * Math.PI) / 180
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(aspect, 0.001))
  const d = Math.max(radius / Math.sin(vFov / 2), radius / Math.sin(hFov / 2))
  return d * margin
}

/** Near and far planes for a globe of this radius: close enough to zoom in, far enough for stars. */
export function cameraPlanes(radius: number, distance: number): { near: number; far: number } {
  return { near: Math.max(radius / 500, (distance - radius) / 100), far: distance * 20 + radius * 40 }
}
