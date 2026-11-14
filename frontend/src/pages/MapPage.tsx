import { useEffect, useMemo, useRef, useState } from 'react'
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
  type Site,
} from '../api'
import { clampPeriod, siteLabel } from '../components/Controls'
import { Notice } from '../components/Notice'
import { useAppState } from '../state'

const R_KM = 1737.4

/** South polar stereographic, km. x towards 90 E, y towards 0 E (same as the LOLA polar products). */
export function project(lat: number, lon: number): [number, number] {
  const rho = 2 * R_KM * Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)
  const l = (lon * Math.PI) / 180
  return [rho * Math.sin(l), rho * Math.cos(l)]
}

/** Marker position in km: the backend's stereographic metres when given, else projected lat/lon. */
function pos(s: Site): [number, number] {
  if (typeof s.x_m === 'number' && typeof s.y_m === 'number') return [s.x_m / 1000, s.y_m / 1000]
  return project(s.lat!, s.lon!)
}

export function unproject(x: number, y: number): [number, number] {
  const rho = Math.hypot(x, y)
  const lat = (2 * Math.atan(rho / (2 * R_KM)) - Math.PI / 2) * (180 / Math.PI)
  const lon = (Math.atan2(x, y) * 180) / Math.PI
  return [lat, lon]
}

export default function MapPage() {
  const { siteId, setSite, from, to, navigate, href } = useAppState()
  const sites = useSites()
  const layer = useAsync(getIlluminationLayer, [])
  const tl = useTimeline(siteId && !siteId.startsWith('custom:') ? siteId : null)
  const [pick, setPick] = useState<{ lat: string; lon: string }>({ lat: '-89.5', lon: '0' })

  const list = useMemo(() => (sites.data ?? []).filter((s) => s.lat !== null && s.lon !== null), [sites.data])
  const fullExtent = useMemo(() => {
    const far = list.reduce((m, s) => Math.max(m, Math.hypot(...pos(s))), 0)
    const fit = Math.max(40, far * 1.15)
    if (!layer.data) return fit
    const { x_km, y_km } = layer.data.meta
    return Math.min(fit, Math.max(Math.abs(x_km[0]), Math.abs(x_km[1]), Math.abs(y_km[0]), Math.abs(y_km[1])))
  }, [list, layer.data])
  const ZOOMS = [1, 2.5, 6, 14]
  const [zoom, setZoom] = useState(0)
  const extent = fullExtent / ZOOMS[zoom]

  const site = list.find((s) => s.id === siteId)
  const sum = useMemo(() => {
    if (!tl.data || !site) return null
    const [f, e] = clampPeriod(from, to, timesMs(tl.data))
    return summarize(tl.data, { id: site.id, name: site.name }, f, e)
  }, [tl.data, site, from, to])

  const E = extent
  // Keep text and markers a fixed size on screen: map units per CSS pixel.
  const svgRef = useRef<SVGSVGElement>(null)
  const [widthPx, setWidthPx] = useState(800)
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidthPx(Math.max(200, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [sites.loading])
  const u = (2 * E) / widthPx
  const showLabel = useMemo(() => {
    const placed: [number, number][] = []
    const out = new Set<string>()
    const order = [...list].sort((a, b) => (a.id === siteId ? -1 : b.id === siteId ? 1 : 0))
    for (const s of order) {
      const [x, y] = pos(s)
      const sx = x / u
      const sy = -y / u
      if (placed.every(([px, py]) => Math.abs(px - sx) > 150 || Math.abs(py - sy) > 18)) {
        placed.push([sx, sy])
        out.add(s.id)
      }
    }
    return out
  }, [list, siteId, u])
  const rings = [-89.5, -89, -88, -87, -86, -85, -84, -83].filter((lat) => Math.hypot(...project(lat, 0)) < E * 0.98)
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
            <svg ref={svgRef} viewBox={`${-E} ${-E} ${2 * E} ${2 * E}`} style={{ fontSize: 13 * u }} onClick={onMapClick} role="group" aria-label="Map of the lunar south pole with landing sites">
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
                  const r = Math.hypot(...project(lat, 0))
                  return (
                    <g key={lat}>
                      <circle r={r} />
                      <text x={r * 0.71 + 3 * u} y={-r * 0.71} className="grat-label">{Math.abs(lat)}° S</text>
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
                <circle r={2.5 * u} className="pole" />
              </g>
              {validPick && (
                <g className="pick" transform={`translate(${px} ${-py})`} aria-hidden="true">
                  <line x1={-9 * u} x2={9 * u} y1={0} y2={0} />
                  <line y1={-9 * u} y2={9 * u} x1={0} x2={0} />
                </g>
              )}
              {list.map((s) => {
                const [x, y] = pos(s)
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
                    <circle r={22 * u} className="hit" />
                    <circle r={(on ? 7 : 5) * u} className="dot" />
                    {showLabel.has(s.id) && <text x={11 * u} y={4.5 * u} className="marker-label">{s.name}</text>}
                  </g>
                )
              })}
            </svg>
            <div className="map-tools">
              <div className="seg" role="group" aria-label="Zoom">
                <button onClick={() => setZoom((z) => Math.max(0, z - 1))} disabled={zoom === 0} aria-label="Zoom out">−</button>
                <button onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))} disabled={zoom === ZOOMS.length - 1} aria-label="Zoom in">+</button>
                <button onClick={() => setZoom(0)} aria-pressed={zoom === 0}>All sites</button>
              </div>
              <span className="muted small">Width shown: {Math.round(2 * E)} km</span>
              {layer.data?.meta.legend && (
                <div className="legend" aria-label="Average illumination legend">
                  <span className="muted small">Sunlit time</span>
                  <span
                    className="legend-bar"
                    style={{
                      background: `linear-gradient(90deg, ${layer.data.meta.legend
                        .map((l) => `rgb(${l.grey} ${l.grey} ${l.grey}) ${l.percent}%`)
                        .join(', ')})`,
                    }}
                  />
                  <span className="legend-ticks small"><span>0 %</span><span>50 %</span><span>100 %</span></span>
                </div>
              )}
            </div>
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
                {site.nasa_avg_illumination_percent !== undefined && (
                  <p className="small">
                    NASA LOLA map, 18.6-year average at this point: <b>{site.nasa_avg_illumination_percent} %</b> sunlit
                  </p>
                )}
                <div className="actions">
                  <a className="btn" href={href('/timeline')}>Open timeline</a>
                  <a className="btn ghost" href={href('/3d')}>3D view</a>
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
                  navigate('/timeline')
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
