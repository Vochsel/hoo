import { useRef, useState, useCallback, useEffect } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { AddressBar, type AddressBarHandle } from './address-bar'
import { BrowserTabChat } from './browser-tab-chat'
import type { BrowserTab, BrowserAction, ActionResult, PageContext } from '@/hooks/use-browser-tabs'
import { getWebviewUserAgent } from '@/lib/webview-user-agent'

interface BrowserTabDialogProps {
  tab: BrowserTab | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onTabUpdate: (id: string, data: Record<string, unknown>) => Promise<unknown>
  onRecaptureScreenshot?: () => void
}

const TAG = '[browser-dialog]'
const WEBVIEW_USER_AGENT = getWebviewUserAgent()

// Selector for interactive elements — broad enough for modern web apps (Gmail, etc.)
const INTERACTIVE_SELECTOR =
  'a[href], button, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"], [role="row"], [role="checkbox"], [role="switch"], [role="textbox"], [aria-label], [data-tooltip], [onclick], [data-action]'

export function BrowserTabDialog({
  tab,
  open,
  onOpenChange,
  onTabUpdate,
  onRecaptureScreenshot
}: BrowserTabDialogProps): React.ReactElement {
  const webviewRef = useRef<Electron.WebviewTag | null>(null)
  const addressBarRef = useRef<AddressBarHandle>(null)
  const [currentUrl, setCurrentUrl] = useState(tab?.url ?? 'about:blank')
  const [pageLoading, setPageLoading] = useState(false)
  const [chatCollapsed, setChatCollapsed] = useState(false)
  const pageLoadingRef = useRef(false)

  // Cmd+L / Ctrl+L focuses the address bar
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: globalThis.KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
        e.preventDefault()
        addressBarRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return (): void => window.removeEventListener('keydown', handleKeyDown)
  }, [open])

  // Sync when tab changes
  useEffect(() => {
    if (tab) {
      setCurrentUrl(tab.url)
    }
  }, [tab?.id])

  // Wire up webview events once mounted
  const setupWebview = useCallback(
    (el: Electron.WebviewTag | null) => {
      if (!el || webviewRef.current === el) return
      webviewRef.current = el
      if (WEBVIEW_USER_AGENT) {
        console.log(`${TAG} using webview userAgent attribute`)
      }

      el.addEventListener('did-navigate', (e) => {
        console.log(`${TAG} did-navigate: ${e.url}`)
        setCurrentUrl(e.url)
        if (tab) onTabUpdate(tab.id, { url: e.url })
      })

      el.addEventListener('did-navigate-in-page', (e) => {
        if (e.isMainFrame) {
          console.log(`${TAG} did-navigate-in-page: ${e.url}`)
          setCurrentUrl(e.url)
          if (tab) onTabUpdate(tab.id, { url: e.url })
        }
      })

      el.addEventListener('page-title-updated', (e) => {
        if (tab) onTabUpdate(tab.id, { title: e.title })
      })

      el.addEventListener('page-favicon-updated', (e) => {
        if (tab && e.favicons.length > 0) {
          onTabUpdate(tab.id, { favicon: e.favicons[0] })
        }
      })

      el.addEventListener('did-start-loading', () => {
        setPageLoading(true)
        pageLoadingRef.current = true
      })

      el.addEventListener('did-stop-loading', () => {
        setPageLoading(false)
        pageLoadingRef.current = false
        captureScreenshot()
      })

      el.addEventListener('did-fail-load', (e) => {
        if (e.errorCode === -3) return
        console.warn(`${TAG} did-fail-load: ${e.errorDescription} (${e.errorCode}) url=${e.validatedURL}`)
      })
    },
    [tab?.id]
  )

  const captureScreenshot = useCallback(async (): Promise<string | null> => {
    const wv = webviewRef.current
    if (!wv || !tab) return null
    try {
      const wcId = wv.getWebContentsId()
      console.log(`${TAG} Capturing screenshot (webContentsId=${wcId})...`)
      const dataUrl = await window.api.browserTabs.captureScreenshot(wcId)
      if (dataUrl) {
        console.log(`${TAG} Screenshot captured: ${Math.round(dataUrl.length / 1024)}KB`)
        await onTabUpdate(tab.id, { screenshot: dataUrl })
      } else {
        console.warn(`${TAG} Screenshot returned null`)
      }
      return dataUrl
    } catch (err) {
      console.warn(`${TAG} Screenshot failed:`, err)
      return null
    }
  }, [tab?.id, onTabUpdate])

  const handleDialogOpenChange = useCallback(
    async (isOpen: boolean): Promise<void> => {
      if (!isOpen) {
        // Capture screenshot before closing so the node thumbnail is up-to-date
        await captureScreenshot()
        onRecaptureScreenshot?.()
      }
      onOpenChange(isOpen)
    },
    [captureScreenshot, onOpenChange, onRecaptureScreenshot]
  )

  // Ensure Escape always closes this dialog from host-renderer focus contexts.
  useEffect(() => {
    if (!open) return
    const handleEscape = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') {
        void handleDialogOpenChange(false)
      }
    }
    window.addEventListener('keydown', handleEscape)
    return (): void => window.removeEventListener('keydown', handleEscape)
  }, [open, handleDialogOpenChange])

  // Wait for any in-progress page loads to finish (with timeout)
  const waitForPageSettle = useCallback(async (): Promise<void> => {
    // Give a brief moment for any navigation to start
    await new Promise((r) => setTimeout(r, 500))
    // Then poll until loading finishes or timeout
    const deadline = Date.now() + 5000
    while (pageLoadingRef.current && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200))
    }
    // Extra settling time for JS frameworks to render
    await new Promise((r) => setTimeout(r, 500))
  }, [])

  // ─── Navigation ─────────────────────────────────────────────────────────────

  const handleNavigate = useCallback((url: string) => {
    console.log(`${TAG} Navigate to: ${url}`)
    webviewRef.current?.loadURL(url).catch((err: Error) => {
      if (err.message?.includes('ERR_ABORTED')) return
      console.warn(`${TAG} loadURL error:`, err.message)
    })
  }, [])

  const handleBack = useCallback(() => {
    webviewRef.current?.goBack()
  }, [])

  const handleForward = useCallback(() => {
    webviewRef.current?.goForward()
  }, [])

  const handleReload = useCallback(() => {
    webviewRef.current?.reload()
  }, [])

  // ─── AI Page Context ────────────────────────────────────────────────────────

  const gatherPageContext = useCallback(
    async (includeScreenshot: boolean): Promise<PageContext> => {
      const wv = webviewRef.current
      if (!wv) {
        console.warn(`${TAG} gatherPageContext: no webview ref`)
        return { url: currentUrl, title: '', text: '', elements: '' }
      }

      console.log(`${TAG} Gathering page context (screenshot=${includeScreenshot})...`)

      try {
        const promises: [Promise<string>, Promise<string>, Promise<string | null>] = [
          wv.executeJavaScript(`document.body.innerText.slice(0, 8000)`),
          wv.executeJavaScript(`
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
          includeScreenshot ? captureScreenshot() : Promise.resolve(null)
        ]

        const [text, elements, screenshot] = await Promise.all(promises)

        const elementCount = elements ? elements.split('\n').length : 0
        console.log(`${TAG} Context gathered — url=${wv.getURL()} elements=${elementCount} text=${text?.length ?? 0} chars screenshot=${screenshot ? 'yes' : 'no'}`)

        const ctx: PageContext = {
          url: wv.getURL(),
          title: wv.getTitle(),
          text: text || '',
          elements: elements || ''
        }
        if (screenshot) {
          ctx.screenshot = screenshot
        }
        return ctx
      } catch (err) {
        console.error(`${TAG} gatherPageContext error:`, err)
        return { url: currentUrl, title: '', text: '', elements: '' }
      }
    },
    [currentUrl, captureScreenshot]
  )

  // ─── AI Action Execution ────────────────────────────────────────────────────

  const executeBrowserActions = useCallback(
    async (actions: BrowserAction[]): Promise<ActionResult[]> => {
      const wv = webviewRef.current
      if (!wv) {
        console.warn(`${TAG} executeBrowserActions: no webview ref`)
        return []
      }

      console.log(`${TAG} Executing ${actions.length} browser action(s)...`)
      const results: ActionResult[] = []

      for (let i = 0; i < actions.length; i++) {
        const action = actions[i]
        console.log(`${TAG}   [${i}/${actions.length}] ${action.type}${action.index !== undefined ? ` index=${action.index}` : ''}${action.value ? ` value="${action.value.slice(0, 50)}"` : ''}${action.url ? ` url=${action.url}` : ''}`)

        try {
          switch (action.type) {
            case 'click':
              if (action.index !== undefined) {
                const result = await wv.executeJavaScript(`
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
                console.log(`${TAG}     → click: ${parsed.desc}`)
                results.push({ type: 'click', description: parsed.desc, success: parsed.ok })
              }
              break

            case 'fill':
              if (action.index !== undefined && action.value !== undefined) {
                const escapedValue = action.value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')
                const result = await wv.executeJavaScript(`
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
                        const escapeHtml = (value) =>
                          value
                            .replace(/&/g, '&amp;')
                            .replace(/</g, '&lt;')
                            .replace(/>/g, '&gt;')
                            .replace(/"/g, '&quot;')
                            .replace(/'/g, '&#39;');
                        const renderInlineMarkdown = (value) => {
                          let out = escapeHtml(value);
                          out = out.replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^\\s)]+)\\)/g, '<a href="$2">$1</a>');
                          out = out.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
                          out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
                          out = out.replace(/\\*([^*\\n]+)\\*/g, '<em>$1</em>');
                          out = out.replace(/_([^_\\n]+)_/g, '<em>$1</em>');
                          out = out.replace(/~~([^~]+)~~/g, '<s>$1</s>');
                          return out;
                        };
                        const markdownToHtml = (value) => {
                          const lines = value.replace(/\\r\\n/g, '\\n').split('\\n');
                          const htmlParts = [];
                          let listType = null;
                          const closeList = () => {
                            if (listType) {
                              htmlParts.push('</' + listType + '>');
                              listType = null;
                            }
                          };
                          for (const raw of lines) {
                            const line = raw.trimEnd();
                            if (!line.trim()) {
                              closeList();
                              continue;
                            }
                            const heading = line.match(/^(#{1,6})\\s+(.*)$/);
                            if (heading) {
                              closeList();
                              const level = heading[1].length;
                              htmlParts.push('<h' + level + '>' + renderInlineMarkdown(heading[2].trim()) + '</h' + level + '>');
                              continue;
                            }
                            const ul = line.match(/^\\s*[-*]\\s+(.*)$/);
                            if (ul) {
                              if (listType !== 'ul') {
                                closeList();
                                htmlParts.push('<ul>');
                                listType = 'ul';
                              }
                              htmlParts.push('<li>' + renderInlineMarkdown(ul[1].trim()) + '</li>');
                              continue;
                            }
                            const ol = line.match(/^\\s*\\d+\\.\\s+(.*)$/);
                            if (ol) {
                              if (listType !== 'ol') {
                                closeList();
                                htmlParts.push('<ol>');
                                listType = 'ol';
                              }
                              htmlParts.push('<li>' + renderInlineMarkdown(ol[1].trim()) + '</li>');
                              continue;
                            }
                            const quote = line.match(/^\\s*>\\s?(.*)$/);
                            if (quote) {
                              closeList();
                              htmlParts.push('<blockquote>' + renderInlineMarkdown(quote[1].trim()) + '</blockquote>');
                              continue;
                            }
                            closeList();
                            htmlParts.push('<p>' + renderInlineMarkdown(line.trim()) + '</p>');
                          }
                          closeList();
                          return htmlParts.join('');
                        };
                        const looksLikeMarkdown =
                          /(^|\\n)\\s{0,3}(#{1,6}\\s|[-*]\\s|\\d+\\.\\s|>\\s)|\\*\\*|__|~~|\\[[^\\]]+\\]\\([^)]+\\)/m.test(rawValue);
                        const htmlValue = looksLikeMarkdown
                          ? markdownToHtml(rawValue)
                          : escapeHtml(rawValue).replace(/\\n/g, '<br>');
                        const selection = window.getSelection();
                        if (selection) {
                          const range = document.createRange();
                          range.selectNodeContents(el);
                          selection.removeAllRanges();
                          selection.addRange(range);
                        }
                        try { document.execCommand('insertHTML', false, htmlValue); } catch {}
                        if ((el.innerHTML || '').trim() !== htmlValue.trim()) {
                          el.innerHTML = htmlValue;
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

                      return JSON.stringify({
                        ok: true,
                        desc: fieldName + ' = "' + rawValue + '"' + ((el.isContentEditable || role === 'textbox') ? ' (rich)' : '')
                      });
                    }
                    return JSON.stringify({ ok: false, desc: 'element not found (index ${action.index}, total=' + els.length + ')' });
                  })()
                `)
                const parsed = JSON.parse(result)
                console.log(`${TAG}     → fill: ${parsed.desc}`)
                results.push({ type: 'fill', description: parsed.desc, success: parsed.ok })
              }
              break

            case 'navigate':
              if (action.url) {
                console.log(`${TAG}     → navigating to ${action.url}`)
                wv.loadURL(action.url).catch((err: Error) => {
                  if (err.message?.includes('ERR_ABORTED')) return
                  console.warn(`${TAG}     → navigate error: ${err.message}`)
                })
                results.push({ type: 'navigate', description: action.url, success: true })
              }
              break

            case 'scroll': {
              const amt = action.amount ?? 500
              const dir = action.direction === 'up' ? -amt : amt
              await wv.executeJavaScript(`window.scrollBy(0, ${dir})`)
              console.log(`${TAG}     → scrolled ${action.direction} by ${Math.abs(dir)}px`)
              results.push({ type: 'scroll', description: `${action.direction} ${Math.abs(dir)}px`, success: true })
              break
            }

            default:
              console.log(`${TAG}     → skipped (no-op for type "${action.type}")`)
          }
        } catch (err) {
          console.warn(`${TAG}     → FAILED: ${action.type}`, err)
          results.push({ type: action.type, description: `Error: ${err}`, success: false })
        }

        // 300ms delay between actions
        await new Promise((r) => setTimeout(r, 300))
      }

      // After all actions, sync the current URL and title back to the tab
      console.log(`${TAG} All actions executed, syncing URL + recapturing screenshot in 500ms...`)
      setTimeout(async () => {
        const wvAfter = webviewRef.current
        if (wvAfter && tab) {
          const newUrl = wvAfter.getURL()
          const newTitle = wvAfter.getTitle()
          if (newUrl && newUrl !== 'about:blank') {
            setCurrentUrl(newUrl)
            await onTabUpdate(tab.id, { url: newUrl, title: newTitle || tab.title })
          }
        }
        captureScreenshot()
      }, 500)
      return results
    },
    [captureScreenshot, tab?.id, onTabUpdate]
  )

  if (!tab) return <></>

  return (
    <Dialog open={open} onOpenChange={(isOpen) => void handleDialogOpenChange(isOpen)}>
      <DialogContent
        className="flex h-[90vh] max-h-[90vh] w-[95vw] max-w-[95vw] flex-col gap-0 overflow-hidden rounded-xl p-0 !left-[2.5vw] !top-[5vh] !translate-x-0 !translate-y-0 !transform-none data-[state=open]:animate-none data-[state=closed]:animate-none [&>button:last-child]:hidden"
      >
        <div className="no-drag flex flex-1 overflow-hidden">
          {/* Left: Browser */}
          <div className="grid flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
            <AddressBar
              ref={addressBarRef}
              url={currentUrl}
              loading={pageLoading}
              onNavigate={handleNavigate}
              onBack={handleBack}
              onForward={handleForward}
              onReload={handleReload}
            />
            <div className="flex-1 bg-white dark:bg-zinc-900">
                <webview
                  ref={setupWebview}
                  src={tab.url || 'about:blank'}
                  partition="persist:browser-tabs"
                  useragent={WEBVIEW_USER_AGENT}
                // @ts-expect-error webview attributes aren't fully typed in React
                allowpopups="true"
                style={{ width: '100%', height: '100%' }}
              />
            </div>
          </div>

          <button
            type="button"
            aria-controls="tab-ai-chat-sidebar"
            aria-expanded={!chatCollapsed}
            aria-label={chatCollapsed ? 'Expand AI chat sidebar' : 'Collapse AI chat sidebar'}
            title={chatCollapsed ? 'Show AI chat' : 'Hide AI chat'}
            onClick={() => setChatCollapsed((v) => !v)}
            className="no-drag -ml-3 mr-1 mt-2 z-20 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-background text-foreground/70 shadow-sm transition-colors hover:bg-muted hover:text-foreground"
          >
            {chatCollapsed ? <ChevronLeft className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>

          {/* Right: AI Chat */}
          <div
            id="tab-ai-chat-sidebar"
            className={`no-drag shrink-0 overflow-hidden border-l transition-[width,opacity] duration-200 ease-out ${
              chatCollapsed ? 'w-0 border-l-0 opacity-0 pointer-events-none' : 'w-[320px] opacity-100'
            }`}
          >
            <BrowserTabChat
              tabId={tab.id}
              gatherPageContext={gatherPageContext}
              executeBrowserActions={executeBrowserActions}
              waitForPageSettle={waitForPageSettle}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
