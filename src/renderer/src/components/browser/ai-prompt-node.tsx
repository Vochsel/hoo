import { memo, useEffect, useMemo, useState } from 'react'
import { type NodeProps, Position } from '@xyflow/react'
import { Sparkles, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useFlowDirection, getSourcePosition, getTargetPosition } from './flow-direction-context'
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
import { HandleWithTooltip } from './handle-with-tooltip'

export interface AiPromptNodeData {
  label: string
  config: { prompt?: string; lastOutput?: string }
  isRunning?: boolean
  runtimeStatus?: string
  onEditPrompt: (nodeId: string, prompt: string) => void | Promise<void>
  [key: string]: unknown
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderInlineMarkdown(value: string): string {
  let out = escapeHtml(value)
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
  out = out.replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
  out = out.replace(/_([^_\n]+)_/g, '<em>$1</em>')
  out = out.replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
  out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>')
  return out
}

function markdownToHtml(value: string): string {
  const lines = value.replace(/\r\n/g, '\n').split('\n')
  const htmlParts: string[] = []
  let listType: 'ul' | 'ol' | null = null

  const closeList = (): void => {
    if (!listType) return
    htmlParts.push(`</${listType}>`)
    listType = null
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      closeList()
      continue
    }

    const codeFence = line.match(/^```(.*)$/)
    if (codeFence) {
      closeList()
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      closeList()
      const level = heading[1].length
      htmlParts.push(`<h${level}>${renderInlineMarkdown(heading[2].trim())}</h${level}>`)
      continue
    }

    const ul = line.match(/^\s*[-*]\s+(.*)$/)
    if (ul) {
      if (listType !== 'ul') {
        closeList()
        htmlParts.push('<ul>')
        listType = 'ul'
      }
      htmlParts.push(`<li>${renderInlineMarkdown(ul[1].trim())}</li>`)
      continue
    }

    const ol = line.match(/^\s*\d+\.\s+(.*)$/)
    if (ol) {
      if (listType !== 'ol') {
        closeList()
        htmlParts.push('<ol>')
        listType = 'ol'
      }
      htmlParts.push(`<li>${renderInlineMarkdown(ol[1].trim())}</li>`)
      continue
    }

    const quote = line.match(/^\s*>\s?(.*)$/)
    if (quote) {
      closeList()
      htmlParts.push(`<blockquote>${renderInlineMarkdown(quote[1].trim())}</blockquote>`)
      continue
    }

    closeList()
    htmlParts.push(`<p>${renderInlineMarkdown(line.trim())}</p>`)
  }

  closeList()
  return htmlParts.join('')
}

function renderMarkdownPreviewHtml(value: string): string {
  const looksLikeMarkdown =
    /(^|\n)\s{0,3}(#{1,6}\s|[-*]\s|\d+\.\s|>\s)|\*\*|__|~~|`[^`\n]+`|\[[^\]]+\]\([^)]+\)/m.test(value)
  if (!looksLikeMarkdown) {
    return `<p>${escapeHtml(value).replace(/\n/g, '<br>')}</p>`
  }
  return markdownToHtml(value)
}

function AiPromptNodeInner({ id, data, selected }: NodeProps): React.ReactElement {
  const { label, config, isRunning, runtimeStatus, onEditPrompt } = data as unknown as AiPromptNodeData
  const promptText = config?.prompt || ''
  const lastOutput = config?.lastOutput || ''
  const lastOutputHtml = useMemo(() => renderMarkdownPreviewHtml(lastOutput), [lastOutput])

  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editValue, setEditValue] = useState(promptText)

  useEffect(() => {
    if (open) {
      setEditValue(promptText)
    }
  }, [open, promptText])

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    try {
      await Promise.resolve(onEditPrompt(id, editValue))
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  const direction = useFlowDirection()
  const sourcePos = getSourcePosition(direction)
  const targetPos = getTargetPosition(direction)

  return (
    <>
      <div
        className={cn(
          'w-[220px] rounded-lg border bg-card p-3 shadow-sm transition-all hover:shadow-md',
          selected && 'ring-2 ring-primary',
          isRunning && 'border-purple-500/50 shadow-purple-500/10 shadow-md'
        )}
        onDoubleClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
      >
        <HandleWithTooltip
          label="Input"
          type="target"
          position={targetPos}
          className="!w-3 !h-3 !bg-muted-foreground !border-2 !border-background"
        />
        <HandleWithTooltip
          label="Response"
          type="source"
          position={sourcePos}
          className="!w-3 !h-3 !bg-purple-500 !border-2 !border-purple-300"
        />

        <div className="mb-1.5 flex items-center gap-2">
          {isRunning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-purple-500" />
          ) : (
            <Sparkles className="h-3.5 w-3.5 text-purple-500" />
          )}
          <span className="truncate text-xs font-medium">{label || 'AI Prompt'}</span>
        </div>

        {lastOutput ? (
          <div className="mt-1.5 rounded bg-muted/50 p-1.5">
            <div
              className="max-h-32 overflow-y-auto break-words text-[10px] text-foreground/70 [&_a]:text-emerald-600 [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:border-l-2 [&_blockquote]:border-emerald-500/40 [&_blockquote]:pl-2 [&_blockquote]:italic [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_h1]:text-[11px] [&_h1]:font-semibold [&_h2]:text-[11px] [&_h2]:font-semibold [&_h3]:text-[10px] [&_h3]:font-semibold [&_li]:leading-snug [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:mb-1 [&_ul]:list-disc [&_ul]:pl-4"
              dangerouslySetInnerHTML={{ __html: lastOutputHtml }}
            />
          </div>
        ) : (
          <p className="mt-1 text-[10px] italic text-muted-foreground/50">No recent output</p>
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
            <DialogTitle>AI Prompt</DialogTitle>
            <DialogDescription>Edit the prompt used by this node.</DialogDescription>
          </DialogHeader>

          <textarea
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            placeholder="Enter your prompt..."
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

export const AiPromptNode = memo(AiPromptNodeInner)
