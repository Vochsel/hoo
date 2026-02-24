import { memo, useEffect, useMemo, useState } from 'react'
import { type NodeProps, Handle, Position } from '@xyflow/react'
import { CalendarClock, Play, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { resolveScheduleCron } from '@/lib/schedule-cron'
import { NodeExecutionFooter } from './node-status-bar'

export interface ScheduleTriggerConfig {
  prompt?: string
  cron?: string
  enabled?: boolean
}

export interface ScheduleTriggerNodeData {
  label: string
  config: ScheduleTriggerConfig
  isRunning?: boolean
  runtimeStatus?: string
  onEditConfig: (nodeId: string, config: ScheduleTriggerConfig) => void | Promise<void>
  onTriggerNow?: (nodeId: string) => void
  [key: string]: unknown
}

function ScheduleTriggerNodeInner({ id, data, selected }: NodeProps): React.ReactElement {
  const { label, config, isRunning, runtimeStatus, onEditConfig, onTriggerNow } = data as unknown as ScheduleTriggerNodeData
  const prompt = config?.prompt ?? ''
  const cron = config?.cron ?? ''
  const enabled = config?.enabled !== false

  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editPrompt, setEditPrompt] = useState(prompt)
  const [editCron, setEditCron] = useState(cron)
  const [editEnabled, setEditEnabled] = useState(enabled)

  useEffect(() => {
    if (!open) return
    setEditPrompt(prompt)
    setEditCron(cron)
    setEditEnabled(enabled)
  }, [open, prompt, cron, enabled])

  const currentResolved = useMemo(() => resolveScheduleCron(prompt, cron), [prompt, cron])
  const editResolved = useMemo(() => resolveScheduleCron(editPrompt, editCron), [editPrompt, editCron])
  const resolvedCron = currentResolved.cron

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    try {
      const promptValue = editPrompt.trim()
      const cronValue = editCron.trim()
      const resolved = resolveScheduleCron(promptValue, cronValue)
      await Promise.resolve(
        onEditConfig(id, {
          ...config,
          prompt: promptValue || undefined,
          // Keep explicit user cron if present; otherwise persist inferred cron from prompt.
          cron: cronValue || resolved.cron || undefined,
          enabled: editEnabled
        })
      )
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div
        className={cn(
          'w-[250px] rounded-lg border bg-card p-3 shadow-sm transition-all hover:shadow-md',
          selected && 'ring-2 ring-primary',
          isRunning && 'border-indigo-500 shadow-indigo-500/20 shadow-md',
          enabled ? 'border-indigo-200/60' : 'border-muted'
        )}
        onDoubleClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
      >
        <Handle
          type="source"
          position={Position.Right}
          className="!h-3 !w-3 !border-2 !border-indigo-300 !bg-indigo-500"
        />

        <div className="mb-1.5 flex items-center gap-2">
          <CalendarClock className={cn('h-3.5 w-3.5 shrink-0', enabled ? 'text-indigo-500' : 'text-muted-foreground')} />
          <span className="flex-1 truncate text-xs font-medium">{label || 'Schedule Trigger'}</span>
          <span
            className={cn(
              'rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
              enabled ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground'
            )}
          >
            {enabled ? 'On' : 'Off'}
          </span>
        </div>

        {resolvedCron ? (
          <code className="block truncate rounded border bg-muted/40 px-1.5 py-1 font-mono text-[11px] text-foreground/85" title={resolvedCron}>
            {resolvedCron}
          </code>
        ) : (
          <p className="text-[10px] italic text-muted-foreground/70">Double-click to configure schedule</p>
        )}

        {prompt ? (
          <p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground" title={prompt}>
            {prompt}
          </p>
        ) : (
          <p className="mt-1 text-[10px] text-muted-foreground/50">No prompt set</p>
        )}

        {!resolvedCron && cron.trim() ? (
          <p className="mt-1 text-[10px] text-destructive/90 line-clamp-2" title={currentResolved.error}>
            {currentResolved.error}
          </p>
        ) : null}

        <div className="mt-2 flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-6 gap-1 px-2 text-[10px]"
            onClick={(e) => {
              e.stopPropagation()
              onTriggerNow?.(id)
            }}
          >
            <Play className="h-3 w-3" />
            Run now
          </Button>
        </div>

        <NodeExecutionFooter
          status={runtimeStatus}
          isRunning={isRunning}
          className="-mb-3 -mx-3 mt-2 px-3 py-1.5"
        />
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="sm:max-w-[560px]"
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>Schedule Trigger</DialogTitle>
            <DialogDescription>
              Enter a schedule prompt and/or a cron expression. This node fires graph execution when the cron matches.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground/80">Prompt</label>
              <textarea
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                placeholder='e.g. every 10 minutes, weekdays at 9:30am'
                rows={3}
                className="w-full resize-none rounded border bg-background px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-ring/50"
              />
              <p className="text-[10px] text-muted-foreground/80">
                If cron is empty, the app will infer one from this prompt.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground/80">Cron expression (5-part)</label>
              <Input
                value={editCron}
                onChange={(e) => setEditCron(e.target.value)}
                placeholder="*/10 * * * *"
              />
              {editResolved.cron ? (
                <p className="flex items-center gap-1 text-[10px] text-emerald-600">
                  <Sparkles className="h-3 w-3" />
                  Effective cron: <code className="font-mono">{editResolved.cron}</code>
                </p>
              ) : (
                <p className="text-[10px] text-destructive/90">{editResolved.error}</p>
              )}
            </div>

            <label className="flex items-center gap-2 text-xs text-foreground/85">
              <input
                type="checkbox"
                checked={editEnabled}
                onChange={(e) => setEditEnabled(e.target.checked)}
                className="h-3.5 w-3.5 rounded border accent-indigo-500"
              />
              Enabled
            </label>
          </div>

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

export const ScheduleTriggerNode = memo(ScheduleTriggerNodeInner)
