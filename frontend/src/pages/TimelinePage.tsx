import { memo, useDeferredValue, useMemo } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  formatHours,
  indexRange,
  nextTransition,
  periodPresets,
  runs,
  skyAt,
  summarize,
  timesMs,
  useSites,
  useHorizon,
  useTimeline,
  visibleFlags,
  riseSet,
  type Timeline,
} from '../api'
import { clampPeriod, fmtUtc, PeriodMovedNote, PeriodPicker, SiteSelect, TimeSlider } from '../components/Controls'
import { Notice } from '../components/Notice'
import { HorizonPanorama } from '../components/HorizonPanorama'
import { useAppState } from '../state'

/** One tick per day (or every few days for long periods), at 00:00 UTC. */
function dayTicks(from: number, to: number): number[] {
  const day = 86_400_000
  const days = (to - from) / day
  const every = days <= 16 ? 1 : days <= 40 ? 2 : days <= 100 ? 7 : 30
  const out: number[] = []
  for (let t = Math.ceil(from / day) * day; t <= to; t += every * day) out.push(t)
  return out
}

const fmtTick = (t: number) => {
  const d = new Date(t)
  return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Strip of shaded windows when a body is visible. */
const WindowStrip = memo(function WindowStrip({
  tl,
  ms,
  body,
  i0,
  i1,
  from,
  to,
  label,
}: {
  tl: Timeline
  ms: number[]
  body: 'sun' | 'earth'
  i0: number
  i1: number
  from: number
  to: number
  label: string
}) {
  const rs = runs(visibleFlags(tl, body), i0, i1).filter((r) => r.value)
  const span = to - from || 1
  const x = (t: number) => ((t - from) / span) * 100
  return (
    <div className="strip-row">
      <span className="strip-label">{label}</span>
      <svg className={`strip strip-${body}`} viewBox="0 0 100 10" preserveAspectRatio="none" role="img" aria-label={`${label}: ${rs.length} windows in the period`}>
        <rect x="0" y="0" width="100" height="10" className="strip-bg" />
        {rs.map((r) => (
          <rect key={r.i0} x={x(ms[r.i0])} width={Math.max(0.15, x(ms[r.i1]) - x(ms[r.i0]))} y="0" height="10" className="strip-on" />
        ))}
      </svg>
    </div>
  )
})

function TimelineHead() {
  return (
    <div className="page-head">
      <h1>Timeline</h1>
      <p className="lede">Sun and Earth elevation against the real horizon of the site. Shaded strips show when each is visible.</p>
    </div>
  )
}

export default function TimelinePage() {
  const { siteId, setSite, from, to, setPeriod, t, setTime } = useAppState()
  const sites = useSites()
  const tl = useTimeline(siteId)
  const horizon = useHorizon(siteId)

  const view = useMemo(() => {
    if (!tl.data) return null
    const ms = timesMs(tl.data)
    const [f, e, moved] = clampPeriod(from, to, ms)
    const range = indexRange(ms, f, e)
    if (!range) return null
    const [i0, i1] = range
    const d = tl.data
    const rows = []
    // about one point per 2 screen pixels: enough for the eye, far less work on phones
    const maxPoints = Math.min(700, Math.max(240, Math.round(window.innerWidth * 0.55)))
    const every = Math.max(1, Math.ceil((i1 - i0 + 1) / maxPoints))
    for (let i = i0; i <= i1; i += every) {
      rows.push({
        t: ms[i],
        sun: d.sun.el[i],
        sunHz: d.sun.horizon_el[i],
        earth: d.earth.el[i],
        earthHz: d.earth.horizon_el[i],
      })
    }
    const sum = summarize(d, { id: d.site.id, name: d.site.id }, f, e)
    return { ms, f, e, i0, i1, rows, moved, sum, presets: periodPresets([d]) }
  }, [tl.data, from, to])
  const tChart = useDeferredValue(t)

  if (sites.loading || tl.loading)
    return (
      <div className="page timeline">
        <TimelineHead />
        <div className="skeleton page-skeleton" aria-busy="true" />
      </div>
    )
  if (tl.error)
    return (
      <div className="page timeline">
        <TimelineHead />
        {sites.data && <SiteSelect sites={sites.data} value={siteId} onChange={setSite} />}
        <Notice tone="error" title="No timeline for this site yet">{tl.error.message}</Notice>
      </div>
    )
  if (!tl.data || !view) return <Notice title="Pick a site and a period inside the data range" />

  const d = tl.data
  const tt = Math.min(Math.max(t, view.f), view.e)
  const sky = skyAt(d, tt, view.ms)
  const sunTr = nextTransition(d, 'sun', tt, view.ms)
  const earthTr = nextTransition(d, 'earth', tt, view.ms)
  const sum = view.sum

  return (
    <div className="page timeline">
      <TimelineHead />

      <div className="toolbar">
        {sites.data && <SiteSelect sites={sites.data} value={siteId} onChange={setSite} />}
        <PeriodPicker from={view.f} to={view.e} min={view.ms[0]} max={view.ms[view.ms.length - 1]} onChange={setPeriod} presets={view.presets} />
      </div>

      <PeriodMovedNote moved={view.moved} />
      <section className="readout" aria-label="At the selected time">
        <div className="read read-sun">
          <h2>Sun</h2>
          <p className="big">{riseSet(sunTr, 'Sunset in', 'Below the terrain, sunrise in', 'No sunset in the data', 'No sunrise in the data')}</p>
          <dl>
            <dt>Elevation</dt><dd>{sky.sun.el.toFixed(2)}°</dd>
            <dt>Terrain in that direction</dt><dd>{sky.sun.horizon_el.toFixed(2)}°</dd>
            <dt>Azimuth</dt><dd>{sky.sun.az.toFixed(1)}°</dd>
            <dt>Disc visible</dt><dd>{Math.round(sky.sun.visible_fraction * 100)} %</dd>
          </dl>
        </div>
        <div className="read read-earth">
          <h2>Earth</h2>
          <p className="big">{riseSet(earthTr, 'Earthset in', 'Hidden, Earthrise in', 'No Earthset in the data', 'No Earthrise in the data')}</p>
          <dl>
            <dt>Elevation</dt><dd>{sky.earth.el.toFixed(2)}°</dd>
            <dt>Terrain in that direction</dt><dd>{sky.earth.horizon_el.toFixed(2)}°</dd>
            <dt>Azimuth</dt><dd>{sky.earth.az.toFixed(1)}°</dd>
            <dt>Direct link</dt><dd>{sky.earth.visible ? 'possible' : 'no line of sight'}</dd>
          </dl>
        </div>
        <div className="read read-period">
          <h2>Whole period</h2>
          <dl>
            <dt>Sunlit</dt><dd>{sum.sun.lit_percent} %</dd>
            <dt>Longest darkness</dt><dd>{formatHours(sum.sun.longest_dark_h)}</dd>
            <dt>Earth visible</dt><dd>{sum.earth.visible_percent} %</dd>
            <dt>Highest Sun</dt><dd>{sum.sun.max_el.toFixed(2)}°</dd>
          </dl>
        </div>
      </section>

      <TimeSlider from={view.f} to={view.e} value={tt} onChange={setTime} />

      <figure className="chart" aria-label="Elevation of the Sun and the Earth over time">
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart
            data={view.rows}
            margin={{ top: 8, right: 8, bottom: 0, left: -18 }}
            onClick={(e) => {
              const x = (e as { activeLabel?: number | string } | null)?.activeLabel
              if (x !== undefined) setTime(Number(x))
            }}
          >
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="t" type="number" domain={[view.f, view.e]} scale="time" ticks={dayTicks(view.f, view.e)} tickFormatter={fmtTick} stroke="var(--ink-3)" tick={{ fontSize: 12 }} minTickGap={16} />
            <YAxis unit="°" stroke="var(--ink-3)" tick={{ fontSize: 12 }} domain={['auto', 'auto']} />
            <Tooltip
              labelFormatter={(v) => fmtUtc(Number(v))}
              formatter={(v, name) => [`${Number(v).toFixed(2)}°`, name]}
              contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8 }}
              labelStyle={{ color: 'var(--ink-2)' }}
              itemStyle={{ color: 'var(--ink-1)' }}
            />
            <Area dataKey="sunHz" name="Terrain toward the Sun" type="monotone" stroke="none" fill="var(--terrain)" fillOpacity={0.9} isAnimationActive={false} baseValue="dataMin" />
            <Line dataKey="earthHz" name="Terrain toward Earth" type="monotone" stroke="var(--earth)" strokeOpacity={0.45} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
            <Line dataKey="sun" name="Sun elevation" type="monotone" stroke="var(--sun)" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line dataKey="earth" name="Earth elevation" type="monotone" stroke="var(--earth)" strokeWidth={2} dot={false} isAnimationActive={false} />
            <ReferenceLine x={Math.min(Math.max(tChart, view.f), view.e)} stroke="var(--ink-1)" strokeWidth={1} />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="strips">
          <WindowStrip tl={d} ms={view.ms} body="sun" i0={view.i0} i1={view.i1} from={view.f} to={view.e} label="Sun visible" />
          <WindowStrip tl={d} ms={view.ms} body="earth" i0={view.i0} i1={view.i1} from={view.f} to={view.e} label="Earth visible" />
        </div>
        <figcaption>
          Grey area: height of the mountains in the direction of the Sun. The Sun counts as visible while any part of its disc is above them. Click the chart to jump to a moment.
        </figcaption>
      </figure>
      {horizon.data && <HorizonPanorama horizon={horizon.data} sky={sky} tl={d} i0={view.i0} i1={view.i1} />}
      <p className="source">Source: {d.source}</p>
    </div>
  )
}
