import { randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { basename, extname, join } from 'node:path'
import { shell } from 'electron'
import { toNfc } from '../../shared/unicodeText.js'
import { isImageAttachment } from '../../shared/attachmentKinds'
import { HOLIDAYS_KR_CALENDAR_ID } from '../../shared/calendarDefaults'
import type { CalendarEvent, EventAttachment } from '../../shared/calendarTypes'
import type { AttachmentImageResult } from '../../shared/ipc'
import type { CalendarStore } from './CalendarStore'

export const MAX_ATTACHMENTS_PER_EVENT = 10
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

const BLOCKED_EXTENSIONS = new Set([
  '.exe',
  '.bat',
  '.cmd',
  '.com',
  '.msi',
  '.scr',
  '.ps1',
  '.vbs',
  '.js',
  '.jse',
  '.wsf',
  '.wsh',
  '.reg',
  '.dll',
  '.sys'
])

function sanitizeId(id: string): string {
  const trimmed = String(id ?? '').trim()
  if (!trimmed || /[<>:"/\\|?*\x00-\x1f]/.test(trimmed) || trimmed.includes('..')) {
    throw new Error('잘못된 일정 ID입니다.')
  }
  return trimmed
}

function guessMime(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.pdf':
      return 'application/pdf'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.txt':
      return 'text/plain'
    case '.md':
      return 'text/markdown'
    case '.csv':
      return 'text/csv'
    case '.json':
      return 'application/json'
    case '.doc':
    case '.docx':
      return 'application/msword'
    case '.xls':
    case '.xlsx':
      return 'application/vnd.ms-excel'
    case '.ppt':
    case '.pptx':
      return 'application/vnd.ms-powerpoint'
    case '.zip':
      return 'application/zip'
    default:
      return 'application/octet-stream'
  }
}

/**
 * MDC EventAttachmentService — files under data/attachments/{eventId}/.
 */
export class EventAttachmentService {
  private readonly store: CalendarStore
  private readonly attachmentsRoot: string

  constructor(store: CalendarStore) {
    this.store = store
    this.attachmentsRoot = join(store.dataRoot, 'attachments')
    mkdirSync(this.attachmentsRoot, { recursive: true })
  }

  eventDir(eventId: string): string {
    return join(this.attachmentsRoot, sanitizeId(eventId))
  }

  addFromPaths(eventId: string, sourcePaths: string[]): CalendarEvent {
    const current = this.requireEditableEvent(eventId)
    const attachments = [...(current.attachments ?? [])]
    if (attachments.length >= MAX_ATTACHMENTS_PER_EVENT) {
      throw new Error(`첨부 파일은 일정당 최대 ${MAX_ATTACHMENTS_PER_EVENT}개까지 가능합니다.`)
    }

    const dir = this.eventDir(eventId)
    mkdirSync(dir, { recursive: true })
    const remaining = MAX_ATTACHMENTS_PER_EVENT - attachments.length
    for (const sourcePath of sourcePaths.slice(0, remaining)) {
      this.addOneFile(attachments, dir, sourcePath)
    }
    return this.store.editEvent(eventId, { attachments })
  }

  /** Browser / HTTP multipart uploads (buffers already in memory). */
  addFromBuffers(
    eventId: string,
    uploads: Array<{ name: string; data: Buffer; mime?: string }>
  ): CalendarEvent {
    const current = this.requireEditableEvent(eventId)
    const attachments = [...(current.attachments ?? [])]
    if (attachments.length >= MAX_ATTACHMENTS_PER_EVENT) {
      throw new Error(`첨부 파일은 일정당 최대 ${MAX_ATTACHMENTS_PER_EVENT}개까지 가능합니다.`)
    }

    const dir = this.eventDir(eventId)
    mkdirSync(dir, { recursive: true })
    const remaining = MAX_ATTACHMENTS_PER_EVENT - attachments.length
    for (const upload of uploads.slice(0, remaining)) {
      this.addOneBuffer(attachments, dir, upload)
    }
    return this.store.editEvent(eventId, { attachments })
  }

  resolveFilePath(
    eventId: string,
    attachmentId: string
  ): { path: string; meta: EventAttachment } {
    const current = this.requireEditableEvent(eventId)
    const meta = (current.attachments ?? []).find((item) => item.id === attachmentId)
    if (!meta) throw new Error('첨부 파일을 찾을 수 없습니다.')
    if (!meta.storedName?.trim()) throw new Error('첨부 파일 경로가 올바르지 않습니다.')
    const path = join(this.eventDir(eventId), basename(meta.storedName))
    if (!existsSync(path)) throw new Error('첨부 파일이 디스크에서 찾을 수 없습니다.')
    return { path, meta }
  }

  remove(eventId: string, attachmentId: string): CalendarEvent {
    const current = this.requireEditableEvent(eventId)
    const attachments = [...(current.attachments ?? [])]
    const index = attachments.findIndex((item) => item.id === attachmentId)
    if (index < 0) throw new Error('첨부 파일을 찾을 수 없습니다.')
    const removed = attachments[index]
    attachments.splice(index, 1)
    this.tryDeleteStoredFile(eventId, removed)
    const updated = this.store.editEvent(eventId, { attachments })
    this.tryDeleteEmptyEventDir(eventId)
    return updated
  }

  async open(eventId: string, attachmentId: string): Promise<void> {
    const { path } = this.resolveFilePath(eventId, attachmentId)
    const result = await shell.openPath(path)
    if (result) throw new Error(result)
  }

  /**
   * Image bytes as a `data:` URL for the in-app viewer, plus the event's other
   * images so the viewer can page through them without another round-trip.
   */
  readImage(eventId: string, attachmentId: string): AttachmentImageResult {
    const { path, meta } = this.resolveFilePath(eventId, attachmentId)
    if (!isImageAttachment(meta)) return { ok: false, reason: 'not-image' }
    const bytes = readFileSync(path)
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) return { ok: false, reason: 'too-large' }

    const mime = meta.mime && meta.mime.startsWith('image/') ? meta.mime : guessMime(extname(path))
    const current = this.requireEditableEvent(eventId)
    return {
      ok: true,
      dataUrl: `data:${mime};base64,${bytes.toString('base64')}`,
      name: meta.name || basename(path),
      mime,
      images: (current.attachments ?? [])
        .filter((item) => isImageAttachment(item))
        .map((item) => ({ id: item.id, name: item.name }))
    }
  }

  deleteAllForEvent(eventId: string): void {
    if (!eventId?.trim()) return
    try {
      const dir = this.eventDir(eventId)
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    } catch (error) {
      console.warn('[attachments] delete folder failed', eventId, error)
    }
  }

  /**
   * Deep-copy attachment files from one event folder into another (new ids / storedNames).
   * Used when duplicating an event onto another date.
   */
  copyBetweenEvents(sourceEventId: string, targetEventId: string): CalendarEvent {
    const sourceId = sanitizeId(sourceEventId)
    const targetId = sanitizeId(targetEventId)
    if (sourceId === targetId) {
      return this.requireEditableEvent(targetId)
    }
    const source = this.requireEditableEvent(sourceId)
    const target = this.requireEditableEvent(targetId)
    const sourceAttachments = Array.isArray(source.attachments) ? source.attachments : []
    if (sourceAttachments.length === 0) return target

    const dir = this.eventDir(targetId)
    mkdirSync(dir, { recursive: true })
    const next = [...(target.attachments ?? [])]
    const sourceDir = this.eventDir(sourceId)

    for (const meta of sourceAttachments) {
      if (next.length >= MAX_ATTACHMENTS_PER_EVENT) break
      if (!meta?.storedName?.trim()) continue
      const srcPath = join(sourceDir, basename(meta.storedName))
      if (!existsSync(srcPath) || !statSync(srcPath).isFile()) continue
      const ext = extname(meta.storedName || meta.name || '')
      const id = randomUUID().replace(/-/g, '')
      const storedName = `${id}${ext ? ext.toLowerCase() : ''}`
      copyFileSync(srcPath, join(dir, storedName))
      next.push({
        id,
        name: meta.name || 'file',
        storedName,
        mime: meta.mime || guessMime(ext),
        size: typeof meta.size === 'number' ? meta.size : statSync(srcPath).size,
        addedAt: new Date().toISOString()
      })
    }

    if (next.length === (target.attachments ?? []).length) return target
    return this.store.editEvent(targetId, { attachments: next })
  }

  private addOneFile(attachments: EventAttachment[], dir: string, sourcePath: string): void {
    if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) return
    const originalName = toNfc(basename(sourcePath))
    const size = statSync(sourcePath).size
    const ext = extname(originalName)
    this.assertUploadAllowed(originalName, ext, size)

    const id = randomUUID().replace(/-/g, '')
    const storedName = `${id}${ext ? ext.toLowerCase() : ''}`
    const dest = join(dir, storedName)
    copyFileSync(sourcePath, dest)

    attachments.push({
      id,
      name: originalName,
      storedName,
      mime: guessMime(ext),
      size,
      addedAt: new Date().toISOString()
    })
  }

  private addOneBuffer(
    attachments: EventAttachment[],
    dir: string,
    upload: { name: string; data: Buffer; mime?: string }
  ): void {
    const originalName = toNfc(basename(String(upload.name ?? '').trim() || 'file'))
    const ext = extname(originalName)
    const size = upload.data?.length ?? 0
    this.assertUploadAllowed(originalName, ext, size)

    const id = randomUUID().replace(/-/g, '')
    const storedName = `${id}${ext ? ext.toLowerCase() : ''}`
    const dest = join(dir, storedName)
    writeFileSync(dest, upload.data)

    attachments.push({
      id,
      name: originalName,
      storedName,
      mime: upload.mime?.trim() || guessMime(ext),
      size,
      addedAt: new Date().toISOString()
    })
  }

  private assertUploadAllowed(originalName: string, ext: string, size: number): void {
    if (BLOCKED_EXTENSIONS.has(ext.toLowerCase())) {
      throw new Error(`보안상 첨부할 수 없는 파일 형식입니다: ${ext}`)
    }
    if (size <= 0) {
      throw new Error(`빈 파일은 첨부할 수 없습니다: ${originalName}`)
    }
    if (size > MAX_ATTACHMENT_BYTES) {
      throw new Error(
        `파일 크기는 ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB 이하여야 합니다: ${originalName}`
      )
    }
  }

  private requireEditableEvent(eventId: string): CalendarEvent {
    const found = this.store.getSnapshot().events.find((item) => item.id === eventId)
    if (!found) throw new Error('일정을 찾을 수 없습니다.')
    if (found.calendarId === HOLIDAYS_KR_CALENDAR_ID) {
      throw new Error('대한민국의 휴일 일정에는 파일을 첨부할 수 없습니다.')
    }
    return found
  }

  private tryDeleteStoredFile(eventId: string, meta: EventAttachment): void {
    try {
      if (!meta.storedName) return
      const path = join(this.eventDir(eventId), basename(meta.storedName))
      if (existsSync(path)) unlinkSync(path)
    } catch (error) {
      console.warn('[attachments] file delete failed', error)
    }
  }

  private tryDeleteEmptyEventDir(eventId: string): void {
    try {
      const dir = this.eventDir(eventId)
      if (existsSync(dir) && readdirSync(dir).length === 0) {
        rmSync(dir, { recursive: true, force: true })
      }
    } catch {
      /* ignore */
    }
  }
}
