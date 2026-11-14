// #/globe: the place for the intro globe by Anastasiia Sh. (her GLB Moon model from LRO data).
// Only a frame and the data the globe needs; the globe itself is hers, see GLOBE.md next to this file.
// Not in the navigation and not the first screen until the model is compressed (budget in GLOBE.md).

import { meToScene, toLatLon, useSites, useSunDirection } from '../api'
import { PageHead } from '../components/PageHead'
import { dateTimeUtc } from '../format'
import { useAppState } from '../state'

export default function GlobePage() {
  const { t, href } = useAppState()
  const sun = useSunDirection(t)
  const sites = useSites()
  const sub = sun ? toLatLon(sun) : null
  const scene = sun ? meToScene(sun) : null
  return (
    <div className="page globe">
      <PageHead
        stamp="Sheet 00 / Intro / The whole Moon, lit as it is now"
        title="The Moon, and where its south pole is"
        lede="A globe from LRO data comes here: the Sun lights it from the true direction at the chosen moment, the ten sites sit at the pole."
      />
      <section className="panel scene-panel" aria-label="Globe (in progress)">
        <div className="scene-cap label">
          <span>Globe: in progress</span>
          <span>{dateTimeUtc(t)}</span>
        </div>
        <div className="stage globe-stage">
          <div className="stage-loading">
            <p>
              The globe model is being prepared. Meanwhile, <a href={href('/map')}>open the map of the south pole</a>.
            </p>
          </div>
        </div>
        <div className="status">
          <p>
            <b className="sun-t">Sun over</b> {sub ? `${Math.abs(sub[0]).toFixed(2)}° ${sub[0] < 0 ? 'S' : 'N'}, ${sub[1].toFixed(1)}° E` : '…'}
          </p>
          <p className="mono">
            <b>Scene direction</b> {scene ? scene.map((v) => v.toFixed(4)).join(', ') : '…'} (x 90° E, y north, z 0° E)
          </p>
          <p>
            <b>Sites</b> {sites.data ? sites.data.length : '…'} at the south pole
          </p>
        </div>
      </section>
    </div>
  )
}
