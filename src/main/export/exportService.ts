import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import { withNativeDialog } from '../nativeDialogGuard'
import type { CalendarStoreSnapshot } from '../../shared/calendarTypes'
import {
  exportFormatLabel,
  formatExportRangeLabel,
  normalizeExportRequest
} from '../../shared/exportCalendarHelpers.js'
import type {
  ExportCalendarFormat,
  ExportCalendarLayout,
  ExportCalendarRequest,
  ExportCalendarResult
} from '../../shared/exportCalendar'
import { resolveDataRoot } from '../calendarStore/paths'
import {
  buildExcelBuffer,
  buildHtmlBuffer,
  buildPdfBuffer,
  getExcelExportFileName,
  getHtmlExportFileName,
  getPdfExportFileName
} from './calendarExport.mjs'

export type { ExportCalendarFormat, ExportCalendarLayout, ExportCalendarRequest, ExportCalendarResult }

export type ExportCalendarInput = Partial<ExportCalendarRequest> & {
  store: CalendarStoreSnapshot
  format: ExportCalendarFormat
  /** Legacy month export. */
  year?: number
  month?: number
}

export async function buildCalendarExportBuffer(input: ExportCalendarInput): Promise<{
  buffer: Buffer
  filename: string
  contentType: string
  rangeLabel: string
  formatLabel: string
  layoutLabel: string
}> {
  const request = normalizeExportRequest(input) as ExportCalendarRequest
  const period = {
    layout: request.layout,
    startDate: request.startDate,
    endDate: request.endDate
  } as const
  const options = {
    asAdmin: request.asAdmin !== false,
    includeCompleted: request.includeCompleted !== false,
    includeHolidays: request.includeHolidays !== false,
    excludeHiddenCalendars: Boolean(request.excludeHiddenCalendars)
  }
  const format = request.format
  const buffer = Buffer.from(
    format === 'excel'
      ? await buildExcelBuffer(input.store, period, options)
      : format === 'html'
        ? await buildHtmlBuffer(input.store, period, {
            ...options,
            attachmentsRoot: join(resolveDataRoot(), 'attachments')
          })
        : await buildPdfBuffer(input.store, period, {
            ...options,
            attachmentsRoot: join(resolveDataRoot(), 'attachments')
          })
  )
  const filename =
    format === 'excel'
      ? getExcelExportFileName(period)
      : format === 'html'
        ? getHtmlExportFileName(period)
        : getPdfExportFileName(period)
  const contentType =
    format === 'excel'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : format === 'html'
        ? 'text/html; charset=utf-8'
        : 'application/pdf'
  return {
    buffer,
    filename,
    contentType,
    rangeLabel: formatExportRangeLabel(request.startDate, request.endDate),
    formatLabel: exportFormatLabel(format),
    layoutLabel: request.layout === 'dayList' ? '일간 목록' : '월간 달력'
  }
}

export async function exportCalendarMonth(
  input: ExportCalendarInput,
  parent: BrowserWindow | null
): Promise<ExportCalendarResult> {
  try {
    const built = await buildCalendarExportBuffer(input)
    const dialogOpts = {
      title: `${built.formatLabel}로 내보내기`,
      defaultPath: built.filename,
      filters:
        built.formatLabel === 'Excel'
          ? [{ name: 'Excel', extensions: ['xlsx'] }]
          : built.formatLabel === 'HTML'
            ? [{ name: 'HTML', extensions: ['html'] }]
            : [{ name: 'PDF', extensions: ['pdf'] }]
    }
    const result = await withNativeDialog(async () =>
      parent ? dialog.showSaveDialog(parent, dialogOpts) : dialog.showSaveDialog(dialogOpts)
    )

    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true }
    }

    writeFileSync(result.filePath, built.buffer)
    return { ok: true, path: result.filePath }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  }
}

/** Alias used by newer call sites. */
export const exportCalendar = exportCalendarMonth
