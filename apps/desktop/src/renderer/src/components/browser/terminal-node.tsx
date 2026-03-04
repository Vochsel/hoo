import { memo } from 'react'
import { type NodeProps } from '@xyflow/react'
import { Terminal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NodeExecutionFooter } from './node-status-bar'
import { HandleWithTooltip } from './handle-with-tooltip'
import { useFlowDirection, getSourcePosition, getTargetPosition } from './flow-direction-context'
import { TerminalPreview } from './terminal-preview'

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

function TerminalNodeInner({ id, data, selected }: NodeProps): React.ReactElement {
  const { label, config, isRunning, runtimeStatus } = data as unknown as TerminalNodeData
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
      {/* Live terminal preview */}
      <TerminalPreview
        sessionId={`pty-${id}`}
        className="w-full h-[100px] rounded-t-lg overflow-hidden"
        fontSize={9}
      />

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
