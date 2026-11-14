// Shared controls: site select, period, time slider. Plain native inputs, styled in index.css.

import { useId } from 'react'
import type { Site } from '../api'
import { HOUR } from '../api'

export const fmtUtc = (t: number) =>
  new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
const toDateInput = (t: number) => new Date(t).toISOString().slice(0, 10)
const fromDateInput = (s: string) => Date.parse(`${s}T00:00:00Z`)

export function siteLabel(s: Site) {
  const coord =
    s.lat !== null && s.lon !== null ? ` (${Math.abs(s.lat).toFixed(2)}° S, ${s.lon.toFixed(1)}° E)` : ''
  return `${s.name}${coord}`
}

export function SiteSelect({
  sites,
  value,
  onChange,
  label = 'Site',
}: {
  sites: Site[]
  value: string | null
  onChange: (id: string) => void
  label?: string
}) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {sites.map((s) => (
          <option key={s.id} value={s.id}>
            {siteLabel(s)}
          </option>
        ))}
      </select>
    </div>
  )
}

export function PeriodPicker({
  from,
  to,
  min,
  max,
  onChange,
}: {
  from: number
  to: number
  min?: number
  max?: number
  onChange: (from: number, to: number) => void
}) {
  const a = useId()
  const b = useId()
  const lo = min !== undefined ? toDateInput(min) : undefined
  const hi = max !== undefined ? toDateInput(max) : undefined
  return (
    <fieldset className="period">
      <legend>Period (UTC)</legend>
      <div className="field">
        <label htmlFor={a}>From</label>
        <input
          id={a}
          type="date"
          value={toDateInput(from)}
          min={lo}
          max={hi}
          onChange={(e) => {
            const v = fromDateInput(e.target.value)
            if (Number.isFinite(v)) onChange(v, Math.max(to, v + 24 * HOUR))
          }}
        />
      </div>
      <div className="field">
        <label htmlFor={b}>To</label>
        <input
          id={b}
          type="date"
          value={toDateInput(to)}
          min={lo}
          max={hi}
          onChange={(e) => {
            const v = fromDateInput(e.target.value)
            if (Number.isFinite(v)) onChange(Math.min(from, v - 24 * HOUR), v)
          }}
        />
      </div>
    </fieldset>
  )
}

export function TimeSlider({
  from,
  to,
  value,
  onChange,
}: {
  from: number
  to: number
  value: number
  onChange: (t: number) => void
}) {
  const id = useId()
  const steps = Math.max(1, Math.round((to - from) / HOUR))
  const v = Math.round((Math.min(Math.max(value, from), to) - from) / HOUR)
  return (
    <div className="slider">
      <label htmlFor={id}>
        Time <output htmlFor={id}>{fmtUtc(from + v * HOUR)}</output>
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={steps}
        step={1}
        value={v}
        aria-valuetext={fmtUtc(from + v * HOUR)}
        onChange={(e) => onChange(from + Number(e.target.value) * HOUR)}
      />
    </div>
  )
}

/** Clamp the selected period to what the timeline covers. */
export function clampPeriod(from: number, to: number, ms: number[]): [number, number] {
  if (!ms.length) return [from, to]
  const lo = ms[0]
  const hi = ms[ms.length - 1]
  const f = Math.min(Math.max(from, lo), hi)
  const t = Math.min(Math.max(to, f + HOUR), hi)
  return [f, t]
}
