import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { Globe, Terminal, File, Plus, X, Sparkles } from 'lucide-react'
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

interface BoardTabsViewProps {
  tabs: BrowserTab[]
  terminalNodes: GraphNode[]
  fileNodes: GraphNode[]
  activeBoardId: string | null
  onTabUpdate: (id: string, data: Record<string, unknown>) => Promise<unknown>
  onCreateTab: () => Promise<BrowserTab | void>
  onCreateTerminal: () => Promise<string | void>
  onCreateAgent: () => Promise<string | void>
  onDeleteTab: (id: string) => void
  onOpenTab: (tab: BrowserTab) => void
  onOpenTerminal: (nodeId: string) => void
  onUpdateNode: (id: string, data: Record<string, unknown>) => Promise<unknown>
  workspaceRootDir?: string
  boardRootDir?: string | null
  pendingSelectId?: string | null
  pendingSelectNonce?: number
}

function parseNodeConfig(rawConfig: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawConfig)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function BoardTabsView({
  tabs,
  terminalNodes,
  fileNodes,
  activeBoardId,
  onTabUpdate,
  onCreateTab,
  onCreateTerminal,
  onCreateAgent,
  onDeleteTab,
  onOpenTab,
  onOpenTerminal,
  onUpdateNode,
  workspaceRootDir,
  boardRootDir,
  pendingSelectId,
  pendingSelectNonce
}: BoardTabsViewProps): React.ReactElement {
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (pendingSelectId) return pendingSelectId
    if (tabs.length > 0) return tabs[0].id
    if (terminalNodes.length > 0) return terminalNodes[0].id
    if (fileNodes.length > 0) return fileNodes[0].id
    return null
  })

  // Nonce-based pending selection tracking (handles same-board re-selections)
  const lastProcessedNonce = useRef(pendingSelectNonce ?? 0)
  useEffect(() => {
    if (pendingSelectId != null && pendingSelectNonce != null
        && pendingSelectNonce !== lastProcessedNonce.current) {
      setSelectedId(pendingSelectId)
      lastProcessedNonce.current = pendingSelectNonce
    }
  }, [pendingSelectId, pendingSelectNonce])

  // Build an unordered map of all tab items keyed by id
  const itemsById = useMemo(() => {
    const map = new Map<string, TabItem>()
    for (const tab of tabs) map.set(tab.id, { kind: 'browser', tab })
    for (const node of terminalNodes) map.set(node.id, { kind: 'terminal', node })
    for (const node of fileNodes) map.set(node.id, { kind: 'file', node })
    return map
  }, [tabs, terminalNodes, fileNodes])

  // Maintain a custom ordering of tab IDs that persists across renders
  const [orderedIds, setOrderedIds] = useState<string[]>([])

  // Sync orderedIds when the set of items changes (adds/removes)
  useEffect(() => {
    const currentIds = new Set(itemsById.keys())
    // Keep existing ordered IDs that still exist, then append any new ones
    const kept = orderedIds.filter((id) => currentIds.has(id))
    const keptSet = new Set(kept)
    const added: string[] = []
    // Preserve default order for new items: browsers, terminals, files
    for (const tab of tabs) {
      if (!keptSet.has(tab.id)) added.push(tab.id)
    }
    for (const node of terminalNodes) {
      if (!keptSet.has(node.id)) added.push(node.id)
    }
    for (const node of fileNodes) {
      if (!keptSet.has(node.id)) added.push(node.id)
    }
    const next = [...kept, ...added]
    // Only update state if something actually changed
    if (next.length !== orderedIds.length || next.some((id, i) => id !== orderedIds[i])) {
      setOrderedIds(next)
    }
  }, [itemsById, tabs, terminalNodes, fileNodes]) // eslint-disable-line react-hooks/exhaustive-deps

  const allItems: TabItem[] = useMemo(
    () => orderedIds.map((id) => itemsById.get(id)).filter((item): item is TabItem => item != null),
    [orderedIds, itemsById]
  )

  // Drag state
  const dragIdRef = useRef<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropIndicator, setDropIndicator] = useState<{ id: string; side: 'left' | 'right' } | null>(null)

  // New-tab dropdown state
  const [newTabMenuOpen, setNewTabMenuOpen] = useState(false)
  const [newTabMenuPos, setNewTabMenuPos] = useState<{ top: number; left: number } | null>(null)
  const newTabMenuRef = useRef<HTMLDivElement | null>(null)
  const newTabBtnRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!newTabMenuOpen) return
    const handleClickOutside = (e: MouseEvent): void => {
      if (newTabMenuRef.current && !newTabMenuRef.current.contains(e.target as Node)) {
        setNewTabMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [newTabMenuOpen])

  const selectedItem = allItems.find((item) => {
    if (item.kind === 'browser') return item.tab.id === selectedId
    return item.node.id === selectedId
  }) ?? null

  // Auto-select first tab if current selection disappears —
  // but skip when selectedId matches pendingSelectId (item may still be loading after board switch)
  useEffect(() => {
    if (selectedId && !selectedItem && allItems.length > 0 && !itemsById.has(selectedId)) {
      if (selectedId === pendingSelectId) return
      const first = allItems[0]
      setSelectedId(first.kind === 'browser' ? first.tab.id : first.node.id)
    }
  }, [selectedId, selectedItem, allItems, itemsById, pendingSelectId])

  // Cmd+1-9 keyboard shortcuts to switch tabs
  // Ctrl+Tab / Ctrl+Shift+Tab to cycle next/previous tab
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (!e.metaKey && !e.ctrlKey) return

      // Ctrl+Tab / Ctrl+Shift+Tab to cycle tabs
      if (e.ctrlKey && e.key === 'Tab' && allItems.length > 0) {
        e.preventDefault()
        const currentIndex = allItems.findIndex((item) =>
          item.kind === 'browser' ? item.tab.id === selectedId : item.node.id === selectedId
        )
        const direction = e.shiftKey ? -1 : 1
        const nextIndex = (currentIndex + direction + allItems.length) % allItems.length
        const target = allItems[nextIndex]
        setSelectedId(target.kind === 'browser' ? target.tab.id : target.node.id)
        return
      }

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
  }, [allItems, selectedId])

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

  // --- Drag-and-drop handlers ---
  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    dragIdRef.current = id
    setDraggingId(id)
    e.dataTransfer.effectAllowed = 'move'
    // Required for Firefox
    e.dataTransfer.setData('text/plain', id)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, overId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (!dragIdRef.current || dragIdRef.current === overId) {
      setDropIndicator(null)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const midX = rect.left + rect.width / 2
    const side: 'left' | 'right' = e.clientX < midX ? 'left' : 'right'
    setDropIndicator({ id: overId, side })
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, dropTargetId: string) => {
    e.preventDefault()
    const dragId = dragIdRef.current
    setDropIndicator(null)
    setDraggingId(null)
    dragIdRef.current = null
    if (!dragId || dragId === dropTargetId) return

    setOrderedIds((prev) => {
      const fromIndex = prev.indexOf(dragId)
      if (fromIndex === -1) return prev

      // Determine drop side
      const rect = e.currentTarget.getBoundingClientRect()
      const midX = rect.left + rect.width / 2
      const dropAfter = e.clientX >= midX

      // Remove the dragged item
      const next = prev.filter((id) => id !== dragId)
      // Find the target index in the new array (after removal)
      let targetIndex = next.indexOf(dropTargetId)
      if (targetIndex === -1) return prev
      if (dropAfter) targetIndex += 1
      next.splice(targetIndex, 0, dragId)
      return next
    })
  }, [])

  const handleDragEnd = useCallback(() => {
    dragIdRef.current = null
    setDraggingId(null)
    setDropIndicator(null)
  }, [])

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
          const isDragging = id === draggingId
          const showLeftIndicator = dropIndicator?.id === id && dropIndicator.side === 'left'
          const showRightIndicator = dropIndicator?.id === id && dropIndicator.side === 'right'
          const title = item.kind === 'browser'
            ? (item.tab.title || item.tab.url || 'New Tab')
            : (item.node.label || (item.kind === 'terminal' ? 'Terminal' : 'File'))
          const favicon = item.kind === 'browser' ? item.tab.favicon : null

          return (
            <button
              key={id}
              type="button"
              draggable
              onDragStart={(e) => handleDragStart(e, id)}
              onDragOver={(e) => handleDragOver(e, id)}
              onDrop={(e) => handleDrop(e, id)}
              onDragEnd={handleDragEnd}
              onDragLeave={() => setDropIndicator(null)}
              className={`group relative flex max-w-[200px] items-center gap-1.5 rounded-t-md px-3 py-1.5 text-xs transition-colors ${
                isSelected
                  ? 'bg-background border border-border/60 border-b-background -mb-px z-10 font-medium'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              } ${isDragging ? 'opacity-40' : ''}`}
              onClick={() => handleSelectTab(id)}
              onDoubleClick={() => {
                if (item.kind === 'browser') onOpenTab(item.tab)
                else if (item.kind === 'terminal') onOpenTerminal(item.node.id)
              }}
              title={title}
            >
              {/* Drop indicator lines */}
              {showLeftIndicator && (
                <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-primary" />
              )}
              {showRightIndicator && (
                <span className="absolute right-0 top-1 bottom-1 w-0.5 rounded-full bg-primary" />
              )}
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
        <div className="shrink-0" ref={newTabMenuRef}>
          <button
            ref={newTabBtnRef}
            type="button"
            className="flex items-center justify-center rounded-t-md px-2 py-1.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
            onClick={() => {
              if (newTabBtnRef.current) {
                const rect = newTabBtnRef.current.getBoundingClientRect()
                setNewTabMenuPos({ top: rect.bottom + 4, left: rect.left })
              }
              setNewTabMenuOpen((v) => !v)
            }}
            title="New tab"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          {newTabMenuOpen && newTabMenuPos && (
            <div className="fixed z-50 w-36 rounded-md border border-border/40 bg-popover p-1 shadow-sm" style={{ top: newTabMenuPos.top, left: newTabMenuPos.left }}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-accent"
                onClick={async () => {
                  setNewTabMenuOpen(false)
                  const newTab = await onCreateTab()
                  if (newTab) setSelectedId(newTab.id)
                }}
              >
                <Globe className="h-3.5 w-3.5" />
                Web
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-accent"
                onClick={async () => {
                  setNewTabMenuOpen(false)
                  const nodeId = await onCreateAgent()
                  if (nodeId) setSelectedId(nodeId)
                }}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Agent
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-accent"
                onClick={async () => {
                  setNewTabMenuOpen(false)
                  const nodeId = await onCreateTerminal()
                  if (nodeId) setSelectedId(nodeId)
                }}
              >
                <Terminal className="h-3.5 w-3.5" />
                Terminal
              </button>
            </div>
          )}
        </div>
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
            label={selectedItem.node.label}
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
}
