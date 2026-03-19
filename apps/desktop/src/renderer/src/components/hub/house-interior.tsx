import { useRef, useState, useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text, Billboard } from '@react-three/drei'
import * as THREE from 'three'
import { useVillage } from './village-context'
import { GlbModel, COMPUTER_ASSET, type AssetDef } from './hub-assets'

const DESK_ASSET: AssetDef = { file: 'picnic_table.glb', scale: 3.0 }

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

const ROOM_SIZE = 16
const WALL_HEIGHT = 4.5
const HS = ROOM_SIZE / 2
const WT = 0.25
const DOOR_WIDTH = 2.5
const DOOR_HEIGHT = 3.5

/* ------------------------------------------------------------------ */
/*  Fetch board items on demand                                        */
/* ------------------------------------------------------------------ */

interface BoardItem {
  id: string
  kind: 'browser' | 'terminal' | 'agent'
  label: string
}

function useBoardItems(boardId: string): BoardItem[] {
  const [items, setItems] = useState<BoardItem[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const tabs = await window.api.browserTabs.list(boardId)
        const nodes: { id: string; nodeType: string; label: string }[] = await window.api.graphNodes.list(boardId)

        if (cancelled) return

        const result: BoardItem[] = []
        for (const tab of tabs) {
          result.push({ id: tab.id, kind: 'browser', label: tab.title || tab.url || 'Tab' })
        }
        for (const node of nodes) {
          if (node.nodeType === 'terminal') {
            result.push({ id: node.id, kind: 'terminal', label: node.label || 'Terminal' })
          }
        }
        setItems(result)
      } catch {
        // Board may not have tabs/nodes
      }
    }
    load()
    return () => { cancelled = true }
  }, [boardId])

  return items
}

/* ------------------------------------------------------------------ */
/*  Room shell                                                         */
/* ------------------------------------------------------------------ */

function RoomShell() {
  const wallColor = '#e8dcc8'
  const floorColor = '#c4a882'
  const doorGapLeft = -(HS - (HS - DOOR_WIDTH / 2) / 2)
  const doorGapRight = (HS - (HS - DOOR_WIDTH / 2) / 2)
  const sideWidth = (ROOM_SIZE - DOOR_WIDTH) / 2

  return (
    <group>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
        <planeGeometry args={[ROOM_SIZE, ROOM_SIZE]} />
        <meshStandardMaterial color={floorColor} />
      </mesh>

      {/* Ceiling */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, WALL_HEIGHT, 0]}>
        <planeGeometry args={[ROOM_SIZE, ROOM_SIZE]} />
        <meshStandardMaterial color="#f5f0e8" />
      </mesh>

      {/* Back wall */}
      <mesh position={[0, WALL_HEIGHT / 2, -HS]} castShadow receiveShadow>
        <boxGeometry args={[ROOM_SIZE, WALL_HEIGHT, WT]} />
        <meshStandardMaterial color={wallColor} />
      </mesh>

      {/* Left wall */}
      <mesh position={[-HS, WALL_HEIGHT / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[WT, WALL_HEIGHT, ROOM_SIZE]} />
        <meshStandardMaterial color={wallColor} />
      </mesh>

      {/* Right wall */}
      <mesh position={[HS, WALL_HEIGHT / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[WT, WALL_HEIGHT, ROOM_SIZE]} />
        <meshStandardMaterial color={wallColor} />
      </mesh>

      {/* Front wall with door gap */}
      <mesh position={[doorGapLeft, WALL_HEIGHT / 2, HS]} castShadow>
        <boxGeometry args={[sideWidth, WALL_HEIGHT, WT]} />
        <meshStandardMaterial color={wallColor} />
      </mesh>
      <mesh position={[doorGapRight, WALL_HEIGHT / 2, HS]} castShadow>
        <boxGeometry args={[sideWidth, WALL_HEIGHT, WT]} />
        <meshStandardMaterial color={wallColor} />
      </mesh>
      <mesh position={[0, DOOR_HEIGHT + (WALL_HEIGHT - DOOR_HEIGHT) / 2, HS]} castShadow>
        <boxGeometry args={[DOOR_WIDTH, WALL_HEIGHT - DOOR_HEIGHT, WT]} />
        <meshStandardMaterial color={wallColor} />
      </mesh>

      {/* Lights */}
      <pointLight position={[-5, WALL_HEIGHT - 0.5, -5]} intensity={0.6} distance={ROOM_SIZE} color="#fff8ee" />
      <pointLight position={[5, WALL_HEIGHT - 0.5, 5]} intensity={0.6} distance={ROOM_SIZE} color="#fff8ee" />
      <pointLight position={[0, WALL_HEIGHT - 0.5, 0]} intensity={0.4} distance={ROOM_SIZE} color="#fff8ee" />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/*  Exit door indicator                                                */
/* ------------------------------------------------------------------ */

function ExitDoor() {
  const { hoveredId } = useVillage()
  const isHovered = hoveredId === 'exit-door'

  return (
    <group position={[0, 0, HS - 1.5]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <ringGeometry args={[0.8, 1.1, 32]} />
        <meshStandardMaterial
          color={isHovered ? '#44ff88' : '#88aa55'}
          emissive={isHovered ? '#22cc44' : '#000000'}
          emissiveIntensity={isHovered ? 0.8 : 0}
          transparent
          opacity={isHovered ? 0.9 : 0.4}
        />
      </mesh>
      <Billboard position={[0, 3, 0.3]}>
        <Text
          fontSize={0.3}
          color={isHovered ? '#ffffff' : '#999999'}
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.015}
          outlineColor="#000000"
        >
          {isHovered ? '[E] Exit' : 'Exit'}
        </Text>
      </Billboard>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/*  Computer desk (represents a real web tab or terminal)              */
/* ------------------------------------------------------------------ */

interface ComputerDeskProps {
  position: [number, number, number]
  rotation: number
  item: BoardItem
  id: string
}

function ComputerDesk({ position, rotation, item, id }: ComputerDeskProps) {
  const { hoveredId, objectPositions, grabbedObjectId } = useVillage()
  const isHovered = hoveredId === id
  const isGrabbed = grabbedObjectId === id
  const override = objectPositions[id]
  const finalPosition = override?.position ?? position
  const finalRotation = override?.rotation ?? rotation

  return (
    <group position={finalPosition} rotation={[0, finalRotation, 0]}>
      <GlbModel asset={DESK_ASSET} />
      <group position={[0, 1.3, 0]}>
        <GlbModel asset={COMPUTER_ASSET} />
      </group>

      {/* Screen glow indicator */}
      <mesh position={[0, 1.1, -0.3]}>
        <planeGeometry args={[0.5, 0.35]} />
        <meshStandardMaterial
          color={item.kind === 'terminal' ? '#001a00' : '#000d1a'}
          emissive={isGrabbed ? '#ffaa00' : item.kind === 'terminal' ? '#00ff44' : '#4488ff'}
          emissiveIntensity={isGrabbed ? 1.0 : isHovered ? 0.8 : 0.3}
        />
      </mesh>

      {/* Grab indicator ring */}
      {isGrabbed && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
          <ringGeometry args={[1.2, 1.5, 32]} />
          <meshStandardMaterial color="#ffaa00" emissive="#ffaa00" emissiveIntensity={0.5} transparent opacity={0.6} />
        </mesh>
      )}

      <Billboard position={[0, 2.2, 0]}>
        <Text
          fontSize={0.22}
          color={isGrabbed ? '#ffcc44' : isHovered ? '#ffffff' : '#aaaaaa'}
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.012}
          outlineColor="#000000"
          maxWidth={3}
        >
          {isGrabbed ? 'Carrying...' : item.label}
        </Text>
        {isHovered && !isGrabbed && (
          <Text
            position={[0, -0.15, 0]}
            fontSize={0.16}
            color="#aaccff"
            anchorX="center"
            anchorY="top"
          >
            [E] Open · [G] Grab
          </Text>
        )}
        {isGrabbed && (
          <Text
            position={[0, -0.15, 0]}
            fontSize={0.16}
            color="#ffcc44"
            anchorX="center"
            anchorY="top"
          >
            [G] Place
          </Text>
        )}
      </Billboard>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/*  Agent character — walks around the room                            */
/* ------------------------------------------------------------------ */

interface AgentCharacterProps {
  startPosition: [number, number, number]
  label: string
  id: string
  seed: number
}

function AgentCharacter({ startPosition, label, id, seed }: AgentCharacterProps) {
  const { hoveredId } = useVillage()
  const isHovered = hoveredId === id
  const ref = useRef<THREE.Group>(null)

  // Generate a patrol path (random waypoints in the room)
  const waypoints = useMemo(() => {
    const rng = () => {
      seed = (seed * 16807) % 2147483647
      return (seed - 1) / 2147483646
    }
    const pts: THREE.Vector3[] = []
    for (let i = 0; i < 5; i++) {
      pts.push(new THREE.Vector3(
        (rng() - 0.5) * (ROOM_SIZE - 6),
        0,
        (rng() - 0.5) * (ROOM_SIZE - 6)
      ))
    }
    // Add start position as first waypoint
    pts.unshift(new THREE.Vector3(...startPosition))
    return pts
  }, [startPosition, seed])

  const waypointIdx = useRef(0)
  const currentPos = useRef(new THREE.Vector3(...startPosition))
  const walkSpeed = 1.5

  useFrame((state, delta) => {
    if (!ref.current) return

    const target = waypoints[waypointIdx.current]
    const dir = new THREE.Vector3().subVectors(target, currentPos.current)
    const dist = dir.length()

    if (dist < 0.3) {
      // Move to next waypoint
      waypointIdx.current = (waypointIdx.current + 1) % waypoints.length
    } else {
      dir.normalize().multiplyScalar(Math.min(walkSpeed * delta, dist))
      currentPos.current.add(dir)
      // Face walk direction
      ref.current.rotation.y = Math.atan2(dir.x, dir.z)
    }

    ref.current.position.copy(currentPos.current)

    // Bobbing while walking
    const bob = Math.sin(state.clock.elapsedTime * 8) * 0.03
    ref.current.position.y = bob
  })

  const bodyColor = isHovered ? '#4488ff' : '#3366aa'
  const skinColor = isHovered ? '#ffcc88' : '#ffddaa'
  const shirtColor = isHovered ? '#5599ff' : '#446699'

  return (
    <group ref={ref} position={startPosition} scale={1.4}>
      {/* Legs */}
      <mesh position={[-0.1, 0.3, 0]} castShadow>
        <capsuleGeometry args={[0.08, 0.35, 4, 8]} />
        <meshStandardMaterial color="#334455" />
      </mesh>
      <mesh position={[0.1, 0.3, 0]} castShadow>
        <capsuleGeometry args={[0.08, 0.35, 4, 8]} />
        <meshStandardMaterial color="#334455" />
      </mesh>

      {/* Torso */}
      <mesh position={[0, 0.8, 0]} castShadow>
        <capsuleGeometry args={[0.2, 0.4, 8, 16]} />
        <meshStandardMaterial color={shirtColor} />
      </mesh>

      {/* Arms */}
      <mesh position={[-0.28, 0.8, 0]} castShadow>
        <capsuleGeometry args={[0.06, 0.35, 4, 8]} />
        <meshStandardMaterial color={skinColor} />
      </mesh>
      <mesh position={[0.28, 0.8, 0]} castShadow>
        <capsuleGeometry args={[0.06, 0.35, 4, 8]} />
        <meshStandardMaterial color={skinColor} />
      </mesh>

      {/* Head */}
      <mesh position={[0, 1.25, 0]} castShadow>
        <sphereGeometry args={[0.18, 16, 16]} />
        <meshStandardMaterial color={skinColor} />
      </mesh>

      {/* Hair */}
      <mesh position={[0, 1.38, -0.02]} castShadow>
        <sphereGeometry args={[0.16, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#3d2b1f" />
      </mesh>

      {/* Name label */}
      <Billboard position={[0, 1.7, 0]}>
        <Text
          fontSize={0.2}
          color={isHovered ? '#ffffff' : '#cccccc'}
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.012}
          outlineColor="#000000"
        >
          {label}
        </Text>
        {isHovered && (
          <Text
            position={[0, -0.12, 0]}
            fontSize={0.14}
            color="#aaccff"
            anchorX="center"
            anchorY="top"
          >
            [E] Talk
          </Text>
        )}
      </Billboard>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/*  House Interior                                                     */
/* ------------------------------------------------------------------ */

interface HouseInteriorProps {
  boardId: string
}

export function HouseInterior({ boardId }: HouseInteriorProps) {
  const { boards } = useVillage()
  const board = boards.find((b) => b.id === boardId)
  const boardItems = useBoardItems(boardId)

  // Randomly place desks around the room using seeded positions
  const desks = useMemo(() => {
    const result: { item: BoardItem; position: [number, number, number]; rotation: number; id: string }[] = []
    let seed = hashStr(boardId)
    const rng = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
    const margin = 2.5
    const placed: [number, number][] = []

    boardItems.forEach((item) => {
      // Try random positions, avoiding overlap
      for (let attempt = 0; attempt < 20; attempt++) {
        const x = (rng() - 0.5) * (ROOM_SIZE - margin * 2 - 2)
        const z = -HS + margin + rng() * (ROOM_SIZE - margin * 2 - 4) // avoid door area at +Z
        const tooClose = placed.some(([px, pz]) => Math.hypot(x - px, z - pz) < 2.8)
        if (!tooClose) {
          placed.push([x, z])
          const rot = rng() * Math.PI * 2
          result.push({ item, position: [x, 0, z], rotation: rot, id: `desk-${item.id}` })
          break
        }
      }
    })
    return result
  }, [boardItems, boardId])

  return (
    <group>
      <RoomShell />
      <ExitDoor />

      {/* Board title on back wall */}
      <Text
        position={[0, WALL_HEIGHT - 0.5, -HS + 0.3]}
        fontSize={0.6}
        color="#5c3d2e"
        anchorX="center"
        anchorY="top"
        fontWeight="bold"
      >
        {board?.name ?? 'Board'}
      </Text>

      {/* Actual board tab/terminal computers */}
      {desks.map((desk) => (
        <ComputerDesk
          key={desk.id}
          position={desk.position}
          rotation={desk.rotation}
          item={desk.item}
          id={desk.id}
        />
      ))}

      {/* Agent character that patrols the room */}
      <AgentCharacter
        startPosition={[2, 0, 2]}
        label="Assistant"
        id="interior-agent-0"
        seed={42}
      />
    </group>
  )
}
