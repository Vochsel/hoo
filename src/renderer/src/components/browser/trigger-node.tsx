import { memo } from 'react'
import { type NodeProps, Handle, Position } from '@xyflow/react'
import { Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NodeExecutionFooter } from './node-status-bar'

export interface TriggerNodeData {
  label: string
  onTrigger: (nodeId: string) => void
  isRunning?: boolean
  runtimeStatus?: string
  [key: string]: unknown
}

function TriggerNodeInner({ id, data, selected }: NodeProps): React.ReactElement {
  const { label, onTrigger, isRunning, runtimeStatus } = data as unknown as TriggerNodeData

  return (
    <div
      className={cn(
        'w-[180px] rounded-lg border bg-card shadow-sm transition-all hover:shadow-md',
        selected && 'ring-2 ring-primary'
      )}
    >
      <button
        className="flex w-full cursor-pointer select-none items-center gap-2 rounded-t-lg bg-primary px-4 py-2 text-left transition-colors hover:bg-primary/90"
        onClick={(e) => {
          e.stopPropagation()
          onTrigger(id)
        }}
      >
        <Play className="h-4 w-4 fill-primary-foreground text-primary-foreground" />
        <span className="text-xs font-semibold text-primary-foreground">{label || 'Run'}</span>
      </button>

      <NodeExecutionFooter
        status={runtimeStatus}
        isRunning={isRunning}
        className="px-2.5 py-1.5"
      />

      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-primary !bg-primary-foreground"
      />
    </div>
  )
}

export const TriggerNode = memo(TriggerNodeInner)
