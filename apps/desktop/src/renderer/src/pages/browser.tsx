import { useState, useCallback, useMemo, useRef, useEffect, useLayoutEffect } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  addEdge,
  reconnectEdge,
  SelectionMode,
  PanOnScrollMode,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeChange,
  type NodePositionChange,
  type EdgeChange,
  type Connection
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Globe, MessageSquare, Radio, Trash2, Copy, Play, Bug, Bell, Sparkles, Timer, NotebookPen, File, FileText, FolderOpen, ChevronDown, ChevronRight, Code, Search, GitCompare, CalendarClock, FormInput, Folder, Terminal, Presentation, PanelTop, Settings, ScrollText, PanelLeftClose, PanelLeftOpen, ArrowLeft, Check, FolderPlus, Archive, Menu, RotateCw } from 'lucide-react'
import { useAppActions } from '@/App'
import { UpdateBanner } from '@/components/update-banner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BrowserTabNode, type BrowserTabNodeData } from '@/components/browser/browser-tab-node'
import { FlowDirectionContext, type FlowDirection } from '@/components/browser/flow-direction-context'
import { TriggerNode } from '@/components/browser/trigger-node'
import { ScheduleTriggerNode, type ScheduleTriggerConfig } from '@/components/browser/schedule-trigger-node'
import { FormTriggerNode, type FormTriggerConfig, type FormTriggerFieldConfig } from '@/components/browser/form-trigger-node'
import { DebugNode } from '@/components/browser/debug-node'
import { NotificationNode } from '@/components/browser/notification-node'
import { DelayNode } from '@/components/browser/delay-node'
import { AiPromptNode } from '@/components/browser/ai-prompt-node'
import { TextNode } from '@/components/browser/text-node'
import { OutputNode } from '@/components/browser/output-node'
import { FileNode } from '@/components/browser/file-node'
import { TerminalNode, type TerminalNodeConfig } from '@/components/browser/terminal-node'
import { TerminalDialog } from '@/components/browser/terminal-dialog'
import { BrowserTabDialog } from '@/components/browser/browser-tab-dialog'
import { MonitorWebviews } from '@/components/browser/monitor-webviews'
import { BoardTabsView, type BoardTabsItemKind } from '@/components/browser/board-tabs-view'
import { BrowserFavicon } from '@/components/browser/browser-favicon'
import { BoardDocumentView } from '@/components/browser/board-document-view'
import { useBrowserTabs, type BrowserTab, type BrowserTabMonitor, type MonitorRule } from '@/hooks/use-browser-tabs'
import { useSettings } from '@/hooks/use-settings'
import { useGraphNodes, type GraphNode } from '@/hooks/use-graph-nodes'
import { useBrowserEdges } from '@/hooks/use-browser-edges'
import { useWorkspace, type WorkspaceBoard } from '@/hooks/use-workspace'
import { executeFromTrigger } from '@/services/graph-executor'
import { runAgentOnWebview } from '@/services/browser-agent-runner'
import { getWebviewUserAgent } from '@/lib/webview-user-agent'
import { cronMatchesDate, formatLocalMinuteKey, resolveScheduleCron } from '@/lib/schedule-cron'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel } from '@/components/ui/dropdown-menu'
import { DynamicIcon, IconPicker } from '@/components/ui/icon-picker'
import { SettingsPage, SettingsSidebar, type SettingsSectionId } from '@/pages/settings'
import { CLI_AGENTS, WORKSPACE_AGENT_COMMAND_OVERRIDES_KEY, getAgentCommand } from '@/lib/cli-agents'
import TurndownService from 'turndown'

const MONITOR_TAG = '[browser-monitor]'
const SCHEDULE_TAG = '[schedule-trigger]'
const BROWSER_EXEC_TAG = '[browser-exec]'
const BROWSER_PREVIEW_TAG = '[browser-preview]'
const FLOW_TAG = '[browser-flow]'
const MAX_HTML_CHARS = 250_000
const MAX_OUTPUT_CHARS = 60_000
const SCHEDULE_POLL_INTERVAL_MS = 60_000
const SCHEDULE_ALIGNMENT_GRACE_MS = 250
const SCHEDULE_MIN_TIMER_DELAY_MS = 25
const PREVIEW_LOAD_TIMEOUT_MS = 12_000
const NETWORK_IDLE_POLL_MS = 300
const NETWORK_IDLE_WAIT_MS = 600
const NETWORK_IDLE_TIMEOUT_MS = 15_000
const MAX_TERMINAL_NOTIFICATION_TAIL_CHARS = 2_000
const INTERACTIVE_SELECTOR =
  'a[href], button, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"], [role="row"], [role="checkbox"], [role="switch"], [role="textbox"], [aria-label], [data-tooltip], [onclick], [data-action]'
const WEBVIEW_USER_AGENT = getWebviewUserAgent()
type FlowInteractionMode = 'design' | 'map'

interface TerminalNotificationState {
  tail: string
  hasBackgroundOutput: boolean
  hasSeenPrompt: boolean
  lastAttentionSignature: string | null
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced'
})
turndown.remove(['script', 'style', 'noscript'])


function preview(value: string | undefined, max = 160): string {
  if (!value) return ''
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, max)}...`
}

function stripAnsiFromTerminalOutput(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
}

function normalizeTerminalOutput(value: string): string {
  return stripAnsiFromTerminalOutput(value)
    .replace(/\u0007/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

function getLastNonEmptyTerminalLine(value: string): string {
  const lines = value.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trimEnd() ?? ''
    if (line.length > 0) return line
  }
  return ''
}

function isLikelyShellPromptLine(value: string): boolean {
  const trimmed = value.trimEnd()
  if (!trimmed || trimmed.length > 140) return false
  if (/^PS [^>\n]+>\s*$/.test(value)) return true
  if (/^(?:❯|➜|λ)\s*$/.test(trimmed)) return true
  return /(?:[%#$›»>])\s*$/.test(trimmed)
}

function isLikelyTerminalInputRequest(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 220) return false
  if (/\[(?:Y\/n|y\/N|y\/n|N\/y|n\/Y)\]|\((?:Y\/n|y\/N|y\/n|N\/y|n\/Y)\)/.test(trimmed)) return true
  if (/(press any key|password|passphrase|verification code|one-time code|otp|mfa|two-factor|2fa|username|email|login|confirm|are you sure|continue\?|overwrite\?|retry\?|select an option|choose an option|pick an option|enter (?:choice|selection|value|password|passphrase|code))/i.test(trimmed)) {
    return true
  }
  return /:\s*$/.test(trimmed) && /(password|passphrase|username|email|login|code|otp|token|choice|selection)/i.test(trimmed)
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    target.isContentEditable ||
    !!target.closest('[contenteditable="true"], [role="textbox"]')
  )
}

function normalizePastedUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const cleaned = trimmed.replace(/^<|>$/g, '').replace(/^['"]|['"]$/g, '')
  if (!cleaned || /\s/.test(cleaned)) return null
  try {
    const parsed = new URL(cleaned)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString()
    }
    return null
  } catch {
    // fall through to bare-domain parsing
  }
  if (/^[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}([/?#:].*)?$/.test(cleaned)) {
    try {
      return new URL(`https://${cleaned}`).toString()
    } catch {
      return null
    }
  }
  return null
}

function normalizeIconUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null
  const trimmed = rawUrl.trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString()
    }
  } catch {
    return null
  }
  return null
}

function getNextAlignedMinuteTick(nowTs: number): number {
  const baseMinute = Math.floor(nowTs / SCHEDULE_POLL_INTERVAL_MS) * SCHEDULE_POLL_INTERVAL_MS
  let next = baseMinute + SCHEDULE_POLL_INTERVAL_MS + SCHEDULE_ALIGNMENT_GRACE_MS
  if (next <= nowTs) next += SCHEDULE_POLL_INTERVAL_MS
  return next
}

function parseNodeConfig(rawConfig: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawConfig)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeFormFieldList(rawFields: unknown): FormTriggerFieldConfig[] {
  if (!Array.isArray(rawFields)) return []
  const normalized = rawFields
    .map((rawField, index) => {
      const field = typeof rawField === 'object' && rawField !== null
        ? (rawField as Partial<FormTriggerFieldConfig>)
        : {}
      const keyRaw = typeof field.key === 'string' ? field.key : ''
      const labelRaw = typeof field.label === 'string' ? field.label : ''
      const key = keyRaw
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || `field_${index + 1}`
      return {
        id:
          typeof field.id === 'string' && field.id.trim().length > 0
            ? field.id.trim()
            : `form-field-${index + 1}-${key}`,
        key,
        label: labelRaw.trim() || `Field ${index + 1}`,
        placeholder: typeof field.placeholder === 'string' ? field.placeholder : '',
        required: field.required === true,
        multiline: field.multiline === true,
        defaultValue: typeof field.defaultValue === 'string' ? field.defaultValue : ''
      }
    })
    .filter((field) => field.key.trim().length > 0)
  const seenKeys = new Map<string, number>()
  return normalized.map((field) => {
    const count = seenKeys.get(field.key) ?? 0
    seenKeys.set(field.key, count + 1)
    if (count === 0) return field
    return { ...field, key: `${field.key}_${count + 1}` }
  })
}

function formatFormSubmission(fields: FormTriggerFieldConfig[], values: Record<string, string>): string {
  if (fields.length === 0) return '(No configured fields)'
  // Single field → output the raw value directly
  if (fields.length === 1) {
    return values[fields[0].key] ?? ''
  }
  // Multiple fields → labelled output
  const lines: string[] = []
  for (const field of fields) {
    const value = values[field.key] ?? ''
    lines.push(`${field.label} (${field.key}): ${value || '(empty)'}`)
  }
  return lines.join('\n')
}

const nodeTypes: NodeTypes = {
  browserTab: BrowserTabNode as unknown as NodeTypes['browserTab'],
  trigger: TriggerNode as unknown as NodeTypes['trigger'],
  scheduleTrigger: ScheduleTriggerNode as unknown as NodeTypes['scheduleTrigger'],
  formTrigger: FormTriggerNode as unknown as NodeTypes['formTrigger'],
  debug: DebugNode as unknown as NodeTypes['debug'],
  notification: NotificationNode as unknown as NodeTypes['notification'],
  delay: DelayNode as unknown as NodeTypes['delay'],
  aiPrompt: AiPromptNode as unknown as NodeTypes['aiPrompt'],
  text: TextNode as unknown as NodeTypes['text'],
  output: OutputNode as unknown as NodeTypes['output'],
  file: FileNode as unknown as NodeTypes['file'],
  terminal: TerminalNode as unknown as NodeTypes['terminal']
}

interface ContextMenu {
  x: number
  y: number
  type: 'pane' | 'node'
  nodeId?: string
  nodeType?: string
  flowPosition?: { x: number; y: number }
}

type SidebarItemKind = BoardTabsItemKind

interface BoardItemMenu {
  x: number
  y: number
  itemId: string
  kind: SidebarItemKind
  boardId: string
  source: 'sidebar' | 'tab-strip'
}

interface BoardContextMenu {
  x: number
  y: number
  boardId: string
  boardName: string
}

interface FolderContextMenu {
  x: number
  y: number
  folderId: string
  folderName: string
}

interface RenameDialogState {
  itemId: string
  currentName: string
  boardId: string | null
  kind: 'browser' | 'graph' | SidebarItemKind
}

type SidebarBoardItem =
  | { id: string; kind: 'browser'; tab: BrowserTab }
  | { id: string; kind: 'terminal' | 'file'; node: GraphNode }


function BrowserPageInner(): React.ReactElement {
  const {
    workspace,
    loading: workspaceLoading,
    activeBoard,
    setRootDir,
    resetWorkspace,
    getRecentWorkspaces,
    createFolder,
    renameFolder,
    deleteFolder,
    createBoard,
    renameBoard,
    moveBoard,
    archiveBoard,
    unarchiveBoard,
    deleteBoard,
    setActiveBoard,
    getBoardDocumentHtml,
    setBoardDocumentHtml,
    setBoardActiveView
  } = useWorkspace()
  const activeBoardId = workspace?.activeBoardId ?? null
  const { tabs, refresh, createTab, updateTab, deleteTab, saveOrder: saveTabOrder, savePositions: saveTabPositions } = useBrowserTabs(activeBoardId)
  const { getSetting, setSetting, loading: settingsLoading } = useSettings()
  const {
    graphNodes: gNodes,
    createNode,
    updateNode,
    deleteNode,
    saveOrder: saveNodeOrder,
    savePositions: saveGraphPositions
  } = useGraphNodes(activeBoardId)
  const { edges: savedEdges, saveEdges } = useBrowserEdges(activeBoardId)

  const [selectedTab, setSelectedTab] = useState<BrowserTab | null>(null)
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const activeItemIdRef = useRef<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [terminalDialogNodeId, setTerminalDialogNodeId] = useState<string | null>(null)
  const pendingSelectNonceRef = useRef(0)
  const [pendingTabSelect, setPendingTabSelect] = useState<{ boardId: string | null; itemId: string; nonce: number } | null>(null)
  const pendingTabSelectRef = useRef(pendingTabSelect)
  pendingTabSelectRef.current = pendingTabSelect
  const pendingReloadNonceRef = useRef(0)
  const [pendingTabReload, setPendingTabReload] = useState<{ itemId: string; nonce: number } | null>(null)
  const requestTabSelect = useCallback((itemId: string, boardId: string | null = activeBoardId) => {
    pendingSelectNonceRef.current += 1
    setPendingTabSelect({ boardId, itemId, nonce: pendingSelectNonceRef.current })
  }, [activeBoardId])
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [boardItemMenu, setBoardItemMenu] = useState<BoardItemMenu | null>(null)
  const [boardItemMenuPosition, setBoardItemMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [boardContextMenu, setBoardContextMenu] = useState<BoardContextMenu | null>(null)
  const [boardContextMenuPosition, setBoardContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [folderContextMenu, setFolderContextMenu] = useState<FolderContextMenu | null>(null)
  const [folderContextMenuPosition, setFolderContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [monitorInput, setMonitorInput] = useState('')
  const [monitorNodeId, setMonitorNodeId] = useState<string | null>(null)
  const [expandedMonitorId, setExpandedMonitorId] = useState<string | null>(null)
  const [runningTabs, setRunningTabs] = useState<Set<string>>(new Set())
  const [previewingTabs, setPreviewingTabs] = useState<Set<string>>(new Set())
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const expandedFoldersInitializedRef = useRef(false)
  const [collapsedBoards, setCollapsedBoards] = useState<Set<string>>(new Set())
  const [boardTabsMap, setBoardTabsMap] = useState<Map<string, BrowserTab[]>>(new Map())
  const [boardTerminalsMap, setBoardTerminalsMap] = useState<Map<string, GraphNode[]>>(new Map())
  const [boardFilesMap, setBoardFilesMap] = useState<Map<string, GraphNode[]>>(new Map())
  const [boardItemOrderMap, setBoardItemOrderMap] = useState<Map<string, string[]>>(new Map())
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  const [editingFolderName, setEditingFolderName] = useState('')
  const [editingBoardId, setEditingBoardId] = useState<string | null>(null)
  const [editingBoardName, setEditingBoardName] = useState('')
  const [editingTerminalId, setEditingTerminalId] = useState<string | null>(null)
  const [editingTerminalName, setEditingTerminalName] = useState('')
  const [renameDialog, setRenameDialog] = useState<RenameDialogState | null>(null)
  const [renameDialogValue, setRenameDialogValue] = useState('')
  const [recentWorkspaces, setRecentWorkspaces] = useState<import('@/hooks/use-workspace').RecentWorkspace[]>([])
  const [newWorkspaceDialogOpen, setNewWorkspaceDialogOpen] = useState(false)
  const [notifiedItemIds, setNotifiedItemIds] = useState<Set<string>>(new Set())
  const [sidebarWidth, setSidebarWidth] = useState(288)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('appearance')
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const [boardView, setBoardView] = useState<'whiteboard' | 'tabs' | 'document'>('whiteboard')
  const [boardDocHtml, setBoardDocHtmlState] = useState('<p></p>')
  const [boardDocLoading, setBoardDocLoading] = useState(false)
  const boardDocSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [boardRootDir, setBoardRootDir] = useState<string | null>(null)
  const [settingsDialogBoardId, setSettingsDialogBoardId] = useState<string | null>(null)
  const [settingsDialogRootDir, setSettingsDialogRootDir] = useState('')
  const [archivingBoardId, setArchivingBoardId] = useState<string | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const boardItemMenuRef = useRef<HTMLDivElement | null>(null)
  const boardContextMenuRef = useRef<HTMLDivElement | null>(null)
  const folderContextMenuRef = useRef<HTMLDivElement | null>(null)
  const flowContainerRef = useRef<HTMLDivElement | null>(null)
  const lastMouseClientPositionRef = useRef<{ x: number; y: number } | null>(null)
  const triggerWebviews = useRef<Map<string, Electron.WebviewTag>>(new Map())
  const dialogWebviews = useRef<Map<string, Electron.WebviewTag>>(new Map())
  const previewWebviews = useRef<Map<string, Electron.WebviewTag>>(new Map())
  const previewHydrationInFlightRef = useRef<Set<string>>(new Set())
  const pendingPositionOverrides = useRef<Map<string, { x: number; y: number }>>(new Map())
  const scheduleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleRunningRef = useRef(false)
  const scheduleLastFiredMinuteRef = useRef<Map<string, string>>(new Map())
  const terminalNotificationStateRef = useRef<Map<string, TerminalNotificationState>>(new Map())
  const pendingBoardRenameRef = useRef(false)
  const pendingFolderRenameRef = useRef(false)
  // -- Drag-and-drop state for sidebar boards/folders --
  const dragItemRef = useRef<{ type: 'board' | 'folder'; id: string } | null>(null)
  const [dropTarget, setDropTarget] = useState<{ type: 'folder' | 'ungrouped'; id?: string } | null>(null)
  const [iconPickerTarget, setIconPickerTarget] = useState<{ type: 'folder' | 'board'; id: string; anchor: DOMRect } | null>(null)
  const reactFlowInstance = useReactFlow()
  const location = useLocation()
  const navigate = useNavigate()
  const isSettingsRoute = location.pathname === '/settings'
  const flowInteractionMode: FlowInteractionMode =
    (getSetting('flowInteractionMode') as string) === 'map' ? 'map' : 'design'
  const isMapMode = flowInteractionMode === 'map'
  const flowDirection: FlowDirection =
    (getSetting('flowDirection') as string) === 'vertical' ? 'vertical' : 'horizontal'
  const nodeOpenClick = (getSetting('nodeOpenClick') as string) === 'single' ? 'single' : 'double'
  const workspaceAgentCommandOverrides = getSetting(WORKSPACE_AGENT_COMMAND_OVERRIDES_KEY)

  const terminalNodes = useMemo(() => gNodes.filter((n) => n.nodeType === 'terminal'), [gNodes])
  const fileNodes = useMemo(() => gNodes.filter((n) => n.nodeType === 'file'), [gNodes])
  const outputNodes = useMemo(() => gNodes.filter((n) => n.nodeType === 'output'), [gNodes])

  // -- Notification tracking --
  // Keep activeItemIdRef in sync
  useEffect(() => { activeItemIdRef.current = activeItemId }, [activeItemId])

  // Clear notification when an item becomes active
  useEffect(() => {
    if (!activeItemId) return
    const terminalState = terminalNotificationStateRef.current.get(activeItemId)
    if (terminalState) {
      terminalState.lastAttentionSignature = null
    }
    setNotifiedItemIds((prev) => {
      if (!prev.has(activeItemId)) return prev
      const next = new Set(prev)
      next.delete(activeItemId)
      return next
    })
  }, [activeItemId])

  // Listen for terminal data on non-active terminals and notify only when a
  // command appears finished or the shell is explicitly asking for input.
  useEffect(() => {
    const getTerminalState = (nodeId: string): TerminalNotificationState => {
      const existing = terminalNotificationStateRef.current.get(nodeId)
      if (existing) return existing
      const next: TerminalNotificationState = {
        tail: '',
        hasBackgroundOutput: false,
        hasSeenPrompt: true,
        lastAttentionSignature: null
      }
      terminalNotificationStateRef.current.set(nodeId, next)
      return next
    }

    const markTerminalNotified = (nodeId: string): void => {
      setNotifiedItemIds((prev) => {
        if (prev.has(nodeId)) return prev
        const next = new Set(prev)
        next.add(nodeId)
        return next
      })
    }

    const removeDataListener = window.api.terminal.onData((sessionId: string, data: string) => {
      if (!sessionId.startsWith('pty-')) return
      const nodeId = sessionId.slice(4)
      const state = getTerminalState(nodeId)
      const normalizedChunk = normalizeTerminalOutput(data)
      const nextTail = `${state.tail}${normalizedChunk}`.slice(-MAX_TERMINAL_NOTIFICATION_TAIL_CHARS)
      state.tail = nextTail

      const lastLine = getLastNonEmptyTerminalLine(nextTail)
      const isShellPrompt = isLikelyShellPromptLine(lastLine)
      const isInputRequest = isLikelyTerminalInputRequest(lastLine)
      const hasMeaningfulOutput = /\S/.test(normalizedChunk)
      const isActive = nodeId === activeItemIdRef.current

      if (isActive) {
        state.hasSeenPrompt = state.hasSeenPrompt || isShellPrompt
        if (!isShellPrompt && hasMeaningfulOutput) {
          state.hasBackgroundOutput = true
          state.lastAttentionSignature = null
        } else if (isShellPrompt) {
          state.hasBackgroundOutput = false
          state.lastAttentionSignature = null
        }
        return
      }

      if (!isShellPrompt && hasMeaningfulOutput) {
        state.hasBackgroundOutput = true
        state.lastAttentionSignature = null
      }

      let attentionSignature: string | null = null
      if (isInputRequest) {
        attentionSignature = `input:${lastLine}`
      } else if (isShellPrompt && state.hasSeenPrompt && state.hasBackgroundOutput) {
        attentionSignature = `prompt:${lastLine}`
        state.hasBackgroundOutput = false
      }

      if (isShellPrompt) {
        state.hasSeenPrompt = true
      }

      if (!attentionSignature || attentionSignature === state.lastAttentionSignature) return
      state.lastAttentionSignature = attentionSignature
      markTerminalNotified(nodeId)
    })

    const removeExitListener = window.api.terminal.onExit((sessionId: string) => {
      if (!sessionId.startsWith('pty-')) return
      const nodeId = sessionId.slice(4)
      const state = getTerminalState(nodeId)
      state.hasBackgroundOutput = false
      state.lastAttentionSignature = 'exit'
      if (nodeId === activeItemIdRef.current) return
      markTerminalNotified(nodeId)
    })

    return () => {
      removeDataListener()
      removeExitListener()
    }
  }, [])

  // Track browser tab title changes for non-active tabs
  const prevTabTitlesRef = useRef<Map<string, string>>(new Map())
  useEffect(() => {
    const prevTitles = prevTabTitlesRef.current
    for (const tab of tabs) {
      const prev = prevTitles.get(tab.id)
      if (prev !== undefined && prev !== (tab.title ?? '') && tab.id !== activeItemIdRef.current) {
        setNotifiedItemIds((s) => {
          if (s.has(tab.id)) return s
          const next = new Set(s)
          next.add(tab.id)
          return next
        })
      }
      prevTitles.set(tab.id, tab.title ?? '')
    }
    // Clean up removed tabs
    for (const id of prevTitles.keys()) {
      if (!tabs.some((t) => t.id === id)) prevTitles.delete(id)
    }
  }, [tabs])

  // Update Electron app badge count
  useEffect(() => {
    window.api.app.setBadgeCount(notifiedItemIds.size).catch(() => {})
  }, [notifiedItemIds])

  // Hydrate folder/board collapse state once settings have loaded
  useEffect(() => {
    if (settingsLoading) return
    if (!workspace?.folders) return
    if (expandedFoldersInitializedRef.current) return
    expandedFoldersInitializedRef.current = true

    const savedFolders = getSetting('expandedFolders')
    if (Array.isArray(savedFolders)) {
      setExpandedFolders(new Set(savedFolders as string[]))
    } else {
      // No saved state — default all folders to expanded
      setExpandedFolders(new Set(workspace.folders.map((f) => f.id)))
    }

    const savedBoards = getSetting('collapsedBoards')
    if (Array.isArray(savedBoards)) {
      setCollapsedBoards(new Set(savedBoards as string[]))
    }
  }, [settingsLoading, workspace?.folders, getSetting])

  // Fetch recent workspaces whenever the root dir changes (so the list is ready when dropdown opens)
  useEffect(() => {
    getRecentWorkspaces().then(setRecentWorkspaces).catch(() => {})
  }, [workspace?.rootDir, getRecentWorkspaces])

  // ─── Folder / Board icon & color meta ──────────────────────────────────────
  const folderMeta = (getSetting('folderMeta') ?? {}) as Record<string, { icon?: string; color?: string }>
  const boardMeta = (getSetting('boardMeta') ?? {}) as Record<string, { icon?: string; color?: string }>
  const lastSelectedBoardItems = (getSetting('lastSelectedBoardItems') ?? {}) as Record<string, string>
  const legacyLastSelectedTabs = (getSetting('lastSelectedTabs') ?? {}) as Record<string, string>

  const getFolderMeta = useCallback((id: string) => folderMeta[id] ?? {}, [folderMeta])
  const getBoardMeta = useCallback((id: string) => boardMeta[id] ?? {}, [boardMeta])

  const setFolderMeta = useCallback(
    (id: string, meta: { icon?: string; color?: string }) => {
      void setSetting('folderMeta', (prevValue) => {
        const next = { ...((prevValue as Record<string, { icon?: string; color?: string }> | null) ?? {}) }
        if (!meta.icon && !meta.color) {
          delete next[id]
        } else {
          next[id] = meta
        }
        return next
      })
    },
    [setSetting]
  )

  const setBoardMeta = useCallback(
    (id: string, meta: { icon?: string; color?: string }) => {
      void setSetting('boardMeta', (prevValue) => {
        const next = { ...((prevValue as Record<string, { icon?: string; color?: string }> | null) ?? {}) }
        if (!meta.icon && !meta.color) {
          delete next[id]
        } else {
          next[id] = meta
        }
        return next
      })
    },
    [setSetting]
  )

  const restoredBoardItemId = activeBoardId
    ? (lastSelectedBoardItems[activeBoardId] ?? legacyLastSelectedTabs[activeBoardId] ?? null)
    : null

  const openBoardIconPicker = useCallback((boardId: string, anchorEl: HTMLElement) => {
    const rect = anchorEl.getBoundingClientRect()
    setIconPickerTarget({ type: 'board', id: boardId, anchor: rect })
  }, [])

  const openFolderIconPicker = useCallback((folderId: string, anchorEl: HTMLElement) => {
    const rect = anchorEl.getBoundingClientRect()
    setIconPickerTarget({ type: 'folder', id: folderId, anchor: rect })
  }, [])

  const settingsDialogBoard = useMemo(
    () => workspace?.boards.find((board) => board.id === settingsDialogBoardId) ?? null,
    [settingsDialogBoardId, workspace?.boards]
  )

  const boardsByFolderId = useMemo(() => {
    const map = new Map<string, WorkspaceBoard[]>()
    if (!workspace) return map
    for (const board of workspace.boards) {
      const key = board.folderId ?? '__ungrouped__'
      const existing = map.get(key) ?? []
      existing.push(board)
      map.set(key, existing)
    }
    return map
  }, [workspace])

  useEffect(() => {
    if (!workspace) return
    let cancelled = false
    const loadAllBoardTabs = async (): Promise<void> => {
      const next = new Map<string, BrowserTab[]>()
      const nextItemOrderMap = new Map<string, string[]>()
      const boardEntries = await Promise.all(
        workspace.boards.map(async (board) => {
          const [boardTabs, itemOrder] = await Promise.all([
            window.api.browserTabs.list(board.id),
            window.api.browserTabs.getViewOrder(board.id)
          ])
          return { boardId: board.id, boardTabs, itemOrder }
        })
      )
      if (cancelled) return
      for (const { boardId, boardTabs, itemOrder } of boardEntries) {
        next.set(boardId, boardTabs)
        if (itemOrder.length > 0) {
          nextItemOrderMap.set(boardId, itemOrder)
        }
      }
      setBoardTabsMap(next)
      setBoardItemOrderMap((prev) => {
        const merged = new Map(nextItemOrderMap)
        const activeOrder = activeBoardId ? prev.get(activeBoardId) : undefined
        if (activeBoardId && activeOrder) {
          merged.set(activeBoardId, activeOrder)
        }
        return merged
      })
    }
    void loadAllBoardTabs()
    return () => { cancelled = true }
  }, [workspace, tabs, activeBoardId])

  // Load terminal and file nodes for non-active boards (sidebar).
  // Mirrors the boardTabsMap pattern — only re-fetches when workspace changes.
  useEffect(() => {
    if (!workspace) return
    let cancelled = false
    const loadOtherBoardNodes = async (): Promise<void> => {
      const nextTerminals = new Map<string, GraphNode[]>()
      const nextFiles = new Map<string, GraphNode[]>()
      for (const board of workspace.boards) {
        if (board.id === activeBoardId) continue
        const allNodes: GraphNode[] = await window.api.graphNodes.list(board.id)
        if (cancelled) return
        const terminals = allNodes.filter((n) => n.nodeType === 'terminal')
        const files = allNodes.filter((n) => n.nodeType === 'file')
        if (terminals.length > 0) nextTerminals.set(board.id, terminals)
        if (files.length > 0) nextFiles.set(board.id, files)
      }
      if (!cancelled) {
        setBoardTerminalsMap((prev) => {
          const merged = new Map(nextTerminals)
          const active = prev.get(activeBoardId ?? '')
          if (active && activeBoardId) merged.set(activeBoardId, active)
          return merged
        })
        setBoardFilesMap((prev) => {
          const merged = new Map(nextFiles)
          const active = prev.get(activeBoardId ?? '')
          if (active && activeBoardId) merged.set(activeBoardId, active)
          return merged
        })
      }
    }
    void loadOtherBoardNodes()
    return () => { cancelled = true }
  }, [workspace, activeBoardId])

  // Keep active board's terminal and file entries in sync from the already-loaded gNodes
  // (no IPC, no async — just a derived update).
  useEffect(() => {
    if (!activeBoardId) return
    const terminals = gNodes.filter((n) => n.nodeType === 'terminal')
    setBoardTerminalsMap((prev) => {
      const next = new Map(prev)
      if (terminals.length > 0) {
        next.set(activeBoardId, terminals)
      } else {
        next.delete(activeBoardId)
      }
      return next
    })
    const files = gNodes.filter((n) => n.nodeType === 'file')
    setBoardFilesMap((prev) => {
      const next = new Map(prev)
      if (files.length > 0) {
        next.set(activeBoardId, files)
      } else {
        next.delete(activeBoardId)
      }
      return next
    })
  }, [activeBoardId, gNodes])

  const toggleBoardCollapsed = useCallback((boardId: string) => {
    setCollapsedBoards((prev) => {
      const next = new Set(prev)
      if (next.has(boardId)) {
        next.delete(boardId)
      } else {
        next.add(boardId)
      }
      void setSetting('collapsedBoards', Array.from(next))
      return next
    })
  }, [setSetting])

  useEffect(() => {
    if (pendingBoardRenameRef.current || pendingFolderRenameRef.current) return
    setRunningTabs(new Set())
    setPreviewingTabs(new Set())
    dialogWebviews.current.clear()
    setMonitorNodeId(null)
    setSelectedTab(null)
    setDialogOpen(false)
    setTerminalDialogNodeId(null)
    setContextMenu(null)
    setBoardItemMenu(null)
    setBoardContextMenu(null)
    setFolderContextMenu(null)
  }, [activeBoardId])

  useEffect(() => {
    if (!workspace) return
    if (editingFolderId && !workspace.folders.some((folder) => folder.id === editingFolderId)) {
      setEditingFolderId(null)
      setEditingFolderName('')
    }
    if (editingBoardId && !workspace.boards.some((board) => board.id === editingBoardId)) {
      setEditingBoardId(null)
      setEditingBoardName('')
    }
    if (editingTerminalId) {
      const allTerminals = Array.from(boardTerminalsMap.values()).flat()
      if (!allTerminals.some((tn) => tn.id === editingTerminalId)) {
        setEditingTerminalId(null)
        setEditingTerminalName('')
      }
    }
  }, [workspace, editingFolderId, editingBoardId, editingTerminalId, boardTerminalsMap])

  // Load board activeView when activeBoardId changes
  useEffect(() => {
    if (!activeBoardId) {
      setBoardView('whiteboard')
      return
    }
    // Pending tab selection → force tabs view, skip loading saved view
    if (pendingTabSelectRef.current?.boardId === activeBoardId) {
      setBoardView('tabs')
      setTerminalDialogNodeId(null)
      return
    }
    let cancelled = false
    void window.api.workspace.getBoardActiveView(activeBoardId)
      .then((view) => {
        if (cancelled) return
        const v = view as string
        if (v === 'whiteboard' || v === 'tabs' || v === 'document') {
          setBoardView(v)
        } else {
          setBoardView('whiteboard')
        }
      })
      .catch(() => {
        if (!cancelled) setBoardView('whiteboard')
      })
    return (): void => { cancelled = true }
  }, [activeBoardId])

  // Load board rootDir when activeBoardId changes
  useEffect(() => {
    if (!activeBoardId) {
      setBoardRootDir(null)
      return
    }
    let cancelled = false
    void window.api.workspace.getBoardRootDir(activeBoardId)
      .then((dir) => {
        if (!cancelled) setBoardRootDir((dir as string) || null)
      })
      .catch(() => {
        if (!cancelled) setBoardRootDir(null)
      })
    return (): void => { cancelled = true }
  }, [activeBoardId])

  // Load board document HTML when switching to document view
  useEffect(() => {
    if (boardDocSaveTimerRef.current) {
      clearTimeout(boardDocSaveTimerRef.current)
      boardDocSaveTimerRef.current = null
    }
    if (boardView !== 'document' || !activeBoardId) {
      return
    }
    let cancelled = false
    setBoardDocLoading(true)
    void getBoardDocumentHtml(activeBoardId)
      .then((html) => {
        if (cancelled) return
        setBoardDocHtmlState(html || '<p></p>')
      })
      .catch((error) => {
        if (cancelled) return
        console.error(`${FLOW_TAG} failed to load board document html:`, error)
        setBoardDocHtmlState('<p></p>')
      })
      .finally(() => {
        if (!cancelled) setBoardDocLoading(false)
      })
    return (): void => { cancelled = true }
  }, [activeBoardId, boardView, getBoardDocumentHtml])

  useEffect(() => {
    return (): void => {
      if (boardDocSaveTimerRef.current) {
        clearTimeout(boardDocSaveTimerRef.current)
      }
    }
  }, [])

  const handleBoardViewChange = useCallback(
    (view: 'whiteboard' | 'tabs' | 'document') => {
      setBoardView(view)
      // Close terminal dialog when switching to tab/document view to avoid
      // competing xterm instances for the same PTY session
      if (view !== 'whiteboard') {
        setTerminalDialogNodeId(null)
      }
      if (activeBoardId) {
        void setBoardActiveView(activeBoardId, view).catch((error) => {
          console.error(`${FLOW_TAG} failed to persist board active view:`, error)
        })
      }
    },
    [activeBoardId, setBoardActiveView]
  )

  const isCompactTabsView = !isSettingsRoute && boardView === 'tabs'

  const boardViewOptions = useMemo(
    () => [
      { value: 'whiteboard' as const, label: 'Whiteboard', icon: Presentation },
      { value: 'tabs' as const, label: 'Tabs', icon: PanelTop },
      { value: 'document' as const, label: 'Notebook', icon: NotebookPen }
    ],
    []
  )

  const currentBoardViewOption = boardViewOptions.find((option) => option.value === boardView) ?? boardViewOptions[0]

  const renderBoardViewSwitcher = useCallback(
    (className: string): React.ReactElement => {
      const CurrentIcon = currentBoardViewOption.icon
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={className}
              title={`View: ${currentBoardViewOption.label}`}
            >
              <CurrentIcon className="h-3.5 w-3.5 shrink-0" />
              <span>{currentBoardViewOption.label}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[180px] rounded-xl">
            {boardViewOptions.map((option) => {
              const Icon = option.icon
              const isActive = option.value === boardView
              return (
                <DropdownMenuItem
                  key={option.value}
                  className="gap-2 text-xs"
                  onClick={() => handleBoardViewChange(option.value)}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1">{option.label}</span>
                  {isActive ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )
    },
    [boardView, boardViewOptions, currentBoardViewOption, handleBoardViewChange]
  )

  const handleBoardDocHtmlChange = useCallback(
    (nextHtml: string) => {
      setBoardDocHtmlState(nextHtml)
      if (!activeBoardId) return
      if (boardDocSaveTimerRef.current) {
        clearTimeout(boardDocSaveTimerRef.current)
      }
      boardDocSaveTimerRef.current = setTimeout(() => {
        void setBoardDocumentHtml(activeBoardId, nextHtml).catch((error) => {
          console.error(`${FLOW_TAG} failed to persist board document html:`, error)
        })
      }, 450)
    },
    [activeBoardId, setBoardDocumentHtml]
  )

  const setNodeRuntimeStatus = useCallback(
    (nodeId: string, status: string, isRunning?: boolean, runtimeOutput?: string): void => {
      reactFlowInstance.setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== nodeId) return n
          const nextData: Record<string, unknown> = {
            ...(n.data as Record<string, unknown>),
            runtimeStatus: status,
            runtimeUpdatedAt: Date.now()
          }
          if (isRunning !== undefined) {
            nextData.isRunning = isRunning
          }
          if (runtimeOutput !== undefined) {
            nextData.runtimeOutput = runtimeOutput
          }
          return { ...n, data: nextData }
        })
      )
    },
    [reactFlowInstance]
  )

  const hydratePastedTabPreview = useCallback(
    async (tabNodeId: string, initialUrl?: string): Promise<void> => {
      if (previewHydrationInFlightRef.current.has(tabNodeId)) return
      previewHydrationInFlightRef.current.add(tabNodeId)
      setPreviewingTabs((prev) => new Set(prev).add(tabNodeId))
      setNodeRuntimeStatus(tabNodeId, 'Browser: preparing preview', true)

      try {
        let waitAttempts = 0
        let webview = previewWebviews.current.get(tabNodeId)
        if (!webview) {
          await new Promise<void>((resolve, reject) => {
            const maxAttempts = 120
            const check = (): void => {
              waitAttempts += 1
              const candidate = previewWebviews.current.get(tabNodeId)
              if (candidate) {
                resolve()
                return
              }
              if (waitAttempts >= maxAttempts) {
                reject(new Error('Preview webview unavailable'))
                return
              }
              setTimeout(check, 50)
            }
            setTimeout(check, 20)
          })
          webview = previewWebviews.current.get(tabNodeId)
        }

        if (!webview) {
          throw new Error('Preview webview missing after wait')
        }

        const tab = tabs.find((item) => item.id === tabNodeId)
        const sourceUrl = normalizePastedUrl(initialUrl ?? '') ?? normalizePastedUrl(tab?.url ?? '')
        if (!sourceUrl) {
          setNodeRuntimeStatus(tabNodeId, 'Browser: preview skipped (invalid URL)', false)
          return
        }

        let faviconUrl: string | null = null
        const onFaviconUpdated = ((event: Event): void => {
          const eventData = event as unknown as { favicons?: string[] }
          const first = eventData.favicons?.[0]
          const normalized = normalizeIconUrl(first)
          if (normalized) faviconUrl = normalized
        }) as EventListener

        webview.addEventListener('page-favicon-updated', onFaviconUpdated)
        try {
          setNodeRuntimeStatus(tabNodeId, `Browser: loading ${preview(sourceUrl, 60)}`, true)
          await new Promise<void>((resolve) => {
            let settled = false
            const cleanup = (): void => {
              webview.removeEventListener('did-stop-loading', onDidStopLoading)
              webview.removeEventListener('did-fail-load', onDidFailLoad)
              clearTimeout(timeout)
            }
            const finish = (): void => {
              if (settled) return
              settled = true
              cleanup()
              resolve()
            }
            const onDidStopLoading = (): void => finish()
            const onDidFailLoad = (event: Event): void => {
              const fail = event as unknown as { errorCode?: number; errorDescription?: string }
              if (fail.errorCode === -3) return
              console.warn(
                `${BROWSER_PREVIEW_TAG} tab=${tabNodeId} did-fail-load code=${fail.errorCode ?? 'unknown'} error="${fail.errorDescription ?? 'unknown'}"`
              )
              finish()
            }
            const timeout = setTimeout(() => {
              console.warn(
                `${BROWSER_PREVIEW_TAG} tab=${tabNodeId} load timeout after ${PREVIEW_LOAD_TIMEOUT_MS}ms`
              )
              finish()
            }, PREVIEW_LOAD_TIMEOUT_MS)

            webview.addEventListener('did-stop-loading', onDidStopLoading)
            webview.addEventListener('did-fail-load', onDidFailLoad)
            webview.loadURL(sourceUrl).catch((error: Error) => {
              if (error.message?.includes('ERR_ABORTED')) {
                finish()
                return
              }
              console.warn(`${BROWSER_PREVIEW_TAG} tab=${tabNodeId} loadURL error:`, error)
              finish()
            })
          })

          await new Promise((resolve) => setTimeout(resolve, 500))

          const currentUrl = webview.getURL()
          const finalUrl = normalizePastedUrl(currentUrl) ?? sourceUrl
          let finalTitle = webview.getTitle().trim()
          if (!finalTitle) {
            try {
              const domTitle = (await webview.executeJavaScript('document.title')) as string
              finalTitle = domTitle?.trim() ?? ''
            } catch {
              finalTitle = ''
            }
          }

          if (!faviconUrl) {
            try {
              const iconHref = (await webview.executeJavaScript(`
                (() => {
                  const selectors = [
                    'link[rel="icon"]',
                    'link[rel="shortcut icon"]',
                    'link[rel*="icon"]'
                  ]
                  for (const selector of selectors) {
                    const el = document.querySelector(selector)
                    const href = el?.getAttribute('href')
                    if (!href) continue
                    try {
                      return new URL(href, location.href).toString()
                    } catch {
                      continue
                    }
                  }
                  return null
                })()
              `)) as string | null
              faviconUrl = normalizeIconUrl(iconHref)
            } catch {
              faviconUrl = null
            }
          }

          const screenshot = await window.api.browserTabs.captureScreenshot(webview.getWebContentsId())

          const updates: Record<string, unknown> = {}
          if (finalUrl) updates.url = finalUrl
          if (finalTitle) updates.title = finalTitle
          if (faviconUrl) updates.favicon = faviconUrl
          if (screenshot) updates.screenshot = screenshot

          if (Object.keys(updates).length > 0) {
            await updateTab(tabNodeId, updates)
            reactFlowInstance.setNodes((nds) =>
              nds.map((n) =>
                n.id === tabNodeId
                  ? { ...n, data: { ...n.data, ...updates } }
                  : n
              )
            )
          }

          const metadataKeys = Object.keys(updates).filter((k) => k !== 'screenshot')
          const summary =
            metadataKeys.length > 0
              ? `Browser: preview ready (${metadataKeys.join(', ')})`
              : 'Browser: preview ready'
          setNodeRuntimeStatus(tabNodeId, summary, false)
          console.log(
            `${BROWSER_PREVIEW_TAG} tab=${tabNodeId} preview ready waitAttempts=${waitAttempts} keys=${Object.keys(updates).join(',') || 'none'} title="${preview(finalTitle, 70)}"`
          )
        } finally {
          webview.removeEventListener('page-favicon-updated', onFaviconUpdated)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setNodeRuntimeStatus(tabNodeId, `Browser: preview failed (${preview(message, 55)})`, false)
        console.warn(`${BROWSER_PREVIEW_TAG} tab=${tabNodeId} preview failed:`, error)
      } finally {
        previewHydrationInFlightRef.current.delete(tabNodeId)
        setPreviewingTabs((prev) => {
          const next = new Set(prev)
          next.delete(tabNodeId)
          return next
        })
      }
    },
    [reactFlowInstance, setNodeRuntimeStatus, tabs, updateTab]
  )

  // ─── Browser tab agent execution ───────────────────────────────────────

  const handleDialogWebviewStateChange = useCallback((tabId: string, webview: Electron.WebviewTag | null) => {
    if (webview) {
      dialogWebviews.current.set(tabId, webview)
    } else {
      dialogWebviews.current.delete(tabId)
    }
  }, [])

  const executeBrowserTab = useCallback(
    async (tabNodeId: string, inputData?: string, runId?: string): Promise<string | undefined> => {
      const runLabel = runId ?? `standalone-${Date.now().toString(36)}`
      const tab = tabs.find((t) => t.id === tabNodeId)
      if (!tab || !tab.url || tab.url === 'about:blank') {
        setNodeRuntimeStatus(tabNodeId, 'Browser: invalid tab or URL', false)
        console.warn(`${BROWSER_EXEC_TAG} run=${runLabel} tab=${tabNodeId} skipped invalid tab/url`)
        return undefined
      }

      const startTs = Date.now()
      setNodeRuntimeStatus(tabNodeId, 'Browser: preparing webview', true)
      const dialogWebview = dialogWebviews.current.get(tabNodeId)
      const usingLiveDialogWebview = Boolean(dialogWebview)
      if (!usingLiveDialogWebview) {
        // Mark tab as running so the hidden execution webview mounts.
        setRunningTabs((prev) => new Set(prev).add(tabNodeId))
      }
      console.log(
        `${BROWSER_EXEC_TAG} run=${runLabel} tab=${tabNodeId} start url=${tab.url} inputLen=${inputData?.length ?? 0} inputPreview="${preview(inputData)}" source=${usingLiveDialogWebview ? 'dialog' : 'hidden'}`
      )

      try {
        // Prefer the currently open dialog webview for this tab so execution uses
        // the exact same in-memory page/session state the user sees.
        const webviewWaitStart = Date.now()
        let waitAttempts = 0
        let webview = dialogWebview ?? triggerWebviews.current.get(tabNodeId)

        if (!webview && !usingLiveDialogWebview) {
          // Wait for React to render the hidden webview
          setNodeRuntimeStatus(tabNodeId, 'Browser: waiting for hidden webview', true)
          await new Promise<void>((resolve) => {
            const check = (): void => {
              waitAttempts += 1
              webview = triggerWebviews.current.get(tabNodeId)
              if (webview) {
                resolve()
              } else {
                setTimeout(check, 100)
              }
            }
            // Give React a tick to render
            setTimeout(check, 50)
          })
          webview = triggerWebviews.current.get(tabNodeId)
        }
        console.log(
          `${BROWSER_EXEC_TAG} run=${runLabel} tab=${tabNodeId} webviewLookup waitMs=${Date.now() - webviewWaitStart} attempts=${waitAttempts} source=${usingLiveDialogWebview ? 'dialog' : 'hidden'}`
        )

        if (!webview) {
          setNodeRuntimeStatus(tabNodeId, 'Browser: failed (webview unavailable)', false)
          console.error(`${BROWSER_EXEC_TAG} run=${runLabel} tab=${tabNodeId} no webview available`)
          return undefined
        }
        if (WEBVIEW_USER_AGENT) {
          console.log(`${BROWSER_EXEC_TAG} run=${runLabel} tab=${tabNodeId} using webview userAgent attribute`)
        }

        // If we're attached to the live dialog webview, keep its current state.
        // Hidden webviews still navigate to the persisted tab URL before execution.
        const currentWebviewUrl = webview.getURL()
        const shouldLoadTabUrl =
          !usingLiveDialogWebview ||
          !currentWebviewUrl ||
          currentWebviewUrl === 'about:blank'

        if (shouldLoadTabUrl) {
          const loadStart = Date.now()
          setNodeRuntimeStatus(tabNodeId, `Browser: loading ${preview(tab.url, 60)}`, true)
          console.log(`${BROWSER_EXEC_TAG} run=${runLabel} tab=${tabNodeId} loading url=${tab.url}`)
          webview.loadURL(tab.url)
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
              console.warn(`${BROWSER_EXEC_TAG} run=${runLabel} tab=${tabNodeId} webview load timeout after 15000ms`)
              resolve()
            }, 15000)

            const handler = (): void => {
              clearTimeout(timeout)
              webview!.removeEventListener('did-stop-loading', handler)
              resolve()
            }
            webview!.addEventListener('did-stop-loading', handler)
          })
          console.log(
            `${BROWSER_EXEC_TAG} run=${runLabel} tab=${tabNodeId} load completed ms=${Date.now() - loadStart}`
          )
        } else {
          setNodeRuntimeStatus(tabNodeId, 'Browser: using live dialog session', true)
          console.log(
            `${BROWSER_EXEC_TAG} run=${runLabel} tab=${tabNodeId} reusing dialog webview currentUrl=${currentWebviewUrl}`
          )
        }

        // Inject a PerformanceObserver to track in-flight network requests, then
        // poll until no new resources have started/completed for a quiet window.
        setNodeRuntimeStatus(tabNodeId, 'Browser: waiting for page settle', true)
        const networkIdleStart = Date.now()
        if (usingLiveDialogWebview) {
          // Never monkeypatch fetch/XHR on the user's visible page.
          await new Promise((r) => setTimeout(r, 700))
        } else {
          try {
            await webview.executeJavaScript(`
              (() => {
                if (window.__hooNetIdle) return;
                window.__hooNetIdle = { pending: 0, lastActivity: Date.now() };
                const s = window.__hooNetIdle;
                const ob = new PerformanceObserver((list) => {
                  for (const e of list.getEntries()) {
                    s.lastActivity = Date.now();
                    if (e.entryType === 'resource') {
                      if (e.responseEnd === 0) { s.pending++; }
                      else if (s.pending > 0) { s.pending--; }
                    }
                  }
                });
                ob.observe({ entryTypes: ['resource'] });
                const orig = window.XMLHttpRequest.prototype.open;
                let inflight = 0;
                window.XMLHttpRequest.prototype.open = function(...args) {
                  inflight++;
                  s.pending++;
                  s.lastActivity = Date.now();
                  this.addEventListener('loadend', () => {
                    inflight = Math.max(0, inflight - 1);
                    s.pending = Math.max(0, s.pending - 1);
                    s.lastActivity = Date.now();
                  }, { once: true });
                  return orig.apply(this, args);
                };
                const origFetch = window.fetch;
                window.fetch = function(...args) {
                  s.pending++;
                  s.lastActivity = Date.now();
                  return origFetch.apply(this, args).then(
                    (r) => { s.pending = Math.max(0, s.pending - 1); s.lastActivity = Date.now(); return r; },
                    (e) => { s.pending = Math.max(0, s.pending - 1); s.lastActivity = Date.now(); throw e; }
                  );
                };
              })();
            `)

            // Poll until pending === 0 and no activity for NETWORK_IDLE_WAIT_MS
            await new Promise<void>((resolve) => {
              const deadline = setTimeout(() => {
                console.warn(
                  `${BROWSER_EXEC_TAG} run=${runLabel} tab=${tabNodeId} network idle timeout after ${NETWORK_IDLE_TIMEOUT_MS}ms`
                )
                clearInterval(poller)
                resolve()
              }, NETWORK_IDLE_TIMEOUT_MS)

              const poller = setInterval(() => {
                webview!
                  .executeJavaScript(
                    `JSON.stringify({ pending: window.__hooNetIdle?.pending ?? 0, lastActivity: window.__hooNetIdle?.lastActivity ?? 0 })`
                  )
                  .then((raw: string) => {
                    const state = JSON.parse(raw) as { pending: number; lastActivity: number }
                    const quietMs = Date.now() - state.lastActivity
                    if (state.pending <= 0 && quietMs >= NETWORK_IDLE_WAIT_MS) {
                      clearInterval(poller)
                      clearTimeout(deadline)
                      resolve()
                    }
                  })
                  .catch(() => {
                    // page navigated or crashed — stop waiting
                    clearInterval(poller)
                    clearTimeout(deadline)
                    resolve()
                  })
              }, NETWORK_IDLE_POLL_MS)
            })
          } catch {
            // executeJavaScript failed (e.g. page doesn't allow scripts) — fall back to fixed wait
            await new Promise((r) => setTimeout(r, 1000))
          }

          // Extra settle delay for late-rendering JS (e.g. client-side hydration)
          await new Promise((r) => setTimeout(r, 1000))
        }

        console.log(
          `${BROWSER_EXEC_TAG} run=${runLabel} tab=${tabNodeId} page settled ms=${Date.now() - networkIdleStart} url=${webview.getURL()} title="${preview(webview.getTitle(), 90)}"`
        )

        let agentSummary: string | undefined
        const prompt = inputData?.trim()
        if (prompt) {
          const agentStart = Date.now()
          setNodeRuntimeStatus(tabNodeId, 'Agent: starting', true)
          console.log(`${BROWSER_EXEC_TAG} run=${runLabel} tab=${tabNodeId} running browser agent promptLen=${prompt.length}`)
          const result = await runAgentOnWebview(tabNodeId, prompt, webview, {
            onStatus: (status) => setNodeRuntimeStatus(tabNodeId, status, true)
          })
          agentSummary = result.content
          setNodeRuntimeStatus(tabNodeId, `Agent: complete (${result.iterations} iterations)`, true)
          console.log(
            `${BROWSER_EXEC_TAG} run=${runLabel} tab=${tabNodeId} browser agent done ms=${Date.now() - agentStart} outputLen=${agentSummary?.length ?? 0} outputPreview="${preview(agentSummary)}"`
          )
        } else {
          setNodeRuntimeStatus(tabNodeId, 'Browser: capturing page content', true)
          console.log(`${BROWSER_EXEC_TAG} run=${runLabel} tab=${tabNodeId} no input prompt; capturing page content only`)
        }

        // Sync the webview's final state back to the tab record + React Flow node
        try {
          const finalUrl = webview.getURL()
          const dbUpdates: Record<string, unknown> = {}
          const nodeDataUpdates: Record<string, unknown> = {}

          if (finalUrl && finalUrl !== 'about:blank' && finalUrl !== tab.url) {
            dbUpdates.url = finalUrl
            nodeDataUpdates.url = finalUrl
            const finalTitle = (await webview.executeJavaScript('document.title')) as string
            if (finalTitle) {
              dbUpdates.title = finalTitle
              nodeDataUpdates.title = finalTitle
            }
          }

          // Capture a screenshot of the final page state
          const wcId = webview.getWebContentsId()
          const screenshot = await window.api.browserTabs.captureScreenshot(wcId)
          if (screenshot) {
            dbUpdates.screenshot = screenshot
            nodeDataUpdates.screenshot = screenshot
          }

          // Persist to DB
          if (Object.keys(dbUpdates).length > 0) {
            console.log(
              `${BROWSER_EXEC_TAG} run=${runLabel} tab=${tabNodeId} persisting tab updates keys=${Object.keys(dbUpdates).join(',')}`
            )
            await updateTab(tabNodeId, dbUpdates)
          }

          // Directly update React Flow node so the canvas reflects changes immediately
          if (Object.keys(nodeDataUpdates).length > 0) {
            console.log(
              `${BROWSER_EXEC_TAG} run=${runLabel} tab=${tabNodeId} updating node data keys=${Object.keys(nodeDataUpdates).join(',')}`
            )
            reactFlowInstance.setNodes((nds) =>
              nds.map((n) =>
                n.id === tabNodeId
                  ? { ...n, data: { ...n.data, ...nodeDataUpdates } }
                  : n
              )
            )
          }
        } catch (syncErr) {
          // Webview may have been destroyed already — ignore
          console.warn(`${BROWSER_EXEC_TAG} run=${runLabel} tab=${tabNodeId} final state sync skipped:`, syncErr)
        }

        // Capture text-first context (more reliable for SPAs) plus HTML→markdown fallback.
        const contextCaptureStart = Date.now()
        setNodeRuntimeStatus(tabNodeId, 'Browser: extracting page snapshot', true)
        let visibleText = ''
        let interactiveElements = ''
        try {
          const selectorLiteral = JSON.stringify(INTERACTIVE_SELECTOR)
          const contextCapture = (await webview.executeJavaScript(`
            (() => {
              const sel = ${selectorLiteral};
              const isVisible = (el) => {
                const r = el.getBoundingClientRect();
                if (r.width <= 0 || r.height <= 0) return false;
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') return false;
                return true;
              };
              const bodyText = (document.body && document.body.innerText) || (document.documentElement && document.documentElement.innerText) || '';
              const text = bodyText.replace(/\\s+/g, ' ').trim().slice(0, 12000);
              const elements = Array.from(document.querySelectorAll(sel))
                .filter(isVisible)
                .slice(0, 120)
                .map((el, i) => {
                  const tag = el.tagName.toLowerCase();
                  const role = el.getAttribute('role') || '';
                  const text = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80);
                  const ariaLabel = el.getAttribute('aria-label') || '';
                  const title = el.getAttribute('title') || '';
                  const placeholder = el.getAttribute('placeholder') || '';
                  const href = el.getAttribute('href') || '';
                  let desc = '[' + i + '] <' + tag + '>';
                  if (role) desc += ' role=' + role;
                  if (text) desc += ' text="' + text + '"';
                  if (ariaLabel) desc += ' aria-label="' + ariaLabel + '"';
                  if (title) desc += ' title="' + title + '"';
                  if (placeholder) desc += ' placeholder="' + placeholder + '"';
                  if (href) desc += ' href="' + href + '"';
                  return desc;
                })
                .join('\\n');
              return { text, elements };
            })()
          `)) as { text?: string; elements?: string }
          visibleText = (contextCapture?.text ?? '').trim()
          interactiveElements = (contextCapture?.elements ?? '').trim()
          console.log(
            `${BROWSER_EXEC_TAG} run=${runLabel} tab=${tabNodeId} context captured ms=${Date.now() - contextCaptureStart} textLen=${visibleText.length} elements=${interactiveElements ? interactiveElements.split('\n').filter(Boolean).length : 0}`
          )
        } catch (error) {
          console.warn(`${BROWSER_EXEC_TAG} run=${runLabel} tab=${tabNodeId} context capture failed:`, error)
        }

        const htmlCaptureStart = Date.now()
        setNodeRuntimeStatus(tabNodeId, 'Browser: extracting HTML snapshot', true)
        const htmlCapture = (await webview.executeJavaScript(`
          (() => {
            const html = document.documentElement?.outerHTML ?? ''
            const originalLength = html.length
            const truncated = originalLength > ${MAX_HTML_CHARS}
            return {
              html: truncated ? html.slice(0, ${MAX_HTML_CHARS}) : html,
              originalLength,
              truncated
            }
          })()
        `)) as { html?: string; originalLength?: number; truncated?: boolean }

        const rawHtml = htmlCapture?.html ?? ''
        const originalHtmlLength = htmlCapture?.originalLength ?? rawHtml.length
        const htmlTruncated = htmlCapture?.truncated ?? false
        console.log(
          `${BROWSER_EXEC_TAG} run=${runLabel} tab=${tabNodeId} html captured ms=${Date.now() - htmlCaptureStart} originalLen=${originalHtmlLength} capturedLen=${rawHtml.length} truncated=${htmlTruncated}`
        )

        const turndownStart = Date.now()
        setNodeRuntimeStatus(tabNodeId, 'Browser: converting HTML to markdown', true)
        const markdown = turndown.turndown(rawHtml)
        console.log(
          `${BROWSER_EXEC_TAG} run=${runLabel} tab=${tabNodeId} turndown done ms=${Date.now() - turndownStart} markdownLen=${markdown.length}`
        )
        if (!markdown.trim()) {
          console.warn(`${BROWSER_EXEC_TAG} run=${runLabel} tab=${tabNodeId} markdown output is empty`)
        }

        const finalUrl = webview.getURL()
        const finalTitle = webview.getTitle()
        const snapshotSections = [
          '[Web Content Snapshot]',
          `URL: ${finalUrl}`,
          `Title: ${finalTitle}`,
          ''
        ]
        if (interactiveElements) {
          snapshotSections.push('[Interactive Elements]', interactiveElements, '')
        }
        if (visibleText) {
          snapshotSections.push('[Visible Text]', visibleText, '')
        }
        if (markdown.trim()) {
          snapshotSections.push('[DOM Markdown]', markdown)
        } else if (!visibleText && !interactiveElements) {
          snapshotSections.push('(No readable page content captured)')
        }
        const snapshot = snapshotSections.join('\n')

        const output =
          snapshot.length > MAX_OUTPUT_CHARS
            ? `${snapshot.slice(0, MAX_OUTPUT_CHARS)}\n\n[Truncated at ${MAX_OUTPUT_CHARS} chars]`
            : snapshot

        console.log(
          `${BROWSER_EXEC_TAG} run=${runLabel} tab=${tabNodeId} output ready agentLen=${agentSummary?.length ?? 0} snapshotLen=${snapshot.length} outputLen=${output.length} outputPreview="${preview(output, 220)}"`
        )
        if (snapshot.length > MAX_OUTPUT_CHARS) {
          console.warn(
            `${BROWSER_EXEC_TAG} run=${runLabel} tab=${tabNodeId} output truncated from ${snapshot.length} to ${MAX_OUTPUT_CHARS}`
          )
        }
        setNodeRuntimeStatus(tabNodeId, `Browser complete (${output.length} chars)`, false, output)
        return output
      } catch (err) {
        setNodeRuntimeStatus(
          tabNodeId,
          `Browser error: ${preview(err instanceof Error ? err.message : String(err), 70)}`,
          false
        )
        console.error(`${BROWSER_EXEC_TAG} run=${runLabel} tab=${tabNodeId} executeBrowserTab error:`, err)
        return undefined
      } finally {
        console.log(
          `${BROWSER_EXEC_TAG} run=${runLabel} tab=${tabNodeId} complete totalMs=${Date.now() - startTs}`
        )
        if (!usingLiveDialogWebview) {
          setRunningTabs((prev) => {
            const next = new Set(prev)
            next.delete(tabNodeId)
            return next
          })
        }
        reactFlowInstance.setNodes((nds) =>
          nds.map((n) => {
            if (n.id !== tabNodeId) return n
            return {
              ...n,
              data: {
                ...(n.data as Record<string, unknown>),
                isRunning: false
              }
            }
          })
        )
      }
    },
    [tabs, updateTab, reactFlowInstance, setNodeRuntimeStatus]
  )

  // ─── Graph node callbacks ──────────────────────────────────────────────────

  const handleTrigger = useCallback(
    (nodeId: string) => {
      // Get current nodes and edges from React Flow state
      const currentNodes = reactFlowInstance.getNodes()
      const currentEdges = reactFlowInstance.getEdges()

      const updateNodeData = (id: string, updater: (prev: Record<string, unknown>) => Record<string, unknown>): void => {
        reactFlowInstance.setNodes((nds) =>
          nds.map((n) => (n.id === id ? { ...n, data: updater(n.data as Record<string, unknown>) } : n))
        )
      }

      executeFromTrigger(
        nodeId,
        currentEdges,
        currentNodes,
        updateNodeData,
        undefined,
        executeBrowserTab,
        undefined,
        undefined,
        activeBoardId ?? undefined
      )
    },
    [reactFlowInstance, executeBrowserTab, activeBoardId]
  )

  const runFromTriggerNode = useCallback(
    async (nodeId: string, runId?: string): Promise<void> => {
      const currentNodes = reactFlowInstance.getNodes()
      const currentEdges = reactFlowInstance.getEdges()
      const updateNodeData = (id: string, updater: (prev: Record<string, unknown>) => Record<string, unknown>): void => {
        reactFlowInstance.setNodes((nds) =>
          nds.map((n) => (n.id === id ? { ...n, data: updater(n.data as Record<string, unknown>) } : n))
        )
      }
      await executeFromTrigger(
        nodeId,
        currentEdges,
        currentNodes,
        updateNodeData,
        undefined,
        executeBrowserTab,
        undefined,
        runId,
        activeBoardId ?? undefined
      )
    },
    [reactFlowInstance, executeBrowserTab, activeBoardId]
  )

  const handleScheduleTrigger = useCallback(
    (nodeId: string) => {
      const runId = `schedule-manual-${Date.now().toString(36)}`
      setNodeRuntimeStatus(nodeId, 'Schedule manual trigger started', true)
      void runFromTriggerNode(nodeId, runId)
        .then(() => {
          setNodeRuntimeStatus(nodeId, 'Schedule manual trigger complete', false)
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          setNodeRuntimeStatus(nodeId, `Schedule manual trigger failed: ${preview(message, 60)}`, false)
          console.error(`${SCHEDULE_TAG} run=${runId} manual trigger failed node=${nodeId}:`, error)
        })
    },
    [runFromTriggerNode, setNodeRuntimeStatus]
  )

  const handleEditNotificationConfig = useCallback(
    async (nodeId: string, config: { title?: string; body?: string }) => {
      await updateNode(nodeId, { config: JSON.stringify(config) })
    },
    [updateNode]
  )

  const handleEditDelayConfig = useCallback(
    async (nodeId: string, config: { seconds?: number }) => {
      await updateNode(nodeId, { config: JSON.stringify(config) })
    },
    [updateNode]
  )

  const handleEditAiPrompt = useCallback(
    async (nodeId: string, promptText: string) => {
      const node = gNodes.find((n) => n.id === nodeId)
      const existingConfig = node ? parseNodeConfig(node.config) : {}
      await updateNode(nodeId, {
        config: JSON.stringify({ ...existingConfig, prompt: promptText })
      })
    },
    [updateNode, gNodes]
  )

  const handleEditText = useCallback(
    async (nodeId: string, textContent: string) => {
      const node = gNodes.find((n) => n.id === nodeId)
      const existingConfig = node ? parseNodeConfig(node.config) : {}
      await updateNode(nodeId, {
        config: JSON.stringify({ ...existingConfig, text: textContent })
      })
    },
    [updateNode, gNodes]
  )

  const handleEditFormTriggerConfig = useCallback(
    async (nodeId: string, config: FormTriggerConfig) => {
      const node = gNodes.find((n) => n.id === nodeId)
      const existingConfig = node ? parseNodeConfig(node.config) : {}
      await updateNode(nodeId, {
        config: JSON.stringify({
          ...existingConfig,
          ...config,
          fields: normalizeFormFieldList(config.fields)
        })
      })
    },
    [updateNode, gNodes]
  )

  const handleSubmitFormTrigger = useCallback(
    async (nodeId: string, values: Record<string, string>, config: FormTriggerConfig): Promise<void> => {
      const runId = `form-submit-${Date.now().toString(36)}`
      const normalizedFields = normalizeFormFieldList(config.fields)
      const normalizedValues: Record<string, string> = {}
      for (const field of normalizedFields) {
        normalizedValues[field.key] = values[field.key] ?? ''
      }

      const submissionOutput = formatFormSubmission(normalizedFields, normalizedValues)
      const nextConfig: FormTriggerConfig = {
        ...config,
        fields: normalizedFields,
        lastSubmission: submissionOutput
      }
      const serializedConfig = JSON.stringify(nextConfig)

      reactFlowInstance.setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                data: {
                  ...(n.data as Record<string, unknown>),
                  config: nextConfig
                }
              }
            : n
        )
      )
      void window.api.graphNodes
        .update(nodeId, { config: serializedConfig }, activeBoardId ?? undefined)
        .catch((error) => console.error(`${FLOW_TAG} failed to persist form trigger config node=${nodeId}:`, error))

      setNodeRuntimeStatus(nodeId, `Form submitted (${submissionOutput.length} chars)`, true)

      const liveNodes = reactFlowInstance.getNodes()
      const currentNodes = liveNodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...(node.data as Record<string, unknown>),
                config: nextConfig
              }
            }
          : node
      )
      const currentEdges = reactFlowInstance.getEdges()
      const updateNodeData = (id: string, updater: (prev: Record<string, unknown>) => Record<string, unknown>): void => {
        reactFlowInstance.setNodes((nds) =>
          nds.map((n) => (n.id === id ? { ...n, data: updater(n.data as Record<string, unknown>) } : n))
        )
      }

      // Pre-seed per-field outputs so field-specific handles resolve correctly
      const preseededOutputs = new Map<string, string>()
      for (const field of normalizedFields) {
        preseededOutputs.set(`${nodeId}:field:${field.key}`, normalizedValues[field.key] ?? '')
      }

      try {
        await executeFromTrigger(
          nodeId,
          currentEdges,
          currentNodes,
          updateNodeData,
          submissionOutput,
          executeBrowserTab,
          preseededOutputs,
          runId,
          activeBoardId ?? undefined
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setNodeRuntimeStatus(nodeId, `Form submit failed: ${preview(message, 60)}`, false)
        console.error(`${FLOW_TAG} form submit failed node=${nodeId} run=${runId}:`, error)
      }
    },
    [reactFlowInstance, executeBrowserTab, setNodeRuntimeStatus, activeBoardId]
  )

  const handleEditScheduleConfig = useCallback(
    async (nodeId: string, config: ScheduleTriggerConfig) => {
      const prompt = config.prompt?.trim()
      const cron = config.cron?.trim()
      const resolved = resolveScheduleCron(prompt, cron)
      const nextConfig: ScheduleTriggerConfig = {
        prompt: prompt || undefined,
        cron: cron || resolved.cron || undefined,
        enabled: config.enabled !== false
      }
      await updateNode(nodeId, { config: JSON.stringify(nextConfig) })
    },
    [updateNode]
  )

  const handleEditFileConfig = useCallback(
    async (
      nodeId: string,
      config: {
        filePath?: string
        writeMode?: 'overwrite' | 'append'
        lastOperation?: 'read' | 'write'
        lastRunAt?: string
        lastBytes?: number
        lastError?: string | null
        lastReadPreview?: string
      }
    ) => {
      await updateNode(nodeId, { config: JSON.stringify(config) })
    },
    [updateNode]
  )

  const handlePickFile = useCallback(
    async (
      _nodeId: string,
      mode: 'open' | 'save',
      defaultPath?: string
    ): Promise<string | null> => {
      const selectedPath = await window.api.graphNodes.pickFile({ mode, defaultPath })
      return typeof selectedPath === 'string' ? selectedPath : null
    },
    []
  )

  const handleClose = useCallback(
    async (id: string) => {
      await deleteTab(id)
    },
    [deleteTab]
  )

  // ─── Monitor firing ────────────────────────────────────────────────────

  const handleMonitorFired = useCallback(
    async (tabId: string, monitorId: string, extractedValue: string) => {
      const monitorRunId = `mon-${Date.now().toString(36)}-${monitorId.slice(0, 5)}`
      console.log(
        `${MONITOR_TAG} run=${monitorRunId} fired tab=${tabId} monitor=${monitorId} extractedLen=${extractedValue.length} extracted="${extractedValue.slice(0, 120)}"`
      )

      // 1. Update lastFiredAt on the monitor
      const tab = tabs.find((t) => t.id === tabId)
      if (tab) {
        const monitors = tab.monitors ? (JSON.parse(tab.monitors) as BrowserTabMonitor[]) : []
        const updated = monitors.map((m) =>
          m.id === monitorId ? { ...m, lastFiredAt: new Date().toISOString() } : m
        )
        await updateTab(tabId, { monitors: JSON.stringify(updated) })
        console.log(`${MONITOR_TAG} run=${monitorRunId} updated lastFiredAt tab=${tabId} monitor=${monitorId}`)
      }

      // 2. Find edges from this monitor handle and execute downstream nodes
      const currentNodes = reactFlowInstance.getNodes()
      const currentEdges = reactFlowInstance.getEdges()
      const matchingEdges = currentEdges.filter(
        (e) => e.source === tabId && e.sourceHandle === `monitor-${monitorId}`
      )
      console.log(
        `${MONITOR_TAG} run=${monitorRunId} matching downstream edges tab=${tabId} monitor=${monitorId} count=${matchingEdges.length}`
      )
      if (matchingEdges.length === 0) {
        console.warn(`${MONITOR_TAG} run=${monitorRunId} no downstream edges for monitor handle monitor-${monitorId}`)
        return
      }

      let monitorSourceOutput = ['[Monitor Trigger]', `Extracted: ${extractedValue}`].join('\n')
      try {
        const browserOutput = await executeBrowserTab(tabId, undefined, `${monitorRunId}-source`)
        if (browserOutput) {
          monitorSourceOutput = ['[Monitor Trigger]', `Extracted: ${extractedValue}`, '', browserOutput].join('\n')
          console.log(
            `${MONITOR_TAG} run=${monitorRunId} source payload prepared extractedLen=${extractedValue.length} browserOutputLen=${browserOutput.length} combinedLen=${monitorSourceOutput.length}`
          )
        } else {
          console.warn(`${MONITOR_TAG} run=${monitorRunId} browser source output empty; using extracted value only`)
        }
      } catch (error) {
        console.error(`${MONITOR_TAG} run=${monitorRunId} failed preparing browser source payload:`, error)
      }

      const updateNodeData = (id: string, updater: (prev: Record<string, unknown>) => Record<string, unknown>): void => {
        reactFlowInstance.setNodes((nds) =>
          nds.map((n) => (n.id === id ? { ...n, data: updater(n.data as Record<string, unknown>) } : n))
        )
      }

      for (let index = 0; index < matchingEdges.length; index += 1) {
        const edge = matchingEdges[index]
        const edgeRunId = `${monitorRunId}-edge${index + 1}`
        console.log(
          `${MONITOR_TAG} run=${monitorRunId} executing edge=${index + 1}/${matchingEdges.length} id=${edge.id} source=${edge.source} target=${edge.target} sourceHandle=${edge.sourceHandle ?? '(none)'} graphRun=${edgeRunId}`
        )
        const preseededOutputs = new Map<string, string>()
        preseededOutputs.set(tabId, monitorSourceOutput)
        await executeFromTrigger(
          edge.target,
          currentEdges,
          currentNodes,
          updateNodeData,
          undefined,
          executeBrowserTab,
          preseededOutputs,
          edgeRunId,
          activeBoardId ?? undefined
        )
        console.log(`${MONITOR_TAG} run=${monitorRunId} edge execution complete id=${edge.id} graphRun=${edgeRunId}`)
      }
    },
    [tabs, updateTab, reactFlowInstance, executeBrowserTab, activeBoardId]
  )

  // Called once when AI generates a rule for a monitor — persist it
  const handleMonitorRuleGenerated = useCallback(
    async (tabId: string, monitorId: string, rule: MonitorRule) => {
      const tab = tabs.find((t) => t.id === tabId)
      if (!tab) return
      const monitors = tab.monitors ? (JSON.parse(tab.monitors) as BrowserTabMonitor[]) : []
      const updated = monitors.map((m) =>
        m.id === monitorId ? { ...m, rule } : m
      )
      await updateTab(tabId, { monitors: JSON.stringify(updated) })
    },
    [tabs, updateTab]
  )

  // Called each cycle to track extracted values (enables 'changed' detection)
  const handleMonitorExtractedUpdate = useCallback(
    async (tabId: string, monitorId: string, extracted: string) => {
      const tab = tabs.find((t) => t.id === tabId)
      if (!tab) return
      const monitors = tab.monitors ? (JSON.parse(tab.monitors) as BrowserTabMonitor[]) : []
      const updated = monitors.map((m) =>
        m.id === monitorId ? { ...m, lastExtracted: extracted } : m
      )
      await updateTab(tabId, { monitors: JSON.stringify(updated) })
    },
    [tabs, updateTab]
  )

  // Tabs with at least one enabled monitor
  const monitoredTabs = useMemo(
    () =>
      tabs.filter((tab) => {
        if (!tab.monitors) return false
        try {
          const monitors = JSON.parse(tab.monitors) as BrowserTabMonitor[]
          return monitors.some((m) => m.enabled)
        } catch {
          return false
        }
      }),
    [tabs]
  )

  const parseMonitors = (tab: BrowserTab): BrowserTabMonitor[] => {
    if (!tab.monitors) return []
    try {
      return JSON.parse(tab.monitors) as BrowserTabMonitor[]
    } catch {
      return []
    }
  }

  const scheduleTriggerNodeCount = useMemo(
    () => gNodes.filter((node) => node.nodeType === 'scheduleTrigger').length,
    [gNodes]
  )

  // ─── Schedule trigger polling ───────────────────────────────────────────

  useEffect(() => {
    if (scheduleTimerRef.current) {
      clearTimeout(scheduleTimerRef.current)
      scheduleTimerRef.current = null
    }

    if (scheduleTriggerNodeCount === 0) {
      scheduleRunningRef.current = false
      scheduleLastFiredMinuteRef.current.clear()
      console.log(`${SCHEDULE_TAG} scheduler disabled (no schedule trigger nodes)`)
      return
    }

    let disposed = false
    console.log(
      `${SCHEDULE_TAG} scheduler setup nodes=${scheduleTriggerNodeCount} pollIntervalMs=${SCHEDULE_POLL_INTERVAL_MS} alignmentGraceMs=${SCHEDULE_ALIGNMENT_GRACE_MS}`
    )

    const runScheduleCycle = async (source: 'initial' | 'interval'): Promise<void> => {
      const now = new Date()
      const nowTs = now.getTime()
      const minuteKey = formatLocalMinuteKey(now)
      const nextTickTs = getNextAlignedMinuteTick(nowTs)

      console.log(
        `${SCHEDULE_TAG} tick source=${source} at=${now.toISOString()} local=${now.toLocaleTimeString()} minuteKey=${minuteKey} next~=${new Date(nextTickTs).toISOString()}`
      )

      if (scheduleRunningRef.current) {
        console.log(`${SCHEDULE_TAG} cycle skip source=${source} reason=previous cycle still running`)
        return
      }

      scheduleRunningRef.current = true
      try {
        const currentNodes = reactFlowInstance.getNodes().filter((node) => node.type === 'scheduleTrigger')
        const activeNodeIds = new Set(currentNodes.map((node) => node.id))
        for (const knownId of Array.from(scheduleLastFiredMinuteRef.current.keys())) {
          if (!activeNodeIds.has(knownId)) {
            scheduleLastFiredMinuteRef.current.delete(knownId)
          }
        }

        console.log(`${SCHEDULE_TAG} cycle source=${source} scheduleNodes=${currentNodes.length}`)
        for (const node of currentNodes) {
          const nodeData = (node.data ?? {}) as Record<string, unknown>
          const config = (nodeData.config as ScheduleTriggerConfig | undefined) ?? {}
          const label = typeof nodeData.label === 'string' ? nodeData.label : node.id
          const enabled = config.enabled !== false

          if (!enabled) {
            setNodeRuntimeStatus(node.id, 'Schedule disabled', false)
            continue
          }

          const resolved = resolveScheduleCron(config.prompt, config.cron)
          if (!resolved.cron) {
            const reason = resolved.error ?? 'Missing cron expression'
            setNodeRuntimeStatus(node.id, `Schedule invalid: ${preview(reason, 70)}`, false)
            console.warn(
              `${SCHEDULE_TAG} node=${node.id} label="${preview(label, 50)}" invalid reason="${reason}"`
            )
            continue
          }

          const cron = resolved.cron
          const match = cronMatchesDate(cron, now)
          console.log(
            `${SCHEDULE_TAG} node=${node.id} label="${preview(label, 50)}" cron="${cron}" source=${resolved.source ?? 'unknown'} match=${match}`
          )

          if (!match) {
            setNodeRuntimeStatus(node.id, `Waiting: ${cron}`, false)
            continue
          }

          const lastFiredMinute = scheduleLastFiredMinuteRef.current.get(node.id)
          if (lastFiredMinute === minuteKey) {
            console.log(`${SCHEDULE_TAG} node=${node.id} already fired for minute=${minuteKey}; skip duplicate`)
            continue
          }

          scheduleLastFiredMinuteRef.current.set(node.id, minuteKey)
          const runId = `schedule-${Date.now().toString(36)}-${node.id.slice(0, 6)}`
          setNodeRuntimeStatus(node.id, `Schedule fired (${minuteKey})`, true)
          console.log(`${SCHEDULE_TAG} run=${runId} firing node=${node.id} cron="${cron}" minute=${minuteKey}`)

          try {
            await runFromTriggerNode(node.id, runId)
            setNodeRuntimeStatus(node.id, `Schedule complete (${minuteKey})`, false)
            console.log(`${SCHEDULE_TAG} run=${runId} complete node=${node.id}`)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            setNodeRuntimeStatus(node.id, `Schedule failed: ${preview(message, 70)}`, false)
            console.error(`${SCHEDULE_TAG} run=${runId} failed node=${node.id}:`, error)
          }
        }
      } finally {
        scheduleRunningRef.current = false
      }
    }

    const scheduleNextTick = (source: 'initial' | 'interval'): void => {
      if (disposed) return
      const now = Date.now()
      const plannedAt = getNextAlignedMinuteTick(now)
      const delayMs = Math.max(SCHEDULE_MIN_TIMER_DELAY_MS, plannedAt - now)
      console.log(
        `${SCHEDULE_TAG} timer scheduled source=${source} runAt=${new Date(plannedAt).toISOString()} local=${new Date(plannedAt).toLocaleTimeString()} delayMs=${delayMs}`
      )
      scheduleTimerRef.current = setTimeout(() => {
        if (disposed) return
        const firedAt = Date.now()
        console.log(
          `${SCHEDULE_TAG} timer fired source=${source} plannedAt=${new Date(plannedAt).toISOString()} firedAt=${new Date(firedAt).toISOString()} driftMs=${firedAt - plannedAt}`
        )
        void runScheduleCycle(source).finally(() => {
          if (disposed) return
          scheduleNextTick('interval')
        })
      }, delayMs)
    }

    void runScheduleCycle('initial')
    scheduleNextTick('initial')

    return (): void => {
      disposed = true
      scheduleRunningRef.current = false
      if (scheduleTimerRef.current) {
        clearTimeout(scheduleTimerRef.current)
        scheduleTimerRef.current = null
      }
      console.log(`${SCHEDULE_TAG} scheduler cleanup`)
    }
  }, [scheduleTriggerNodeCount, reactFlowInstance, runFromTriggerNode, setNodeRuntimeStatus])

  // ─── Merge tabs + graph nodes into React Flow nodes ──────────────────────

  const graphNodeIdSet = useMemo(() => new Set(gNodes.map((node) => node.id)), [gNodes])

  const initialNodes: Node[] = useMemo(() => {
    const tabNodes: Node[] = tabs.map((tab) => ({
      id: tab.id,
      type: 'browserTab',
      position: pendingPositionOverrides.current.get(tab.id) ?? { x: tab.flowX, y: tab.flowY },
      data: {
        title: tab.title,
        url: tab.url,
        favicon: tab.favicon,
        screenshot: tab.screenshot,
        monitors: parseMonitors(tab),
        isRunning: runningTabs.has(tab.id) || previewingTabs.has(tab.id),
        hasNotification: notifiedItemIds.has(tab.id),
        onClose: handleClose
      } satisfies BrowserTabNodeData
    }))

    const graphNodeList: Node[] = gNodes.map((gn) => {
      const config = parseNodeConfig(gn.config)
      const base = {
        id: gn.id,
        type: gn.nodeType,
        position: pendingPositionOverrides.current.get(gn.id) ?? { x: gn.flowX, y: gn.flowY }
      }

      if (gn.nodeType === 'trigger') {
        return { ...base, data: { label: gn.label || 'Run', onTrigger: handleTrigger } }
      }
      if (gn.nodeType === 'scheduleTrigger') {
        return {
          ...base,
          data: {
            label: gn.label || 'Schedule',
            config: config as ScheduleTriggerConfig,
            onEditConfig: handleEditScheduleConfig,
            onTriggerNow: handleScheduleTrigger
          }
        }
      }
      if (gn.nodeType === 'formTrigger') {
        return {
          ...base,
          data: {
            label: gn.label || 'Form Trigger',
            config: config as FormTriggerConfig,
            onEditConfig: handleEditFormTriggerConfig,
            onSubmit: handleSubmitFormTrigger
          }
        }
      }
      if (gn.nodeType === 'debug') {
        return { ...base, data: { label: gn.label || 'Debug' } }
      }
      if (gn.nodeType === 'notification') {
        return {
          ...base,
          data: {
            label: gn.label || 'Notify',
            config,
            onEditConfig: handleEditNotificationConfig
          }
        }
      }
      if (gn.nodeType === 'delay') {
        return {
          ...base,
          data: {
            label: gn.label || 'Delay',
            config,
            onEditConfig: handleEditDelayConfig
          }
        }
      }
      if (gn.nodeType === 'aiPrompt') {
        return {
          ...base,
          data: {
            label: gn.label || 'AI Prompt',
            config,
            onEditPrompt: handleEditAiPrompt
          }
        }
      }
      if (gn.nodeType === 'text') {
        const textLabel = !gn.label || gn.label === 'Text' ? 'Instructions' : gn.label
        return {
          ...base,
          data: {
            label: textLabel,
            config,
            onEditText: handleEditText
          }
        }
      }
      if (gn.nodeType === 'output') {
        return {
          ...base,
          style: {
            border: 'none',
            background: 'transparent',
            padding: 0,
            width: 'auto',
            boxShadow: 'none'
          },
          data: {
            label: gn.label || 'Output',
            config
          }
        }
      }
      if (gn.nodeType === 'file') {
        return {
          ...base,
          data: {
            label: gn.label || 'File',
            config,
            onEditConfig: handleEditFileConfig,
            onPickFile: handlePickFile
          }
        }
      }
      if (gn.nodeType === 'terminal') {
        return {
          ...base,
          data: {
            label: gn.label || 'Terminal',
            config,
            hasNotification: notifiedItemIds.has(gn.id)
          }
        }
      }
      return { ...base, data: { label: gn.label } }
    })

    const mergedNodes = [...tabNodes, ...graphNodeList]
    const seenIds = new Set<string>()
    const duplicateIds = new Set<string>()
    for (const node of mergedNodes) {
      if (seenIds.has(node.id)) {
        duplicateIds.add(node.id)
      } else {
        seenIds.add(node.id)
      }
    }
    if (duplicateIds.size > 0) {
      console.error(`${FLOW_TAG} duplicate node ids detected: ${Array.from(duplicateIds).join(', ')}`)
    }
    return mergedNodes
  }, [tabs, gNodes, runningTabs, previewingTabs, notifiedItemIds, handleClose, handleTrigger, handleEditScheduleConfig, handleScheduleTrigger, handleEditFormTriggerConfig, handleSubmitFormTrigger, handleEditNotificationConfig, handleEditDelayConfig, handleEditAiPrompt, handleEditText, handleEditFileConfig, handlePickFile])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(savedEdges)

  // Sync nodes when data sources change
  useEffect(() => {
    setNodes((prevNodes) => {
      const prevById = new Map(prevNodes.map((node) => [node.id, node]))
      return initialNodes.map((nextNode) => {
        const prevNode = prevById.get(nextNode.id)
        if (!prevNode) return nextNode
        const prevData = (prevNode.data as Record<string, unknown>) ?? {}
        const nextData = (nextNode.data as Record<string, unknown>) ?? {}
        const mergedData: Record<string, unknown> = {
          ...prevData,
          ...nextData
        }
        if (isRecord(prevData.config) && isRecord(nextData.config)) {
          // Preserve runtime-enriched config fields (e.g. output markdown) until persisted state catches up.
          mergedData.config = {
            ...prevData.config,
            ...nextData.config
          }
        }
        return {
          ...prevNode,
          ...nextNode,
          // Preserve in-flight local positioning and interaction state.
          position: prevNode.position ?? nextNode.position,
          data: mergedData
        }
      })
    })
  }, [initialNodes, setNodes])

  // Sync edges when loaded from DB
  useEffect(() => {
    setEdges(savedEdges)
  }, [savedEdges])

  // ─── Edge handlers ─────────────────────────────────────────────────────────

  const handleConnect = useCallback(
    (connection: Connection) => {
      const newEdges = addEdge(connection, edges)
      setEdges(newEdges)
      saveEdges(newEdges)
    },
    [edges, setEdges, saveEdges]
  )

  const handleReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      const newEdges = reconnectEdge(oldEdge, newConnection, edges)
      setEdges(newEdges)
      saveEdges(newEdges)
    },
    [edges, setEdges, saveEdges]
  )

  const connectingNodeRef = useRef<{ nodeId: string; handleId: string | null } | null>(null)

  const handleConnectStart = useCallback(
    (_event: MouseEvent | TouchEvent, params: { nodeId: string | null; handleId: string | null }) => {
      if (params.nodeId) {
        connectingNodeRef.current = { nodeId: params.nodeId, handleId: params.handleId }
      }
    },
    []
  )

  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      const source = connectingNodeRef.current
      connectingNodeRef.current = null
      if (!source) return

      const target = event instanceof MouseEvent ? event.target : (event as TouchEvent).touches?.[0]?.target
      if (!(target instanceof HTMLElement)) return

      // Walk up the DOM to find a ReactFlow node wrapper
      const nodeEl = target.closest('.react-flow__node')
      if (!nodeEl) return
      const targetNodeId = nodeEl.getAttribute('data-id')
      if (!targetNodeId || targetNodeId === source.nodeId) return

      // Create a connection from source to the target node's default target handle
      const connection: Connection = {
        source: source.nodeId,
        target: targetNodeId,
        sourceHandle: source.handleId,
        targetHandle: null
      }
      const newEdges = addEdge(connection, edges)
      setEdges(newEdges)
      saveEdges(newEdges)
    },
    [edges, setEdges, saveEdges]
  )

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      onEdgesChange(changes)

      // Check if any edge was removed
      const hasRemoval = changes.some((c) => c.type === 'remove')
      if (hasRemoval) {
        // After state update, save — use setTimeout to get updated edges
        setTimeout(() => {
          const currentEdges = reactFlowInstance.getEdges()
          saveEdges(currentEdges)
        }, 0)
      }
    },
    [onEdgesChange, reactFlowInstance, saveEdges]
  )

  // ─── Node change handlers ─────────────────────────────────────────────────

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Filter out 'remove' changes — deletion is handled via context menu only
      const filtered = changes.filter((c) => c.type !== 'remove')
      if (filtered.length === 0) return
      onNodesChange(filtered)

      const positionChanges = changes.filter(
        (c): c is NodePositionChange => c.type === 'position' && c.dragging === false && c.position !== undefined
      )
      if (positionChanges.length > 0) {
        const tabPositions: Array<{ id: string; x: number; y: number }> = []
        const graphPositions: Array<{ id: string; x: number; y: number }> = []

        for (const c of positionChanges) {
          if (!('id' in c)) continue
          if (!c.position) continue
          const pos = c.position
          if (graphNodeIdSet.has(c.id)) {
            graphPositions.push({ id: c.id, x: pos.x, y: pos.y })
          } else {
            tabPositions.push({ id: c.id, x: pos.x, y: pos.y })
          }
          pendingPositionOverrides.current.set(c.id, { x: pos.x, y: pos.y })
        }

        if (tabPositions.length > 0) {
          void saveTabPositions(tabPositions)
            .then(() => {
              for (const pos of tabPositions) {
                pendingPositionOverrides.current.delete(pos.id)
              }
            })
            .catch((error) => {
              console.error(`${FLOW_TAG} failed to persist tab positions:`, error)
            })
        }

        if (graphPositions.length > 0) {
          void saveGraphPositions(graphPositions)
            .then(() => {
              for (const pos of graphPositions) {
                pendingPositionOverrides.current.delete(pos.id)
              }
            })
            .catch((error) => {
              console.error(`${FLOW_TAG} failed to persist graph positions:`, error)
            })
        }
      }
    },
    [onNodesChange, saveTabPositions, saveGraphPositions, graphNodeIdSet]
  )

  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      // Open dialog for browser tabs
      const tab = tabs.find((t) => t.id === node.id)
      if (tab) {
        setSelectedTab(tab)
        setDialogOpen(true)
        return
      }
      // Open interactive terminal for terminal nodes
      if (node.type === 'terminal') {
        setTerminalDialogNodeId(node.id)
      }
      // Open file preview in tabs view
      if (node.type === 'file') {
        setBoardView('tabs')
        requestTabSelect(node.id)
      }
    },
    [tabs]
  )

  const handleAddTab = useCallback(
    async (flowX?: number, flowY?: number) => {
      if (!activeBoardId) return undefined
      // Center the node on the target position (node origin is top-left)
      const cx = (flowX ?? 100 + Math.random() * 200) - 120
      const cy = (flowY ?? 100 + Math.random() * 200) - 84
      const tab = await createTab({ flowX: cx, flowY: cy })
      return tab
    },
    [createTab, activeBoardId]
  )

  const handleAddAgent = useCallback(
    async (flowX?: number, flowY?: number): Promise<string | undefined> => {
      if (!activeBoardId) return undefined
      try {
        const agentId = getSetting('defaultAgent')
        const command = getAgentCommand(agentId, workspace?.rootDir, workspaceAgentCommandOverrides)
        const agentLabel = CLI_AGENTS.find((a) => a.id === agentId)?.label ?? 'Agent'
        const cx = (flowX ?? 100 + Math.random() * 200) - 120
        const cy = (flowY ?? 100 + Math.random() * 200) - 84
        const node = await createNode({
          nodeType: 'terminal',
          label: agentLabel,
          config: JSON.stringify({ command }),
          flowX: cx,
          flowY: cy
        })
        return node.id
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[browser] failed to create agent terminal:`, message)
        return undefined
      }
    },
    [activeBoardId, createNode, getSetting, workspace?.rootDir, workspaceAgentCommandOverrides]
  )

  const handleSidebarItemClick = useCallback(
    (itemId: string, boardId: string) => {
      if (boardId !== activeBoardId) {
        void setActiveBoard(boardId)
        void setBoardActiveView(boardId, 'tabs').catch(() => {})
      }
      setBoardView('tabs')
      setTerminalDialogNodeId(null)
      requestTabSelect(itemId, boardId)
    },
    [activeBoardId, setActiveBoard, setBoardActiveView, requestTabSelect]
  )

  const handleActiveBoardItemChange = useCallback(
    (itemId: string | null) => {
      setActiveItemId(itemId)
      const pendingSelection = pendingTabSelectRef.current
      if (pendingSelection && pendingSelection.boardId === activeBoardId && pendingSelection.itemId === itemId) {
        setPendingTabSelect(null)
      }
      if (!activeBoardId) return
      void setSetting('lastSelectedBoardItems', (prevValue) => {
        const next = { ...((prevValue as Record<string, string> | null) ?? {}) }
        if (itemId) {
          next[activeBoardId] = itemId
        } else {
          delete next[activeBoardId]
        }
        return next
      })
    },
    [activeBoardId, setSetting]
  )


  const startInlineTerminalEdit = useCallback((nodeId: string, name: string) => {
    setEditingFolderId(null)
    setEditingFolderName('')
    setEditingBoardId(null)
    setEditingBoardName('')
    setEditingTerminalId(nodeId)
    setEditingTerminalName(name)
  }, [])

  const cancelInlineTerminalEdit = useCallback(() => {
    setEditingTerminalId(null)
    setEditingTerminalName('')
  }, [])

  const saveInlineTerminalEdit = useCallback(async () => {
    if (!editingTerminalId) return
    const nodeId = editingTerminalId
    const nextName = editingTerminalName.trim()
    setEditingTerminalId(null)
    setEditingTerminalName('')
    // Find which board owns this terminal
    let ownerBoardId: string | null = null
    for (const [boardId, terminals] of boardTerminalsMap) {
      if (terminals.some((tn) => tn.id === nodeId)) {
        ownerBoardId = boardId
        break
      }
    }
    const allTerminals = Array.from(boardTerminalsMap.values()).flat()
    const currentName = allTerminals.find((tn) => tn.id === nodeId)?.label ?? ''
    if (nextName.length === 0 || nextName === currentName || !ownerBoardId) return
    try {
      if (ownerBoardId === activeBoardId) {
        await updateNode(nodeId, { label: nextName })
      } else {
        await window.api.graphNodes.update(nodeId, { label: nextName }, ownerBoardId)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`${FLOW_TAG} failed to rename terminal node id=${nodeId}:`, error)
      window.alert(`Failed to rename terminal: ${message}`)
    }
  }, [editingTerminalId, editingTerminalName, boardTerminalsMap, updateNode, activeBoardId])

  useEffect(() => {
    const onAddTab = (): void => {
      void handleAddTab()
    }
    window.addEventListener('hoo:browser-add-tab', onAddTab)
    return (): void => {
      window.removeEventListener('hoo:browser-add-tab', onAddTab)
    }
  }, [handleAddTab])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'f') return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.repeat) return

      if (isEditableTarget(event.target) || isEditableTarget(document.activeElement)) return

      const currentNodes = reactFlowInstance.getNodes()
      if (currentNodes.length === 0) return
      const selectedNodes = currentNodes.filter((node) => node.selected)

      event.preventDefault()
      if (selectedNodes.length > 0) {
        void reactFlowInstance.fitView({
          nodes: selectedNodes,
          padding: 0.35,
          duration: 220
        })
        return
      }

      void reactFlowInstance.fitView({
        padding: 0.5,
        duration: 220
      })
    }

    window.addEventListener('keydown', onKeyDown)
    return (): void => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [reactFlowInstance])

  // Cmd+T / Ctrl+T → add new tab matching the active tab kind (works across all board views)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 't') return
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.repeat) return

      event.preventDefault()

      // Determine the kind of the currently active item so we create the same type
      const currentId = activeItemIdRef.current
      const isTerminal = currentId != null && terminalNodes.some((n) => n.id === currentId)

      if (boardView === 'whiteboard') {
        const flowRect = flowContainerRef.current?.getBoundingClientRect()
        let clientPosition = lastMouseClientPositionRef.current

        // If mouse isn't over the flow canvas, fall back to center
        if (clientPosition && flowRect) {
          const inside =
            clientPosition.x >= flowRect.left &&
            clientPosition.x <= flowRect.right &&
            clientPosition.y >= flowRect.top &&
            clientPosition.y <= flowRect.bottom
          if (!inside) clientPosition = null
        }

        if (!clientPosition && flowRect) {
          clientPosition = {
            x: flowRect.left + flowRect.width / 2,
            y: flowRect.top + flowRect.height / 2
          }
        }
        if (!clientPosition) return

        const flowPosition = reactFlowInstance.screenToFlowPosition(clientPosition)
        if (isTerminal) {
          void handleAddAgent(flowPosition.x, flowPosition.y).then((nodeId) => {
            if (nodeId) requestTabSelect(nodeId)
          })
        } else {
          void handleAddTab(flowPosition.x, flowPosition.y)
        }
      } else {
        if (isTerminal) {
          void handleAddAgent().then((nodeId) => {
            if (nodeId && boardView === 'tabs') {
              requestTabSelect(nodeId)
            }
          })
        } else {
          void handleAddTab().then((tab) => {
            if (tab && boardView === 'tabs') {
              requestTabSelect(tab.id)
            }
          })
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return (): void => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [reactFlowInstance, handleAddTab, handleAddAgent, boardView, terminalNodes])

  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      if (isEditableTarget(event.target) || isEditableTarget(document.activeElement)) return
      const pastedText = event.clipboardData?.getData('text/plain') ?? event.clipboardData?.getData('text') ?? ''
      const normalizedUrl = normalizePastedUrl(pastedText)
      if (!normalizedUrl) return

      const flowRect = flowContainerRef.current?.getBoundingClientRect()
      let clientPosition = lastMouseClientPositionRef.current
      if (!clientPosition && flowRect) {
        clientPosition = {
          x: flowRect.left + flowRect.width / 2,
          y: flowRect.top + flowRect.height / 2
        }
      }
      if (!clientPosition) return

      if (flowRect) {
        clientPosition = {
          x: Math.min(Math.max(clientPosition.x, flowRect.left), flowRect.right),
          y: Math.min(Math.max(clientPosition.y, flowRect.top), flowRect.bottom)
        }
      }

      const flowPosition = reactFlowInstance.screenToFlowPosition(clientPosition)
      event.preventDefault()
      void createTab({
        url: normalizedUrl,
        flowX: flowPosition.x,
        flowY: flowPosition.y
      })
        .then((createdTab) => hydratePastedTabPreview(createdTab.id, normalizedUrl))
        .catch((error) => {
          console.error(`${FLOW_TAG} failed to create tab from paste:`, error)
        })
    }

    window.addEventListener('paste', onPaste)
    return (): void => {
      window.removeEventListener('paste', onPaste)
    }
  }, [createTab, hydratePastedTabPreview, reactFlowInstance])

  const handleDialogClose = useCallback(
    (open: boolean) => {
      setDialogOpen(open)
      if (!open) {
        const updated = tabs.find((t) => t.id === selectedTab?.id)
        if (updated) setSelectedTab(updated)
      }
    },
    [tabs, selectedTab]
  )

  useEffect(() => {
    if (!selectedTab) return
    const updated = tabs.find((tab) => tab.id === selectedTab.id)
    if (!updated) {
      setSelectedTab(null)
      setDialogOpen(false)
      return
    }
    setSelectedTab(updated)
  }, [tabs, selectedTab])

  // ─── Context Menus ──────────────────────────────────────────────────────────

  const handlePaneContextMenu = useCallback(
    (event: MouseEvent | React.MouseEvent<Element, MouseEvent>) => {
      event.preventDefault()
      setBoardItemMenu(null)
      setBoardContextMenu(null)
      setFolderContextMenu(null)
      const flowPosition = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY
      })
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        type: 'pane',
        flowPosition
      })
    },
    [reactFlowInstance]
  )

  const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault()
      setBoardItemMenu(null)
      setBoardContextMenu(null)
      setFolderContextMenu(null)
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        type: 'node',
        nodeId: node.id,
        nodeType: node.type
      })
    },
    []
  )

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  const closeBoardItemMenu = useCallback(() => {
    setBoardItemMenu(null)
  }, [])

  const closeBoardContextMenu = useCallback(() => {
    setBoardContextMenu(null)
  }, [])

  const closeFolderContextMenu = useCallback(() => {
    setFolderContextMenu(null)
  }, [])

  useLayoutEffect(() => {
    if (!boardContextMenu) {
      setBoardContextMenuPosition(null)
      return
    }

    const clampToViewport = (): void => {
      const menuEl = boardContextMenuRef.current
      const menuWidth = menuEl?.offsetWidth ?? 180
      const menuHeight = menuEl?.offsetHeight ?? 140
      const pad = 8
      const maxX = Math.max(pad, window.innerWidth - menuWidth - pad)
      const maxY = Math.max(pad, window.innerHeight - menuHeight - pad)
      const x = Math.min(Math.max(boardContextMenu.x, pad), maxX)
      const y = Math.min(Math.max(boardContextMenu.y, pad), maxY)
      setBoardContextMenuPosition({ x, y })
    }

    clampToViewport()
    window.addEventListener('resize', clampToViewport)
    return (): void => window.removeEventListener('resize', clampToViewport)
  }, [boardContextMenu])

  useLayoutEffect(() => {
    if (!folderContextMenu) {
      setFolderContextMenuPosition(null)
      return
    }

    const clampToViewport = (): void => {
      const menuEl = folderContextMenuRef.current
      const menuWidth = menuEl?.offsetWidth ?? 180
      const menuHeight = menuEl?.offsetHeight ?? 150
      const pad = 8
      const maxX = Math.max(pad, window.innerWidth - menuWidth - pad)
      const maxY = Math.max(pad, window.innerHeight - menuHeight - pad)
      const x = Math.min(Math.max(folderContextMenu.x, pad), maxX)
      const y = Math.min(Math.max(folderContextMenu.y, pad), maxY)
      setFolderContextMenuPosition({ x, y })
    }

    clampToViewport()
    window.addEventListener('resize', clampToViewport)
    return (): void => window.removeEventListener('resize', clampToViewport)
  }, [folderContextMenu])

  useLayoutEffect(() => {
    if (!contextMenu) {
      setContextMenuPosition(null)
      return
    }

    const clampToViewport = (): void => {
      const menuEl = contextMenuRef.current
      const menuWidth = menuEl?.offsetWidth ?? 220
      const menuHeight = menuEl?.offsetHeight ?? 280
      const pad = 8
      const maxX = Math.max(pad, window.innerWidth - menuWidth - pad)
      const maxY = Math.max(pad, window.innerHeight - menuHeight - pad)
      const x = Math.min(Math.max(contextMenu.x, pad), maxX)
      const y = Math.min(Math.max(contextMenu.y, pad), maxY)
      setContextMenuPosition({ x, y })
    }

    clampToViewport()
    window.addEventListener('resize', clampToViewport)
    return (): void => window.removeEventListener('resize', clampToViewport)
  }, [contextMenu])

  useLayoutEffect(() => {
    if (!boardItemMenu) {
      setBoardItemMenuPosition(null)
      return
    }

    const clampToViewport = (): void => {
      const menuEl = boardItemMenuRef.current
      const menuWidth = menuEl?.offsetWidth ?? 180
      const menuHeight = menuEl?.offsetHeight ?? 110
      const pad = 8
      const maxX = Math.max(pad, window.innerWidth - menuWidth - pad)
      const maxY = Math.max(pad, window.innerHeight - menuHeight - pad)
      const x = Math.min(Math.max(boardItemMenu.x, pad), maxX)
      const y = Math.min(Math.max(boardItemMenu.y, pad), maxY)
      setBoardItemMenuPosition({ x, y })
    }

    clampToViewport()
    window.addEventListener('resize', clampToViewport)
    return (): void => window.removeEventListener('resize', clampToViewport)
  }, [boardItemMenu])

  const handleBoardItemContextMenu = useCallback(
    (
      event: React.MouseEvent,
      itemId: string,
      kind: SidebarItemKind,
      boardId: string,
      source: BoardItemMenu['source'] = 'sidebar'
    ) => {
      event.preventDefault()
      event.stopPropagation()
      setContextMenu(null)
      setBoardContextMenu(null)
      setFolderContextMenu(null)
      setBoardItemMenu({
        x: event.clientX,
        y: event.clientY,
        itemId,
        kind,
        boardId,
        source
      })
    },
    []
  )

  const updateBoardTabsSidebar = useCallback((boardId: string, updater: (tabs: BrowserTab[]) => BrowserTab[]) => {
    setBoardTabsMap((prev) => {
      const current = prev.get(boardId) ?? []
      const nextTabs = updater(current)
      if (current === nextTabs) return prev
      const next = new Map(prev)
      if (nextTabs.length > 0) next.set(boardId, nextTabs)
      else next.delete(boardId)
      return next
    })
  }, [])

  const updateBoardNodeSidebar = useCallback(
    (
      boardId: string,
      kind: 'terminal' | 'file',
      updater: (nodes: GraphNode[]) => GraphNode[]
    ) => {
      const setMap = kind === 'terminal' ? setBoardTerminalsMap : setBoardFilesMap
      setMap((prev) => {
        const current = prev.get(boardId) ?? []
        const nextNodes = updater(current)
        if (current === nextNodes) return prev
        const next = new Map(prev)
        if (nextNodes.length > 0) next.set(boardId, nextNodes)
        else next.delete(boardId)
        return next
      })
    },
    []
  )

  const updateBoardItemOrder = useCallback(
    (boardId: string, updater: (orderedIds: string[]) => string[]) => {
      setBoardItemOrderMap((prev) => {
        const current = prev.get(boardId) ?? []
        const nextOrder = Array.from(new Set(updater(current).filter((id) => id.length > 0)))
        if (current.length === nextOrder.length && current.every((id, index) => id === nextOrder[index])) {
          return prev
        }
        const next = new Map(prev)
        if (nextOrder.length > 0) next.set(boardId, nextOrder)
        else next.delete(boardId)
        return next
      })
    },
    []
  )

  const saveBoardItemOrder = useCallback(
    async (boardId: string, orderedIds: string[]) => {
      const normalizedIds = Array.from(new Set(orderedIds.filter((id) => id.length > 0)))
      updateBoardItemOrder(boardId, () => normalizedIds)
      await window.api.browserTabs.saveViewOrder(normalizedIds, boardId)
    },
    [updateBoardItemOrder]
  )

  useEffect(() => {
    return window.api.browserTabs.onOpenLinkInNewTabRequested(({ sourceTabId, url, disposition }) => {
      if (!activeBoardId || !url) return

      const sourceTab = tabs.find((tab) => tab.id === sourceTabId)
      if (!sourceTab) return
      const flowX = sourceTab.flowX + 280
      const flowY = sourceTab.flowY + 20
      const preferredOrderIds = boardItemOrderMap.get(activeBoardId) ?? []
      const availableItemIds = new Set([
        ...tabs.map((tab) => tab.id),
        ...terminalNodes.map((node) => node.id),
        ...fileNodes.map((node) => node.id)
      ])
      const currentOrder: string[] = []
      const seen = new Set<string>()
      for (const id of preferredOrderIds) {
        if (!id || seen.has(id) || !availableItemIds.has(id)) continue
        seen.add(id)
        currentOrder.push(id)
      }
      for (const tab of tabs) {
        if (seen.has(tab.id)) continue
        seen.add(tab.id)
        currentOrder.push(tab.id)
      }
      for (const node of terminalNodes) {
        if (seen.has(node.id)) continue
        seen.add(node.id)
        currentOrder.push(node.id)
      }
      for (const node of fileNodes) {
        if (seen.has(node.id)) continue
        seen.add(node.id)
        currentOrder.push(node.id)
      }

      void createTab({ url, flowX, flowY })
        .then((tab) => {
          const sourceIndex = currentOrder.indexOf(sourceTabId)
          const nextOrder =
            sourceIndex === -1
              ? [...currentOrder, tab.id]
              : [
                  ...currentOrder.slice(0, sourceIndex + 1),
                  tab.id,
                  ...currentOrder.slice(sourceIndex + 1)
                ]
          void saveBoardItemOrder(activeBoardId, nextOrder)
          if (disposition !== 'foreground-tab') return
          setBoardView('tabs')
          requestTabSelect(tab.id)
        })
        .catch((error) => {
          console.error(`${FLOW_TAG} failed to open link in new tab from source=${sourceTabId}:`, error)
        })
    })
  }, [activeBoardId, boardItemOrderMap, createTab, fileNodes, requestTabSelect, saveBoardItemOrder, tabs, terminalNodes])

  const getOrderedSidebarBoardItems = useCallback(
    (boardId: string): SidebarBoardItem[] => {
      const boardTabs = boardId === activeBoardId ? tabs : (boardTabsMap.get(boardId) ?? [])
      const boardTerminals = boardId === activeBoardId ? terminalNodes : (boardTerminalsMap.get(boardId) ?? [])
      const boardFiles = boardId === activeBoardId ? fileNodes : (boardFilesMap.get(boardId) ?? [])
      const itemsById = new Map<string, SidebarBoardItem>()
      for (const tab of boardTabs) {
        itemsById.set(tab.id, { id: tab.id, kind: 'browser', tab })
      }
      for (const node of boardTerminals) {
        itemsById.set(node.id, { id: node.id, kind: 'terminal', node })
      }
      for (const node of boardFiles) {
        itemsById.set(node.id, { id: node.id, kind: 'file', node })
      }

      const orderedItems: SidebarBoardItem[] = []
      const seen = new Set<string>()
      for (const id of boardItemOrderMap.get(boardId) ?? []) {
        const item = itemsById.get(id)
        if (!item || seen.has(id)) continue
        seen.add(id)
        orderedItems.push(item)
      }
      for (const tab of boardTabs) {
        if (seen.has(tab.id)) continue
        seen.add(tab.id)
        orderedItems.push({ id: tab.id, kind: 'browser', tab })
      }
      for (const node of boardTerminals) {
        if (seen.has(node.id)) continue
        seen.add(node.id)
        orderedItems.push({ id: node.id, kind: 'terminal', node })
      }
      for (const node of boardFiles) {
        if (seen.has(node.id)) continue
        seen.add(node.id)
        orderedItems.push({ id: node.id, kind: 'file', node })
      }
      return orderedItems
    },
    [activeBoardId, boardFilesMap, boardItemOrderMap, boardTabsMap, boardTerminalsMap, fileNodes, tabs, terminalNodes]
  )

  const renderSidebarBoardItems = useCallback(
    (boardId: string): React.ReactNode => {
      const items = getOrderedSidebarBoardItems(boardId)
      if (items.length === 0) return null
      return (
        <div className="ml-[7px] mt-0.5 space-y-0.5 border-l border-border pl-[13px] py-0.5">
          {items.map((item) => {
            const isActive = activeItemId === item.id && boardId === activeBoardId
            if (item.kind === 'browser') {
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSidebarItemClick(item.id, boardId)}
                  onContextMenu={(event) => handleBoardItemContextMenu(event, item.id, item.kind, boardId)}
                  className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${isActive ? 'bg-accent/60 text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}`}
                >
                  <BrowserFavicon
                    src={item.tab.favicon}
                    imgClassName="h-3.5 w-3.5 rounded-sm"
                    iconClassName="h-3.5 w-3.5 text-muted-foreground"
                  />
                  <span className="truncate">{item.tab.title || item.tab.url || 'New Tab'}</span>
                  {!isActive && notifiedItemIds.has(item.id) && (
                    <span className="ml-auto shrink-0 h-1.5 w-1.5 rounded-full bg-blue-500" />
                  )}
                </button>
              )
            }

            if (item.kind === 'terminal') {
              return (
                <div
                  key={item.id}
                  className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs transition-colors cursor-pointer ${isActive ? 'bg-accent/60 text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}`}
                  onClick={() => handleSidebarItemClick(item.id, boardId)}
                  onContextMenu={(event) => handleBoardItemContextMenu(event, item.id, item.kind, boardId)}
                >
                  <Terminal className="h-3.5 w-3.5 shrink-0 text-green-500" />
                  {editingTerminalId === item.id ? (
                    <Input
                      value={editingTerminalName}
                      onChange={(event) => setEditingTerminalName(event.target.value)}
                      onBlur={() => void saveInlineTerminalEdit()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.currentTarget.blur()
                          return
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          cancelInlineTerminalEdit()
                        }
                      }}
                      className="h-5 flex-1 text-xs px-1 py-0"
                      autoFocus
                    />
                  ) : (
                    <span
                      className="min-w-0 flex-1 truncate text-left"
                      onDoubleClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        startInlineTerminalEdit(item.id, item.node.label || 'Terminal')
                      }}
                    >
                      {item.node.label || 'Terminal'}
                    </span>
                  )}
                  {!isActive && notifiedItemIds.has(item.id) && (
                    <span className="ml-auto shrink-0 h-1.5 w-1.5 rounded-full bg-blue-500" />
                  )}
                </div>
              )
            }

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSidebarItemClick(item.id, boardId)}
                onContextMenu={(event) => handleBoardItemContextMenu(event, item.id, item.kind, boardId)}
                className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${isActive ? 'bg-accent/60 text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}`}
              >
                <File className="h-3.5 w-3.5 shrink-0 text-cyan-500" />
                <span className="truncate">{item.node.label || 'File'}</span>
                {!isActive && notifiedItemIds.has(item.id) && (
                  <span className="ml-auto shrink-0 h-1.5 w-1.5 rounded-full bg-blue-500" />
                )}
              </button>
            )
          })}
        </div>
      )
    },
    [
      activeBoardId,
      activeItemId,
      notifiedItemIds,
      cancelInlineTerminalEdit,
      editingTerminalId,
      editingTerminalName,
      getOrderedSidebarBoardItems,
      handleBoardItemContextMenu,
      handleSidebarItemClick,
      saveInlineTerminalEdit,
      startInlineTerminalEdit
    ]
  )

  // Pane context menu actions
  const handleContextAddTab = useCallback(async () => {
    if (contextMenu?.flowPosition) {
      await handleAddTab(contextMenu.flowPosition.x, contextMenu.flowPosition.y)
    }
    setContextMenu(null)
  }, [contextMenu, handleAddTab])

  const handleContextAddGraphNode = useCallback(
    async (nodeType: string, label: string, config?: Record<string, unknown>) => {
      if (contextMenu?.flowPosition) {
        await createNode({
          nodeType,
          label,
          config: config ? JSON.stringify(config) : undefined,
          flowX: contextMenu.flowPosition.x,
          flowY: contextMenu.flowPosition.y
        })
      }
      setContextMenu(null)
    },
    [contextMenu, createNode]
  )

  // Node context menu actions
  const handleContextOpenTab = useCallback(() => {
    if (contextMenu?.nodeId) {
      const tab = tabs.find((t) => t.id === contextMenu.nodeId)
      if (tab) {
        setSelectedTab(tab)
        setDialogOpen(true)
      }
    }
    setContextMenu(null)
  }, [contextMenu, tabs])

  const handleContextAskAI = useCallback(() => {
    if (contextMenu?.nodeId) {
      const tab = tabs.find((t) => t.id === contextMenu.nodeId)
      if (tab) {
        setSelectedTab(tab)
        setDialogOpen(true)
      }
    }
    setContextMenu(null)
  }, [contextMenu, tabs])

  const handleContextAddMonitor = useCallback(() => {
    if (contextMenu?.nodeId) {
      setMonitorNodeId(contextMenu.nodeId)
      setMonitorInput('')
    }
    setContextMenu(null)
  }, [contextMenu])

  const handleContextDuplicateTab = useCallback(async () => {
    if (contextMenu?.nodeId) {
      const tab = tabs.find((t) => t.id === contextMenu.nodeId)
      if (tab) {
        await createTab({
          title: tab.title,
          url: tab.url,
          flowX: tab.flowX + 280,
          flowY: tab.flowY + 20
        })
      }
    }
    setContextMenu(null)
  }, [contextMenu, tabs, createTab])

  const deleteGraphItemFromActiveBoard = useCallback(
    async (itemId: string, kind: 'graph' | 'terminal' | 'file') => {
      if (kind === 'terminal') {
        window.api.terminal.kill(`pty-${itemId}`).catch(() => {})
        if (terminalDialogNodeId === itemId) {
          setTerminalDialogNodeId(null)
        }
      }
      await deleteNode(itemId)
      const currentEdges = reactFlowInstance.getEdges()
      const filteredEdges = currentEdges.filter((edge) => edge.source !== itemId && edge.target !== itemId)
      setEdges(filteredEdges)
      saveEdges(filteredEdges)
    },
    [deleteNode, reactFlowInstance, saveEdges, setEdges, terminalDialogNodeId]
  )

  const handleBoardItemRename = useCallback(() => {
    if (!boardItemMenu) return
    const { itemId, kind, boardId } = boardItemMenu
    if (kind === 'browser') {
      const sourceTabs = boardId === activeBoardId ? tabs : (boardTabsMap.get(boardId) ?? [])
      const tab = sourceTabs.find((entry) => entry.id === itemId)
      if (tab) {
        const currentName = tab.title?.trim() || tab.url || 'New Tab'
        setRenameDialog({ itemId, currentName, boardId, kind })
        setRenameDialogValue(currentName)
      }
      setBoardItemMenu(null)
      return
    }

    const sourceNodes = boardId === activeBoardId
      ? (kind === 'terminal' ? terminalNodes : fileNodes)
      : ((kind === 'terminal' ? boardTerminalsMap.get(boardId) : boardFilesMap.get(boardId)) ?? [])
    const node = sourceNodes.find((entry) => entry.id === itemId)
    if (node) {
      const fallbackName = kind === 'terminal' ? 'Terminal' : 'File'
      const currentName = node.label?.trim() || fallbackName
      setRenameDialog({ itemId, currentName, boardId, kind })
      setRenameDialogValue(currentName)
    }
    setBoardItemMenu(null)
  }, [activeBoardId, boardItemMenu, boardTabsMap, boardTerminalsMap, boardFilesMap, tabs, terminalNodes, fileNodes])

  const handleBoardItemReload = useCallback(() => {
    if (!boardItemMenu) return
    if (boardItemMenu.source !== 'tab-strip') {
      setBoardItemMenu(null)
      return
    }
    if (boardItemMenu.kind !== 'browser' && boardItemMenu.kind !== 'terminal') {
      setBoardItemMenu(null)
      return
    }
    pendingReloadNonceRef.current += 1
    setPendingTabReload({ itemId: boardItemMenu.itemId, nonce: pendingReloadNonceRef.current })
    setBoardItemMenu(null)
  }, [boardItemMenu])

  const deleteBoardItem = useCallback(
    async (itemId: string, kind: 'browser' | 'graph' | 'terminal' | 'file', boardId: string | null) => {
      const isActiveBoardItem = !!boardId && boardId === activeBoardId

      if (kind === 'browser') {
        if (isActiveBoardItem) {
          await deleteTab(itemId)
        } else if (boardId) {
          await window.api.browserTabs.delete(itemId, boardId)
          updateBoardTabsSidebar(boardId, (prev) => prev.filter((tab) => tab.id !== itemId))
        }
        if (boardId) {
          updateBoardItemOrder(boardId, (prev) => prev.filter((id) => id !== itemId))
        }
        return
      }

      if (isActiveBoardItem) {
        await deleteGraphItemFromActiveBoard(itemId, kind)
        if (boardId) {
          updateBoardItemOrder(boardId, (prev) => prev.filter((id) => id !== itemId))
        }
        return
      }

      if (kind === 'terminal') {
        window.api.terminal.kill(`pty-${itemId}`).catch(() => {})
      }
      if (!boardId) return
      await window.api.graphNodes.delete(itemId, boardId)
      if (kind === 'terminal' || kind === 'file') {
        updateBoardNodeSidebar(boardId, kind, (prev) => prev.filter((node) => node.id !== itemId))
      }
      updateBoardItemOrder(boardId, (prev) => prev.filter((id) => id !== itemId))
    },
    [activeBoardId, deleteTab, deleteGraphItemFromActiveBoard, updateBoardItemOrder, updateBoardNodeSidebar, updateBoardTabsSidebar]
  )

  const handleContextExecuteNode = useCallback(() => {
    const nodeId = contextMenu?.nodeId
    if (!nodeId) {
      setContextMenu(null)
      return
    }

    const runId = `context-node-${Date.now().toString(36)}`
    const currentNodes = reactFlowInstance.getNodes()
    const currentEdges = reactFlowInstance.getEdges()
    const targetNode = currentNodes.find((n) => n.id === nodeId)
    if (!targetNode) {
      setContextMenu(null)
      return
    }

    const incomingOnlyEdges = currentEdges.filter((e) => e.target === nodeId)
    const edgesForExecution =
      targetNode.type === 'trigger' || targetNode.type === 'scheduleTrigger' || targetNode.type === 'formTrigger'
        ? currentEdges
        : incomingOnlyEdges
    const updateNodeData = (id: string, updater: (prev: Record<string, unknown>) => Record<string, unknown>): void => {
      reactFlowInstance.setNodes((nds) =>
        nds.map((n) => (n.id === id ? { ...n, data: updater(n.data as Record<string, unknown>) } : n))
      )
    }

    console.log(
      `${FLOW_TAG} context execute node=${nodeId} type=${targetNode.type} incoming=${incomingOnlyEdges.length} edges=${edgesForExecution.length} run=${runId}`
    )
    setContextMenu(null)
    void executeFromTrigger(
      nodeId,
      edgesForExecution,
      currentNodes,
      updateNodeData,
      undefined,
      executeBrowserTab,
      undefined,
      runId,
      activeBoardId ?? undefined
    ).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      setNodeRuntimeStatus(nodeId, `Manual run failed: ${preview(message, 60)}`, false)
      console.error(`${FLOW_TAG} context execute failed node=${nodeId} run=${runId}:`, error)
    })
  }, [contextMenu, reactFlowInstance, executeBrowserTab, setNodeRuntimeStatus, activeBoardId])

  const handleContextRenameNode = useCallback(() => {
    const nodeId = contextMenu?.nodeId
    if (!nodeId) {
      setContextMenu(null)
      return
    }

    const isGraph = nodeId.startsWith('gn-')
    if (isGraph) {
      const node = gNodes.find((item) => item.id === nodeId)
      if (!node) {
        setContextMenu(null)
        return
      }
      const fallbackName = (
        {
          trigger: 'Run',
          scheduleTrigger: 'Schedule',
          formTrigger: 'Form Trigger',
          debug: 'Debug',
          notification: 'Notify',
          delay: 'Delay',
          aiPrompt: 'AI Prompt',
          text: 'Instructions',
          output: 'Output',
          file: 'File',
          terminal: 'Terminal'
        } as const
      )[node.nodeType] ?? 'Node'
      const currentName = node.label?.trim() || fallbackName
      setRenameDialog({
        itemId: nodeId,
        currentName,
        boardId: activeBoardId,
        kind: node.nodeType === 'terminal' ? 'terminal' : node.nodeType === 'file' ? 'file' : 'graph'
      })
      setRenameDialogValue(currentName)
      setContextMenu(null)
      return
    }

    const tab = tabs.find((item) => item.id === nodeId)
    if (!tab) {
      setContextMenu(null)
      return
    }
    const currentTitle = tab.title?.trim() || 'New Tab'
    setRenameDialog({ itemId: nodeId, currentName: currentTitle, boardId: activeBoardId, kind: 'browser' })
    setRenameDialogValue(currentTitle)
    setContextMenu(null)
  }, [activeBoardId, contextMenu, gNodes, tabs])

  const handleRenameDialogSubmit = useCallback(async () => {
    if (!renameDialog) return
    const trimmed = renameDialogValue.trim()
    if (!trimmed || trimmed === renameDialog.currentName) {
      setRenameDialog(null)
      return
    }
    try {
      const { itemId, boardId, kind } = renameDialog
      const isActiveBoardItem = !!boardId && boardId === activeBoardId
      if (kind === 'browser') {
        if (isActiveBoardItem || !boardId) {
          await updateTab(itemId, { title: trimmed })
        } else {
          await window.api.browserTabs.update(itemId, { title: trimmed }, boardId)
          updateBoardTabsSidebar(boardId, (prev) =>
            prev.map((tab) => (tab.id === itemId ? { ...tab, title: trimmed } : tab))
          )
        }
      } else {
        if (isActiveBoardItem || !boardId || kind === 'graph') {
          await updateNode(itemId, { label: trimmed })
        } else {
          await window.api.graphNodes.update(itemId, { label: trimmed }, boardId)
          if (kind === 'terminal' || kind === 'file') {
            updateBoardNodeSidebar(boardId, kind, (prev) =>
              prev.map((node) => (node.id === itemId ? { ...node, label: trimmed } : node))
            )
          }
        }
      }
    } catch (error) {
      console.error(`${FLOW_TAG} failed to rename node id=${renameDialog.itemId}:`, error)
    }
    setRenameDialog(null)
  }, [activeBoardId, renameDialog, renameDialogValue, updateBoardNodeSidebar, updateBoardTabsSidebar, updateTab, updateNode])

  const handleContextDeleteNode = useCallback(async () => {
    if (!contextMenu?.nodeId) {
      setContextMenu(null)
      return
    }
    if (contextMenu.nodeId.startsWith('gn-')) {
      const gn = gNodes.find((n) => n.id === contextMenu.nodeId)
      const kind =
        gn?.nodeType === 'terminal' ? 'terminal' : gn?.nodeType === 'file' ? 'file' : 'graph'
      await deleteBoardItem(contextMenu.nodeId, kind, activeBoardId)
    } else {
      await deleteBoardItem(contextMenu.nodeId, 'browser', activeBoardId)
    }
    setContextMenu(null)
  }, [activeBoardId, contextMenu, deleteBoardItem, gNodes])

  const handleBoardItemDelete = useCallback(async () => {
    if (!boardItemMenu) return
    await deleteBoardItem(boardItemMenu.itemId, boardItemMenu.kind, boardItemMenu.boardId)
    setBoardItemMenu(null)
  }, [boardItemMenu, deleteBoardItem])

  // ─── Monitor Dialog ─────────────────────────────────────────────────────────

  const handleAddMonitor = useCallback(async () => {
    if (!monitorNodeId || !monitorInput.trim()) return
    const tab = tabs.find((t) => t.id === monitorNodeId)
    if (!tab) return

    const existing = parseMonitors(tab)
    const newMonitor: BrowserTabMonitor = {
      id: `mon-${Date.now()}`,
      condition: monitorInput.trim(),
      enabled: true
    }
    const updated = [...existing, newMonitor]
    await updateTab(monitorNodeId, { monitors: JSON.stringify(updated) })
    setMonitorNodeId(null)
    setMonitorInput('')
  }, [monitorNodeId, monitorInput, tabs, updateTab])

  const handleRemoveMonitor = useCallback(
    async (tabId: string, monitorId: string) => {
      const tab = tabs.find((t) => t.id === tabId)
      if (!tab) return
      const existing = parseMonitors(tab)
      const updated = existing.filter((m) => m.id !== monitorId)
      await updateTab(tabId, { monitors: updated.length > 0 ? JSON.stringify(updated) : null })
    },
    [tabs, updateTab]
  )

  // Capture-phase Escape closes the monitor dialog reliably
  useEffect(() => {
    if (!monitorNodeId) return
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setMonitorNodeId(null)
      }
    }
    window.addEventListener('keydown', handleEscape, true)
    return (): void => window.removeEventListener('keydown', handleEscape, true)
  }, [monitorNodeId])

  const monitorTab = monitorNodeId ? tabs.find((t) => t.id === monitorNodeId) : null
  const monitorTabMonitors = monitorTab ? parseMonitors(monitorTab) : []

  const isBrowserTabNode = contextMenu?.type === 'node' && !contextMenu.nodeId?.startsWith('gn-')
  const isGraphNode = contextMenu?.type === 'node' && contextMenu.nodeId?.startsWith('gn-')
  const contextTerminalNode = isGraphNode && contextMenu?.nodeId
    ? gNodes.find((n) => n.id === contextMenu.nodeId && n.nodeType === 'terminal')
    : null
  const isTerminalNode = !!contextTerminalNode
  const contextFileNode = isGraphNode && contextMenu?.nodeId
    ? gNodes.find((n) => n.id === contextMenu.nodeId && n.nodeType === 'file')
    : null
  const isFileNode = !!contextFileNode

  const handleContextRestartTerminal = useCallback(() => {
    if (!contextTerminalNode) return
    const sessionId = `pty-${contextTerminalNode.id}`
    window.api.terminal.kill(sessionId).catch(() => {})
    setContextMenu(null)
  }, [contextTerminalNode])

  const handleContextShowFileAsTab = useCallback(() => {
    if (!contextFileNode) return
    setBoardView('tabs')
    requestTabSelect(contextFileNode.id)
    setContextMenu(null)
  }, [contextFileNode])
  const handleFlowContainerMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    lastMouseClientPositionRef.current = { x: event.clientX, y: event.clientY }
  }, [])

  const ungroupedBoards = workspace ? boardsByFolderId.get('__ungrouped__') ?? [] : []
  const { openChangelog } = useAppActions()

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizeRef.current = { startX: e.clientX, startWidth: sidebarWidth }
    const onMouseMove = (ev: MouseEvent): void => {
      if (!resizeRef.current) return
      const delta = ev.clientX - resizeRef.current.startX
      const newWidth = Math.max(200, Math.min(480, resizeRef.current.startWidth + delta))
      setSidebarWidth(newWidth)
    }
    const onMouseUp = (): void => {
      resizeRef.current = null
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [sidebarWidth])

  const toggleFolderExpanded = useCallback((folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(folderId)) {
        next.delete(folderId)
      } else {
        next.add(folderId)
      }
      void setSetting('expandedFolders', Array.from(next))
      return next
    })
  }, [setSetting])

  const handleCreateFolder = useCallback(async () => {
    try {
      await createFolder()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`${FLOW_TAG} failed to create folder:`, error)
      window.alert(`Failed to create folder: ${message}`)
    }
  }, [createFolder])

  const startInlineFolderEdit = useCallback((folderId: string, name: string) => {
    setEditingBoardId(null)
    setEditingBoardName('')
    setEditingFolderId(folderId)
    setEditingFolderName(name)
  }, [])

  const cancelInlineFolderEdit = useCallback(() => {
    setEditingFolderId(null)
    setEditingFolderName('')
  }, [])

  const saveInlineFolderEdit = useCallback(async () => {
    if (!editingFolderId) return
    const folderId = editingFolderId
    const nextName = editingFolderName.trim()
    const currentName = workspace?.folders.find((folder) => folder.id === folderId)?.name ?? ''
    setEditingFolderId(null)
    setEditingFolderName('')
    if (nextName.length === 0 || nextName === currentName) return
    try {
      pendingFolderRenameRef.current = true
      await renameFolder(folderId, nextName)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`${FLOW_TAG} failed to rename folder id=${folderId}:`, error)
      window.alert(`Failed to rename folder: ${message}`)
    } finally {
      pendingFolderRenameRef.current = false
    }
  }, [editingFolderId, editingFolderName, workspace, renameFolder])

  const handleDeleteFolder = useCallback(
    async (folderId: string, folderName: string) => {
      const confirmed = window.confirm(
        `Delete folder "${folderName}"? Boards in this folder will be moved to Ungrouped.`
      )
      if (!confirmed) return
      await deleteFolder(folderId)
    },
    [deleteFolder]
  )

  const handleCreateBoard = useCallback(
    async (folderId?: string | null) => {
      try {
        await createBoard({ folderId: folderId ?? null })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`${FLOW_TAG} failed to create board:`, error)
        window.alert(`Failed to create board: ${message}`)
      }
    },
    [createBoard]
  )

  const handleCreateTerminal = useCallback(async () => {
    if (!activeBoardId) return
    try {
      const command = getAgentCommand(getSetting('defaultAgent'), workspace?.rootDir, workspaceAgentCommandOverrides)
      const node = await createNode({
        nodeType: 'terminal',
        label: 'Terminal',
        config: JSON.stringify({ command }),
        flowX: 0,
        flowY: 0
      })
      setTerminalDialogNodeId(node.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`${FLOW_TAG} failed to create terminal:`, error)
      window.alert(`Failed to create terminal: ${message}`)
    }
  }, [activeBoardId, createNode, getSetting, workspace?.rootDir, workspaceAgentCommandOverrides])

  const startInlineBoardEdit = useCallback((boardId: string, name: string) => {
    setEditingFolderId(null)
    setEditingFolderName('')
    setEditingBoardId(boardId)
    setEditingBoardName(name)
  }, [])

  const cancelInlineBoardEdit = useCallback(() => {
    setEditingBoardId(null)
    setEditingBoardName('')
  }, [])

  const saveInlineBoardEdit = useCallback(async () => {
    if (!editingBoardId) return
    const boardId = editingBoardId
    const nextName = editingBoardName.trim()
    const currentName = workspace?.boards.find((board) => board.id === boardId)?.name ?? ''
    setEditingBoardId(null)
    setEditingBoardName('')
    if (nextName.length === 0 || nextName === currentName) return
    try {
      pendingBoardRenameRef.current = true
      await renameBoard(boardId, nextName)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`${FLOW_TAG} failed to rename board id=${boardId}:`, error)
      window.alert(`Failed to rename board: ${message}`)
    } finally {
      pendingBoardRenameRef.current = false
    }
  }, [editingBoardId, editingBoardName, workspace, renameBoard])

  const handleDeleteBoard = useCallback(
    async (boardId: string, boardName: string) => {
      const confirmed = window.confirm(`Delete board "${boardName}"?`)
      if (!confirmed) return
      await deleteBoard(boardId)
    },
    [deleteBoard]
  )

  const handleArchiveBoard = useCallback(
    async (boardId: string, boardName: string) => {
      const confirmed = window.confirm(
        `Archive board "${boardName}"? It will move into a hidden .archive folder and disappear from the main UI until restored from Settings.`
      )
      if (!confirmed) return
      setArchivingBoardId(boardId)
      try {
        await archiveBoard(boardId)
        setSettingsDialogBoardId((current) => (current === boardId ? null : current))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`${FLOW_TAG} failed to archive board id=${boardId}:`, error)
        window.alert(`Failed to archive board: ${message}`)
      } finally {
        setArchivingBoardId((current) => (current === boardId ? null : current))
      }
    },
    [archiveBoard]
  )

  const handleSelectBoard = useCallback(
    async (boardId: string) => {
      await setActiveBoard(boardId)
    },
    [setActiveBoard]
  )

  // -- Drag-and-drop handlers for sidebar boards/folders --
  const handleDragStart = useCallback((e: React.DragEvent, type: 'board' | 'folder', id: string) => {
    dragItemRef.current = { type, id }
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', `${type}:${id}`)
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.5'
    }
  }, [])

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    dragItemRef.current = null
    setDropTarget(null)
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = ''
    }
  }, [])

  const handleFolderDragOver = useCallback((e: React.DragEvent, folderId: string) => {
    e.preventDefault()
    e.stopPropagation()
    const dragging = dragItemRef.current
    if (!dragging) return
    // Don't allow dropping a folder onto itself
    if (dragging.type === 'folder' && dragging.id === folderId) return
    // Only boards can be dropped into folders
    if (dragging.type !== 'board') return
    // Don't allow dropping a board that's already in this folder
    const board = workspace?.boards.find((b) => b.id === dragging.id)
    if (board?.folderId === folderId) return
    e.dataTransfer.dropEffect = 'move'
    setDropTarget({ type: 'folder', id: folderId })
  }, [workspace])

  const handleUngroupedDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const dragging = dragItemRef.current
    if (!dragging) return
    // Only boards can be moved to ungrouped
    if (dragging.type !== 'board') return
    // Don't highlight if already ungrouped
    const board = workspace?.boards.find((b) => b.id === dragging.id)
    if (!board?.folderId) return
    e.dataTransfer.dropEffect = 'move'
    setDropTarget({ type: 'ungrouped' })
  }, [workspace])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement | null
    if (relatedTarget && e.currentTarget.contains(relatedTarget)) return
    setDropTarget(null)
  }, [])

  const handleFolderDrop = useCallback(async (e: React.DragEvent, folderId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(null)
    const dragging = dragItemRef.current
    dragItemRef.current = null
    if (!dragging) return
    if (dragging.type === 'board') {
      const board = workspace?.boards.find((b) => b.id === dragging.id)
      if (board?.folderId === folderId) return
      try {
        await moveBoard(dragging.id, folderId)
      } catch (error) {
        console.error(`${FLOW_TAG} failed to move board to folder:`, error)
      }
    }
  }, [workspace, moveBoard])

  const handleUngroupedDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(null)
    const dragging = dragItemRef.current
    dragItemRef.current = null
    if (!dragging) return
    if (dragging.type === 'board') {
      const board = workspace?.boards.find((b) => b.id === dragging.id)
      if (!board?.folderId) return
      try {
        await moveBoard(dragging.id, null)
      } catch (error) {
        console.error(`${FLOW_TAG} failed to move board to ungrouped:`, error)
      }
    }
  }, [workspace, moveBoard])

  return (
    <div className="flex h-full min-h-0 bg-transparent" onClick={() => { closeContextMenu(); closeBoardItemMenu(); closeBoardContextMenu(); closeFolderContextMenu() }}>
      {!sidebarCollapsed && (
        <aside style={{ width: sidebarWidth }} className="shrink-0 sidebar-vibrancy flex flex-col min-h-0">
          <div className="sidebar-traffic-row shrink-0 flex items-center pr-3">
            <div className="traffic-light-offset no-drag flex shrink-0 items-center">
              <button
                type="button"
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-colors"
                onClick={() => setSidebarCollapsed(true)}
                title="Collapse sidebar"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>
            <div className="drag-region flex-1 h-full" />
          </div>
          {isSettingsRoute && (
            <>
              <div className="drag-region px-3 py-2.5">
                <div className="no-drag">
                  <button
                    type="button"
                    className="flex h-8 w-full items-center gap-2 rounded-xl px-3 text-sm font-semibold text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-colors"
                    onClick={() => navigate('/')}
                  >
                    <ArrowLeft className="h-4 w-4 shrink-0" />
                    Back to app
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1">
                <div className="no-drag h-full">
                  <SettingsSidebar
                    workspace={workspace}
                    activeSection={settingsSection}
                    onSectionChange={setSettingsSection}
                  />
                </div>
              </div>
            </>
          )}
          {!isSettingsRoute && (
            <>
          <div className="drag-region px-3 py-2.5">
            <div className="no-drag">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
	                  <button
	                    type="button"
	                    className="flex h-8 w-full items-center justify-between gap-3 rounded-xl border border-border/40 bg-background/60 px-3 text-sm font-semibold text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-colors outline-none"
	                  >
                    <span className="truncate text-left">{workspace?.rootDir.split('/').pop() || 'Workspace'}</span>
                    <ChevronDown className="h-4 w-4 shrink-0" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56 rounded-2xl">
                  <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">Recent workspaces</DropdownMenuLabel>
                  {recentWorkspaces.map((rw) => (
                    <DropdownMenuItem
                      key={rw.path}
                      className="gap-2 text-xs"
                      onClick={() => {
                        if (rw.path !== workspace?.rootDir) {
                          void setRootDir(rw.path)
                        }
                      }}
                    >
                      {rw.path === workspace?.rootDir ? (
                        <Check className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <span className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <span className="truncate">{rw.name}</span>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="gap-2 text-xs"
                    onClick={() => void handleCreateFolder()}
                  >
                    <Folder className="h-3.5 w-3.5 shrink-0" />
                    New folder
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="gap-2 text-xs"
                    onClick={() => void handleCreateBoard(null)}
                  >
                    <NotebookPen className="h-3.5 w-3.5 shrink-0" />
                    New board
                  </DropdownMenuItem>
                  {activeBoardId && (
                    <DropdownMenuItem
                      className="gap-2 text-xs"
                      onClick={() => void handleCreateTerminal()}
                    >
                      <Terminal className="h-3.5 w-3.5 shrink-0" />
                      New terminal
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="gap-2 text-xs"
                    onClick={() => setNewWorkspaceDialogOpen(true)}
                  >
                    <FolderPlus className="h-3.5 w-3.5 shrink-0" />
                    New workspace...
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="gap-2 text-xs"
                    onClick={async () => {
                      const selected = await window.api.workspace.pickRootDir(workspace?.rootDir)
                      if (selected) void setRootDir(selected)
                    }}
                  >
                    <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                    Open folder...
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hidden px-1.5 py-1">
            <div className="space-y-0.5">
              {workspace?.folders.map((folder) => {
                const folderBoards = boardsByFolderId.get(folder.id) ?? []
                const expanded = expandedFolders.has(folder.id)
                const folderNotificationCount = folderBoards.reduce((count, board) => {
                  const boardItems = getOrderedSidebarBoardItems(board.id)
                  return count + boardItems.filter((item) => notifiedItemIds.has(item.id)).length
                }, 0)
                return (
                  <section
                    key={folder.id}
                    onDragOver={(e) => handleFolderDragOver(e, folder.id)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => void handleFolderDrop(e, folder.id)}
                  >
                    <div
                      className={[
                        'group/folderItem flex items-center gap-1 rounded-lg px-2 py-1 transition-colors',
                        dropTarget?.type === 'folder' && dropTarget.id === folder.id
                          ? 'bg-accent ring-1 ring-primary/50'
                          : 'hover:bg-accent/60'
                      ].join(' ')}
                      draggable={editingFolderId !== folder.id}
                      onDragStart={(e) => handleDragStart(e, 'folder', folder.id)}
                      onDragEnd={handleDragEnd}
                    >
                      {editingFolderId === folder.id ? (
                        <Input
                          value={editingFolderName}
                          onChange={(event) => setEditingFolderName(event.target.value)}
                          onBlur={() => void saveInlineFolderEdit()}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.currentTarget.blur()
                              return
                            }
                            if (event.key === 'Escape') {
                              event.preventDefault()
                              cancelInlineFolderEdit()
                            }
                          }}
                          className="h-7 flex-1 text-xs"
                          autoFocus
                        />
                      ) : (
                        <button
                          type="button"
                          className="group/folder flex min-w-0 flex-1 items-center gap-1 text-left"
                          onClick={() => toggleFolderExpanded(folder.id)}
                          onDoubleClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            startInlineFolderEdit(folder.id, folder.name)
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            setContextMenu(null)
                            setBoardItemMenu(null)
                            setBoardContextMenu(null)
                            setFolderContextMenu({
                              x: event.clientX,
                              y: event.clientY,
                              folderId: folder.id,
                              folderName: folder.name
                            })
                          }}
                        >
                          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                            {(() => {
                              const fm = getFolderMeta(folder.id)
                              const iconStyle = fm.color ? { color: fm.color } : undefined
                              return (
                                <>
                                  <DynamicIcon name={fm.icon} fallback={expanded ? FolderOpen : Folder} className="h-3.5 w-3.5 text-muted-foreground group-hover/folder:hidden" style={iconStyle} />
                                  {expanded ? (
                                    <ChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground group-hover/folder:block" />
                                  ) : (
                                    <ChevronRight className="hidden h-3.5 w-3.5 text-muted-foreground group-hover/folder:block" />
                                  )}
                                </>
                              )
                            })()}
                          </span>
                          <span className="truncate text-[13px] font-medium">{folder.name}</span>
                          {folderNotificationCount > 0 ? (
                            <span className="ml-auto shrink-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[9px] font-medium text-white">
                              {folderNotificationCount}
                            </span>
                          ) : null}
                        </button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="rounded p-1 text-muted-foreground opacity-0 group-hover/folderItem:opacity-100 transition-opacity hover:text-foreground"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Menu className="h-3 w-3" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" side="bottom" className="min-w-[160px]">
                          <DropdownMenuItem onClick={(event) => openFolderIconPicker(folder.id, event.currentTarget)}>
                            <Folder className="mr-2 h-4 w-4" />
                            Change Icon
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => void handleCreateBoard(folder.id)}>
                            <NotebookPen className="mr-2 h-4 w-4" />
                            Add New Board
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => void handleDeleteFolder(folder.id, folder.name)}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {expanded && (
                      <div className="ml-[15px] space-y-0.5 border-l border-border pl-[5px] py-0.5">
                        {folderBoards.length === 0 ? (
                          <p className="px-1 py-1 text-[11px] text-muted-foreground">No items</p>
                        ) : (
	                          <>
	                            {folderBoards.map((board) => {
	                              const boardItems = getOrderedSidebarBoardItems(board.id)
	                              const collapsed = collapsedBoards.has(board.id)
	                              return (
                              <div
                                key={board.id}
                                draggable={editingBoardId !== board.id}
                                onDragStart={(e) => handleDragStart(e, 'board', board.id)}
                                onDragEnd={handleDragEnd}
                                className={[
                                  'group/boardItem rounded-lg px-2 py-1 transition-colors',
                                  board.id === activeBoardId
                                    ? 'bg-accent/60 text-foreground'
                                    : 'hover:bg-accent/50'
                                ].join(' ')}
                              >
                                <div className="flex items-center gap-1">
                                  {editingBoardId === board.id ? (
                                    <Input
                                      value={editingBoardName}
                                      onChange={(event) => setEditingBoardName(event.target.value)}
                                      onBlur={() => void saveInlineBoardEdit()}
                                      onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                          event.currentTarget.blur()
                                          return
                                        }
                                        if (event.key === 'Escape') {
                                          event.preventDefault()
                                          cancelInlineBoardEdit()
                                        }
                                      }}
                                      className="h-7 flex-1 text-xs"
                                      autoFocus
                                    />
                                  ) : (
                                    <button
                                      type="button"
                                      className="group/board flex min-w-0 flex-1 items-center gap-1.5 truncate text-left text-xs font-medium"
                                      onClick={() => void handleSelectBoard(board.id)}
                                      onDoubleClick={(event) => {
                                        event.preventDefault()
                                        event.stopPropagation()
                                        startInlineBoardEdit(board.id, board.name)
                                      }}
                                      onContextMenu={(event) => {
                                        event.preventDefault()
                                        event.stopPropagation()
                                        setContextMenu(null)
                                        setBoardItemMenu(null)
                                        setFolderContextMenu(null)
                                        setBoardContextMenu({ x: event.clientX, y: event.clientY, boardId: board.id, boardName: board.name })
                                      }}
                                    >
                                      <span
                                        className="flex h-3.5 w-3.5 shrink-0 items-center justify-center"
                                        onClick={(event) => {
                                          event.preventDefault()
                                          event.stopPropagation()
                                          toggleBoardCollapsed(board.id)
                                        }}
                                      >
                                        {(() => {
                                          const bm = getBoardMeta(board.id)
                                          return (
                                            <>
                                              <DynamicIcon name={bm.icon} fallback={NotebookPen} className="h-3.5 w-3.5 text-muted-foreground group-hover/board:hidden" style={bm.color ? { color: bm.color } : undefined} />
                                              {collapsed ? (
                                                <ChevronRight className="hidden h-3.5 w-3.5 text-muted-foreground group-hover/board:block" />
                                              ) : (
                                                <ChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground group-hover/board:block" />
                                              )}
                                            </>
                                          )
                                        })()}
                                      </span>
                                      <span className="truncate">{board.name}</span>
                                      {(() => {
                                        const notifCount = boardItems.filter((bi) => notifiedItemIds.has(bi.id)).length
                                        return notifCount > 0 ? (
                                          <span className="ml-auto shrink-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[9px] font-medium text-white">{notifCount}</span>
                                        ) : null
                                      })()}
                                    </button>
                                  )}
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <button
                                        type="button"
                                        className="rounded p-1 text-muted-foreground opacity-0 group-hover/boardItem:opacity-100 transition-opacity hover:text-foreground"
                                        onClick={(event) => event.stopPropagation()}
                                      >
                                        <Menu className="h-3 w-3" />
                                      </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="start" side="bottom" className="min-w-[160px]">
                                      <DropdownMenuItem onClick={(event) => openBoardIconPicker(board.id, event.currentTarget)}>
                                        <NotebookPen className="mr-2 h-4 w-4" />
                                        Change Icon
                                      </DropdownMenuItem>
                                      <DropdownMenuItem onClick={() => {
                                        setSettingsDialogBoardId(board.id)
                                        void window.api.workspace.getBoardRootDir(board.id).then((dir) => {
                                          setSettingsDialogRootDir((dir as string) || '')
                                        })
                                      }}>
                                        <Settings className="mr-2 h-4 w-4" />
                                        Settings
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => void handleDeleteBoard(board.id, board.name)}>
                                        <Trash2 className="mr-2 h-4 w-4" />
                                        Delete
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
	                                {!collapsed && boardItems.length > 0 && renderSidebarBoardItems(board.id)}
	                              </div>
	                              )
	                            })}
                          </>
                        )}
                      </div>
                    )}
                  </section>
                )
              })}

              <div
                className={[
                  'rounded-lg transition-colors min-h-[8px]',
                  dropTarget?.type === 'ungrouped' ? 'ring-1 ring-primary/50 bg-accent/30' : ''
                ].join(' ')}
                onDragOver={handleUngroupedDragOver}
                onDragLeave={handleDragLeave}
                onDrop={(e) => void handleUngroupedDrop(e)}
	              >
	              {ungroupedBoards.map((board) => {
	                const boardItems = getOrderedSidebarBoardItems(board.id)
	                const collapsed = collapsedBoards.has(board.id)
	                return (
                  <div
                    key={board.id}
                    draggable={editingBoardId !== board.id}
                    onDragStart={(e) => handleDragStart(e, 'board', board.id)}
                    onDragEnd={handleDragEnd}
                    className={[
                      'group/boardItem rounded-lg px-2 py-1 transition-colors',
                      board.id === activeBoardId
                        ? 'bg-accent/60 text-foreground'
                        : 'hover:bg-accent/50'
                    ].join(' ')}
                  >
                    <div className="flex items-center gap-1">
                      {editingBoardId === board.id ? (
                        <Input
                          value={editingBoardName}
                          onChange={(event) => setEditingBoardName(event.target.value)}
                          onBlur={() => void saveInlineBoardEdit()}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.currentTarget.blur()
                              return
                            }
                            if (event.key === 'Escape') {
                              event.preventDefault()
                              cancelInlineBoardEdit()
                            }
                          }}
                          className="h-7 flex-1 text-xs"
                          autoFocus
                        />
                      ) : (
                        <button
                          type="button"
                          className="group/board flex min-w-0 flex-1 items-center gap-1.5 truncate text-left text-xs font-medium"
                          onClick={() => void handleSelectBoard(board.id)}
                          onDoubleClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            startInlineBoardEdit(board.id, board.name)
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            setContextMenu(null)
                            setBoardItemMenu(null)
                            setFolderContextMenu(null)
                            setBoardContextMenu({ x: event.clientX, y: event.clientY, boardId: board.id, boardName: board.name })
                          }}
                        >
                          <span
                            className="flex h-3.5 w-3.5 shrink-0 items-center justify-center"
                            onClick={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              toggleBoardCollapsed(board.id)
                            }}
                          >
                            {(() => {
                              const bm = getBoardMeta(board.id)
                              return (
                                <>
                                  <DynamicIcon name={bm.icon} fallback={NotebookPen} className="h-3.5 w-3.5 text-muted-foreground group-hover/board:hidden" style={bm.color ? { color: bm.color } : undefined} />
                                  {collapsed ? (
                                    <ChevronRight className="hidden h-3.5 w-3.5 text-muted-foreground group-hover/board:block" />
                                  ) : (
                                    <ChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground group-hover/board:block" />
                                  )}
                                </>
                              )
                            })()}
                          </span>
                          <span className="truncate">{board.name}</span>
                          {(() => {
                            const notifCount = boardItems.filter((bi) => notifiedItemIds.has(bi.id)).length
                            return notifCount > 0 ? (
                              <span className="ml-auto shrink-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[9px] font-medium text-white">{notifCount}</span>
                            ) : null
                          })()}
                        </button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="rounded p-1 text-muted-foreground opacity-0 group-hover/boardItem:opacity-100 transition-opacity hover:text-foreground"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Menu className="h-3 w-3" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" side="bottom" className="min-w-[160px]">
                          <DropdownMenuItem onClick={(event) => openBoardIconPicker(board.id, event.currentTarget)}>
                            <NotebookPen className="mr-2 h-4 w-4" />
                            Change Icon
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => {
                            setSettingsDialogBoardId(board.id)
                            void window.api.workspace.getBoardRootDir(board.id).then((dir) => {
                              setSettingsDialogRootDir((dir as string) || '')
                            })
                          }}>
                            <Settings className="mr-2 h-4 w-4" />
                            Settings
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => void handleDeleteBoard(board.id, board.name)}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
	                    {!collapsed && boardItems.length > 0 && renderSidebarBoardItems(board.id)}
	                  </div>
	                )
	              })}
              </div>
            </div>
          </div>

          <div className="border-t border-border/40 px-3 py-2 space-y-0.5">
            <UpdateBanner />
            <NavLink
              to="/settings"
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <Settings className="h-3.5 w-3.5" />
              Settings
            </NavLink>
            <button
              type="button"
              onClick={openChangelog}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <ScrollText className="h-3.5 w-3.5" />
              Changelog
            </button>
          </div>
            </>
          )}
        </aside>
      )}
      {!sidebarCollapsed && (
        <div
          className="relative z-20 mr-3 w-0 shrink-0 cursor-col-resize before:absolute before:-left-1 before:top-0 before:bottom-0 before:w-2 before:z-10 hover:before:bg-border/60 active:before:bg-border before:transition-colors"
          onMouseDown={startResize}
        />
      )}

      <div
        className={[
          'relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden bg-background/95 backdrop-blur-xl',
          sidebarCollapsed
            ? 'bg-background'
            : '-ml-3 rounded-l-2xl border border-border/50 shadow-[8px_18px_28px_rgba(15,23,42,0.08)]'
        ].join(' ')}
      >
          {!(sidebarCollapsed && isCompactTabsView) && (
            <div className={`drag-region shrink-0 ${sidebarCollapsed ? 'sidebar-drag-region' : 'content-drag-region'}`} />
          )}
          {!isCompactTabsView && (
            <div className="drag-region flex items-center justify-between gap-2 border-b border-border/40 pl-3 pr-2 py-1.5">
              <div className="flex items-center gap-2 min-w-0">
                {sidebarCollapsed && (
                  <button
                    type="button"
                    className="no-drag shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                    onClick={() => setSidebarCollapsed(false)}
                    title="Expand sidebar"
                  >
                    <PanelLeftOpen className="h-4 w-4" />
                  </button>
                )}
                {isSettingsRoute && sidebarCollapsed && (
                  <button
                    type="button"
                    className="no-drag shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                    onClick={() => navigate('/')}
                    title="Back"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                )}
                <p className="min-w-0 truncate text-sm font-semibold">
                  {isSettingsRoute ? 'Settings' : workspaceLoading ? 'Loading...' : activeBoard?.name ?? 'Select a board'}
                </p>
              </div>
              {!isSettingsRoute && activeBoardId && (
                <div className="no-drag flex shrink-0 items-center">
                  {renderBoardViewSwitcher('flex h-7 items-center gap-2 rounded-md border border-border/40 bg-background/80 px-2.5 text-[11px] font-medium text-foreground shadow-sm transition-colors hover:bg-accent/60')}
                </div>
              )}
            </div>
          )}
          {isSettingsRoute && (
            <SettingsPage
              activeSection={settingsSection}
              workspace={workspace}
              setRootDir={setRootDir}
              resetWorkspace={resetWorkspace}
              getRecentWorkspaces={getRecentWorkspaces}
              unarchiveBoard={unarchiveBoard}
            />
          )}
          {!isSettingsRoute && boardView === 'whiteboard' && (
          <FlowDirectionContext.Provider value={flowDirection}>
          <div ref={flowContainerRef} className="flex-1" onMouseMove={handleFlowContainerMouseMove}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={handleNodesChange}
              onEdgesChange={handleEdgesChange}
              onConnect={handleConnect}
              onReconnect={handleReconnect}
              onConnectStart={handleConnectStart}
              onConnectEnd={handleConnectEnd}
              onNodeClick={nodeOpenClick === 'single' ? handleNodeDoubleClick : undefined}
              onNodeDoubleClick={nodeOpenClick === 'double' ? handleNodeDoubleClick : undefined}
              onPaneContextMenu={handlePaneContextMenu}
              onNodeContextMenu={handleNodeContextMenu}
              fitView
              fitViewOptions={{ padding: 0.5 }}
              minZoom={0.3}
              maxZoom={2}
              nodesDraggable={!isMapMode}
              nodesConnectable={!isMapMode}
              elementsSelectable={!isMapMode}
              selectionOnDrag={!isMapMode}
              selectionMode={isMapMode ? SelectionMode.Full : SelectionMode.Partial}
              panOnDrag={isMapMode ? [0, 1] : [1]}
              panOnScroll={!isMapMode}
              panOnScrollMode={PanOnScrollMode.Free}
              zoomOnScroll={isMapMode}
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <Panel position="bottom-center">
                <div className="flex items-center gap-2">
                  <p className="text-xs text-muted-foreground bg-background/80 px-3 py-1 rounded-full border border-border/40">
                    {isMapMode
                      ? 'Map mode: drag to pan and scroll to zoom'
                      : 'Design mode: scroll to pan · drag-select supports partial overlap'}
                  </p>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground bg-background/80 px-3 py-1 rounded-full border border-border/40 hover:text-foreground transition-colors"
                    onClick={() => void setSetting('flowDirection', flowDirection === 'horizontal' ? 'vertical' : 'horizontal')}
                    title={`Edge direction: ${flowDirection}`}
                  >
                    {flowDirection === 'horizontal' ? '→' : '↓'}
                  </button>
                </div>
              </Panel>
            </ReactFlow>
          </div>
          </FlowDirectionContext.Provider>
          )}
          {!isSettingsRoute && boardView === 'tabs' && (
	            <BoardTabsView
	              key={activeBoardId}
	              tabs={tabs}
	              terminalNodes={terminalNodes}
	              fileNodes={fileNodes}
	              activeBoardId={activeBoardId}
	              inlineWithTrafficLights={sidebarCollapsed}
	              tabBarLeading={
	                sidebarCollapsed ? (
	                  <button
	                    type="button"
	                    className="no-drag rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
	                    onClick={() => setSidebarCollapsed(false)}
	                    title="Expand sidebar"
	                  >
	                    <PanelLeftOpen className="h-4 w-4" />
	                  </button>
	                ) : undefined
	              }
	              tabBarTrailing={
	                activeBoardId
	                  ? renderBoardViewSwitcher('no-drag flex h-7 items-center gap-2 rounded-md border border-border/40 bg-background/80 px-2.5 text-[11px] font-medium text-foreground shadow-sm transition-colors hover:bg-accent/60')
	                  : undefined
	              }
	              preferredOrderIds={activeBoardId ? (boardItemOrderMap.get(activeBoardId) ?? []) : []}
	              pendingSelectId={
	                pendingTabSelect?.boardId === activeBoardId
	                  ? pendingTabSelect.itemId
	                  : restoredBoardItemId
	              }
	              pendingSelectNonce={pendingTabSelect?.boardId === activeBoardId ? pendingTabSelect.nonce : 0}
	              onTabUpdate={updateTab}
	              onSaveViewOrder={async (orderedIds) => {
	                if (!activeBoardId) return
	                await saveBoardItemOrder(activeBoardId, orderedIds)
	              }}
	              onSaveTabOrder={saveTabOrder}
	              onSaveNodeOrder={saveNodeOrder}
	              onCreateTab={() => handleAddTab()}
	              onCreateAgent={async () => {
	                if (!activeBoardId) return undefined
	                try {
	                  const agentId = getSetting('defaultAgent')
	                  const command = getAgentCommand(agentId, workspace?.rootDir, workspaceAgentCommandOverrides)
	                  const agentLabel = CLI_AGENTS.find((a) => a.id === agentId)?.label ?? 'Agent'
	                  const node = await createNode({
	                    nodeType: 'terminal',
	                    label: agentLabel,
	                    config: JSON.stringify({ command }),
	                    flowX: 0,
	                    flowY: 0
	                  })
	                  return node.id
	                } catch (error) {
	                  const message = error instanceof Error ? error.message : String(error)
	                  console.error(`[browser] failed to create agent terminal:`, message)
	                  return undefined
	                }
	              }}
	              onCreateTerminal={async () => {
	                if (!activeBoardId) return undefined
	                try {
	                  const node = await createNode({
	                    nodeType: 'terminal',
	                    label: 'Terminal',
	                    flowX: 0,
	                    flowY: 0
	                  })
	                  return node.id
	                } catch (error) {
	                  const message = error instanceof Error ? error.message : String(error)
	                  console.error(`[browser] failed to create terminal:`, message)
	                  return undefined
	                }
	              }}
              onDeleteTab={(id) => void deleteTab(id)}
              onDeleteNode={(id) => {
                const gn = gNodes.find((n) => n.id === id)
                const kind = gn?.nodeType === 'terminal' ? 'terminal' : gn?.nodeType === 'file' ? 'file' : 'graph'
                void deleteBoardItem(id, kind, activeBoardId)
              }}
              onOpenTab={(tab) => { setSelectedTab(tab); setDialogOpen(true) }}
              onOpenTerminal={(nodeId) => setTerminalDialogNodeId(nodeId)}
              onUpdateNode={updateNode}
              notifiedIds={notifiedItemIds}
              onItemContextMenu={(event, item) => {
                if (!activeBoardId) return
                handleBoardItemContextMenu(event, item.id, item.kind, activeBoardId, 'tab-strip')
              }}
	              workspaceRootDir={workspace?.rootDir}
	              boardRootDir={boardRootDir}
	              pendingReloadId={pendingTabReload?.itemId ?? null}
	              pendingReloadNonce={pendingTabReload?.nonce}
	              onActiveItemChange={handleActiveBoardItemChange}
	            />
          )}
          {!isSettingsRoute && boardView === 'document' && (
            <BoardDocumentView
              boardId={activeBoardId}
              html={boardDocHtml}
              loading={boardDocLoading}
              tabs={tabs}
              terminalNodes={terminalNodes}
              outputNodes={outputNodes}
              onChange={handleBoardDocHtmlChange}
              onOpenTab={(tab) => { setSelectedTab(tab); setDialogOpen(true) }}
              onOpenTerminal={(nodeId) => setTerminalDialogNodeId(nodeId)}
            />
          )}
      </div>

      {/* Context Menu */}
      {contextMenu && boardView === 'whiteboard' && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 max-h-[calc(100vh-16px)] min-w-[180px] overflow-y-auto rounded-md border border-border/40 bg-popover p-1 shadow-sm animate-in fade-in-0 zoom-in-95"
          style={{
            left: contextMenuPosition?.x ?? contextMenu.x,
            top: contextMenuPosition?.y ?? contextMenu.y
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.type === 'pane' && (
            <>
              <button
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={handleContextAddTab}
              >
                <Globe className="h-4 w-4" />
                Add Website
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() => handleContextAddGraphNode('terminal', 'Agent', {
                  command: getAgentCommand(getSetting('defaultAgent'), workspace?.rootDir, workspaceAgentCommandOverrides)
                })}
              >
                <Sparkles className="h-4 w-4" />
                Add Agent
              </button>

              <div className="my-1 h-px bg-border" />

              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Triggers
              </div>
              <button
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() => handleContextAddGraphNode('trigger', 'Run')}
              >
                <Play className="h-4 w-4" />
                Add Trigger
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() =>
                  handleContextAddGraphNode('formTrigger', 'Form Trigger', {
                    fields: [
                      {
                        id: 'form-field-1',
                        key: 'input',
                        label: 'Input',
                        required: true
                      }
                    ]
                  } satisfies FormTriggerConfig)
                }
              >
                <FormInput className="h-4 w-4" />
                Add Form Trigger
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() =>
                  handleContextAddGraphNode('scheduleTrigger', 'Schedule', {
                    enabled: true,
                    prompt: 'every 10 minutes'
                  } satisfies ScheduleTriggerConfig)
                }
              >
                <CalendarClock className="h-4 w-4" />
                Add Schedule Trigger
              </button>

              <div className="my-1 h-px bg-border" />

              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Processing
              </div>
              <button
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() => handleContextAddGraphNode('delay', 'Delay')}
              >
                <Timer className="h-4 w-4" />
                Add Delay
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() => handleContextAddGraphNode('aiPrompt', 'AI Prompt')}
              >
                <Sparkles className="h-4 w-4" />
                Add AI Prompt
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() => handleContextAddGraphNode('text', 'Instructions')}
              >
                <NotebookPen className="h-4 w-4" />
                Add Instructions
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() => handleContextAddGraphNode('terminal', 'Terminal')}
              >
                <Terminal className="h-4 w-4" />
                Add Terminal
              </button>
              <div className="my-1 h-px bg-border" />

              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Outputs
              </div>
              <button
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() => handleContextAddGraphNode('notification', 'Notify')}
              >
                <Bell className="h-4 w-4" />
                Add Notification
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() => handleContextAddGraphNode('output', 'Output')}
              >
                <FileText className="h-4 w-4" />
                Add Output
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() => handleContextAddGraphNode('file', 'File')}
              >
                <FolderOpen className="h-4 w-4" />
                Add File
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() => handleContextAddGraphNode('debug', 'Debug')}
              >
                <Bug className="h-4 w-4" />
                Add Debug
              </button>
            </>
          )}
          {isBrowserTabNode && (
            <>
              <button
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={handleContextExecuteNode}
              >
                <Play className="h-4 w-4" />
                Execute node
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() => void handleContextRenameNode()}
              >
                <NotebookPen className="h-4 w-4" />
                Rename tab
              </button>
              <div className="my-1 h-px bg-border" />
              <button
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={handleContextOpenTab}
              >
                <Globe className="h-4 w-4" />
                Open tab
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={handleContextAskAI}
              >
                <MessageSquare className="h-4 w-4" />
                Ask AI...
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={handleContextDuplicateTab}
              >
                <Copy className="h-4 w-4" />
                Duplicate tab
              </button>
              <div className="my-1 h-px bg-border" />
              <button
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={handleContextAddMonitor}
              >
                <Radio className="h-4 w-4" />
                Add monitor / watch
              </button>
              <div className="my-1 h-px bg-border" />
              <button
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-accent"
                onClick={handleContextDeleteNode}
              >
                <Trash2 className="h-4 w-4" />
                Delete tab
              </button>
            </>
          )}
          {isGraphNode && (
            <>
              <button
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={handleContextExecuteNode}
              >
                <Play className="h-4 w-4" />
                Execute node
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() => void handleContextRenameNode()}
              >
                <NotebookPen className="h-4 w-4" />
                Rename node
              </button>
              {isTerminalNode && (
                <button
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                  onClick={handleContextRestartTerminal}
                >
                  <Terminal className="h-4 w-4" />
                  Restart terminal
                </button>
              )}
              {isFileNode && (
                <button
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                  onClick={handleContextShowFileAsTab}
                >
                  <File className="h-4 w-4" />
                  Show as tab
                </button>
              )}
              <div className="my-1 h-px bg-border" />
              <button
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-accent"
                onClick={handleContextDeleteNode}
              >
                <Trash2 className="h-4 w-4" />
                Delete node
              </button>
            </>
          )}
        </div>
      )}

      {boardItemMenu && (
        <div
          ref={boardItemMenuRef}
          className="fixed z-50 min-w-[180px] rounded-md border border-border/40 bg-popover p-1 shadow-sm animate-in fade-in-0 zoom-in-95"
          style={{
            left: boardItemMenuPosition?.x ?? boardItemMenu.x,
            top: boardItemMenuPosition?.y ?? boardItemMenu.y
          }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {boardItemMenu.source === 'tab-strip' && (boardItemMenu.kind === 'browser' || boardItemMenu.kind === 'terminal') && (
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
              onClick={() => void handleBoardItemReload()}
            >
              <RotateCw className="h-4 w-4" />
              {boardItemMenu.kind === 'browser' ? 'Reload Webview' : 'Restart Terminal'}
            </button>
          )}
          <button
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => void handleBoardItemRename()}
          >
            <NotebookPen className="h-4 w-4" />
            Rename
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-accent"
            onClick={() => void handleBoardItemDelete()}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        </div>
      )}

      {folderContextMenu && (
        <div
          ref={folderContextMenuRef}
          className="fixed z-50 min-w-[170px] rounded-md border border-border/40 bg-popover p-1 shadow-sm animate-in fade-in-0 zoom-in-95"
          style={{
            left: folderContextMenuPosition?.x ?? folderContextMenu.x,
            top: folderContextMenuPosition?.y ?? folderContextMenu.y
          }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={(event) => {
              openFolderIconPicker(folderContextMenu.folderId, event.currentTarget)
              setFolderContextMenu(null)
            }}
          >
            <Folder className="h-4 w-4" />
            Change Icon
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              void handleCreateBoard(folderContextMenu.folderId)
              setFolderContextMenu(null)
            }}
          >
            <NotebookPen className="h-4 w-4" />
            Add New Board
          </button>
          <div className="my-1 h-px bg-border/40" />
          <button
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-accent"
            onClick={() => {
              void handleDeleteFolder(folderContextMenu.folderId, folderContextMenu.folderName)
              setFolderContextMenu(null)
            }}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        </div>
      )}

      {boardContextMenu && (
        <div
          ref={boardContextMenuRef}
          className="fixed z-50 min-w-[160px] rounded-md border border-border/40 bg-popover p-1 shadow-sm animate-in fade-in-0 zoom-in-95"
          style={{
            left: boardContextMenuPosition?.x ?? boardContextMenu.x,
            top: boardContextMenuPosition?.y ?? boardContextMenu.y
          }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={(event) => {
              openBoardIconPicker(boardContextMenu.boardId, event.currentTarget)
              setBoardContextMenu(null)
            }}
          >
            <NotebookPen className="h-4 w-4" />
            Change Icon
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              setSettingsDialogBoardId(boardContextMenu.boardId)
              void window.api.workspace.getBoardRootDir(boardContextMenu.boardId).then((dir) => {
                setSettingsDialogRootDir((dir as string) || '')
              })
              setBoardContextMenu(null)
            }}
          >
            <Settings className="h-4 w-4" />
            Settings
          </button>
          <div className="my-1 h-px bg-border/40" />
          <button
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-accent"
            onClick={() => {
              void handleDeleteBoard(boardContextMenu.boardId, boardContextMenu.boardName)
              setBoardContextMenu(null)
            }}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        </div>
      )}

      {/* Monitor Dialog */}
      {monitorNodeId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setMonitorNodeId(null)}>
          <div
            className="w-[400px] rounded-lg border border-border/40 bg-card p-4 shadow-sm space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold">Add Monitor / Watch</h3>
            <p className="text-xs text-muted-foreground">
              Describe a condition to monitor on this page. When the condition is met, the monitor handle will fire.
            </p>

            {/* Existing monitors */}
            {monitorTabMonitors.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Active monitors</p>
                {monitorTabMonitors.map((m) => {
                  const isExpanded = expandedMonitorId === m.id
                  const hasRule = !!m.rule
                  return (
                    <div key={m.id} className="rounded-md border border-border/40 overflow-hidden">
                      <div className="flex items-center gap-2 px-2 py-1.5 text-xs">
                        <button
                          className="text-muted-foreground hover:text-foreground shrink-0"
                          onClick={() => setExpandedMonitorId(isExpanded ? null : m.id)}
                          title={hasRule ? 'Show/hide rule preview' : 'Rule not generated yet'}
                        >
                          {isExpanded
                            ? <ChevronDown className="h-3 w-3" />
                            : <ChevronRight className="h-3 w-3" />
                          }
                        </button>
                        <Radio className="h-3 w-3 text-amber-500 shrink-0" />
                        <span className="flex-1 truncate">{m.condition}</span>
                        {hasRule && (
                          <span className="text-[9px] text-emerald-500 font-medium shrink-0">RULE</span>
                        )}
                        {!hasRule && (
                          <span className="text-[9px] text-muted-foreground/50 shrink-0">pending</span>
                        )}
                        <button
                          className="text-muted-foreground hover:text-destructive shrink-0"
                          onClick={() => handleRemoveMonitor(monitorNodeId, m.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                      {isExpanded && (
                        <div className="border-t border-border/40 bg-muted/20 px-2.5 py-2 space-y-1.5">
                          {hasRule ? (
                            <>
                              <div className="flex items-start gap-1.5">
                                <Search className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                                <div className="min-w-0 flex-1">
                                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider">CSS Selector</p>
                                  <code className="block text-[11px] font-mono text-foreground/80 break-all bg-background rounded px-1.5 py-0.5 mt-0.5 border border-border/40">
                                    {m.rule!.cssSelector}
                                  </code>
                                </div>
                              </div>
                              <div className="flex items-start gap-1.5">
                                <Code className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                                <div className="min-w-0 flex-1">
                                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider">
                                    Regex <span className="normal-case">(group {m.rule!.regexGroup})</span>
                                  </p>
                                  <code className="block text-[11px] font-mono text-foreground/80 break-all bg-background rounded px-1.5 py-0.5 mt-0.5 border border-border/40">
                                    /{m.rule!.regex}/
                                  </code>
                                </div>
                              </div>
                              <div className="flex items-start gap-1.5">
                                <GitCompare className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                                <div className="min-w-0 flex-1">
                                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Check</p>
                                  <p className="text-[11px] text-foreground/80 mt-0.5">
                                    <span className="font-mono bg-background rounded px-1 py-0.5 border border-border/40">{m.rule!.check}</span>
                                    {m.rule!.value !== undefined && (
                                      <span className="ml-1.5 font-mono bg-background rounded px-1 py-0.5 border border-border/40">{m.rule!.value}</span>
                                    )}
                                  </p>
                                </div>
                              </div>
                              {m.lastExtracted !== undefined && (
                                <div className="mt-1 pt-1.5 border-t">
                                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Last extracted value</p>
                                  <code className="block text-[11px] font-mono text-foreground/80 break-all bg-background rounded px-1.5 py-0.5 mt-0.5 border border-border/40 max-h-[60px] overflow-auto">
                                    {m.lastExtracted || <span className="text-muted-foreground/50 italic">(empty)</span>}
                                  </code>
                                </div>
                              )}
                            </>
                          ) : (
                            <p className="text-[11px] text-muted-foreground/60 italic">
                              Rule will be auto-generated on the next polling cycle when the monitor evaluates the page for the first time.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            <div className="flex gap-2">
              <Input
                value={monitorInput}
                onChange={(e) => setMonitorInput(e.target.value)}
                placeholder='e.g. "Price drops below $50" or "New items appear"'
                className="h-8 text-xs"
                onKeyDown={(e) => e.key === 'Enter' && handleAddMonitor()}
                autoFocus
              />
              <Button size="sm" className="h-8 shrink-0" onClick={handleAddMonitor} disabled={!monitorInput.trim()}>
                Add
              </Button>
            </div>

            <div className="flex justify-end">
              <Button variant="outline" size="sm" className="h-7" onClick={() => setMonitorNodeId(null)}>
                Done
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden monitor webviews for polling */}
      {monitoredTabs.length > 0 && (
        <MonitorWebviews
          tabs={monitoredTabs}
          onMonitorFired={handleMonitorFired}
          onMonitorRuleGenerated={handleMonitorRuleGenerated}
          onMonitorExtractedUpdate={handleMonitorExtractedUpdate}
        />
      )}

      {/* Hidden webviews for pasted-tab preview hydration */}
      {previewingTabs.size > 0 && (
        <div
          style={{
            position: 'absolute',
            width: '1px',
            height: '1px',
            opacity: 0,
            pointerEvents: 'none',
            overflow: 'hidden'
          }}
        >
          {Array.from(previewingTabs).map((tabId) => {
            const tab = tabs.find((item) => item.id === tabId)
            return (
              <webview
                key={`preview-${tabId}`}
                ref={(el) => {
                  if (el) {
                    const wv = el as unknown as Electron.WebviewTag
                    previewWebviews.current.set(tabId, wv)
                    wv.addEventListener('focus', () => wv.blur())
                  } else {
                    previewWebviews.current.delete(tabId)
                  }
                }}
                src={tab?.url && tab.url !== 'about:blank' ? tab.url : 'about:blank'}
                partition="persist:browser-tabs"
                useragent={WEBVIEW_USER_AGENT}
                tabIndex={-1}
                style={{ width: '1280px', height: '800px' }}
              />
            )
          })}
        </div>
      )}

      {/* Hidden webviews for graph-triggered browser tab agent runs */}
      {runningTabs.size > 0 && (
        <div
          style={{
            position: 'absolute',
            width: '1px',
            height: '1px',
            opacity: 0,
            pointerEvents: 'none',
            overflow: 'hidden'
          }}
        >
          {Array.from(runningTabs).map((tabId) => (
            <webview
              key={tabId}
              ref={(el) => {
                if (el) {
                  const wv = el as unknown as Electron.WebviewTag
                  triggerWebviews.current.set(tabId, wv)
                  wv.addEventListener('focus', () => wv.blur())
                } else {
                  triggerWebviews.current.delete(tabId)
                }
              }}
              src="about:blank"
              partition="persist:browser-tabs"
              useragent={WEBVIEW_USER_AGENT}
              tabIndex={-1}
              style={{ width: '1024px', height: '768px' }}
            />
          ))}
        </div>
      )}

      {/* Dialog */}
      <BrowserTabDialog
        key={selectedTab?.id ?? 'browser-tab-dialog-empty'}
        tab={selectedTab}
        boardId={activeBoardId}
        open={dialogOpen}
        onOpenChange={handleDialogClose}
        onTabUpdate={updateTab}
        onRecaptureScreenshot={refresh}
        onWebviewStateChange={handleDialogWebviewStateChange}
      />

      {(() => {
        const gn = terminalDialogNodeId ? gNodes.find((n) => n.id === terminalDialogNodeId) : null
        const cfg = gn ? (parseNodeConfig(gn.config) as TerminalNodeConfig) : {}
        return (
          <TerminalDialog
            key={terminalDialogNodeId ?? 'terminal-dialog-empty'}
            open={!!terminalDialogNodeId}
            onOpenChange={(o) => { if (!o) setTerminalDialogNodeId(null) }}
            sessionId={terminalDialogNodeId ? `pty-${terminalDialogNodeId}` : ''}
            label={gn?.label || 'Terminal'}
            onRename={(name) => {
              if (terminalDialogNodeId) {
                void updateNode(terminalDialogNodeId, { label: name })
              }
            }}
            config={cfg}
            onUpdateConfig={(nextCfg) => {
              if (terminalDialogNodeId) {
                void updateNode(terminalDialogNodeId, { config: JSON.stringify(nextCfg) })
              }
            }}
            workspaceRootDir={workspace?.rootDir}
            boardRootDir={boardRootDir}
          />
        )
      })()}

      {/* Board Settings Dialog */}
      <Dialog open={!!settingsDialogBoardId} onOpenChange={(o) => { if (!o) setSettingsDialogBoardId(null) }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Board Settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Root Directory</label>
              <p className="text-xs text-muted-foreground">
                Terminals in this board will start in this directory by default.
              </p>
              <div className="flex gap-2">
                <Input
                  value={settingsDialogRootDir}
                  onChange={(e) => setSettingsDialogRootDir(e.target.value)}
                  placeholder="(none — uses workspace root)"
                  className="flex-1 text-sm font-mono"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={async () => {
                    const picked = await window.api.workspace.pickBoardRootDir(settingsDialogRootDir || undefined)
                    if (picked) setSettingsDialogRootDir(picked as string)
                  }}
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="rounded-[20px] border border-border/60 bg-muted/20 p-4">
              <label className="text-sm font-medium">Archive Board</label>
              <p className="mt-1 text-xs text-muted-foreground">
                Move this board into a hidden <code>.archive</code> folder inside its current location. Archived boards are removed from the sidebar and can be restored from Settings.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 gap-1.5"
                disabled={!settingsDialogBoard || archivingBoardId === settingsDialogBoard.id}
                onClick={() => {
                  if (!settingsDialogBoard) return
                  void handleArchiveBoard(settingsDialogBoard.id, settingsDialogBoard.name)
                }}
              >
                <Archive className="h-3.5 w-3.5" />
                {settingsDialogBoard && archivingBoardId === settingsDialogBoard.id ? 'Archiving...' : 'Archive Board'}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={!!settingsDialogBoard && archivingBoardId === settingsDialogBoard.id}
              onClick={() => setSettingsDialogBoardId(null)}
            >
              Cancel
            </Button>
            <Button disabled={!!settingsDialogBoard && archivingBoardId === settingsDialogBoard.id} onClick={async () => {
              if (!settingsDialogBoardId) return
              await window.api.workspace.setBoardRootDir(settingsDialogBoardId, settingsDialogRootDir.trim() || null)
              if (settingsDialogBoardId === activeBoardId) {
                setBoardRootDir(settingsDialogRootDir.trim() || null)
              }
              setSettingsDialogBoardId(null)
            }}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Node Dialog */}
      <Dialog open={!!renameDialog} onOpenChange={(o) => { if (!o) setRenameDialog(null) }}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>Rename</DialogTitle>
          </DialogHeader>
          <Input
            value={renameDialogValue}
            onChange={(e) => setRenameDialogValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleRenameDialogSubmit() }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialog(null)}>Cancel</Button>
            <Button onClick={() => void handleRenameDialogSubmit()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Workspace Dialog */}
      <Dialog open={newWorkspaceDialogOpen} onOpenChange={(o) => { if (!o) setNewWorkspaceDialogOpen(false) }}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>New Workspace</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Choose a folder to use as the workspace root. Boards and settings will be stored inside it.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewWorkspaceDialogOpen(false)}>Cancel</Button>
            <Button onClick={async () => {
              setNewWorkspaceDialogOpen(false)
              const selected = await window.api.workspace.pickRootDir(workspace?.rootDir)
              if (selected) void setRootDir(selected)
            }}>
              Choose Folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Icon Picker */}
      {iconPickerTarget && (
        <IconPicker
          currentIcon={
            iconPickerTarget.type === 'folder'
              ? getFolderMeta(iconPickerTarget.id).icon
              : getBoardMeta(iconPickerTarget.id).icon
          }
          currentColor={
            iconPickerTarget.type === 'folder'
              ? getFolderMeta(iconPickerTarget.id).color
              : getBoardMeta(iconPickerTarget.id).color
          }
          anchor={iconPickerTarget.anchor}
          onSelect={(meta) => {
            if (iconPickerTarget.type === 'folder') {
              setFolderMeta(iconPickerTarget.id, meta)
            } else {
              setBoardMeta(iconPickerTarget.id, meta)
            }
          }}
          onClose={() => setIconPickerTarget(null)}
        />
      )}
    </div>
  )
}

export function BrowserPage(): React.ReactElement {
  return (
    <ReactFlowProvider>
      <BrowserPageInner />
    </ReactFlowProvider>
  )
}
