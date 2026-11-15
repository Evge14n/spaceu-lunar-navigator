import { useEffect, useMemo, useState } from 'react'
import { formatHours, isCustom, periodPresets, summarize, timesMs, useHeights, useSites, useTimelines, type Summary } from '../api'
import { clampPeriod, PeriodMovedNote, PeriodPicker } from '../components/Controls'
import { Notice } from '../components/Notice'
import { PageHead } from '../components/PageHead'
import { dateUtc, latLon, siteNo, terrainMark } from '../format'
import { useAppState } from '../state'

interface Metric {
  key: string
  label: string
  hint: string
  get: (s: Summary) => number | null
  fmt: (v: number | null) => string
  better: 'high' | 'low' | 'none'
}

const pct = (v: number | null) => (v === null ? 'n/a' : `${v.toFixed(1)} %`)

/** "custom:-12.5,143" -> [-12.5, 143], for the label of a point of your own. */
const parseLatLon = (id: string): [number, number] | null => {
  const [a, b] = id.slice('custom:'.length).split(',').map(Number)
  return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null
}

const METRICS: Metric[] = [
  { key: 'lit', label: 'Sunlit share of the period', hint: 'Any part of the Sun above the terrain', get: (s) => s.sun.lit_percent, fmt: pct, better: 'high' },
  { key: 'dark', label: 'Longest darkness to survive', hint: 'Batteries must last this long', get: (s) => s.sun.longest_dark_h, fmt: formatHours, better: 'low' },
  { key: 'litrun', label: 'Longest continuous light', hint: 'Unbroken sunlight', get: (s) => s.sun.longest_lit_h, fmt: formatHours, better: 'high' },
  { key: 'maxel', label: 'Highest Sun', hint: 'More power on a tilted panel', get: (s) => s.sun.max_el, fmt: (v) => (v === null ? 'n/a' : `${v.toFixed(2)}°`), better: 'high' },
  { key: 'irr', label: 'Sunlight on a panel facing the Sun', hint: 'Mean over the period, W/m²', get: (s) => s.sun.mean_irradiance_w_m2 ?? null, fmt: (v) => (v === null ? 'n/a' : `${Math.round(v)} W/m²`), better: 'high' },
  { key: 'earth', label: 'Earth in view, direct link', hint: 'Radio without a relay satellite', get: (s) => s.earth.visible_percent, fmt: pct, better: 'high' },
  { key: 'sunset', label: 'Hours to the first sunset', hint: 'Counted from the start of the period', get: (s) => s.sun.hours_to_sunset ?? (s.sun.lit_percent > 0 ? Infinity : null), fmt: (v) => (v === null ? 'never up' : formatHours(v)), better: 'high' },
  { key: 'earthset', label: 'Hours to the first Earthset', hint: 'Counted from the start of the period', get: (s) => s.earth.hours_to_earthset ?? (s.earth.visible_percent > 0 ? Infinity : null), fmt: (v) => (v === null ? 'never in view' : formatHours(v)), better: 'high' },
]

const WORDS = ['No', 'One', 'Two', 'Three', 'Four']
function periodWords(f: number, e: number) {
  const d = Math.round((e - f) / 86_400_000)
  if (d >= 360 && d <= 370) return 'one year'
  if (d === 14) return 'two weeks'
  if (d >= 29 && d <= 31) return `${d} days`
  return `${d} days`
}

function best(values: (number | null)[], better: Metric['better']): number | null {
  if (better === 'none') return null
  const nums = values.filter((v): v is number => v !== null)
  if (nums.length < 2) return null
  const b = better === 'high' ? Math.max(...nums) : Math.min(...nums)
  return nums.every((v) => v === b) ? null : b
}

export default function ComparePage() {
  const { compareIds, setCompare, from, to, setPeriod, siteId } = useAppState()
  const sites = useSites()
  const list = sites.data ?? []
  // a point of your own can be compared with the prepared sites: the one that is picked
  const custom = siteId && isCustom(siteId) ? siteId : null
  const chosen = compareIds.filter((id) => isCustom(id) || list.some((s) => s.id === id))
  const tls = useTimelines(chosen)
  const heights = useHeights()

  const result = useMemo(() => {
    if (!tls.data || tls.data.length !== chosen.length || !tls.data.length) return null
    const ms = timesMs(tls.data[0])
    const [f, e, moved] = clampPeriod(from, to, ms)
    const sums = tls.data.map((tl, i) => {
      const s = list.find((x) => x.id === chosen[i])
      return summarize(tl, { id: chosen[i], name: s ? s.name : 'Your point' }, f, e)
    })
    return { f, e, ms, sums, moved, presets: periodPresets(tls.data) }
  }, [tls.data, chosen, list, from, to])

  const full = chosen.length >= 4
  const [nudge, setNudge] = useState(0)
  useEffect(() => {
    if (!nudge) return
    const timer = window.setTimeout(() => setNudge(0), 2600)
    return () => window.clearTimeout(timer)
  }, [nudge])
  const toggle = (id: string) => {
    if (chosen.includes(id)) setCompare(chosen.filter((x) => x !== id))
    else if (chosen.length < 4) setCompare([...chosen, id])
    else setNudge((n) => n + 1)
  }

  const f = result?.f ?? from
  const e = result?.e ?? to
  return (
    <div className="page compare">
      <PageHead
        stamp={`Sheet 02 / ${chosen.length} of 4 sites / ${dateUtc(f)} to ${dateUtc(e)}`}
        title="Compare sites and dates"
        lede="Choose two to four sites and a period. The best value in each row is marked. Every number is computed in your browser from the hourly timelines."
      />

      <div className="toolbar">
        <fieldset className="chips">
          <legend>
            Sites, {chosen.length} of 4 chosen
            {full && (
              <span className={`chips-hint${nudge ? ' nudge' : ''}`} key={nudge} role="status">
                Up to four — remove one to add another
              </span>
            )}
          </legend>
          {custom && (
            <label key={custom} className={`chip${chosen.includes(custom) ? ' on' : full ? ' off' : ''}`}>
              <input
                type="checkbox"
                checked={chosen.includes(custom)}
                aria-disabled={!chosen.includes(custom) && full ? true : undefined}
                onChange={() => toggle(custom)}
              />
              <span className="no">--</span>
              Your point {latLon(...(parseLatLon(custom) ?? [0, 0]))}
            </label>
          )}
          {list.map((s) => {
            const on = chosen.includes(s.id)
            return (
              <label key={s.id} className={`chip${on ? ' on' : full ? ' off' : ''}`}>
                <input type="checkbox" checked={on} aria-disabled={!on && full ? true : undefined} onChange={() => toggle(s.id)} />
                <span className="no">{siteNo(list, s.id)}</span>
                {s.name}
              </label>
            )
          })}
        </fieldset>
        <PeriodPicker from={f} to={e} min={result?.ms[0]} max={result?.ms[result.ms.length - 1]} onChange={setPeriod} presets={result?.presets} />
      </div>

      <PeriodMovedNote moved={!!result?.moved} />
      {chosen.length < 2 && <Notice title="Pick at least two sites to compare" />}
      {tls.error && (
        <Notice tone="error" title="Some site data is missing">
          {tls.error.message}
        </Notice>
      )}
      {tls.loading && chosen.length >= 2 && <div className="skeleton table-skeleton" aria-busy="true" />}

      {result && chosen.length >= 2 && !tls.loading && (
        <section className="panel" aria-label="Comparison table">
          <div className="panel-head">
            <h2>
              {WORDS[chosen.length] ?? chosen.length} sites, {periodWords(result.f, result.e)}
            </h2>
            <span className="label">Best value in each row is marked</span>
          </div>
          <div className="table-wrap" role="region" aria-label="Comparison table, scrolls sideways" tabIndex={0}>
            <table className="cmp">
              <thead>
                <tr>
                  <th scope="col">Metric</th>
                  {result.sums.map((s, i) => {
                    const mark = terrainMark(tls.data?.[i])
                    return (
                      <th scope="col" key={s.site.id}>
                        {isCustom(s.site.id) ? `${s.site.name} ${latLon(...(parseLatLon(s.site.id) ?? [0, 0]))}` : `${siteNo(list, s.site.id)} ${s.site.name}`}
                        {mark && <em className="coarse-mark">{mark}</em>}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {METRICS.map((m) => {
                  const vals = result.sums.map(m.get)
                  const b = best(vals, m.better)
                  return (
                    <tr key={m.key}>
                      <th scope="row">
                        {m.label}
                        <span className="hint">{m.hint}</span>
                      </th>
                      {vals.map((v, i) => {
                        const isBest = b !== null && v === b
                        return (
                          <td key={i} className={isBest ? 'best' : undefined}>
                            <span className="num">{m.fmt(v)}</span>
                            {isBest && <span className="best-tag">BEST</span>}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {heights.data && chosen.length >= 1 && (
        <section className="panel" aria-label="What a mast gives">
          <div className="panel-head">
            <h2>What a mast gives</h2>
            <span className="label">Whole year / instrument 1, 2, 5 and 10 m above the ground</span>
          </div>
          <div className="table-wrap" role="region" aria-label="Mast height table, scrolls sideways" tabIndex={0}>
            <table className="cmp">
              <thead>
                <tr>
                  <th scope="col">Site</th>
                  {heights.data[0].heights.map((h) => (
                    <th scope="col" key={h.height_m}>
                      {h.height_m} m up
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {chosen.map((id) => {
                  const row = heights.data!.find((r) => r.site.id === id)
                  if (!row) return null
                  return (
                    <tr key={id}>
                      <th scope="row">
                        {siteNo(list, id)} {row.site.name}
                        <span className="hint">Sunlit share / longest darkness</span>
                      </th>
                      {row.heights.map((h) => (
                        <td key={h.height_m}>
                          <span className="num">{h.sun.lit_percent.toFixed(1)} %</span>
                          <span className="hint">{formatHours(h.sun.longest_dark_h)} dark</span>
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <p className="small muted">
        Sunlight on a panel: 1361 W/m² times the visible part of the solar disc, averaged over the period (within about 3 %, the distance to the Sun is not counted).
        Same rules as the API: the Sun counts while any part of its disc is above the terrain; the Earth counts while its upper limb is. Instrument height 2 m, step 1 h.
      </p>
    </div>
  )
}
