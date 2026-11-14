import { useMemo } from 'react'
import { formatHours, periodPresets, summarize, timesMs, useSites, useTimelines, type Site, type Summary } from '../api'
import { clampPeriod, PeriodMovedNote, PeriodPicker, siteLabel } from '../components/Controls'
import { Notice } from '../components/Notice'
import { useAppState } from '../state'

interface Metric {
  key: string
  label: string
  hint: string
  get: (s: Summary) => number | null
  fmt: (v: number | null) => string
  better: 'high' | 'low' | 'none'
}

const pct = (v: number | null) => (v === null ? 'n/a' : `${v} %`)

const METRICS: Metric[] = [
  { key: 'lit', label: 'Sunlit', hint: 'Share of the period with any part of the Sun above the terrain', get: (s) => s.sun.lit_percent, fmt: pct, better: 'high' },
  { key: 'dark', label: 'Longest darkness', hint: 'Batteries must last this long', get: (s) => s.sun.longest_dark_h, fmt: formatHours, better: 'low' },
  { key: 'litrun', label: 'Longest sunlit stretch', hint: 'Longest continuous light', get: (s) => s.sun.longest_lit_h, fmt: formatHours, better: 'high' },
  { key: 'maxel', label: 'Highest Sun', hint: 'Higher Sun, more power on a tilted panel', get: (s) => s.sun.max_el, fmt: (v) => (v === null ? 'n/a' : `${v.toFixed(2)}°`), better: 'high' },
  { key: 'sunset', label: 'First sunset after start', hint: 'Hours from the start of the period', get: (s) => s.sun.hours_to_sunset ?? (s.sun.lit_percent > 0 ? Infinity : null), fmt: (v) => (v === null ? 'never up' : formatHours(v)), better: 'high' },
  { key: 'earth', label: 'Earth visible', hint: 'Direct-to-Earth radio possible', get: (s) => s.earth.visible_percent, fmt: pct, better: 'high' },
  { key: 'windows', label: 'Earth windows', hint: 'Separate periods with Earth in view', get: (s) => s.earth.windows.length, fmt: (v) => String(v ?? 0), better: 'none' },
  { key: 'earthset', label: 'First Earthset after start', hint: 'Hours from the start of the period', get: (s) => s.earth.hours_to_earthset ?? (s.earth.visible_percent > 0 ? Infinity : null), fmt: (v) => (v === null ? 'never in view' : formatHours(v)), better: 'high' },
]

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

  return (
    <div className="page compare">
      <div className="page-head">
        <h1>Compare sites</h1>
        <p className="lede">Choose 2 to 4 sites and a period. The best value in each row is marked.</p>
      </div>

      <div className="toolbar">
        <fieldset className="chips">
          <legend>Sites ({chosen.length} of 4)</legend>
          {list.map((s) => {
            const on = chosen.includes(s.id)
            return (
              <label key={s.id} className={`chip${on ? ' on' : ''}`}>
                <input type="checkbox" checked={on} disabled={!on && chosen.length >= 4} onChange={() => toggle(s.id)} />
                {siteLabel(s)}
              </label>
            )
          })}
        </fieldset>
        <PeriodPicker
          from={result?.f ?? from}
          to={result?.e ?? to}
          min={result?.ms[0]}
          max={result?.ms[result.ms.length - 1]}
          onChange={setPeriod}
          presets={result?.presets}
        />
      </div>

      <PeriodMovedNote moved={!!result?.moved} />
      {chosen.length < 2 && <Notice title="Pick at least two sites to compare" />}
      {tls.error && <Notice tone="error" title="Some site data is missing">{tls.error.message}</Notice>}
      {tls.loading && chosen.length >= 2 && <div className="skeleton table-skeleton" aria-busy="true" />}

      {result && chosen.length >= 2 && !tls.loading && (
        <div className="table-wrap" role="region" aria-label="Comparison table" tabIndex={0}>
          <table className="cmp">
            <thead>
              <tr>
                <th scope="col">Metric</th>
                {result.sums.map((s) => (
                  <th scope="col" key={s.site.id}>{s.site.name}</th>
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
                          {m.fmt(v)}
                          {isBest && <span className="best-tag">best</span>}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="source">
        Computed in the browser from hourly timelines, the same rules as the API: the Sun counts while any part of its disc is above the terrain; Earth counts while its upper limb is.
      </p>
    </div>
  )
}
