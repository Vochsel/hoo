import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * Format an ISO date string as a relative countdown when same-day,
 * otherwise fall back to a calendar label.
 */
export function formatRelativeDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()

  // Check if same calendar day (local time)
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()

  if (sameDay) {
    const diffMs = d.getTime() - now.getTime()
    if (diffMs <= 0) {
      // Already passed today
      const mins = Math.round(Math.abs(diffMs) / 60_000)
      if (mins < 60) return `${mins}m ago`
      return `${Math.round(mins / 60)}h ago`
    }
    const mins = Math.round(diffMs / 60_000)
    if (mins < 60) return `in ${mins}m`
    const hrs = Math.floor(mins / 60)
    const remainder = mins % 60
    if (remainder === 0) return `in ${hrs}h`
    return `in ${hrs}h ${remainder}m`
  }

  // Not same day — calendar-style
  const diffMs = d.getTime() - now.getTime()
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

  if (days < 0) return `${Math.abs(days)}d overdue`
  if (days === 1) return 'Tomorrow'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
