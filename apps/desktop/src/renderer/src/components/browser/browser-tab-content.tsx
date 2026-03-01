import { useRef, useState, useCallback, useEffect } from 'react'
import { AddressBar } from './address-bar'
import type { BrowserTab } from '@/hooks/use-browser-tabs'
import { getWebviewUserAgent } from '@/lib/webview-user-agent'

interface BrowserTabContentProps {
  tab: BrowserTab
  boardId?: string | null
  onTabUpdate: (id: string, data: Record<string, unknown>) => Promise<unknown>
}

const TAG = '[browser-tab-content]'
const WEBVIEW_USER_AGENT = getWebviewUserAgent()

export function BrowserTabContent({
  tab,
  boardId,
  onTabUpdate
}: BrowserTabContentProps): React.ReactElement {
  const webviewRef = useRef<Electron.WebviewTag | null>(null)
  const initialUrlRef = useRef(tab.url || 'about:blank')
  const [currentUrl, setCurrentUrl] = useState(tab.url ?? 'about:blank')
  const [pageLoading, setPageLoading] = useState(false)
  const tabIdRef = useRef(tab.id)
  const webContentsIdRef = useRef<number | null>(null)
  const onTabUpdateRef = useRef(onTabUpdate)
  const webviewCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    tabIdRef.current = tab.id
  }, [tab.id])

  useEffect(() => {
    onTabUpdateRef.current = onTabUpdate
  }, [onTabUpdate])

  useEffect(() => {
    const nextUrl = tab.url || 'about:blank'
    setCurrentUrl(nextUrl)
  }, [tab.id])

  const publishLiveWebContents = useCallback((webContentsId?: number | null): void => {
    const tabId = tabIdRef.current
    if (!tabId) return
    void window.api.browserTabs
      .setLiveWebContents(tabId, webContentsId ?? null)
      .catch(() => {})
  }, [])

  const persistTabUpdate = useCallback(async (data: Record<string, unknown>): Promise<void> => {
    const tabId = tabIdRef.current
    if (!tabId) return
    try {
      await onTabUpdateRef.current(tabId, data)
    } catch (error) {
      console.warn(`${TAG} failed to persist tab update:`, error)
    }
  }, [])

  const captureScreenshot = useCallback(async (): Promise<void> => {
    const wv = webviewRef.current
    const tabId = tabIdRef.current
    if (!wv || !tabId) return
    try {
      const wcId = wv.getWebContentsId()
      const dataUrl = await window.api.browserTabs.captureScreenshot(wcId)
      if (dataUrl) {
        await persistTabUpdate({ screenshot: dataUrl })
      }
    } catch {}
  }, [persistTabUpdate])

  const setupWebview = useCallback(
    (el: Electron.WebviewTag | null) => {
      if (!el) {
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
      } catch {}
      webviewCleanupRef.current?.()
      webviewRef.current = el

      const handleDidNavigate = (e: Electron.DidNavigateEvent): void => {
        setCurrentUrl(e.url)
        void persistTabUpdate({ url: e.url })
      }

      const handleDidNavigateInPage = (e: Electron.DidNavigateInPageEvent): void => {
        if (e.isMainFrame) {
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
      }

      const handleDidStopLoading = (): void => {
        setPageLoading(false)
        void (async () => {
          try {
            const [liveUrl, liveTitle] = await Promise.all([
              el.executeJavaScript(`window.location.href || ''`) as Promise<string>,
              el.executeJavaScript(`document.title || ''`) as Promise<string>
            ])
            if (typeof liveUrl === 'string' && liveUrl.trim()) {
              setCurrentUrl(liveUrl.trim())
              const payload: Record<string, unknown> = { url: liveUrl.trim() }
              if (typeof liveTitle === 'string' && liveTitle.trim()) payload.title = liveTitle.trim()
              await persistTabUpdate(payload)
            }
          } catch {}
          await captureScreenshot()
        })()
      }

      const handleDidFailLoad = (e: Electron.DidFailLoadEvent): void => {
        if (e.errorCode === -3) return
        console.warn(`${TAG} did-fail-load: ${e.errorDescription} (${e.errorCode})`)
      }

      const handleNewWindow = (event: Event): void => {
        const popupEvent = event as Event & { url?: string; preventDefault?: () => void }
        popupEvent.preventDefault?.()
        const popupUrl = typeof popupEvent.url === 'string' ? popupEvent.url : ''
        if (!popupUrl) return
        setCurrentUrl(popupUrl)
        void persistTabUpdate({ url: popupUrl })
        el.loadURL(popupUrl).catch((error: Error) => {
          if (error.message?.includes('ERR_ABORTED')) return
          console.warn(`${TAG} popup redirect error:`, error)
        })
      }

      const handleDomReady = (): void => {
        try {
          const wcId = el.getWebContentsId()
          if (Number.isFinite(wcId)) {
            webContentsIdRef.current = wcId
            publishLiveWebContents(wcId)
          }
        } catch {}
        void el.executeJavaScript(`
          (() => {
            try {
              const rewriteAnchorTarget = (root) => {
                const links = root.querySelectorAll ? root.querySelectorAll('a[target="_blank"]') : [];
                for (const link of links) {
                  link.setAttribute('target', '_self');
                }
              };
              rewriteAnchorTarget(document);
              const observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                  for (const node of mutation.addedNodes) {
                    if (node && node.nodeType === Node.ELEMENT_NODE) rewriteAnchorTarget(node);
                  }
                }
              });
              observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
              const originalOpen = window.open;
              window.open = function (url) { if (typeof url === 'string' && url.length > 0) location.href = url; return null; };
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
    [captureScreenshot, persistTabUpdate, publishLiveWebContents]
  )

  const handleNavigate = useCallback((url: string) => {
    setCurrentUrl(url)
    void persistTabUpdate({ url })
    webviewRef.current?.loadURL(url).catch((err: Error) => {
      if (err.message?.includes('ERR_ABORTED')) return
      console.warn(`${TAG} loadURL error:`, err.message)
    })
  }, [persistTabUpdate])

  const handleBack = useCallback(() => { webviewRef.current?.goBack() }, [])
  const handleForward = useCallback(() => { webviewRef.current?.goForward() }, [])
  const handleReload = useCallback(() => { webviewRef.current?.reload() }, [])

  const handleTogglePin = useCallback(() => {
    const tabId = tabIdRef.current
    if (!tabId) return
    const current = tab.pinnedUrl
    const nextPinned = current ? null : currentUrl
    void persistTabUpdate({ pinnedUrl: nextPinned })
  }, [currentUrl, tab.pinnedUrl, persistTabUpdate])

  const handleGoHome = useCallback(() => {
    if (!tab.pinnedUrl) return
    handleNavigate(tab.pinnedUrl)
  }, [tab.pinnedUrl, handleNavigate])

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <AddressBar
        url={currentUrl}
        loading={pageLoading}
        onNavigate={handleNavigate}
        onBack={handleBack}
        onForward={handleForward}
        onReload={handleReload}
        pinnedUrl={tab.pinnedUrl}
        onTogglePin={handleTogglePin}
        onGoHome={handleGoHome}
      />
      <div className="flex-1 min-h-0 bg-white dark:bg-zinc-900">
        <webview
          ref={setupWebview}
          src={initialUrlRef.current}
          partition="persist:browser-tabs"
          useragent={WEBVIEW_USER_AGENT}
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    </div>
  )
}
