import { useEffect, useState, useCallback, useMemo } from 'react'
import { RotateCcw, Save, Moon, Sun, Monitor, MousePointer2, Map, Folder, MousePointerClick, MousePointer, Download, RefreshCw, CheckCircle2, Loader2, Trash2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useSettings } from '@/hooks/use-settings'
import { useWorkspace } from '@/hooks/use-workspace'
import { useThemeContext } from '@/App'
import {
  CLI_AGENTS,
  WORKSPACE_AGENT_COMMAND_OVERRIDES_KEY,
  getWorkspaceAgentCommandOverrides,
  type AgentId
} from '@/lib/cli-agents'

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

export function SettingsPage(): React.ReactElement {
  const { settings, getSetting, setSetting } = useSettings()
  const { workspace, setRootDir, resetWorkspace, getRecentWorkspaces } = useWorkspace()
  const { theme, setTheme } = useThemeContext()

  const [openAiKey, setOpenAiKey] = useState('')
  const [anthropicKey, setAnthropicKey] = useState('')
  const [workspaceRoot, setWorkspaceRoot] = useState('')
  const [saving, setSaving] = useState(false)
  const [savingWorkspace, setSavingWorkspace] = useState(false)
  const [savingAgentCommands, setSavingAgentCommands] = useState(false)
  const [resettingWorkspace, setResettingWorkspace] = useState(false)
  const [recentWorkspaces, setRecentWorkspaces] = useState<Array<{ path: string; name: string }>>([])
  const [showResetConfirm, setShowResetConfirm] = useState(false)
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
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <section className="rounded-lg border p-4">
          <h2 className="text-base font-semibold">Appearance</h2>
          <p className="mt-1 text-sm text-muted-foreground">Theme is saved in local settings.</p>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant={theme === 'system' ? 'default' : 'outline'}
              className="gap-1.5"
              onClick={() => setTheme('system')}
            >
              <Monitor className="h-3.5 w-3.5" />
              System
            </Button>
            <Button
              size="sm"
              variant={theme === 'light' ? 'default' : 'outline'}
              className="gap-1.5"
              onClick={() => setTheme('light')}
            >
              <Sun className="h-3.5 w-3.5" />
              Light
            </Button>
            <Button
              size="sm"
              variant={theme === 'dark' ? 'default' : 'outline'}
              className="gap-1.5"
              onClick={() => setTheme('dark')}
            >
              <Moon className="h-3.5 w-3.5" />
              Dark
            </Button>
          </div>
        </section>

        <section className="rounded-lg border p-4">
          <h2 className="text-base font-semibold">Browser Model</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Chooses the model used by browser chat and AI prompt nodes.
          </p>
          <select
            className="mt-3 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={selectedModel}
            onChange={(e) => setSetting('browserAiModel', e.target.value)}
          >
            {BROWSER_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        </section>

        <section className="rounded-lg border p-4">
          <h2 className="text-base font-semibold">Default Agent</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            CLI agent launched when creating a new terminal from the sidebar.
          </p>
          <select
            className="mt-3 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={defaultAgent}
            onChange={(e) => setSetting('defaultAgent', e.target.value)}
          >
            {CLI_AGENTS.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.label}
              </option>
            ))}
          </select>
        </section>

        <section className="rounded-lg border p-4 space-y-4">
          <div>
            <h2 className="text-base font-semibold">Workspace Agent Commands</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Override the CLI command used for each agent in this workspace. Leave blank to use the default command.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {workspaceRootDir ? `Current workspace: ${workspaceRootDir}` : 'Select a workspace to configure overrides.'}
            </p>
          </div>

          <div className="space-y-3">
            {CLI_AGENTS.map((agent) => (
              <div key={agent.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-sm font-medium">{agent.label}</label>
                  <span className="text-xs text-muted-foreground">Default: <code>{agent.command}</code></span>
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

          <div className="flex gap-2">
            <Button
              className="gap-1.5"
              onClick={saveWorkspaceAgentCommands}
              disabled={!workspaceRootDir || savingAgentCommands}
            >
              <Save className="h-3.5 w-3.5" />
              {savingAgentCommands ? 'Saving...' : 'Save Workspace Agent Commands'}
            </Button>
            <Button
              variant="outline"
              onClick={() => void resetWorkspaceAgentCommands()}
              disabled={!workspaceRootDir || savingAgentCommands}
            >
              Reset to Defaults
            </Button>
          </div>
        </section>

        <section className="rounded-lg border p-4">
          <h2 className="text-base font-semibold">Canvas Interaction</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Switch between graph editing mode and map-style navigation mode.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant={flowInteractionMode === 'design' ? 'default' : 'outline'}
              className="gap-1.5"
              onClick={() => setSetting('flowInteractionMode', 'design')}
            >
              <MousePointer2 className="h-3.5 w-3.5" />
              Design Tool
            </Button>
            <Button
              size="sm"
              variant={flowInteractionMode === 'map' ? 'default' : 'outline'}
              className="gap-1.5"
              onClick={() => setSetting('flowInteractionMode', 'map')}
            >
              <Map className="h-3.5 w-3.5" />
              Map Like
            </Button>
          </div>
        </section>

        <section className="rounded-lg border p-4">
          <h2 className="text-base font-semibold">Node Open Action</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Open tab and terminal nodes with a single click or double click.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant={nodeOpenClick === 'single' ? 'default' : 'outline'}
              className="gap-1.5"
              onClick={() => setSetting('nodeOpenClick', 'single')}
            >
              <MousePointerClick className="h-3.5 w-3.5" />
              Single Click
            </Button>
            <Button
              size="sm"
              variant={nodeOpenClick === 'double' ? 'default' : 'outline'}
              className="gap-1.5"
              onClick={() => setSetting('nodeOpenClick', 'double')}
            >
              <MousePointer className="h-3.5 w-3.5" />
              Double Click
            </Button>
          </div>
        </section>

        <section className="rounded-lg border p-4 space-y-4">
          <div>
            <h2 className="text-base font-semibold">Workspace Storage</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Folders are real directories and each board is stored as a JSON file under this root directory.
            </p>
          </div>

          {recentWorkspaces.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Recent Workspaces</label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={workspace?.rootDir ?? ''}
                onChange={(e) => {
                  if (e.target.value) switchToRecentWorkspace(e.target.value)
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
            <Button variant="outline" className="gap-1.5" onClick={browseWorkspaceRoot} disabled={savingWorkspace}>
              <Folder className="h-3.5 w-3.5" />
              Browse
            </Button>
            <Button className="gap-1.5" onClick={saveWorkspaceRoot} disabled={savingWorkspace || workspaceRoot.trim().length === 0}>
              <Save className="h-3.5 w-3.5" />
              {savingWorkspace ? 'Saving...' : 'Save Workspace Root'}
            </Button>
          </div>

          <div className="border-t pt-4 space-y-2">
            <label className="text-sm font-medium">Reset Workspace</label>
            <p className="text-sm text-muted-foreground">
              Delete all boards and folders in the current workspace and restore default content.
            </p>
            {showResetConfirm ? (
              <div className="flex gap-2 items-center">
                <span className="text-sm text-destructive">Are you sure? This cannot be undone.</span>
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
                className="gap-1.5"
                onClick={() => setShowResetConfirm(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Reset Workspace
              </Button>
            )}
          </div>
        </section>

        <section className="rounded-lg border p-4 space-y-4">
          <div>
            <h2 className="text-base font-semibold">Updates</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Current version: <code className="text-xs">{__APP_VERSION__}</code>
            </p>
          </div>
          <div className="flex items-center gap-3">
            {(updateState.status === 'idle' || updateState.status === 'up-to-date' || updateState.status === 'error') && (
              <Button size="sm" className="gap-1.5" onClick={checkForUpdates}>
                <RefreshCw className="h-3.5 w-3.5" />
                Check for updates
              </Button>
            )}
            {updateState.status === 'checking' && (
              <Button size="sm" disabled className="gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Checking…
              </Button>
            )}
            {updateState.status === 'available' && (
              <Button size="sm" className="gap-1.5" onClick={() => window.api.updater.download()}>
                <Download className="h-3.5 w-3.5" />
                Download v{updateState.version}
              </Button>
            )}
            {updateState.status === 'downloading' && (
              <Button size="sm" disabled className="gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Downloading… {Math.round(updateState.percent)}%
              </Button>
            )}
            {updateState.status === 'ready' && (
              <Button size="sm" className="gap-1.5" onClick={() => window.api.updater.install()}>
                <RotateCcw className="h-3.5 w-3.5" />
                Restart to update
              </Button>
            )}
            {updateState.status === 'up-to-date' && (
              <span className="flex items-center gap-1.5 text-sm text-green-600">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Up to date
              </span>
            )}
            {updateState.status === 'error' && (
              <span className="text-sm text-destructive">{updateState.message}</span>
            )}
          </div>
        </section>

        <section className="rounded-lg border p-4 space-y-4">
          <div>
            <h2 className="text-base font-semibold">API Keys</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Stored locally in app settings. Environment variables are also supported as fallback:
              <code className="ml-1">OPENAI_API_KEY</code> and <code>ANTHROPIC_API_KEY</code>.
            </p>
          </div>

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
            <Button variant="outline" className="gap-1.5" onClick={() => window.api.app.restart()}>
              <RotateCcw className="h-3.5 w-3.5" />
              Restart App
            </Button>
          </div>
        </section>
      </div>
    </div>
  )
}
