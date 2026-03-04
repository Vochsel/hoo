import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Extension, Node, mergeAttributes } from '@tiptap/core'
import { EditorContent, useEditor, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import Suggestion from '@tiptap/suggestion'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import Bold from '@tiptap/extension-bold'
import Italic from '@tiptap/extension-italic'
import Heading from '@tiptap/extension-heading'
import BulletList from '@tiptap/extension-bullet-list'
import ListItem from '@tiptap/extension-list-item'
import History from '@tiptap/extension-history'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Bold as BoldIcon, Italic as ItalicIcon, List as ListIcon, ListChecks, Undo2, Redo2, Globe, Terminal, FileText, ChevronDown, ChevronRight, AlertTriangle, Circle, Loader2, CheckCircle2 } from 'lucide-react'
import type { BrowserTab } from '@/hooks/use-browser-tabs'
import type { GraphNode } from '@/hooks/use-graph-nodes'
import { TerminalPreview } from './terminal-preview'

// ─── Types ──────────────────────────────────────────────────────────────────

interface BoardDocumentViewProps {
  boardId: string | null
  html: string
  loading: boolean
  tabs: BrowserTab[]
  terminalNodes: GraphNode[]
  outputNodes: GraphNode[]
  onChange: (html: string) => void
  onOpenTab: (tab: BrowserTab) => void
  onOpenTerminal: (nodeId: string) => void
}

interface BoardData {
  tabs: BrowserTab[]
  terminalNodes: GraphNode[]
  outputNodes: GraphNode[]
  onOpenTab: (tab: BrowserTab) => void
  onOpenTerminal: (nodeId: string) => void
}

// ─── Task Embed Node ────────────────────────────────────────────────────────

type TaskStatus = 'todo' | 'in_progress' | 'done'

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done'
}

function TaskEmbedNodeView(props: NodeViewProps): React.ReactElement {
  const attrs = props.node.attrs as {
    taskName?: string
    status?: TaskStatus
    dueDate?: string
  }

  const status = (attrs.status as TaskStatus) ?? 'todo'

  const StatusIcon = status === 'done' ? CheckCircle2 : status === 'in_progress' ? Loader2 : Circle
  const statusColor = status === 'done' ? 'text-green-500' : status === 'in_progress' ? 'text-blue-500' : 'text-muted-foreground/50'

  return (
    <NodeViewWrapper as="div" className="board-doc-task-node" contentEditable={false}>
      <button
        type="button"
        className="flex items-center justify-center"
        onClick={() => {
          const next: TaskStatus = status === 'done' ? 'todo' : 'done'
          props.updateAttributes({ status: next })
        }}
      >
        <StatusIcon className={`h-4 w-4 shrink-0 cursor-pointer ${statusColor}`} />
      </button>
      <input
        className="board-doc-task-name"
        value={attrs.taskName ?? ''}
        onChange={(event) => props.updateAttributes({ taskName: event.target.value })}
        placeholder="Untitled task"
      />
      <select
        className="board-doc-task-status"
        value={status}
        onChange={(event) => props.updateAttributes({ status: event.target.value as TaskStatus })}
      >
        {Object.entries(STATUS_LABELS).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      <input
        className="board-doc-task-due"
        type="date"
        value={attrs.dueDate ?? ''}
        onChange={(event) => props.updateAttributes({ dueDate: event.target.value })}
      />
    </NodeViewWrapper>
  )
}

const TaskEmbedNode = Node.create({
  name: 'taskEmbed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addNodeView() {
    return ReactNodeViewRenderer(TaskEmbedNodeView)
  },
  addAttributes() {
    return {
      taskName: { default: '' },
      status: { default: 'todo' },
      dueDate: { default: '' }
    }
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-task-embed]',
        getAttrs: (element) => {
          const el = element as HTMLElement
          return {
            taskName: el.getAttribute('data-task-name') ?? '',
            status: el.getAttribute('data-status') ?? 'todo',
            dueDate: el.getAttribute('data-due-date') ?? ''
          }
        }
      }
    ]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-task-embed': 'true',
        'data-task-name': HTMLAttributes.taskName ?? '',
        'data-status': HTMLAttributes.status ?? 'todo',
        'data-due-date': HTMLAttributes.dueDate ?? ''
      })
    ]
  }
})

// ─── Shared Embed Context Menu ──────────────────────────────────────────────

function EmbedContextMenu({
  x,
  y,
  onDelete,
  onClose
}: {
  x: number
  y: number
  onDelete: () => void
  onClose: () => void
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[140px] rounded-md border border-border/40 bg-popover p-1 shadow-sm animate-in fade-in-0 zoom-in-95"
      style={{ left: x, top: y }}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-accent"
        onClick={onDelete}
      >
        Remove embed
      </button>
    </div>
  )
}

// ─── Browser Embed Node View ────────────────────────────────────────────────

function BrowserEmbedNodeView(props: NodeViewProps): React.ReactElement {
  const tabId = props.node.attrs.tabId as string
  const boardData = props.editor.storage.boardData as BoardData | undefined
  const tab = boardData?.tabs.find((t) => t.id === tabId)
  const [expanded, setExpanded] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const handleDelete = useCallback(() => {
    setContextMenu(null)
    props.deleteNode()
  }, [props])

  if (!tab) {
    return (
      <NodeViewWrapper as="div" className="browser-embed-card not-found" contentEditable={false}>
        <div
          className="flex items-center gap-2 rounded-lg border border-dashed border-muted-foreground/20 bg-muted/20 px-4 py-3"
          onContextMenu={handleContextMenu}
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-muted-foreground/50" />
          <span className="text-xs text-muted-foreground">Browser tab not found</span>
        </div>
        {contextMenu && (
          <EmbedContextMenu x={contextMenu.x} y={contextMenu.y} onDelete={handleDelete} onClose={() => setContextMenu(null)} />
        )}
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper as="div" className="browser-embed-card" contentEditable={false}>
      <div
        className="rounded-lg border border-border/40 bg-card transition-colors hover:bg-accent/50"
        onContextMenu={handleContextMenu}
      >
        <button
          type="button"
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
          onClick={() => boardData?.onOpenTab(tab)}
        >
          {tab.screenshot ? (
            <button
              type="button"
              className="shrink-0 text-muted-foreground/50 hover:text-foreground"
              onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
            >
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          ) : null}
          {tab.favicon ? (
            <img src={tab.favicon} alt="" className="h-5 w-5 shrink-0 rounded-sm" />
          ) : (
            <Globe className="h-5 w-5 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{tab.title || 'Untitled'}</p>
            <p className="truncate text-xs text-muted-foreground">{tab.url || 'about:blank'}</p>
          </div>
          {tab.screenshot && !expanded && (
            <img
              src={tab.screenshot}
              alt=""
              className="h-10 w-16 shrink-0 rounded border border-border/40 object-cover object-top"
            />
          )}
        </button>
        {expanded && tab.screenshot && (
          <div className="border-t border-border/40 px-4 py-3">
            <img
              src={tab.screenshot}
              alt=""
              className="w-full rounded border border-border/40 object-contain"
            />
          </div>
        )}
      </div>
      {contextMenu && (
        <EmbedContextMenu x={contextMenu.x} y={contextMenu.y} onDelete={handleDelete} onClose={() => setContextMenu(null)} />
      )}
    </NodeViewWrapper>
  )
}

const BrowserEmbedNode = Node.create({
  name: 'browserEmbed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addNodeView() {
    return ReactNodeViewRenderer(BrowserEmbedNodeView)
  },
  addAttributes() {
    return {
      tabId: { default: '' }
    }
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-browser-embed]',
        getAttrs: (element) => {
          const el = element as HTMLElement
          return { tabId: el.getAttribute('data-tab-id') ?? '' }
        }
      }
    ]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-browser-embed': 'true',
        'data-tab-id': HTMLAttributes.tabId ?? ''
      })
    ]
  }
})

// ─── Terminal Embed Node View ───────────────────────────────────────────────

function TerminalEmbedNodeView(props: NodeViewProps): React.ReactElement {
  const nodeId = props.node.attrs.nodeId as string
  const boardData = props.editor.storage.boardData as BoardData | undefined
  const node = boardData?.terminalNodes.find((n) => n.id === nodeId)
  const [expanded, setExpanded] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const handleDelete = useCallback(() => {
    setContextMenu(null)
    props.deleteNode()
  }, [props])

  if (!node) {
    return (
      <NodeViewWrapper as="div" className="terminal-embed-card not-found" contentEditable={false}>
        <div
          className="flex items-center gap-2 rounded-lg border border-dashed border-muted-foreground/20 bg-muted/20 px-4 py-3"
          onContextMenu={handleContextMenu}
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-muted-foreground/50" />
          <span className="text-xs text-muted-foreground">Terminal not found</span>
        </div>
        {contextMenu && (
          <EmbedContextMenu x={contextMenu.x} y={contextMenu.y} onDelete={handleDelete} onClose={() => setContextMenu(null)} />
        )}
      </NodeViewWrapper>
    )
  }

  let config: Record<string, unknown> = {}
  try {
    config = JSON.parse(node.config) as Record<string, unknown>
  } catch {}

  return (
    <NodeViewWrapper as="div" className="terminal-embed-card" contentEditable={false}>
      <div
        className="rounded-lg border border-border/40 bg-card transition-colors hover:bg-accent/50"
        onContextMenu={handleContextMenu}
      >
        <button
          type="button"
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
          onClick={() => boardData?.onOpenTerminal(node.id)}
        >
          <button
            type="button"
            className="shrink-0 text-muted-foreground/50 hover:text-foreground"
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          <Terminal className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{node.label || 'Terminal'}</p>
            {config.command && (
              <p className="truncate text-xs text-muted-foreground font-mono">$ {String(config.command)}</p>
            )}
          </div>
        </button>
        {expanded && (
          <div className="border-t border-border/40">
            <TerminalPreview
              sessionId={`pty-${nodeId}`}
              className="w-full h-[200px]"
              fontSize={11}
              onClick={() => boardData?.onOpenTerminal(node.id)}
            />
          </div>
        )}
      </div>
      {contextMenu && (
        <EmbedContextMenu x={contextMenu.x} y={contextMenu.y} onDelete={handleDelete} onClose={() => setContextMenu(null)} />
      )}
    </NodeViewWrapper>
  )
}

const TerminalEmbedNode = Node.create({
  name: 'terminalEmbed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addNodeView() {
    return ReactNodeViewRenderer(TerminalEmbedNodeView)
  },
  addAttributes() {
    return {
      nodeId: { default: '' }
    }
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-terminal-embed]',
        getAttrs: (element) => {
          const el = element as HTMLElement
          return { nodeId: el.getAttribute('data-node-id') ?? '' }
        }
      }
    ]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-terminal-embed': 'true',
        'data-node-id': HTMLAttributes.nodeId ?? ''
      })
    ]
  }
})

// ─── Output Embed Node View ─────────────────────────────────────────────────

function OutputEmbedNodeView(props: NodeViewProps): React.ReactElement {
  const nodeId = props.node.attrs.nodeId as string
  const boardData = props.editor.storage.boardData as BoardData | undefined
  const node = boardData?.outputNodes.find((n) => n.id === nodeId)
  const [expanded, setExpanded] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const handleDelete = useCallback(() => {
    setContextMenu(null)
    props.deleteNode()
  }, [props])

  if (!node) {
    return (
      <NodeViewWrapper as="div" className="output-embed-card not-found" contentEditable={false}>
        <div
          className="flex items-center gap-2 rounded-lg border border-dashed border-muted-foreground/20 bg-muted/20 px-4 py-3"
          onContextMenu={handleContextMenu}
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-muted-foreground/50" />
          <span className="text-xs text-muted-foreground">Output node not found</span>
        </div>
        {contextMenu && (
          <EmbedContextMenu x={contextMenu.x} y={contextMenu.y} onDelete={handleDelete} onClose={() => setContextMenu(null)} />
        )}
      </NodeViewWrapper>
    )
  }

  let config: Record<string, unknown> = {}
  try {
    config = JSON.parse(node.config) as Record<string, unknown>
  } catch {}
  const markdown = typeof config.markdown === 'string' ? config.markdown : ''

  return (
    <NodeViewWrapper as="div" className="output-embed-card" contentEditable={false}>
      <div
        className="rounded-lg border border-border/40 bg-card transition-colors hover:bg-accent/50"
        onContextMenu={handleContextMenu}
      >
        <button
          type="button"
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
        >
          {markdown ? (
            <span className="shrink-0 text-muted-foreground/50">
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </span>
          ) : null}
          <FileText className="h-5 w-5 shrink-0 text-emerald-500" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{node.label || 'Output'}</p>
            {markdown && !expanded && (
              <p className="truncate text-xs text-muted-foreground">{markdown.slice(0, 100)}</p>
            )}
          </div>
        </button>
        {expanded && markdown && (
          <div className="border-t border-border/40 px-4 py-3">
            <pre className="overflow-auto rounded bg-muted/70 p-2 text-[11px] leading-relaxed text-foreground whitespace-pre-wrap max-h-[400px]">
              {markdown}
            </pre>
          </div>
        )}
      </div>
      {contextMenu && (
        <EmbedContextMenu x={contextMenu.x} y={contextMenu.y} onDelete={handleDelete} onClose={() => setContextMenu(null)} />
      )}
    </NodeViewWrapper>
  )
}

const OutputEmbedNode = Node.create({
  name: 'outputEmbed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addNodeView() {
    return ReactNodeViewRenderer(OutputEmbedNodeView)
  },
  addAttributes() {
    return {
      nodeId: { default: '' }
    }
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-output-embed]',
        getAttrs: (element) => {
          const el = element as HTMLElement
          return { nodeId: el.getAttribute('data-node-id') ?? '' }
        }
      }
    ]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-output-embed': 'true',
        'data-node-id': HTMLAttributes.nodeId ?? ''
      })
    ]
  }
})

// ─── Board Data Extension (stores live data for NodeViews) ──────────────────

const BoardDataExtension = Extension.create({
  name: 'boardData',
  addStorage() {
    return {
      tabs: [] as BrowserTab[],
      terminalNodes: [] as GraphNode[],
      outputNodes: [] as GraphNode[],
      onOpenTab: (() => {}) as (tab: BrowserTab) => void,
      onOpenTerminal: (() => {}) as (nodeId: string) => void
    }
  }
})

// ─── Slash Commands ─────────────────────────────────────────────────────────

interface SlashItem {
  id: string
  label: string
  kind: 'browser' | 'terminal' | 'output' | 'task'
  tabId?: string
  nodeId?: string
}

function createBoardSlashExtension(getData: () => BoardData): Extension {
  return Extension.create({
    name: 'boardSlashCommands',
    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          char: '/',
          allowSpaces: true,
          items: ({ query }) => {
            const normalized = query.trim().toLowerCase()
            const data = getData()
            const items: SlashItem[] = []
            for (const tab of data.tabs) {
              items.push({
                id: `browser-${tab.id}`,
                label: tab.title || tab.url || 'Browser Tab',
                kind: 'browser',
                tabId: tab.id
              })
            }
            for (const node of data.terminalNodes) {
              items.push({
                id: `terminal-${node.id}`,
                label: node.label || 'Terminal',
                kind: 'terminal',
                nodeId: node.id
              })
            }
            for (const node of data.outputNodes) {
              items.push({
                id: `output-${node.id}`,
                label: node.label || 'Output',
                kind: 'output',
                nodeId: node.id
              })
            }
            items.push({ id: 'task-new', label: 'Task', kind: 'task' })
            if (!normalized) return items.slice(0, 10)
            return items
              .filter((item) => item.label.toLowerCase().includes(normalized) || item.kind.includes(normalized))
              .slice(0, 10)
          },
          command: ({ editor, range, props }) => {
            const item = props as SlashItem
            if (item.kind === 'browser' && item.tabId) {
              editor
                .chain()
                .focus()
                .deleteRange(range)
                .insertContent({
                  type: 'browserEmbed',
                  attrs: { tabId: item.tabId }
                })
                .run()
            } else if (item.kind === 'terminal' && item.nodeId) {
              editor
                .chain()
                .focus()
                .deleteRange(range)
                .insertContent({
                  type: 'terminalEmbed',
                  attrs: { nodeId: item.nodeId }
                })
                .run()
            } else if (item.kind === 'output' && item.nodeId) {
              editor
                .chain()
                .focus()
                .deleteRange(range)
                .insertContent({
                  type: 'outputEmbed',
                  attrs: { nodeId: item.nodeId }
                })
                .run()
            } else if (item.kind === 'task') {
              editor
                .chain()
                .focus()
                .deleteRange(range)
                .insertContent({
                  type: 'taskEmbed',
                  attrs: { taskName: '', status: 'todo', dueDate: '' }
                })
                .run()
            }
          },
          render: () => {
            let popup: HTMLDivElement | null = null
            let items: SlashItem[] = []
            let selectedIndex = 0
            let command: ((item: SlashItem) => void) | null = null

            const cleanup = (): void => {
              if (!popup) return
              popup.remove()
              popup = null
            }

            const updatePosition = (clientRect: (() => DOMRect | null) | null | undefined): void => {
              if (!popup || !clientRect) return
              const rect = clientRect()
              if (!rect) return
              popup.style.left = `${rect.left}px`
              popup.style.top = `${rect.bottom + 8}px`
            }

            const renderItems = (): void => {
              if (!popup) return
              popup.innerHTML = ''
              if (items.length === 0) {
                const empty = document.createElement('div')
                empty.className = 'board-doc-slash-empty'
                empty.textContent = 'No items available'
                popup.appendChild(empty)
                return
              }

              items.forEach((item, index) => {
                const button = document.createElement('button')
                button.type = 'button'
                button.className = `board-doc-slash-item${index === selectedIndex ? ' active' : ''}`
                const icon = item.kind === 'task' ? '\u{2611}\u{FE0F} ' : item.kind === 'browser' ? '\u{1F310} ' : item.kind === 'output' ? '\u{1F4C4} ' : '\u{1F5A5} '
                button.textContent = `${icon}${item.label}`
                button.addEventListener('mousedown', (event) => {
                  event.preventDefault()
                  command?.(item)
                })
                popup?.appendChild(button)
              })
            }

            return {
              onStart: (props) => {
                items = (props.items as SlashItem[]) ?? []
                selectedIndex = 0
                command = props.command as (item: SlashItem) => void
                popup = document.createElement('div')
                popup.className = 'board-doc-slash-popup'
                document.body.appendChild(popup)
                updatePosition(props.clientRect)
                renderItems()
              },
              onUpdate: (props) => {
                items = (props.items as SlashItem[]) ?? []
                selectedIndex = 0
                command = props.command as (item: SlashItem) => void
                updatePosition(props.clientRect)
                renderItems()
              },
              onKeyDown: (props) => {
                if (props.event.key === 'Escape') {
                  cleanup()
                  return true
                }
                if (props.event.key === 'ArrowDown') {
                  selectedIndex = (selectedIndex + 1) % Math.max(items.length, 1)
                  renderItems()
                  return true
                }
                if (props.event.key === 'ArrowUp') {
                  selectedIndex = (selectedIndex + items.length - 1) % Math.max(items.length, 1)
                  renderItems()
                  return true
                }
                if (props.event.key === 'Enter') {
                  const item = items[selectedIndex]
                  if (item) {
                    command?.(item)
                    return true
                  }
                }
                return false
              },
              onExit: () => {
                cleanup()
              }
            }
          }
        })
      ]
    }
  })
}

// ─── Toolbar Button ─────────────────────────────────────────────────────────

function ToolbarButton({
  active,
  onClick,
  title,
  children
}: {
  active?: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <button
      type="button"
      title={title}
      className={[
        'inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        active ? 'bg-accent text-foreground' : ''
      ].join(' ')}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

// ─── Board Document View ────────────────────────────────────────────────────

export function BoardDocumentView({
  boardId,
  html,
  loading,
  tabs,
  terminalNodes,
  outputNodes,
  onChange,
  onOpenTab,
  onOpenTerminal
}: BoardDocumentViewProps): React.ReactElement {
  const boardDataRef = useRef<BoardData>({ tabs, terminalNodes, outputNodes, onOpenTab, onOpenTerminal })

  useEffect(() => {
    boardDataRef.current = { tabs, terminalNodes, outputNodes, onOpenTab, onOpenTerminal }
  }, [tabs, terminalNodes, outputNodes, onOpenTab, onOpenTerminal])

  const slashExtension = useMemo(
    () => createBoardSlashExtension(() => boardDataRef.current),
    []
  )

  const editor = useEditor({
    extensions: [
      Document,
      Paragraph,
      Text,
      Bold,
      Italic,
      Heading.configure({ levels: [1, 2, 3, 4, 5, 6] }),
      BulletList,
      ListItem,
      History,
      TaskList,
      TaskItem.configure({ nested: true }),
      BrowserEmbedNode,
      TerminalEmbedNode,
      OutputEmbedNode,
      TaskEmbedNode,
      BoardDataExtension,
      slashExtension
    ],
    content: html || '<p></p>',
    editorProps: {
      attributes: {
        class: 'board-doc-editor-content'
      }
    },
    onUpdate: ({ editor: current }) => {
      onChange(current.getHTML())
    }
  })

  // Keep boardData storage in sync
  useEffect(() => {
    if (!editor) return
    editor.storage.boardData = { tabs, terminalNodes, outputNodes, onOpenTab, onOpenTerminal }
  }, [editor, tabs, terminalNodes, outputNodes, onOpenTab, onOpenTerminal])

  // Sync content when html prop changes externally
  useEffect(() => {
    if (!editor) return
    const current = editor.getHTML()
    if (current !== html) {
      editor.commands.setContent(html || '<p></p>', false)
    }
  }, [editor, html])

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading document...
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 bg-card">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-16">
        <div className="mx-auto w-full max-w-[720px]">
          {/* Toolbar */}
          <div className="board-doc-toolbar mb-4">
            <div className="flex items-center gap-0.5">
              <ToolbarButton
                title="Bold"
                active={editor?.isActive('bold')}
                onClick={() => editor?.chain().focus().toggleBold().run()}
              >
                <BoldIcon className="h-3.5 w-3.5" />
              </ToolbarButton>
              <ToolbarButton
                title="Italic"
                active={editor?.isActive('italic')}
                onClick={() => editor?.chain().focus().toggleItalic().run()}
              >
                <ItalicIcon className="h-3.5 w-3.5" />
              </ToolbarButton>
              <select
                className="h-8 rounded border bg-background px-2 text-xs text-foreground"
                title="Heading level"
                value={
                  editor?.isActive('heading', { level: 1 })
                    ? 'h1'
                    : editor?.isActive('heading', { level: 2 })
                      ? 'h2'
                      : editor?.isActive('heading', { level: 3 })
                        ? 'h3'
                        : 'paragraph'
                }
                onChange={(event) => {
                  const val = event.target.value
                  if (!editor) return
                  if (val === 'paragraph') {
                    editor.chain().focus().setParagraph().run()
                    return
                  }
                  const level = Number(val.slice(1))
                  if (level >= 1 && level <= 3) {
                    editor.chain().focus().setHeading({ level: level as 1 | 2 | 3 }).run()
                  }
                }}
              >
                <option value="paragraph">P</option>
                <option value="h1">H1</option>
                <option value="h2">H2</option>
                <option value="h3">H3</option>
              </select>
              <ToolbarButton
                title="Bullet List"
                active={editor?.isActive('bulletList')}
                onClick={() => editor?.chain().focus().toggleBulletList().run()}
              >
                <ListIcon className="h-3.5 w-3.5" />
              </ToolbarButton>
              <ToolbarButton
                title="Task List"
                active={editor?.isActive('taskList')}
                onClick={() => editor?.chain().focus().toggleTaskList().run()}
              >
                <ListChecks className="h-3.5 w-3.5" />
              </ToolbarButton>
              <div className="mx-1 h-4 w-px bg-border" />
              <ToolbarButton title="Undo" onClick={() => editor?.chain().focus().undo().run()}>
                <Undo2 className="h-3.5 w-3.5" />
              </ToolbarButton>
              <ToolbarButton title="Redo" onClick={() => editor?.chain().focus().redo().run()}>
                <Redo2 className="h-3.5 w-3.5" />
              </ToolbarButton>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Type <kbd className="rounded border px-1 py-0.5 text-[10px]">/</kbd> to embed a browser tab, terminal, or output
            </p>
          </div>

          {/* Editor content */}
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  )
}
