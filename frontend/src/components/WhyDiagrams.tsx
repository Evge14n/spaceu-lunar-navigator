// Schematic pictures for the "Why" sheet, drawn in ink like the rest of the map sheet. Not to scale.

import type { WhyItem } from '../content/why'

const W = 560
const H = 190

function Skim() {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Standing at the pole, the Sun stays one to two degrees above the horizon and circles it once in 29.5 days">
      <line x1="20" y1="120" x2="540" y2="120" className="d-line" />
      <line x1="280" y1="120" x2="280" y2="78" className="d-line" />
      <circle cx="280" cy="74" r="6" fill="var(--ink)" />
      <text x="280" y="56" textAnchor="middle" className="d-label">You, at the pole</text>
      <circle cx="470" cy="96" r="12" className="d-sun" />
      <text x="490" y="84" className="d-label">1° to 2° up</text>
      <text x="20" y="144" className="d-label">Horizon</text>
      <text x="280" y="168" textAnchor="middle" className="d-label">One full circle in 29.5 days</text>
    </svg>
  )
}

function Mountains() {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Low sunlight reaches a peak but a crater floor between hills stays dark">
      <path d="M20 170 L150 60 L265 160 L340 160 L430 90 L540 170 Z" className="d-ground" />
      <path d="M265 160 L340 160 L362 145 Z" className="d-shadow" />
      <circle cx="520" cy="40" r="11" className="d-sun" />
      <line x1="510" y1="44" x2="156" y2="62" className="d-ray" />
      <text x="110" y="44" className="d-label">Peak: lit</text>
      <text x="300" y="186" textAnchor="middle" className="d-label">Crater floor: always dark</text>
    </svg>
  )
}

function Mast() {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Guaranteed sunlight 68 percent for a panel 1 metre up and 89.3 percent for a panel 5 metres up">
      <text x="20" y="44" className="d-num">68.0 %</text>
      <rect x="20" y="62" width="250" height="68" fill="var(--terrain)" stroke="var(--ink)" strokeWidth="1.5" />
      <text x="20" y="156" className="d-label">Panel 1 m above the ground</text>
      <text x="300" y="26" className="d-num">89.3 %</text>
      <rect x="300" y="44" width="250" height="86" fill="var(--white)" stroke="var(--ink)" strokeWidth="1.5" />
      <text x="300" y="156" className="d-label">Panel 5 m above the ground</text>
    </svg>
  )
}

function Earth() {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="The Earth drifts above and below the hills on the horizon">
      <path d="M30 110 L140 104 L250 116 L360 102 L460 114 L540 108 L540 186 L30 186 Z" className="d-ground" />
      <circle cx="380" cy="58" r="15" className="d-earth" />
      <text x="360" y="54" textAnchor="end" className="d-label">In view: direct radio link</text>
      <circle cx="300" cy="160" r="14" className="d-earth dim" />
      <text x="56" y="166" className="d-label">Hidden: a relay is needed</text>
    </svg>
  )
}

function Panel() {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Sunlight arrives sideways: a flat panel catches 2.3 percent, an upright one nearly all">
      <line x1="20" y1="150" x2="540" y2="150" className="d-line" />
      <circle cx="40" cy="140" r="9" className="d-sun" />
      <line x1="52" y1="141" x2="430" y2="132" className="d-ray" />
      <rect x="150" y="144" width="110" height="6" className="d-panel" />
      <rect x="432" y="40" width="7" height="110" className="d-panel" />
      <text x="205" y="174" textAnchor="middle" className="d-label">Flat: 2.3 %</text>
      <text x="436" y="174" textAnchor="middle" className="d-label">Upright: nearly 100 %</text>
    </svg>
  )
}

const map = { skim: Skim, mountains: Mountains, mast: Mast, earth: Earth, panel: Panel }

export function WhyDiagram({ kind }: { kind: WhyItem['diagram'] }) {
  const C = map[kind]
  return <C />
}
