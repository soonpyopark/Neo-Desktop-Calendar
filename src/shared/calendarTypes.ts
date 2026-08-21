import type { CalendarSkin } from './calendarSkin'
import type { LaunchMode, WidgetBounds } from './ipc'
import type { StoreBackupSettings } from './storeBackup'

export type CalendarOwner = 'local' | 'shared'

export type CalendarRecord = {
  id: string
  dataKey?: string
  name: string
  description?: string
  color: string
  visible: boolean
  owner: CalendarOwner
  custom?: boolean
  ownerLoginId?: string
  /** Display owner label; Neo sets this from the member loginId. */
  ownerName?: string
  sortOrder?: number
}

export type EventLink = {
  id: string
  url: string
  title?: string
}

export type EventAttachment = {
  id: string
  name: string
  storedName: string
  mime?: string
  size?: number
  addedAt?: string
}

export type CalendarEvent = {
  id: string
  calendarId: string
  title: string
  description?: string
  link?: string
  links?: EventLink[]
  location?: string
  startDate: string
  endDate: string
  allDay: boolean
  startTime?: string | null
  endTime?: string | null
  repeat?: string
  repeatUntil?: string | null
  repeatCount?: number | null
  exdates?: string[]
  color?: string | null
  guests?: string[]
  completed?: boolean
  markerShape?: string | null
  tagIds?: string[]
  attachments?: EventAttachment[]
  sortOrder?: number
  sortOrderByDay?: Record<string, number>
  createdAt?: string
  updatedAt?: string
  createdBy?: string
  ownerLoginId?: string
  /** Expanded occurrence date (search / views). */
  occurrenceDate?: string
  seriesId?: string
  /**
   * Soft link for a "this event only" exception detached from a recurring master.
   * Used to clean orphans on delete-all / delete-following (not full Google RECURRENCE-ID).
   */
  detachedFromSeriesId?: string | null
  /** Original occurrence start (YYYY-MM-DD) for a detached exception. */
  detachedOccurrenceDate?: string | null
}

export type TagRecord = {
  id: string
  name: string
  color: string
  sortOrder: number
}

export type MemberRole = 'super_admin' | 'member' | 'admin'

export type MemberRecord = {
  id: string
  loginId: string
  displayName: string
  passwordHash?: string
  role: MemberRole
  active: boolean
  isBootstrapAdmin?: boolean
}

/** UI save payload — plain `password` is hashed in MembersStore. */
export type MemberSaveInput = {
  id?: string
  loginId: string
  displayName?: string
  role?: MemberRole
  active?: boolean
  password?: string
  passwordHash?: string
  /** MDC: mark row for deletion on save */
  _delete?: boolean
}

export type HolidaysKrSettings = {
  serviceKey: string
  rememberKey: boolean
  ok: boolean | null
  skipped: boolean
  reason: string | null
  message: string | null
  years: number[]
  count: number
  lastSyncedAt: string | null
  /** api | seed | seed-fallback | env */
  source?: string | null
}

export type SyncHolidaysInput = {
  serviceKey?: string
  rememberKey?: boolean
  years?: number[]
}

export type SyncHolidaysResult = {
  ok: boolean
  skipped?: boolean
  reason?: string | null
  count: number
  years: number[]
  source: string
  message?: string | null
  error?: string
}

/** Electron shell vs LAN/browser editor (MDC ClientSurface). */
export type ClientSurface = 'native' | 'browser'

/** Custom label between app logo and search in the header chrome. */
export type HeaderTitleOptions = {
  enabled: boolean
  text: string
  color: string
  fontSizePx: number
}

/** Presentation prefs stored per surface (theme, week start, hide flags, …). */
export type SurfaceViewOptions = {
  showWeekNumbers: boolean
  weekStartsOnSunday: boolean
  /** Neo chrome: rounded shell/header/footer. Default off for new installs. */
  roundedCorners: boolean
  /** Optional personal calendar name in the header (between logo and search). */
  headerTitle: HeaderTitleOptions
  /**
   * 세로보기: date rows newest-first (말일 → 1일). When false, 1일 → 말일.
   * Default true for new installs / missing key.
   */
  dayListSortDesc: boolean
  /**
   * Month/week event-bar density (0.75–1.25). Lower = smaller bars/text and more
   * events before "N개 더보기". Default 1.
   */
  eventDensity: number
  /**
   * Event-bar letter-spacing in em (−0.12 … 0.08). Default −0.06 (current look).
   */
  eventLetterSpacing: number
  colorScheme: 'light' | 'dark' | 'system'
  accentColor: string
  /** Optional chrome colors (weekday/weekend/header/footer/grid). Empty = theme default. */
  skin: CalendarSkin
  eventsHidden: boolean
  completedHidden: boolean
  /** Hide chrome row 1 (search/settings/login) and the footer hint bar. */
  headerCollapsed: boolean
}

export type ViewOptions = SurfaceViewOptions & {
  /** Shell-only: Windows login item (native surface may patch; browser must not). */
  runAtStartup: boolean
}

export type StoreSettings = {
  ownerName: string
  timezone: string
  timezoneLabel: string
  notifications: {
    enabled: string
    reminderTiming: string
    playSound: boolean
    onlyYesOrMaybe: boolean
  }
  /**
   * Client-facing flattened view options (shell ∪ surface).
   * On disk after migration: shell keys only; presentation lives in viewOptionsBySurface.
   */
  viewOptions: ViewOptions
  /** Per-surface presentation prefs (native Electron vs browser editor). */
  viewOptionsBySurface?: Partial<Record<ClientSurface, Partial<SurfaceViewOptions>>>
  holidaysKr: HolidaysKrSettings
  widget: {
    launchMode: LaunchMode
    enabled: boolean
    alwaysOnTop: boolean
    bounds: WidgetBounds
    margins?: Record<string, number>
    /** Preferred monitor + relative offsets (multi-monitor restore). */
    displayPlacement?: {
      displayId: number
      offsetX: number
      offsetY: number
      width: number
      height: number
    } | null
  }
  dayColors: Record<string, string>
  dayColorsByLoginId?: Record<string, Record<string, string>>
  /** 형광펜 — highlighter color behind the date number, keyed by dateKey. */
  dayHighlights?: Record<string, string>
  dayHighlightsByLoginId?: Record<string, Record<string, string>>
  hiddenCalendarIdsByLoginId?: Record<string, string[]>
  allowedIpCidrs: Array<{ cidr: string; description?: string }>
  /**
   * When true, 3 failed passwords for the same loginId lock that id for 5 minutes.
   * Direct 127.0.0.1 (Electron / same-PC browser) is exempt.
   */
  loginLockoutEnabled?: boolean
  /**
   * HTTP web server listen port (Local / LAN).
   * null/undefined → fall back to .env PORT, then 3010.
   * When set, always wins over .env.
   */
  webServerPort?: number | null
  /**
   * Preferred HTTP server bind mode from 서버 관리 / tray.
   * null/undefined → fall back to .env HOSTNAME, then local.
   * When set, always wins over .env.
   */
  webServerMode?: 'local' | 'lan' | null
  /**
   * HTTPS on the same listen port (settings → 서버 관리).
   * null/undefined → fall back to .env HTTPS_ENABLED, then off.
   */
  httpsEnabled?: boolean | null
  /**
   * Super-admin scheduled ZIP backup (설정 → 백업 관리).
   * Dest folder + auto-mirror times live here; run state is a sidecar file.
   */
  storeBackup?: StoreBackupSettings
  /** Neo chrome extensions */
  headerOpacity: number
  shellOpacity: number
}

export type CalendarStoreSnapshot = {
  version: number
  settings: StoreSettings
  calendars: CalendarRecord[]
  events: CalendarEvent[]
  tags: TagRecord[]
  updatedAt: string
}

export type EventInput = Partial<CalendarEvent> & {
  title: string
  calendarId: string
  startDate: string
  endDate?: string
}
