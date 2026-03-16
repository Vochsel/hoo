import { app, shell, BrowserWindow, ipcMain, Menu } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { getDb } from './db/client'
import { registerSettingsHandlers } from './ipc/settings'
import { registerBrowserTabHandlers } from './ipc/browser-tabs'
import { registerWorkspaceHandlers } from './ipc/workspace'
import { registerTerminalHandlers, cleanupTerminalSessions } from './ipc/terminal'

function resolveAppIconPath(): string | null {
  const preferredFile =
    process.platform === 'win32'
      ? 'icon.ico'
      : process.platform === 'darwin'
        ? 'icon.icns'
        : 'icon.png'
  const fallbackFile = 'icon.png'
  const baseDirs = [process.cwd(), join(__dirname, '../..'), app.getAppPath()]
  const candidates = baseDirs.flatMap((dir) =>
    preferredFile === fallbackFile
      ? [join(dir, `build/${preferredFile}`)]
      : [join(dir, `build/${preferredFile}`), join(dir, `build/${fallbackFile}`)]
  )

  for (const path of candidates) {
    if (existsSync(path)) {
      return path
    }
  }

  return null
}

function createWindow(iconPath: string | null): void {
  const isMac = process.platform === 'darwin'

  const mainWindow = new BrowserWindow({
    title: 'Hoo',
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    ...(isMac
      ? {
          trafficLightPosition: { x: 15, y: 18 },
          vibrancy: 'under-window',
          visualEffectState: 'active',
          transparent: true
        }
      : {}),
    ...(!isMac && iconPath ? { icon: iconPath } : {}),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webviewTag: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function setupAutoUpdater(): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('updater:update-available', {
        version: info.version,
        releaseNotes: info.releaseNotes
      })
    }
  })

  autoUpdater.on('download-progress', (progress) => {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('updater:download-progress', {
        percent: progress.percent
      })
    }
  })

  autoUpdater.on('update-downloaded', () => {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('updater:update-downloaded')
    }
  })

  autoUpdater.on('error', (error) => {
    console.warn('[updater] Error checking for updates:', error.message)
  })

  ipcMain.handle('app:setBadgeCount', (_e: Electron.IpcMainInvokeEvent, count: number) => {
    app.setBadgeCount(count)
  })

  ipcMain.handle('updater:check', () => autoUpdater.checkForUpdates())
  ipcMain.handle('updater:download', () => autoUpdater.downloadUpdate())
  ipcMain.handle('updater:install', () => autoUpdater.quitAndInstall())
}

app.setName('Hoo')

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.hoo.app')
  const iconPath = resolveAppIconPath()

  if (process.platform === 'darwin' && iconPath) {
    try {
      app.dock?.setIcon(iconPath)
    } catch (error) {
      console.warn(`[main] Failed to set dock icon from ${iconPath}:`, error)
    }
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  getDb()
  registerSettingsHandlers()
  registerWorkspaceHandlers()
  registerBrowserTabHandlers()
  registerTerminalHandlers()
  setupAutoUpdater()

  // Build app menu — override CmdOrCtrl+W so it doesn't close the window
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' as const },
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const }
          ]
        }]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: (): void => {
            // No-op — prevent closing the window
          }
        },
        ...(isMac ? [] : [{ role: 'quit' as const }])
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))

  createWindow(iconPath)

  if (!is.dev) {
    autoUpdater.checkForUpdates().catch(() => {})
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(iconPath)
  })
})

app.on('before-quit', () => {
  cleanupTerminalSessions()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
