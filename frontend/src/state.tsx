// Shared selection: one site, the sites to compare, a period and a moment in time.
// Kept in the URL (#/page?site=..&t=..&from=..&to=..&cmp=..) so any view can be shared as a link.
// Navigate with `navigate(path)` or <a href={href(path)}>, never by writing location.hash directly.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

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
  /** compare ids came from the URL (do not override them with defaults) */
  compareFromUrl: boolean
  setSite: (id: string) => void
  setCompare: (ids: string[]) => void
  setPeriod: (from: number, to: number) => void
  setTime: (t: number) => void
  navigate: (path: string) => void
  href: (path: string) => string
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

function query(sel: Selection): string {
  const q = new URLSearchParams()
  if (sel.siteId) q.set('site', sel.siteId)
  if (sel.compareIds.length) q.set('cmp', sel.compareIds.join(','))
  q.set('from', isoMin(sel.from))
  q.set('to', isoMin(sel.to))
  q.set('t', isoMin(sel.t))
  return q.toString()
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(() => parseHash().path)
  const [sel, setSel] = useState<Selection>(() => readSelection(parseHash().q))
  const compareFromUrl = useRef(parseHash().q.has('cmp')).current
  const lastWritten = useRef('')

  // Back/forward or a pasted link: take path and selection from the URL.
  useEffect(() => {
    const onHash = () => {
      if (window.location.hash === lastWritten.current) return
      const { path: p, q } = parseHash()
      setPath(p)
      if ([...q.keys()].length) setSel(readSelection(q))
    }
    window.addEventListener('hashchange', onHash)
    window.addEventListener('popstate', onHash)
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('popstate', onHash)
    }
  }, [])

  // Write the selection into the URL after the user pauses (browsers limit replaceState to ~100 per 30 s).
  useEffect(() => {
    const id = window.setTimeout(() => {
      const next = `#${path}?${query(sel)}`
      if (window.location.hash === next) return
      try {
        history.replaceState(null, '', next)
        lastWritten.current = next
      } catch {
        // over the browser limit: the link is just not updated this time
      }
    }, 400)
    return () => window.clearTimeout(id)
  }, [sel, path])

  const setSite = useCallback((siteId: string) => setSel((s) => (s.siteId === siteId ? s : { ...s, siteId })), [])
  const setCompare = useCallback(
    (compareIds: string[]) => setSel((s) => (sameIds(s.compareIds, compareIds) ? s : { ...s, compareIds })),
    [],
  )
  const setPeriod = useCallback(
    (from: number, to: number) =>
      setSel((s) =>
        s.from === from && s.to === to ? s : { ...s, from, to, t: Math.min(Math.max(s.t, from), to) },
      ),
    [],
  )
  const setTime = useCallback((t: number) => setSel((s) => (s.t === t ? s : { ...s, t })), [])

  const navigate = useCallback(
    (p: string) => {
      const next = `#${p}?${query(sel)}`
      try {
        history.pushState(null, '', next)
        lastWritten.current = next
      } catch {
        /* ignore */
      }
      setPath(p)
      window.scrollTo(0, 0)
    },
    [sel],
  )
  const href = useCallback((p: string) => `#${p}?${query(sel)}`, [sel])

  // Plain <a href="#/..."> clicks: switch page without re-reading stale query values.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element).closest('a')
      const h = a?.getAttribute('href')
      if (!h || !h.startsWith('#/')) return
      e.preventDefault()
      navigate(h.slice(1).split('?')[0])
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [navigate])

  const value = useMemo<Ctx>(
    () => ({ ...sel, path, compareFromUrl, setSite, setCompare, setPeriod, setTime, navigate, href }),
    [sel, path, compareFromUrl, setSite, setCompare, setPeriod, setTime, navigate, href],
  )
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

export function useAppState(): Ctx {
  const c = useContext(AppCtx)
  if (!c) throw new Error('useAppState outside AppStateProvider')
  return c
}
