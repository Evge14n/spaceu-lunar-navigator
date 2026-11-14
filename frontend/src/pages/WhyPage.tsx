// Sheet 05: five ideas behind every number, for students and anyone curious.

import { useApollo, useSites, useYearSummaries } from '../api'
import { PageHead } from '../components/PageHead'
import { WhyDiagram } from '../components/WhyDiagrams'
import { why, whyConclusion } from '../content/why'
import { hours, pct } from '../format'
import { useAppState } from '../state'

export default function WhyPage() {
  const { href } = useAppState()
  const sites = useSites()
  const year = useYearSummaries()
  const apollo = useApollo()

  // The Earth fact is computed from our own data when it is available.
  const first = sites.data?.[0]
  const fy = year.data?.find((y) => y.site.id === first?.id)
  const earthFact =
    first && fy
      ? `At ${first.name} the Earth is in view ${pct(fy.earth.visible_percent)} of the year, in ${fy.earth.windows.length} separate windows.`
      : null

  return (
    <div className="page why">
      <PageHead
        stamp="Sheet 05 / Five ideas behind every number here"
        title="Why is the south pole so tricky?"
        lede="For students and anyone curious. No formulas, each idea fits in one picture."
      />
      <ol className="why-grid">
        {why.map((w, i) => {
          const apolloFact =
            w.id === 'skim' && apollo.data && fy && first
              ? `For contrast, at Apollo 11 near the equator the Sun climbs to ${apollo.data.sun.max_el.toFixed(0)}°, but it is lit only ${pct(apollo.data.sun.lit_percent)} of the year with nights of ${hours(apollo.data.sun.longest_dark_h)}; ${first.name} is lit ${pct(fy.sun.lit_percent)}.`
              : null
          const dataFact = w.id === 'earth' ? earthFact : null
          return (
            <li key={w.id} id={w.id} className="panel why-item">
              <header>
                <span className="badge-no">{String(i + 1).padStart(2, '0')}</span>
                <h2>{w.title}</h2>
              </header>
              <div className="why-pic">
                <WhyDiagram kind={w.diagram} />
              </div>
              <div className="why-text">
                <p>{w.body}</p>
                <p className="fact">{dataFact ?? w.fact}</p>
                {apolloFact && <p className="fact">{apolloFact}</p>}
                <p className="src">{dataFact ? 'Computed here from NAIF SPICE and LOLA terrain' : w.source}</p>
              </div>
            </li>
          )
        })}
        <li className="why-end">
          <h2>{whyConclusion}</h2>
          <a className="btn" href={href('/compare')}>
            Compare sites and dates
          </a>
        </li>
      </ol>
    </div>
  )
}
