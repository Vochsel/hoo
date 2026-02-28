import { memo } from 'react'
import { type NodeProps, Handle, Position } from '@xyflow/react'
import { Globe, X, Radio, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BrowserTabMonitor } from '@/hooks/use-browser-tabs'
import { NodeExecutionFooter } from './node-status-bar'
import { useFlowDirection, getSourcePosition, getTargetPosition } from './flow-direction-context'

export interface BrowserTabNodeData {
  title: string
  url: string
  favicon: string | null
  screenshot: string | null
  monitors: BrowserTabMonitor[]
  isRunning?: boolean
  runtimeStatus?: string
  onClose: (id: string) => void
  [key: string]: unknown
}

function BrowserTabNodeInner({ id, data, selected }: NodeProps): React.ReactElement {
  const { title, favicon, screenshot, monitors, isRunning, runtimeStatus, runtimeOutput, onClose } = data as unknown as BrowserTabNodeData
  const enabledMonitors = monitors?.filter((m) => m.enabled) ?? []
  const hasMonitors = enabledMonitors.length > 0
  const direction = useFlowDirection()
  const sourcePos = getSourcePosition(direction)
  const targetPos = getTargetPosition(direction)

  return (
    <div
      className={cn(
        'group w-[240px] rounded-lg border bg-card shadow-sm transition-all hover:shadow-md',
        selected && 'ring-2 ring-primary'
      )}
    >
      {/* Screenshot / Placeholder */}
      <div className="relative w-full overflow-hidden rounded-t-lg bg-muted">
        {screenshot ? (
          <img src={screenshot} alt={title} draggable={false} className="block h-auto w-full" />
        ) : (
          <div className="flex min-h-[135px] w-full items-center justify-center">
            <Globe className="h-8 w-8 text-muted-foreground/40" />
          </div>
        )}

        {/* Close button */}
        <button
          className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation()
            onClose(id)
          }}
        >
          <X className="h-3 w-3" />
        </button>

        {/* Monitor indicator badge */}
        {hasMonitors && (
          <div className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-amber-500/90 px-1.5 py-0.5">
            <Radio className="h-2.5 w-2.5 text-white" />
            <span className="text-[9px] font-medium text-white">{enabledMonitors.length}</span>
          </div>
        )}

        {/* Running indicator overlay */}
        {isRunning && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-[1px]">
            <div className="flex items-center gap-1.5 rounded-full bg-primary/90 px-2 py-1">
              <Loader2 className="h-3 w-3 animate-spin text-white" />
              <span className="text-[9px] font-medium text-white">Running</span>
            </div>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="px-2.5 py-2">
        <div className="flex items-center gap-1.5">
          {favicon ? <img src={favicon} alt="" draggable={false} className="h-3.5 w-3.5 shrink-0" /> : null}
          <span className="truncate text-xs font-medium">{title || 'New Tab'}</span>
        </div>
      </div>

      {/* Per-monitor rows with inline handles */}
      {hasMonitors && (
        <div className="border-t px-2.5 py-1.5 space-y-0.5">
          {enabledMonitors.map((monitor) => (
            <div key={monitor.id} className="relative flex items-center gap-1.5 h-5">
              <Radio className="h-2.5 w-2.5 text-amber-500 shrink-0" />
              <span
                className="text-[10px] text-muted-foreground truncate max-w-[180px]"
                title={monitor.condition}
              >
                {monitor.condition}
              </span>
              {/* Handle sits inside the row so it's vertically centered */}
              <Handle
                type="source"
                position={sourcePos}
                id={`monitor-${monitor.id}`}
                title={monitor.condition}
                className={cn(
                  '!absolute !w-3 !h-3 !bg-amber-500 !border-2 !border-amber-300',
                  direction === 'vertical'
                    ? '!bottom-[-18px] !left-1/2 !-translate-x-1/2'
                    : '!right-[-18px] !top-1/2 !-translate-y-1/2'
                )}
              />
            </div>
          ))}
        </div>
      )}

      <NodeExecutionFooter status={runtimeStatus} isRunning={isRunning} runtimeOutput={runtimeOutput as string | undefined} className="px-2.5 py-1.5" />

      {/* Default handles */}
      <Handle
        type="target"
        position={targetPos}
        className="!w-3 !h-3 !bg-muted-foreground !border-2 !border-background"
      />
      <Handle
        type="source"
        position={sourcePos}
        className="!w-3 !h-3 !bg-muted-foreground !border-2 !border-background"
      />
    </div>
  )
}

export const BrowserTabNode = memo(BrowserTabNodeInner)
