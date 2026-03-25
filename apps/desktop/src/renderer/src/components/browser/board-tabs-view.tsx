import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { Globe, Terminal, File, Plus, X, Sparkles, Loader2, FolderOpen } from 'lucide-react'
import { BrowserTabContent } from './browser-tab-content'
import { TerminalContent } from './terminal-content'
import { FileContent } from './file-content'
import { BoardFilesystemView } from './board-filesystem-view'
import { BrowserFavicon } from './browser-favicon'
import type { BrowserTab } from '@/hooks/use-browser-tabs'
import type { GraphNode } from '@/hooks/use-graph-nodes'
import type { TerminalNodeConfig } from './terminal-node'
import type { FileNodeConfig } from './file-node'

const MAX_CACHED_BROWSER_TABS = 5
export const BOARD_FILESYSTEM_TAB_ID = '__board_filesystem__'

type TabItem =
  | { kind: 'filesystem'; id: typeof BOARD_FILESYSTEM_TAB_ID; title: string }
  | { kind: 'browser'; tab: BrowserTab }
  | { kind: 'terminal'; node: GraphNode }
  | { kind: 'file'; node: GraphNode }

export type BoardTabsItemKind = TabItem['kind']

interface BoardTabsViewProps {
  tabs: BrowserTab[]
  allBrowserTabs?: BrowserTab[]
  terminalNodes: GraphNode[]
  fileNodes: GraphNode[]
  loading?: boolean
  activeBoardId: string | null
  inlineWithTrafficLights?: boolean
  tabBarLeading?: React.ReactNode
  tabBarTrailing?: React.ReactNode
  preferredOrderIds?: string[]
  onTabUpdate: (id: string, data: Record<string, unknown>) => Promise<unknown>
  onSaveViewOrder: (orderedIds: string[]) => Promise<void>
  onSaveTabOrder: (orderedIds: string[]) => Promise<void>
  onSaveNodeOrder: (orderedIds: string[]) => Promise<void>
  onCreateTab: () => Promise<BrowserTab | void>
  onCreateFile: () => Promise<string | void>
  onCreateTerminal: () => Promise<string | void>
  onCreateAgent: () => Promise<string | void>
  onDeleteTab: (id: string) => void
  onDeleteNode: (id: string) => void
  onOpenTab: (tab: BrowserTab) => void
  onOpenTerminal: (nodeId: string) => void
  onUpdateNode: (id: string, data: Record<string, unknown>) => Promise<unknown>
  onItemContextMenu?: (event: React.MouseEvent, item: { id: string; kind: BoardTabsItemKind }) => void
  notifiedIds?: Set<string>
  runningTerminalIds?: Set<string>
  onTerminalRunningChange?: (nodeId: string, isRunning: boolean) => void
  workspaceRootDir?: string
  boardRootDir?: string | null
  boardRootDirLoaded?: boolean
  onBoardRootDirChange?: (rootDir: string | null) => void | Promise<void>
  pendingSelectId?: string | null
  pendingSelectNonce?: number
  pendingReloadId?: string | null
  pendingReloadNonce?: number
  onActiveItemChange?: (id: string | null) => void
}

function parseNodeConfig(rawConfig: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawConfig)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function reorderIds(ids: string[], dragId: string, dropTargetId: string, dropAfter: boolean): string[] {
  const fromIndex = ids.indexOf(dragId)
  if (fromIndex === -1) return ids
  const next = ids.filter((id) => id !== dragId)
  let targetIndex = next.indexOf(dropTargetId)
  if (targetIndex === -1) return ids
  if (dropAfter) targetIndex += 1
  next.splice(targetIndex, 0, dragId)
  return next
}

function buildOrderedIds(
  preferredOrderIds: string[],
  tabs: BrowserTab[],
  terminalNodes: GraphNode[],
  fileNodes: GraphNode[],
  availableItemIds: Set<string>
): string[] {
  const next: string[] = []
  const seen = new Set<string>()

  for (const rawId of preferredOrderIds) {
    const id = String(rawId ?? '')
    if (!id || seen.has(id) || !availableItemIds.has(id)) continue
    seen.add(id)
    next.push(id)
  }

  for (const tab of tabs) {
    if (seen.has(tab.id)) continue
    seen.add(tab.id)
    next.push(tab.id)
  }
  for (const node of terminalNodes) {
    if (seen.has(node.id)) continue
    seen.add(node.id)
    next.push(node.id)
  }
  for (const node of fileNodes) {
    if (seen.has(node.id)) continue
    seen.add(node.id)
    next.push(node.id)
  }

  for (const id of availableItemIds) {
    if (seen.has(id)) continue
    seen.add(id)
    next.push(id)
  }

  return next
}

export function BoardTabsView({
  tabs,
  allBrowserTabs,
  terminalNodes,
  fileNodes,
  loading = false,
  activeBoardId,
  inlineWithTrafficLights = false,
  tabBarLeading,
  tabBarTrailing,
  preferredOrderIds = [],
  onTabUpdate,
  onSaveViewOrder,
  onSaveTabOrder,
  onSaveNodeOrder,
  onCreateTab,
  onCreateFile,
  onCreateTerminal,
  onCreateAgent,
  onDeleteTab,
  onDeleteNode,
  onOpenTab,
  onOpenTerminal,
  onUpdateNode,
  onItemContextMenu,
  notifiedIds,
  runningTerminalIds,
  onTerminalRunningChange,
  workspaceRootDir,
  boardRootDir,
  boardRootDirLoaded = true,
  onBoardRootDirChange,
  pendingSelectId,
  pendingSelectNonce,
  pendingReloadId,
  pendingReloadNonce,
  onActiveItemChange
}: BoardTabsViewProps): React.ReactElement {
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (pendingSelectId) return pendingSelectId
    if (tabs.length > 0) return tabs[0].id
    if (terminalNodes.length > 0) return terminalNodes[0].id
    if (fileNodes.length > 0) return fileNodes[0].id
    return null
  })
  const [orderedIds, setOrderedIds] = useState<string[]>([])
  const [cachedBrowserTabIds, setCachedBrowserTabIds] = useState<string[]>([])
  const [mountedBrowserTabIds, setMountedBrowserTabIds] = useState<string[]>([])
  const [mountedTerminalIds, setMountedTerminalIds] = useState<string[]>([])
  const [browserReloadNonceById, setBrowserReloadNonceById] = useState<Map<string, number>>(new Map())
  const [terminalInstanceRevisionById, setTerminalInstanceRevisionById] = useState<Map<string, number>>(new Map())

  // Nonce-based pending selection tracking (handles same-board re-selections)
  const lastProcessedNonce = useRef(pendingSelectNonce ?? 0)
  const lastActiveBoardIdRef = useRef(activeBoardId)
  useEffect(() => {
    if (activeBoardId === lastActiveBoardIdRef.current) return
    lastActiveBoardIdRef.current = activeBoardId
    setSelectedId(pendingSelectId ?? null)
  }, [activeBoardId, pendingSelectId])

  useEffect(() => {
    if (pendingSelectId != null && pendingSelectNonce != null
        && pendingSelectNonce !== lastProcessedNonce.current) {
      setSelectedId(pendingSelectId)
      lastProcessedNonce.current = pendingSelectNonce
    }
  }, [pendingSelectId, pendingSelectNonce])

  const filesystemTabOpen =
    activeBoardId != null &&
    (orderedIds.includes(BOARD_FILESYSTEM_TAB_ID) || preferredOrderIds.includes(BOARD_FILESYSTEM_TAB_ID))

  // Build an unordered map of all tab items keyed by id
  const itemsById = useMemo(() => {
    const map = new Map<string, TabItem>()
    if (filesystemTabOpen) {
      map.set(BOARD_FILESYSTEM_TAB_ID, { kind: 'filesystem', id: BOARD_FILESYSTEM_TAB_ID, title: 'Files' })
    }
    for (const tab of tabs) map.set(tab.id, { kind: 'browser', tab })
    for (const node of terminalNodes) map.set(node.id, { kind: 'terminal', node })
    for (const node of fileNodes) map.set(node.id, { kind: 'file', node })
    return map
  }, [filesystemTabOpen, tabs, terminalNodes, fileNodes])

  // Maintain a custom ordering of tab IDs that persists across renders
  const cachedBrowserTabIdsRef = useRef<string[]>([])
  const lastProcessedReloadNonce = useRef(pendingReloadNonce ?? 0)
  const availableBrowserTabs = allBrowserTabs ?? tabs

  // Notify parent only about items that exist in the current board's item set.
  const activeItemId = selectedId != null && itemsById.has(selectedId) ? selectedId : null
  useEffect(() => {
    onActiveItemChange?.(activeItemId)
  }, [activeItemId, onActiveItemChange])

  // Sync orderedIds from the saved mixed order, then append any new items.
  useEffect(() => {
    const next = buildOrderedIds(preferredOrderIds, tabs, terminalNodes, fileNodes, new Set(itemsById.keys()))
    setOrderedIds((prev) => (areStringArraysEqual(prev, next) ? prev : next))
  }, [itemsById, preferredOrderIds, tabs, terminalNodes, fileNodes])

  useEffect(() => {
    cachedBrowserTabIdsRef.current = cachedBrowserTabIds
  }, [cachedBrowserTabIds])

  const allItems: TabItem[] = useMemo(
    () => orderedIds.map((id) => itemsById.get(id)).filter((item): item is TabItem => item != null),
    [orderedIds, itemsById]
  )
  const browserTabIdSet = useMemo(() => new Set(tabs.map((tab) => tab.id)), [tabs])
  const graphItemIdSet = useMemo(
    () => new Set([...terminalNodes.map((node) => node.id), ...fileNodes.map((node) => node.id)]),
    [terminalNodes, fileNodes]
  )

  // Drag state
  const dragIdRef = useRef<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropIndicator, setDropIndicator] = useState<{ id: string; side: 'left' | 'right' } | null>(null)

  // New-tab dropdown state
  const [newTabMenuOpen, setNewTabMenuOpen] = useState(false)
  const newTabMenuRef = useRef<HTMLDivElement | null>(null)

  const appendCreatedItemToEnd = useCallback((id: string, kind: BoardTabsItemKind) => {
    const nextOrderedIds = orderedIds.includes(id) ? orderedIds : [...orderedIds, id]
    setOrderedIds((prev) => (areStringArraysEqual(prev, nextOrderedIds) ? prev : nextOrderedIds))
    setSelectedId(id)
    void onSaveViewOrder(nextOrderedIds)

    const nextBrowserTabIds = nextOrderedIds.filter(
      (entryId) => browserTabIdSet.has(entryId) || (kind === 'browser' && entryId === id)
    )
    if (nextBrowserTabIds.length > 0) {
      void onSaveTabOrder(nextBrowserTabIds)
    }

    const nextGraphNodeIds = nextOrderedIds.filter(
      (entryId) => graphItemIdSet.has(entryId) || ((kind === 'terminal' || kind === 'file') && entryId === id)
    )
    if (nextGraphNodeIds.length > 0) {
      void onSaveNodeOrder(nextGraphNodeIds)
    }
  }, [orderedIds, browserTabIdSet, graphItemIdSet, onSaveViewOrder, onSaveTabOrder, onSaveNodeOrder])

  const handleCreateBrowserTab = useCallback(async () => {
    const newTab = await onCreateTab()
    if (!newTab) return
    appendCreatedItemToEnd(newTab.id, 'browser')
  }, [onCreateTab, appendCreatedItemToEnd])

  const handleCreateAgentTab = useCallback(async () => {
    const nodeId = await onCreateAgent()
    if (!nodeId) return
    appendCreatedItemToEnd(nodeId, 'terminal')
  }, [onCreateAgent, appendCreatedItemToEnd])

  const handleCreateFileTab = useCallback(async () => {
    const nodeId = await onCreateFile()
    if (!nodeId) return
    appendCreatedItemToEnd(nodeId, 'file')
  }, [onCreateFile, appendCreatedItemToEnd])

  const handleCreateTerminalTab = useCallback(async () => {
    const nodeId = await onCreateTerminal()
    if (!nodeId) return
    appendCreatedItemToEnd(nodeId, 'terminal')
  }, [onCreateTerminal, appendCreatedItemToEnd])

  const handleCreateFilesystemTab = useCallback(() => {
    if (activeBoardId == null || filesystemTabOpen) return
    appendCreatedItemToEnd(BOARD_FILESYSTEM_TAB_ID, 'filesystem')
  }, [activeBoardId, appendCreatedItemToEnd, filesystemTabOpen])

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
    if (item.kind === 'filesystem') return item.id === selectedId
    if (item.kind === 'browser') return item.tab.id === selectedId
    return item.node.id === selectedId
  }) ?? null
  const selectedBrowserTab = selectedItem?.kind === 'browser' ? selectedItem.tab : null

  useEffect(() => {
    if (!selectedBrowserTab) return
    setCachedBrowserTabIds((prev) => {
      const next = [selectedBrowserTab.id, ...prev.filter((id) => id !== selectedBrowserTab.id)]
        .slice(0, MAX_CACHED_BROWSER_TABS)
      return areStringArraysEqual(prev, next) ? prev : next
    })
    setMountedBrowserTabIds((prev) => {
      // Keep mounted webviews in a stable DOM order; moving Electron webviews is crash-prone.
      const withSelected = prev.includes(selectedBrowserTab.id) ? prev : [...prev, selectedBrowserTab.id]
      const nextCachedIds = [selectedBrowserTab.id, ...cachedBrowserTabIds.filter((id) => id !== selectedBrowserTab.id)]
        .slice(0, MAX_CACHED_BROWSER_TABS)
      const next = withSelected.filter((id) => nextCachedIds.includes(id))
      return areStringArraysEqual(prev, next) ? prev : next
    })
  }, [selectedBrowserTab, cachedBrowserTabIds])

  useEffect(() => {
    const activeBrowserIds = new Set(availableBrowserTabs.map((tab) => tab.id))
    setCachedBrowserTabIds((prev) => {
      const next = prev.filter((id) => activeBrowserIds.has(id))
      return areStringArraysEqual(prev, next) ? prev : next
    })
    setMountedBrowserTabIds((prev) => {
      const next = prev.filter((id) => activeBrowserIds.has(id))
      return areStringArraysEqual(prev, next) ? prev : next
    })
  }, [availableBrowserTabs])

  useEffect(() => {
    if (selectedItem?.kind !== 'terminal') return
    setMountedTerminalIds((prev) => (prev.includes(selectedItem.node.id) ? prev : [...prev, selectedItem.node.id]))
  }, [selectedItem])

  useEffect(() => {
    const activeTerminalIds = new Set(terminalNodes.map((node) => node.id))
    setMountedTerminalIds((prev) => {
      const next = prev.filter((id) => activeTerminalIds.has(id))
      return areStringArraysEqual(prev, next) ? prev : next
    })
  }, [terminalNodes])

  useEffect(() => {
    if (!pendingReloadId || pendingReloadNonce == null) return
    if (pendingReloadNonce === lastProcessedReloadNonce.current) return
    lastProcessedReloadNonce.current = pendingReloadNonce

    const item = itemsById.get(pendingReloadId)
    if (!item) return

    if (item.kind === 'browser') {
      const nextCachedIds = [
        item.tab.id,
        ...cachedBrowserTabIdsRef.current.filter((id) => id !== item.tab.id)
      ].slice(0, MAX_CACHED_BROWSER_TABS)
      setCachedBrowserTabIds((prev) => (areStringArraysEqual(prev, nextCachedIds) ? prev : nextCachedIds))
      setMountedBrowserTabIds((prev) => {
        const withTarget = prev.includes(item.tab.id) ? prev : [...prev, item.tab.id]
        const next = withTarget.filter((id) => nextCachedIds.includes(id))
        return areStringArraysEqual(prev, next) ? prev : next
      })
      setBrowserReloadNonceById((prev) => {
        if (prev.get(item.tab.id) === pendingReloadNonce) return prev
        const next = new Map(prev)
        next.set(item.tab.id, pendingReloadNonce)
        return next
      })
      return
    }

    if (item.kind === 'terminal') {
      void window.api.terminal.kill(`pty-${item.node.id}`).catch(() => {}).then(() => {
        setTerminalInstanceRevisionById((prev) => {
          const next = new Map(prev)
          next.set(item.node.id, (prev.get(item.node.id) ?? 0) + 1)
          return next
        })
      })
    }
  }, [itemsById, pendingReloadId, pendingReloadNonce])

  const browserTabsById = useMemo(() => {
    const map = new Map<string, BrowserTab>()
    for (const tab of availableBrowserTabs) map.set(tab.id, tab)
    return map
  }, [availableBrowserTabs])

  const mountedBrowserTabs = useMemo(() => {
    return mountedBrowserTabIds
      .map((tabId) => browserTabsById.get(tabId))
      .filter((tab): tab is BrowserTab => tab != null)
  }, [mountedBrowserTabIds, browserTabsById])

  const terminalNodesById = useMemo(() => {
    const map = new Map<string, GraphNode>()
    for (const node of terminalNodes) map.set(node.id, node)
    return map
  }, [terminalNodes])

  const mountedTerminalIdsToRender = useMemo(() => {
    if (selectedItem?.kind !== 'terminal') return mountedTerminalIds
    return mountedTerminalIds.includes(selectedItem.node.id)
      ? mountedTerminalIds
      : [...mountedTerminalIds, selectedItem.node.id]
  }, [mountedTerminalIds, selectedItem])

  const mountedTerminalNodes = useMemo(() => {
    return mountedTerminalIdsToRender
      .map((nodeId) => terminalNodesById.get(nodeId))
      .filter((node): node is GraphNode => node != null)
  }, [mountedTerminalIdsToRender, terminalNodesById])

  const firstAvailableItemId = useMemo(() => {
    const first = allItems.find((item) => item.kind !== 'filesystem') ?? allItems[0]
    if (!first) return null
    if (first.kind === 'filesystem') return first.id
    return first.kind === 'browser' ? first.tab.id : first.node.id
  }, [allItems])
  const shouldWaitForPendingSelection =
    pendingSelectId != null &&
    !itemsById.has(pendingSelectId) &&
    loading

  // Keep selection stable while a requested item is still loading, then fall
  // back only once the current board's items are ready.
  useEffect(() => {
    if (selectedId == null) {
      if (pendingSelectId != null && itemsById.has(pendingSelectId)) {
        setSelectedId(pendingSelectId)
        return
      }
      if (shouldWaitForPendingSelection || firstAvailableItemId == null) return
      setSelectedId(firstAvailableItemId)
      return
    }

    if (selectedItem || itemsById.has(selectedId)) return
    if (shouldWaitForPendingSelection && pendingSelectId === selectedId) return
    setSelectedId(firstAvailableItemId)
  }, [
    firstAvailableItemId,
    itemsById,
    pendingSelectId,
    selectedId,
    selectedItem,
    shouldWaitForPendingSelection
  ])

  const handleSelectTab = useCallback((id: string) => {
    setSelectedId(id)
  }, [])

  const closeItem = useCallback((id: string, kind: BoardTabsItemKind) => {
    if (kind === 'filesystem') {
      const nextOrderedIds = orderedIds.filter((entryId) => entryId !== id)
      if (!areStringArraysEqual(nextOrderedIds, orderedIds)) {
        setOrderedIds(nextOrderedIds)
        void onSaveViewOrder(nextOrderedIds)
      }
      if (selectedId === id) {
        const remaining = allItems.filter((item) => {
          const itemId = item.kind === 'filesystem' ? item.id : item.kind === 'browser' ? item.tab.id : item.node.id
          return itemId !== id
        })
        setSelectedId(remaining.length > 0
          ? (remaining[0].kind === 'filesystem' ? remaining[0].id : remaining[0].kind === 'browser' ? remaining[0].tab.id : remaining[0].node.id)
          : null
        )
      }
      return
    }
    if (kind === 'browser') {
      onDeleteTab(id)
    } else {
      onDeleteNode(id)
    }
    if (selectedId === id) {
      const remaining = allItems.filter((item) => {
        const itemId = item.kind === 'filesystem' ? item.id : item.kind === 'browser' ? item.tab.id : item.node.id
        return itemId !== id
      })
      setSelectedId(remaining.length > 0
        ? (remaining[0].kind === 'filesystem' ? remaining[0].id : remaining[0].kind === 'browser' ? remaining[0].tab.id : remaining[0].node.id)
        : null
      )
    }
  }, [selectedId, allItems, onDeleteTab, onDeleteNode, onSaveViewOrder, orderedIds])

  const handleCloseTab = useCallback((e: React.MouseEvent, id: string, kind: BoardTabsItemKind) => {
    e.stopPropagation()
    closeItem(id, kind)
  }, [closeItem])

  // Cmd+1-9 keyboard shortcuts to switch tabs
  // Ctrl+Tab / Ctrl+Shift+Tab to cycle next/previous tab
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (!e.metaKey && !e.ctrlKey) return

      if (e.key.toLowerCase() === 'w' && !e.shiftKey && !e.altKey && selectedItem) {
        e.preventDefault()
        if (e.repeat) return
        const id = selectedItem.kind === 'filesystem'
          ? selectedItem.id
          : selectedItem.kind === 'browser'
          ? selectedItem.tab.id
          : selectedItem.node.id
        closeItem(id, selectedItem.kind)
        return
      }

      // Ctrl+Tab / Ctrl+Shift+Tab to cycle tabs
      if (e.ctrlKey && e.key === 'Tab' && allItems.length > 0) {
        e.preventDefault()
        const currentIndex = allItems.findIndex((item) =>
          item.kind === 'filesystem' ? item.id === selectedId : item.kind === 'browser' ? item.tab.id === selectedId : item.node.id === selectedId
        )
        const direction = e.shiftKey ? -1 : 1
        const nextIndex = (currentIndex + direction + allItems.length) % allItems.length
        const target = allItems[nextIndex]
        setSelectedId(target.kind === 'filesystem' ? target.id : target.kind === 'browser' ? target.tab.id : target.node.id)
        return
      }

      const num = parseInt(e.key, 10)
      if (num < 1 || num > 9 || isNaN(num)) return
      const index = num - 1
      if (index >= allItems.length) return
      e.preventDefault()
      const target = allItems[index]
      setSelectedId(target.kind === 'filesystem' ? target.id : target.kind === 'browser' ? target.tab.id : target.node.id)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [allItems, closeItem, selectedId, selectedItem])

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
    const rect = e.currentTarget.getBoundingClientRect()
    const midX = rect.left + rect.width / 2
    const dropAfter = e.clientX >= midX
    const nextOrderedIds = reorderIds(orderedIds, dragId, dropTargetId, dropAfter)
    if (areStringArraysEqual(nextOrderedIds, orderedIds)) return
    setOrderedIds(nextOrderedIds)
    void onSaveViewOrder(nextOrderedIds)

    const nextBrowserTabIds = nextOrderedIds.filter((id) => browserTabIdSet.has(id))
    if (nextBrowserTabIds.length > 0) {
      void onSaveTabOrder(nextBrowserTabIds)
    }
    const nextGraphNodeIds = nextOrderedIds.filter((id) => graphItemIdSet.has(id))
    if (nextGraphNodeIds.length > 0) {
      void onSaveNodeOrder(nextGraphNodeIds)
    }
  }, [orderedIds, browserTabIdSet, graphItemIdSet, onSaveViewOrder, onSaveTabOrder, onSaveNodeOrder])

  const handleDragEnd = useCallback(() => {
    dragIdRef.current = null
    setDraggingId(null)
    setDropIndicator(null)
  }, [])

  const tabBar = (
    <div
      className={
        inlineWithTrafficLights
          ? 'traffic-light-tabs-row traffic-light-offset drag-region flex items-center gap-2 border-b border-border/40 bg-muted/20 pr-2'
          : 'flex items-end gap-2 border-b border-border/40 bg-muted/20 pl-3 pr-2 pt-1'
      }
    >
      {tabBarLeading ? (
        <div className={`no-drag flex shrink-0 items-center ${inlineWithTrafficLights ? '' : 'self-center pb-1'}`}>
          {tabBarLeading}
        </div>
      ) : null}
      <div className="scrollbar-hidden flex min-w-0 flex-1 items-end gap-0 overflow-x-auto overflow-y-hidden">
        {allItems.map((item) => {
          const id = item.kind === 'filesystem' ? item.id : item.kind === 'browser' ? item.tab.id : item.node.id
          const isSelected = id === selectedId
          const isDragging = id === draggingId
          const showLeftIndicator = dropIndicator?.id === id && dropIndicator.side === 'left'
          const showRightIndicator = dropIndicator?.id === id && dropIndicator.side === 'right'
          const terminalIsRunning = item.kind === 'terminal' && !!runningTerminalIds?.has(id)
          const title = item.kind === 'filesystem'
            ? item.title
            : item.kind === 'browser'
            ? (item.tab.title || item.tab.url || 'New Tab')
            : (item.node.label || (item.kind === 'terminal' ? 'Terminal' : 'File'))
          const favicon = item.kind === 'browser' ? item.tab.favicon : null

          return (
            <button
              key={id}
              type="button"
              draggable
              className={`no-drag group relative flex w-[160px] shrink-0 items-center gap-1.5 ${isSelected ? 'rounded-t-xl' : 'rounded-t-lg'} border -mb-px px-3 py-1.5 text-xs transition-[background-color,border-color,color,box-shadow] ${
                isSelected
                  ? 'bg-background border-border/70 border-b-background text-foreground shadow-[0_-1px_0_rgba(255,255,255,0.08),0_12px_28px_rgba(15,23,42,0.14)] z-10 font-semibold'
                  : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              } ${isDragging ? 'opacity-40' : ''}`}
              onDragStart={(e) => handleDragStart(e, id)}
              onDragOver={(e) => handleDragOver(e, id)}
              onDrop={(e) => handleDrop(e, id)}
              onDragEnd={handleDragEnd}
              onDragLeave={() => setDropIndicator(null)}
              onContextMenu={(event) => {
                if (item.kind !== 'filesystem') {
                  onItemContextMenu?.(event, { id, kind: item.kind })
                }
              }}
              onClick={() => handleSelectTab(id)}
              onDoubleClick={() => {
                if (item.kind === 'browser') onOpenTab(item.tab)
                else if (item.kind === 'terminal') onOpenTerminal(item.node.id)
              }}
              title={title}
            >
              {isSelected && (
                <span className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-primary/80" />
              )}
              {showLeftIndicator && (
                <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-primary" />
              )}
              {showRightIndicator && (
                <span className="absolute right-0 top-1 bottom-1 w-0.5 rounded-full bg-primary" />
              )}
              {item.kind === 'filesystem' ? (
                <FolderOpen className={`h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-amber-400' : 'text-amber-500'}`} />
              ) : item.kind === 'browser' ? (
                <BrowserFavicon
                  src={favicon}
                  imgClassName="h-3.5 w-3.5 shrink-0 rounded-sm"
                  iconClassName={`h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-foreground' : 'text-muted-foreground'}`}
                />
              ) : item.kind === 'terminal' ? (
                terminalIsRunning ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                ) : (
                  <Terminal className={`h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                )
              ) : (
                <File className={`h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-cyan-400' : 'text-cyan-500'}`} />
              )}
              <span className="truncate">{title}</span>
              {!isSelected && !terminalIsRunning && notifiedIds?.has(id) && (
                <span className="ml-0.5 shrink-0 h-1.5 w-1.5 rounded-full bg-blue-500" />
              )}
              <span
                role="button"
                className={`ml-1 shrink-0 rounded p-0.5 hover:text-destructive transition-opacity ${
                  isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
                aria-label={`Close ${title}`}
                title={`Close ${title}`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => handleCloseTab(e, id, item.kind)}
              >
                <X className="h-3 w-3" />
              </span>
            </button>
          )
        })}
      </div>
      <div className="relative shrink-0 self-end" ref={newTabMenuRef}>
        <button
          type="button"
          className="no-drag flex items-center justify-center rounded-t-lg px-2 py-1.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
          onClick={() => {
            setNewTabMenuOpen((prev) => !prev)
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            setNewTabMenuOpen(true)
          }}
          title="New tab"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        {newTabMenuOpen && (
          <div className="absolute right-0 top-[calc(100%+4px)] z-50 w-36 rounded-md border border-border/40 bg-popover p-1 shadow-sm">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-accent"
              onClick={() => {
                setNewTabMenuOpen(false)
                void handleCreateBrowserTab()
              }}
            >
              <Globe className="h-3.5 w-3.5" />
              Web
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-accent"
              onClick={() => {
                setNewTabMenuOpen(false)
                void handleCreateAgentTab()
              }}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Agent
            </button>
            {!filesystemTabOpen && activeBoardId != null && (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-accent"
                onClick={() => {
                  setNewTabMenuOpen(false)
                  handleCreateFilesystemTab()
                }}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Files
              </button>
            )}
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-accent"
              onClick={() => {
                setNewTabMenuOpen(false)
                void handleCreateFileTab()
              }}
            >
              <File className="h-3.5 w-3.5" />
              File
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-accent"
              onClick={() => {
                setNewTabMenuOpen(false)
                void handleCreateTerminalTab()
              }}
            >
              <Terminal className="h-3.5 w-3.5" />
              Terminal
            </button>
          </div>
        )}
      </div>
      {tabBarTrailing ? (
        <div className={`no-drag flex shrink-0 items-center ${inlineWithTrafficLights ? '' : 'self-center pb-1'}`}>
          {tabBarTrailing}
        </div>
      ) : null}
    </div>
  )

  const isLoadingState = loading || shouldWaitForPendingSelection

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {tabBar}

      {/* Content */}
      <div className="relative flex flex-1 min-h-0">
        {mountedBrowserTabs.map((tab) => {
          const isActive = selectedItem?.kind === 'browser' && selectedItem.tab.id === tab.id
          return (
            <div
              key={tab.id}
              className={`absolute inset-0 flex min-h-0 ${isActive ? 'z-10' : 'pointer-events-none'}`}
              style={{ visibility: isActive ? 'visible' : 'hidden' }}
              aria-hidden={!isActive}
            >
              <BrowserTabContent
                tab={tab}
                boardId={activeBoardId}
                onTabUpdate={onTabUpdate}
                active={isActive}
                reloadNonce={browserReloadNonceById.get(tab.id) ?? 0}
              />
            </div>
          )
        })}
        {boardRootDirLoaded && mountedTerminalNodes.map((node) => {
          const isActive = selectedItem?.kind === 'terminal' && selectedItem.node.id === node.id
          return (
            <div
              key={node.id}
              className={`absolute inset-0 flex min-h-0 ${isActive ? 'z-10' : 'pointer-events-none'}`}
              style={{ visibility: isActive ? 'visible' : 'hidden' }}
              aria-hidden={!isActive}
            >
              <TerminalContent
                key={`${node.id}:${terminalInstanceRevisionById.get(node.id) ?? 0}`}
                sessionId={`pty-${node.id}`}
                label={node.label}
                config={parseNodeConfig(node.config) as TerminalNodeConfig}
                active={isActive}
                onRequestClose={() => closeItem(node.id, 'terminal')}
                onUpdateConfig={(nextCfg) => {
                  void onUpdateNode(node.id, { config: JSON.stringify(nextCfg) })
                }}
                onRunningChange={(isRunning) => onTerminalRunningChange?.(node.id, isRunning)}
                workspaceRootDir={boardRootDir || workspaceRootDir}
                showHeader={false}
              />
            </div>
          )
        })}
        {selectedItem?.kind === 'filesystem' && (
          <div className="absolute inset-0 flex min-h-0 z-10">
            <BoardFilesystemView
              boardId={activeBoardId}
              boardRootDir={boardRootDir}
              boardRootDirLoaded={boardRootDirLoaded}
              workspaceRootDir={workspaceRootDir}
              onBoardRootDirChange={onBoardRootDirChange}
            />
          </div>
        )}
        {selectedItem?.kind === 'file' && (
          <div className="absolute inset-0 flex min-h-0 z-10">
            <FileContent
              key={selectedItem.node.id}
              nodeId={selectedItem.node.id}
              config={parseNodeConfig(selectedItem.node.config) as FileNodeConfig}
              onUpdateConfig={(nextCfg) => {
                void onUpdateNode(selectedItem.node.id, { config: JSON.stringify(nextCfg) })
              }}
            />
          </div>
        )}
        {!selectedItem && allItems.length === 0 && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <p className="text-sm">{isLoadingState ? 'Loading board items...' : 'No tabs or terminals yet'}</p>
            {!isLoadingState && (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
                onClick={() => void handleCreateBrowserTab()}
              >
                <Plus className="h-3.5 w-3.5" />
                New browser tab
              </button>
            )}
          </div>
        )}
        {!selectedItem && allItems.length > 0 && (
          <div className="absolute inset-0 z-20 flex items-center justify-center text-sm text-muted-foreground">
            Select a tab to view
          </div>
        )}
      </div>
    </div>
  )
}
