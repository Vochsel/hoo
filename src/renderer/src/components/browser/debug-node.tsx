import { memo, useState, useEffect, useRef } from 'react'
import { type NodeProps, Handle, Position } from '@xyflow/react'
import { Bug } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface DebugNodeData {
  label: string
  activated?: boolean
  [key: string]: unknown
}

function DebugNodeInner({ data, selected }: NodeProps): React.ReactElement {
  const { label, activated } = data as unknown as DebugNodeData
  const [lit, setLit] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (activated) {
      setLit(true)
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setLit(false), 5000)
    }
  }, [activated])

  useEffect(() => {
    return (): void => {
      clearTimeout(timerRef.current)
    }
  }, [])

  return (
    <div
      className={cn(
        'w-[140px] rounded-lg border bg-card p-3 shadow-sm transition-all',
        selected && 'ring-2 ring-primary',
        lit && 'border-emerald-500 shadow-emerald-500/20 shadow-md'
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-muted-foreground !border-2 !border-background"
      />

      <div className="flex items-center gap-2">
        <div
          className={cn(
            'h-3 w-3 rounded-full border-2 transition-colors duration-300',
            lit
              ? 'bg-emerald-500 border-emerald-400 shadow-sm shadow-emerald-500/50'
              : 'bg-muted border-muted-foreground/30'
          )}
        />
        <Bug className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium truncate">{label || 'Debug'}</span>
      </div>
    </div>
  )
}

export const DebugNode = memo(DebugNodeInner)
