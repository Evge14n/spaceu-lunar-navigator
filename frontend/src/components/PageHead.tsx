import type { ReactNode } from 'react'

/** Sheet stamp + big condensed title + short lede on the right (design: "map sheet"). */
export function PageHead({ stamp, title, lede, children }: { stamp: ReactNode; title: ReactNode; lede?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <p className="sheet-stamp">{stamp}</p>
        <h1>{title}</h1>
      </div>
      {lede && <p className="lede">{lede}</p>}
      {children}
    </div>
  )
}
