import { createContext, useContext, useState } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { BrowserPage } from '@/pages/browser'
import { useTheme, type Theme } from '@/hooks/use-theme'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

interface ThemeContextValue {
  theme: Theme
  resolved: 'light' | 'dark'
  setTheme: (theme: Theme) => Promise<void>
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'system',
  resolved: 'dark',
  setTheme: async () => {}
})

export const useThemeContext = (): ThemeContextValue => useContext(ThemeContext)

interface AppActionsContextValue {
  openChangelog: () => void
}

const AppActionsContext = createContext<AppActionsContextValue>({
  openChangelog: () => {}
})

export const useAppActions = (): AppActionsContextValue => useContext(AppActionsContext)

interface ChangelogEntry {
  title: string
  date: string
  points: string[]
}

const CHANGELOG_ENTRIES: ChangelogEntry[] = [
  {
    title: 'Terminal & Dialog Improvements',
    date: 'March 4, 2026',
    points: [
      'Terminal scrollback increased to 10,000 lines and backend buffer to 500KB — reopening terminals no longer loses scroll history.',
      'Shift+Enter in terminal now sends a distinct key sequence so interactive CLIs like Claude Code can treat it as newline.',
      'AI chat sidebar in the browser dialog is now collapsed by default.',
      'Cmd+L / Ctrl+L now focuses the URL bar in both the dialog and the tabs view.',
      'Address bar auto-adds https:// for multi-part TLDs like .com.au and .co.uk.',
      'Added a "Node Open Action" setting to choose single-click or double-click to open nodes.',
      'Node renaming now uses a proper dialog instead of window.prompt — works reliably in Electron.',
      'Terminal dialog header shows the node name and supports inline rename via double-click.',
      'Terminal label is now displayed consistently across whiteboard nodes, sidebar, tabs view, and dialogs.'
    ]
  },
  {
    title: 'Notarization & Desktop Build',
    date: 'March 4, 2026',
    points: [
      'Added macOS entitlements and notarization support for distribution.',
      'Added auto-update banner component.',
      'Terminal preview component for whiteboard node thumbnails.'
    ]
  },
  {
    title: 'Workflow Canvas Overhaul',
    date: 'February 24, 2026',
    points: [
      'Added right-click execute for individual nodes and kept context menus inside the viewport.',
      'Standardized execution footer/status across browser and graph nodes.',
      'Added keyboard focus shortcut: press "f" to frame selected nodes or all nodes when none are selected.'
    ]
  },
  {
    title: 'Node UX Improvements',
    date: 'February 24, 2026',
    points: [
      'AI Prompt node now opens prompt editing in dialog on double-click and renders markdown output preview directly on the node.',
      'Text node is now Instructions, with dialog-based editing and updated add-menu labeling.',
      'Added Form Trigger node with on-node inputs, submit action, and dialog-based form schema editor.'
    ]
  },
  {
    title: 'Browser Capture and Output',
    date: 'February 24, 2026',
    points: [
      'Browser screenshot capture now exports opaque images to avoid transparency artifacts.',
      'Browser node output now emits HTML-to-markdown snapshot content only.',
      'Output node now supports full rendered markdown view in dialog on double-click.'
    ]
  },
  {
    title: 'Desktop Branding and Build',
    date: 'February 24, 2026',
    points: [
      'Updated app icons for desktop packaging and runtime window/dock usage.',
      'Set app product naming to Hoo in desktop/runtime surfaces.',
      'Fixed desktop build workflow checks around icon assets and validated build pipeline.'
    ]
  }
]

function AppShell(): React.ReactElement {
  const [changelogOpen, setChangelogOpen] = useState(false)

  const appActions: AppActionsContextValue = {
    openChangelog: () => setChangelogOpen(true)
  }

  return (
    <AppActionsContext.Provider value={appActions}>
      <div className="flex h-screen flex-col bg-background">
        <div className="drag-region h-9 shrink-0 border-b border-border/40" />

        <main className="min-h-0 flex-1">
          <Routes>
            <Route path="/" element={<BrowserPage />} />
            <Route path="/browser" element={<BrowserPage />} />
            <Route path="/settings" element={<BrowserPage />} />
          </Routes>
        </main>

        <Dialog open={changelogOpen} onOpenChange={setChangelogOpen}>
          <DialogContent className="sm:max-w-[760px] max-h-[84vh] overflow-hidden">
            <DialogHeader>
              <DialogTitle>Changelog</DialogTitle>
              <DialogDescription>Recent updates shipped in Hoo.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 overflow-y-auto pr-1">
              {CHANGELOG_ENTRIES.map((entry) => (
                <section key={`${entry.title}-${entry.date}`} className="rounded-md border bg-card/40 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">{entry.title}</h3>
                    <span className="text-[11px] text-muted-foreground">{entry.date}</span>
                  </div>
                  <ul className="list-disc space-y-1 pl-4 text-xs text-foreground/90">
                    {entry.points.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </AppActionsContext.Provider>
  )
}

export default function App(): React.ReactElement {
  const themeValue = useTheme()

  return (
    <ThemeContext.Provider value={themeValue}>
      <HashRouter>
        <AppShell />
      </HashRouter>
    </ThemeContext.Provider>
  )
}
