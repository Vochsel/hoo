import { memo, useEffect, useState } from 'react'
import { type NodeProps, Handle, Position } from '@xyflow/react'
import { NotebookPen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { NodeExecutionFooter } from './node-status-bar'

export interface TextNodeData {
  label: string
  config: { text?: string }
  isRunning?: boolean
  runtimeStatus?: string
  onEditText: (nodeId: string, text: string) => void
  [key: string]: unknown
}

function TextNodeInner({ id, data, selected }: NodeProps): React.ReactElement {
  const { label, config, isRunning, runtimeStatus, onEditText } = data as unknown as TextNodeData
  const textContent = config?.text || ''

  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editValue, setEditValue] = useState(textContent)

  useEffect(() => {
    if (open) {
      setEditValue(textContent)
    }
  }, [open, textContent])

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    try {
      await Promise.resolve(onEditText(id, editValue))
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div
        className={cn(
          'w-[220px] rounded-lg border bg-card p-3 shadow-sm transition-all hover:shadow-md',
          selected && 'ring-2 ring-primary'
        )}
        onDoubleClick={(e) => {
          e.stopPropagation()
          setOpen(true)
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
          className="!w-3 !h-3 !bg-sky-600 !border-2 !border-sky-300"
        />

        <div className="mb-1.5 flex items-center gap-2">
          <NotebookPen className="h-3.5 w-3.5 text-sky-600" />
          <span className="truncate text-xs font-medium">{label || 'Instructions'}</span>
        </div>

        {textContent ? (
          <p className="line-clamp-5 text-[10px] text-muted-foreground" title={textContent}>
            {textContent}
          </p>
        ) : (
          <p className="text-[10px] italic text-muted-foreground/60">
            Double-click to edit instructions
          </p>
        )}

        <NodeExecutionFooter
          status={runtimeStatus}
          isRunning={isRunning}
          className="-mb-3 -mx-3 mt-2 px-3 py-1.5"
        />
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="sm:max-w-[640px]"
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>Instructions</DialogTitle>
            <DialogDescription>Edit the instruction text for this node.</DialogDescription>
          </DialogHeader>

          <textarea
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            placeholder="Enter instructions..."
            rows={8}
            className="w-full resize-y rounded border bg-background px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-ring/50"
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export const TextNode = memo(TextNodeInner)
