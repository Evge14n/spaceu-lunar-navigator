// The heights read off the globe model, kept for the rest of the session. Deliberately free of
// three.js: sheet 04 imports this to pass the grid to its worker, and must not pull the renderer
// into its chunk. The reading itself is modelHeights.ts, which the globe sheet owns.

import type { EquirectGrid } from './heights'

export interface ModelGrid extends EquirectGrid {
  data: Int16Array
  /** vertices that landed in the grid */
  samples: number
  /** lowest to highest, metres: how much relief the model actually has */
  spreadM: number
}

/** Below this the model is a smooth ball (a textured sphere) and its "heights" are noise. */
export const MIN_RELIEF_M = 300

let cache: ModelGrid | null = null
let tried = false

export const modelGrid = () => cache
export const modelGridTried = () => tried

export function setModelGrid(g: ModelGrid | null) {
  cache = g
  tried = true
}

/** A copy of the grid, safe to transfer to a Worker (the cache keeps its own buffer). */
export function modelGridMessage(): ModelGrid | null {
  return cache ? { ...cache, data: cache.data.slice() } : null
}
