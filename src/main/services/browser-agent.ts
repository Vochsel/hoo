import { join } from 'path'
import { existsSync } from 'fs'
import { config as loadEnv } from 'dotenv'
import { generateText, type CoreMessage } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { eq, asc } from 'drizzle-orm'
import { getDb } from '../db/client'
import { settings, browserTabMessages } from '../db/schema'
import { createBrowserTools, type BrowserAction } from './browser-agent-tools'

const TAG = '[browser-agent]'

// Load environment from CWD and optional local .env
loadEnv()
const localEnvPath = join(process.cwd(), '.env')
if (existsSync(localEnvPath)) {
  loadEnv({ path: localEnvPath, override: false })
}

const abortControllers = new Map<string, AbortController>()

export function abortBrowserAgent(tabId: string): boolean {
  const controller = abortControllers.get(tabId)
  if (controller) {
    console.log(`${TAG} Aborting agent for tab=${tabId}`)
    controller.abort()
    abortControllers.delete(tabId)
    return true
  }
  return false
}

export const BROWSER_AI_MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic' as const },
  { id: 'claude-sonnet-4-5-20241022', label: 'Claude Sonnet 4.5', provider: 'anthropic' as const },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', provider: 'anthropic' as const },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'anthropic' as const },
  { id: 'gpt-4.1', label: 'GPT 4.1', provider: 'openai' as const },
  { id: 'gpt-4.1-mini', label: 'GPT 4.1 Mini', provider: 'openai' as const },
  { id: 'gpt-4.1-nano', label: 'GPT 4.1 Nano', provider: 'openai' as const }
]

function getEnvFallback(key: string): string | null {
  const envMap: Record<string, string> = {
    openaiApiKey: 'OPENAI_API_KEY',
    anthropicApiKey: 'ANTHROPIC_API_KEY',
    browserAiModel: 'BROWSER_AI_MODEL'
  }
  const envKey = envMap[key]
  if (!envKey) return null
  const value = process.env[envKey]?.trim()
  return value && value.length > 0 ? value : null
}

export function getSetting(key: string): string | null {
  const db = getDb()
  const row = db.select().from(settings).where(eq(settings.key, key)).get()

  if (row) {
    try {
      const parsed = JSON.parse(row.value) as unknown
      if (typeof parsed === 'string') {
        const trimmed = parsed.trim()
        if (trimmed.length > 0) return trimmed
      }
    } catch {
      const trimmed = row.value.trim()
      if (trimmed.length > 0) return trimmed
    }
  }

  return getEnvFallback(key)
}

export function getModelConfig(): { modelId: string; provider: 'anthropic' | 'openai' } {
  const selectedModel = getSetting('browserAiModel') ?? 'claude-sonnet-4-6'
  const entry = BROWSER_AI_MODELS.find((m) => m.id === selectedModel)
  return entry
    ? { modelId: entry.id, provider: entry.provider }
    : { modelId: 'claude-sonnet-4-6', provider: 'anthropic' }
}

export async function runBrowserAgent(
  tabId: string,
  userMessage: string,
  pageContext: { url: string; title: string; text: string; elements: string; screenshot?: string }
): Promise<{ content: string; actions: BrowserAction[] }> {
  const { modelId, provider } = getModelConfig()
  const apiKey = getSetting(provider === 'anthropic' ? 'anthropicApiKey' : 'openaiApiKey')
  if (!apiKey) {
    console.warn(`${TAG} No ${provider} API key set`)
    return {
      content: `${provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key not set. Add it in Settings or .env.`,
      actions: []
    }
  }

  const db = getDb()

  const history = db
    .select()
    .from(browserTabMessages)
    .where(eq(browserTabMessages.tabId, tabId))
    .orderBy(asc(browserTabMessages.createdAt))
    .all()
    .slice(-20)

  console.log(`${TAG} Loaded ${history.length} history messages`)

  const messages: CoreMessage[] = history.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content
  }))

  const userContent: Array<{ type: 'text'; text: string } | { type: 'image'; image: string }> = []

  const contextBlock = [
    `Current page: ${pageContext.url}`,
    `Title: ${pageContext.title}`,
    '',
    'Interactive elements on this page:',
    pageContext.elements || '(none found)',
    '',
    'Page text (first 8000 chars):',
    pageContext.text || '(empty page)',
    '',
    `User request: ${userMessage}`
  ].join('\n')

  userContent.push({ type: 'text', text: contextBlock })

  if (pageContext.screenshot) {
    console.log(`${TAG} Including screenshot in request (${Math.round(pageContext.screenshot.length / 1024)}KB)`)
    userContent.push({ type: 'image', image: pageContext.screenshot })
  }

  messages.push({ role: 'user', content: userContent })

  const model =
    provider === 'anthropic'
      ? createAnthropic({ apiKey })(modelId)
      : createOpenAI({ apiKey })(modelId)
  const { tools, getActions } = createBrowserTools()

  const abortController = new AbortController()
  abortControllers.set(tabId, abortController)

  try {
    console.log(`${TAG} Calling generateText (${modelId}, maxSteps=5)...`)
    const startTime = Date.now()

    const result = await generateText({
      model,
      maxSteps: 5,
      abortSignal: abortController.signal,
      system: `You are a browser automation assistant that controls a web browser embedded in an Electron app. You can see the page via a screenshot (if provided) and you have a list of interactive elements with index numbers.

YOUR JOB: When the user asks you to interact with the page, you MUST use your tools to do it. Do not just describe what you would do - actually call the tools.

TOOLS:
- clickElement(index) - click an interactive element by its index from the elements list
- fillInput(index, value) - type into an input/textarea by its index
- navigate(url) - go to a completely different URL (e.g. google.com -> twitter.com)
- scrollPage(direction, amount) - scroll up or down

HOW TO USE ELEMENTS:
- The elements list shows [index] <tag> with attributes like role, text, aria-label, title, tooltip, href
- Match the user's request to an element by its text, aria-label, title, tooltip, or purpose
- Use the index number when calling clickElement or fillInput
- Elements include <tr role="row">, <div role="button">, <a>, etc. - modern web apps use diverse markup

CRITICAL - CLICKING vs NAVIGATING:
- PREFER clickElement over navigate! Most modern web apps (Gmail, Google Docs, Slack, etc.) are single-page apps (SPAs)
- To open an email, click a row/link - do NOT navigate to its URL
- To click a menu item, button, or link on the CURRENT page, use clickElement
- ONLY use navigate to go to a completely DIFFERENT website or a URL the user typed
- If you already navigated somewhere and the page loaded, do NOT navigate to the same URL again - use clickElement to interact with the page content instead

AGENTIC BEHAVIOR:
- After you call tools, your actions will be executed on the real browser
- You will then be called again with the UPDATED page state (new screenshot + new elements)
- Keep going - use tools again if the task needs more steps
- Only stop using tools when the task is fully complete
- Each round you get a fresh view of the page - re-examine the elements list carefully as indices change
- NEVER repeat the same action twice in a row. If you already navigated to a URL and see the same page, the navigation worked - now click elements on the page instead
- If an action didn't have the expected effect, try a different approach (different element, scroll first, etc.)

RULES:
- ALWAYS use tools when the user asks to click, type, navigate, scroll, or interact
- If you see a screenshot, use it to better understand the page layout
- After using tools, briefly describe what you did
- If you can't find the requested element, scroll down or list the closest matches
- When the task is fully complete, respond with a short confirmation and NO tool calls
- Be concise`,
      messages,
      tools
    })

    const elapsed = Date.now() - startTime
    const actions = getActions()

    console.log(`${TAG} generateText completed in ${elapsed}ms`)
    console.log(`${TAG}   steps: ${result.steps.length}`)
    console.log(`${TAG}   text: "${result.text?.slice(0, 100) ?? '(empty)'}"`)
    console.log(`${TAG}   actions collected: ${actions.length}`)

    try {
      result.steps.forEach((step, i) => {
        if (step.toolCalls && step.toolCalls.length > 0) {
          step.toolCalls.forEach((tc) => {
            console.log(`${TAG}   step[${i}] tool: ${tc.toolName}(${JSON.stringify(tc.args ?? {})})`)
          })
        }
        if (step.toolResults && step.toolResults.length > 0) {
          step.toolResults.forEach((tr) => {
            const resultStr = JSON.stringify(tr.result ?? null) ?? '(empty)'
            console.log(`${TAG}   step[${i}] result: ${resultStr.slice(0, 120)}`)
          })
        }
      })
    } catch (logErr) {
      console.warn(`${TAG} Step logging failed:`, logErr)
    }

    return {
      content: result.text || '',
      actions
    }
  } catch (error) {
    if (abortController.signal.aborted) {
      console.log(`${TAG} Agent aborted for tab=${tabId}`)
      return { content: 'Generation stopped.', actions: [] }
    }
    const msg = error instanceof Error ? error.message : 'Failed to get AI response'
    console.error(`${TAG} Error:`, msg)
    return { content: `Error: ${msg}`, actions: [] }
  } finally {
    abortControllers.delete(tabId)
  }
}
