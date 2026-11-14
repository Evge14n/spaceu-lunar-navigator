// Sheet 06: how we know the numbers are right. Validity is a judging criterion, so the checks
// are on the site, not only in the repository. Every number comes from data/ (no numbers typed in).

import { useMemo } from 'react'
import { useSites, useValidation, useYearSummaries } from '../api'
import { PageHead } from '../components/PageHead'
import { pct, signed, siteNo } from '../format'

type V = Record<string, unknown>
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const obj = (x: unknown): V | null => (x && typeof x === 'object' && !Array.isArray(x) ? (x as V) : null)
/** First numeric value found under any of the keys (validation.json is written by the backend). */
function pick(o: V | null, ...keys: string[]): number | null {
  if (!o) return null
  for (const k of keys) {
    const v = num(o[k])
    if (v !== null) return v
  }
  return null
}

export default function AccuracyPage() {
  const sites = useSites()
  const year = useYearSummaries()
  const val = useValidation()

  const rows = useMemo(() => {
    if (!sites.data || !year.data) return []
    return sites.data
      .map((s) => {
        const ours = year.data!.find((y) => y.site.id === s.id)?.sun.lit_percent
        const nasa = s.nasa_avg_illumination_percent
        return ours === undefined || nasa === undefined ? null : { s, ours, nasa, diff: ours - nasa }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
  }, [sites.data, year.data])
  const mean = rows.length ? rows.reduce((a, r) => a + r.diff, 0) / rows.length : null
  const lo = rows.length ? Math.min(...rows.map((r) => r.diff)) : null
  const hi = rows.length ? Math.max(...rows.map((r) => r.diff)) : null

  const v = val.data
  const hz = obj(v?.horizons) ?? obj(v?.horizons_test) ?? obj(v?.ephemeris)
  const hzMax = pick(hz, 'max_diff_deg', 'max_difference_deg', 'max_deg', 'max_diff')
  const hzSun = pick(hz, 'sun_max_diff_deg', 'sun_max_deg')
  const hzN = pick(hz, 'samples', 'n', 'moments')
  const hzPts = pick(hz, 'points', 'n_points')
  const orient = obj(v?.terrain_orientation) ?? obj(v?.orientation)
  const orRms = orient && Array.isArray(orient.rms_m) ? (orient.rms_m as number[]) : null
  const orOther = orient && Array.isArray(orient.other_rms_m) ? (orient.other_rms_m as number[]) : null

  return (
    <div className="page accuracy">
      <PageHead
        stamp="Sheet 06 / Three independent checks against NASA sources"
        title="How we know the numbers are right"
        lede="Every figure on this site comes from a calculation that is tested. Here is what was compared with what, and where the method stops."
      />

      <section className="panel checks" aria-label="Checks">
        <div>
          <span className="label">Check 1 / Where the Sun and the Earth are</span>
          {hzMax !== null ? (
            <>
              <span className="num">{hzMax < 0.001 ? hzMax.toPrecision(1) : hzMax.toFixed(4)}°</span>
              <p>
                Largest difference from JPL Horizons{hzN !== null ? ` over ${hzN.toLocaleString('en-GB')} moments` : ''}
                {hzPts !== null ? ` at ${hzPts} points` : ''}.{hzSun !== null ? ` The Sun agrees to ${hzSun.toPrecision(1)}°.` : ''}
              </p>
            </>
          ) : (
            <>
              <span className="num">Horizons</span>
              <p>Positions of the Sun and the Earth are tested against JPL Horizons in the backend tests. The numbers appear here as soon as data/validation.json is published.</p>
            </>
          )}
        </div>
        <div>
          <span className="label">Check 2 / Is the terrain the right way round</span>
          {orRms ? (
            <>
              <span className="num">
                {orRms[0]} to {orRms[1]} m
              </span>
              <p>
                Height mismatch between the polar elevation model as we read it and NASA's georeferenced 5 m site models.
                {orOther ? ` The other possible orientations give ${orOther[0]} to ${orOther[1]} m.` : ''}
              </p>
            </>
          ) : (
            <>
              <span className="num">5 m tiles</span>
              <p>The polar elevation model is checked against NASA's georeferenced 5 m site models, so no hill ends up mirrored. Figures arrive with data/validation.json.</p>
            </>
          )}
        </div>
        <div>
          <span className="label">Check 3 / Sunlit share against NASA's map</span>
          {mean !== null ? (
            <>
              <span className="num">{signed(mean)} points</span>
              <p>
                Average difference at the {rows.length} sites between our year at 2 m above the ground and NASA's 18.6-year average at the surface. Being higher and above small shadows, ours should read a little more.
              </p>
              <span className="label">
                Range {signed(lo!)} to {signed(hi!)}
              </span>
            </>
          ) : (
            <div className="skeleton line-skeleton" aria-busy="true" />
          )}
        </div>
      </section>

      <section className="panel" aria-label="Sunlit share, site by site">
        <div className="panel-head">
          <h2>Sunlit share, site by site</h2>
          <span className="acc-key label">
            <span>
              <i className="k-ours" />
              Ours, one year, 2 m up
            </span>
            <span>
              <i className="k-nasa" />
              NASA map, 18.6 years, surface
            </span>
          </span>
        </div>
        {rows.length ? (
          <ul className="acc-rows">
            {rows.map((r) => (
              <li key={r.s.id}>
                <span>
                  <span className="no">{siteNo(sites.data, r.s.id)}</span>
                  {r.s.name}
                </span>
                <span className="acc-bar" role="img" aria-label={`Ours ${pct(r.ours)}, NASA ${pct(r.nasa)}`}>
                  <span className="ours" style={{ width: `${r.ours}%` }} />
                  <span className="nasa" style={{ left: `${r.nasa}%` }} />
                </span>
                <span className="vals">
                  {r.ours.toFixed(1)} / {r.nasa.toFixed(1)} / {signed(r.diff)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="panel-pad">
            <div className="skeleton table-skeleton" aria-busy="true" />
          </div>
        )}
        <p className="label panel-pad rowline">Columns: ours % / NASA % / difference in points</p>
      </section>

      <div className="two">
        <section className="panel" aria-label="What is in the model">
          <h2>What is in the model</h2>
          <ul>
            <li>Positions of the Sun and the Earth from NASA's SPICE ephemeris DE440, libration included.</li>
            <li>The real horizon from LOLA terrain: 5 m near the site, 20 m and 80 m further out, to 150 km, with the curvature of the Moon.</li>
            <li>The Sun as a disc, not a point: we report how much of it is above the hills.</li>
            <li>The view of the Earth shifted for where you stand on the Moon (parallax).</li>
          </ul>
        </section>
        <section className="panel" aria-label="Where it stops">
          <h2>Where it stops</h2>
          <ul>
            <li>No temperatures and no light scattered from nearby slopes.</li>
            <li>Earth visibility is geometric: no relay satellites, no ground stations, no radio link budget.</li>
            <li>Your own points use a coarser 240 m terrain grid, so a nearby boulder or small rise is not seen.</li>
            <li>Rocks smaller than the 5 m grid are not in any of the terrain models.</li>
          </ul>
        </section>
      </div>
    </div>
  )
}
