import { useState, useEffect, useCallback, useRef } from 'react'

export interface MonitorRule {
  cssSelector: string
  regex: string
  regexGroup: number
  check: 'exists' | 'not_exists' | 'contains' | 'not_contains' | 'less_than' | 'greater_than' | 'equals' | 'changed'
  value?: string
}

export interface BrowserTabMonitor {
  id: string
  condition: string
  enabled: boolean
  lastFiredAt?: string
  rule?: MonitorRule
  lastExtracted?: string
}

export interface BrowserTab {
  id: string
  title: string
  url: string
  favicon: string | null
  screenshot: string | null
  monitors: string | null
  pinnedUrl: string | null
  flowX: number
  flowY: number
  createdAt: string
  updatedAt: string
}

export interface BrowserTabMessage {
  id: string
  tabId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export interface BrowserAction {
  type: 'click' | 'doubleClick' | 'fill' | 'navigate' | 'scroll' | 'getText' | 'getElements'
  index?: number
  value?: string
  url?: string
  direction?: 'up' | 'down'
  amount?: number
}

export interface ActionResult {
  type: BrowserAction['type']
  description: string
  success: boolean
}

export interface PageContext {
  url: string
  title: string
  text: string
  elements: string
  screenshot?: string
  webContentsId?: number
  includeScreenshot?: boolean
}

function orderTabsByIds(tabs: BrowserTab[], orderedIds: string[]): BrowserTab[] {
  if (orderedIds.length === 0) return tabs
  const tabsById = new Map(tabs.map((tab) => [tab.id, tab]))
  const orderedTabs = orderedIds
    .map((id) => tabsById.get(id))
    .filter((tab): tab is BrowserTab => tab != null)
  const orderedIdSet = new Set(orderedTabs.map((tab) => tab.id))
  return [...orderedTabs, ...tabs.filter((tab) => !orderedIdSet.has(tab.id))]
}

export function useBrowserTabs(boardId: string | null): {
  tabs: BrowserTab[]
  loading: boolean
  refresh: () => Promise<void>
  createTab: (data?: { title?: string; url?: string; flowX?: number; flowY?: number }) => Promise<BrowserTab>
  updateTab: (id: string, data: Record<string, unknown>) => Promise<BrowserTab>
  deleteTab: (id: string) => Promise<void>
  saveOrder: (orderedIds: string[]) => Promise<void>
  savePositions: (positions: Array<{ id: string; x: number; y: number }>) => Promise<void>
} {
  const [tabs, setTabs] = useState<BrowserTab[]>([])
  const [loading, setLoading] = useState(true)
  const [loadedBoardId, setLoadedBoardId] = useState<string | null>(boardId)
  const boardIdRef = useRef<string | null>(boardId)
  const refreshVersionRef = useRef(0)

  useEffect(() => {
    boardIdRef.current = boardId
  }, [boardId])

  const refresh = useCallback(async () => {
    const targetBoardId = boardId
    const refreshVersion = refreshVersionRef.current + 1
    refreshVersionRef.current = refreshVersion
    if (!targetBoardId) {
      if (refreshVersion === refreshVersionRef.current) {
        setTabs([])
        setLoadedBoardId(null)
        setLoading(false)
      }
      return
    }

    setLoading(true)
    try {
      const result = await window.api.browserTabs.list(targetBoardId)
      if (refreshVersion !== refreshVersionRef.current) return
      if (boardIdRef.current !== targetBoardId) return
      setTabs(result)
      setLoadedBoardId(targetBoardId)
    } finally {
      if (refreshVersion === refreshVersionRef.current && boardIdRef.current === targetBoardId) {
        setLoading(false)
      }
    }
  }, [boardId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const createTab = useCallback(
    async (data?: { title?: string; url?: string; flowX?: number; flowY?: number }) => {
      const targetBoardId = boardId
      if (!targetBoardId) {
        throw new Error('No board selected')
      }
      const tab = await window.api.browserTabs.create(data ?? {}, targetBoardId)
      if (boardIdRef.current === targetBoardId) {
        setLoadedBoardId(targetBoardId)
        setTabs((prev) => [...prev, tab])
      }
      return tab
    },
    [boardId]
  )

  const updateTab = useCallback(
    async (id: string, data: Record<string, unknown>) => {
      const targetBoardId = boardId
      if (!targetBoardId) {
        throw new Error('No board selected')
      }
      const tab = await window.api.browserTabs.update(id, data, targetBoardId)
      if (!tab) {
        const latest = await window.api.browserTabs.list(targetBoardId)
        if (boardIdRef.current === targetBoardId) {
          setLoadedBoardId(targetBoardId)
          setTabs(latest)
        }
        const fallback = latest.find((entry) => entry.id === id)
        if (!fallback) {
          throw new Error(`Tab not found: ${id}`)
        }
        return fallback
      }
      if (boardIdRef.current === targetBoardId) {
        setLoadedBoardId(targetBoardId)
        setTabs((prev) => prev.map((entry) => (entry.id === id ? tab : entry)))
      }
      return tab
    },
    [boardId]
  )

  const deleteTab = useCallback(
    async (id: string) => {
      const targetBoardId = boardId
      if (!targetBoardId) return
      await window.api.browserTabs.delete(id, targetBoardId)
      if (boardIdRef.current === targetBoardId) {
        setLoadedBoardId(targetBoardId)
        setTabs((prev) => prev.filter((tab) => tab.id !== id))
      }
    },
    [boardId]
  )

  const saveOrder = useCallback(
    async (orderedIds: string[]) => {
      const targetBoardId = boardId
      if (!targetBoardId) return
      if (boardIdRef.current === targetBoardId) {
        setLoadedBoardId(targetBoardId)
        setTabs((prev) => orderTabsByIds(prev, orderedIds))
      }
      await window.api.browserTabs.saveOrder(orderedIds, targetBoardId)
    },
    [boardId]
  )

  const savePositions = useCallback(
    async (positions: Array<{ id: string; x: number; y: number }>) => {
      const targetBoardId = boardId
      if (!targetBoardId) return
      await window.api.browserTabs.savePositions(positions, targetBoardId)
      if (boardIdRef.current !== targetBoardId || positions.length === 0) return
      const positionsById = new Map(positions.map((entry) => [entry.id, entry]))
      const updatedAt = new Date().toISOString()
      setLoadedBoardId(targetBoardId)
      setTabs((prev) =>
        prev.map((tab) => {
          const nextPosition = positionsById.get(tab.id)
          if (!nextPosition) return tab
          return {
            ...tab,
            flowX: nextPosition.x,
            flowY: nextPosition.y,
            updatedAt
          }
        })
      )
    },
    [boardId]
  )

  const visibleTabs = loadedBoardId === boardId ? tabs : []
  const visibleLoading = loading || loadedBoardId !== boardId

  return { tabs: visibleTabs, loading: visibleLoading, refresh, createTab, updateTab, deleteTab, saveOrder, savePositions }
}

export function useBrowserTabChat(tabId: string | null, boardId: string | null): {
  messages: BrowserTabMessage[]
  loading: boolean
  sending: boolean
  refresh: () => Promise<void>
  clearMessages: () => Promise<void>
  sendMessage: (message: string, pageContext: PageContext) => Promise<BrowserAction[]>
} {
  const [messages, setMessages] = useState<BrowserTabMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)

  const refresh = useCallback(async () => {
    if (!tabId) {
      setMessages([])
      return
    }
    setLoading(true)
    const result = await window.api.browserTabs.listMessages(tabId, boardId ?? undefined)
    setMessages(result)
    setLoading(false)
  }, [tabId, boardId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const clearMessages = useCallback(async () => {
    if (!tabId) return
    await window.api.browserTabs.clearMessages(tabId, boardId ?? undefined)
    setMessages([])
  }, [tabId, boardId])

  const sendMessage = useCallback(
    async (message: string, pageContext: PageContext): Promise<BrowserAction[]> => {
      if (!tabId) return []
      setSending(true)
      try {
        const result = await window.api.browserTabs.chat(tabId, message, pageContext, boardId ?? undefined)
        setMessages(result.messages)
        return result.actions ?? []
      } finally {
        setSending(false)
      }
    },
    [tabId, boardId]
  )

  return { messages, loading, sending, refresh, clearMessages, sendMessage }
}
