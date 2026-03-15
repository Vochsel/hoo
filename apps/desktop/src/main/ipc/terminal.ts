import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import * as pty from 'node-pty'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { homedir, tmpdir } from 'os'
import { promisify } from 'node:util'

const sessions = new Map<string, pty.IPty>()
const buffers = new Map<string, string>()
const MAX_BUFFER_SIZE = 500_000 // ~500KB per session
const execFileAsync = promisify(execFile)
const shellEnvCache = new Map<string, Promise<Record<string, string>>>()

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
}

function defaultShell(): string {
  return process.platform === 'win32'
    ? 'powershell.exe'
    : process.env.SHELL || '/bin/zsh'
}

function currentProcessEnv(): Record<string, string> {
  const entries = Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  return Object.fromEntries(entries)
}

function parseEnvOutput(stdout: string): Record<string, string> {
  const parsed: Record<string, string> = {}
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) continue
    parsed[line.slice(0, separatorIndex)] = line.slice(separatorIndex + 1)
  }
  return parsed
}

async function resolveShellEnv(shellPath: string): Promise<Record<string, string>> {
  if (process.platform === 'win32') return currentProcessEnv()

  const cached = shellEnvCache.get(shellPath)
  if (cached) return cached

  const baseEnv = currentProcessEnv()
  const loadPromise = (async () => {
    try {
      const { stdout } = await execFileAsync(
        shellPath,
        ['-ilc', 'command env'],
        {
          cwd: homedir(),
          env: baseEnv,
          timeout: 5_000,
          maxBuffer: 1024 * 1024
        }
      )

      return {
        ...baseEnv,
        ...parseEnvOutput(stdout)
      }
    } catch {
      return baseEnv
    }
  })()

  shellEnvCache.set(shellPath, loadPromise)
  return loadPromise
}

function sanitizeDroppedFileName(fileName: string): string {
  const normalized = basename((fileName || 'dropped-file').trim() || 'dropped-file')
  const safe = normalized.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
  return safe || 'dropped-file'
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
      const env = await resolveShellEnv(resolvedShell)

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
            env
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
    async (
      e: IpcMainInvokeEvent,
      sessionId: string,
      opts?: { shell?: string; cwd?: string; cols?: number; rows?: number }
    ) => {
      if (sessions.has(sessionId)) {
        return { success: false, error: 'Session already exists' }
      }

      try {
        const resolvedShell = opts?.shell || defaultShell()
        const env = await resolveShellEnv(resolvedShell)

        const proc = pty.spawn(resolvedShell, [], {
          name: 'xterm-256color',
          cols: opts?.cols ?? 80,
          rows: opts?.rows ?? 24,
          cwd: opts?.cwd || homedir(),
          env
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

  ipcMain.handle('terminal:materializeDroppedFile', async (_e: IpcMainInvokeEvent, fileName: string, bytes: Uint8Array) => {
    const directory = join(tmpdir(), 'hoo-terminal-drops')
    await fs.mkdir(directory, { recursive: true })

    const safeName = sanitizeDroppedFileName(fileName)
    const extension = extname(safeName)
    const stem = extension ? safeName.slice(0, -extension.length) : safeName
    const filePath = join(directory, `${stem}-${randomUUID()}${extension}`)

    await fs.writeFile(filePath, bytes)
    return filePath
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
