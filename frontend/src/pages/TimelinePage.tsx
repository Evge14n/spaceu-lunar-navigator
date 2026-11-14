import { useMemo } from 'react'
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
  runs,
  skyAt,
  summarize,
  timesMs,
  useSites,
  useTimeline,
  visibleFlags,
  type Timeline,
} from '../api'
import { clampPeriod, fmtUtc, PeriodPicker, SiteSelect, TimeSlider } from '../components/Controls'
import { Notice } from '../components/Notice'
import { useAppState } from '../state'

const fmtTick = (t: number) => {
  const d = new Date(t)
  return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Strip of shaded windows when a body is visible. */
function WindowStrip({
  tl,
  body,
  i0,
  i1,
  from,
  to,
  label,
}: {
  tl: Timeline
  body: 'sun' | 'earth'
  i0: number
  i1: number
  from: number
  to: number
  label: string
}) {
  const ms = timesMs(tl)
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
}

export default function TimelinePage() {
  const { siteId, setSite, from, to, setPeriod, t, setTime } = useAppState()
  const sites = useSites()
  const tl = useTimeline(siteId)
  const site = sites.data?.find((s) => s.id === siteId)

  const view = useMemo(() => {
    if (!tl.data) return null
    const ms = timesMs(tl.data)
    const [f, e] = clampPeriod(from, to, ms)
    const range = indexRange(ms, f, e)
    if (!range) return null
    const [i0, i1] = range
    const d = tl.data
    const rows = []
    const every = Math.max(1, Math.ceil((i1 - i0 + 1) / 1500))
    for (let i = i0; i <= i1; i += every) {
      rows.push({
        t: ms[i],
        sun: d.sun.el[i],
        sunHz: d.sun.horizon_el[i],
        earth: d.earth.el[i],
        earthHz: d.earth.horizon_el[i],
      })
    }
    return { ms, f, e, i0, i1, rows }
  }, [tl.data, from, to])

  if (sites.loading || tl.loading) return <div className="skeleton page-skeleton" aria-busy="true" />
  if (tl.error) return <Notice tone="error" title="No timeline for this site yet">{tl.error.message}</Notice>
  if (!tl.data || !view) return <Notice title="Pick a site and a period inside the data range" />

  const d = tl.data
  const tt = Math.min(Math.max(t, view.f), view.e)
  const sky = skyAt(d, tt, view.ms)
  const sunTr = nextTransition(d, 'sun', tt, view.ms)
  const earthTr = nextTransition(d, 'earth', tt, view.ms)
  const sum = summarize(d, { id: d.site.id, name: site?.name ?? d.site.id }, view.f, view.e)

  return (
    <div className="page timeline">
      <div className="page-head">
        <h1>Timeline</h1>
        <p className="lede">Sun and Earth elevation against the real horizon of the site. Shaded strips show when each is visible.</p>
      </div>

      <div className="toolbar">
        {sites.data && <SiteSelect sites={sites.data} value={siteId} onChange={setSite} />}
        <PeriodPicker from={view.f} to={view.e} min={view.ms[0]} max={view.ms[view.ms.length - 1]} onChange={setPeriod} />
      </div>

      <section className="readout" aria-live="polite" aria-label="At the selected time">
        <div className="read read-sun">
          <h2>Sun</h2>
          <p className="big">{sunTr.up ? `Sunset in ${formatHours(sunTr.hours)}` : `Below the horizon, sunrise in ${formatHours(sunTr.hours)}`}</p>
          <dl>
            <dt>Elevation</dt><dd>{sky.sun.el.toFixed(2)}°</dd>
            <dt>Terrain in that direction</dt><dd>{sky.sun.horizon_el.toFixed(2)}°</dd>
            <dt>Azimuth</dt><dd>{sky.sun.az.toFixed(1)}°</dd>
            <dt>Disc visible</dt><dd>{Math.round(sky.sun.visible_fraction * 100)} %</dd>
          </dl>
        </div>
        <div className="read read-earth">
          <h2>Earth</h2>
          <p className="big">{earthTr.up ? `Earthset in ${formatHours(earthTr.hours)}` : `Hidden, Earthrise in ${formatHours(earthTr.hours)}`}</p>
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
            <XAxis dataKey="t" type="number" domain={[view.f, view.e]} scale="time" tickFormatter={fmtTick} stroke="var(--ink-3)" tick={{ fontSize: 12 }} minTickGap={24} />
            <YAxis unit="°" stroke="var(--ink-3)" tick={{ fontSize: 12 }} domain={['auto', 'auto']} />
            <Tooltip
              labelFormatter={(v) => fmtUtc(Number(v))}
              formatter={(v, name) => [`${Number(v).toFixed(2)}°`, name]}
              contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8 }}
              labelStyle={{ color: 'var(--ink-2)' }}
            />
            <Area dataKey="sunHz" name="Terrain toward the Sun" type="monotone" stroke="none" fill="var(--terrain)" fillOpacity={0.9} isAnimationActive={false} baseValue="dataMin" />
            <Line dataKey="earthHz" name="Terrain toward Earth" type="monotone" stroke="var(--earth)" strokeOpacity={0.45} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
            <Line dataKey="sun" name="Sun elevation" type="monotone" stroke="var(--sun)" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line dataKey="earth" name="Earth elevation" type="monotone" stroke="var(--earth)" strokeWidth={2} dot={false} isAnimationActive={false} />
            <ReferenceLine x={tt} stroke="var(--ink-1)" strokeWidth={1} />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="strips">
          <WindowStrip tl={d} body="sun" i0={view.i0} i1={view.i1} from={view.f} to={view.e} label="Sun visible" />
          <WindowStrip tl={d} body="earth" i0={view.i0} i1={view.i1} from={view.f} to={view.e} label="Earth visible" />
        </div>
        <figcaption>
          Grey area: height of the mountains in the direction of the Sun. The Sun counts as visible while any part of its disc is above them. Click the chart to jump to a moment.
        </figcaption>
      </figure>
      <p className="source">Source: {d.source}</p>
    </div>
  )
}
