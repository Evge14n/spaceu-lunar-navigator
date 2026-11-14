import { useMemo, useState } from 'react'
import {
  API_URL,
  customId,
  formatHours,
  getIlluminationLayer,
  summarize,
  timesMs,
  useAsync,
  useSites,
  useTimeline,
} from '../api'
import { clampPeriod, siteLabel } from '../components/Controls'
import { Notice } from '../components/Notice'
import { hrefFor, useAppState } from '../state'

const R_KM = 1737.4

/** South polar stereographic, km. x towards 90 E, y towards 0 E (same as the LOLA polar products). */
export function project(lat: number, lon: number): [number, number] {
  const rho = 2 * R_KM * Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)
  const l = (lon * Math.PI) / 180
  return [rho * Math.sin(l), rho * Math.cos(l)]
}

export function unproject(x: number, y: number): [number, number] {
  const rho = Math.hypot(x, y)
  const lat = (2 * Math.atan(rho / (2 * R_KM)) - Math.PI / 2) * (180 / Math.PI)
  const lon = (Math.atan2(x, y) * 180) / Math.PI
  return [lat, lon]
}

export default function MapPage() {
  const { siteId, setSite, from, to } = useAppState()
  const sites = useSites()
  const layer = useAsync(getIlluminationLayer, [])
  const tl = useTimeline(siteId && !siteId.startsWith('custom:') ? siteId : null)
  const [pick, setPick] = useState<{ lat: string; lon: string }>({ lat: '-89.5', lon: '0' })

  const list = useMemo(() => (sites.data ?? []).filter((s) => s.lat !== null && s.lon !== null), [sites.data])
  const extent = useMemo(() => {
    if (layer.data) {
      const { x_km, y_km } = layer.data.meta
      return Math.max(Math.abs(x_km[0]), Math.abs(x_km[1]), Math.abs(y_km[0]), Math.abs(y_km[1]))
    }
    const far = list.reduce((m, s) => Math.max(m, Math.hypot(...project(s.lat!, s.lon!))), 0)
    return Math.max(40, far * 1.18)
  }, [list, layer.data])

  const site = list.find((s) => s.id === siteId)
  const sum = useMemo(() => {
    if (!tl.data || !site) return null
    const [f, e] = clampPeriod(from, to, timesMs(tl.data))
    return summarize(tl.data, { id: site.id, name: site.name }, f, e)
  }, [tl.data, site, from, to])

  const E = extent
  const rings = [89, 88, 87, 86, 85, 84, 82, 80].filter((lat) => Math.hypot(...project(-lat, 0)) < E)
  const spokes = Array.from({ length: 12 }, (_, i) => i * 30)

  const onMapClick = (ev: React.MouseEvent<SVGSVGElement>) => {
    if ((ev.target as Element).closest('.marker')) return
    const svg = ev.currentTarget
    const pt = svg.createSVGPoint()
    pt.x = ev.clientX
    pt.y = ev.clientY
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse())
    const [lat, lon] = unproject(p.x, -p.y)
    setPick({ lat: lat.toFixed(4), lon: lon.toFixed(3) })
  }

  const lat = Number(pick.lat)
  const lon = Number(pick.lon)
  const validPick = Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= -60 && lon >= -180 && lon <= 360
  const [px, py] = validPick ? project(lat, lon) : [0, 0]

  return (
    <div className="page map">
      <div className="page-head">
        <h1>South pole</h1>
        <p className="lede">Seen from above, 0° longitude at the top. Pick a candidate site, or click anywhere to read coordinates.</p>
      </div>
      {sites.loading && <div className="skeleton map-skeleton" aria-busy="true" />}
      {!sites.loading && (
        <div className="map-layout">
          <figure className="map-figure">
            <svg viewBox={`${-E} ${-E} ${2 * E} ${2 * E}`} style={{ fontSize: E * 0.036 }} onClick={onMapClick} role="group" aria-label="Map of the lunar south pole with landing sites">
              <defs>
                <clipPath id="disc">
                  <rect x={-E} y={-E} width={2 * E} height={2 * E} />
                </clipPath>
              </defs>
              <rect x={-E} y={-E} width={2 * E} height={2 * E} className="map-bg" />
              {layer.data && (
                <image
                  href={layer.data.url}
                  x={layer.data.meta.x_km[0]}
                  y={-layer.data.meta.y_km[1]}
                  width={layer.data.meta.x_km[1] - layer.data.meta.x_km[0]}
                  height={layer.data.meta.y_km[1] - layer.data.meta.y_km[0]}
                  preserveAspectRatio="none"
                />
              )}
              <g className="graticule" clipPath="url(#disc)">
                {rings.map((lat) => {
                  const r = Math.hypot(...project(-lat, 0))
                  return (
                    <g key={lat}>
                      <circle r={r} />
                      <text x={r * 0.71 + E * 0.01} y={-r * 0.71} className="grat-label">{lat}° S</text>
                    </g>
                  )
                })}
                {spokes.map((l) => {
                  const [x, y] = project(-60, l)
                  const [lx, ly] = project(-90 + (Math.atan(E * 0.93 / (2 * R_KM)) * 360) / Math.PI, l)
                  return (
                    <g key={l}>
                      <line x1={0} y1={0} x2={x} y2={-y} />
                      <text x={lx} y={-ly} className="grat-label" textAnchor="middle" dominantBaseline="middle">
                        {l > 180 ? `${360 - l}° W` : l === 180 || l === 0 ? `${l}°` : `${l}° E`}
                      </text>
                    </g>
                  )
                })}
                <circle r={E * 0.008} className="pole" />
              </g>
              {validPick && (
                <g className="pick" transform={`translate(${px} ${-py})`} aria-hidden="true">
                  <line x1={-E * 0.025} x2={E * 0.025} y1={0} y2={0} />
                  <line y1={-E * 0.025} y2={E * 0.025} x1={0} x2={0} />
                </g>
              )}
              {list.map((s) => {
                const [x, y] = project(s.lat!, s.lon!)
                const on = s.id === siteId
                return (
                  <g
                    key={s.id}
                    className={`marker${on ? ' on' : ''}`}
                    transform={`translate(${x} ${-y})`}
                    role="button"
                    tabIndex={0}
                    aria-pressed={on}
                    aria-label={siteLabel(s)}
                    onClick={() => setSite(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setSite(s.id)
                      }
                    }}
                  >
                    <circle r={E * 0.045} className="hit" />
                    <circle r={E * (on ? 0.02 : 0.014)} className="dot" />
                    <text x={E * 0.03} y={E * 0.012} className="marker-label">{s.name}</text>
                  </g>
                )
              })}
            </svg>
            <figcaption>
              {layer.data
                ? `Colour layer: average illumination, ${layer.data.meta.source ?? 'LOLA (PGDA)'}.`
                : 'Illumination layer will appear here when data/illumination.png is published.'}{' '}
              Polar stereographic projection, R = 1737.4 km.
            </figcaption>
          </figure>

          <aside className="side">
            {site ? (
              <section className="site-card" aria-live="polite">
                <h2>{site.name}</h2>
                <p className="coord">
                  {Math.abs(site.lat!).toFixed(4)}° S, {site.lon!.toFixed(4)}° E
                  {site.elevation_m !== null && ` · ${Math.round(site.elevation_m)} m`}
                </p>
                {sum ? (
                  <dl className="mini">
                    <dt>Sunlit</dt><dd>{sum.sun.lit_percent} %</dd>
                    <dt>Longest darkness</dt><dd>{formatHours(sum.sun.longest_dark_h)}</dd>
                    <dt>Earth visible</dt><dd>{sum.earth.visible_percent} %</dd>
                  </dl>
                ) : tl.error ? (
                  <p className="muted">No timeline yet: {tl.error.message}</p>
                ) : (
                  <div className="skeleton line-skeleton" />
                )}
                <p className="muted small">For the selected period. Source: {site.source}</p>
                <div className="actions">
                  <a className="btn" href={hrefFor('/timeline')}>Open timeline</a>
                  <a className="btn ghost" href={hrefFor('/3d')}>3D view</a>
                </div>
              </section>
            ) : (
              <Notice title="Select a site on the map" />
            )}

            <form
              className="custom"
              onSubmit={(e) => {
                e.preventDefault()
                if (validPick && API_URL) {
                  setSite(customId(lat, lon))
                  window.location.hash = hrefFor('/timeline').slice(1)
                }
              }}
            >
              <h2>Your own coordinates</h2>
              <div className="row">
                <div className="field">
                  <label htmlFor="clat">Latitude</label>
                  <input id="clat" inputMode="decimal" value={pick.lat} onChange={(e) => setPick({ ...pick, lat: e.target.value })} aria-invalid={!validPick} />
                </div>
                <div className="field">
                  <label htmlFor="clon">Longitude (east)</label>
                  <input id="clon" inputMode="decimal" value={pick.lon} onChange={(e) => setPick({ ...pick, lon: e.target.value })} aria-invalid={!validPick} />
                </div>
              </div>
              {!validPick && <p className="err">Latitude between -90 and -60, longitude between -180 and 360.</p>}
              <button className="btn" type="submit" disabled={!validPick || !API_URL}>
                Compute for this point
              </button>
              {!API_URL && <p className="muted small">Needs the live API, which is off in this build. Listed sites work without it.</p>}
            </form>
          </aside>
        </div>
      )}
    </div>
  )
}
