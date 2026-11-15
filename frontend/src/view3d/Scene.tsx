// 3D scene. Axes (docs/ARCHITECTURE.md): x = east, y = up, z = south. Units: metres.
// Terrain: n x n heights, row 0 = north edge. Sun and Earth sit on a sky sphere in their true
// directions; their discs have the true angular size unless `enlarge` > 1.

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Horizon, Sky, Terrain } from '../api'
import { dirFromAzEl } from '../api'
import { litCells } from './terrainShadow'
import { useTerrainHorizons } from './useTerrainHorizons'

const SKY_R = 60_000
const DPR: [number, number] = typeof window !== 'undefined' && window.innerWidth < 700 ? [1, 1.5] : [1, 1.75]
const FAR_R = 30_000

const SMALL_SCREEN = typeof window !== 'undefined' && window.innerWidth < 700

function useTerrainGeometry(terrain: Terrain) {
  return useMemo(() => {
    const { n, size_m } = terrain.meta
    // phones: every second sample (512 -> 256), a quarter of the vertices, same look at that size
    const k = SMALL_SCREEN && n > 300 ? 2 : 1
    const m = Math.floor((n - 1) / k) + 1
    const g = new THREE.PlaneGeometry(((m - 1) * k * size_m) / (n - 1), ((m - 1) * k * size_m) / (n - 1), m - 1, m - 1)
    g.rotateX(-Math.PI / 2) // plane rows: first row (top) -> z = -size/2 = north
    const pos = g.attributes.position as THREE.BufferAttribute
    for (let r = 0; r < m; r++) for (let c = 0; c < m; c++) pos.setY(r * m + c, terrain.heights[r * k * n + c * k])
    pos.needsUpdate = true
    g.computeVertexNormals()
    return g
  }, [terrain])
}

/** Mean height along the tile border: where the far ground ring starts. */
export function edgeHeight(terrain: Terrain): number {
  const { n } = terrain.meta
  const h = terrain.heights
  let sum = 0
  for (let i = 0; i < n; i++) sum += h[i] + h[(n - 1) * n + i] + h[i * n] + h[i * n + n - 1]
  return sum / (4 * n)
}

/** Height at the tile centre (the site), metres. */
export function centreHeight(terrain: Terrain): number {
  const { n } = terrain.meta
  const h = terrain.heights
  if (n % 2 === 1) {
    const c = (n - 1) / 2
    return h[c * n + c]
  }
  const a = n / 2 - 1
  const b = n / 2
  return (h[a * n + a] + h[a * n + b] + h[b * n + a] + h[b * n + b]) / 4
}

const terrainVert = /* glsl */ `
varying vec3 vN;
varying vec2 vUv;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

// Lit share of the Sun's disc per cell comes from litMap (terrain horizons, terrainShadow.ts); the slope
// only sets how bright a lit cell is. A weak fill keeps the shape readable inside the shadows.
const terrainFrag = /* glsl */ `
uniform sampler2D litMap;
uniform vec3 sunDir;
uniform float ready;
varying vec3 vN;
varying vec2 vUv;
void main() {
  vec3 n = normalize(vN);
  float lit = mix(1.0, texture2D(litMap, vUv).r, ready);
  // the Sun is 1-2 degrees up: flat ground gets dot 0.03, so the slope term is scaled up like an exposure
  float direct = lit * clamp(max(dot(n, sunDir), 0.0) * 6.0, 0.0, 0.95);
  // fill from the side opposite the Sun (light reflected by lit slopes): keeps the form inside shadows
  vec3 back = normalize(vec3(-sunDir.x, 0.6, -sunDir.z));
  float fill = 0.035 + 0.075 * clamp(dot(n, back), 0.0, 1.0);
  gl_FragColor = vec4(vec3(0.62, 0.63, 0.65) * (fill + direct), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

function TerrainMesh({ terrain, sky, mask }: { terrain: Terrain; sky: Sky; mask: number[] | null }) {
  const geo = useTerrainGeometry(terrain)
  const hz = useTerrainHorizons(terrain)
  const tex = useMemo(() => {
    const g = hz?.g ?? 1
    const t = new THREE.DataTexture(new Uint8Array(g * g).fill(255), g, g, THREE.RedFormat, THREE.UnsignedByteType)
    t.magFilter = THREE.LinearFilter
    t.minFilter = THREE.LinearFilter
    t.needsUpdate = true
    return t
  }, [hz])
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: terrainVert,
        fragmentShader: terrainFrag,
        uniforms: { litMap: { value: null }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, ready: { value: 0 } },
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  useEffect(() => () => tex.dispose(), [tex])
  // every time step: only the lit share per cell is recomputed (about 1 ms), the horizons stay
  useEffect(() => {
    if (hz) {
      litCells(hz, mask, sky.sun.az, sky.sun.el, sky.sun.angular_radius_deg, tex.image.data as Uint8Array)
      tex.needsUpdate = true
    }
    mat.uniforms.litMap.value = tex
    mat.uniforms.ready.value = hz ? 1 : 0
    mat.uniforms.sunDir.value.set(...sky.sun.dir)
  }, [hz, tex, mat, mask, sky.sun.az, sky.sun.el, sky.sun.angular_radius_deg, sky.sun.dir])
  return <mesh geometry={geo} material={mat} />
}

/** Far terrain from the horizon mask: a ring "wall" at FAR_R whose top matches the mask angle. */
function FarHorizon({ horizon, eyeY }: { horizon: Horizon; eyeY: number }) {
  const geo = useMemo(() => {
    const n = horizon.elevation_deg.length
    const pos: number[] = []
    const idx: number[] = []
    for (let i = 0; i <= n; i++) {
      const az = (i % n) * horizon.step_deg
      const el = horizon.elevation_deg[i % n]
      const [dx, , dz] = dirFromAzEl(az, 0)
      const top = eyeY + FAR_R * Math.tan((el * Math.PI) / 180)
      pos.push(dx * FAR_R, Math.min(top, eyeY) - 8000, dz * FAR_R, dx * FAR_R, top, dz * FAR_R)
      if (i < n) {
        const a = i * 2
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    return g
  }, [horizon, eyeY])
  return (
    <mesh geometry={geo}>
      <meshBasicMaterial color="#3a3d41" side={THREE.DoubleSide} />
    </mesh>
  )
}

function Stars() {
  const geo = useMemo(() => {
    let s = 7
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
    const p: number[] = []
    for (let i = 0; i < 1800; i++) {
      const u = rnd() * 2 - 1
      const t = rnd() * Math.PI * 2
      const r = Math.sqrt(1 - u * u)
      p.push(r * Math.cos(t) * SKY_R * 1.2, u * SKY_R * 1.2, r * Math.sin(t) * SKY_R * 1.2)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
    return g
  }, [])
  return (
    <points geometry={geo}>
      <pointsMaterial color="#d9dde8" size={1.4} sizeAttenuation={false} transparent opacity={0.75} />
    </points>
  )
}

/** Sun, Earth and stars ride with the camera: they are effectively at infinity, so their
 * direction is the same from any viewpoint (no fake parallax against the terrain). */
function SkyDome({ sky, enlarge }: { sky: Sky; enlarge: number }) {
  const group = useRef<THREE.Group>(null)
  useFrame(({ camera }) => group.current?.position.copy(camera.position))
  const s = new THREE.Vector3(...sky.sun.dir).multiplyScalar(SKY_R)
  const e = new THREE.Vector3(...sky.earth.dir).multiplyScalar(SKY_R)
  const rs = SKY_R * Math.tan((sky.sun.angular_radius_deg * enlarge * Math.PI) / 180)
  const re = SKY_R * Math.tan((sky.earth.angular_radius_deg * enlarge * Math.PI) / 180)
  return (
    <group ref={group}>
      <Stars />
      <mesh position={s}>
        <sphereGeometry args={[rs, 32, 16]} />
        <meshBasicMaterial color="#fff4d6" />
      </mesh>
      <sprite position={s} scale={[rs * 9, rs * 9, 1]}>
        <spriteMaterial map={glowTexture()} color="#ffcf7a" transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      <mesh position={e}>
        <sphereGeometry args={[re, 48, 24]} />
        <meshStandardMaterial color="#5b8fd9" emissive="#0d1a2e" roughness={0.6} />
      </mesh>
      <Label text="Sun" color="#f2b84b" position={s} offsetY={0.9} />
      <Label text="Earth" color="#7fb0f0" position={e} offsetY={0.9} />
    </group>
  )
}

const labelCache = new Map<string, THREE.Texture>()
function labelTexture(text: string, color: string) {
  const key = text + color
  let t = labelCache.get(key)
  if (!t) {
    const c = document.createElement('canvas')
    c.width = 256
    c.height = 64
    const g = c.getContext('2d')!
    g.font = '600 34px Inter, system-ui, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.lineWidth = 8
    g.strokeStyle = 'rgba(5,6,10,0.85)'
    g.strokeText(text, 128, 32)
    g.fillStyle = color
    g.fillText(text, 128, 32)
    t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    labelCache.set(key, t)
  }
  return t
}

/** Sprite size is relative to the lens; keep labels the same size on screen for the narrow eye-level lens. */
let labelK = 1
export function setLabelScale(fovDeg: number) {
  labelK = Math.tan((fovDeg * Math.PI) / 360) / Math.tan((55 * Math.PI) / 360)
}

/** Text that always faces the camera and keeps a constant size on screen. */
function Label({ text, color, position, offsetY = 0 }: { text: string; color: string; position: THREE.Vector3 | [number, number, number]; offsetY?: number }) {
  return (
    <sprite position={position} scale={[0.15 * labelK, 0.0375 * labelK, 1]} center={new THREE.Vector2(0.5, -offsetY)} renderOrder={10}>
      <spriteMaterial map={labelTexture(text, color)} transparent depthTest={false} depthWrite={false} sizeAttenuation={false} />
    </sprite>
  )
}

let glow: THREE.Texture | null = null
function glowTexture() {
  if (glow) return glow
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.15, 'rgba(255,220,150,0.6)')
  grad.addColorStop(1, 'rgba(255,200,120,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  glow = new THREE.CanvasTexture(c)
  return glow
}

function SunLight({ sky, eyeY }: { sky: Sky; eyeY: number }) {
  const ref = useRef<THREE.DirectionalLight>(null)
  const target = useMemo(() => new THREE.Object3D(), [])
  const d = new THREE.Vector3(...sky.sun.dir)
  const pos = d.clone().multiplyScalar(20_000).add(new THREE.Vector3(0, eyeY, 0))
  useEffect(() => {
    if (ref.current) ref.current.target = target
  }, [target])
  return (
    <>
      <primitive object={target} position={[0, eyeY, 0]} />
      <directionalLight ref={ref} position={pos} intensity={3.2} />
    </>
  )
}

function Compass({ eyeY }: { eyeY: number }) {
  const r = 5200
  const items: [string, number][] = [['N', 0], ['E', 90], ['S', 180], ['W', 270]]
  return (
    <>
      {items.map(([l, az]) => {
        const [x, , z] = dirFromAzEl(az, 0)
        return <Label key={l} text={l} color="#c9c6bf" position={[x * r, eyeY + 40, z * r]} />
      })}
    </>
  )
}

export type CameraMode = 'site' | 'overview'

const EYE_FOV = 20
const ABOVE_FOV = 55

function CameraRig({
  mode,
  eyeY,
  lookDir,
  resetKey,
}: {
  mode: CameraMode
  eyeY: number
  lookDir: [number, number, number]
  resetKey: string
}) {
  const { camera, gl } = useThree()
  const controls = useRef<OrbitControls | null>(null)
  const latestLook = useRef(lookDir)
  latestLook.current = lookDir
  const eyeRef = useRef(eyeY)
  const modeRef = useRef(mode)
  modeRef.current = mode
  // Created in an effect so StrictMode's test unmount/remount reconnects the listeners.
  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement)
    controls.current = c
    // The wheel scrolls the page; Ctrl + wheel zooms (lens in eye-level view, distance from above).
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) {
        c.enableZoom = false
        return
      }
      e.preventDefault()
      if (modeRef.current === 'site') {
        const cam = camera as THREE.PerspectiveCamera
        cam.fov = Math.min(60, Math.max(6, cam.fov * (e.deltaY > 0 ? 1.1 : 1 / 1.1)))
        cam.updateProjectionMatrix()
        c.enableZoom = false
      } else c.enableZoom = true
    }
    gl.domElement.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => {
      gl.domElement.removeEventListener('wheel', onWheel, { capture: true })
      c.dispose()
      controls.current = null
    }
  }, [camera, gl])

  useFrame(() => controls.current?.update())

  // 1) The eye height changed (relief 1x/3x, other site): shift camera and target
  // by the difference, so the viewing angle and zoom are kept.
  // Must stay ABOVE the reset effect: on a site change both run, and the reset reads eyeRef.
  useEffect(() => {
    const c = controls.current
    const dy = eyeY - eyeRef.current
    eyeRef.current = eyeY
    if (!c || dy === 0) return
    camera.position.y += dy
    c.target.y += dy
  }, [camera, eyeY])

  // 2) Reset the camera only when the mode, the target body or the site changes.
  useEffect(() => {
    const c = controls.current
    if (!c) return
    const eye = eyeRef.current
    const d = latestLook.current
    const cam = camera as THREE.PerspectiveCamera
    c.enablePan = mode === 'overview'
    c.rotateSpeed = mode === 'site' ? -0.25 : 0.6
    c.maxPolarAngle = mode === 'overview' ? Math.PI / 2.05 : Math.PI
    const az = Math.atan2(d[0], -d[2])
    const el = Math.asin(Math.max(-1, Math.min(1, d[1])))
    if (mode === 'site') {
      // look along the body's azimuth, a little above it, so the horizon sits in the lower part of the frame
      const look = Math.min(Math.max(el, -0.05), 0.1) + (3 * Math.PI) / 180
      const dir = new THREE.Vector3(Math.cos(look) * Math.sin(az), Math.sin(look), -Math.cos(look) * Math.cos(az))
      camera.position.set(0, eye, 0)
      c.target.set(dir.x * 0.01, eye + dir.y * 0.01, dir.z * 0.01)
      cam.fov = EYE_FOV
      c.minDistance = 0.005
      c.maxDistance = 0.02
      c.enableZoom = false
    } else {
      camera.position.set(-Math.sin(az) * 6000, eye + 1800, Math.cos(az) * 6000)
      c.target.set(0, eye, 0)
      cam.fov = ABOVE_FOV
      c.minDistance = 500
      c.maxDistance = 20_000
      c.enableZoom = true
    }
    cam.updateProjectionMatrix()
    c.update()
  }, [camera, mode, resetKey])
  return null
}

export interface OverlayRefs {
  ladder: React.RefObject<HTMLDivElement | null>
  az: React.RefObject<HTMLDivElement | null>
}

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const azName = (a: number) => `${DIRS[Math.round((((a % 360) + 360) % 360) / 45) % 8]} ${Math.round(((a % 360) + 360) % 360)}°`

/** Writes the elevation ladder and the azimuths at the frame edges into DOM overlays, every frame, without React renders. */
function OverlayWriter({ refs, show }: { refs: OverlayRefs; show: boolean }) {
  const v = useMemo(() => new THREE.Vector3(), [])
  const fwd = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera, size }) => {
    const lad = refs.ladder.current
    const azr = refs.az.current
    if (!lad || !azr) return
    lad.style.display = show ? 'block' : 'none'
    azr.style.display = show ? 'block' : 'none'
    if (!show) return
    camera.getWorldDirection(fwd)
    const yaw = Math.atan2(fwd.x, -fwd.z)
    const spans = lad.children
    for (let k = 0; k < spans.length; k++) {
      const e = (Number((spans[k] as HTMLElement).dataset.el) * Math.PI) / 180
      v.set(Math.cos(e) * Math.sin(yaw), Math.sin(e), -Math.cos(e) * Math.cos(yaw)).multiplyScalar(1000)
      v.add(camera.position)
      v.project(camera)
      const y = ((1 - v.y) / 2) * size.height
      const el = spans[k] as HTMLElement
      el.style.top = `${y}px`
      el.style.visibility = v.z < 1 && y > 8 && y < size.height - 30 ? 'visible' : 'hidden'
    }
    const cam = camera as THREE.PerspectiveCamera
    const hfov = 2 * Math.atan(Math.tan((cam.fov * Math.PI) / 360) * cam.aspect)
    const yawDeg = (yaw * 180) / Math.PI
    const half = (hfov * 180) / Math.PI / 2
    const labels = azr.children
    const vals = [yawDeg - half, yawDeg, yawDeg + half]
    for (let k = 0; k < labels.length && k < 3; k++) (labels[k] as HTMLElement).textContent = azName(vals[k])
  })
  return null
}

export function Scene(props: Parameters<typeof SceneInner>[0]) {
  setLabelScale(props.mode === 'site' ? EYE_FOV : ABOVE_FOV)
  return <SceneInner {...props} />
}

function SceneInner({
  terrain,
  horizon,
  sky,
  mode,
  enlarge,
  exaggeration,
  lookDir,
  resetKey,
  overlay,
  eyeM = 2,
}: {
  /** eye (instrument) height above the ground, m */
  eyeM?: number
  overlay?: OverlayRefs
  resetKey: string
  terrain: Terrain
  horizon: Horizon | null
  sky: Sky
  mode: CameraMode
  enlarge: number
  exaggeration: number
  lookDir: [number, number, number]
}) {
  const h0 = centreHeight(terrain) * exaggeration
  const eyeY = h0 + eyeM
  return (
    <div className="canvas-wrap" role="img" aria-label="3D view of the terrain around the site with the Sun and the Earth">
    <Canvas
      dpr={DPR}
      camera={{ fov: EYE_FOV, near: 0.3, far: 250_000 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ scene }) => (scene.background = new THREE.Color('#05060a'))}
    >
      {/* lights for the Earth disc; the terrain has its own shading with shadows cast through the horizons */}
      <ambientLight intensity={0.55} color="#c8ced6" />
      <hemisphereLight args={['#9aa3ad', '#2a2e33', 0.45]} />
      <SunLight sky={sky} eyeY={eyeY} />
      <group scale={[1, exaggeration, 1]}>
        <TerrainMesh terrain={terrain} sky={sky} mask={horizon?.elevation_deg ?? null} />
      </group>
      {horizon && <FarHorizon horizon={horizon} eyeY={eyeY} />}
      <SkyDome sky={sky} enlarge={enlarge} />
      {mode === 'overview' && <Compass eyeY={eyeY} />}
      {mode === 'overview' && (
        <mesh position={[0, eyeY + 140, 0]}>
          <cylinderGeometry args={[25, 25, 300, 12]} />
          <meshBasicMaterial color="#ffb547" />
        </mesh>
      )}
      <CameraRig mode={mode} eyeY={eyeY} lookDir={lookDir} resetKey={resetKey} />
      {overlay && <OverlayWriter refs={overlay} show={mode === 'site'} />}
    </Canvas>
    </div>
  )
}
