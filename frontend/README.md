# Frontend (React + Vite + TypeScript)

Live site: https://evge14n.github.io/spaceu-lunar-navigator/ (rebuilt automatically after every push to `main`).

## Run it (3 commands)

```bash
cd frontend
npm install
npm run dev        # open the printed link, e.g. http://localhost:5173/spaceu-lunar-navigator/
```

Other commands: `npm test` (data layer tests), `npm run build` (what GitHub Pages runs), `npm run preview` (serve the build).

## Who owns which folder

| Folder | Owner | What |
|---|---|---|
| `src/pages/` | Anastasiia U. | Map, Compare, Timeline, Why screens |
| `src/components/` | Anastasiia U. | shared controls (site select, period, time slider), notices, Why diagrams |
| `src/view3d/` | Anastasiia Sh. | 3D view: `Scene.tsx` (three.js via @react-three/fiber), `View3DPage.tsx` (controls) |
| `src/content/why.ts` | Nazar | texts of the "Why?" screen |
| `src/api/` | shared, change by PR | data layer: types from `docs/API.md`, loading, calculations, tests |
| `src/state.tsx`, `src/routes.ts`, `src/App.tsx` | shared, change by PR | selection kept in the URL, list of pages, page frame |

Every screen already works on mock data. It is a baseline: rewrite your screen as you like, keep the data layer calls.

## Where the data comes from

`src/api/` reads static JSON next to the site, so the demo works without a server.

- `../data/` (owned by the backend): real files, same shapes as `docs/API.md`. Copied into the site on build.
- `public/mock/`: mock files with the final shapes. Sun and Earth positions are real (JPL Horizons, smooth Moon), terrain is synthetic. Rebuild with `python frontend/scripts/make_mock.py`.
- Switch with `VITE_DATA` in `frontend/.env.local`: `auto` (default: real data as soon as `data/sites.json` has coordinates, mock until then), `real`, `mock`.
- `VITE_API_URL` (optional): the live FastAPI, used only for custom coordinates. On GitHub it is the repository variable `VITE_API_URL`.

Use it from a page:

```tsx
import { useSites, useTimeline, summarize, skyAt, nextTransition } from '../api'

const sites = useSites()                       // { data, error, loading }
const tl = useTimeline('site04')               // one year, 1 hour step
const sum = summarize(tl.data!, site, from, to) // the same numbers as GET /api/summary
const sky = skyAt(tl.data!, t)                 // Sun and Earth direction for the 3D scene
```

The shared selection (site, sites to compare, period, time) lives in the URL, so every view is a shareable link: `const { siteId, setSite, from, to, t, setTime } = useAppState()`.

## Add a page

1. Create `src/pages/MyPage.tsx` with `export default function MyPage() { ... }`.
2. Add one line to `src/routes.ts`: `{ path: '/my', label: 'My page', component: lazy(() => import('./pages/MyPage')) }`.

## Rules everyone follows

- Angles in degrees, azimuth from north clockwise, times in UTC. 3D axes: x = east, y = up, z = south (see `docs/ARCHITECTURE.md`).
- Interface text in English. Colours: amber `var(--sun)` means the Sun, blue `var(--earth)` means the Earth, nothing else uses them.
- Work in a branch, open a pull request; the build and tests run on every PR. `main` must always build.
- Log AI help in `docs/AI_LOG.md`.
