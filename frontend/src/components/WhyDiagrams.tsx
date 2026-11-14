// Simple schematic pictures for the "Why?" screen. Not to scale; labels say so where it matters.

import type { WhyItem } from '../content/why'

const W = 320
const H = 160

function Skim() {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="The Sun moves around the horizon in a low circle">
      <ellipse cx="160" cy="112" rx="130" ry="26" className="d-orbit" />
      <line x1="10" y1="112" x2="310" y2="112" className="d-horizon" />
      <text x="14" y="130" className="d-label">horizon</text>
      <circle cx="268" cy="104" r="9" className="d-sun" />
      <path d="M190 138 a130 26 0 0 0 78 -32" className="d-arrow" markerEnd="url(#ah)" />
      <circle cx="160" cy="112" r="4" className="d-you" />
      <text x="146" y="100" className="d-label">you</text>
      <text x="310" y="30" textAnchor="end" className="d-label">Sun stays 1° to 2° up,</text>
      <text x="310" y="46" textAnchor="end" className="d-label">one full circle in 29.5 days</text>
      <defs>
        <marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0 L10 5 L0 10z" className="d-arrowhead" />
        </marker>
      </defs>
    </svg>
  )
}

function Mountains() {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Low sunlight reaches a peak but not a crater floor">
      <path d="M0 140 L60 70 L110 128 L150 140 L200 140 L240 90 L320 140 Z" className="d-ground" />
      <circle cx="306" cy="58" r="10" className="d-sun" />
      <line x1="296" y1="62" x2="62" y2="70" className="d-ray" />
      <line x1="296" y1="62" x2="240" y2="88" className="d-ray" />
      <text x="34" y="60" className="d-label">peak: lit</text>
      <text x="140" y="155" className="d-label">crater floor: always dark</text>
      <path d="M110 128 L150 140 L200 140 L232 98 Z" className="d-shadow" />
    </svg>
  )
}

function Mast() {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="A panel on a 5 metre mast sees over a ridge that blocks a 1 metre panel">
      <path d="M0 140 L320 140 L320 160 L0 160 Z" className="d-ground" />
      <path d="M170 140 L215 112 L260 140 Z" className="d-ground" />
      <circle cx="306" cy="70" r="10" className="d-sun" />
      <line x1="40" y1="140" x2="40" y2="78" className="d-mast" />
      <rect x="34" y="70" width="12" height="10" className="d-panel" />
      <rect x="64" y="124" width="12" height="10" className="d-panel" />
      <line x1="46" y1="75" x2="296" y2="70" className="d-ray" />
      <line x1="76" y1="129" x2="214" y2="113" className="d-ray-blocked" />
      <text x="50" y="66" className="d-label">5 m: 89 % lit</text>
      <text x="82" y="150" className="d-label">1 m: 68 % lit</text>
    </svg>
  )
}

function Earth() {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="The Earth wobbles up and down across the horizon">
      <line x1="10" y1="100" x2="310" y2="100" className="d-horizon" />
      <path d="M10 100 L60 86 L100 100 Z" className="d-ground" />
      <path d="M30 96 C 90 40, 140 40, 170 92 S 260 150, 300 70" className="d-path" />
      <circle cx="120" cy="56" r="11" className="d-earth" />
      <circle cx="232" cy="122" r="11" className="d-earth dim" />
      <text x="96" y="30" className="d-label">in view: direct radio</text>
      <text x="312" y="154" textAnchor="end" className="d-label">below terrain: relay needed</text>
    </svg>
  )
}

function Panel() {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="A vertical panel faces the low Sun, a flat panel does not">
      <line x1="10" y1="130" x2="310" y2="130" className="d-horizon" />
      <circle cx="300" cy="120" r="9" className="d-sun" />
      <rect x="60" y="80" width="8" height="50" className="d-panel" />
      <rect x="150" y="124" width="60" height="6" className="d-panel" />
      <line x1="290" y1="121" x2="70" y2="105" className="d-ray" />
      <line x1="290" y1="122" x2="212" y2="125" className="d-ray" />
      <text x="30" y="70" className="d-label">upright: ~100 %</text>
      <text x="140" y="112" className="d-label">flat: 2.3 %</text>
    </svg>
  )
}

const map = { skim: Skim, mountains: Mountains, mast: Mast, earth: Earth, panel: Panel }

export function WhyDiagram({ kind }: { kind: WhyItem['diagram'] }) {
  const C = map[kind]
  return <C />
}
