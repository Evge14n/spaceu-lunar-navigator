// The globe itself: the LRO Moon model (or a plain sphere when it is not there yet), lit by the
// Sun from its true direction, with the ten prepared sites, the picked point and the three
// orientation markers of GLOBE.md. Loaded only on #/globe, lazily, with three.js in its own chunk.
//
// Scene frame: x = 0 N 90 E, y = north pole, z = 0 N 0 E (api/sun.ts, meToScene). The globe is a
// unit sphere, so one scene unit is one lunar radius (frame.ts).

import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Site, Vec3 } from '../../api'
import { hasPosition, pickLabels, type LabelCandidate } from './sitePicker'
import { fileExists } from './heights'
import { sampleModelHeights } from './modelHeights'
import type { ModelGrid } from './modelGrid'
import { cameraDistanceFor, cameraPlanes, fitModel, type ModelFit } from './fit'
import {
  dirFromLatLon,
  GLOBE_RADIUS,
  latLonFromPoint,
  modelMatrix,
  ORIENTATION_MARKERS,
  pointFromLatLon,
  type ModelFrame,
  type ModelSummary,
} from './frame'

const SMALL = typeof window !== 'undefined' && window.innerWidth < 700
const DPR: [number, number] = SMALL ? [1, 1.5] : [1, 2]
/** phones draw a quarter of the triangles of the fallback sphere */
const SEGMENTS: [number, number] = SMALL ? [96, 48] : [192, 96]

const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/?$/, '/')

/**
 * `?debug` anywhere in the address (before the # is the one that survives, because the sheets
 * rewrite the part after it) turns on the console report about the model.
 */
export function debugOn(): boolean {
  if (typeof window === 'undefined') return false
  const { search, hash } = window.location
  return /(^|[?&])debug\b/.test(search) || /[?&]debug\b/.test(hash)
}

const log = (...args: unknown[]) => {
  if (debugOn()) console.info('[globe]', ...args)
}
/** Where the model may live: the first one that answers wins. */
export const MODEL_URLS = [`${BASE}moon/moon.glb`, `${BASE}models/moon.glb`]
const TEXTURE_NAMES = SMALL ? ['moon-1024.webp', 'moon.webp', 'moon.jpg'] : ['moon.webp', 'moon.jpg', 'moon-1024.webp']
export const TEXTURE_URLS = [...TEXTURE_NAMES.map((n) => `${BASE}moon/${n}`), `${BASE}models/moon.webp`]

export type ModelState =
  | { kind: 'loading' }
  | { kind: 'model'; object: THREE.Object3D; url: string; fit: ModelFit }
  | { kind: 'sphere'; texture: THREE.Texture | null; reason: string }

async function firstThatExists(urls: string[]): Promise<string | null> {
  for (const url of urls) if (await fileExists(url)) return url
  return null
}

/**
 * Make every material of the model react to the Sun, keeping its texture, and draw both faces:
 * a globe exported with flipped normals (or a half-sphere) would otherwise be invisible from
 * outside, which looks exactly like "the model did not load".
 */
function relight(object: THREE.Object3D): void {
  object.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const next = mats.map((m) => {
      const old = m as THREE.MeshStandardMaterial & { map?: THREE.Texture | null }
      if ((old as THREE.Material).type === 'MeshStandardMaterial' || (old as THREE.Material).type === 'MeshPhysicalMaterial') {
        old.roughness = 1
        old.metalness = 0
        old.side = THREE.DoubleSide
        return old
      }
      return new THREE.MeshStandardMaterial({
        map: old.map ?? null,
        color: old.map ? 0xffffff : 0xcfcbc4,
        roughness: 1,
        metalness: 0,
        side: THREE.DoubleSide,
      })
    })
    mesh.material = (Array.isArray(mesh.material) ? next : next[0]) as THREE.Material
  })
}

/** Load the GLB once per page visit; fall back to a sphere, never crash. */
function useGlobeModel(): ModelState {
  const [state, setState] = useState<ModelState>({ kind: 'loading' })
  useEffect(() => {
    let live = true
    let created: THREE.Object3D | null = null
    const sphere = async (reason: string) => {
      const texUrl = await firstThatExists(TEXTURE_URLS)
      let texture: THREE.Texture | null = null
      if (texUrl) {
        try {
          texture = await new THREE.TextureLoader().loadAsync(texUrl)
          texture.colorSpace = THREE.SRGBColorSpace
        } catch {
          texture = null
        }
      }
      if (live) setState({ kind: 'sphere', texture, reason })
      else texture?.dispose()
    }
    ;(async () => {
      const url = await firstThatExists(MODEL_URLS)
      if (!url) return sphere('no model file yet')
      try {
        const loader = new GLTFLoader()
        loader.setMeshoptDecoder(MeshoptDecoder)
        // Draco models work too: three ships the decoder and Vite emits it next to the site,
        // fetched only if a model actually needs it
        const draco = new DRACOLoader()
        loader.setDRACOLoader(draco)
        const gltf = await loader.loadAsync(url)
        draco.dispose()
        if (!live) return
        const fit = fitModel(gltf.scene)
        log('loaded', url)
        log(
          'nodes:',
          gltf.scene.children.length,
          'meshes:',
          fit.meshes.length,
          'triangles:',
          fit.triangles,
          fit.meshes.map((m) => ({
            name: m.name,
            triangles: m.triangles,
            radius: m.radius,
            centre: m.centre,
            box: m.box,
            dropped: m.dropped,
          })),
        )
        log('bounding sphere radius of the chosen mesh:', fit.radius, '(' + (fit.chosen ?? 'none') + ')', '-> scale', fit.scale)
        if (!fit.ok) {
          // an empty export, or a file with nothing but cameras and lights: say so and draw the ball
          log('nothing to draw:', fit.reason)
          await sphere(fit.reason ?? 'the model has nothing to draw')
          return
        }
        created = gltf.scene
        relight(created)
        setState({ kind: 'model', object: created, url, fit })
      } catch (e) {
        const msg = (e as Error).message || 'the model could not be read'
        await sphere(msg)
      }
    })()
    return () => {
      live = false
      created?.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.geometry.dispose()
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose()
      })
    }
  }, [])
  return state
}

/** Scale and orient the model so that it is a unit sphere in the scene frame. */
function ModelGlobe({
  object,
  fit,
  frame,
  spin,
  onTap,
  onHeights,
}: {
  object: THREE.Object3D
  /** which mesh is the globe, and how much to scale it (fit.ts) */
  fit: ModelFit
  frame: ModelFrame
  spin: number
  onTap: (e: ThreeEvent<PointerEvent>) => void
  onHeights: (g: ModelGrid | null) => void
}) {
  const quat = useMemo(() => {
    const m = modelMatrix(frame, spin)
    const mat = new THREE.Matrix4().set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1)
    return new THREE.Quaternion().setFromRotationMatrix(mat)
  }, [frame, spin])
  // Once the model is on screen, read its vertices into a height grid (modelHeights.ts). It is
  // the only relief a custom point has away from the pole unless a grid is published; a textured
  // ball gives null and the 3D view says "no elevation model". Re-read when the model is turned.
  useEffect(() => {
    const id = window.setTimeout(() => onHeights(sampleModelHeights(object, modelMatrix(frame, spin), fit.centre, fit.scale)), 400)
    return () => window.clearTimeout(id)
  }, [object, frame, spin, fit, onHeights])
  return (
    <group quaternion={quat} scale={fit.scale} onPointerDown={onTap} onPointerUp={onTap}>
      <group position={[-fit.centre.x, -fit.centre.y, -fit.centre.z]}>
        <primitive object={object} />
      </group>
    </group>
  )
}

function SphereGlobe({ texture, onTap }: { texture: THREE.Texture | null; onTap: (e: ThreeEvent<PointerEvent>) => void }) {
  return (
    <mesh onPointerDown={onTap} onPointerUp={onTap}>
      {/* the texture of an equirectangular map starts at 180 W: turn it so u = 0.5 is 0 E */}
      <sphereGeometry args={[GLOBE_RADIUS, SEGMENTS[0], SEGMENTS[1], -Math.PI / 2]} />
      <meshStandardMaterial map={texture ?? undefined} color={texture ? '#ffffff' : '#bfbbb4'} roughness={1} metalness={0} side={THREE.DoubleSide} />
    </mesh>
  )
}

function Marker({
  at,
  color,
  radius = 0.012,
  onPick,
  onHover,
}: {
  at: Vec3
  color: string
  radius?: number
  onPick?: () => void
  onHover?: (over: boolean) => void
}) {
  return (
    <mesh
      position={at}
      onPointerDown={
        onPick
          ? (e) => {
              e.stopPropagation()
              onPick()
            }
          : undefined
      }
      onPointerOver={onHover ? (e) => (e.stopPropagation(), onHover(true)) : undefined}
      onPointerOut={onHover ? () => onHover(false) : undefined}
    >
      <sphereGeometry args={[radius, 12, 8]} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
  )
}

/** The chosen site: a ring lying on the ground around its marker, so it reads from any angle. */
function SelectionRing({ lat, lon }: { lat: number; lon: number }) {
  const quat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...dirFromLatLon(lat, lon))), [lat, lon])
  return (
    <mesh position={pointFromLatLon(lat, lon, 0, 0.004)} quaternion={quat}>
      <ringGeometry args={[0.026, 0.036, 32]} />
      <meshBasicMaterial color="#ffd166" side={THREE.DoubleSide} transparent opacity={0.95} toneMapped={false} />
    </mesh>
  )
}

/**
 * Site names, drawn as plain DOM over the canvas and moved every frame: crisp text, the sheet's
 * own type, and collisions decided in screen pixels (sitePicker.ts, pickLabels).
 */
function LabelWriter({
  sites,
  selectedId,
  hoveredId,
  host,
}: {
  sites: Site[]
  selectedId: string | null
  hoveredId: string | null
  host: React.RefObject<HTMLDivElement | null>
}) {
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera, size }) => {
    const root = host.current
    if (!root) return
    const items: LabelCandidate[] = []
    const seen: { el: HTMLElement; x: number; y: number }[] = []
    for (const s of sites) {
      if (!hasPosition(s)) continue
      const el = root.querySelector<HTMLElement>(`[data-site="${s.id}"]`)
      if (!el) continue
      const p = pointFromLatLon(s.lat, s.lon, s.elevation_m ?? 0, 0.03)
      v.set(p[0], p[1], p[2])
      // the near side only: the marker must point towards the camera, not away from it
      const front = v.dot(camera.position) > 0
      v.project(camera)
      const x = ((v.x + 1) / 2) * size.width
      const y = ((1 - v.y) / 2) * size.height
      items.push({ id: s.id, x, y, front: front && v.z < 1, priority: s.id === selectedId ? 3 : s.id === hoveredId ? 2 : 1, width: el.offsetWidth || 90 })
      seen.push({ el, x, y })
    }
    const keep = pickLabels(items, { stageWidth: size.width, stageHeight: size.height })
    for (const { el, x, y } of seen) {
      const id = el.dataset.site ?? ''
      el.style.visibility = keep.has(id) ? 'visible' : 'hidden'
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`
    }
  })
  return null
}

/** Orbit with the mouse or a finger; Ctrl + wheel zooms, as on the other sheets. */
function Rig({ focus, fitKey }: { focus: { dir: [number, number, number]; distance: number; key: number } | null; fitKey: string }) {
  const { camera, gl, size } = useThree()
  const controls = useRef<OrbitControls | null>(null)
  const target = useRef<THREE.Vector3 | null>(null)
  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement)
    c.enablePan = false
    c.enableDamping = true
    c.dampingFactor = 0.08
    c.rotateSpeed = 0.45
    c.minDistance = GLOBE_RADIUS * 1.08
    c.maxDistance = GLOBE_RADIUS * 10
    // the page scrolls on a plain wheel; Ctrl + wheel zooms, as on sheet 04. Pinch always zooms.
    c.enableZoom = true
    c.zoomSpeed = 0.8
    controls.current = c
    const onWheel = (e: WheelEvent) => {
      c.enableZoom = e.ctrlKey
      if (e.ctrlKey) e.preventDefault()
    }
    gl.domElement.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => {
      gl.domElement.removeEventListener('wheel', onWheel, { capture: true })
      c.dispose()
      controls.current = null
    }
  }, [camera, gl])
  // Put the whole globe in the frame, whatever the model turned out to be and whatever shape the
  // window is (on a phone held upright the width is the tight side), and set the planes from its
  // radius rather than from numbers guessed for one screen.
  const aspect = size.width / Math.max(1, size.height)
  const fitted = useRef('')
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera
    const d = cameraDistanceFor(GLOBE_RADIUS, cam.fov, aspect)
    const { near, far } = cameraPlanes(GLOBE_RADIUS, d)
    cam.near = near
    cam.far = far
    const first = fitted.current !== fitKey
    fitted.current = fitKey
    if (camera.position.length() < 1e-6) camera.position.set(0.32, 0.18, 1)
    // a new model starts at the fitting distance; later, when the window changes shape, only pull
    // back if the globe would no longer fit, so a zoom the user chose is not undone
    if (first || camera.position.length() < d) camera.position.setLength(d)
    cam.updateProjectionMatrix()
    controls.current?.update()
    log('camera fitted:', { distance: camera.position.length(), near, far, aspect: +aspect.toFixed(3), fov: cam.fov })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, aspect, camera])

  const key = focus?.key ?? 0
  const turn = useRef<{ from: THREE.Vector3; to: THREE.Vector3; t0: number } | null>(null)
  useEffect(() => {
    if (!focus || !key) return
    const to = new THREE.Vector3(...focus.dir).multiplyScalar(focus.distance)
    const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (still) {
      camera.position.copy(to)
      controls.current?.update()
      target.current = null
      turn.current = null
      return
    }
    turn.current = { from: camera.position.clone(), to, t0: performance.now() }
    target.current = to
    // only a new focus request (a new key) moves the camera; dragging must not be fought
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  useFrame(() => {
    const t = turn.current
    if (t) {
      // 600 ms, ease in and out, along the shorter way round the globe
      const k = Math.min(1, (performance.now() - t.t0) / TURN_MS)
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
      const from = t.from.clone().normalize()
      const to = t.to.clone().normalize()
      const dir = from.angleTo(to) < 1e-6 ? to : from.applyAxisAngle(new THREE.Vector3().crossVectors(from, to).normalize(), from.angleTo(to) * e)
      camera.position.copy(dir.multiplyScalar(t.from.length() + (t.to.length() - t.from.length()) * e))
      if (k >= 1) {
        turn.current = null
        target.current = null
      }
    }
    controls.current?.update()
  })
  return null
}

export const summarize = (m: ModelState): ModelSummary =>
  m.kind === 'model'
    ? { kind: 'model', url: m.url, triangles: m.fit.triangles }
    : m.kind === 'sphere'
      ? { kind: 'sphere', reason: m.reason, textured: !!m.texture }
      : { kind: 'loading' }

export interface GlobeSceneProps {
  /** unit vector to the Sun in the scene frame, or null while the ephemeris loads */
  sunDir: [number, number, number] | null
  sites: Site[]
  selectedId: string | null
  hoveredId: string | null
  /** a tap on bare ground chooses the listed site closest to it */
  onPickNearest: (lat: number, lon: number) => void
  onPickSite: (id: string) => void
  onHoverSite: (id: string | null) => void
  showOrientation: boolean
  frame: ModelFrame
  spin: number
  onModel: (m: ModelSummary) => void
  /** relief found in the model, or null when it is a smooth ball */
  onHeights: (g: ModelGrid | null) => void
  focus: { dir: [number, number, number]; distance: number; key: number } | null
}

/** how long the camera takes to swing to a chosen site */
const TURN_MS = 600
const TAP_PX = 8
const TAP_MS = 600

export default function GlobeScene({
  sunDir,
  sites,
  selectedId,
  hoveredId,
  onPickNearest,
  onPickSite,
  onHoverSite,
  showOrientation,
  frame,
  spin,
  onModel,
  onHeights,
  focus,
}: GlobeSceneProps) {
  const labelHost = useRef<HTMLDivElement>(null)
  const model = useGlobeModel()
  useEffect(() => onModel(summarize(model)), [model, onModel])
  const down = useRef<{ x: number; y: number; t: number } | null>(null)
  // a drag turns the globe; only a tap drops the pin
  const onTap = (e: ThreeEvent<PointerEvent>) => {
    const ev = e.nativeEvent
    if (ev.type === 'pointerdown') {
      down.current = { x: ev.clientX, y: ev.clientY, t: performance.now() }
      return
    }
    const d = down.current
    down.current = null
    if (!d || Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > TAP_PX || performance.now() - d.t > TAP_MS) return
    e.stopPropagation()
    const [lat, lon] = latLonFromPoint([e.point.x, e.point.y, e.point.z])
    onPickNearest(lat, lon)
  }
  const sun = sunDir ?? [0.6, 0.2, 0.8]
  return (
    <div className="canvas-wrap" role="img" aria-label="Globe of the Moon lit by the Sun; tap it to pick a point, or type the coordinates below">
      {model.kind === 'loading' && <div className="stage-loading" aria-busy="true">Loading the Moon…</div>}
      <Canvas
        dpr={DPR}
        camera={{ fov: 32, near: 0.05, far: 60, position: [0.9, 0.5, 2.8] }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ scene }) => (scene.background = new THREE.Color('#05060a'))}
      >
        {/* the Moon has no air, so the night side is dark - but not a black hole in the page */}
        <ambientLight intensity={0.16} color="#9fb0c8" />
        <hemisphereLight args={['#8ea0b8', '#1b1f26', 0.12]} />
        <directionalLight position={[sun[0] * 12, sun[1] * 12, sun[2] * 12]} intensity={3.0} />
        {model.kind === 'model' ? (
          <ModelGlobe object={model.object} fit={model.fit} frame={frame} spin={spin} onTap={onTap} onHeights={onHeights} />
        ) : model.kind === 'sphere' ? (
          <SphereGlobe texture={model.texture} onTap={onTap} />
        ) : null}
        {sites.map((s) => {
          if (!hasPosition(s)) return null
          const on = s.id === selectedId
          const over = s.id === hoveredId
          return (
            <group key={s.id}>
              {on && <SelectionRing lat={s.lat} lon={s.lon} />}
              <Marker
                at={pointFromLatLon(s.lat, s.lon, s.elevation_m ?? 0, 0.006)}
                color={on ? '#ffd166' : over ? '#ffffff' : '#7fb0f0'}
                radius={on ? 0.017 : over ? 0.014 : 0.0095}
                onPick={() => onPickSite(s.id)}
                onHover={(o) => onHoverSite(o ? s.id : null)}
              />
            </group>
          )
        })}
        {showOrientation &&
          ORIENTATION_MARKERS.map((m, i) => (
            <Marker key={m.label} at={pointFromLatLon(m.lat, m.lon, 0, 0.004)} color={['#6ee7a8', '#ff8fd0', '#ffe066'][i]} radius={0.02} />
          ))}
        <LabelWriter sites={sites} selectedId={selectedId} hoveredId={hoveredId} host={labelHost} />
        <Rig focus={focus} fitKey={model.kind === 'model' ? `${model.url}|${model.fit.radius}` : model.kind} />
      </Canvas>
      <div ref={labelHost} className="globe-labels" aria-hidden="true">
        {sites.filter(hasPosition).map((s) => (
          <span
            key={s.id}
            data-site={s.id}
            className="globe-label"
            data-on={s.id === selectedId ? 'true' : undefined}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              visibility: 'hidden',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
              padding: '2px 6px',
              fontFamily: 'var(--f-mono)',
              fontSize: 11,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: s.id === selectedId ? '#05060a' : '#e9edf2',
              background: s.id === selectedId ? '#ffd166' : 'rgba(5, 6, 10, 0.72)',
              border: `1px solid ${s.id === selectedId ? '#ffd166' : 'rgba(233, 237, 242, 0.35)'}`,
            }}
          >
            {s.name}
          </span>
        ))}
      </div>
    </div>
  )
}
