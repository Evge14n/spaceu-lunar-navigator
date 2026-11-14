// Sheet 00: the whole Moon. Turn the globe, tap anywhere, and open the 3D view of that point.
// The model and the picking live in globe/GlobeScene.tsx; the frame, the inverse transform and
// the constants are in globe/frame.ts; what the model has to satisfy is in GLOBE.md next to this file.

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { customId, meToScene, toLatLon, useSites, useSunDirection, type Site } from '../api'
import { TimeSlider } from '../components/Controls'
import { Notice } from '../components/Notice'
import { PageHead } from '../components/PageHead'
import { dateTimeUtc, latLon as fmtLatLon, siteNo } from '../format'
import { useAppState } from '../state'
import {
  dirFromLatLon,
  distanceKm,
  GLOBE_MODEL_FRAME,
  GLOBE_MODEL_SPIN_DEG,
  normalizeLon,
  ORIENTATION_MARKERS,
  roundCoord,
  type ModelFrame,
  type ModelSummary,
} from './globe/frame'

const GlobeScene = lazy(() => import('./globe/GlobeScene'))

const STORE_KEY = 'spaceu.globe.orientation'

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

const nearestSite = (sites: Site[], lat: number, lon: number) => {
  let best: { site: Site; km: number } | null = null
  for (const s of sites) {
    if (s.lat === null || s.lon === null) continue
    const km = distanceKm(lat, lon, s.lat, s.lon)
    if (!best || km < best.km) best = { site: s, km }
  }
  return best
}

export default function GlobePage() {
  const { t, from, to, setTime, siteId, setSite, navigate } = useAppState()
  const sites = useSites()
  const list = useMemo(() => (sites.data ?? []).filter((s) => s.lat !== null && s.lon !== null), [sites.data])
  const sunMe = useSunDirection(t)
  const sunScene = sunMe ? (meToScene(sunMe) as [number, number, number]) : null
  const sub = sunMe ? toLatLon(sunMe) : null
  const [model, setModel] = useState<ModelSummary>({ kind: 'loading' })

  const [pin, setPin] = useState<{ lat: number; lon: number } | null>(null)
  const [text, setText] = useState({ lat: '', lon: '' })
  const [orientation, setOrientation] = useState(loadOrientation)
  const [showOrientation, setShowOrientation] = useState(false)
  const [focus, setFocus] = useState<{ dir: [number, number, number]; distance: number; key: number } | null>(null)
  const focusKey = useRef(0)
  const liveRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => saveOrientation(orientation), [orientation])

  const place = (lat: number, lon: number) => {
    const p = { lat: roundCoord(lat), lon: roundCoord(normalizeLon(lon)) }
    setPin(p)
    setText({ lat: String(p.lat), lon: String(p.lon) })
  }

  const lookAt = (lat: number, lon: number, distance = 2.6) => {
    focusKey.current += 1
    setFocus({ dir: dirFromLatLon(lat, lon) as [number, number, number], distance, key: focusKey.current })
  }

  const pickSite = (id: string) => {
    const s = list.find((x) => x.id === id)
    if (!s || s.lat === null || s.lon === null) return
    setSite(id)
    place(s.lat, s.lon)
  }

  const typed = { lat: Number(text.lat), lon: Number(text.lon) }
  const typedOk = text.lat.trim() !== '' && text.lon.trim() !== '' && Number.isFinite(typed.lat) && Number.isFinite(typed.lon) && Math.abs(typed.lat) <= 90 && typed.lon >= -180 && typed.lon <= 360

  const near = pin ? nearestSite(list, pin.lat, pin.lon) : null
  /** within a tile of a prepared site: use its full-quality data instead of a custom point */
  const samePrepared = near && near.km < 5 ? near.site : null

  const openHere = () => {
    if (!pin) return
    setSite(samePrepared ? samePrepared.id : customId(pin.lat, pin.lon))
    navigate('/horizon')
  }

  const modelNote =
    model.kind === 'sphere'
      ? model.reason === 'no model file yet'
        ? 'No relief model yet: a plain sphere stands in for it. Drop moon.glb into frontend/public/moon/ (see GLOBE.md) and reload.'
        : `The model could not be used (${model.reason}); a plain sphere stands in for it.`
      : null

  return (
    <div className="page globe">
      <PageHead
        stamp={`Sheet 00 / The whole Moon / ${model.kind === 'model' ? 'LRO relief model' : model.kind === 'sphere' ? 'sphere stand-in' : 'loading'}`}
        title="Pick any point on the Moon"
        lede="Turn the globe and tap where you would land. The Sun lights it from the true direction of that moment; the ten prepared sites are the blue dots at the south pole."
      />

      <section className="panel scene-panel" aria-label="Globe">
        <div className="scene-cap label">
          <span>
            {model.kind === 'model'
              ? `Model: ${model.url.split('/').pop()}, ${model.triangles.toLocaleString('en-US')} triangles`
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
              sites={list}
              selectedId={siteId}
              pick={pin}
              onPick={place}
              onPickSite={pickSite}
              showOrientation={showOrientation}
              frame={orientation.frame}
              spin={orientation.spin}
              onModel={setModel}
              focus={focus}
            />
          </Suspense>
        </div>

        <div className="status">
          <p ref={liveRef} aria-live="polite">
            <b>Picked</b>{' '}
            {pin ? (
              <>
                {fmtLatLon(pin.lat, pin.lon)}
                {samePrepared ? ` / site ${siteNo(sites.data, samePrepared.id)} ${samePrepared.name}, full-quality data` : near ? ` / ${near.km.toFixed(0)} km from site ${siteNo(sites.data, near.site.id)} ${near.site.name}` : ''}
              </>
            ) : (
              'nothing yet — tap the globe, or type the coordinates below'
            )}
          </p>
          <p>
            <b className="sun-t">Sun overhead at</b> {sub ? fmtLatLon(sub[0], sub[1]) : '…'} / <b>lit side</b> faces it
          </p>
        </div>
      </section>

      {modelNote && (
        <Notice title="Globe model">
          {modelNote} Everything else on this sheet — the Sun direction, the picking, the coordinates — works either way.
        </Notice>
      )}

      <section className="panel" aria-label="Choose a point">
        <div className="panel-head">
          <h2>Choose a point</h2>
          <span className="label">Latitude −90…90, east longitude 0…360</span>
        </div>
        <div className="panel-pad">
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault()
              if (typedOk) {
                place(typed.lat, typed.lon)
                lookAt(typed.lat, normalizeLon(typed.lon))
              }
            }}
          >
            <div className="field">
              <label htmlFor="glat">Latitude</label>
              <input id="glat" inputMode="decimal" value={text.lat} placeholder="−89.45" onChange={(e) => setText({ ...text, lat: e.target.value })} aria-invalid={!typedOk && text.lat !== ''} />
            </div>
            <div className="field">
              <label htmlFor="glon">Longitude, east</label>
              <input id="glon" inputMode="decimal" value={text.lon} placeholder="222.7" onChange={(e) => setText({ ...text, lon: e.target.value })} aria-invalid={!typedOk && text.lon !== ''} />
            </div>
            <button className="btn ghost" type="submit" disabled={!typedOk}>
              Put the pin there
            </button>
          </form>

          <div className="toolbar" style={{ marginTop: 12 }}>
            <button className="btn" type="button" disabled={!pin} onClick={openHere}>
              Open 3D view here
            </button>
            <div className="seg" role="group" aria-label="Turn the globe to">
              <button type="button" onClick={() => lookAt(-90, 0, 2.2)}>
                South pole
              </button>
              <button type="button" onClick={() => lookAt(0, 0, 2.8)}>
                Near side
              </button>
              <button type="button" onClick={() => lookAt(0, 180, 2.8)}>
                Far side
              </button>
            </div>
            <span className="hint">Drag to turn / Ctrl + wheel or pinch to zoom / tap to drop the pin</span>
          </div>

          <div className="play-row" style={{ marginTop: 14 }}>
            <TimeSlider from={from} to={to} value={t} onChange={setTime} />
          </div>
        </div>
      </section>

      <section className="panel" aria-label="Model orientation">
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
            All three in place means the globe and the data agree, and a tap gives the right coordinates. When they do not, turn the model here and write the result into
            GLOBE_MODEL_FRAME and GLOBE_MODEL_SPIN_DEG in <span className="mono">view3d/globe/frame.ts</span>.
          </p>
        </div>
      </section>
    </div>
  )
}
