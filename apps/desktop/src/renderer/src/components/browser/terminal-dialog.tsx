import { useRef, useCallback, useState, useEffect, type DragEvent as ReactDragEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Settings, ChevronLeft, ChevronRight, X, RotateCw } from 'lucide-react'
import '@xterm/xterm/css/xterm.css'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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

interface TerminalDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
  label?: string
  onRename?: (name: string) => void
  config: TerminalNodeConfig
  onUpdateConfig: (config: TerminalNodeConfig) => void
  onRunningChange?: (isRunning: boolean) => void
  workspaceRootDir?: string
  boardRootDir?: string | null
}

export function TerminalDialog({
  open,
  onOpenChange,
  label,
  onRename,
  config,
  onUpdateConfig,
  onRunningChange,
  sessionId,
  workspaceRootDir,
  boardRootDir
}: TerminalDialogProps): React.ReactElement {
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const spawnedRef = useRef(false)
  const observerRef = useRef<ResizeObserver | null>(null)
  const cleanupListenersRef = useRef<(() => void) | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [termContextMenu, setTermContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(label || 'Terminal')
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Local config editing state
  const [editCommand, setEditCommand] = useState(config.command || '')
  const [editCwd, setEditCwd] = useState(config.cwd || '')
  const [editShell, setEditShell] = useState(config.shell || '')
  const [editTimeout, setEditTimeout] = useState(String(config.timeout ?? 30))

  // Keep config refs current for the callback ref closure
  const configRef = useRef(config)
  configRef.current = config
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId
  const onUpdateConfigRef = useRef(onUpdateConfig)
  onUpdateConfigRef.current = onUpdateConfig
  const onRunningChangeRef = useRef(onRunningChange)
  onRunningChangeRef.current = onRunningChange
  const tailRef = useRef('')
  const pendingSubmittedCommandRef = useRef(false)

  const setRunningState = useCallback((isRunning: boolean): void => {
    onRunningChangeRef.current?.(isRunning)
  }, [])

  // Sync edit state when settings panel opens
  useEffect(() => {
    if (!settingsOpen) return
    setEditCommand(config.command || '')
    setEditCwd(config.cwd || '')
    setEditShell(config.shell || '')
    setEditTimeout(String(config.timeout ?? 30))
  }, [settingsOpen, config])

  const handleSaveConfig = (): void => {
    const timeoutNum = parseInt(editTimeout, 10)
    onUpdateConfig({
      ...config,
      command: editCommand.trim() || undefined,
      cwd: editCwd.trim() || undefined,
      shell: editShell.trim() || undefined,
      timeout: isNaN(timeoutNum) ? 30 : timeoutNum
    })
    setSettingsOpen(false)
  }

  const handleRestartTerminal = useCallback(async () => {
    setTermContextMenu(null)
    const sid = sessionIdRef.current
    const cfg = configRef.current
    const term = termRef.current
    const fitAddon = fitRef.current
    if (!term) return
    try {
      await window.api.terminal.kill(sid)
    } catch {}
    term.clear()
    term.reset()
    try {
      const result = await window.api.terminal.spawn(sid, {
        shell: cfg.shell || undefined,
        cwd: cfg.cwd || boardRootDir || workspaceRootDir || undefined,
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
      try {
        fitAddon?.fit()
        window.api.terminal.resize(sid, term.cols, term.rows).catch(() => {})
      } catch {}
    } catch (err) {
      term.writeln(`\r\nRestart error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [workspaceRootDir, boardRootDir])

  /** Serialize xterm buffer content to a string */
  const serializeBuffer = useCallback((): string => {
    const term = termRef.current
    if (!term) return ''
    const buf = term.buffer.active
    const lines: string[] = []
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i)
      if (line) lines.push(line.translateToString(true))
    }
    // Trim trailing empty lines
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop()
    }
    return lines.join('\n')
  }, [])

  /** Render terminal buffer onto a canvas with colors and return a PNG data URL */
  const captureScreenshot = useCallback((): string | undefined => {
    const term = termRef.current
    if (!term) return undefined
    const buf = term.buffer.active
    if (!buf || buf.length === 0) return undefined

    // Standard ANSI 16-color palette
    const ansiColors = [
      '#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5',
      '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#e5e5e5'
    ]
    const defaultFg = '#e0e0e0'
    const bgColor = '#1a1a2e'

    const dpr = window.devicePixelRatio || 2
    const fontSize = 12
    const lineHeight = Math.ceil(fontSize * 1.3)
    const fontFamily = 'Menlo, Monaco, "Courier New", monospace'
    const cols = term.cols || 80
    const visibleRows = term.rows || 24

    // Measure actual character width
    const measureCanvas = document.createElement('canvas')
    const measureCtx = measureCanvas.getContext('2d')!
    measureCtx.font = `${fontSize}px ${fontFamily}`
    const charWidth = measureCtx.measureText('M').width

    const padding = 8
    const canvasLogicalW = Math.ceil(cols * charWidth + padding * 2)
    const canvasLogicalH = visibleRows * lineHeight + padding * 2

    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(canvasLogicalW * dpr)
    canvas.height = Math.ceil(canvasLogicalH * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined

    ctx.scale(dpr, dpr)

    // Background
    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, canvasLogicalW, canvasLogicalH)

    // Render cells with color
    const startRow = Math.max(0, buf.length - visibleRows)
    ctx.font = `${fontSize}px ${fontFamily}`
    ctx.textBaseline = 'top'

    for (let row = 0; row < visibleRows && (startRow + row) < buf.length; row++) {
      const line = buf.getLine(startRow + row)
      if (!line) continue
      const y = padding + row * lineHeight

      for (let col = 0; col < cols; col++) {
        const cell = line.getCell(col)
        if (!cell) continue
        const ch = cell.getChars()
        if (!ch || ch === ' ') continue

        // Determine foreground color
        let fg = defaultFg
        if (cell.isFgPalette()) {
          const idx = cell.getFgColor()
          if (idx < 16) fg = ansiColors[idx]
        } else if (cell.isFgRGB()) {
          const c = cell.getFgColor()
          fg = `#${((c >> 16) & 0xff).toString(16).padStart(2, '0')}${((c >> 8) & 0xff).toString(16).padStart(2, '0')}${(c & 0xff).toString(16).padStart(2, '0')}`
        }

        ctx.fillStyle = fg
        ctx.fillText(ch, padding + col * charWidth, y)
      }
    }

    try {
      return canvas.toDataURL('image/png')
    } catch {
      return undefined
    }
  }, [])

  /** Detach xterm UI + IPC listeners without killing the PTY */
  const detachTerminal = useCallback(() => {
    // Save scrollback to config for app-restart persistence
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
    // Do NOT kill PTY — it stays alive in the main process
  }, [serializeBuffer])

  // Ref callback: fires when the container div mounts/unmounts
  const containerCallbackRef = useCallback(
    (el: HTMLDivElement | null) => {
      // Unmount: detach UI only
      if (!el) {
        detachTerminal()
        return
      }

      // Already initialized
      if (termRef.current) return

      const sid = sessionIdRef.current
      const cfg = configRef.current

      const term = new Terminal({
        cursorBlink: true,
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

      const removeKeyBindings = installTerminalKeyBindings(term, sid, el)

      // Fit after the dialog animation settles
      const fitTimer = setTimeout(() => {
        try {
          fitAddon.fit()
        } catch { /* ignore */ }
      }, 100)

      // Check if PTY session is still alive from a previous open
      window.api.terminal
        .hasSession(sid)
        .then(async (alive) => {
          if (alive) {
            // Reconnect: fetch buffered output and write to xterm
            const buffer = await window.api.terminal.getBuffer(sid)
            if (buffer) {
              tailRef.current = appendTerminalOutputTail('', buffer)
              term.write(buffer)
            }
            spawnedRef.current = true
            pendingSubmittedCommandRef.current = false
            const agentKind = detectTerminalAgentKind(cfg.command)
            setRunningState(
              isTerminalBusyFromTail(tailRef.current) &&
              !isLikelyAgentWaitingForInput(tailRef.current, agentKind)
            )
            // Re-fit and sync size
            try {
              fitAddon.fit()
              window.api.terminal.resize(sid, term.cols, term.rows).catch(() => {})
            } catch { /* ignore */ }
          } else {
            // PTY not alive — show saved scrollback as dimmed history if available
            if (cfg.lastScrollback) {
              term.write('\x1b[2m') // dim
              term.write(cfg.lastScrollback.replace(/\n/g, '\r\n'))
              term.write('\x1b[0m\r\n') // reset
            }

            // Spawn fresh PTY
            const result = await window.api.terminal.spawn(sid, {
              shell: cfg.shell || undefined,
              cwd: cfg.cwd || boardRootDir || workspaceRootDir || undefined,
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
            try {
              fitAddon.fit()
              window.api.terminal.resize(sid, term.cols, term.rows).catch(() => {})
            } catch { /* ignore */ }
          }
        })
        .catch((err: unknown) => {
          term.writeln(`\r\nError: ${err instanceof Error ? err.message : String(err)}`)
        })

      // Wire data from PTY → xterm
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

          if (hasAttentionSignal || isPrompt || isInputRequest || isAgentWaitingForInput) {
            pendingSubmittedCommandRef.current = false
            setRunningState(false)
            return
          }

          if (pendingSubmittedCommandRef.current && hasMeaningfulOutput) {
            setRunningState(true)
          }
        }
      )

      // Wire data from xterm → PTY
      const disposable = term.onData((data) => {
        if (data.includes('\r') || data.includes('\n')) {
          pendingSubmittedCommandRef.current = true
          setRunningState(true)
        }
        window.api.terminal.write(sid, data).catch(() => {})
      })

      // Wire exit event
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
        clearTimeout(fitTimer)
        removeKeyBindings()
        disposable.dispose()
        removeDataListener()
        removeExitListener()
      }

      // Resize observer
      const observer = new ResizeObserver(() => {
        try {
          fitAddon.fit()
          if (spawnedRef.current) {
            window.api.terminal.resize(sid, term.cols, term.rows).catch(() => {})
          }
        } catch { /* ignore */ }
      })
      observer.observe(el)
      observerRef.current = observer
    },
    [detachTerminal]
  )

  /** Wrap onOpenChange to capture screenshot while canvas is still live */
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        // Capture screenshot while the terminal is still alive.
        // Write into configRef so the subsequent detachTerminal scrollback
        // save won't overwrite it with a stale config.
        const screenshot = captureScreenshot()
        if (screenshot) {
          configRef.current = { ...configRef.current, lastScreenshot: screenshot }
        }
      }
      onOpenChange(nextOpen)
    },
    [onOpenChange, captureScreenshot]
  )

  // Dismiss context menu on click outside
  useEffect(() => {
    if (!termContextMenu) return
    const handler = (): void => setTermContextMenu(null)
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [termContextMenu])

  // Capture-phase Escape so it fires before stopPropagation or xterm can swallow it
  useEffect(() => {
    if (!open) return
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        handleOpenChange(false)
      }
    }
    window.addEventListener('keydown', handleEscape, true)
    return (): void => window.removeEventListener('keydown', handleEscape, true)
  }, [open, handleOpenChange])

  // Detach UI when dialog closes (PTY stays alive)
  useEffect(() => {
    if (!open) {
      detachTerminal()
      setTermContextMenu(null)
    }
  }, [open, detachTerminal])

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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="flex h-[80vh] max-w-[90vw] flex-row p-0 gap-0 overflow-hidden [&>button[class*='absolute']]:hidden"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onDragEnter={handleDragOver}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Terminal area */}
        <div className="flex flex-1 min-w-0 flex-col">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <div className="flex items-center gap-2 min-w-0">
              {editingName ? (
                <input
                  ref={nameInputRef}
                  value={nameValue}
                  onChange={(e) => setNameValue(e.target.value)}
                  onBlur={() => {
                    const trimmed = nameValue.trim()
                    if (trimmed && trimmed !== label && onRename) onRename(trimmed)
                    setEditingName(false)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    if (e.key === 'Escape') { setNameValue(label || 'Terminal'); setEditingName(false) }
                  }}
                  className="h-6 rounded border bg-background px-1.5 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-ring/50"
                  autoFocus
                />
              ) : (
                <span
                  className="text-sm font-medium shrink-0 cursor-pointer hover:underline"
                  onDoubleClick={() => { setNameValue(label || 'Terminal'); setEditingName(true) }}
                  title="Double-click to rename"
                >
                  {label || 'Terminal'}
                </span>
              )}
              {config.command && !editingName && (
                <span className="truncate text-xs text-muted-foreground font-mono">$ {config.command}</span>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setSettingsOpen(!settingsOpen)}
                title="Terminal settings"
              >
                {settingsOpen ? (
                  <ChevronRight className="h-4 w-4" />
                ) : (
                  <Settings className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => handleOpenChange(false)}
                title="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div
            ref={containerCallbackRef}
            className="relative flex-1 min-h-0 p-1"
            style={{ background: '#1a1a2e' }}
            onContextMenu={(e) => {
              e.preventDefault()
              setTermContextMenu({ x: e.clientX, y: e.clientY })
            }}
          />
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

        {/* Settings sidebar */}
        {settingsOpen && (
          <div className="w-[280px] shrink-0 border-l flex flex-col bg-background">
            <div className="flex items-center justify-between border-b px-4 py-2">
              <span className="text-sm font-medium">Workflow Settings</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setSettingsOpen(false)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <p className="text-xs text-muted-foreground">
                Configure the command that runs when this node executes in a workflow.
              </p>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground/80">Command</label>
                <Input
                  value={editCommand}
                  onChange={(e) => setEditCommand(e.target.value)}
                  placeholder="ls -la"
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground/80">Working directory</label>
                <Input
                  value={editCwd}
                  onChange={(e) => setEditCwd(e.target.value)}
                  placeholder={boardRootDir ? `(board: ${boardRootDir})` : '(defaults to home)'}
                  className="text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground/80">Shell</label>
                <Input
                  value={editShell}
                  onChange={(e) => setEditShell(e.target.value)}
                  placeholder="(default)"
                  className="text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground/80">Timeout (seconds)</label>
                <Input
                  type="number"
                  value={editTimeout}
                  onChange={(e) => setEditTimeout(e.target.value)}
                  min={1}
                  max={3600}
                  className="text-xs"
                />
              </div>
              <Button size="sm" className="w-full" onClick={handleSaveConfig}>
                Save
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
