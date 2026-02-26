import { useRef, useCallback, useEffect } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { TerminalNodeConfig } from './terminal-node'

interface TerminalContentProps {
  sessionId: string
  config: TerminalNodeConfig
  onUpdateConfig: (config: TerminalNodeConfig) => void
}

export function TerminalContent({
  sessionId,
  config,
  onUpdateConfig
}: TerminalContentProps): React.ReactElement {
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const spawnedRef = useRef(false)
  const observerRef = useRef<ResizeObserver | null>(null)
  const cleanupListenersRef = useRef<(() => void) | null>(null)

  const configRef = useRef(config)
  configRef.current = config
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId
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

  // Cleanup on unmount
  useEffect(() => {
    return () => { detachTerminal() }
  }, [detachTerminal])

  const containerCallbackRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) {
        detachTerminal()
        return
      }
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

      const fitTimer = setTimeout(() => {
        try { fitAddon.fit() } catch {}
      }, 100)

      window.api.terminal
        .hasSession(sid)
        .then(async (alive) => {
          if (alive) {
            const buffer = await window.api.terminal.getBuffer(sid)
            if (buffer) term.write(buffer)
            spawnedRef.current = true
            try {
              fitAddon.fit()
              window.api.terminal.resize(sid, term.cols, term.rows).catch(() => {})
            } catch {}
          } else {
            if (cfg.lastScrollback) {
              term.write('\x1b[2m')
              term.write(cfg.lastScrollback.replace(/\n/g, '\r\n'))
              term.write('\x1b[0m\r\n')
            }
            const result = await window.api.terminal.spawn(sid, {
              shell: cfg.shell || undefined,
              cwd: cfg.cwd || undefined,
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
            } catch {}
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
        clearTimeout(fitTimer)
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
    },
    [detachTerminal]
  )

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="flex items-center border-b px-4 py-2">
        <span className="text-sm font-medium">Terminal</span>
      </div>
      <div
        ref={containerCallbackRef}
        className="flex-1 min-h-0 p-1"
        style={{ background: '#1a1a2e' }}
      />
    </div>
  )
}
