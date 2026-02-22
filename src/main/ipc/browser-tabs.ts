import { ipcMain, webContents, Notification, dialog, BrowserWindow } from 'electron'
import { exec } from 'child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { eq, asc } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { generateText } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { getDb } from '../db/client'
import { browserTabs, browserTabMessages, graphNodes, browserEdges } from '../db/schema'
import { runBrowserAgent, abortBrowserAgent, getModelConfig, getSetting } from '../services/browser-agent'
import { generateMonitorRule } from '../services/monitor-evaluator'

const TAG = '[browser-tabs]'
const PROMPT_TAG = '[graph-ai-prompt]'

function preview(value: string | undefined, max = 180): string {
  if (!value) return ''
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, max)}...`
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

export function registerBrowserTabHandlers(): void {
  // ─── Tab CRUD ───────────────────────────────────────────────────────────────

  ipcMain.handle('browserTabs:list', async () => {
    const db = getDb()
    return db.select().from(browserTabs).orderBy(asc(browserTabs.createdAt)).all()
  })

  ipcMain.handle('browserTabs:get', async (_e, id: string) => {
    const db = getDb()
    return db.select().from(browserTabs).where(eq(browserTabs.id, id)).get()
  })

  ipcMain.handle(
    'browserTabs:create',
    async (_e, data: { title?: string; url?: string; flowX?: number; flowY?: number }) => {
      const db = getDb()
      const id = `tab-${randomUUID()}`
      const now = new Date().toISOString()
      const normalizedUrl = data.url?.trim() || 'https://www.google.com'
      console.log(`${TAG} Creating tab id=${id} url=${normalizedUrl}`)
      db.insert(browserTabs)
        .values({
          id,
          title: data.title ?? 'New Tab',
          url: normalizedUrl,
          flowX: data.flowX ?? 0,
          flowY: data.flowY ?? 0,
          createdAt: now,
          updatedAt: now
        })
        .run()
      return db.select().from(browserTabs).where(eq(browserTabs.id, id)).get()
    }
  )

  ipcMain.handle(
    'browserTabs:update',
    async (_e, id: string, data: Record<string, unknown>) => {
      const db = getDb()
      db.update(browserTabs)
        .set({ ...data, updatedAt: new Date().toISOString() })
        .where(eq(browserTabs.id, id))
        .run()
      return db.select().from(browserTabs).where(eq(browserTabs.id, id)).get()
    }
  )

  ipcMain.handle('browserTabs:delete', async (_e, id: string) => {
    console.log(`${TAG} Deleting tab id=${id}`)
    const db = getDb()
    db.delete(browserTabs).where(eq(browserTabs.id, id)).run()
    return { success: true }
  })

  ipcMain.handle(
    'browserTabs:savePositions',
    async (_e, positions: Array<{ id: string; x: number; y: number }>) => {
      const db = getDb()
      for (const pos of positions) {
        db.update(browserTabs)
          .set({ flowX: pos.x, flowY: pos.y, updatedAt: new Date().toISOString() })
          .where(eq(browserTabs.id, pos.id))
          .run()
      }
      return { success: true }
    }
  )

  // ─── Messages ───────────────────────────────────────────────────────────────

  ipcMain.handle('browserTabs:listMessages', async (_e, tabId: string) => {
    const db = getDb()
    return db
      .select()
      .from(browserTabMessages)
      .where(eq(browserTabMessages.tabId, tabId))
      .orderBy(asc(browserTabMessages.createdAt))
      .all()
  })

  ipcMain.handle('browserTabs:clearMessages', async (_e, tabId: string) => {
    console.log(`${TAG} Clearing messages for tab=${tabId}`)
    const db = getDb()
    db.delete(browserTabMessages).where(eq(browserTabMessages.tabId, tabId)).run()
    return { success: true }
  })

  // ─── AI Chat ────────────────────────────────────────────────────────────────

  ipcMain.handle(
    'browserTabs:chat',
    async (
      _e,
      tabId: string,
      userMessage: string,
      pageContext: { url: string; title: string; text: string; elements: string; screenshot?: string }
    ) => {
      const db = getDb()

      console.log(`${TAG} Chat request — tab=${tabId} msg="${userMessage.slice(0, 80)}"`)
      console.log(`${TAG}   page: ${pageContext.url} (${pageContext.title})`)
      console.log(`${TAG}   elements: ${pageContext.elements.split('\n').length} found`)
      console.log(`${TAG}   text: ${pageContext.text.length} chars`)
      console.log(`${TAG}   screenshot: ${pageContext.screenshot ? `${Math.round(pageContext.screenshot.length / 1024)}KB` : 'none'}`)

      // Save user message
      const userId = nanoid()
      db.insert(browserTabMessages)
        .values({
          id: userId,
          tabId,
          role: 'user',
          content: userMessage,
          createdAt: new Date().toISOString()
        })
        .run()

      // Run browser agent
      console.log(`${TAG} Running browser agent...`)
      const startTime = Date.now()
      const result = await runBrowserAgent(tabId, userMessage, pageContext)
      console.log(`${TAG} Agent returned in ${Date.now() - startTime}ms — actions: ${result.actions.length}, text: ${result.content.length} chars`)

      if (result.actions.length > 0) {
        console.log(`${TAG} Actions to execute:`)
        result.actions.forEach((a, i) => {
          console.log(`${TAG}   [${i}] ${a.type}${a.index !== undefined ? ` index=${a.index}` : ''}${a.value ? ` value="${a.value.slice(0, 50)}"` : ''}${a.url ? ` url=${a.url}` : ''}${a.direction ? ` dir=${a.direction}` : ''}`)
        })
      }

      // Save assistant response
      if (result.content.trim()) {
        const aiId = nanoid()
        db.insert(browserTabMessages)
          .values({
            id: aiId,
            tabId,
            role: 'assistant',
            content: result.content,
            createdAt: new Date().toISOString()
          })
          .run()
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

      const image = await wc.capturePage()
      const size = image.getSize()

      if (size.width === 0 || size.height === 0) {
        console.warn(`${TAG} Screenshot: empty image (${size.width}x${size.height})`)
        return null
      }

      // Resize to 480px width for thumbnail
      const targetWidth = 480
      const scale = targetWidth / size.width
      const resized = image.resize({
        width: targetWidth,
        height: Math.round(size.height * scale)
      })

      const dataUrl = `data:image/png;base64,${resized.toPNG().toString('base64')}`
      console.log(`${TAG} Screenshot captured: ${size.width}x${size.height} → ${targetWidth}x${Math.round(size.height * scale)} (${Math.round(dataUrl.length / 1024)}KB)`)
      return dataUrl
    } catch (err) {
      console.error(`${TAG} Screenshot capture failed:`, err)
      return null
    }
  })

  // ─── Abort Chat ──────────────────────────────────────────────────────────────

  ipcMain.handle('browserTabs:abortChat', async (_e, tabId: string) => {
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

  ipcMain.handle('graphNodes:list', async () => {
    const db = getDb()
    return db.select().from(graphNodes).orderBy(asc(graphNodes.createdAt)).all()
  })

  ipcMain.handle(
    'graphNodes:create',
    async (
      _e,
      data: { nodeType: string; label?: string; config?: string; flowX?: number; flowY?: number }
    ) => {
      const db = getDb()
      const id = `gn-${randomUUID()}`
      const now = new Date().toISOString()
      db.insert(graphNodes)
        .values({
          id,
          nodeType: data.nodeType as 'trigger' | 'debug' | 'notification' | 'aiPrompt' | 'delay' | 'text' | 'output' | 'file',
          label: data.label ?? '',
          config: data.config ?? '{}',
          flowX: data.flowX ?? 0,
          flowY: data.flowY ?? 0,
          createdAt: now,
          updatedAt: now
        })
        .run()
      return db.select().from(graphNodes).where(eq(graphNodes.id, id)).get()
    }
  )

  ipcMain.handle(
    'graphNodes:update',
    async (_e, id: string, data: Record<string, unknown>) => {
      const db = getDb()
      db.update(graphNodes)
        .set({ ...data, updatedAt: new Date().toISOString() })
        .where(eq(graphNodes.id, id))
        .run()
      return db.select().from(graphNodes).where(eq(graphNodes.id, id)).get()
    }
  )

  ipcMain.handle('graphNodes:delete', async (_e, id: string) => {
    console.log(`${TAG} Deleting graph node id=${id}`)
    const db = getDb()
    // Also clean up edges referencing this node
    db.delete(browserEdges)
      .where(eq(browserEdges.sourceNodeId, id))
      .run()
    db.delete(browserEdges)
      .where(eq(browserEdges.targetNodeId, id))
      .run()
    db.delete(graphNodes).where(eq(graphNodes.id, id)).run()
    return { success: true }
  })

  ipcMain.handle(
    'graphNodes:savePositions',
    async (_e, positions: Array<{ id: string; x: number; y: number }>) => {
      const db = getDb()
      for (const pos of positions) {
        db.update(graphNodes)
          .set({ flowX: pos.x, flowY: pos.y, updatedAt: new Date().toISOString() })
          .where(eq(graphNodes.id, pos.id))
          .run()
      }
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

  ipcMain.handle('browserEdges:list', async () => {
    const db = getDb()
    return db.select().from(browserEdges).all()
  })

  ipcMain.handle(
    'browserEdges:save',
    async (
      _e,
      edges: Array<{ id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }>
    ) => {
      const db = getDb()
      // Replace-all save pattern: delete all, re-insert
      db.delete(browserEdges).run()
      for (const edge of edges) {
        db.insert(browserEdges)
          .values({
            id: edge.id,
            sourceNodeId: edge.source,
            targetNodeId: edge.target,
            sourceHandle: edge.sourceHandle ?? null,
            targetHandle: edge.targetHandle ?? null
          })
          .run()
      }
      return { success: true }
    }
  )

  // ─── Execute AI Prompt ───────────────────────────────────────────────────────

  ipcMain.handle(
    'graphNodes:executeAiPrompt',
    async (_e, nodeId: string, inputData?: string, runId?: string) => {
      const requestId = `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      const startedAt = Date.now()
      console.log(
        `${PROMPT_TAG} request id=${requestId} run=${runId ?? 'none'} node=${nodeId} inputLen=${inputData?.length ?? 0} inputPreview="${preview(inputData)}"`
      )
      const db = getDb()
      const lookupStart = Date.now()
      const node = db.select().from(graphNodes).where(eq(graphNodes.id, nodeId)).get()
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
        db.update(graphNodes)
          .set({ config: JSON.stringify(config), updatedAt: new Date().toISOString() })
          .where(eq(graphNodes.id, nodeId))
          .run()
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
}
