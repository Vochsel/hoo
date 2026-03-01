import { useEffect, useRef, useCallback } from 'react'
import type { BrowserTab, BrowserTabMonitor, MonitorRule } from '@/hooks/use-browser-tabs'
import { getWebviewUserAgent } from '@/lib/webview-user-agent'

const TAG = '[monitor]'
const WEBVIEW_USER_AGENT = getWebviewUserAgent()
const POLL_INTERVAL = 60_000
const CRON_ALIGNMENT_GRACE_MS = 250
const MIN_TIMER_DELAY_MS = 25
const COOLDOWN_MS = 5 * 60_000
const LOAD_TIMEOUT = 15_000
const PREVIEW_LIMIT = 120

interface MonitorWebviewsProps {
  tabs: BrowserTab[]
  onMonitorFired: (tabId: string, monitorId: string, extractedValue: string) => void | Promise<void>
  onMonitorRuleGenerated: (tabId: string, monitorId: string, rule: MonitorRule) => void | Promise<void>
  onMonitorExtractedUpdate: (tabId: string, monitorId: string, extracted: string) => void | Promise<void>
}

interface LocalEvalResult {
  fired: boolean
  extracted: string
  reason: string
  found: boolean
  selectorCount: number
  regexMatched: boolean
  regexRaw: string
}

function parseMonitors(tab: BrowserTab): BrowserTabMonitor[] {
  if (!tab.monitors) return []
  try {
    return JSON.parse(tab.monitors) as BrowserTabMonitor[]
  } catch {
    return []
  }
}

function previewText(input: string, max = PREVIEW_LIMIT): string {
  const compact = input.replace(/\s+/g, ' ').trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, max)}...`
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString()
}

function getNextCronTick(nowTs: number): number {
  const baseMinute = Math.floor(nowTs / POLL_INTERVAL) * POLL_INTERVAL
  let next = baseMinute + POLL_INTERVAL + CRON_ALIGNMENT_GRACE_MS
  if (next <= nowTs) {
    next += POLL_INTERVAL
  }
  return next
}

async function runMonitorHook(
  label: string,
  fn: () => void | Promise<void>
): Promise<void> {
  const start = Date.now()
  try {
    await Promise.resolve(fn())
    console.log(`${TAG} hook ${label} complete in ${Date.now() - start}ms`)
  } catch (err) {
    console.error(`${TAG} hook ${label} failed in ${Date.now() - start}ms:`, err)
  }
}

/**
 * Evaluate a monitor rule locally — runs CSS selector + regex extraction
 * inside the webview, then applies the comparison in the renderer.
 */
async function evaluateRuleLocally(
  webview: Electron.WebviewTag,
  rule: MonitorRule,
  lastExtracted?: string
): Promise<LocalEvalResult> {
  // Run the CSS selector and extract text inside the webview
  const extractScript = `
    (function() {
      try {
        const els = document.querySelectorAll(${JSON.stringify(rule.cssSelector)});
        if (els.length === 0) return { found: false, count: 0, text: '' };
        const texts = Array.from(els).map(el => el.textContent || '').join('\\n');
        return { found: true, count: els.length, text: texts };
      } catch(e) {
        return { found: false, count: 0, text: '', error: e.message };
      }
    })()
  `
  const result = await webview.executeJavaScript(extractScript) as {
    found: boolean
    count: number
    text: string
    error?: string
  }

  if (result.error) {
    console.warn(`${TAG} Selector error: ${result.error}`)
    return {
      fired: false,
      extracted: '',
      reason: `selector_error: ${result.error}`,
      found: false,
      selectorCount: 0,
      regexMatched: false,
      regexRaw: ''
    }
  }

  // Apply regex to the matched text
  let extracted = ''
  let regexMatched = false
  let regexRaw = ''
  if (result.found && result.text) {
    try {
      const re = new RegExp(rule.regex)
      const match = result.text.match(re)
      if (match) {
        regexMatched = true
        regexRaw = match[0] ?? ''
        extracted = match[rule.regexGroup] ?? match[0] ?? ''
      }
    } catch (e) {
      console.warn(`${TAG} Regex error: ${e}`)
      return {
        fired: false,
        extracted: '',
        reason: `regex_error: ${e}`,
        found: result.found,
        selectorCount: result.count,
        regexMatched: false,
        regexRaw: ''
      }
    }
  }

  // Apply comparison
  const { check, value } = rule
  const normalized = extracted.trim()
  const valueNormalized = (value ?? '').trim()

  const withResult = (fired: boolean, reason: string): LocalEvalResult => ({
    fired,
    extracted,
    reason,
    found: result.found,
    selectorCount: result.count,
    regexMatched,
    regexRaw
  })

  switch (check) {
    case 'exists':
      return withResult(
        result.found && extracted.length > 0,
        `exists found=${result.found} extracted_len=${extracted.length}`
      )

    case 'not_exists':
      return withResult(
        !result.found || extracted.length === 0,
        `not_exists found=${result.found} extracted_len=${extracted.length}`
      )

    case 'contains':
      return withResult(
        extracted.toLowerCase().includes(valueNormalized.toLowerCase()),
        `contains value="${valueNormalized}" in="${previewText(extracted)}"`
      )

    case 'not_contains':
      return withResult(
        !extracted.toLowerCase().includes(valueNormalized.toLowerCase()),
        `not_contains value="${valueNormalized}" in="${previewText(extracted)}"`
      )

    case 'less_than': {
      const num = parseFloat(extracted.replace(/[^0-9.\-]/g, ''))
      const threshold = parseFloat(valueNormalized || '0')
      return withResult(
        !isNaN(num) && num < threshold,
        `less_than numeric=${num} threshold=${threshold}`
      )
    }

    case 'greater_than': {
      const num = parseFloat(extracted.replace(/[^0-9.\-]/g, ''))
      const threshold = parseFloat(valueNormalized || '0')
      return withResult(
        !isNaN(num) && num > threshold,
        `greater_than numeric=${num} threshold=${threshold}`
      )
    }

    case 'equals': {
      // Schedule-friendly mode: treat "00|10|20|..." as exact allowed values.
      if (valueNormalized.includes('|')) {
        const options = valueNormalized
          .split('|')
          .map((v) => v.trim())
          .filter((v) => v.length > 0)
        const fired = options.includes(normalized)
        return withResult(
          fired,
          `equals(list) actual="${normalized}" options=${JSON.stringify(options)}`
        )
      }

      return withResult(
        normalized === valueNormalized,
        `equals actual="${normalized}" expected="${valueNormalized}"`
      )
    }

    case 'changed':
      return withResult(
        lastExtracted !== undefined && extracted !== lastExtracted,
        `changed prev="${previewText(lastExtracted ?? '(none)')}" curr="${previewText(extracted)}"`
      )

    default:
      return withResult(false, `unsupported_check=${check}`)
  }
}

export function MonitorWebviews({
  tabs,
  onMonitorFired,
  onMonitorRuleGenerated,
  onMonitorExtractedUpdate
}: MonitorWebviewsProps): React.ReactElement {
  const webviewRefs = useRef<Map<string, Electron.WebviewTag>>(new Map())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const runningRef = useRef(false)
  const cycleRef = useRef(0)
  const lastCycleEndedAtRef = useRef<number | null>(null)
  // Track in-flight rule generation to avoid duplicate calls
  const generatingRules = useRef<Set<string>>(new Set())

  const evaluateTab = useCallback(
    async (tab: BrowserTab, webview: Electron.WebviewTag, cycleId: number): Promise<void> => {
      const monitors = parseMonitors(tab).filter((m) => m.enabled)
      if (monitors.length === 0) return

      try {
        const tabStart = Date.now()
        console.log(
          `${TAG} cycle#${cycleId} tab=${tab.id} start url=${tab.url} monitors=${monitors.length}`
        )

        // Reload the page
        console.log(`${TAG} cycle#${cycleId} tab=${tab.id} loading ${tab.url}`)
        webview.loadURL(tab.url)

        // Wait for page to finish loading (max 15s)
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            console.warn(`${TAG} Page load timeout for tab=${tab.id}`)
            resolve()
          }, LOAD_TIMEOUT)

          const handler = (): void => {
            clearTimeout(timeout)
            webview.removeEventListener('did-stop-loading', handler)
            resolve()
          }
          webview.addEventListener('did-stop-loading', handler)
        })

        const pageUrl = webview.getURL()
        console.log(
          `${TAG} cycle#${cycleId} tab=${tab.id} loaded ${pageUrl} in ${Date.now() - tabStart}ms`
        )

        for (const monitor of monitors) {
          console.log(
            `${TAG} cycle#${cycleId} tab=${tab.id} monitor=${monitor.id} condition="${previewText(monitor.condition, 180)}"`
          )

          // Cooldown check
          if (monitor.lastFiredAt) {
            const elapsed = Date.now() - new Date(monitor.lastFiredAt).getTime()
            if (elapsed < COOLDOWN_MS) {
              const remainingSec = Math.max(0, Math.ceil((COOLDOWN_MS - elapsed) / 1000))
              console.log(
                `${TAG} cycle#${cycleId} tab=${tab.id} monitor=${monitor.id} cooldown skip remaining=${remainingSec}s (last fired ${Math.round(elapsed / 1000)}s ago)`
              )
              continue
            }
          }

          try {
            // If no rule yet, generate one via AI (one-time)
            if (!monitor.rule) {
              const key = `${tab.id}:${monitor.id}`
              if (generatingRules.current.has(key)) {
                console.log(
                  `${TAG} cycle#${cycleId} tab=${tab.id} monitor=${monitor.id} rule generation already in-flight`
                )
                continue
              }

              generatingRules.current.add(key)
              console.log(
                `${TAG} cycle#${cycleId} tab=${tab.id} monitor=${monitor.id} no rule -> generating`
              )

              // Get page HTML for rule generation
              const pageHtml = await webview.executeJavaScript(
                'document.documentElement.outerHTML.slice(0, 50000)'
              ) as string

              const ruleStart = Date.now()
              const result = await window.api.browserTabs.generateMonitorRule(
                monitor.condition,
                pageHtml,
                pageUrl
              )

              generatingRules.current.delete(key)

              if (result.rule) {
                console.log(
                  `${TAG} cycle#${cycleId} tab=${tab.id} monitor=${monitor.id} rule generated in ${Date.now() - ruleStart}ms selector="${result.rule.cssSelector}" regex="${result.rule.regex}" check=${result.rule.check} value="${result.rule.value ?? ''}"`
                )
                await runMonitorHook(
                  `onMonitorRuleGenerated tab=${tab.id} monitor=${monitor.id}`,
                  () => onMonitorRuleGenerated(tab.id, monitor.id, result.rule)
                )
                // Don't evaluate this cycle — rule will be available next tick
              } else {
                console.warn(
                  `${TAG} cycle#${cycleId} tab=${tab.id} monitor=${monitor.id} rule generation failed: ${result.error}`
                )
              }
              continue
            }

            if (monitor.rule.check === 'equals' && (monitor.rule.value ?? '').includes('|')) {
              console.log(
                `${TAG} cycle#${cycleId} tab=${tab.id} monitor=${monitor.id} schedule-mode equals(list) value="${monitor.rule.value}"`
              )
            }

            // Evaluate the rule locally
            const { fired, extracted, reason, found, selectorCount, regexMatched, regexRaw } = await evaluateRuleLocally(
              webview,
              monitor.rule,
              monitor.lastExtracted
            )

            console.log(
              `${TAG} cycle#${cycleId} tab=${tab.id} monitor=${monitor.id} eval fired=${fired} found=${found} selectorCount=${selectorCount} regexMatched=${regexMatched} regexRaw="${previewText(regexRaw)}" extracted="${previewText(extracted)}" reason=${reason}`
            )

            // Always update lastExtracted so 'changed' checks work
            if (extracted !== monitor.lastExtracted) {
              console.log(
                `${TAG} cycle#${cycleId} tab=${tab.id} monitor=${monitor.id} extracted changed prev="${previewText(monitor.lastExtracted ?? '(none)')}" next="${previewText(extracted)}"`
              )
              await runMonitorHook(
                `onMonitorExtractedUpdate tab=${tab.id} monitor=${monitor.id}`,
                () => onMonitorExtractedUpdate(tab.id, monitor.id, extracted)
              )
            }

            if (fired) {
              console.log(
                `${TAG} cycle#${cycleId} tab=${tab.id} monitor=${monitor.id} FIRED extracted="${previewText(extracted)}"`
              )
              await runMonitorHook(
                `onMonitorFired tab=${tab.id} monitor=${monitor.id}`,
                () => onMonitorFired(tab.id, monitor.id, extracted)
              )
            } else {
              console.log(`${TAG} cycle#${cycleId} tab=${tab.id} monitor=${monitor.id} NO_FIRE`)
            }
          } catch (err) {
            console.error(`${TAG} cycle#${cycleId} tab=${tab.id} error evaluating monitor=${monitor.id}:`, err)
          }
        }
      } catch (err) {
        console.error(`${TAG} cycle#${cycleId} error processing tab=${tab.id}:`, err)
      }
    },
    [onMonitorFired, onMonitorRuleGenerated, onMonitorExtractedUpdate]
  )

  const runPollingCycle = useCallback(async (source: 'initial' | 'interval'): Promise<void> => {
    const tickTs = Date.now()
    const nextTs = getNextCronTick(tickTs)
    const sinceLastMs = lastCycleEndedAtRef.current === null ? null : tickTs - lastCycleEndedAtRef.current
    console.log(
      `${TAG} cron tick source=${source} at=${new Date(tickTs).toISOString()} local=${formatTime(tickTs)} next~=${new Date(nextTs).toISOString()} sinceLastMs=${sinceLastMs ?? 'n/a'}`
    )

    if (runningRef.current) {
      console.log(`${TAG} cycle skip: previous cycle still running source=${source}`)
      return
    }

    const cycleId = ++cycleRef.current
    const cycleStart = Date.now()
    runningRef.current = true
    console.log(
      `${TAG} cycle#${cycleId} start source=${source} tabs=${tabs.length} pollIntervalMs=${POLL_INTERVAL}`
    )

    try {
      for (const tab of tabs) {
        const webview = webviewRefs.current.get(tab.id)
        if (!webview) {
          console.warn(`${TAG} cycle#${cycleId} tab=${tab.id} missing webview ref`)
          continue
        }
        await evaluateTab(tab, webview, cycleId)
      }
    } finally {
      runningRef.current = false
      lastCycleEndedAtRef.current = Date.now()
      console.log(
        `${TAG} cycle#${cycleId} complete source=${source} durationMs=${Date.now() - cycleStart}`
      )
    }
  }, [tabs, evaluateTab])

  // Set up polling interval
  useEffect(() => {
    if (tabs.length === 0) {
      console.log(`${TAG} polling disabled (no monitored tabs)`)
      return
    }

    const enabledMonitorCount = tabs
      .flatMap((tab) => parseMonitors(tab))
      .filter((m) => m.enabled).length
    console.log(
      `${TAG} polling setup tabs=${tabs.length} monitors=${enabledMonitorCount} pollIntervalMs=${POLL_INTERVAL} alignmentGraceMs=${CRON_ALIGNMENT_GRACE_MS}`
    )
    let disposed = false

    const scheduleNextTick = (source: 'initial' | 'interval'): void => {
      if (disposed) return
      const now = Date.now()
      const plannedTs = getNextCronTick(now)
      const delayMs = Math.max(MIN_TIMER_DELAY_MS, plannedTs - now)
      console.log(
        `${TAG} cron scheduled source=${source} runAt=${new Date(plannedTs).toISOString()} local=${formatTime(plannedTs)} delayMs=${delayMs}`
      )

      timerRef.current = setTimeout(() => {
        if (disposed) return
        const firedAt = Date.now()
        console.log(
          `${TAG} cron timer fired source=${source} plannedAt=${new Date(plannedTs).toISOString()} firedAt=${new Date(firedAt).toISOString()} driftMs=${firedAt - plannedTs}`
        )

        void runPollingCycle(source).finally(() => {
          if (disposed) return
          scheduleNextTick('interval')
        })
      }, delayMs)
    }

    scheduleNextTick('initial')

    return (): void => {
      disposed = true
      console.log(`${TAG} polling cleanup`)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [tabs, runPollingCycle])

  const setWebviewRef = useCallback((tabId: string, el: Electron.WebviewTag | null) => {
    if (el) {
      webviewRefs.current.set(tabId, el)
      // Prevent hidden monitor webviews from stealing focus
      el.addEventListener('focus', () => el.blur())
      console.log(
        `${TAG} attached hidden webview for tab=${tabId}${WEBVIEW_USER_AGENT ? ' userAgent=custom' : ''}`
      )
    } else {
      webviewRefs.current.delete(tabId)
      console.log(`${TAG} detached hidden webview for tab=${tabId}`)
    }
  }, [])

  return (
    <div
      style={{
        position: 'absolute',
        width: '1px',
        height: '1px',
        opacity: 0,
        pointerEvents: 'none',
        overflow: 'hidden'
      }}
    >
      {tabs.map((tab) => (
        <webview
          key={tab.id}
          ref={(el) => setWebviewRef(tab.id, el as unknown as Electron.WebviewTag | null)}
          src="about:blank"
          partition="persist:browser-tabs"
          useragent={WEBVIEW_USER_AGENT}
          tabIndex={-1}
          style={{ width: '1px', height: '1px' }}
        />
      ))}
    </div>
  )
}
