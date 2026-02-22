import type { BrowserAction, ActionResult, PageContext } from '@/hooks/use-browser-tabs'

const TAG = '[agent-runner]'
const MAX_LOOPS = 10

const INTERACTIVE_SELECTOR =
  'a, button, input, textarea, select, [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"], [role="row"], [role="listbox"], [role="checkbox"], [role="switch"], [tabindex], [onclick], [data-action]'

// ─── Page context gathering ─────────────────────────────────────────────────

async function gatherPageContext(webview: Electron.WebviewTag): Promise<PageContext> {
  try {
    const [text, elements] = await Promise.all([
      webview.executeJavaScript('document.body.innerText.slice(0, 8000)'),
      webview.executeJavaScript(`
        (() => {
          const sel = '${INTERACTIVE_SELECTOR}';
          const all = Array.from(document.querySelectorAll(sel));
          const visible = all.filter(el => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });
          const els = visible.slice(0, 80);
          return els.map((el, i) => {
            const tag = el.tagName.toLowerCase();
            const type = el.getAttribute('type') || '';
            const text = (el.textContent || '').trim().slice(0, 100);
            const placeholder = el.getAttribute('placeholder') || '';
            const href = el.getAttribute('href') || '';
            const role = el.getAttribute('role') || '';
            const name = el.getAttribute('name') || '';
            const ariaLabel = el.getAttribute('aria-label') || '';
            const title = el.getAttribute('title') || '';
            const dataTooltip = el.getAttribute('data-tooltip') || '';
            let desc = '[' + i + '] <' + tag + '>';
            if (type) desc += ' type=' + type;
            if (role) desc += ' role=' + role;
            if (name) desc += ' name=' + name;
            if (text) desc += ' text="' + text + '"';
            if (placeholder) desc += ' placeholder="' + placeholder + '"';
            if (ariaLabel) desc += ' aria-label="' + ariaLabel + '"';
            if (title) desc += ' title="' + title + '"';
            if (dataTooltip) desc += ' tooltip="' + dataTooltip + '"';
            if (href) desc += ' href="' + href + '"';
            return desc;
          }).join('\\n');
        })()
      `)
    ])

    return {
      url: webview.getURL(),
      title: webview.getTitle(),
      text: text || '',
      elements: elements || ''
    }
  } catch (err) {
    console.error(`${TAG} gatherPageContext error:`, err)
    return { url: webview.getURL(), title: '', text: '', elements: '' }
  }
}

// ─── Action execution ───────────────────────────────────────────────────────

async function executeBrowserActions(
  webview: Electron.WebviewTag,
  actions: BrowserAction[]
): Promise<ActionResult[]> {
  const results: ActionResult[] = []

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i]
    console.log(
      `${TAG}   [${i}/${actions.length}] ${action.type}` +
        `${action.index !== undefined ? ` index=${action.index}` : ''}` +
        `${action.value ? ` value="${action.value.slice(0, 50)}"` : ''}` +
        `${action.url ? ` url=${action.url}` : ''}`
    )

    try {
      switch (action.type) {
        case 'click':
          if (action.index !== undefined) {
            const result = await webview.executeJavaScript(`
              (() => {
                const sel = '${INTERACTIVE_SELECTOR}';
                const all = Array.from(document.querySelectorAll(sel));
                const visible = all.filter(el => {
                  const r = el.getBoundingClientRect();
                  return r.width > 0 && r.height > 0;
                });
                const els = visible.slice(0, 80);
                const el = els[${action.index}];
                if (el) {
                  const tag = el.tagName.toLowerCase();
                  const text = (el.textContent || '').trim().slice(0, 60);
                  el.scrollIntoView({ block: 'center', behavior: 'instant' });
                  if (['input','textarea','select'].includes(tag) || el.isContentEditable) {
                    el.focus();
                  }
                  const rect = el.getBoundingClientRect();
                  const x = rect.left + rect.width / 2;
                  const y = rect.top + rect.height / 2;
                  const eo = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
                  el.dispatchEvent(new PointerEvent('pointerdown', { ...eo, pointerId: 1 }));
                  el.dispatchEvent(new MouseEvent('mousedown', eo));
                  el.dispatchEvent(new PointerEvent('pointerup', { ...eo, pointerId: 1 }));
                  el.dispatchEvent(new MouseEvent('mouseup', eo));
                  el.dispatchEvent(new MouseEvent('click', eo));
                  if (el.type === 'submit' || tag === 'button') {
                    const form = el.closest('form');
                    if (form) {
                      form.requestSubmit ? form.requestSubmit() : form.submit();
                    }
                  }
                  return JSON.stringify({ ok: true, desc: '<' + tag + '> "' + text + '"' });
                }
                return JSON.stringify({ ok: false, desc: 'element not found (index ${action.index}, total=' + els.length + ')' });
              })()
            `)
            const parsed = JSON.parse(result)
            results.push({ type: 'click', description: parsed.desc, success: parsed.ok })
          }
          break

        case 'fill':
          if (action.index !== undefined && action.value !== undefined) {
            const escapedValue = action.value
              .replace(/\\/g, '\\\\')
              .replace(/'/g, "\\'")
              .replace(/\n/g, '\\n')
            const result = await webview.executeJavaScript(`
              (() => {
                const sel = '${INTERACTIVE_SELECTOR}';
                const all = Array.from(document.querySelectorAll(sel));
                const visible = all.filter(el => {
                  const r = el.getBoundingClientRect();
                  return r.width > 0 && r.height > 0;
                });
                const els = visible.slice(0, 80);
                const el = els[${action.index}];
                if (el) {
                  const tag = el.tagName.toLowerCase();
                  const name = el.getAttribute('name') || el.getAttribute('placeholder') || tag;
                  el.focus();
                  const proto = tag === 'textarea'
                    ? window.HTMLTextAreaElement.prototype
                    : window.HTMLInputElement.prototype;
                  const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                  if (nativeSetter) {
                    nativeSetter.call(el, '${escapedValue}');
                  } else {
                    el.value = '${escapedValue}';
                  }
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  el.dispatchEvent(new InputEvent('input', { bubbles: true, data: '${escapedValue}', inputType: 'insertText' }));
                  return JSON.stringify({ ok: true, desc: name + ' = "${escapedValue}"' });
                }
                return JSON.stringify({ ok: false, desc: 'element not found (index ${action.index}, total=' + els.length + ')' });
              })()
            `)
            const parsed = JSON.parse(result)
            results.push({ type: 'fill', description: parsed.desc, success: parsed.ok })

            // Simulate Enter key
            await new Promise((r) => setTimeout(r, 100))
            await webview.executeJavaScript(`
              (() => {
                const sel = '${INTERACTIVE_SELECTOR}';
                const all = Array.from(document.querySelectorAll(sel));
                const visible = all.filter(el => {
                  const r = el.getBoundingClientRect();
                  return r.width > 0 && r.height > 0;
                });
                const els = visible.slice(0, 80);
                const el = els[${action.index}];
                if (el) {
                  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                  el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                  el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                  const form = el.closest('form');
                  if (form) {
                    form.requestSubmit ? form.requestSubmit() : form.submit();
                  }
                }
              })()
            `)
          }
          break

        case 'navigate':
          if (action.url) {
            webview.loadURL(action.url).catch((err: Error) => {
              if (err.message?.includes('ERR_ABORTED')) return
              console.warn(`${TAG} navigate error: ${err.message}`)
            })
            results.push({ type: 'navigate', description: action.url, success: true })
          }
          break

        case 'scroll': {
          const amt = action.amount ?? 500
          const dir = action.direction === 'up' ? -amt : amt
          await webview.executeJavaScript(`window.scrollBy(0, ${dir})`)
          results.push({
            type: 'scroll',
            description: `${action.direction} ${Math.abs(dir)}px`,
            success: true
          })
          break
        }

        default:
          console.log(`${TAG}   skipped (no-op for type "${action.type}")`)
      }
    } catch (err) {
      console.warn(`${TAG}   FAILED: ${action.type}`, err)
      results.push({ type: action.type, description: `Error: ${err}`, success: false })
    }

    // 300ms delay between actions
    await new Promise((r) => setTimeout(r, 300))
  }

  return results
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
  options?: { maxLoops?: number }
): Promise<{ content: string; iterations: number }> {
  const maxLoops = options?.maxLoops ?? MAX_LOOPS
  const automatedPrompt = `[Automated] ${prompt}`

  console.log(`${TAG} Starting agent run on tab=${tabId} prompt="${prompt.slice(0, 80)}"`)

  // Initial gather + send
  const pageContext = await gatherPageContext(webview)
  const result = await window.api.browserTabs.chat(tabId, automatedPrompt, pageContext)
  let actions: BrowserAction[] = result.actions ?? []
  let lastContent = result.messages?.[result.messages.length - 1]?.content ?? ''

  console.log(`${TAG} Initial AI response: ${actions.length} action(s)`)

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
    if (actionKey === prevActionKey) {
      repeatCount++
      if (repeatCount >= 2) {
        console.warn(`${TAG} Breaking loop — same action repeated ${repeatCount + 1} times`)
        break
      }
    } else {
      repeatCount = 0
    }
    prevActionKey = actionKey

    // Execute actions
    console.log(`${TAG} Executing ${actions.length} actions...`)
    const results = await executeBrowserActions(webview, actions)

    // Wait for page
    console.log(`${TAG} Waiting for page to settle...`)
    await waitForPageSettle(webview)

    // Re-observe
    console.log(`${TAG} Gathering updated page context...`)
    const updatedContext = await gatherPageContext(webview)

    const resultSummary = results
      .map((r) => `${r.type}: ${r.success ? 'OK' : 'FAILED'} — ${r.description}`)
      .join('\n')

    const continuationMsg = `[Actions executed — iteration ${iteration}]\n${resultSummary}\n\nThe page has updated. Look at the current page state and continue with the original task if more steps are needed. If the task is complete, just confirm what was done.`

    console.log(`${TAG} Sending continuation to AI...`)
    const contResult = await window.api.browserTabs.chat(tabId, continuationMsg, updatedContext)
    actions = contResult.actions ?? []
    lastContent = contResult.messages?.[contResult.messages.length - 1]?.content ?? lastContent
    console.log(`${TAG} AI returned ${actions.length} action(s) on iteration ${iteration}`)
  }

  if (iteration >= maxLoops && actions.length > 0) {
    console.warn(`${TAG} Agent loop hit max iterations (${maxLoops})`)
  }

  console.log(`${TAG} Agent run complete after ${iteration} iteration(s)`)
  return { content: lastContent, iterations: iteration }
}
