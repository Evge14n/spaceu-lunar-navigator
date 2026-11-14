// 360° panorama of the horizon: terrain silhouette from the horizon mask, the Sun and the Earth
// at the selected moment, and the Sun's path over the period. Vertical scale is stretched.

import { useMemo } from 'react'
import type { Horizon, Sky, Timeline } from '../api'

const W = 720
const H = 170

export function HorizonPanorama({
  horizon,
  sky,
  tl,
  i0,
  i1,
}: {
  horizon: Horizon
  sky: Sky
  tl: Timeline
  i0: number
  i1: number
}) {
  const { lo, hi, path, sunPath, earthPath } = useMemo(() => {
    const hz = horizon.elevation_deg
    let lo = Math.min(...hz, -2)
    let hi = Math.max(...hz, 3)
    for (let i = i0; i <= i1; i++) {
      hi = Math.max(hi, tl.sun.el[i], tl.earth.el[i])
      lo = Math.min(lo, tl.earth.el[i])
    }
    lo = Math.floor(lo - 0.5)
    hi = Math.ceil(hi + 1)
    const y = (e: number) => H - ((e - lo) / (hi - lo)) * H
    const step = W / hz.length
    let d = `M0 ${H}`
    hz.forEach((e, k) => (d += ` L${(k * step).toFixed(1)} ${y(e).toFixed(1)}`))
    d += ` L${W} ${y(hz[0]).toFixed(1)} L${W} ${H} Z`
    const track = (az: number[], el: number[]) => {
      let p = ''
      let prevX = -1
      for (let i = i0; i <= i1; i += Math.max(1, Math.floor((i1 - i0) / 400))) {
        const x = (az[i] / 360) * W
        p += `${prevX < 0 || Math.abs(x - prevX) > W / 2 ? 'M' : 'L'}${x.toFixed(1)} ${y(el[i]).toFixed(1)} `
        prevX = x
      }
      return p
    }
    return { lo, hi, path: d, sunPath: track(tl.sun.az, tl.sun.el), earthPath: track(tl.earth.az, tl.earth.el) }
  }, [horizon, tl, i0, i1])

  const y = (e: number) => H - ((e - lo) / (hi - lo)) * H
  const x = (az: number) => (az / 360) * W
  const pxPerDeg = H / (hi - lo)
  const ticks = []
  for (let e = Math.ceil(lo); e <= hi; e += hi - lo > 10 ? 2 : 1) ticks.push(e)

  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`-28 -4 ${W + 36} ${H + 26}`} role="img" aria-label={`Horizon panorama. Sun at azimuth ${sky.sun.az.toFixed(0)}°, Earth at azimuth ${sky.earth.az.toFixed(0)}°`}>
        {ticks.map((e) => (
          <g key={e}>
            <line x1={0} x2={W} y1={y(e)} y2={y(e)} className={e === 0 ? 'pano-zero' : 'pano-grid'} />
            <text x={-6} y={y(e) + 3.5} textAnchor="end" className="pano-tick">{e}°</text>
          </g>
        ))}
        <path d={path} className="pano-ground" />
        <path d={sunPath} className="pano-track-sun" />
        <path d={earthPath} className="pano-track-earth" />
        <circle cx={x(sky.earth.az)} cy={y(sky.earth.el)} r={Math.max(3, sky.earth.angular_radius_deg * pxPerDeg)} className={`pano-earth${sky.earth.visible ? '' : ' hidden'}`} />
        <circle cx={x(sky.sun.az)} cy={y(sky.sun.el)} r={Math.max(3, sky.sun.angular_radius_deg * pxPerDeg)} className={`pano-sun${sky.sun.visible_fraction > 0 ? '' : ' hidden'}`} />
        {[['N 0°', 0], ['E 90°', 90], ['S 180°', 180], ['W 270°', 270], ['N 360°', 360]].map(([l, az]) => (
          <text key={`${l}${az}`} x={x(az as number)} y={H + 16} textAnchor={(az as number) === 0 ? 'start' : (az as number) === 360 ? 'end' : 'middle'} className="pano-dir">{l}</text>
        ))}
      </svg>
      <figcaption className="small muted" style={{ marginTop: 6 }}>
        Horizon all around the site (vertical scale stretched). Dotted lines: paths of the Sun and the Earth over the next 30 days. A faded disc is behind the terrain.
      </figcaption>
    </figure>
  )
}
