import { useEffect, useState } from 'react'
import { dataSource, getHorizon, getSites, getTerrain, getTimeline } from './client'
import type { DataSource, Horizon, Site, Terrain, Timeline } from './types'

export type Async<T> = { data: T | null; error: Error | null; loading: boolean }

/** Run an async loader when deps change; ignores stale results. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): Async<T> {
  const [state, setState] = useState<Async<T>>({ data: null, error: null, loading: true })
  useEffect(() => {
    let live = true
    setState((s) => ({ data: s.data, error: null, loading: true }))
    load().then(
      (data) => live && setState({ data, error: null, loading: false }),
      (error: Error) => live && setState({ data: null, error, loading: false }),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return state
}

export const useSites = () => useAsync<Site[]>(getSites, [])
export const useDataSource = () => useAsync<DataSource>(dataSource, [])
export const useTimeline = (siteId: string | null) =>
  useAsync<Timeline | null>(() => (siteId ? getTimeline(siteId) : Promise.resolve(null)), [siteId])
export const useHorizon = (siteId: string | null) =>
  useAsync<Horizon | null>(() => (siteId ? getHorizon(siteId) : Promise.resolve(null)), [siteId])
export const useTerrain = (siteId: string | null) =>
  useAsync<Terrain | null>(() => (siteId ? getTerrain(siteId) : Promise.resolve(null)), [siteId])

/** Many timelines at once (Compare). */
export const useTimelines = (ids: string[]) =>
  useAsync<Timeline[]>(() => Promise.all(ids.map((id) => getTimeline(id))), [ids.join(',')])
