import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { app } from 'electron'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { getDb } from '../db/client'
import { settings } from '../db/schema'

const WORKSPACE_ROOT_SETTING_KEY = 'workspaceRootDir'
const WORKSPACE_ACTIVE_BOARD_KEY = 'activeBoardId'
const DEFAULT_WORKSPACE_DIRNAME = 'Hoo Workspace'
const BOARD_FILE_SUFFIX = '.board.json'

export interface WorkspaceFolderSnapshot {
  id: string
  name: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface WorkspaceBoardSnapshot {
  id: string
  folderId: string | null
  name: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface WorkspaceSnapshot {
  rootDir: string
  activeBoardId: string | null
  folders: WorkspaceFolderSnapshot[]
  boards: WorkspaceBoardSnapshot[]
}

export type BoardViewMode = 'whiteboard' | 'tabs' | 'document'

export interface BoardDocument {
  version: 1
  tabs: Array<Record<string, unknown>>
  graphNodes: Array<Record<string, unknown>>
  edges: Array<Record<string, unknown>>
  documentHtml?: string
  activeView?: BoardViewMode
}

function parseStringSetting(rawValue: string | null | undefined): string | null {
  if (!rawValue) return null
  try {
    const parsed = JSON.parse(rawValue) as unknown
    if (typeof parsed === 'string') {
      const trimmed = parsed.trim()
      return trimmed.length > 0 ? trimmed : null
    }
  } catch {
    const trimmed = rawValue.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  return null
}

function upsertAppSetting(key: string, value: unknown): void {
  const db = getDb()
  const jsonValue = JSON.stringify(value)
  const existing = db.select().from(settings).where(eq(settings.key, key)).get()
  if (existing) {
    db.update(settings).set({ value: jsonValue }).where(eq(settings.key, key)).run()
    return
  }
  db.insert(settings).values({ key, value: jsonValue }).run()
}

function isoFromFsTime(ms: number): string {
  const ts = Number.isFinite(ms) && ms > 0 ? ms : Date.now()
  return new Date(ts).toISOString()
}

function sanitizePathName(rawName: string | undefined, fallback: string): string {
  const trimmed = (rawName ?? '').trim()
  const base = trimmed.length > 0 ? trimmed : fallback
  return base
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || fallback
}

function normalizeFolderId(folderId: string): string {
  const normalized = folderId.replace(/\\/g, '/').trim()
  if (!normalized || normalized === '.' || normalized === '..' || normalized.includes('/')) {
    throw new Error('Invalid folder id')
  }
  return normalized
}

function normalizeBoardId(boardId: string): string {
  const normalized = boardId
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .join('/')
  if (
    !normalized ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    normalized === '..' ||
    normalized.startsWith('/') ||
    !normalized.endsWith(BOARD_FILE_SUFFIX)
  ) {
    throw new Error('Invalid board id')
  }
  return normalized
}

function boardNameFromId(boardId: string): string {
  const filename = basename(boardId)
  return filename.slice(0, -BOARD_FILE_SUFFIX.length)
}

function defaultBoardDocument(): BoardDocument {
  return {
    version: 1,
    tabs: [],
    graphNodes: [],
    edges: []
  }
}

function templateTab(title: string, url: string, flowX: number, flowY: number): Record<string, unknown> {
  const now = new Date().toISOString()
  return {
    id: `tab-${randomUUID()}`,
    title,
    url,
    favicon: null,
    screenshot: null,
    monitors: null,
    flowX,
    flowY,
    createdAt: now,
    updatedAt: now
  }
}

function templateGraphNode(
  nodeType: string,
  label: string,
  config: Record<string, unknown>,
  flowX: number,
  flowY: number
): Record<string, unknown> {
  const now = new Date().toISOString()
  return {
    id: `gn-${randomUUID()}`,
    nodeType,
    label,
    config: JSON.stringify(config),
    flowX,
    flowY,
    createdAt: now,
    updatedAt: now
  }
}

function templateEdge(sourceId: string, targetId: string, sourceHandle?: string): Record<string, unknown> {
  return {
    id: `edge-${randomUUID()}`,
    source: sourceId,
    target: targetId,
    ...(sourceHandle ? { sourceHandle } : {})
  }
}

async function seedDefaultWorkspace(rootDir: string): Promise<string[]> {
  const createdFiles: string[] = []

  // ── Folder: Discover ─────────────────────────────────────────
  const discoverDir = join(rootDir, 'Discover')
  await fs.mkdir(discoverDir, { recursive: true })

  // Board: News Feed — Hacker News with AI summary trigger
  const hnTab = templateTab('Hacker News', 'https://news.ycombinator.com', 0, 0)
  const hnTrigger = templateGraphNode('trigger', 'Summarise', {}, -300, 0)
  const hnPrompt = templateGraphNode(
    'aiPrompt',
    'Summarise HN',
    { prompt: 'Summarise the top stories on this page. Give a brief one-liner for each of the top 10 stories with their points and comment count.' },
    -300,
    200
  )
  const hnOutput = templateGraphNode('output', 'Summary', {}, -300, 400)
  const newsFeedDoc: BoardDocument = {
    version: 1,
    tabs: [hnTab],
    graphNodes: [hnTrigger, hnPrompt, hnOutput],
    edges: [
      templateEdge(hnTrigger.id as string, hnTab.id as string),
      templateEdge(hnTab.id as string, hnPrompt.id as string),
      templateEdge(hnPrompt.id as string, hnOutput.id as string)
    ]
  }
  const newsFeedPath = join(discoverDir, `News Feed${BOARD_FILE_SUFFIX}`)
  await fs.writeFile(newsFeedPath, JSON.stringify(newsFeedDoc, null, 2), 'utf8')
  createdFiles.push(newsFeedPath)

  // Board: Browse — starter tabs for browsing
  const browseDoc: BoardDocument = {
    version: 1,
    tabs: [
      templateTab('Google', 'https://www.google.com', 0, 0),
      templateTab('Reddit', 'https://www.reddit.com', 300, 0),
      templateTab('GitHub Trending', 'https://github.com/trending', 600, 0)
    ],
    graphNodes: [],
    edges: []
  }
  const browsePath = join(discoverDir, `Browse${BOARD_FILE_SUFFIX}`)
  await fs.writeFile(browsePath, JSON.stringify(browseDoc, null, 2), 'utf8')
  createdFiles.push(browsePath)

  // ── Folder: Work ─────────────────────────────────────────────
  const workDir = join(rootDir, 'Work')
  await fs.mkdir(workDir, { recursive: true })

  // Board: Daily — Gmail, Calendar, common work links
  const dailyDoc: BoardDocument = {
    version: 1,
    tabs: [
      templateTab('Gmail', 'https://mail.google.com', 0, 0),
      templateTab('Google Calendar', 'https://calendar.google.com', 300, 0),
      templateTab('Google Drive', 'https://drive.google.com', 600, 0),
      templateTab('Notion', 'https://www.notion.so', 0, 300)
    ],
    graphNodes: [],
    edges: []
  }
  const dailyPath = join(workDir, `Daily${BOARD_FILE_SUFFIX}`)
  await fs.writeFile(dailyPath, JSON.stringify(dailyDoc, null, 2), 'utf8')
  createdFiles.push(dailyPath)

  // Board: Research — blank board for research workflows
  const researchDoc: BoardDocument = {
    version: 1,
    tabs: [],
    graphNodes: [],
    edges: []
  }
  const researchPath = join(workDir, `Research${BOARD_FILE_SUFFIX}`)
  await fs.writeFile(researchPath, JSON.stringify(researchDoc, null, 2), 'utf8')
  createdFiles.push(researchPath)

  return createdFiles
}

function isValidBoardViewMode(v: unknown): v is BoardViewMode {
  return v === 'whiteboard' || v === 'tabs' || v === 'document'
}

function normalizeBoardDocument(raw: unknown): BoardDocument {
  const value = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const doc: BoardDocument = {
    version: 1,
    tabs: Array.isArray(value.tabs) ? (value.tabs as Array<Record<string, unknown>>) : [],
    graphNodes: Array.isArray(value.graphNodes) ? (value.graphNodes as Array<Record<string, unknown>>) : [],
    edges: Array.isArray(value.edges) ? (value.edges as Array<Record<string, unknown>>) : []
  }
  if (typeof value.documentHtml === 'string') {
    doc.documentHtml = value.documentHtml
  }
  if (isValidBoardViewMode(value.activeView)) {
    doc.activeView = value.activeView
  }
  return doc
}

function toBoardId(rootDir: string, absolutePath: string): string {
  const rel = relative(rootDir, absolutePath).replace(/\\/g, '/')
  return normalizeBoardId(rel)
}

function toBoardPath(rootDir: string, boardId: string): string {
  const normalized = normalizeBoardId(boardId)
  const resolvedRoot = resolve(rootDir)
  const absolute = resolve(rootDir, ...normalized.split('/'))
  if (!(absolute === resolvedRoot || absolute.startsWith(`${resolvedRoot}${sep}`))) {
    throw new Error('Board path escapes workspace root')
  }
  return absolute
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

async function ensureUniquePath(
  directory: string,
  baseName: string,
  suffix: string
): Promise<string> {
  let counter = 1
  while (true) {
    const candidate =
      counter === 1
        ? join(directory, `${baseName}${suffix}`)
        : join(directory, `${baseName} (${counter})${suffix}`)
    if (!(await fileExists(candidate))) return candidate
    counter += 1
  }
}

async function listBoardFilesInDirectory(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(BOARD_FILE_SUFFIX))
    .map((entry) => join(directory, entry.name))
}

async function listWorkspaceBoardFiles(rootDir: string): Promise<string[]> {
  const boardFiles: string[] = []
  boardFiles.push(...(await listBoardFilesInDirectory(rootDir)))

  const entries = await fs.readdir(rootDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.')) continue
    const folderPath = join(rootDir, entry.name)
    boardFiles.push(...(await listBoardFilesInDirectory(folderPath)))
  }

  boardFiles.sort((a, b) => a.localeCompare(b))
  return boardFiles
}

function tableExists(sqlite: Database.Database, tableName: string): boolean {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name?: string } | undefined
  return !!row?.name
}

async function migrateLegacyWorkspaceDb(rootDir: string): Promise<number> {
  const legacyDbPath = join(rootDir, 'workspace.db')
  if (!(await fileExists(legacyDbPath))) return 0

  const sqlite = new Database(legacyDbPath, { readonly: true })
  let migratedCount = 0
  try {
    if (!tableExists(sqlite, 'workspace_boards')) return 0

    const legacyFolders = tableExists(sqlite, 'workspace_folders')
      ? (sqlite
          .prepare(
            `SELECT id, name
             FROM workspace_folders
             ORDER BY sort_order ASC, created_at ASC`
          )
          .all() as Array<{ id: string; name: string }>)
      : []

    const legacyBoards = sqlite
      .prepare(
        `SELECT id, folder_id AS folderId, name
         FROM workspace_boards
         ORDER BY sort_order ASC, created_at ASC`
      )
      .all() as Array<{ id: string; folderId: string | null; name: string }>

    if (legacyBoards.length === 0) return 0

    const folderPathByLegacyId = new Map<string, string>()
    for (const folder of legacyFolders) {
      const safeFolder = sanitizePathName(folder.name, 'Folder')
      const folderPath = await ensureUniquePath(rootDir, safeFolder, '')
      await fs.mkdir(folderPath, { recursive: true })
      folderPathByLegacyId.set(folder.id, folderPath)
    }

    const oldToNewBoardId = new Map<string, string>()
    for (const board of legacyBoards) {
      const targetDir = board.folderId
        ? folderPathByLegacyId.get(board.folderId) ?? rootDir
        : rootDir
      await fs.mkdir(targetDir, { recursive: true })
      const boardBase = sanitizePathName(board.name, 'Board')
      const boardPath = await ensureUniquePath(targetDir, boardBase, BOARD_FILE_SUFFIX)

      const tabs = tableExists(sqlite, 'workspace_browser_tabs')
        ? (sqlite
            .prepare(
              `SELECT
                 id, title, url, favicon, screenshot, monitors,
                 flow_x AS flowX, flow_y AS flowY,
                 created_at AS createdAt, updated_at AS updatedAt
               FROM workspace_browser_tabs
               WHERE board_id = ?
               ORDER BY created_at ASC`
            )
            .all(board.id) as Array<Record<string, unknown>>)
        : []

      const graphNodes = tableExists(sqlite, 'workspace_graph_nodes')
        ? (sqlite
            .prepare(
              `SELECT
                 id, node_type AS nodeType, label, config,
                 flow_x AS flowX, flow_y AS flowY,
                 created_at AS createdAt, updated_at AS updatedAt
               FROM workspace_graph_nodes
               WHERE board_id = ?
               ORDER BY created_at ASC`
            )
            .all(board.id) as Array<Record<string, unknown>>)
        : []

      const edges = tableExists(sqlite, 'workspace_browser_edges')
        ? (sqlite
            .prepare(
              `SELECT
                 id,
                 source_node_id AS sourceNodeId,
                 target_node_id AS targetNodeId,
                 source_handle AS sourceHandle,
                 target_handle AS targetHandle
               FROM workspace_browser_edges
               WHERE board_id = ?`
            )
            .all(board.id) as Array<Record<string, unknown>>)
        : []

      const nextDoc: BoardDocument = {
        version: 1,
        tabs,
        graphNodes,
        edges
      }
      await fs.writeFile(boardPath, JSON.stringify(nextDoc, null, 2), 'utf8')
      oldToNewBoardId.set(board.id, toBoardId(rootDir, boardPath))
    }

    const legacyActiveBoardId = getWorkspaceActiveBoardId()
    if (legacyActiveBoardId && oldToNewBoardId.has(legacyActiveBoardId)) {
      setWorkspaceActiveBoardId(oldToNewBoardId.get(legacyActiveBoardId)!)
    }

    migratedCount = oldToNewBoardId.size
  } finally {
    sqlite.close()
  }

  if (migratedCount > 0) {
    const backupPath = join(rootDir, 'workspace.legacy.db')
    if (!(await fileExists(backupPath))) {
      await fs.rename(legacyDbPath, backupPath)
    }
  }

  return migratedCount
}

export function getWorkspaceRootDir(): string {
  const db = getDb()
  const row = db.select().from(settings).where(eq(settings.key, WORKSPACE_ROOT_SETTING_KEY)).get()
  const configured = parseStringSetting(row?.value)
  if (configured) return resolve(configured)
  return resolve(join(app.getPath('documents'), DEFAULT_WORKSPACE_DIRNAME))
}

export function setWorkspaceRootDir(rootDir: string): string {
  const trimmed = rootDir.trim()
  const nextRoot = resolve(trimmed.length > 0 ? trimmed : join(app.getPath('documents'), DEFAULT_WORKSPACE_DIRNAME))
  upsertAppSetting(WORKSPACE_ROOT_SETTING_KEY, nextRoot)
  return nextRoot
}

export function getWorkspaceActiveBoardId(): string | null {
  const db = getDb()
  const row = db.select().from(settings).where(eq(settings.key, WORKSPACE_ACTIVE_BOARD_KEY)).get()
  return parseStringSetting(row?.value)
}

export function setWorkspaceActiveBoardId(boardId: string): void {
  upsertAppSetting(WORKSPACE_ACTIVE_BOARD_KEY, normalizeBoardId(boardId))
}

export function clearWorkspaceActiveBoardId(): void {
  upsertAppSetting(WORKSPACE_ACTIVE_BOARD_KEY, null)
}

export function resolveBoardId(boardId?: string | null): string | null {
  if (boardId && boardId.trim().length > 0) {
    return normalizeBoardId(boardId)
  }
  const active = getWorkspaceActiveBoardId()
  if (!active) return null
  try {
    return normalizeBoardId(active)
  } catch {
    return null
  }
}

export async function ensureWorkspaceRootExists(): Promise<string> {
  const rootDir = getWorkspaceRootDir()
  await fs.mkdir(rootDir, { recursive: true })
  return rootDir
}

export async function ensureWorkspaceInitialized(): Promise<void> {
  const rootDir = await ensureWorkspaceRootExists()
  const legacyDbPath = join(rootDir, 'workspace.db')
  const legacyBackupPath = join(rootDir, 'workspace.legacy.db')
  let boardFiles = await listWorkspaceBoardFiles(rootDir)
  if (boardFiles.length === 0) {
    await migrateLegacyWorkspaceDb(rootDir)
    boardFiles = await listWorkspaceBoardFiles(rootDir)
    if (boardFiles.length === 0) {
      const seeded = await seedDefaultWorkspace(rootDir)
      boardFiles = seeded.length > 0 ? seeded : boardFiles
      if (boardFiles.length === 0) {
        const filePath = await ensureUniquePath(rootDir, 'Board 1', BOARD_FILE_SUFFIX)
        await fs.writeFile(filePath, JSON.stringify(defaultBoardDocument(), null, 2), 'utf8')
        boardFiles = [filePath]
      }
    }
  }

  if (boardFiles.length > 0 && (await fileExists(legacyDbPath)) && !(await fileExists(legacyBackupPath))) {
    try {
      await fs.rename(legacyDbPath, legacyBackupPath)
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code !== 'ENOENT') {
        throw error
      }
    }
  }

  const active = getWorkspaceActiveBoardId()
  if (active) {
    try {
      const activePath = toBoardPath(rootDir, active)
      if (await fileExists(activePath)) return
    } catch {
      // fallthrough to reset active board id
    }
  }

  setWorkspaceActiveBoardId(toBoardId(rootDir, boardFiles[0]))
}

export async function boardExists(boardId: string): Promise<boolean> {
  const rootDir = await ensureWorkspaceRootExists()
  const boardPath = toBoardPath(rootDir, boardId)
  return fileExists(boardPath)
}

export async function readBoardDocument(boardId: string): Promise<BoardDocument> {
  const rootDir = await ensureWorkspaceRootExists()
  const boardPath = toBoardPath(rootDir, boardId)
  const maxRetries = 3
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const raw = await fs.readFile(boardPath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      return normalizeBoardDocument(parsed)
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code === 'ENOENT') {
        const doc = defaultBoardDocument()
        await fs.mkdir(dirname(boardPath), { recursive: true })
        await fs.writeFile(boardPath, JSON.stringify(doc, null, 2), 'utf8')
        return doc
      }
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 20 * attempt))
        continue
      }
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to read board document "${boardId}": ${message}`)
    }
  }
  throw new Error(`Failed to read board document "${boardId}"`)
}

export async function writeBoardDocument(boardId: string, doc: BoardDocument): Promise<void> {
  const rootDir = await ensureWorkspaceRootExists()
  const boardPath = toBoardPath(rootDir, boardId)
  const tempPath = `${boardPath}.${process.pid}.${Date.now().toString(36)}.tmp`
  await fs.mkdir(dirname(boardPath), { recursive: true })
  const payload = JSON.stringify(normalizeBoardDocument(doc), null, 2)
  await fs.writeFile(tempPath, payload, 'utf8')
  try {
    await fs.rename(tempPath, boardPath)
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {})
    throw error
  }
}

export async function createFolderInWorkspace(name?: string): Promise<string> {
  const rootDir = await ensureWorkspaceRootExists()
  const folderBase = sanitizePathName(name, 'New Folder')
  const folderPath = await ensureUniquePath(rootDir, folderBase, '')
  await fs.mkdir(folderPath, { recursive: true })
  return basename(folderPath)
}

export async function renameFolderInWorkspace(folderId: string, name: string): Promise<string> {
  const rootDir = await ensureWorkspaceRootExists()
  const normalizedFolderId = normalizeFolderId(folderId)
  const sourcePath = join(rootDir, normalizedFolderId)
  const targetBase = sanitizePathName(name, 'Untitled Folder')
  const targetPath = await ensureUniquePath(rootDir, targetBase, '')
  await fs.rename(sourcePath, targetPath)

  const activeId = getWorkspaceActiveBoardId()
  if (activeId && activeId.startsWith(`${normalizedFolderId}/`)) {
    const nextActive = `${basename(targetPath)}/${activeId.slice(normalizedFolderId.length + 1)}`
    setWorkspaceActiveBoardId(nextActive)
  }

  return basename(targetPath)
}

export async function deleteFolderInWorkspace(folderId: string): Promise<void> {
  const rootDir = await ensureWorkspaceRootExists()
  const normalizedFolderId = normalizeFolderId(folderId)
  const folderPath = join(rootDir, normalizedFolderId)
  const boardFiles = await listBoardFilesInDirectory(folderPath)

  const activeId = getWorkspaceActiveBoardId()
  for (const boardPath of boardFiles) {
    const boardName = basename(boardPath, BOARD_FILE_SUFFIX)
    const targetPath = await ensureUniquePath(rootDir, boardName, BOARD_FILE_SUFFIX)
    await fs.rename(boardPath, targetPath)

    if (activeId) {
      const oldBoardId = `${normalizedFolderId}/${basename(boardPath)}`
      if (activeId === oldBoardId) {
        setWorkspaceActiveBoardId(toBoardId(rootDir, targetPath))
      }
    }
  }

  await fs.rm(folderPath, { recursive: true, force: true })
}

export async function createBoardInWorkspace(payload?: {
  name?: string
  folderId?: string | null
}): Promise<string> {
  const rootDir = await ensureWorkspaceRootExists()
  const folderId = payload?.folderId?.trim() ? normalizeFolderId(payload.folderId) : null
  const targetDir = folderId ? join(rootDir, folderId) : rootDir
  await fs.mkdir(targetDir, { recursive: true })

  const boardBase = sanitizePathName(payload?.name, 'New Board')
  const boardPath = await ensureUniquePath(targetDir, boardBase, BOARD_FILE_SUFFIX)
  await fs.writeFile(boardPath, JSON.stringify(defaultBoardDocument(), null, 2), 'utf8')
  return toBoardId(rootDir, boardPath)
}

export async function renameBoardInWorkspace(boardId: string, name: string): Promise<string> {
  const rootDir = await ensureWorkspaceRootExists()
  const normalizedBoardId = normalizeBoardId(boardId)
  const sourcePath = toBoardPath(rootDir, normalizedBoardId)
  const sourceDir = join(sourcePath, '..')
  const boardBase = sanitizePathName(name, 'Untitled Board')
  const targetPath = await ensureUniquePath(sourceDir, boardBase, BOARD_FILE_SUFFIX)
  await fs.rename(sourcePath, targetPath)
  const nextBoardId = toBoardId(rootDir, targetPath)

  if (getWorkspaceActiveBoardId() === normalizedBoardId) {
    setWorkspaceActiveBoardId(nextBoardId)
  }

  return nextBoardId
}

export async function moveBoardInWorkspace(
  boardId: string,
  folderId?: string | null
): Promise<string> {
  const rootDir = await ensureWorkspaceRootExists()
  const normalizedBoardId = normalizeBoardId(boardId)
  const sourcePath = toBoardPath(rootDir, normalizedBoardId)
  const normalizedFolder = folderId?.trim() ? normalizeFolderId(folderId) : null
  const targetDir = normalizedFolder ? join(rootDir, normalizedFolder) : rootDir
  await fs.mkdir(targetDir, { recursive: true })

  const sourceName = basename(sourcePath, BOARD_FILE_SUFFIX)
  const targetPath = await ensureUniquePath(targetDir, sourceName, BOARD_FILE_SUFFIX)
  await fs.rename(sourcePath, targetPath)
  const nextBoardId = toBoardId(rootDir, targetPath)

  if (getWorkspaceActiveBoardId() === normalizedBoardId) {
    setWorkspaceActiveBoardId(nextBoardId)
  }

  return nextBoardId
}

export async function deleteBoardInWorkspace(boardId: string): Promise<void> {
  const rootDir = await ensureWorkspaceRootExists()
  const normalizedBoardId = normalizeBoardId(boardId)
  const boardPath = toBoardPath(rootDir, normalizedBoardId)
  await fs.rm(boardPath, { force: true })
  await ensureWorkspaceInitialized()
}

export async function getWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
  await ensureWorkspaceInitialized()
  const rootDir = getWorkspaceRootDir()

  const rootEntries = await fs.readdir(rootDir, { withFileTypes: true })
  const folderEntries = rootEntries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name))

  const folders: WorkspaceFolderSnapshot[] = await Promise.all(
    folderEntries.map(async (entry, index) => {
      const folderPath = join(rootDir, entry.name)
      const stat = await fs.stat(folderPath)
      return {
        id: entry.name,
        name: entry.name,
        sortOrder: index,
        createdAt: isoFromFsTime(stat.birthtimeMs),
        updatedAt: isoFromFsTime(stat.mtimeMs)
      }
    })
  )

  const boardFiles = await listWorkspaceBoardFiles(rootDir)
  const boards: WorkspaceBoardSnapshot[] = await Promise.all(
    boardFiles.map(async (boardPath, index) => {
      const stat = await fs.stat(boardPath)
      const boardId = toBoardId(rootDir, boardPath)
      const folderName = boardId.includes('/') ? boardId.split('/')[0] : null
      return {
        id: boardId,
        folderId: folderName,
        name: boardNameFromId(boardId),
        sortOrder: index,
        createdAt: isoFromFsTime(stat.birthtimeMs),
        updatedAt: isoFromFsTime(stat.mtimeMs)
      }
    })
  )

  let activeBoardId = resolveBoardId()
  if (!activeBoardId || !boards.some((board) => board.id === activeBoardId)) {
    activeBoardId = boards[0]?.id ?? null
    if (activeBoardId) {
      setWorkspaceActiveBoardId(activeBoardId)
    } else {
      clearWorkspaceActiveBoardId()
    }
  }

  return {
    rootDir,
    activeBoardId,
    folders,
    boards
  }
}

export async function getBoardIdForTabId(tabId: string): Promise<string | null> {
  const snapshot = await getWorkspaceSnapshot()
  for (const board of snapshot.boards) {
    const doc = await readBoardDocument(board.id)
    if (doc.tabs.some((tab) => tab.id === tabId)) {
      return board.id
    }
  }
  return null
}

export async function removeBoardFileById(boardId: string): Promise<void> {
  const rootDir = await ensureWorkspaceRootExists()
  const boardPath = toBoardPath(rootDir, boardId)
  await fs.rm(boardPath, { force: true })
}

export function generateBoardRecordId(prefix: 'tab' | 'gn'): string {
  return `${prefix}-${randomUUID()}`
}

export function getBoardFileSuffix(): string {
  return BOARD_FILE_SUFFIX
}

export function boardNameFromBoardId(boardId: string): string {
  return boardNameFromId(boardId)
}

export function boardFileNameFromName(name: string): string {
  return `${sanitizePathName(name, 'Board')}${BOARD_FILE_SUFFIX}`
}

export function boardFileExtname(boardFilePath: string): string {
  return extname(boardFilePath)
}
