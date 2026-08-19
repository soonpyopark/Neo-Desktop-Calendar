import { mkdir, readdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { writeBackupZip } from './calendarStore/backupZip'
import type { CalendarStore } from './calendarStore/CalendarStore'
import {
  backupSlotKey,
  extractBackupStamp,
  formatBackupDayFolder,
  isStoreBackupDayFolder,
  isStoreBackupFileName,
  normalizeStoreBackup,
  parseStoreBackupPath,
  storeBackupFileName,
  type StoreBackupArchive,
  type StoreBackupRunResult,
  type StoreBackupSettings,
  type StoreBackupStatus
} from '../shared/storeBackup'

const STATE_FILE = 'store-backup-state.json'
const TICK_MS = 30_000

type BackupState = {
  ranSlots: string[]
  last: StoreBackupRunResult | null
}

let storeRef: CalendarStore | null = null
let timer: ReturnType<typeof setInterval> | null = null
let running = false
let lastResult: StoreBackupRunResult | null = null

function requireStore(): CalendarStore {
  if (!storeRef) {
    throw new Error('백업 서비스가 아직 준비되지 않았습니다.')
  }
  return storeRef
}

function normalizeAbs(value: string): string {
  const resolved = resolve(String(value ?? ''))
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function isEqualOrInside(target: string, root: string): boolean {
  const t = normalizeAbs(target)
  const r = normalizeAbs(root)
  if (t === r) return true
  const rel = relative(r, t)
  return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel)
}

export function assertBackupDestAllowed(destPath: string, dataRoot: string): string {
  const dest = resolve(String(destPath ?? '').trim())
  if (!dest) {
    throw new Error('백업 폴더를 지정해 주세요.')
  }
  if (isEqualOrInside(dest, dataRoot)) {
    throw new Error('일정 데이터 폴더 안에는 백업할 수 없습니다. 다른 폴더를 지정해 주세요.')
  }
  return dest
}

function readConfig(): StoreBackupSettings {
  return normalizeStoreBackup(requireStore().getSnapshot().settings.storeBackup)
}

function statePath(): string {
  return join(requireStore().dataRoot, STATE_FILE)
}

async function loadState(): Promise<BackupState> {
  try {
    const raw = JSON.parse(await readFile(statePath(), 'utf8')) as Partial<BackupState>
    return {
      ranSlots: Array.isArray(raw.ranSlots)
        ? raw.ranSlots.filter((item): item is string => typeof item === 'string')
        : [],
      last: raw.last && typeof raw.last === 'object' ? raw.last : null
    }
  } catch {
    return { ranSlots: [], last: null }
  }
}

async function saveState(state: BackupState): Promise<void> {
  await writeFile(statePath(), `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

async function pruneDayBackups(dayDir: string, maxPerDay: number): Promise<void> {
  let names: string[] = []
  try {
    names = await readdir(dayDir)
  } catch {
    return
  }
  const zips = names.filter((name) => isStoreBackupFileName(name))
  const byStamp = new Map<string, string[]>()
  for (const name of zips) {
    const stamp = extractBackupStamp(name)
    if (!stamp) continue
    const list = byStamp.get(stamp) ?? []
    list.push(name)
    byStamp.set(stamp, list)
  }
  const stamps = [...byStamp.keys()].sort()
  const extra = stamps.length - maxPerDay
  if (extra <= 0) return
  for (const stamp of stamps.slice(0, extra)) {
    for (const name of byStamp.get(stamp) ?? []) {
      await rm(join(dayDir, name), { force: true }).catch(() => undefined)
    }
  }
}

async function collectBackupArchives(destDir: string): Promise<Array<{ fileName: string; filePath: string }>> {
  let entries: Array<{ name: string; isDirectory: () => boolean }>
  try {
    entries = await readdir(destDir, { withFileTypes: true })
  } catch {
    return []
  }

  const found: Array<{ fileName: string; filePath: string }> = []
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      if (isStoreBackupFileName(entry.name)) {
        found.push({ fileName: entry.name, filePath: join(destDir, entry.name) })
      }
      continue
    }
    if (!isStoreBackupDayFolder(entry.name)) continue

    let dayNames: string[] = []
    try {
      dayNames = await readdir(join(destDir, entry.name))
    } catch {
      continue
    }
    for (const name of dayNames) {
      if (!isStoreBackupFileName(name)) continue
      found.push({
        fileName: `${entry.name}/${name}`,
        filePath: join(destDir, entry.name, name)
      })
    }
  }
  return found
}

export async function listStoreBackups(): Promise<StoreBackupArchive[]> {
  const settings = readConfig()
  if (!settings.destPath) return []
  const destDir = assertBackupDestAllowed(settings.destPath, requireStore().dataRoot)

  const items: StoreBackupArchive[] = []
  for (const archive of await collectBackupArchives(destDir)) {
    try {
      const info = await stat(archive.filePath)
      if (!info.isFile()) continue
      items.push({
        fileName: archive.fileName,
        filePath: archive.filePath,
        bytes: info.size,
        at: info.mtime.toISOString()
      })
    } catch {
      /* skip unreadable */
    }
  }
  items.sort((left, right) => {
    const stampLeft = extractBackupStamp(left.fileName) ?? ''
    const stampRight = extractBackupStamp(right.fileName) ?? ''
    if (stampLeft !== stampRight) return stampRight.localeCompare(stampLeft)
    return left.fileName.localeCompare(right.fileName, 'ko')
  })
  return items
}

async function removeEmptyDayFolder(dayDir: string): Promise<void> {
  try {
    const names = await readdir(dayDir)
    if (names.length === 0) await rmdir(dayDir)
  } catch {
    /* leave the folder */
  }
}

export async function deleteStoreBackup(fileName: string): Promise<StoreBackupArchive[]> {
  const parsed = parseStoreBackupPath(fileName)
  if (!parsed) {
    throw new Error('백업 파일이 아닙니다.')
  }
  const settings = readConfig()
  if (!settings.destPath) {
    throw new Error('백업 폴더를 먼저 지정해 주세요.')
  }
  const destDir = assertBackupDestAllowed(settings.destPath, requireStore().dataRoot)
  const dayDir = parsed.dayFolder ? join(destDir, parsed.dayFolder) : destDir
  const destZip = join(dayDir, parsed.fileName)
  if (!isEqualOrInside(destZip, destDir)) {
    throw new Error('잘못된 백업 파일입니다.')
  }
  await rm(destZip)
  if (parsed.dayFolder) await removeEmptyDayFolder(dayDir)

  const relativeName = parsed.dayFolder
    ? `${parsed.dayFolder}/${parsed.fileName}`
    : parsed.fileName
  if (lastResult?.fileName === relativeName) {
    lastResult = null
    const state = await loadState()
    state.last = null
    await saveState(state)
  }
  return listStoreBackups()
}

export async function getStoreBackupStatus(): Promise<StoreBackupStatus> {
  const settings = readConfig()
  if (!lastResult) {
    const state = await loadState()
    lastResult = state.last
  }
  return {
    config: settings,
    running,
    last: lastResult,
    archives: await listStoreBackups()
  }
}

export function saveStoreBackupSettings(patch: unknown): StoreBackupSettings {
  const store = requireStore()
  const current = readConfig()
  const next = normalizeStoreBackup({ ...current, ...(patch && typeof patch === 'object' ? patch : {}) })
  if (next.destPath) {
    next.destPath = assertBackupDestAllowed(next.destPath, store.dataRoot)
  }
  store.patchStoreSettings({ storeBackup: next })
  return readConfig()
}

export async function runStoreBackup(trigger: 'manual' | 'auto' = 'manual'): Promise<StoreBackupRunResult> {
  if (running) {
    throw new Error('이미 백업이 진행 중입니다.')
  }

  const store = requireStore()
  const settings = readConfig()
  if (!settings.destPath) {
    throw new Error('백업 폴더를 먼저 지정해 주세요.')
  }
  const destDir = assertBackupDestAllowed(settings.destPath, store.dataRoot)
  await mkdir(destDir, { recursive: true })

  const now = new Date()
  const dayFolder = formatBackupDayFolder(now)
  const dayDir = join(destDir, dayFolder)
  const fileName = storeBackupFileName(now)
  const destZip = join(dayDir, fileName)
  const relativeName = `${dayFolder}/${fileName}`

  running = true
  try {
    await mkdir(dayDir, { recursive: true })
    const written = writeBackupZip(store, destZip)
    const info = await stat(destZip)
    await pruneDayBackups(dayDir, settings.maxPerDay)
    lastResult = {
      at: new Date().toISOString(),
      fileName: relativeName,
      filePath: destZip,
      bytes: info.size,
      attachmentFiles: written.fileCount,
      eventsWithAttachments: written.eventCount,
      trigger
    }
    const state = await loadState()
    state.last = lastResult
    await saveState(state)
    return lastResult
  } catch (error) {
    lastResult = {
      at: new Date().toISOString(),
      fileName: relativeName,
      filePath: destZip,
      bytes: 0,
      trigger,
      error: error instanceof Error ? error.message : String(error)
    }
    const state = await loadState()
    state.last = lastResult
    await saveState(state)
    await rm(destZip, { force: true }).catch(() => undefined)
    throw error
  } finally {
    running = false
  }
}

async function tickAutoBackup(): Promise<void> {
  if (running) return
  const settings = readConfig()
  if (!settings.enabled || !settings.destPath || settings.times.length === 0) return

  const now = new Date()
  const minutesNow = now.getHours() * 60 + now.getMinutes()
  const state = await loadState()
  const todayPrefix = backupSlotKey(now, '').slice(0, 11)
  const ranToday = new Set(state.ranSlots.filter((slot) => slot.startsWith(todayPrefix)))

  const due: Array<{ time: string; key: string }> = []
  for (const time of settings.times) {
    const [hour, minute] = time.split(':').map(Number)
    const slotMinutes = hour * 60 + minute
    if (minutesNow < slotMinutes) continue
    const key = backupSlotKey(now, time)
    if (ranToday.has(key)) continue
    due.push({ time, key })
  }
  const next = due[due.length - 1]
  if (!next) return

  for (const slot of due) ranToday.add(slot.key)
  try {
    await runStoreBackup('auto')
    state.ranSlots = [...ranToday]
    state.last = lastResult
    await saveState(state)
  } catch (error) {
    console.warn('[backup] auto backup failed:', error)
    state.ranSlots = [...ranToday]
    state.last = lastResult
    await saveState(state)
  }
}

export function startStoreBackupScheduler(store: CalendarStore): void {
  storeRef = store
  if (timer) return
  void tickAutoBackup().catch((error) => {
    console.warn('[backup] scheduler tick failed:', error)
  })
  timer = setInterval(() => {
    void tickAutoBackup().catch((error) => {
      console.warn('[backup] scheduler tick failed:', error)
    })
  }, TICK_MS)
  if (typeof timer.unref === 'function') timer.unref()
}
