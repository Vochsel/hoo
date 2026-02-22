import { memo, useState, useRef, useEffect } from 'react'
import { type NodeProps, Handle, Position } from '@xyflow/react'
import { Sparkles, Loader2, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NodeStatusBar } from './node-status-bar'

export interface AiPromptNodeData {
  label: string
  config: { prompt?: string; lastOutput?: string }
  isRunning?: boolean
  runtimeStatus?: string
  onEditPrompt: (nodeId: string, prompt: string) => void
  [key: string]: unknown
}

function AiPromptNodeInner({ id, data, selected }: NodeProps): React.ReactElement {
  const { label, config, isRunning, runtimeStatus, onEditPrompt } = data as unknown as AiPromptNodeData
  const promptText = config?.prompt || ''
  const lastOutput = config?.lastOutput || ''

  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(promptText)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing) {
      setEditValue(promptText)
      setTimeout(() => {
        textareaRef.current?.focus()
        textareaRef.current?.select()
      }, 0)
    }
  }, [editing])

  const handleSave = (): void => {
    onEditPrompt(id, editValue)
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
        selected && 'ring-2 ring-primary',
        isRunning && 'border-purple-500/50 shadow-purple-500/10 shadow-md'
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
        className="!w-3 !h-3 !bg-purple-500 !border-2 !border-purple-300"
      />

      <div className="flex items-center gap-2 mb-1.5">
        {isRunning ? (
          <Loader2 className="h-3.5 w-3.5 text-purple-500 animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5 text-purple-500" />
        )}
        <span className="text-xs font-medium truncate">{label || 'AI Prompt'}</span>
      </div>

      {editing ? (
        <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
          <textarea
            ref={textareaRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter your prompt..."
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
          {promptText ? (
            <p className="text-[10px] text-muted-foreground truncate mb-1" title={promptText}>
              {promptText}
            </p>
          ) : (
            <p className="text-[10px] text-muted-foreground/50 italic mb-1">
              Double-click to set prompt
            </p>
          )}

          {lastOutput && (
            <div className="mt-1.5 rounded bg-muted/50 p-1.5">
              <p className="text-[10px] text-foreground/70 line-clamp-3" title={lastOutput}>
                {lastOutput}
              </p>
            </div>
          )}
        </>
      )}

      <NodeStatusBar status={runtimeStatus} isRunning={isRunning} className="mt-2" />
    </div>
  )
}

export const AiPromptNode = memo(AiPromptNodeInner)
