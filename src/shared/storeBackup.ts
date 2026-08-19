export const STORE_BACKUP_FILE_PREFIX = 'Neo_Desktop_Calendar_백업_'

export type StoreBackupSettings = {
  enabled: boolean
  destPath: string | null
  times: string[]
  maxPerDay: number
}

export type StoreBackupRunResult = {
  at: string
  fileName: string
  filePath: string
  bytes: number
  attachmentFiles?: number
  eventsWithAttachments?: number
  trigger: 'manual' | 'auto'
  error?: string
}

export type StoreBackupArchive = {
  fileName: string
  filePath: string
  bytes: number
  at: string
}

export type StoreBackupStatus = {
  config: StoreBackupSettings
  running: boolean
  last: StoreBackupRunResult | null
  archives: StoreBackupArchive[]
}

export const DEFAULT_STORE_BACKUP: StoreBackupSettings = {
  enabled: false,
  destPath: null,
  times: ['09:00'],
  maxPerDay: 2
}

export function normalizeBackupDestPath(value: unknown): string | null {
  if (value == null) return null
  const trimmed = String(value).trim()
  return trimmed || null
}

export function normalizeBackupTime(value: unknown): string | null {
  const raw = String(value ?? '').trim()
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function normalizeBackupTimes(value: unknown): string[] {
  const list = Array.isArray(value) ? value : []
  const unique = new Set<string>()
  for (const item of list) {
    const time = normalizeBackupTime(item)
    if (time) unique.add(time)
  }
  return Array.from(unique).sort()
}

export function normalizeBackupMaxPerDay(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_STORE_BACKUP.maxPerDay
  return Math.min(24, Math.max(1, Math.round(parsed)))
}

export function normalizeStoreBackup(value: unknown): StoreBackupSettings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    enabled: raw.enabled === true,
    destPath: normalizeBackupDestPath(raw.destPath),
    times: normalizeBackupTimes(raw.times ?? DEFAULT_STORE_BACKUP.times),
    maxPerDay: normalizeBackupMaxPerDay(raw.maxPerDay)
  }
}

export function formatBackupStamp(date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const yy = String(date.getFullYear()).slice(-2)
  return `${yy}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

export function formatBackupDayFolder(date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
}

export function isStoreBackupDayFolder(name: string): boolean {
  return /^\d{8}$/.test(String(name ?? ''))
}

export function extractBackupStamp(name: string): string | null {
  const base = String(name ?? '').split(/[/\\]/).pop() ?? ''
  const match = /_(\d{6}_\d{6})\.zip$/i.exec(base)
  return match ? match[1] : null
}

export function storeBackupFileName(date = new Date()): string {
  return `${STORE_BACKUP_FILE_PREFIX}${formatBackupStamp(date)}.zip`
}

export function isStoreBackupFileName(name: string): boolean {
  const base = String(name ?? '').split(/[/\\]/).pop() ?? ''
  if (!base || base.includes('..')) return false
  if (!base.startsWith(STORE_BACKUP_FILE_PREFIX) || !base.toLowerCase().endsWith('.zip')) {
    return false
  }
  const rest = base.slice(STORE_BACKUP_FILE_PREFIX.length, -4)
  return /^\d{6}_\d{6}$/.test(rest)
}

/** `YYYYMMDD/Neo_Desktop_Calendar_백업_….zip`, or a bare name from older flat dests. */
export function parseStoreBackupPath(name: string): { dayFolder: string; fileName: string } | null {
  const parts = String(name ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
  if (parts.length === 0 || parts.length > 2) return null

  const fileName = parts[parts.length - 1]
  if (!isStoreBackupFileName(fileName)) return null
  const dayFolder = parts.length === 2 ? parts[0] : ''
  if (dayFolder && !isStoreBackupDayFolder(dayFolder)) return null
  return { dayFolder, fileName }
}

export function backupSlotKey(date: Date, time: string): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${time}`
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  const digits = value >= 10 ? 0 : 1
  return `${value.toFixed(digits)} ${units[index]}`
}
