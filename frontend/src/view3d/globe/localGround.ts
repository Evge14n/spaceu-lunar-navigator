// Standing on the globe: the model's own triangles around the picked point, turned into the local
// frame of sheet 04 (x = east, y = up, z = south, metres), with the ground under the camera's feet
// at the origin.
//
// Floating origin. Every vertex is transformed in float64 here, once per point, and only then
// written as float32. Near the camera the numbers are small, so nothing is lost; the alternative -
// keeping the globe at its true place and translating in the shader - cancels 1 737 400 against
// 1 737 400 in float32 and wobbles by a quarter of a metre, which at eye level is several degrees.
//
// Only a cap around the point is kept. From 2 m up the horizon of a smooth Moon is 2.4 km away and
// the farthest thing that can clear it is about 150 km out; from a few hundred km up the limb is
// some 34 deg away. A 45 deg cap covers both and is a tenth of the model.
//
// The relief is rescaled by the calibration (calibrate.ts) before anything else, so the ground you
// stand on and the horizon mask behind the HUD come from the same heights.

import * as THREE from 'three'
import { applyMat3, MOON_RADIUS_M, type Mat3 } from './frame'
import type { Calibration } from './calibrate'
import type { MoonModel } from './modelSource'
import type { Vec3 } from '../../api'

export interface LocalGroundOptions {
  latDeg: number
  lonDeg: number
  /** the rotation that puts the model into the scene frame (frame.ts, modelMatrix) */
  rotation: Mat3
  calibration: Calibration
  /** half-angle of the piece of the globe to keep, degrees */
  capDeg?: number
  /** instrument height above the ground, metres (the camera sits here) */
  eyeM?: number
}

export interface LocalGround {
  /** positions (and flat normals) in metres, local frame, ground at the origin */
  geometry: THREE.BufferGeometry
  /** height of the ground at the point above the 1737.4 km sphere, metres */
  groundM: number
  triangles: number
  capDeg: number
  /** radius of the model's sphere level in its own fitted units (what relief is measured from) */
  baseRadius: number
  /** how much of the model was kept */
  keptFraction: number
}

/** Rows of the matrix that takes a direction in the globe's scene frame to the local frame. */
export function localBasis(latDeg: number, lonDeg: number): { east: Vec3; up: Vec3; north: Vec3 } {
  const p = (latDeg * Math.PI) / 180
  const l = (lonDeg * Math.PI) / 180
  // MOON_ME (docs/BROWSER_COMPUTE.md), then the cyclic swap of meToScene: [x, y, z] -> [y, z, x]
  const me = {
    east: [-Math.sin(l), Math.cos(l), 0] as Vec3,
    north: [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)] as Vec3,
    up: [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)] as Vec3,
  }
  const toScene = (v: Vec3): Vec3 => [v[1], v[2], v[0]]
  return { east: toScene(me.east), north: toScene(me.north), up: toScene(me.up) }
}

/**
 * Globe frame -> local frame (x east, y up, z south), as a row-major 3 x 3.
 * Right-handed: east x up = -north = south, which is +z here.
 */
export function localMatrix(latDeg: number, lonDeg: number): Mat3 {
  const { east, up, north } = localBasis(latDeg, lonDeg)
  return [east[0], east[1], east[2], up[0], up[1], up[2], -north[0], -north[1], -north[2]]
}

function multiply(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9).fill(0) as number[]
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]
  return out as Mat3
}

interface MeshPart {
  pos: THREE.BufferAttribute
  index: THREE.BufferAttribute | null
  rel: THREE.Matrix4
}

function parts(model: MoonModel): MeshPart[] {
  const root = model.object
  root.updateWorldMatrix(false, true)
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const keep = new Set(model.fit.meshes.filter((m) => !m.dropped).map((m) => m.name))
  const out: MeshPart[] = []
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    if (keep.size && !keep.has(mesh.name || '(unnamed)')) return
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!pos) return
    out.push({ pos, index: mesh.geometry.getIndex(), rel: new THREE.Matrix4().copy(inv).multiply(mesh.matrixWorld) })
  })
  return out
}

/** The model's sphere level: the median radius of its vertices, in fitted units. */
export function baseRadiusOf(model: MoonModel, samples = 20_000): number {
  const radii: number[] = []
  const v = new THREE.Vector3()
  for (const part of parts(model)) {
    const stride = Math.max(1, Math.floor(part.pos.count / Math.max(1, samples / 2)))
    for (let i = 0; i < part.pos.count; i += stride) {
      v.fromBufferAttribute(part.pos, i).applyMatrix4(part.rel).sub(model.fit.centre).multiplyScalar(model.fit.scale)
      radii.push(v.length())
    }
  }
  if (!radii.length) return 1
  radii.sort((a, b) => a - b)
  return radii[radii.length >> 1]
}

/**
 * Build the ground. The heavy loop is plain arithmetic on doubles: transform, rescale the relief,
 * drop what is outside the cap, write float32 triples.
 */
export function buildLocalGround(model: MoonModel, opts: LocalGroundOptions): LocalGround {
  const capDeg = opts.capDeg ?? 45
  const cosCap = Math.cos((capDeg * Math.PI) / 180)
  const base = baseRadiusOf(model)
  const cal = opts.calibration
  const M = multiply(localMatrix(opts.latDeg, opts.lonDeg), opts.rotation)
  const { centre, scale } = model.fit

  // local direction of each vertex and its true radius in metres
  const v = new THREE.Vector3()
  const radiusOf = (part: MeshPart, i: number): { x: number; y: number; z: number; r: number } => {
    v.fromBufferAttribute(part.pos, i).applyMatrix4(part.rel).sub(centre).multiplyScalar(scale)
    const w = applyMat3(M, [v.x, v.y, v.z])
    const rho = Math.hypot(w[0], w[1], w[2]) || 1
    const hModel = (rho / base - 1) * MOON_RADIUS_M
    const r = MOON_RADIUS_M + cal.scale * hModel + cal.offset
    return { x: w[0] / rho, y: w[1] / rho, z: w[2] / rho, r }
  }

  const px: number[] = []
  let kept = 0
  let total = 0
  // the surface straight above the Moon's centre at this point: where the camera's feet go
  let groundR = Number.NaN

  for (const part of parts(model)) {
    const count = part.index ? part.index.count : part.pos.count
    total += count / 3
    const idx = part.index
    const cache = new Map<number, { x: number; y: number; z: number; r: number }>()
    const at = (i: number) => {
      let c = cache.get(i)
      if (!c) {
        c = radiusOf(part, i)
        if (cache.size > 300_000) cache.clear()
        cache.set(i, c)
      }
      return c
    }
    for (let t = 0; t < count; t += 3) {
      const ia = idx ? idx.getX(t) : t
      const ib = idx ? idx.getX(t + 1) : t + 1
      const ic = idx ? idx.getX(t + 2) : t + 2
      const a = at(ia)
      const b = at(ib)
      const c = at(ic)
      if (a.y < cosCap && b.y < cosCap && c.y < cosCap) continue // the whole triangle is over the horizon
      kept++
      const A = [a.x * a.r, a.y * a.r, a.z * a.r]
      const B = [b.x * b.r, b.y * b.r, b.z * b.r]
      const C = [c.x * c.r, c.y * c.r, c.z * c.r]
      if (!Number.isFinite(groundR)) {
        const hit = rayUp(A, B, C)
        if (hit !== null) groundR = hit
      }
      px.push(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2])
    }
  }

  const groundM = (Number.isFinite(groundR) ? groundR : MOON_RADIUS_M) - MOON_RADIUS_M
  const r0 = MOON_RADIUS_M + groundM
  // the shift is the floating origin: done here, in doubles, never in the shader
  const positions = new Float32Array(px.length)
  for (let i = 0; i < px.length; i += 3) {
    positions[i] = px[i]
    positions[i + 1] = px[i + 1] - r0
    positions[i + 2] = px[i + 2]
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.computeVertexNormals() // not indexed, so these are flat: honest for kilometre triangles
  geometry.computeBoundingSphere()

  return { geometry, groundM, triangles: kept, capDeg, baseRadius: base, keptFraction: total ? kept / total : 0 }
}

/** Where the ray from the Moon's centre straight up meets this triangle, or null. */
function rayUp(a: number[], b: number[], c: number[]): number | null {
  // Moeller-Trumbore with origin (0,0,0) and direction (0,1,0)
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  // cross(dir, e2) with dir = (0,1,0) -> (e2[2]*1 - 0, 0, -e2[0])
  const p = [e2[2], 0, -e2[0]]
  const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2]
  if (Math.abs(det) < 1e-9) return null
  const invDet = 1 / det
  const tv = [-a[0], -a[1], -a[2]]
  const u = (tv[0] * p[0] + tv[1] * p[1] + tv[2] * p[2]) * invDet
  if (u < 0 || u > 1) return null
  const q = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]]
  const vv = q[1] * invDet // dot(dir, q) with dir = (0,1,0)
  if (vv < 0 || u + vv > 1) return null
  const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * invDet
  return t > 0 ? t : null
}

/**
 * The skyline of the ground as the camera sees it: for each azimuth, the highest angle at which a
 * ray from the eye still hits the ground. Rays, not vertices - vertices kilometres apart leave
 * gaps in any narrow direction. This is what the drawn picture shows, so it can be held against
 * the mask the HUD uses (localGround.test.ts).
 */
export function horizonFromGeometry(
  geometry: THREE.BufferGeometry,
  azimuthsDeg: number[],
  eyeM = 2,
  range: { lowDeg?: number; highDeg?: number; steps?: number } = {},
): number[] {
  const low = range.lowDeg ?? -6
  const high = range.highDeg ?? 12
  const steps = range.steps ?? 22
  const mesh = new THREE.Mesh(geometry)
  mesh.updateMatrixWorld(true)
  const raycaster = new THREE.Raycaster()
  raycaster.far = 2_000_000
  const origin = new THREE.Vector3(0, eyeM, 0)
  const dir = new THREE.Vector3()
  const hits = (azDeg: number, elDeg: number) => {
    const a = (azDeg * Math.PI) / 180
    const e = (elDeg * Math.PI) / 180
    // docs/ARCHITECTURE.md: x = cosE sinA, y = sinE, z = -cosE cosA
    dir.set(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a))
    raycaster.set(origin, dir)
    return raycaster.intersectObject(mesh, false).length > 0
  }
  return azimuthsDeg.map((az) => {
    if (!hits(az, low)) return low // nothing in this direction at all
    let lo = low
    let hi = high
    for (let i = 0; i < steps; i++) {
      const mid = (lo + hi) / 2
      if (hits(az, mid)) lo = mid
      else hi = mid
    }
    return (lo + hi) / 2
  })
}
