import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { type NodeProps } from '@xyflow/react'
import { File, FolderOpen, Save, ArrowDownToLine, ArrowUpToLine, AlertTriangle } from 'lucide-react'
import { marked } from 'marked'
import { Button } from '@/components/ui/button'
import { HandleWithTooltip } from './handle-with-tooltip'
import { useFlowDirection, getSourcePosition, getTargetPosition } from './flow-direction-context'
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
import { NodeExecutionFooter } from './node-status-bar'

export interface FileNodeConfig {
  filePath?: string
  writeMode?: 'overwrite' | 'append'
  lastOperation?: 'read' | 'write'
  lastRunAt?: string
  lastBytes?: number
  lastError?: string | null
  lastReadPreview?: string
}

export interface FileNodeData {
  label: string
  config: FileNodeConfig
  isRunning?: boolean
  runtimeStatus?: string
  onEditConfig: (nodeId: string, config: FileNodeConfig) => void | Promise<void>
  onPickFile: (
    nodeId: string,
    mode: 'open' | 'save',
    defaultPath?: string
  ) => Promise<string | null>
  [key: string]: unknown
}

function getFileExtension(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  return dot >= 0 ? filePath.slice(dot).toLowerCase() : ''
}

function FileNodeInner({ id, data, selected }: NodeProps): React.ReactElement {
  const { label, config, isRunning, runtimeStatus, onEditConfig, onPickFile } = data as unknown as FileNodeData
  const filePath = config?.filePath || ''
  const writeMode = config?.writeMode === 'append' ? 'append' : 'overwrite'

  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [picking, setPicking] = useState<'open' | 'save' | null>(null)
  const [editPath, setEditPath] = useState(filePath)
  const [editWriteMode, setEditWriteMode] = useState<'overwrite' | 'append'>(writeMode)

  // Live preview state
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const watchedPathRef = useRef<string | null>(null)

  useEffect(() => {
    if (!open) return
    setEditPath(filePath)
    setEditWriteMode(writeMode)
  }, [open, filePath, writeMode])

  // Watch file for live preview
  useEffect(() => {
    if (!filePath) {
      setFileContent(null)
      setFileError(null)
      return
    }

    let cancelled = false
    watchedPathRef.current = filePath

    window.api.graphNodes.watchFile(filePath).then((result) => {
      if (cancelled) return
      if (result.error) {
        setFileError(result.error)
        setFileContent(null)
      } else {
        setFileContent(result.content)
        setFileError(null)
      }
    })

    const cleanup = window.api.graphNodes.onFileChanged((data) => {
      if (data.filePath === filePath && !cancelled) {
        setFileContent(data.content)
        setFileError(null)
      }
    })

    return () => {
      cancelled = true
      cleanup()
      window.api.graphNodes.unwatchFile(filePath)
      watchedPathRef.current = null
    }
  }, [filePath])

  const ext = useMemo(() => getFileExtension(filePath), [filePath])

  const renderedHtml = useMemo(() => {
    if (!fileContent || ext !== '.md') return null
    return marked.parse(fileContent, { gfm: true, breaks: true }) as string
  }, [fileContent, ext])

  const handlePick = async (mode: 'open' | 'save'): Promise<void> => {
    setPicking(mode)
    try {
      const selectedPath = await onPickFile(id, mode, editPath)
      if (selectedPath) setEditPath(selectedPath)
    } finally {
      setPicking(null)
    }
  }

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    try {
      const normalizedPath = editPath.trim()
      await Promise.resolve(
        onEditConfig(id, {
          ...config,
          filePath: normalizedPath || undefined,
          writeMode: editWriteMode
        })
      )
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
          'w-[300px] rounded-lg border bg-card p-3 shadow-sm transition-all hover:shadow-md',
          selected && 'ring-2 ring-primary'
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
          label="File contents"
          type="source"
          position={sourcePos}
          className="!w-3 !h-3 !bg-cyan-500 !border-2 !border-cyan-300"
        />

        <div className="mb-1.5 flex items-center gap-2">
          <File className="h-3.5 w-3.5 text-cyan-500 shrink-0" />
          <span className="text-xs font-medium truncate">{label || 'File'}</span>
        </div>

        {filePath ? (
          <p className="text-[10px] text-foreground/80 truncate" title={filePath}>
            {filePath}
          </p>
        ) : (
          <p className="text-[10px] text-muted-foreground/60 italic">
            Double-click to choose file
          </p>
        )}

        <p className="mt-1 text-[10px] text-muted-foreground/70">
          Write mode: <span className="font-medium">{writeMode}</span>
        </p>

        {/* Live file preview */}
        {filePath && fileError && (
          <p className="mt-1.5 text-[10px] text-destructive/90 line-clamp-2" title={fileError}>
            {fileError}
          </p>
        )}
        {filePath && fileContent !== null && !fileError && (
          <div className="mt-1.5 max-h-[200px] overflow-y-auto rounded border border-border/40 bg-muted/30 p-1.5 text-[10px]">
            {ext === '.md' && renderedHtml ? (
              <div
                className="prose prose-xs dark:prose-invert max-w-none text-[10px] leading-relaxed [&_h1]:text-xs [&_h2]:text-[11px] [&_h3]:text-[10px] [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0 [&_pre]:text-[9px] [&_code]:text-[9px]"
                dangerouslySetInnerHTML={{ __html: renderedHtml }}
              />
            ) : ext === '.html' ? (
              <div
                className="prose prose-xs dark:prose-invert max-w-none text-[10px] leading-relaxed"
                dangerouslySetInnerHTML={{ __html: fileContent }}
              />
            ) : (
              <pre className="whitespace-pre-wrap break-all font-mono text-[10px] text-foreground/80">
                {fileContent.length > 5000 ? fileContent.slice(0, 5000) + '\n...' : fileContent}
              </pre>
            )}
          </div>
        )}
        {filePath && fileContent === null && !fileError && (
          <p className="mt-1.5 text-[10px] text-muted-foreground/50 italic">Loading...</p>
        )}

        {/* Legacy status info (when no live preview) */}
        {!filePath && config?.lastError && (
          <p className="mt-1 text-[10px] text-destructive/90 line-clamp-2" title={config.lastError}>
            {config.lastError}
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
          className="sm:max-w-[560px]"
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>File Node</DialogTitle>
            <DialogDescription>
              If the node receives input, it writes to file. If it has no input, it reads file content.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground/80">File path</label>
              <Input
                value={editPath}
                onChange={(e) => setEditPath(e.target.value)}
                placeholder="/path/to/file.md"
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => void handlePick('open')}
                  disabled={picking !== null}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  {picking === 'open' ? 'Choosing...' : 'Choose Existing'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => void handlePick('save')}
                  disabled={picking !== null}
                >
                  <Save className="h-3.5 w-3.5" />
                  {picking === 'save' ? 'Choosing...' : 'Choose Destination'}
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground/80">When writing</label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={editWriteMode === 'overwrite' ? 'default' : 'outline'}
                  className="gap-1.5"
                  onClick={() => setEditWriteMode('overwrite')}
                >
                  <ArrowUpToLine className="h-3.5 w-3.5" />
                  Overwrite
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={editWriteMode === 'append' ? 'default' : 'outline'}
                  className="gap-1.5"
                  onClick={() => setEditWriteMode('append')}
                >
                  <ArrowDownToLine className="h-3.5 w-3.5" />
                  Append
                </Button>
              </div>
            </div>

            <div className="rounded-md border bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground/80">
              <div className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                <p>
                  Upstream usage: place this node early in the graph to read file content into downstream nodes.
                  Downstream usage: connect prompt/text/output into this node to write results to disk.
                </p>
              </div>
            </div>
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

export const FileNode = memo(FileNodeInner)
