/** Shared Excel/PDF/HTML export request helpers (native IPC + browser HTTP). */

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * @param {unknown} value
 * @returns {'excel' | 'pdf' | 'html'}
 */
export function normalizeExportFormat(value) {
  if (value === 'pdf' || value === 'html') return value
  return 'excel'
}

/**
 * @param {unknown} format
 * @returns {string}
 */
export function exportFormatLabel(format) {
  if (format === 'pdf') return 'PDF'
  if (format === 'html') return 'HTML'
  return 'Excel'
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
export function isValidExportDateKey(value) {
  if (typeof value !== 'string' || !DATE_KEY_RE.test(value)) return false
  const match = DATE_KEY_RE.exec(value)
  if (!match) return false
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
}

/**
 * @param {Record<string, unknown>} input
 */
export function normalizeExportRequest(input = {}) {
  const format = normalizeExportFormat(input.format)
  const layout = input.layout === 'dayList' ? 'dayList' : 'monthGrid'

  let startDate = typeof input.startDate === 'string' ? input.startDate : ''
  let endDate = typeof input.endDate === 'string' ? input.endDate : ''

  if ((!isValidExportDateKey(startDate) || !isValidExportDateKey(endDate)) && input.year && input.month) {
    const year = Number(input.year)
    const month = Number(input.month)
    if (Number.isFinite(year) && month >= 1 && month <= 12) {
      const last = new Date(year, month, 0).getDate()
      startDate = `${year}-${String(month).padStart(2, '0')}-01`
      endDate = `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`
    }
  }

  if (!isValidExportDateKey(startDate) || !isValidExportDateKey(endDate)) {
    throw new Error('내보내기 기간(startDate/endDate)이 올바르지 않습니다.')
  }
  if (endDate < startDate) {
    const tmp = startDate
    startDate = endDate
    endDate = tmp
  }

  return {
    format,
    layout,
    startDate,
    endDate,
    includeCompleted: input.includeCompleted !== false,
    includeHolidays: input.includeHolidays !== false,
    excludeHiddenCalendars: Boolean(input.excludeHiddenCalendars),
    asAdmin: input.asAdmin !== false
  }
}

/**
 * @param {string} startDate
 * @param {string} endDate
 */
export function formatExportRangeLabel(startDate, endDate) {
  if (startDate === endDate) return startDate.replace(/-/g, '.')
  const [sy, sm] = startDate.split('-')
  const [ey, em, ed] = endDate.split('-')
  if (sy === ey && sm === em && startDate.endsWith('-01')) {
    const last = new Date(Number(ey), Number(em), 0).getDate()
    if (Number(ed) === last) {
      return `${sy}년 ${Number(sm)}월`
    }
  }
  return `${startDate.replace(/-/g, '.')} ~ ${endDate.replace(/-/g, '.')}`
}
