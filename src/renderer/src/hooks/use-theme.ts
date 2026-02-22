import { useState, useEffect, useCallback } from 'react'

export type Theme = 'light' | 'dark' | 'system'

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: Theme): void {
  const resolved = theme === 'system' ? getSystemTheme() : theme
  document.documentElement.classList.toggle('dark', resolved === 'dark')
}

export function useTheme(): {
  theme: Theme
  resolved: 'light' | 'dark'
  setTheme: (theme: Theme) => Promise<void>
} {
  const [theme, setThemeState] = useState<Theme>('system')

  // Load saved theme on mount
  useEffect(() => {
    window.api.settings.get('theme').then((saved) => {
      const t = (saved as Theme) ?? 'system'
      setThemeState(t)
      applyTheme(t)
    })
  }, [])

  // Listen for OS theme changes when set to system
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (): void => {
      if (theme === 'system') applyTheme('system')
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  const setTheme = useCallback(async (t: Theme) => {
    setThemeState(t)
    applyTheme(t)
    await window.api.settings.set('theme', t)
  }, [])

  const resolved = theme === 'system' ? getSystemTheme() : theme

  return { theme, resolved, setTheme }
}
