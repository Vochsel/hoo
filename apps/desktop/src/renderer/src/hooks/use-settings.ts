import { useState, useEffect, useCallback, useRef } from 'react'

type SettingsMap = Record<string, unknown>
type SettingUpdater = (prevValue: unknown, prevSettings: SettingsMap) => unknown
type SettingValue = unknown | SettingUpdater

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
    await window.api.settings.set(key, nextValue)
  }, [resolveSettingValue])

  return { settings, loading, getSetting, setSetting, refresh }
}
