import { memo, useState, useRef, useEffect } from 'react'
import { type NodeProps, Handle, Position } from '@xyflow/react'
import { Type, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface TextNodeData {
  label: string
  config: { text?: string }
  onEditText: (nodeId: string, text: string) => void
  [key: string]: unknown
}

function TextNodeInner({ id, data, selected }: NodeProps): React.ReactElement {
  const { label, config, onEditText } = data as unknown as TextNodeData
  const textContent = config?.text || ''

  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(textContent)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing) {
      setEditValue(textContent)
      setTimeout(() => {
        textareaRef.current?.focus()
        textareaRef.current?.select()
      }, 0)
    }
  }, [editing])

  const handleSave = (): void => {
    onEditText(id, editValue)
    setEditing(false)
  }

  const handleCancel = (): void => {
    setEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSave()
    }
    if (e.key === 'Escape') {
      handleCancel()
    }
  }

  return (
    <div
      className={cn(
        'w-[220px] rounded-lg border bg-card p-3 shadow-sm transition-all hover:shadow-md',
        selected && 'ring-2 ring-primary'
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
        className="!w-3 !h-3 !bg-blue-500 !border-2 !border-blue-300"
      />

      <div className="flex items-center gap-2 mb-1.5">
        <Type className="h-3.5 w-3.5 text-blue-500" />
        <span className="text-xs font-medium truncate">{label || 'Text'}</span>
      </div>

      {editing ? (
        <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
          <textarea
            ref={textareaRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter text content..."
            rows={3}
            className="w-full rounded border bg-background px-1.5 py-1 text-[11px] outline-none focus:ring-1 focus:ring-ring/50 resize-none"
          />
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-muted-foreground/50">Cmd+Enter to save</span>
            <div className="flex gap-1">
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
        </div>
      ) : (
        <>
          {textContent ? (
            <p className="text-[10px] text-muted-foreground line-clamp-3" title={textContent}>
              {textContent}
            </p>
          ) : (
            <p className="text-[10px] text-muted-foreground/50 italic">
              Double-click to set text
            </p>
          )}
        </>
      )}
    </div>
  )
}

export const TextNode = memo(TextNodeInner)
