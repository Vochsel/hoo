import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Code,
  ExternalLink,
  File,
  Folder,
  FolderOpen,
  Loader2,
  RefreshCw
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface BoardFilesystemEntry {
  name: string
  relativePath: string
  absolutePath: string
  kind: 'file' | 'directory'
  extension: string | null
  size: number | null
}

interface BoardDirectoryListing {
  rootDir: string
  relativePath: string
  entries: BoardFilesystemEntry[]
}

interface BoardFilePreview {
  rootDir: string
  relativePath: string
  absolutePath: string
  size: number
  extension: string | null
  isBinary: boolean
  truncated: boolean
  content: string | null
}

interface BoardFilesystemViewProps {
  boardId: string | null
  boardRootDir?: string | null
  boardRootDirLoaded?: boolean
  workspaceRootDir?: string
  onBoardRootDirChange?: (rootDir: string | null) => void | Promise<void>
}

type PreviewMode = 'text' | 'pdf' | 'image' | 'audio' | 'video'
type SyntaxLanguage = 'js' | 'json' | 'html' | 'css' | 'shell' | 'python' | 'sql' | 'yaml' | 'markdown' | 'text'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif'])
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.m4v', '.avi'])
const PDF_EXTENSIONS = new Set(['.pdf'])

const JS_KEYWORDS = new Set([
  'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'finally', 'for', 'from', 'function', 'if',
  'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new', 'of', 'private', 'protected',
  'public', 'return', 'static', 'super', 'switch', 'this', 'throw', 'try', 'type', 'typeof', 'var',
  'void', 'while', 'with', 'yield'
])
const PYTHON_KEYWORDS = new Set([
  'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else',
  'except', 'False', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'None',
  'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'True', 'try', 'while', 'with', 'yield'
])
const SHELL_KEYWORDS = new Set([
  'case', 'do', 'done', 'elif', 'else', 'esac', 'export', 'fi', 'for', 'function', 'if', 'in', 'local',
  'select', 'source', 'then', 'until', 'while'
])
const SQL_KEYWORDS = new Set([
  'add', 'all', 'alter', 'and', 'as', 'asc', 'between', 'by', 'case', 'check', 'column', 'constraint',
  'create', 'database', 'default', 'delete', 'desc', 'distinct', 'drop', 'else', 'end', 'exists', 'from',
  'group', 'having', 'in', 'index', 'inner', 'insert', 'into', 'is', 'join', 'key', 'left', 'like', 'limit',
  'not', 'null', 'on', 'or', 'order', 'outer', 'primary', 'references', 'right', 'select', 'set', 'table',
  'then', 'union', 'unique', 'update', 'values', 'view', 'when', 'where'
])

const TOKEN_STYLES: Record<string, string> = {
  plain: '',
  comment: 'color:#64748b;font-style:italic;',
  keyword: 'color:#f472b6;',
  string: 'color:#86efac;',
  number: 'color:#fb923c;',
  boolean: 'color:#38bdf8;',
  property: 'color:#67e8f9;',
  variable: 'color:#c084fc;',
  operator: 'color:#f8fafc;',
  punctuation: 'color:#94a3b8;',
  tag: 'color:#fda4af;',
  attribute: 'color:#fcd34d;',
  heading: 'color:#f8fafc;font-weight:700;',
  builtin: 'color:#60a5fa;',
  selector: 'color:#f9a8d4;'
}

function formatBytes(size: number | null | undefined): string {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return '-'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatRelativePath(relativePath: string): string {
  return relativePath || '.'
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function wrapToken(value: string, token: keyof typeof TOKEN_STYLES): string {
  const style = TOKEN_STYLES[token]
  const escaped = escapeHtml(value)
  return style ? `<span style="${style}">${escaped}</span>` : escaped
}

function detectPreviewMode(extension: string | null | undefined): PreviewMode {
  const normalized = (extension ?? '').toLowerCase()
  if (PDF_EXTENSIONS.has(normalized)) return 'pdf'
  if (IMAGE_EXTENSIONS.has(normalized)) return 'image'
  if (AUDIO_EXTENSIONS.has(normalized)) return 'audio'
  if (VIDEO_EXTENSIONS.has(normalized)) return 'video'
  return 'text'
}

function detectSyntaxLanguage(extension: string | null | undefined): SyntaxLanguage {
  const normalized = (extension ?? '').toLowerCase()
  if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(normalized)) return 'js'
  if (['.json', '.jsonc'].includes(normalized)) return 'json'
  if (['.html', '.htm', '.xml', '.svg'].includes(normalized)) return 'html'
  if (['.css', '.scss', '.sass', '.less'].includes(normalized)) return 'css'
  if (['.sh', '.bash', '.zsh', '.fish', '.env'].includes(normalized)) return 'shell'
  if (['.py'].includes(normalized)) return 'python'
  if (['.sql'].includes(normalized)) return 'sql'
  if (['.yaml', '.yml', '.toml'].includes(normalized)) return 'yaml'
  if (['.md', '.mdx'].includes(normalized)) return 'markdown'
  return 'text'
}

function toFileUrl(filePath: string): string {
  let normalized = filePath.replace(/\\/g, '/')
  if (!normalized.startsWith('/')) normalized = `/${normalized}`
  return encodeURI(`file://${normalized}`)
}

function tokenizeWithPattern(
  content: string,
  pattern: RegExp,
  classify: (match: string, index: number, source: string) => keyof typeof TOKEN_STYLES
): string {
  let html = ''
  let lastIndex = 0

  for (const match of content.matchAll(pattern)) {
    const value = match[0]
    const index = match.index ?? 0
    html += escapeHtml(content.slice(lastIndex, index))
    html += wrapToken(value, classify(value, index, content))
    lastIndex = index + value.length
  }

  html += escapeHtml(content.slice(lastIndex))
  return html
}

function highlightMarkupTag(tag: string): string {
  const attributePattern = /([A-Za-z_:][-A-Za-z0-9_:.]*)(\s*=\s*)("[^"]*"|'[^']*')/g
  const openTag = tag.match(/^<\/?\s*([A-Za-z0-9:_-]+)/)
  let html = escapeHtml(tag)

  if (openTag) {
    html = html.replace(
      escapeHtml(openTag[1]),
      wrapToken(openTag[1], 'tag')
    )
  }

  html = html
    .replace(/&lt;\/?/g, (match) => wrapToken(match, 'punctuation'))
    .replace(/\/?&gt;/g, (match) => wrapToken(match, 'punctuation'))

  for (const match of tag.matchAll(attributePattern)) {
    const [full, attributeName, equalsToken, stringValue] = match
    html = html.replace(
      escapeHtml(full),
      `${wrapToken(attributeName, 'attribute')}${wrapToken(equalsToken, 'operator')}${wrapToken(stringValue, 'string')}`
    )
  }

  return html
}

function highlightCode(content: string, language: SyntaxLanguage): string {
  if (language === 'html') {
    return tokenizeWithPattern(
      content,
      /<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>/g,
      (match) => match.startsWith('<!--') ? 'comment' : 'tag'
    ).replace(
      /<span style="color:#fda4af;">(&lt;\/?[A-Za-z][\s\S]*?&gt;)<\/span>/g,
      (_full, escapedTag: string) => highlightMarkupTag(
        escapedTag
          .replaceAll('&lt;', '<')
          .replaceAll('&gt;', '>')
          .replaceAll('&amp;', '&')
      )
    )
  }

  if (language === 'json') {
    return tokenizeWithPattern(
      content,
      /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
      (match, index, source) => {
        if (match.startsWith('"')) {
          const nextNonWhitespace = source.slice(index + match.length).match(/^\s*:/)
          return nextNonWhitespace ? 'property' : 'string'
        }
        if (match === 'true' || match === 'false' || match === 'null') return 'boolean'
        return 'number'
      }
    )
  }

  if (language === 'css') {
    return tokenizeWithPattern(
      content,
      /\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[0-9a-fA-F]{3,8}\b|\b[\w-]+(?=\s*:)|[^\r\n{}]+(?=\s*\{)|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:px|rem|em|vh|vw|%)?/gm,
      (match, index, source) => {
        const trimmed = match.trim()
        if (trimmed.startsWith('/*')) return 'comment'
        if (trimmed.startsWith('"') || trimmed.startsWith('\'')) return 'string'
        if (trimmed.startsWith('#')) return 'number'
        const nextNonWhitespace = source.slice(index + match.length).match(/^\s*:/)
        if (nextNonWhitespace) return 'property'
        if (!/^[-\d.]/.test(trimmed)) return 'selector'
        if (/^[\w-]+$/.test(trimmed)) return 'property'
        return 'number'
      }
    )
  }

  if (language === 'shell') {
    return tokenizeWithPattern(
      content,
      /#.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\$[{(]?[A-Za-z_][A-Za-z0-9_]*[})]?|\b(?:case|do|done|elif|else|esac|export|fi|for|function|if|in|local|select|source|then|until|while)\b|-?(?:0|[1-9]\d*)(?:\.\d+)?/gm,
      (match) => {
        if (match.startsWith('#')) return 'comment'
        if (match.startsWith('"') || match.startsWith('\'')) return 'string'
        if (match.startsWith('$')) return 'variable'
        if (SHELL_KEYWORDS.has(match)) return 'keyword'
        return 'number'
      }
    )
  }

  if (language === 'python') {
    return tokenizeWithPattern(
      content,
      /#.*$|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|@[A-Za-z_][A-Za-z0-9_]*|\b(?:and|as|assert|async|await|break|class|continue|def|del|elif|else|except|False|finally|for|from|global|if|import|in|is|lambda|None|nonlocal|not|or|pass|raise|return|True|try|while|with|yield)\b|-?(?:0|[1-9]\d*)(?:\.\d+)?/gm,
      (match) => {
        if (match.startsWith('#')) return 'comment'
        if (match.startsWith('"') || match.startsWith('\'')) return 'string'
        if (match.startsWith('@')) return 'builtin'
        if (PYTHON_KEYWORDS.has(match)) return 'keyword'
        return 'number'
      }
    )
  }

  if (language === 'sql') {
    return tokenizeWithPattern(
      content,
      /--.*$|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:add|all|alter|and|as|asc|between|by|case|check|column|constraint|create|database|default|delete|desc|distinct|drop|else|end|exists|from|group|having|in|index|inner|insert|into|is|join|key|left|like|limit|not|null|on|or|order|outer|primary|references|right|select|set|table|then|union|unique|update|values|view|when|where)\b|-?(?:0|[1-9]\d*)(?:\.\d+)?/gim,
      (match) => {
        const lowered = match.toLowerCase()
        if (match.startsWith('--') || match.startsWith('/*')) return 'comment'
        if (match.startsWith('"') || match.startsWith('\'')) return 'string'
        if (SQL_KEYWORDS.has(lowered)) return 'keyword'
        return 'number'
      }
    )
  }

  if (language === 'yaml') {
    return tokenizeWithPattern(
      content,
      /#.*$|^[ \t-]*[A-Za-z0-9_.-]+(?=\s*:)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:true|false|null|yes|no|on|off)\b|-?(?:0|[1-9]\d*)(?:\.\d+)?/gm,
      (match) => {
        const trimmed = match.trim()
        if (trimmed.startsWith('#')) return 'comment'
        if (trimmed.startsWith('"') || trimmed.startsWith('\'')) return 'string'
        if (/^[A-Za-z0-9_.-]+$/.test(trimmed)) return 'property'
        if (['true', 'false', 'null', 'yes', 'no', 'on', 'off'].includes(trimmed.toLowerCase())) return 'boolean'
        return 'number'
      }
    )
  }

  if (language === 'markdown') {
    return tokenizeWithPattern(
      content,
      /^#{1,6}\s.*$|^\s*[-*+]\s.*$|^\s*\d+\.\s.*$|`[^`]+`|```[\s\S]*?```/gm,
      (match) => {
        if (match.startsWith('```') || match.startsWith('`')) return 'string'
        if (match.trim().startsWith('#')) return 'heading'
        return 'property'
      }
    )
  }

  if (language === 'js') {
    return tokenizeWithPattern(
      content,
      /\/\*[\s\S]*?\*\/|\/\/.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|@[A-Za-z_][A-Za-z0-9_]*|\b(?:as|async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|finally|for|from|function|if|implements|import|in|instanceof|interface|let|new|of|private|protected|public|return|static|super|switch|this|throw|try|type|typeof|var|void|while|with|yield)\b|\b(?:true|false|null|undefined)\b|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/gm,
      (match) => {
        if (match.startsWith('/*') || match.startsWith('//')) return 'comment'
        if (match.startsWith('"') || match.startsWith('\'') || match.startsWith('`')) return 'string'
        if (match.startsWith('@')) return 'builtin'
        if (JS_KEYWORDS.has(match)) return 'keyword'
        if (['true', 'false', 'null', 'undefined'].includes(match)) return 'boolean'
        return 'number'
      }
    )
  }

  return escapeHtml(content)
}

export function BoardFilesystemView({
  boardId,
  boardRootDir,
  boardRootDirLoaded = true,
  workspaceRootDir,
  onBoardRootDirChange
}: BoardFilesystemViewProps): React.ReactElement {
  const [directoryEntriesByPath, setDirectoryEntriesByPath] = useState<Record<string, BoardFilesystemEntry[]>>({})
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set(['']))
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set())
  const [treeError, setTreeError] = useState<string | null>(null)
  const [resolvedRootDir, setResolvedRootDir] = useState<string | null>(null)
  const [selectedEntry, setSelectedEntry] = useState<BoardFilesystemEntry | null>(null)
  const [preview, setPreview] = useState<BoardFilePreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: BoardFilesystemEntry } | null>(null)
  const [savingBoardRootDir, setSavingBoardRootDir] = useState(false)

  const previewMode = useMemo(
    () => detectPreviewMode(selectedEntry?.extension),
    [selectedEntry?.extension]
  )
  const previewFileUrl = useMemo(
    () => (selectedEntry?.kind === 'file' ? toFileUrl(selectedEntry.absolutePath) : null),
    [selectedEntry]
  )
  const highlightedPreviewHtml = useMemo(() => {
    if (!preview?.content || previewMode !== 'text') return null
    return highlightCode(preview.content, detectSyntaxLanguage(preview.extension))
  }, [preview, previewMode])

  const loadDirectory = useCallback(async (relativePath = ''): Promise<void> => {
    if (!boardId || !boardRootDir) return

    setLoadingPaths((prev) => new Set(prev).add(relativePath))
    try {
      const result = await window.api.workspace.listBoardDirectory(boardId, relativePath) as BoardDirectoryListing
      setResolvedRootDir(result.rootDir)
      setTreeError(null)
      setDirectoryEntriesByPath((prev) => ({
        ...prev,
        [result.relativePath]: result.entries
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setTreeError(message)
    } finally {
      setLoadingPaths((prev) => {
        const next = new Set(prev)
        next.delete(relativePath)
        return next
      })
    }
  }, [boardId, boardRootDir])

  useEffect(() => {
    setDirectoryEntriesByPath({})
    setExpandedPaths(new Set(['']))
    setTreeError(null)
    setResolvedRootDir(boardRootDir?.trim() || null)
    setSelectedEntry(null)
    setPreview(null)
    setPreviewError(null)
    setPreviewLoading(false)
    setContextMenu(null)
  }, [boardId, boardRootDir])

  useEffect(() => {
    if (!boardId || !boardRootDirLoaded || !boardRootDir) return
    void loadDirectory('')
  }, [boardId, boardRootDir, boardRootDirLoaded, loadDirectory])

  useEffect(() => {
    if (!contextMenu) return

    const handleDismiss = (): void => setContextMenu(null)
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setContextMenu(null)
    }

    document.addEventListener('mousedown', handleDismiss)
    document.addEventListener('scroll', handleDismiss, true)
    window.addEventListener('resize', handleDismiss)
    window.addEventListener('keydown', handleKeyDown)
    return (): void => {
      document.removeEventListener('mousedown', handleDismiss)
      document.removeEventListener('scroll', handleDismiss, true)
      window.removeEventListener('resize', handleDismiss)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenu])

  useEffect(() => {
    if (!boardId || !selectedEntry || selectedEntry.kind !== 'file') {
      setPreview(null)
      setPreviewError(null)
      setPreviewLoading(false)
      return
    }

    if (previewMode !== 'text') {
      setPreview(null)
      setPreviewError(null)
      setPreviewLoading(false)
      return
    }

    let cancelled = false
    setPreviewLoading(true)
    setPreviewError(null)

    void window.api.workspace.readBoardFilePreview(boardId, selectedEntry.relativePath)
      .then((result) => {
        if (cancelled) return
        setPreview(result as BoardFilePreview)
        setResolvedRootDir((result as BoardFilePreview).rootDir)
      })
      .catch((error) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : String(error)
        setPreview(null)
        setPreviewError(message)
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false)
      })

    return (): void => {
      cancelled = true
    }
  }, [boardId, previewMode, selectedEntry])

  const handleSelectEntry = useCallback((entry: BoardFilesystemEntry): void => {
    setSelectedEntry(entry)
    if (entry.kind !== 'directory') return

    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(entry.relativePath)) {
        next.delete(entry.relativePath)
      } else {
        next.add(entry.relativePath)
      }
      return next
    })

    if (!directoryEntriesByPath[entry.relativePath]) {
      void loadDirectory(entry.relativePath)
    }
  }, [directoryEntriesByPath, loadDirectory])

  const handleRefresh = useCallback((): void => {
    if (!boardRootDir) return
    setDirectoryEntriesByPath({})
    setPreview(null)
    setPreviewError(null)
    void loadDirectory('')
    if (selectedEntry?.kind === 'directory') {
      void loadDirectory(selectedEntry.relativePath)
    } else if (selectedEntry?.kind === 'file') {
      setSelectedEntry({ ...selectedEntry })
    }
  }, [boardRootDir, loadDirectory, selectedEntry])

  const handlePickBoardRootDir = useCallback(async (): Promise<void> => {
    if (!boardId) return
    setSavingBoardRootDir(true)
    try {
      const picked = await window.api.workspace.pickBoardRootDir(boardRootDir || workspaceRootDir || undefined)
      if (!picked || typeof picked !== 'string') return
      await window.api.workspace.setBoardRootDir(boardId, picked)
      await onBoardRootDirChange?.(picked)
    } finally {
      setSavingBoardRootDir(false)
    }
  }, [boardId, boardRootDir, onBoardRootDirChange, workspaceRootDir])

  const openEntryInEditor = useCallback(async (entry: BoardFilesystemEntry, editor: 'cursor' | 'vscode' | 'zed') => {
    await window.api.workspace.openInEditor(entry.absolutePath, editor)
    setContextMenu(null)
  }, [])

  const renderDirectory = useCallback((relativePath: string, depth: number): React.ReactNode => {
    const entries = directoryEntriesByPath[relativePath] ?? []
    const isLoading = loadingPaths.has(relativePath)

    if (!isLoading && entries.length === 0) {
      return (
        <div className="px-3 py-1.5 text-[11px] text-muted-foreground" style={{ paddingLeft: 24 + depth * 14 }}>
          {relativePath ? 'Empty folder' : 'No files or folders in this directory'}
        </div>
      )
    }

    return (
      <>
        {entries.map((entry) => {
          const isExpanded = entry.kind === 'directory' && expandedPaths.has(entry.relativePath)
          const isSelected = selectedEntry?.relativePath === entry.relativePath

          return (
            <div key={entry.relativePath}>
              <button
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs transition-colors',
                  isSelected ? 'bg-accent/70 text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                )}
                style={{ paddingLeft: 10 + depth * 14 }}
                onClick={() => handleSelectEntry(entry)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setSelectedEntry(entry)
                  setContextMenu({ x: event.clientX, y: event.clientY, entry })
                }}
                title={entry.absolutePath}
              >
                {entry.kind === 'directory' ? (
                  <>
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                    )}
                    {isExpanded ? (
                      <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                    ) : (
                      <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                    )}
                  </>
                ) : (
                  <>
                    <span className="w-3.5 shrink-0" />
                    <File className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                  </>
                )}
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                {entry.kind === 'file' ? (
                  <span className="shrink-0 text-[10px] text-muted-foreground/70">{formatBytes(entry.size)}</span>
                ) : null}
              </button>
              {entry.kind === 'directory' && isExpanded ? renderDirectory(entry.relativePath, depth + 1) : null}
            </div>
          )
        })}
        {isLoading ? (
          <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-muted-foreground" style={{ paddingLeft: 24 + depth * 14 }}>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading...
          </div>
        ) : null}
      </>
    )
  }, [directoryEntriesByPath, expandedPaths, handleSelectEntry, loadingPaths, selectedEntry?.relativePath])

  const selectionSummary = useMemo(() => {
    if (!selectedEntry) return null
    if (selectedEntry.kind === 'directory') {
      const childCount = directoryEntriesByPath[selectedEntry.relativePath]?.length
      return childCount == null ? 'Folder' : `${childCount} item${childCount === 1 ? '' : 's'}`
    }
    return formatBytes(selectedEntry.size)
  }, [directoryEntriesByPath, selectedEntry])

  if (!boardId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Select a board to browse files.
      </div>
    )
  }

  if (!boardRootDirLoaded) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading board files...
      </div>
    )
  }

  if (!boardRootDir) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="space-y-2">
          <p className="text-base font-medium text-foreground">No board folder selected</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Set a root directory for this board to browse files, preview source, and open assets directly.
          </p>
        </div>
        <Button type="button" className="gap-2" onClick={() => void handlePickBoardRootDir()} disabled={savingBoardRootDir}>
          <FolderOpen className="h-4 w-4" />
          {savingBoardRootDir ? 'Choosing...' : 'Choose Folder'}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-1 min-h-0">
      <aside className="flex w-[320px] shrink-0 flex-col border-r border-border/40 bg-muted/15">
        <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">Board Files</p>
            <p className="truncate text-[11px] text-muted-foreground" title={resolvedRootDir ?? boardRootDir}>
              {resolvedRootDir ?? boardRootDir}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 px-2" onClick={() => void handleRefresh()} title="Refresh">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 px-2"
            onClick={() => void handlePickBoardRootDir()}
            disabled={savingBoardRootDir}
            title="Change board folder"
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-2">
          {treeError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {treeError}
            </div>
          ) : renderDirectory('', 1)}
        </div>
      </aside>

      <section className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-border/40 px-4 py-3">
          {selectedEntry?.kind === 'directory' ? (
            <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" />
          ) : selectedEntry?.kind === 'file' ? (
            <File className="h-4 w-4 shrink-0 text-sky-500" />
          ) : (
            <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{selectedEntry?.name ?? 'Select a file or folder'}</p>
            <p className="truncate text-[11px] text-muted-foreground" title={selectedEntry?.absolutePath ?? resolvedRootDir ?? boardRootDir}>
              {selectedEntry ? selectedEntry.absolutePath : resolvedRootDir ?? boardRootDir}
            </p>
          </div>
          {selectionSummary ? (
            <span className="shrink-0 text-[11px] text-muted-foreground">{selectionSummary}</span>
          ) : null}
          {selectedEntry ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => void window.api.workspace.openInFinder(selectedEntry.absolutePath)}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Finder
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => void window.api.workspace.openInEditor(selectedEntry.absolutePath, 'cursor')}
              >
                <Code className="h-3.5 w-3.5" />
                Cursor
              </Button>
            </>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-background">
          {!selectedEntry ? (
            <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
              Choose a file from the left to preview it.
            </div>
          ) : selectedEntry.kind === 'directory' ? (
            <div className="flex h-full items-center justify-center px-6">
              <div className="max-w-md rounded-2xl border border-border/50 bg-muted/20 p-6 text-center">
                <FolderOpen className="mx-auto h-8 w-8 text-amber-500" />
                <p className="mt-3 text-sm font-medium text-foreground">{selectedEntry.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">{formatRelativePath(selectedEntry.relativePath)}</p>
                <p className="mt-3 text-sm text-muted-foreground">
                  Expand folders in the sidebar or use the actions above to open this path externally.
                </p>
              </div>
            </div>
          ) : previewMode === 'pdf' && previewFileUrl ? (
            <iframe title={selectedEntry.name} src={previewFileUrl} className="h-full w-full border-0 bg-white" />
          ) : previewMode === 'image' && previewFileUrl ? (
            <div className="flex h-full items-center justify-center bg-[#0b1120] p-6">
              <img src={previewFileUrl} alt={selectedEntry.name} className="max-h-full max-w-full rounded-xl shadow-2xl" />
            </div>
          ) : previewMode === 'video' && previewFileUrl ? (
            <div className="flex h-full items-center justify-center bg-[#0b1120] p-6">
              <video src={previewFileUrl} controls className="max-h-full max-w-full rounded-xl shadow-2xl" />
            </div>
          ) : previewMode === 'audio' && previewFileUrl ? (
            <div className="flex h-full items-center justify-center bg-[#0b1120] p-6">
              <audio src={previewFileUrl} controls className="w-full max-w-xl" />
            </div>
          ) : previewLoading ? (
            <div className="flex h-full items-center justify-center gap-2 px-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading preview...
            </div>
          ) : previewError ? (
            <div className="flex h-full items-center justify-center px-6">
              <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {previewError}
              </div>
            </div>
          ) : preview?.isBinary ? (
            <div className="flex h-full items-center justify-center px-6">
              <div className="max-w-md rounded-2xl border border-border/50 bg-muted/20 p-6 text-center">
                <File className="mx-auto h-8 w-8 text-sky-500" />
                <p className="mt-3 text-sm font-medium text-foreground">Binary file preview unavailable</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Open this file in Finder, Cursor, VS Code, or Zed from the context menu.
                </p>
              </div>
            </div>
          ) : (
            <div className="min-h-full bg-[#0b1120] text-slate-100">
              <div className="border-b border-slate-800 bg-slate-950/80 px-4 py-2 text-[11px] text-slate-400">
                {detectSyntaxLanguage(preview?.extension) === 'text' ? 'Text preview' : `Syntax highlighted • ${detectSyntaxLanguage(preview?.extension)}`}
                {preview?.truncated ? ` • truncated from ${formatBytes(preview.size)}` : ''}
              </div>
              <pre
                className="min-h-full overflow-auto px-4 py-4 font-mono text-[12px] leading-6 whitespace-pre-wrap break-words"
                dangerouslySetInnerHTML={{ __html: highlightedPreviewHtml ?? escapeHtml(preview?.content ?? '') }}
              />
            </div>
          )}
        </div>
      </section>

      {contextMenu ? (
        <div
          className="fixed z-50 min-w-[180px] rounded-md border border-border/40 bg-popover p-1 shadow-sm animate-in fade-in-0 zoom-in-95"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              void window.api.workspace.openInFinder(contextMenu.entry.absolutePath)
              setContextMenu(null)
            }}
          >
            <ExternalLink className="h-4 w-4" />
            Open in Finder
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => { void openEntryInEditor(contextMenu.entry, 'cursor') }}
          >
            <Code className="h-4 w-4" />
            Open in Cursor
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => { void openEntryInEditor(contextMenu.entry, 'vscode') }}
          >
            <Code className="h-4 w-4" />
            Open in VS Code
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => { void openEntryInEditor(contextMenu.entry, 'zed') }}
          >
            <Code className="h-4 w-4" />
            Open in Zed
          </button>
        </div>
      ) : null}
    </div>
  )
}
