// Texts for the "Why" sheet. Owner: Nazar. Drafts from the design (Claude Design, 14.11), replace freely.
// Keep each body to 1-2 sentences. `diagram` picks a picture in components/WhyDiagrams.tsx.
// A fact may be replaced on the page by a number computed from data/ (see WhyPage.tsx, `dataFact`).

export interface WhyItem {
  id: string
  title: string
  body: string
  fact: string
  source: string
  diagram: 'skim' | 'mountains' | 'mast' | 'earth' | 'panel'
}

export const why: WhyItem[] = [
  {
    id: 'skim',
    title: 'The Sun never climbs',
    body: "The Moon's axis is tilted only about 1.5°. At the pole the Sun does not rise and set, it slides around the horizon once a month.",
    fact: 'At 89.5° S on 14 Nov 2026 the Sun is 1.3° up and moves 12° along the horizon each day.',
    source: 'NASA Moon Fact Sheet; JPL Horizons, queried 12 Nov 2026',
    diagram: 'skim',
  },
  {
    id: 'mountains',
    title: 'Mountains decide who gets light',
    body: 'With the Sun that low, any hill can block it. Rims and peaks stay lit most of the time. Some crater floors never see the Sun and are cold enough to keep water ice.',
    fact: 'A point on the rim of Shackleton is lit for about 240 days in a row. Permanently dark areas in the south cover about 16 000 km².',
    source: 'Mazarico et al. 2011, Icarus, doi:10.1016/j.icarus.2010.10.030',
    diagram: 'mountains',
  },
  {
    id: 'mast',
    title: 'A few metres of mast change everything',
    body: 'The light skims the surface, so a boulder or a small rise casts a shadow hundreds of metres long. Lifting the panel gets it above those shadows.',
    fact: 'Share of time with sunlight guaranteed over 99 % of one candidate site: 68.0 % at 1 m, 89.3 % at 5 m.',
    source: 'Barker et al. 2021, Planetary and Space Science, Site 1, doi:10.1016/j.pss.2020.105119',
    diagram: 'mast',
  },
  {
    id: 'earth',
    title: 'Earth hangs low and wobbles',
    body: 'The Moon always shows the same face to Earth, but it rocks a little. From the pole the Earth sits near the horizon and drifts above and below it over about four weeks.',
    fact: 'From 89.5° S, 0° E the Earth stays 2° to 4° below the horizon from 14 to 16 November 2026.',
    source: 'JPL Horizons, queried 12 Nov 2026',
    diagram: 'earth',
  },
  {
    id: 'panel',
    title: 'Panels stand upright',
    body: 'Sunlight arrives almost sideways. A panel lying flat catches a sliver of it, so polar landers carry panels that stand vertically and turn to follow the Sun.',
    fact: 'With the Sun 1.3° up, a flat panel gets sin(1.3°) = 2.3 % of the full flux.',
    source: 'Geometry; Sun elevation from JPL Horizons',
    diagram: 'panel',
  },
]

export const whyConclusion = 'Move the site by a few hundred metres or the date by a few days, and the answer changes.'
