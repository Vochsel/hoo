import { contextBridge, ipcRenderer } from 'electron'

const api = {
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
    getAll: () => ipcRenderer.invoke('settings:getAll')
  },

  browserTabs: {
    list: () => ipcRenderer.invoke('browserTabs:list'),
    get: (id: string) => ipcRenderer.invoke('browserTabs:get', id),
    create: (data: { title?: string; url?: string; flowX?: number; flowY?: number }) =>
      ipcRenderer.invoke('browserTabs:create', data),
    update: (id: string, data: Record<string, unknown>) =>
      ipcRenderer.invoke('browserTabs:update', id, data),
    delete: (id: string) => ipcRenderer.invoke('browserTabs:delete', id),
    savePositions: (positions: Array<{ id: string; x: number; y: number }>) =>
      ipcRenderer.invoke('browserTabs:savePositions', positions),
    listMessages: (tabId: string) => ipcRenderer.invoke('browserTabs:listMessages', tabId),
    clearMessages: (tabId: string) => ipcRenderer.invoke('browserTabs:clearMessages', tabId),
    chat: (
      tabId: string,
      userMessage: string,
      pageContext: { url: string; title: string; text: string; elements: string; screenshot?: string }
    ) => ipcRenderer.invoke('browserTabs:chat', tabId, userMessage, pageContext),
    captureScreenshot: (webContentsId: number) =>
      ipcRenderer.invoke('browserTabs:captureScreenshot', webContentsId),
    abortChat: (tabId: string) => ipcRenderer.invoke('browserTabs:abortChat', tabId),
    generateMonitorRule: (condition: string, pageHtml: string, pageUrl: string) =>
      ipcRenderer.invoke('browserTabs:generateMonitorRule', condition, pageHtml, pageUrl)
  },

  graphNodes: {
    list: () => ipcRenderer.invoke('graphNodes:list'),
    create: (data: { nodeType: string; label?: string; config?: string; flowX?: number; flowY?: number }) =>
      ipcRenderer.invoke('graphNodes:create', data),
    update: (id: string, data: Record<string, unknown>) =>
      ipcRenderer.invoke('graphNodes:update', id, data),
    delete: (id: string) => ipcRenderer.invoke('graphNodes:delete', id),
    savePositions: (positions: Array<{ id: string; x: number; y: number }>) =>
      ipcRenderer.invoke('graphNodes:savePositions', positions),
    pickFile: (options?: { mode?: 'open' | 'save'; defaultPath?: string }) =>
      ipcRenderer.invoke('graphNodes:pickFile', options),
    readFile: (filePath: string) =>
      ipcRenderer.invoke('graphNodes:readFile', filePath),
    writeFile: (filePath: string, content: string, mode?: 'overwrite' | 'append') =>
      ipcRenderer.invoke('graphNodes:writeFile', filePath, content, mode),
    executeAiPrompt: (nodeId: string, inputData?: string, runId?: string) =>
      ipcRenderer.invoke('graphNodes:executeAiPrompt', nodeId, inputData, runId),
    notify: (title: string, body: string, playSound?: boolean) =>
      ipcRenderer.invoke('graphNodes:notify', title, body, playSound)
  },

  browserEdges: {
    list: () => ipcRenderer.invoke('browserEdges:list'),
    save: (edges: Array<{ id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }>) =>
      ipcRenderer.invoke('browserEdges:save', edges)
  },

  app: {
    restart: () => ipcRenderer.invoke('app:restart')
  }
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
