export function isValidExportDateKey(value: unknown): value is string

export function normalizeExportFormat(value: unknown): 'excel' | 'pdf' | 'html'

export function exportFormatLabel(format: unknown): string

export function normalizeExportRequest(input?: Record<string, unknown>): {
  format: 'excel' | 'pdf' | 'html'
  layout: 'monthGrid' | 'dayList'
  startDate: string
  endDate: string
  includeCompleted: boolean
  includeHolidays: boolean
  excludeHiddenCalendars: boolean
  asAdmin: boolean
}

export function formatExportRangeLabel(startDate: string, endDate: string): string
