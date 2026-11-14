import { why } from '../content/why'
import { WhyDiagram } from '../components/WhyDiagrams'

export default function WhyPage() {
  return (
    <div className="page why">
      <div className="page-head">
        <h1>Why is the south pole so tricky?</h1>
        <p className="lede">Five ideas behind every number in this tool, for students and anyone curious.</p>
      </div>
      <ol className="why-list">
        {why.map((w, i) => (
          <li key={w.id} id={w.id} className="why-item">
            <div className="why-text">
              <span className="why-n" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
              <h2>{w.title}</h2>
              <p>{w.body}</p>
              <p className="fact">{w.fact}</p>
              <p className="source small">{w.source}</p>
            </div>
            <div className="why-pic">
              <WhyDiagram kind={w.diagram} />
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
