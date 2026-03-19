import { useRef, useCallback, useEffect, useState, type DragEvent as ReactDragEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { RotateCw } from 'lucide-react'
import '@xterm/xterm/css/xterm.css'
import type { TerminalNodeConfig } from './terminal-node'
import {
  canAcceptTerminalDrop,
  installTerminalKeyBindings,
  writeDroppedItemsToTerminal
} from './terminal-interactions'

interface TerminalContentProps {
  sessionId: string
  label?: string
  config: TerminalNodeConfig
  onRequestClose?: () => void
  onUpdateConfig: (config: TerminalNodeConfig) => void
  workspaceRootDir?: string
  showHeader?: boolean
}

export function TerminalContent({
  sessionId,
  label,
  config,
  onRequestClose,
  onUpdateConfig,
  workspaceRootDir,
  showHeader = true
}: TerminalContentProps): React.ReactElement {
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const spawnedRef = useRef(false)
  const observerRef = useRef<ResizeObserver | null>(null)
  const cleanupListenersRef = useRef<(() => void) | null>(null)

  const [termContextMenu, setTermContextMenu] = useState<{ x: number; y: number } | null>(null)

  const configRef = useRef(config)
  configRef.current = config
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId
  const onRequestCloseRef = useRef(onRequestClose)
  onRequestCloseRef.current = onRequestClose
  const onUpdateConfigRef = useRef(onUpdateConfig)
  onUpdateConfigRef.current = onUpdateConfig

  const serializeBuffer = useCallback((): string => {
    const term = termRef.current
    if (!term) return ''
    const buf = term.buffer.active
    const lines: string[] = []
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i)
      if (line) lines.push(line.translateToString(true))
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop()
    }
    return lines.join('\n')
  }, [])

  const focusTerminal = useCallback(() => {
    window.requestAnimationFrame(() => {
      termRef.current?.focus()
    })
  }, [])

  const detachTerminal = useCallback(() => {
    const scrollback = serializeBuffer()
    if (scrollback) {
      onUpdateConfigRef.current({ ...configRef.current, lastScrollback: scrollback })
    }
    if (cleanupListenersRef.current) {
      cleanupListenersRef.current()
      cleanupListenersRef.current = null
    }
    if (observerRef.current) {
      observerRef.current.disconnect()
      observerRef.current = null
    }
    if (termRef.current) {
      termRef.current.dispose()
      termRef.current = null
    }
    fitRef.current = null
  }, [serializeBuffer])

  const handleRestartTerminal = useCallback(async () => {
    setTermContextMenu(null)
    const sid = sessionIdRef.current
    const cfg = configRef.current
    const term = termRef.current
    const fitAddon = fitRef.current
    if (!term) return
    try { await window.api.terminal.kill(sid) } catch {}
    term.clear()
    term.reset()
    try {
      const result = await window.api.terminal.spawn(sid, {
        shell: cfg.shell || undefined,
        cwd: cfg.cwd || workspaceRootDir || undefined,
        cols: term.cols || 80,
        rows: term.rows || 24
      })
      if (!result.success) {
        term.writeln(`\r\nFailed to restart terminal: ${result.error ?? 'unknown error'}`)
        return
      }
      spawnedRef.current = true
      // Run configured command on restart
      if (cfg.command?.trim()) {
        window.api.terminal.write(sid, cfg.command.trim() + '\n').catch(() => {})
      }
      try {
        fitAddon?.fit()
        window.api.terminal.resize(sid, term.cols, term.rows).catch(() => {})
      } catch {}
    } catch (err) {
      term.writeln(`\r\nRestart error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [workspaceRootDir])

  // Dismiss context menu on click outside
  useEffect(() => {
    if (!termContextMenu) return
    const handler = (): void => setTermContextMenu(null)
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [termContextMenu])

  // Cleanup on unmount
  useEffect(() => {
    return () => { detachTerminal() }
  }, [detachTerminal])

  const handleDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (!canAcceptTerminalDrop(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDrop = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (!canAcceptTerminalDrop(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    void writeDroppedItemsToTerminal(sessionIdRef.current, event.dataTransfer)
  }, [])

  const initTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const containerCallbackRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) {
        if (initTimerRef.current) { clearTimeout(initTimerRef.current); initTimerRef.current = null }
        detachTerminal()
        return
      }
      if (termRef.current) return

      // Defer xterm initialization until after browser layout so the container
      // has non-zero dimensions. xterm's renderer needs measured dimensions
      // during open() to properly create its canvases.
      initTimerRef.current = setTimeout(() => {
        initTimerRef.current = null
        if (!el.isConnected) return

        const sid = sessionIdRef.current
        const cfg = configRef.current

        const term = new Terminal({
          cursorBlink: true,
          scrollback: 10_000,
          fontSize: 13,
          fontFamily: 'Menlo, Monaco, "Courier New", monospace',
          theme: {
            background: '#1a1a2e',
            foreground: '#e0e0e0',
            cursor: '#e0e0e0',
            selectionBackground: '#3a3a5c'
          }
        })
        const fitAddon = new FitAddon()
        term.loadAddon(fitAddon)
        term.open(el)

        termRef.current = term
        fitRef.current = fitAddon
        focusTerminal()

        const removeKeyBindings = installTerminalKeyBindings(term, sid, el, () => {
          onRequestCloseRef.current?.()
        })

        try { fitAddon.fit() } catch {}

        window.api.terminal
          .hasSession(sid)
          .then(async (alive) => {
            if (alive) {
              const buffer = await window.api.terminal.getBuffer(sid)
              if (buffer) {
                term.write(buffer, () => {
                  term.scrollToBottom()
                })
              }
              spawnedRef.current = true
              try {
                fitAddon.fit()
                window.api.terminal.resize(sid, term.cols, term.rows).catch(() => {})
              } catch {}
              focusTerminal()
            } else {
              if (cfg.lastScrollback) {
                term.write('\x1b[2m')
                term.write(cfg.lastScrollback.replace(/\n/g, '\r\n'))
                term.write('\x1b[0m\r\n')
              }
              const result = await window.api.terminal.spawn(sid, {
                shell: cfg.shell || undefined,
                cwd: cfg.cwd || workspaceRootDir || undefined,
                cols: term.cols || 80,
                rows: term.rows || 24
              })
              if (!result.success) {
                term.writeln(`\r\nFailed to spawn terminal: ${result.error ?? 'unknown error'}`)
                return
              }
              spawnedRef.current = true
              // Run configured command on startup
              if (cfg.command?.trim()) {
                window.api.terminal.write(sid, cfg.command.trim() + '\n').catch(() => {})
              }
              try {
                fitAddon.fit()
                window.api.terminal.resize(sid, term.cols, term.rows).catch(() => {})
              } catch {}
              focusTerminal()
            }
          })
          .catch((err: unknown) => {
            term.writeln(`\r\nError: ${err instanceof Error ? err.message : String(err)}`)
          })

        const removeDataListener = window.api.terminal.onData(
          (incomingSessionId: string, data: string) => {
            if (incomingSessionId === sid) term.write(data)
          }
        )

        const disposable = term.onData((data) => {
          window.api.terminal.write(sid, data).catch(() => {})
        })

        const removeExitListener = window.api.terminal.onExit(
          (incomingSessionId: string, exitCode: number) => {
            if (incomingSessionId === sid) {
              term.writeln(`\r\n[Process exited with code ${exitCode}]`)
              spawnedRef.current = false
            }
          }
        )

        cleanupListenersRef.current = () => {
          removeKeyBindings()
          disposable.dispose()
          removeDataListener()
          removeExitListener()
        }

        const observer = new ResizeObserver(() => {
          try {
            fitAddon.fit()
            if (spawnedRef.current) {
              window.api.terminal.resize(sid, term.cols, term.rows).catch(() => {})
            }
          } catch {}
        })
        observer.observe(el)
        observerRef.current = observer
      }, 0)
    },
    [detachTerminal, focusTerminal]
  )

  return (
    <div
      className="flex flex-1 flex-col min-h-0 overflow-hidden"
      onDragEnter={handleDragOver}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {showHeader && (
        <div className="flex items-center gap-2 border-b px-4 py-2">
          <span className="text-sm font-medium shrink-0">{label || 'Terminal'}</span>
          {config.command && (
            <span className="truncate text-xs text-muted-foreground font-mono">$ {config.command}</span>
          )}
        </div>
      )}
      <div className="relative flex-1 min-h-0">
        <div
          ref={containerCallbackRef}
          className="absolute inset-0 p-1"
          style={{ background: '#1a1a2e' }}
          onContextMenu={(e) => {
            e.preventDefault()
            setTermContextMenu({ x: e.clientX, y: e.clientY })
          }}
        />
      </div>
      {termContextMenu && (
        <div
          className="fixed z-[100] rounded-md border bg-popover p-1 shadow-md"
          style={{ left: termContextMenu.x, top: termContextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-3 py-1.5 text-xs hover:bg-accent"
            onClick={() => void handleRestartTerminal()}
          >
            <RotateCw className="h-3.5 w-3.5" />
            Restart Terminal
          </button>
        </div>
      )}
    </div>
  )
}
