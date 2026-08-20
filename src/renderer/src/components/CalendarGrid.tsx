import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactElement
} from 'react'
import { InteractionUI } from './InteractionUI'
import { useAppDialog } from './AppDialogProvider'
import { AppChrome } from './AppChrome'
import { DayQuickEditPopover, type AnchorRect, QUICK_EDIT_YEAR_MIN_BODY } from './DayQuickEditPopover'
import { getLunarMonthLabel } from '../lib/lunar'
import {
  generateWeekRange,
  getWeeksInMonth
} from '../lib/calendarUtils'
import { useMonthWeekScroll } from '../hooks/useMonthWeekScroll.js'
import { EventEditor } from './EventEditor'
import { EventPopover, type EventPopoverAnchor } from './EventPopover'
import { MonthDayCell, type DaySegment } from './MonthDayCell'
import {
  buildAllWeekEventLayouts,
  buildWeekEventLayout
} from '../../../shared/mdcExport/monthWeekLayout.js'

const WEEKS_BEFORE = 56
const WEEKS_AFTER = 56
import { parseDateKey as parseDateKeyLocal } from '../lib/calendarUtils'
import {
  getEventSortOrderForDay,
  mergeSortOrderByDay
} from '../../../shared/mdcExport/eventBarFormat.js'
import { LoginDialog } from './LoginDialog'
import {
  hasBrowserAuthToken,
  isBrowserNeoCalendarHost,
  subscribeAuthUserSync
} from '../lib/browserNeoCalendar'
import {
  CHROME_TOOLBAR_ACTIONS,
  EMBEDDED_AUTH_CHROME_ACTIONS,
  EMBEDDED_EXPORT_CHROME_ACTIONS,
  EMBEDDED_FLOATING_CHROME_ACTIONS,
  EMBEDDED_FOOTER_HINT_ACTIONS,
  EMBEDDED_FOOTER_LINK_ACTIONS,
  EMBEDDED_HEADER_CHROME_ACTIONS,
  EMBEDDED_MODE_CHROME_ACTIONS,
  EMBEDDED_RELOAD_CHROME_ACTIONS,
  FOOTER_HINT_ACTIONS,
  PERIOD_TOOLBAR_ACTIONS,
  YEAR_MONTH_OPEN_ACTIONS,
  parseYearMonthOpenAction,
  yearMonthOpenAction
} from '../../../shared/ipc'
import {
  type OpenPanelWindowRequest,
  type PanelAnchorRect,
  type PanelWindowInit
} from '../../../shared/panelWindows'
import { RecurrenceScopeDialog } from './RecurrenceScopeDialog'
import { SearchPanel } from './SearchPanel'
import { SettingsPanel } from './SettingsPanel'
import { ExportOptionsPanel } from './ExportOptionsPanel'
import { FooterHelpPanel } from './FooterHelpPanel'
import { HeaderTitleEditorPanel } from './HeaderTitleEditorPanel'
import { normalizeHeaderTitle } from '../../../shared/headerTitle'
import { DayListPreviewPanel } from './DayListPreviewPanel'
import { exportFormatLabel, formatExportRangeLabel } from '../../../shared/exportCalendarHelpers.js'
import type { ExportCalendarRequest } from '../../../shared/exportCalendar'
import { useMaxVisibleEvents } from '../hooks/useMaxVisibleEvents'
import {
  EVENT_DENSITY_MAX,
  EVENT_DENSITY_MIN,
  EVENT_DENSITY_STEP,
  normalizeEventDensity,
  stepEventDensity
} from '../../../shared/eventLayoutMetrics'
import {
  getOccurrenceDate,
  getSeriesId,
  isRecurringEvent,
  expandEventsForRange
} from '../../../shared/mdcExport/eventOccurrences.js'
import { eventToMutationPayload } from '../lib/eventMutation'
import {
  FOOTER_HINTS,
  FOOTER_HINT_ROTATE_MS,
  pickRandomFooterHintIndex
} from '../content/footerHints'
import {
  EVENT_UI_DISMISS_AFTER_DELETE,
  type EventUiDismissDetail
} from '../lib/eventUiDismiss'
import {
  buildRecurringCompletePayload,
  closePanelsAfterEventDelete
} from '../lib/recurrenceComplete'
import {
  applyRecurringDelete,
  applyRecurringEdit as applyRecurringEditCore
} from '../lib/recurrenceMutations'
import { copyEventToDate } from '../lib/copyEventToDate'
import { applyEventDateShift } from '../lib/shiftEventDates'
import {
  getPrimaryEventLinkUrl,
  normalizeEventLinksArray
} from '../lib/eventLinks'
import { normalizeTagIds } from '../../../shared/mdcExport/eventTags.js'
import type { EventLink } from '../../../shared/calendarTypes'
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DesktopModeIcon,
  DoubleChevronLeftIcon,
  DoubleChevronRightIcon,
  DensityDownIcon,
  DensityUpIcon,
  ExportIcon,
  HelpIcon,
  HideCompletedCheckIcon,
  HideEventsEyeIcon,
  MonthViewIcon,
  PortraitPreviewIcon,
  SearchIcon,
  SettingsIcon,
  WebBrowserIcon,
  WeekViewIcon,
  WindowModeIcon,
  YearViewIcon
} from './CalendarHeaderIcons'
import { useCalendarStore } from '../hooks/useCalendarStore'
import { useUndoRedoShortcuts } from '../hooks/useUndoRedoShortcuts'
import {
  desktopModeIconBtnClass,
  footerShellClass,
  headerShellClass,
  iconBtnDisabledClass,
  navBtnClass,
  dayListPreviewIconBtnActiveClass,
  dayListPreviewIconBtnClass,
  densityIconBtnClass,
  softBlueIconBtnActiveClass,
  softBlueIconBtnClass,
  softBlueIconBtnMutedClass,
  softRedIconBtnActiveClass,
  todayBtnClass,
  viewModeIconBtnActiveClass,
  viewModeIconBtnClass,
  yearNavBtnClass
} from '../lib/headerButtonClasses'
import { HOLIDAYS_KR_CALENDAR_ID, PRIMARY_CALENDAR_ID } from '../../../shared/calendarDefaults'
import type { CalendarEvent } from '../../../shared/calendarTypes'
import type { AppSettings, AuthUser, LaunchMode } from '../../../shared/ipc'
import { SiteLink } from './SiteLink'
import { openExternalUrl } from '../lib/openExternal'

export type { CalendarEvent }
export type ViewMode = 'year' | 'week' | 'month'

const LOGIN_REQUIRED_TITLE = '로그인 후 사용할 수 있습니다'
/** Visual-only muted state — avoid `disabled` so clicks can open the login dialog. */
const LOGIN_MUTED_CLASS = 'cursor-not-allowed opacity-40'

const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'] as const
const PERIOD_TOOLBAR_ACTION_ID_SET = new Set<string>([
  ...Object.values(PERIOD_TOOLBAR_ACTIONS),
  ...YEAR_MONTH_OPEN_ACTIONS
])

function toPanelAnchor(anchor: EventPopoverAnchor): PanelAnchorRect | null {
  if (!anchor) return null
  if ('left' in anchor && 'top' in anchor && 'width' in anchor && 'height' in anchor) {
    return anchor
  }
  if ('x' in anchor && 'y' in anchor) {
    return { left: anchor.x - 12, top: anchor.y - 12, width: 24, height: 24 }
  }
  return null
}
const VIEW_MODE_OPTIONS: Array<{ value: ViewMode; label: string; Icon: () => ReactElement }> = [
  { value: 'year', label: '연', Icon: YearViewIcon },
  { value: 'week', label: '주', Icon: WeekViewIcon },
  { value: 'month', label: '월', Icon: MonthViewIcon }
]

function toDateKey(year: number, month: number, day: number): string {
  const mm = String(month + 1).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

/** WorkerW embedded: inflate client hit rects — Sunday column gets extra outer-edge slack. */
function publishDayCellHitRect(
  el: HTMLElement,
  rect: DOMRect,
  weekStartsOn: 0 | 1
): { x: number; y: number; width: number; height: number } {
  const pad = 6
  let x = Math.round(rect.left) - pad
  let y = Math.round(rect.top) - pad
  let width = Math.round(rect.width) + pad * 2
  let height = Math.round(rect.height) + pad * 2

  if (el.classList.contains('sunday')) {
    if (weekStartsOn === 0) {
      x -= 12
      width += 12
    } else {
      width += 12
    }
  }

  return { x, y, width, height }
}

function parseDateKey(dateKey: string): Date | null {
  const [y, m, d] = dateKey.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

function eachDateKey(start: string, end: string): string[] {
  const from = parseDateKey(start)
  const to = parseDateKey(end || start)
  if (!from || !to) return start ? [start] : []
  const keys: string[] = []
  const cur = new Date(from)
  const last = to < from ? from : to
  while (cur <= last) {
    keys.push(toDateKey(cur.getFullYear(), cur.getMonth(), cur.getDate()))
    cur.setDate(cur.getDate() + 1)
    if (keys.length > 366) break
  }
  return keys
}

function startOfWeek(date: Date, weekStartsOn: 0 | 1 = 0): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = d.getDay()
  const diff = weekStartsOn === 1 ? (day === 0 ? -6 : 1 - day) : -day
  d.setDate(d.getDate() + diff)
  return d
}

function addDays(date: Date, delta: number): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  d.setDate(d.getDate() + delta)
  return d
}

function formatWeekTitle(anchor: Date, weekStartsOn: 0 | 1 = 0): string {
  const start = startOfWeek(anchor, weekStartsOn)
  const end = addDays(start, 6)
  const sameMonth = start.getMonth() === end.getMonth()
  if (sameMonth) {
    return `${start.getFullYear()}년 ${start.getMonth() + 1}월 ${start.getDate()}–${end.getDate()}일`
  }
  return `${start.getFullYear()}년 ${start.getMonth() + 1}/${start.getDate()} – ${end.getMonth() + 1}/${end.getDate()}`
}

/** ISO week number (Mon-based), matching MDC. */
function getWeekNumber(date: Date): number {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = target.getUTCDay() || 7
  target.setUTCDate(target.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1))
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

type DayCell = {
  day: number
  dateKey: string
  inMonth: boolean
  isToday: boolean
  weekday: number
  date: Date
}

function mapWeekToDayCells(
  week: Array<{ date: Date }>,
  displayYear: number,
  displayMonth: number
): DayCell[] {
  const today = new Date()
  const todayKey = toDateKey(today.getFullYear(), today.getMonth(), today.getDate())
  return week.map(({ date }) => {
    const y = date.getFullYear()
    const m = date.getMonth()
    const day = date.getDate()
    const dateKey = toDateKey(y, m, day)
    return {
      day,
      dateKey,
      inMonth: y === displayYear && m === displayMonth,
      isToday: dateKey === todayKey,
      weekday: date.getDay(),
      date: new Date(y, m, day)
    }
  })
}

function buildMonthWeeks(year: number, month: number, weekStartsOn: 0 | 1 = 0): DayCell[][] {
  const first = new Date(year, month, 1)
  const start = startOfWeek(first, weekStartsOn)
  const today = new Date()
  const todayKey = toDateKey(today.getFullYear(), today.getMonth(), today.getDate())

  const weeks: DayCell[][] = []
  const cursor = new Date(start)
  for (let w = 0; w < 6; w += 1) {
    const week: DayCell[] = []
    for (let d = 0; d < 7; d += 1) {
      const y = cursor.getFullYear()
      const m = cursor.getMonth()
      const day = cursor.getDate()
      const dateKey = toDateKey(y, m, day)
      week.push({
        day,
        dateKey,
        inMonth: m === month,
        isToday: dateKey === todayKey,
        weekday: cursor.getDay(),
        date: new Date(y, m, day)
      })
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
  }
  return weeks
}

function buildWeekDays(anchor: Date, weekStartsOn: 0 | 1 = 0): DayCell[] {
  const start = startOfWeek(anchor, weekStartsOn)
  const today = new Date()
  const todayKey = toDateKey(today.getFullYear(), today.getMonth(), today.getDate())
  const days: DayCell[] = []
  for (let i = 0; i < 7; i += 1) {
    const d = addDays(start, i)
    const dateKey = toDateKey(d.getFullYear(), d.getMonth(), d.getDate())
    days.push({
      day: d.getDate(),
      dateKey,
      inMonth: true,
      isToday: dateKey === todayKey,
      weekday: d.getDay(),
      date: d
    })
  }
  return days
}

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

function FooterHintPrevIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
      <path fill="currentColor" d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
    </svg>
  )
}

function FooterHintPauseIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
      <path fill="currentColor" d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
    </svg>
  )
}

function FooterHintPlayIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
      <path fill="currentColor" d="M8 5v14l11-7L8 5z" />
    </svg>
  )
}

function FooterHintNextIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
      <path fill="currentColor" d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
    </svg>
  )
}

type FooterHintNav = {
  index: number
  history: number[]
  pos: number
}

function createFooterHintNav(index = pickRandomFooterHintIndex()): FooterHintNav {
  return { index, history: [index], pos: 0 }
}

function advanceFooterHintNav(nav: FooterHintNav, nextIndex: number): FooterHintNav {
  const history = nav.history.slice(0, nav.pos + 1)
  history.push(nextIndex)
  return { index: nextIndex, history, pos: history.length - 1 }
}

function toWeekStartKey(week: DayCell[]): string {
  return week[0]?.dateKey ?? ''
}

/** Electron window mode + WorkerW embedded — floating panel BrowserWindows. */
function usesFloatingPanels(mode: LaunchMode, embedded: boolean): boolean {
  if (isBrowserNeoCalendarHost()) return false
  return mode === 'window' || embedded
}

/** Unlocked desktop + HTTP browser — inline popovers inside the main renderer. */
function usesInlineOverlays(mode: LaunchMode, embedded: boolean): boolean {
  if (isBrowserNeoCalendarHost()) return true
  return mode === 'desktop' && !embedded
}

export type CalendarGridProps = {
  mode: LaunchMode
  /** True only while WorkerW-embedded (not while temporarily undocked). */
  embedded?: boolean
  switchReady?: boolean
  user: AuthUser | null
  /** False until first getAuth() resolves — avoids flashing login before remembered session. */
  authReady?: boolean
  settings: AppSettings | null
  onUserChange: (user: AuthUser | null) => void
  onModeChange: (mode: LaunchMode) => void
  onSettingsSaved: (patch: Partial<AppSettings>) => void | Promise<void>
}

/**
 * MDC-styled calendar on Neo click-through core.
 */
export function CalendarGrid({
  mode,
  embedded = false,
  switchReady = true,
  user,
  authReady = true,
  settings,
  onUserChange,
  onModeChange,
  onSettingsSaved
}: CalendarGridProps): ReactElement {
  const { alert } = useAppDialog()
  const now = new Date()
  const canEdit =
    Boolean(user) || (isBrowserNeoCalendarHost() && hasBrowserAuthToken())
  const {
    store,
    loading,
    visibleEvents,
    calendarsById,
    addEvent,
    editEvent,
    removeEvent,
    patchStoreSettings,
    createCalendar,
    patchCalendar,
    reorderCalendars,
    deleteCalendar,
    clearCalendarEvents,
    importEventsIntoCalendar,
    createTag,
    patchTag,
    deleteTag,
    replaceStore,
    importStore,
    listMembers,
    saveMembers,
    syncHolidays,
    refresh,
    undo,
    redo,
    canUndo,
    canRedo,
    deleteCompletedForDay
  } = useCalendarStore()

  const [viewMode, setViewMode] = useState<ViewMode>('month')
  const [viewDate, setViewDate] = useState(() => new Date(now.getFullYear(), now.getMonth(), now.getDate()))
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [dayListPreviewOpen, setDayListPreviewOpen] = useState(false)
  const [headerTitleEditorOpen, setHeaderTitleEditorOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [loginBusy, setLoginBusy] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [modeBusy, setModeBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportOptionsOpen, setExportOptionsOpen] = useState(false)
  const [footerHelpOpen, setFooterHelpOpen] = useState(false)
  const [footerHintNav, setFooterHintNav] = useState<FooterHintNav>(() => createFooterHintNav())
  const [footerHintPaused, setFooterHintPaused] = useState(false)
  const footerHintIndex = footerHintNav.index
  const canGoPrevFooterHint = footerHintNav.pos > 0
  const [webEditUrl, setWebEditUrl] = useState<string | null>(null)
  /** Bumps when light/dark flips so MDC event-bar themes recompute. */
  const [themeEpoch, setThemeEpoch] = useState(0)
  const [quickEdit, setQuickEdit] = useState<{
    dateKey: string
    date: Date
    anchorRect: AnchorRect | null
  } | null>(null)
  const [eventPopover, setEventPopover] = useState<{
    event: CalendarEvent
    anchorRect: EventPopoverAnchor
    dayKey?: string
  } | null>(null)
  /** Browser / unlocked desktop: which inline overlay paints on top. */
  const [inlineFrontPanel, setInlineFrontPanel] = useState<'quickEdit' | 'eventDetail'>(
    'quickEdit'
  )
  const inlineQuickEditZ = inlineFrontPanel === 'quickEdit' ? 80 : 35
  const inlineEventDetailZ = inlineFrontPanel === 'eventDetail' ? 80 : 70
  const [editor, setEditor] = useState<{
    event: CalendarEvent | null
    defaultDate?: string
    occurrenceDate?: string | null
    returnQuickEdit?: { dateKey: string; date: Date; anchorRect: AnchorRect | null } | null
  } | null>(null)
  const [scopeDialog, setScopeDialog] = useState<{
    mode: 'edit' | 'delete' | 'complete' | 'shift'
  } | null>(null)
  const [shiftingEvent, setShiftingEvent] = useState(false)
  const [pendingEdit, setPendingEdit] = useState<{
    master: CalendarEvent
    occurrenceDate: string
    needsScope: boolean
    payload?: Record<string, unknown>
  } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{
    master: CalendarEvent
    occurrenceDate: string
  } | null>(null)
  const [pendingComplete, setPendingComplete] = useState<{
    master: CalendarEvent
    occurrenceDate: string
    completed: boolean
  } | null>(null)
  const [pendingShift, setPendingShift] = useState<{
    master: CalendarEvent
    occurrenceDate: string
    deltaDays: number
  } | null>(null)
  /** Search-opened detail may stay up even while grid hide toggles are on (MDC). */
  const detailFromSearchRef = useRef(false)

  /** MDC App.clearEventDetail — detail only; keep quickEdit (delete-cancel / detail X). */
  const clearEventDetail = useCallback((): void => {
    detailFromSearchRef.current = false
    setEventPopover(null)
  }, [])

  // Browser / unlocked-desktop inline overlays: close detail/editor/scope after delete.
  // Keep quickEdit mounted — list refreshes from the shared store.
  useEffect(() => {
    const onDismiss = (event: Event): void => {
      const phase = (event as CustomEvent<EventUiDismissDetail>).detail?.phase
      if (phase === 'immediate') {
        clearEventDetail()
        setEditor(null)
        setPendingEdit(null)
        setScopeDialog(null)
        setPendingDelete(null)
      }
    }
    window.addEventListener(EVENT_UI_DISMISS_AFTER_DELETE, onDismiss)
    return () => window.removeEventListener(EVENT_UI_DISMISS_AFTER_DELETE, onDismiss)
  }, [clearEventDetail])

  useEffect(() => {
    if (footerHintPaused) return undefined
    const id = window.setInterval(() => {
      setFooterHintNav((nav) =>
        advanceFooterHintNav(nav, pickRandomFooterHintIndex(nav.index))
      )
    }, FOOTER_HINT_ROTATE_MS)
    return () => window.clearInterval(id)
  }, [footerHintPaused, footerHintIndex])

  // MDC login wall: first launch / cold start without session → login dialog.
  const autoLoginPromptedRef = useRef(false)

  const chromeRef = useRef<HTMLDivElement | null>(null)
  const periodHeaderRef = useRef<HTMLDivElement | null>(null)

  const monthBodyRef = useRef<HTMLDivElement | null>(null)
  const publishHitZonesRef = useRef<(() => void) | null>(null)
  const lastDayZoneCountRef = useRef(-1)
  const modeEmbeddedRef = useRef({
    mode,
    embedded,
    floatingPanels: usesFloatingPanels(mode, embedded)
  })
  const userRef = useRef(user)
  userRef.current = user
  const promptLoginRef = useRef<() => void>(() => undefined)
  const goToMonthViewRef = useRef<(monthIndex: number) => void>(() => undefined)
  modeEmbeddedRef.current = {
    mode,
    embedded,
    floatingPanels: usesFloatingPanels(mode, embedded)
  }
  const inlineOverlays = usesInlineOverlays(mode, embedded)
  const floatingPanels = usesFloatingPanels(mode, embedded)

  const openInlineChromePanel = useCallback((init: PanelWindowInit): void => {
    switch (init.kind) {
      case 'search':
        setSettingsOpen(false)
        setSearchOpen(true)
        break
      case 'settings':
        setSearchOpen(false)
        setSettingsOpen(true)
        break
      case 'login':
        setLoginError(null)
        setLoginOpen(true)
        break
      case 'dayListPreview':
        setDayListPreviewOpen(true)
        break
      case 'headerTitleEditor':
        setHeaderTitleEditorOpen(true)
        break
      case 'footerHelp':
        setFooterHelpOpen(true)
        break
      default:
        break
    }
  }, [])

  const openEmbeddedPanel = useCallback(
    (init: PanelWindowInit, anchorClient?: PanelAnchorRect | null): void => {
      if (isBrowserNeoCalendarHost()) {
        openInlineChromePanel(init)
        return
      }
      const payload = {
        ...init,
        ...(anchorClient ? { anchorClient } : {})
      } as OpenPanelWindowRequest
      void window.neoCalendar.openPanelWindow?.(payload)?.then((opened) => {
        if (opened === false) openInlineChromePanel(init)
      })
    },
    [openInlineChromePanel]
  )

  const promptLogin = useCallback((): void => {
    setLoginError(null)
    if (isBrowserNeoCalendarHost()) {
      setLoginOpen(true)
      return
    }
    if (floatingPanels) {
      openEmbeddedPanel({ kind: 'login', dismissible: true })
      return
    }
    setLoginOpen(true)
  }, [floatingPanels, openEmbeddedPanel])
  promptLoginRef.current = promptLogin

  const requireEdit = useCallback((): boolean => {
    if (canEdit) return true
    promptLogin()
    return false
  }, [canEdit, promptLogin])

  const handleUndo = useCallback(async () => {
    if (!requireEdit() || !canUndo) return
    try {
      await undo()
      clearEventDetail()
      setQuickEdit(null)
    } catch (err) {
      await alert(err instanceof Error ? err.message : '실행 취소에 실패했습니다.')
    }
  }, [alert, canUndo, clearEventDetail, requireEdit, undo])

  const handleRedo = useCallback(async () => {
    if (!requireEdit() || !canRedo) return
    try {
      await redo()
      clearEventDetail()
      setQuickEdit(null)
    } catch (err) {
      await alert(err instanceof Error ? err.message : '다시 실행에 실패했습니다.')
    }
  }, [alert, canRedo, clearEventDetail, redo, requireEdit])

  useUndoRedoShortcuts({
    canUndo: canEdit && canUndo,
    canRedo: canEdit && canRedo,
    onUndo: handleUndo,
    onRedo: handleRedo,
    enabled: canEdit
  })

  useEffect(() => {
    if (autoLoginPromptedRef.current || loading || !authReady || user) return
    autoLoginPromptedRef.current = true
    setLoginError(null)

    if (isBrowserNeoCalendarHost()) {
      setLoginOpen(true)
      return
    }

    if (floatingPanels) {
      openEmbeddedPanel({ kind: 'login', dismissible: false })
      return
    }

    // Unlocked desktop cold-start: keep desktop mode so idle embed still arms.
    // Do not enterWindow() — that permanently persists window mode.
    setLoginOpen(true)
  }, [authReady, floatingPanels, loading, openEmbeddedPanel, user])

  useEffect(() => {
    return subscribeAuthUserSync((next) => {
      onUserChange(next)
      void refresh()
    })
  }, [onUserChange, refresh])

  const eventsHidden = store.settings.viewOptions.eventsHidden
  const completedHidden = store.settings.viewOptions.completedHidden
  const storedHeaderCollapsed = Boolean(store.settings.viewOptions.headerCollapsed)
  const [guestHeaderCollapsed, setGuestHeaderCollapsed] = useState(false)
  const headerCollapsed = canEdit ? storedHeaderCollapsed : guestHeaderCollapsed
  const prevHeaderCollapsedRef = useRef<boolean | null>(null)
  const eventDensity = normalizeEventDensity(store.settings.viewOptions.eventDensity)
  const showWeekNumbers = store.settings.viewOptions.showWeekNumbers !== false
  const roundedCorners = Boolean(store.settings.viewOptions.roundedCorners)
  const dayColors = store.settings.dayColors ?? {}
  const dayHighlights = store.settings.dayHighlights ?? {}
  const weekStartsOn: 0 | 1 =
    settings?.weekStartsOn ?? (store.settings.viewOptions.weekStartsOnSunday === false ? 1 : 0)

  const openSearch = useCallback((): void => {
    setSettingsOpen(false)
    if (isBrowserNeoCalendarHost()) {
      setSearchOpen(true)
      return
    }
    if (floatingPanels) {
      openEmbeddedPanel({ kind: 'search', eventsHidden })
      return
    }
    setSearchOpen(true)
  }, [eventsHidden, floatingPanels, openEmbeddedPanel])

  const openSettingsPanel = useCallback((): void => {
    if (!requireEdit()) return
    if (isBrowserNeoCalendarHost()) {
      setSearchOpen(false)
      setSettingsOpen(true)
      return
    }
    if (floatingPanels) {
      openEmbeddedPanel({ kind: 'settings' })
      return
    }
    setSearchOpen(false)
    setSettingsOpen(true)
  }, [floatingPanels, openEmbeddedPanel, requireEdit])

  // WorkerW-embedded: publish period-toolbar + visible day-cell hit zones.
  useLayoutEffect(() => {
    const api = window.neoCalendar
    if (!api?.setClickForwardHitZones || !api.setDayCellHitZones || !api.setDayDblClickExcludeZones)
      return

    const publish = (): void => {
      const { mode: currentMode, embedded: isEmbedded } = modeEmbeddedRef.current
      if (currentMode !== 'desktop' || !isEmbedded) {
        api.setClickForwardHitZones([])
        api.setDayCellHitZones([])
        api.setDayDblClickExcludeZones([])
        return
      }

      const periodRoot = periodHeaderRef.current
      const toolbarZones = periodRoot
        ? Array.from(periodRoot.querySelectorAll<HTMLElement>('[data-toolbar-action]')).flatMap(
            (el) => {
              if (el instanceof HTMLButtonElement && el.disabled) return []
              const action = el.dataset.toolbarAction ?? ''
              if (
                !action ||
                (!PERIOD_TOOLBAR_ACTION_ID_SET.has(action) &&
                  !EMBEDDED_HEADER_CHROME_ACTIONS.has(action) &&
                  !EMBEDDED_FLOATING_CHROME_ACTIONS.has(action) &&
                  !EMBEDDED_MODE_CHROME_ACTIONS.has(action) &&
                  !EMBEDDED_EXPORT_CHROME_ACTIONS.has(action))
              )
                return []
              const r = el.getBoundingClientRect()
              if (r.width < 1 || r.height < 1) return []
              return [
                {
                  x: Math.round(r.left),
                  y: Math.round(r.top),
                  width: Math.round(r.width),
                  height: Math.round(r.height),
                  action
                }
              ]
            }
          )
        : []

      const chromeRoot = chromeRef.current
      const chromeZones = chromeRoot
        ? Array.from(chromeRoot.querySelectorAll<HTMLElement>('[data-toolbar-action]')).flatMap(
            (el) => {
              if (el instanceof HTMLButtonElement && el.disabled) return []
              const action = el.dataset.toolbarAction ?? ''
              if (
                !action ||
                (!EMBEDDED_FLOATING_CHROME_ACTIONS.has(action) &&
                  !EMBEDDED_MODE_CHROME_ACTIONS.has(action) &&
                  !EMBEDDED_EXPORT_CHROME_ACTIONS.has(action) &&
                  !EMBEDDED_AUTH_CHROME_ACTIONS.has(action) &&
                  !EMBEDDED_HEADER_CHROME_ACTIONS.has(action) &&
                  !EMBEDDED_RELOAD_CHROME_ACTIONS.has(action))
              )
                return []
              const r = el.getBoundingClientRect()
              if (r.width < 1 || r.height < 1) return []
              // Centered header title is easy to miss — enlarge its embedded hit box.
              const pad =
                action === CHROME_TOOLBAR_ACTIONS.editHeaderTitle
                  ? { x: 6, y: 8 }
                  : { x: 0, y: 0 }
              return [
                {
                  x: Math.round(r.left - pad.x),
                  y: Math.round(r.top - pad.y),
                  width: Math.round(r.width + pad.x * 2),
                  height: Math.round(r.height + pad.y * 2),
                  action
                }
              ]
            }
          )
        : []
      const footerZones = Array.from(
        document.querySelectorAll<HTMLElement>(
          '.neo-cal-shell [data-shell-chrome="footer"] [data-toolbar-action]'
        )
      ).flatMap((el) => {
        if (el instanceof HTMLButtonElement && el.disabled) return []
        const action = el.dataset.toolbarAction ?? ''
        if (
          !action ||
          (!EMBEDDED_FOOTER_HINT_ACTIONS.has(action) && !EMBEDDED_FOOTER_LINK_ACTIONS.has(action))
        )
          return []
        const r = el.getBoundingClientRect()
        if (r.width < 1 || r.height < 1) return []
        return [
          {
            x: Math.round(r.left),
            y: Math.round(r.top),
            width: Math.round(r.width),
            height: Math.round(r.height),
            action
          }
        ]
      })
      // Year-view month titles: WorkerW double-click → month view (not click-through).
      const yearMonthZones = Array.from(
        document.querySelectorAll<HTMLElement>(
          '.neo-cal-shell .year-month-title[data-toolbar-action]'
        )
      ).flatMap((el) => {
        const action = el.dataset.toolbarAction ?? ''
        if (!action || !PERIOD_TOOLBAR_ACTION_ID_SET.has(action)) return []
        const r = el.getBoundingClientRect()
        if (r.width < 1 || r.height < 1) return []
        // Slightly taller hit box so “3월” is easy to double-click under icons.
        const padY = 4
        return [
          {
            x: Math.round(r.left),
            y: Math.round(r.top - padY),
            width: Math.round(r.width),
            height: Math.round(r.height + padY * 2),
            action
          }
        ]
      })
      api.setClickForwardHitZones([
        ...toolbarZones,
        ...chromeZones,
        ...footerZones,
        ...yearMonthZones
      ])

      const vw = window.innerWidth
      const vh = window.innerHeight
      const dayZoneSelectors = [
        '.neo-cal-shell .day-cell[data-date-key]',
        '.neo-cal-shell .year-day[data-date-key]'
      ].join(', ')
      const dayZones = Array.from(
        document.querySelectorAll<HTMLElement>(dayZoneSelectors)
      ).flatMap((el) => {
        const dateKey = el.dataset.dateKey ?? ''
        if (!dateKey) return []
        if (el instanceof HTMLButtonElement && el.disabled) return []
        // Other-month pads must not get WorkerW hit zones (desktop clicks
        // outside the in-month grid would open prev/next month quick edit).
        if (el.classList.contains('other-month')) return []
        const r = el.getBoundingClientRect()
        if (r.width < 1 || r.height < 1) return []
        if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return []
        const hit = publishDayCellHitRect(el, r, weekStartsOn)
        return [
          {
            ...hit,
            dateKey
          }
        ]
      })
      api.setDayCellHitZones(dayZones)

      if (dayZones.length !== lastDayZoneCountRef.current) {
        lastDayZoneCountRef.current = dayZones.length
        console.log('[day-dblclick] renderer published zones', dayZones.length)
      }

      const excludeZones = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-shell-chrome="header"], [data-shell-chrome="header-actions"], [data-shell-chrome="period-header"], [data-shell-chrome="footer"], [data-shell-chrome="weekday-header"], .year-month-title'
        )
      ).flatMap((el) => {
        const r = el.getBoundingClientRect()
        if (r.width < 1 || r.height < 1) return []
        return [
          {
            x: Math.round(r.left),
            y: Math.round(r.top),
            width: Math.round(r.width),
            height: Math.round(r.height)
          }
        ]
      })
      api.setDayDblClickExcludeZones(excludeZones)
      api.setDesktopQuickEditContext?.({ viewMode, eventsHidden })
    }

    publishHitZonesRef.current = publish
    publish()
    const ro = new ResizeObserver(publish)
    const chrome = chromeRef.current
    const period = periodHeaderRef.current
    const body = monthBodyRef.current
    if (chrome) ro.observe(chrome)
    if (period) ro.observe(period)
    if (body) ro.observe(body)
    body?.addEventListener('scroll', publish, { passive: true })
    window.addEventListener('resize', publish)
    return () => {
      publishHitZonesRef.current = null
      ro.disconnect()
      body?.removeEventListener('scroll', publish)
      window.removeEventListener('resize', publish)
      api.setClickForwardHitZones([])
      api.setDayCellHitZones([])
      api.setDayDblClickExcludeZones([])
    }
  }, [
    mode,
    embedded,
    viewMode,
    viewDate,
    weekStartsOn,
    eventsHidden,
    completedHidden,
    webEditUrl,
    searchOpen,
    settingsOpen,
    exporting,
    modeBusy,
    switchReady,
    user,
    footerHintPaused,
    canGoPrevFooterHint,
    footerHelpOpen,
    store.settings.viewOptions.headerTitle,
    storedHeaderCollapsed,
    guestHeaderCollapsed
  ])

  // Re-publish after embed (WorkerW blocks forwarded mousemove).
  useEffect(() => {
    if (mode !== 'desktop' || !embedded) return
    const republish = (): void => publishHitZonesRef.current?.()
    republish()
    const raf = requestAnimationFrame(republish)
    const t = window.setTimeout(republish, 100)
    const interval = window.setInterval(republish, 800)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(t)
      window.clearInterval(interval)
    }
  }, [
    mode,
    embedded,
    viewMode,
    viewDate,
    weekStartsOn,
    eventsHidden,
    completedHidden,
    webEditUrl,
    searchOpen,
    settingsOpen,
    exporting,
    modeBusy,
    switchReady,
    user,
    store.settings.viewOptions.headerTitle,
    storedHeaderCollapsed,
    guestHeaderCollapsed
  ])
  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()

  const openDayListPreview = useCallback((): void => {
    if (!requireEdit()) return
    if (isBrowserNeoCalendarHost() || !floatingPanels) {
      setDayListPreviewOpen((open) => !open)
      return
    }
    // Floating panel: openEmbedded toggles close when already open.
    if (dayListPreviewOpen) {
      window.neoCalendar.closePanelSlot?.('dayListPreview')
      setDayListPreviewOpen(false)
      return
    }
    openEmbeddedPanel({ kind: 'dayListPreview', year, month })
    setDayListPreviewOpen(true)
  }, [dayListPreviewOpen, floatingPanels, month, openEmbeddedPanel, requireEdit, year])

  // Floating 세로보기 closed via X / Esc — keep toolbar pressed state in sync.
  useEffect(() => {
    const api = window.neoCalendar
    if (!api?.onDayListPreviewOpenChanged) return
    return api.onDayListPreviewOpenChanged((open) => {
      setDayListPreviewOpen(open)
    })
  }, [])

  const openHeaderTitleEditor = useCallback((): void => {
    if (!requireEdit()) return
    if (isBrowserNeoCalendarHost() || !floatingPanels) {
      setHeaderTitleEditorOpen(true)
      return
    }
    // Stay WorkerW-embedded — same as search/settings. Do not call focusForTextInput
    // on the main window (that suspends under-icons / unlocks).
    openEmbeddedPanel({ kind: 'headerTitleEditor' })
  }, [floatingPanels, openEmbeddedPanel, requireEdit])

  const openFooterHelp = useCallback((): void => {
    if (isBrowserNeoCalendarHost() || !floatingPanels) {
      setFooterHelpOpen((open) => !open)
      return
    }
    openEmbeddedPanel({ kind: 'footerHelp' })
  }, [floatingPanels, openEmbeddedPanel])
  const openHeaderTitleEditorRef = useRef(openHeaderTitleEditor)
  openHeaderTitleEditorRef.current = openHeaderTitleEditor

  const weekdayLabels = useMemo(() => {
    if (weekStartsOn === 1) {
      return [...WEEKDAYS_KO.slice(1), WEEKDAYS_KO[0]]
    }
    return [...WEEKDAYS_KO]
  }, [weekStartsOn])

  const monthWeeks = useMemo(
    () => buildMonthWeeks(year, month, weekStartsOn),
    [year, month, weekStartsOn]
  )
  const weekDays = useMemo(() => buildWeekDays(viewDate, weekStartsOn), [viewDate, weekStartsOn])

  const viewDateRef = useRef(viewDate)
  viewDateRef.current = viewDate
  const hasInitialScrollRef = useRef(false)
  const prevViewMonthRef = useRef('')
  const prevWeeksInViewportRef = useRef(0)
  /** Chrome/toolbar nav: ignore scroll-derived month until settle (stops flicker + dead clicks). */
  const chromeNavLockUntilRef = useRef(0)
  const viewModeRef = useRef(viewMode)
  viewModeRef.current = viewMode
  const prevViewModeForAlignRef = useRef(viewMode)

  const lockChromeNav = (ms = 450): void => {
    chromeNavLockUntilRef.current = Date.now() + ms
  }

  /**
   * Always anchor the infinite buffer on the viewed month's day-1.
   * Keeping a stale buffer and only scrolling caused Sunday-start months
   * (e.g. 2027-08) to land one week early (Jul 25…31 as the first row).
   * With day-1 as anchor, that week is always at index WEEKS_BEFORE.
   */
  const weekRangeAnchor = useMemo(() => new Date(year, month, 1), [year, month])

  /** MDC infinite buffer (~113 weeks) mapped to DayCells for the header month. */
  const scrollWeeks = useMemo(() => {
    const raw = generateWeekRange(weekRangeAnchor, weekStartsOn, WEEKS_BEFORE, WEEKS_AFTER)
    return raw.map((week) => mapWeekToDayCells(week, year, month))
  }, [weekRangeAnchor, weekStartsOn, year, month])

  const effectiveWeeksInViewport =
    viewMode === 'week' ? 1 : viewMode === 'month' ? getWeeksInMonth(year, month, weekStartsOn) : 0

  /** MDC: row height ÷ weeks → how many bars fit before "더보기". */
  const eventLayout = useMaxVisibleEvents(
    monthBodyRef,
    effectiveWeeksInViewport,
    eventDensity,
    headerCollapsed
  )
  const eventCapacity = eventLayout
  const eventLayoutCssVars = eventLayout.cssVars

  const layoutEvents = useMemo(
    () => (completedHidden ? visibleEvents.filter((event) => !event.completed) : visibleEvents),
    [visibleEvents, completedHidden]
  )

  const monthWeekLayouts = useMemo(
    () =>
      buildAllWeekEventLayouts(scrollWeeks, layoutEvents, store.tags) as Map<
        string,
        Record<string, DaySegment[]>
      >,
    [scrollWeeks, layoutEvents, store.tags]
  )

  const weekViewLayout = useMemo(
    () =>
      buildWeekEventLayout(weekDays, layoutEvents, store.tags) as Record<string, DaySegment[]>,
    [weekDays, layoutEvents, store.tags]
  )

  const segmentsForDay = useCallback(
    (cell: DayCell, weeks: DayCell[][]): DaySegment[] => {
      if (viewMode === 'week') return weekViewLayout[cell.dateKey] ?? []
      const week = weeks.find((row) => row.some((d) => d.dateKey === cell.dateKey))
      if (!week) return []
      const layout = monthWeekLayouts.get(toWeekStartKey(week))
      return layout?.[cell.dateKey] ?? []
    },
    [viewMode, weekViewLayout, monthWeekLayouts]
  )

  const wheelLocked = Boolean(
    quickEdit ||
      searchOpen ||
      settingsOpen ||
      loginOpen ||
      eventPopover ||
      editor ||
      scopeDialog
  )

  const {
    setWeekRef,
    scrollToMonth,
    consumeSkipScroll
  } = useMonthWeekScroll({
    scrollRef: monthBodyRef,
    weeks: scrollWeeks,
    weeksInViewport: effectiveWeeksInViewport,
    onVisibleMonthChange: (nextYear: number, nextMonth1: number) => {
      // Ignore trailing scroll reports from the previous mode's container (MDC viewModeRef).
      if (viewModeRef.current !== 'month') return
      if (Date.now() < chromeNavLockUntilRef.current) return
      const cur = viewDateRef.current
      if (cur.getFullYear() === nextYear && cur.getMonth() === nextMonth1 - 1) return
      setViewDate(new Date(nextYear, nextMonth1 - 1, 1))
    },
    // Desktop / window / browser (tablet): never navigate month/week by wheel or swipe.
    wheelLocked: wheelLocked || mode === 'desktop' || mode === 'window' || !canEdit
  })

  const scrollToMonthRef = useRef(scrollToMonth)
  scrollToMonthRef.current = scrollToMonth

  useLayoutEffect(() => {
    if (viewMode !== 'month') {
      prevViewModeForAlignRef.current = viewMode
      return
    }

    // Week/year unmount the infinite month body — remount starts at scrollTop 0
    // (~buffer start, often a prior month). Same monthKey must still realign.
    const enteredMonth = prevViewModeForAlignRef.current !== 'month'
    prevViewModeForAlignRef.current = viewMode

    const monthKey = `${year}-${month}`
    const weeksCountChanged = prevWeeksInViewportRef.current !== effectiveWeeksInViewport
    prevWeeksInViewportRef.current = effectiveWeeksInViewport

    const prevHeaderCollapsed = prevHeaderCollapsedRef.current
    const headerChromeChanged =
      prevHeaderCollapsed !== null && prevHeaderCollapsed !== headerCollapsed
    prevHeaderCollapsedRef.current = headerCollapsed

    if (!hasInitialScrollRef.current) {
      hasInitialScrollRef.current = true
      scrollToMonthRef.current(year, month, weekStartsOn, 'auto')
      prevViewMonthRef.current = monthKey
      return
    }

    if (
      enteredMonth ||
      prevViewMonthRef.current !== monthKey ||
      weeksCountChanged ||
      headerChromeChanged
    ) {
      if (weeksCountChanged || enteredMonth || headerChromeChanged) consumeSkipScroll()
      prevViewMonthRef.current = monthKey
      // Buffer remounts on month change (day-1 anchor) — pin before paint.
      // Header fold/unfold also re-pins the *current* month so week rows use the new cqh.
      scrollToMonthRef.current(year, month, weekStartsOn, 'auto')
    }
  }, [
    viewMode,
    year,
    month,
    weekStartsOn,
    effectiveWeeksInViewport,
    scrollWeeks,
    consumeSkipScroll,
    headerCollapsed
  ])

  // Window / browser resize changes `cqh` week-row height but leaves scrollTop in
  // old pixels, so rows sit off the week grid until 「오늘」 re-pins. Re-pin the
  // header month (not today) whenever the month body size actually changes.
  useEffect(() => {
    if (viewMode !== 'month') return undefined
    const container = monthBodyRef.current
    if (!container || typeof ResizeObserver === 'undefined') return undefined

    let raf = 0
    let lastH = container.clientHeight
    let lastW = container.clientWidth

    const realign = (): void => {
      raf = 0
      const el = monthBodyRef.current
      if (!el) return
      const h = el.clientHeight
      const w = el.clientWidth
      if (h < 8 || w < 8) return
      if (h === lastH && w === lastW) return
      lastH = h
      lastW = w
      consumeSkipScroll()
      const current = viewDateRef.current
      scrollToMonthRef.current(current.getFullYear(), current.getMonth(), weekStartsOn, 'auto')
    }

    const schedule = (): void => {
      if (raf) return
      raf = window.requestAnimationFrame(realign)
    }

    const observer = new ResizeObserver(schedule)
    observer.observe(container)
    window.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('resize', schedule)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('resize', schedule)
      if (raf) window.cancelAnimationFrame(raf)
    }
  }, [viewMode, weekStartsOn, consumeSkipScroll])

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const event of visibleEvents) {
      const keys = eachDateKey(event.startDate, event.endDate || event.startDate)
      for (const key of keys) {
        const list = map.get(key) ?? []
        list.push(event)
        map.set(key, list)
      }
    }
    return map
  }, [visibleEvents])

  /** Dates with 대한민국의 휴일 events — day numeral uses Sunday red. */
  const holidayKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const event of visibleEvents) {
      if (event.calendarId !== HOLIDAYS_KR_CALENDAR_ID) continue
      for (const key of eachDateKey(event.startDate, event.endDate || event.startDate)) {
        keys.add(key)
      }
    }
    return keys
  }, [visibleEvents])

  const periodTitle =
    viewMode === 'year'
      ? `${year}년`
      : viewMode === 'week'
        ? formatWeekTitle(viewDate, weekStartsOn)
        : `${year}년 ${month + 1}월`

  const closeOverlays = useCallback((): void => {
    setQuickEdit(null)
    detailFromSearchRef.current = false
    setEventPopover(null)
    setEditor(null)
    setScopeDialog(null)
    setPendingEdit(null)
    setPendingDelete(null)
    setPendingComplete(null)
    setPendingShift(null)
    setSearchOpen(false)
    setSettingsOpen(false)
    setLoginOpen(false)
    setLoginError(null)
    setHeaderTitleEditorOpen(false)
    setExportOptionsOpen(false)
    setDayListPreviewOpen(false)
    setFooterHelpOpen(false)
    // Floating panels may outlive React state — ask main to tear them down too.
    window.neoCalendar?.closePanelSlot?.('dayListPreview')
    window.neoCalendar?.closePanelSlot?.('search')
    window.neoCalendar?.closePanelSlot?.('settings')
    window.neoCalendar?.closePanelSlot?.('eventEditor')
    window.neoCalendar?.closePanelSlot?.('eventDetail')
    window.neoCalendar?.closePanelSlot?.('quickEdit')
    window.neoCalendar?.closePanelSlot?.('headerTitleEditor')
    window.neoCalendar?.closePanelSlot?.('exportOptions')
    window.neoCalendar?.closePanelSlot?.('recurrenceScope')
    window.neoCalendar?.closePanelSlot?.('login')
    window.neoCalendar?.closePanelSlot?.('footerHelp')
  }, [])

  // Keep open detail in sync when store patches the same event (preserve occurrence day).
  useEffect(() => {
    if (!eventPopover) return
    const seriesId = getSeriesId(eventPopover.event) || eventPopover.event.id
    const next =
      store.events.find((item) => item.id === seriesId || item.id === eventPopover.event.id) ??
      null
    if (!next) {
      clearEventDetail()
      return
    }
    setEventPopover((prev) => {
      if (!prev) return null
      const occurrenceDate = prev.event.occurrenceDate
      const merged = occurrenceDate ? { ...next, occurrenceDate } : next
      if (
        prev.event.title === merged.title &&
        prev.event.completed === merged.completed &&
        prev.event.description === merged.description &&
        prev.event.calendarId === merged.calendarId
      ) {
        return prev
      }
      return { ...prev, event: merged }
    })
  }, [store.events, eventPopover?.event.id, clearEventDetail])

  // MDC: hide-events / hide-completed dismisses bar detail (search-opened stays).
  useEffect(() => {
    if (!eventsHidden) return
    if (detailFromSearchRef.current) return
    clearEventDetail()
  }, [eventsHidden, clearEventDetail])

  useEffect(() => {
    if (!completedHidden || !eventPopover?.event.completed) return
    if (detailFromSearchRef.current) return
    clearEventDetail()
  }, [completedHidden, eventPopover?.event.completed, clearEventDetail])

  const dismissEditorAfterSave = useCallback((): void => {
    const back = editor?.returnQuickEdit ?? null
    setEditor(null)
    setPendingEdit(null)
    if (back) {
      setInlineFrontPanel('quickEdit')
      setQuickEdit(back)
    }
  }, [editor?.returnQuickEdit])

  const applyRecurringEdit = useCallback(
    async (
      master: CalendarEvent,
      payload: Record<string, unknown>,
      occurrenceDate: string,
      scope: 'single' | 'following' | 'all'
    ): Promise<void> => {
      await applyRecurringEditCore(
        { addEvent, editEvent, removeEvent },
        master,
        payload,
        occurrenceDate,
        scope,
        store.events
      )
    },
    [addEvent, editEvent, removeEvent, store.events]
  )

  const shiftMonth = (delta: number): void => {
    lockChromeNav()
    setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1))
    setQuickEdit(null)
  }

  const shiftYear = (delta: number): void => {
    lockChromeNav()
    setViewDate((prev) => new Date(prev.getFullYear() + delta, prev.getMonth(), 1))
    setQuickEdit(null)
  }

  const shiftWeek = (delta: number): void => {
    lockChromeNav()
    setViewDate((prev) => addDays(prev, delta * 7))
    setQuickEdit(null)
  }

  const onPrev = (): void => {
    if (!requireEdit()) return
    if (viewMode === 'year') shiftYear(-1)
    else if (viewMode === 'week') shiftWeek(-1)
    else shiftMonth(-1)
  }

  const onNext = (): void => {
    if (!requireEdit()) return
    if (viewMode === 'year') shiftYear(1)
    else if (viewMode === 'week') shiftWeek(1)
    else shiftMonth(1)
  }

  const goToday = (): void => {
    if (!requireEdit()) return
    lockChromeNav(500)
    const d = new Date()
    if (viewMode === 'month') {
      // Day-1 of current month so header + infinite scroll stay on this month.
      setViewDate(new Date(d.getFullYear(), d.getMonth(), 1))
    } else {
      setViewDate(new Date(d.getFullYear(), d.getMonth(), d.getDate()))
    }
    setSelectedKey(toDateKey(d.getFullYear(), d.getMonth(), d.getDate()))
    setQuickEdit(null)
    // Force month-body realign even when year/month did not change (same as MDC token).
    if (viewMode === 'month') {
      prevViewMonthRef.current = ''
      scrollToMonthRef.current(d.getFullYear(), d.getMonth(), weekStartsOn, 'auto')
    }
  }

  const handleViewModeChange = (nextMode: ViewMode): void => {
    if (!requireEdit()) return
    lockChromeNav(500)
    if (nextMode === 'month' || nextMode === 'year') {
      setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth(), 1))
    } else if (nextMode === 'week') {
      const fromSelected = selectedKey ? parseDateKeyLocal(selectedKey) : null
      const anchor = fromSelected ?? viewDateRef.current
      setViewDate(new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate()))
    }
    setViewMode(nextMode)
  }

  const rectFromTarget = (target: EventTarget | null): AnchorRect | null => {
    const el = target instanceof Element ? target.closest('.day-cell') : null
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height
    }
  }

  const focusDayCell = useCallback((dateKey: string): void => {
    setSelectedKey(dateKey)
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        `.neo-cal-shell .day-cell[data-date-key="${dateKey}"], .neo-cal-shell .year-day[data-date-key="${dateKey}"]`
      )
      if (!el) return
      try {
        el.focus({ preventScroll: true })
      } catch {
        el.focus()
      }
    })
  }, [])

  const focusDayCellRef = useRef(focusDayCell)
  focusDayCellRef.current = focusDayCell

  const openQuickEdit = (
    cell: DayCell,
    eventOrRect?: MouseEvent | DOMRect | null
  ): void => {
    if (!requireEdit()) return
    setEventPopover(null)
    focusDayCell(cell.dateKey)
    let anchorRect: AnchorRect | null = null
    if (eventOrRect instanceof DOMRect) {
      anchorRect = {
        top: eventOrRect.top,
        left: eventOrRect.left,
        width: eventOrRect.width,
        height: eventOrRect.height
      }
    } else if (eventOrRect) {
      anchorRect = rectFromTarget(eventOrRect.currentTarget)
    }
    const { floatingPanels } = modeEmbeddedRef.current
    if (floatingPanels) {
      openEmbeddedPanel(
        {
          kind: 'quickEdit',
          dateKey: cell.dateKey,
          viewMode,
          eventsHidden,
          anchor: anchorRect
        },
        anchorRect
      )
      return
    }
    setInlineFrontPanel('quickEdit')
    setQuickEdit({
      dateKey: cell.dateKey,
      date: cell.date,
      anchorRect
    })
  }

  const openQuickEditFromDate = (date: Date, rect?: DOMRect | null): void => {
    // Month grid: ignore leading/trailing (other-month) days — no quick edit.
    if (viewMode === 'month') {
      const vd = viewDateRef.current
      if (date.getFullYear() !== vd.getFullYear() || date.getMonth() !== vd.getMonth()) {
        return
      }
    }
    const dateKey = toDateKey(date.getFullYear(), date.getMonth(), date.getDate())
    openQuickEdit(
      {
        day: date.getDate(),
        dateKey,
        inMonth: true,
        isToday: false,
        weekday: date.getDay(),
        date
      },
      rect ?? null
    )
  }

  useEffect(() => {
    const api = window.neoCalendar
    if (!api?.onFocusDayCell) return
    return api.onFocusDayCell(({ dateKey }) => {
      focusDayCellRef.current(dateKey)
    })
  }, [])

  useEffect(() => {
    const onTheme = (): void => setThemeEpoch((n) => n + 1)
    window.addEventListener('neocalendar:colorSchemeEffective', onTheme)
    return () => window.removeEventListener('neocalendar:colorSchemeEffective', onTheme)
  }, [])

  useEffect(() => {
    const api = window.neoCalendar
    if (!api?.onModeChanged) return
    return api.onModeChanged((status) => {
      onModeChange(status.mode)
      if (status.mode === 'window') {
        closeOverlays()
        return
      }
      // Re-embed / enter desktop under icons — clear overlays so they aren't stranded
      // on a click-through WorkerW surface. Do NOT clear on temporary unlock (suspend).
      if (status.mode === 'desktop' && status.embedded) {
        const needsLogin = !userRef.current
        closeOverlays()
        // Guest cold-start login was cleared above; reopen on floating surface (embedded).
        if (needsLogin) {
          autoLoginPromptedRef.current = false
          queueMicrotask(() => {
            if (userRef.current || autoLoginPromptedRef.current) return
            autoLoginPromptedRef.current = true
            setLoginError(null)
            if (isBrowserNeoCalendarHost()) {
              setLoginOpen(true)
              return
            }
            openEmbeddedPanel({ kind: 'login', dismissible: false })
          })
        }
        requestAnimationFrame(() => publishHitZonesRef.current?.())
      }
    })
  }, [onModeChange, closeOverlays, openEmbeddedPanel])

  const openQuickEditFromDateRef = useRef(openQuickEditFromDate)
  openQuickEditFromDateRef.current = openQuickEditFromDate

  // WorkerW embedded: main opens floating quick-edit window (no full unlock).
  useEffect(() => {
    const api = window.neoCalendar
    if (!api?.onOpenDayQuickEdit) return
    return api.onOpenDayQuickEdit((payload) => {
      if (!userRef.current) {
        promptLoginRef.current()
        return
      }
      // Legacy inline unlock path (non-embedded fallback).
      console.log('[day-dblclick] renderer open quick edit (inline)', payload)
      const date =
        parseDateKeyLocal(payload.dateKey) ?? parseDateKey(payload.dateKey)
      if (!date) return
      const el = document.querySelector<HTMLElement>(
        `.neo-cal-shell .day-cell[data-date-key="${payload.dateKey}"], .neo-cal-shell .year-day[data-date-key="${payload.dateKey}"]`
      )
      const rect =
        el?.getBoundingClientRect() ??
        (typeof payload.clientX === 'number' && typeof payload.clientY === 'number'
          ? new DOMRect(payload.clientX, payload.clientY, 48, 48)
          : null)
      openQuickEditFromDateRef.current(date, rect)
      requestAnimationFrame(() => {
        void api.focusForTextInput?.()
      })
    })
  }, [])

  // Dev: mirror main-process day-dblclick logs into DevTools Console.
  useEffect(() => {
    const api = window.neoCalendar
    if (!api?.onDayDblClickLog) return
    return api.onDayDblClickLog(({ msg, data }) => {
      if (data) console.log(msg, data)
      else console.log(msg)
    })
  }, [])

  // WorkerW embedded: period toolbar click → synthesize button (stay embedded).
  useEffect(() => {
    const api = window.neoCalendar
    if (!api?.onToolbarClick) return
    return api.onToolbarClick(({ action }) => {
      const toolbarActionSet = PERIOD_TOOLBAR_ACTION_ID_SET
      const chromeActionSet = new Set([
        ...Array.from(EMBEDDED_FLOATING_CHROME_ACTIONS),
        ...Array.from(EMBEDDED_MODE_CHROME_ACTIONS),
        ...Array.from(EMBEDDED_EXPORT_CHROME_ACTIONS),
        ...Array.from(EMBEDDED_AUTH_CHROME_ACTIONS),
        ...Array.from(EMBEDDED_HEADER_CHROME_ACTIONS),
        ...Array.from(EMBEDDED_FOOTER_HINT_ACTIONS),
        ...Array.from(EMBEDDED_FOOTER_LINK_ACTIONS),
        ...Array.from(EMBEDDED_RELOAD_CHROME_ACTIONS)
      ])
      if (!toolbarActionSet.has(action) && !chromeActionSet.has(action)) return
      if (action === CHROME_TOOLBAR_ACTIONS.reload) {
        window.location.reload()
        return
      }
      if (action === CHROME_TOOLBAR_ACTIONS.editHeaderTitle) {
        openHeaderTitleEditorRef.current()
        return
      }
      const yearMonthIndex = parseYearMonthOpenAction(action)
      if (yearMonthIndex != null) {
        goToMonthViewRef.current(yearMonthIndex)
        return
      }
      const btn = document.querySelector<HTMLElement>(
        `.neo-cal-shell [data-toolbar-action="${action}"]`
      )
      if (btn instanceof HTMLButtonElement && btn.disabled) return
      btn?.click()
      const { mode: currentMode, embedded: isEmbedded } = modeEmbeddedRef.current
      if (currentMode !== 'desktop' || !isEmbedded) {
        requestAnimationFrame(() => {
          void api.focusForTextInput?.()
        })
      }
    })
  }, [])

  /** Resolve a display occurrence (`id::date`) back to the stored series master. */
  const findMasterEvent = useCallback(
    (eventOrId: CalendarEvent | string | null | undefined): CalendarEvent | null => {
      if (!eventOrId) return null
      const seriesId =
        typeof eventOrId === 'string' ? eventOrId : getSeriesId(eventOrId) || eventOrId.id
      if (!seriesId) return null
      return store.events.find((item) => item.id === seriesId) ?? null
    },
    [store.events]
  )

  /** MDC openEditEvent — show occurrence dates/times in the full editor. */
  const mergeOccurrenceForEditor = useCallback(
    (master: CalendarEvent, occurrence: CalendarEvent): CalendarEvent => ({
      ...master,
      startDate: occurrence.startDate ?? master.startDate,
      endDate: occurrence.endDate ?? master.endDate,
      startTime: occurrence.startTime ?? master.startTime,
      endTime: occurrence.endTime ?? master.endTime,
      allDay: occurrence.allDay ?? master.allDay
    }),
    []
  )

  const openRecurringCompleteScope = useCallback(
    (master: CalendarEvent, occurrenceDate: string, completed: boolean): void => {
      const nextCompleted = Boolean(completed)
      const openInline = (): void => {
        setPendingComplete({ master, occurrenceDate, completed: nextCompleted })
        setScopeDialog({ mode: 'complete' })
      }
      // Browser / unlocked desktop: in-shell floating dialog (quick-edit chrome).
      if (isBrowserNeoCalendarHost() || !floatingPanels) {
        openInline()
        return
      }
      void window.neoCalendar
        .openPanelWindow?.({
          kind: 'recurrenceScope',
          mode: 'complete',
          eventId: master.id,
          occurrenceDate,
          completed: nextCompleted
        })
        .then((opened) => {
          if (opened === false) openInline()
        })
        .catch(() => openInline())
    },
    [floatingPanels]
  )

  const handleQuickEditToggleCompleted = useCallback(
    async (event: CalendarEvent, completed: boolean): Promise<void> => {
      if (!requireEdit()) return
      const master = findMasterEvent(event)
      if (!master || master.calendarId === HOLIDAYS_KR_CALENDAR_ID) return
      const nextCompleted = Boolean(completed)
      try {
        if (!isRecurringEvent(master)) {
          await editEvent(master.id, { completed: nextCompleted })
          return
        }
        const occurrenceDate =
          getOccurrenceDate(event, quickEdit?.dateKey) ?? master.startDate
        openRecurringCompleteScope(master, occurrenceDate, nextCompleted)
      } catch (error) {
        await alert(
          error instanceof Error ? error.message : '완료 상태를 변경하지 못했습니다.'
        )
      }
    },
    [
      alert,
      editEvent,
      findMasterEvent,
      openRecurringCompleteScope,
      quickEdit?.dateKey,
      requireEdit
    ]
  )

  const handleQuickEditDeleteCompleted = useCallback(
    async (completedEvents: CalendarEvent[]): Promise<void> => {
      if (!requireEdit() || !quickEdit?.dateKey) return
      try {
        const { deleted, failed } = await deleteCompletedForDay(
          completedEvents,
          quickEdit.dateKey
        )
        if (failed > 0) {
          await alert(
            deleted > 0
              ? `완료된 일정 ${deleted}건을 삭제했습니다. ${failed}건은 삭제하지 못했습니다.`
              : '완료된 일정을 삭제하지 못했습니다.'
          )
        }
      } catch (error) {
        await alert(error instanceof Error ? error.message : '완료된 일정을 삭제하지 못했습니다.')
      }
    },
    [alert, deleteCompletedForDay, quickEdit?.dateKey, requireEdit]
  )

  /** MDC DayQuickEditPopover — resolve occurrence id to series master before patch. */
  const handleQuickEditEventPatch = useCallback(
    async (
      event: CalendarEvent,
      patch: Partial<CalendarEvent>,
      errorMessage: string
    ): Promise<void> => {
      if (!requireEdit()) return
      const master = findMasterEvent(event)
      if (!master || master.calendarId === HOLIDAYS_KR_CALENDAR_ID) return
      try {
        await editEvent(master.id, patch)
      } catch (error) {
        await alert(error instanceof Error ? error.message : errorMessage)
      }
    },
    [alert, editEvent, findMasterEvent, requireEdit]
  )

  const handleQuickEditCalendarChange = useCallback(
    (event: CalendarEvent, calendarId: string): void => {
      void handleQuickEditEventPatch(event, { calendarId }, '캘린더를 변경하지 못했습니다.')
    },
    [handleQuickEditEventPatch]
  )

  const handleQuickEditTagChange = useCallback(
    (event: CalendarEvent, tagIds: string[]): void => {
      void handleQuickEditEventPatch(
        event,
        { tagIds: normalizeTagIds(tagIds) },
        '태그를 변경하지 못했습니다.'
      )
    },
    [handleQuickEditEventPatch]
  )

  const handleQuickEditMarkerShapeChange = useCallback(
    (event: CalendarEvent, markerShape: string | null): void => {
      void handleQuickEditEventPatch(
        event,
        { markerShape },
        '표시 도형을 변경하지 못했습니다.'
      )
    },
    [handleQuickEditEventPatch]
  )

  const handleQuickEditLinkChange = useCallback(
    (event: CalendarEvent, links: EventLink[]): void => {
      const normalized = normalizeEventLinksArray(links)
      void handleQuickEditEventPatch(
        event,
        {
          links: normalized,
          link: getPrimaryEventLinkUrl({ links: normalized })
        },
        '바로가기를 변경하지 못했습니다.'
      )
    },
    [handleQuickEditEventPatch]
  )

  useEffect(() => {
    let cancelled = false
    const poll = async (): Promise<void> => {
      try {
        const info = await window.neoCalendar.getSyncInfo?.()
        if (cancelled) return
        if (info?.running && (info.editorUrl || info.port)) {
          setWebEditUrl(
            info.editorUrl ||
              `${info.httpsEnabled ? 'https' : 'http'}://127.0.0.1:${info.port}/`
          )
        } else {
          setWebEditUrl(null)
        }
      } catch {
        if (!cancelled) setWebEditUrl(null)
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 4000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  const handleOpenWebEditor = (): void => {
    if (!requireEdit() || !webEditUrl) return
    void openExternalUrl(webEditUrl)
  }

  const enterDesktop = async (): Promise<void> => {
    setModeBusy(true)
    try {
      const status = await window.neoCalendar.enterDesktop()
      onModeChange(status.mode)
    } finally {
      setModeBusy(false)
    }
  }

  const enterWindow = async (): Promise<void> => {
    setModeBusy(true)
    try {
      const status = await window.neoCalendar.enterWindow()
      onModeChange(status.mode)
    } finally {
      setModeBusy(false)
    }
  }

  const handleAuthToggle = (): void => {
    const authenticated =
      Boolean(user) || (isBrowserNeoCalendarHost() && hasBrowserAuthToken())
    if (authenticated) {
      void window.neoCalendar
        .logout()
        .then(async () => {
          onUserChange(null)
          setSettingsOpen(false)
          await refresh()
        })
        .catch(async (error) => {
          await alert(error instanceof Error ? error.message : '로그아웃에 실패했습니다.')
        })
      return
    }
    setLoginError(null)
    promptLogin()
  }

  const handleLogin = async (loginId: string, password: string, remember: boolean): Promise<void> => {
    setLoginBusy(true)
    setLoginError(null)
    try {
      const result = await window.neoCalendar.login(loginId, password, remember)
      if (!result.ok) {
        setLoginError(result.error)
        return
      }
      onUserChange(result.user)
      await refresh()
      setLoginOpen(false)
    } finally {
      setLoginBusy(false)
    }
  }

  /**
   * MDC App.openEventDetail — pointer `{x,y}` or null (centered).
   * Callers that must not open over QE/editor (bar click) guard themselves.
   */
  const openEventDetail = (
    event: CalendarEvent,
    anchorRect: EventPopoverAnchor = null,
    opts?: {
      dayKey?: string
      fromSearch?: boolean
      pointerScreen?: { x: number; y: number } | null
    }
  ): void => {
    if (!requireEdit()) return
    detailFromSearchRef.current = Boolean(opts?.fromSearch)
    const panelAnchor = toPanelAnchor(anchorRect)
    const dayKey = opts?.dayKey ?? event.occurrenceDate ?? event.startDate
    const { floatingPanels } = modeEmbeddedRef.current
    if (floatingPanels) {
      // Toggle-close for same event is handled in panelWindowManager.openEmbedded.
      openEmbeddedPanel(
        {
          kind: 'eventDetail',
          eventId: event.id,
          dayKey,
          anchor: panelAnchor,
          pointerScreen: opts?.pointerScreen ?? null,
          fromSearch: opts?.fromSearch
        },
        panelAnchor
      )
      return
    }
    // Browser + unlocked desktop (inline): same title click again closes detail.
    if (eventPopover) {
      const openId = getSeriesId(eventPopover.event) || eventPopover.event.id
      const nextId = getSeriesId(event) || event.id
      if (openId === nextId && (eventPopover.dayKey ?? '') === dayKey) {
        clearEventDetail()
        return
      }
    }
    setInlineFrontPanel('eventDetail')
    setEventPopover({
      event,
      anchorRect,
      dayKey
    })
  }

  const handleSearchSelect = ({
    event,
    date,
    dayKey,
    clientX,
    clientY,
    screenX,
    screenY
  }: {
    event: CalendarEvent
    date: Date
    dayKey: string
    clientX: number
    clientY: number
    screenX: number
    screenY: number
  }): void => {
    if (!requireEdit()) return
    // Keep search open; detail opens at the click pointer.
    setViewDate(date)
    setSelectedKey(dayKey)
    setViewMode('month')
    openEventDetail(event, { x: clientX, y: clientY }, {
      dayKey,
      fromSearch: true,
      pointerScreen: { x: screenX, y: screenY }
    })
  }

  const handleSearchEdit = ({
    event,
    date,
    dayKey
  }: {
    event: CalendarEvent
    date: Date
    dayKey: string
    clientX: number
    clientY: number
    screenX: number
    screenY: number
  }): void => {
    if (!requireEdit()) return
    setViewDate(date)
    setSelectedKey(dayKey)
    setViewMode('month')
    const master = findMasterEvent(event)
    if (!master) {
      void alert('일정을 찾을 수 없습니다.')
      return
    }
    openEventEditor(master, { defaultDate: dayKey })
  }

  const handleReorderEvents = useCallback(
    async (
      ordered: Array<{ event: CalendarEvent; sortOrder: number }>,
      dayKey: string
    ): Promise<void> => {
      if (!requireEdit() || !dayKey) return
      try {
        for (const { event, sortOrder } of ordered ?? []) {
          const master =
            store.events.find((item) => item.id === (getSeriesId(event) || event.id)) ?? null
          if (!master || master.calendarId === HOLIDAYS_KR_CALENDAR_ID) continue
          if (getEventSortOrderForDay(master, dayKey) === sortOrder) continue
          await editEvent(master.id, {
            sortOrderByDay: mergeSortOrderByDay(master, dayKey, sortOrder)
          })
        }
      } catch (error) {
        await alert(error instanceof Error ? error.message : '일정 순서를 저장하지 못했습니다.')
      }
    },
    [alert, editEvent, requireEdit, store.events]
  )

  const openEventEditor = (
    event: CalendarEvent | null,
    opts?: {
      defaultDate?: string
      returnQuickEdit?: { dateKey: string; date: Date; anchorRect: AnchorRect | null } | null
    }
  ): void => {
    if (!requireEdit()) return
    if (event?.calendarId === HOLIDAYS_KR_CALENDAR_ID) return
    const { floatingPanels } = modeEmbeddedRef.current
    if (floatingPanels) {
      setEventPopover(null)
      setScopeDialog(null)
      setPendingDelete(null)
      // Keep floating quickEdit under the editor (panel manager no longer evicts it).
      openEmbeddedPanel({
        kind: 'eventEditor',
        eventId: event?.id ?? null,
        defaultDate: opts?.defaultDate,
        occurrenceDate: opts?.defaultDate ?? null,
        returnQuickEdit: opts?.returnQuickEdit
          ? {
              dateKey: opts.returnQuickEdit.dateKey,
              anchor: opts.returnQuickEdit.anchorRect
            }
          : quickEdit
            ? { dateKey: quickEdit.dateKey, anchor: quickEdit.anchorRect }
            : null
      })
      return
    }
    setEventPopover(null)
    // Keep inline quickEdit mounted so delete-cancel / editor X can return to it.
    setScopeDialog(null)
    setPendingDelete(null)

    if (event) {
      const master = findMasterEvent(event)
      if (!master) {
        void alert('일정을 찾을 수 없습니다.')
        return
      }
      if (master.calendarId === HOLIDAYS_KR_CALENDAR_ID) return
      const occurrenceDate =
        getOccurrenceDate(event, opts?.defaultDate ?? selectedKey ?? event.occurrenceDate) ??
        master.startDate
      setPendingEdit({
        master,
        occurrenceDate,
        needsScope: isRecurringEvent(master)
      })
      setEditor({
        event: mergeOccurrenceForEditor(master, event),
        defaultDate: opts?.defaultDate,
        occurrenceDate,
        returnQuickEdit: opts?.returnQuickEdit ?? quickEdit ?? null
      })
      return
    }

    setPendingEdit(null)
    setEditor({
      event: null,
      defaultDate: opts?.defaultDate,
      occurrenceDate: opts?.defaultDate ?? null,
      returnQuickEdit: opts?.returnQuickEdit ?? quickEdit ?? null
    })
  }

  const openEventEditorRef = useRef(openEventEditor)
  openEventEditorRef.current = openEventEditor
  const openEventDetailRef = useRef(openEventDetail)
  openEventDetailRef.current = openEventDetail
  const storeEventsRef = useRef(store.events)
  storeEventsRef.current = store.events

  useEffect(() => {
    const api = window.neoCalendar
    if (!api?.onQuickEditDeferred) return
    return api.onQuickEditDeferred((payload) => {
      const date =
        parseDateKeyLocal(payload.dateKey) ?? parseDateKey(payload.dateKey)
      if (date) {
        setViewDate(date)
        setSelectedKey(payload.dateKey)
      }
      if (payload.kind === 'editor') {
        const event = payload.eventId
          ? storeEventsRef.current.find((item) => item.id === payload.eventId) ?? null
          : null
        openEventEditorRef.current(event, { defaultDate: payload.dateKey })
        return
      }
      if (payload.kind === 'detail' && payload.eventId) {
        const seriesId = payload.eventId.split('::')[0] ?? payload.eventId
        const master = storeEventsRef.current.find((item) => item.id === seriesId)
        if (master) {
          const occurrence =
            storeEventsRef.current.find((item) => item.id === payload.eventId) ?? master
          openEventDetailRef.current(occurrence, null, { dayKey: payload.dateKey })
        }
      }
    })
  }, [])

  const handleScopeSelect = async (scope: 'single' | 'following' | 'all'): Promise<void> => {
    const dialogMode = scopeDialog?.mode
    setScopeDialog(null)
    try {
      if (dialogMode === 'edit' && pendingEdit?.payload && pendingEdit.master) {
        const { master, payload, occurrenceDate } = pendingEdit
        dismissEditorAfterSave()
        await applyRecurringEdit(master, payload, occurrenceDate, scope)
        return
      }
      if (dialogMode === 'complete' && pendingComplete?.master) {
        const { master, occurrenceDate, completed } = pendingComplete
        const nextCompleted = Boolean(completed)
        const payload = buildRecurringCompletePayload(master, occurrenceDate, nextCompleted)
        await applyRecurringEdit(master, payload, occurrenceDate, scope)
        setPendingComplete(null)
        setEventPopover((prev) =>
          prev ? { ...prev, event: { ...prev.event, completed: nextCompleted } } : null
        )
        return
      }
      if (dialogMode === 'delete' && pendingDelete?.master) {
        const { master, occurrenceDate } = pendingDelete
        setPendingDelete(null)
        await applyRecurringDelete(
          { editEvent, removeEvent },
          master,
          occurrenceDate,
          scope,
          store.events
        )
        closePanelsAfterEventDelete()
        return
      }
      if (dialogMode === 'shift' && pendingShift?.master) {
        const { master, occurrenceDate, deltaDays } = pendingShift
        setPendingShift(null)
        setShiftingEvent(true)
        await applyEventDateShift(
          { addEvent, editEvent, removeEvent },
          {
            master,
            occurrenceDate,
            deltaDays,
            scope,
            allEvents: store.events
          }
        )
        clearEventDetail()
      }
    } catch (error) {
      await alert(error instanceof Error ? error.message : '반복 일정 처리에 실패했습니다.')
    } finally {
      setShiftingEvent(false)
    }
  }

  const setViewFlag = (patch: {
    eventsHidden?: boolean
    completedHidden?: boolean
    eventDensity?: number
  }): void => {
    if (!requireEdit()) return
    void patchStoreSettings({
      viewOptions: {
        ...store.settings.viewOptions,
        ...patch
      }
    }).catch(async (error) => {
      await alert(error instanceof Error ? error.message : '표시 설정을 저장하지 못했습니다.')
    })
  }

  const toggleHeaderCollapsed = (): void => {
    if (!canEdit) {
      setGuestHeaderCollapsed((value) => !value)
      return
    }
    void patchStoreSettings({
      viewOptions: {
        ...store.settings.viewOptions,
        headerCollapsed: !headerCollapsed
      }
    }).catch(async (error) => {
      await alert(error instanceof Error ? error.message : '헤더 표시를 저장하지 못했습니다.')
    })
  }

  const adjustEventDensity = (delta: number): void => {
    setViewFlag({ eventDensity: stepEventDensity(eventDensity, delta) })
  }

  const exportReferenceDate = useMemo(() => {
    const y = viewDate.getFullYear()
    const m = viewDate.getMonth()
    const d = Math.min(viewDate.getDate(), new Date(y, m + 1, 0).getDate())
    return toDateKey(y, m, d)
  }, [viewDate])

  const runExportRequest = async (request: ExportCalendarRequest): Promise<void> => {
    if (exporting) return
    const formatLabel = exportFormatLabel(request.format)
    const layoutLabel = request.layout === 'dayList' ? '일간 목록' : '월간 달력'
    const rangeLabel = formatExportRangeLabel(request.startDate, request.endDate)
    setExporting(true)
    try {
      const result = await window.neoCalendar.exportCalendar(request)
      if (result.canceled) return
      if (!result.ok) {
        await alert(result.error || `${formatLabel} 내보내기에 실패했습니다.`)
        return
      }
      await alert(`${rangeLabel} ${layoutLabel}을(를) ${formatLabel} 파일로 저장했습니다.`)
      setExportOptionsOpen(false)
    } catch (error) {
      await alert(error instanceof Error ? error.message : `${formatLabel} 내보내기에 실패했습니다.`)
    } finally {
      setExporting(false)
    }
  }

  const handleOpenExport = (): void => {
    if (!requireEdit() || exporting) return
    const { floatingPanels: useFloating } = modeEmbeddedRef.current
    if (useFloating && !isBrowserNeoCalendarHost()) {
      openEmbeddedPanel({
        kind: 'exportOptions',
        referenceDate: exportReferenceDate,
        weekStartsOnSunday: store.settings.viewOptions.weekStartsOnSunday !== false
      })
      return
    }
    setExportOptionsOpen(true)
  }

  const lunarMonthLabel = useMemo(
    () => (viewMode === 'month' ? getLunarMonthLabel(year, month + 1) : null),
    [viewMode, year, month]
  )

  const renderDayCell = (cell: DayCell, options?: { tall?: boolean }): ReactElement => {
    const weeks = options?.tall ? [weekDays] : scrollWeeks
    return (
      <MonthDayCell
        key={cell.dateKey}
        cell={cell}
        segments={segmentsForDay(cell, weeks)}
        calendarsById={calendarsById}
        tags={store.tags}
        selected={selectedKey === cell.dateKey}
        isKrHoliday={holidayKeys.has(cell.dateKey)}
        dayColor={dayColors[cell.dateKey] ?? null}
        dayHighlight={dayHighlights[cell.dateKey] ?? null}
        eventCapacity={eventCapacity}
        eventsHidden={eventsHidden}
        completedHidden={completedHidden}
        canEdit={canEdit}
        tall={options?.tall}
        desktopEmbedded={embedded}
        themeEpoch={themeEpoch}
        onLoginRequired={promptLogin}
        onDayQuickEdit={(date, rect) => openQuickEditFromDate(date, rect)}
      />
    )
  }

  const goToMonthView = (monthIndex: number): void => {
    if (!requireEdit()) return
    lockChromeNav(500)
    setViewDate(new Date(year, monthIndex, 1))
    setViewMode('month')
  }
  goToMonthViewRef.current = goToMonthView

  const renderYearView = (): ReactElement => (
    <div className="year-view flex-1">
      {Array.from({ length: 12 }, (_, monthIndex) => {
        const weeks = buildMonthWeeks(year, monthIndex, weekStartsOn)
        return (
          <div
            key={monthIndex}
            className={cn(
              'year-month',
              'interaction-ui',
              monthIndex === month && 'is-current',
              !canEdit && LOGIN_MUTED_CLASS
            )}
            onDoubleClick={(e) => {
              // Day cells handle their own double-click (quick edit) and stopPropagation.
              e.preventDefault()
              goToMonthView(monthIndex)
            }}
            title={!canEdit ? LOGIN_REQUIRED_TITLE : `${year}년 ${monthIndex + 1}월 보기로 이동`}
          >
            <InteractionUI
              as="button"
              className={cn('year-month-title', !canEdit && LOGIN_MUTED_CLASS)}
              data-toolbar-action={yearMonthOpenAction(monthIndex)}
              onClick={() => goToMonthView(monthIndex)}
              onDoubleClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                goToMonthView(monthIndex)
              }}
              aria-label={`${year}년 ${monthIndex + 1}월로 이동`}
              title={!canEdit ? LOGIN_REQUIRED_TITLE : `${monthIndex + 1}월 보기로 이동`}
            >
              {monthIndex + 1}월
            </InteractionUI>
            <div className="year-month-weekdays" data-shell-chrome="weekday-header">
              {weekdayLabels.map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            <div className="year-month-grid">
              {weeks.flat().map((cell) => (
                <button
                  key={cell.dateKey}
                  type="button"
                  className={cn(
                    'year-day',
                    'interaction-ui',
                    !cell.inMonth && 'other-month',
                    cell.isToday && cell.inMonth && 'today',
                    selectedKey === cell.dateKey && cell.inMonth && !cell.isToday && 'selected',
                    cell.weekday === 0 && cell.inMonth && 'sunday',
                    cell.weekday === 6 && cell.inMonth && 'saturday',
                    holidayKeys.has(cell.dateKey) && cell.inMonth && 'holiday'
                  )}
                  data-date-key={cell.dateKey}
                  disabled={!cell.inMonth}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!cell.inMonth) return
                    if (!canEdit) promptLogin()
                  }}
                  onDoubleClick={
                    embedded
                      ? undefined
                      : (e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          if (!cell.inMonth) return
                          if (!requireEdit()) return
                          openQuickEdit(cell, new DOMRect(e.clientX, e.clientY, 1, 1))
                        }
                  }
                  aria-label={
                    cell.inMonth
                      ? `${year}년 ${monthIndex + 1}월 ${cell.day}일`
                      : undefined
                  }
                >
                  {cell.inMonth ? cell.day : ''}
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )

  const captureToolbarOnHover = !embedded

  return (
    <div
      className={cn(
        'neo-cal-shell flex h-full flex-col',
        roundedCorners && 'is-rounded-corners',
        headerCollapsed && 'is-header-collapsed'
      )}
    >
      <header
        className={cn(
          headerShellClass,
          headerCollapsed && 'gap-0',
          !embedded && 'interaction-ui',
          mode === 'window' && 'is-window-mode'
        )}
        data-shell-chrome="header"
        onMouseDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
      >
        {!headerCollapsed ? (
        <AppChrome
          mode={mode}
          embedded={embedded}
          user={user}
          loggedIn={canEdit}
          headerTitle={store.settings.viewOptions.headerTitle}
          chromeRef={chromeRef}
          onHeaderTitleEdit={openHeaderTitleEditor}
          onAuthToggle={handleAuthToggle}
          onLoginRequired={promptLogin}
        />
        ) : null}

        <div
          ref={periodHeaderRef}
          className="header-period-row interaction-ui flex shrink-0 items-center justify-center gap-1.5"
          data-shell-chrome="period-header"
          onDoubleClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
        >
          <div className="flex shrink-0 items-center gap-1" role="group" aria-label="보기 모드">
            {VIEW_MODE_OPTIONS.map(({ value, label, Icon }) => (
              <InteractionUI
                key={value}
                as="button"
                className={cn(
                  viewMode === value ? viewModeIconBtnActiveClass : viewModeIconBtnClass,
                  !canEdit && LOGIN_MUTED_CLASS
                )}
                captureOnHover={captureToolbarOnHover}
                data-toolbar-action={
                  value === 'year'
                    ? PERIOD_TOOLBAR_ACTIONS.viewYear
                    : value === 'week'
                      ? PERIOD_TOOLBAR_ACTIONS.viewWeek
                      : PERIOD_TOOLBAR_ACTIONS.viewMonth
                }
                aria-label={`${label} 보기`}
                aria-pressed={viewMode === value}
                title={!canEdit ? LOGIN_REQUIRED_TITLE : `${label} 보기`}
                onClick={() => handleViewModeChange(value)}
              >
                <Icon />
              </InteractionUI>
            ))}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {viewMode === 'month' && (
              <InteractionUI
                as="button"
                className={cn(yearNavBtnClass, !canEdit && LOGIN_MUTED_CLASS)}
                captureOnHover={captureToolbarOnHover}
                data-toolbar-action={PERIOD_TOOLBAR_ACTIONS.prevYear}
                onClick={() => {
                  if (!requireEdit()) return
                  shiftYear(-1)
                }}
                aria-label="이전 연도"
                title={!canEdit ? LOGIN_REQUIRED_TITLE : '이전 연도'}
              >
                <DoubleChevronLeftIcon />
              </InteractionUI>
            )}
            <InteractionUI
              as="button"
              className={cn(`${navBtnClass} mr-2`, !canEdit && LOGIN_MUTED_CLASS)}
              captureOnHover={captureToolbarOnHover}
              data-toolbar-action={PERIOD_TOOLBAR_ACTIONS.prev}
              onClick={onPrev}
              aria-label={
                viewMode === 'year' ? '이전 연도' : viewMode === 'week' ? '이전 주' : '이전 월'
              }
              title={
                !canEdit
                  ? LOGIN_REQUIRED_TITLE
                  : viewMode === 'year'
                    ? '이전 연도'
                    : viewMode === 'week'
                      ? '이전 주'
                      : '이전 월'
              }
            >
              <ChevronLeftIcon />
            </InteractionUI>

            <div className="flex min-w-0 items-baseline gap-2 whitespace-nowrap">
              <h1 className="m-0 text-[19px] font-semibold leading-7 tracking-tight text-gcal-heading">
                {periodTitle}
              </h1>
              {lunarMonthLabel ? (
                <span
                  className="hidden shrink-0 rounded-full bg-gcal-blue-soft px-1.5 py-0.5 text-[13px] text-gcal-blue-dark xl:inline-block"
                  title={lunarMonthLabel}
                >
                  {lunarMonthLabel}
                </span>
              ) : null}
            </div>

            <InteractionUI
              as="button"
              className={cn(`${navBtnClass} ml-2`, !canEdit && LOGIN_MUTED_CLASS)}
              captureOnHover={captureToolbarOnHover}
              data-toolbar-action={PERIOD_TOOLBAR_ACTIONS.next}
              onClick={onNext}
              aria-label={
                viewMode === 'year' ? '다음 연도' : viewMode === 'week' ? '다음 주' : '다음 월'
              }
              title={
                !canEdit
                  ? LOGIN_REQUIRED_TITLE
                  : viewMode === 'year'
                    ? '다음 연도'
                    : viewMode === 'week'
                      ? '다음 주'
                      : '다음 월'
              }
            >
              <ChevronRightIcon />
            </InteractionUI>
            {viewMode === 'month' && (
              <InteractionUI
                as="button"
                className={cn(yearNavBtnClass, !canEdit && LOGIN_MUTED_CLASS)}
                captureOnHover={captureToolbarOnHover}
                data-toolbar-action={PERIOD_TOOLBAR_ACTIONS.nextYear}
                onClick={() => {
                  if (!requireEdit()) return
                  shiftYear(1)
                }}
                aria-label="다음 연도"
                title={!canEdit ? LOGIN_REQUIRED_TITLE : '다음 연도'}
              >
                <DoubleChevronRightIcon />
              </InteractionUI>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <InteractionUI
              as="button"
              className={cn(todayBtnClass, !canEdit && LOGIN_MUTED_CLASS)}
              captureOnHover={captureToolbarOnHover}
              data-toolbar-action={PERIOD_TOOLBAR_ACTIONS.today}
              aria-label="오늘"
              title={!canEdit ? LOGIN_REQUIRED_TITLE : '오늘'}
              onClick={goToday}
            >
              오늘
            </InteractionUI>
            <InteractionUI
              as="button"
              className={cn(
                desktopModeIconBtnClass,
                dayListPreviewIconBtnClass,
                dayListPreviewOpen && dayListPreviewIconBtnActiveClass,
                !canEdit && LOGIN_MUTED_CLASS
              )}
              captureOnHover={captureToolbarOnHover}
              data-toolbar-action={PERIOD_TOOLBAR_ACTIONS.dayListPreview}
              onClick={openDayListPreview}
              aria-label="세로보기"
              aria-pressed={dayListPreviewOpen}
              title={!canEdit ? LOGIN_REQUIRED_TITLE : '세로보기 (일자별 미리보기)'}
            >
              <PortraitPreviewIcon />
            </InteractionUI>
            <InteractionUI
              as="button"
              className={cn(
                desktopModeIconBtnClass,
                softBlueIconBtnClass,
                (!canEdit || !webEditUrl) && LOGIN_MUTED_CLASS
              )}
              captureOnHover={captureToolbarOnHover}
              data-toolbar-action={PERIOD_TOOLBAR_ACTIONS.webEditor}
              onClick={handleOpenWebEditor}
              aria-label="브라우저에서 편집"
              title={
                !canEdit
                  ? LOGIN_REQUIRED_TITLE
                  : webEditUrl
                    ? `브라우저에서 편집 (${webEditUrl})`
                    : '로컬 웹 서버가 꺼져 있습니다 (.env의 PORT 확인)'
              }
              disabled={canEdit && !webEditUrl}
            >
              <WebBrowserIcon />
            </InteractionUI>
            <InteractionUI
              as="button"
              className={cn(
                desktopModeIconBtnClass,
                softBlueIconBtnClass,
                eventsHidden && softRedIconBtnActiveClass,
                !canEdit && LOGIN_MUTED_CLASS
              )}
              captureOnHover={captureToolbarOnHover}
              data-toolbar-action={PERIOD_TOOLBAR_ACTIONS.toggleEvents}
              onClick={() => setViewFlag({ eventsHidden: !eventsHidden })}
              aria-label={eventsHidden ? '모든 일정 보이기' : '모든 일정 숨기기'}
              aria-pressed={eventsHidden}
              title={
                !canEdit
                  ? LOGIN_REQUIRED_TITLE
                  : eventsHidden
                    ? '일정 다시 보이기'
                    : '모든 일정 숨기기'
              }
            >
              <HideEventsEyeIcon open={!eventsHidden} />
            </InteractionUI>
            <InteractionUI
              as="button"
              className={cn(
                desktopModeIconBtnClass,
                softBlueIconBtnClass,
                completedHidden && softRedIconBtnActiveClass,
                !canEdit && LOGIN_MUTED_CLASS
              )}
              captureOnHover={captureToolbarOnHover}
              data-toolbar-action={PERIOD_TOOLBAR_ACTIONS.toggleCompleted}
              onClick={() => setViewFlag({ completedHidden: !completedHidden })}
              aria-label={completedHidden ? '완료 일정 보이기' : '완료 일정 숨기기'}
              aria-pressed={completedHidden}
              title={
                !canEdit
                  ? LOGIN_REQUIRED_TITLE
                  : completedHidden
                    ? '완료된 일정 다시 보이기'
                    : '완료된 일정만 숨기기'
              }
            >
              <HideCompletedCheckIcon checked={completedHidden} />
            </InteractionUI>
            <InteractionUI
              as="button"
              className={cn(
                desktopModeIconBtnClass,
                densityIconBtnClass,
                iconBtnDisabledClass,
                !canEdit && LOGIN_MUTED_CLASS
              )}
              captureOnHover={captureToolbarOnHover}
              data-toolbar-action={PERIOD_TOOLBAR_ACTIONS.densityDown}
              onClick={() => adjustEventDensity(-EVENT_DENSITY_STEP)}
              disabled={!canEdit || eventDensity <= EVENT_DENSITY_MIN}
              aria-label="일정 글자·막대 작게 (더 많이 표시)"
              title={
                !canEdit
                  ? LOGIN_REQUIRED_TITLE
                  : `일정 작게 (${eventDensity.toFixed(1)}) — 칸에 더 많이 표시`
              }
            >
              <DensityDownIcon />
            </InteractionUI>
            <InteractionUI
              as="button"
              className={cn(
                desktopModeIconBtnClass,
                densityIconBtnClass,
                iconBtnDisabledClass,
                !canEdit && LOGIN_MUTED_CLASS
              )}
              captureOnHover={captureToolbarOnHover}
              data-toolbar-action={PERIOD_TOOLBAR_ACTIONS.densityUp}
              onClick={() => adjustEventDensity(EVENT_DENSITY_STEP)}
              disabled={!canEdit || eventDensity >= EVENT_DENSITY_MAX}
              aria-label="일정 글자·막대 크게"
              title={
                !canEdit
                  ? LOGIN_REQUIRED_TITLE
                  : `일정 크게 (${eventDensity.toFixed(1)}) — 가독성 우선`
              }
            >
              <DensityUpIcon />
            </InteractionUI>
            <InteractionUI
              as="button"
              className={cn(
                desktopModeIconBtnClass,
                densityIconBtnClass,
                (!canEdit || settingsOpen) && LOGIN_MUTED_CLASS
              )}
              captureOnHover={captureToolbarOnHover}
              data-toolbar-action={CHROME_TOOLBAR_ACTIONS.search}
              aria-label="검색"
              title={
                !canEdit
                  ? LOGIN_REQUIRED_TITLE
                  : settingsOpen
                    ? '설정을 닫은 후 검색할 수 있습니다'
                    : '검색'
              }
              disabled={canEdit ? settingsOpen : false}
              onClick={() => {
                if (!requireEdit()) return
                if (settingsOpen) return
                openSearch()
              }}
            >
              <SearchIcon />
            </InteractionUI>
            <InteractionUI
              as="button"
              className={cn(
                desktopModeIconBtnClass,
                densityIconBtnClass,
                (!canEdit || searchOpen) && LOGIN_MUTED_CLASS
              )}
              captureOnHover={captureToolbarOnHover}
              data-toolbar-action={CHROME_TOOLBAR_ACTIONS.settings}
              aria-label="설정"
              title={
                !canEdit
                  ? LOGIN_REQUIRED_TITLE
                  : searchOpen
                    ? '검색을 닫은 후 설정할 수 있습니다'
                    : '설정'
              }
              disabled={canEdit ? searchOpen : false}
              onClick={openSettingsPanel}
            >
              <SettingsIcon />
            </InteractionUI>
            <InteractionUI
              as="button"
              className={cn(
                desktopModeIconBtnClass,
                densityIconBtnClass,
                iconBtnDisabledClass,
                (!canEdit || exporting || settingsOpen || searchOpen) && LOGIN_MUTED_CLASS
              )}
              captureOnHover={captureToolbarOnHover}
              data-toolbar-action={CHROME_TOOLBAR_ACTIONS.export}
              aria-label="내려받기"
              title={!canEdit ? LOGIN_REQUIRED_TITLE : '내려받기'}
              disabled={canEdit ? exporting || settingsOpen || searchOpen : false}
              onClick={() => {
                if (!requireEdit()) return
                handleOpenExport()
              }}
            >
              <ExportIcon />
            </InteractionUI>
            <InteractionUI
              as="button"
              className={cn(desktopModeIconBtnClass, densityIconBtnClass)}
              captureOnHover={captureToolbarOnHover}
              data-toolbar-action={CHROME_TOOLBAR_ACTIONS.footerHelp}
              aria-label="도움말"
              title="도움말 — 모든 푸터 힌트"
              onClick={openFooterHelp}
            >
              <HelpIcon />
            </InteractionUI>
            <InteractionUI
              as="button"
              className={cn(
                desktopModeIconBtnClass,
                densityIconBtnClass,
                iconBtnDisabledClass,
                mode === 'desktop' && softBlueIconBtnMutedClass
              )}
              captureOnHover={captureToolbarOnHover}
              data-toolbar-action={CHROME_TOOLBAR_ACTIONS.enterDesktop}
              aria-label="바탕화면모드"
              aria-pressed={mode === 'desktop'}
              title={
                mode === 'desktop'
                  ? '바탕화면 모드 — 아이콘 아래'
                  : !switchReady
                    ? '잠시만 기다려 주세요'
                    : '바탕화면에 고정 (아이콘 아래로 들어감)'
              }
              disabled={modeBusy || mode === 'desktop' || !switchReady}
              onClick={() => {
                if (!switchReady || modeBusy) return
                void enterDesktop()
              }}
            >
              <DesktopModeIcon />
            </InteractionUI>
            <InteractionUI
              as="button"
              className={cn(
                desktopModeIconBtnClass,
                densityIconBtnClass,
                iconBtnDisabledClass,
                mode === 'window' && softBlueIconBtnMutedClass
              )}
              captureOnHover={captureToolbarOnHover}
              data-toolbar-action={CHROME_TOOLBAR_ACTIONS.enterWindow}
              aria-label="창모드"
              aria-pressed={mode === 'window'}
              title={!switchReady ? '잠시만 기다려 주세요' : '창 모드 — 이동·크기조절 가능'}
              disabled={modeBusy || mode === 'window' || !switchReady}
              onClick={() => {
                if (!switchReady || modeBusy) return
                void enterWindow()
              }}
            >
              <WindowModeIcon />
            </InteractionUI>
            <InteractionUI
              as="button"
              className={cn(
                desktopModeIconBtnClass,
                dayListPreviewIconBtnClass,
                headerCollapsed && dayListPreviewIconBtnActiveClass
              )}
              captureOnHover={captureToolbarOnHover}
              data-toolbar-action={CHROME_TOOLBAR_ACTIONS.toggleHeader}
              aria-label={headerCollapsed ? '헤더 펼치기' : '헤더 접기'}
              aria-pressed={headerCollapsed}
              title={headerCollapsed ? '헤더 펼치기' : '헤더 접기'}
              onClick={toggleHeaderCollapsed}
            >
              {headerCollapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
            </InteractionUI>
          </div>
        </div>
      </header>

      {viewMode === 'year' ? (
        renderYearView()
      ) : viewMode === 'week' ? (
        <div
          className={cn(
            'month-view week-view flex-1',
            !showWeekNumbers && 'hide-week-numbers',
            eventsHidden && 'is-events-hidden',
            completedHidden && 'is-completed-hidden'
          )}
          style={eventLayoutCssVars as CSSProperties}
        >
          <div className="month-weekdays" data-shell-chrome="weekday-header">
            {showWeekNumbers ? <div className="week-number-header" aria-hidden /> : null}
            {weekdayLabels.map((label) => (
              <div
                key={label}
                className={
                  label === '일' ? 'is-sunday' : label === '토' ? 'is-saturday' : undefined
                }
              >
                {label}
              </div>
            ))}
          </div>
          <div ref={monthBodyRef} className="month-body">
            <div className="month-week month-week--single">
              {showWeekNumbers ? (
                <div className="week-number" title={`${getWeekNumber(weekDays[0].date)}주`}>
                  {getWeekNumber(weekDays[0].date)}
                </div>
              ) : null}
              {weekDays.map((cell) => renderDayCell(cell, { tall: true }))}
            </div>
          </div>
        </div>
      ) : (
        <div
          className={cn(
            'month-view flex-1',
            !showWeekNumbers && 'hide-week-numbers',
            eventsHidden && 'is-events-hidden',
            completedHidden && 'is-completed-hidden'
          )}
          style={
            {
              ...eventLayoutCssVars,
              '--weeks-in-viewport': effectiveWeeksInViewport
            } as CSSProperties
          }
        >
          <div className="month-weekdays" data-shell-chrome="weekday-header">
            {showWeekNumbers ? (
              <div className="week-number-header" title="주차">
                주
              </div>
            ) : null}
            {weekdayLabels.map((label) => (
              <div
                key={label}
                className={
                  label === '일' ? 'is-sunday' : label === '토' ? 'is-saturday' : undefined
                }
              >
                {label}
              </div>
            ))}
          </div>
          <div ref={monthBodyRef} className="month-body">
            {scrollWeeks.map((week) => {
              const weekStartKey = toWeekStartKey(week)
              return (
                <div
                  key={weekStartKey}
                  className="month-week"
                  data-week-start={weekStartKey}
                  ref={(node) => setWeekRef(weekStartKey, node)}
                >
                  {showWeekNumbers ? (
                    <div className="week-number" title={`${getWeekNumber(week[0].date)}주`}>
                      {getWeekNumber(week[0].date)}
                    </div>
                  ) : null}
                  {week.map((cell) => renderDayCell(cell))}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {!headerCollapsed ? (
      <footer
        className={cn(footerShellClass, 'interaction-ui')}
        data-shell-chrome="footer"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
      >
        <div className="neo-cal-footer-hint m-0 flex min-w-0 items-center gap-1.5">
          <div className="neo-cal-footer-hint-controls shrink-0">
            <button
              type="button"
              className="neo-cal-footer-hint-control"
              data-toolbar-action={FOOTER_HINT_ACTIONS.prev}
              title="이전 도움말"
              aria-label="이전 도움말"
              disabled={!canGoPrevFooterHint}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setFooterHintNav((nav) => {
                  if (nav.pos <= 0) return nav
                  const pos = nav.pos - 1
                  return { ...nav, pos, index: nav.history[pos] ?? nav.index }
                })
              }}
            >
              <FooterHintPrevIcon />
            </button>
            <button
              type="button"
              className={cn(
                'neo-cal-footer-hint-control',
                !footerHintPaused && 'is-active'
              )}
              data-toolbar-action={FOOTER_HINT_ACTIONS.pause}
              title="도움말 자동 전환 정지"
              aria-label="도움말 자동 전환 정지"
              aria-pressed={footerHintPaused}
              disabled={footerHintPaused}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setFooterHintPaused(true)
              }}
            >
              <FooterHintPauseIcon />
            </button>
            <button
              type="button"
              className={cn(
                'neo-cal-footer-hint-control',
                footerHintPaused && 'is-active'
              )}
              data-toolbar-action={FOOTER_HINT_ACTIONS.play}
              title="도움말 자동 전환 재생"
              aria-label="도움말 자동 전환 재생"
              aria-pressed={!footerHintPaused}
              disabled={!footerHintPaused}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setFooterHintPaused(false)
              }}
            >
              <FooterHintPlayIcon />
            </button>
            <button
              type="button"
              className="neo-cal-footer-hint-control"
              data-toolbar-action={FOOTER_HINT_ACTIONS.next}
              title="다음 도움말"
              aria-label="다음 도움말"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setFooterHintNav((nav) => {
                  if (nav.pos < nav.history.length - 1) {
                    const pos = nav.pos + 1
                    return { ...nav, pos, index: nav.history[pos] ?? nav.index }
                  }
                  return advanceFooterHintNav(nav, pickRandomFooterHintIndex(nav.index))
                })
              }}
            >
              <FooterHintNextIcon />
            </button>
          </div>
          <p className="m-0 min-w-0 truncate">
            {FOOTER_HINTS[footerHintIndex] ?? FOOTER_HINTS[0]}
          </p>
        </div>
        <SiteLink />
      </footer>
      ) : null}

      {inlineOverlays ? (
        <SearchPanel
          open={searchOpen}
          events={eventsHidden ? [] : visibleEvents}
          calendars={store.calendars}
          tags={store.tags}
          onClose={() => setSearchOpen(false)}
          onSelectResult={handleSearchSelect}
          onEditResult={handleSearchEdit}
        />
      ) : null}
      {inlineOverlays ? (
        <DayListPreviewPanel
          open={dayListPreviewOpen}
          store={store}
          year={year}
          month={month}
          eventsHidden={eventsHidden}
          completedHidden={completedHidden}
          shortcutsSuspended={Boolean(editor)}
          onOpenDay={(dayKey) => {
            openEventEditor(null, { defaultDate: dayKey })
          }}
          onOpenEvent={(eventId, dayKey) => {
            const master = findMasterEvent(eventId)
            if (!master) {
              void alert('일정을 찾을 수 없습니다.')
              return
            }
            openEventEditor(master, { defaultDate: dayKey })
          }}
          onSortDirChange={(dir) => {
            void patchStoreSettings({
              viewOptions: {
                ...store.settings.viewOptions,
                dayListSortDesc: dir === 'desc'
              }
            })
          }}
          onClose={() => setDayListPreviewOpen(false)}
        />
      ) : null}
      {inlineOverlays ? (
        <ExportOptionsPanel
          open={exportOptionsOpen}
          busy={exporting}
          variant="inline"
          referenceDate={exportReferenceDate}
          weekStartsOnSunday={store.settings.viewOptions.weekStartsOnSunday !== false}
          onClose={() => {
            if (!exporting) setExportOptionsOpen(false)
          }}
          onExport={(request) => void runExportRequest(request)}
        />
      ) : null}
      {inlineOverlays ? (
        <FooterHelpPanel
          open={footerHelpOpen}
          onClose={() => setFooterHelpOpen(false)}
        />
      ) : null}
      <HeaderTitleEditorPanel
        open={headerTitleEditorOpen}
        variant="inline"
        value={store.settings.viewOptions.headerTitle}
        onClose={() => setHeaderTitleEditorOpen(false)}
        onChange={(next) => {
          void patchStoreSettings({
            viewOptions: {
              ...store.settings.viewOptions,
              headerTitle: normalizeHeaderTitle({ ...next, enabled: true })
            }
          }).catch(async (error) => {
            await alert(
              error instanceof Error ? error.message : '캘린더 이름을 저장하지 못했습니다.'
            )
          })
        }}
      />
      {inlineOverlays ? (
        <SettingsPanel
          open={settingsOpen}
          settings={settings}
          store={store}
          user={user}
          onClose={() => setSettingsOpen(false)}
          onSave={onSettingsSaved}
          onPatchStore={patchStoreSettings}
          onCreateCalendar={createCalendar}
          onPatchCalendar={patchCalendar}
          onReorderCalendars={reorderCalendars}
          onDeleteCalendar={deleteCalendar}
          onClearCalendarEvents={clearCalendarEvents}
          onImportIntoCalendar={importEventsIntoCalendar}
          onCreateTag={createTag}
          onUpdateTag={patchTag}
          onDeleteTag={deleteTag}
          onReplaceStore={replaceStore}
          onImportStore={importStore}
          onAddEvent={addEvent}
          onListMembers={listMembers}
          onSaveMembers={saveMembers}
          onSyncHolidays={syncHolidays}
          onRefresh={refresh}
        />
      ) : null}
      {!floatingPanels ? (
        <LoginDialog
          open={loginOpen}
          busy={loginBusy}
          error={loginError}
          dismissible={!isBrowserNeoCalendarHost() || Boolean(user)}
          onClose={() => setLoginOpen(false)}
          onSubmit={handleLogin}
        />
      ) : null}

      {inlineOverlays && quickEdit ? (
        <DayQuickEditPopover
          viewMode={viewMode}
          dateKey={quickEdit.dateKey}
          date={quickEdit.date}
          // MDC: pass store masters; DayQuickEditPopover expands recurrence per day.
          events={eventsHidden ? [] : visibleEvents}
          calendars={store.calendars}
          tags={store.tags}
          dayColor={dayColors[quickEdit.dateKey] ?? null}
          dayHighlight={dayHighlights[quickEdit.dateKey] ?? null}
          anchorRect={quickEdit.anchorRect}
          canEdit={canEdit}
          expandBody={viewMode === 'month'}
          minBodyHeight={viewMode === 'year' ? QUICK_EDIT_YEAR_MIN_BODY : undefined}
          eventDensity={eventDensity}
          zIndex={inlineQuickEditZ}
          onRaise={() => setInlineFrontPanel('quickEdit')}
          onDismissEventDetail={clearEventDetail}
          onReorderEvents={handleReorderEvents}
          onClose={() => {
            if (scopeDialog) return
            setQuickEdit(null)
          }}
          onCreate={(title, calendarId, tagIds, links) =>
            void addEvent({
              title,
              calendarId: calendarId || PRIMARY_CALENDAR_ID,
              startDate: quickEdit.dateKey,
              endDate: quickEdit.dateKey,
              allDay: true,
              tagIds,
              links
            })
          }
          onToggleCompleted={(event, completed) => {
            void handleQuickEditToggleCompleted(event, completed)
          }}
          onDeleteCompleted={(completedEvents) => {
            void handleQuickEditDeleteCompleted(completedEvents)
          }}
          onDayColorChange={(color) => {
            const next = { ...dayColors }
            if (!color) delete next[quickEdit.dateKey]
            else next[quickEdit.dateKey] = color
            void patchStoreSettings({ dayColors: next })
          }}
          onDayHighlightChange={(color) => {
            const next = { ...dayHighlights }
            if (!color) delete next[quickEdit.dateKey]
            else next[quickEdit.dateKey] = color
            void patchStoreSettings({ dayHighlights: next })
          }}
          onEventCalendarChange={handleQuickEditCalendarChange}
          onEventTagChange={handleQuickEditTagChange}
          onEventMarkerShapeChange={handleQuickEditMarkerShapeChange}
          onEventLinkChange={handleQuickEditLinkChange}
          onShiftEvent={async (event, deltaDays) => {
            if (!requireEdit() || shiftingEvent) return
            const master = findMasterEvent(event)
            if (!master || master.calendarId === HOLIDAYS_KR_CALENDAR_ID) return
            const occurrenceDate =
              getOccurrenceDate(event, quickEdit.dateKey) || master.startDate
            if (isRecurringEvent(master)) {
              setPendingShift({ master, occurrenceDate, deltaDays })
              setScopeDialog({ mode: 'shift' })
              return
            }
            setShiftingEvent(true)
            try {
              await applyEventDateShift(
                { addEvent, editEvent, removeEvent },
                { master, occurrenceDate, deltaDays }
              )
            } catch (error) {
              await alert(
                error instanceof Error ? error.message : '일정을 이동하지 못했습니다.'
              )
            } finally {
              setShiftingEvent(false)
            }
          }}
          onCopyEvent={async (event, targetDateKey) => {
            if (!requireEdit()) return
            const master = findMasterEvent(event)
            if (!master || master.calendarId === HOLIDAYS_KR_CALENDAR_ID) return
            const occurrenceDate =
              getOccurrenceDate(event, quickEdit.dateKey) || master.startDate
            try {
              await copyEventToDate({
                master,
                occurrenceDate,
                targetStartDate: targetDateKey,
                addEvent
              })
              setQuickEdit(null)
              clearEventDetail()
            } catch (error) {
              await alert(
                error instanceof Error ? error.message : '일정을 복사하지 못했습니다.'
              )
              throw error
            }
          }}
          onOpenMore={(event) => {
            if (event?.calendarId === HOLIDAYS_KR_CALENDAR_ID) return
            openEventEditor(event ?? null, {
              defaultDate: quickEdit.dateKey,
              returnQuickEdit: quickEdit
            })
          }}
          onOpenEvent={(event, pointer) =>
            openEventDetail(
              event,
              pointer ? { x: pointer.x, y: pointer.y } : quickEdit.anchorRect,
              { dayKey: quickEdit.dateKey }
            )
          }
          onEditEvent={(event) => {
            if (event.calendarId === HOLIDAYS_KR_CALENDAR_ID) return
            openEventEditor(event, {
              defaultDate: quickEdit.dateKey,
              returnQuickEdit: quickEdit
            })
          }}
          onAttachFiles={async (event) => {
            if (!requireEdit()) return
            const master =
              store.events.find((item) => item.id === (getSeriesId(event) || event.id)) ?? event
            if (!master?.id || master.calendarId === HOLIDAYS_KR_CALENDAR_ID) {
              await alert('저장된 일정에만 파일을 첨부할 수 있습니다.')
              return
            }
            try {
              await window.neoCalendar.addEventAttachments(master.id)
              await refresh()
            } catch (error) {
              await alert(
                error instanceof Error ? error.message : '파일을 첨부하지 못했습니다.'
              )
            }
          }}
        />
      ) : null}

      {inlineOverlays && eventPopover ? (
        <EventPopover
          event={eventPopover.event}
          calendar={calendarsById.get(eventPopover.event.calendarId) ?? null}
          tags={store.tags}
          dayKey={eventPopover.dayKey}
          anchorRect={eventPopover.anchorRect}
          canEdit={
            canEdit && eventPopover.event.calendarId !== HOLIDAYS_KR_CALENDAR_ID
          }
          zIndex={inlineEventDetailZ}
          onRaise={() => setInlineFrontPanel('eventDetail')}
          onClose={clearEventDetail}
          onEdit={(event) => {
            if (event.calendarId === HOLIDAYS_KR_CALENDAR_ID) return
            openEventEditor(event, {
              defaultDate: eventPopover.dayKey,
              returnQuickEdit: quickEdit
            })
          }}
          onDelete={(event) => {
            const master = findMasterEvent(event)
            if (!master) {
              void alert('일정을 찾을 수 없습니다.')
              return
            }
            if (!isRecurringEvent(master)) {
              void removeEvent(master.id).then(() => {
                closePanelsAfterEventDelete()
              })
              return
            }
            const occurrenceDate =
              getOccurrenceDate(event, eventPopover.dayKey) || master.startDate
            setPendingDelete({ master, occurrenceDate })
            setScopeDialog({ mode: 'delete' })
          }}
          onToggleCompleted={(event, completed) => {
            if (!requireEdit()) return
            const master = findMasterEvent(event)
            if (!master || master.calendarId === HOLIDAYS_KR_CALENDAR_ID) return
            const nextCompleted = Boolean(completed)
            if (!isRecurringEvent(master)) {
              void editEvent(master.id, { completed: nextCompleted }).then(() =>
                setEventPopover((prev) =>
                  prev
                    ? { ...prev, event: { ...prev.event, completed: nextCompleted } }
                    : null
                )
              )
              return
            }
            // Recurring complete → floating panel (Electron) or in-shell dialog (browser).
            const occurrenceDate =
              getOccurrenceDate(event, eventPopover.dayKey) || master.startDate
            openRecurringCompleteScope(master, occurrenceDate, nextCompleted)
          }}
          shifting={shiftingEvent}
          onShiftDate={(event, deltaDays) => {
            if (!requireEdit() || shiftingEvent) return
            const master = findMasterEvent(event)
            if (!master || master.calendarId === HOLIDAYS_KR_CALENDAR_ID) return
            const occurrenceDate =
              getOccurrenceDate(event, eventPopover.dayKey) || master.startDate
            if (isRecurringEvent(master)) {
              setPendingShift({ master, occurrenceDate, deltaDays })
              setScopeDialog({ mode: 'shift' })
              return
            }
            void (async () => {
              setShiftingEvent(true)
              try {
                await applyEventDateShift(
                  { addEvent, editEvent, removeEvent },
                  { master, occurrenceDate, deltaDays }
                )
                clearEventDetail()
              } catch (error) {
                await alert(
                  error instanceof Error ? error.message : '일정을 이동하지 못했습니다.'
                )
              } finally {
                setShiftingEvent(false)
              }
            })()
          }}
          onCopyToDate={async (event, targetDateKey) => {
            if (!requireEdit()) return
            const master = findMasterEvent(event)
            if (!master || master.calendarId === HOLIDAYS_KR_CALENDAR_ID) return
            const occurrenceDate =
              getOccurrenceDate(event, eventPopover.dayKey) || master.startDate
            try {
              await copyEventToDate({
                master,
                occurrenceDate,
                targetStartDate: targetDateKey,
                addEvent
              })
              clearEventDetail()
            } catch (error) {
              await alert(
                error instanceof Error ? error.message : '일정을 복사하지 못했습니다.'
              )
              throw error
            }
          }}
        />
      ) : null}

      {inlineOverlays && editor ? (
        <EventEditor
          open
          event={editor.event}
          defaultDate={editor.defaultDate}
          calendars={store.calendars}
          tags={store.tags}
          onEventRefresh={(updated) => {
            setEditor((prev) => (prev ? { ...prev, event: updated } : prev))
            void refresh()
          }}
          onClose={() => {
            const back = editor.returnQuickEdit
            setEditor(null)
            setPendingEdit(null)
            if (back) {
              setInlineFrontPanel('quickEdit')
              setQuickEdit(back)
            }
          }}
          onSave={async (payload, options) => {
            const keepOpen = Boolean(options?.keepOpen)
            try {
              if (!editor.event) {
                const created = await addEvent({
                  ...payload,
                  allDay: payload.allDay !== false
                } as Parameters<typeof addEvent>[0])
                if (keepOpen) {
                  setEditor((prev) =>
                    prev ? { ...prev, event: created } : { event: created, defaultDate: created.startDate }
                  )
                  void refresh()
                  return
                }
                dismissEditorAfterSave()
                return
              }

              if (pendingEdit?.needsScope) {
                setPendingEdit((prev) =>
                  prev
                    ? { ...prev, payload: payload as Record<string, unknown> }
                    : prev
                )
                setScopeDialog({ mode: 'edit' })
                return
              }

              const masterId = findMasterEvent(editor.event)?.id ?? editor.event.id
              const updated = await editEvent(masterId, payload as Partial<CalendarEvent>)
              if (keepOpen) {
                setEditor((prev) => (prev ? { ...prev, event: updated } : prev))
                void refresh()
                return
              }
              dismissEditorAfterSave()
            } catch (error) {
              await alert(error instanceof Error ? error.message : '일정을 저장하지 못했습니다.')
              throw error
            }
          }}
          onDelete={
            editor.event
              ? async () => {
                  const master = findMasterEvent(editor.event)
                  if (!master) {
                    await alert('일정을 찾을 수 없습니다.')
                    return
                  }
                  if (!isRecurringEvent(master)) {
                    await removeEvent(master.id)
                    closePanelsAfterEventDelete()
                    return
                  }
                  const occurrenceDate =
                    editor.occurrenceDate ||
                    getOccurrenceDate(editor.event, selectedKey) ||
                    master.startDate
                  setPendingDelete({ master, occurrenceDate })
                  setScopeDialog({ mode: 'delete' })
                }
              : undefined
          }
          onCopyToDate={
            editor.event
              ? async (targetDateKey) => {
                  if (!requireEdit()) return
                  const master = findMasterEvent(editor.event)
                  if (!master || master.calendarId === HOLIDAYS_KR_CALENDAR_ID) {
                    await alert('일정을 찾을 수 없습니다.')
                    return
                  }
                  const occurrenceDate =
                    editor.occurrenceDate ||
                    getOccurrenceDate(editor.event, selectedKey) ||
                    master.startDate
                  await copyEventToDate({
                    master,
                    occurrenceDate,
                    targetStartDate: targetDateKey,
                    addEvent
                  })
                  dismissEditorAfterSave()
                }
              : undefined
          }
        />
      ) : null}

      <RecurrenceScopeDialog
        open={Boolean(scopeDialog)}
        surface="overlay"
        mode={scopeDialog?.mode ?? 'edit'}
        onClose={() => {
          setScopeDialog(null)
          if (scopeDialog?.mode === 'edit') {
            /* keep editor open so user can cancel scope and continue editing */
            return
          }
          if (scopeDialog?.mode === 'complete') {
            setPendingComplete(null)
          } else if (scopeDialog?.mode === 'delete') {
            setPendingDelete(null)
          } else if (scopeDialog?.mode === 'shift') {
            setPendingShift(null)
          }
        }}
        onSelect={(scope) => {
          void handleScopeSelect(scope)
        }}
      />
    </div>
  )
}

export default CalendarGrid
