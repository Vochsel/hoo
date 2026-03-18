import { Suspense, useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Text, Sky, ContactShadows } from '@react-three/drei'
import * as THREE from 'three'
import type { WorkspaceFolder, WorkspaceBoard } from '@/hooks/use-workspace'
import {
  GlbModel, HOUSE_ASSETS, TREE_ASSETS, OUTDOOR_PROPS, SMALL_PROPS,
  seededRandom, pickAsset, type AssetDef
} from './hub-assets'

/* ------------------------------------------------------------------ */
/*  Types & Constants                                                  */
/* ------------------------------------------------------------------ */

interface HouseData {
  folder: WorkspaceFolder
  boards: WorkspaceBoard[]
  position: [number, number, number]
  houseAsset: AssetDef
}

interface PersonWorldPos {
  boardId: string
  worldPos: THREE.Vector3
}

interface SceneProp {
  asset: AssetDef
  position: [number, number, number]
  rotation: [number, number, number]
}

const MOVE_SPEED = 8
const LOOK_SPEED = 0.002
const HOUSE_SPACING = 18
const HOUSES_PER_ROW = 4
const PERSON_RADIUS = 0.3
const PERSON_HEIGHT = 1.6
const INTERACTION_DISTANCE = 3.5
const PLAYER_HEIGHT = 1.7
const PERSON_SPREAD = 4

/* ------------------------------------------------------------------ */
/*  Ground & Road                                                      */
/* ------------------------------------------------------------------ */

function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <planeGeometry args={[300, 300]} />
      <meshStandardMaterial color="#4a7c59" />
    </mesh>
  )
}

function Road({ houseCount }: { houseCount: number }) {
  const cols = Math.min(houseCount, HOUSES_PER_ROW)
  const roadLength = Math.max(cols * HOUSE_SPACING, 20)

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[((cols - 1) * HOUSE_SPACING) / 2, 0.02, 6]}>
      <planeGeometry args={[roadLength + 12, 5]} />
      <meshStandardMaterial color="#888070" />
    </mesh>
  )
}

/* ------------------------------------------------------------------ */
/*  Person (board) - keeps proxy geo for clarity + labels              */
/* ------------------------------------------------------------------ */

interface PersonProps {
  position: [number, number, number]
  board: WorkspaceBoard
  isHighlighted: boolean
  onHover: (boardId: string | null) => void
}

function Person({ position, board, isHighlighted, onHover }: PersonProps) {
  const meshRef = useRef<THREE.Group>(null)

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * 2 + position[0]) * 0.05
    }
  })

  const bodyColor = isHighlighted ? '#4488ff' : '#6699cc'
  const headColor = isHighlighted ? '#ffcc88' : '#ffddaa'

  return (
    <group
      ref={meshRef}
      position={position}
      onPointerOver={(e) => { e.stopPropagation(); onHover(board.id) }}
      onPointerOut={(e) => { e.stopPropagation(); onHover(null) }}
    >
      <mesh position={[0, PERSON_HEIGHT / 2, 0]} castShadow>
        <capsuleGeometry args={[PERSON_RADIUS, PERSON_HEIGHT * 0.4, 8, 16]} />
        <meshStandardMaterial color={bodyColor} />
      </mesh>
      <mesh position={[0, PERSON_HEIGHT * 0.85, 0]} castShadow>
        <sphereGeometry args={[PERSON_RADIUS * 0.8, 16, 16]} />
        <meshStandardMaterial color={headColor} />
      </mesh>
      <Text
        position={[0, PERSON_HEIGHT + 0.4, 0]}
        fontSize={0.25}
        color={isHighlighted ? '#ffffff' : '#dddddd'}
        anchorX="center"
        anchorY="bottom"
        outlineWidth={0.02}
        outlineColor="#000000"
      >
        {board.name}
      </Text>
      {isHighlighted && (
        <Text
          position={[0, PERSON_HEIGHT + 0.7, 0]}
          fontSize={0.18}
          color="#aaccff"
          anchorX="center"
          anchorY="bottom"
        >
          [E] Interact
        </Text>
      )}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/*  House (folder) - GLB model + people in front                       */
/* ------------------------------------------------------------------ */

interface HouseProps {
  data: HouseData
  hoveredBoard: string | null
  onHoverBoard: (boardId: string | null) => void
}

function House({ data, hoveredBoard, onHoverBoard }: HouseProps) {
  const { folder, boards, position, houseAsset } = data

  return (
    <group position={position}>
      <GlbModel asset={houseAsset} />

      {/* Folder name sign above house */}
      <Text
        position={[0, 8, 0]}
        fontSize={0.5}
        color="#ffffff"
        anchorX="center"
        anchorY="bottom"
        outlineWidth={0.03}
        outlineColor="#000000"
        fontWeight="bold"
      >
        {folder.name}
      </Text>

      {/* People (boards) spread in front of house */}
      {boards.map((board, i) => {
        const spread = Math.min(boards.length, 5)
        const px = ((i % spread) - (spread - 1) / 2) * 1.8
        const pz = PERSON_SPREAD + Math.floor(i / spread) * 2
        return (
          <Person
            key={board.id}
            position={[px, 0, pz]}
            board={board}
            isHighlighted={hoveredBoard === board.id}
            onHover={onHoverBoard}
          />
        )
      })}

      <pointLight position={[0, 4, 0]} intensity={0.6} distance={12} color="#fff5e0" />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/*  FPS Camera Controller                                              */
/* ------------------------------------------------------------------ */

interface FPSControllerProps {
  personPositions: PersonWorldPos[]
  onInteract: (boardId: string) => void
}

function FPSController({ personPositions, onInteract }: FPSControllerProps) {
  const { camera, gl } = useThree()
  const keysRef = useRef(new Set<string>())
  const yawRef = useRef(0)
  const pitchRef = useRef(0)
  const isLockedRef = useRef(false)
  const nearestBoardRef = useRef<string | null>(null)
  const velocityYRef = useRef(0)
  const isGroundedRef = useRef(true)

  useEffect(() => {
    camera.position.set(0, PLAYER_HEIGHT, 20)

    const handleKeyDown = (e: KeyboardEvent) => {
      keysRef.current.add(e.code)
      if (e.code === 'Space' && isGroundedRef.current) {
        velocityYRef.current = 6
        isGroundedRef.current = false
      }
      if (e.code === 'KeyE' && isLockedRef.current) {
        if (nearestBoardRef.current) onInteract(nearestBoardRef.current)
        document.exitPointerLock()
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => keysRef.current.delete(e.code)
    const handleMouseMove = (e: MouseEvent) => {
      if (!isLockedRef.current) return
      yawRef.current -= e.movementX * LOOK_SPEED
      pitchRef.current -= e.movementY * LOOK_SPEED
      pitchRef.current = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, pitchRef.current))
    }
    const handlePointerLockChange = () => {
      isLockedRef.current = document.pointerLockElement === gl.domElement
    }
    const handleClick = () => {
      if (!isLockedRef.current) gl.domElement.requestPointerLock()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('pointerlockchange', handlePointerLockChange)
    gl.domElement.addEventListener('click', handleClick)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('pointerlockchange', handlePointerLockChange)
      gl.domElement.removeEventListener('click', handleClick)
      if (document.pointerLockElement === gl.domElement) document.exitPointerLock()
    }
  }, [camera, gl, onInteract])

  useFrame((_, delta) => {
    const keys = keysRef.current
    const forward = new THREE.Vector3(-Math.sin(yawRef.current), 0, -Math.cos(yawRef.current))
    const right = new THREE.Vector3(Math.cos(yawRef.current), 0, -Math.sin(yawRef.current))
    const velocity = new THREE.Vector3()
    if (keys.has('KeyW') || keys.has('ArrowUp')) velocity.add(forward)
    if (keys.has('KeyS') || keys.has('ArrowDown')) velocity.sub(forward)
    if (keys.has('KeyA') || keys.has('ArrowLeft')) velocity.sub(right)
    if (keys.has('KeyD') || keys.has('ArrowRight')) velocity.add(right)
    if (velocity.lengthSq() > 0) {
      velocity.normalize().multiplyScalar(MOVE_SPEED * delta)
      camera.position.add(velocity)
    }
    velocityYRef.current -= 15 * delta
    camera.position.y += velocityYRef.current * delta
    if (camera.position.y <= PLAYER_HEIGHT) {
      camera.position.y = PLAYER_HEIGHT
      velocityYRef.current = 0
      isGroundedRef.current = true
    }
    camera.quaternion.setFromEuler(new THREE.Euler(pitchRef.current, yawRef.current, 0, 'YXZ'))

    let nearest: string | null = null
    let nearestDist = INTERACTION_DISTANCE
    const cam2D = new THREE.Vector2(camera.position.x, camera.position.z)
    for (const pp of personPositions) {
      const d = cam2D.distanceTo(new THREE.Vector2(pp.worldPos.x, pp.worldPos.z))
      if (d < nearestDist) { nearestDist = d; nearest = pp.boardId }
    }
    nearestBoardRef.current = nearest
  })

  return null
}

/* ------------------------------------------------------------------ */
/*  Main FPS View                                                      */
/* ------------------------------------------------------------------ */

interface HubFpsViewProps {
  folders: WorkspaceFolder[]
  boards: WorkspaceBoard[]
  onSelectBoard: (boardId: string) => void
}

export function HubFpsView({ folders, boards, onSelectBoard }: HubFpsViewProps) {
  const [hoveredBoard, setHoveredBoard] = useState<string | null>(null)

  // Build houses with assigned GLB models
  const houses = useMemo(() => {
    const boardsByFolder = new Map<string | null, WorkspaceBoard[]>()
    for (const b of boards) {
      const key = b.folderId ?? null
      if (!boardsByFolder.has(key)) boardsByFolder.set(key, [])
      boardsByFolder.get(key)!.push(b)
    }

    const result: HouseData[] = []
    const sortedFolders = [...folders].sort((a, b) => a.sortOrder - b.sortOrder)
    const ungrouped = boardsByFolder.get(null)
    if (ungrouped && ungrouped.length > 0) {
      result.push({
        folder: { id: '__ungrouped__', name: 'Ungrouped', sortOrder: -1, createdAt: '', updatedAt: '' },
        boards: ungrouped,
        position: [0, 0, 0],
        houseAsset: HOUSE_ASSETS[0]
      })
    }
    for (const folder of sortedFolders) {
      result.push({
        folder,
        boards: boardsByFolder.get(folder.id) ?? [],
        position: [0, 0, 0],
        houseAsset: HOUSE_ASSETS[0]
      })
    }
    // Assign house models and layout
    result.forEach((house, i) => {
      const col = i % HOUSES_PER_ROW
      const row = Math.floor(i / HOUSES_PER_ROW)
      house.position = [col * HOUSE_SPACING, 0, -row * HOUSE_SPACING]
      house.houseAsset = HOUSE_ASSETS[i % HOUSE_ASSETS.length]
    })
    return result
  }, [folders, boards])

  // Person world positions for proximity detection
  const personPositions = useMemo(() => {
    const result: PersonWorldPos[] = []
    for (const house of houses) {
      house.boards.forEach((board, i) => {
        const spread = Math.min(house.boards.length, 5)
        const px = house.position[0] + ((i % spread) - (spread - 1) / 2) * 1.8
        const pz = house.position[2] + PERSON_SPREAD + Math.floor(i / spread) * 2
        result.push({ boardId: board.id, worldPos: new THREE.Vector3(px, 0, pz) })
      })
    }
    return result
  }, [houses])

  // Procedural scene decorations using seeded random
  const sceneProps = useMemo(() => {
    const rng = seededRandom(42)
    const props: SceneProp[] = []
    const cols = Math.min(houses.length, HOUSES_PER_ROW)
    const rows = Math.ceil(houses.length / HOUSES_PER_ROW)
    const extentX = cols * HOUSE_SPACING
    const extentZ = Math.max(rows, 1) * HOUSE_SPACING

    // Trees around the town
    for (let i = 0; i < 30; i++) {
      const x = (rng() - 0.3) * extentX * 1.8
      const z = (rng() - 0.5) * extentZ * 2
      const tooClose = houses.some((h) => {
        return Math.abs(x - h.position[0]) < 7 && Math.abs(z - h.position[2]) < 7
      })
      if (!tooClose) {
        props.push({
          asset: pickAsset(TREE_ASSETS, rng),
          position: [x, 0, z],
          rotation: [0, rng() * Math.PI * 2, 0]
        })
      }
    }

    // Outdoor props near houses
    for (const house of houses) {
      const count = 2 + Math.floor(rng() * 3)
      for (let j = 0; j < count; j++) {
        const ox = house.position[0] + (rng() - 0.5) * 12
        const oz = house.position[2] + (rng() - 0.5) * 10
        props.push({
          asset: pickAsset(OUTDOOR_PROPS, rng),
          position: [ox, 0, oz],
          rotation: [0, rng() * Math.PI * 2, 0]
        })
      }
    }

    // Small decorations (flowers, mushrooms) scattered
    for (let i = 0; i < 40; i++) {
      const x = (rng() - 0.3) * extentX * 1.5
      const z = (rng() - 0.5) * extentZ * 1.5
      props.push({
        asset: pickAsset(SMALL_PROPS, rng),
        position: [x, 0, z],
        rotation: [0, rng() * Math.PI * 2, 0]
      })
    }

    // Streetlights along the road
    const streetlight = OUTDOOR_PROPS.find((p) => p.file === 'streetlight.glb')!
    for (let i = 0; i < cols; i++) {
      props.push({ asset: streetlight, position: [i * HOUSE_SPACING - 4, 0, 6], rotation: [0, 0, 0] })
      props.push({ asset: streetlight, position: [i * HOUSE_SPACING + 4, 0, 6], rotation: [0, Math.PI, 0] })
    }

    return props
  }, [houses])

  const handleInteract = useCallback((boardId: string) => {
    onSelectBoard(boardId)
  }, [onSelectBoard])

  return (
    <div className="relative h-full w-full">
      <Canvas
        shadows
        camera={{ fov: 75, near: 0.1, far: 500 }}
        style={{ background: '#87CEEB' }}
      >
        <Suspense fallback={null}>
          <Sky sunPosition={[100, 20, 100]} />
          <ambientLight intensity={0.35} />
          <directionalLight
            position={[50, 50, 25]}
            intensity={1.2}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-camera-left={-50}
            shadow-camera-right={50}
            shadow-camera-top={50}
            shadow-camera-bottom={-50}
          />
          <hemisphereLight args={['#87CEEB', '#4a7c59', 0.3]} />
          <fog attach="fog" args={['#87CEEB', 60, 180]} />

          <FPSController personPositions={personPositions} onInteract={handleInteract} />
          <Ground />
          <Road houseCount={houses.length} />

          <ContactShadows
            position={[((Math.min(houses.length, HOUSES_PER_ROW) - 1) * HOUSE_SPACING) / 2, 0.01, 0]}
            opacity={0.35}
            scale={120}
            blur={2.5}
            far={15}
          />

          {houses.map((house) => (
            <House
              key={house.folder.id}
              data={house}
              hoveredBoard={hoveredBoard}
              onHoverBoard={setHoveredBoard}
            />
          ))}

          {sceneProps.map((prop, i) => (
            <GlbModel
              key={`prop-${i}`}
              asset={prop.asset}
              position={prop.position}
              rotation={prop.rotation}
            />
          ))}
        </Suspense>
      </Canvas>

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-1 w-1 rounded-full bg-white/60" />
      </div>

      <div className="absolute bottom-4 left-4 rounded-lg bg-black/60 px-4 py-2 text-xs text-white/80 backdrop-blur-sm">
        <p>Click to lock mouse · WASD to move · Space to jump · Mouse to look</p>
        <p>Press <span className="font-bold text-white">E</span> near a person to interact · <span className="font-bold text-white">E</span> also releases mouse</p>
      </div>

      {hoveredBoard && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 rounded-lg bg-black/60 px-4 py-2 text-sm text-white backdrop-blur-sm">
          {boards.find((b) => b.id === hoveredBoard)?.name}
        </div>
      )}
    </div>
  )
}
