// Sheet 04: stand on the site and look around. Owner of the 3D scene: Anastasiia Sh. (Scene.tsx).
// Default view is at eye level, 2 m above the ground, where elevations read as they are measured.

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { indexRange, isCustom, nextTransition, riseSet, skyAt, timesMs, useHorizon, useSites, useTerrain, useTimeline } from '../api'
import { clampPeriod, PeriodMovedNote, SiteSelect, TimeSlider } from '../components/Controls'
import { HorizonPanorama } from '../components/HorizonPanorama'
import { Notice } from '../components/Notice'
import { PageHead } from '../components/PageHead'
import { dateTimeUtc, siteNo } from '../format'
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
  const [mode, setMode] = useState<CameraMode>('site')
  const [enlarge, setEnlarge] = useState(1)
  const [look, setLook] = useState<'sun' | 'earth'>('sun')
  const [playing, setPlaying] = useState(false)
  const ladder = useRef<HTMLDivElement>(null)
  const azr = useRef<HTMLDivElement>(null)
  const overlay = useMemo(() => ({ ladder, az: azr }), [])

  const ms = useMemo(() => (tl.data ? timesMs(tl.data) : []), [tl.data])
  const [f, e, moved] = clampPeriod(from, to, ms)
  const tt = Math.min(Math.max(t, f), e)

  useEffect(() => {
    if (!playing) return
    // about 40 s for the whole period, at least one hour per frame
    const step = Math.max(3_600_000, Math.round((e - f) / 330 / 3_600_000) * 3_600_000)
    const id = window.setInterval(() => setTime(tt + step > e ? f : tt + step), 120)
    return () => window.clearInterval(id)
  }, [playing, tt, f, e, setTime])

  const custom = !!siteId && isCustom(siteId)
  const ready = !!(tl.data && terrain.data)
  const sky = tl.data ? skyAt(tl.data, tt, ms) : null
  const sunTr = tl.data ? nextTransition(tl.data, 'sun', tt, ms) : null
  const earthTr = tl.data ? nextTransition(tl.data, 'earth', tt, ms) : null
  const lookDir = sky ? (look === 'sun' ? sky.sun.dir : sky.earth.dir) : ([0, 0, -1] as [number, number, number])
  const m = terrain.data?.meta
  const site = sites.data?.find((x) => x.id === siteId)
  // tracks on the panorama: the next 30 days from the chosen moment (a whole year is a tangle of loops)
  const range = tl.data ? indexRange(ms, tt, Math.min(e, tt + 30 * 86_400_000)) : null
  const sunWide = sky ? 2 * sky.sun.angular_radius_deg : null
  const widths = sky && sunWide ? sky.sun.el / sunWide : null

  return (
    <div className="page horizon">
      <PageHead
        stamp={`Sheet 04 / Site ${siteNo(sites.data, siteId)} ${site?.name ?? ''} / ${mode === 'site' ? 'Eye level, 2 m above the ground' : 'From above, 1.8 km up'}`}
        title="Stand on the site and look around"
        lede={
          sky && widths !== null
            ? sky.sun.el >= 0
              ? `The Sun is ${sky.sun.el.toFixed(2)}° up, ${widths.toFixed(1)} of its own widths. Every hill on the horizon matters.`
              : `The Sun is ${Math.abs(sky.sun.el).toFixed(2)}° below the level line; from a raised site it can still be seen over lower ground.`
            : 'Real LOLA terrain around the site, the Sun and the Earth in their true directions.'
        }
      />

      <div className="toolbar">
        <SiteSelect sites={sites.data ?? []} value={siteId} onChange={setSite} />
        <div className="seg" role="group" aria-label="Camera">
          <button aria-pressed={mode === 'site'} onClick={() => setMode('site')}>Eye level</button>
          <button aria-pressed={mode === 'overview'} onClick={() => setMode('overview')}>From above</button>
        </div>
        <div className="seg" role="group" aria-label="Look towards">
          <button aria-pressed={look === 'sun'} onClick={() => setLook('sun')}>Face the Sun</button>
          <button aria-pressed={look === 'earth'} onClick={() => setLook('earth')}>Face Earth</button>
        </div>
        <div className="seg" role="group" aria-label="Disc size">
          <button aria-pressed={enlarge === 1} onClick={() => setEnlarge(1)}>True size</button>
          <button aria-pressed={enlarge === 5} onClick={() => setEnlarge(5)}>5× for clarity</button>
        </div>
        <span className="hint">Drag to look around / Ctrl + wheel to zoom</span>
      </div>

      <section className="panel scene-panel" aria-label="3D scene">
        <div className="scene-cap label">
          <span>Live 3D scene: LOLA terrain{m ? ` ${(m.size_m / 1000).toFixed(0)} × ${(m.size_m / 1000).toFixed(0)} km` : ''}, far hills from the horizon mask</span>
          <span>{dateTimeUtc(tt)}</span>
        </div>
        <div className="stage">
          {custom ? (
            <div className="stage-loading">3D terrain is drawn for the listed sites. For your point, the whole horizon is below, computed from the 240 m grid.</div>
          ) : terrain.error || tl.error ? (
            <div className="stage-loading">
              <Notice tone="error" title="No 3D data for this site yet">
                {(terrain.error ?? tl.error)?.message}
              </Notice>
            </div>
          ) : !ready ? (
            <div className="stage-loading" aria-busy="true">
              Loading terrain…
            </div>
          ) : (
            <Suspense fallback={<div className="stage-loading">Loading 3D…</div>}>
              <Scene terrain={terrain.data!} horizon={horizon.data} sky={sky!} mode={mode} enlarge={enlarge} exaggeration={1} lookDir={lookDir} resetKey={`${siteId}|${look}`} overlay={overlay} />
            </Suspense>
          )}
          <div className="ov ov-ladder" ref={ladder} aria-hidden="true">
            {[-4, -2, 0, 2, 4, 6].map((v) => (
              <span key={v} data-el={v}>
                {v}°
              </span>
            ))}
          </div>
          <div className="ov ov-az" ref={azr} aria-hidden="true">
            <span style={{ left: 0 }} />
            <span style={{ left: '50%' }} />
            <span style={{ left: '100%' }} />
          </div>
          {mode === 'overview' && (
            <p className="ov ov-note">
              Camera 1.8 km above the site, so the Sun looks higher above the hills than it does from the ground. Elevations are measured at the site: switch to eye level.
            </p>
          )}
        </div>
        {sky && sunTr && earthTr && (
          <div className="status">
            <p>
              <b className="sun-t">Sun</b> {Math.abs(sky.sun.el).toFixed(2)}° {sky.sun.el >= 0 ? 'up' : 'below level'} / azimuth {sky.sun.az.toFixed(0)}° /{' '}
              {riseSet(sunTr, 'sets in', 'rises in', 'never sets in the data', 'never rises in the data')}
            </p>
            <p>
              <b className="earth-t">Earth</b> {Math.abs(sky.earth.el).toFixed(2)}° {sky.earth.el >= 0 ? 'up' : 'below level'} / azimuth {sky.earth.az.toFixed(0)}° /{' '}
              {riseSet(earthTr, 'sets in', 'rises in', 'never sets in the data', 'never rises in the data')}
            </p>
            <p>
              <b>Terrain towards the Sun</b> {sky.sun.horizon_el.toFixed(2)}° / clearance {(sky.sun.el - sky.sun.horizon_el).toFixed(2)}°
            </p>
          </div>
        )}
      </section>

      <PeriodMovedNote moved={moved} />

      <section className="panel" aria-label="The whole horizon, unrolled">
        <div className="panel-head">
          <h2>The whole horizon, unrolled</h2>
          <span className="label">720 directions / terrain out to 150 km / vertical scale stretched</span>
        </div>
        <div className="panel-pad pano">
          {horizon.data && sky && tl.data && range ? (
            <HorizonPanorama horizon={horizon.data} sky={sky} tl={tl.data} i0={range[0]} i1={range[1]} />
          ) : horizon.error ? (
            <Notice tone="error" title="No horizon mask for this site yet">
              {horizon.error.message}
            </Notice>
          ) : (
            <div className="skeleton line-skeleton" aria-busy="true" />
          )}
          <div className="play-row" style={{ marginTop: 12 }}>
            <button className="btn ghost" onClick={() => setPlaying((p) => !p)} aria-pressed={playing}>
              {playing ? 'Pause' : 'Play'}
            </button>
            <TimeSlider from={f} to={e} value={tt} onChange={setTime} />
          </div>
        </div>
      </section>

      {sky && (
        <p className="label">
          Disc sizes: Sun {(2 * sky.sun.angular_radius_deg).toFixed(2)}° wide, Earth {(2 * sky.earth.angular_radius_deg).toFixed(1)}° wide / No atmosphere, the horizon is terrain only
          {m?.mock ? ' / synthetic terrain' : ''}
        </p>
      )}
    </div>
  )
}
