import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from 'react'
import type { WorkspaceFolder, WorkspaceBoard } from '@/hooks/use-workspace'
import type {
  VillageNeighborhood, VillageLocation, CameraMode,
  ActiveDialog, DecorationPlacement, SceneProp,
  ObjectPositionOverride, VillageData
} from './village-types'
import { useVillageLayout, type RoadSegment } from './use-village-layout'

/* ------------------------------------------------------------------ */
/*  Persistent village data (workspace JSON file)                      */
/* ------------------------------------------------------------------ */

const VILLAGE_DATA_FILE = '.village-data.json'

async function getVillageDataPath(): Promise<string> {
  const state = await window.api.workspace.getState()
  return state.rootDir + '/' + VILLAGE_DATA_FILE
}

async function loadVillageData(): Promise<VillageData> {
  try {
    const path = await getVillageDataPath()
    const raw = await window.api.graphNodes.readFile(path)
    return JSON.parse(raw) as VillageData
  } catch {
    return { objectPositions: {} }
  }
}

async function saveVillageData(data: VillageData): Promise<void> {
  try {
    const path = await getVillageDataPath()
    await window.api.graphNodes.writeFile(path, JSON.stringify(data, null, 2), 'overwrite')
  } catch (e) {
    console.warn('Failed to save village data:', e)
  }
}

/* ------------------------------------------------------------------ */
/*  Persistent player position (Electron settings)                     */
/* ------------------------------------------------------------------ */

const PLAYER_POS_KEY = 'hub-player-position'

export interface PersistedPlayerPos {
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  locationType: 'outdoor' | 'indoor'
  boardId?: string
}

async function loadPlayerPosition(): Promise<PersistedPlayerPos | null> {
  try {
    const val = await window.api.settings.get(PLAYER_POS_KEY)
    return val as PersistedPlayerPos | null
  } catch {
    return null
  }
}

async function savePlayerPosition(pos: PersistedPlayerPos): Promise<void> {
  try {
    await window.api.settings.set(PLAYER_POS_KEY, pos)
  } catch {
    // ignore
  }
}

/* ------------------------------------------------------------------ */
/*  Context shape                                                      */
/* ------------------------------------------------------------------ */

interface VillageState {
  neighborhoods: VillageNeighborhood[]
  scenery: SceneProp[]
  roads: RoadSegment[]
  location: VillageLocation
  cameraMode: CameraMode
  hoveredId: string | null
  activeDialog: ActiveDialog | null
  decorations: DecorationPlacement[]
  isDecoMode: boolean

  enterHouse: (boardId: string) => void
  exitHouse: () => void
  setHoveredId: (id: string | null) => void
  interact: (id: string, kind: ActiveDialog['kind'], boardId: string) => void
  closeDialog: () => void
  toggleDecoMode: () => void
  addDecoration: (d: DecorationPlacement) => void
  moveDecoration: (id: string, pos: [number, number, number]) => void
  rotateDecoration: (id: string, rot: [number, number, number]) => void
  deleteDecoration: (id: string) => void

  savedCameraPos: { x: number; y: number; z: number; yaw: number } | null
  saveCameraPos: (pos: { x: number; y: number; z: number; yaw: number }) => void

  // Grab system
  grabbedObjectId: string | null
  objectPositions: Record<string, ObjectPositionOverride>
  grabObject: (id: string) => void
  placeObject: (position: [number, number, number], rotation: number) => void
  updateGrabbedPosition: (position: [number, number, number]) => void

  // Persistent player position
  persistedPlayerPos: PersistedPlayerPos | null
  persistPlayerPos: (pos: PersistedPlayerPos) => void

  // Board items refresh (bumped when dialog closes to re-fetch screenshots)
  boardItemsVersion: number

  folders: WorkspaceFolder[]
  boards: WorkspaceBoard[]
  onSelectBoard: (boardId: string) => void
}

const VillageContext = createContext<VillageState | null>(null)

export function useVillage(): VillageState {
  const ctx = useContext(VillageContext)
  if (!ctx) throw new Error('useVillage must be inside VillageProvider')
  return ctx
}

const DECO_KEY = 'hub-village-decorations'

function loadDecorations(): DecorationPlacement[] {
  try {
    const raw = localStorage.getItem(DECO_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveDecorations(decos: DecorationPlacement[]) {
  localStorage.setItem(DECO_KEY, JSON.stringify(decos))
}

interface VillageProviderProps {
  folders: WorkspaceFolder[]
  boards: WorkspaceBoard[]
  cameraMode: CameraMode
  onSelectBoard: (boardId: string) => void
  children: React.ReactNode
}

export function VillageProvider({ folders, boards, cameraMode: cameraModeFromProps, onSelectBoard, children }: VillageProviderProps) {
  const { neighborhoods, scenery, roads } = useVillageLayout(folders, boards)
  const [location, setLocation] = useState<VillageLocation>({ type: 'outdoor' })
  const cameraMode = cameraModeFromProps
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [activeDialog, setActiveDialog] = useState<ActiveDialog | null>(null)
  const [decorations, setDecorations] = useState<DecorationPlacement[]>(loadDecorations)
  const [isDecoMode, setIsDecoMode] = useState(false)
  const [savedCameraPos, setSavedCameraPos] = useState<{ x: number; y: number; z: number; yaw: number } | null>(null)

  // Object position overrides
  const [objectPositions, setObjectPositions] = useState<Record<string, ObjectPositionOverride>>({})
  const [grabbedObjectId, setGrabbedObjectId] = useState<string | null>(null)
  const villageDataRef = useRef<VillageData>({ objectPositions: {} })

  // Board items version — bumped when dialog closes to trigger re-fetch of screenshots
  const [boardItemsVersion, setBoardItemsVersion] = useState(0)

  // Persistent player position
  const [persistedPlayerPos, setPersistedPlayerPos] = useState<PersistedPlayerPos | null>(null)
  const playerPosSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load village data on mount
  useEffect(() => {
    loadVillageData().then((data) => {
      villageDataRef.current = data
      setObjectPositions(data.objectPositions)
    })
    loadPlayerPosition().then((pos) => {
      if (pos) {
        setPersistedPlayerPos(pos)
        // Restore location if player was indoors
        if (pos.locationType === 'indoor' && pos.boardId) {
          setLocation({ type: 'indoor', boardId: pos.boardId, houseWorldPos: [0, 0, 0] })
        }
      }
    })
  }, [])

  const saveCameraPos = useCallback((pos: { x: number; y: number; z: number; yaw: number }) => {
    setSavedCameraPos(pos)
  }, [])

  const enterHouse = useCallback((boardId: string) => {
    for (const n of neighborhoods) {
      for (const h of n.houses) {
        if (h.id === boardId) {
          setLocation({ type: 'indoor', boardId, houseWorldPos: h.worldPosition })
          return
        }
      }
    }
  }, [neighborhoods])

  const exitHouse = useCallback(() => {
    setLocation({ type: 'outdoor' })
  }, [])

  const interact = useCallback((id: string, kind: ActiveDialog['kind'], boardId: string) => {
    setActiveDialog({ kind, id, boardId })
  }, [])

  const closeDialog = useCallback(() => {
    setActiveDialog(null)
    // Bump version so useBoardItems re-fetches with updated screenshots
    setBoardItemsVersion((v) => v + 1)
  }, [])
  const toggleDecoMode = useCallback(() => setIsDecoMode((v) => !v), [])

  const addDecoration = useCallback((d: DecorationPlacement) => {
    setDecorations((prev) => {
      const next = [...prev, d]
      saveDecorations(next)
      return next
    })
  }, [])

  const moveDecoration = useCallback((id: string, pos: [number, number, number]) => {
    setDecorations((prev) => {
      const next = prev.map((d) => d.id === id ? { ...d, position: pos } : d)
      saveDecorations(next)
      return next
    })
  }, [])

  const rotateDecoration = useCallback((id: string, rot: [number, number, number]) => {
    setDecorations((prev) => {
      const next = prev.map((d) => d.id === id ? { ...d, rotation: rot } : d)
      saveDecorations(next)
      return next
    })
  }, [])

  const deleteDecoration = useCallback((id: string) => {
    setDecorations((prev) => {
      const next = prev.filter((d) => d.id !== id)
      saveDecorations(next)
      return next
    })
  }, [])

  // Grab system
  const grabObject = useCallback((id: string) => {
    setGrabbedObjectId(id)
  }, [])

  const placeObject = useCallback((position: [number, number, number], rotation: number) => {
    setGrabbedObjectId((currentId) => {
      if (!currentId) return null
      setObjectPositions((prev) => {
        const next = { ...prev, [currentId]: { position, rotation } }
        // Save to file
        villageDataRef.current = { ...villageDataRef.current, objectPositions: next }
        saveVillageData(villageDataRef.current)
        return next
      })
      return null
    })
  }, [])

  const updateGrabbedPosition = useCallback((position: [number, number, number]) => {
    setGrabbedObjectId((currentId) => {
      if (!currentId) return null
      setObjectPositions((prev) => ({
        ...prev,
        [currentId]: { position, rotation: prev[currentId]?.rotation ?? 0 }
      }))
      return currentId
    })
  }, [])

  // Persist player position (debounced)
  const persistPlayerPos = useCallback((pos: PersistedPlayerPos) => {
    setPersistedPlayerPos(pos)
    if (playerPosSaveTimer.current) clearTimeout(playerPosSaveTimer.current)
    playerPosSaveTimer.current = setTimeout(() => {
      savePlayerPosition(pos)
    }, 2000)
  }, [])

  const value = useMemo<VillageState>(() => ({
    neighborhoods, scenery, roads, location, cameraMode, hoveredId, activeDialog,
    decorations, isDecoMode, savedCameraPos, saveCameraPos,
    enterHouse, exitHouse, setHoveredId, interact, closeDialog,
    toggleDecoMode, addDecoration, moveDecoration, rotateDecoration, deleteDecoration,
    grabbedObjectId, objectPositions, grabObject, placeObject, updateGrabbedPosition,
    persistedPlayerPos, persistPlayerPos,
    boardItemsVersion,
    folders, boards, onSelectBoard
  }), [
    neighborhoods, scenery, roads, location, cameraMode, hoveredId, activeDialog,
    decorations, isDecoMode, savedCameraPos, saveCameraPos,
    enterHouse, exitHouse, interact, closeDialog, setHoveredId,
    toggleDecoMode, addDecoration, moveDecoration, rotateDecoration, deleteDecoration,
    grabbedObjectId, objectPositions, grabObject, placeObject, updateGrabbedPosition,
    persistedPlayerPos, persistPlayerPos,
    boardItemsVersion,
    folders, boards, onSelectBoard
  ])

  return <VillageContext.Provider value={value}>{children}</VillageContext.Provider>
}
