export const CLI_AGENTS = [
  { id: 'claude', label: 'Claude Code', command: 'claude' },
  { id: 'codex', label: 'Codex', command: 'codex' },
  { id: 'opencode', label: 'OpenCode', command: 'opencode' },
  { id: 'amp', label: 'Amp', command: 'amp' },
  { id: 'gemini', label: 'Gemini CLI', command: 'gemini' }
] as const

export type AgentId = (typeof CLI_AGENTS)[number]['id']

export const WORKSPACE_AGENT_COMMAND_OVERRIDES_KEY = 'workspaceAgentCommandOverrides'

export type WorkspaceAgentCommandOverrides = Record<string, Partial<Record<AgentId, string>>>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function getWorkspaceAgentCommandOverrides(value: unknown): WorkspaceAgentCommandOverrides {
  if (!isRecord(value)) return {}

  const next: WorkspaceAgentCommandOverrides = {}
  for (const [workspaceRoot, rawOverrides] of Object.entries(value)) {
    if (!workspaceRoot || !isRecord(rawOverrides)) continue

    const parsed: Partial<Record<AgentId, string>> = {}
    for (const agent of CLI_AGENTS) {
      const rawCommand = rawOverrides[agent.id]
      if (typeof rawCommand !== 'string') continue
      const trimmed = rawCommand.trim()
      if (trimmed.length === 0) continue
      parsed[agent.id] = trimmed
    }

    if (Object.keys(parsed).length > 0) {
      next[workspaceRoot] = parsed
    }
  }

  return next
}

export function getAgentCommand(
  agentId: string | unknown,
  workspaceRoot?: string | null,
  overridesSetting?: unknown
): string {
  const agent = CLI_AGENTS.find((entry) => entry.id === agentId)
  const defaultCommand = agent?.command ?? 'claude'
  const normalizedWorkspaceRoot = workspaceRoot?.trim()
  if (!normalizedWorkspaceRoot) return defaultCommand

  const overrides = getWorkspaceAgentCommandOverrides(overridesSetting)
  const override = agent ? overrides[normalizedWorkspaceRoot]?.[agent.id] : undefined
  return override?.trim() || defaultCommand
}
