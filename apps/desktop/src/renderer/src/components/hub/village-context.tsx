import { createContext, useContext, useState, useCallback, useMemo, useRef } from 'react'
import type { WorkspaceFolder, WorkspaceBoard } from '@/hooks/use-workspace'
import type {
  VillageNeighborhood, VillageLocation, CameraMode,
  ActiveDialog, DecorationPlacement, SceneProp
} from './village-types'
import { useVillageLayout, type RoadSegment } from './use-village-layout'

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

  const saveCameraPos = useCallback((pos: { x: number; y: number; z: number; yaw: number }) => {
    setSavedCameraPos(pos)
  }, [])

  const enterHouse = useCallback((boardId: string) => {
    // Find house world position
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

  const closeDialog = useCallback(() => setActiveDialog(null), [])
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

  const value = useMemo<VillageState>(() => ({
    neighborhoods, scenery, roads, location, cameraMode, hoveredId, activeDialog,
    decorations, isDecoMode, savedCameraPos, saveCameraPos,
    enterHouse, exitHouse, setHoveredId, interact, closeDialog,
    toggleDecoMode, addDecoration, moveDecoration, rotateDecoration, deleteDecoration,
    folders, boards, onSelectBoard
  }), [
    neighborhoods, scenery, roads, location, cameraMode, hoveredId, activeDialog,
    decorations, isDecoMode, savedCameraPos, saveCameraPos,
    enterHouse, exitHouse, interact, closeDialog, setHoveredId,
    toggleDecoMode, addDecoration, moveDecoration, rotateDecoration, deleteDecoration,
    folders, boards, onSelectBoard
  ])

  return <VillageContext.Provider value={value}>{children}</VillageContext.Provider>
}
