import { useRef, useState, useCallback, useEffect } from 'react'
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
  'a, button, input, textarea, select, [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"], [role="row"], [role="listbox"], [role="checkbox"], [role="switch"], [tabindex], [onclick], [data-action]'

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
              // Deduplicate: skip elements that are children of another matched element
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
                      // Focus first for input-like elements
                      if (['input','textarea','select'].includes(tag) || el.isContentEditable) {
                        el.focus();
                      }
                      // Full pointer + mouse event sequence for React/SPA compatibility
                      const rect = el.getBoundingClientRect();
                      const x = rect.left + rect.width / 2;
                      const y = rect.top + rect.height / 2;
                      const eo = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
                      el.dispatchEvent(new PointerEvent('pointerdown', { ...eo, pointerId: 1 }));
                      el.dispatchEvent(new MouseEvent('mousedown', eo));
                      el.dispatchEvent(new PointerEvent('pointerup', { ...eo, pointerId: 1 }));
                      el.dispatchEvent(new MouseEvent('mouseup', eo));
                      el.dispatchEvent(new MouseEvent('click', eo));
                      // Also try submitting parent form if it's a submit button
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

                      // Use native setter for React/framework compatibility
                      const proto = tag === 'textarea'
                        ? window.HTMLTextAreaElement.prototype
                        : window.HTMLInputElement.prototype;
                      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                      if (nativeSetter) {
                        nativeSetter.call(el, '${escapedValue}');
                      } else {
                        el.value = '${escapedValue}';
                      }

                      // Fire full event sequence for framework compat
                      el.dispatchEvent(new Event('input', { bubbles: true }));
                      el.dispatchEvent(new Event('change', { bubbles: true }));
                      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: '${escapedValue}', inputType: 'insertText' }));

                      return JSON.stringify({ ok: true, desc: name + ' = "${escapedValue}"' });
                    }
                    return JSON.stringify({ ok: false, desc: 'element not found (index ${action.index}, total=' + els.length + ')' });
                  })()
                `)
                const parsed = JSON.parse(result)
                console.log(`${TAG}     → fill: ${parsed.desc}`)
                results.push({ type: 'fill', description: parsed.desc, success: parsed.ok })

                // After filling, simulate Enter key to trigger search/submit
                await new Promise((r) => setTimeout(r, 100))
                await wv.executeJavaScript(`
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
                      // Also try form submit
                      const form = el.closest('form');
                      if (form) {
                        form.requestSubmit ? form.requestSubmit() : form.submit();
                      }
                    }
                  })()
                `)
                console.log(`${TAG}     → dispatched Enter key + form submit`)
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

          {/* Right: AI Chat */}
          <div className="no-drag w-[320px] shrink-0 border-l">
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
