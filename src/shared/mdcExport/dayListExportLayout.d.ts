export type DayListExportDetail = {
  text: string
  kind: 'description' | 'link' | 'attachment'
  /** Set when `kind` is `'link'`. */
  url?: string
  /** Set when `kind` is `'attachment'`. */
  attachmentId?: string
}

export type DayListExportEvent = {
  id: string
  /** Stored series id for lookups (links, attachments). */
  eventId: string
  calendarId: string
  /** `head` + `details` joined by newlines. */
  line: string
  /** Title line. */
  head: string
  /** 설명 / 링크 / 첨부 lines, boxed by viewers. */
  details: DayListExportDetail[]
  color: string
  completed: boolean
}

export type DayListExportRow = {
  dayKey: string
  dateLabel: string
  /** Date covered by a 대한민국의 휴일 event — styled like Sunday. */
  isHoliday: boolean
  events: DayListExportEvent[]
  contentText: string
}

export type DayListExportLayout = {
  layout: 'dayList'
  startDate: string
  endDate: string
  title: string
  weekStartsOn: 0 | 1
  rows: DayListExportRow[]
}

export function prepareDayListExportLayout(
  store: unknown,
  range: { startDate: string; endDate: string },
  options?: {
    includeCompleted?: boolean
    includeHolidays?: boolean
    excludeHiddenCalendars?: boolean
    asAdmin?: boolean
    dayListSortDesc?: boolean
  }
): DayListExportLayout
