import { useRef, useMemo, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useVillage } from './village-context'
import { seededRandom } from './hub-assets'
import type { RoadSegment } from './use-village-layout'
import type { VillageNeighborhood } from './village-types'
import { useHubWorldLighting } from '@/hooks/use-hub-world-lighting'

/* ------------------------------------------------------------------ */
/*  Procedural textures                                                */
/* ------------------------------------------------------------------ */

function createNoiseTexture(size = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const imageData = ctx.createImageData(size, size)
  const rng = seededRandom(42)

  const gridSize = 16
  const grid: number[][] = []
  for (let y = 0; y <= gridSize; y++) {
    grid[y] = []
    for (let x = 0; x <= gridSize; x++) {
      grid[y][x] = rng()
    }
  }

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const gx = (px / size) * gridSize
      const gy = (py / size) * gridSize
      const ix = Math.floor(gx)
      const iy = Math.floor(gy)
      const fx = gx - ix
      const fy = gy - iy
      const sx = fx * fx * (3 - 2 * fx)
      const sy = fy * fy * (3 - 2 * fy)

      const nx = (ix + 1) % (gridSize + 1)
      const ny = (iy + 1) % (gridSize + 1)
      const a = grid[iy][ix]
      const b = grid[iy][nx]
      const c = grid[ny][ix]
      const d = grid[ny][nx]

      const v = Math.floor((a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * 255)
      const idx = (py * size + px) * 4
      imageData.data[idx] = v
      imageData.data[idx + 1] = v
      imageData.data[idx + 2] = v
      imageData.data[idx + 3] = 255
    }
  }

  ctx.putImageData(imageData, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  return tex
}

function createGrassAlphaTexture(size = 128): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const rng = seededRandom(99)

  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, size, size)

  ctx.fillStyle = '#fff'
  const bladeCount = 10
  for (let i = 0; i < bladeCount; i++) {
    const baseX = ((i + 0.5) / bladeCount) * size
    const baseWidth = 3 + rng() * 5
    const height = size * (0.5 + rng() * 0.4)
    const lean = (rng() - 0.5) * 12

    ctx.beginPath()
    ctx.moveTo(baseX - baseWidth / 2, size)
    ctx.lineTo(baseX + lean, size - height)
    ctx.lineTo(baseX + baseWidth / 2, size)
    ctx.closePath()
    ctx.fill()
  }

  return new THREE.CanvasTexture(canvas)
}

/* ------------------------------------------------------------------ */
/*  Grass blade geometry — 3 intersecting quads (star pattern)         */
/* ------------------------------------------------------------------ */

function createGrassGeometry(): THREE.BufferGeometry {
  const h = 1.0
  const w = 0.6
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  for (let i = 0; i < 3; i++) {
    const angle = (i * Math.PI) / 3
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const hw = w / 2
    const base = i * 4

    positions.push(-hw * cos, 0, -hw * sin)
    uvs.push(0, 0)
    positions.push(hw * cos, 0, hw * sin)
    uvs.push(1, 0)
    positions.push(hw * cos, h, hw * sin)
    uvs.push(1, 1)
    positions.push(-hw * cos, h, -hw * sin)
    uvs.push(0, 1)

    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

/* ------------------------------------------------------------------ */
/*  Placement helpers — avoid roads, cul-de-sacs, and houses           */
/* ------------------------------------------------------------------ */

function isOnRoad(x: number, z: number, roads: RoadSegment[], margin = 1.5): boolean {
  for (const seg of roads) {
    const dx = x - seg.cx
    const dz = z - seg.cz
    const cos = Math.cos(-seg.angle)
    const sin = Math.sin(-seg.angle)
    const lx = dx * cos - dz * sin
    const lz = dx * sin + dz * cos
    if (Math.abs(lx) < seg.width / 2 + margin && Math.abs(lz) < seg.length / 2 + margin) return true
  }
  return false
}

function isNearStructure(x: number, z: number, neighborhoods: VillageNeighborhood[]): boolean {
  for (const n of neighborhoods) {
    if (Math.hypot(x - n.position[0], z - n.position[2]) < 10) return true
    for (const h of n.houses) {
      if (Math.hypot(x - h.worldPosition[0], z - h.worldPosition[2]) < 5) return true
    }
  }
  return false
}

/* ------------------------------------------------------------------ */
/*  Shaders                                                            */
/* ------------------------------------------------------------------ */

const grassVertexShader = /* glsl */ `
  uniform float uTime;
  uniform sampler2D uNoiseTexture;
  uniform float uNoiseScale;

  varying vec2 vUv;
  varying vec2 vGlobalUV;
  varying vec3 vNormal;

  #include <fog_pars_vertex>

  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);

    vec4 modelPosition = modelMatrix * instanceMatrix * vec4(position, 1.0);

    float terrainSize = 200.0;
    vGlobalUV = vec2(modelPosition.xz) / terrainSize + 0.5;

    // Wind
    vec2 windDir = normalize(vec2(1.0, 0.7));
    float windStrength = uv.y;
    vec4 noise = texture2D(uNoiseTexture, vGlobalUV + uTime * 0.002);
    float wave = sin(40.0 * dot(windDir, vGlobalUV) + noise.r * 5.0 + uTime * 1.5) * 0.15 * windStrength;

    modelPosition.x += wave;
    modelPosition.z += wave * 0.7;

    // Height variation from noise
    float heightNoise = texture2D(uNoiseTexture, vGlobalUV * uNoiseScale).r;
    modelPosition.y += heightNoise * 0.25 * uv.y;

    vec4 mvPosition = viewMatrix * modelPosition;
    gl_Position = projectionMatrix * mvPosition;

    #include <fog_vertex>
  }
`

const grassFragmentShader = /* glsl */ `
  uniform vec3 uBaseColor;
  uniform vec3 uTipColor1;
  uniform vec3 uTipColor2;
  uniform vec3 uLightDir;
  uniform sampler2D uGrassAlphaTexture;
  uniform sampler2D uNoiseTexture;
  uniform float uNoiseScale;
  uniform float uDaylight;
  uniform float uNightFactor;

  varying vec2 vUv;
  varying vec2 vGlobalUV;
  varying vec3 vNormal;

  #include <fog_pars_fragment>

  void main() {
    float alpha = texture2D(uGrassAlphaTexture, vUv).r;
    if (alpha < 0.1) discard;

    float variation = texture2D(uNoiseTexture, vGlobalUV * uNoiseScale).r;
    vec3 tipColor = mix(uTipColor1, uTipColor2, variation);
    vec3 color = mix(uBaseColor, tipColor, vUv.y);

    // Shift grass toward a cooler, desaturated moonlit palette at night.
    vec3 nightColor = color * vec3(0.34, 0.42, 0.58);
    color = mix(nightColor, color, uDaylight);

    // Approximate the current scene lighting instead of a fixed daytime sun.
    vec3 lightDir = normalize(uLightDir);
    float NdotL = max(dot(vNormal, lightDir), 0.0);
    // Blend front and back face lighting for double-sided grass
    float diffuse = max(NdotL, max(dot(-vNormal, lightDir), 0.0) * 0.6);
    float lighting = mix(0.34, 0.55, uDaylight) + diffuse * mix(0.16, 0.55, uDaylight);
    lighting += vUv.y * uNightFactor * 0.06;

    gl_FragColor = vec4(color * lighting, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

const GRASS_COUNT = 20000

export function FluffyGrass() {
  const { roads, neighborhoods } = useVillage()
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const lighting = useHubWorldLighting()

  const noiseTexture = useMemo(() => createNoiseTexture(), [])
  const grassAlphaTexture = useMemo(() => createGrassAlphaTexture(), [])
  const grassGeometry = useMemo(() => createGrassGeometry(), [])

  const uniforms = useMemo(
    () => ({
      ...THREE.UniformsLib.fog,
      uTime: { value: 0 },
      uNoiseTexture: { value: noiseTexture },
      uGrassAlphaTexture: { value: grassAlphaTexture },
      uBaseColor: { value: new THREE.Color('#3d6b45') },
      uTipColor1: { value: new THREE.Color('#6aad5e') },
      uTipColor2: { value: new THREE.Color('#4a7c59') },
      uLightDir: { value: new THREE.Vector3(0.65, 0.7, 0.3).normalize() },
      uNoiseScale: { value: 1.5 },
      uDaylight: { value: 1 },
      uNightFactor: { value: 0 },
    }),
    [noiseTexture, grassAlphaTexture]
  )

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: grassVertexShader,
        fragmentShader: grassFragmentShader,
        side: THREE.DoubleSide,
        transparent: true,
        fog: true,
      }),
    [uniforms]
  )

  // Scatter grass instances avoiding roads and structures
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return

    const rng = seededRandom(54321)
    const matrix = new THREE.Matrix4()
    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    const scl = new THREE.Vector3()
    const euler = new THREE.Euler()

    // Determine village bounds — keep grass close, don't extend too far out
    let minX = -20, maxX = 20, minZ = -20, maxZ = 20
    for (const n of neighborhoods) {
      for (const h of n.houses) {
        minX = Math.min(minX, h.worldPosition[0] - 10)
        maxX = Math.max(maxX, h.worldPosition[0] + 10)
        minZ = Math.min(minZ, h.worldPosition[2] - 10)
        maxZ = Math.max(maxZ, h.worldPosition[2] + 10)
      }
    }

    let placed = 0
    let attempts = 0
    while (placed < GRASS_COUNT && attempts < GRASS_COUNT * 5) {
      attempts++
      const x = minX + rng() * (maxX - minX)
      const z = minZ + rng() * (maxZ - minZ)

      if (isOnRoad(x, z, roads)) continue
      if (isNearStructure(x, z, neighborhoods)) continue

      pos.set(x, 0, z)
      euler.set(0, rng() * Math.PI * 2, 0)
      quat.setFromEuler(euler)
      const s = 0.5 + rng() * 0.43
      scl.set(s, s + rng() * 0.34, s)
      matrix.compose(pos, quat, scl)
      mesh.setMatrixAt(placed, matrix)
      placed++
    }

    mesh.count = placed
    mesh.instanceMatrix.needsUpdate = true
  }, [roads, neighborhoods])

  // Animate wind
  useFrame((_, delta) => {
    uniforms.uTime.value += delta
  })

  useEffect(() => {
    uniforms.uLightDir.value.set(...lighting.directionalPosition).normalize()
    uniforms.uDaylight.value = lighting.daylightFactor
    uniforms.uNightFactor.value = lighting.nightFactor
  }, [lighting.daylightFactor, lighting.directionalPosition, lighting.nightFactor, uniforms])

  return (
    <instancedMesh
      ref={meshRef}
      args={[grassGeometry, material, GRASS_COUNT]}
      frustumCulled={false}
    />
  )
}
