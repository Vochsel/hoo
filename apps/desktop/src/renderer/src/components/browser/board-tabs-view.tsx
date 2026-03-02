import { useState, useCallback, useEffect, useImperativeHandle, forwardRef } from 'react'
import { Globe, Terminal, File, Plus, X } from 'lucide-react'
import { BrowserTabContent } from './browser-tab-content'
import { TerminalContent } from './terminal-content'
import { FileContent } from './file-content'
import type { BrowserTab } from '@/hooks/use-browser-tabs'
import type { GraphNode } from '@/hooks/use-graph-nodes'
import type { TerminalNodeConfig } from './terminal-node'
import type { FileNodeConfig } from './file-node'

type TabItem =
  | { kind: 'browser'; tab: BrowserTab }
  | { kind: 'terminal'; node: GraphNode }
  | { kind: 'file'; node: GraphNode }

export interface BoardTabsViewHandle {
  selectTab: (id: string) => void
}

interface BoardTabsViewProps {
  tabs: BrowserTab[]
  terminalNodes: GraphNode[]
  fileNodes: GraphNode[]
  activeBoardId: string | null
  onTabUpdate: (id: string, data: Record<string, unknown>) => Promise<unknown>
  onCreateTab: () => Promise<BrowserTab | void>
  onDeleteTab: (id: string) => void
  onOpenTab: (tab: BrowserTab) => void
  onOpenTerminal: (nodeId: string) => void
  onUpdateNode: (id: string, data: Record<string, unknown>) => Promise<unknown>
  workspaceRootDir?: string
  boardRootDir?: string | null
}

function parseNodeConfig(rawConfig: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawConfig)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export const BoardTabsView = forwardRef<BoardTabsViewHandle, BoardTabsViewProps>(function BoardTabsView({
  tabs,
  terminalNodes,
  fileNodes,
  activeBoardId,
  onTabUpdate,
  onCreateTab,
  onDeleteTab,
  onOpenTab,
  onOpenTerminal,
  onUpdateNode,
  workspaceRootDir,
  boardRootDir
}, ref): React.ReactElement {
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (tabs.length > 0) return tabs[0].id
    if (terminalNodes.length > 0) return terminalNodes[0].id
    if (fileNodes.length > 0) return fileNodes[0].id
    return null
  })

  useImperativeHandle(ref, () => ({
    selectTab: (id: string) => setSelectedId(id)
  }))

  const allItems: TabItem[] = [
    ...tabs.map((tab): TabItem => ({ kind: 'browser', tab })),
    ...terminalNodes.map((node): TabItem => ({ kind: 'terminal', node })),
    ...fileNodes.map((node): TabItem => ({ kind: 'file', node }))
  ]

  const selectedItem = allItems.find((item) => {
    if (item.kind === 'browser') return item.tab.id === selectedId
    return item.node.id === selectedId
  }) ?? null

  // Auto-select first tab if current selection disappears
  useEffect(() => {
    if (selectedId && !selectedItem && allItems.length > 0) {
      const first = allItems[0]
      setSelectedId(first.kind === 'browser' ? first.tab.id : first.node.id)
    }
  }, [selectedId, selectedItem, allItems])

  // Cmd+1-9 keyboard shortcuts to switch tabs
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (!e.metaKey && !e.ctrlKey) return
      const num = parseInt(e.key, 10)
      if (num < 1 || num > 9 || isNaN(num)) return
      const index = num - 1
      if (index >= allItems.length) return
      e.preventDefault()
      const target = allItems[index]
      setSelectedId(target.kind === 'browser' ? target.tab.id : target.node.id)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [allItems])

  const handleSelectTab = useCallback((id: string) => {
    setSelectedId(id)
  }, [])

  const handleCloseTab = useCallback((e: React.MouseEvent, id: string, kind: 'browser' | 'terminal' | 'file') => {
    e.stopPropagation()
    if (kind === 'browser') {
      onDeleteTab(id)
    }
    if (selectedId === id) {
      const remaining = allItems.filter((item) => {
        const itemId = item.kind === 'browser' ? item.tab.id : item.node.id
        return itemId !== id
      })
      setSelectedId(remaining.length > 0
        ? (remaining[0].kind === 'browser' ? remaining[0].tab.id : remaining[0].node.id)
        : null
      )
    }
  }, [selectedId, allItems, onDeleteTab])

  if (allItems.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
        <p className="text-sm">No tabs or terminals yet</p>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
          onClick={async () => {
            const newTab = await onCreateTab()
            if (newTab) setSelectedId(newTab.id)
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          New browser tab
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Tab bar */}
      <div className="flex items-end gap-0 border-b border-border/40 bg-muted/20 px-1 pt-1 overflow-x-auto">
        {allItems.map((item) => {
          const id = item.kind === 'browser' ? item.tab.id : item.node.id
          const isSelected = id === selectedId
          const title = item.kind === 'browser'
            ? (item.tab.title || item.tab.url || 'New Tab')
            : (item.node.label || (item.kind === 'terminal' ? 'Terminal' : 'File'))
          const favicon = item.kind === 'browser' ? item.tab.favicon : null

          return (
            <button
              key={id}
              type="button"
              className={`group relative flex max-w-[200px] items-center gap-1.5 rounded-t-md px-3 py-1.5 text-xs transition-colors ${
                isSelected
                  ? 'bg-background border border-border/60 border-b-background -mb-px z-10 font-medium'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              }`}
              onClick={() => handleSelectTab(id)}
              onDoubleClick={() => {
                if (item.kind === 'browser') onOpenTab(item.tab)
                else if (item.kind === 'terminal') onOpenTerminal(item.node.id)
              }}
              title={title}
            >
              {item.kind === 'browser' ? (
                favicon ? (
                  <img src={favicon} alt="" className="h-3.5 w-3.5 shrink-0 rounded-sm" />
                ) : (
                  <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )
              ) : item.kind === 'terminal' ? (
                <Terminal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <File className="h-3.5 w-3.5 shrink-0 text-cyan-500" />
              )}
              <span className="truncate">{title}</span>
              {item.kind === 'browser' && (
                <span
                  role="button"
                  className="ml-1 shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
                  onClick={(e) => handleCloseTab(e, id, item.kind)}
                >
                  <X className="h-3 w-3" />
                </span>
              )}
            </button>
          )
        })}
        <button
          type="button"
          className="flex items-center justify-center rounded-t-md px-2 py-1.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
          onClick={async () => {
            const newTab = await onCreateTab()
            if (newTab) setSelectedId(newTab.id)
          }}
          title="New tab"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex flex-1 min-h-0">
        {selectedItem?.kind === 'browser' && (
          <BrowserTabContent
            key={selectedItem.tab.id}
            tab={selectedItem.tab}
            boardId={activeBoardId}
            onTabUpdate={onTabUpdate}
          />
        )}
        {selectedItem?.kind === 'terminal' && (
          <TerminalContent
            key={selectedItem.node.id}
            sessionId={`pty-${selectedItem.node.id}`}
            config={parseNodeConfig(selectedItem.node.config) as TerminalNodeConfig}
            onUpdateConfig={(nextCfg) => {
              void onUpdateNode(selectedItem.node.id, { config: JSON.stringify(nextCfg) })
            }}
            workspaceRootDir={boardRootDir || workspaceRootDir}
          />
        )}
        {selectedItem?.kind === 'file' && (
          <FileContent
            key={selectedItem.node.id}
            nodeId={selectedItem.node.id}
            config={parseNodeConfig(selectedItem.node.config) as FileNodeConfig}
            onUpdateConfig={(nextCfg) => {
              void onUpdateNode(selectedItem.node.id, { config: JSON.stringify(nextCfg) })
            }}
          />
        )}
        {!selectedItem && (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Select a tab to view
          </div>
        )}
      </div>
    </div>
  )
})
