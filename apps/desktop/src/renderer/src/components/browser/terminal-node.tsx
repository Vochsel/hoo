import { memo } from 'react'
import { type NodeProps, Position } from '@xyflow/react'
import { Terminal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NodeExecutionFooter } from './node-status-bar'
import { HandleWithTooltip } from './handle-with-tooltip'
import { useFlowDirection, getSourcePosition, getTargetPosition } from './flow-direction-context'

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
  useLatestUpstreamOnly?: boolean
}

export interface TerminalNodeData {
  label: string
  config: TerminalNodeConfig
  isRunning?: boolean
  runtimeStatus?: string
  [key: string]: unknown
}

function TerminalNodeInner({ id: _id, data, selected }: NodeProps): React.ReactElement {
  const { label, config, isRunning, runtimeStatus } = data as unknown as TerminalNodeData
  const command = config?.command || ''
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
      {/* Terminal preview area */}
      <div className="relative w-full overflow-hidden rounded-t-lg bg-[#1a1a2e]">
        <div className="flex min-h-[100px] w-full flex-col px-3 py-2.5">
          {/* Fake title bar dots */}
          <div className="mb-2 flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-red-500/60" />
            <div className="h-2 w-2 rounded-full bg-yellow-500/60" />
            <div className="h-2 w-2 rounded-full bg-green-500/60" />
          </div>
          {command ? (
            <p className="font-mono text-[10px] text-green-400/80 leading-relaxed">
              <span className="text-green-500/60">$</span> {command}
            </p>
          ) : (
            <p className="font-mono text-[10px] text-green-400/40 italic">
              Double-click to open terminal
            </p>
          )}
          {config?.lastOutput && (
            <p className="mt-1 font-mono text-[9px] text-gray-400/70 line-clamp-3 leading-relaxed">
              {config.lastOutput.slice(0, 200)}
            </p>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="px-2.5 py-2">
        <div className="flex items-center gap-1.5">
          <Terminal className="h-3.5 w-3.5 shrink-0 text-green-500" />
          <span className="truncate text-xs font-medium">{label || 'Terminal'}</span>
        </div>
        {config?.lastExitCode !== undefined && (
          <p
            className={cn(
              'mt-0.5 text-[10px]',
              config.lastExitCode === 0 ? 'text-green-600' : 'text-destructive/90'
            )}
          >
            Exit code: {config.lastExitCode}
          </p>
        )}
        {config?.lastError && !config.lastOutput && (
          <p className="mt-0.5 text-[10px] text-destructive/90 line-clamp-1" title={config.lastError}>
            {config.lastError}
          </p>
        )}
      </div>

      <NodeExecutionFooter status={runtimeStatus} isRunning={isRunning} className="px-2.5 py-1.5" />

      {/* Handles */}
      <HandleWithTooltip
        label="Input"
        type="target"
        position={targetPos}
        className="!w-3 !h-3 !bg-muted-foreground !border-2 !border-background"
      />
      <HandleWithTooltip
        label="Output"
        type="source"
        position={sourcePos}
        className="!w-3 !h-3 !bg-green-500 !border-2 !border-green-300"
      />
    </div>
  )
}

export const TerminalNode = memo(TerminalNodeInner)
