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
/** Where the model may live: the first one that answers wins. */
export const MODEL_URLS = [`${BASE}moon/moon.glb`, `${BASE}models/moon.glb`]
const TEXTURE_NAMES = SMALL ? ['moon-1024.webp', 'moon.webp', 'moon.jpg'] : ['moon.webp', 'moon.jpg', 'moon-1024.webp']
export const TEXTURE_URLS = [...TEXTURE_NAMES.map((n) => `${BASE}moon/${n}`), `${BASE}models/moon.webp`]

export type ModelState =
  | { kind: 'loading' }
  | { kind: 'model'; object: THREE.Object3D; url: string; triangles: number }
  | { kind: 'sphere'; texture: THREE.Texture | null; reason: string }

async function firstThatExists(urls: string[]): Promise<string | null> {
  for (const url of urls) {
    try {
      const r = await fetch(url, { method: 'HEAD' })
      if (r.ok && !(r.headers.get('content-type') ?? '').includes('text/html')) return url
    } catch {
      /* try the next one */
    }
  }
  return null
}

/** Make every material of the model react to the Sun, keeping its texture. */
function relight(object: THREE.Object3D): number {
  let triangles = 0
  object.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const index = mesh.geometry.getIndex()
    triangles += (index ? index.count : mesh.geometry.getAttribute('position')?.count ?? 0) / 3
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const next = mats.map((m) => {
      const old = m as THREE.MeshStandardMaterial & { map?: THREE.Texture | null }
      if ((old as THREE.Material).type === 'MeshStandardMaterial' || (old as THREE.Material).type === 'MeshPhysicalMaterial') {
        old.roughness = 1
        old.metalness = 0
        return old
      }
      return new THREE.MeshStandardMaterial({ map: old.map ?? null, color: old.map ? 0xffffff : 0xcfcbc4, roughness: 1, metalness: 0 })
    })
    mesh.material = (Array.isArray(mesh.material) ? next : next[0]) as THREE.Material
  })
  return Math.round(triangles)
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
        // only used when the model is Draco-compressed and the decoder was put next to the site
        const draco = new DRACOLoader().setDecoderPath(`${BASE}draco/`)
        loader.setDRACOLoader(draco)
        const gltf = await loader.loadAsync(url)
        draco.dispose()
        if (!live) return
        created = gltf.scene
        const triangles = relight(created)
        setState({ kind: 'model', object: created, url, triangles })
      } catch (e) {
        const msg = (e as Error).message || 'the model could not be read'
        await sphere(/draco/i.test(msg) ? 'the model needs the Draco decoder' : msg)
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
function ModelGlobe({ object, frame, spin, onTap }: { object: THREE.Object3D; frame: ModelFrame; spin: number; onTap: (e: ThreeEvent<PointerEvent>) => void }) {
  const group = useRef<THREE.Group>(null)
  const fit = useMemo(() => {
    const box = new THREE.Box3().setFromObject(object)
    const sphere = box.getBoundingSphere(new THREE.Sphere())
    // the model may be centred anywhere and scaled in metres, kilometres or radii
    return { scale: sphere.radius > 0 ? GLOBE_RADIUS / sphere.radius : 1, centre: sphere.center.clone() }
  }, [object])
  const quat = useMemo(() => {
    const m = modelMatrix(frame, spin)
    const mat = new THREE.Matrix4().set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1)
    return new THREE.Quaternion().setFromRotationMatrix(mat)
  }, [frame, spin])
  return (
    <group ref={group} quaternion={quat} scale={fit.scale} onPointerDown={onTap} onPointerUp={onTap}>
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
      <meshStandardMaterial map={texture ?? undefined} color={texture ? '#ffffff' : '#bfbbb4'} roughness={1} metalness={0} />
    </mesh>
  )
}

function Marker({ at, color, radius = 0.012, onPick }: { at: Vec3; color: string; radius?: number; onPick?: () => void }) {
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
    >
      <sphereGeometry args={[radius, 12, 8]} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
  )
}

/** The picked point: a pin standing on the surface, visible from any side. */
function Pin({ lat, lon }: { lat: number; lon: number }) {
  const base = pointFromLatLon(lat, lon, 0, 0.005)
  const tip = pointFromLatLon(lat, lon, 0, 0.1)
  const mid: [number, number, number] = [(base[0] + tip[0]) / 2, (base[1] + tip[1]) / 2, (base[2] + tip[2]) / 2]
  const quat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dirFromLatLon(lat, lon))), [lat, lon])
  return (
    <group>
      <mesh position={mid} quaternion={quat}>
        <cylinderGeometry args={[0.004, 0.004, 0.095, 8]} />
        <meshBasicMaterial color="#ff5a3c" toneMapped={false} />
      </mesh>
      <mesh position={tip}>
        <sphereGeometry args={[0.022, 16, 12]} />
        <meshBasicMaterial color="#ff5a3c" toneMapped={false} />
      </mesh>
      <Marker at={pointFromLatLon(lat, lon, 0, 0.002)} color="#ffd28a" radius={0.008} />
    </group>
  )
}

/** Orbit with the mouse or a finger; Ctrl + wheel zooms, as on the other sheets. */
function Rig({ focus }: { focus: { dir: [number, number, number]; distance: number; key: number } | null }) {
  const { camera, gl } = useThree()
  const controls = useRef<OrbitControls | null>(null)
  const target = useRef<THREE.Vector3 | null>(null)
  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement)
    c.enablePan = false
    c.enableDamping = true
    c.dampingFactor = 0.08
    c.rotateSpeed = 0.45
    c.minDistance = 1.25
    c.maxDistance = 8
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
  const key = focus?.key ?? 0
  useEffect(() => {
    if (!focus || !key) return
    target.current = new THREE.Vector3(...focus.dir).multiplyScalar(focus.distance)
    // only a new focus request (a new key) moves the camera; dragging must not be fought
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  useFrame(() => {
    const t = target.current
    if (t) {
      camera.position.lerp(t, 0.12)
      if (camera.position.distanceTo(t) < 1e-3) target.current = null
    }
    controls.current?.update()
  })
  return null
}

export const summarize = (m: ModelState): ModelSummary =>
  m.kind === 'model'
    ? { kind: 'model', url: m.url, triangles: m.triangles }
    : m.kind === 'sphere'
      ? { kind: 'sphere', reason: m.reason, textured: !!m.texture }
      : { kind: 'loading' }

export interface GlobeSceneProps {
  /** unit vector to the Sun in the scene frame, or null while the ephemeris loads */
  sunDir: [number, number, number] | null
  sites: Site[]
  selectedId: string | null
  pick: { lat: number; lon: number } | null
  onPick: (lat: number, lon: number) => void
  onPickSite: (id: string) => void
  showOrientation: boolean
  frame: ModelFrame
  spin: number
  onModel: (m: ModelSummary) => void
  focus: { dir: [number, number, number]; distance: number; key: number } | null
}

const TAP_PX = 8
const TAP_MS = 600

export default function GlobeScene({ sunDir, sites, selectedId, pick, onPick, onPickSite, showOrientation, frame, spin, onModel, focus }: GlobeSceneProps) {
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
    onPick(lat, lon)
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
        {/* the Moon has no air: almost nothing lights the night side */}
        <ambientLight intensity={0.07} color="#9fb0c8" />
        <directionalLight position={[sun[0] * 12, sun[1] * 12, sun[2] * 12]} intensity={3.0} />
        {model.kind === 'model' ? (
          <ModelGlobe object={model.object} frame={frame} spin={spin} onTap={onTap} />
        ) : model.kind === 'sphere' ? (
          <SphereGlobe texture={model.texture} onTap={onTap} />
        ) : null}
        {sites.map((s) =>
          s.lat === null || s.lon === null ? null : (
            <Marker
              key={s.id}
              at={pointFromLatLon(s.lat, s.lon, s.elevation_m ?? 0, 0.006)}
              color={s.id === selectedId ? '#ffd166' : '#7fb0f0'}
              radius={s.id === selectedId ? 0.016 : 0.011}
              onPick={() => onPickSite(s.id)}
            />
          ),
        )}
        {showOrientation &&
          ORIENTATION_MARKERS.map((m, i) => (
            <Marker key={m.label} at={pointFromLatLon(m.lat, m.lon, 0, 0.004)} color={['#6ee7a8', '#ff8fd0', '#ffe066'][i]} radius={0.02} />
          ))}
        {pick && <Pin lat={pick.lat} lon={pick.lon} />}
        <Rig focus={focus} />
      </Canvas>
    </div>
  )
}
