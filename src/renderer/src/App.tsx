import { createContext, useContext, useState } from 'react'
import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { Plus, ScrollText } from 'lucide-react'
import { BrowserPage } from '@/pages/browser'
import { SettingsPage } from '@/pages/settings'
import { useTheme, type Theme } from '@/hooks/use-theme'
import { Button } from '@/components/ui/button'
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

interface ChangelogEntry {
  title: string
  date: string
  points: string[]
}

const CHANGELOG_ENTRIES: ChangelogEntry[] = [
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

function NavItem({ to, label }: { to: string; label: string }): React.ReactElement {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          'px-3 py-1.5 rounded-md text-sm font-medium transition-colors no-drag',
          isActive
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent'
        ].join(' ')
      }
    >
      {label}
    </NavLink>
  )
}

function AppShell(): React.ReactElement {
  const location = useLocation()
  const isBrowserRoute = location.pathname === '/' || location.pathname === '/browser'
  const [changelogOpen, setChangelogOpen] = useState(false)

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="drag-region border-b px-4 py-3">
        <div className="titlebar-nav-offset flex items-center justify-between gap-3">
          <div className="no-drag flex items-center gap-2">
            <NavItem to="/browser" label="Browser" />
            <NavItem to="/settings" label="Settings" />
            <button
              type="button"
              className={[
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors no-drag',
                changelogOpen
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              ].join(' ')}
              onClick={() => setChangelogOpen(true)}
            >
              <ScrollText className="h-4 w-4" />
              Changelog
            </button>
          </div>

          {isBrowserRoute ? (
            <div className="no-drag">
              <Button
                size="sm"
                className="gap-1"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('hoo:browser-add-tab'))
                }}
              >
                <Plus className="h-4 w-4" />
                Add Tab
              </Button>
            </div>
          ) : null}
        </div>
      </header>

      <main className="min-h-0 flex-1">
        <Routes>
          <Route path="/" element={<BrowserPage />} />
          <Route path="/browser" element={<BrowserPage />} />
          <Route path="/settings" element={<SettingsPage />} />
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
