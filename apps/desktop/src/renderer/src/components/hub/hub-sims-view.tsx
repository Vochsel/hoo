import { Suspense, useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Text, ContactShadows } from '@react-three/drei'
import * as THREE from 'three'
import type { WorkspaceFolder, WorkspaceBoard } from '@/hooks/use-workspace'
import { useHubWorldLighting } from '@/hooks/use-hub-world-lighting'
import { GlbModel, INDOOR_PROPS, SMALL_PROPS, seededRandom, pickAsset, type AssetDef } from './hub-assets'

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const ROOM_SIZE = 8
const ROOM_GAP = 0.4 // wall thickness
const WALL_HEIGHT = 3
const ROOMS_PER_ROW = 3
const PERSON_RADIUS = 0.25
const PERSON_HEIGHT = 1.2
const PAN_SPEED = 0.02 // greatly reduced from 0.5
const EDGE_PAN_ZONE = 60
const EDGE_PAN_SPEED = 8
const FLOOR_Y = 0.05 // raised to avoid z-fighting with ground

/* ------------------------------------------------------------------ */
/*  Wall & Floor colors                                                */
/* ------------------------------------------------------------------ */

const WALL_COLORS = [
  '#e8dcc8', '#d4c4a8', '#c9b896', '#f0e6d3', '#ddd5c0',
  '#b8c4d0', '#c4d4c0', '#d8c8c8', '#c8c8d8', '#d0d4c4'
]

const FLOOR_COLORS = [
  '#c4a882', '#b89a70', '#d4b892', '#c0a478', '#b8946a',
  '#8b7355', '#a0896b', '#cdb89c', '#bca888', '#d0c0a0'
]

/* ------------------------------------------------------------------ */
/*  Room decorations (GLB-based)                                       */
/* ------------------------------------------------------------------ */

interface RoomDeco {
  asset: AssetDef
  position: [number, number, number]
  rotation: [number, number, number]
}

function getRoomDecorations(roomIndex: number, roomSize: number): RoomDeco[] {
  const rng = seededRandom(roomIndex * 137 + 42)
  const hs = roomSize / 2 - 1.2
  const decos: RoomDeco[] = []

  // 3-5 random indoor props
  const count = 3 + Math.floor(rng() * 3)
  for (let i = 0; i < count; i++) {
    const asset = pickAsset(INDOOR_PROPS, rng)
    const x = (rng() - 0.5) * hs * 2
    const z = (rng() - 0.5) * hs * 2
    decos.push({
      asset,
      position: [x, 0, z],
      rotation: [0, rng() * Math.PI * 2, 0]
    })
  }

  // A small decoration in a corner
  const corner = Math.floor(rng() * 4)
  const cx = corner < 2 ? -hs : hs
  const cz = corner % 2 === 0 ? -hs : hs
  decos.push({
    asset: pickAsset(SMALL_PROPS, rng),
    position: [cx, 0, cz],
    rotation: [0, rng() * Math.PI * 2, 0]
  })

  return decos
}

/* ------------------------------------------------------------------ */
/*  Room wall with optional door                                       */
/* ------------------------------------------------------------------ */

interface WallProps {
  position: [number, number, number]
  size: [number, number, number]
  color: string
  hasDoor?: boolean
  doorSide?: 'center'
  onClick?: () => void
  isSelected?: boolean
}

function Wall({ position, size, color, hasDoor, onClick, isSelected }: WallProps) {
  if (hasDoor) {
    const doorW = 1.5
    const doorH = 2.2
    const wallW = size[0]
    const wallH = size[1]
    const sideW = (wallW - doorW) / 2

    return (
      <group position={position}>
        <mesh position={[-(wallW / 2 - sideW / 2), 0, 0]} onClick={onClick} castShadow receiveShadow>
          <boxGeometry args={[sideW, wallH, size[2]]} />
          <meshStandardMaterial color={isSelected ? '#66aaff' : color} />
        </mesh>
        <mesh position={[(wallW / 2 - sideW / 2), 0, 0]} onClick={onClick} castShadow receiveShadow>
          <boxGeometry args={[sideW, wallH, size[2]]} />
          <meshStandardMaterial color={isSelected ? '#66aaff' : color} />
        </mesh>
        <mesh position={[0, (wallH / 2 - (wallH - doorH) / 4 + doorH / 4), 0]} onClick={onClick} castShadow receiveShadow>
          <boxGeometry args={[doorW, wallH - doorH, size[2]]} />
          <meshStandardMaterial color={isSelected ? '#66aaff' : color} />
        </mesh>
      </group>
    )
  }

  return (
    <mesh position={position} onClick={onClick} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={isSelected ? '#66aaff' : color} />
    </mesh>
  )
}

/* ------------------------------------------------------------------ */
/*  Person in Sims view                                                */
/* ------------------------------------------------------------------ */

interface SimsPersonProps {
  position: [number, number, number]
  board: WorkspaceBoard
  isHighlighted: boolean
  onHover: (id: string | null) => void
  onClick: (id: string) => void
}

function SimsPerson({ position, board, isHighlighted, onHover, onClick }: SimsPersonProps) {
  const ref = useRef<THREE.Group>(null)

  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.y = Math.sin(state.clock.elapsedTime * 1.5 + position[0] * 10) * 0.1
    }
  })

  const bodyColor = isHighlighted ? '#4488ff' : '#6699cc'
  const headColor = isHighlighted ? '#ffcc88' : '#ffddaa'

  return (
    <group
      ref={ref}
      position={position}
      onPointerOver={(e) => { e.stopPropagation(); onHover(board.id) }}
      onPointerOut={(e) => { e.stopPropagation(); onHover(null) }}
      onClick={(e) => { e.stopPropagation(); onClick(board.id) }}
    >
      <mesh position={[0, PERSON_HEIGHT / 2, 0]} castShadow>
        <capsuleGeometry args={[PERSON_RADIUS, PERSON_HEIGHT * 0.35, 8, 16]} />
        <meshStandardMaterial color={bodyColor} />
      </mesh>
      <mesh position={[0, PERSON_HEIGHT * 0.82, 0]} castShadow>
        <sphereGeometry args={[PERSON_RADIUS * 0.7, 16, 16]} />
        <meshStandardMaterial color={headColor} />
      </mesh>
      <Text
        position={[0, PERSON_HEIGHT + 0.3, 0]}
        fontSize={0.22}
        color={isHighlighted ? '#ffffff' : '#cccccc'}
        anchorX="center"
        anchorY="bottom"
        outlineWidth={0.015}
        outlineColor="#000000"
        rotation={[-Math.PI / 4, 0, 0]}
      >
        {board.name}
      </Text>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/*  Room component                                                     */
/* ------------------------------------------------------------------ */

interface RoomData {
  folder: WorkspaceFolder
  boards: WorkspaceBoard[]
  gridX: number
  gridZ: number
}

interface RoomProps {
  data: RoomData
  roomIndex: number
  hoveredBoard: string | null
  selectedWall: string | null
  onHoverBoard: (id: string | null) => void
  onClickBoard: (id: string) => void
  onClickWall: (wallId: string) => void
  wallColors: Record<string, string>
}

function Room({ data, roomIndex, hoveredBoard, selectedWall, onHoverBoard, onClickBoard, onClickWall, wallColors }: RoomProps) {
  const { folder, boards, gridX, gridZ } = data
  const ox = gridX * (ROOM_SIZE + ROOM_GAP)
  const oz = gridZ * (ROOM_SIZE + ROOM_GAP)
  const hs = ROOM_SIZE / 2
  const wh = WALL_HEIGHT / 2
  const wt = ROOM_GAP

  const decos = useMemo(() => getRoomDecorations(roomIndex, ROOM_SIZE), [roomIndex])

  const wallId = (side: string) => `wall-${folder.id}-${side}`
  const getWallColor = (side: string) => wallColors[wallId(side)] ?? WALL_COLORS[roomIndex % WALL_COLORS.length]
  const floorColor = FLOOR_COLORS[roomIndex % FLOOR_COLORS.length]

  return (
    <group position={[ox, 0, oz]}>
      {/* Floor - raised above ground to avoid z-fighting */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]} receiveShadow>
        <planeGeometry args={[ROOM_SIZE, ROOM_SIZE]} />
        <meshStandardMaterial color={floorColor} />
      </mesh>

      <Wall
        position={[0, wh, -hs]}
        size={[ROOM_SIZE, WALL_HEIGHT, wt]}
        color={getWallColor('north')}
        onClick={() => onClickWall(wallId('north'))}
        isSelected={selectedWall === wallId('north')}
      />
      <Wall
        position={[0, wh, hs]}
        size={[ROOM_SIZE, WALL_HEIGHT, wt]}
        color={getWallColor('south')}
        hasDoor
        onClick={() => onClickWall(wallId('south'))}
        isSelected={selectedWall === wallId('south')}
      />
      <Wall
        position={[-hs, wh, 0]}
        size={[wt, WALL_HEIGHT, ROOM_SIZE]}
        color={getWallColor('west')}
        onClick={() => onClickWall(wallId('west'))}
        isSelected={selectedWall === wallId('west')}
      />
      <Wall
        position={[hs, wh, 0]}
        size={[wt, WALL_HEIGHT, ROOM_SIZE]}
        color={getWallColor('east')}
        onClick={() => onClickWall(wallId('east'))}
        isSelected={selectedWall === wallId('east')}
      />

      <Text
        position={[0, FLOOR_Y + 0.01, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.5}
        color="#666666"
        anchorX="center"
        anchorY="middle"
      >
        {folder.name}
      </Text>

      {decos.map((d, i) => (
        <GlbModel key={`deco-${roomIndex}-${i}`} asset={d.asset} position={d.position} rotation={d.rotation} />
      ))}

      {boards.map((board, i) => {
        const angle = (i / Math.max(boards.length, 1)) * Math.PI * 2
        const radius = ROOM_SIZE * 0.25
        const px = Math.cos(angle) * radius
        const pz = Math.sin(angle) * radius
        return (
          <SimsPerson
            key={board.id}
            position={[px, 0, pz]}
            board={board}
            isHighlighted={hoveredBoard === board.id}
            onHover={onHoverBoard}
            onClick={onClickBoard}
          />
        )
      })}

      <pointLight position={[0, WALL_HEIGHT - 0.3, 0]} intensity={0.6} distance={ROOM_SIZE * 1.5} color="#fff8ee" />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/*  Top-down camera controller                                         */
/* ------------------------------------------------------------------ */

function SimsCameraController({ roomCount }: { roomCount: number }) {
  const { camera, gl } = useThree()
  const isDraggingRef = useRef(false)
  const lastMouseRef = useRef({ x: 0, y: 0 })
  const mouseScreenRef = useRef({ x: 0, y: 0 })
  const targetRef = useRef(new THREE.Vector3()) // the point camera looks at on the ground
  const distRef = useRef(20) // distance from target

  useEffect(() => {
    const cols = Math.min(roomCount, ROOMS_PER_ROW)
    const rows = Math.ceil(Math.max(roomCount, 1) / ROOMS_PER_ROW)
    const centerX = ((cols - 1) * (ROOM_SIZE + ROOM_GAP)) / 2
    const centerZ = ((rows - 1) * (ROOM_SIZE + ROOM_GAP)) / 2
    targetRef.current.set(centerX, 0, centerZ)

    // Position camera looking down at ~45 degrees
    const d = distRef.current
    camera.position.set(centerX, d, centerZ + d * 0.6)
    camera.lookAt(targetRef.current)

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 0 || e.button === 1) {
        isDraggingRef.current = true
        lastMouseRef.current = { x: e.clientX, y: e.clientY }
      }
    }
    const handleMouseUp = () => {
      isDraggingRef.current = false
    }
    const handleMouseMove = (e: MouseEvent) => {
      mouseScreenRef.current = { x: e.clientX, y: e.clientY }
      if (isDraggingRef.current) {
        const dx = e.clientX - lastMouseRef.current.x
        const dy = e.clientY - lastMouseRef.current.y
        // Scale drag speed by distance so it feels consistent at all zoom levels
        const scale = PAN_SPEED * distRef.current
        targetRef.current.x -= dx * scale
        targetRef.current.z -= dy * scale
        lastMouseRef.current = { x: e.clientX, y: e.clientY }
      }
    }
    const handleWheel = (e: WheelEvent) => {
      // Zoom toward/away from look target by changing distance
      const zoomDelta = e.deltaY * 0.002 * distRef.current
      distRef.current = Math.max(6, Math.min(60, distRef.current + zoomDelta))
    }

    const el = gl.domElement
    el.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('mousemove', handleMouseMove)
    el.addEventListener('wheel', handleWheel, { passive: true })

    return () => {
      el.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('mousemove', handleMouseMove)
      el.removeEventListener('wheel', handleWheel)
    }
  }, [camera, gl, roomCount])

  useFrame((_, delta) => {
    const rect = gl.domElement.getBoundingClientRect()
    const mx = mouseScreenRef.current.x - rect.left
    const my = mouseScreenRef.current.y - rect.top
    const w = rect.width
    const h = rect.height

    // Edge-of-screen panning
    if (!isDraggingRef.current) {
      const speed = EDGE_PAN_SPEED * delta * (distRef.current / 20)
      if (mx < EDGE_PAN_ZONE) targetRef.current.x -= speed * (1 - mx / EDGE_PAN_ZONE)
      if (mx > w - EDGE_PAN_ZONE) targetRef.current.x += speed * (1 - (w - mx) / EDGE_PAN_ZONE)
      if (my < EDGE_PAN_ZONE) targetRef.current.z -= speed * (1 - my / EDGE_PAN_ZONE)
      if (my > h - EDGE_PAN_ZONE) targetRef.current.z += speed * (1 - (h - my) / EDGE_PAN_ZONE)
    }

    // Orbit camera at fixed angle around look target
    const d = distRef.current
    camera.position.set(
      targetRef.current.x,
      d,
      targetRef.current.z + d * 0.6
    )
    camera.lookAt(targetRef.current)
  })

  return null
}

/* ------------------------------------------------------------------ */
/*  Wall color picker                                                  */
/* ------------------------------------------------------------------ */

const PALETTE = [
  '#e8dcc8', '#d4c4a8', '#c9b896', '#f0e6d3', '#ddd5c0',
  '#b8c4d0', '#c4d4c0', '#d8c8c8', '#c8c8d8', '#d0d4c4',
  '#ff9999', '#99ccff', '#99ff99', '#ffcc99', '#cc99ff',
  '#ffffff', '#333333', '#8B4513', '#FFD700', '#FF69B4'
]

interface WallPickerProps {
  wallId: string
  currentColor: string
  onPickColor: (wallId: string, color: string) => void
  onClose: () => void
}

function WallColorPicker({ wallId, currentColor, onPickColor, onClose }: WallPickerProps) {
  return (
    <div className="absolute bottom-16 left-1/2 -translate-x-1/2 rounded-xl border border-border/50 bg-background/95 p-3 shadow-xl backdrop-blur-xl">
      <p className="mb-2 text-xs font-medium text-muted-foreground">Wall Color</p>
      <div className="grid grid-cols-10 gap-1">
        {PALETTE.map((color) => (
          <button
            key={color}
            type="button"
            className={`h-6 w-6 rounded-md border-2 transition-transform hover:scale-110 ${
              color === currentColor ? 'border-foreground scale-110' : 'border-transparent'
            }`}
            style={{ backgroundColor: color }}
            onClick={() => { onPickColor(wallId, color); onClose() }}
          />
        ))}
      </div>
    </div>
  )
}


/* ------------------------------------------------------------------ */
/*  Main Sims View                                                     */
/* ------------------------------------------------------------------ */

interface HubSimsViewProps {
  folders: WorkspaceFolder[]
  boards: WorkspaceBoard[]
  onSelectBoard: (boardId: string) => void
}

export function HubSimsView({ folders, boards, onSelectBoard }: HubSimsViewProps) {
  const [hoveredBoard, setHoveredBoard] = useState<string | null>(null)
  const [selectedWall, setSelectedWall] = useState<string | null>(null)
  const [wallColors, setWallColors] = useState<Record<string, string>>({})
  const lighting = useHubWorldLighting()

  const rooms = useMemo(() => {
    const boardsByFolder = new Map<string | null, WorkspaceBoard[]>()
    for (const b of boards) {
      const key = b.folderId ?? null
      if (!boardsByFolder.has(key)) boardsByFolder.set(key, [])
      boardsByFolder.get(key)!.push(b)
    }

    const result: RoomData[] = []
    const sortedFolders = [...folders].sort((a, b) => a.sortOrder - b.sortOrder)

    const ungrouped = boardsByFolder.get(null)
    if (ungrouped && ungrouped.length > 0) {
      result.push({
        folder: { id: '__ungrouped__', name: 'Ungrouped', sortOrder: -1, createdAt: '', updatedAt: '' },
        boards: ungrouped,
        gridX: 0,
        gridZ: 0
      })
    }

    for (const folder of sortedFolders) {
      result.push({
        folder,
        boards: boardsByFolder.get(folder.id) ?? [],
        gridX: 0,
        gridZ: 0
      })
    }

    result.forEach((room, i) => {
      room.gridX = i % ROOMS_PER_ROW
      room.gridZ = Math.floor(i / ROOMS_PER_ROW)
    })

    return result
  }, [folders, boards])

  const handleClickBoard = useCallback((boardId: string) => {
    onSelectBoard(boardId)
  }, [onSelectBoard])

  const handleClickWall = useCallback((wallId: string) => {
    setSelectedWall((prev) => prev === wallId ? null : wallId)
  }, [])

  const handlePickColor = useCallback((wallId: string, color: string) => {
    setWallColors((prev) => ({ ...prev, [wallId]: color }))
  }, [])

  const selectedWallColor = selectedWall ? (wallColors[selectedWall] ?? WALL_COLORS[0]) : ''

  return (
    <div className="relative h-full w-full">
      <Canvas
        shadows
        camera={{ fov: 50, near: 0.1, far: 200 }}
        style={{ background: lighting.backgroundColor }}
      >
        <Suspense fallback={null}>
          <color attach="background" args={[lighting.backgroundColor]} />
          <ambientLight intensity={lighting.ambientIntensity + 0.08} />
          <directionalLight
            position={lighting.directionalPosition}
            intensity={lighting.directionalIntensity}
            color={lighting.directionalColor}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-camera-left={-30}
            shadow-camera-right={30}
            shadow-camera-top={30}
            shadow-camera-bottom={-30}
          />

          <SimsCameraController roomCount={rooms.length} />

          {/* Ground plane - at y=0 */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[
            ((Math.min(rooms.length, ROOMS_PER_ROW) - 1) * (ROOM_SIZE + ROOM_GAP)) / 2,
            0,
            ((Math.ceil(rooms.length / ROOMS_PER_ROW) - 1) * (ROOM_SIZE + ROOM_GAP)) / 2
          ]} receiveShadow>
            <planeGeometry args={[
              Math.min(rooms.length, ROOMS_PER_ROW) * (ROOM_SIZE + ROOM_GAP) + 4,
              Math.ceil(rooms.length / ROOMS_PER_ROW) * (ROOM_SIZE + ROOM_GAP) + 4
            ]} />
            <meshStandardMaterial color="#3d5c3a" />
          </mesh>

          {/* Contact shadows for nice soft AO on the ground */}
          <ContactShadows
            position={[
              ((Math.min(rooms.length, ROOMS_PER_ROW) - 1) * (ROOM_SIZE + ROOM_GAP)) / 2,
              0.02,
              ((Math.ceil(rooms.length / ROOMS_PER_ROW) - 1) * (ROOM_SIZE + ROOM_GAP)) / 2
            ]}
            opacity={lighting.shadowOpacity}
            scale={60}
            blur={2}
            far={10}
          />

          {rooms.map((room, i) => (
            <Room
              key={room.folder.id}
              data={room}
              roomIndex={i}
              hoveredBoard={hoveredBoard}
              selectedWall={selectedWall}
              onHoverBoard={setHoveredBoard}
              onClickBoard={handleClickBoard}
              onClickWall={handleClickWall}
              wallColors={wallColors}
            />
          ))}

        </Suspense>
      </Canvas>

      <div className="absolute bottom-4 left-4 rounded-lg bg-black/60 px-4 py-2 text-xs text-white/80 backdrop-blur-sm">
        <p>Click + drag to pan · Scroll to zoom · Move mouse to edges to pan</p>
        <p>Click walls to customize · Click people to open boards</p>
      </div>

      {hoveredBoard && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 rounded-lg bg-black/60 px-4 py-2 text-sm text-white backdrop-blur-sm">
          {boards.find((b) => b.id === hoveredBoard)?.name}
        </div>
      )}

      {selectedWall && (
        <WallColorPicker
          wallId={selectedWall}
          currentColor={selectedWallColor}
          onPickColor={handlePickColor}
          onClose={() => setSelectedWall(null)}
        />
      )}
    </div>
  )
}
