import { useEffect, useMemo, useRef } from 'react'
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
import { Bold as BoldIcon, Italic as ItalicIcon, List as ListIcon, ListChecks, Undo2, Redo2, Circle, Loader2, CheckCircle2 } from 'lucide-react'

export type PlanTaskStatus = 'todo' | 'in_progress' | 'done'

export interface PlanTemplate {
  id: string
  name: string
  type: 'task'
  defaultStatus?: PlanTaskStatus
}

interface PlanEditorProps {
  value: string
  templates: PlanTemplate[]
  planName?: string
  onChange: (html: string) => void
  onCreateTemplate?: (name: string) => void | Promise<void>
}

const STATUS_LABELS: Record<PlanTaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done'
}

function PlanTaskNodeView(props: NodeViewProps): React.ReactElement {
  const attrs = props.node.attrs as {
    taskName?: string
    status?: PlanTaskStatus
    dueDate?: string
  }

  const status = (attrs.status as PlanTaskStatus) ?? 'todo'

  const StatusIcon = status === 'done' ? CheckCircle2 : status === 'in_progress' ? Loader2 : Circle
  const statusColor = status === 'done' ? 'text-green-500' : status === 'in_progress' ? 'text-blue-500' : 'text-muted-foreground/50'

  return (
    <NodeViewWrapper as="div" className="plan-task-node" contentEditable={false}>
      <button
        type="button"
        className="flex items-center justify-center"
        onClick={() => {
          const next: PlanTaskStatus = status === 'done' ? 'todo' : 'done'
          props.updateAttributes({ status: next })
        }}
      >
        <StatusIcon className={`h-4 w-4 shrink-0 cursor-pointer ${statusColor}`} />
      </button>
      <input
        className="plan-task-name"
        value={attrs.taskName ?? ''}
        onChange={(event) => props.updateAttributes({ taskName: event.target.value })}
        placeholder="Untitled task"
      />
      <select
        className="plan-task-status"
        value={status}
        onChange={(event) => props.updateAttributes({ status: event.target.value as PlanTaskStatus })}
      >
        {Object.entries(STATUS_LABELS).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      <input
        className="plan-task-due"
        type="date"
        value={attrs.dueDate ?? ''}
        onChange={(event) => props.updateAttributes({ dueDate: event.target.value })}
      />
    </NodeViewWrapper>
  )
}

const PlanTaskNode = Node.create({
  name: 'planTask',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addNodeView() {
    return ReactNodeViewRenderer(PlanTaskNodeView)
  },
  addAttributes() {
    return {
      taskName: {
        default: ''
      },
      status: {
        default: 'todo'
      },
      dueDate: {
        default: ''
      }
    }
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-plan-task]',
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
        'data-plan-task': 'true',
        'data-task-name': HTMLAttributes.taskName ?? '',
        'data-status': HTMLAttributes.status ?? 'todo',
        'data-due-date': HTMLAttributes.dueDate ?? ''
      })
    ]
  }
})

function createSlashTemplateExtension(getTemplates: () => PlanTemplate[]): Extension {
  return Extension.create({
    name: 'planSlashTemplates',
    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          char: '/',
          allowSpaces: true,
          items: ({ query }) => {
            const normalized = query.trim().toLowerCase()
            const templates = getTemplates()
            if (!normalized) return templates.slice(0, 8)
            return templates
              .filter((template) => template.name.toLowerCase().includes(normalized))
              .slice(0, 8)
          },
          command: ({ editor, range, props }) => {
            const template = props as PlanTemplate
            if (template.type === 'task') {
              editor
                .chain()
                .focus()
                .deleteRange(range)
                .insertContent({
                  type: 'planTask',
                  attrs: {
                    taskName: '',
                    status: template.defaultStatus ?? 'todo',
                    dueDate: ''
                  }
                })
                .run()
            }
          },
          render: () => {
            let popup: HTMLDivElement | null = null
            let items: PlanTemplate[] = []
            let selectedIndex = 0
            let command: ((item: PlanTemplate) => void) | null = null

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
                empty.className = 'plan-slash-empty'
                empty.textContent = 'No templates'
                popup.appendChild(empty)
                return
              }

              items.forEach((item, index) => {
                const button = document.createElement('button')
                button.type = 'button'
                button.className = `plan-slash-item${index === selectedIndex ? ' active' : ''}`
                button.textContent = item.name
                button.addEventListener('mousedown', (event) => {
                  event.preventDefault()
                  command?.(item)
                })
                popup?.appendChild(button)
              })
            }

            return {
              onStart: (props) => {
                items = (props.items as PlanTemplate[]) ?? []
                selectedIndex = 0
                command = props.command as (item: PlanTemplate) => void
                popup = document.createElement('div')
                popup.className = 'plan-slash-popup'
                document.body.appendChild(popup)
                updatePosition(props.clientRect)
                renderItems()
              },
              onUpdate: (props) => {
                items = (props.items as PlanTemplate[]) ?? []
                selectedIndex = 0
                command = props.command as (item: PlanTemplate) => void
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
        'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground',
        active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground/70'
      ].join(' ')}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export function PlanEditor({
  value,
  templates,
  planName,
  onChange
}: PlanEditorProps): React.ReactElement {
  const templatesRef = useRef<PlanTemplate[]>(templates)

  useEffect(() => {
    templatesRef.current = templates
  }, [templates])

  const slashExtension = useMemo(
    () => createSlashTemplateExtension(() => templatesRef.current),
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
      PlanTaskNode,
      slashExtension
    ],
    content: value || '<p></p>',
    editorProps: {
      attributes: {
        class: 'plan-editor-content'
      }
    },
    onUpdate: ({ editor: current }) => {
      onChange(current.getHTML())
    }
  })

  useEffect(() => {
    if (!editor) return
    const current = editor.getHTML()
    if (current !== value) {
      editor.commands.setContent(value || '<p></p>', false)
    }
  }, [editor, value])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-16">
        {planName && (
          <div className="mx-auto w-full max-w-[720px] px-0 pt-4 pb-1">
            <p className="text-3xl font-bold tracking-tight">{planName}</p>
          </div>
        )}
        {/* Toolbar – centered, minimal */}
        <div className="plan-toolbar">
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
              className="h-7 rounded-md border-0 bg-transparent px-2 text-xs text-muted-foreground/70 outline-none hover:text-foreground"
              title="Heading level"
              value={
                editor?.isActive('heading', { level: 1 })
                  ? 'h1'
                  : editor?.isActive('heading', { level: 2 })
                    ? 'h2'
                    : editor?.isActive('heading', { level: 3 })
                      ? 'h3'
                      : editor?.isActive('heading', { level: 4 })
                        ? 'h4'
                        : editor?.isActive('heading', { level: 5 })
                          ? 'h5'
                          : editor?.isActive('heading', { level: 6 })
                            ? 'h6'
                            : 'paragraph'
              }
              onChange={(event) => {
                const value = event.target.value
                if (!editor) return
                if (value === 'paragraph') {
                  editor.chain().focus().setParagraph().run()
                  return
                }
                const level = Number(value.slice(1))
                if (level >= 1 && level <= 6) {
                  editor.chain().focus().setHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run()
                }
              }}
            >
              <option value="paragraph">P</option>
              <option value="h1">H1</option>
              <option value="h2">H2</option>
              <option value="h3">H3</option>
              <option value="h4">H4</option>
              <option value="h5">H5</option>
              <option value="h6">H6</option>
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
        </div>

        {/* Editor content */}
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
