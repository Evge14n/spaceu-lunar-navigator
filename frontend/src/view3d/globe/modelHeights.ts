// Heights read out of the globe model itself, for points the published grids do not cover.
//
// A GLB that is a sphere with a texture carries no heights: every vertex sits at the same radius
// and this returns null. A displaced model does carry them, at about one vertex per few kilometres,
// which is the resolution this can ever give. So: better than a smooth sphere, far below the 240 m
// polar grid, and always labelled as what it is (GLOBE.md).
//
// Main thread only: it reads three.js geometry once, after the model is on screen, and puts the
// result in the cache of modelGrid.ts, so sheet 04 can send a copy to its worker without loading
// the GLB again (and without pulling three.js into its chunk).

import * as THREE from 'three'
import { latLonFromDir, MOON_RADIUS_M, type Mat3, applyMat3 } from './frame'
import { MIN_RELIEF_M, setModelGrid, type ModelGrid } from './modelGrid'

export type { ModelGrid }

function gridSize(vertices: number): [number, number] {
  if (vertices >= 1_500_000) return [2048, 1024]
  if (vertices >= 400_000) return [1024, 512]
  return [512, 256]
}

/**
 * Read every vertex of the model, turn it into "metres above the 1737.4 km sphere" at its latitude
 * and longitude, and average into an equirectangular grid. `rotation` is the matrix the page uses
 * to put the model into the scene frame, `centre` and `scale` the fit of frame.ts.
 */
export function sampleModelHeights(object: THREE.Object3D, rotation: Mat3, centre: THREE.Vector3, scale: number): ModelGrid | null {
  object.updateWorldMatrix(false, true)
  const inv = new THREE.Matrix4().copy(object.matrixWorld).invert()
  const meshes: THREE.Mesh[] = []
  let vertices = 0
  object.traverse((o) => {
    const m = o as THREE.Mesh
    const pos = m.isMesh ? (m.geometry.getAttribute('position') as THREE.BufferAttribute | undefined) : undefined
    if (pos) {
      meshes.push(m)
      vertices += pos.count
    }
  })
  if (!vertices) {
    setModelGrid(null)
    return null
  }

  const [width, height] = gridSize(vertices)
  const sum = new Float64Array(width * height)
  const count = new Uint32Array(width * height)
  const v = new THREE.Vector3()
  const rel = new THREE.Matrix4()
  let samples = 0
  let minH = Infinity
  let maxH = -Infinity
  // how many vertices sit well off the sphere: one stray vertex is not relief, a landscape is
  let moved = 0
  for (const mesh of meshes) {
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
    rel.copy(inv).multiply(mesh.matrixWorld)
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(rel).sub(centre).multiplyScalar(scale)
      const r = v.length()
      if (!(r > 0)) continue
      const h = (r - 1) * MOON_RADIUS_M
      const [lat, lon] = latLonFromDir(applyMat3(rotation, [v.x / r, v.y / r, v.z / r]))
      const row = Math.min(height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * height)))
      const col = Math.min(width - 1, Math.max(0, Math.floor((lon / 360) * width)))
      sum[row * width + col] += h
      count[row * width + col]++
      samples++
      if (h < minH) minH = h
      if (h > maxH) maxH = h
      if (Math.abs(h) > 100) moved++
    }
  }
  if (!samples) {
    setModelGrid(null)
    return null
  }

  const spreadM = maxH - minH
  if (spreadM < MIN_RELIEF_M || moved < Math.max(8, samples * 0.001)) {
    setModelGrid(null)
    return null
  }

  const data = new Int16Array(width * height)
  const filled = new Uint8Array(width * height)
  for (let i = 0; i < data.length; i++)
    if (count[i]) {
      data[i] = Math.max(-32768, Math.min(32767, Math.round(sum[i] / count[i])))
      filled[i] = 1
    }
  // cells no vertex fell into take the mean of the neighbours they have, a few passes out
  for (let pass = 0; pass < 6; pass++) {
    let left = 0
    const next = filled.slice()
    for (let r = 0; r < height; r++)
      for (let c = 0; c < width; c++) {
        const i = r * width + c
        if (filled[i]) continue
        let s = 0
        let n = 0
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr
            if (rr < 0 || rr >= height) continue
            const cc = (((c + dc) % width) + width) % width
            const j = rr * width + cc
            if (filled[j]) {
              s += data[j]
              n++
            }
          }
        if (n) {
          data[i] = Math.round(s / n)
          next[i] = 1
        } else left++
      }
    filled.set(next)
    if (!left) break
  }

  const grid: ModelGrid = {
    width,
    height,
    data,
    northLat: 90,
    southLat: -90,
    westLon: 0,
    scale: 1,
    offset: 0,
    samples,
    spreadM,
    label: `relief read from the globe model itself (${width} × ${height} grid, about ${((Math.PI * MOON_RADIUS_M) / height / 1000).toFixed(1)} km per sample)`,
  }
  setModelGrid(grid)
  return grid
}
