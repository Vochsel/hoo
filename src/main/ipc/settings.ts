import { ipcMain, app } from 'electron'
import { eq } from 'drizzle-orm'
import { getDb } from '../db/client'
import { settings } from '../db/schema'

export function registerSettingsHandlers(): void {
  ipcMain.handle('app:restart', async () => {
    app.relaunch()
    app.exit(0)
  })

  ipcMain.handle('settings:get', async (_e, key: string) => {
    const db = getDb()
    const row = db.select().from(settings).where(eq(settings.key, key)).get()
    return row ? JSON.parse(row.value) : null
  })

  ipcMain.handle('settings:set', async (_e, key: string, value: unknown) => {
    const db = getDb()
    const jsonValue = JSON.stringify(value)
    const existing = db.select().from(settings).where(eq(settings.key, key)).get()
    if (existing) {
      db.update(settings).set({ value: jsonValue }).where(eq(settings.key, key)).run()
    } else {
      db.insert(settings).values({ key, value: jsonValue }).run()
    }
    return { success: true }
  })

  ipcMain.handle('settings:getAll', async () => {
    const db = getDb()
    const rows = db.select().from(settings).all()
    const result: Record<string, unknown> = {}
    for (const row of rows) {
      result[row.key] = JSON.parse(row.value)
    }
    return result
  })
}
