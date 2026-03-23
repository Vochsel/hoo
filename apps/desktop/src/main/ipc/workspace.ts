import { ipcMain, BrowserWindow, dialog, shell } from 'electron'
import { spawn } from 'child_process'
import { promises as fs } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import {
  getWorkspaceRootDir,
  setWorkspaceRootDir,
  getWorkspaceSnapshot,
  ensureWorkspaceInitialized,
  createFolderInWorkspace,
  renameFolderInWorkspace,
  deleteFolderInWorkspace,
  createBoardInWorkspace,
  renameBoardInWorkspace,
  moveBoardInWorkspace,
  archiveBoardInWorkspace,
  unarchiveBoardInWorkspace,
  deleteBoardInWorkspace,
  setWorkspaceActiveBoardId,
  boardExists,
  readBoardDocument,
  writeBoardDocument,
  getRecentWorkspaces,
  resetWorkspace,
  type BoardViewMode
} from '../services/workspace-files'

const WORKSPACE_TAG = '[workspace]'
const MAX_FILE_PREVIEW_BYTES = 256 * 1024

interface BoardFilesystemEntry {
  name: string
  relativePath: string
  absolutePath: string
  kind: 'file' | 'directory'
  extension: string | null
  size: number | null
}

function normalizeRelativePath(relativePath?: string): string {
  const normalized = String(relativePath ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.')

  for (const segment of normalized) {
    if (segment === '..') {
      throw new Error('Invalid relative path')
    }
  }

  return normalized.join('/')
}

function resolvePathInsideRoot(rootDir: string, relativePath?: string): string {
  const normalizedRelativePath = normalizeRelativePath(relativePath)
  const resolvedRoot = resolve(rootDir)
  const absolutePath = normalizedRelativePath
    ? resolve(resolvedRoot, ...normalizedRelativePath.split('/'))
    : resolvedRoot

  if (!(absolutePath === resolvedRoot || absolutePath.startsWith(`${resolvedRoot}${sep}`))) {
    throw new Error('Path escapes board root')
  }

  return absolutePath
}

async function resolveBoardFilesystemRoot(boardId: string): Promise<string> {
  if (!(await boardExists(boardId))) {
    throw new Error('Board not found')
  }

  const doc = await readBoardDocument(boardId)
  const rootDir = doc.rootDir?.trim()
  if (!rootDir) {
    throw new Error('Board root directory not configured')
  }

  return resolve(rootDir)
}

function isLikelyBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) return false

  let suspiciousBytes = 0
  const sampleLength = Math.min(buffer.length, 8_192)
  for (let index = 0; index < sampleLength; index += 1) {
    const value = buffer[index]
    if (value === 0) return true
    if (value < 7 || (value > 14 && value < 32)) {
      suspiciousBytes += 1
    }
  }

  return suspiciousBytes / sampleLength > 0.2
}

export function registerWorkspaceHandlers(): void {
  ipcMain.handle('workspace:getState', async () => {
    return getWorkspaceSnapshot()
  })

  ipcMain.handle('workspace:pickRootDir', async (event, defaultPath?: string) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = parentWindow
      ? await dialog.showOpenDialog(parentWindow, {
          title: 'Choose workspace root directory',
          defaultPath: defaultPath?.trim() || getWorkspaceRootDir(),
          properties: ['openDirectory', 'createDirectory', 'dontAddToRecent']
        })
      : await dialog.showOpenDialog({
          title: 'Choose workspace root directory',
          defaultPath: defaultPath?.trim() || getWorkspaceRootDir(),
          properties: ['openDirectory', 'createDirectory', 'dontAddToRecent']
        })
    if (result.canceled) return null
    return result.filePaths[0] ?? null
  })

  ipcMain.handle('workspace:setRootDir', async (_event, rootDir: string) => {
    const resolved = setWorkspaceRootDir(rootDir)
    console.log(`${WORKSPACE_TAG} root set to ${resolved}`)
    await ensureWorkspaceInitialized()
    return getWorkspaceSnapshot()
  })

  ipcMain.handle('workspace:getRecentWorkspaces', async () => {
    return getRecentWorkspaces()
  })

  ipcMain.handle('workspace:reset', async () => {
    console.log(`${WORKSPACE_TAG} resetting workspace`)
    return resetWorkspace()
  })

  ipcMain.handle('workspace:createFolder', async (_event, name?: string) => {
    await createFolderInWorkspace(name)
    return getWorkspaceSnapshot()
  })

  ipcMain.handle('workspace:renameFolder', async (_event, folderId: string, name: string) => {
    const nextFolderName = await renameFolderInWorkspace(folderId, name)
    const snapshot = await getWorkspaceSnapshot()
    return { snapshot, nextFolderName }
  })

  ipcMain.handle('workspace:deleteFolder', async (_event, folderId: string) => {
    await deleteFolderInWorkspace(folderId)
    return getWorkspaceSnapshot()
  })

  ipcMain.handle('workspace:createBoard', async (_event, payload?: { name?: string; folderId?: string | null }) => {
    const nextBoardId = await createBoardInWorkspace(payload)
    setWorkspaceActiveBoardId(nextBoardId)
    return getWorkspaceSnapshot()
  })

  ipcMain.handle('workspace:renameBoard', async (_event, boardId: string, name: string) => {
    const nextBoardId = await renameBoardInWorkspace(boardId, name)
    const snapshot = await getWorkspaceSnapshot()
    return { snapshot, nextBoardId }
  })

  ipcMain.handle('workspace:moveBoard', async (_event, boardId: string, folderId?: string | null) => {
    await moveBoardInWorkspace(boardId, folderId)
    return getWorkspaceSnapshot()
  })

  ipcMain.handle('workspace:archiveBoard', async (_event, boardId: string) => {
    await archiveBoardInWorkspace(boardId)
    return getWorkspaceSnapshot()
  })

  ipcMain.handle('workspace:unarchiveBoard', async (_event, boardId: string) => {
    await unarchiveBoardInWorkspace(boardId)
    return getWorkspaceSnapshot()
  })

  ipcMain.handle('workspace:deleteBoard', async (_event, boardId: string) => {
    await deleteBoardInWorkspace(boardId)
    return getWorkspaceSnapshot()
  })

  ipcMain.handle('workspace:setActiveBoard', async (_event, boardId: string) => {
    try {
      if (await boardExists(boardId)) {
        setWorkspaceActiveBoardId(boardId)
      }
    } catch {
      // ignore invalid board ids from stale UI state
    }
    return getWorkspaceSnapshot()
  })

  ipcMain.handle('workspace:getBoardActiveView', async (_event, boardId: string) => {
    if (!(await boardExists(boardId))) {
      return 'whiteboard'
    }
    const doc = await readBoardDocument(boardId)
    return doc.activeView ?? 'whiteboard'
  })

  ipcMain.handle('workspace:getBoardDocumentHtml', async (_event, boardId: string) => {
    if (!(await boardExists(boardId))) {
      throw new Error('Board not found')
    }
    const doc = await readBoardDocument(boardId)
    return doc.documentHtml ?? '<p></p>'
  })

  ipcMain.handle('workspace:setBoardDocumentHtml', async (_event, boardId: string, html: string) => {
    if (!(await boardExists(boardId))) {
      throw new Error('Board not found')
    }
    const doc = await readBoardDocument(boardId)
    doc.documentHtml = html
    await writeBoardDocument(boardId, doc)
    return { success: true }
  })

  ipcMain.handle('workspace:setBoardActiveView', async (_event, boardId: string, view: BoardViewMode) => {
    if (!(await boardExists(boardId))) {
      throw new Error('Board not found')
    }
    const doc = await readBoardDocument(boardId)
    doc.activeView = view
    await writeBoardDocument(boardId, doc)
    return { success: true }
  })

  ipcMain.handle('workspace:getBoardRootDir', async (_event, boardId: string) => {
    if (!(await boardExists(boardId))) {
      return null
    }
    const doc = await readBoardDocument(boardId)
    return doc.rootDir ?? null
  })

  ipcMain.handle('workspace:setBoardRootDir', async (_event, boardId: string, rootDir: string | null) => {
    if (!(await boardExists(boardId))) {
      throw new Error('Board not found')
    }
    const doc = await readBoardDocument(boardId)
    if (rootDir && rootDir.trim().length > 0) {
      doc.rootDir = rootDir.trim()
    } else {
      delete doc.rootDir
    }
    await writeBoardDocument(boardId, doc)
    return { success: true }
  })

  ipcMain.handle('workspace:listBoardDirectory', async (_event, boardId: string, relativePath?: string) => {
    const rootDir = await resolveBoardFilesystemRoot(boardId)
    const normalizedRelativePath = normalizeRelativePath(relativePath)
    const directoryPath = resolvePathInsideRoot(rootDir, normalizedRelativePath)
    const stats = await fs.stat(directoryPath)
    if (!stats.isDirectory()) {
      throw new Error('Path is not a directory')
    }

    const entries = await fs.readdir(directoryPath, { withFileTypes: true })
    const serializedEntries: BoardFilesystemEntry[] = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() || entry.isFile())
        .map(async (entry) => {
          const nextRelativePath = normalizedRelativePath
            ? `${normalizedRelativePath}/${entry.name}`
            : entry.name
          const absolutePath = resolvePathInsideRoot(rootDir, nextRelativePath)
          const entryStats = await fs.stat(absolutePath)
          return {
            name: entry.name,
            relativePath: nextRelativePath,
            absolutePath,
            kind: entry.isDirectory() ? 'directory' : 'file',
            extension: entry.isDirectory() ? null : extname(entry.name).toLowerCase() || null,
            size: entry.isDirectory() ? null : entryStats.size
          }
        })
    )

    serializedEntries.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
      return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
    })

    return {
      rootDir,
      relativePath: normalizedRelativePath,
      entries: serializedEntries
    }
  })

  ipcMain.handle('workspace:readBoardFilePreview', async (_event, boardId: string, relativePath: string) => {
    const rootDir = await resolveBoardFilesystemRoot(boardId)
    const normalizedRelativePath = normalizeRelativePath(relativePath)
    if (!normalizedRelativePath) {
      throw new Error('No file selected')
    }

    const absolutePath = resolvePathInsideRoot(rootDir, normalizedRelativePath)
    const stats = await fs.stat(absolutePath)
    if (!stats.isFile()) {
      throw new Error('Path is not a file')
    }

    const handle = await fs.open(absolutePath, 'r')
    try {
      const previewLength = Math.min(stats.size, MAX_FILE_PREVIEW_BYTES)
      const buffer = Buffer.alloc(previewLength)
      const { bytesRead } = await handle.read(buffer, 0, previewLength, 0)
      const previewBuffer = buffer.subarray(0, bytesRead)
      const binary = isLikelyBinary(previewBuffer)

      return {
        rootDir,
        relativePath: normalizedRelativePath,
        absolutePath,
        size: stats.size,
        extension: extname(absolutePath).toLowerCase() || null,
        isBinary: binary,
        truncated: stats.size > bytesRead,
        content: binary ? null : previewBuffer.toString('utf8')
      }
    } finally {
      await handle.close()
    }
  })

  ipcMain.handle('workspace:pickBoardRootDir', async (event, defaultPath?: string) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = parentWindow
      ? await dialog.showOpenDialog(parentWindow, {
          title: 'Choose board root directory',
          defaultPath: defaultPath?.trim() || undefined,
          properties: ['openDirectory', 'createDirectory', 'dontAddToRecent']
        })
      : await dialog.showOpenDialog({
          title: 'Choose board root directory',
          defaultPath: defaultPath?.trim() || undefined,
          properties: ['openDirectory', 'createDirectory', 'dontAddToRecent']
        })
    if (result.canceled) return null
    return result.filePaths[0] ?? null
  })

  ipcMain.handle('workspace:openInFinder', async (_event, dirPath: string) => {
    const targetPath = dirPath?.trim()
    if (!targetPath) {
      throw new Error('No path provided')
    }

    try {
      const stats = await fs.stat(targetPath)
      if (stats.isDirectory()) {
        await shell.openPath(targetPath)
      } else {
        shell.showItemInFolder(targetPath)
      }
    } catch {
      shell.showItemInFolder(targetPath)
    }
    return { success: true }
  })

  ipcMain.handle('workspace:openInEditor', async (_event, dirPath: string, editor: string) => {
    const editorCommands: Record<string, string> = {
      cursor: 'cursor',
      vscode: 'code',
      zed: 'zed'
    }
    const cmd = editorCommands[editor] ?? 'cursor'
    spawn(cmd, [dirPath], { detached: true, stdio: 'ignore' }).unref()
    return { success: true }
  })
}
