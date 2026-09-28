import type { CalendarEvent, CalendarRecord, TagRecord } from './calendarTypes'
import { compareEventsForDisplay } from './mdcExport/eventBarFormat.js'
import { expandEventsForRange } from './mdcExport/eventOccurrences.js'
import { resolveEventTags } from './mdcExport/eventTags.js'

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

export type SearchRange = { start: string; end: string }

export function getDefaultSearchRange(now = new Date()): SearchRange {
  const start = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
  const end = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate())
  return { start: toDateKey(start), end: toDateKey(end) }
}

export function toDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function normalizeSearchRange(start?: string, end?: string): SearchRange {
  const defaults = getDefaultSearchRange()
  let from = DATE_KEY_RE.test(String(start ?? '')) ? String(start) : defaults.start
  let to = DATE_KEY_RE.test(String(end ?? '')) ? String(end) : defaults.end
  if (from > to) {
    const swap = from
    from = to
    to = swap
  }
  return { start: from, end: to }
}

function collectLinkSearchParts(event: CalendarEvent): string[] {
  const parts: string[] = []
  if (Array.isArray(event.links)) {
    for (const link of event.links) {
      if (link?.title) parts.push(link.title)
      if (link?.url) parts.push(link.url)
    }
  }
  if (event.link) parts.push(event.link)
  return parts
}

function collectAttachmentSearchParts(event: CalendarEvent): string[] {
  if (!Array.isArray(event.attachments)) return []
  return event.attachments
    .map((item) => String(item?.name ?? '').trim())
    .filter(Boolean)
}

function matchesQuery(
  query: string,
  event: CalendarEvent,
  calendar: CalendarRecord | undefined,
  tags: TagRecord[]
): boolean {
  const tagNames = resolveEventTags(event, tags).map((tag) => tag.name)
  const haystack = [
    event.title,
    event.description,
    event.location,
    calendar?.name,
    ...tagNames,
    ...collectLinkSearchParts(event),
    ...collectAttachmentSearchParts(event)
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return haystack.includes(query)
}

export function searchCalendarEvents(options: {
  query: string
  events: CalendarEvent[]
  calendars: CalendarRecord[]
  tags?: TagRecord[]
  rangeStart?: string
  rangeEnd?: string
}): CalendarEvent[] {
  const normalized = String(options.query ?? '')
    .trim()
    .toLowerCase()
  if (!normalized) return []

  const tags = options.tags ?? []
  const range = normalizeSearchRange(options.rangeStart, options.rangeEnd)
  const calendarById = new Map((options.calendars ?? []).map((calendar) => [calendar.id, calendar]))
  const expanded = expandEventsForRange(options.events ?? [], range.start, range.end) as CalendarEvent[]

  return expanded
    .filter((event) =>
      matchesQuery(normalized, event, calendarById.get(event.calendarId), tags)
    )
    .sort(compareEventsForDisplay)
}
