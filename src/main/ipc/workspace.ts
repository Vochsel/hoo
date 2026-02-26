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
  createPlanInWorkspace,
  renamePlanInWorkspace,
  movePlanInWorkspace,
  deletePlanInWorkspace,
  readPlanHtml,
  writePlanHtml,
  planExists
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
    await renameFolderInWorkspace(folderId, name)
    return getWorkspaceSnapshot()
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
    await renameBoardInWorkspace(boardId, name)
    return getWorkspaceSnapshot()
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

  ipcMain.handle('workspace:createPlan', async (_event, payload?: { name?: string; folderId?: string | null }) => {
    await createPlanInWorkspace(payload)
    return getWorkspaceSnapshot()
  })

  ipcMain.handle('workspace:renamePlan', async (_event, planId: string, name: string) => {
    await renamePlanInWorkspace(planId, name)
    return getWorkspaceSnapshot()
  })

  ipcMain.handle('workspace:movePlan', async (_event, planId: string, folderId?: string | null) => {
    await movePlanInWorkspace(planId, folderId)
    return getWorkspaceSnapshot()
  })

  ipcMain.handle('workspace:deletePlan', async (_event, planId: string) => {
    await deletePlanInWorkspace(planId)
    return getWorkspaceSnapshot()
  })

  ipcMain.handle('workspace:getPlanHtml', async (_event, planId: string) => {
    if (!(await planExists(planId))) {
      throw new Error('Plan not found')
    }
    return readPlanHtml(planId)
  })

  ipcMain.handle('workspace:setPlanHtml', async (_event, planId: string, html: string) => {
    if (!(await planExists(planId))) {
      throw new Error('Plan not found')
    }
    await writePlanHtml(planId, html)
    return { success: true }
  })
}
