// 3D scene. Axes (docs/ARCHITECTURE.md): x = east, y = up, z = south. Units: metres.
// Terrain: n x n heights, row 0 = north edge. Sun and Earth sit on a sky sphere in their true
// directions; their discs have the true angular size unless `enlarge` > 1.

import { OrbitControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Horizon, Sky, Terrain } from '../api'
import { dirFromAzEl } from '../api'

const SKY_R = 60_000
const FAR_R = 30_000

function useTerrainGeometry(terrain: Terrain) {
  return useMemo(() => {
    const { n, size_m } = terrain.meta
    const g = new THREE.PlaneGeometry(size_m, size_m, n - 1, n - 1)
    g.rotateX(-Math.PI / 2) // plane rows: first row (top) -> z = -size/2 = north
    const pos = g.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) pos.setY(i, terrain.heights[i])
    pos.needsUpdate = true
    g.computeVertexNormals()
    return g
  }, [terrain])
}

/** Height at the tile centre (the site), metres. */
export function centreHeight(terrain: Terrain): number {
  const { n } = terrain.meta
  const c = Math.floor(n / 2)
  return terrain.heights[c * n + c]
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

function Bodies({ sky, eyeY, enlarge }: { sky: Sky; eyeY: number; enlarge: number }) {
  const s = new THREE.Vector3(...sky.sun.dir).multiplyScalar(SKY_R).add(new THREE.Vector3(0, eyeY, 0))
  const e = new THREE.Vector3(...sky.earth.dir).multiplyScalar(SKY_R).add(new THREE.Vector3(0, eyeY, 0))
  const rs = SKY_R * Math.tan((sky.sun.angular_radius_deg * enlarge * Math.PI) / 180)
  const re = SKY_R * Math.tan((sky.earth.angular_radius_deg * enlarge * Math.PI) / 180)
  return (
    <>
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
    </>
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
        intensity={sky.sun.el > -1 ? 3.2 : 0}
        castShadow
        shadow-mapSize={[2048, 2048]}
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

function CameraRig({ mode, eyeY, lookDir }: { mode: CameraMode; eyeY: number; lookDir: [number, number, number] }) {
  const { camera } = useThree()
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null)
  useEffect(() => {
    const c = controls.current
    if (!c) return
    if (mode === 'site') {
      const target = new THREE.Vector3(lookDir[0], eyeY + lookDir[1], lookDir[2]).multiplyScalar(1)
      target.set(lookDir[0] * 50, eyeY + lookDir[1] * 50, lookDir[2] * 50)
      camera.position.set(-lookDir[0] * 0.5, eyeY - lookDir[1] * 0.5, -lookDir[2] * 0.5)
      c.target.copy(target)
      c.minDistance = 0.1
      c.maxDistance = 200
    } else {
      camera.position.set(-lookDir[0] * 7000, eyeY + 2600, -lookDir[2] * 7000)
      c.target.set(0, eyeY, 0)
      c.minDistance = 500
      c.maxDistance = 20_000
    }
    c.update()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, eyeY, lookDir[0], lookDir[2]])
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={mode === 'overview'}
      rotateSpeed={mode === 'site' ? -0.35 : 0.6}
      maxPolarAngle={mode === 'overview' ? Math.PI / 2.05 : Math.PI}
    />
  )
}

export function Scene({
  terrain,
  horizon,
  sky,
  mode,
  enlarge,
  exaggeration,
  lookDir,
}: {
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
    <Canvas
      shadows="percentage"
      dpr={[1, 2]}
      camera={{ fov: 55, near: 0.3, far: 250_000 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ scene }) => (scene.background = new THREE.Color('#05060a'))}
      aria-label="3D view of the terrain around the site with the Sun and the Earth"
    >
      <ambientLight intensity={0.22} color="#9fb7ff" />
      <hemisphereLight args={['#1a2238', '#000000', 0.12]} />
      <SunLight sky={sky} eyeY={eyeY} />
      <Stars />
      <group scale={[1, exaggeration, 1]}>
        <TerrainMesh terrain={terrain} />
      </group>
      {horizon && <FarHorizon horizon={horizon} eyeY={eyeY} groundY={((terrain.meta.min_h ?? h0) - 3) * exaggeration} />}
      <Bodies sky={sky} eyeY={eyeY} enlarge={enlarge} />
      <Compass eyeY={eyeY} />
      <mesh position={[0, eyeY - 1, 0]}>
        <cylinderGeometry args={[mode === 'overview' ? 40 : 0.05, mode === 'overview' ? 40 : 0.05, mode === 'overview' ? 300 : 2, 12]} />
        <meshBasicMaterial color="#ffb547" />
      </mesh>
      <CameraRig mode={mode} eyeY={eyeY} lookDir={lookDir} />
    </Canvas>
  )
}
