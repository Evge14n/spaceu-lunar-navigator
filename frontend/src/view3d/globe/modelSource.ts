// The globe model, loaded once per session and shared by both sheets: the globe (#/globe draws it)
// and the 3D view (#/horizon stands on it for a custom point, building its own local geometry from
// the same triangles). Keeping one copy means a direct link to a custom point still works - the
// file is fetched here, from the browser cache if the globe sheet already had it.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { fitModel, sampleSpacingM, type ModelFit } from './fit'
import { fileExists } from './heights'

const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/?$/, '/')
export const MODEL_URLS = [`${BASE}moon/moon.glb`, `${BASE}models/moon.glb`]

export interface MoonModel {
  object: THREE.Object3D
  fit: ModelFit
  url: string
  /** vertices of the meshes that make up the globe */
  vertices: number
  /** mean distance between those vertices on the ground, metres (measured, see fit.ts) */
  spacingM: number
  /** the model's own colour map, if it has one: the local ground borrows it */
  texture: THREE.Texture | null
}

export type ModelLoad = { ok: true; model: MoonModel } | { ok: false; reason: string }

let promise: Promise<ModelLoad> | null = null
let cached: ModelLoad | null = null

export const moonModelCached = (): ModelLoad | null => cached

async function firstThatExists(urls: string[]): Promise<string | null> {
  for (const url of urls) if (await fileExists(url)) return url
  return null
}

function firstTexture(object: THREE.Object3D): THREE.Texture | null {
  let found: THREE.Texture | null = null
  object.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (found || !mesh.isMesh) return
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const map = (m as THREE.MeshStandardMaterial).map
      if (map) {
        found = map
        return
      }
    }
  })
  return found
}

/** Load (or hand back) the model. Never throws: the callers fall back to a plain sphere. */
export function loadMoonModel(): Promise<ModelLoad> {
  if (!promise) {
    promise = (async (): Promise<ModelLoad> => {
      const url = await firstThatExists(MODEL_URLS)
      if (!url) return { ok: false, reason: 'no model file yet' }
      try {
        const loader = new GLTFLoader()
        loader.setMeshoptDecoder(MeshoptDecoder)
        // three ships the Draco decoder and the build emits it; fetched only if the model needs it
        const draco = new DRACOLoader()
        loader.setDRACOLoader(draco)
        const gltf = await loader.loadAsync(url)
        draco.dispose()
        const fit = fitModel(gltf.scene)
        if (!fit.ok) return { ok: false, reason: fit.reason ?? 'the model has nothing to draw' }
        return {
          ok: true,
          model: {
            object: gltf.scene,
            fit,
            url,
            vertices: fit.vertices,
            spacingM: sampleSpacingM(fit.vertices),
            texture: firstTexture(gltf.scene),
          },
        }
      } catch (e) {
        return { ok: false, reason: (e as Error).message || 'the model could not be read' }
      }
    })()
    promise.then((r) => (cached = r))
  }
  return promise
}
