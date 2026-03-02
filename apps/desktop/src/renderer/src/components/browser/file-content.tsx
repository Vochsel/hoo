import { useEffect, useMemo, useRef, useState } from 'react'
import { File } from 'lucide-react'
import { marked } from 'marked'
import type { FileNodeConfig } from './file-node'

interface FileContentProps {
  nodeId: string
  config: FileNodeConfig
  onUpdateConfig: (config: FileNodeConfig) => void
}

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

export function FileContent({ config }: FileContentProps): React.ReactElement {
  const filePath = config?.filePath || ''
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const watchedPathRef = useRef<string | null>(null)

  useEffect(() => {
    if (!filePath) {
      setFileContent(null)
      setFileError(null)
      return
    }

    let cancelled = false
    watchedPathRef.current = filePath

    window.api.graphNodes.watchFile(filePath).then((result) => {
      if (cancelled) return
      if (result.error) {
        setFileError(result.error)
        setFileContent(null)
      } else {
        setFileContent(result.content)
        setFileError(null)
      }
    })

    const cleanup = window.api.graphNodes.onFileChanged((data) => {
      if (data.filePath === filePath && !cancelled) {
        setFileContent(data.content)
        setFileError(null)
      }
    })

    return () => {
      cancelled = true
      cleanup()
      window.api.graphNodes.unwatchFile(filePath)
      watchedPathRef.current = null
    }
  }, [filePath])

  const ext = useMemo(() => getFileExtension(filePath), [filePath])
  const fileName = useMemo(() => getFileName(filePath), [filePath])

  const renderedHtml = useMemo(() => {
    if (!fileContent || ext !== '.md') return null
    return marked.parse(fileContent, { gfm: true, breaks: true }) as string
  }, [fileContent, ext])

  if (!filePath) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        No file path configured
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
        <File className="h-4 w-4 text-cyan-500 shrink-0" />
        <span className="text-xs font-medium truncate" title={filePath}>{fileName}</span>
        <span className="text-[10px] text-muted-foreground truncate">{filePath}</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {fileError && (
          <p className="text-sm text-destructive">{fileError}</p>
        )}
        {fileContent !== null && !fileError && (
          <>
            {ext === '.md' && renderedHtml ? (
              <div
                className="prose prose-sm dark:prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: renderedHtml }}
              />
            ) : ext === '.html' ? (
              <div
                className="prose prose-sm dark:prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: fileContent }}
              />
            ) : (
              <pre className="whitespace-pre-wrap break-all font-mono text-xs text-foreground/90">
                {fileContent}
              </pre>
            )}
          </>
        )}
        {fileContent === null && !fileError && (
          <p className="text-sm text-muted-foreground italic">Loading...</p>
        )}
      </div>
    </div>
  )
}
