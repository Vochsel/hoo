import { useEffect, useMemo, useState } from 'react'
import { Color } from 'three'
import { useSettings } from './use-settings'

export type HubWorldTimeMode = 'system' | 'override'

export const HUB_WORLD_TIME_MODE_KEY = 'hubWorldTimeMode'
export const HUB_WORLD_OVERRIDE_TIME_KEY = 'hubWorldOverrideTime'
export const DEFAULT_HUB_WORLD_OVERRIDE_TIME = '12:00'

const MINUTES_PER_DAY = 24 * 60

export interface HubWorldLighting {
  totalMinutes: number
  timeLabel: string
  daylightFactor: number
  nightFactor: number
  sunPosition: [number, number, number]
  directionalPosition: [number, number, number]
  backgroundColor: string
  fogColor: string
  hemisphereSkyColor: string
  hemisphereGroundColor: string
  directionalColor: string
  ambientIntensity: number
  directionalIntensity: number
  hemisphereIntensity: number
  environmentIntensity: number
  shadowOpacity: number
  skyTurbidity: number
  skyRayleigh: number
  skyMieCoefficient: number
  skyMieDirectionalG: number
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function mix(start: number, end: number, amount: number): number {
  return start + (end - start) * clamp01(amount)
}

function blendHex(start: string, end: string, amount: number): string {
  const color = new Color(start)
  color.lerp(new Color(end), clamp01(amount))
  return `#${color.getHexString()}`
}

export function getHubWorldTimeMode(value: unknown): HubWorldTimeMode {
  return value === 'override' ? 'override' : 'system'
}

export function parseHubWorldTime(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim())
  if (!match) return null

  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null

  return hours * 60 + minutes
}

export function sanitizeHubWorldOverrideTime(value: unknown): string {
  return typeof value === 'string' && parseHubWorldTime(value) !== null
    ? value
    : DEFAULT_HUB_WORLD_OVERRIDE_TIME
}

export function getSystemClockMinutes(now: Date = new Date()): number {
  return now.getHours() * 60 + now.getMinutes()
}

export function resolveHubWorldMinutes(
  timeMode: HubWorldTimeMode,
  overrideTime: string,
  now: Date = new Date()
): number {
  if (timeMode === 'override') {
    return parseHubWorldTime(overrideTime) ?? parseHubWorldTime(DEFAULT_HUB_WORLD_OVERRIDE_TIME) ?? 12 * 60
  }
  return getSystemClockMinutes(now)
}

export function formatHubWorldTimeLabel(totalMinutes: number): string {
  const normalized = ((Math.round(totalMinutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  const hours24 = Math.floor(normalized / 60)
  const minutes = normalized % 60
  const suffix = hours24 >= 12 ? 'PM' : 'AM'
  const hours12 = hours24 % 12 || 12

  return `${hours12}:${minutes.toString().padStart(2, '0')} ${suffix}`
}

export function buildHubWorldLighting(totalMinutes: number): HubWorldLighting {
  const normalizedMinutes = ((Math.round(totalMinutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  const orbitAngle = (normalizedMinutes / MINUTES_PER_DAY) * Math.PI * 2 - Math.PI / 2
  const rawSunHeight = Math.sin(orbitAngle)
  const daylight = smoothstep(-0.12, 0.22, rawSunHeight)
  const fullDay = smoothstep(0.08, 0.72, rawSunHeight)
  const twilight = clamp01(1 - Math.abs(rawSunHeight) / 0.24) * (1 - fullDay)
  const nightFactor = 1 - daylight

  const backgroundColor = blendHex(
    blendHex('#07111f', '#f59f6c', twilight),
    '#87ceeb',
    fullDay
  )
  const fogColor = blendHex(
    blendHex('#09172b', '#efb27c', twilight * 0.85),
    '#d9eefb',
    fullDay * 0.9
  )
  const hemisphereSkyColor = blendHex(
    blendHex('#14284b', '#ffba78', twilight * 0.9),
    '#9fd8ff',
    fullDay
  )
  const hemisphereGroundColor = blendHex('#15273a', '#4a7c59', daylight)
  const directionalColor = blendHex(
    blendHex('#a6bbff', '#ffd199', twilight),
    '#fff7df',
    fullDay
  )

  const sunPosition: [number, number, number] = [
    Math.cos(orbitAngle) * 120,
    rawSunHeight * 90,
    Math.sin(orbitAngle * 0.7) * 48 + 28
  ]

  const lightHeight = mix(10, 82, clamp01((rawSunHeight + 0.2) / 1.2))
  const directionalPosition: [number, number, number] = [
    Math.cos(orbitAngle) * 68,
    lightHeight,
    Math.sin(orbitAngle * 0.7) * 26 + 20
  ]

  return {
    totalMinutes: normalizedMinutes,
    timeLabel: formatHubWorldTimeLabel(normalizedMinutes),
    daylightFactor: daylight,
    nightFactor,
    sunPosition,
    directionalPosition,
    backgroundColor,
    fogColor,
    hemisphereSkyColor,
    hemisphereGroundColor,
    directionalColor,
    ambientIntensity: mix(0.18, 0.24, daylight) + twilight * 0.05,
    directionalIntensity: mix(0.24, 1.12, daylight) + twilight * 0.1,
    hemisphereIntensity: mix(0.17, 0.22, daylight) + twilight * 0.04,
    environmentIntensity: mix(0.1, 0.6, daylight),
    shadowOpacity: mix(0.1, 0.34, daylight),
    skyTurbidity: mix(2, 8, daylight) + twilight * 2,
    skyRayleigh: mix(0.15, 1.4, daylight) + twilight * 0.25,
    skyMieCoefficient: mix(0.005, 0.03, twilight) + fullDay * 0.002,
    skyMieDirectionalG: mix(0.97, 0.8, daylight)
  }
}

export function useHubWorldLighting(): HubWorldLighting & {
  timeMode: HubWorldTimeMode
  overrideTime: string
} {
  const { getSetting } = useSettings()
  const [clockTick, setClockTick] = useState(() => Date.now())

  const timeMode = getHubWorldTimeMode(getSetting(HUB_WORLD_TIME_MODE_KEY))
  const overrideTime = sanitizeHubWorldOverrideTime(getSetting(HUB_WORLD_OVERRIDE_TIME_KEY))

  useEffect(() => {
    if (timeMode === 'override') return

    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const scheduleNextTick = () => {
      const now = new Date()
      const msUntilNextMinute =
        (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 50

      timeoutId = setTimeout(() => {
        setClockTick(Date.now())
        scheduleNextTick()
      }, Math.max(msUntilNextMinute, 1000))
    }

    scheduleNextTick()

    return () => {
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [timeMode])

  const totalMinutes = useMemo(
    () => resolveHubWorldMinutes(timeMode, overrideTime, new Date(clockTick)),
    [clockTick, overrideTime, timeMode]
  )

  return useMemo(
    () => ({
      timeMode,
      overrideTime,
      ...buildHubWorldLighting(totalMinutes)
    }),
    [overrideTime, timeMode, totalMinutes]
  )
}
