import { createContext, useContext } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { BrowserPage } from '@/pages/browser'
import { useTheme, type Theme } from '@/hooks/use-theme'

interface ThemeContextValue {
  theme: Theme
  resolved: 'light' | 'dark'
  setTheme: (theme: Theme) => Promise<void>
  customization: import('@/lib/theme-presets').ThemeCustomization
  setCustomization: (c: import('@/lib/theme-presets').ThemeCustomization) => Promise<void>
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'system',
  resolved: 'dark',
  setTheme: async () => {},
  customization: { preset: 'default', colors: { light: { accent: '', background: '', foreground: '' }, dark: { accent: '', background: '', foreground: '' } }, uiFont: '', codeFont: '' },
  setCustomization: async () => {},
})

export const useThemeContext = (): ThemeContextValue => useContext(ThemeContext)

function AppShell(): React.ReactElement {
  return (
    <div className="flex h-screen flex-col">
      <main className="min-h-0 flex-1">
        <Routes>
          <Route path="/" element={<BrowserPage />} />
          <Route path="/browser" element={<BrowserPage />} />
          <Route path="/settings" element={<BrowserPage />} />
        </Routes>
      </main>
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
