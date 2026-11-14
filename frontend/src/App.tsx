import { Suspense, useEffect, useRef } from 'react'
import { isCustom, useDataSource, useSites } from './api'
import { routes } from './routes'
import { useAppState } from './state'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Notice } from './components/Notice'

export default function App() {
  const { path, siteId, compareIds, compareFromUrl, setSite, setCompare, href } = useAppState()
  const sites = useSites()
  const source = useDataSource()
  const route = routes.find((r) => r.path === path) ?? routes[0]
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
    document.title = `${route.label} · Lunar Landing Site Navigator`
  }, [route.label])

  return (
    <div className="shell">
      <a className="skip" href="#main" onClick={(e) => (e.preventDefault(), document.getElementById('main')?.focus())}>
        Skip to content
      </a>
      <header className="top">
        <a className="brand" href={href('/map')}>
          <svg aria-hidden="true" viewBox="0 0 32 32" width="22" height="22">
            <circle cx="16" cy="16" r="11" fill="var(--regolith-3)" />
            <path d="M5 19 Q16 13 27 19" stroke="var(--sun)" strokeWidth="2.2" fill="none" strokeLinecap="round" />
          </svg>
          <span>
            Lunar Landing Site Navigator <small>SpaceU</small>
          </span>
        </a>
        <nav aria-label="Screens">
          <ul>
            {routes.map((r) => (
              <li key={r.path}>
                <a href={href(r.path)} aria-current={r === route ? 'page' : undefined}>
                  {r.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        {source.data === 'mock' && (
          <span className="badge" title="Sun and Earth positions are real (JPL Horizons); terrain and sites are synthetic until the backend publishes data/">
            Mock data
          </span>
        )}
      </header>
      <main id="main" tabIndex={-1}>
        {sites.error ? (
          <Notice tone="error" title="Could not load the site list">
            {sites.error.message}
          </Notice>
        ) : (
          <ErrorBoundary resetKey={`${path}|${siteId}`}>
            <Suspense fallback={<div className="skeleton page-skeleton" aria-busy="true" />}>
              <Page />
            </Suspense>
          </ErrorBoundary>
        )}
      </main>
      <footer className="foot">
        <span>
          Sun and Earth: NAIF SPICE, checked against JPL Horizons. Terrain: LRO LOLA. Times in UTC.
        </span>
        <a href="https://github.com/Evge14n/spaceu-lunar-navigator">Source on GitHub</a>
      </footer>
    </div>
  )
}
