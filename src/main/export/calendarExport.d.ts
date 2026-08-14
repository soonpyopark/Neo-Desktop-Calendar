declare module './calendarExport.mjs' {
  type ExportPeriod = {
    scope?: 'month' | 'year'
    year?: number
    month?: number
    layout?: 'monthGrid' | 'dayList'
    startDate?: string
    endDate?: string
  }

  type ExportOptions = {
    asAdmin?: boolean
    includeCompleted?: boolean
    includeHolidays?: boolean
    excludeHiddenCalendars?: boolean
    /** Absolute path to data/attachments — required for day-list PDF image embeds. */
    attachmentsRoot?: string
  }

  export function buildExcelBuffer(
    store: unknown,
    period: ExportPeriod,
    options?: ExportOptions
  ): Promise<Uint8Array | ArrayBuffer>

  export function buildPdfBuffer(
    store: unknown,
    period: ExportPeriod,
    options?: ExportOptions
  ): Promise<Uint8Array | ArrayBuffer>

  export function getExcelExportFileName(period: ExportPeriod): string

  export function getPdfExportFileName(period: ExportPeriod): string

  export function buildHtmlBuffer(
    store: unknown,
    period: ExportPeriod,
    options?: ExportOptions
  ): Promise<Uint8Array | ArrayBuffer>

  export function getHtmlExportFileName(period: ExportPeriod): string
}
