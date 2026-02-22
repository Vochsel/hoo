import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
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
import { Plus, Globe, MessageSquare, Radio, Trash2, Copy, Play, Bug, Bell, Sparkles, Timer, Type, FileText, FolderOpen, ChevronDown, ChevronRight, Code, Search, GitCompare, CalendarClock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BrowserTabNode, type BrowserTabNodeData } from '@/components/browser/browser-tab-node'
import { TriggerNode } from '@/components/browser/trigger-node'
import { ScheduleTriggerNode, type ScheduleTriggerConfig } from '@/components/browser/schedule-trigger-node'
import { DebugNode } from '@/components/browser/debug-node'
import { NotificationNode } from '@/components/browser/notification-node'
import { DelayNode } from '@/components/browser/delay-node'
import { AiPromptNode } from '@/components/browser/ai-prompt-node'
import { TextNode } from '@/components/browser/text-node'
import { OutputNode } from '@/components/browser/output-node'
import { FileNode } from '@/components/browser/file-node'
import { BrowserTabDialog } from '@/components/browser/browser-tab-dialog'
import { MonitorWebviews } from '@/components/browser/monitor-webviews'
import { useBrowserTabs, type BrowserTab, type BrowserTabMonitor, type MonitorRule } from '@/hooks/use-browser-tabs'
import { useSettings } from '@/hooks/use-settings'
import { useGraphNodes } from '@/hooks/use-graph-nodes'
import { useBrowserEdges } from '@/hooks/use-browser-edges'
import { executeFromTrigger } from '@/services/graph-executor'
import { runAgentOnWebview } from '@/services/browser-agent-runner'
import { getWebviewUserAgent } from '@/lib/webview-user-agent'
import { cronMatchesDate, formatLocalMinuteKey, resolveScheduleCron } from '@/lib/schedule-cron'
import TurndownService from 'turndown'

const MONITOR_TAG = '[browser-monitor]'
const SCHEDULE_TAG = '[schedule-trigger]'
const BROWSER_EXEC_TAG = '[browser-exec]'
const FLOW_TAG = '[browser-flow]'
const MAX_HTML_CHARS = 250_000
const MAX_OUTPUT_CHARS = 60_000
const SCHEDULE_POLL_INTERVAL_MS = 60_000
const SCHEDULE_ALIGNMENT_GRACE_MS = 250
const SCHEDULE_MIN_TIMER_DELAY_MS = 25
const WEBVIEW_USER_AGENT = getWebviewUserAgent()
type FlowInteractionMode = 'design' | 'map'

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

const nodeTypes: NodeTypes = {
  browserTab: BrowserTabNode as unknown as NodeTypes['browserTab'],
  trigger: TriggerNode as unknown as NodeTypes['trigger'],
  scheduleTrigger: ScheduleTriggerNode as unknown as NodeTypes['scheduleTrigger'],
  debug: DebugNode as unknown as NodeTypes['debug'],
  notification: NotificationNode as unknown as NodeTypes['notification'],
  delay: DelayNode as unknown as NodeTypes['delay'],
  aiPrompt: AiPromptNode as unknown as NodeTypes['aiPrompt'],
  text: TextNode as unknown as NodeTypes['text'],
  output: OutputNode as unknown as NodeTypes['output'],
  file: FileNode as unknown as NodeTypes['file']
}

interface ContextMenu {
  x: number
  y: number
  type: 'pane' | 'node'
  nodeId?: string
  nodeType?: string
  flowPosition?: { x: number; y: number }
}

function BrowserPageInner(): React.ReactElement {
  const { tabs, refresh, createTab, updateTab, deleteTab, savePositions: saveTabPositions } = useBrowserTabs()
  const { getSetting } = useSettings()
  const {
    graphNodes: gNodes,
    createNode,
    updateNode,
    deleteNode,
    savePositions: saveGraphPositions
  } = useGraphNodes()
  const { edges: savedEdges, saveEdges } = useBrowserEdges()

  const [selectedTab, setSelectedTab] = useState<BrowserTab | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const [monitorInput, setMonitorInput] = useState('')
  const [monitorNodeId, setMonitorNodeId] = useState<string | null>(null)
  const [expandedMonitorId, setExpandedMonitorId] = useState<string | null>(null)
  const [runningTabs, setRunningTabs] = useState<Set<string>>(new Set())
  const triggerWebviews = useRef<Map<string, Electron.WebviewTag>>(new Map())
  const pendingPositionOverrides = useRef<Map<string, { x: number; y: number }>>(new Map())
  const scheduleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleRunningRef = useRef(false)
  const scheduleLastFiredMinuteRef = useRef<Map<string, string>>(new Map())
  const reactFlowInstance = useReactFlow()
  const flowInteractionMode: FlowInteractionMode =
    (getSetting('flowInteractionMode') as string) === 'map' ? 'map' : 'design'
  const isMapMode = flowInteractionMode === 'map'

  const setNodeRuntimeStatus = useCallback(
    (nodeId: string, status: string, isRunning?: boolean): void => {
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
          return { ...n, data: nextData }
        })
      )
    },
    [reactFlowInstance]
  )

  // ─── Browser tab agent execution ───────────────────────────────────────

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
      // Mark tab as running
      setRunningTabs((prev) => new Set(prev).add(tabNodeId))
      console.log(
        `${BROWSER_EXEC_TAG} run=${runLabel} tab=${tabNodeId} start url=${tab.url} inputLen=${inputData?.length ?? 0} inputPreview="${preview(inputData)}"`
      )

      try {
        // Get or wait for the hidden webview
        const webviewWaitStart = Date.now()
        let waitAttempts = 0
        let webview = triggerWebviews.current.get(tabNodeId)

        if (!webview) {
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
          `${BROWSER_EXEC_TAG} run=${runLabel} tab=${tabNodeId} webviewLookup waitMs=${Date.now() - webviewWaitStart} attempts=${waitAttempts}`
        )

        if (!webview) {
          setNodeRuntimeStatus(tabNodeId, 'Browser: failed (webview unavailable)', false)
          console.error(`${BROWSER_EXEC_TAG} run=${runLabel} tab=${tabNodeId} no webview available`)
          return undefined
        }
        if (WEBVIEW_USER_AGENT) {
          console.log(`${BROWSER_EXEC_TAG} run=${runLabel} tab=${tabNodeId} using webview userAgent attribute`)
        }

        // Load the tab URL and wait for it
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

        // Extra settle time
        setNodeRuntimeStatus(tabNodeId, 'Browser: waiting for page settle', true)
        await new Promise((r) => setTimeout(r, 1000))
        console.log(
          `${BROWSER_EXEC_TAG} run=${runLabel} tab=${tabNodeId} page settled url=${webview.getURL()} title="${preview(webview.getTitle(), 90)}"`
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

        // Extract full HTML and convert to markdown for downstream prompt nodes.
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
        const snapshot = [
          '[Web Content Snapshot]',
          `URL: ${finalUrl}`,
          `Title: ${finalTitle}`,
          '',
          markdown
        ].join('\n')

        const combined = agentSummary?.trim()
          ? ['[Browser Agent Result]', agentSummary.trim(), '', snapshot].join('\n')
          : snapshot

        const output =
          combined.length > MAX_OUTPUT_CHARS
            ? `${combined.slice(0, MAX_OUTPUT_CHARS)}\n\n[Truncated at ${MAX_OUTPUT_CHARS} chars]`
            : combined

        console.log(
          `${BROWSER_EXEC_TAG} run=${runLabel} tab=${tabNodeId} output ready agentLen=${agentSummary?.length ?? 0} snapshotLen=${snapshot.length} combinedLen=${combined.length} outputLen=${output.length} outputPreview="${preview(output, 220)}"`
        )
        if (combined.length > MAX_OUTPUT_CHARS) {
          console.warn(
            `${BROWSER_EXEC_TAG} run=${runLabel} tab=${tabNodeId} output truncated from ${combined.length} to ${MAX_OUTPUT_CHARS}`
          )
        }
        setNodeRuntimeStatus(tabNodeId, `Browser complete (${output.length} chars)`, false)
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
        setRunningTabs((prev) => {
          const next = new Set(prev)
          next.delete(tabNodeId)
          return next
        })
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

      executeFromTrigger(nodeId, currentEdges, currentNodes, updateNodeData, undefined, executeBrowserTab)
    },
    [reactFlowInstance, executeBrowserTab]
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
      await executeFromTrigger(nodeId, currentEdges, currentNodes, updateNodeData, undefined, executeBrowserTab, undefined, runId)
    },
    [reactFlowInstance, executeBrowserTab]
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
          edgeRunId
        )
        console.log(`${MONITOR_TAG} run=${monitorRunId} edge execution complete id=${edge.id} graphRun=${edgeRunId}`)
      }
    },
    [tabs, updateTab, reactFlowInstance, executeBrowserTab]
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
        isRunning: runningTabs.has(tab.id),
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
        return {
          ...base,
          data: {
            label: gn.label || 'Text',
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
  }, [tabs, gNodes, runningTabs, handleClose, handleTrigger, handleEditScheduleConfig, handleScheduleTrigger, handleEditNotificationConfig, handleEditDelayConfig, handleEditAiPrompt, handleEditText, handleEditFileConfig, handlePickFile])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(savedEdges)

  // Sync nodes when data sources change
  useEffect(() => {
    setNodes((prevNodes) => {
      const prevById = new Map(prevNodes.map((node) => [node.id, node]))
      return initialNodes.map((nextNode) => {
        const prevNode = prevById.get(nextNode.id)
        if (!prevNode) return nextNode
        return {
          ...prevNode,
          ...nextNode,
          // Preserve in-flight local positioning and interaction state.
          position: prevNode.position ?? nextNode.position,
          data: {
            ...(prevNode.data as Record<string, unknown>),
            ...(nextNode.data as Record<string, unknown>)
          }
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
      onNodesChange(changes)

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
      // Only open dialog for browser tabs (graph nodes handle their own double-click)
      const tab = tabs.find((t) => t.id === node.id)
      if (tab) {
        setSelectedTab(tab)
        setDialogOpen(true)
      }
    },
    [tabs]
  )

  const handleAddTab = useCallback(
    async (flowX?: number, flowY?: number) => {
      await createTab({
        flowX: flowX ?? 100 + Math.random() * 200,
        flowY: flowY ?? 100 + Math.random() * 200
      })
    },
    [createTab]
  )

  useEffect(() => {
    const onAddTab = (): void => {
      void handleAddTab()
    }
    window.addEventListener('hoo:browser-add-tab', onAddTab)
    return (): void => {
      window.removeEventListener('hoo:browser-add-tab', onAddTab)
    }
  }, [handleAddTab])

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

  // ─── Context Menus ──────────────────────────────────────────────────────────

  const handlePaneContextMenu = useCallback(
    (event: MouseEvent | React.MouseEvent<Element, MouseEvent>) => {
      event.preventDefault()
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

  const handleContextDeleteNode = useCallback(async () => {
    if (!contextMenu?.nodeId) {
      setContextMenu(null)
      return
    }
    if (contextMenu.nodeId.startsWith('gn-')) {
      await deleteNode(contextMenu.nodeId)
      // Also remove edges connected to this node
      const currentEdges = reactFlowInstance.getEdges()
      const filteredEdges = currentEdges.filter(
        (e) => e.source !== contextMenu.nodeId && e.target !== contextMenu.nodeId
      )
      setEdges(filteredEdges)
      saveEdges(filteredEdges)
    } else {
      await deleteTab(contextMenu.nodeId)
    }
    setContextMenu(null)
  }, [contextMenu, deleteTab, deleteNode, reactFlowInstance, setEdges, saveEdges])

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

  const monitorTab = monitorNodeId ? tabs.find((t) => t.id === monitorNodeId) : null
  const monitorTabMonitors = monitorTab ? parseMonitors(monitorTab) : []

  const isBrowserTabNode = contextMenu?.type === 'node' && !contextMenu.nodeId?.startsWith('gn-')
  const isGraphNode = contextMenu?.type === 'node' && contextMenu.nodeId?.startsWith('gn-')

  return (
    <div className="flex h-full flex-col" onClick={closeContextMenu}>
      {/* Canvas */}
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onReconnect={handleReconnect}
          onNodeDoubleClick={handleNodeDoubleClick}
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
            <p className="text-xs text-muted-foreground bg-background/80 px-3 py-1 rounded-full border">
              {isMapMode
                ? 'Map mode: drag to pan and scroll to zoom'
                : 'Design mode: scroll to pan · drag-select supports partial overlap'}
            </p>
          </Panel>
        </ReactFlow>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[180px] rounded-md border bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.type === 'pane' && (
            <>
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Tabs
              </div>
              <button
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={handleContextAddTab}
              >
                <Plus className="h-4 w-4" />
                Add new tab
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
                onClick={() => handleContextAddGraphNode('text', 'Text')}
              >
                <Type className="h-4 w-4" />
                Add Text
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() => handleContextAddGraphNode('file', 'File')}
              >
                <FolderOpen className="h-4 w-4" />
                Add File
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
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10"
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
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10"
                onClick={handleContextDeleteNode}
              >
                <Trash2 className="h-4 w-4" />
                Delete node
              </button>
            </>
          )}
        </div>
      )}

      {/* Monitor Dialog */}
      {monitorNodeId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setMonitorNodeId(null)}>
          <div
            className="w-[400px] rounded-lg border bg-card p-4 shadow-lg space-y-3"
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
                    <div key={m.id} className="rounded-md border overflow-hidden">
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
                        <div className="border-t bg-muted/30 px-2.5 py-2 space-y-1.5">
                          {hasRule ? (
                            <>
                              <div className="flex items-start gap-1.5">
                                <Search className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                                <div className="min-w-0 flex-1">
                                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider">CSS Selector</p>
                                  <code className="block text-[11px] font-mono text-foreground/80 break-all bg-background rounded px-1.5 py-0.5 mt-0.5 border">
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
                                  <code className="block text-[11px] font-mono text-foreground/80 break-all bg-background rounded px-1.5 py-0.5 mt-0.5 border">
                                    /{m.rule!.regex}/
                                  </code>
                                </div>
                              </div>
                              <div className="flex items-start gap-1.5">
                                <GitCompare className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                                <div className="min-w-0 flex-1">
                                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Check</p>
                                  <p className="text-[11px] text-foreground/80 mt-0.5">
                                    <span className="font-mono bg-background rounded px-1 py-0.5 border">{m.rule!.check}</span>
                                    {m.rule!.value !== undefined && (
                                      <span className="ml-1.5 font-mono bg-background rounded px-1 py-0.5 border">{m.rule!.value}</span>
                                    )}
                                  </p>
                                </div>
                              </div>
                              {m.lastExtracted !== undefined && (
                                <div className="mt-1 pt-1.5 border-t">
                                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Last extracted value</p>
                                  <code className="block text-[11px] font-mono text-foreground/80 break-all bg-background rounded px-1.5 py-0.5 mt-0.5 border max-h-[60px] overflow-auto">
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
                  triggerWebviews.current.set(tabId, el as unknown as Electron.WebviewTag)
                } else {
                  triggerWebviews.current.delete(tabId)
                }
              }}
              src="about:blank"
              partition="persist:browser-tabs"
              useragent={WEBVIEW_USER_AGENT}
              // @ts-expect-error webview attributes aren't fully typed in React
              allowpopups="true"
              style={{ width: '1024px', height: '768px' }}
            />
          ))}
        </div>
      )}

      {/* Dialog */}
      <BrowserTabDialog
        tab={selectedTab}
        open={dialogOpen}
        onOpenChange={handleDialogClose}
        onTabUpdate={updateTab}
        onRecaptureScreenshot={refresh}
      />
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
