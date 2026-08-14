/** Shared Excel/PDF/HTML export request contract (native IPC + browser HTTP). */

export type ExportCalendarFormat = 'excel' | 'pdf' | 'html'

export type ExportCalendarLayout = 'monthGrid' | 'dayList'

export type ExportRangePreset = 'thisMonth' | 'thisWeek' | 'thisYear' | 'custom'

export type ExportCalendarRequest = {
  format: ExportCalendarFormat
  layout: ExportCalendarLayout
  /** Inclusive YYYY-MM-DD */
  startDate: string
  /** Inclusive YYYY-MM-DD */
  endDate: string
  /** Default true (current behavior). */
  includeCompleted?: boolean
  /** Default true (current behavior). */
  includeHolidays?: boolean
  /** Default false for API back-compat; UI defaults to true. */
  excludeHiddenCalendars?: boolean
  /**
   * Day-list date order. Default false (1일 → 말일) for back-compat.
   * Ignored for month-grid.
   */
  dayListSortDesc?: boolean
  /**
   * Legacy published/admin gate used by filterEventsForViewer.
   * Prefer excludeHiddenCalendars for eye-toggle calendars.
   */
  asAdmin?: boolean
}

export type ExportCalendarResult = {
  ok: boolean
  canceled?: boolean
  path?: string
  error?: string
}

export {
  exportFormatLabel,
  formatExportRangeLabel,
  isValidExportDateKey,
  normalizeExportFormat,
  normalizeExportRequest
} from './exportCalendarHelpers.js'
