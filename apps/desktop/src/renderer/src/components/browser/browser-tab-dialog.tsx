import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { AddressBar, type AddressBarHandle } from './address-bar'
import { BrowserTabChat } from './browser-tab-chat'
import type { BrowserTab, BrowserAction, ActionResult, PageContext } from '@/hooks/use-browser-tabs'
import { getWebviewUserAgent } from '@/lib/webview-user-agent'

interface BrowserTabDialogProps {
  tab: BrowserTab | null
  boardId?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onTabUpdate: (id: string, data: Record<string, unknown>) => Promise<unknown>
  onRecaptureScreenshot?: () => void
  onWebviewStateChange?: (tabId: string, webview: Electron.WebviewTag | null) => void
}

const TAG = '[browser-dialog]'
const WEBVIEW_USER_AGENT = getWebviewUserAgent()

// Selector for interactive elements — broad enough for modern web apps (Gmail, etc.)
const INTERACTIVE_SELECTOR =
  'a[href], button, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"], [role="row"], [role="checkbox"], [role="switch"], [role="textbox"], [aria-label], [data-tooltip], [onclick], [data-action]'

export function BrowserTabDialog({
  tab,
  boardId,
  open,
  onOpenChange,
  onTabUpdate,
  onRecaptureScreenshot,
  onWebviewStateChange
}: BrowserTabDialogProps): React.ReactElement {
  const webviewRef = useRef<Electron.WebviewTag | null>(null)
  const addressBarRef = useRef<AddressBarHandle>(null)
  const webviewSrc = useMemo(() => {
    if (!open || !tab) return 'about:blank'
    return tab.url || 'about:blank'
  }, [open, tab?.id])
  const [currentUrl, setCurrentUrl] = useState(tab?.url ?? 'about:blank')
  const currentUrlRef = useRef(currentUrl)
  const [pageLoading, setPageLoading] = useState(false)
  const [chatCollapsed, setChatCollapsed] = useState(false)
  const pageLoadingRef = useRef(false)
  const tabIdRef = useRef<string | null>(tab?.id ?? null)
  const webContentsIdRef = useRef<number | null>(null)
  const onTabUpdateRef = useRef(onTabUpdate)
  const webviewCleanupRef = useRef<(() => void) | null>(null)

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

  useEffect(() => {
    tabIdRef.current = tab?.id ?? null
  }, [tab?.id])

  useEffect(() => {
    onTabUpdateRef.current = onTabUpdate
  }, [onTabUpdate])

  // Sync address bar display when tab URL changes externally.
  // Do NOT update initialUrlRef — changing the webview src attribute
  // triggers Electron to reload, creating an infinite navigation loop.
  useEffect(() => {
    const nextUrl = tab?.url || 'about:blank'
    setCurrentUrl(nextUrl)
  }, [tab?.id, tab?.url])

  useEffect(() => {
    currentUrlRef.current = currentUrl
  }, [currentUrl])

  const publishLiveWebContents = useCallback((webContentsId?: number | null): void => {
    const tabId = tabIdRef.current
    if (!tabId) return
    void window.api.browserTabs
      .setLiveWebContents(tabId, webContentsId ?? null)
      .catch((error) => {
        console.warn(`${TAG} failed to publish live webContents mapping tab=${tabId}:`, error)
      })
  }, [])

  // Unmount cleanup is handled by setupWebview(null) — React calls
  // the ref callback with null when the component unmounts, which
  // already clears events, IPC state, and webviewRef.

  const persistTabUpdate = useCallback(async (data: Record<string, unknown>): Promise<void> => {
    const tabId = tabIdRef.current
    if (!tabId) return
    try {
      await onTabUpdateRef.current(tabId, data)
    } catch (error) {
      console.warn(`${TAG} failed to persist tab update id=${tabId}:`, error)
    }
  }, [])

  const captureScreenshot = useCallback(async (): Promise<string | null> => {
    const wv = webviewRef.current
    const tabId = tabIdRef.current
    if (!wv || !tabId) return null
    try {
      const wcId = wv.getWebContentsId()
      console.log(`${TAG} Capturing screenshot (webContentsId=${wcId})...`)
      const dataUrl = await window.api.browserTabs.captureScreenshot(wcId)
      if (dataUrl) {
        console.log(`${TAG} Screenshot captured: ${Math.round(dataUrl.length / 1024)}KB`)
        await persistTabUpdate({ screenshot: dataUrl })
      } else {
        console.warn(`${TAG} Screenshot returned null`)
      }
      return dataUrl
    } catch (err) {
      console.warn(`${TAG} Screenshot failed:`, err)
      return null
    }
  }, [persistTabUpdate])

  // Wire up webview events once mounted
  const setupWebview = useCallback(
    (el: Electron.WebviewTag | null) => {
      if (!el) {
        const tabId = tabIdRef.current
        if (tabId) {
          onWebviewStateChange?.(tabId, null)
        }
        publishLiveWebContents(null)
        webContentsIdRef.current = null
        webviewCleanupRef.current?.()
        webviewCleanupRef.current = null
        webviewRef.current = null
        return
      }
      if (webviewRef.current === el) return
      try {
        const nextId = el.getWebContentsId()
        if (Number.isFinite(nextId)) {
          webContentsIdRef.current = nextId
          publishLiveWebContents(nextId)
        }
      } catch {
        // guest may not be ready yet; we'll retry on dom-ready/context gather
      }
      webviewCleanupRef.current?.()
      webviewRef.current = el
      const tabId = tabIdRef.current
      if (tabId) {
        onWebviewStateChange?.(tabId, el)
      }
      if (WEBVIEW_USER_AGENT) {
        console.log(`${TAG} using webview userAgent attribute`)
      }

      const handleDidNavigate = (e: Electron.DidNavigateEvent): void => {
        console.log(`${TAG} did-navigate: ${e.url}`)
        setCurrentUrl(e.url)
        void persistTabUpdate({ url: e.url })
      }

      const handleDidNavigateInPage = (e: Electron.DidNavigateInPageEvent): void => {
        if (e.isMainFrame) {
          console.log(`${TAG} did-navigate-in-page: ${e.url}`)
          setCurrentUrl(e.url)
          void persistTabUpdate({ url: e.url })
        }
      }

      const handleTitleUpdated = (e: Electron.PageTitleUpdatedEvent): void => {
        void persistTabUpdate({ title: e.title })
      }

      const handleFaviconUpdated = (e: Electron.PageFaviconUpdatedEvent): void => {
        const nextFavicon = e.favicons.length > 0 ? e.favicons[0] : null
        void persistTabUpdate({ favicon: nextFavicon })
      }

      const handleDidStartLoading = (): void => {
        setPageLoading(true)
        pageLoadingRef.current = true
      }

      const handleDidStopLoading = (): void => {
        setPageLoading(false)
        pageLoadingRef.current = false
        void (async () => {
          try {
            const [liveUrl, liveTitle] = await Promise.all([
              el.executeJavaScript(`window.location.href || ''`) as Promise<string>,
              el.executeJavaScript(`document.title || ''`) as Promise<string>
            ])
            const normalizedUrl = typeof liveUrl === 'string' ? liveUrl.trim() : ''
            const normalizedTitle = typeof liveTitle === 'string' ? liveTitle.trim() : ''
            if (normalizedUrl) {
              setCurrentUrl(normalizedUrl)
              const updatePayload: Record<string, unknown> = { url: normalizedUrl }
              if (normalizedTitle) updatePayload.title = normalizedTitle
              await persistTabUpdate(updatePayload)
            }
          } catch {
            // ignore URL/title sync errors and keep screenshot flow
          }
          await captureScreenshot()
        })()
      }

      const handleDidFailLoad = (e: Electron.DidFailLoadEvent): void => {
        if (e.errorCode === -3) return
        console.warn(`${TAG} did-fail-load: ${e.errorDescription} (${e.errorCode}) url=${e.validatedURL}`)
      }

      const handleNewWindow = (event: Event): void => {
        const popupEvent = event as Event & { url?: string; preventDefault?: () => void }
        popupEvent.preventDefault?.()
        const popupUrl = typeof popupEvent.url === 'string' ? popupEvent.url : ''
        if (!popupUrl) return
        console.log(`${TAG} redirecting popup to current tab: ${popupUrl}`)
        setCurrentUrl(popupUrl)
        void persistTabUpdate({ url: popupUrl })
        el.loadURL(popupUrl).catch((error: Error) => {
          if (error.message?.includes('ERR_ABORTED')) return
          console.warn(`${TAG} popup redirect loadURL error:`, error)
        })
      }

      const handleDomReady = (): void => {
        try {
          const wcId = el.getWebContentsId()
          if (Number.isFinite(wcId)) {
            webContentsIdRef.current = wcId
            publishLiveWebContents(wcId)
          }
        } catch {
          // ignore
        }
        void el.executeJavaScript(`
          (() => {
            try {
              const rewriteAnchorTarget = (root) => {
                const links = root.querySelectorAll ? root.querySelectorAll('a[target="_blank"]') : [];
                for (const link of links) {
                  link.setAttribute('target', '_self');
                  const rel = (link.getAttribute('rel') || '').split(/\\s+/).filter(Boolean);
                  const filtered = rel.filter((value) => value !== 'noopener' && value !== 'noreferrer');
                  if (filtered.length > 0) {
                    link.setAttribute('rel', filtered.join(' '));
                  } else {
                    link.removeAttribute('rel');
                  }
                }
              };

              rewriteAnchorTarget(document);
              const observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                  for (const node of mutation.addedNodes) {
                    if (node && node.nodeType === Node.ELEMENT_NODE) {
                      rewriteAnchorTarget(node);
                    }
                  }
                }
              });
              observer.observe(document.documentElement || document.body, {
                childList: true,
                subtree: true
              });

              const originalOpen = window.open;
              window.open = function (url, target, features) {
                if (typeof url === 'string' && url.length > 0) {
                  location.href = url;
                }
                return null;
              };
              Object.defineProperty(window, '__hooOriginalWindowOpen', {
                value: originalOpen,
                configurable: true,
                writable: true
              });
            } catch {}
          })();
        `).catch(() => {})
      }

      el.addEventListener('did-navigate', handleDidNavigate)
      el.addEventListener('did-navigate-in-page', handleDidNavigateInPage)
      el.addEventListener('page-title-updated', handleTitleUpdated)
      el.addEventListener('page-favicon-updated', handleFaviconUpdated)
      el.addEventListener('did-start-loading', handleDidStartLoading)
      el.addEventListener('did-stop-loading', handleDidStopLoading)
      el.addEventListener('did-fail-load', handleDidFailLoad)
      el.addEventListener('new-window', handleNewWindow)
      el.addEventListener('dom-ready', handleDomReady)

      webviewCleanupRef.current = (): void => {
        el.removeEventListener('did-navigate', handleDidNavigate)
        el.removeEventListener('did-navigate-in-page', handleDidNavigateInPage)
        el.removeEventListener('page-title-updated', handleTitleUpdated)
        el.removeEventListener('page-favicon-updated', handleFaviconUpdated)
        el.removeEventListener('did-start-loading', handleDidStartLoading)
        el.removeEventListener('did-stop-loading', handleDidStopLoading)
        el.removeEventListener('did-fail-load', handleDidFailLoad)
        el.removeEventListener('new-window', handleNewWindow)
        el.removeEventListener('dom-ready', handleDomReady)
      }
    },
    [captureScreenshot, persistTabUpdate, onWebviewStateChange, publishLiveWebContents]
  )

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
    window.addEventListener('keydown', handleEscape, true)
    return (): void => window.removeEventListener('keydown', handleEscape, true)
  }, [open, handleDialogOpenChange])

  // Wait for any in-progress page loads to finish (with timeout)
  const waitForPageSettle = useCallback(async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, 350))
    const deadline = Date.now() + 9000
    while (Date.now() < deadline) {
      const wv = webviewRef.current
      if (!wv) break

      let stillLoading = pageLoadingRef.current
      try {
        stillLoading = stillLoading || wv.isLoading()
      } catch {
        // ignore and rely on event state
      }

      if (!stillLoading) {
        try {
          const readyState = await wv.executeJavaScript('document.readyState')
          if (readyState === 'complete' || readyState === 'interactive') {
            break
          }
        } catch {
          // ignore and keep polling
        }
      }
      await new Promise((r) => setTimeout(r, 250))
    }
    await new Promise((r) => setTimeout(r, 350))
  }, [])

  // ─── Navigation ─────────────────────────────────────────────────────────────

  const handleNavigate = useCallback((url: string) => {
    console.log(`${TAG} Navigate to: ${url}`)
    setCurrentUrl(url)
    void persistTabUpdate({ url })
    webviewRef.current?.loadURL(url).catch((err: Error) => {
      if (err.message?.includes('ERR_ABORTED')) return
      console.warn(`${TAG} loadURL error:`, err.message)
    })
  }, [persistTabUpdate])

  const handleBack = useCallback(() => {
    webviewRef.current?.goBack()
  }, [])

  const handleForward = useCallback(() => {
    webviewRef.current?.goForward()
  }, [])

  const handleReload = useCallback(() => {
    webviewRef.current?.reload()
  }, [])

  const handleTogglePin = useCallback(() => {
    const tabId = tabIdRef.current
    if (!tabId) return
    const current = tab?.pinnedUrl
    const nextPinned = current ? null : currentUrl
    void persistTabUpdate({ pinnedUrl: nextPinned })
  }, [currentUrl, tab?.pinnedUrl, persistTabUpdate])

  const handleGoHome = useCallback(() => {
    if (!tab?.pinnedUrl) return
    handleNavigate(tab.pinnedUrl)
  }, [tab?.pinnedUrl, handleNavigate])

  // Fallback URL/title synchronization in case webview navigation events miss.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    const poll = async (): Promise<void> => {
      if (cancelled) return
      const wv = webviewRef.current
      if (!wv) return

      let liveUrl = ''
      let liveTitle = ''
      try {
        liveUrl = (wv.getURL() || '').trim()
      } catch {
        liveUrl = ''
      }

      if (!liveUrl || liveUrl === 'about:blank') {
        try {
          const viaJs = await wv.executeJavaScript(`window.location.href || ''`)
          liveUrl = typeof viaJs === 'string' ? viaJs.trim() : ''
        } catch {
          liveUrl = ''
        }
      }

      try {
        liveTitle = (wv.getTitle() || '').trim()
      } catch {
        liveTitle = ''
      }
      if (!liveTitle) {
        try {
          const viaJsTitle = await wv.executeJavaScript(`document.title || ''`)
          liveTitle = typeof viaJsTitle === 'string' ? viaJsTitle.trim() : ''
        } catch {
          liveTitle = ''
        }
      }

      if (!liveUrl) return
      if (liveUrl !== currentUrlRef.current) {
        setCurrentUrl(liveUrl)
        const payload: Record<string, unknown> = { url: liveUrl }
        if (liveTitle) payload.title = liveTitle
        void persistTabUpdate(payload)
      }
    }

    const timer = window.setInterval(() => {
      void poll()
    }, 700)
    void poll()

    return (): void => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [open, persistTabUpdate])

  // ─── AI Page Context ────────────────────────────────────────────────────────

  const gatherPageContext = useCallback(
    async (includeScreenshot: boolean): Promise<PageContext> => {
      const wv = webviewRef.current
      const resolveWebContentsId = (): number | undefined => {
        try {
          const id = wv?.getWebContentsId()
          if (typeof id === 'number' && Number.isFinite(id)) {
            webContentsIdRef.current = id
            return id
          }
        } catch {
          // ignore
        }
        const cached = webContentsIdRef.current
        return typeof cached === 'number' && Number.isFinite(cached) ? cached : undefined
      }
      const safeUrl = (): string => {
        try {
          const url = wv?.getURL()
          if (typeof url === 'string' && url.length > 0) return url
        } catch {
          // ignore
        }
        return currentUrl
      }
      const safeTitle = (): string => {
        try {
          const title = wv?.getTitle()
          return typeof title === 'string' ? title : ''
        } catch {
          return ''
        }
      }
      if (!wv) {
        console.warn(`${TAG} gatherPageContext: no webview ref`)
        return {
          url: currentUrl,
          title: '',
          text: '',
          elements: '',
          webContentsId: resolveWebContentsId(),
          includeScreenshot,
          screenshot: includeScreenshot ? tab?.screenshot ?? undefined : undefined
        }
      }

      console.log(`${TAG} Gathering page context (screenshot=${includeScreenshot})...`)

      try {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          if (attempt > 1) {
            await waitForPageSettle()
          }

          const promises: [Promise<string>, Promise<string>, Promise<string | null>] = [
            wv.executeJavaScript(`document.body?.innerText?.slice(0, 8000) || ''`) as Promise<string>,
            (wv.executeJavaScript(`
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
            `) as Promise<string>),
            includeScreenshot ? captureScreenshot() : Promise.resolve(null)
          ]

          const settled = await Promise.allSettled(promises)
          const text = settled[0].status === 'fulfilled' ? (settled[0].value || '') : ''
          const elements = settled[1].status === 'fulfilled' ? (settled[1].value || '') : ''
          const screenshot = settled[2].status === 'fulfilled' ? settled[2].value : null
          if (settled[0].status === 'rejected') {
            console.warn(`${TAG} gatherPageContext text extract failed attempt=${attempt}:`, settled[0].reason)
          }
          if (settled[1].status === 'rejected') {
            console.warn(`${TAG} gatherPageContext element extract failed attempt=${attempt}:`, settled[1].reason)
          }
          if (settled[2].status === 'rejected') {
            console.warn(`${TAG} gatherPageContext screenshot extract failed attempt=${attempt}:`, settled[2].reason)
          }
          const normalizedText = (text || '').trim()
          const normalizedElements = (elements || '').trim()
          const elementCount = normalizedElements.length > 0 ? normalizedElements.split('\n').filter(Boolean).length : 0
          const title = safeTitle()
          const url = safeUrl()
          const webContentsId = resolveWebContentsId()
          if (typeof webContentsId === 'number' && Number.isFinite(webContentsId)) {
            publishLiveWebContents(webContentsId)
          }
          const fallbackScreenshot = includeScreenshot ? tab?.screenshot ?? null : null
          const effectiveScreenshot = screenshot || fallbackScreenshot
          const sparseContext = normalizedText.length < 40 && elementCount <= 1 && !title && !effectiveScreenshot

          console.log(
            `${TAG} Context gathered — url=${url} elements=${elementCount} text=${normalizedText.length} chars screenshot=${effectiveScreenshot ? 'yes' : 'no'} attempt=${attempt}`
          )

          if (sparseContext && attempt < 3) {
            console.warn(`${TAG} Sparse page context (attempt ${attempt}/3), retrying...`)
            continue
          }

          const ctx: PageContext = {
            url,
            title,
            text: text || '',
            elements: elements || '',
            webContentsId,
            includeScreenshot
          }
          if (effectiveScreenshot) {
            ctx.screenshot = effectiveScreenshot
          }
          return ctx
        }

        const fallbackScreenshot = includeScreenshot ? tab?.screenshot ?? undefined : undefined
        const fallbackWebContentsId = resolveWebContentsId()
        if (typeof fallbackWebContentsId === 'number' && Number.isFinite(fallbackWebContentsId)) {
          publishLiveWebContents(fallbackWebContentsId)
        }
        return {
          url: safeUrl(),
          title: safeTitle(),
          text: '',
          elements: '',
          webContentsId: fallbackWebContentsId,
          includeScreenshot,
          screenshot: fallbackScreenshot
        }
      } catch (err) {
        console.error(`${TAG} gatherPageContext error:`, err)
        const fallbackScreenshot = includeScreenshot ? tab?.screenshot ?? undefined : undefined
        const fallbackWebContentsId = resolveWebContentsId()
        if (typeof fallbackWebContentsId === 'number' && Number.isFinite(fallbackWebContentsId)) {
          publishLiveWebContents(fallbackWebContentsId)
        }
        return {
          url: safeUrl(),
          title: safeTitle(),
          text: '',
          elements: '',
          screenshot: fallbackScreenshot,
          webContentsId: fallbackWebContentsId,
          includeScreenshot
        }
      }
    },
    [currentUrl, captureScreenshot, waitForPageSettle, tab?.screenshot, publishLiveWebContents]
  )

  // ─── AI Action Execution ────────────────────────────────────────────────────

  // Execute browser actions via main process native input events (sendInputEvent/insertText)
  const executeBrowserActions = useCallback(
    async (actions: BrowserAction[]): Promise<ActionResult[]> => {
      const wv = webviewRef.current
      if (!wv) {
        console.warn(`${TAG} executeBrowserActions: no webview ref`)
        return []
      }

      // Resolve the webContentsId so the main process can operate on the right webContents
      let wcId: number | undefined
      try {
        wcId = wv.getWebContentsId()
      } catch {
        wcId = webContentsIdRef.current ?? undefined
      }
      if (typeof wcId !== 'number' || !Number.isFinite(wcId)) {
        console.warn(`${TAG} executeBrowserActions: no webContentsId available`)
        return []
      }

      console.log(`${TAG} Executing ${actions.length} action(s) via main process (wc=${wcId})...`)

      try {
        const response = await window.api.browserTabs.executeActions(wcId, actions)
        const results: ActionResult[] = (response.results ?? []).map(
          (r: { type: string; description: string; success: boolean }) => ({
            type: r.type,
            description: r.description,
            success: r.success
          })
        )

        // After actions, sync the URL from the webview back to the renderer
        setTimeout(async () => {
          const wvAfter = webviewRef.current
          if (wvAfter) {
            try {
              const newUrl = wvAfter.getURL()
              const newTitle = wvAfter.getTitle()
              if (newUrl && newUrl !== 'about:blank') {
                setCurrentUrl(newUrl)
                const updatePayload: Record<string, unknown> = { url: newUrl }
                if (newTitle) updatePayload.title = newTitle
                await persistTabUpdate(updatePayload)
              }
            } catch {
              // ignore URL sync errors
            }
          }
          void captureScreenshot()
        }, 500)

        return results
      } catch (err) {
        console.error(`${TAG} executeBrowserActions IPC failed:`, err)
        return []
      }
    },
    [captureScreenshot, persistTabUpdate]
  )

  if (!tab || !open) return <></>

  return (
    <div
      className="fixed inset-0 z-50"
    >
      <div
        aria-hidden
        onMouseDown={(event) => {
          event.preventDefault()
          void handleDialogOpenChange(false)
        }}
        className="absolute inset-0 bg-black/80"
      />

      <div
        role="dialog"
        aria-modal="true"
        className="no-drag absolute left-[2.5vw] top-[5vh] flex h-[90vh] max-h-[90vh] w-[95vw] max-w-[95vw] flex-col gap-0 overflow-hidden rounded-xl border bg-background p-0 shadow-lg"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
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
              pinnedUrl={tab?.pinnedUrl}
              onTogglePin={handleTogglePin}
              onGoHome={handleGoHome}
            />
            <div className="flex-1 bg-white dark:bg-zinc-900">
              <webview
                ref={setupWebview}
                src={webviewSrc}
                partition="persist:browser-tabs"
                useragent={WEBVIEW_USER_AGENT}
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
              boardId={boardId ?? null}
              gatherPageContext={gatherPageContext}
              executeBrowserActions={executeBrowserActions}
              waitForPageSettle={waitForPageSettle}
              onClose={() => void handleDialogOpenChange(false)}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

