import type { BrowserAction, ActionResult, PageContext } from '@/hooks/use-browser-tabs'

const TAG = '[agent-runner]'
const MAX_LOOPS = 10

const INTERACTIVE_SELECTOR =
  'a[href], button, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"], [role="row"], [role="checkbox"], [role="switch"], [role="textbox"], [aria-label], [data-tooltip], [onclick], [data-action]'

function preview(value: string | undefined, max = 80): string {
  if (!value) return ''
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, max)}...`
}

// ─── Page context gathering ─────────────────────────────────────────────────

async function gatherPageContext(
  webview: Electron.WebviewTag,
  options?: { includeScreenshot?: boolean }
): Promise<PageContext> {
  const includeScreenshot = options?.includeScreenshot !== false
  let webContentsId: number | undefined
  try {
    webContentsId = webview.getWebContentsId()
  } catch {
    webContentsId = undefined
  }
  try {
    const [text, elements, screenshot] = await Promise.all([
      webview.executeJavaScript('document.body.innerText.slice(0, 8000)'),
      webview.executeJavaScript(`
        (() => {
          const sel = '${INTERACTIVE_SELECTOR}';
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

          const ranked = Array.from(document.querySelectorAll(sel))
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
            .slice(0, 120);

          return ranked.map((el, i) => {
            const tag = el.tag;
            let desc = '[' + i + '] <' + tag + '>';
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
      `),
      includeScreenshot && typeof webContentsId === 'number'
        ? window.api.browserTabs.captureScreenshot(webContentsId).catch(() => null)
        : Promise.resolve(null)
    ])

    return {
      url: webview.getURL(),
      title: webview.getTitle(),
      text: text || '',
      elements: elements || '',
      screenshot: screenshot || undefined,
      webContentsId,
      includeScreenshot
    }
  } catch (err) {
    console.error(`${TAG} gatherPageContext error:`, err)
    return {
      url: webview.getURL(),
      title: '',
      text: '',
      elements: '',
      webContentsId,
      includeScreenshot
    }
  }
}

// ─── Action execution (via main process native input) ────────────────────────

async function executeBrowserActions(
  webview: Electron.WebviewTag,
  actions: BrowserAction[],
  onStatus?: (status: string) => void
): Promise<ActionResult[]> {
  let wcId: number | undefined
  try {
    wcId = webview.getWebContentsId()
  } catch {
    wcId = undefined
  }
  if (typeof wcId !== 'number' || !Number.isFinite(wcId)) {
    console.warn(`${TAG} executeBrowserActions: no webContentsId`)
    return []
  }

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i]
    onStatus?.(
      `Tool ${i + 1}/${actions.length}: ${action.type}${action.index !== undefined ? ` #${action.index}` : ''}${
        action.url ? ` ${preview(action.url, 40)}` : ''
      }`
    )
    console.log(
      `${TAG}   [${i}/${actions.length}] ${action.type}` +
        `${action.index !== undefined ? ` index=${action.index}` : ''}` +
        `${action.value ? ` value="${action.value.slice(0, 50)}"` : ''}` +
        `${action.url ? ` url=${action.url}` : ''}`
    )
  }

  try {
    const response = await window.api.browserTabs.executeActions(wcId, actions)
    return (response.results ?? []).map(
      (r: { type: string; description: string; success: boolean }) => ({
        type: r.type,
        description: r.description,
        success: r.success
      })
    )
  } catch (err) {
    console.error(`${TAG} executeBrowserActions IPC failed:`, err)
    return []
  }
}

// ─── Page settle ────────────────────────────────────────────────────────────

async function waitForPageSettle(webview: Electron.WebviewTag): Promise<void> {
  // Initial wait for navigations to start
  await new Promise((r) => setTimeout(r, 500))

  // Poll loading state up to 5s
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    try {
      const loading = await webview.executeJavaScript('document.readyState !== "complete"')
      if (!loading) break
    } catch {
      break
    }
    await new Promise((r) => setTimeout(r, 200))
  }

  // Extra settle for JS frameworks to render
  await new Promise((r) => setTimeout(r, 500))
}

// ─── Main agent runner ──────────────────────────────────────────────────────

export async function runAgentOnWebview(
  tabId: string,
  prompt: string,
  webview: Electron.WebviewTag,
  options?: { maxLoops?: number; onStatus?: (status: string) => void }
): Promise<{ content: string; iterations: number }> {
  const maxLoops = options?.maxLoops ?? MAX_LOOPS
  const automatedPrompt = `[Automated] ${prompt}`
  const reportStatus = (status: string): void => options?.onStatus?.(status)

  console.log(`${TAG} Starting agent run on tab=${tabId} prompt="${prompt.slice(0, 80)}"`)
  reportStatus('Agent: gathering page context')

  // Initial gather + send
  const pageContext = await gatherPageContext(webview, { includeScreenshot: true })
  reportStatus('Agent: requesting model plan')
  const result = await window.api.browserTabs.chat(tabId, automatedPrompt, pageContext)
  let actions: BrowserAction[] = result.actions ?? []
  let lastContent = result.messages?.[result.messages.length - 1]?.content ?? ''

  console.log(`${TAG} Initial AI response: ${actions.length} action(s)`)
  reportStatus(actions.length > 0 ? `Agent plan: ${actions.length} action(s)` : 'Agent: no actions')

  let iteration = 0
  let prevActionKey = ''
  let repeatCount = 0

  while (actions.length > 0 && iteration < maxLoops) {
    iteration++
    console.log(`${TAG} === Agent loop iteration ${iteration}/${maxLoops} ===`)

    // Detect repeated identical actions
    const actionKey = actions
      .map((a) => `${a.type}:${a.index ?? ''}:${a.url ?? ''}:${a.value ?? ''}`)
      .join('|')
    const isRepeatedAction = actionKey === prevActionKey
    if (actionKey === prevActionKey) {
      repeatCount++
      if (repeatCount >= 2) {
        console.warn(`${TAG} Breaking loop — same action repeated ${repeatCount + 1} times`)
        reportStatus('Agent stopped: repeated action loop')
        break
      }
    } else {
      repeatCount = 0
    }
    prevActionKey = actionKey

    // Execute actions
    console.log(`${TAG} Executing ${actions.length} actions...`)
    reportStatus(`Agent: executing ${actions.length} action(s)`)
    const results = await executeBrowserActions(webview, actions, reportStatus)

    // Wait for page
    console.log(`${TAG} Waiting for page to settle...`)
    reportStatus('Agent: waiting for page settle')
    await waitForPageSettle(webview)

    // Re-observe
    console.log(`${TAG} Gathering updated page context...`)
    reportStatus('Agent: collecting updated page context')
    const updatedContext = await gatherPageContext(webview, { includeScreenshot: true })

    const resultSummary = results
      .map((r) => `${r.type}: ${r.success ? 'OK' : 'FAILED'} — ${r.description}`)
      .join('\n')

    const continuationMsg = [
      `[Actions executed — iteration ${iteration}]`,
      `Original task: ${prompt}`,
      resultSummary,
      '',
      'The page has updated. Continue with the original task if more steps are needed. If complete, confirm what was done.',
      isRepeatedAction
        ? 'IMPORTANT: Your previous action repeated without progress. Do not click the same index again. Choose a different element or use fillInput for text entry.'
        : ''
    ]
      .filter(Boolean)
      .join('\n')

    console.log(`${TAG} Sending continuation to AI...`)
    reportStatus('Agent: requesting next step')
    const contResult = await window.api.browserTabs.chat(tabId, continuationMsg, updatedContext)
    actions = contResult.actions ?? []
    lastContent = contResult.messages?.[contResult.messages.length - 1]?.content ?? lastContent
    console.log(`${TAG} AI returned ${actions.length} action(s) on iteration ${iteration}`)
    reportStatus(actions.length > 0 ? `Agent next: ${actions.length} action(s)` : 'Agent: task complete')
  }

  if (iteration >= maxLoops && actions.length > 0) {
    console.warn(`${TAG} Agent loop hit max iterations (${maxLoops})`)
    reportStatus(`Agent stopped: max loops (${maxLoops})`)
  }

  console.log(`${TAG} Agent run complete after ${iteration} iteration(s)`)
  reportStatus(`Agent done after ${iteration} iteration(s)`)
  return { content: lastContent, iterations: iteration }
}
