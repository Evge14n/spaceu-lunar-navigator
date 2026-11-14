// The five screens. To add a page: create src/pages/MyPage.tsx with a default export,
// then add one line here. Pages load lazily, so a heavy page (3D) does not slow the others.

import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

export interface Route {
  path: string
  label: string
  component: LazyExoticComponent<ComponentType>
}

export const routes: Route[] = [
  { path: '/map', label: 'Map', component: lazy(() => import('./pages/MapPage')) },
  { path: '/compare', label: 'Compare', component: lazy(() => import('./pages/ComparePage')) },
  { path: '/timeline', label: 'Timeline', component: lazy(() => import('./pages/TimelinePage')) },
  { path: '/3d', label: '3D view', component: lazy(() => import('./view3d/View3DPage')) },
  { path: '/why', label: 'Why?', component: lazy(() => import('./pages/WhyPage')) },
]
