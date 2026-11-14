// Shared selection: one site, the sites to compare, a period and a moment in time.
// Kept in the URL (#/page?site=..&t=..&from=..&to=..&cmp=..) so any view can be shared as a link.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export const DEFAULT_FROM = Date.parse('2026-11-14T00:00:00Z')
export const DEFAULT_TO = Date.parse('2026-11-28T00:00:00Z')
export const DEFAULT_T = Date.parse('2026-11-14T12:00:00Z')

export interface Selection {
  siteId: string | null
  compareIds: string[]
  from: number
  to: number
  t: number
}

interface Ctx extends Selection {
  path: string
  setSite: (id: string) => void
  setCompare: (ids: string[]) => void
  setPeriod: (from: number, to: number) => void
  setTime: (t: number) => void
}

const AppCtx = createContext<Ctx | null>(null)

function parseHash(): { path: string; q: URLSearchParams } {
  const h = window.location.hash.replace(/^#/, '') || '/map'
  const [path, query = ''] = h.split('?')
  return { path: path || '/map', q: new URLSearchParams(query) }
}

const isoMin = (t: number) => new Date(t).toISOString().slice(0, 16) + 'Z'
const parseT = (s: string | null, fallback: number) => {
  const v = s ? Date.parse(s) : NaN
  return Number.isFinite(v) ? v : fallback
}

function readSelection(q: URLSearchParams): Selection {
  return {
    siteId: q.get('site'),
    compareIds: (q.get('cmp') ?? '').split(',').filter(Boolean),
    from: parseT(q.get('from'), DEFAULT_FROM),
    to: parseT(q.get('to'), DEFAULT_TO),
    t: parseT(q.get('t'), DEFAULT_T),
  }
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(() => parseHash().path)
  const [sel, setSel] = useState<Selection>(() => readSelection(parseHash().q))

  useEffect(() => {
    const onHash = () => setPath(parseHash().path)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Write the selection back into the URL without adding history entries.
  useEffect(() => {
    const q = new URLSearchParams()
    if (sel.siteId) q.set('site', sel.siteId)
    if (sel.compareIds.length) q.set('cmp', sel.compareIds.join(','))
    q.set('from', isoMin(sel.from))
    q.set('to', isoMin(sel.to))
    q.set('t', isoMin(sel.t))
    const next = `#${path}?${q.toString()}`
    if (window.location.hash !== next) history.replaceState(null, '', next)
  }, [sel, path])

  const setSite = useCallback((siteId: string) => setSel((s) => ({ ...s, siteId })), [])
  const setCompare = useCallback((compareIds: string[]) => setSel((s) => ({ ...s, compareIds })), [])
  const setPeriod = useCallback(
    (from: number, to: number) =>
      setSel((s) => ({ ...s, from, to, t: Math.min(Math.max(s.t, from), to) })),
    [],
  )
  const setTime = useCallback((t: number) => setSel((s) => ({ ...s, t })), [])

  const value = useMemo<Ctx>(
    () => ({ ...sel, path, setSite, setCompare, setPeriod, setTime }),
    [sel, path, setSite, setCompare, setPeriod, setTime],
  )
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

export function useAppState(): Ctx {
  const c = useContext(AppCtx)
  if (!c) throw new Error('useAppState outside AppStateProvider')
  return c
}

/** Link to another page that keeps the current selection. */
export function hrefFor(path: string): string {
  const q = window.location.hash.split('?')[1]
  return `#${path}${q ? `?${q}` : ''}`
}
