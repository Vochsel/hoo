import { useEffect, useState } from 'react'
import { RotateCcw, Save, Moon, Sun, Monitor, MousePointer2, Map, Folder } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useSettings } from '@/hooks/use-settings'
import { useWorkspace } from '@/hooks/use-workspace'
import { useThemeContext } from '@/App'

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

export function SettingsPage(): React.ReactElement {
  const { settings, getSetting, setSetting } = useSettings()
  const { workspace, setRootDir } = useWorkspace()
  const { theme, setTheme } = useThemeContext()

  const [openAiKey, setOpenAiKey] = useState('')
  const [anthropicKey, setAnthropicKey] = useState('')
  const [workspaceRoot, setWorkspaceRoot] = useState('')
  const [saving, setSaving] = useState(false)
  const [savingWorkspace, setSavingWorkspace] = useState(false)

  const selectedModel = ((getSetting('browserAiModel') as string) ?? 'claude-sonnet-4-6').trim()
  const flowInteractionMode: FlowInteractionMode =
    (getSetting('flowInteractionMode') as string) === 'map' ? 'map' : 'design'

  useEffect(() => {
    setOpenAiKey(((getSetting('openaiApiKey') as string) ?? '').trim())
    setAnthropicKey(((getSetting('anthropicApiKey') as string) ?? '').trim())
  }, [settings, getSetting])

  useEffect(() => {
    setWorkspaceRoot(workspace?.rootDir ?? '')
  }, [workspace?.rootDir])

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

        <section className="rounded-lg border p-4 space-y-4">
          <div>
            <h2 className="text-base font-semibold">Workspace Storage</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Folders are real directories and each board is stored as a JSON file under this root directory.
            </p>
          </div>

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
