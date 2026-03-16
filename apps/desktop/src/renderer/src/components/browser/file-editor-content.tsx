import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
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
import { marked } from 'marked'
import TurndownService from 'turndown'
import {
  File,
  Bold as BoldIcon,
  Italic as ItalicIcon,
  List as ListIcon,
  ListChecks,
  Undo2,
  Redo2,
  Save
} from 'lucide-react'
import type { FileNodeConfig } from './file-node'

interface FileEditorContentProps {
  nodeId: string
  config: FileNodeConfig
  onUpdateConfig: (config: FileNodeConfig) => void
}

type FileFormat = 'markdown' | 'html' | 'text'

function getFileExtension(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  return dot >= 0 ? filePath.slice(dot).toLowerCase() : ''
}

function getFileName(filePath: string): string {
  const sep = filePath.lastIndexOf('/')
  const bsep = filePath.lastIndexOf('\\')
  const idx = Math.max(sep, bsep)
  return idx >= 0 ? filePath.slice(idx + 1) : filePath
}

function getFileFormat(ext: string): FileFormat {
  if (ext === '.md' || ext === '.markdown' || ext === '.mdx') return 'markdown'
  if (ext === '.html' || ext === '.htm') return 'html'
  return 'text'
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  emDelimiter: '*'
})
turndown.remove(['script', 'style', 'noscript'])

function fileContentToHtml(content: string, format: FileFormat): string {
  if (format === 'html') return content
  if (format === 'markdown') return marked.parse(content, { gfm: true, breaks: true }) as string
  // Plain text: wrap lines in paragraphs
  const lines = content.split('\n')
  return lines.map((line) => `<p>${line || '<br>'}</p>`).join('')
}

function htmlToFileContent(html: string, format: FileFormat): string {
  if (format === 'html') return html
  if (format === 'markdown') return turndown.turndown(html)
  // Plain text: strip all HTML tags, convert <br> and closing block tags to newlines
  const div = document.createElement('div')
  div.innerHTML = html
  return (div.textContent || div.innerText || '').trim()
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
        'inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        active ? 'bg-accent text-foreground' : ''
      ].join(' ')}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export function FileEditorContent({
  config,
  onUpdateConfig
}: FileEditorContentProps): React.ReactElement {
  const filePath = config?.filePath || ''
  const [originalContent, setOriginalContent] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saveFlash, setSaveFlash] = useState(false)
  const loadedPathRef = useRef<string | null>(null)
  const editorContentRef = useRef<string>('')

  const ext = useMemo(() => getFileExtension(filePath), [filePath])
  const fileName = useMemo(() => getFileName(filePath), [filePath])
  const format = useMemo(() => getFileFormat(ext), [ext])

  // Load file content on mount or path change
  useEffect(() => {
    if (!filePath) {
      setOriginalContent(null)
      setFileError(null)
      setDirty(false)
      return
    }

    let cancelled = false
    loadedPathRef.current = filePath

    window.api.graphNodes.readFile(filePath).then((result) => {
      if (cancelled) return
      if (result.error) {
        setFileError(result.error)
        setOriginalContent(null)
      } else {
        setOriginalContent(result.content)
        setFileError(null)
        setDirty(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [filePath])

  const initialHtml = useMemo(() => {
    if (originalContent === null) return '<p></p>'
    return fileContentToHtml(originalContent, format)
  }, [originalContent, format])

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
      TaskItem.configure({ nested: true })
    ],
    content: initialHtml,
    editorProps: {
      attributes: {
        class: 'file-editor-content'
      }
    },
    onUpdate: ({ editor: current }) => {
      editorContentRef.current = current.getHTML()
      setDirty(true)
    }
  })

  // Sync editor content when file loads/changes path
  useEffect(() => {
    if (!editor || originalContent === null) return
    const html = fileContentToHtml(originalContent, format)
    editor.commands.setContent(html, false)
    editorContentRef.current = html
    setDirty(false)
  }, [editor, originalContent, format])

  const handleSave = useCallback(async () => {
    if (!filePath || !editor || saving) return
    setSaving(true)
    try {
      const html = editor.getHTML()
      const content = htmlToFileContent(html, format)
      const result = await window.api.graphNodes.writeFile(filePath, content, 'overwrite')
      if (result.error) {
        setFileError(result.error)
      } else {
        setDirty(false)
        setOriginalContent(content)
        setSaveFlash(true)
        setTimeout(() => setSaveFlash(false), 1500)
        // Update the lastOperation on the node config
        onUpdateConfig({ ...config, lastOperation: 'write' })
      }
    } finally {
      setSaving(false)
    }
  }, [filePath, editor, saving, format, config, onUpdateConfig])

  // Cmd/Ctrl+S to save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        void handleSave()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave])

  if (!filePath) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        No file path configured
      </div>
    )
  }

  if (originalContent === null && !fileError) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground italic">
        Loading...
      </div>
    )
  }

  if (fileError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2">
        <p className="text-sm text-destructive">{fileError}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border/40 px-3 py-1.5">
        <File className="h-4 w-4 text-cyan-500 shrink-0" />
        <span className="text-xs font-medium truncate" title={filePath}>{fileName}</span>
        <span className="text-[10px] text-muted-foreground truncate flex-1">{filePath}</span>
        <span className="text-[10px] text-muted-foreground uppercase">{format}</span>
        {dirty && (
          <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" title="Unsaved changes" />
        )}
        {saveFlash && (
          <span className="text-[10px] text-emerald-500 font-medium">Saved</span>
        )}
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors hover:bg-muted disabled:opacity-50"
          onClick={() => void handleSave()}
          disabled={saving || !dirty}
          title="Save (⌘S)"
        >
          <Save className="h-3 w-3" />
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      {/* Toolbar */}
      {format !== 'text' && (
        <div className="flex items-center gap-0.5 border-b border-border/40 px-3 py-1">
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
            className="h-7 rounded border bg-background px-1.5 text-[11px] text-foreground"
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
      )}

      {/* Editor */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto w-full max-w-[720px]">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  )
}
