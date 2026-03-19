import { useRef, useState, useEffect, useMemo } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import { Text, Billboard } from '@react-three/drei'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import * as THREE from 'three'
import { useVillage } from './village-context'
import { GlbModel, type AssetDef } from './hub-assets'

// Desk dimensions (base, scaled by FURNITURE_SCALE on the group)
const FURNITURE_SCALE = 1.35
const DESK_W = 1.6
const DESK_D = 0.8
const DESK_H = 0.82
const DESK_TOP_T = 0.04
const LEG_T = 0.05

const PLANT_ASSETS: AssetDef[] = [
  { file: 'potted_bush.glb', scale: 3.5 },
]

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

const ROOM_SIZE = 24
const WALL_HEIGHT = 5
const HS = ROOM_SIZE / 2
const WT = 0.15
const DOOR_WIDTH = 3
const DOOR_HEIGHT = 3.8
const BASEBOARD_H = 0.25
const TRIM_DEPTH = 0.04

/* ------------------------------------------------------------------ */
/*  Fetch board items on demand                                        */
/* ------------------------------------------------------------------ */

interface BoardItem {
  id: string
  kind: 'browser' | 'terminal' | 'agent'
  label: string
  screenshot?: string | null
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
          result.push({ id: tab.id, kind: 'browser', label: tab.title || tab.url || 'Tab', screenshot: tab.screenshot })
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
/*  Room shell — procedural white modern room                          */
/* ------------------------------------------------------------------ */


function Wall({ position, size }: { position: [number, number, number]; size: [number, number, number] }) {
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color="#f5f2ee" roughness={0.9} metalness={0} />
    </mesh>
  )
}

function Baseboard({ position, size }: { position: [number, number, number]; size: [number, number, number] }) {
  return (
    <mesh position={position}>
      <boxGeometry args={size} />
      <meshStandardMaterial color="#e8e4de" roughness={0.6} metalness={0} />
    </mesh>
  )
}

function CeilingLight({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Fixture disc */}
      <mesh position={[0, -0.02, 0]}>
        <cylinderGeometry args={[0.4, 0.4, 0.04, 24]} />
        <meshStandardMaterial color="#ffffff" roughness={0.3} metalness={0.1} />
      </mesh>
      {/* Glow bulb */}
      <mesh position={[0, -0.08, 0]}>
        <sphereGeometry args={[0.15, 16, 16]} />
        <meshStandardMaterial color="#fffdf5" emissive="#fffdf5" emissiveIntensity={2} />
      </mesh>
      <pointLight position={[0, -0.3, 0]} intensity={1.2} distance={ROOM_SIZE * 0.7} color="#fffaf0" />
    </group>
  )
}

function RoomShell() {
  const floorColor = '#d4c4a8' // light oak
  const ceilingColor = '#faf8f5'
  const sideWidth = (ROOM_SIZE - DOOR_WIDTH) / 2
  const doorGapLeft = -(HS - sideWidth / 2)
  const doorGapRight = (HS - sideWidth / 2)

  return (
    <group>
      {/* ── Floor ── */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0, 0]} receiveShadow>
        <planeGeometry args={[ROOM_SIZE, ROOM_SIZE]} />
        <meshStandardMaterial color={floorColor} roughness={0.55} metalness={0.05} />
      </mesh>

      {/* ── Ceiling ── */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, WALL_HEIGHT, 0]}>
        <planeGeometry args={[ROOM_SIZE, ROOM_SIZE]} />
        <meshStandardMaterial color={ceilingColor} roughness={0.95} metalness={0} />
      </mesh>

      {/* ── Back wall ── */}
      <Wall position={[0, WALL_HEIGHT / 2, -HS]} size={[ROOM_SIZE, WALL_HEIGHT, WT]} />
      <Baseboard position={[0, BASEBOARD_H / 2, -HS + TRIM_DEPTH]} size={[ROOM_SIZE, BASEBOARD_H, TRIM_DEPTH * 2]} />

      {/* ── Left wall ── */}
      <Wall position={[-HS, WALL_HEIGHT / 2, 0]} size={[WT, WALL_HEIGHT, ROOM_SIZE]} />
      <Baseboard position={[-HS + TRIM_DEPTH, BASEBOARD_H / 2, 0]} size={[TRIM_DEPTH * 2, BASEBOARD_H, ROOM_SIZE]} />

      {/* ── Right wall ── */}
      <Wall position={[HS, WALL_HEIGHT / 2, 0]} size={[WT, WALL_HEIGHT, ROOM_SIZE]} />
      <Baseboard position={[HS - TRIM_DEPTH, BASEBOARD_H / 2, 0]} size={[TRIM_DEPTH * 2, BASEBOARD_H, ROOM_SIZE]} />

      {/* ── Front wall with door gap ── */}
      <Wall position={[doorGapLeft, WALL_HEIGHT / 2, HS]} size={[sideWidth, WALL_HEIGHT, WT]} />
      <Wall position={[doorGapRight, WALL_HEIGHT / 2, HS]} size={[sideWidth, WALL_HEIGHT, WT]} />
      <Wall position={[0, DOOR_HEIGHT + (WALL_HEIGHT - DOOR_HEIGHT) / 2, HS]} size={[DOOR_WIDTH, WALL_HEIGHT - DOOR_HEIGHT, WT]} />
      {/* Door frame trim */}
      <Baseboard position={[-DOOR_WIDTH / 2 - 0.06, DOOR_HEIGHT / 2, HS - TRIM_DEPTH]} size={[0.08, DOOR_HEIGHT, TRIM_DEPTH * 3]} />
      <Baseboard position={[DOOR_WIDTH / 2 + 0.06, DOOR_HEIGHT / 2, HS - TRIM_DEPTH]} size={[0.08, DOOR_HEIGHT, TRIM_DEPTH * 3]} />
      <Baseboard position={[0, DOOR_HEIGHT + 0.04, HS - TRIM_DEPTH]} size={[DOOR_WIDTH + 0.2, 0.08, TRIM_DEPTH * 3]} />
      {/* Front baseboards (beside door) */}
      <Baseboard position={[doorGapLeft, BASEBOARD_H / 2, HS - TRIM_DEPTH]} size={[sideWidth, BASEBOARD_H, TRIM_DEPTH * 2]} />
      <Baseboard position={[doorGapRight, BASEBOARD_H / 2, HS - TRIM_DEPTH]} size={[sideWidth, BASEBOARD_H, TRIM_DEPTH * 2]} />

      {/* ── Crown moulding (top trim) ── */}
      <Baseboard position={[0, WALL_HEIGHT - 0.06, -HS + TRIM_DEPTH]} size={[ROOM_SIZE, 0.1, TRIM_DEPTH * 2]} />
      <Baseboard position={[-HS + TRIM_DEPTH, WALL_HEIGHT - 0.06, 0]} size={[TRIM_DEPTH * 2, 0.1, ROOM_SIZE]} />
      <Baseboard position={[HS - TRIM_DEPTH, WALL_HEIGHT - 0.06, 0]} size={[TRIM_DEPTH * 2, 0.1, ROOM_SIZE]} />

      {/* ── Ceiling lights ── */}
      <CeilingLight position={[-5, WALL_HEIGHT, -4]} />
      <CeilingLight position={[5, WALL_HEIGHT, -4]} />
      <CeilingLight position={[0, WALL_HEIGHT, 4]} />

      {/* ── Corner plants ── */}
      <GlbModel asset={PLANT_ASSETS[0]} position={[-HS + 1.5, 0, -HS + 1.5]} rotation={[0, 0.4, 0]} />
      <GlbModel asset={PLANT_ASSETS[0]} position={[HS - 1.5, 0, -HS + 1.5]} rotation={[0, -0.6, 0]} />
      <GlbModel asset={PLANT_ASSETS[0]} position={[-HS + 1.2, 0, HS - 2.5]} rotation={[0, 1.2, 0]} />
      <GlbModel asset={PLANT_ASSETS[0]} position={[HS - 1.2, 0, HS - 2.5]} rotation={[0, -1.0, 0]} />

      {/* ── Wall shelf on back wall ── */}
      <mesh position={[-6, 2.8, -HS + 0.2]} castShadow>
        <boxGeometry args={[3, 0.08, 0.35]} />
        <meshStandardMaterial color="#c9b896" roughness={0.5} metalness={0.05} />
      </mesh>
      <mesh position={[6, 2.8, -HS + 0.2]} castShadow>
        <boxGeometry args={[3, 0.08, 0.35]} />
        <meshStandardMaterial color="#c9b896" roughness={0.5} metalness={0.05} />
      </mesh>
      {/* Small plants on shelves */}
      <GlbModel asset={PLANT_ASSETS[0]} position={[-6.5, 2.84, -HS + 0.2]} scale={1.0} />
      <GlbModel asset={PLANT_ASSETS[0]} position={[5.5, 2.84, -HS + 0.2]} scale={1.0} />

      {/* ── Rug in center ── */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
        <planeGeometry args={[10, 8]} />
        <meshStandardMaterial color="#c8b99a" roughness={0.95} metalness={0} />
      </mesh>
      {/* Rug border */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]} receiveShadow>
        <planeGeometry args={[10.6, 8.6]} />
        <meshStandardMaterial color="#b5a486" roughness={0.95} metalness={0} />
      </mesh>
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
/*  Screenshot texture hook                                            */
/* ------------------------------------------------------------------ */

function useScreenshotTexture(screenshot?: string | null): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(null)

  useEffect(() => {
    if (!screenshot) { setTexture(null); return }
    const img = new Image()
    img.onload = () => {
      const tex = new THREE.Texture(img)
      tex.needsUpdate = true
      tex.colorSpace = THREE.SRGBColorSpace
      tex.minFilter = THREE.LinearFilter
      tex.magFilter = THREE.LinearFilter
      tex.flipY = false
      // UVs are 0,0 to 1,1 — fill width, top-align, clip overflow
      const imgAspect = img.width / img.height
      const screenAspect = 1920 / 1080
      const scaleY = screenAspect / imgAspect
      tex.repeat.set(1, Math.min(1, scaleY))
      tex.offset.set(0, Math.max(0, 1 - Math.min(1, scaleY)))
      tex.wrapS = THREE.ClampToEdgeWrapping
      tex.wrapT = THREE.ClampToEdgeWrapping
      setTexture(tex)
    }
    img.src = screenshot
    return () => { img.onload = null }
  }, [screenshot])

  return texture
}

/* ------------------------------------------------------------------ */
/*  Computer with screenshot on ScreenMaterial                         */
/* ------------------------------------------------------------------ */

const COMPUTER_NEW_PATH = '/hub-assets/computer_new.glb'

function ComputerWithScreen({ item }: { item: BoardItem }) {
  const gltf = useLoader(GLTFLoader, COMPUTER_NEW_PATH)
  const screenshotTex = useScreenshotTexture(item.screenshot)

  const scene = useMemo(() => {
    const cloned = gltf.scene.clone(true)
    cloned.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return
      const mesh = child as THREE.Mesh
      // Check original material name before any conversion
      const origMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
      const matName = origMat?.name ?? ''

      if (matName === 'ScreenMaterial') {
        // Apply screenshot or fallback
        if (screenshotTex) {
          mesh.material = new THREE.MeshBasicMaterial({
            map: screenshotTex,
            toneMapped: false,
          })
        } else {
          mesh.material = new THREE.MeshStandardMaterial({
            color: item.kind === 'terminal' ? '#001a00' : '#000d1a',
            emissive: new THREE.Color(item.kind === 'terminal' ? '#00ff44' : '#4488ff'),
            emissiveIntensity: 0.4,
          })
        }
      } else if (origMat?.type === 'MeshPhysicalMaterial') {
        // Downgrade physical -> standard to avoid Three.js crash
        const phys = origMat as THREE.MeshPhysicalMaterial
        const std = new THREE.MeshStandardMaterial()
        std.name = phys.name
        std.color.copy(phys.color)
        std.map = phys.map
        std.normalMap = phys.normalMap
        std.roughness = phys.roughness
        std.roughnessMap = phys.roughnessMap
        std.metalness = phys.metalness
        std.metalnessMap = phys.metalnessMap
        std.aoMap = phys.aoMap
        std.emissive.copy(phys.emissive)
        std.emissiveMap = phys.emissiveMap
        std.emissiveIntensity = phys.emissiveIntensity
        std.side = phys.side
        std.transparent = phys.transparent
        std.opacity = phys.opacity
        mesh.material = std
      }
      mesh.castShadow = true
      mesh.receiveShadow = true
    })
    // Shift up so bottom of model sits at y=0 (on desk surface)
    const box = new THREE.Box3().setFromObject(cloned)
    cloned.position.y = -box.min.y

    return cloned
  }, [gltf.scene, screenshotTex, item.kind])

  return <primitive object={scene} />
}

/* ------------------------------------------------------------------ */
/*  Procedural desk                                                    */
/* ------------------------------------------------------------------ */

function ProceduralDesk() {
  const topY = DESK_H - DESK_TOP_T / 2
  const legH = DESK_H - DESK_TOP_T
  const legY = legH / 2
  const insetW = DESK_W / 2 - LEG_T / 2 - 0.03
  const insetD = DESK_D / 2 - LEG_T / 2 - 0.03
  const woodColor = '#8b6f4e'
  const topColor = '#f0ebe3'

  return (
    <group>
      {/* Tabletop — white laminate */}
      <mesh position={[0, topY, 0]} castShadow receiveShadow>
        <boxGeometry args={[DESK_W, DESK_TOP_T, DESK_D]} />
        <meshStandardMaterial color={topColor} roughness={0.25} metalness={0.02} />
      </mesh>
      {/* Thin edge band */}
      <mesh position={[0, topY - DESK_TOP_T / 2 - 0.005, 0]}>
        <boxGeometry args={[DESK_W + 0.005, 0.01, DESK_D + 0.005]} />
        <meshStandardMaterial color="#d5cfc5" roughness={0.4} metalness={0.05} />
      </mesh>
      {/* Four straight legs — warm wood */}
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
        <mesh key={i} position={[sx * insetW, legY, sz * insetD]} castShadow>
          <boxGeometry args={[LEG_T, legH, LEG_T]} />
          <meshStandardMaterial color={woodColor} roughness={0.55} metalness={0.0} />
        </mesh>
      ))}
      {/* Cross bar under top for structure */}
      <mesh position={[0, topY - DESK_TOP_T - 0.04, 0]}>
        <boxGeometry args={[DESK_W - 0.15, 0.03, 0.03]} />
        <meshStandardMaterial color={woodColor} roughness={0.55} metalness={0.0} />
      </mesh>
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
      <group scale={[FURNITURE_SCALE, FURNITURE_SCALE, FURNITURE_SCALE]}>
        <ProceduralDesk />
        <group position={[0, DESK_H, 0]}>
          <ComputerWithScreen item={item} />
        </group>
      </group>

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
