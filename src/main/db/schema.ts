import { sqliteTable, text, real } from 'drizzle-orm/sqlite-core'

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})

export const browserTabs = sqliteTable('browser_tabs', {
  id: text('id').primaryKey(),
  title: text('title').notNull().default('New Tab'),
  url: text('url').notNull().default('about:blank'),
  favicon: text('favicon'),
  screenshot: text('screenshot'),
  monitors: text('monitors'),
  flowX: real('flow_x').notNull().default(0),
  flowY: real('flow_y').notNull().default(0),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString())
})

export const browserTabMessages = sqliteTable('browser_tab_messages', {
  id: text('id').primaryKey(),
  tabId: text('tab_id')
    .notNull()
    .references(() => browserTabs.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant'] }).notNull(),
  content: text('content').notNull(),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString())
})

export const graphNodes = sqliteTable('graph_nodes', {
  id: text('id').primaryKey(),
  nodeType: text('node_type', { enum: ['trigger', 'scheduleTrigger', 'formTrigger', 'debug', 'notification', 'aiPrompt', 'delay', 'text', 'output', 'file'] }).notNull(),
  label: text('label').notNull().default(''),
  config: text('config').notNull().default('{}'),
  flowX: real('flow_x').notNull().default(0),
  flowY: real('flow_y').notNull().default(0),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString())
})

export const browserEdges = sqliteTable('browser_edges', {
  id: text('id').primaryKey(),
  sourceNodeId: text('source_node_id').notNull(),
  targetNodeId: text('target_node_id').notNull(),
  sourceHandle: text('source_handle'),
  targetHandle: text('target_handle')
})
