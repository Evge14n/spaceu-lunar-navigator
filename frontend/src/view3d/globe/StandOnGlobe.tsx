// Sheet 04 for a point of your own: stand on the globe model itself, not on a separate tile.
// The ground is the model's own triangles around the point, moved into the local frame with the
// surface under your feet at the origin (localGround.ts). Sky, Sun light, compass, camera and the
// HUD overlay are the same components the prepared sites use (../Scene.tsx).
//
// Depth: this scene holds ground 2 m away and a limb 1 300 km away in the same frame, so the
// canvas uses a logarithmic depth buffer. The prepared-site scene keeps its ordinary one.

import { Canvas } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import type { Sky } from '../../api'
import {
  ABOVE_FOV,
  CameraRig,
  Compass,
  EYE_FOV,
  OverlayWriter,
  SkyDome,
  SunLight,
  setLabelScale,
  type CameraMode,
  type OverlayRefs,
  type OverviewView,
} from '../Scene'
import { IDENTITY_CALIBRATION, type Calibration } from './calibrate'
import { sampleSpacingM } from './fit'
import { GLOBE_MODEL_FRAME, GLOBE_MODEL_SPIN_DEG, modelMatrix, type ModelFrame } from './frame'
import { buildLocalGround, type LocalGround } from './localGround'
import { loadMoonModel, type MoonModel } from './modelSource'
import { debugOn } from './GlobeScene'

const SMALL = typeof window !== 'undefined' && window.innerWidth < 700
const DPR: [number, number] = SMALL ? [1, 1.5] : [1, 1.75]
/** how much of the globe to carry into the local scene (phones take a smaller bite) */
export const CAP_DEG = SMALL ? 30 : 45
const EYE_M = 2

/** "From above" for the globe ground: a few hundred kilometres up, not a few kilometres. */
const GLOBE_OVERVIEW: OverviewView = {
  radius: SMALL ? 150_000 : 300_000,
  height: SMALL ? 150_000 : 300_000,
  minDistance: 2_000,
  maxDistance: 1_500_000,
}

export interface GroundState {
  ground: LocalGround | null
  model: MoonModel | null
  error: string | null
  loading: boolean
}

/** Build the local ground once per point (and per calibration), off the render path. */
export function useLocalGround(latDeg: number, lonDeg: number, calibration: Calibration | null, frame: ModelFrame = GLOBE_MODEL_FRAME, spin = GLOBE_MODEL_SPIN_DEG): GroundState {
  const [state, setState] = useState<GroundState>({ ground: null, model: null, error: null, loading: true })
  const cal = calibration ?? IDENTITY_CALIBRATION
  const key = `${latDeg},${lonDeg}|${cal.scale},${cal.offset}|${frame}|${spin}`
  useEffect(() => {
    let live = true
    let built: LocalGround | null = null
    setState({ ground: null, model: null, error: null, loading: true })
    loadMoonModel().then((loaded) => {
      if (!live) return
      if (!loaded.ok) {
        setState({ ground: null, model: null, error: loaded.reason, loading: false })
        return
      }
      try {
        const t0 = performance.now()
        built = buildLocalGround(loaded.model, { latDeg, lonDeg, rotation: modelMatrix(frame, spin), calibration: cal, capDeg: CAP_DEG, eyeM: EYE_M })
        if (debugOn())
          console.info('[globe] ground at', latDeg, lonDeg, {
            spacing_km: +(sampleSpacingM(loaded.model.vertices) / 1000).toFixed(2),
            vertices: loaded.model.vertices,
            triangles_kept: built.triangles,
            kept_fraction: +built.keptFraction.toFixed(3),
            cap_deg: CAP_DEG,
            ground_m: Math.round(built.groundM),
            model_base_radius: built.baseRadius,
            calibration: cal,
            ms: Math.round(performance.now() - t0),
          })
        if (!live) {
          built.geometry.dispose()
          return
        }
        setState({ ground: built, model: loaded.model, error: null, loading: false })
      } catch (e) {
        setState({ ground: null, model: null, error: (e as Error).message || 'the ground could not be built', loading: false })
      }
    })
    return () => {
      live = false
      built?.geometry.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state
}

function Ground({ ground, exaggeration }: { ground: LocalGround; exaggeration: number }) {
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#9b9790', roughness: 1, metalness: 0, side: THREE.DoubleSide, flatShading: true }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])
  return (
    <group scale={[1, exaggeration, 1]}>
      <mesh geometry={ground.geometry} material={material} />
    </group>
  )
}

export interface GroundStatus {
  loading: boolean
  error: string | null
  /** measured spacing of the model's vertices on the ground, km (null while loading) */
  spacingKm: number | null
  triangles: number
}

export interface StandOnGlobeProps {
  latDeg: number
  lonDeg: number
  calibration: Calibration | null
  onStatus: (s: GroundStatus) => void
  sky: Sky
  mode: CameraMode
  enlarge: number
  lookDir: [number, number, number]
  resetKey: string
  overlay?: OverlayRefs
}

export default function StandOnGlobe({ latDeg, lonDeg, calibration, onStatus, sky, mode, enlarge, lookDir, resetKey, overlay }: StandOnGlobeProps) {
  const state = useLocalGround(latDeg, lonDeg, calibration)
  const { ground, model, error, loading } = state
  useEffect(
    () => onStatus({ loading, error, spacingKm: model ? sampleSpacingM(model.vertices) / 1000 : null, triangles: ground?.triangles ?? 0 }),
    [loading, error, model, ground, onStatus],
  )
  setLabelScale(mode === 'site' ? EYE_FOV : ABOVE_FOV)
  if (!ground) return null
  return (
    <div className="canvas-wrap" role="img" aria-label="3D view from the picked point on the Moon, with the Sun and the Earth in their true directions">
      <Canvas
        dpr={DPR}
        camera={{ fov: EYE_FOV, near: 0.5, far: 4_000_000 }}
        gl={{ antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true }}
        onCreated={({ scene }) => (scene.background = new THREE.Color('#05060a'))}
      >
        {/* the Moon has no air: the night side keeps only the light other slopes throw back */}
        <ambientLight intensity={0.1} color="#c8ced6" />
        <hemisphereLight args={['#9aa3ad', '#2a2e33', 0.18]} />
        <SunLight sky={sky} eyeY={EYE_M} />
        <Ground ground={ground} exaggeration={1} />
        <SkyDome sky={sky} enlarge={enlarge} />
        {mode === 'overview' && <Compass eyeY={EYE_M} />}
        <CameraRig mode={mode} eyeY={EYE_M} lookDir={lookDir} resetKey={resetKey} overview={GLOBE_OVERVIEW} />
        {overlay && <OverlayWriter refs={overlay} show={mode === 'site'} />}
      </Canvas>
    </div>
  )
}
