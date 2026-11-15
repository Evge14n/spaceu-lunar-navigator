// "Night here" on the Horizon sheet: is the Sun hidden by the terrain at t, and when does it come back?
// Pure, tested on the real timelines of all sites (night.test.ts).

import { formatHours, HOUR, nextTransition, timesMs, visibleFlags } from '../api/compute'
import type { Timeline } from '../api/types'

export interface Night {
  /** sunrise (UTC ms, interpolated crossing); null when the Sun stays down to the end of the data */
  riseAt: number | null
  /** "6 d 8 h" */
  riseIn: string | null
  /** first whole sample with part of the disc above the hills: where "Jump to sunrise" moves the time */
  jumpTo: number | null
}

/** null while any part of the Sun's disc is above the terrain at t. */
export function nightAt(tl: Timeline, t: number, ms = timesMs(tl)): Night | null {
  const tr = nextTransition(tl, 'sun', t, ms)
  if (tr.up) return null
  if (tr.at === null) return { riseAt: null, riseIn: null, jumpTo: null }
  const flags = visibleFlags(tl, 'sun')
  let k = 0
  while (k < ms.length - 1 && ms[k] < tr.at) k++
  while (k < ms.length - 1 && !flags[k]) k++
  return { riseAt: tr.at, riseIn: formatHours(tr.hours), jumpTo: flags[k] ? ms[k] : Math.ceil(tr.at / HOUR) * HOUR }
}
