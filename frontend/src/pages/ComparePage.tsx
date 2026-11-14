import { useMemo } from 'react'
import { formatHours, periodPresets, summarize, timesMs, useSites, useTimelines, type Site, type Summary } from '../api'
import { clampPeriod, PeriodMovedNote, PeriodPicker } from '../components/Controls'
import { Notice } from '../components/Notice'
import { PageHead } from '../components/PageHead'
import { dateUtc, siteNo } from '../format'
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

const METRICS: Metric[] = [
  { key: 'lit', label: 'Sunlit share of the period', hint: 'Any part of the Sun above the terrain', get: (s) => s.sun.lit_percent, fmt: pct, better: 'high' },
  { key: 'dark', label: 'Longest darkness to survive', hint: 'Batteries must last this long', get: (s) => s.sun.longest_dark_h, fmt: formatHours, better: 'low' },
  { key: 'litrun', label: 'Longest continuous light', hint: 'Unbroken sunlight', get: (s) => s.sun.longest_lit_h, fmt: formatHours, better: 'high' },
  { key: 'maxel', label: 'Highest Sun', hint: 'More power on a tilted panel', get: (s) => s.sun.max_el, fmt: (v) => (v === null ? 'n/a' : `${v.toFixed(2)}°`), better: 'high' },
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
  const { compareIds, setCompare, from, to, setPeriod } = useAppState()
  const sites = useSites()
  const list = sites.data ?? []
  const chosen = compareIds.filter((id) => list.some((s) => s.id === id))
  const tls = useTimelines(chosen)

  const result = useMemo(() => {
    if (!tls.data || tls.data.length !== chosen.length || !tls.data.length) return null
    const ms = timesMs(tls.data[0])
    const [f, e, moved] = clampPeriod(from, to, ms)
    const sums = tls.data.map((tl, i) => {
      const s = list.find((x) => x.id === chosen[i]) as Site
      return summarize(tl, { id: s.id, name: s.name }, f, e)
    })
    return { f, e, ms, sums, moved, presets: periodPresets(tls.data) }
  }, [tls.data, chosen, list, from, to])

  const toggle = (id: string) => {
    if (chosen.includes(id)) setCompare(chosen.filter((x) => x !== id))
    else if (chosen.length < 4) setCompare([...chosen, id])
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
          <legend>Sites, {chosen.length} of 4 chosen</legend>
          {list.map((s) => {
            const on = chosen.includes(s.id)
            return (
              <label key={s.id} className={`chip${on ? ' on' : ''}`}>
                <input type="checkbox" checked={on} disabled={!on && chosen.length >= 4} onChange={() => toggle(s.id)} />
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
                  {result.sums.map((s) => (
                    <th scope="col" key={s.site.id}>
                      {siteNo(list, s.site.id)} {s.site.name}
                    </th>
                  ))}
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
      <p className="small muted">
        Same rules as the API: the Sun counts while any part of its disc is above the terrain; the Earth counts while its upper limb is. Instrument height 2 m, step 1 h.
      </p>
    </div>
  )
}
