import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text, Billboard } from '@react-three/drei'
import * as THREE from 'three'
import { useVillage } from './village-context'
import { GlbModel, seededRandom, type AssetDef } from './hub-assets'
import type { VillageNeighborhood, VillageHouse } from './village-types'
import type { RoadSegment } from './use-village-layout'
import { FluffyGrass } from './fluffy-grass'

const ARCH_ASSET: AssetDef = { file: 'arch.glb', scale: 5.0 }
const FOUNTAIN_ASSET: AssetDef = { file: 'fountain.glb', scale: 3.5 }

/* ------------------------------------------------------------------ */
/*  Ground                                                             */
/* ------------------------------------------------------------------ */

function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <planeGeometry args={[500, 500]} />
      <meshStandardMaterial color="#3d6b45" />
    </mesh>
  )
}

/* ------------------------------------------------------------------ */
/*  Road segment                                                       */
/* ------------------------------------------------------------------ */

function RoadMesh({ segment }: { segment: RoadSegment }) {
  return (
    <group position={[segment.cx, 0, segment.cz]} rotation={[0, segment.angle, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
        <planeGeometry args={[segment.width, segment.length]} />
        <meshStandardMaterial color="#888070" />
      </mesh>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/*  Cul-de-sac road circle                                             */
/* ------------------------------------------------------------------ */

function CulDeSacCircle({ position }: { position: [number, number, number] }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[position[0], 0.04, position[2]]} receiveShadow>
      <circleGeometry args={[8, 32]} />
      <meshStandardMaterial color="#99897a" />
    </mesh>
  )
}

/* ------------------------------------------------------------------ */
/*  Archway entrance with folder name (non-billboarded)                */
/* ------------------------------------------------------------------ */

function NeighborhoodArch({ archPosition, archRotation, name }: { archPosition: [number, number, number]; archRotation: number; name: string }) {
  // Arch straddles the side street. Side streets run along X axis.
  // The arch GLB model's opening should face along X so people walk through it.
  return (
    <group position={archPosition} rotation={[0, archRotation, 0]}>
      <GlbModel asset={ARCH_ASSET} />
      {/* Text readable when walking along the side street (+X and -X directions) */}
      <Text
        position={[0, 5.2, 0.3]}
        fontSize={0.35}
        color="#3d2b1f"
        anchorX="center"
        anchorY="middle"
        fontWeight="bold"
        outlineWidth={0.02}
        outlineColor="#ffffff"
      >
        {name}
      </Text>
      <Text
        position={[0, 5.2, -0.3]}
        rotation={[0, Math.PI, 0]}
        fontSize={0.35}
        color="#3d2b1f"
        anchorX="center"
        anchorY="middle"
        fontWeight="bold"
        outlineWidth={0.02}
        outlineColor="#ffffff"
      >
        {name}
      </Text>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/*  House exterior with door zone                                      */
/* ------------------------------------------------------------------ */

const DOOR_OFFSET_Z = 5

function HouseExterior({ house }: { house: VillageHouse }) {
  const { hoveredId } = useVillage()
  const isHovered = hoveredId === `door-${house.id}`

  return (
    <group position={house.worldPosition} rotation={[0, house.worldRotation, 0]}>
      <GlbModel asset={house.houseAsset} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, DOOR_OFFSET_Z]}>
        <ringGeometry args={[0.6, 0.9, 32]} />
        <meshStandardMaterial
          color={isHovered ? '#44aaff' : '#aa8855'}
          emissive={isHovered ? '#2266cc' : '#000000'}
          emissiveIntensity={isHovered ? 0.8 : 0}
          transparent
          opacity={isHovered ? 0.9 : 0.4}
        />
      </mesh>

      <Billboard position={[0, 8, 0]}>
        <Text
          fontSize={0.45}
          color="#ffffff"
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.03}
          outlineColor="#000000"
          fontWeight="bold"
        >
          {house.board.name}
        </Text>
      </Billboard>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/*  Neighborhood group                                                 */
/* ------------------------------------------------------------------ */

function Neighborhood({ data }: { data: VillageNeighborhood }) {
  return (
    <group>
      <CulDeSacCircle position={data.position} />

      {/* Fountain in the center of the cul-de-sac */}
      <GlbModel asset={FOUNTAIN_ASSET} position={data.position} />

      {/* Archway at the main road junction */}
      <NeighborhoodArch
        archPosition={data.archPosition}
        archRotation={data.archRotation}
        name={data.folder.name}
      />

      {data.houses.map((h) => (
        <HouseExterior key={h.id} house={h} />
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/*  Meandering road helper (must match use-village-layout.ts)          */
/* ------------------------------------------------------------------ */

function mainRoadX(z: number): number {
  return Math.sin(z * 0.08) * 6 + Math.sin(z * 0.184 + 1.5) * 2.4
}

/* ------------------------------------------------------------------ */
/*  Wandering villager NPC                                             */
/* ------------------------------------------------------------------ */

const NPC_COLORS = [
  { shirt: '#cc4444', pants: '#334455' },
  { shirt: '#44aa44', pants: '#443322' },
  { shirt: '#4466cc', pants: '#333344' },
  { shirt: '#cc8844', pants: '#2a3a2a' },
  { shirt: '#aa44aa', pants: '#3a3a3a' },
  { shirt: '#44aaaa', pants: '#443344' },
  { shirt: '#ddaa33', pants: '#334433' },
  { shirt: '#886644', pants: '#222233' },
]

const SKIN_TONES = ['#ffddaa', '#e8c89a', '#d4a574', '#c49060', '#8d5524']

interface VillagerProps {
  startZ: number
  speed: number
  minZ: number
  maxZ: number
  colorIdx: number
  skinIdx: number
  xOffset: number
}

function Villager({ startZ, speed, minZ, maxZ, colorIdx, skinIdx, xOffset }: VillagerProps) {
  const ref = useRef<THREE.Group>(null)
  const zRef = useRef(startZ)
  const dirRef = useRef(speed > 0 ? 1 : -1)
  const colors = NPC_COLORS[colorIdx % NPC_COLORS.length]
  const skin = SKIN_TONES[skinIdx % SKIN_TONES.length]

  useFrame((state, delta) => {
    if (!ref.current) return
    zRef.current += dirRef.current * Math.abs(speed) * delta
    if (zRef.current > maxZ) { zRef.current = maxZ; dirRef.current = -1 }
    if (zRef.current < minZ) { zRef.current = minZ; dirRef.current = 1 }
    const x = mainRoadX(zRef.current) + xOffset
    ref.current.position.set(x, 0, zRef.current)
    ref.current.rotation.y = dirRef.current > 0 ? 0 : Math.PI
    ref.current.position.y = Math.sin(state.clock.elapsedTime * 6 * Math.abs(speed)) * 0.04
  })

  return (
    <group ref={ref} position={[mainRoadX(startZ) + xOffset, 0, startZ]} scale={1.4}>
      <mesh position={[-0.08, 0.28, 0]} castShadow>
        <capsuleGeometry args={[0.06, 0.3, 4, 8]} />
        <meshStandardMaterial color={colors.pants} />
      </mesh>
      <mesh position={[0.08, 0.28, 0]} castShadow>
        <capsuleGeometry args={[0.06, 0.3, 4, 8]} />
        <meshStandardMaterial color={colors.pants} />
      </mesh>
      <mesh position={[0, 0.72, 0]} castShadow>
        <capsuleGeometry args={[0.16, 0.32, 8, 16]} />
        <meshStandardMaterial color={colors.shirt} />
      </mesh>
      <mesh position={[-0.24, 0.72, 0]} castShadow>
        <capsuleGeometry args={[0.05, 0.28, 4, 8]} />
        <meshStandardMaterial color={skin} />
      </mesh>
      <mesh position={[0.24, 0.72, 0]} castShadow>
        <capsuleGeometry args={[0.05, 0.28, 4, 8]} />
        <meshStandardMaterial color={skin} />
      </mesh>
      <mesh position={[0, 1.1, 0]} castShadow>
        <sphereGeometry args={[0.14, 16, 16]} />
        <meshStandardMaterial color={skin} />
      </mesh>
      <mesh position={[0, 1.2, -0.02]} castShadow>
        <sphereGeometry args={[0.12, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#3d2b1f" />
      </mesh>
    </group>
  )
}

function VillagerCrowd({ minZ, maxZ }: { minZ: number; maxZ: number }) {
  const villagers = useMemo(() => {
    const rng = seededRandom(777)
    const count = Math.max(6, Math.min(20, Math.floor((maxZ - minZ) / 15)))
    const result: VillagerProps[] = []
    for (let i = 0; i < count; i++) {
      result.push({
        startZ: minZ + rng() * (maxZ - minZ),
        speed: 1.5 + rng() * 2,
        minZ: minZ + 5,
        maxZ: maxZ - 5,
        colorIdx: Math.floor(rng() * NPC_COLORS.length),
        skinIdx: Math.floor(rng() * SKIN_TONES.length),
        xOffset: (rng() - 0.5) * 3,
      })
    }
    return result
  }, [minZ, maxZ])

  return (
    <>
      {villagers.map((v, i) => (
        <Villager key={`npc-${i}`} {...v} />
      ))}
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  Full outdoor world                                                 */
/* ------------------------------------------------------------------ */

export function VillageWorld() {
  const { neighborhoods, scenery, roads } = useVillage()

  const roadExtents = useMemo(() => {
    if (roads.length === 0) return { minZ: -20, maxZ: 20 }
    let minZ = Infinity, maxZ = -Infinity
    for (const r of roads) {
      minZ = Math.min(minZ, r.cz - r.length / 2)
      maxZ = Math.max(maxZ, r.cz + r.length / 2)
    }
    return { minZ, maxZ }
  }, [roads])

  return (
    <>
      <Ground />
      <FluffyGrass />

      {roads.map((seg, i) => (
        <RoadMesh key={`road-${i}`} segment={seg} />
      ))}

      <VillagerCrowd minZ={roadExtents.minZ} maxZ={roadExtents.maxZ} />

      {neighborhoods.map((n) => (
        <Neighborhood key={n.id} data={n} />
      ))}

      {scenery.map((prop, i) => (
        <GlbModel
          key={`scenery-${i}`}
          asset={prop.asset}
          position={prop.position}
          rotation={prop.rotation}
        />
      ))}
    </>
  )
}
