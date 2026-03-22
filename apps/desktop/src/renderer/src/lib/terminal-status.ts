export const MAX_TERMINAL_STATUS_TAIL_CHARS = 2_000

export type TerminalAgentKind = 'claude' | 'codex' | 'opencode' | 'amp' | 'gemini' | null

export function stripAnsiFromTerminalOutput(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
}

export function normalizeTerminalOutput(value: string): string {
  return stripAnsiFromTerminalOutput(value)
    .replace(/\u0007/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

export function detectTerminalAgentKind(command: string | null | undefined): TerminalAgentKind {
  const normalized = command?.trim().toLowerCase()
  if (!normalized) return null
  if (/(^|\s|\/)claude(?=\s|$)/.test(normalized)) return 'claude'
  if (/(^|\s|\/)codex(?=\s|$)/.test(normalized)) return 'codex'
  if (/(^|\s|\/)opencode(?=\s|$)/.test(normalized)) return 'opencode'
  if (/(^|\s|\/)amp(?=\s|$)/.test(normalized)) return 'amp'
  if (/(^|\s|\/)gemini(?=\s|$)/.test(normalized)) return 'gemini'
  return null
}

export function hasTerminalAttentionSignal(value: string): boolean {
  return (
    value.includes('\u0007') ||
    /\x1b\]9;/.test(value) ||
    /\x1b\]1337;RequestAttention=/.test(value) ||
    /\x1b\]777;notify;/.test(value)
  )
}

export function appendTerminalOutputTail(
  currentTail: string,
  chunk: string,
  maxChars = MAX_TERMINAL_STATUS_TAIL_CHARS
): string {
  const normalizedChunk = normalizeTerminalOutput(chunk)
  return `${currentTail}${normalizedChunk}`.slice(-maxChars)
}

export function getLastNonEmptyTerminalLine(value: string): string {
  const lines = value.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trimEnd() ?? ''
    if (line.length > 0) return line
  }
  return ''
}

export function isLikelyShellPromptLine(value: string): boolean {
  const trimmed = value.trimEnd()
  if (!trimmed || trimmed.length > 140) return false
  if (/^PS [^>\n]+>\s*$/.test(value)) return true
  if (/^(?:❯|➜|λ)\s*$/.test(trimmed)) return true
  return /(?:[%#$›»>])\s*$/.test(trimmed)
}

export function isLikelyTerminalInputRequest(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 220) return false
  if (/\[(?:Y\/n|y\/N|y\/n|N\/y|n\/Y)\]|\((?:Y\/n|y\/N|y\/n|N\/y|n\/Y)\)/.test(trimmed)) return true
  if (/(press any key|press enter to continue|password|passphrase|verification code|one-time code|otp|mfa|two-factor|2fa|username|email|login|confirm|are you sure|continue\?|overwrite\?|retry\?|select an option|choose an option|pick an option|approve|approval|permission|allow|deny|review and approve|waiting for (?:your )?input|enter (?:choice|selection|value|password|passphrase|code))/i.test(trimmed)) {
    return true
  }
  return /:\s*$/.test(trimmed) && /(password|passphrase|username|email|login|code|otp|token|choice|selection)/i.test(trimmed)
}

export function isLikelyAgentWaitingForInput(
  tail: string,
  agentKind: TerminalAgentKind
): boolean {
  if (!agentKind) return false
  const window = tail.slice(-800).toLowerCase()
  if (!window.trim()) return false

  // Generic patterns — apply to all coding agents
  if (
    /waiting for (?:your )?input/.test(window) ||
    /waiting for (?:your )?(?:approval|permission)/.test(window) ||
    /needs your (?:input|approval|permission)/.test(window) ||
    /approve (?:this|the)? ?(?:command|change|action)?/.test(window) ||
    /review and approve/.test(window) ||
    /press enter to continue/.test(window) ||
    /what would you like to (?:do|work on)\??/.test(window) ||
    /how can i help/.test(window) ||
    /what(?:'s| is) next/.test(window)
  ) {
    return true
  }

  // Agent-specific idle prompt patterns
  switch (agentKind) {
    case 'claude':
      return /what would you like claude to do\??/.test(window)
    case 'codex':
      return /what should codex do next\??/.test(window)
    case 'gemini':
      return /what would you like gemini to do\??/.test(window)
    case 'opencode':
    case 'amp':
      return false
  }
}

export function isTerminalBusyFromTail(tail: string): boolean {
  const lastLine = getLastNonEmptyTerminalLine(tail)
  if (!lastLine) return false
  if (isLikelyShellPromptLine(lastLine)) return false
  if (isLikelyTerminalInputRequest(lastLine)) return false
  return true
}
