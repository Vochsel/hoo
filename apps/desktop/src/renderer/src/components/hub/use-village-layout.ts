import { useMemo } from 'react'
import type { WorkspaceFolder, WorkspaceBoard } from '@/hooks/use-workspace'
import type { VillageNeighborhood, VillageHouse, SceneProp } from './village-types'
import {
  HOUSE_ASSETS, TREE_ASSETS, OUTDOOR_PROPS, SMALL_PROPS,
  seededRandom, pickAsset
} from './hub-assets'

/* ------------------------------------------------------------------ */
/*  Layout constants                                                   */
/* ------------------------------------------------------------------ */

const CUL_DE_SAC_RADIUS = 12
const STREET_SPACING_Z = 28 // tighter spacing between side streets
const SIDE_STREET_LENGTH = 18
const MAIN_ROAD_WIDTH = 5
const SIDE_ROAD_WIDTH = 3.5
const HOUSES_PER_RING = 6
const MEANDER_AMP = 6 // how much the main road wobbles side to side
const MEANDER_FREQ = 0.08 // how fast the wobble oscillates

/* ------------------------------------------------------------------ */
/*  Road segment — now supports curved roads via multiple segments     */
/* ------------------------------------------------------------------ */

export interface RoadSegment {
  cx: number
  cz: number
  width: number
  length: number
  angle: number
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

/** Get the main road X offset at a given Z (meandering curve) */
function mainRoadX(z: number): number {
  return Math.sin(z * MEANDER_FREQ) * MEANDER_AMP + Math.sin(z * MEANDER_FREQ * 2.3 + 1.5) * MEANDER_AMP * 0.4
}

/* ------------------------------------------------------------------ */
/*  Layout                                                             */
/* ------------------------------------------------------------------ */

function layoutNeighborhoods(
  folders: WorkspaceFolder[],
  boards: WorkspaceBoard[]
): { neighborhoods: VillageNeighborhood[]; roads: RoadSegment[] } {
  const boardsByFolder = new Map<string | null, WorkspaceBoard[]>()
  for (const b of boards) {
    const key = b.folderId ?? null
    if (!boardsByFolder.has(key)) boardsByFolder.set(key, [])
    boardsByFolder.get(key)!.push(b)
  }

  const sorted = [...folders].sort((a, b) => a.sortOrder - b.sortOrder)
  const folderEntries: { folder: WorkspaceFolder; boards: WorkspaceBoard[] }[] = []
  const ungrouped = boardsByFolder.get(null)
  if (ungrouped && ungrouped.length > 0) {
    folderEntries.push({
      folder: { id: '__ungrouped__', name: 'Town Square', sortOrder: -1, createdAt: '', updatedAt: '' },
      boards: ungrouped
    })
  }
  for (const f of sorted) {
    folderEntries.push({ folder: f, boards: boardsByFolder.get(f.id) ?? [] })
  }

  const neighborhoods: VillageNeighborhood[] = []
  const roads: RoadSegment[] = []

  const totalStreets = folderEntries.length
  const mainRoadStartZ = 15
  const mainRoadEndZ = mainRoadStartZ - Math.max(totalStreets, 1) * STREET_SPACING_Z - 10

  // Build meandering main road from segments
  const segLen = 4
  for (let z = mainRoadStartZ; z > mainRoadEndZ; z -= segLen) {
    const z1 = z
    const z2 = z - segLen
    const x1 = mainRoadX(z1)
    const x2 = mainRoadX(z2)
    const dx = x2 - x1
    const dz = z2 - z1
    const len = Math.sqrt(dx * dx + dz * dz)
    const angle = Math.atan2(dx, dz)
    roads.push({
      cx: (x1 + x2) / 2,
      cz: (z1 + z2) / 2,
      width: MAIN_ROAD_WIDTH,
      length: len + 0.5, // slight overlap to avoid gaps
      angle
    })
  }

  // Place neighborhoods
  for (let i = 0; i < folderEntries.length; i++) {
    const { folder, boards: folderBoards } = folderEntries[i]

    const side = i % 2 === 0 ? -1 : 1
    const streetZ = mainRoadStartZ - (i + 0.5) * STREET_SPACING_Z
    const roadX = mainRoadX(streetZ)

    // Cul-de-sac center offset from the road
    const culX = roadX + side * (SIDE_STREET_LENGTH + CUL_DE_SAC_RADIUS * 0.5)
    const culZ = streetZ

    // Side street connecting main road to cul-de-sac
    const sideStartX = roadX + side * (MAIN_ROAD_WIDTH / 2)
    const sideEndX = culX - side * (CUL_DE_SAC_RADIUS * 0.3)
    const sideCx = (sideStartX + sideEndX) / 2
    const sideLen = Math.abs(sideEndX - sideStartX)
    roads.push({
      cx: sideCx,
      cz: streetZ,
      width: SIDE_ROAD_WIDTH,
      length: sideLen,
      angle: Math.PI / 2
    })

    // Cul-de-sac opening faces back toward main road
    const nRot = side > 0 ? Math.PI : 0

    const houseCount = folderBoards.length
    const radius = CUL_DE_SAC_RADIUS + Math.max(0, Math.floor((houseCount - HOUSES_PER_RING) / HOUSES_PER_RING)) * 5
    const rng = seededRandom(hashStr(folder.id))

    const houses: VillageHouse[] = folderBoards
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((board, hi) => {
        // Arc on the back half only (away from the road entrance)
        // Spans ~140° centered on the back, leaving the front wide open for the road
        const arcSpan = Math.PI * 0.75
        const arcStart = -arcSpan / 2
        const angle = houseCount === 1 ? 0 : arcStart + (hi / (houseCount - 1)) * arcSpan
        // Houses sit on the far side: localZ is negative (back of cul-de-sac)
        const localX = Math.sin(angle) * radius
        const localZ = -Math.cos(angle) * radius
        const cosR = Math.cos(nRot)
        const sinR = Math.sin(nRot)
        const wx = culX + localX * cosR - localZ * sinR
        const wz = culZ + localX * sinR + localZ * cosR

        // Face toward the cul-de-sac center
        const toCenterX = culX - wx
        const toCenterZ = culZ - wz
        const faceAngle = Math.atan2(toCenterX, toCenterZ)

        return {
          id: board.id,
          board,
          neighborhoodId: folder.id,
          worldPosition: [wx, 0, wz] as [number, number, number],
          worldRotation: faceAngle,
          houseAsset: pickAsset(HOUSE_ASSETS, rng)
        }
      })

    // Arch at the main road junction — where side street starts
    const archX = sideStartX + side * 2
    const archZ = streetZ
    // Arch spans across the side street which runs along X
    const archRot = Math.PI / 2

    neighborhoods.push({
      id: folder.id,
      folder,
      position: [culX, 0, culZ],
      rotation: nRot,
      archPosition: [archX, 0, archZ],
      archRotation: archRot,
      houses
    })
  }

  return { neighborhoods, roads }
}

/* ------------------------------------------------------------------ */
/*  Procedural scenery                                                 */
/* ------------------------------------------------------------------ */

function generateScenery(neighborhoods: VillageNeighborhood[]): SceneProp[] {
  const rng = seededRandom(12345)
  const props: SceneProp[] = []

  let minX = -40, maxX = 40, minZ = -40, maxZ = 40
  for (const n of neighborhoods) {
    for (const h of n.houses) {
      minX = Math.min(minX, h.worldPosition[0] - 12)
      maxX = Math.max(maxX, h.worldPosition[0] + 12)
      minZ = Math.min(minZ, h.worldPosition[2] - 12)
      maxZ = Math.max(maxZ, h.worldPosition[2] + 12)
    }
  }

  const housePositions = neighborhoods.flatMap((n) => n.houses.map((h) => h.worldPosition))
  const neighborhoodCenters = neighborhoods.map((n) => n.position)

  function isTooClose(x: number, z: number, minDist: number): boolean {
    if (housePositions.some((hp) => Math.hypot(x - hp[0], z - hp[2]) < minDist)) return true
    if (neighborhoodCenters.some((nc) => Math.hypot(x - nc[0], z - nc[2]) < minDist * 1.2)) return true
    return false
  }

  for (let i = 0; i < 80; i++) {
    const x = minX + rng() * (maxX - minX)
    const z = minZ + rng() * (maxZ - minZ)
    if (!isTooClose(x, z, 7)) {
      props.push({ asset: pickAsset(TREE_ASSETS, rng), position: [x, 0, z], rotation: [0, rng() * Math.PI * 2, 0] })
    }
  }

  for (const n of neighborhoods) {
    const count = 2 + Math.floor(rng() * 3)
    for (let j = 0; j < count; j++) {
      const ox = n.position[0] + (rng() - 0.5) * 22
      const oz = n.position[2] + (rng() - 0.5) * 16
      if (!isTooClose(ox, oz, 5)) {
        props.push({ asset: pickAsset(OUTDOOR_PROPS, rng), position: [ox, 0, oz], rotation: [0, rng() * Math.PI * 2, 0] })
      }
    }
  }

  for (let i = 0; i < 80; i++) {
    const x = minX + rng() * (maxX - minX)
    const z = minZ + rng() * (maxZ - minZ)
    if (!isTooClose(x, z, 3)) {
      props.push({ asset: pickAsset(SMALL_PROPS, rng), position: [x, 0, z], rotation: [0, rng() * Math.PI * 2, 0] })
    }
  }

  const streetlight = OUTDOOR_PROPS.find((p) => p.file === 'streetlight.glb')!
  for (const n of neighborhoods) {
    const cos = Math.cos(n.rotation)
    const sin = Math.sin(n.rotation)
    const d = CUL_DE_SAC_RADIUS + 3
    props.push({ asset: streetlight, position: [n.position[0] + sin * d + cos * 2.5, 0, n.position[2] + cos * d - sin * 2.5], rotation: [0, n.rotation, 0] })
    props.push({ asset: streetlight, position: [n.position[0] + sin * d - cos * 2.5, 0, n.position[2] + cos * d + sin * 2.5], rotation: [0, n.rotation + Math.PI, 0] })
  }

  return props
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useVillageLayout(folders: WorkspaceFolder[], boards: WorkspaceBoard[]) {
  const { neighborhoods, roads } = useMemo(() => layoutNeighborhoods(folders, boards), [folders, boards])
  const scenery = useMemo(() => generateScenery(neighborhoods), [neighborhoods])
  return { neighborhoods, scenery, roads }
}
