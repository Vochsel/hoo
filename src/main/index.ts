import { app, shell, BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { getDb } from './db/client'
import { registerSettingsHandlers } from './ipc/settings'
import { registerBrowserTabHandlers } from './ipc/browser-tabs'

function resolveAppIconPath(): string | null {
  const preferredFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
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
    ...(isMac ? { trafficLightPosition: { x: 15, y: 10 } } : {}),
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

app.setName('Hoo')

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.hoo.app')
  const iconPath = resolveAppIconPath()

  if (process.platform === 'darwin' && iconPath) {
    app.dock?.setIcon(iconPath)
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  getDb()
  registerSettingsHandlers()
  registerBrowserTabHandlers()

  createWindow(iconPath)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(iconPath)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
