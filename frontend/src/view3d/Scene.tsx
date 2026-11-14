// 3D scene. Axes (docs/ARCHITECTURE.md): x = east, y = up, z = south. Units: metres.
// Terrain: n x n heights, row 0 = north edge. Sun and Earth sit on a sky sphere in their true
// directions; their discs have the true angular size unless `enlarge` > 1.

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Horizon, Sky, Terrain } from '../api'
import { dirFromAzEl } from '../api'

const SKY_R = 60_000
// smaller shadow map on phones: same look at that size, far less GPU work
const SHADOW_SIZE: [number, number] =
  typeof window !== 'undefined' && window.innerWidth < 700 ? [1024, 1024] : [2048, 2048]
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

function TerrainMesh({ terrain }: { terrain: Terrain }) {
  const geo = useTerrainGeometry(terrain)
  return (
    <mesh geometry={geo} receiveShadow castShadow>
      <meshStandardMaterial color="#8d8a84" roughness={0.97} metalness={0} />
    </mesh>
  )
}

/** Far terrain from the horizon mask: a ring "wall" at FAR_R whose top matches the mask angle. */
function FarHorizon({ horizon, eyeY, groundY }: { horizon: Horizon; eyeY: number; groundY: number }) {
  const geo = useMemo(() => {
    const n = horizon.elevation_deg.length
    const pos: number[] = []
    const idx: number[] = []
    for (let i = 0; i <= n; i++) {
      const az = (i % n) * horizon.step_deg
      const el = horizon.elevation_deg[i % n]
      const [dx, , dz] = dirFromAzEl(az, 0)
      const top = eyeY + FAR_R * Math.tan((el * Math.PI) / 180)
      pos.push(dx * FAR_R, groundY, dz * FAR_R, dx * FAR_R, Math.max(top, groundY + 1), dz * FAR_R)
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
  }, [horizon, eyeY, groundY])
  return (
    <>
      <mesh geometry={geo}>
        <meshBasicMaterial color="#2c2a27" side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, groundY, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <ringGeometry args={[100, FAR_R, 96]} />
        <meshStandardMaterial color="#45433f" roughness={1} />
      </mesh>
    </>
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

/** Text that always faces the camera and keeps a constant size on screen. */
function Label({ text, color, position, offsetY = 0 }: { text: string; color: string; position: THREE.Vector3 | [number, number, number]; offsetY?: number }) {
  return (
    <sprite position={position} scale={[0.15, 0.0375, 1]} center={new THREE.Vector2(0.5, -offsetY)} renderOrder={10}>
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
      <directionalLight
        ref={ref}
        position={pos}
        intensity={3.2 * sky.sun.visible_fraction}
        castShadow
        shadow-mapSize={SHADOW_SIZE}
        shadow-camera-left={-7000}
        shadow-camera-right={7000}
        shadow-camera-top={7000}
        shadow-camera-bottom={-7000}
        shadow-camera-near={100}
        shadow-camera-far={45_000}
        shadow-bias={-0.0004}
        shadow-normalBias={20}
      />
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
  // Created in an effect so StrictMode's test unmount/remount reconnects the listeners.
  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement)
    controls.current = c
    return () => {
      c.dispose()
      controls.current = null
    }
  }, [camera, gl])
  useFrame(() => controls.current?.update())
  // Move the camera only when the mode, the target body or the site changes, not on every time step.
  useEffect(() => {
    const c = controls.current
    if (!c) return
    const d = latestLook.current
    c.enablePan = mode === 'overview'
    c.rotateSpeed = mode === 'site' ? -0.35 : 0.6
    c.maxPolarAngle = mode === 'overview' ? Math.PI / 2.05 : Math.PI
    if (mode === 'site') {
      c.target.set(d[0] * 50, eyeY + d[1] * 50, d[2] * 50)
      camera.position.set(-d[0] * 0.5, eyeY - d[1] * 0.5, -d[2] * 0.5)
      c.minDistance = 0.1
      c.maxDistance = 200
    } else {
      camera.position.set(-d[0] * 6000, eyeY + 1800, -d[2] * 6000)
      c.target.set(0, eyeY, 0)
      c.minDistance = 500
      c.maxDistance = 20_000
    }
    c.update()
  }, [camera, mode, eyeY, resetKey])
  return null
}

export function Scene({
  terrain,
  horizon,
  sky,
  mode,
  enlarge,
  exaggeration,
  lookDir,
  resetKey,
}: {
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
  const eyeY = h0 + 2
  return (
    <div className="canvas-wrap" role="img" aria-label="3D view of the terrain around the site with the Sun and the Earth">
    <Canvas
      shadows="percentage"
      dpr={DPR}
      camera={{ fov: 55, near: 0.3, far: 250_000 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ scene }) => (scene.background = new THREE.Color('#05060a'))}
    >
      <ambientLight intensity={0.22} color="#9fb7ff" />
      <hemisphereLight args={['#1a2238', '#000000', 0.12]} />
      <SunLight sky={sky} eyeY={eyeY} />
      <group scale={[1, exaggeration, 1]}>
        <TerrainMesh terrain={terrain} />
      </group>
      {horizon && <FarHorizon horizon={horizon} eyeY={eyeY} groundY={(edgeHeight(terrain) - 5) * exaggeration} />}
      <SkyDome sky={sky} enlarge={enlarge} />
      <Compass eyeY={eyeY} />
      {mode === 'overview' && (
        <mesh position={[0, eyeY + 140, 0]}>
          <cylinderGeometry args={[25, 25, 300, 12]} />
          <meshBasicMaterial color="#ffb547" />
        </mesh>
      )}
      <CameraRig mode={mode} eyeY={eyeY} lookDir={lookDir} resetKey={resetKey} />
    </Canvas>
    </div>
  )
}
