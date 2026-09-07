import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LoginAuditEntry, LoginAuditList, LoginAuditResult } from '../../shared/calendarTypes'
import { normalizeClientIp } from '../webServer/ipAccess'

export type { LoginAuditEntry, LoginAuditList, LoginAuditResult }

const AUDIT_FILE = 'login-audit.json'
const MAX_ENTRIES = 1000
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000

let writeChain: Promise<void> = Promise.resolve()

function auditFilePath(dataRoot: string): string {
  return join(dataRoot, AUDIT_FILE)
}

function normalizeResult(value: unknown): LoginAuditResult | null {
  return value === 'success' || value === 'fail' || value === 'locked' ? value : null
}

function normalizeEntry(raw: unknown): LoginAuditEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const loginId = String(row.loginId ?? '').trim()
  const result = normalizeResult(row.result)
  const at = String(row.at ?? '').trim()
  if (!loginId || !result || !at) return null
  const parsed = Date.parse(at)
  if (!Number.isFinite(parsed)) return null
  const ip = normalizeClientIp(String(row.ip ?? '')) || String(row.ip ?? '').trim() || '—'
  return {
    id: String(row.id ?? '').trim() || randomUUID(),
    at: new Date(parsed).toISOString(),
    loginId,
    result,
    ip
  }
}

function pruneEntries(entries: LoginAuditEntry[]): LoginAuditEntry[] {
  const cutoff = Date.now() - MAX_AGE_MS
  return entries
    .filter((entry) => Date.parse(entry.at) >= cutoff)
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .slice(0, MAX_ENTRIES)
}

async function loadEntries(dataRoot: string): Promise<LoginAuditEntry[]> {
  try {
    const raw = await readFile(auditFilePath(dataRoot), 'utf8')
    const parsed = JSON.parse(raw) as { entries?: unknown }
    const list = Array.isArray(parsed?.entries) ? parsed.entries : []
    return pruneEntries(list.map(normalizeEntry).filter((entry): entry is LoginAuditEntry => Boolean(entry)))
  } catch {
    return []
  }
}

async function saveEntries(dataRoot: string, entries: LoginAuditEntry[]): Promise<void> {
  const filePath = auditFilePath(dataRoot)
  const payload = `${JSON.stringify({ version: 1, entries }, null, 2)}\n`
  const tmp = `${filePath}.${process.pid}.tmp`
  await writeFile(tmp, payload, 'utf8')
  await rename(tmp, filePath)
}

export function recordLoginAudit(
  entry: {
    loginId: string
    result: LoginAuditResult
    clientIp?: string | null
  },
  dataRoot: string,
  isEnabled = true
): Promise<void> {
  writeChain = writeChain
    .then(async () => {
      if (isEnabled === false) return
      const loginId = String(entry?.loginId ?? '').trim()
      const result = normalizeResult(entry?.result)
      if (!loginId || !result) return
      const next = pruneEntries([
        {
          id: randomUUID(),
          at: new Date().toISOString(),
          loginId,
          result,
          ip: normalizeClientIp(String(entry.clientIp ?? '')) || '—'
        },
        ...(await loadEntries(dataRoot))
      ])
      await saveEntries(dataRoot, next)
    })
    .catch((err) => {
      console.warn('[auth] login audit write failed:', err)
    })
  return writeChain
}

function toAuditList(
  entries: LoginAuditEntry[],
  filter: { loginId?: string; result?: string } = {}
): LoginAuditList {
  const loginFilter = String(filter.loginId ?? '').trim().toLowerCase()
  const resultFilter = normalizeResult(filter.result)
  const filtered = entries.filter((entry) => {
    if (loginFilter && !entry.loginId.toLowerCase().includes(loginFilter)) return false
    if (resultFilter && entry.result !== resultFilter) return false
    return true
  })
  const lastSuccessAt: Record<string, string> = {}
  for (const entry of entries) {
    if (entry.result !== 'success') continue
    const key = entry.loginId.toLowerCase()
    if (!lastSuccessAt[key]) lastSuccessAt[key] = entry.at
  }
  return { entries: filtered, lastSuccessAt }
}

function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn)
  writeChain = run.then(
    () => undefined,
    (err) => {
      console.warn('[auth] login audit write failed:', err)
    }
  )
  return run
}

export async function listLoginAudit(
  filter: { loginId?: string; result?: string } = {},
  dataRoot: string
): Promise<LoginAuditList> {
  return toAuditList(await loadEntries(dataRoot), filter)
}

export function deleteLoginAudit(id: string, dataRoot: string): Promise<LoginAuditList> {
  const target = String(id ?? '').trim()
  return enqueueWrite(async () => {
    const entries = await loadEntries(dataRoot)
    if (!target) return toAuditList(entries)
    const next = entries.filter((entry) => entry.id !== target)
    if (next.length !== entries.length) await saveEntries(dataRoot, next)
    return toAuditList(next)
  })
}

export function clearLoginAudit(dataRoot: string): Promise<LoginAuditList> {
  return enqueueWrite(async () => {
    await saveEntries(dataRoot, [])
    return toAuditList([])
  })
}
