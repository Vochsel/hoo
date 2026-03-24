import { memo } from 'react'
import { type NodeProps, NodeResizer } from '@xyflow/react'
import { ExternalLink, Loader2, Terminal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TerminalContent } from './terminal-content'
import { NodeExecutionFooter } from './node-status-bar'

const MIN_WIDTH = 420
const MIN_HEIGHT = 280

export interface TerminalNodeConfig {
  command?: string
  shell?: string
  cwd?: string
  timeout?: number
  lastOutput?: string
  lastError?: string
  lastExitCode?: number
  lastRunAt?: string
  lastScrollback?: string
  lastScreenshot?: string
  useLatestUpstreamOnly?: boolean
}

export interface TerminalNodeData {
  nodeId: string
  label: string
  config: TerminalNodeConfig
  isRunning?: boolean
  hasNotification?: boolean
  runtimeStatus?: string
  runtimeOutput?: string
  isInteractive?: boolean
  isResizing?: boolean
  onOpen?: (id: string) => void
  onResize?: (id: string, width: number, height: number) => void
  onResizeStateChange?: (id: string, isResizing: boolean) => void
  onUpdateConfig: (config: TerminalNodeConfig) => void
  onRunningChange?: (isRunning: boolean) => void
  workspaceRootDir?: string
  [key: string]: unknown
}

function TerminalNodeInner({ id, data, selected }: NodeProps): React.ReactElement {
  const {
    nodeId,
    label,
    config,
    isRunning,
    hasNotification,
    runtimeStatus,
    runtimeOutput,
    isInteractive,
    isResizing,
    onOpen,
    onResize,
    onResizeStateChange,
    onUpdateConfig,
    onRunningChange,
    workspaceRootDir
  } = data as unknown as TerminalNodeData

  return (
    <div
      className={cn(
        'group flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md',
        selected && 'ring-2 ring-primary'
      )}
    >
      <NodeResizer
        minWidth={MIN_WIDTH}
        minHeight={MIN_HEIGHT}
        isVisible={selected}
        autoScale={false}
        lineStyle={{ borderColor: 'hsl(var(--border))', opacity: 0.65 }}
        handleStyle={{
          width: 10,
          height: 10,
          borderRadius: 9999,
          border: '1px solid hsl(var(--border))',
          background: 'hsl(var(--background))'
        }}
        onResizeStart={() => onResizeStateChange?.(id, true)}
        onResizeEnd={(_, params) => {
          onResize?.(id, params.width, params.height)
          onResizeStateChange?.(id, false)
        }}
      />

      <div className="canvas-node-drag-handle flex h-9 shrink-0 items-center gap-2 border-b bg-background/95 px-2.5">
        {isRunning ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
        ) : (
          <Terminal className="h-3.5 w-3.5 shrink-0 text-green-500" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">{label || 'Terminal'}</p>
          {config.command ? (
            <p className="truncate text-[10px] text-muted-foreground">{config.command}</p>
          ) : null}
        </div>
        {hasNotification && !isRunning && <div className="h-2 w-2 rounded-full bg-blue-500" />}
        <button
          type="button"
          className="nodrag inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation()
            onOpen?.(id)
          }}
          title="Open terminal"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {isInteractive ? (
          <div className={cn('nodrag nopan nowheel flex min-h-0 flex-1', isResizing && 'pointer-events-none select-none')}>
            <TerminalContent
              sessionId={`pty-${nodeId}`}
              label={label}
              config={config}
              active
              onUpdateConfig={onUpdateConfig}
              onRunningChange={onRunningChange}
              workspaceRootDir={workspaceRootDir}
              showHeader={false}
            />
          </div>
        ) : config?.lastScreenshot ? (
          <img
            src={config.lastScreenshot}
            alt="Terminal screenshot"
            className="h-full w-full flex-1 object-cover object-top"
          />
        ) : (
          <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-[#1a1a2e]">
            <Terminal className="h-8 w-8 text-white/20" />
          </div>
        )}
      </div>

      <NodeExecutionFooter
        status={runtimeStatus}
        isRunning={isRunning}
        runtimeOutput={runtimeOutput}
        className="shrink-0 px-2.5 py-1.5"
      />
    </div>
  )
}

export const TerminalNode = memo(TerminalNodeInner)
