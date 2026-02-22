import { memo, useState, useRef, useEffect } from 'react'
import { type NodeProps, Handle, Position } from '@xyflow/react'
import { Timer, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NodeStatusBar } from './node-status-bar'

export interface DelayNodeData {
  label: string
  config: { seconds?: number }
  isRunning?: boolean
  runtimeStatus?: string
  onEditConfig: (nodeId: string, config: { seconds?: number }) => void
  [key: string]: unknown
}

function DelayNodeInner({ id, data, selected }: NodeProps): React.ReactElement {
  const { label, config, isRunning, runtimeStatus, onEditConfig } = data as unknown as DelayNodeData
  const seconds = config?.seconds ?? 1

  const [editing, setEditing] = useState(false)
  const [editSeconds, setEditSeconds] = useState(seconds)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      setEditSeconds(seconds)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [editing])

  const handleSave = (): void => {
    const clamped = Math.max(0.1, editSeconds)
    onEditConfig(id, { seconds: clamped })
    setEditing(false)
  }

  const handleCancel = (): void => {
    setEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    }
    if (e.key === 'Escape') {
      handleCancel()
    }
  }

  const formatDuration = (s: number): string => {
    if (s < 1) return `${Math.round(s * 1000)}ms`
    if (s < 60) return `${s}s`
    const mins = Math.floor(s / 60)
    const rem = s % 60
    return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`
  }

  return (
    <div
      className={cn(
        'w-[160px] rounded-lg border bg-card p-3 shadow-sm transition-all hover:shadow-md',
        selected && 'ring-2 ring-primary',
        isRunning && 'border-blue-500 shadow-blue-500/20 shadow-md'
      )}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (!editing) setEditing(true)
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-muted-foreground !border-2 !border-background"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-muted-foreground !border-2 !border-background"
      />

      <div className="flex items-center gap-2 mb-1.5">
        <Timer className={cn('h-3.5 w-3.5 shrink-0', isRunning ? 'text-blue-500 animate-pulse' : 'text-blue-400')} />
        <span className="text-xs font-medium truncate flex-1">{label || 'Delay'}</span>
      </div>

      {editing ? (
        <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1.5">
            <input
              ref={inputRef}
              type="number"
              min={0.1}
              step={0.5}
              value={editSeconds}
              onChange={(e) => setEditSeconds(parseFloat(e.target.value) || 0)}
              onKeyDown={handleKeyDown}
              className="w-full rounded border bg-background px-1.5 py-1 text-[11px] outline-none focus:ring-1 focus:ring-ring/50"
            />
            <span className="text-[10px] text-muted-foreground shrink-0">sec</span>
          </div>
          <div className="flex justify-end gap-1">
            <button
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted"
              onClick={handleCancel}
            >
              <X className="h-3 w-3" />
            </button>
            <button
              className="flex h-5 w-5 items-center justify-center rounded text-primary hover:bg-primary/10"
              onClick={handleSave}
            >
              <Check className="h-3 w-3" />
            </button>
          </div>
        </div>
      ) : (
        <p className={cn(
          'text-[11px] font-mono tabular-nums',
          isRunning ? 'text-blue-500' : 'text-muted-foreground'
        )}>
          {isRunning ? 'Waiting...' : formatDuration(seconds)}
        </p>
      )}

      <NodeStatusBar status={runtimeStatus} isRunning={isRunning} className="mt-2" />
    </div>
  )
}

export const DelayNode = memo(DelayNodeInner)
