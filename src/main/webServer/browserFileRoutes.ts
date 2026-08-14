import type { IncomingMessage, ServerResponse } from 'node:http'
import { AuthService } from '../auth'
import {
  createBackupZipBuffer,
  restoreBackupZipBuffer
} from '../calendarStore/backupZip'
import type { CalendarStore } from '../calendarStore/CalendarStore'
import { buildCalendarExportBuffer } from '../export/exportService'
import { normalizeExportFormat } from '../../shared/exportCalendarHelpers.js'
import { can, isSuperAdminUser } from '../../shared/members'
import {
  contentTypeOf,
  getMultipartBoundary,
  parseMultipart,
  readRawBody
} from './multipart'

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '')
  const encoded = encodeURIComponent(filename)
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

function sendFile(
  res: ServerResponse,
  file: { buffer: Buffer; contentType: string; filename: string }
): void {
  res.writeHead(200, {
    'Content-Type': file.contentType,
    'Content-Length': file.buffer.length,
    'Content-Disposition': contentDisposition(file.filename),
    'Cache-Control': 'no-store'
  })
  res.end(file.buffer)
}

/**
 * Browser file download/upload routes (ZIP backup + Excel/PDF/HTML export).
 */
export async function tryHandleBrowserFileRequest(options: {
  req: IncomingMessage
  res: ServerResponse
  path: string
  auth: AuthService
  calendarStore: CalendarStore
  onStoreMutated: () => void
}): Promise<boolean> {
  const { req, res, path, auth, calendarStore, onStoreMutated } = options
  const method = (req.method ?? 'GET').toUpperCase()

  const isBackupExport = path === '/api/backup/export' && (method === 'GET' || method === 'POST')
  const isBackupImport = path === '/api/backup/import' && method === 'POST'
  const isCalendarExport = path === '/api/export' && method === 'POST'

  if (!isBackupExport && !isBackupImport && !isCalendarExport) return false

  const token = AuthService.extractToken(
    req.headers.authorization,
    headerValue(req.headers['x-admin-token'])
  )
  const user = auth.getBrowserUser(token)
  if (!user) {
    sendJson(res, 401, { ok: false, error: '로그인이 필요합니다.' })
    return true
  }

  try {
    if (isBackupExport) {
      if (!can(user, 'backupStore')) {
        sendJson(res, 403, { ok: false, error: '권한이 없습니다.' })
        return true
      }
      // Drain body if present (POST with empty JSON).
      if (method === 'POST') await readRawBody(req).catch(() => Buffer.alloc(0))
      const built = createBackupZipBuffer(calendarStore)
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Length': built.buffer.length,
        'Content-Disposition': contentDisposition(built.filename),
        'Cache-Control': 'no-store',
        'X-Attachment-Files': String(built.fileCount),
        'X-Events-With-Attachments': String(built.eventCount)
      })
      res.end(built.buffer)
      return true
    }

    if (isBackupImport) {
      if (!can(user, 'backupStore')) {
        sendJson(res, 403, { ok: false, error: '권한이 없습니다.' })
        return true
      }
      const contentType = contentTypeOf(req)
      const boundary = getMultipartBoundary(contentType)
      let zipBuffer: Buffer | null = null
      if (boundary) {
        const raw = await readRawBody(req)
        const parts = parseMultipart(raw, boundary)
        const part =
          parts.find((p) => p.fieldName === 'file' || p.fieldName === 'files') ?? parts[0]
        zipBuffer = part?.data ?? null
      } else {
        zipBuffer = await readRawBody(req)
      }
      if (!zipBuffer || zipBuffer.length === 0) {
        sendJson(res, 400, { ok: false, error: 'ZIP 파일이 없습니다.' })
        return true
      }
      const result = restoreBackupZipBuffer(calendarStore, zipBuffer, user.loginId)
      onStoreMutated()
      sendJson(res, 200, {
        ok: true,
        cancelled: false,
        attachmentFiles: result.attachmentFiles ?? 0,
        store: calendarStore.getSnapshotForLogin(
          user.loginId,
          'browser',
          isSuperAdminUser(user)
        )
      })
      return true
    }

    if (isCalendarExport) {
      const raw = await readRawBody(req)
      const text = raw.toString('utf8').trim()
      const body = text ? (JSON.parse(text) as Record<string, unknown>) : {}
      const format = normalizeExportFormat(body.format)
      const layout = body.layout === 'dayList' ? 'dayList' : 'monthGrid'
      const startDate = typeof body.startDate === 'string' ? body.startDate : undefined
      const endDate = typeof body.endDate === 'string' ? body.endDate : undefined
      const year = body.year != null ? Number(body.year) : undefined
      const month = body.month != null ? Number(body.month) : undefined
      if (!startDate && !endDate) {
        if (!Number.isFinite(year) || !Number.isFinite(month) || (month ?? 0) < 1 || (month ?? 0) > 12) {
          sendJson(res, 400, { ok: false, error: '내보내기 기간이 올바르지 않습니다.' })
          return true
        }
      }
      const excludeHiddenCalendars = Boolean(body.excludeHiddenCalendars)
      const snap = calendarStore.getSnapshotForLogin(
        user.loginId,
        'browser',
        isSuperAdminUser(user)
      )
      const store = excludeHiddenCalendars
        ? snap
        : {
            ...snap,
            calendars: snap.calendars.map((calendar) => ({ ...calendar, visible: true }))
          }
      const built = await buildCalendarExportBuffer({
        store,
        format,
        layout,
        startDate,
        endDate,
        year,
        month,
        includeCompleted: body.includeCompleted !== false,
        includeHolidays: body.includeHolidays !== false,
        excludeHiddenCalendars,
        asAdmin: isSuperAdminUser(user) && body.asAdmin !== false
      })
      sendFile(res, built)
      return true
    }

    return false
  } catch (err) {
    const message = err instanceof Error ? err.message : '파일 처리에 실패했습니다.'
    sendJson(res, 400, { ok: false, error: message })
    return true
  }
}
