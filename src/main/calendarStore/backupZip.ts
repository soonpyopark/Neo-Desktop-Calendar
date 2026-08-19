import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { dialog, type BrowserWindow } from 'electron'
import { withNativeDialog } from '../nativeDialogGuard'
import { createZipFromDirectory, extractZipToDirectory } from '../sevenZip'
import type { CalendarStore } from './CalendarStore'
import type { CalendarStoreSnapshot } from '../../shared/calendarTypes'

export type BackupZipResult = {
  ok: boolean
  cancelled?: boolean
  path?: string
  attachmentFiles?: number
  eventsWithAttachments?: number
  store?: CalendarStoreSnapshot
}

function stampForZip(): string {
  const d = new Date()
  const yy = String(d.getFullYear()).slice(-2)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${yy}${mm}${dd}_${hh}${mi}${ss}`
}

function trySanitizeId(id: string): string | null {
  const safeId = String(id ?? '').trim()
  if (!safeId) return null
  if (/[<>:"/\\|?*\x00-\x1f]/.test(safeId)) return null
  if (safeId.includes('..')) return null
  return safeId
}

function tryDeleteDir(path: string): void {
  try {
    if (existsSync(path)) rmSync(path, { recursive: true, force: true })
  } catch (error) {
    console.warn('[backup] temp cleanup failed', error)
  }
}

function findStoreJson(extractDir: string): string | null {
  const root = join(extractDir, 'store.json')
  if (existsSync(root)) return root
  for (const name of readdirSync(extractDir)) {
    const nested = join(extractDir, name, 'store.json')
    if (existsSync(nested) && statSync(join(extractDir, name)).isDirectory()) {
      return nested
    }
  }
  return null
}

function extractZipSafe(zipPath: string, destDir: string): void {
  extractZipToDirectory(zipPath, destDir)
}

function replaceAttachmentsFrom(
  attachmentsRoot: string,
  sourceAttachmentsDir: string
): number {
  tryDeleteDir(attachmentsRoot)
  mkdirSync(attachmentsRoot, { recursive: true })
  if (!existsSync(sourceAttachmentsDir)) return 0

  let fileCount = 0
  for (const eventId of readdirSync(sourceAttachmentsDir)) {
    const eventDir = join(sourceAttachmentsDir, eventId)
    if (!statSync(eventDir).isDirectory()) continue
    const safeId = trySanitizeId(eventId)
    if (!safeId) continue
    const destDir = join(attachmentsRoot, safeId)
    mkdirSync(destDir, { recursive: true })
    for (const name of readdirSync(eventDir)) {
      const source = join(eventDir, name)
      if (!statSync(source).isFile()) continue
      if (/[<>:"/\\|?*\x00-\x1f]/.test(name)) continue
      copyFileSync(source, join(destDir, name))
      fileCount += 1
    }
  }
  return fileCount
}

function stageBackupZip(store: CalendarStore): {
  staging: string
  fileCount: number
  eventCount: number
} {
  const staging = mkdtempSync(join(tmpdir(), 'neo-backup-'))
  const snapshot = store.getSnapshot()
  writeFileSync(join(staging, 'store.json'), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')

  const attachStaging = join(staging, 'attachments')
  mkdirSync(attachStaging, { recursive: true })
  const attachmentsRoot = join(store.dataRoot, 'attachments')

  let fileCount = 0
  let eventCount = 0
  for (const evt of snapshot.events) {
    const safeId = trySanitizeId(evt.id)
    if (!safeId) continue
    const attachments = evt.attachments ?? []
    if (attachments.length === 0) continue

    let copiedForEvent = 0
    const eventDir = join(attachStaging, safeId)
    for (const att of attachments) {
      const fileName = basename(String(att.storedName ?? ''))
      if (!fileName) continue
      const source = join(attachmentsRoot, safeId, fileName)
      if (!existsSync(source)) continue
      mkdirSync(eventDir, { recursive: true })
      copyFileSync(source, join(eventDir, fileName))
      fileCount += 1
      copiedForEvent += 1
    }
    if (copiedForEvent > 0) eventCount += 1
  }
  return { staging, fileCount, eventCount }
}

export function writeBackupZip(store: CalendarStore, zipPath: string): { fileCount: number; eventCount: number } {
  const { staging, fileCount, eventCount } = stageBackupZip(store)
  try {
    createZipFromDirectory(staging, zipPath)
    return { fileCount, eventCount }
  } finally {
    tryDeleteDir(staging)
  }
}

/** Browser / HTTP: build ZIP bytes without a Save dialog. */
export function createBackupZipBuffer(store: CalendarStore): {
  buffer: Buffer
  fileCount: number
  eventCount: number
  filename: string
} {
  const { staging, fileCount, eventCount } = stageBackupZip(store)
  const stamp = stampForZip()
  const zipPath = join(tmpdir(), `neo-backup-buf-${stamp}.zip`)
  try {
    createZipFromDirectory(staging, zipPath)
    return {
      buffer: readFileSync(zipPath),
      fileCount,
      eventCount,
      filename: `my-calendar-backup-${stamp}.zip`
    }
  } finally {
    tryDeleteDir(staging)
    try {
      if (existsSync(zipPath)) unlinkSync(zipPath)
    } catch {
      /* ignore */
    }
  }
}

function restoreFromExtractedDir(
  store: CalendarStore,
  extractDir: string,
  importerLoginId?: string | null
): BackupZipResult {
  const storePath = findStoreJson(extractDir)
  if (!storePath) {
    throw new Error('ZIP에 store.json이 없습니다. 이 앱의 백업 ZIP인지 확인해 주세요.')
  }

  let payload: unknown
  try {
    payload = JSON.parse(readFileSync(storePath, 'utf8'))
  } catch (error) {
    throw new Error(
      `store.json을 읽지 못했습니다: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  const imported = store.importStore(payload, importerLoginId)
  const zipAttachments = join(dirname(storePath), 'attachments')
  const fileCount = replaceAttachmentsFrom(join(store.dataRoot, 'attachments'), zipAttachments)

  return {
    ok: true,
    cancelled: false,
    attachmentFiles: fileCount,
    store: imported
  }
}

/** Browser / HTTP: restore from uploaded ZIP bytes. */
export function restoreBackupZipBuffer(
  store: CalendarStore,
  zipBuffer: Buffer,
  importerLoginId?: string | null
): BackupZipResult {
  const extractDir = mkdtempSync(join(tmpdir(), 'neo-restore-'))
  try {
    const zipPath = join(extractDir, 'upload.zip')
    writeFileSync(zipPath, zipBuffer)
    const unpackDir = join(extractDir, 'unpacked')
    mkdirSync(unpackDir, { recursive: true })
    extractZipSafe(zipPath, unpackDir)
    return restoreFromExtractedDir(store, unpackDir, importerLoginId)
  } finally {
    tryDeleteDir(extractDir)
  }
}

export async function exportBackupZip(
  store: CalendarStore,
  ownerWindow?: BrowserWindow | null
): Promise<BackupZipResult> {
  const stamp = stampForZip()
  const saveOpts: Electron.SaveDialogOptions = {
    title: '일정 + 첨부 백업 저장',
    defaultPath: `my-calendar-backup-${stamp}.zip`,
    filters: [{ name: 'ZIP 백업', extensions: ['zip'] }]
  }
  const result = await withNativeDialog(async () =>
    ownerWindow && !ownerWindow.isDestroyed()
      ? dialog.showSaveDialog(ownerWindow, saveOpts)
      : dialog.showSaveDialog(saveOpts)
  )
  if (result.canceled || !result.filePath) {
    return { ok: true, cancelled: true }
  }

  const { fileCount, eventCount } = writeBackupZip(store, result.filePath)
  return {
    ok: true,
    cancelled: false,
    path: result.filePath,
    attachmentFiles: fileCount,
    eventsWithAttachments: eventCount
  }
}

/** Restore a full-store ZIP already chosen by the unified import picker. */
export function importBackupZipFromPath(
  store: CalendarStore,
  zipPath: string,
  importerLoginId?: string | null
): BackupZipResult {
  const extractDir = mkdtempSync(join(tmpdir(), 'neo-restore-'))
  try {
    extractZipSafe(zipPath, extractDir)
    const restored = restoreFromExtractedDir(store, extractDir, importerLoginId)
    return { ...restored, path: zipPath }
  } finally {
    tryDeleteDir(extractDir)
  }
}

export async function importBackupZip(
  store: CalendarStore,
  ownerWindow?: BrowserWindow | null,
  importerLoginId?: string | null
): Promise<BackupZipResult> {
  const openOpts: Electron.OpenDialogOptions = {
    title: '일정 + 첨부 백업 가져오기',
    filters: [{ name: 'ZIP 백업', extensions: ['zip'] }],
    properties: ['openFile']
  }
  const result = await withNativeDialog(async () =>
    ownerWindow && !ownerWindow.isDestroyed()
      ? dialog.showOpenDialog(ownerWindow, openOpts)
      : dialog.showOpenDialog(openOpts)
  )
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: true, cancelled: true }
  }

  return importBackupZipFromPath(store, result.filePaths[0], importerLoginId)
}

function findCalendarExportJson(extractDir: string): string | null {
  const preferred = ['calendar.json', 'export.json']
  for (const name of preferred) {
    const path = join(extractDir, name)
    if (existsSync(path) && statSync(path).isFile()) return path
  }
  for (const name of readdirSync(extractDir)) {
    if (!name.toLowerCase().endsWith('.json')) continue
    if (name === 'store.json') continue
    const path = join(extractDir, name)
    if (statSync(path).isFile()) return path
  }
  return null
}

function readEventsFromCalendarZip(extractDir: string): unknown[] {
  const calendarJson = findCalendarExportJson(extractDir)
  if (calendarJson) {
    const payload = JSON.parse(readFileSync(calendarJson, 'utf8')) as {
      events?: unknown[]
    }
    if (Array.isArray(payload?.events)) return payload.events
    if (Array.isArray(payload)) return payload
  }
  const storePath = findStoreJson(extractDir)
  if (storePath) {
    const payload = JSON.parse(readFileSync(storePath, 'utf8')) as {
      events?: unknown[]
    }
    if (Array.isArray(payload?.events)) return payload.events
  }
  throw new Error('ZIP에서 가져올 일정 데이터를 찾지 못했습니다.')
}

function restoreAttachmentsForIdMap(
  store: CalendarStore,
  extractDir: string,
  idMap: Array<{ sourceId: string; newId: string }>
): number {
  const zipAttachments = join(extractDir, 'attachments')
  if (!existsSync(zipAttachments)) return 0
  const attachmentsRoot = join(store.dataRoot, 'attachments')
  let fileCount = 0
  for (const { sourceId, newId } of idMap) {
    const safeSource = trySanitizeId(sourceId)
    const safeNew = trySanitizeId(newId)
    if (!safeSource || !safeNew) continue
    const sourceDir = join(zipAttachments, safeSource)
    if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) continue
    const destDir = join(attachmentsRoot, safeNew)
    mkdirSync(destDir, { recursive: true })
    for (const name of readdirSync(sourceDir)) {
      const source = join(sourceDir, name)
      if (!statSync(source).isFile()) continue
      if (/[<>:"/\\|?*\x00-\x1f]/.test(name)) continue
      copyFileSync(source, join(destDir, name))
      fileCount += 1
    }
  }
  return fileCount
}

/** Single-calendar ZIP: calendar JSON + that calendar's attachment files. */
export async function exportCalendarZip(
  store: CalendarStore,
  calendarId: string,
  ownerWindow?: BrowserWindow | null
): Promise<BackupZipResult> {
  const snap = store.getSnapshot()
  const calendar = snap.calendars.find((c) => c.id === calendarId)
  if (!calendar) throw new Error('캘린더를 찾을 수 없습니다.')
  const events = snap.events.filter((e) => e.calendarId === calendarId)
  const safeName = String(calendar.name ?? 'calendar').replace(/[\\/:*?"<>|]/g, '_')
  const stamp = stampForZip()

  const saveOpts: Electron.SaveDialogOptions = {
    title: '캘린더 ZIP 내보내기',
    defaultPath: `${safeName}-export-${stamp}.zip`,
    filters: [{ name: 'ZIP', extensions: ['zip'] }]
  }
  const result = await withNativeDialog(async () =>
    ownerWindow && !ownerWindow.isDestroyed()
      ? dialog.showSaveDialog(ownerWindow, saveOpts)
      : dialog.showSaveDialog(saveOpts)
  )
  if (result.canceled || !result.filePath) {
    return { ok: true, cancelled: true }
  }

  const staging = mkdtempSync(join(tmpdir(), 'neo-cal-export-'))
  try {
    writeFileSync(
      join(staging, 'calendar.json'),
      `${JSON.stringify({ calendar, events }, null, 2)}\n`,
      'utf8'
    )
    const attachStaging = join(staging, 'attachments')
    mkdirSync(attachStaging, { recursive: true })
    const attachmentsRoot = join(store.dataRoot, 'attachments')
    let fileCount = 0
    let eventCount = 0
    for (const evt of events) {
      const safeId = trySanitizeId(evt.id)
      if (!safeId) continue
      const attachments = evt.attachments ?? []
      if (attachments.length === 0) continue
      let copiedForEvent = 0
      const eventDir = join(attachStaging, safeId)
      for (const att of attachments) {
        const fileName = basename(String(att.storedName ?? ''))
        if (!fileName) continue
        const source = join(attachmentsRoot, safeId, fileName)
        if (!existsSync(source)) continue
        mkdirSync(eventDir, { recursive: true })
        copyFileSync(source, join(eventDir, fileName))
        fileCount += 1
        copiedForEvent += 1
      }
      if (copiedForEvent > 0) eventCount += 1
    }
    createZipFromDirectory(staging, result.filePath)
    return {
      ok: true,
      cancelled: false,
      path: result.filePath,
      attachmentFiles: fileCount,
      eventsWithAttachments: eventCount
    }
  } finally {
    tryDeleteDir(staging)
  }
}

/** Import a calendar/backup ZIP into one existing calendar (events merge + attachments). */
export function importCalendarZipFromPath(
  store: CalendarStore,
  calendarId: string,
  zipPath: string,
  importerLoginId?: string | null
): BackupZipResult & { importedCount?: number } {
  const extractDir = mkdtempSync(join(tmpdir(), 'neo-cal-import-'))
  try {
    extractZipSafe(zipPath, extractDir)
    const events = readEventsFromCalendarZip(extractDir)
    const imported = store.importEventsIntoCalendar(calendarId, events, importerLoginId)
    const fileCount = restoreAttachmentsForIdMap(store, extractDir, imported.idMap)
    return {
      ok: true,
      cancelled: false,
      path: zipPath,
      attachmentFiles: fileCount,
      importedCount: imported.importedCount
    }
  } finally {
    tryDeleteDir(extractDir)
  }
}
