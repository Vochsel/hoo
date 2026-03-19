import { app, shell, BrowserWindow, ipcMain, Menu, type WebContents } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { getDb } from './db/client'
import { registerSettingsHandlers } from './ipc/settings'
import { findLiveTabIdByWebContentsId, registerBrowserTabHandlers } from './ipc/browser-tabs'
import { registerWorkspaceHandlers } from './ipc/workspace'
import { registerTerminalHandlers, cleanupTerminalSessions } from './ipc/terminal'

const popupWindows = new Set<BrowserWindow>()

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

function buildPopupWindowOptions(
  options: Electron.BrowserWindowConstructorOptions,
  sourceContents: WebContents,
  iconPath: string | null
): Electron.BrowserWindowConstructorOptions {
  const parentWindow = BrowserWindow.fromWebContents(sourceContents) ?? undefined
  const inheritedWebPreferences = options.webPreferences ?? {}
  const webPreferences =
    inheritedWebPreferences.partition || inheritedWebPreferences.session
      ? inheritedWebPreferences
      : {
          ...inheritedWebPreferences,
          session: sourceContents.session
        }

  return {
    ...options,
    width: typeof options.width === 'number' ? options.width : 960,
    height: typeof options.height === 'number' ? options.height : 720,
    minWidth: typeof options.minWidth === 'number' ? options.minWidth : 480,
    minHeight: typeof options.minHeight === 'number' ? options.minHeight : 360,
    parent: options.parent ?? parentWindow,
    autoHideMenuBar: true,
    show: false,
    webPreferences,
    ...(process.platform !== 'darwin' && iconPath ? { icon: iconPath } : {})
  }
}

function trackPopupWindow(popupWindow: BrowserWindow): void {
  popupWindows.add(popupWindow)
  popupWindow.once('closed', () => {
    popupWindows.delete(popupWindow)
  })
}

function attachPopupSupport(
  sourceContents: WebContents,
  iconPath: string | null,
  hostContents?: WebContents,
  sourceTabId?: string
): void {
  sourceContents.setWindowOpenHandler((details) => {
    const openerTabId = sourceTabId ?? findLiveTabIdByWebContentsId(sourceContents.id)
    console.log(
      `[main] popup requested opener=${sourceContents.id} tab=${openerTabId ?? 'unknown'} disposition=${details.disposition} url=${details.url}`
    )

    if (
      (details.disposition === 'foreground-tab' || details.disposition === 'background-tab') &&
      openerTabId &&
      hostContents &&
      !hostContents.isDestroyed()
    ) {
      hostContents.send('browserTabs:openLinkInNewTabRequested', {
        sourceTabId: openerTabId,
        url: details.url,
        disposition: details.disposition
      })
      console.log(
        `[main] routed tab-open opener=${sourceContents.id} tab=${openerTabId} disposition=${details.disposition} url=${details.url}`
      )
      return { action: 'deny' }
    }

    return {
      action: 'allow',
      createWindow: (options) => {
        const popupOptions = buildPopupWindowOptions(options, sourceContents, iconPath)
        const popupWindow = new BrowserWindow(popupOptions)
        trackPopupWindow(popupWindow)
        popupWindow.setMenuBarVisibility(false)
        console.log(
          `[main] popup created opener=${sourceContents.id} window=${popupWindow.id} url=${details.url} parent=${popupOptions.parent ? 'yes' : 'no'}`
        )

        const showAndFocusPopup = (): void => {
          if (popupWindow.isDestroyed()) return
          popupWindow.show()
          popupWindow.focus()
        }

        popupWindow.once('ready-to-show', showAndFocusPopup)
        popupWindow.webContents.once('dom-ready', showAndFocusPopup)
        popupWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
          if (errorCode === -3) return
          console.warn(
            `[main] popup load failed window=${popupWindow.id} code=${errorCode} url=${validatedURL} error=${errorDescription}`
          )
        })

        attachPopupSupport(popupWindow.webContents, iconPath, hostContents, openerTabId)
        return popupWindow.webContents
      }
    }
  })
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

  mainWindow.webContents.on('did-attach-webview', (_event, guestContents) => {
    attachPopupSupport(guestContents, iconPath, mainWindow.webContents)
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

  autoUpdater.on('update-not-available', () => {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('updater:update-not-available')
    }
  })

  autoUpdater.on('error', (error) => {
    console.warn('[updater] Error checking for updates:', error.message)
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('updater:error', error.message)
    }
  })

  ipcMain.handle('app:setBadgeCount', (_e: Electron.IpcMainInvokeEvent, count: number) => {
    app.setBadgeCount(count)
  })

  ipcMain.handle('updater:check', async () => {
    await autoUpdater.checkForUpdates()
  })
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
