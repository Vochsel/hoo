interface CronFieldMatcher {
  matches: (value: number) => boolean
  isWildcard: boolean
}

interface CronFieldOptions {
  min: number
  max: number
  aliases?: Record<string, number>
  allowSevenAsZero?: boolean
}

interface ParsedCronExpression {
  normalized: string
  minute: CronFieldMatcher
  hour: CronFieldMatcher
  dayOfMonth: CronFieldMatcher
  month: CronFieldMatcher
  dayOfWeek: CronFieldMatcher
}

const MONTH_ALIASES: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12
}

const DAY_ALIASES: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  weds: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6
}

function normalizeWhitespace(input: string): string {
  return input.trim().replace(/\s+/g, ' ')
}

function parseStep(raw: string): number | null {
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) return null
  return value
}

function parseValue(raw: string, options: CronFieldOptions): number | null {
  const token = raw.trim().toLowerCase()
  if (!token) return null

  let value: number | undefined
  if (/^\d+$/.test(token)) {
    value = Number(token)
  } else if (options.aliases && token in options.aliases) {
    value = options.aliases[token]
  }
  if (value === undefined) return null

  if (options.allowSevenAsZero && value === 7) value = 0
  if (value < options.min || value > options.max) return null
  return value
}

function parseFieldSegment(
  segmentRaw: string,
  options: CronFieldOptions
): ((value: number) => boolean) | null {
  const segment = segmentRaw.trim().toLowerCase()
  if (!segment) return null

  if (segment === '*') {
    return () => true
  }

  const everyMatch = segment.match(/^\*\/(\d+)$/)
  if (everyMatch) {
    const step = parseStep(everyMatch[1])
    if (!step) return null
    return (value: number) => (value - options.min) % step === 0
  }

  const rangeMatch = segment.match(/^([a-z0-9]+)-([a-z0-9]+)(?:\/(\d+))?$/i)
  if (rangeMatch) {
    const start = parseValue(rangeMatch[1], options)
    const end = parseValue(rangeMatch[2], options)
    const step = rangeMatch[3] ? parseStep(rangeMatch[3]) : 1
    if (start === null || end === null || !step) return null
    if (start > end) return null
    return (value: number) => value >= start && value <= end && (value - start) % step === 0
  }

  const steppedMatch = segment.match(/^([a-z0-9]+)\/(\d+)$/i)
  if (steppedMatch) {
    const start = parseValue(steppedMatch[1], options)
    const step = parseStep(steppedMatch[2])
    if (start === null || !step) return null
    return (value: number) => value >= start && (value - start) % step === 0
  }

  const exact = parseValue(segment, options)
  if (exact === null) return null
  return (value: number) => value === exact
}

function parseCronField(fieldRaw: string, options: CronFieldOptions): CronFieldMatcher | null {
  const field = fieldRaw.trim()
  if (!field) return null

  const segments = field.split(',').map((part) => part.trim()).filter(Boolean)
  if (segments.length === 0) return null

  const matchers: Array<(value: number) => boolean> = []
  for (const segment of segments) {
    const matcher = parseFieldSegment(segment, options)
    if (!matcher) return null
    matchers.push(matcher)
  }

  return {
    isWildcard: segments.length === 1 && segments[0] === '*',
    matches: (value: number) => matchers.some((matcher) => matcher(value))
  }
}

function parseCronExpression(expression: string): ParsedCronExpression | null {
  const normalized = normalizeWhitespace(expression)
  if (!normalized) return null

  const fields = normalized.split(' ')
  if (fields.length !== 5) return null

  const minute = parseCronField(fields[0], { min: 0, max: 59 })
  const hour = parseCronField(fields[1], { min: 0, max: 23 })
  const dayOfMonth = parseCronField(fields[2], { min: 1, max: 31 })
  const month = parseCronField(fields[3], { min: 1, max: 12, aliases: MONTH_ALIASES })
  const dayOfWeek = parseCronField(fields[4], {
    min: 0,
    max: 6,
    aliases: DAY_ALIASES,
    allowSevenAsZero: true
  })

  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return null

  return { normalized, minute, hour, dayOfMonth, month, dayOfWeek }
}

export function normalizeCronExpression(expression: string | undefined): string {
  return normalizeWhitespace(expression ?? '')
}

export function isValidCronExpression(expression: string | undefined): boolean {
  const normalized = normalizeCronExpression(expression)
  if (!normalized) return false
  return parseCronExpression(normalized) !== null
}

export function cronMatchesDate(expression: string, date: Date): boolean {
  const parsed = parseCronExpression(expression)
  if (!parsed) return false

  if (!parsed.minute.matches(date.getMinutes())) return false
  if (!parsed.hour.matches(date.getHours())) return false
  if (!parsed.month.matches(date.getMonth() + 1)) return false

  const dayOfMonthMatch = parsed.dayOfMonth.matches(date.getDate())
  const dayOfWeekMatch = parsed.dayOfWeek.matches(date.getDay())

  // Cron semantics: if both DOM and DOW are restricted, either may match.
  if (parsed.dayOfMonth.isWildcard && parsed.dayOfWeek.isWildcard) return true
  if (parsed.dayOfMonth.isWildcard) return dayOfWeekMatch
  if (parsed.dayOfWeek.isWildcard) return dayOfMonthMatch
  return dayOfMonthMatch || dayOfWeekMatch
}

function parsePromptTime(text: string): { hour: number; minute: number } | null {
  if (/\bmidnight\b/.test(text)) return { hour: 0, minute: 0 }
  if (/\bnoon\b/.test(text)) return { hour: 12, minute: 0 }

  const amPmMatch = text.match(/\b(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b/i)
  if (amPmMatch) {
    const rawHour = Number(amPmMatch[1])
    const minute = amPmMatch[2] ? Number(amPmMatch[2]) : 0
    if (rawHour >= 1 && rawHour <= 12 && minute >= 0 && minute <= 59) {
      const suffix = amPmMatch[3].toLowerCase()
      let hour = rawHour % 12
      if (suffix === 'pm') hour += 12
      return { hour, minute }
    }
  }

  const hhmmMatch = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)
  if (hhmmMatch) {
    return { hour: Number(hhmmMatch[1]), minute: Number(hhmmMatch[2]) }
  }

  const atHourMatch = text.match(/\bat\s+([01]?\d|2[0-3])\b/)
  if (atHourMatch) {
    return { hour: Number(atHourMatch[1]), minute: 0 }
  }

  return null
}

function parseHourlyMinuteHint(text: string): number | null {
  const minuteMatch = text.match(/\bat\s*:?\s*([0-5]?\d)\b/)
  if (!minuteMatch) return null
  const minute = Number(minuteMatch[1])
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null
  return minute
}

function extractPromptDays(text: string): number[] {
  const patterns: Array<{ value: number; pattern: RegExp }> = [
    { value: 0, pattern: /\bsun(?:day)?s?\b/ },
    { value: 1, pattern: /\bmon(?:day)?s?\b/ },
    { value: 2, pattern: /\btue(?:s|sday)?s?\b/ },
    { value: 3, pattern: /\bwed(?:nesday)?s?\b/ },
    { value: 4, pattern: /\bthu(?:r|rs|rsday|ursday)?s?\b/ },
    { value: 5, pattern: /\bfri(?:day)?s?\b/ },
    { value: 6, pattern: /\bsat(?:urday)?s?\b/ }
  ]
  const values = new Set<number>()
  for (const entry of patterns) {
    if (entry.pattern.test(text)) values.add(entry.value)
  }
  return Array.from(values).sort((a, b) => a - b)
}

function toDailyCron(hour: number, minute: number): string {
  return `${minute} ${hour} * * *`
}

export function inferCronFromPrompt(prompt: string | undefined): string | undefined {
  const text = normalizeWhitespace((prompt ?? '').toLowerCase())
  if (!text) return undefined

  if (isValidCronExpression(text)) return normalizeCronExpression(text)

  if (/\bevery minute\b|\beach minute\b/.test(text)) return '* * * * *'

  const everyMinutesMatch = text.match(/\bevery\s+(\d{1,2})\s*(?:minutes?|mins?)\b/)
  if (everyMinutesMatch) {
    const step = Number(everyMinutesMatch[1])
    if (step === 1) return '* * * * *'
    if (step >= 2 && step <= 59) return `*/${step} * * * *`
  }

  const everyHoursMatch = text.match(/\bevery\s+(\d{1,2})\s*(?:hours?|hrs?)\b/)
  if (everyHoursMatch) {
    const step = Number(everyHoursMatch[1])
    if (step >= 1 && step <= 23) {
      const minute = parsePromptTime(text)?.minute ?? parseHourlyMinuteHint(text) ?? 0
      if (step === 1) return `${minute} * * * *`
      return `${minute} */${step} * * *`
    }
  }

  if (/\bevery hour\b|\bhourly\b/.test(text)) {
    const minute = parsePromptTime(text)?.minute ?? parseHourlyMinuteHint(text) ?? 0
    return `${minute} * * * *`
  }

  const time = parsePromptTime(text) ?? { hour: 9, minute: 0 }

  if (/\bweekdays?\b/.test(text)) {
    return `${time.minute} ${time.hour} * * 1-5`
  }
  if (/\bweekends?\b/.test(text)) {
    return `${time.minute} ${time.hour} * * 0,6`
  }

  const days = extractPromptDays(text)
  if (days.length > 0) {
    return `${time.minute} ${time.hour} * * ${days.join(',')}`
  }

  const monthlyMatch = text.match(/\b(?:every month|monthly)(?:\s+on\s+(?:day\s+)?(\d{1,2}))?\b/)
  if (monthlyMatch) {
    const day = monthlyMatch[1] ? Number(monthlyMatch[1]) : 1
    if (day >= 1 && day <= 31) return `${time.minute} ${time.hour} ${day} * *`
  }

  const everyDaysMatch = text.match(/\bevery\s+(\d{1,2})\s*days?\b/)
  if (everyDaysMatch) {
    const step = Number(everyDaysMatch[1])
    if (step === 1) return toDailyCron(time.hour, time.minute)
    if (step >= 2 && step <= 31) return `${time.minute} ${time.hour} */${step} * *`
  }

  if (/\bevery day\b|\beach day\b|\bdaily\b/.test(text)) {
    return toDailyCron(time.hour, time.minute)
  }

  if (parsePromptTime(text) && /\bat\b/.test(text)) {
    return toDailyCron(time.hour, time.minute)
  }

  return undefined
}

export interface ResolveScheduleCronResult {
  cron?: string
  source?: 'cron' | 'prompt'
  error?: string
}

export function resolveScheduleCron(prompt: string | undefined, cronInput: string | undefined): ResolveScheduleCronResult {
  const normalizedCron = normalizeCronExpression(cronInput)
  if (normalizedCron) {
    if (isValidCronExpression(normalizedCron)) {
      return { cron: normalizedCron, source: 'cron' }
    }
    return {
      error: `Invalid cron expression: ${normalizedCron}`
    }
  }

  const inferredCron = inferCronFromPrompt(prompt)
  if (inferredCron) {
    return { cron: inferredCron, source: 'prompt' }
  }

  if (normalizeWhitespace(prompt ?? '')) {
    return {
      error: 'Could not infer cron from prompt. Try "every 10 minutes" or "30 9 * * 1-5".'
    }
  }

  return {
    error: 'Enter a cron expression or a schedule prompt.'
  }
}

export function formatLocalMinuteKey(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
}
