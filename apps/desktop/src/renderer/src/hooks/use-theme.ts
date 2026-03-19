import { useState, useEffect, useCallback } from 'react'
import {
  type ThemeCustomization,
  applyThemeCustomization,
  makeDefaultCustomization,
} from '@/lib/theme-presets'

export type Theme = 'light' | 'dark' | 'system'

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyThemeMode(theme: Theme): void {
  const resolved = theme === 'system' ? getSystemTheme() : theme
  document.documentElement.classList.toggle('dark', resolved === 'dark')
}

export function useTheme(): {
  theme: Theme
  resolved: 'light' | 'dark'
  setTheme: (theme: Theme) => Promise<void>
  customization: ThemeCustomization
  setCustomization: (c: ThemeCustomization) => Promise<void>
} {
  const [theme, setThemeState] = useState<Theme>('system')
  const [customization, setCustomizationState] = useState<ThemeCustomization>(makeDefaultCustomization)

  // Load saved theme + customization on mount
  useEffect(() => {
    Promise.all([
      window.api.settings.get('theme'),
      window.api.settings.get('themeCustomization'),
    ]).then(([savedTheme, savedCustomization]) => {
      const t = (savedTheme as Theme) ?? 'system'
      setThemeState(t)
      applyThemeMode(t)

      if (savedCustomization) {
        const c = savedCustomization as ThemeCustomization
        setCustomizationState(c)
        const resolved = t === 'system' ? getSystemTheme() : t
        applyThemeCustomization(c, resolved)
      }
    })
  }, [])

  // Listen for OS theme changes when set to system
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (): void => {
      if (theme === 'system') {
        applyThemeMode('system')
        applyThemeCustomization(customization, getSystemTheme())
      }
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme, customization])

  const setTheme = useCallback(async (t: Theme) => {
    setThemeState(t)
    applyThemeMode(t)
    const resolved = t === 'system' ? getSystemTheme() : t
    applyThemeCustomization(customization, resolved)
    await window.api.settings.set('theme', t)
  }, [customization])

  const setCustomization = useCallback(async (c: ThemeCustomization) => {
    setCustomizationState(c)
    const resolved = theme === 'system' ? getSystemTheme() : theme
    applyThemeCustomization(c, resolved)
    await window.api.settings.set('themeCustomization', c)
  }, [theme])

  const resolved = theme === 'system' ? getSystemTheme() : theme

  return { theme, resolved, setTheme, customization, setCustomization }
}
