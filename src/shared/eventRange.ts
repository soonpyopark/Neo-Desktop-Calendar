import type { CalendarEvent } from './calendarTypes'

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

export function isRecurringEvent(event: CalendarEvent | null | undefined): boolean {
  const repeat = String(event?.repeat ?? 'none')
    .trim()
    .toLowerCase()
  return Boolean(repeat) && repeat !== 'none' && repeat !== 'never' && repeat !== 'off'
}

export function eventStartYear(event: CalendarEvent): number {
  const year = Number.parseInt(String(event.startDate ?? '').slice(0, 4), 10)
  return Number.isFinite(year) ? year : new Date().getFullYear()
}

export function normalizeDateKey(value: string | null | undefined): string | null {
  const key = String(value ?? '').trim()
  return DATE_KEY_RE.test(key) ? key : null
}

/** Inclusive YYYY-MM-DD overlap. Recurring masters are always included when a range is set. */
export function eventOverlapsDateRange(
  event: CalendarEvent,
  from?: string | null,
  to?: string | null
): boolean {
  const startBound = normalizeDateKey(from)
  const endBound = normalizeDateKey(to)
  if (!startBound && !endBound) return true
  if (isRecurringEvent(event)) return true
  const start = normalizeDateKey(event.startDate) ?? '0000-01-01'
  const end = normalizeDateKey(event.endDate) ?? start
  if (startBound && end < startBound) return false
  if (endBound && start > endBound) return false
  return true
}
