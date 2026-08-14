import { DEFAULT_VIEW_OPTIONS, HOLIDAYS_KR_CALENDAR_ID } from './constants.js'
import {
  compareEventsForDayDisplay,
  formatDayListExportEventParts,
} from './eventBarFormat.js'
import { addDaysToDateKey, expandEventsForRange, getSeriesId } from './eventOccurrences.js'
import { filterEventsForExport, filterExpandedEventsForExport } from './exportFilters.js'
import {
  formatDayListDateLabel,
  listDateKeysInRange,
} from './exportRange.js'

/**
 * Dates covered by 대한민국의 휴일 events, so rows can borrow the Sunday style.
 * Independent of the includeHolidays option: a date stays a holiday even when
 * the holiday titles themselves are left out of the export.
 *
 * @param {object} store
 * @param {string} startDate
 * @param {string} endDate
 * @param {{ excludeHiddenCalendars?: boolean, asAdmin?: boolean }} options
 * @returns {Set<string>}
 */
function collectHolidayDateKeys(store, startDate, endDate, options) {
  const keys = new Set()
  const calendar = (store?.calendars ?? []).find((item) => item.id === HOLIDAYS_KR_CALENDAR_ID)
  if (!calendar) return keys
  const hidden = calendar.visible === false
  if (hidden && (options.excludeHiddenCalendars || options.asAdmin === false)) return keys

  for (const event of store?.events ?? []) {
    if (event?.calendarId !== HOLIDAYS_KR_CALENDAR_ID) continue
    const eventStart = event.startDate < startDate ? startDate : event.startDate
    const eventEnd = (event.endDate || event.startDate) > endDate
      ? endDate
      : event.endDate || event.startDate
    if (!eventStart || eventEnd < startDate || eventStart > endDate) continue
    let cursor = eventStart
    for (let i = 0; i < 400 && cursor <= eventEnd; i += 1) {
      keys.add(cursor)
      cursor = addDaysToDateKey(cursor, 1)
    }
  }
  return keys
}

/**
 * Build a day-list export model for [startDate, endDate].
 * Every date in the range is included (empty days keep an empty events array).
 * Multi-day / recurring events appear on every overlapping date.
 *
 * @param {object} store
 * @param {{ startDate: string, endDate: string }} range
 * @param {{
 *   includeCompleted?: boolean
 *   includeHolidays?: boolean
 *   excludeHiddenCalendars?: boolean
 *   asAdmin?: boolean
 *   dayListSortDesc?: boolean
 * }} [options]
 */
export function prepareDayListExportLayout(store, range, options = {}) {
  const startDate = range.startDate
  const endDate = range.endDate
  if (!startDate || !endDate || endDate < startDate) {
    throw new Error('내보내기 기간이 올바르지 않습니다.')
  }

  const viewOptions = {
    ...DEFAULT_VIEW_OPTIONS,
    ...(store?.settings?.viewOptions ?? {}),
  }
  const weekStartsOn = viewOptions.weekStartsOnSunday === false ? 1 : 0

  const calendars = store?.calendars ?? []
  const calendarMap = new Map(calendars.map((calendar) => [calendar.id, calendar]))
  const tags = store?.tags ?? []

  const filtered = filterEventsForExport(store?.events ?? [], calendars, options)
  const expanded = filterExpandedEventsForExport(
    expandEventsForRange(filtered, startDate, endDate),
    options,
  )

  /** @type {Map<string, object[]>} */
  const byDay = new Map()
  for (const event of expanded) {
    const eventStart = event.startDate < startDate ? startDate : event.startDate
    const eventEnd = event.endDate > endDate ? endDate : event.endDate
    if (eventEnd < startDate || eventStart > endDate) continue
    let cursor = eventStart
    for (let i = 0; i < 1200 && cursor <= eventEnd; i += 1) {
      const list = byDay.get(cursor) ?? []
      list.push(event)
      byDay.set(cursor, list)
      cursor = addDaysToDateKey(cursor, 1)
    }
  }

  const holidayKeys = collectHolidayDateKeys(store, startDate, endDate, options)

  const dateKeys = listDateKeysInRange(startDate, endDate)
  const rowsAsc = dateKeys.map((dayKey) => {
    const dayEvents = [...(byDay.get(dayKey) ?? [])]
      .sort((a, b) => compareEventsForDayDisplay(a, b, dayKey))
      .map((event) => {
        const color = calendarMap.get(event.calendarId)?.color ?? '#f6bf26'
        const { head, details } = formatDayListExportEventParts(event, dayKey, tags)
        return {
          id: `${event.id}-${dayKey}`,
          // Stored series id — lets viewers look the event back up (links, attachments).
          eventId: getSeriesId(event) ?? event.id,
          calendarId: String(event.calendarId ?? ''),
          line: [head, ...details.map((item) => item.text)].join('\n'),
          /** Title line. */
          head,
          /** 설명 / 링크 / 첨부 lines — viewers render them inside a boxed block. */
          details,
          color,
          completed: Boolean(event.completed),
        }
      })

    return {
      dayKey,
      dateLabel: formatDayListDateLabel(dayKey),
      isHoliday: holidayKeys.has(dayKey),
      events: dayEvents,
      contentText: dayEvents.map((event) => event.line).join('\n'),
    }
  })
  const rows = options.dayListSortDesc ? [...rowsAsc].reverse() : rowsAsc

  const title =
    startDate === endDate
      ? startDate.replace(/-/g, '.')
      : `${startDate.replace(/-/g, '.')} ~ ${endDate.replace(/-/g, '.')}`

  return {
    layout: 'dayList',
    startDate,
    endDate,
    title: `일정 목록 — ${title}`,
    weekStartsOn,
    rows,
  }
}
