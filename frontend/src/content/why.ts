// Texts for the "Why?" screen. Owner: Nazar. DRAFTS from the team notes, replace freely.
// Keep each body short (2-3 sentences). `diagram` picks a picture in components/WhyDiagrams.tsx.

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
    title: 'The Sun never climbs high at the pole',
    body:
      'The Moon’s axis is tilted only about 1.5° from the plane in which the Earth and Moon go around the Sun. So at the south pole the Sun circles the whole horizon once every 29.5 days and never rises more than a couple of degrees.',
    fact: 'At 89.5° S on 14 November 2026 the Sun is 1.3° above the horizon and moves about 12° along it every day.',
    source: 'NASA Moon Fact Sheet (6.68° − 5.145°); JPL Horizons, queried 12 Nov 2026',
    diagram: 'skim',
  },
  {
    id: 'mountains',
    title: 'Mountains decide who gets light',
    body:
      'With the Sun that low, any hill can block it. Crater rims and peaks get sunlight most of the time. Crater floors may never see the Sun at all: these permanently shadowed regions are cold enough to keep water ice.',
    fact: 'A point near the rim of Shackleton crater is lit continuously for about 240 days a year; the south polar shadowed regions cover about 16 000 km².',
    source: 'Mazarico et al. 2011, Icarus, doi:10.1016/j.icarus.2010.10.030',
    diagram: 'mountains',
  },
  {
    id: 'mast',
    title: 'A few metres of height make a big difference',
    body:
      'Lifting a solar panel or antenna on a mast lets it see over nearby bumps. Because the Sun grazes the horizon, a small gain in height adds a lot of sunlit hours.',
    fact: 'At one candidate site, light guaranteed for 99 % of the area rises from 68.0 % of the time at 1 m to 89.3 % at 5 m.',
    source: 'Barker et al. 2021, Planetary and Space Science, doi:10.1016/j.pss.2020.105119',
    diagram: 'mast',
  },
  {
    id: 'earth',
    title: 'Earth hides behind the horizon too',
    body:
      'From the pole the Earth hangs near the horizon and wobbles a few degrees because of libration. When it dips below the terrain, a lander cannot talk to Earth directly and needs a relay satellite.',
    fact: 'From 89.5° S, 0° E the Earth stays 2° to 4° below the horizon from 14 to 16 November 2026, even with no mountains at all.',
    source: 'JPL Horizons, queried 12 Nov 2026',
    diagram: 'earth',
  },
  {
    id: 'panel',
    title: 'Solar panels stand upright',
    body:
      'A flat panel facing up catches almost nothing when the Sun is 1° above the horizon. Polar landers mount panels vertically and turn them to follow the Sun around the sky.',
    fact: 'A horizontal panel with the Sun at 1.3° gets sin(1.3°) ≈ 2.3 % of the sunlight a panel facing the Sun would get.',
    source: 'Geometry; Sun elevation from JPL Horizons',
    diagram: 'panel',
  },
]
