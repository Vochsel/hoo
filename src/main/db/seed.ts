import { eq } from 'drizzle-orm'
import { settings } from './schema'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type * as schema from './schema'

type Db = BetterSQLite3Database<typeof schema>

const defaultSettings = [
  { key: 'browserAiModel', value: JSON.stringify('claude-sonnet-4-6') },
  { key: 'theme', value: JSON.stringify('system') }
]

export function seed(db: Db): void {
  for (const setting of defaultSettings) {
    const existing = db.select().from(settings).where(eq(settings.key, setting.key)).get()
    if (!existing) {
      db.insert(settings).values(setting).run()
    }
  }
}
