import { contextBridge, ipcRenderer } from 'electron'

const api = {
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
    getAll: () => ipcRenderer.invoke('settings:getAll')
  },

  browserTabs: {
    list: (boardId?: string) => ipcRenderer.invoke('browserTabs:list', boardId),
    get: (id: string, boardId?: string) => ipcRenderer.invoke('browserTabs:get', id, boardId),
    create: (data: { title?: string; url?: string; flowX?: number; flowY?: number }, boardId?: string) =>
      ipcRenderer.invoke('browserTabs:create', data, boardId),
    update: (id: string, data: Record<string, unknown>, boardId?: string) =>
      ipcRenderer.invoke('browserTabs:update', id, data, boardId),
    delete: (id: string, boardId?: string) => ipcRenderer.invoke('browserTabs:delete', id, boardId),
    saveOrder: (orderedIds: string[], boardId?: string) =>
      ipcRenderer.invoke('browserTabs:saveOrder', orderedIds, boardId),
    getViewOrder: (boardId?: string) => ipcRenderer.invoke('browserTabs:getViewOrder', boardId),
    saveViewOrder: (orderedIds: string[], boardId?: string) =>
      ipcRenderer.invoke('browserTabs:saveViewOrder', orderedIds, boardId),
    savePositions: (positions: Array<{ id: string; x: number; y: number }>, boardId?: string) =>
      ipcRenderer.invoke('browserTabs:savePositions', positions, boardId),
    listMessages: (tabId: string, boardId?: string) => ipcRenderer.invoke('browserTabs:listMessages', tabId, boardId),
    clearMessages: (tabId: string, boardId?: string) => ipcRenderer.invoke('browserTabs:clearMessages', tabId, boardId),
    chat: (
      tabId: string,
      userMessage: string,
      pageContext: {
        url: string
        title: string
        text: string
        elements: string
        screenshot?: string
        webContentsId?: number
        includeScreenshot?: boolean
      },
      boardId?: string
    ) => ipcRenderer.invoke('browserTabs:chat', tabId, userMessage, pageContext, boardId),
    captureScreenshot: (webContentsId: number) =>
      ipcRenderer.invoke('browserTabs:captureScreenshot', webContentsId),
    setLiveWebContents: (tabId: string, webContentsId?: number | null) =>
      ipcRenderer.invoke('browserTabs:setLiveWebContents', tabId, webContentsId),
    executeActions: (
      webContentsId: number,
      actions: Array<{ type: string; index?: number; value?: string; url?: string; direction?: string; amount?: number }>
    ) => ipcRenderer.invoke('browserTabs:executeActions', webContentsId, actions),
    abortChat: (tabId: string, boardId?: string) => ipcRenderer.invoke('browserTabs:abortChat', tabId, boardId),
    generateMonitorRule: (condition: string, pageHtml: string, pageUrl: string) =>
      ipcRenderer.invoke('browserTabs:generateMonitorRule', condition, pageHtml, pageUrl)
  },

  graphNodes: {
    list: (boardId?: string) => ipcRenderer.invoke('graphNodes:list', boardId),
    create: (data: { nodeType: string; label?: string; config?: string; flowX?: number; flowY?: number }, boardId?: string) =>
      ipcRenderer.invoke('graphNodes:create', data, boardId),
    update: (id: string, data: Record<string, unknown>, boardId?: string) =>
      ipcRenderer.invoke('graphNodes:update', id, data, boardId),
    delete: (id: string, boardId?: string) => ipcRenderer.invoke('graphNodes:delete', id, boardId),
    saveOrder: (orderedIds: string[], boardId?: string) =>
      ipcRenderer.invoke('graphNodes:saveOrder', orderedIds, boardId),
    savePositions: (positions: Array<{ id: string; x: number; y: number }>, boardId?: string) =>
      ipcRenderer.invoke('graphNodes:savePositions', positions, boardId),
    pickFile: (options?: { mode?: 'open' | 'save'; defaultPath?: string }) =>
      ipcRenderer.invoke('graphNodes:pickFile', options),
    readFile: (filePath: string) =>
      ipcRenderer.invoke('graphNodes:readFile', filePath),
    writeFile: (filePath: string, content: string, mode?: 'overwrite' | 'append') =>
      ipcRenderer.invoke('graphNodes:writeFile', filePath, content, mode),
    executeAiPrompt: (nodeId: string, inputData?: string, runId?: string, boardId?: string) =>
      ipcRenderer.invoke('graphNodes:executeAiPrompt', nodeId, inputData, runId, boardId),
    notify: (title: string, body: string, playSound?: boolean) =>
      ipcRenderer.invoke('graphNodes:notify', title, body, playSound),
    watchFile: (filePath: string) =>
      ipcRenderer.invoke('graphNodes:watchFile', filePath) as Promise<{ content: string | null; error?: string }>,
    unwatchFile: (filePath: string) =>
      ipcRenderer.invoke('graphNodes:unwatchFile', filePath),
    onFileChanged: (callback: (data: { filePath: string; content: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { filePath: string; content: string }): void => {
        callback(data)
      }
      ipcRenderer.on('graphNodes:fileChanged', listener)
      return () => { ipcRenderer.removeListener('graphNodes:fileChanged', listener) }
    }
  },

  browserEdges: {
    list: (boardId?: string) => ipcRenderer.invoke('browserEdges:list', boardId),
    save: (edges: Array<{ id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }>, boardId?: string) =>
      ipcRenderer.invoke('browserEdges:save', edges, boardId)
  },

  workspace: {
    getState: () => ipcRenderer.invoke('workspace:getState'),
    pickRootDir: (defaultPath?: string) => ipcRenderer.invoke('workspace:pickRootDir', defaultPath),
    setRootDir: (rootDir: string) => ipcRenderer.invoke('workspace:setRootDir', rootDir),
    getRecentWorkspaces: () => ipcRenderer.invoke('workspace:getRecentWorkspaces'),
    reset: () => ipcRenderer.invoke('workspace:reset'),
    createFolder: (name?: string) => ipcRenderer.invoke('workspace:createFolder', name),
    renameFolder: (folderId: string, name: string) => ipcRenderer.invoke('workspace:renameFolder', folderId, name),
    deleteFolder: (folderId: string) => ipcRenderer.invoke('workspace:deleteFolder', folderId),
    createBoard: (payload?: { name?: string; folderId?: string | null }) =>
      ipcRenderer.invoke('workspace:createBoard', payload),
    renameBoard: (boardId: string, name: string) => ipcRenderer.invoke('workspace:renameBoard', boardId, name),
    moveBoard: (boardId: string, folderId?: string | null) =>
      ipcRenderer.invoke('workspace:moveBoard', boardId, folderId),
    deleteBoard: (boardId: string) => ipcRenderer.invoke('workspace:deleteBoard', boardId),
    setActiveBoard: (boardId: string) => ipcRenderer.invoke('workspace:setActiveBoard', boardId),
    getBoardActiveView: (boardId: string) => ipcRenderer.invoke('workspace:getBoardActiveView', boardId),
    getBoardDocumentHtml: (boardId: string) => ipcRenderer.invoke('workspace:getBoardDocumentHtml', boardId),
    setBoardDocumentHtml: (boardId: string, html: string) => ipcRenderer.invoke('workspace:setBoardDocumentHtml', boardId, html),
    setBoardActiveView: (boardId: string, view: string) => ipcRenderer.invoke('workspace:setBoardActiveView', boardId, view),
    getBoardRootDir: (boardId: string) => ipcRenderer.invoke('workspace:getBoardRootDir', boardId),
    setBoardRootDir: (boardId: string, rootDir: string | null) => ipcRenderer.invoke('workspace:setBoardRootDir', boardId, rootDir),
    pickBoardRootDir: (defaultPath?: string) => ipcRenderer.invoke('workspace:pickBoardRootDir', defaultPath)
  },

  terminal: {
    execute: (command: string, cwd?: string, shell?: string, timeout?: number) =>
      ipcRenderer.invoke('terminal:execute', command, cwd, shell, timeout),
    spawn: (sessionId: string, opts?: { shell?: string; cwd?: string; cols?: number; rows?: number }) =>
      ipcRenderer.invoke('terminal:spawn', sessionId, opts),
    write: (sessionId: string, data: string) =>
      ipcRenderer.invoke('terminal:write', sessionId, data),
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.invoke('terminal:resize', sessionId, cols, rows),
    kill: (sessionId: string) =>
      ipcRenderer.invoke('terminal:kill', sessionId),
    hasSession: (sessionId: string) =>
      ipcRenderer.invoke('terminal:hasSession', sessionId) as Promise<boolean>,
    getBuffer: (sessionId: string) =>
      ipcRenderer.invoke('terminal:getBuffer', sessionId) as Promise<string>,
    materializeDroppedFile: (fileName: string, bytes: Uint8Array) =>
      ipcRenderer.invoke('terminal:materializeDroppedFile', fileName, bytes) as Promise<string>,
    onData: (callback: (sessionId: string, data: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, sessionId: string, data: string): void => {
        callback(sessionId, data)
      }
      ipcRenderer.on('terminal:data', listener)
      return () => { ipcRenderer.removeListener('terminal:data', listener) }
    },
    onExit: (callback: (sessionId: string, exitCode: number) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, sessionId: string, exitCode: number): void => {
        callback(sessionId, exitCode)
      }
      ipcRenderer.on('terminal:exit', listener)
      return () => { ipcRenderer.removeListener('terminal:exit', listener) }
    }
  },

  app: {
    restart: () => ipcRenderer.invoke('app:restart')
  },

  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    onUpdateAvailable: (callback: (info: { version: string; releaseNotes?: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, info: { version: string; releaseNotes?: string }): void => {
        callback(info)
      }
      ipcRenderer.on('updater:update-available', listener)
      return () => { ipcRenderer.removeListener('updater:update-available', listener) }
    },
    onDownloadProgress: (callback: (progress: { percent: number }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: { percent: number }): void => {
        callback(progress)
      }
      ipcRenderer.on('updater:download-progress', listener)
      return () => { ipcRenderer.removeListener('updater:download-progress', listener) }
    },
    onUpdateDownloaded: (callback: () => void) => {
      const listener = (): void => { callback() }
      ipcRenderer.on('updater:update-downloaded', listener)
      return () => { ipcRenderer.removeListener('updater:update-downloaded', listener) }
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
