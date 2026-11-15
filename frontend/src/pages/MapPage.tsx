// Sheet 01: the south pole as a map sheet. NASA illumination layer as a "photographic plate",
// numbered markers at exact backend positions, an inset for the sites near the pole,
// the index of sites (the main way to choose, also on phones), the site card and your own point.

import { useEffect, useMemo, useState } from 'react'
import {
  API_URL,
  canComputeLocally,
  computeLightNow,
  customId,
  getIlluminationLayer,
  runs,
  summarize,
  timesMs,
  useAsync,
  useSites,
  useTimeline,
  useValidation,
  useYearSummaries,
  visibleFlags,
  type LightFrame,
  type Site,
  type Timeline,
} from '../api'
import { clampPeriod, TimeSlider } from '../components/Controls'
import { Notice } from '../components/Notice'
import { PageHead } from '../components/PageHead'
import { dateTimeUtc, dateUtc, dayMon, deg, hours, latLon, pct, siteNo } from '../format'
import { useAppState } from '../state'

const R_KM = 1737.4
const INSET_HALF_KM = 45
const INSET_FRACTION = 0.38

/** South polar stereographic, km. x towards 90 E, y towards 0 E (same as the LOLA polar products). */
export function project(lat: number, lon: number): [number, number] {
  const rho = 2 * R_KM * Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)
  const l = (lon * Math.PI) / 180
  return [rho * Math.sin(l), rho * Math.cos(l)]
}

export function unproject(x: number, y: number): [number, number] {
  const rho = Math.hypot(x, y)
  const lat = (2 * Math.atan(rho / (2 * R_KM)) - Math.PI / 2) * (180 / Math.PI)
  const lon = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360
  return [lat, lon]
}

/** Marker position in km: the backend's stereographic metres when given, else projected lat/lon. */
function pos(s: Site): [number, number] {
  if (typeof s.x_m === 'number' && typeof s.y_m === 'number') return [s.x_m / 1000, s.y_m / 1000]
  return project(s.lat!, s.lon!)
}

interface View {
  x0: number
  x1: number
  y0: number
  y1: number
}
const toPct = (v: View, x: number, y: number): [number, number] => [
  ((x - v.x0) / (v.x1 - v.x0)) * 100,
  ((v.y1 - y) / (v.y1 - v.y0)) * 100,
]

function Markers({
  list,
  sites,
  view,
  selected,
  onPick,
}: {
  list: Site[]
  sites: Site[]
  view: View
  selected: string | null
  onPick: (id: string) => void
}) {
  const pts = list.map((s) => ({ s, p: toPct(view, ...pos(s)) }))
  return (
    <>
      {pts.map(({ s, p }) => {
        // label goes to the left when a neighbour sits just to the right
        const left = pts.some((o) => o.s !== s && o.p[0] > p[0] && o.p[0] - p[0] < 9 && Math.abs(o.p[1] - p[1]) < 5)
        const on = s.id === selected
        const no = siteNo(sites, s.id)
        return (
          <button
            key={s.id}
            type="button"
            className={`marker${left ? ' left' : ''}${on ? ' on' : ''}`}
            style={{ left: `${p[0]}%`, top: `${p[1]}%` }}
            aria-label={`Site ${no} ${s.name}${on ? ', selected' : ''}`}
            aria-pressed={on}
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation()
              onPick(s.id)
            }}
          >
            <span className="dot" aria-hidden="true" />
            <span className="tag">{no}</span>
          </button>
        )
      })}
    </>
  )
}

/** 30-day strip: white = visible, ink hatching = dark/hidden. */
function Strip({ tl, body, from, days, label }: { tl: Timeline; body: 'sun' | 'earth'; from: number; days: number; label: string }) {
  const ms = timesMs(tl)
  const to = from + days * 86_400_000
  let i0 = ms.findIndex((t) => t >= from)
  if (i0 < 0) i0 = ms.length - 1
  let i1 = ms.findIndex((t) => t > to)
  i1 = i1 < 0 ? ms.length - 1 : i1 - 1
  const rs = i1 >= i0 ? runs(visibleFlags(tl, body), i0, i1).filter((r) => r.value) : []
  const x = (t: number) => ((t - from) / (to - from)) * 100
  const share = i1 >= i0 ? Math.round((rs.reduce((a, r) => a + r.i1 - r.i0 + 1, 0) / (i1 - i0 + 1)) * 100) : 0
  return (
    <div className="strip" role="img" aria-label={`${label}: ${share} % of the next ${days} days`}>
      <svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
        {rs.map((r) => (
          <rect key={r.i0} className={`strip-on ${body}`} x={x(ms[r.i0])} width={Math.max(0.3, x(ms[r.i1] + 3_600_000) - x(ms[r.i0]))} y="0" height="10" />
        ))}
      </svg>
    </div>
  )
}

// "Now" layer colours: lit ground as the paper of the sheet, shadow as ink
const LIT = [242, 239, 231]
const DARK = [15, 20, 27]

async function frameUrl(f: LightFrame): Promise<string> {
  const c = document.createElement('canvas')
  c.width = c.height = f.m
  const g = c.getContext('2d')!
  const img = g.createImageData(f.m, f.m)
  for (let i = 0; i < f.data.length; i++) {
    const w = f.data[i] / 255
    img.data[i * 4] = DARK[0] + (LIT[0] - DARK[0]) * w
    img.data[i * 4 + 1] = DARK[1] + (LIT[1] - DARK[1]) * w
    img.data[i * 4 + 2] = DARK[2] + (LIT[2] - DARK[2]) * w
    img.data[i * 4 + 3] = 255
  }
  g.putImageData(img, 0, 0)
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r))
  return blob ? URL.createObjectURL(blob) : c.toDataURL()
}

/** Light and shadow over the whole map at time t. While the slider moves the previous frame stays; a new one follows when it stops. */
function useLightLayer(on: boolean, t: number) {
  const [frame, setFrame] = useState<{ url: string; t: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!on) return
    let live = true
    const id = window.setTimeout(() => {
      setBusy(true)
      computeLightNow(t).then(
        async (f) => {
          const url = await frameUrl(f)
          if (!live) return URL.revokeObjectURL(url)
          setFrame((old) => {
            if (old) URL.revokeObjectURL(old.url)
            return { url, t: f.t }
          })
          setError(null)
          setBusy(false)
        },
        (e: Error) => {
          if (!live) return
          setError(e.message)
          setBusy(false)
        },
      )
    }, 250)
    return () => {
      live = false
      window.clearTimeout(id)
    }
  }, [on, t])
  return { frame, busy, error }
}

export default function MapPage() {
  const { siteId, setSite, from, to, t, setTime, navigate, href } = useAppState()
  const [layerMode, setLayerMode] = useState<'avg' | 'now'>('avg')
  const sites = useSites()
  const layer = useAsync(getIlluminationLayer, [])
  const year = useYearSummaries()
  const custom = siteId?.startsWith('custom:') ?? false
  const tl = useTimeline(siteId && !custom ? siteId : null)
  const [pick, setPickRaw] = useState<{ lat: string; lon: string }>({ lat: '-89.5', lon: '0' })
  const [picked, setPicked] = useState(false)
  const setPick = (v: { lat: string; lon: string }) => {
    setPickRaw(v)
    setPicked(true)
  }
  const local = useAsync(canComputeLocally, [])
  const now = layerMode === 'now' && !!local.data
  const light = useLightLayer(now, t)
  const plateUrl = now ? light.frame?.url : layer.data?.url
  const canCompute = !!local.data || !!API_URL
  const customTl = useTimeline(custom ? siteId : null)
  const val = useValidation()
  const browserCaption = (val.data?.browser as { caption?: string } | undefined)?.caption

  const list = useMemo(() => (sites.data ?? []).filter((s) => s.lat !== null && s.lon !== null), [sites.data])
  const view: View = useMemo(() => {
    if (layer.data) {
      const { x_km, y_km } = layer.data.meta
      return { x0: x_km[0], x1: x_km[1], y0: y_km[0], y1: y_km[1] }
    }
    const far = list.reduce((m, s) => Math.max(m, Math.hypot(...pos(s))), 0)
    const e = Math.max(60, far * 1.15)
    return { x0: -e, x1: e, y0: -e, y1: e }
  }, [list, layer.data])
  const width = view.x1 - view.x0
  const insetView: View = { x0: -INSET_HALF_KM, x1: INSET_HALF_KM, y0: -INSET_HALF_KM, y1: INSET_HALF_KM }
  const useInset = width > 4 * INSET_HALF_KM
  const inInset = (x: number, y: number) => useInset && Math.abs(x) < INSET_HALF_KM && Math.abs(y) < INSET_HALF_KM
  const near = (s: Site) => inInset(...pos(s))

  const site = list.find((s) => s.id === siteId)
  const sum = useMemo(() => {
    if (!tl.data || !site) return null
    const [f, e] = clampPeriod(from, to, timesMs(tl.data))
    return { s: summarize(tl.data, { id: site.id, name: site.name }, f, e), f, e }
  }, [tl.data, site, from, to])
  const yearPct = (id: string) => year.data?.find((y) => y.site.id === id)?.sun.lit_percent

  // grid in the plate's 0..100 coordinates
  const rings = [-89, -87, -85, -83, -81].map((lat) => ({ lat, r: (Math.hypot(...project(lat, 0)) / width) * 100 }))
  const [cx, cy] = toPct(view, 0, 0)
  const box = toPct(view, -INSET_HALF_KM, INSET_HALF_KM)
  const boxW = ((2 * INSET_HALF_KM) / width) * 100

  const lat = Number(pick.lat)
  const lon = Number(pick.lon)
  const validPick = pick.lat.trim() !== '' && pick.lon.trim() !== '' && Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= -80 && lon >= -180 && lon <= 360
  const pickXY = validPick && picked ? project(lat, lon) : null

  const onPlateClick = (v: View) => (ev: React.MouseEvent<HTMLDivElement>) => {
    const r = ev.currentTarget.getBoundingClientRect()
    const x = v.x0 + ((ev.clientX - r.left) / r.width) * (v.x1 - v.x0)
    const y = v.y1 - ((ev.clientY - r.top) / r.height) * (v.y1 - v.y0)
    const [la, lo] = unproject(x, y)
    setPick({ lat: la.toFixed(4), lon: lo.toFixed(3) })
  }

  const meta = layer.data?.meta
  const legend = layer.data?.meta.legend
  const no = siteNo(sites.data, siteId)

  const indexList = (
    <>

            <p className="label index-head">Index of sites / sunlit share of the year</p>
            <ul className="index">
              {list.map((s) => {
                const v = yearPct(s.id)
                return (
                  <li key={s.id}>
                    <button type="button" aria-pressed={s.id === siteId} onClick={() => setSite(s.id)}>
                      <span className="no">{siteNo(sites.data, s.id)}</span>
                      <span className="nm">{s.name}</span>
                      <span className="pc">{v === undefined ? '' : pct(v)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
    </>
  )
  const siteCard = (
    <>
            {site ? (
              <section className="panel site-card" aria-label={`Site ${no} ${site.name}`}>
                <div className="card-title">
                  <h2>{site.name}</h2>
                  <span className="badge-no">{no}</span>
                </div>
                {sum && (
                  <p className="label period-tag">
                    Period {dateUtc(sum.f)} to {dateUtc(sum.e)}
                  </p>
                )}
                <p className="coord">
                  {latLon(site.lat!, site.lon!)}
                  {site.elevation_m !== null && ` / ${site.elevation_m >= 0 ? '+' : ''}${Math.round(site.elevation_m)} m`}
                </p>
                {sum ? (
                  <>
                    <div className="cells">
                      <div className="cell">
                        <span className="label">Sunlit</span>
                        <span className="num big">
                          {sum.s.sun.lit_percent.toFixed(1)}
                          <small>%</small>
                        </span>
                        {site.nasa_avg_illumination_percent !== undefined && <p>NASA 18.6-year map: {pct(site.nasa_avg_illumination_percent)}</p>}
                      </div>
                      <div className="cell">
                        <span className="label">Earth in view</span>
                        <span className="num big">
                          {sum.s.earth.visible_percent.toFixed(1)}
                          <small>%</small>
                        </span>
                        <p>Direct link without a relay</p>
                      </div>
                    </div>
                    <div className="cells">
                      <div className="cell">
                        <span className="label">Longest darkness</span>
                        <span className="num mid">{hours(sum.s.sun.longest_dark_h)}</span>
                      </div>
                      <div className="cell">
                        <span className="label">Highest Sun</span>
                        <span className="num mid">{deg(sum.s.sun.max_el)}</span>
                      </div>
                    </div>
                    {tl.data && (
                      <div className="strips">
                        <span className="label">Next 30 days, light and dark</span>
                        <Strip tl={tl.data} body="sun" from={sum.f} days={30} label="Sunlight" />
                        <span className="label" style={{ marginTop: 6 }}>
                          Earth above the horizon
                        </span>
                        <Strip tl={tl.data} body="earth" from={sum.f} days={30} label="Earth in view" />
                        <div className="strip-ticks">
                          <span>{dayMon(sum.f)}</span>
                          <span>{dayMon(sum.f + 15 * 86_400_000)}</span>
                          <span>{dayMon(sum.f + 30 * 86_400_000)}</span>
                        </div>
                      </div>
                    )}
                  </>
                ) : tl.error ? (
                  <div className="panel-pad">
                    <Notice tone="error" title="No timeline for this site yet">
                      {tl.error.message}
                    </Notice>
                  </div>
                ) : (
                  <div className="panel-pad">
                    <div className="skeleton line-skeleton" aria-busy="true" />
                  </div>
                )}
                <div className="card-actions">
                  <a className="btn" href={href('/timeline')}>
                    Open timeline
                  </a>
                  <a className="btn ghost" href={href('/horizon')}>
                    Stand on site
                  </a>
                </div>
              </section>
            ) : (
              <Notice title="Choose a site in the index below the map" />
            )}

    </>
  )
  const customForm = (
            <form
              className="panel custom"
              onSubmit={(e) => {
                e.preventDefault()
                if (validPick && canCompute) setSite(customId(lat, lon))
              }}
            >
              <span className="label">Your own point, or click the map</span>
              <div className="row">
                <div className="field">
                  <label htmlFor="clat">Latitude</label>
                  <input id="clat" inputMode="decimal" value={pick.lat} onChange={(e) => setPick({ ...pick, lat: e.target.value })} aria-invalid={!validPick} />
                </div>
                <div className="field">
                  <label htmlFor="clon">Longitude, east</label>
                  <input id="clon" inputMode="decimal" value={pick.lon} onChange={(e) => setPick({ ...pick, lon: e.target.value })} aria-invalid={!validPick} />
                </div>
                <button className="btn ghost" type="submit" disabled={!validPick || !canCompute}>
                  Compute
                </button>
              </div>
              {!validPick && <p className="err">Latitude between −90 and −80, longitude between −180 and 360.</p>}
              {custom && customTl.loading && <div className="skeleton line-skeleton" aria-busy="true" />}
              {custom && customTl.error && (
                <Notice tone="error" title="Could not compute this point">
                  {customTl.error.message}
                </Notice>
              )}
              {custom && customTl.data && (() => {
                const ms = timesMs(customTl.data)
                const [f, e] = clampPeriod(from, to, ms)
                const cs = summarize(customTl.data, { id: siteId!, name: 'Your point' }, f, e)
                return (
                  <div aria-live="polite">
                    <div className="cells" style={{ border: '1px solid var(--ink)' }}>
                      <div className="cell">
                        <span className="label">Sunlit</span>
                        <span className="num mid">{pct(cs.sun.lit_percent)}</span>
                      </div>
                      <div className="cell">
                        <span className="label">Earth in view</span>
                        <span className="num mid">{pct(cs.earth.visible_percent)}</span>
                      </div>
                    </div>
                    <div className="card-actions" style={{ border: '1px solid var(--ink)', borderTop: 0 }}>
                      <button type="button" className="btn" onClick={() => navigate('/timeline')}>
                        Timeline
                      </button>
                      <button type="button" className="btn ghost" onClick={() => navigate('/horizon')}>
                        Horizon
                      </button>
                    </div>
                  </div>
                )
              })()}
              <p className="small muted">
                {local.data
                  ? (browserCaption ?? 'Computed in your browser from the same ephemerides and a 240 m terrain grid. Listed sites use 5 m terrain.')
                  : API_URL
                    ? 'Computed by the live API from the same ephemerides and LOLA terrain.'
                    : 'The point is marked on the map. The in-browser calculation (same ephemerides, 240 m terrain) switches on when its data files are published; listed sites use 5 m terrain.'}
              </p>
            </form>
  )

  return (
    <div className="page map">
      <PageHead
        stamp={`Sheet 01 / South polar stereographic / ${meta?.lat_limit ? `${Math.abs(meta.lat_limit)}° S to 90° S` : 'around 90° S'}`}
        title="Where the Sun never quite sets"
        lede={`${list.length ? list.length : 'Candidate'} candidate sites at the lunar south pole. Pick one to see how long it stays lit and when Earth is in view.`}
      />
      {sites.loading ? (
        <div className="skeleton page-skeleton" aria-busy="true" />
      ) : (
        <div className="map-layout">
          <section className="panel map-sheet" aria-label="Map">
            <div className="map-cap label">
              <span>0° E at the top</span>
              <span>{now ? `Light and shadow ${light.frame ? `at ${dateTimeUtc(light.frame.t)}` : 'now'}, terrain 240 m` : layer.data ? 'NASA LOLA average illumination, 240 m/px' : 'Illumination layer not published yet'}</span>
              <span>90° E →</span>
            </div>
            <div className="layer-row">
              <div className="seg" role="group" aria-label="Map layer">
                <button type="button" aria-pressed={!now} onClick={() => setLayerMode('avg')}>
                  Average (NASA, 18.6 years)
                </button>
                <button type="button" aria-pressed={now} disabled={!local.data} onClick={() => setLayerMode('now')} title={local.data ? undefined : 'Needs the terrain and ephemeris files'}>
                  Now
                </button>
              </div>
              {now && <TimeSlider from={from} to={to} value={t} onChange={setTime} />}
            </div>
            <div className={now ? 'plate now' : 'plate'} onClick={onPlateClick(view)} role="group" aria-label="Lunar south pole. Click to set your own point.">
              {now
                ? plateUrl && <img src={plateUrl} alt="Light and shadow at the lunar south pole at the chosen moment, light means the Sun is in view" draggable={false} />
                : layer.data && <img src={layer.data.url} srcSet={layer.data.srcSet} sizes="(max-width: 700px) 100vw, 840px" fetchPriority="high" alt="Average illumination of the lunar south pole, brighter means lit for more of the time" draggable={false} />}
              {now && light.busy && <span className="plate-busy label" aria-live="polite">Computing light…</span>}
              <svg className="grid" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <g fill="none" stroke="#F7F8F9" strokeOpacity="0.35" strokeWidth="0.15">
                  {rings.map((g) => (
                    <circle key={g.lat} cx={cx} cy={cy} r={g.r} />
                  ))}
                  <path d={`M${cx} 0V100M0 ${cy}H100M${cx - 50} ${cy - 50}L${cx + 50} ${cy + 50}M${cx + 50} ${cy - 50}L${cx - 50} ${cy + 50}`} />
                </g>
                {useInset && (
                  <>
                    <rect x={box[0]} y={box[1]} width={boxW} height={boxW} fill="none" stroke="#F7F8F9" strokeWidth="0.35" />
                    <path
                      d={`M${box[0]} ${box[1] + boxW}L0 ${100 - INSET_FRACTION * 100}M${box[0] + boxW} ${box[1] + boxW}L${INSET_FRACTION * 100} 100`}
                      fill="none"
                      stroke="#F7F8F9"
                      strokeOpacity="0.6"
                      strokeWidth="0.2"
                      strokeDasharray="0.8 0.8"
                    />
                  </>
                )}
              </svg>
              {rings
                .filter((g) => g.lat >= -87 && cy - g.r > 3)
                .map((g) => (
                  <span key={g.lat} className="glabel" style={{ left: `${cx + 1}%`, top: `${cy - g.r - 1.5}%` }}>
                    {Math.abs(g.lat)}° S
                  </span>
                ))}
              {useInset && (
                <span className="glabel" style={{ left: `${box[0] + 0.6}%`, top: `${box[1] - 2}%`, opacity: 1 }}>
                  SEE INSET
                </span>
              )}
              <Markers list={list.filter((s) => !near(s))} sites={sites.data ?? []} view={view} selected={siteId} onPick={setSite} />
              {pickXY && !inInset(...pickXY) && (
                <span className="pick" aria-hidden="true" style={{ left: `${toPct(view, ...pickXY)[0]}%`, top: `${toPct(view, ...pickXY)[1]}%` }} />
              )}
              {useInset && (
                <div
                  className="inset"
                  role="group"
                  aria-label={`Inset: ${2 * INSET_HALF_KM} by ${2 * INSET_HALF_KM} km around the pole`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onPlateClick(insetView)(e)
                  }}
                >
                  <span className="inset-tag">
                    INSET {2 * INSET_HALF_KM} × {2 * INSET_HALF_KM} KM
                  </span>
                  {plateUrl && (
                    <img
                      src={plateUrl}
                      alt=""
                      draggable={false}
                      style={{
                        width: `${(width / (2 * INSET_HALF_KM)) * 100}%`,
                        left: `${((view.x0 - insetView.x0) / (2 * INSET_HALF_KM)) * 100}%`,
                        top: `${((insetView.y1 - view.y1) / (2 * INSET_HALF_KM)) * 100}%`,
                      }}
                    />
                  )}
                  <span className="glabel" style={{ left: '52%', top: '46%' }}>
                    POLE
                  </span>
                  <Markers list={list.filter(near)} sites={sites.data ?? []} view={insetView} selected={siteId} onPick={setSite} />
                  {pickXY && inInset(...pickXY) && (
                    <span className="pick" aria-hidden="true" style={{ left: `${toPct(insetView, ...pickXY)[0]}%`, top: `${toPct(insetView, ...pickXY)[1]}%` }} />
                  )}
                </div>
              )}
            </div>
            <div className="map-under">
              {now ? (
                <div className="legend label" aria-label="Light and shadow at the chosen moment">
                  <span className="sw" style={{ background: `rgb(${LIT.join(' ')})` }} /> <span>Sun in view</span>
                  <span className="sw" style={{ background: `rgb(${DARK.join(' ')})` }} /> <span>In shadow</span>
                  <span>/ terrain 240 m, small shadows are not seen{light.error ? ` / ${light.error}` : ''}</span>
                </div>
              ) : legend && (
                <div className="legend label" aria-label="Illumination scale from 0 to 100 percent of time sunlit">
                  <span>0 %</span>
                  <span
                    className="legend-bar"
                    style={{ background: `linear-gradient(90deg, ${legend.map((l) => `rgb(${l.grey} ${l.grey} ${l.grey}) ${l.percent}%`).join(', ')})` }}
                  />
                  <span>100 % of time sunlit</span>
                </div>
              )}
              <div className="scalebar label" style={{ flex: '1 1 160px', justifyContent: 'flex-end' }}>
                <i style={{ width: `${(50 / width) * 100}%`, minWidth: 30 }} />
                <span>50 km on the main map</span>
              </div>
            </div>

            <div className="index-desk">{indexList}</div>
          </section>

          <aside className="map-side">
            {siteCard}
            <div className="index-mob">{indexList}</div>
            {customForm}
          </aside>
        </div>
      )}
    </div>
  )
}
