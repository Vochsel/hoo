import { useState, useEffect, useCallback } from 'react'

export function useSettings(): {
  settings: Record<string, unknown>
  loading: boolean
  getSetting: (key: string) => unknown
  setSetting: (key: string, value: unknown) => Promise<void>
  refresh: () => Promise<void>
} {
  const [settings, setSettings] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const result = await window.api.settings.getAll()
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

  const setSetting = useCallback(async (key: string, value: unknown) => {
    await window.api.settings.set(key, value)
    setSettings((prev) => ({ ...prev, [key]: value }))
  }, [])

  return { settings, loading, getSetting, setSetting, refresh }
}
