import { formatTime24, isTimedEvent } from '../../../shared/mdcExport/eventBarFormat.js'
import { eventOnDay, parseDateKey } from './calendarUtils'

const WEEKDAY_NAMES = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일']

const REPEAT_LABELS: Record<string, string | null> = {
  none: null,
  daily: '매일',
  weekly: '매주',
  monthly: '매월',
  yearly: '매년',
  'lunar-monthly': '음력 매월',
  'lunar-yearly': '음력 매년',
  weekdays: '주중(월~금)'
}

function formatShortDate(date: Date): string {
  return `${date.getMonth() + 1}월 ${date.getDate()}일`
}

function formatDetailDate(date: Date): string {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 (${WEEKDAY_NAMES[date.getDay()]})`
}

export type EventScheduleRelativeBadge = 'today' | 'tomorrow' | 'dayAfter'

export type EventScheduleParts = {
  dateLine: string
  timeLine: string | null
  relativeBadge: EventScheduleRelativeBadge | null
}

function getRelativeDayBadge(date: Date, now = new Date()): EventScheduleRelativeBadge | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86_400_000)
  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'tomorrow'
  if (diffDays === 2) return 'dayAfter'
  return null
}

export function formatEventScheduleParts(
  event: {
    startDate: string
    endDate?: string
    allDay?: boolean
    startTime?: string | null
    endTime?: string | null
  },
  dayKey?: string
): EventScheduleParts {
  const refKey = dayKey && eventOnDay(event, dayKey) ? dayKey : event.startDate
  const refDate = parseDateKey(refKey)
  const endDateKey = event.endDate || event.startDate
  const multiDay = event.startDate !== endDateKey

  if (multiDay) {
    const start = parseDateKey(event.startDate)
    const end = parseDateKey(endDateKey)
    const rangePart =
      start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()
        ? `${formatShortDate(start)}~${end.getDate()}일 (${WEEKDAY_NAMES[end.getDay()]})`
        : `${formatShortDate(start)}~${formatShortDate(end)} (${WEEKDAY_NAMES[end.getDay()]})`
    const yearPrefix =
      start.getFullYear() === end.getFullYear() ? `${start.getFullYear()}년 ` : ''
    const dateLine = `${yearPrefix}${rangePart}`

    if (isTimedEvent(event)) {
      return {
        dateLine,
        timeLine: `${formatTime24(event.startTime)} ~ ${formatShortDate(end)} ${formatTime24(event.endTime)}`,
        relativeBadge: getRelativeDayBadge(refDate)
      }
    }

    return {
      dateLine,
      timeLine: '종일',
      relativeBadge: getRelativeDayBadge(refDate)
    }
  }

  const dateLine = formatDetailDate(refDate)
  if (isTimedEvent(event)) {
    return {
      dateLine,
      timeLine: `${formatTime24(event.startTime)} ~ ${formatTime24(event.endTime)}`,
      relativeBadge: getRelativeDayBadge(refDate)
    }
  }

  return {
    dateLine,
    timeLine: '종일',
    relativeBadge: getRelativeDayBadge(refDate)
  }
}

/** Quick-edit / day-list label (plain title; tag icons render separately). */
export function formatEventBarLabel(
  event: { title?: string; allDay?: boolean; startTime?: string | null },
  showOnDay: boolean,
  _tags?: unknown
): { time: string | null; title: string } | null {
  if (!showOnDay) return null
  const title = event.title ?? ''
  if (!isTimedEvent(event)) {
    return { time: null, title }
  }
  return {
    time: formatTime24(event.startTime),
    title
  }
}

export function formatRepeatLabel(
  event: { repeat?: string | null; repeatUntil?: string | null; repeatCount?: number | null } | string | null | undefined
): string | null {
  if (!event) return null
  const repeat = typeof event === 'string' ? event : (event.repeat ?? 'none')
  if (!repeat || repeat === 'none') return null
  const base = REPEAT_LABELS[repeat]
  if (!base) return null

  if (typeof event === 'string') return base

  if (event.repeatUntil) {
    const [y, m, d] = String(event.repeatUntil).split('-')
    return `${base} · ${Number(y)}년 ${Number(m)}월 ${Number(d)}일까지`
  }
  if (event.repeatCount) {
    return `${base} · ${event.repeatCount}회`
  }
  return base
}
