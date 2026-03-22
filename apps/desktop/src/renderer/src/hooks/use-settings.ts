import { useState, useEffect, useCallback, useRef } from 'react'

type SettingsMap = Record<string, unknown>
type SettingUpdater = (prevValue: unknown, prevSettings: SettingsMap) => unknown
type SettingValue = unknown | SettingUpdater

// Cross-instance sync: when any useSettings instance writes a setting,
// all other instances are notified so they stay in sync.
type SettingsListener = (settings: SettingsMap) => void
const listeners = new Set<SettingsListener>()

function notifyListeners(settings: SettingsMap, exclude?: SettingsListener): void {
  for (const listener of listeners) {
    if (listener !== exclude) listener(settings)
  }
}

export function useSettings(): {
  settings: SettingsMap
  loading: boolean
  getSetting: (key: string) => unknown
  setSetting: (key: string, value: SettingValue) => Promise<void>
  refresh: () => Promise<void>
} {
  const [settings, setSettings] = useState<SettingsMap>({})
  const [loading, setLoading] = useState(true)
  const settingsRef = useRef<SettingsMap>({})

  const resolveSettingValue = useCallback((value: SettingValue, currentSettings: SettingsMap, key: string): unknown => {
    if (typeof value === 'function') {
      return (value as SettingUpdater)(currentSettings[key], currentSettings)
    }
    return value
  }, [])

  const refresh = useCallback(async () => {
    const result = await window.api.settings.getAll()
    settingsRef.current = result
    setSettings(result)
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Listen for cross-instance settings updates
  const listenerRef = useRef<SettingsListener | null>(null)
  useEffect(() => {
    const listener: SettingsListener = (next) => {
      settingsRef.current = next
      setSettings(next)
    }
    listenerRef.current = listener
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [])

  const getSetting = useCallback(
    (key: string) => settings[key],
    [settings]
  )

  const setSetting = useCallback(async (key: string, value: SettingValue) => {
    const currentSettings = settingsRef.current
    const nextValue = resolveSettingValue(value, currentSettings, key)
    const nextSettings = { ...currentSettings, [key]: nextValue }
    settingsRef.current = nextSettings
    setSettings(nextSettings)
    notifyListeners(nextSettings, listenerRef.current ?? undefined)
    await window.api.settings.set(key, nextValue)
  }, [resolveSettingValue])

  return { settings, loading, getSetting, setSetting, refresh }
}
