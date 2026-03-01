import { memo, useState, useRef, useEffect } from 'react'
import { type NodeProps, Position } from '@xyflow/react'
import { Bell, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NodeExecutionFooter } from './node-status-bar'
import { HandleWithTooltip } from './handle-with-tooltip'
import { useFlowDirection, getTargetPosition } from './flow-direction-context'

export interface NotificationNodeData {
  label: string
  config: { title?: string; body?: string; playSound?: boolean }
  isRunning?: boolean
  runtimeStatus?: string
  onEditConfig: (nodeId: string, config: { title?: string; body?: string; playSound?: boolean }) => void
  [key: string]: unknown
}

function NotificationNodeInner({ id, data, selected }: NodeProps): React.ReactElement {
  const { label, config, isRunning, runtimeStatus, onEditConfig } = data as unknown as NotificationNodeData
  const title = config?.title || ''
  const body = config?.body || ''
  const playSound = config?.playSound ?? true

  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(title)
  const [editBody, setEditBody] = useState(body)
  const [editPlaySound, setEditPlaySound] = useState(playSound)
  const titleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      setEditTitle(title)
      setEditBody(body)
      setEditPlaySound(playSound)
      setTimeout(() => titleInputRef.current?.focus(), 0)
    }
  }, [editing])

  const handleSave = (): void => {
    onEditConfig(id, { title: editTitle, body: editBody, playSound: editPlaySound })
    setEditing(false)
  }

  const handleCancel = (): void => {
    setEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSave()
    }
    if (e.key === 'Escape') {
      handleCancel()
    }
  }

  const direction = useFlowDirection()
  const targetPos = getTargetPosition(direction)

  return (
    <div
      className={cn(
        'w-[200px] rounded-lg border bg-card p-3 shadow-sm transition-all hover:shadow-md',
        selected && 'ring-2 ring-primary'
      )}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (!editing) setEditing(true)
      }}
    >
      <HandleWithTooltip
        label="Input"
        type="target"
        position={targetPos}
        className="!w-3 !h-3 !bg-muted-foreground !border-2 !border-background"
      />

      <div className="flex items-center gap-2 mb-1.5">
        <Bell className="h-3.5 w-3.5 text-amber-500 shrink-0" />
        <span className="text-xs font-medium truncate flex-1">{label || 'Notify'}</span>
      </div>

      {editing ? (
        <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
          <input
            ref={titleInputRef}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Title"
            className="w-full rounded border bg-background px-1.5 py-1 text-[11px] outline-none focus:ring-1 focus:ring-ring/50"
          />
          <textarea
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Body text..."
            rows={2}
            className="w-full rounded border bg-background px-1.5 py-1 text-[11px] outline-none focus:ring-1 focus:ring-ring/50 resize-none"
          />
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={editPlaySound}
              onChange={(e) => setEditPlaySound(e.target.checked)}
              className="h-3 w-3 rounded border accent-amber-500"
            />
            <span className="text-[10px] text-muted-foreground">Play sound</span>
          </label>
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
        <div className="space-y-0.5">
          {title ? (
            <p className="text-[10px] font-medium text-foreground/80 truncate">{title}</p>
          ) : (
            <p className="text-[10px] text-muted-foreground/50 italic">Double-click to edit</p>
          )}
          {body && (
            <p className="text-[10px] text-muted-foreground truncate">{body}</p>
          )}
        </div>
      )}

      <NodeExecutionFooter
        status={runtimeStatus}
        isRunning={isRunning}
        className="-mb-3 -mx-3 mt-2 px-3 py-1.5"
      />
    </div>
  )
}

export const NotificationNode = memo(NotificationNodeInner)
