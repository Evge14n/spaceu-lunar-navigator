import { describe, expect, it } from 'vitest'
import { azEl, enu, horizonMask, sitePos, stereo, type Dem, type Vec3 } from './local'

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]

/** Flat (zero) DEM around the pole with one Gaussian mountain at (lat, lon). */
function demWithMountain(lat: number, lon: number, heightM: number, n = 600, halfKm = 150): Dem {
  const h = new Float32Array(n * n)
  const [mx, my] = stereo(lat, lon)
  const cell = (2 * halfKm) / n
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const x = -halfKm + (c + 0.5) * cell
      const y = halfKm - (r + 0.5) * cell
      const d2 = (x - mx) ** 2 + (y - my) ** 2
      h[r * n + c] = heightM * Math.exp(-d2 / (2 * 3 * 3))
    }
  return { n, x0: -halfKm, x1: halfKm, y0: -halfKm, y1: halfKm, h }
}

describe('local geometry', () => {
  it('from 89.5 S, 0 E the pole is due south and slightly below the level line', () => {
    const f = enu(-89.5, 0)
    const [az, el] = azEl(sub([0, 0, -1737.4], sitePos(-89.5, 0, 0)), f)
    expect(az).toBeCloseTo(180, 3)
    expect(el).toBeLessThan(0)
    expect(el).toBeGreaterThan(-0.3)
  })

  it('east is +90 degrees of azimuth', () => {
    const f = enu(-89.5, 0)
    expect(azEl(f.e, f)[0]).toBeCloseTo(90, 6)
    expect(azEl(f.n, f)[0]).toBeCloseTo(0, 6)
  })

  for (const [mlat, mlon] of [
    [-89, 90],
    [-88.5, 200],
    [-89.8, 300],
  ]) {
    it(`a mountain at ${mlat}, ${mlon} shows up in the mask at its true azimuth`, () => {
      const site: [number, number] = [-89.5, 0]
      const dem = demWithMountain(mlat, mlon, 3000)
      const mask = horizonMask(dem, site[0], site[1], 2, 150, 0.5)
      let peak = 0
      for (let i = 1; i < mask.length; i++) if (mask[i] > mask[peak]) peak = i
      const [azTrue] = azEl(sub(sitePos(mlat, mlon, 3000), sitePos(site[0], site[1], 2)), enu(site[0], site[1]))
      const diff = Math.abs(((peak * 0.5 - azTrue + 540) % 360) - 180)
      expect(diff).toBeLessThan(1.5)
      expect(mask[peak]).toBeGreaterThan(0)
    })
  }

  it('flat ground gives the geometric horizon of a 2 m instrument', () => {
    const dem = demWithMountain(-80, 0, 0) // zero everywhere
    const mask = horizonMask(dem, -89.5, 0, 2)
    expect(mask[0]).toBeCloseTo(-0.0869, 3) // same as the backend on a smooth sphere
  })
})
