import type { WorkspaceFolder, WorkspaceBoard } from '@/hooks/use-workspace'
import type { AssetDef } from './hub-assets'

/* ------------------------------------------------------------------ */
/*  Village world model                                                */
/* ------------------------------------------------------------------ */

export interface VillageNeighborhood {
  id: string
  folder: WorkspaceFolder
  position: [number, number, number]
  rotation: number
  houses: VillageHouse[]
  archPosition: [number, number, number]
  archRotation: number
}

export interface VillageHouse {
  id: string
  board: WorkspaceBoard
  neighborhoodId: string
  worldPosition: [number, number, number]
  worldRotation: number
  houseAsset: AssetDef
}

/* ------------------------------------------------------------------ */
/*  Interior objects                                                   */
/* ------------------------------------------------------------------ */

export interface InteriorObject {
  id: string
  kind: 'computer' | 'terminal' | 'agent'
  label: string
  localPosition: [number, number, number]
  localRotation: number
}

/* ------------------------------------------------------------------ */
/*  Decoration                                                         */
/* ------------------------------------------------------------------ */

export interface DecorationPlacement {
  id: string
  assetFile: string
  position: [number, number, number]
  rotation: [number, number, number]
  scale: number
  scope: 'outdoor' | 'indoor'
  scopeId: string
}

/* ------------------------------------------------------------------ */
/*  Scene prop (procedural, non-editable)                              */
/* ------------------------------------------------------------------ */

export interface SceneProp {
  asset: AssetDef
  position: [number, number, number]
  rotation: [number, number, number]
}

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */

export type VillageLocation =
  | { type: 'outdoor' }
  | { type: 'indoor'; boardId: string; houseWorldPos: [number, number, number] }

export type CameraMode = 'fps' | 'sims'

export interface ActiveDialog {
  kind: 'browser' | 'terminal' | 'board'
  id: string
  boardId: string
}
