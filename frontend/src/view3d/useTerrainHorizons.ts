// Horizons for the terrain shadows of one tile, computed once per site in Web Workers.
import { useEffect, useState } from 'react'
import type { Terrain } from '../api'
import type { HorizonGrid } from './terrainShadow'

const SMALL = typeof window !== 'undefined' && window.innerWidth < 700
/** cells per side: 192 x 192 over 10 km = 52 m (phones 128, 78 m); the texture is filtered between them */
export const SHADOW_GRID = SMALL ? 128 : 192
export const SHADOW_AZIMUTHS = 64
/** the ground is tested 2 m up, like the instrument in the timeline (and so a cell does not shade itself) */
export const SHADOW_EYE_M = 2

const cache = new Map<string, Promise<HorizonGrid>>()

function compute(terrain: Terrain): Promise<HorizonGrid> {
  const g = SHADOW_GRID
  const nAz = SHADOW_AZIMUTHS
  const parts = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1))
  const deg = new Float32Array(g * g * nAz)
  const jobs: Promise<void>[] = []
  for (let p = 0; p < parts; p++) {
    const row0 = Math.floor((p * g) / parts)
    const row1 = Math.floor(((p + 1) * g) / parts)
    jobs.push(
      new Promise((resolve, reject) => {
        const w = new Worker(new URL('./terrainShadow.worker.ts', import.meta.url), { type: 'module' })
        w.onmessage = (e) => {
          deg.set(e.data.out, e.data.row0 * g * nAz)
          w.terminate()
          resolve()
        }
        w.onerror = (e) => {
          w.terminate()
          reject(new Error(e.message || 'shadow calculation failed'))
        }
        w.postMessage({ heights: terrain.heights.slice(), n: terrain.meta.n, stepM: terrain.meta.step_m, g, nAz, eyeM: SHADOW_EYE_M, row0, row1 })
      }),
    )
  }
  return Promise.all(jobs).then(() => ({ g, nAz, deg }))
}

/** null while the workers run (a second or so), then the horizons of every cell. */
export function useTerrainHorizons(terrain: Terrain): HorizonGrid | null {
  const key = terrain.meta.site
  const [hz, setHz] = useState<{ key: string; grid: HorizonGrid } | null>(null)
  useEffect(() => {
    let live = true
    let p = cache.get(key)
    if (!p) {
      p = compute(terrain)
      p.catch(() => cache.delete(key))
      cache.set(key, p)
    }
    p.then((grid) => live && setHz({ key, grid }), () => undefined)
    return () => {
      live = false
    }
  }, [key, terrain])
  return hz && hz.key === key ? hz.grid : null
}
