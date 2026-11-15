// Sheet 04: stand on the site and look around. Owner of the 3D scene: Anastasiia Sh. (Scene.tsx).
// Default view is at eye level, 2 m above the ground, where elevations read as they are measured.

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { indexRange, isCustom, nextTransition, riseSet, skyAt, timesMs, useHorizonAt, useSites, useTerrain, useTimelineAt } from '../api'
import { clampPeriod, HeightSwitch, PeriodMovedNote, SiteSelect, TimeSlider } from '../components/Controls'
import { HorizonPanorama } from '../components/HorizonPanorama'
import { Notice } from '../components/Notice'
import { PageHead } from '../components/PageHead'
import { dateTimeUtc, siteTitle } from '../format'
import { useAppState } from '../state'
import { nightAt, type Night } from './night'
import type { CameraMode } from './Scene'
import { dataPath, parseCustomId } from './globe/route'
import { useCustomSite } from './globe/useCustomSite'
import type { GroundStatus } from './globe/StandOnGlobe'

// a finger, not a mouse: OrbitControls zooms by pinching, there is no Ctrl + wheel
const touch = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches

// three.js loads after the page frame is on screen.
const Scene = lazy(() => import('./Scene').then((m) => ({ default: m.Scene })))
// the globe ground brings the model with it: only loaded when a point of your own is shown
const StandOnGlobe = lazy(() => import('./globe/StandOnGlobe'))

/** Said in words when the Sun is behind the terrain, so a dark scene does not look broken. */
function NightBanner({ night, onJump }: { night: Night; onJump: () => void }) {
  return (
    <div className="night">
      <span className="label">
        Night here<span className="night-why"> / the Sun is below the horizon</span>
      </span>
      <b className="night-t">{night.riseIn ? `Sunrise in ${night.riseIn}` : 'No sunrise in the computed data'}</b>
      {night.jumpTo !== null && (
        <button type="button" className="btn" onClick={onJump}>
          Jump to sunrise
        </button>
      )}
    </div>
  )
}

/**
 * Above the panorama: the same line by day and by night, in a box of fixed height, so the Play
 * button and the slider below never jump when the Sun rises or sets during Play.
 */
function SunLine({ night, setsIn, onJump }: { night: Night | null; setsIn: string; onJump: () => void }) {
  if (!night)
    return (
      <div className="night compact day">
        <span className="label">Sun in view here</span>
        <b className="night-t">{setsIn}</b>
      </div>
    )
  return (
    <div className="night compact">
      <span className="label">
        Night here<span className="night-why"> / the Sun is below the horizon</span>
      </span>
      <b className="night-t">{night.riseIn ? `Sunrise in ${night.riseIn}` : 'No sunrise in the computed data'}</b>
      {night.jumpTo !== null && (
        <button type="button" className="btn" onClick={onJump}>
          Jump to sunrise
        </button>
      )}
    </div>
  )
}

export default function View3DPage() {
  const { siteId, setSite, from, to, t, setTime, heightM, setHeight, href } = useAppState()
  const sites = useSites()
  const custom = !!siteId && isCustom(siteId)
  // other instrument heights are published for the listed sites only
  const h = custom ? 2 : heightM
  // Listed sites and your own points inside the 240 m polar grid keep the data layer exactly as
  // it was (main: no 3D tile for your own point there, the horizon is unrolled below); anywhere
  // else on the Moon the sky, the mask and the ground are computed here (route.ts).
  const path = dataPath(siteId)
  const apiId = path === 'browser-globe' ? null : siteId
  const tlA = useTimelineAt(apiId, h)
  const terrainA = useTerrain(path === 'static' ? siteId : null)
  const horizonA = useHorizonAt(apiId, h)
  const local = useCustomSite(path === 'browser-globe' ? siteId : null)
  const tl = { data: tlA.data ?? local.data?.timeline ?? null, error: tlA.error ?? local.error, loading: tlA.loading || local.loading }
  const terrain = { data: terrainA.data ?? local.data?.terrain ?? null, error: terrainA.error ?? local.error, loading: terrainA.loading || local.loading }
  const horizon = { data: horizonA.data ?? local.data?.horizon ?? null, error: horizonA.error ?? local.error, loading: horizonA.loading || local.loading }
  const coarse = local.data?.coarse ?? null
  // A point of your own stands on the globe model itself; the tile is only drawn for the
  // prepared sites. The ground waits for the worker, so both come from the same heights.
  const point = parseCustomId(siteId)
  const onGlobe = path === 'browser-globe' && !!point
  const [groundState, setGroundState] = useState<GroundStatus>({ loading: true, error: null, spacingKm: null, triangles: 0 })
  const [mode, setMode] = useState<CameraMode>('site')
  const [enlarge, setEnlarge] = useState(1)
  const [face, setLook] = useState<'sun' | 'earth'>('sun')
  const [playing, setPlaying] = useState(false)
  // bumped by "Jump to sunrise" so the camera turns to where the Sun comes up
  const [aim, setAim] = useState(0)
  // camera re-aims when this changes (part of the scene's resetKey): another body, or a jump to sunrise
  const look = aim ? `${face}#${aim}` : face
  const ladder = useRef<HTMLDivElement>(null)
  const scenePanel = useRef<HTMLElement>(null)
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

  const { setPeriod } = useAppState()
  const night = tl.data ? nightAt(tl.data, tt, ms) : null
  const jumpToSunrise = () => {
    if (!night || night.jumpTo === null) return
    setPlaying(false)
    if (night.jumpTo > e) setPeriod(f, ms[ms.length - 1])
    setTime(night.jumpTo)
    setLook('sun')
    setAim((a) => a + 1)
    // the button goes away with the night: keep keyboard focus on the scene it changed
    scenePanel.current?.focus({ preventScroll: true })
  }
  const ready = onGlobe ? !!tl.data && !groundState.loading && !groundState.error : !!(tl.data && terrain.data)
  const sky = tl.data ? skyAt(tl.data, tt, ms) : null
  const sunTr = tl.data ? nextTransition(tl.data, 'sun', tt, ms) : null
  const earthTr = tl.data ? nextTransition(tl.data, 'earth', tt, ms) : null
  const lookDir = sky ? (face === 'sun' ? sky.sun.dir : sky.earth.dir) : ([0, 0, -1] as [number, number, number])
  const m = terrain.data?.meta
  const sizeKm = m ? m.size_m / 1000 : null
  const sample = coarse?.pixelM ? (coarse.pixelM >= 1000 ? `${(coarse.pixelM / 1000).toFixed(1)} km` : `${Math.round(coarse.pixelM)} m`) : null
  // never let a tile built from the global model read as the 20 m LOLA data of a listed site
  // measured from the model that is actually loaded, never hard-coded
  const modelSpacingKm = groundState.spacingKm
  const rescale = coarse?.calibration && coarse.calibration.n > 0 ? ` / relief rescaled to LOLA × ${coarse.calibration.scale.toFixed(2)}` : ''
  const terrainCaption = onGlobe
    ? `Terrain: global model, about ${modelSpacingKm ? modelSpacingKm.toFixed(1) : '…'} km per sample (coarse)${rescale}`
    : !coarse
      ? `Live 3D scene: LOLA terrain${sizeKm ? ` ${sizeKm.toFixed(0)} × ${sizeKm.toFixed(0)} km` : ''}, far hills from the horizon mask`
      : coarse.sourceId === 'sphere'
        ? 'No elevation model for this point: smooth sphere of 1737.4 km'
        : `${coarse.sourceId === 'lola240' ? 'LOLA 240 m terrain' : 'Coarse terrain from the global model'}${sizeKm ? ` ${sizeKm.toFixed(1)} × ${sizeKm.toFixed(1)} km` : ''}${sample ? `, ${sample} samples` : ''}`
  // tracks on the panorama: the next 30 days from the chosen moment (a whole year is a tangle of loops)
  const range = tl.data ? indexRange(ms, tt, Math.min(e, tt + 30 * 86_400_000)) : null
  const sunWide = sky ? 2 * sky.sun.angular_radius_deg : null
  const widths = sky && sunWide ? sky.sun.el / sunWide : null

  return (
    <div className="page horizon">
      <PageHead
        stamp={`Sheet 04 / ${siteTitle(sites.data, siteId)} / ${mode === 'site' ? `Eye level, ${h} m above the ground` : 'From above, 1.8 km up'}`}
        title="Stand on the site and look around"
        lede={
          sky && widths !== null
            ? night
              ? `Night here: the terrain hides the Sun${night.riseIn ? `, sunrise in ${night.riseIn}` : ''}. The scene is dark because it is night, not because it is broken.`
              : sky.sun.el >= 0
              ? `The Sun is ${sky.sun.el.toFixed(2)}° up, ${widths.toFixed(1)} of its own widths. Every hill on the horizon matters.`
              : `The Sun is ${Math.abs(sky.sun.el).toFixed(2)}° below the level line; from a raised site it can still be seen over lower ground.`
            : path === 'static'
              ? 'Real LOLA terrain around the site, the Sun and the Earth in their true directions.'
              : 'Your own point: the Sun and the Earth in their true directions, the terrain as well as the published models can tell.'
        }
      />

      <div className="toolbar">
        <SiteSelect sites={sites.data ?? []} value={siteId} onChange={setSite} />
        <HeightSwitch value={h} onChange={setHeight} disabled={custom} />
        <div className="seg" role="group" aria-label="Camera">
          <button aria-pressed={mode === 'site'} onClick={() => setMode('site')}>Eye level</button>
          <button aria-pressed={mode === 'overview'} onClick={() => setMode('overview')}>From above</button>
        </div>
        <div className="seg" role="group" aria-label="Look towards">
          <button aria-pressed={face === 'sun'} onClick={() => setLook('sun')}>Face the Sun</button>
          <button aria-pressed={face === 'earth'} onClick={() => setLook('earth')}>Face Earth</button>
        </div>
        <div className="seg" role="group" aria-label="Disc size">
          <button aria-pressed={enlarge === 1} onClick={() => setEnlarge(1)}>True size</button>
          <button aria-pressed={enlarge === 5} onClick={() => setEnlarge(5)}>5× for clarity</button>
        </div>
        <a className="btn ghost" href={href('/globe')}>
          Pick another point
        </a>
        <span className="hint">Drag to look around / {touch ? 'pinch' : 'Ctrl + wheel'} to zoom</span>
      </div>

      <section className="panel scene-panel" aria-label="3D scene" ref={scenePanel} tabIndex={-1}>
        <div className="scene-cap label">
          <span>{custom && !onGlobe ? 'Your point / horizon from the 240 m grid' : terrainCaption}</span>
          <span>{dateTimeUtc(tt)}</span>
        </div>
        {custom && !onGlobe ? (
          <p className="stage-note">No 3D for your own point: its whole horizon is unrolled below.</p>
        ) : (
        <div className="stage">
          {(onGlobe ? tl.error : terrain.error || tl.error) ? (
            <div className="stage-loading">
              <Notice tone="error" title="No 3D data for this site yet">
                {(terrain.error ?? tl.error)?.message}
              </Notice>
            </div>
          ) : onGlobe && groundState.error ? (
            <div className="stage-loading">
              <Notice tone="error" title="The globe model is not there">
                {groundState.error}. Open the globe sheet to check the model, or pick a point near the south pole, where the LOLA grid works without it.
              </Notice>
            </div>
          ) : !ready && !onGlobe ? (
            <div className="stage-loading" aria-busy="true">
              Loading terrain…
            </div>
          ) : onGlobe ? (
            <Suspense fallback={<div className="stage-loading">Loading 3D…</div>}>
              {sky && (
                <StandOnGlobe
                  latDeg={point!.lat}
                  lonDeg={point!.lon}
                  calibration={coarse?.calibration ?? null}
                  onStatus={setGroundState}
                  sky={sky}
                  mode={mode}
                  enlarge={enlarge}
                  lookDir={lookDir}
                  resetKey={`${siteId}|${look}`}
                  overlay={overlay}
                />
              )}
            </Suspense>
          ) : (
            <Suspense fallback={<div className="stage-loading">Loading 3D…</div>}>
              <Scene terrain={terrain.data!} horizon={horizon.data} sky={sky!} mode={mode} enlarge={enlarge} exaggeration={1} lookDir={lookDir} resetKey={`${siteId}|${look}`} overlay={overlay} eyeM={h} />
            </Suspense>
          )}
          {onGlobe && !ready && !groundState.error && (
            <div className="stage-loading" aria-busy="true">
              Building the ground from the globe model…
            </div>
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
          <div className="ov-top">
            {night && <NightBanner night={night} onJump={jumpToSunrise} />}
            {mode === 'overview' &&
              (onGlobe ? (
                <p className="ov-note">
                  <span className="long">Camera a few hundred kilometres up, so the Sun looks higher above the hills than it does from the ground. Elevations are measured at the point: switch to eye level.</span>
                  <span className="short">Camera far up: the Sun looks higher than from the ground.</span>
                </p>
              ) : (
                <p className="ov-note">
                  <span className="long">Camera 1.8 km above the site, so the Sun looks higher above the hills than it does from the ground. Elevations are measured at the site: switch to eye level.</span>
                  <span className="short">Camera 1.8 km up: the Sun looks higher than from the ground.</span>
                </p>
              ))}
          </div>
        </div>
        )}
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

      {onGlobe && (
        <Notice title="You are standing on the global model">
          The ground is the model's own surface, about {modelSpacingKm ? modelSpacingKm.toFixed(1) : '…'} km between its samples — from 2 m up, the
          horizon of a smooth Moon is 2.4 km away, so the ground right at your feet is one flat triangle. Hills tens of kilometres away are real shapes;
          nothing smaller than a few kilometres exists in this model, and none of it is invented to fill the gap.
          {coarse?.calibration && coarse.calibration.n > 0
            ? ` The model exaggerates relief, so its heights are rescaled by ${coarse.calibration.scale.toFixed(2)} to match LOLA (measured at ${coarse.calibration.n} points, correlation ${coarse.calibration.r.toFixed(2)}).`
            : ' The model\u2019s relief has not been checked against LOLA in this browser yet, so heights may be exaggerated.'}
        </Notice>
      )}

      {!onGlobe && coarse && coarse.sourceId !== 'lola240' && (
        <Notice title={coarse.sourceId === 'sphere' ? 'This point has no terrain model' : 'Coarse terrain from the global model'}>
          {coarse.sourceId === 'sphere'
            ? 'The Sun and the Earth are the real ones, computed from the NASA ephemeris. The ground is a smooth sphere of 1737.4 km: nothing published in this project covers this point, so the skyline you see is the geometric horizon, not real hills.'
            : `Heights here come from ${coarse.label}, about ${sample} per sample — hills and crater walls are real but flattened, and small ridges are missing. It is an estimate, not the LOLA 20 m data of the ten prepared sites.`}
          {coarse.missing > 0.01 ? ` ${(coarse.missing * 100).toFixed(0)} % of the samples fell outside the model and were taken as level ground.` : ''}
        </Notice>
      )}

      <PeriodMovedNote moved={moved} />

      <section className="panel" aria-label="The whole horizon, unrolled">
        <div className="panel-head">
          <h2>The whole horizon, unrolled</h2>
          <span className="label">720 directions / terrain out to 150 km / vertical scale stretched</span>
        </div>
        <div className="panel-pad pano">
          {sunTr && <SunLine night={night} setsIn={riseSet(sunTr, 'Sunset in', 'Sunrise in', 'No sunset in the computed data', 'No sunrise in the computed data')} onJump={jumpToSunrise} />}
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
          {coarse ? ` / ${coarse.label}` : ''}
        </p>
      )}
    </div>
  )
}
