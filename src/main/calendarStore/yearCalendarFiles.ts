import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync
} from 'node:fs'
import { join } from 'node:path'
import { eventStartYear, isRecurringEvent } from '../../shared/eventRange'
import type { CalendarEvent, CalendarRecord } from '../../shared/calendarTypes'
import { sanitizeDataKey } from './paths'
import { readJsonFile, writeJsonAtomic } from './atomicJson'

export type CalendarFile = {
  version: number
  calendar: CalendarRecord
  events: CalendarEvent[]
  updatedAt: string
}

type MetaFile = {
  version: number
  calendar: CalendarRecord
  updatedAt: string
}

type EventsFile = {
  version: number
  year?: number
  events: CalendarEvent[]
}

export type LoadedCalendarTree = {
  calendar: CalendarRecord
  events: CalendarEvent[]
  key: string
  dir: string
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

export function partitionEventsByYear(events: CalendarEvent[]): {
  recurring: CalendarEvent[]
  byYear: Map<number, CalendarEvent[]>
} {
  const recurring: CalendarEvent[] = []
  const byYear = new Map<number, CalendarEvent[]>()
  for (const event of events) {
    if (isRecurringEvent(event)) {
      recurring.push(event)
      continue
    }
    const year = eventStartYear(event)
    const list = byYear.get(year) ?? []
    list.push(event)
    byYear.set(year, list)
  }
  return { recurring, byYear }
}

export function calendarTreeDir(calendarsDir: string, key: string): string {
  return join(calendarsDir, sanitizeDataKey(key))
}

export function loadCalendarTree(dir: string): LoadedCalendarTree | null {
  const meta = readJsonFile<MetaFile>(join(dir, 'meta.json'))
  if (!meta?.calendar?.id) return null
  const events: CalendarEvent[] = []
  const recurring = readJsonFile<EventsFile>(join(dir, 'recurring.json'))
  if (Array.isArray(recurring?.events)) events.push(...recurring.events)

  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    return null
  }
  for (const name of names) {
    const match = /^(\d{4})\.json$/.exec(name)
    if (!match) continue
    const payload = readJsonFile<EventsFile>(join(dir, name))
    if (Array.isArray(payload?.events)) events.push(...payload.events)
  }

  const key = sanitizeDataKey(meta.calendar.dataKey ?? meta.calendar.id)
  return {
    calendar: { ...meta.calendar, dataKey: key },
    events,
    key,
    dir
  }
}

export function writeCalendarTree(
  calendarsDir: string,
  calendar: CalendarRecord,
  events: CalendarEvent[]
): string {
  mkdirSync(calendarsDir, { recursive: true })
  const key = sanitizeDataKey(calendar.dataKey ?? calendar.id)
  const dir = calendarTreeDir(calendarsDir, key)
  mkdirSync(dir, { recursive: true })
  const updatedAt = new Date().toISOString()
  const nextCal: CalendarRecord = { ...calendar, dataKey: key }
  writeJsonAtomic(join(dir, 'meta.json'), {
    version: 2,
    calendar: nextCal,
    updatedAt
  } satisfies MetaFile)

  const { recurring, byYear } = partitionEventsByYear(events)
  writeJsonAtomic(join(dir, 'recurring.json'), {
    version: 1,
    events: recurring
  } satisfies EventsFile)

  const keepYears = new Set(byYear.keys())
  for (const [year, list] of byYear) {
    writeJsonAtomic(join(dir, `${year}.json`), {
      version: 1,
      year,
      events: list
    } satisfies EventsFile)
  }

  try {
    for (const name of readdirSync(dir)) {
      const match = /^(\d{4})\.json$/.exec(name)
      if (!match) continue
      if (!keepYears.has(Number(match[1]))) {
        try {
          unlinkSync(join(dir, name))
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }

  const legacyFile = join(calendarsDir, `${key}.json`)
  if (isFile(legacyFile)) {
    try {
      unlinkSync(legacyFile)
    } catch {
      /* ignore */
    }
  }

  return key
}

export function removeCalendarTree(calendarsDir: string, key: string): void {
  const safe = sanitizeDataKey(key)
  const dir = calendarTreeDir(calendarsDir, safe)
  try {
    if (isDirectory(dir)) rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  const legacyFile = join(calendarsDir, `${safe}.json`)
  try {
    if (isFile(legacyFile)) unlinkSync(legacyFile)
  } catch {
    /* ignore */
  }
}

export function clearCalendarTrees(calendarsDir: string): void {
  if (!existsSync(calendarsDir)) return
  for (const name of readdirSync(calendarsDir)) {
    const path = join(calendarsDir, name)
    try {
      if (isDirectory(path)) rmSync(path, { recursive: true, force: true })
      else if (name.endsWith('.json') && isFile(path)) unlinkSync(path)
    } catch {
      /* ignore */
    }
  }
}

function loadLegacyCalendarFile(path: string): { calendar: CalendarRecord; events: CalendarEvent[] } | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<CalendarFile>
    if (!raw.calendar?.id) return null
    return {
      calendar: raw.calendar,
      events: Array.isArray(raw.events) ? raw.events : []
    }
  } catch {
    return null
  }
}

function migrateFlatFile(calendarsDir: string, name: string): void {
  const path = join(calendarsDir, name)
  if (!isFile(path)) return
  const loaded = loadLegacyCalendarFile(path)
  if (!loaded) {
    try {
      if (!readFileSync(path, 'utf8').trim()) unlinkSync(path)
    } catch {
      /* ignore */
    }
    return
  }
  const key = sanitizeDataKey(loaded.calendar.dataKey ?? loaded.calendar.id)
  const dir = calendarTreeDir(calendarsDir, key)
  if (isDirectory(dir)) {
    const existing = loadCalendarTree(dir)
    const mergedEvents = existing
      ? dedupeEventsById([...existing.events, ...loaded.events])
      : loaded.events
    writeCalendarTree(calendarsDir, loaded.calendar, mergedEvents)
  } else {
    writeCalendarTree(calendarsDir, loaded.calendar, loaded.events)
  }
  try {
    if (isFile(path)) unlinkSync(path)
  } catch {
    /* ignore */
  }
}

function dedupeEventsById(events: CalendarEvent[]): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>()
  for (const event of events) {
    const id = String(event?.id ?? '').trim()
    if (!id) continue
    if (!byId.has(id)) byId.set(id, event)
  }
  return Array.from(byId.values())
}

export function migrateAndLoadCalendarTrees(calendarsDir: string): LoadedCalendarTree[] {
  mkdirSync(calendarsDir, { recursive: true })
  for (const name of readdirSync(calendarsDir)) {
    if (name.endsWith('.json') && isFile(join(calendarsDir, name))) {
      migrateFlatFile(calendarsDir, name)
    }
  }

  const byId = new Map<string, LoadedCalendarTree>()
  for (const name of readdirSync(calendarsDir)) {
    const path = join(calendarsDir, name)
    if (!isDirectory(path)) continue
    const loaded = loadCalendarTree(path)
    if (!loaded) continue
    const prev = byId.get(loaded.calendar.id)
    if (!prev) {
      byId.set(loaded.calendar.id, loaded)
      continue
    }
    const mergedEvents = dedupeEventsById([...prev.events, ...loaded.events])
    const prefer =
      loaded.events.length > prev.events.length ||
      (loaded.events.length === prev.events.length && loaded.key === loaded.calendar.id)
        ? loaded
        : prev
    const loser = prefer === loaded ? prev : loaded
    writeCalendarTree(calendarsDir, prefer.calendar, mergedEvents)
    if (loser.dir !== prefer.dir) {
      try {
        rmSync(loser.dir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
    byId.set(prefer.calendar.id, {
      ...prefer,
      events: mergedEvents,
      dir: calendarTreeDir(calendarsDir, sanitizeDataKey(prefer.calendar.dataKey ?? prefer.calendar.id)),
      key: sanitizeDataKey(prefer.calendar.dataKey ?? prefer.calendar.id)
    })
  }

  return Array.from(byId.values())
}

export function calendarTreeHasId(calendarsDir: string, calendarId: string): boolean {
  if (!existsSync(calendarsDir)) return false
  for (const name of readdirSync(calendarsDir)) {
    const path = join(calendarsDir, name)
    if (isDirectory(path)) {
      const meta = readJsonFile<MetaFile>(join(path, 'meta.json'))
      if (meta?.calendar?.id === calendarId) return true
      continue
    }
    if (name.endsWith('.json') && isFile(path)) {
      const raw = loadLegacyCalendarFile(path)
      if (raw?.calendar.id === calendarId) return true
    }
  }
  return false
}

export function countCalendarTreeEvents(calendarsDir: string, calendarId: string): number {
  if (!existsSync(calendarsDir)) return 0
  for (const name of readdirSync(calendarsDir)) {
    const path = join(calendarsDir, name)
    if (isDirectory(path)) {
      const loaded = loadCalendarTree(path)
      if (loaded?.calendar.id === calendarId) return loaded.events.length
      continue
    }
    if (name.endsWith('.json') && isFile(path)) {
      const raw = loadLegacyCalendarFile(path)
      if (raw?.calendar.id === calendarId) return raw.events.length
    }
  }
  return 0
}
