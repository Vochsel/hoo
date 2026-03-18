import { useState } from 'react'
import { LayoutGrid, Footprints, Home } from 'lucide-react'
import { HubReactFlowView } from './hub-reactflow-view'
import { HubFpsView } from './hub-fps-view'
import { HubSimsView } from './hub-sims-view'
import type { WorkspaceFolder, WorkspaceBoard } from '@/hooks/use-workspace'

type HubMode = 'canvas' | 'fps' | 'sims'

interface HubViewProps {
  folders: WorkspaceFolder[]
  boards: WorkspaceBoard[]
  onSelectBoard: (boardId: string) => void
}

export function HubView({ folders, boards, onSelectBoard }: HubViewProps) {
  const [mode, setMode] = useState<HubMode>('canvas')

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
          title="Sims house view"
        >
          <Home className="h-3.5 w-3.5" />
          House
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
        {mode === 'fps' && (
          <HubFpsView
            folders={folders}
            boards={boards}
            onSelectBoard={onSelectBoard}
          />
        )}
        {mode === 'sims' && (
          <HubSimsView
            folders={folders}
            boards={boards}
            onSelectBoard={onSelectBoard}
          />
        )}
      </div>
    </div>
  )
}
