// Pure functions over a timeline. Same rules as docs/API.md and docs/ARCHITECTURE.md:
// - the Sun is visible when any part of the disc is above the terrain (visible_fraction > 0);
// - the Earth is visible when its upper limb is above horizon_el (the `visible` flag);
// - times are UTC, angles in degrees, azimuth from north clockwise.
// No React here, so everything is unit tested (compute.test.ts).

import type { Sky, Summary, Timeline, Window } from './types'

export const HOUR = 3_600_000
export const SUN_RADIUS_DEG = 0.266
/** Solar constant at 1 AU, W/m2. The Earth-Moon distance to the Sun changes it by about 3 % over a year. */
export const SOLAR_CONSTANT = 1361
const EARTH_RADIUS_KM = 6371
const DEFAULT_EARTH_DIST_KM = 384_400

export type Body = 'sun' | 'earth'

/** Unit vector to a body (ARCHITECTURE.md): x = cosE sinA, y = sinE, z = -cosE cosA. */
export function dirFromAzEl(azDeg: number, elDeg: number): [number, number, number] {
  const a = (azDeg * Math.PI) / 180
  const e = (elDeg * Math.PI) / 180
  return [Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)]
}

export function earthRadiusDeg(distanceKm: number | null | undefined): number {
  const d = distanceKm ?? DEFAULT_EARTH_DIST_KM
  return (Math.asin(EARTH_RADIUS_KM / d) * 180) / Math.PI
}

export function timesMs(tl: Timeline): number[] {
  return tl.times.map((t) => Date.parse(t))
}

export function visibleFlags(tl: Timeline, body: Body): boolean[] {
  return body === 'sun' ? tl.sun.visible_fraction.map((f) => f > 0) : tl.earth.visible.slice()
}

/** Signed margin in degrees: upper limb minus terrain. > 0 means visible. Used to interpolate crossings. */
export function margin(tl: Timeline, body: Body, i: number): number {
  if (body === 'sun') return tl.sun.el[i] + SUN_RADIUS_DEG - tl.sun.horizon_el[i]
  return tl.earth.el[i] + earthRadiusDeg(tl.earth.distance_km[i]) - tl.earth.horizon_el[i]
}

/** Index range [i0, i1] of samples inside [startMs, endMs]. Returns null if none. */
export function indexRange(ms: number[], startMs: number, endMs: number): [number, number] | null {
  let i0 = -1
  let i1 = -1
  for (let i = 0; i < ms.length; i++) {
    if (ms[i] >= startMs && ms[i] <= endMs) {
      if (i0 < 0) i0 = i
      i1 = i
    }
  }
  return i0 < 0 ? null : [i0, i1]
}

/** Typical sample step in hours (median of differences). */
export function stepHours(ms: number[]): number {
  if (ms.length < 2) return 1
  const d = ms.slice(1).map((t, i) => t - ms[i]).sort((a, b) => a - b)
  return d[Math.floor(d.length / 2)] / HOUR
}

/** Runs of equal values: [{value, i0, i1}] with inclusive indices. */
export function runs(flags: boolean[], i0 = 0, i1 = flags.length - 1) {
  const out: { value: boolean; i0: number; i1: number }[] = []
  for (let i = i0; i <= i1; i++) {
    const last = out[out.length - 1]
    if (last && last.value === flags[i]) last.i1 = i
    else out.push({ value: flags[i], i0: i, i1: i })
  }
  return out
}

/**
 * Time of the crossing between sample i (state s) and i+1 (state !s), linearly
 * interpolated on the margin. Falls back to the midpoint if margins disagree with flags.
 */
function crossing(tl: Timeline, body: Body, ms: number[], i: number): number {
  const m0 = margin(tl, body, i)
  const m1 = margin(tl, body, i + 1)
  if (m0 === m1 || Math.sign(m0) === Math.sign(m1)) return (ms[i] + ms[i + 1]) / 2
  const f = m0 / (m0 - m1)
  return ms[i] + f * (ms[i + 1] - ms[i])
}

export interface Transition {
  /** state at time t */
  up: boolean
  /** next moment the state flips (UTC ms), null if not within the timeline */
  at: number | null
  hours: number | null
}

/** Is the body up at t, and when does that change next (sunset if up, sunrise if down)? */
export function nextTransition(tl: Timeline, body: Body, t: number, ms = timesMs(tl)): Transition {
  const flags = visibleFlags(tl, body)
  let i = 0
  while (i < ms.length - 1 && ms[i + 1] <= t) i++
  let up = flags[i]
  let k0 = i
  // t may fall after a crossing inside the current sample interval
  if (i < ms.length - 1 && flags[i + 1] !== up && t >= crossing(tl, body, ms, i)) {
    up = flags[i + 1]
    k0 = i + 1
  }
  for (let k = k0; k < ms.length - 1; k++) {
    if (flags[k + 1] !== up) {
      const at = Math.max(t, crossing(tl, body, ms, k))
      return { up, at, hours: (at - t) / HOUR }
    }
  }
  return { up, at: null, hours: null }
}

/** First set (visible -> hidden) at or after t; null if none in the timeline. */
export function nextSet(tl: Timeline, body: Body, t: number, ms = timesMs(tl)): number | null {
  const flags = visibleFlags(tl, body)
  let i = 0
  while (i < ms.length - 1 && ms[i + 1] <= t) i++
  for (let k = i; k < ms.length - 1; k++) {
    if (flags[k] && !flags[k + 1]) return Math.max(t, crossing(tl, body, ms, k))
  }
  return null
}

const iso = (t: number) => new Date(Math.round(t / 60000) * 60000).toISOString().replace('.000Z', 'Z')
const r1 = (x: number) => Math.round(x * 10) / 10
const r3 = (x: number) => Math.round(x * 1000) / 1000

/**
 * Summary for any period, computed in the browser. Same shape as GET /api/summary.
 * Percentages count samples in [start, end]; durations are run length x step.
 * next_sunset / next_earthset: first set at or after the period start (searching the whole timeline).
 */
export function summarize(
  tl: Timeline,
  site: { id: string; name: string },
  startMs: number,
  endMs: number,
): Summary {
  const ms = timesMs(tl)
  const step = stepHours(ms)
  const range = indexRange(ms, startMs, endMs)
  const period = { start: iso(startMs), end: iso(endMs) }
  if (!range) {
    return {
      site,
      period,
      sun: { lit_percent: 0, longest_dark_h: 0, longest_lit_h: 0, max_el: 0, next_sunset: null, hours_to_sunset: null },
      earth: { visible_percent: 0, next_earthset: null, hours_to_earthset: null, windows: [] },
    }
  }
  const [i0, i1] = range
  const n = i1 - i0 + 1
  const sunUp = visibleFlags(tl, 'sun')
  const earthUp = visibleFlags(tl, 'earth')
  const sunRuns = runs(sunUp, i0, i1)
  const earthRuns = runs(earthUp, i0, i1)
  // a run of k samples stands for k x step hours, but never more than the period itself
  const span = (endMs - startMs) / HOUR
  const longest = (rs: typeof sunRuns, v: boolean) =>
    Math.min(span, rs.filter((r) => r.value === v).reduce((m, r) => Math.max(m, (r.i1 - r.i0 + 1) * step), 0))
  let lit = 0
  let seen = 0
  let frac = 0
  let maxEl = -90
  for (let i = i0; i <= i1; i++) {
    if (sunUp[i]) lit++
    frac += tl.sun.visible_fraction[i]
    if (earthUp[i]) seen++
    if (tl.sun.el[i] > maxEl) maxEl = tl.sun.el[i]
  }
  const sunset = nextSet(tl, 'sun', startMs, ms)
  const earthset = nextSet(tl, 'earth', startMs, ms)
  const windows: Window[] = earthRuns
    .filter((r) => r.value)
    .map((r) => ({ start: tl.times[r.i0], end: tl.times[r.i1] }))
  return {
    site,
    period,
    sun: {
      lit_percent: r1((lit / n) * 100),
      longest_dark_h: r1(longest(sunRuns, false)),
      longest_lit_h: r1(longest(sunRuns, true)),
      max_el: r3(maxEl),
      next_sunset: sunset === null ? null : iso(sunset),
      hours_to_sunset: sunset === null ? null : r1((sunset - startMs) / HOUR),
      mean_irradiance_w_m2: r1((SOLAR_CONSTANT * frac) / n),
      energy_kwh_m2: r1((SOLAR_CONSTANT * frac * step) / 1000),
    },
    earth: {
      visible_percent: r1((seen / n) * 100),
      next_earthset: earthset === null ? null : iso(earthset),
      hours_to_earthset: earthset === null ? null : r1((earthset - startMs) / HOUR),
      windows,
    },
  }
}

function lerpAngle(a: number, b: number, f: number): number {
  const d = ((b - a + 540) % 360) - 180
  return (a + d * f + 360) % 360
}

/** Sky at any moment, interpolated between timeline samples. Same shape as GET /api/sky (+ az/el). */
export function skyAt(tl: Timeline, t: number, ms = timesMs(tl)): Sky {
  let i = 0
  while (i < ms.length - 2 && ms[i + 1] <= t) i++
  const j = Math.min(i + 1, ms.length - 1)
  const f = j === i ? 0 : Math.min(1, Math.max(0, (t - ms[i]) / (ms[j] - ms[i])))
  const near = f < 0.5 ? i : j
  const lin = (a: number[]) => a[i] + (a[j] - a[i]) * f
  const sAz = lerpAngle(tl.sun.az[i], tl.sun.az[j], f)
  const sEl = lin(tl.sun.el)
  const eAz = lerpAngle(tl.earth.az[i], tl.earth.az[j], f)
  const eEl = lin(tl.earth.el)
  const dist = tl.earth.distance_km[near] ?? tl.earth.distance_km.find((d) => d !== null) ?? null
  return {
    time: iso(t),
    sun: {
      az: sAz,
      el: sEl,
      dir: dirFromAzEl(sAz, sEl),
      angular_radius_deg: SUN_RADIUS_DEG,
      horizon_el: lin(tl.sun.horizon_el),
      visible_fraction: tl.sun.visible_fraction[near],
    },
    earth: {
      az: eAz,
      el: eEl,
      dir: dirFromAzEl(eAz, eEl),
      angular_radius_deg: earthRadiusDeg(dist),
      horizon_el: lin(tl.earth.horizon_el),
      visible: tl.earth.visible[near],
      distance_km: dist,
    },
  }
}

/** Horizon elevation for any azimuth (linear between the 0.5 deg samples). */
export function horizonAt(elevation: number[], stepDeg: number, azDeg: number): number {
  const n = elevation.length
  const x = (((azDeg % 360) + 360) % 360) / stepDeg
  const i = Math.floor(x) % n
  const j = (i + 1) % n
  const f = x - Math.floor(x)
  return elevation[i] * (1 - f) + elevation[j] * f
}

/** Hours formatted for people: "3 h", "2 d 4 h". */
/** Share of a disc of angular radius `radius` (deg) whose centre is `el` deg up, above a line at `hor` deg. */
export function discFraction(el: number, hor: number, radius: number): number {
  const x = (el - hor) / radius
  if (x >= 1) return 1
  if (x <= -1) return 0
  return (Math.acos(-x) + x * Math.sqrt(1 - x * x)) / Math.PI
}

/**
 * The same timeline seen by an instrument at another height: the horizon in the direction of each body
 * comes from that height's mask, the visible part of the Sun's disc from it (the horizon at the centre
 * of the disc), the Earth is visible when its upper limb clears the terrain. The Sun's and the Earth's
 * own directions change by less than 0.0001 deg between 1 and 10 m, so they are kept.
 */
export function atHeight(tl: Timeline, mask: { elevation_deg: number[]; step_deg: number; height_m: number }): Timeline {
  const sunHz = tl.sun.az.map((a) => horizonAt(mask.elevation_deg, mask.step_deg, a))
  const earthHz = tl.earth.az.map((a) => horizonAt(mask.elevation_deg, mask.step_deg, a))
  const vf = tl.sun.el.map((e, i) => {
    const f = discFraction(e, sunHz[i], SUN_RADIUS_DEG)
    // a sliver never rounds down to 0 (docs/API.md)
    return f > 0 ? Math.max(f, 0.001) : 0
  })
  return {
    ...tl,
    height_m: mask.height_m,
    sun: { ...tl.sun, horizon_el: sunHz, visible_fraction: vf },
    earth: {
      ...tl.earth,
      horizon_el: earthHz,
      visible: tl.earth.el.map((e, i) => e + earthRadiusDeg(tl.earth.distance_km[i]) > earthHz[i]),
    },
  }
}

export function formatHours(h: number | null): string {
  if (h === null || Number.isNaN(h)) return 'not in data'
  if (h === Infinity) return 'not within data'
  if (h === 0) return '0 h'
  const min = Math.max(0, Math.round(h * 60))
  if (min < 60) return `${min} min`
  const hours = Math.round(h)
  if (hours < 48) return `${hours} h`
  const d = Math.floor(hours / 24)
  return `${d} d ${hours - d * 24} h`
}

/** "Sunset in 5 h" / "No sunset in the data". */
export function riseSet(tr: Transition, upText: string, downText: string, upNone: string, downNone: string) {
  if (tr.hours === null) return tr.up ? upNone : downNone
  return `${tr.up ? upText : downText} ${formatHours(tr.hours)}`
}

export interface PeriodPreset {
  label: string
  from: number
  to: number
}

/** Handy periods for the data at hand: two weeks, a month, the darkest 30 days of these sites, everything. */
export function periodPresets(tls: Timeline[]): PeriodPreset[] {
  if (!tls.length) return []
  const ms = timesMs(tls[0])
  const lo = ms[0]
  const hi = ms[ms.length - 1]
  const day = 24 * HOUR
  const out: PeriodPreset[] = [
    { label: '2 weeks', from: lo, to: Math.min(hi, lo + 14 * day) },
    { label: '30 days', from: lo, to: Math.min(hi, lo + 30 * day) },
  ]
  const n = Math.min(...tls.map((t) => t.times.length))
  const w = Math.round((30 * day) / (stepHours(ms) * HOUR))
  if (n > w + 1) {
    const lit = new Array<number>(n).fill(0)
    for (const tl of tls) for (let i = 0; i < n; i++) if (tl.sun.visible_fraction[i] > 0) lit[i]++
    let sum = 0
    for (let i = 0; i < w; i++) sum += lit[i]
    let best = sum
    let bestI = 0
    for (let i = w; i < n; i++) {
      sum += lit[i] - lit[i - w]
      if (sum < best) {
        best = sum
        bestI = i - w + 1
      }
    }
    out.push({ label: 'Darkest 30 days', from: ms[bestI], to: ms[bestI + w - 1] })
  }
  out.push({ label: 'Whole year', from: lo, to: hi })
  return out
}
