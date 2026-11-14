import { Suspense, useEffect, useRef } from 'react'
import { isCustom, useDataSource, useSites } from './api'
import { aliases, hiddenRoutes, routes } from './routes'
import { useAppState } from './state'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Notice } from './components/Notice'

export default function App() {
  const { path, siteId, compareIds, compareFromUrl, setSite, setCompare, href, from, to } = useAppState()
  const sites = useSites()
  const source = useDataSource()
  const route = [...routes, ...hiddenRoutes].find((r) => r.path === (aliases[path] ?? path)) ?? routes[0]
  const Page = route.component

  // Pick sensible defaults once, when the site list first arrives.
  const defaultsDone = useRef(false)
  useEffect(() => {
    const list = sites.data
    if (!list?.length || defaultsDone.current) return
    defaultsDone.current = true
    const ids = list.map((s) => s.id)
    if (!siteId || (!isCustom(siteId) && !ids.includes(siteId))) setSite(ids[0])
    const valid = compareIds.filter((id) => ids.includes(id))
    if (!compareFromUrl || valid.length < 2) setCompare(ids.slice(0, Math.min(3, ids.length)))
    else if (valid.length !== compareIds.length) setCompare(valid)
  }, [sites.data, siteId, compareIds, compareFromUrl, setSite, setCompare])

  useEffect(() => {
    document.title = `${route.no} ${route.label} · Lunar Landing Site Navigator`
  }, [route.no, route.label])

  const nav = (cls: string, short: boolean) =>
    routes.map((r) => (
      <a key={r.path} className={cls} href={href(r.path)} aria-current={r === route ? 'page' : undefined}>
        {short ? (
          <>
            <b>{r.no}</b>
            {r.short}
          </>
        ) : (
          `${r.no} ${r.label}`
        )}
      </a>
    ))

  return (
    <div className="shell">
      <a className="skip" href="#main" onClick={(e) => (e.preventDefault(), document.getElementById('main')?.focus())}>
        Skip to content
      </a>
      <header className="top">
        <div className="top-in">
          <a className="brand" href={href('/map')} aria-label="Lunar Navigator, map">
            <svg aria-hidden="true" width="34" height="34" viewBox="0 0 34 34" fill="none" stroke="var(--ink)" strokeWidth="2">
              <circle cx="17" cy="17" r="12" />
              <path d="M17 1v8M17 25v8M1 17h8M25 17h8" />
              <circle cx="17" cy="17" r="2.5" fill="var(--sun)" stroke="none" />
            </svg>
            <span>Lunar Navigator</span>
          </a>
          <nav className="nav" aria-label="Sheets">
            {nav('', false)}
          </nav>
          <span className="team">
            Team SpaceU / NASA Space Apps 2026{source.data === 'mock' ? ' / sample data' : ''}
          </span>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        {sites.error ? (
          <Notice tone="error" title="Could not load the site list">
            {sites.error.message}. Check the connection and reload the page.
          </Notice>
        ) : (
          <ErrorBoundary resetKey={`${path}|${siteId}`}>
            <Suspense fallback={<div className="route-loading" aria-busy="true" />}>
              <Page />
            </Suspense>
          </ErrorBoundary>
        )}
      </main>
      <footer className="foot">
        <span>Ephemeris: NAIF SPICE DE440 / Terrain: LRO LOLA / Checked against JPL Horizons</span>
        <span>
          Period {new Date(from).toISOString().slice(0, 10)} to {new Date(to).toISOString().slice(0, 10)} UTC /{' '}
          <a href="https://github.com/Evge14n/spaceu-lunar-navigator">Source</a>
        </span>
      </footer>
      <nav className="tabbar" aria-label="Sheets">
        {nav('', true)}
      </nav>
    </div>
  )
}
