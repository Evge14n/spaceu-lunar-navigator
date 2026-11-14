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
  const hzMoments = pick(hz, 'moments_per_point')
  const hzTarget = pick(hz, 'target_deg')
  const map = obj(v?.nasa_map)
  const mapMedian = pick(map, 'median_abs_pp')
  const mapPixels = pick(map, 'pixels')
  const mapCorr = pick(map, 'correlation')
  const mapBias = pick(map, 'bias_pp')
  const within = obj(map?.within_pp)
  const within5 = pick(within, '5')
  const psr = obj(v?.psr)
  const psrN = pick(psr, 'pixels')
  const psrDark = pick(psr, 'never_lit')
  const psrIn = pick(psr, 'interior_pixels')
  const psrInDark = pick(psr, 'interior_never_lit')
  const br = obj(v?.browser)
  const brLit = obj(br?.lit_percent)
  const brMed = pick(brLit, 'median_abs')
  const brP90 = pick(brLit, 'p90_abs')
  const limits = Array.isArray(v?.limits) ? (v!.limits as string[]) : null
  const siteRows = obj(v?.sites) && Array.isArray(obj(v?.sites)!.rows) ? (obj(v?.sites)!.rows as { id: string; explanation?: string }[]) : []
  const siteNote = obj(v?.sites) ? (obj(v?.sites)!.note as string | undefined) : undefined

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
                Largest difference from JPL Horizons over {hzN !== null ? hzN.toLocaleString('en-GB') : 'the'} compared positions
                {hzMoments !== null && hzPts !== null ? ` (${hzMoments} moments at ${hzPts} points, Sun and Earth)` : ''}.
                {hzSun !== null ? ` The Sun agrees to ${hzSun.toPrecision(1)}°.` : ''}
              </p>
              {hzTarget !== null && <span className="label">Our target was {hzTarget}°</span>}
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
          {mapMedian !== null ? (
            <>
              <span className="num">{mapMedian.toFixed(2)} pp</span>
              <p>
                Median difference from NASA's illumination map at {mapPixels} random pixels, computed the way the map was (60 m model, on the surface, 18.6 years).
                {within5 !== null ? ` ${within5.toFixed(0)} % of pixels within 5 points.` : ''}
              </p>
              <span className="label">
                {mapCorr !== null ? `Correlation ${mapCorr.toFixed(4)}` : ''}
                {mapBias !== null ? ` / bias ${signed(mapBias, 2)} pp` : ''}
              </span>
            </>
          ) : mean !== null ? (
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
        <div>
          <span className="label">Check 4 / Shadowed craters stay dark</span>
          {psrN !== null && psrDark !== null ? (
            <>
              <span className="num">
                {psrDark} of {psrN}
              </span>
              <p>
                Pixels that NASA marks as permanently shadowed never see the Sun in our calculation
                {psrIn !== null && psrInDark !== null ? `; ${psrInDark} of ${psrIn} well inside the shadow` : ''}.
              </p>
            </>
          ) : (
            <div className="skeleton line-skeleton" aria-busy="true" />
          )}
        </div>
        <div>
          <span className="label">Check 5 / Your own point in the browser</span>
          {brMed !== null ? (
            <>
              <span className="num">{brMed.toFixed(1)} pp</span>
              <p>
                Typical difference of the in-browser estimate (240 m terrain) from the full calculation{brP90 !== null ? `; nine points in ten within ${brP90.toFixed(1)} pp` : ''}. The listed sites always use the full calculation.
              </p>
            </>
          ) : (
            <div className="skeleton line-skeleton" aria-busy="true" />
          )}
        </div>
        <div>
          <span className="label">Check 6 / Website against backend</span>
          <span className="num">Same numbers</span>
          <p>An automatic test recomputes every site's year in the browser code and compares it with the backend's summary: sunlit share, Earth in view, highest Sun, darkness and sunlight on a panel.</p>
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
        {siteRows.length > 0 && (
          <details className="panel-pad rowline">
            <summary className="label" style={{ cursor: 'pointer' }}>
              Why the two numbers differ, site by site
            </summary>
            {siteNote && <p className="small" style={{ margin: '10px 0' }}>{siteNote}</p>}
            <ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {siteRows.map((r) => (
                <li key={r.id}>
                  <b>{siteNo(sites.data, r.id)}</b> {r.explanation}
                </li>
              ))}
            </ul>
          </details>
        )}
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
            {(limits ?? []).map((l) => (
              <li key={l}>{l}</li>
            ))}
            <li>Earth visibility is geometric: no relay satellites, no ground stations, no radio link budget.</li>
          </ul>
        </section>
      </div>
    </div>
  )
}
