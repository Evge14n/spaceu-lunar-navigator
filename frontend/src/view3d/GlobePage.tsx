// Sheet 00: the whole Moon as a picker. Turn the globe, choose one of the prepared sites - on the
// globe or in the list - and open its 3D view. Every site here has the full LOLA data behind it;
// there are no points of your own on this sheet any more.
//
// The globe itself is globe/GlobeScene.tsx, the rules (nearest site, order, framing, labels) are
// globe/sitePicker.ts, and what the model has to satisfy is in GLOBE.md next to this file.

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { meToScene, toLatLon, useSites, useSunDirection, type Site } from '../api'
import { TimeSlider } from '../components/Controls'
import { Notice } from '../components/Notice'
import { PageHead } from '../components/PageHead'
import { dateTimeUtc, pct, siteNo } from '../format'
import { useAppState } from '../state'
import {
  GLOBE_MODEL_FRAME,
  GLOBE_MODEL_SPIN_DEG,
  dirFromLatLon,
  normalizeLon,
  ORIENTATION_MARKERS,
  type ModelFrame,
  type ModelSummary,
} from './globe/frame'
import { formatLatLon, framingFor, hasPosition, moveSelection, nearestSite, sortSites, type SortKey } from './globe/sitePicker'

const GlobeScene = lazy(() => import('./globe/GlobeScene'))

const STORE_KEY = 'spaceu.globe.orientation'
const COLUMNS = 3
/** The first view: tilted south so the pole sits in the lower part of the disk... */
const HOME_LAT = -40
/** ...and turned to the lit side, a little west of the Sun so the relief casts shadows */
const HOME_SUN_OFFSET = 35
/** a focus distance of 0 means "the whole globe in the frame", whatever the shape of the stage */
const WHOLE = 0
const TOUCH = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches

/** Remembered orientation of the model, so a fix survives a reload. Storage may be blocked. */
function loadOrientation(): { frame: ModelFrame; spin: number } {
  try {
    const raw = window.localStorage.getItem(STORE_KEY)
    if (raw) {
      const v = JSON.parse(raw) as { frame?: string; spin?: number }
      if (v.frame === 'scene' || v.frame === 'me') return { frame: v.frame, spin: Number(v.spin) || 0 }
    }
  } catch {
    /* private mode, or storage is full: the defaults are fine */
  }
  return { frame: GLOBE_MODEL_FRAME, spin: GLOBE_MODEL_SPIN_DEG }
}

function saveOrientation(v: { frame: ModelFrame; spin: number }) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(v))
  } catch {
    /* nothing to do: the choice simply does not survive the reload */
  }
}

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'id', label: 'By number' },
  { key: 'lit', label: 'By sunlight' },
  { key: 'elevation', label: 'By height' },
]

export default function GlobePage() {
  const { t, from, to, setTime, siteId, setSite, navigate, href } = useAppState()
  const sites = useSites()
  const [sortKey, setSortKey] = useState<SortKey>('id')
  const all = useMemo(() => sortSites(sites.data ?? [], sortKey), [sites.data, sortKey])
  const placed = useMemo(() => all.filter(hasPosition), [all])
  const numbering = sites.data ?? []

  const selected: Site | null = useMemo(() => all.find((s) => s.id === siteId) ?? null, [all, siteId])
  const [hovered, setHovered] = useState<string | null>(null)
  const [snapped, setSnapped] = useState<{ id: string; km: number } | null>(null)
  const [model, setModel] = useState<ModelSummary>({ kind: 'loading' })
  const [orientation, setOrientation] = useState(loadOrientation)
  const [showOrientation, setShowOrientation] = useState(false)
  const [focus, setFocus] = useState<{ dir: [number, number, number]; distance: number; key: number } | null>(null)
  const focusKey = useRef(0)
  const framedOnce = useRef(false)
  const cardRefs = useRef(new Map<string, HTMLButtonElement>())

  useEffect(() => saveOrientation(orientation), [orientation])

  /** Where the camera has to be for the cluster to come apart: measured from the sites themselves. */
  const framing = useMemo(() => framingFor(placed), [placed])

  const turnTo = useCallback((lat: number, lon: number, distance: number) => {
    focusKey.current += 1
    setFocus({ dir: dirFromLatLon(lat, normalizeLon(lon)) as [number, number, number], distance, key: focusKey.current })
  }, [])

  const showPole = useCallback(() => turnTo(framing.lat, framing.lon, framing.distance), [framing, turnTo])

  /** One selection for the globe and the list. Choosing a site turns the globe to it. */
  const choose = useCallback(
    (id: string, turn = true) => {
      setSite(id)
      setSnapped(null)
      const s = (sites.data ?? []).find((x) => x.id === id)
      if (turn && s && hasPosition(s)) turnTo(s.lat, s.lon, framing.distance)
      const card = cardRefs.current.get(id)
      card?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    },
    [framing.distance, setSite, sites.data, turnTo],
  )

  /** A tap on bare ground is not a point of its own any more: it snaps to the nearest site. */
  const pickNearest = useCallback(
    (lat: number, lon: number) => {
      const near = nearestSite(placed, lat, lon)
      if (!near) return
      choose(near.site.id, false)
      setSnapped({ id: near.site.id, km: near.km })
    },
    [choose, placed],
  )

  const sunMe = useSunDirection(t)
  const sunScene = sunMe ? (meToScene(sunMe) as [number, number, number]) : null
  const sub = sunMe ? toLatLon(sunMe) : null
  const sunLon = sub ? sub[1] : null

  // start with the whole Moon in view, south pole included; "South pole" zooms in to the cluster
  useEffect(() => {
    if (framedOnce.current || sunLon === null) return
    framedOnce.current = true
    turnTo(HOME_LAT, sunLon - HOME_SUN_OFFSET, WHOLE)
  }, [sunLon, turnTo])

  const ids = useMemo(() => all.map((s) => s.id), [all])
  const onListKey = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (e.key === 'Enter' && selected) {
      e.preventDefault()
      navigate('/horizon')
      return
    }
    const next = moveSelection(ids, siteId, e.key, COLUMNS)
    if (!next) return
    e.preventDefault()
    choose(next)
    cardRefs.current.get(next)?.focus()
  }

  const modelNote =
    model.kind === 'sphere'
      ? model.reason === 'no model file yet'
        ? 'No relief model yet: a plain sphere stands in for it. Drop moon.glb into frontend/public/moon/ (see GLOBE.md) and reload.'
        : /no meshes/.test(model.reason)
          ? 'The file loaded, but it is empty — it has no meshes in it, only a scene. In Blender, select the Moon object and export with File ▸ Export ▸ glTF 2.0 (.glb), with “Include ▸ Selected Objects” either off or the Moon actually selected. A plain sphere stands in meanwhile.'
          : `The model could not be used (${model.reason}); a plain sphere stands in for it.`
      : null

  const lit = (s: Site) => (typeof s.nasa_avg_illumination_percent === 'number' ? s.nasa_avg_illumination_percent : null)

  return (
    <div className="page globe">
      <PageHead
        stamp={`Sheet 00 / The whole Moon / ${placed.length} prepared sites`}
        title="Choose a landing site"
        lede="Turn the globe and pick one of the sites we have full NASA data for — on the globe or in the list below — then open the view from the ground."
      />

      {sites.error ? (
        <Notice tone="error" title="Could not load the site list">
          {sites.error.message}. Check the connection and reload the page.
        </Notice>
      ) : sites.loading ? (
        <div className="skeleton page-skeleton" aria-busy="true" />
      ) : (
        <>
          <section className="panel scene-panel" aria-label="Globe">
            <div className="scene-cap label">
              <span>
                {model.kind === 'model'
                  ? 'Moon model from LRO data'
                  : model.kind === 'sphere'
                    ? `Sphere stand-in, 1737.4 km radius${model.textured ? ', textured' : ''}`
                    : 'Loading the model…'}
              </span>
              <span>{dateTimeUtc(t)}</span>
            </div>
            <div className="stage globe-stage">
              <Suspense fallback={<div className="stage-loading">Loading the globe…</div>}>
                <GlobeScene
                  sunDir={sunScene}
                  sites={placed}
                  selectedId={selected?.id ?? null}
                  hoveredId={hovered}
                  onPickNearest={pickNearest}
                  onPickSite={(id) => choose(id, false)}
                  onHoverSite={setHovered}
                  showOrientation={showOrientation}
                  frame={orientation.frame}
                  spin={orientation.spin}
                  onModel={setModel}
                  onHeights={() => undefined}
                  focus={focus}
                />
              </Suspense>
            </div>

            <div className="status">
              <p aria-live="polite">
                <b>Chosen</b> {selected ? `${siteNo(numbering, selected.id)} ${selected.name}` : 'nothing yet — tap a marker or a card'}
                {snapped && selected?.id === snapped.id ? ` / nearest to your tap, ${snapped.km.toFixed(0)} km away` : ''}
              </p>
              <p>
                <b className="sun-t">Sun overhead at</b> {sub ? formatLatLon(sub[0], sub[1], 1) : '…'}
              </p>
              <p>
                <b>Sites</b> {placed.length} with full LOLA data{all.length > placed.length ? `, ${all.length - placed.length} without a position` : ''}
              </p>
            </div>
          </section>

          <div className="toolbar" style={{ marginTop: 14 }}>
            <button className="btn" type="button" disabled={!selected} onClick={() => navigate('/horizon')}>
              Open 3D view
            </button>
            <a className="btn ghost" href={href('/map')} aria-disabled={!selected}>
              Open on the map
            </a>
            <div className="seg" role="group" aria-label="Turn the globe to">
              <button type="button" onClick={showPole}>
                South pole
              </button>
              <button type="button" onClick={() => turnTo(0, 0, WHOLE)}>
                Near side
              </button>
              <button type="button" onClick={() => turnTo(0, 180, WHOLE)}>
                Far side
              </button>
            </div>
            <span className="hint">
              {TOUCH
                ? 'Drag to turn / pinch to zoom / tap the globe for the nearest site'
                : 'Drag to turn / Ctrl + wheel or pinch to zoom / tap the globe for the nearest site'}
            </span>
          </div>

          {modelNote && <Notice title="Globe model">{modelNote} The sites, the Sun and the picking all work either way.</Notice>}

          {selected && (
            <section className="panel site-card" aria-label={`Site ${siteNo(numbering, selected.id)} ${selected.name}`} style={{ marginTop: 14 }}>
              <div className="card-title">
                <h2>
                  <span className="label" style={{ marginRight: 10 }}>
                    {siteNo(numbering, selected.id)}
                  </span>
                  {selected.name}
                </h2>
                <span className="label">{selected.has_5m ? 'LOLA 5 m site model' : 'LOLA 240 m'}{selected.mock ? ' / sample data' : ''}</span>
              </div>
              <p className="coord">
                {hasPosition(selected) ? formatLatLon(selected.lat, selected.lon) : 'No position in the data'}
                {typeof selected.elevation_m === 'number' ? ` / ${Math.round(selected.elevation_m).toLocaleString('en-US')} m above the 1737.4 km sphere` : ''}
              </p>
              <div className="cells">
                <div className="cell">
                  <span className="label">NASA average sunlight</span>
                  <span className="num mid">{lit(selected) === null ? 'n/a' : pct(lit(selected))}</span>
                  {lit(selected) !== null && (
                    <span aria-hidden="true" style={{ display: 'block', height: 6, background: 'var(--line)' }}>
                      <span style={{ display: 'block', height: '100%', width: `${lit(selected)}%`, background: 'var(--sun)' }} />
                    </span>
                  )}
                </div>
                <div className="cell">
                  <span className="label">Elevation</span>
                  <span className="num mid">
                    {typeof selected.elevation_m === 'number' ? Math.round(selected.elevation_m).toLocaleString('en-US') : 'n/a'} <small>m</small>
                  </span>
                  <span className="label" style={{ textTransform: 'none' }}>
                    {selected.source}
                  </span>
                </div>
              </div>
              <div className="card-actions">
                <button type="button" className="btn" onClick={() => navigate('/horizon')}>
                  Open 3D view
                </button>
                <a className="btn ghost" href={href('/timeline')}>
                  Timeline
                </a>
              </div>
            </section>
          )}

          <section className="panel" aria-label="All sites" style={{ marginTop: 14 }}>
            <div className="panel-head">
              <h2>All sites</h2>
              <div className="seg" role="group" aria-label="Order">
                {SORTS.map((s) => (
                  <button key={s.key} type="button" aria-pressed={sortKey === s.key} onClick={() => setSortKey(s.key)}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="panel-pad">
              {all.length === 0 ? (
                <Notice title="No sites in the data yet">
                  The site list is empty. The sheets fall back to sample data until <span className="mono">data/sites.json</span> is published.
                </Notice>
              ) : (
                <ul className="index" onKeyDown={onListKey}>
                  {all.map((s) => {
                    const on = s.id === selected?.id
                    const placedSite = hasPosition(s)
                    return (
                      <li key={s.id}>
                        <button
                          type="button"
                          ref={(el) => {
                            if (el) cardRefs.current.set(s.id, el)
                            else cardRefs.current.delete(s.id)
                          }}
                          aria-pressed={on}
                          disabled={!placedSite}
                          onClick={() => choose(s.id)}
                          onMouseEnter={() => setHovered(s.id)}
                          onMouseLeave={() => setHovered(null)}
                          onFocus={() => setHovered(s.id)}
                          onBlur={() => setHovered(null)}
                        >
                          <span className="no">{siteNo(numbering, s.id)}</span>
                          <span className="nm">
                            {s.name}
                            <span className="label" style={{ display: 'block', textTransform: 'none' }}>
                              {placedSite ? formatLatLon(s.lat, s.lon, 2) : 'no position'}
                            </span>
                          </span>
                          <span className="pc">{lit(s) === null ? '—' : `${lit(s)!.toFixed(0)}%`}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
              <p className="label" style={{ marginTop: 10 }}>
                Arrow keys move the choice, Enter opens the 3D view. The percentage is the NASA 18.6-year average sunlight at the point.
              </p>
            </div>
          </section>

          <div className="play-row" style={{ marginTop: 14 }}>
            <TimeSlider from={from} to={to} value={t} onChange={setTime} />
          </div>

          <section className="panel" aria-label="Model orientation" style={{ marginTop: 14 }}>
            <div className="panel-head">
              <h2>Is the model oriented correctly?</h2>
              <span className="label">Three known places (GLOBE.md)</span>
            </div>
            <div className="panel-pad">
              <div className="toolbar">
                <button className="btn ghost" type="button" aria-pressed={showOrientation} onClick={() => setShowOrientation((v) => !v)}>
                  {showOrientation ? 'Hide the markers' : 'Show the markers'}
                </button>
                <div className="seg" role="group" aria-label="Model axes">
                  <button type="button" aria-pressed={orientation.frame === 'scene'} onClick={() => setOrientation({ ...orientation, frame: 'scene' })}>
                    Model is y-up
                  </button>
                  <button type="button" aria-pressed={orientation.frame === 'me'} onClick={() => setOrientation({ ...orientation, frame: 'me' })}>
                    Model is MOON_ME
                  </button>
                </div>
                <div className="seg" role="group" aria-label="Turn the model about the polar axis">
                  {[-90, -10, 10, 90].map((d) => (
                    <button key={d} type="button" onClick={() => setOrientation({ ...orientation, spin: normalizeLon(orientation.spin + d) })}>
                      {d > 0 ? `+${d}°` : `${d}°`}
                    </button>
                  ))}
                  <button type="button" onClick={() => setOrientation({ frame: GLOBE_MODEL_FRAME, spin: GLOBE_MODEL_SPIN_DEG })}>
                    Reset
                  </button>
                </div>
                <span className="label">spin {orientation.spin.toFixed(0)}°</span>
              </div>
              <ul className="label" style={{ marginTop: 10, lineHeight: 1.7 }}>
                {ORIENTATION_MARKERS.map((m, i) => (
                  <li key={m.label}>
                    <span style={{ color: ['#6ee7a8', '#ff8fd0', '#ffe066'][i] }}>■</span> {m.label} — {m.hint}
                  </li>
                ))}
              </ul>
              <p className="label">
                All three in place means the globe and the data agree, so the markers sit where the sites really are. When they do not, turn the model
                here and write the result into GLOBE_MODEL_FRAME and GLOBE_MODEL_SPIN_DEG in <span className="mono">view3d/globe/frame.ts</span>.
              </p>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
