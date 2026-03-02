import { ipcMain, webContents, Notification, dialog, BrowserWindow, nativeImage } from 'electron'
import { exec } from 'child_process'
import { promises as fs } from 'node:fs'
import { watch as fsWatch, type FSWatcher } from 'node:fs'
import { dirname } from 'node:path'
import { eq, asc } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { generateText } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { getDb as getAppDb } from '../db/client'
import { browserTabMessages, browserTabs } from '../db/schema'
import {
  type BoardDocument,
  resolveBoardId,
  readBoardDocument,
  writeBoardDocument,
  boardExists,
  ensureWorkspaceInitialized,
  generateBoardRecordId,
  getBoardIdForTabId
} from '../services/workspace-files'
import { runBrowserAgent, abortBrowserAgent, getModelConfig, getSetting } from '../services/browser-agent'
import { generateMonitorRule } from '../services/monitor-evaluator'

const TAG = '[browser-tabs]'
const PROMPT_TAG = '[graph-ai-prompt]'
const INTERACTIVE_SELECTOR =
  'a[href], button, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"], [role="row"], [role="checkbox"], [role="switch"], [role="textbox"], [aria-label], [data-tooltip], [onclick], [data-action]'

interface ChatPageContext {
  url: string
  title: string
  text: string
  elements: string
  screenshot?: string
  webContentsId?: number
  includeScreenshot?: boolean
}

const liveTabWebContentsById = new Map<string, number>()

type UrlParts = {
  full: string
  noHash: string
  originPath: string
  origin: string
}

function splitUrlParts(raw: string | undefined): UrlParts {
  const input = (raw || '').trim()
  if (!input) {
    return { full: '', noHash: '', originPath: '', origin: '' }
  }
  try {
    const parsed = new URL(input)
    const noHash = `${parsed.origin}${parsed.pathname}${parsed.search}`
    const originPath = `${parsed.origin}${parsed.pathname}`
    return {
      full: parsed.toString(),
      noHash,
      originPath,
      origin: parsed.origin
    }
  } catch {
    return {
      full: input,
      noHash: input,
      originPath: input,
      origin: ''
    }
  }
}

function resolveChatWebContentsId(tabId: string, pageContext: ChatPageContext): number | undefined {
  const explicitWebContentsId =
    typeof pageContext.webContentsId === 'number' && Number.isFinite(pageContext.webContentsId)
      ? pageContext.webContentsId
      : undefined

  if (explicitWebContentsId !== undefined) {
    const explicitWc = webContents.fromId(explicitWebContentsId)
    if (explicitWc && !explicitWc.isDestroyed()) {
      liveTabWebContentsById.set(tabId, explicitWebContentsId)
      return explicitWebContentsId
    }
    console.warn(`${TAG} context resolve tab=${tabId} explicit wc=${explicitWebContentsId} invalid`)
  }

  const mappedWebContentsId = liveTabWebContentsById.get(tabId)
  if (mappedWebContentsId !== undefined) {
    const mappedWc = webContents.fromId(mappedWebContentsId)
    if (mappedWc && !mappedWc.isDestroyed()) {
      return mappedWebContentsId
    }
    liveTabWebContentsById.delete(tabId)
    console.warn(`${TAG} context resolve tab=${tabId} mapped wc=${mappedWebContentsId} stale`)
  }

  const target = splitUrlParts(pageContext.url)
  const all = webContents
    .getAllWebContents()
    .filter((wc) => {
      if (wc.isDestroyed()) return false
      const url = wc.getURL()
      if (url.startsWith('devtools://') || url.startsWith('chrome-devtools://')) return false
      return true
    })

  let bestId: number | undefined
  let bestScore = -1
  let bestUrl = ''
  let bestOriginMatchId: number | undefined
  let bestOriginMatchScore = -1
  let bestOriginMatchUrl = ''

  for (const wc of all) {
    const current = splitUrlParts(wc.getURL())
    let score = 0
    if (target.full && current.full === target.full) score += 1000
    if (target.noHash && current.noHash === target.noHash) score += 900
    if (target.originPath && current.originPath === target.originPath) score += 700
    if (target.origin && current.origin === target.origin) score += 350
    if (!target.full && current.full) score += 5
    if (wc.getTitle().trim().length > 0) score += 15
    try {
      if (wc.isFocused()) score += 20
    } catch {
      // ignore
    }

    if (target.origin && current.origin === target.origin && score > bestOriginMatchScore) {
      bestOriginMatchScore = score
      bestOriginMatchId = wc.id
      bestOriginMatchUrl = current.full
    }

    if (score > bestScore) {
      bestScore = score
      bestId = wc.id
      bestUrl = current.full
    }
  }

  if (bestOriginMatchId !== undefined) {
    liveTabWebContentsById.set(tabId, bestOriginMatchId)
    console.log(
      `${TAG} context resolve tab=${tabId} discovered origin-match wc=${bestOriginMatchId} score=${bestOriginMatchScore} url=${bestOriginMatchUrl}`
    )
    return bestOriginMatchId
  }

  const threshold = target.full ? 350 : 20
  if (bestId !== undefined && bestScore >= threshold) {
    liveTabWebContentsById.set(tabId, bestId)
    console.log(`${TAG} context resolve tab=${tabId} discovered wc=${bestId} score=${bestScore} url=${bestUrl}`)
    return bestId
  }

  if (all.length > 0) {
    const sample = all
      .slice(0, 6)
      .map((wc) => `${wc.id}:${wc.getType()}:${splitUrlParts(wc.getURL()).originPath || wc.getURL()}`)
      .join(' | ')
    console.warn(
      `${TAG} context resolve tab=${tabId} failed target=${target.originPath || pageContext.url || '(empty)'} candidates=${all.length} best=${bestId ?? 'none'} bestScore=${bestScore} sample=${sample}`
    )
  } else {
    console.warn(
      `${TAG} context resolve tab=${tabId} failed target=${target.originPath || pageContext.url || '(empty)'} no webContents candidates`
    )
  }

  return undefined
}

function preview(value: string | undefined, max = 180): string {
  if (!value) return ''
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, max)}...`
}

function flattenScreenshotOpaque(image: Electron.NativeImage): Electron.NativeImage {
  const { width, height } = image.getSize()
  if (width <= 0 || height <= 0) return image

  const bitmap = image.toBitmap()
  if (!bitmap || bitmap.length < width * height * 4) return image

  // Flatten onto white to eliminate alpha/transparency entirely.
  const out = Buffer.allocUnsafe(bitmap.length)
  for (let i = 0; i < bitmap.length; i += 4) {
    const b = bitmap[i]
    const g = bitmap[i + 1]
    const r = bitmap[i + 2]
    const a = bitmap[i + 3] / 255
    out[i] = Math.round(b * a + 255 * (1 - a))
    out[i + 1] = Math.round(g * a + 255 * (1 - a))
    out[i + 2] = Math.round(r * a + 255 * (1 - a))
    out[i + 3] = 255
  }

  return nativeImage.createFromBitmap(out, { width, height })
}

async function execCommand(command: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(error)
        return
      }
      if (stdout?.trim()) {
        console.log(`${TAG} command stdout: ${preview(stdout, 300)}`)
      }
      if (stderr?.trim()) {
        console.warn(`${TAG} command stderr: ${preview(stderr, 300)}`)
      }
      resolve()
    })
  })
}

function resolveBoardIdOrThrow(boardId?: string | null): string {
  const resolved = resolveBoardId(boardId)
  if (!resolved) {
    throw new Error('No active board selected')
  }
  return resolved
}

function normalizeLegacyTabRow(
  tabId: string,
  raw: Record<string, unknown> | null,
  now: string
): {
  id: string
  title: string
  url: string
  favicon: string | null
  screenshot: string | null
  monitors: string | null
  flowX: number
  flowY: number
  createdAt: string
  updatedAt: string
} {
  const title = typeof raw?.title === 'string' && raw.title.trim().length > 0 ? raw.title : 'New Tab'
  const url = typeof raw?.url === 'string' && raw.url.trim().length > 0 ? raw.url : 'about:blank'
  const flowX = typeof raw?.flowX === 'number' && Number.isFinite(raw.flowX) ? raw.flowX : 0
  const flowY = typeof raw?.flowY === 'number' && Number.isFinite(raw.flowY) ? raw.flowY : 0
  const createdAt = typeof raw?.createdAt === 'string' && raw.createdAt.trim().length > 0 ? raw.createdAt : now
  const updatedAt = typeof raw?.updatedAt === 'string' && raw.updatedAt.trim().length > 0 ? raw.updatedAt : now
  return {
    id: tabId,
    title,
    url,
    favicon: typeof raw?.favicon === 'string' ? raw.favicon : null,
    screenshot: typeof raw?.screenshot === 'string' ? raw.screenshot : null,
    monitors: typeof raw?.monitors === 'string' ? raw.monitors : null,
    flowX,
    flowY,
    createdAt,
    updatedAt
  }
}

async function findTabRecordInWorkspace(tabId: string, boardId?: string): Promise<Record<string, unknown> | null> {
  const candidateBoardIds: string[] = []
  if (boardId) {
    try {
      candidateBoardIds.push(resolveBoardIdOrThrow(boardId))
    } catch {
      // ignore invalid board id and continue with workspace lookup
    }
  }
  const ownerBoardId = await getBoardIdForTabId(tabId)
  if (ownerBoardId && !candidateBoardIds.includes(ownerBoardId)) {
    candidateBoardIds.push(ownerBoardId)
  }
  for (const candidate of candidateBoardIds) {
    try {
      const board = await readBoardDocument(candidate)
      const tab = board.tabs.find((entry) => String(entry.id) === tabId)
      if (tab) return tab
    } catch {
      // keep searching
    }
  }
  return null
}

async function ensureMessageParentTabRow(tabId: string, boardId?: string): Promise<void> {
  const db = getAppDb()
  const existing = db
    .select({ id: browserTabs.id })
    .from(browserTabs)
    .where(eq(browserTabs.id, tabId))
    .get()
  if (existing) return

  const now = new Date().toISOString()
  const workspaceTab = await findTabRecordInWorkspace(tabId, boardId)
  const row = normalizeLegacyTabRow(tabId, workspaceTab, now)

  try {
    db.insert(browserTabs).values(row).run()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('UNIQUE constraint failed')) {
      return
    }
    throw error
  }
}

function isSqliteForeignKeyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('FOREIGN KEY constraint failed') || message.includes('SQLITE_CONSTRAINT_FOREIGNKEY')
}

function countElementLines(elements: string): number {
  const trimmed = (elements || '').trim()
  if (!trimmed) return 0
  return trimmed.split('\n').filter((line) => line.trim().length > 0).length
}

function isSparsePageContext(context: ChatPageContext): boolean {
  const textLength = (context.text || '').trim().length
  const elementCount = countElementLines(context.elements || '')
  const hasScreenshot = typeof context.screenshot === 'string' && context.screenshot.length > 0
  const hasTitle = (context.title || '').trim().length > 0
  return textLength < 40 && elementCount <= 1 && !hasScreenshot && !hasTitle
}

function contextRichnessScore(context: ChatPageContext): number {
  const textScore = Math.min((context.text || '').trim().length, 8000)
  const elementsScore = Math.min(countElementLines(context.elements || '') * 80, 8000)
  const screenshotScore = context.screenshot ? 2500 : 0
  const titleScore = (context.title || '').trim().length > 0 ? 250 : 0
  return textScore + elementsScore + screenshotScore + titleScore
}

async function captureWebContentsScreenshotDataUrl(wc: Electron.WebContents): Promise<string | null> {
  let image: Electron.NativeImage | null = null
  let size = { width: 0, height: 0 }

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    image = await wc.capturePage()
    size = image.getSize()
    if (size.width > 0 && size.height > 0) {
      break
    }
    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 140))
    }
  }

  if (!image || size.width === 0 || size.height === 0) {
    console.warn(`${TAG} Screenshot: empty image (${size.width}x${size.height})`)
    return null
  }

  const opaque = flattenScreenshotOpaque(image)
  const opaqueSize = opaque.getSize()

  // Resize to 480px width for thumbnail
  const targetWidth = 480
  const scale = targetWidth / opaqueSize.width
  const resized = opaque.resize({
    width: targetWidth,
    height: Math.round(opaqueSize.height * scale)
  })

  const dataUrl = `data:image/png;base64,${resized.toPNG().toString('base64')}`
  console.log(
    `${TAG} Screenshot captured: ${size.width}x${size.height} opaque=${opaqueSize.width}x${opaqueSize.height} → ${targetWidth}x${Math.round(opaqueSize.height * scale)} (${Math.round(dataUrl.length / 1024)}KB)`
  )
  return dataUrl
}

async function executeFrameScript(frame: Electron.WebFrameMain, script: string): Promise<string> {
  try {
    const result = await frame.executeJavaScript(script, true)
    return typeof result === 'string' ? result : ''
  } catch {
    return ''
  }
}

function dedupeElementLines(raw: string): string {
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const line of lines) {
    if (seen.has(line)) continue
    seen.add(line)
    ordered.push(line)
    if (ordered.length >= 220) break
  }
  return ordered.join('\n')
}

async function buildPageContextFromWebContents(webContentsId: number, includeScreenshot: boolean): Promise<ChatPageContext | null> {
  const wc = webContents.fromId(webContentsId)
  if (!wc || wc.isDestroyed()) {
    return null
  }

  const textScript = `
    (() => {
      const out = [];
      const bodyText = (document.body && document.body.innerText) || (document.documentElement && document.documentElement.innerText) || '';
      if (bodyText && bodyText.trim()) out.push(bodyText.trim());

      const seen = new Set();
      const queue = [document];
      while (queue.length > 0) {
        const root = queue.shift();
        if (!root || !root.querySelectorAll) continue;
        const all = root.querySelectorAll('*');
        for (const el of all) {
          if (el && el.shadowRoot && !seen.has(el.shadowRoot)) {
            seen.add(el.shadowRoot);
            const txt = (el.shadowRoot.textContent || '').trim();
            if (txt) out.push(txt);
            queue.push(el.shadowRoot);
          }
        }
      }
      return out.join('\\n').replace(/\\s+/g, ' ').trim().slice(0, 8000);
    })()
  `

  const selectorLiteral = JSON.stringify(INTERACTIVE_SELECTOR)
  const elementsScript = `
    (() => {
      const sel = ${selectorLiteral};
      const isVisible = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        return true;
      };
      const isEditable = (el) => {
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role') || '';
        return tag === 'input' || tag === 'textarea' || tag === 'select' || role === 'textbox' || el.isContentEditable;
      };
      const roots = [document];
      const seenRoots = new Set([document]);
      for (let i = 0; i < roots.length; i++) {
        const root = roots[i];
        if (!root || !root.querySelectorAll) continue;
        const all = root.querySelectorAll('*');
        for (const el of all) {
          if (el && el.shadowRoot && !seenRoots.has(el.shadowRoot)) {
            seenRoots.add(el.shadowRoot);
            roots.push(el.shadowRoot);
          }
        }
      }
      const unique = new Set();
      const candidates = [];
      for (const root of roots) {
        if (!root || !root.querySelectorAll) continue;
        const matches = root.querySelectorAll(sel);
        for (const el of matches) {
          if (!el || unique.has(el)) continue;
          unique.add(el);
          candidates.push(el);
        }
      }

      const ranked = candidates
        .filter(isVisible)
        .map((el, domIndex) => {
          const tag = el.tagName.toLowerCase();
          const type = el.getAttribute('type') || '';
          const role = el.getAttribute('role') || '';
          const name = el.getAttribute('name') || '';
          const text = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 100);
          const placeholder = el.getAttribute('placeholder') || '';
          const ariaLabel = el.getAttribute('aria-label') || '';
          const title = el.getAttribute('title') || '';
          const dataTooltip = el.getAttribute('data-tooltip') || '';
          const href = el.getAttribute('href') || '';
          const editable = isEditable(el);
          const value = tag === 'input' || tag === 'textarea' || tag === 'select'
            ? String(el.value || '').slice(0, 60)
            : '';
          const r = el.getBoundingClientRect();
          let score = 0;
          if (editable) score += 60;
          if (tag === 'button' || role === 'button') score += 40;
          if (tag === 'a' || role === 'link') score += 35;
          if (role === 'menuitem' || role === 'option' || role === 'tab') score += 25;
          if (role === 'row') score += 20;
          if (text) score += 8;
          if (ariaLabel || placeholder || title || dataTooltip || name) score += 10;
          if (el.closest('[role="dialog"], [aria-modal="true"]')) score += 15;
          return {
            domIndex,
            top: r.top,
            left: r.left,
            score,
            tag,
            type,
            role,
            name,
            text,
            placeholder,
            ariaLabel,
            title,
            dataTooltip,
            href,
            editable,
            value
          };
        })
        .sort((a, b) => b.score - a.score || a.top - b.top || a.left - b.left || a.domIndex - b.domIndex)
        .slice(0, 140);

      return ranked.map((el, i) => {
        let desc = '[' + i + '] <' + el.tag + '>';
        if (el.type) desc += ' type=' + el.type;
        if (el.role) desc += ' role=' + el.role;
        if (el.name) desc += ' name=' + el.name;
        if (el.text) desc += ' text="' + el.text + '"';
        if (el.placeholder) desc += ' placeholder="' + el.placeholder + '"';
        if (el.ariaLabel) desc += ' aria-label="' + el.ariaLabel + '"';
        if (el.title) desc += ' title="' + el.title + '"';
        if (el.dataTooltip) desc += ' tooltip="' + el.dataTooltip + '"';
        if (el.href) desc += ' href="' + el.href + '"';
        if (el.editable) desc += ' editable=true';
        if (el.value) desc += ' value="' + el.value + '"';
        return desc;
      }).join('\\n');
    })()
  `

  const frames = wc.mainFrame?.framesInSubtree ?? []
  const textParts: string[] = []
  const elementParts: string[] = []
  for (const frame of frames) {
    if (!frame || frame.isDestroyed() || frame.detached) continue
    const [frameText, frameElements] = await Promise.all([
      executeFrameScript(frame, textScript),
      executeFrameScript(frame, elementsScript)
    ])
    if (frameText.trim().length > 0) {
      textParts.push(frameText.trim())
    }
    if (frameElements.trim().length > 0) {
      elementParts.push(frameElements.trim())
    }
  }

  const aggregatedText = textParts.join('\n\n').slice(0, 12000)
  const aggregatedElements = dedupeElementLines(elementParts.join('\n'))
  const context: ChatPageContext = {
    url: wc.getURL(),
    title: wc.getTitle(),
    text: aggregatedText,
    elements: aggregatedElements,
    webContentsId
  }

  if (includeScreenshot) {
    try {
      const shot = await captureWebContentsScreenshotDataUrl(wc)
      if (shot) {
        context.screenshot = shot
      }
    } catch (error) {
      console.warn(`${TAG} frame-context screenshot failed id=${webContentsId}:`, error)
    }
  }

  console.log(
    `${TAG} frame-context id=${webContentsId} frames=${frames.length} elements=${countElementLines(aggregatedElements)} text=${aggregatedText.length} screenshot=${context.screenshot ? 'yes' : 'no'}`
  )

  return context
}

async function insertTabMessageWithParentFallback(
  tabId: string,
  role: 'user' | 'assistant',
  content: string,
  boardId?: string
): Promise<void> {
  const db = getAppDb()
  const row = {
    id: nanoid(),
    tabId,
    role,
    content,
    createdAt: new Date().toISOString()
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      db.insert(browserTabMessages).values(row).run()
      return
    } catch (error) {
      if (!isSqliteForeignKeyError(error) || attempt === 2) {
        throw error
      }
      console.warn(`${TAG} message insert missing parent row tab=${tabId}; repairing and retrying`)
      await ensureMessageParentTabRow(tabId, boardId)
    }
  }
}

async function tabBelongsToBoard(tabId: string, boardId?: string): Promise<boolean> {
  if (!boardId) return true
  try {
    if (!(await boardExists(boardId))) return false
    const board = await readBoardDocument(boardId)
    return board.tabs.some((tab) => tab.id === tabId)
  } catch {
    return false
  }
}

const boardMutationQueues = new Map<string, Promise<void>>()

async function mutateBoardDocument<T>(
  boardId: string,
  mutate: (board: BoardDocument) => T | Promise<T>
): Promise<T> {
  const queued = boardMutationQueues.get(boardId) ?? Promise.resolve()
  let releaseQueue!: () => void
  const next = new Promise<void>((resolve) => {
    releaseQueue = resolve
  })
  boardMutationQueues.set(
    boardId,
    queued.then(() => next, () => next)
  )

  await queued
  try {
    const board = await readBoardDocument(boardId)
    const result = await mutate(board)
    await writeBoardDocument(boardId, board)
    return result
  } finally {
    releaseQueue()
    if (boardMutationQueues.get(boardId) === next) {
      boardMutationQueues.delete(boardId)
    }
  }
}

export function registerBrowserTabHandlers(): void {
  // ─── Tab CRUD ───────────────────────────────────────────────────────────────

  ipcMain.handle('browserTabs:list', async (_e, boardId?: string) => {
    await ensureWorkspaceInitialized()
    const resolvedBoardId = resolveBoardIdOrThrow(boardId)
    const board = await readBoardDocument(resolvedBoardId)
    return [...board.tabs].sort((a, b) => {
      const left = String(a.createdAt ?? '')
      const right = String(b.createdAt ?? '')
      return left.localeCompare(right)
    })
  })

  ipcMain.handle('browserTabs:get', async (_e, id: string, boardId?: string) => {
    await ensureWorkspaceInitialized()
    const resolvedBoardId = resolveBoardIdOrThrow(boardId)
    const board = await readBoardDocument(resolvedBoardId)
    return board.tabs.find((tab) => tab.id === id) ?? null
  })

  ipcMain.handle(
    'browserTabs:create',
    async (_e, data: { title?: string; url?: string; flowX?: number; flowY?: number }, boardId?: string) => {
      await ensureWorkspaceInitialized()
      const resolvedBoardId = resolveBoardIdOrThrow(boardId)
      const now = new Date().toISOString()
      const normalizedUrl = data.url?.trim() || 'https://www.google.com'
      const tab = {
        id: generateBoardRecordId('tab'),
        title: data.title ?? 'New Tab',
        url: normalizedUrl,
        favicon: null,
        screenshot: null,
        monitors: null,
        flowX: data.flowX ?? 0,
        flowY: data.flowY ?? 0,
        createdAt: now,
        updatedAt: now
      }
      console.log(`${TAG} Creating tab id=${tab.id} board=${resolvedBoardId} url=${normalizedUrl}`)
      await mutateBoardDocument(resolvedBoardId, (board) => {
        board.tabs.push(tab)
      })
      await ensureMessageParentTabRow(tab.id, resolvedBoardId)
      return tab
    }
  )

  ipcMain.handle(
    'browserTabs:update',
    async (_e, id: string, data: Record<string, unknown>, boardId?: string) => {
      await ensureWorkspaceInitialized()
      const requestedBoardId = resolveBoardIdOrThrow(boardId)
      const updateInBoard = async (targetBoardId: string): Promise<Record<string, unknown> | null> => {
        return mutateBoardDocument(targetBoardId, (board) => {
          let updated: Record<string, unknown> | null = null
          board.tabs = board.tabs.map((tab) => {
            if (tab.id !== id) return tab
            updated = { ...tab, ...data, updatedAt: new Date().toISOString() }
            return updated
          })
          return updated
        })
      }

      let updated = await updateInBoard(requestedBoardId)
      if (!updated) {
        const ownerBoardId = await getBoardIdForTabId(id)
        if (ownerBoardId && ownerBoardId !== requestedBoardId) {
          console.warn(`${TAG} tab update rerouted id=${id} from board=${requestedBoardId} to board=${ownerBoardId}`)
          updated = await updateInBoard(ownerBoardId)
        }
      }
      if (updated) {
        await ensureMessageParentTabRow(id, boardId)
      }
      return updated
    }
  )

  ipcMain.handle('browserTabs:delete', async (_e, id: string, boardId?: string) => {
    await ensureWorkspaceInitialized()
    const resolvedBoardId = resolveBoardIdOrThrow(boardId)
    console.log(`${TAG} Deleting tab id=${id} board=${resolvedBoardId}`)
    await mutateBoardDocument(resolvedBoardId, (board) => {
      board.tabs = board.tabs.filter((tab) => tab.id !== id)
      board.edges = board.edges.filter((edge) => edge.sourceNodeId !== id && edge.targetNodeId !== id)
    })
    const appDb = getAppDb()
    appDb.delete(browserTabs).where(eq(browserTabs.id, id)).run()
    appDb.delete(browserTabMessages).where(eq(browserTabMessages.tabId, id)).run()
    return { success: true }
  })

  ipcMain.handle(
    'browserTabs:savePositions',
    async (_e, positions: Array<{ id: string; x: number; y: number }>, boardId?: string) => {
      await ensureWorkspaceInitialized()
      const resolvedBoardId = resolveBoardIdOrThrow(boardId)
      if (positions.length === 0) return { success: true }
      const positionsById = new Map(positions.map((entry) => [entry.id, entry]))
      await mutateBoardDocument(resolvedBoardId, (board) => {
        const nextUpdatedAt = new Date().toISOString()
        board.tabs = board.tabs.map((tab) => {
          const pos = positionsById.get(String(tab.id))
          if (!pos) return tab
          return { ...tab, flowX: pos.x, flowY: pos.y, updatedAt: nextUpdatedAt }
        })
      })
      return { success: true }
    }
  )

  // ─── Messages ───────────────────────────────────────────────────────────────

  ipcMain.handle('browserTabs:listMessages', async (_e, tabId: string, boardId?: string) => {
    if (!(await tabBelongsToBoard(tabId, boardId))) return []
    const db = getAppDb()
    return db
      .select()
      .from(browserTabMessages)
      .where(eq(browserTabMessages.tabId, tabId))
      .orderBy(asc(browserTabMessages.createdAt))
      .all()
  })

  ipcMain.handle('browserTabs:clearMessages', async (_e, tabId: string, boardId?: string) => {
    if (!(await tabBelongsToBoard(tabId, boardId))) {
      return { success: false, error: 'Tab not found in board' }
    }
    console.log(`${TAG} Clearing messages for tab=${tabId}`)
    const db = getAppDb()
    db.delete(browserTabMessages).where(eq(browserTabMessages.tabId, tabId)).run()
    return { success: true }
  })

  // ─── AI Chat ────────────────────────────────────────────────────────────────

  ipcMain.handle('browserTabs:setLiveWebContents', async (_e, tabId: string, webContentsId?: number | null) => {
    if (!tabId) return { success: false }

    if (typeof webContentsId === 'number' && Number.isFinite(webContentsId)) {
      const wc = webContents.fromId(webContentsId)
      if (wc && !wc.isDestroyed()) {
        liveTabWebContentsById.set(tabId, webContentsId)
        console.log(`${TAG} live-webcontents set tab=${tabId} wc=${webContentsId}`)
        return { success: true }
      }
      liveTabWebContentsById.delete(tabId)
      console.warn(`${TAG} live-webcontents rejected tab=${tabId} wc=${webContentsId} (not found)`)
      return { success: false }
    }

    if (liveTabWebContentsById.has(tabId)) {
      liveTabWebContentsById.delete(tabId)
      console.log(`${TAG} live-webcontents cleared tab=${tabId}`)
    }
    return { success: true }
  })

  ipcMain.handle(
    'browserTabs:chat',
    async (
      _e,
      tabId: string,
      userMessage: string,
      pageContext: ChatPageContext,
      boardId?: string
    ) => {
      if (!(await tabBelongsToBoard(tabId, boardId))) {
        return { messages: [], actions: [], error: 'Tab not found in board' }
      }
      const db = getAppDb()

      let effectivePageContext: ChatPageContext = pageContext
      const effectiveWebContentsId = resolveChatWebContentsId(tabId, pageContext)
      const hasWebContentsId = typeof effectiveWebContentsId === 'number' && Number.isFinite(effectiveWebContentsId)
      const wantsScreenshot = pageContext.includeScreenshot !== false

      if (hasWebContentsId) {
        const frameContext = await buildPageContextFromWebContents(effectiveWebContentsId as number, wantsScreenshot)
        if (frameContext) {
          const mergedContext: ChatPageContext = {
            ...pageContext,
            ...frameContext
          }
          const mergedScore = contextRichnessScore(mergedContext)
          const originalScore = contextRichnessScore(pageContext)
          effectivePageContext = mergedScore >= originalScore ? mergedContext : pageContext
          if (isSparsePageContext(effectivePageContext) && !isSparsePageContext(frameContext)) {
            effectivePageContext = frameContext
          }
          console.log(
            `${TAG} context merge tab=${tabId} wc=${effectiveWebContentsId} originalScore=${originalScore} mergedScore=${mergedScore} selected=${effectivePageContext === pageContext ? 'original' : effectivePageContext === frameContext ? 'frame' : 'merged'}`
          )
        } else {
          console.warn(`${TAG} context merge tab=${tabId} wc=${effectiveWebContentsId} frame context unavailable`)
          liveTabWebContentsById.delete(tabId)
        }
      } else {
        console.warn(`${TAG} context merge tab=${tabId} missing webContentsId; using renderer-only context`)
      }

      console.log(`${TAG} Chat request — tab=${tabId} msg="${userMessage.slice(0, 80)}"`)
      console.log(`${TAG}   page: ${effectivePageContext.url} (${effectivePageContext.title})`)
      console.log(`${TAG}   elements: ${countElementLines(effectivePageContext.elements)} found`)
      console.log(`${TAG}   text: ${effectivePageContext.text.length} chars`)
      console.log(`${TAG}   screenshot: ${effectivePageContext.screenshot ? `${Math.round(effectivePageContext.screenshot.length / 1024)}KB` : 'none'}`)
      await ensureMessageParentTabRow(tabId, boardId)

      // Save user message
      await insertTabMessageWithParentFallback(tabId, 'user', userMessage, boardId)

      // Run browser agent
      console.log(`${TAG} Running browser agent...`)
      const startTime = Date.now()
      const result = await runBrowserAgent(tabId, userMessage, effectivePageContext)
      console.log(`${TAG} Agent returned in ${Date.now() - startTime}ms — actions: ${result.actions.length}, text: ${result.content.length} chars`)

      if (result.actions.length > 0) {
        console.log(`${TAG} Actions to execute:`)
        result.actions.forEach((a, i) => {
          console.log(`${TAG}   [${i}] ${a.type}${a.index !== undefined ? ` index=${a.index}` : ''}${a.value ? ` value="${a.value.slice(0, 50)}"` : ''}${a.url ? ` url=${a.url}` : ''}${a.direction ? ` dir=${a.direction}` : ''}`)
        })
      }

      // Save assistant response
      if (result.content.trim()) {
        await insertTabMessageWithParentFallback(tabId, 'assistant', result.content, boardId)
      }

      // Return updated messages + actions
      const messages = db
        .select()
        .from(browserTabMessages)
        .where(eq(browserTabMessages.tabId, tabId))
        .orderBy(asc(browserTabMessages.createdAt))
        .all()

      return { messages, actions: result.actions }
    }
  )

  // ─── Screenshot Capture ─────────────────────────────────────────────────────

  ipcMain.handle('browserTabs:captureScreenshot', async (_e, webContentsId: number) => {
    try {
      const wc = webContents.fromId(webContentsId)
      if (!wc) {
        console.warn(`${TAG} Screenshot: webContents not found for id=${webContentsId}`)
        return null
      }
      return await captureWebContentsScreenshotDataUrl(wc)
    } catch (err) {
      console.error(`${TAG} Screenshot capture failed:`, err)
      return null
    }
  })

  // ─── Action Execution (native input events) ─────────────────────────────────

  ipcMain.handle(
    'browserTabs:executeActions',
    async (
      _e,
      webContentsId: number,
      actions: Array<{ type: string; index?: number; value?: string; url?: string; direction?: string; amount?: number }>
    ) => {
      const wc = webContents.fromId(webContentsId)
      if (!wc || wc.isDestroyed()) {
        console.warn(`${TAG} executeActions: webContents ${webContentsId} not found`)
        return { results: [] }
      }

      const selectorLiteral = JSON.stringify(INTERACTIVE_SELECTOR)
      const results: Array<{ type: string; description: string; success: boolean }> = []

      // Helper: get element bounding rect by ranked index
      const getElementRect = async (index: number): Promise<{ x: number; y: number; width: number; height: number; desc: string; found: boolean; editable: boolean; tag: string; role: string } | null> => {
        const script = `
          (() => {
            const sel = ${selectorLiteral};
            const isVisible = (el) => {
              const r = el.getBoundingClientRect();
              if (r.width <= 0 || r.height <= 0) return false;
              const style = window.getComputedStyle(el);
              if (style.display === 'none' || style.visibility === 'hidden') return false;
              return true;
            };
            const isEditable = (el) => {
              const tag = el.tagName.toLowerCase();
              const role = el.getAttribute('role') || '';
              return tag === 'input' || tag === 'textarea' || tag === 'select' || role === 'textbox' || el.isContentEditable;
            };
            const els = Array.from(document.querySelectorAll(sel))
              .filter(isVisible)
              .map((el, domIndex) => {
                const tag = el.tagName.toLowerCase();
                const role = el.getAttribute('role') || '';
                const text = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80);
                const ariaLabel = el.getAttribute('aria-label') || '';
                const title = el.getAttribute('title') || '';
                const placeholder = el.getAttribute('placeholder') || '';
                const name = el.getAttribute('name') || '';
                const r = el.getBoundingClientRect();
                let score = 0;
                if (isEditable(el)) score += 60;
                if (tag === 'button' || role === 'button') score += 40;
                if (tag === 'a' || role === 'link') score += 35;
                if (role === 'menuitem' || role === 'option' || role === 'tab') score += 25;
                if (role === 'row') score += 20;
                if (text) score += 8;
                if (ariaLabel || placeholder || title || name) score += 10;
                if (el.closest('[role="dialog"], [aria-modal="true"]')) score += 15;
                return { el, domIndex, score, top: r.top, left: r.left, tag, role, text, ariaLabel, title, placeholder, name };
              })
              .sort((a, b) => b.score - a.score || a.top - b.top || a.left - b.left || a.domIndex - b.domIndex)
              .slice(0, 120);

            const target = els[${index}];
            if (!target) {
              return JSON.stringify({ found: false, desc: 'element not found (index=${index}, total=' + els.length + ')' });
            }
            const el = target.el;
            el.scrollIntoView({ block: 'center', behavior: 'instant' });
            const r = el.getBoundingClientRect();
            let desc = '<' + target.tag + '>';
            if (target.role) desc += ' role=' + target.role;
            if (target.ariaLabel) desc += ' aria-label="' + target.ariaLabel + '"';
            if (target.placeholder) desc += ' placeholder="' + target.placeholder + '"';
            if (target.title) desc += ' title="' + target.title + '"';
            if (target.text) desc += ' text="' + target.text + '"';
            return JSON.stringify({
              found: true,
              x: Math.round(r.left + r.width / 2),
              y: Math.round(r.top + r.height / 2),
              width: Math.round(r.width),
              height: Math.round(r.height),
              desc: desc,
              editable: isEditable(el),
              tag: target.tag,
              role: target.role
            });
          })()
        `
        try {
          const raw = await wc.executeJavaScript(script)
          return JSON.parse(raw)
        } catch (err) {
          console.warn(`${TAG} getElementRect failed index=${index}:`, err)
          return null
        }
      }

      // Helper: send a native click at (x, y) on the webContents
      const nativeClick = (x: number, y: number): void => {
        wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 } as Electron.MouseInputEvent)
        wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 } as Electron.MouseInputEvent)
      }

      const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

      for (let i = 0; i < actions.length; i++) {
        const action = actions[i]
        console.log(
          `${TAG} executeAction [${i}] ${action.type}` +
            `${action.index !== undefined ? ` index=${action.index}` : ''}` +
            `${action.value ? ` value="${action.value.slice(0, 50)}"` : ''}` +
            `${action.url ? ` url=${action.url}` : ''}`
        )

        try {
          switch (action.type) {
            case 'click': {
              if (action.index === undefined) break
              const rect = await getElementRect(action.index)
              if (!rect || !rect.found) {
                results.push({ type: 'click', description: rect?.desc || 'element not found', success: false })
                break
              }
              nativeClick(rect.x, rect.y)
              await delay(100)
              console.log(`${TAG}   → clicked (${rect.x},${rect.y}) ${rect.desc}`)
              results.push({ type: 'click', description: rect.desc, success: true })
              break
            }

            case 'doubleClick': {
              if (action.index === undefined) break
              const rect = await getElementRect(action.index)
              if (!rect || !rect.found) {
                results.push({ type: 'doubleClick', description: rect?.desc || 'element not found', success: false })
                break
              }
              // First click
              wc.sendInputEvent({ type: 'mouseDown', x: rect.x, y: rect.y, button: 'left', clickCount: 1 } as Electron.MouseInputEvent)
              wc.sendInputEvent({ type: 'mouseUp', x: rect.x, y: rect.y, button: 'left', clickCount: 1 } as Electron.MouseInputEvent)
              await delay(50)
              // Second click (double-click)
              wc.sendInputEvent({ type: 'mouseDown', x: rect.x, y: rect.y, button: 'left', clickCount: 2 } as Electron.MouseInputEvent)
              wc.sendInputEvent({ type: 'mouseUp', x: rect.x, y: rect.y, button: 'left', clickCount: 2 } as Electron.MouseInputEvent)
              await delay(100)
              console.log(`${TAG}   → double-clicked (${rect.x},${rect.y}) ${rect.desc}`)
              results.push({ type: 'doubleClick', description: rect.desc, success: true })
              break
            }

            case 'fill': {
              if (action.index === undefined || action.value === undefined) break
              const rect = await getElementRect(action.index)
              if (!rect || !rect.found) {
                results.push({ type: 'fill', description: rect?.desc || 'element not found', success: false })
                break
              }
              // Click to focus
              nativeClick(rect.x, rect.y)
              await delay(100)
              // Select all existing content
              const isMac = process.platform === 'darwin'
              const modifiers: Electron.InputEvent['modifiers'] = isMac ? ['meta'] : ['control']
              wc.sendInputEvent({ type: 'keyDown', keyCode: 'a', modifiers } as Electron.KeyboardInputEvent)
              wc.sendInputEvent({ type: 'keyUp', keyCode: 'a', modifiers } as Electron.KeyboardInputEvent)
              await delay(50)
              // Type the new value using insertText (native keyboard input)
              wc.insertText(action.value)
              await delay(50)
              console.log(`${TAG}   → filled (${rect.x},${rect.y}) ${rect.desc} = "${action.value.slice(0, 50)}"`)
              results.push({ type: 'fill', description: `${rect.desc} = "${action.value}"`, success: true })
              break
            }

            case 'navigate': {
              if (!action.url) break
              try {
                await wc.loadURL(action.url)
              } catch (err) {
                const error = err as Error
                if (error.message?.includes('ERR_ABORTED')) {
                  // Navigation was superseded; not an error
                } else {
                  console.warn(`${TAG}   → navigate error: ${error.message}`)
                }
              }
              const finalUrl = wc.getURL()
              console.log(`${TAG}   → navigated to ${finalUrl}`)
              results.push({ type: 'navigate', description: finalUrl || action.url, success: true })
              break
            }

            case 'scroll': {
              const amt = action.amount ?? 500
              const dir = action.direction === 'up' ? -amt : amt
              await wc.executeJavaScript(`window.scrollBy(0, ${dir})`)
              console.log(`${TAG}   → scrolled ${action.direction} ${Math.abs(dir)}px`)
              results.push({ type: 'scroll', description: `${action.direction} ${Math.abs(dir)}px`, success: true })
              break
            }

            default:
              console.log(`${TAG}   → skipped (no-op for type "${action.type}")`)
          }
        } catch (err) {
          console.warn(`${TAG}   → FAILED: ${action.type}`, err)
          results.push({ type: action.type, description: `Error: ${err}`, success: false })
        }

        // Small delay between actions
        await delay(200)
      }

      return { results }
    }
  )

  // ─── Abort Chat ──────────────────────────────────────────────────────────────

  ipcMain.handle('browserTabs:abortChat', async (_e, tabId: string, _boardId?: string) => {
    console.log(`${TAG} Abort chat request for tab=${tabId}`)
    const aborted = abortBrowserAgent(tabId)
    return { success: aborted }
  })

  // ─── Monitor Rule Generation ────────────────────────────────────────────

  ipcMain.handle(
    'browserTabs:generateMonitorRule',
    async (
      _e,
      condition: string,
      pageHtml: string,
      pageUrl: string
    ) => {
      console.log(`${TAG} generateMonitorRule condition="${condition.slice(0, 60)}" url=${pageUrl}`)
      const result = await generateMonitorRule(condition, pageHtml, pageUrl)
      console.log(`${TAG} generateMonitorRule result: rule=${result.rule ? 'generated' : 'null'} error=${result.error ?? 'none'}`)
      return result
    }
  )

  // ─── Graph Nodes CRUD ────────────────────────────────────────────────────────

  ipcMain.handle('graphNodes:list', async (_e, boardId?: string) => {
    await ensureWorkspaceInitialized()
    const resolvedBoardId = resolveBoardIdOrThrow(boardId)
    const board = await readBoardDocument(resolvedBoardId)
    return [...board.graphNodes].sort((a, b) => {
      const left = String(a.createdAt ?? '')
      const right = String(b.createdAt ?? '')
      return left.localeCompare(right)
    })
  })

  ipcMain.handle(
    'graphNodes:create',
    async (
      _e,
      data: { nodeType: string; label?: string; config?: string; flowX?: number; flowY?: number },
      boardId?: string
    ) => {
      await ensureWorkspaceInitialized()
      const resolvedBoardId = resolveBoardIdOrThrow(boardId)
      const id = generateBoardRecordId('gn')
      const now = new Date().toISOString()
      const node = {
        id,
        nodeType: data.nodeType as 'trigger' | 'scheduleTrigger' | 'formTrigger' | 'debug' | 'notification' | 'aiPrompt' | 'delay' | 'text' | 'output' | 'file' | 'terminal',
        label: data.label ?? '',
        config: data.config ?? '{}',
        flowX: data.flowX ?? 0,
        flowY: data.flowY ?? 0,
        createdAt: now,
        updatedAt: now
      }
      await mutateBoardDocument(resolvedBoardId, (board) => {
        board.graphNodes.push(node)
      })
      return node
    }
  )

  ipcMain.handle(
    'graphNodes:update',
    async (_e, id: string, data: Record<string, unknown>, boardId?: string) => {
      await ensureWorkspaceInitialized()
      const resolvedBoardId = resolveBoardIdOrThrow(boardId)
      return mutateBoardDocument(resolvedBoardId, (board) => {
        let updated: Record<string, unknown> | null = null
        board.graphNodes = board.graphNodes.map((node) => {
          if (node.id !== id) return node
          updated = { ...node, ...data, updatedAt: new Date().toISOString() }
          return updated
        })
        return updated
      })
    }
  )

  ipcMain.handle('graphNodes:delete', async (_e, id: string, boardId?: string) => {
    await ensureWorkspaceInitialized()
    const resolvedBoardId = resolveBoardIdOrThrow(boardId)
    console.log(`${TAG} Deleting graph node id=${id} board=${resolvedBoardId}`)
    await mutateBoardDocument(resolvedBoardId, (board) => {
      board.graphNodes = board.graphNodes.filter((node) => node.id !== id)
      board.edges = board.edges.filter((edge) => edge.sourceNodeId !== id && edge.targetNodeId !== id)
    })
    return { success: true }
  })

  ipcMain.handle(
    'graphNodes:savePositions',
    async (_e, positions: Array<{ id: string; x: number; y: number }>, boardId?: string) => {
      await ensureWorkspaceInitialized()
      const resolvedBoardId = resolveBoardIdOrThrow(boardId)
      if (positions.length === 0) return { success: true }
      const positionsById = new Map(positions.map((entry) => [entry.id, entry]))
      await mutateBoardDocument(resolvedBoardId, (board) => {
        const updatedAt = new Date().toISOString()
        board.graphNodes = board.graphNodes.map((node) => {
          const pos = positionsById.get(String(node.id))
          if (!pos) return node
          return { ...node, flowX: pos.x, flowY: pos.y, updatedAt }
        })
      })
      return { success: true }
    }
  )

  // ─── File Node Helpers ───────────────────────────────────────────────────────

  ipcMain.handle(
    'graphNodes:pickFile',
    async (
      event,
      options?: { mode?: 'open' | 'save'; defaultPath?: string }
    ) => {
      const mode = options?.mode === 'save' ? 'save' : 'open'
      const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined
      const defaultPath = options?.defaultPath?.trim() || undefined

      try {
        if (mode === 'save') {
          const saveOptions = {
            title: 'Choose destination file',
            defaultPath
          }
          const result = parentWindow
            ? await dialog.showSaveDialog(parentWindow, saveOptions)
            : await dialog.showSaveDialog(saveOptions)
          if (result.canceled || !result.filePath) return null
          console.log(`${TAG} pickFile mode=save path=${result.filePath}`)
          return result.filePath
        }

        const openOptions: Electron.OpenDialogOptions = {
          title: 'Choose file',
          defaultPath,
          properties: ['openFile', 'dontAddToRecent']
        }
        const result = parentWindow
          ? await dialog.showOpenDialog(parentWindow, openOptions)
          : await dialog.showOpenDialog(openOptions)
        const selectedPath = result.canceled ? null : (result.filePaths[0] ?? null)
        if (selectedPath) {
          console.log(`${TAG} pickFile mode=open path=${selectedPath}`)
        }
        return selectedPath
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error(`${TAG} pickFile failed mode=${mode} error=${msg}`, error)
        return null
      }
    }
  )

  ipcMain.handle('graphNodes:readFile', async (_e, filePath: string) => {
    const normalizedPath = filePath?.trim()
    if (!normalizedPath) {
      return { success: false, error: 'No file path provided' }
    }

    try {
      const content = await fs.readFile(normalizedPath, 'utf8')
      console.log(`${TAG} readFile path=${normalizedPath} chars=${content.length}`)
      return { success: true, content }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`${TAG} readFile failed path=${normalizedPath} error=${msg}`, error)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle(
    'graphNodes:writeFile',
    async (_e, filePath: string, content: string, mode?: 'overwrite' | 'append') => {
      const normalizedPath = filePath?.trim()
      if (!normalizedPath) {
        return { success: false, error: 'No file path provided' }
      }

      const writeMode: 'overwrite' | 'append' = mode === 'append' ? 'append' : 'overwrite'

      try {
        await fs.mkdir(dirname(normalizedPath), { recursive: true })
        if (writeMode === 'append') {
          await fs.appendFile(normalizedPath, content, 'utf8')
        } else {
          await fs.writeFile(normalizedPath, content, 'utf8')
        }
        const bytes = Buffer.byteLength(content, 'utf8')
        console.log(`${TAG} writeFile path=${normalizedPath} mode=${writeMode} bytes=${bytes}`)
        return { success: true, bytes, mode: writeMode }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error(`${TAG} writeFile failed path=${normalizedPath} mode=${writeMode} error=${msg}`, error)
        return { success: false, error: msg }
      }
    }
  )

  // ─── Browser Edges ───────────────────────────────────────────────────────────

  ipcMain.handle('browserEdges:list', async (_e, boardId?: string) => {
    await ensureWorkspaceInitialized()
    const resolvedBoardId = resolveBoardIdOrThrow(boardId)
    const board = await readBoardDocument(resolvedBoardId)
    return [...board.edges]
  })

  ipcMain.handle(
    'browserEdges:save',
    async (
      _e,
      edges: Array<{ id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }>,
      boardId?: string
    ) => {
      await ensureWorkspaceInitialized()
      const resolvedBoardId = resolveBoardIdOrThrow(boardId)
      await mutateBoardDocument(resolvedBoardId, (board) => {
        board.edges = edges.map((edge) => ({
          id: edge.id,
          sourceNodeId: edge.source,
          targetNodeId: edge.target,
          sourceHandle: edge.sourceHandle ?? null,
          targetHandle: edge.targetHandle ?? null
        }))
      })
      return { success: true }
    }
  )

  // ─── Execute AI Prompt ───────────────────────────────────────────────────────

  ipcMain.handle(
    'graphNodes:executeAiPrompt',
    async (_e, nodeId: string, inputData?: string, runId?: string, boardId?: string) => {
      const requestId = `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      const startedAt = Date.now()
      console.log(
        `${PROMPT_TAG} request id=${requestId} run=${runId ?? 'none'} node=${nodeId} inputLen=${inputData?.length ?? 0} inputPreview="${preview(inputData)}"`
      )
      await ensureWorkspaceInitialized()
      const resolvedBoardId = resolveBoardIdOrThrow(boardId)
      const lookupStart = Date.now()
      const board = await readBoardDocument(resolvedBoardId)
      const node = board.graphNodes.find((entry) => entry.id === nodeId) as
        | { id: string; config: string }
        | undefined
      console.log(
        `${PROMPT_TAG} id=${requestId} node lookup ms=${Date.now() - lookupStart} found=${node ? 'yes' : 'no'}`
      )
      if (!node) {
        return { error: 'Node not found' }
      }

      let config: { prompt?: string; lastOutput?: string }
      try {
        config = JSON.parse(node.config) as { prompt?: string; lastOutput?: string }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Invalid config JSON'
        console.error(`${PROMPT_TAG} id=${requestId} failed to parse config: ${msg}`)
        return { error: `Invalid node config: ${msg}` }
      }
      const prompt = config.prompt
      if (!prompt) {
        console.warn(`${PROMPT_TAG} id=${requestId} node=${nodeId} prompt missing`)
        return { error: 'No prompt configured' }
      }
      console.log(
        `${PROMPT_TAG} id=${requestId} node=${nodeId} promptLen=${prompt.length} lastOutputLen=${config.lastOutput?.length ?? 0} promptPreview="${preview(prompt)}"`
      )

      const { modelId, provider } = getModelConfig()
      const apiKey = getSetting(provider === 'anthropic' ? 'anthropicApiKey' : 'openaiApiKey')
      if (!apiKey) {
        console.warn(`${PROMPT_TAG} id=${requestId} node=${nodeId} provider=${provider} api key missing`)
        return { error: `${provider} API key not set` }
      }
      console.log(
        `${PROMPT_TAG} id=${requestId} node=${nodeId} provider=${provider} model=${modelId}`
      )

      const model =
        provider === 'anthropic'
          ? createAnthropic({ apiKey })(modelId)
          : createOpenAI({ apiKey })(modelId)

      try {
        const userContent = inputData
          ? `${prompt}\n\nInput data:\n${inputData}`
          : prompt
        console.log(
          `${PROMPT_TAG} id=${requestId} node=${nodeId} composed promptLen=${prompt.length} inputLen=${inputData?.length ?? 0} userContentLen=${userContent.length}`
        )

        const modelStart = Date.now()
        const result = await generateText({
          model,
          messages: [{ role: 'user', content: userContent }]
        })

        const output = result.text || ''
        const finishReason = (result as { finishReason?: string }).finishReason ?? 'unknown'
        const usage = (result as {
          usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
        }).usage
        console.log(
          `${PROMPT_TAG} id=${requestId} node=${nodeId} model success ms=${Date.now() - modelStart} finishReason=${finishReason} usageIn=${usage?.inputTokens ?? 'n/a'} usageOut=${usage?.outputTokens ?? 'n/a'} usageTotal=${usage?.totalTokens ?? 'n/a'} outputLen=${output.length} outputPreview="${preview(output)}"`
        )
        // Persist output to config
        const persistStart = Date.now()
        config.lastOutput = output
        await mutateBoardDocument(resolvedBoardId, (latestBoard) => {
          latestBoard.graphNodes = latestBoard.graphNodes.map((entry) =>
            entry.id === nodeId
              ? {
                  ...entry,
                  config: JSON.stringify(config),
                  updatedAt: new Date().toISOString()
                }
              : entry
          )
        })
        console.log(
          `${PROMPT_TAG} id=${requestId} node=${nodeId} persisted output ms=${Date.now() - persistStart}`
        )
        console.log(`${PROMPT_TAG} complete id=${requestId} totalMs=${Date.now() - startedAt}`)

        return { output }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'AI prompt failed'
        console.error(`${PROMPT_TAG} failed id=${requestId} node=${nodeId} totalMs=${Date.now() - startedAt} msg=${msg}`, error)
        return { error: msg }
      }
    }
  )

  // ─── System Notification ─────────────────────────────────────────────────────

  ipcMain.handle('graphNodes:notify', async (_e, title: string, body: string, playSound?: boolean) => {
    const shouldPlaySound = playSound ?? true
    console.log(`${TAG} Notification: ${title} — ${body} (sound=${shouldPlaySound})`)

    try {
      // macOS native notification via osascript (works without code-signing)
      if (process.platform === 'darwin') {
        const escapedTitle = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        const escapedBody = body.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        const soundFlag = shouldPlaySound ? ' sound name "default"' : ''
        await execCommand(`osascript -e 'display notification "${escapedBody}" with title "${escapedTitle}"${soundFlag}'`)
      } else if (Notification.isSupported()) {
        new Notification({ title, body }).show()
        if (shouldPlaySound) {
          const soundCommand = process.platform === 'win32'
            ? 'powershell -c "(New-Object Media.SoundPlayer \'C:\\Windows\\Media\\notify.wav\').PlaySync()"'
            : 'paplay /usr/share/sounds/freedesktop/stereo/message.oga 2>/dev/null || true'
          await execCommand(soundCommand)
        }
      } else {
        console.warn(`${TAG} Notification API not supported on platform=${process.platform}`)
      }

      console.log(`${TAG} Notification delivered title="${preview(title)}"`)
      return { success: true }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`${TAG} Notification failed title="${preview(title)}" error=${msg}`, error)
      return { success: false, error: msg }
    }
  })

  // ── File watching ──────────────────────────────────────────────────────

  const fileWatchers = new Map<string, { watcher: FSWatcher; refCount: number; debounceTimer: ReturnType<typeof setTimeout> | null }>()

  function broadcastFileChanged(filePath: string, content: string): void {
    for (const wc of webContents.getAllWebContents()) {
      wc.send('graphNodes:fileChanged', { filePath, content })
    }
  }

  ipcMain.handle('graphNodes:watchFile', async (_event, filePath: string) => {
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      const existing = fileWatchers.get(filePath)
      if (existing) {
        existing.refCount++
        return { content }
      }

      const watcher = fsWatch(filePath, () => {
        const entry = fileWatchers.get(filePath)
        if (!entry) return
        if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
        entry.debounceTimer = setTimeout(async () => {
          try {
            const updated = await fs.readFile(filePath, 'utf-8')
            broadcastFileChanged(filePath, updated)
          } catch {
            // File may have been deleted/moved — send empty
            broadcastFileChanged(filePath, '')
          }
        }, 300)
      })

      fileWatchers.set(filePath, { watcher, refCount: 1, debounceTimer: null })
      return { content }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { content: null, error: msg }
    }
  })

  ipcMain.handle('graphNodes:unwatchFile', async (_event, filePath: string) => {
    const entry = fileWatchers.get(filePath)
    if (!entry) return
    entry.refCount--
    if (entry.refCount <= 0) {
      if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
      entry.watcher.close()
      fileWatchers.delete(filePath)
    }
  })
}
