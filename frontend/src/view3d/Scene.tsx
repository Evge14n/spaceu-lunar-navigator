// 3D scene. Axes (docs/ARCHITECTURE.md): x = east, y = up, z = south. Units: metres.
// Terrain: n x n heights, row 0 = north edge. Sun and Earth sit on a sky sphere in their true
// directions; their discs have the true angular size unless `enlarge` > 1.

import { Html, OrbitControls } from '@react-three/drei'
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
      pos.push(dx * FAR_R, Math.min(top, eyeY) - 4000, dz * FAR_R, dx * FAR_R, top, dz * FAR_R)
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
      <meshBasicMaterial color="#34322f" side={THREE.DoubleSide} />
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
      <Html position={s} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <span className="sky-tag sun">Sun</span>
      </Html>
      <Html position={e} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <span className="sky-tag earth">Earth</span>
      </Html>
    </>
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
        return (
          <Html key={l} position={[x * r, eyeY + 40, z * r]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
            <span className="compass">{l}</span>
          </Html>
        )
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
  const eyeY = h0 + 2 * Math.max(1, exaggeration === 1 ? 1 : 1)
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ fov: 55, near: 0.3, far: 250_000 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ scene }) => (scene.background = new THREE.Color('#05060a'))}
      aria-label="3D view of the terrain around the site with the Sun and the Earth"
    >
      <ambientLight intensity={0.06} color="#9fb7ff" />
      <hemisphereLight args={['#1a2238', '#000000', 0.12]} />
      <SunLight sky={sky} eyeY={eyeY} />
      <Stars />
      <group scale={[1, exaggeration, 1]}>
        <TerrainMesh terrain={terrain} />
      </group>
      {horizon && <FarHorizon horizon={horizon} eyeY={eyeY} />}
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
