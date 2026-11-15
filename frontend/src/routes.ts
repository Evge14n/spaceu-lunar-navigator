// The sheets. To add a page: create src/pages/MyPage.tsx with a default export,
// then add one line here (no = number shown in the navigation). Pages load lazily.

import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

export interface Route {
  path: string
  no: string
  label: string
  short: string
  component: LazyExoticComponent<ComponentType>
}

export const routes: Route[] = [
  { path: '/globe', no: '00', label: 'Globe', short: 'Globe', component: lazy(() => import('./view3d/GlobePage')) },
  { path: '/map', no: '01', label: 'Map', short: 'Map', component: lazy(() => import('./pages/MapPage')) },
  { path: '/compare', no: '02', label: 'Compare', short: 'Compare', component: lazy(() => import('./pages/ComparePage')) },
  { path: '/timeline', no: '03', label: 'Timeline', short: 'Timeline', component: lazy(() => import('./pages/TimelinePage')) },
  { path: '/horizon', no: '04', label: 'Horizon', short: 'Horizon', component: lazy(() => import('./view3d/View3DPage')) },
  { path: '/why', no: '05', label: 'Why', short: 'Why', component: lazy(() => import('./pages/WhyPage')) },
  { path: '/accuracy', no: '06', label: 'Accuracy', short: 'Accuracy', component: lazy(() => import('./pages/AccuracyPage')) },
]

/** Pages that open by link but are not in the navigation (none at the moment). */
export const hiddenRoutes: Route[] = []

/** The sheet that opens when the address has no page or an unknown one. */
export const home = '/map'

/** Old links keep working. */
export const aliases: Record<string, string> = { '/3d': '/horizon' }
