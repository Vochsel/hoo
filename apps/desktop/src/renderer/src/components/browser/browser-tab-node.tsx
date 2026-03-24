import { memo } from 'react'
import { type NodeProps, NodeResizer } from '@xyflow/react'
import { ExternalLink, Globe, Loader2, Radio, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BrowserTab, BrowserTabMonitor } from '@/hooks/use-browser-tabs'
import { BrowserFavicon } from './browser-favicon'
import { BrowserTabContent } from './browser-tab-content'
import { NodeExecutionFooter } from './node-status-bar'

const MIN_WIDTH = 420
const MIN_HEIGHT = 320

export interface BrowserTabNodeData {
  tab: BrowserTab
  title: string
  url: string
  favicon: string | null
  screenshot: string | null
  monitors: BrowserTabMonitor[]
  isRunning?: boolean
  hasNotification?: boolean
  runtimeStatus?: string
  runtimeOutput?: string
  isInteractive?: boolean
  isResizing?: boolean
  reloadNonce?: number
  onClose: (id: string) => void
  onOpen?: (id: string) => void
  onActivate?: (id: string) => void
  onResize?: (id: string, width: number, height: number) => void
  onResizeStateChange?: (id: string, isResizing: boolean) => void
  onTabUpdate: (id: string, data: Record<string, unknown>) => Promise<unknown>
  onWebviewStateChange?: (tabId: string, webview: Electron.WebviewTag | null) => void
  [key: string]: unknown
}

function BrowserTabNodeInner({ id, data, selected }: NodeProps): React.ReactElement {
  const {
    tab,
    title,
    favicon,
    screenshot,
    monitors,
    isRunning,
    hasNotification,
    runtimeStatus,
    runtimeOutput,
    isInteractive,
    isResizing,
    reloadNonce,
    onClose,
    onOpen,
    onResize,
    onResizeStateChange,
    onTabUpdate,
    onWebviewStateChange
  } = data as unknown as BrowserTabNodeData
  const enabledMonitors = monitors?.filter((monitor) => monitor.enabled) ?? []

  return (
    <div
      className={cn(
        'group flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md',
        selected && 'ring-2 ring-primary'
      )}
    >
      <NodeResizer
        minWidth={MIN_WIDTH}
        minHeight={MIN_HEIGHT}
        isVisible={selected}
        autoScale={false}
        lineStyle={{ borderColor: 'hsl(var(--border))', opacity: 0.65 }}
        handleStyle={{
          width: 10,
          height: 10,
          borderRadius: 9999,
          border: '1px solid hsl(var(--border))',
          background: 'hsl(var(--background))'
        }}
        onResizeStart={() => onResizeStateChange?.(id, true)}
        onResizeEnd={(_, params) => {
          onResize?.(id, params.width, params.height)
          onResizeStateChange?.(id, false)
        }}
      />

      <div className="canvas-node-drag-handle flex h-9 shrink-0 items-center gap-2 border-b bg-background/95 px-2.5">
        <BrowserFavicon
          src={favicon}
          imgClassName="h-3.5 w-3.5 shrink-0"
          iconClassName="h-3.5 w-3.5 shrink-0 text-muted-foreground"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">{title || 'New Tab'}</p>
        </div>
        {enabledMonitors.length > 0 && (
          <div className="flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600">
            <Radio className="h-2.5 w-2.5" />
            <span>{enabledMonitors.length}</span>
          </div>
        )}
        {hasNotification && !isRunning && <div className="h-2 w-2 rounded-full bg-blue-500" />}
        <button
          type="button"
          className="nodrag inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation()
            onOpen?.(id)
          }}
          title="Open tab"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="nodrag inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation()
            onClose(id)
          }}
          title="Close tab"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {isInteractive ? (
          <div className={cn('nodrag nopan nowheel flex min-h-0 flex-1', isResizing && 'pointer-events-none select-none')}>
            <BrowserTabContent
              tab={tab}
              onTabUpdate={onTabUpdate}
              active
              reloadNonce={reloadNonce ?? 0}
              onWebviewStateChange={onWebviewStateChange}
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center bg-muted">
            {screenshot ? (
              <img
                src={screenshot}
                alt={title}
                draggable={false}
                className="h-full w-full object-cover object-top"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                {isRunning ? (
                  <Loader2 className="h-8 w-8 animate-spin text-primary/70" />
                ) : (
                  <Globe className="h-8 w-8 text-muted-foreground/40" />
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <NodeExecutionFooter
        status={runtimeStatus}
        isRunning={isRunning}
        runtimeOutput={runtimeOutput}
        className="shrink-0 px-2.5 py-1.5"
      />
    </div>
  )
}

export const BrowserTabNode = memo(BrowserTabNodeInner)
