// Horizons of a band of grid rows for the terrain shadows (terrainShadow.ts). Several of these run at once.
import { horizonGrid } from './terrainShadow'

self.onmessage = (e: MessageEvent) => {
  const { heights, n, stepM, g, nAz, eyeM, row0, row1 } = e.data
  const out = horizonGrid({ n, stepM, heights }, g, nAz, eyeM, row0, row1)
  ;(self as unknown as Worker).postMessage({ row0, out }, [out.buffer])
}
