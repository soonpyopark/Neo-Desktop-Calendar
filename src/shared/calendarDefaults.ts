import { DEFAULT_WIDGET_BOUNDS } from './constants'
import { DEFAULT_ACCENT_COLOR } from './calendarColorPalette'
import type {
  CalendarRecord,
  CalendarStoreSnapshot,
  StoreSettings,
  TagRecord
} from './calendarTypes'
import { DEFAULT_HEADER_TITLE } from './headerTitle'
import { DEFAULT_STORE_BACKUP } from './storeBackup'

export const HOLIDAYS_KR_CALENDAR_ID = 'holidays-kr'

/** 번들 시드에 굽는 창과 같아야 한다 — `scripts/build-holiday-seed.mjs`. */
export const HOLIDAYS_KR_YEAR_SPAN = 3

/** 동기화 기본 연도: 올해부터 3년 (시드 커버리지와 동일). */
export function defaultHolidayYears(from = new Date().getFullYear()): number[] {
  return Array.from({ length: HOLIDAYS_KR_YEAR_SPAN }, (_, index) => from + index)
}
export const PRIMARY_CALENDAR_ID = 'primary'
export const PRIMARY_CALENDAR_COLOR = '#f6bf26'

export function isProtectedCalendarId(id: string): boolean {
  return id === PRIMARY_CALENDAR_ID || id === HOLIDAYS_KR_CALENDAR_ID
}

/** First-run / factory Neo chrome opacity (settings sliders + CSS vars). */
export const DEFAULT_HEADER_OPACITY = 1
export const DEFAULT_SHELL_OPACITY = 1

/** Older factory pairs that should be upgraded to the current defaults. */
const LEGACY_FACTORY_OPACITY_PAIRS: ReadonlyArray<{ header: number; shell: number }> = [
  { header: 0.62, shell: 0.35 },
  { header: 0.65, shell: 0.35 }
]

function approxOpacity(a: number, b: number): boolean {
  return Math.abs(Number(a) - b) < 0.005
}

/**
 * If settings still carry a known pre-1.0 factory opacity pair, bump to current defaults.
 * User-chosen values (anything else) are left alone.
 */
export function upgradeLegacyFactoryOpacity<T extends {
  headerOpacity?: number
  shellOpacity?: number
}>(settings: T): T {
  const header = Number(settings.headerOpacity)
  const shell = Number(settings.shellOpacity)
  if (!Number.isFinite(header) || !Number.isFinite(shell)) {
    return {
      ...settings,
      headerOpacity: DEFAULT_HEADER_OPACITY,
      shellOpacity: DEFAULT_SHELL_OPACITY
    }
  }
  const isLegacyFactory = LEGACY_FACTORY_OPACITY_PAIRS.some(
    (pair) => approxOpacity(header, pair.header) && approxOpacity(shell, pair.shell)
  )
  if (!isLegacyFactory) return settings
  return {
    ...settings,
    headerOpacity: DEFAULT_HEADER_OPACITY,
    shellOpacity: DEFAULT_SHELL_OPACITY
  }
}

export const DEFAULT_TAGS: TagRecord[] = [
  { id: 'tag-admin', name: '행정', color: '#039be5', sortOrder: 0 },
  { id: 'tag-work', name: '작업', color: '#ffe252', sortOrder: 1 },
  { id: 'tag-duty', name: '회의', color: '#8e24aa', sortOrder: 2 },
  { id: 'tag-trip', name: '출장', color: '#f4511e', sortOrder: 3 },
  { id: 'tag-personal', name: '개인', color: '#33b679', sortOrder: 4 }
]

export const DEFAULT_CALENDARS: CalendarRecord[] = [
  {
    id: PRIMARY_CALENDAR_ID,
    dataKey: PRIMARY_CALENDAR_ID,
    name: '기본 캘린더',
    color: PRIMARY_CALENDAR_COLOR,
    visible: true,
    owner: 'local',
    custom: false,
    sortOrder: 0
  },
  {
    id: HOLIDAYS_KR_CALENDAR_ID,
    dataKey: HOLIDAYS_KR_CALENDAR_ID,
    name: '대한민국의 휴일',
    description: '공공데이터포털 특일 정보로 동기화할 수 있습니다.',
    color: '#d50000',
    visible: true,
    owner: 'shared',
    custom: false,
    sortOrder: 1
  }
]

export function createDefaultSettings(): StoreSettings {
  return {
    ownerName: '',
    timezone: 'Asia/Seoul',
    timezoneLabel: '(GMT+09:00) 한국 표준시 - 서울',
    notifications: {
      enabled: 'none',
      reminderTiming: '1min',
      playSound: true,
      onlyYesOrMaybe: false
    },
    viewOptions: {
      showWeekNumbers: true,
      weekStartsOnSunday: true,
      roundedCorners: false,
      headerTitle: { ...DEFAULT_HEADER_TITLE },
      dayListSortDesc: true,
      eventDensity: 1,
      eventLetterSpacing: -0.06,
      eventLetterWidth: 0.88,
      colorScheme: 'light',
      accentColor: DEFAULT_ACCENT_COLOR,
      skin: { light: {}, dark: {} },
      runAtStartup: true,
      eventsHidden: false,
      completedHidden: false,
      headerCollapsed: false
    },
    holidaysKr: {
      serviceKey: '',
      rememberKey: false,
      ok: null,
      skipped: false,
      reason: null,
      message: null,
      years: [],
      count: 0,
      lastSyncedAt: null
    },
    widget: {
      launchMode: 'window',
      enabled: false,
      alwaysOnTop: false,
      bounds: { ...DEFAULT_WIDGET_BOUNDS }
    },
    dayColors: {},
    dayColorsByLoginId: {},
    dayHighlights: {},
    dayHighlightsByLoginId: {},
    hiddenCalendarIdsByLoginId: {},
    allowedIpCidrs: [],
    loginLockoutEnabled: false,
    webServerPort: null,
    webServerMode: null,
    httpsEnabled: null,
    storeBackup: { ...DEFAULT_STORE_BACKUP },
    headerOpacity: DEFAULT_HEADER_OPACITY,
    shellOpacity: DEFAULT_SHELL_OPACITY
  }
}

export function createEmptySnapshot(): CalendarStoreSnapshot {
  return {
    version: 2,
    settings: createDefaultSettings(),
    calendars: structuredClone(DEFAULT_CALENDARS),
    events: [],
    tags: structuredClone(DEFAULT_TAGS),
    updatedAt: new Date().toISOString()
  }
}
