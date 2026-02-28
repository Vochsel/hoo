import { useRef, useCallback, useState, useEffect } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Settings, ChevronLeft, ChevronRight, X, RotateCw } from 'lucide-react'
import '@xterm/xterm/css/xterm.css'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { TerminalNodeConfig } from './terminal-node'

interface TerminalDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
  config: TerminalNodeConfig
  onUpdateConfig: (config: TerminalNodeConfig) => void
  workspaceRootDir?: string
}

export function TerminalDialog({
  open,
  onOpenChange,
  config,
  onUpdateConfig,
  sessionId,
  workspaceRootDir
}: TerminalDialogProps): React.ReactElement {
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const spawnedRef = useRef(false)
  const observerRef = useRef<ResizeObserver | null>(null)
  const cleanupListenersRef = useRef<(() => void) | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [termContextMenu, setTermContextMenu] = useState<{ x: number; y: number } | null>(null)

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
        cwd: cfg.cwd || workspaceRootDir || undefined,
        cols: term.cols || 80,
        rows: term.rows || 24
      })
      if (!result.success) {
        term.writeln(`\r\nFailed to restart terminal: ${result.error ?? 'unknown error'}`)
        return
      }
      spawnedRef.current = true
      try {
        fitAddon?.fit()
        window.api.terminal.resize(sid, term.cols, term.rows).catch(() => {})
      } catch {}
    } catch (err) {
      term.writeln(`\r\nRestart error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [workspaceRootDir])

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
              term.write(buffer)
            }
            spawnedRef.current = true
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
              cwd: cfg.cwd || workspaceRootDir || undefined,
              cols: term.cols || 80,
              rows: term.rows || 24
            })
            if (!result.success) {
              term.writeln(`\r\nFailed to spawn terminal: ${result.error ?? 'unknown error'}`)
              return
            }
            spawnedRef.current = true
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
          if (incomingSessionId === sid) {
            term.write(data)
          }
        }
      )

      // Wire data from xterm → PTY
      const disposable = term.onData((data) => {
        window.api.terminal.write(sid, data).catch(() => {})
      })

      // Wire exit event
      const removeExitListener = window.api.terminal.onExit(
        (incomingSessionId: string, exitCode: number) => {
          if (incomingSessionId === sid) {
            term.writeln(`\r\n[Process exited with code ${exitCode}]`)
            spawnedRef.current = false
          }
        }
      )

      cleanupListenersRef.current = () => {
        clearTimeout(fitTimer)
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

  // Dismiss context menu on click outside
  useEffect(() => {
    if (!termContextMenu) return
    const handler = (): void => setTermContextMenu(null)
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [termContextMenu])

  // Detach UI when dialog closes (PTY stays alive)
  useEffect(() => {
    if (!open) {
      detachTerminal()
      setTermContextMenu(null)
    }
  }, [open, detachTerminal])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[80vh] max-w-[90vw] flex-row p-0 gap-0 overflow-hidden [&>button[class*='absolute']]:hidden"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {/* Terminal area */}
        <div className="flex flex-1 min-w-0 flex-col">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-medium shrink-0">Interactive Terminal</span>
              {config.command && (
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
                onClick={() => onOpenChange(false)}
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
                  placeholder="(defaults to home)"
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
