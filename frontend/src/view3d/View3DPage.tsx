// 3D view from the site. Owner: Anastasiia Sh. This is a working baseline: replace freely.

import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import {
  nextTransition,
  riseSet,
  skyAt,
  timesMs,
  useHorizon,
  useSites,
  useTerrain,
  useTimeline,
} from '../api'
import { clampPeriod, PeriodMovedNote, SiteSelect, TimeSlider } from '../components/Controls'
import { Notice } from '../components/Notice'
import { useAppState } from '../state'
import type { CameraMode } from './Scene'

// three.js loads after the page frame is on screen.
const Scene = lazy(() => import('./Scene').then((m) => ({ default: m.Scene })))

export default function View3DPage() {
  const { siteId, setSite, from, to, t, setTime } = useAppState()
  const sites = useSites()
  const tl = useTimeline(siteId)
  const terrain = useTerrain(siteId)
  const horizon = useHorizon(siteId)
  const [mode, setMode] = useState<CameraMode>('overview')
  const [enlarge, setEnlarge] = useState(1)
  const [ex, setEx] = useState(1)
  const [look, setLook] = useState<'sun' | 'earth'>('sun')
  const [playing, setPlaying] = useState(false)

  const ms = useMemo(() => (tl.data ? timesMs(tl.data) : []), [tl.data])
  const [f, e, moved] = clampPeriod(from, to, ms)
  const tt = Math.min(Math.max(t, f), e)

  useEffect(() => {
    if (!playing) return
    // about 40 s for the whole period, at least one hour per frame
    const step = Math.max(3_600_000, Math.round((e - f) / 330 / 3_600_000) * 3_600_000)
    const id = window.setInterval(() => {
      setTime(tt + step > e ? f : tt + step)
    }, 120)
    return () => window.clearInterval(id)
  }, [playing, tt, f, e, setTime])

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) setPlaying(false)
  }, [])

  if (sites.loading || tl.loading || terrain.loading) return <div className="skeleton page-skeleton" aria-busy="true" />
  if (terrain.error || !terrain.data)
    return (
      <div className="page">
        {sites.data && <SiteSelect sites={sites.data} value={siteId} onChange={setSite} />}
        <Notice tone="error" title="No terrain tile for this site yet">{terrain.error?.message}</Notice>
      </div>
    )
  if (!tl.data) return <Notice tone="error" title="No timeline for this site">{tl.error?.message}</Notice>

  const sky = skyAt(tl.data, tt, ms)
  const sunTr = nextTransition(tl.data, 'sun', tt, ms)
  const earthTr = nextTransition(tl.data, 'earth', tt, ms)
  const lookDir = look === 'sun' ? sky.sun.dir : sky.earth.dir
  const m = terrain.data.meta

  return (
    <div className="page view3d">
      <div className="page-head">
        <h1>3D view</h1>
        <p className="lede">
          {(m.size_m / 1000).toFixed(0)} × {(m.size_m / 1000).toFixed(0)} km of LOLA terrain around the site. Sun and Earth are drawn in their true directions{enlarge === 1 ? ' and true sizes' : `, ${enlarge}× enlarged`}.
        </p>
      </div>
      <div className="toolbar">
        {sites.data && <SiteSelect sites={sites.data} value={siteId} onChange={setSite} />}
        <div className="seg" role="group" aria-label="Camera">
          <button aria-pressed={mode === 'overview'} onClick={() => setMode('overview')}>Overview</button>
          <button aria-pressed={mode === 'site'} onClick={() => setMode('site')}>Stand at the site</button>
        </div>
        <div className="seg" role="group" aria-label="Look towards">
          <button aria-pressed={look === 'sun'} onClick={() => setLook('sun')}>Face the Sun</button>
          <button aria-pressed={look === 'earth'} onClick={() => setLook('earth')}>Face Earth</button>
        </div>
        <div className="seg" role="group" aria-label="Disc size">
          <button aria-pressed={enlarge === 1} onClick={() => setEnlarge(1)}>True size</button>
          <button aria-pressed={enlarge === 5} onClick={() => setEnlarge(5)}>5× size</button>
        </div>
        <div className="seg" role="group" aria-label="Vertical scale">
          <button aria-pressed={ex === 1} onClick={() => setEx(1)}>Relief 1×</button>
          <button aria-pressed={ex === 3} onClick={() => setEx(3)}>3×</button>
        </div>
      </div>

      <div className="stage">
        <Suspense fallback={<div className="stage-loading">Loading 3D…</div>}>
          <Scene terrain={terrain.data} horizon={horizon.data} sky={sky} mode={mode} enlarge={enlarge} exaggeration={ex} lookDir={lookDir} resetKey={`${siteId}|${look}`} />
        </Suspense>
        <div className="hud">
          <p className="hud-sun">
            <b>Sun</b> {sky.sun.el.toFixed(2)}° high, az {sky.sun.az.toFixed(0)}° ·{' '}
            {riseSet(sunTr, 'sets in', 'hidden, rises in', 'does not set in the data', 'does not rise in the data')}
          </p>
          <p className="hud-earth">
            <b>Earth</b> {sky.earth.el.toFixed(2)}°, az {sky.earth.az.toFixed(0)}° ·{' '}
            {riseSet(earthTr, 'sets in', 'hidden, rises in', 'does not set in the data', 'does not rise in the data')}
          </p>
        </div>
      </div>

      <PeriodMovedNote moved={moved} />
      <div className="play-row">
        <button className="btn" onClick={() => setPlaying((p) => !p)} aria-pressed={playing}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <TimeSlider from={f} to={e} value={tt} onChange={setTime} />
      </div>
      <p className="source">
        Drag to look around{mode === 'overview' ? ', scroll to zoom' : ''}. Dark wall in the distance: mountains beyond the tile, from the horizon mask. Terrain: {m.mock ? 'synthetic (mock)' : 'LOLA DEM'}.
      </p>
    </div>
  )
}
