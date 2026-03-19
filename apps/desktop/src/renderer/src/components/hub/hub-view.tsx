import { useState } from 'react'
import { LayoutGrid, Footprints, Home } from 'lucide-react'
import { HubReactFlowView } from './hub-reactflow-view'
import { VillageProvider, useVillage } from './village-context'
import { VillageScene } from './village-scene'
import { VillageDialog } from './village-dialog'
import type { WorkspaceFolder, WorkspaceBoard } from '@/hooks/use-workspace'
import type { CameraMode } from './village-types'

type HubMode = 'canvas' | 'fps' | 'sims'

interface HubViewProps {
  folders: WorkspaceFolder[]
  boards: WorkspaceBoard[]
  onSelectBoard: (boardId: string) => void
}

function FPSHud() {
  const { isDriving } = useVillage()

  return (
    <div className="absolute bottom-4 left-4 rounded-lg bg-black/60 px-4 py-2 text-xs text-white/80 backdrop-blur-sm">
      {isDriving ? (
        <>
          <p>W/S to accelerate and reverse · A/D to steer · Shift to boost · Space to brake</p>
          <p><span className="font-bold text-white">E</span> to hop back out of the car</p>
        </>
      ) : (
        <>
          <p>Click to lock mouse · WASD to move · Shift to run · Space to jump</p>
          <p>Walk into door circles to enter · <span className="font-bold text-white">E</span> to interact · <span className="font-bold text-white">G</span> to grab/place · <span className="font-bold text-white">Esc</span> to exit house</p>
          <p>Find the town car and press <span className="font-bold text-white">E</span> to drive it</p>
        </>
      )}
    </div>
  )
}

export function HubView({ folders, boards, onSelectBoard }: HubViewProps) {
  const [mode, setMode] = useState<HubMode>('fps')

  const is3D = mode === 'fps' || mode === 'sims'
  const cameraMode: CameraMode = mode === 'sims' ? 'sims' : 'fps'

  return (
    <div className="relative flex h-full flex-col">
      {/* Mode switcher bar */}
      <div className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-border/40 bg-background/80 p-0.5 backdrop-blur-sm">
        <button
          type="button"
          className={`flex h-7 items-center gap-1.5 rounded-md px-3 text-[11px] font-medium transition-colors ${
            mode === 'canvas'
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
          }`}
          onClick={() => setMode('canvas')}
          title="Canvas view"
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          Canvas
        </button>
        <button
          type="button"
          className={`flex h-7 items-center gap-1.5 rounded-md px-3 text-[11px] font-medium transition-colors ${
            mode === 'fps'
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
          }`}
          onClick={() => setMode('fps')}
          title="FPS town view"
        >
          <Footprints className="h-3.5 w-3.5" />
          Town
        </button>
        <button
          type="button"
          className={`flex h-7 items-center gap-1.5 rounded-md px-3 text-[11px] font-medium transition-colors ${
            mode === 'sims'
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
          }`}
          onClick={() => setMode('sims')}
          title="Top-down view"
        >
          <Home className="h-3.5 w-3.5" />
          Overhead
        </button>
      </div>

      {/* View content */}
      <div className="flex-1 min-h-0">
        {mode === 'canvas' && (
          <HubReactFlowView
            folders={folders}
            boards={boards}
            onSelectBoard={onSelectBoard}
          />
        )}
        {is3D && (
          <VillageProvider
            folders={folders}
            boards={boards}
            cameraMode={cameraMode}
            onSelectBoard={onSelectBoard}
          >
            <VillageScene />

            {/* FPS HUD */}
            {mode === 'fps' && (
              <>
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="h-1 w-1 rounded-full bg-white/60" />
                </div>
                <FPSHud />
              </>
            )}

            {/* Sims HUD */}
            {mode === 'sims' && (
              <div className="absolute bottom-4 left-4 rounded-lg bg-black/60 px-4 py-2 text-xs text-white/80 backdrop-blur-sm">
                <p>Click + drag to pan · Scroll to zoom · Move mouse to edges to pan</p>
              </div>
            )}

            {/* Interaction dialog overlay */}
            <VillageDialog />
          </VillageProvider>
        )}
      </div>
    </div>
  )
}
