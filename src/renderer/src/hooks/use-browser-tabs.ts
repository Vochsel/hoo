import { useState, useEffect, useCallback } from 'react'

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
  type: 'click' | 'fill' | 'navigate' | 'scroll' | 'getText' | 'getElements'
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
}

export function useBrowserTabs(): {
  tabs: BrowserTab[]
  loading: boolean
  refresh: () => Promise<void>
  createTab: (data?: { title?: string; url?: string; flowX?: number; flowY?: number }) => Promise<BrowserTab>
  updateTab: (id: string, data: Record<string, unknown>) => Promise<BrowserTab>
  deleteTab: (id: string) => Promise<void>
  savePositions: (positions: Array<{ id: string; x: number; y: number }>) => Promise<void>
} {
  const [tabs, setTabs] = useState<BrowserTab[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const result = await window.api.browserTabs.list()
    setTabs(result)
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const createTab = useCallback(
    async (data?: { title?: string; url?: string; flowX?: number; flowY?: number }) => {
      const tab = await window.api.browserTabs.create(data ?? {})
      await refresh()
      return tab
    },
    [refresh]
  )

  const updateTab = useCallback(
    async (id: string, data: Record<string, unknown>) => {
      const tab = await window.api.browserTabs.update(id, data)
      await refresh()
      return tab
    },
    [refresh]
  )

  const deleteTab = useCallback(
    async (id: string) => {
      await window.api.browserTabs.delete(id)
      await refresh()
    },
    [refresh]
  )

  const savePositions = useCallback(
    async (positions: Array<{ id: string; x: number; y: number }>) => {
      await window.api.browserTabs.savePositions(positions)
    },
    []
  )

  return { tabs, loading, refresh, createTab, updateTab, deleteTab, savePositions }
}

export function useBrowserTabChat(tabId: string | null): {
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
    const result = await window.api.browserTabs.listMessages(tabId)
    setMessages(result)
    setLoading(false)
  }, [tabId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const clearMessages = useCallback(async () => {
    if (!tabId) return
    await window.api.browserTabs.clearMessages(tabId)
    setMessages([])
  }, [tabId])

  const sendMessage = useCallback(
    async (message: string, pageContext: PageContext): Promise<BrowserAction[]> => {
      if (!tabId) return []
      setSending(true)
      try {
        const result = await window.api.browserTabs.chat(tabId, message, pageContext)
        setMessages(result.messages)
        return result.actions ?? []
      } finally {
        setSending(false)
      }
    },
    [tabId]
  )

  return { messages, loading, sending, refresh, clearMessages, sendMessage }
}
