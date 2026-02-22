import { createContext, useContext } from 'react'
import { HashRouter, NavLink, Route, Routes } from 'react-router-dom'
import { BrowserPage } from '@/pages/browser'
import { SettingsPage } from '@/pages/settings'
import { useTheme, type Theme } from '@/hooks/use-theme'

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

export default function App(): React.ReactElement {
  const themeValue = useTheme()

  return (
    <ThemeContext.Provider value={themeValue}>
      <HashRouter>
        <div className="flex h-screen flex-col bg-background">
          <header className="drag-region border-b px-4 py-3">
            <div className="titlebar-nav-offset no-drag flex items-center gap-2">
              <NavItem to="/browser" label="Browser" />
              <NavItem to="/settings" label="Settings" />
            </div>
          </header>

          <main className="min-h-0 flex-1">
            <Routes>
              <Route path="/" element={<BrowserPage />} />
              <Route path="/browser" element={<BrowserPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </main>
        </div>
      </HashRouter>
    </ThemeContext.Provider>
  )
}
