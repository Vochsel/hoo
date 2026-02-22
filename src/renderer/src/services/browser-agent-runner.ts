import type { BrowserAction, ActionResult, PageContext } from '@/hooks/use-browser-tabs'

const TAG = '[agent-runner]'
const MAX_LOOPS = 10

const INTERACTIVE_SELECTOR =
  'a[href], button, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"], [role="row"], [role="checkbox"], [role="switch"], [role="textbox"], [aria-label], [data-tooltip], [onclick], [data-action]'

// ─── Page context gathering ─────────────────────────────────────────────────

async function gatherPageContext(webview: Electron.WebviewTag): Promise<PageContext> {
  try {
    const [text, elements] = await Promise.all([
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
                    const r = el.getBoundingClientRect();
                    let score = 0;
                    if (isEditable(el)) score += 60;
                    if (tag === 'button' || role === 'button') score += 40;
                    if (tag === 'a' || role === 'link') score += 35;
                    if (role === 'menuitem' || role === 'option' || role === 'tab') score += 25;
                    if (role === 'row') score += 20;
                    if (text) score += 8;
                    if (ariaLabel || placeholder || title) score += 10;
                    if (el.closest('[role="dialog"], [aria-modal="true"]')) score += 15;
                    return { el, domIndex, score, top: r.top, left: r.left, tag, role, text, ariaLabel, title, placeholder };
                  })
                  .sort((a, b) => b.score - a.score || a.top - b.top || a.left - b.left || a.domIndex - b.domIndex)
                  .slice(0, 120);

                const target = els[${action.index}];
                const el = target?.el;
                if (el) {
                  const tag = target.tag;
                  el.scrollIntoView({ block: 'center', behavior: 'instant' });
                  if (isEditable(el)) el.focus();

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
                    if (form) form.requestSubmit ? form.requestSubmit() : form.submit();
                  }

                  let desc = '<' + target.tag + '>';
                  if (target.role) desc += ' role=' + target.role;
                  if (target.ariaLabel) desc += ' aria-label="' + target.ariaLabel + '"';
                  if (target.placeholder) desc += ' placeholder="' + target.placeholder + '"';
                  if (target.title) desc += ' title="' + target.title + '"';
                  if (target.text) desc += ' text="' + target.text + '"';
                  return JSON.stringify({ ok: true, desc });
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

                const target = els[${action.index}];
                const el = target?.el;
                if (el) {
                  const tag = target.tag;
                  const role = target.role;
                  const rawValue = '${escapedValue}';
                  const fieldName = target.ariaLabel || target.placeholder || target.name || target.title || target.text || tag;
                  el.focus();

                  if (tag === 'input' || tag === 'textarea') {
                    const proto = tag === 'textarea'
                      ? window.HTMLTextAreaElement.prototype
                      : window.HTMLInputElement.prototype;
                    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                    if (nativeSetter) {
                      nativeSetter.call(el, rawValue);
                    } else {
                      el.value = rawValue;
                    }
                  } else if (tag === 'select') {
                    const options = Array.from(el.options || []);
                    const needle = rawValue.toLowerCase();
                    const match = options.find((o) => (o.value || '').toLowerCase() === needle)
                      || options.find((o) => (o.textContent || '').trim().toLowerCase() === needle)
                      || options.find((o) => (o.textContent || '').toLowerCase().includes(needle));
                    el.value = match ? match.value : rawValue;
                  } else if (el.isContentEditable || role === 'textbox') {
                    const selection = window.getSelection();
                    if (selection) {
                      const range = document.createRange();
                      range.selectNodeContents(el);
                      selection.removeAllRanges();
                      selection.addRange(range);
                    }
                    try { document.execCommand('insertText', false, rawValue); } catch {}
                    if ((el.textContent || '') !== rawValue) {
                      el.textContent = rawValue;
                    }
                  } else {
                    el.value = rawValue;
                  }

                  try {
                    el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: rawValue, inputType: 'insertText' }));
                  } catch {}
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  try {
                    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: rawValue, inputType: 'insertText' }));
                  } catch {}

                  return JSON.stringify({ ok: true, desc: fieldName + ' = "' + rawValue + '"' });
                }
                return JSON.stringify({ ok: false, desc: 'element not found (index ${action.index}, total=' + els.length + ')' });
              })()
            `)
            const parsed = JSON.parse(result)
            results.push({ type: 'fill', description: parsed.desc, success: parsed.ok })
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
    const isRepeatedAction = actionKey === prevActionKey
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
