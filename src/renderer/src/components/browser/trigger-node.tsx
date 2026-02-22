import { memo } from 'react'
import { type NodeProps, Handle, Position } from '@xyflow/react'
import { Play } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface TriggerNodeData {
  label: string
  onTrigger: (nodeId: string) => void
  [key: string]: unknown
}

function TriggerNodeInner({ id, data, selected }: NodeProps): React.ReactElement {
  const { label, onTrigger } = data as unknown as TriggerNodeData

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-full border-2 bg-primary px-4 py-2 shadow-sm transition-all hover:shadow-md cursor-pointer select-none',
        selected ? 'ring-2 ring-primary/50 ring-offset-2' : 'border-primary'
      )}
      onClick={(e) => {
        e.stopPropagation()
        onTrigger(id)
      }}
    >
      <Play className="h-4 w-4 text-primary-foreground fill-primary-foreground" />
      <span className="text-xs font-semibold text-primary-foreground">{label || 'Run'}</span>

      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-primary-foreground !border-2 !border-primary"
      />
    </div>
  )
}

export const TriggerNode = memo(TriggerNodeInner)
