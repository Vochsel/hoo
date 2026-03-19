import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { RotateCcw, Save, Moon, Sun, Monitor, MousePointer2, Map, Folder, MousePointerClick, MousePointer, Download, RefreshCw, CheckCircle2, Loader2, Trash2, Sparkles, KeyRound, ChevronDown, type LucideIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useSettings } from '@/hooks/use-settings'
import { useThemeContext } from '@/App'
import type { RecentWorkspace, WorkspaceState } from '@/hooks/use-workspace'
import {
  CLI_AGENTS,
  WORKSPACE_AGENT_COMMAND_OVERRIDES_KEY,
  getWorkspaceAgentCommandOverrides,
  type AgentId
} from '@/lib/cli-agents'
import {
  THEME_PRESETS,
  getPresetById,
  type ThemeCustomization,
} from '@/lib/theme-presets'

const BROWSER_MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-sonnet-4-5-20241022', label: 'Claude Sonnet 4.5' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { id: 'gpt-4.1', label: 'GPT 4.1' },
  { id: 'gpt-4.1-mini', label: 'GPT 4.1 Mini' },
  { id: 'gpt-4.1-nano', label: 'GPT 4.1 Nano' }
]

type FlowInteractionMode = 'design' | 'map'
type NodeOpenClick = 'single' | 'double'
export type SettingsSectionId = 'appearance' | 'agents' | 'interaction' | 'workspace' | 'updates' | 'api'

export const SETTINGS_SECTIONS: Array<{
  id: SettingsSectionId
  label: string
  description: string
  icon: LucideIcon
}> = [
  {
    id: 'appearance',
    label: 'Appearance',
    description: 'Theme and visual display preferences.',
    icon: Monitor
  },
  {
    id: 'agents',
    label: 'Agents',
    description: 'Browser model, default agent, and workspace overrides.',
    icon: Sparkles
  },
  {
    id: 'interaction',
    label: 'Interaction',
    description: 'Canvas and node interaction behavior.',
    icon: MousePointer2
  },
  {
    id: 'workspace',
    label: 'Workspace',
    description: 'Storage location and workspace maintenance.',
    icon: Folder
  },
  {
    id: 'updates',
    label: 'Updates',
    description: 'App version and update installation.',
    icon: RefreshCw
  },
  {
    id: 'api',
    label: 'API Keys',
    description: 'Provider credentials used by the app.',
    icon: KeyRound
  }
]

function SettingsPanel({
  title,
  description,
  children
}: {
  title: string
  description: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <section className="relative overflow-visible rounded-[24px] border border-border/50 bg-background/80 p-6 shadow-[0_20px_50px_rgba(15,23,42,0.06)] backdrop-blur-sm">
      <div className="mb-5 space-y-1">
        <h3 className="text-base font-semibold tracking-tight">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  )
}

export function SettingsSidebar({
  workspace,
  activeSection,
  onSectionChange
}: {
  workspace: WorkspaceState | null
  activeSection: SettingsSectionId
  onSectionChange: (section: SettingsSectionId) => void
}): React.ReactElement {
  const workspaceRootDir = workspace?.rootDir ?? ''
  const workspaceName = useMemo(() => {
    if (!workspaceRootDir) return 'No workspace selected'
    const normalized = workspaceRootDir.replace(/[\\/]+$/, '')
    return normalized.split(/[\\/]/).pop() || workspaceRootDir
  }, [workspaceRootDir])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-3 pb-1 pt-1">
        <p className="px-2 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Settings
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hidden px-1.5 py-1">
        <nav className="space-y-0.5">
          {SETTINGS_SECTIONS.map((section) => {
            const Icon = section.icon
            const isActive = section.id === activeSection
            return (
              <button
                key={section.id}
                type="button"
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                  isActive
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                }`}
                onClick={() => onSectionChange(section.id)}
              >
                <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{section.label}</span>
                {isActive && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/80" />
                )}
              </button>
            )
          })}
        </nav>
      </div>

      <div className="border-t border-border/40 px-3 py-2">
        <div className="rounded-lg bg-background/50 px-2 py-2">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Active workspace
          </p>
          <p className="mt-1 truncate text-xs font-medium text-foreground">{workspaceName}</p>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
            {workspaceRootDir || 'Choose a workspace to enable storage and per-workspace agent overrides.'}
          </p>
        </div>
      </div>
    </div>
  )
}

export function SettingsPage({
  activeSection,
  workspace,
  setRootDir,
  resetWorkspace,
  getRecentWorkspaces,
  unarchiveBoard
}: {
  workspace: WorkspaceState | null
  activeSection: SettingsSectionId
  setRootDir: (rootDir: string) => Promise<void>
  resetWorkspace: () => Promise<void>
  getRecentWorkspaces: () => Promise<RecentWorkspace[]>
  unarchiveBoard: (boardId: string) => Promise<void>
}): React.ReactElement {
  const { settings, getSetting, setSetting } = useSettings()
  const { theme, resolved, setTheme, customization, setCustomization } = useThemeContext()

  const [openAiKey, setOpenAiKey] = useState('')
  const [anthropicKey, setAnthropicKey] = useState('')
  const [workspaceRoot, setWorkspaceRoot] = useState('')
  const [saving, setSaving] = useState(false)
  const [savingWorkspace, setSavingWorkspace] = useState(false)
  const [savingAgentCommands, setSavingAgentCommands] = useState(false)
  const [resettingWorkspace, setResettingWorkspace] = useState(false)
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspace[]>([])
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [restoringArchivedBoardId, setRestoringArchivedBoardId] = useState<string | null>(null)
  const [workspaceAgentCommands, setWorkspaceAgentCommands] = useState<Record<AgentId, string>>(() =>
    Object.fromEntries(CLI_AGENTS.map((agent) => [agent.id, ''])) as Record<AgentId, string>
  )
  const [updateState, setUpdateState] = useState<
    | { status: 'idle' }
    | { status: 'checking' }
    | { status: 'available'; version: string }
    | { status: 'downloading'; percent: number }
    | { status: 'ready' }
    | { status: 'up-to-date' }
    | { status: 'error'; message: string }
  >({ status: 'idle' })

  const selectedModel = ((getSetting('browserAiModel') as string) ?? 'claude-sonnet-4-6').trim()
  const defaultAgent: AgentId =
    (CLI_AGENTS.find((a) => a.id === getSetting('defaultAgent'))?.id) ?? 'claude'
  const flowInteractionMode: FlowInteractionMode =
    (getSetting('flowInteractionMode') as string) === 'map' ? 'map' : 'design'
  const nodeOpenClick: NodeOpenClick =
    (getSetting('nodeOpenClick') as string) === 'single' ? 'single' : 'double'
  const workspaceRootDir = workspace?.rootDir ?? ''
  const workspaceAgentCommandOverrides = useMemo(
    () => getWorkspaceAgentCommandOverrides(getSetting(WORKSPACE_AGENT_COMMAND_OVERRIDES_KEY)),
    [getSetting, settings]
  )
  const activeSectionMeta = useMemo(
    () => SETTINGS_SECTIONS.find((section) => section.id === activeSection) ?? SETTINGS_SECTIONS[0],
    [activeSection]
  )

  useEffect(() => {
    setOpenAiKey(((getSetting('openaiApiKey') as string) ?? '').trim())
    setAnthropicKey(((getSetting('anthropicApiKey') as string) ?? '').trim())
  }, [settings, getSetting])

  useEffect(() => {
    const nextEntries = CLI_AGENTS.map((agent) => [
      agent.id,
      workspaceRootDir ? workspaceAgentCommandOverrides[workspaceRootDir]?.[agent.id] ?? '' : ''
    ])
    setWorkspaceAgentCommands(Object.fromEntries(nextEntries) as Record<AgentId, string>)
  }, [workspaceRootDir, workspaceAgentCommandOverrides])

  // Listen for update events
  useEffect(() => {
    const unsub1 = window.api.updater.onUpdateAvailable((info) => {
      setUpdateState({ status: 'available', version: info.version })
    })
    const unsub2 = window.api.updater.onDownloadProgress((progress) => {
      setUpdateState({ status: 'downloading', percent: progress.percent })
    })
    const unsub3 = window.api.updater.onUpdateDownloaded(() => {
      setUpdateState({ status: 'ready' })
    })
    return () => { unsub1(); unsub2(); unsub3() }
  }, [])

  const checkForUpdates = useCallback(async () => {
    setUpdateState({ status: 'checking' })
    try {
      await window.api.updater.check()
      // If update-available event hasn't changed state after check resolves, we're up to date
      setTimeout(() => {
        setUpdateState((prev) => prev.status === 'checking' ? { status: 'up-to-date' } : prev)
      }, 2000)
    } catch (err) {
      setUpdateState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [])

  useEffect(() => {
    setWorkspaceRoot(workspace?.rootDir ?? '')
    getRecentWorkspaces().then(setRecentWorkspaces).catch(() => {})
  }, [workspace?.rootDir, getRecentWorkspaces])

  const saveKeys = async (): Promise<void> => {
    setSaving(true)
    try {
      await Promise.all([
        setSetting('openaiApiKey', openAiKey),
        setSetting('anthropicApiKey', anthropicKey)
      ])
    } finally {
      setSaving(false)
    }
  }

  const saveWorkspaceRoot = async (): Promise<void> => {
    setSavingWorkspace(true)
    try {
      await setRootDir(workspaceRoot)
    } finally {
      setSavingWorkspace(false)
    }
  }

  const browseWorkspaceRoot = async (): Promise<void> => {
    const selected = await window.api.workspace.pickRootDir(workspaceRoot || workspace?.rootDir)
    if (!selected) return
    setWorkspaceRoot(selected)
    setSavingWorkspace(true)
    try {
      await setRootDir(selected)
    } finally {
      setSavingWorkspace(false)
    }
  }

  const switchToRecentWorkspace = async (path: string): Promise<void> => {
    setWorkspaceRoot(path)
    setSavingWorkspace(true)
    try {
      await setRootDir(path)
    } finally {
      setSavingWorkspace(false)
    }
  }

  const handleResetWorkspace = async (): Promise<void> => {
    setShowResetConfirm(false)
    setResettingWorkspace(true)
    try {
      await resetWorkspace()
    } finally {
      setResettingWorkspace(false)
    }
  }

  const handleUnarchiveBoard = async (boardId: string): Promise<void> => {
    setRestoringArchivedBoardId(boardId)
    try {
      await unarchiveBoard(boardId)
    } finally {
      setRestoringArchivedBoardId((current) => (current === boardId ? null : current))
    }
  }

  const saveWorkspaceAgentCommands = async (): Promise<void> => {
    if (!workspaceRootDir) return

    setSavingAgentCommands(true)
    try {
      const nextOverrides = { ...workspaceAgentCommandOverrides }
      const nextWorkspaceOverrides = Object.fromEntries(
        CLI_AGENTS.map((agent) => [agent.id, workspaceAgentCommands[agent.id]?.trim() ?? ''])
          .filter(([, command]) => command.length > 0)
      ) as Partial<Record<AgentId, string>>

      if (Object.keys(nextWorkspaceOverrides).length > 0) {
        nextOverrides[workspaceRootDir] = nextWorkspaceOverrides
      } else {
        delete nextOverrides[workspaceRootDir]
      }

      await setSetting(WORKSPACE_AGENT_COMMAND_OVERRIDES_KEY, nextOverrides)
    } finally {
      setSavingAgentCommands(false)
    }
  }

  const resetWorkspaceAgentCommands = async (): Promise<void> => {
    setWorkspaceAgentCommands(
      Object.fromEntries(CLI_AGENTS.map((agent) => [agent.id, ''])) as Record<AgentId, string>
    )

    if (!workspaceRootDir) return

    setSavingAgentCommands(true)
    try {
      const nextOverrides = { ...workspaceAgentCommandOverrides }
      delete nextOverrides[workspaceRootDir]
      await setSetting(WORKSPACE_AGENT_COMMAND_OVERRIDES_KEY, nextOverrides)
    } finally {
      setSavingAgentCommands(false)
    }
  }

  return (
    <div className="flex-1 overflow-auto bg-[linear-gradient(180deg,hsl(var(--background)/0.94),hsl(var(--background)))]">
      <div className="mx-auto max-w-3xl px-8 py-9">
        <div className="mb-8">
          <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Configuration</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
            {activeSectionMeta.label}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {activeSectionMeta.description}
          </p>
        </div>

        <div className="space-y-4">
          {activeSection === 'appearance' && (
            <>
              <SettingsPanel
                title="Theme"
                description="Choose how Hoo should look on this machine."
              >
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    { id: 'system', label: 'System', icon: Monitor, selected: theme === 'system' },
                    { id: 'light', label: 'Light', icon: Sun, selected: theme === 'light' },
                    { id: 'dark', label: 'Dark', icon: Moon, selected: theme === 'dark' }
                  ].map((option) => {
                    const Icon = option.icon
                    return (
                      <button
                        key={option.id}
                        type="button"
                        className={`rounded-[20px] border px-4 py-4 text-left transition-colors ${
                          option.selected
                            ? 'border-foreground bg-foreground text-background shadow-sm'
                            : 'border-border/50 bg-muted/30 hover:bg-muted/50'
                        }`}
                        onClick={() => void setTheme(option.id as 'system' | 'light' | 'dark')}
                      >
                        <Icon className="h-4 w-4" />
                        <p className="mt-3 text-sm font-medium">{option.label}</p>
                        <p className={`mt-1 text-xs ${option.selected ? 'text-background/70' : 'text-muted-foreground'}`}>
                          {option.id === 'system'
                            ? 'Follow macOS or system theme.'
                            : option.id === 'light'
                              ? 'Bright interface with softer contrast.'
                              : 'Dark surfaces for lower-light use.'}
                        </p>
                      </button>
                    )
                  })}
                </div>
              </SettingsPanel>

              <SettingsPanel
                title="Color Theme"
                description="Select a preset or customize colors and fonts."
              >
                <ThemeCustomizer
                  resolved={resolved}
                  customization={customization}
                  onChange={(next) => void setCustomization(next)}
                />
              </SettingsPanel>
            </>
          )}

          {activeSection === 'agents' && (
            <>
              <SettingsPanel
                title="Browser Model"
                description="Choose the model used by browser chat and AI prompt nodes."
              >
                <select
                  className="h-11 w-full rounded-2xl border border-input bg-background px-4 text-sm"
                  value={selectedModel}
                  onChange={(e) => setSetting('browserAiModel', e.target.value)}
                >
                  {BROWSER_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </SettingsPanel>

              <SettingsPanel
                title="Default Agent"
                description="Choose which CLI agent Hoo launches by default for new agent terminals."
              >
                <select
                  className="h-11 w-full rounded-2xl border border-input bg-background px-4 text-sm"
                  value={defaultAgent}
                  onChange={(e) => setSetting('defaultAgent', e.target.value)}
                >
                  {CLI_AGENTS.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.label}
                    </option>
                  ))}
                </select>
              </SettingsPanel>

              <SettingsPanel
                title="Workspace Agent Commands"
                description="Override the CLI command used for each agent in this workspace. Leave any field blank to fall back to the built-in default."
              >
                <div className="mb-4 rounded-2xl border border-dashed border-border/60 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
                  {workspaceRootDir
                    ? `Current workspace: ${workspaceRootDir}`
                    : 'Select a workspace to configure overrides.'}
                </div>

                <div className="space-y-3">
                  {CLI_AGENTS.map((agent) => (
                    <div key={agent.id} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <label className="text-sm font-medium">{agent.label}</label>
                        <span className="text-xs text-muted-foreground">
                          Default: <code>{agent.command}</code>
                        </span>
                      </div>
                      <Input
                        value={workspaceAgentCommands[agent.id] ?? ''}
                        onChange={(event) => {
                          const value = event.target.value
                          setWorkspaceAgentCommands((prev) => ({ ...prev, [agent.id]: value }))
                        }}
                        placeholder={agent.command}
                        disabled={!workspaceRootDir || savingAgentCommands}
                      />
                    </div>
                  ))}
                </div>

                <div className="mt-5 flex gap-2">
                  <Button
                    className="gap-1.5"
                    onClick={saveWorkspaceAgentCommands}
                    disabled={!workspaceRootDir || savingAgentCommands}
                  >
                    <Save className="h-3.5 w-3.5" />
                    {savingAgentCommands ? 'Saving...' : 'Save Overrides'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void resetWorkspaceAgentCommands()}
                    disabled={!workspaceRootDir || savingAgentCommands}
                  >
                    Reset to defaults
                  </Button>
                </div>
              </SettingsPanel>
            </>
          )}

          {activeSection === 'interaction' && (
            <>
              <SettingsPanel
                title="Canvas Interaction"
                description="Switch between graph editing mode and map-style navigation mode."
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    {
                      id: 'design',
                      label: 'Design Tool',
                      description: 'Optimized for editing nodes, wiring, and selection.',
                      icon: MousePointer2,
                      selected: flowInteractionMode === 'design'
                    },
                    {
                      id: 'map',
                      label: 'Map Like',
                      description: 'Pan and zoom the canvas like a spatial map.',
                      icon: Map,
                      selected: flowInteractionMode === 'map'
                    }
                  ].map((option) => {
                    const Icon = option.icon
                    return (
                      <button
                        key={option.id}
                        type="button"
                        className={`rounded-[20px] border px-4 py-4 text-left transition-colors ${
                          option.selected
                            ? 'border-foreground bg-foreground text-background shadow-sm'
                            : 'border-border/50 bg-muted/30 hover:bg-muted/50'
                        }`}
                        onClick={() => setSetting('flowInteractionMode', option.id)}
                      >
                        <Icon className="h-4 w-4" />
                        <p className="mt-3 text-sm font-medium">{option.label}</p>
                        <p className={`mt-1 text-xs ${option.selected ? 'text-background/70' : 'text-muted-foreground'}`}>
                          {option.description}
                        </p>
                      </button>
                    )
                  })}
                </div>
              </SettingsPanel>

              <SettingsPanel
                title="Node Open Action"
                description="Choose whether tabs and terminals open on a single click or a double click."
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    {
                      id: 'single',
                      label: 'Single Click',
                      description: 'Open nodes immediately with one click.',
                      icon: MousePointerClick,
                      selected: nodeOpenClick === 'single'
                    },
                    {
                      id: 'double',
                      label: 'Double Click',
                      description: 'Require a double click before opening nodes.',
                      icon: MousePointer,
                      selected: nodeOpenClick === 'double'
                    }
                  ].map((option) => {
                    const Icon = option.icon
                    return (
                      <button
                        key={option.id}
                        type="button"
                        className={`rounded-[20px] border px-4 py-4 text-left transition-colors ${
                          option.selected
                            ? 'border-foreground bg-foreground text-background shadow-sm'
                            : 'border-border/50 bg-muted/30 hover:bg-muted/50'
                        }`}
                        onClick={() => setSetting('nodeOpenClick', option.id)}
                      >
                        <Icon className="h-4 w-4" />
                        <p className="mt-3 text-sm font-medium">{option.label}</p>
                        <p className={`mt-1 text-xs ${option.selected ? 'text-background/70' : 'text-muted-foreground'}`}>
                          {option.description}
                        </p>
                      </button>
                    )
                  })}
                </div>
              </SettingsPanel>
            </>
          )}

          {activeSection === 'workspace' && (
            <>
              <SettingsPanel
                title="Workspace Storage"
                description="Folders are real directories and each board is stored as a JSON file under the selected root directory."
              >
                <div className="space-y-5">
                  {recentWorkspaces.length > 0 && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Recent Workspaces</label>
                      <select
                        className="h-11 w-full rounded-2xl border border-input bg-background px-4 text-sm"
                        value={workspace?.rootDir ?? ''}
                        onChange={(e) => {
                          if (e.target.value) void switchToRecentWorkspace(e.target.value)
                        }}
                        disabled={savingWorkspace}
                      >
                        {recentWorkspaces.map((w) => (
                          <option key={w.path} value={w.path}>
                            {w.name} — {w.path}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Workspace Root Directory</label>
                    <Input
                      value={workspaceRoot}
                      onChange={(e) => setWorkspaceRoot(e.target.value)}
                      placeholder="Choose a directory for workspace data"
                    />
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="gap-1.5"
                      onClick={browseWorkspaceRoot}
                      disabled={savingWorkspace}
                    >
                      <Folder className="h-3.5 w-3.5" />
                      Browse
                    </Button>
                    <Button
                      className="gap-1.5"
                      onClick={saveWorkspaceRoot}
                      disabled={savingWorkspace || workspaceRoot.trim().length === 0}
                    >
                      <Save className="h-3.5 w-3.5" />
                      {savingWorkspace ? 'Saving...' : 'Save Workspace Root'}
                    </Button>
                  </div>

                  <div className="rounded-[20px] border border-destructive/20 bg-destructive/[0.04] p-4">
                    <label className="text-sm font-medium text-foreground">Reset Workspace</label>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Delete all boards and folders in the current workspace and restore default content.
                    </p>
                    {showResetConfirm ? (
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <span className="text-sm text-destructive">
                          Are you sure? This cannot be undone.
                        </span>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="gap-1.5"
                          onClick={handleResetWorkspace}
                          disabled={resettingWorkspace}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {resettingWorkspace ? 'Resetting...' : 'Confirm Reset'}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowResetConfirm(false)}
                          disabled={resettingWorkspace}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-4 gap-1.5"
                        onClick={() => setShowResetConfirm(true)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Reset Workspace
                      </Button>
                    )}
                  </div>
                </div>
              </SettingsPanel>

              <SettingsPanel
                title="Archived Boards"
                description="Archived boards live in a hidden .archive folder inside their original parent folder and stay out of the main UI until restored."
              >
                <div className="space-y-3">
                  {(workspace?.archivedBoards ?? []).length === 0 && (
                    <div className="rounded-[20px] border border-dashed border-border/60 bg-muted/20 px-4 py-4 text-sm text-muted-foreground">
                      No archived boards in this workspace.
                    </div>
                  )}

                  {(workspace?.archivedBoards ?? []).map((board) => (
                    <div
                      key={board.id}
                      className="flex flex-col gap-3 rounded-[20px] border border-border/50 bg-muted/20 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{board.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {board.folderId
                            ? `Stored in ${board.folderId}/.archive`
                            : 'Stored in .archive at the workspace root'}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 self-start sm:self-auto"
                        disabled={restoringArchivedBoardId === board.id}
                        onClick={() => void handleUnarchiveBoard(board.id)}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {restoringArchivedBoardId === board.id ? 'Unarchiving...' : 'Unarchive'}
                      </Button>
                    </div>
                  ))}
                </div>
              </SettingsPanel>
            </>
          )}

          {activeSection === 'updates' && (
            <SettingsPanel
              title="App Updates"
              description="Check for updates, download the newest build, and restart into a ready update."
            >
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-[20px] border border-border/50 bg-muted/25 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">Current version</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <code>{__APP_VERSION__}</code>
                  </p>
                </div>
                {updateState.status === 'up-to-date' && (
                  <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-sm text-emerald-600">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Up to date
                  </span>
                )}
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                {(updateState.status === 'idle' ||
                  updateState.status === 'up-to-date' ||
                  updateState.status === 'error') && (
                  <Button className="gap-1.5" onClick={checkForUpdates}>
                    <RefreshCw className="h-3.5 w-3.5" />
                    Check for updates
                  </Button>
                )}
                {updateState.status === 'checking' && (
                  <Button disabled className="gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Checking…
                  </Button>
                )}
                {updateState.status === 'available' && (
                  <Button className="gap-1.5" onClick={() => window.api.updater.download()}>
                    <Download className="h-3.5 w-3.5" />
                    Download v{updateState.version}
                  </Button>
                )}
                {updateState.status === 'downloading' && (
                  <Button disabled className="gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Downloading… {Math.round(updateState.percent)}%
                  </Button>
                )}
                {updateState.status === 'ready' && (
                  <Button className="gap-1.5" onClick={() => window.api.updater.install()}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    Restart to update
                  </Button>
                )}
                {updateState.status === 'error' && (
                  <span className="text-sm text-destructive">{updateState.message}</span>
                )}
              </div>
            </SettingsPanel>
          )}

          {activeSection === 'api' && (
            <SettingsPanel
              title="API Keys"
              description="Stored locally in app settings. Environment variables still work as fallbacks: OPENAI_API_KEY and ANTHROPIC_API_KEY."
            >
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">OpenAI API Key</label>
                  <Input
                    type="password"
                    value={openAiKey}
                    onChange={(e) => setOpenAiKey(e.target.value)}
                    placeholder="sk-..."
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Anthropic API Key</label>
                  <Input
                    type="password"
                    value={anthropicKey}
                    onChange={(e) => setAnthropicKey(e.target.value)}
                    placeholder="sk-ant-..."
                  />
                </div>

                <div className="flex gap-2">
                  <Button className="gap-1.5" onClick={saveKeys} disabled={saving}>
                    <Save className="h-3.5 w-3.5" />
                    {saving ? 'Saving...' : 'Save Keys'}
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => window.api.app.restart()}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Restart App
                  </Button>
                </div>
              </div>
            </SettingsPanel>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Color Swatch Input ──────────────────────────────────────────────────

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (hex: string) => void
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <label className="text-sm font-medium">{label}</label>
      <div className="flex items-center gap-2">
        <div className="relative">
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
          <span
            className="block h-6 w-6 rounded-full border border-border/60 shadow-sm"
            style={{ backgroundColor: value }}
          />
        </div>
        <Input
          className="w-[100px] text-center font-mono text-xs uppercase"
          value={value}
          onChange={(e) => {
            const v = e.target.value
            if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onChange(v)
          }}
          maxLength={7}
        />
      </div>
    </div>
  )
}

// ─── Theme Customizer ────────────────────────────────────────────────────

function ThemeCustomizer({
  resolved,
  customization,
  onChange,
}: {
  resolved: 'light' | 'dark'
  customization: ThemeCustomization
  onChange: (next: ThemeCustomization) => void
}): React.ReactElement {
  const [presetOpen, setPresetOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)

  const activeColors = resolved === 'dark' ? customization.colors.dark : customization.colors.light
  const modeLabel = resolved === 'dark' ? 'Dark' : 'Light'
  const currentPreset = getPresetById(customization.preset)

  const togglePresetMenu = (): void => {
    if (presetOpen) {
      setPresetOpen(false)
      return
    }
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 4, left: rect.right - 220 })
    }
    setPresetOpen(true)
  }

  const updateColor = (field: keyof typeof activeColors, hex: string): void => {
    const nextColors = { ...customization.colors }
    if (resolved === 'dark') {
      nextColors.dark = { ...nextColors.dark, [field]: hex }
    } else {
      nextColors.light = { ...nextColors.light, [field]: hex }
    }
    onChange({ ...customization, colors: nextColors })
  }

  const selectPreset = (presetId: string): void => {
    const preset = getPresetById(presetId)
    if (!preset) return
    onChange({
      preset: preset.id,
      colors: { light: { ...preset.light }, dark: { ...preset.dark } },
      uiFont: preset.uiFont ?? '',
      codeFont: preset.codeFont ?? '',
    })
    setPresetOpen(false)
  }

  return (
    <div className="space-y-1">
      {/* Preset selector + preview */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">{modeLabel} theme</span>
        <div className="relative">
          <button
            ref={triggerRef}
            type="button"
            className="flex h-9 items-center gap-2 rounded-xl border border-border/50 bg-muted/30 px-3 text-sm font-medium transition-colors hover:bg-muted/50"
            onClick={togglePresetMenu}
          >
            {/* Mini color preview dots */}
            <span className="flex gap-1">
              <span className="h-3 w-3 rounded-full border border-border/40" style={{ backgroundColor: activeColors.accent }} />
              <span className="h-3 w-3 rounded-full border border-border/40" style={{ backgroundColor: activeColors.background }} />
              <span className="h-3 w-3 rounded-full border border-border/40" style={{ backgroundColor: activeColors.foreground }} />
            </span>
            <span>{currentPreset?.name ?? 'Custom'}</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>

          {presetOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setPresetOpen(false)} />
              <div className="fixed z-50 w-[220px] max-h-[320px] overflow-y-auto rounded-xl border border-border/50 bg-popover p-1 shadow-lg" style={menuPos ? { top: menuPos.top, left: menuPos.left } : undefined}>
                {THEME_PRESETS.map((preset) => {
                  const previewColors = resolved === 'dark' ? preset.dark : preset.light
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                        customization.preset === preset.id
                          ? 'bg-accent text-foreground font-medium'
                          : 'hover:bg-accent/60'
                      }`}
                      onClick={() => selectPreset(preset.id)}
                    >
                      <span className="flex gap-0.5">
                        <span className="h-3.5 w-3.5 rounded-full border border-border/40" style={{ backgroundColor: previewColors.accent }} />
                        <span className="h-3.5 w-3.5 rounded-full border border-border/40" style={{ backgroundColor: previewColors.background }} />
                        <span className="h-3.5 w-3.5 rounded-full border border-border/40" style={{ backgroundColor: previewColors.foreground }} />
                      </span>
                      <span className="flex-1 truncate">{preset.name}</span>
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Color rows */}
      <div className="divide-y divide-border/30">
        <ColorRow label="Accent" value={activeColors.accent} onChange={(hex) => updateColor('accent', hex)} />
        <ColorRow label="Background" value={activeColors.background} onChange={(hex) => updateColor('background', hex)} />
        <ColorRow label="Foreground" value={activeColors.foreground} onChange={(hex) => updateColor('foreground', hex)} />
      </div>

      {/* Font rows */}
      <div className="mt-4 divide-y divide-border/30">
        <div className="flex items-center justify-between gap-4 py-2">
          <label className="text-sm font-medium">UI Font</label>
          <Input
            className="max-w-[200px] text-right text-sm"
            value={customization.uiFont}
            onChange={(e) => onChange({ ...customization, uiFont: e.target.value })}
            placeholder="System default"
          />
        </div>
        <div className="flex items-center justify-between gap-4 py-2">
          <label className="text-sm font-medium">Code Font</label>
          <Input
            className="max-w-[200px] text-right text-sm"
            value={customization.codeFont}
            onChange={(e) => onChange({ ...customization, codeFont: e.target.value })}
            placeholder="System default"
          />
        </div>
      </div>
    </div>
  )
}
