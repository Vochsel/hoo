import { app } from 'electron'
import { join } from 'path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'
import { seed } from './seed'

let db: ReturnType<typeof drizzle<typeof schema>>

export function closeDb(): void {
  db = undefined as unknown as typeof db
}

export function getDb(): typeof db {
  if (!db) {
    const dbPath = join(app.getPath('userData'), 'browser-extract.db')
    const sqlite = new Database(dbPath)
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('foreign_keys = ON')

    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS browser_tabs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'New Tab',
        url TEXT NOT NULL DEFAULT 'about:blank',
        favicon TEXT,
        screenshot TEXT,
        monitors TEXT,
        flow_x REAL NOT NULL DEFAULT 0,
        flow_y REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS browser_tab_messages (
        id TEXT PRIMARY KEY,
        tab_id TEXT NOT NULL REFERENCES browser_tabs(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS graph_nodes (
        id TEXT PRIMARY KEY,
        node_type TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        config TEXT NOT NULL DEFAULT '{}',
        flow_x REAL NOT NULL DEFAULT 0,
        flow_y REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS browser_edges (
        id TEXT PRIMARY KEY,
        source_node_id TEXT NOT NULL,
        target_node_id TEXT NOT NULL,
        source_handle TEXT,
        target_handle TEXT
      );
    `)

    db = drizzle(sqlite, { schema })
    seed(db)
  }

  return db
}
