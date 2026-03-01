import { generateText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { getSetting } from './browser-agent'

const TAG = '[monitor-eval]'

export interface MonitorRule {
  cssSelector: string
  regex: string
  regexGroup: number
  check: 'exists' | 'not_exists' | 'contains' | 'not_contains' | 'less_than' | 'greater_than' | 'equals' | 'changed'
  value?: string
}

/**
 * Called ONCE per monitor — AI analyzes the page HTML and condition
 * to produce a reusable extraction rule (CSS selector + regex + comparison).
 */
export async function generateMonitorRule(
  condition: string,
  pageHtml: string,
  pageUrl: string
): Promise<{ rule: MonitorRule | null; error?: string }> {
  const apiKey = getSetting('openaiApiKey')
  if (!apiKey) {
    console.warn(`${TAG} No OpenAI API key set`)
    return { rule: null, error: 'OpenAI API key not set' }
  }

  const model = createOpenAI({ apiKey })('gpt-5.2')
  const truncatedHtml = pageHtml.slice(0, 12000)

  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), 20_000)

  try {
    console.log(`${TAG} Generating rule for: "${condition}" on ${pageUrl} (${truncatedHtml.length} chars HTML)`)

    const result = await generateText({
      model,
      abortSignal: abortController.signal,
      system: `You analyze web page HTML and a user's monitoring condition to produce a structured extraction rule.

Return ONLY valid JSON with this exact shape:
{
  "cssSelector": "CSS selector to find the relevant element(s)",
  "regex": "regex pattern to extract the value from the element's text content",
  "regexGroup": 0,
  "check": "one of: exists | not_exists | contains | not_contains | less_than | greater_than | equals | changed",
  "value": "comparison value (omit for exists/not_exists/changed)"
}

RULES:
- cssSelector: target the most specific element containing the monitored value. Use classes, IDs, data attributes, or structural selectors from the HTML.
- regex: pattern to extract the relevant value from the matched element's textContent. Use capture groups if needed. For numeric extraction, capture just the number.
- regexGroup: which capture group to use (0 = full match, 1+ = capture groups)
- check: the comparison operator
  - "exists": fires when the selector matches AND regex matches (element/text is present)
  - "not_exists": fires when selector finds nothing or regex doesn't match
  - "contains" / "not_contains": check if extracted text contains the value
  - "less_than" / "greater_than": parse extracted value as a number and compare to value
  - "equals": exact string match
  - "changed": fires when the extracted value differs from the previous extraction
- value: the threshold or comparison string (not needed for exists/not_exists/changed)

No other text outside the JSON.`,
      messages: [
        {
          role: 'user',
          content: `Condition to monitor: ${condition}\n\nPage URL: ${pageUrl}\n\nPage HTML:\n${truncatedHtml}`
        }
      ]
    })

    const text = result.text.trim()
    console.log(`${TAG} Rule generation response: ${text.slice(0, 300)}`)

    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn(`${TAG} No JSON found in AI response`)
      return { rule: null, error: 'Could not parse AI response' }
    }

    const parsed = JSON.parse(jsonMatch[0]) as MonitorRule
    // Validate required fields
    if (!parsed.cssSelector || !parsed.regex || !parsed.check) {
      console.warn(`${TAG} Incomplete rule:`, parsed)
      return { rule: null, error: 'AI returned incomplete rule' }
    }

    // Ensure regexGroup is a number
    parsed.regexGroup = typeof parsed.regexGroup === 'number' ? parsed.regexGroup : 0

    console.log(`${TAG} Generated rule: selector="${parsed.cssSelector}" regex="${parsed.regex}" check=${parsed.check} value=${parsed.value ?? '(none)'}`)
    return { rule: parsed }
  } catch (err) {
    if (abortController.signal.aborted) {
      console.warn(`${TAG} Rule generation timed out`)
      return { rule: null, error: 'Timed out' }
    }
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error(`${TAG} Rule generation failed:`, msg)
    return { rule: null, error: msg }
  } finally {
    clearTimeout(timeout)
  }
}
