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
  indexRange,
  nextTransition,
  periodPresets,
  runs,
  skyAt,
  summarize,
  timesMs,
  useSites,
  isCustom,
  useTimelineAt,
  visibleFlags,
  riseSet,
  type Timeline,
} from '../api'
import { clampPeriod, HeightSwitch, PeriodMovedNote, PeriodPicker, SiteSelect, TimeSlider } from '../components/Controls'
import { Notice } from '../components/Notice'
import { PageHead } from '../components/PageHead'
import { dateTimeUtc, dayMon, deg, hours as fmtH, latLon, pct, siteTitle } from '../format'
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

const fmtTick = (t: number) => dayMon(t)

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
    <div className="wrow">
      <span className="label">{label}</span>
      <div className="strip" role="img" aria-label={`${label}: ${rs.length} windows in the period; hatching means not visible`}>
        <svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
          {rs.map((r) => (
            <rect key={r.i0} x={x(ms[r.i0])} width={Math.max(0.15, x(ms[r.i1] + 3_600_000) - x(ms[r.i0]))} y="0" height="10" className={`strip-on ${body}`} />
          ))}
        </svg>
      </div>
    </div>
  )
})

function TimelineHead({ stamp }: { stamp: string }) {
  return (
    <PageHead
      stamp={stamp}
      title="Sun and Earth against the real horizon"
      lede="Elevation of the Sun and the Earth above the local level, and the height of the hills in the same direction. Move the time to see what is up."
    />
  )
}

export default function TimelinePage() {
  const { siteId, setSite, from, to, setPeriod, t, setTime, heightM, setHeight } = useAppState()
  const sites = useSites()
  const custom = !!siteId && isCustom(siteId)
  const h = custom ? 2 : heightM
  const tl = useTimelineAt(siteId, h)
  const site = sites.data?.find((x) => x.id === siteId)
  const stamp = `Sheet 03 / ${siteTitle(sites.data, siteId)}${site && site.lat !== null && site.lon !== null ? ` / ${latLon(site.lat, site.lon)}` : ''} / Instrument ${h} m above the ground`

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
        <TimelineHead stamp={stamp} />
        <div className="skeleton page-skeleton" aria-busy="true" />
      </div>
    )
  if (tl.error)
    return (
      <div className="page timeline">
        <TimelineHead stamp={stamp} />
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
      <TimelineHead stamp={stamp} />

      <div className="toolbar">
        {sites.data && <SiteSelect sites={sites.data} value={siteId} onChange={setSite} />}
        <HeightSwitch value={h} onChange={setHeight} disabled={custom} />
        <PeriodPicker from={view.f} to={view.e} min={view.ms[0]} max={view.ms[view.ms.length - 1]} onChange={setPeriod} presets={view.presets} />
      </div>

      <PeriodMovedNote moved={view.moved} />
      <section className="panel now" aria-label="At the selected time">
        <div>
          <span className="label">Sun now / {dateTimeUtc(tt)}</span>
          <span className="num sun-t">{riseSet(sunTr, 'Sets in', 'Rises in', 'Never sets in the data', 'Never rises in the data')}</span>
          <p className="mono">
            {Math.abs(sky.sun.el).toFixed(2)}° {sky.sun.el >= 0 ? 'above' : 'below'} level / azimuth {sky.sun.az.toFixed(0)}° / disc {Math.round(sky.sun.visible_fraction * 100)} % visible
          </p>
        </div>
        <div>
          <span className="label">Earth now</span>
          <span className="num earth-t">{riseSet(earthTr, 'Sets in', 'Rises in', 'Never sets in the data', 'Never rises in the data')}</span>
          <p className="mono">
            {Math.abs(sky.earth.el).toFixed(2)}° {sky.earth.el >= 0 ? 'above' : 'below'} level / azimuth {sky.earth.az.toFixed(0)}° / {sky.earth.visible ? 'direct link possible' : 'no direct link'}
          </p>
        </div>
        <div>
          <span className="label">Whole period</span>
          <span className="num mid">
            {pct(sum.sun.lit_percent)} sunlit / {pct(sum.earth.visible_percent)} Earth
          </span>
          <p className="mono">
            Longest darkness {fmtH(sum.sun.longest_dark_h)} / highest Sun {deg(sum.sun.max_el)}
          </p>
        </div>
      </section>

      <figure className="panel chart-panel" aria-label="Elevation of the Sun and the Earth over time" style={{ margin: 0 }}>
        <div className="chart-top">
          <span className="label">Elevation above the local level, degrees</span>
          <span className="key label">
            <span>
              <i className="k-sun" />
              Sun
            </span>
            <span>
              <i className="k-earth" />
              Earth
            </span>
            <span>
              <i className="k-terrain" />
              Terrain toward the Sun
            </span>
            <span>
              <i className="k-earth" style={{ opacity: 0.5 }} />
              Terrain toward Earth, dashed
            </span>
          </span>
        </div>
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart
            data={view.rows}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            onClick={(e) => {
              const x = (e as { activeLabel?: number | string } | null)?.activeLabel
              if (x !== undefined) setTime(Number(x))
            }}
          >
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              domain={[view.f, view.e]}
              scale="time"
              ticks={dayTicks(view.f, view.e)}
              tickFormatter={fmtTick}
              stroke="var(--ink)"
              tick={{ fontSize: 12, fontFamily: 'var(--f-mono)', fill: 'var(--ink-2)' }}
              minTickGap={20}
            />
            <YAxis
              stroke="var(--ink)"
              tick={{ fontSize: 12, fontFamily: 'var(--f-mono)', fill: 'var(--ink-2)' }}
              width={50}
              tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v}°`}
              domain={['auto', 'auto']}
            />
            <Tooltip
              labelFormatter={(v) => dateTimeUtc(Number(v))}
              formatter={(v, name) => [`${Number(v).toFixed(2)}°`, name]}
              contentStyle={{ background: 'var(--white)', border: '1px solid var(--ink)', borderRadius: 0, fontFamily: 'var(--f-mono)', fontSize: 12 }}
              labelStyle={{ color: 'var(--ink)' }}
              itemStyle={{ color: 'var(--ink)' }}
            />
            <Area dataKey="sunHz" name="Terrain toward the Sun" type="monotone" stroke="var(--ink)" strokeWidth={1.5} fill="var(--terrain)" fillOpacity={1} isAnimationActive={false} baseValue="dataMin" />
            <Line dataKey="earthHz" name="Terrain toward Earth" type="monotone" stroke="var(--earth)" strokeOpacity={0.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
            <ReferenceLine y={0} stroke="var(--ink)" strokeDasharray="2 3" />
            <Line dataKey="sun" name="Sun" type="monotone" stroke="var(--sun)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
            <Line dataKey="earth" name="Earth" type="monotone" stroke="var(--earth)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
            <ReferenceLine x={Math.min(Math.max(tChart, view.f), view.e)} stroke="var(--ink)" strokeWidth={2} />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="wstrips">
          <WindowStrip tl={d} ms={view.ms} body="sun" i0={view.i0} i1={view.i1} from={view.f} to={view.e} label="Sun visible" />
          <WindowStrip tl={d} ms={view.ms} body="earth" i0={view.i0} i1={view.i1} from={view.f} to={view.e} label="Earth in view" />
        </div>
        <TimeSlider from={view.f} to={view.e} value={tt} onChange={setTime} />
        <figcaption className="small muted">
          Grey: the hills in the direction of the Sun. The Sun counts as visible while any part of its disc is above them. Hatching on the strips means not visible. Click the chart to jump to a moment.
        </figcaption>
      </figure>
      <p className="small muted">Source: {d.source}</p>
    </div>
  )
}
