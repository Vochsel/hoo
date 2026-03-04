import { useRef, useCallback, useEffect } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface TerminalPreviewProps {
  sessionId: string
  className?: string
  fontSize?: number
  onClick?: () => void
}

export function TerminalPreview({
  sessionId,
  className,
  fontSize = 9,
  onClick
}: TerminalPreviewProps): React.ReactElement {
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const cleanupListenersRef = useRef<(() => void) | null>(null)
  const initTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId

  const detach = useCallback(() => {
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
  }, [])

  useEffect(() => {
    return () => { detach() }
  }, [detach])

  const containerCallbackRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) {
        if (initTimerRef.current) { clearTimeout(initTimerRef.current); initTimerRef.current = null }
        detach()
        return
      }
      if (termRef.current) return

      initTimerRef.current = setTimeout(() => {
        initTimerRef.current = null
        if (!el.isConnected) return

        const sid = sessionIdRef.current

        const term = new Terminal({
          disableStdin: true,
          cursorBlink: false,
          fontSize,
          scrollback: 200,
          fontFamily: 'Menlo, Monaco, "Courier New", monospace',
          theme: {
            background: '#1a1a2e',
            foreground: '#e0e0e0',
            cursor: '#1a1a2e',
            selectionBackground: '#3a3a5c'
          }
        })
        const fitAddon = new FitAddon()
        term.loadAddon(fitAddon)
        term.open(el)

        termRef.current = term
        fitRef.current = fitAddon

        try { fitAddon.fit() } catch {}

        window.api.terminal
          .hasSession(sid)
          .then(async (alive) => {
            if (alive) {
              const buffer = await window.api.terminal.getBuffer(sid)
              if (buffer) term.write(buffer)
              try { fitAddon.fit() } catch {}
            }
          })
          .catch(() => {})

        const removeDataListener = window.api.terminal.onData(
          (incomingSessionId: string, data: string) => {
            if (incomingSessionId === sid) term.write(data)
          }
        )

        const removeExitListener = window.api.terminal.onExit(
          (incomingSessionId: string, exitCode: number) => {
            if (incomingSessionId === sid) {
              term.writeln(`\r\n[Process exited with code ${exitCode}]`)
            }
          }
        )

        cleanupListenersRef.current = () => {
          removeDataListener()
          removeExitListener()
        }

        const observer = new ResizeObserver(() => {
          try { fitAddon.fit() } catch {}
        })
        observer.observe(el)
        observerRef.current = observer
      }, 0)
    },
    [detach, fontSize]
  )

  return (
    <div
      ref={containerCallbackRef}
      className={className}
      style={{ background: '#1a1a2e' }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    />
  )
}
