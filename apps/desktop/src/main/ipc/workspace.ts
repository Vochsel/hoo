import { ipcMain, BrowserWindow, dialog } from 'electron'
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
  deleteBoardInWorkspace,
  setWorkspaceActiveBoardId,
  boardExists,
  readBoardDocument,
  writeBoardDocument,
  type BoardViewMode
} from '../services/workspace-files'

const WORKSPACE_TAG = '[workspace]'

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
}
