import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import * as pty from 'node-pty'
import { homedir } from 'os'

const sessions = new Map<string, pty.IPty>()
const buffers = new Map<string, string>()
const MAX_BUFFER_SIZE = 500_000 // ~500KB per session

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
}

function defaultShell(): string {
  return process.platform === 'win32'
    ? 'powershell.exe'
    : process.env.SHELL || '/bin/zsh'
}

export function registerTerminalHandlers(): void {
  // Non-interactive execution for workflow nodes
  ipcMain.handle(
    'terminal:execute',
    async (
      _e: IpcMainInvokeEvent,
      command: string,
      cwd?: string,
      shell?: string,
      timeout?: number
    ): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number; error?: string }> => {
      const timeoutMs = (timeout ?? 30) * 1000
      const resolvedShell = shell || defaultShell()
      const resolvedCwd = cwd || homedir()

      return new Promise((resolve) => {
        let stdout = ''
        let settled = false

        const settle = (result: { success: boolean; stdout: string; stderr: string; exitCode: number; error?: string }): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(result)
        }

        let proc: pty.IPty
        try {
          // Use shell -c to execute the command, so pipes/redirects work
          const args = process.platform === 'win32'
            ? ['-Command', command]
            : ['-c', command]

          proc = pty.spawn(resolvedShell, args, {
            name: 'xterm-256color',
            cols: 200,
            rows: 50,
            cwd: resolvedCwd,
            env: process.env as Record<string, string>
          })
        } catch (err) {
          settle({
            success: false,
            stdout: '',
            stderr: '',
            exitCode: -1,
            error: err instanceof Error ? err.message : String(err)
          })
          return
        }

        proc.onData((data) => {
          stdout += data
        })

        proc.onExit(({ exitCode }) => {
          settle({
            success: exitCode === 0,
            stdout: stripAnsi(stdout).trim(),
            stderr: '',
            exitCode
          })
        })

        const timer = setTimeout(() => {
          try {
            proc.kill()
          } catch { /* ignore */ }
          settle({
            success: false,
            stdout: stripAnsi(stdout).trim(),
            stderr: '',
            exitCode: -1,
            error: `Command timed out after ${timeout ?? 30}s`
          })
        }, timeoutMs)
      })
    }
  )

  // Interactive PTY sessions
  ipcMain.handle(
    'terminal:spawn',
    (
      e: IpcMainInvokeEvent,
      sessionId: string,
      opts?: { shell?: string; cwd?: string; cols?: number; rows?: number }
    ) => {
      if (sessions.has(sessionId)) {
        return { success: false, error: 'Session already exists' }
      }

      try {
        const proc = pty.spawn(opts?.shell || defaultShell(), [], {
          name: 'xterm-256color',
          cols: opts?.cols ?? 80,
          rows: opts?.rows ?? 24,
          cwd: opts?.cwd || homedir(),
          env: process.env as Record<string, string>
        })

        sessions.set(sessionId, proc)
        buffers.set(sessionId, '')

        proc.onData((data) => {
          // Append to scrollback buffer (truncate front if over limit)
          let buf = (buffers.get(sessionId) ?? '') + data
          if (buf.length > MAX_BUFFER_SIZE) {
            buf = buf.slice(buf.length - MAX_BUFFER_SIZE)
          }
          buffers.set(sessionId, buf)

          try {
            e.sender.send('terminal:data', sessionId, data)
          } catch { /* renderer may have been destroyed */ }
        })

        proc.onExit(({ exitCode }) => {
          sessions.delete(sessionId)
          buffers.delete(sessionId)
          try {
            e.sender.send('terminal:exit', sessionId, exitCode)
          } catch { /* renderer may have been destroyed */ }
        })

        return { success: true }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle('terminal:write', (_e: IpcMainInvokeEvent, sessionId: string, data: string) => {
    const proc = sessions.get(sessionId)
    if (!proc) return
    proc.write(data)
  })

  ipcMain.handle('terminal:resize', (_e: IpcMainInvokeEvent, sessionId: string, cols: number, rows: number) => {
    const proc = sessions.get(sessionId)
    if (!proc) return
    try {
      proc.resize(cols, rows)
    } catch { /* ignore resize errors */ }
  })

  ipcMain.handle('terminal:kill', (_e: IpcMainInvokeEvent, sessionId: string) => {
    const proc = sessions.get(sessionId)
    if (!proc) return
    sessions.delete(sessionId)
    buffers.delete(sessionId)
    try {
      proc.kill()
    } catch { /* ignore kill errors */ }
  })

  ipcMain.handle('terminal:hasSession', (_e: IpcMainInvokeEvent, sessionId: string) => {
    return sessions.has(sessionId)
  })

  ipcMain.handle('terminal:getBuffer', (_e: IpcMainInvokeEvent, sessionId: string) => {
    return buffers.get(sessionId) ?? ''
  })
}

export function cleanupTerminalSessions(): void {
  for (const [id, proc] of sessions) {
    try {
      proc.kill()
    } catch { /* ignore */ }
    sessions.delete(id)
  }
  buffers.clear()
}
