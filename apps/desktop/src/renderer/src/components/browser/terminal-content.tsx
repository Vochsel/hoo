import { useRef, useCallback, useEffect, useState, type DragEvent as ReactDragEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { RotateCw } from 'lucide-react'
import '@xterm/xterm/css/xterm.css'
import type { TerminalNodeConfig } from './terminal-node'
import {
  appendTerminalOutputTail,
  detectTerminalAgentKind,
  getLastNonEmptyTerminalLine,
  hasTerminalAttentionSignal,
  isLikelyAgentWaitingForInput,
  isLikelyShellPromptLine,
  isLikelyTerminalInputRequest,
  isTerminalBusyFromTail,
  normalizeTerminalOutput
} from '@/lib/terminal-status'
import {
  canAcceptTerminalDrop,
  installTerminalKeyBindings,
  writeDroppedItemsToTerminal
} from './terminal-interactions'

interface TerminalContentProps {
  sessionId: string
  label?: string
  config: TerminalNodeConfig
  active?: boolean
  onRequestClose?: () => void
  onUpdateConfig: (config: TerminalNodeConfig) => void
  onRunningChange?: (isRunning: boolean) => void
  workspaceRootDir?: string
  showHeader?: boolean
}

export function TerminalContent({
  sessionId,
  label,
  config,
  active = true,
  onRequestClose,
  onUpdateConfig,
  onRunningChange,
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
  const activeRef = useRef(active)
  activeRef.current = active
  const onRunningChangeRef = useRef(onRunningChange)
  onRunningChangeRef.current = onRunningChange
  const workspaceRootDirRef = useRef(workspaceRootDir)
  workspaceRootDirRef.current = workspaceRootDir
  const tailRef = useRef('')
  const pendingSubmittedCommandRef = useRef(false)

  const setRunningState = useCallback((isRunning: boolean): void => {
    onRunningChangeRef.current?.(isRunning)
  }, [])

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

  const captureScreenshot = useCallback((): string | undefined => {
    const term = termRef.current
    if (!term) return undefined
    const buf = term.buffer.active
    if (!buf || buf.length === 0) return undefined

    const ansiColors = [
      '#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5',
      '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#e5e5e5'
    ]
    const defaultFg = '#e0e0e0'
    const background = '#1a1a2e'
    const dpr = window.devicePixelRatio || 2
    const fontSize = 12
    const lineHeight = Math.ceil(fontSize * 1.3)
    const fontFamily = 'Menlo, Monaco, "Courier New", monospace'
    const cols = term.cols || 80
    const visibleRows = term.rows || 24

    const measureCanvas = document.createElement('canvas')
    const measureCtx = measureCanvas.getContext('2d')
    if (!measureCtx) return undefined
    measureCtx.font = `${fontSize}px ${fontFamily}`
    const charWidth = measureCtx.measureText('M').width

    const padding = 8
    const logicalWidth = Math.ceil(cols * charWidth + padding * 2)
    const logicalHeight = visibleRows * lineHeight + padding * 2
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(logicalWidth * dpr)
    canvas.height = Math.ceil(logicalHeight * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined

    ctx.scale(dpr, dpr)
    ctx.fillStyle = background
    ctx.fillRect(0, 0, logicalWidth, logicalHeight)
    ctx.font = `${fontSize}px ${fontFamily}`
    ctx.textBaseline = 'top'

    const startRow = Math.max(0, buf.length - visibleRows)
    for (let row = 0; row < visibleRows && startRow + row < buf.length; row += 1) {
      const line = buf.getLine(startRow + row)
      if (!line) continue
      const y = padding + row * lineHeight

      for (let col = 0; col < cols; col += 1) {
        const cell = line.getCell(col)
        if (!cell) continue
        const chars = cell.getChars()
        if (!chars || chars === ' ') continue

        let fg = defaultFg
        if (cell.isFgPalette()) {
          const idx = cell.getFgColor()
          if (idx < 16) fg = ansiColors[idx]
        } else if (cell.isFgRGB()) {
          const color = cell.getFgColor()
          fg = `#${((color >> 16) & 0xff).toString(16).padStart(2, '0')}${((color >> 8) & 0xff).toString(16).padStart(2, '0')}${(color & 0xff).toString(16).padStart(2, '0')}`
        }

        ctx.fillStyle = fg
        ctx.fillText(chars, padding + col * charWidth, y)
      }
    }

    try {
      return canvas.toDataURL('image/png')
    } catch {
      return undefined
    }
  }, [])

  const focusTerminal = useCallback(() => {
    if (!activeRef.current) return
    window.requestAnimationFrame(() => {
      if (!activeRef.current) return
      termRef.current?.focus()
    })
  }, [])

  const fitTerminal = useCallback(() => {
    const term = termRef.current
    const fitAddon = fitRef.current
    if (!term || !fitAddon) return
    try {
      fitAddon.fit()
      if (spawnedRef.current) {
        window.api.terminal.resize(sessionIdRef.current, term.cols, term.rows).catch(() => {})
      }
    } catch {}
  }, [])

  const detachTerminal = useCallback(() => {
    const scrollback = serializeBuffer()
    const screenshot = captureScreenshot()
    if (scrollback || screenshot) {
      onUpdateConfigRef.current({
        ...configRef.current,
        ...(scrollback ? { lastScrollback: scrollback } : {}),
        ...(screenshot ? { lastScreenshot: screenshot } : {})
      })
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
  }, [captureScreenshot, serializeBuffer])

  const handleRestartTerminal = useCallback(async () => {
    setTermContextMenu(null)
    const sid = sessionIdRef.current
    const cfg = configRef.current
    const term = termRef.current
    if (!term) return
    try { await window.api.terminal.kill(sid) } catch {}
    term.clear()
    term.reset()
    try {
      const result = await window.api.terminal.spawn(sid, {
        shell: cfg.shell || undefined,
        cwd: cfg.cwd || workspaceRootDirRef.current || undefined,
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
        pendingSubmittedCommandRef.current = true
        setRunningState(true)
        window.api.terminal.write(sid, cfg.command.trim() + '\n').catch(() => {})
      } else {
        pendingSubmittedCommandRef.current = false
        setRunningState(false)
      }
      fitTerminal()
    } catch (err) {
      term.writeln(`\r\nRestart error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [fitTerminal])

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

  useEffect(() => {
    const term = termRef.current
    if (!term) return

    if (!active) {
      term.blur()
      return
    }

    const frame = window.requestAnimationFrame(() => {
      fitTerminal()
      focusTerminal()
    })

    return () => window.cancelAnimationFrame(frame)
  }, [active, fitTerminal, focusTerminal])

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
                tailRef.current = appendTerminalOutputTail('', buffer)
                term.write(buffer, () => {
                  term.scrollToBottom()
                })
              }
              spawnedRef.current = true
              pendingSubmittedCommandRef.current = false
              const agentKind = detectTerminalAgentKind(cfg.command)
              setRunningState(
                isTerminalBusyFromTail(tailRef.current, agentKind) &&
                !isLikelyAgentWaitingForInput(tailRef.current, agentKind)
              )
              fitTerminal()
              focusTerminal()
            } else {
              if (cfg.lastScrollback) {
                term.write('\x1b[2m')
                term.write(cfg.lastScrollback.replace(/\n/g, '\r\n'))
                term.write('\x1b[0m\r\n')
              }
              const result = await window.api.terminal.spawn(sid, {
                shell: cfg.shell || undefined,
                cwd: cfg.cwd || workspaceRootDirRef.current || undefined,
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
                pendingSubmittedCommandRef.current = true
                setRunningState(true)
                window.api.terminal.write(sid, cfg.command.trim() + '\n').catch(() => {})
              } else {
                pendingSubmittedCommandRef.current = false
                setRunningState(false)
              }
              fitTerminal()
              focusTerminal()
            }
          })
          .catch((err: unknown) => {
            term.writeln(`\r\nError: ${err instanceof Error ? err.message : String(err)}`)
          })

        const removeDataListener = window.api.terminal.onData(
          (incomingSessionId: string, data: string) => {
            if (incomingSessionId !== sid) return
            term.write(data)

            const normalizedChunk = normalizeTerminalOutput(data)
            tailRef.current = appendTerminalOutputTail(tailRef.current, data)
            const lastLine = getLastNonEmptyTerminalLine(tailRef.current)
            const agentKind = detectTerminalAgentKind(configRef.current.command)
            const hasAttentionSignal = hasTerminalAttentionSignal(data)
            const isPrompt = isLikelyShellPromptLine(lastLine)
            const isInputRequest = isLikelyTerminalInputRequest(lastLine)
            const isAgentWaitingForInput = isLikelyAgentWaitingForInput(tailRef.current, agentKind)
            const hasMeaningfulOutput = /\S/.test(normalizedChunk)

            const shouldStop = hasAttentionSignal || isInputRequest || isAgentWaitingForInput || (!agentKind && isPrompt)
            if (shouldStop) {
              pendingSubmittedCommandRef.current = false
              setRunningState(false)
              return
            }

            if (pendingSubmittedCommandRef.current && hasMeaningfulOutput) {
              setRunningState(true)
            }
          }
        )

        const disposable = term.onData((data) => {
          if (data.includes('\r') || data.includes('\n')) {
            pendingSubmittedCommandRef.current = true
            setRunningState(true)
          }
          window.api.terminal.write(sid, data).catch(() => {})
        })

        const removeExitListener = window.api.terminal.onExit(
          (incomingSessionId: string, exitCode: number) => {
            if (incomingSessionId === sid) {
              term.writeln(`\r\n[Process exited with code ${exitCode}]`)
              spawnedRef.current = false
              pendingSubmittedCommandRef.current = false
              setRunningState(false)
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
          fitTerminal()
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
