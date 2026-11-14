// The six sheets. To add a page: create src/pages/MyPage.tsx with a default export,
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
  { path: '/map', no: '01', label: 'Map', short: 'Map', component: lazy(() => import('./pages/MapPage')) },
  { path: '/compare', no: '02', label: 'Compare', short: 'Compare', component: lazy(() => import('./pages/ComparePage')) },
  { path: '/timeline', no: '03', label: 'Timeline', short: 'Time', component: lazy(() => import('./pages/TimelinePage')) },
  { path: '/horizon', no: '04', label: 'Horizon', short: 'Horizon', component: lazy(() => import('./view3d/View3DPage')) },
  { path: '/why', no: '05', label: 'Why', short: 'Why', component: lazy(() => import('./pages/WhyPage')) },
  { path: '/accuracy', no: '06', label: 'Accuracy', short: 'Proof', component: lazy(() => import('./pages/AccuracyPage')) },
]

/** Old links keep working. */
export const aliases: Record<string, string> = { '/3d': '/horizon' }
