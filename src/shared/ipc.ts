import type {
  DesktopQuickEditContext,
  QuickEditDeferToMainPayload,
  QuickEditWindowInit
} from './quickEditLayout'
export type { DesktopQuickEditContext, QuickEditDeferToMainPayload, QuickEditWindowInit }
import type { OpenPanelWindowRequest, PanelKind, PanelWindowInit } from './panelWindows'
export type { OpenPanelWindowRequest, PanelKind, PanelWindowInit }
import type {
  CalendarEvent,
  CalendarRecord,
  CalendarStoreSnapshot,
  EventInput,
  MemberRecord,
  MemberSaveInput,
  StoreSettings,
  SyncHolidaysInput,
  SyncHolidaysResult,
  TagRecord
} from './calendarTypes'
import type { UpdateCheckResult } from './updateCheck'
import type {
  StoreBackupArchive,
  StoreBackupRunResult,
  StoreBackupSettings,
  StoreBackupStatus
} from './storeBackup'
export type {
  StoreBackupArchive,
  StoreBackupRunResult,
  StoreBackupSettings,
  StoreBackupStatus
} from './storeBackup'
export type { UpdateCheckResult }
import type { WebServerSyncInfo } from './httpsConfig'
export type { WebServerSyncInfo, WebServerTlsStatus } from './httpsConfig'

export type SetIgnoreMouseOptions = {
  /** Electron native option mapped in main */
  forward?: boolean
  /** Project alias; treated the same as `forward` in main */
  forwardToOverlay?: boolean
  /** Capture mouse on the WorkerW calendar without undocking. */
  allowWhileEmbedded?: boolean
}

export type LaunchMode = 'desktop' | 'window'

export type WidgetBounds = {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Preferred monitor footprint — survives sleep/wake when absolute DIP coords
 * temporarily resolve to the wrong (nearest) display.
 */
export type WidgetDisplayPlacement = {
  /** Electron `Display.id` for the preferred monitor. */
  displayId: number
  /** DIP offset from that display's `bounds` origin. */
  offsetX: number
  offsetY: number
  width: number
  height: number
}

export type AppSettings = {
  widget: {
    launchMode: LaunchMode
    bounds: WidgetBounds
    /** Preferred monitor + relative offsets (multi-monitor restore). */
    displayPlacement?: WidgetDisplayPlacement | null
  }
  weekStartsOn: 0 | 1
  headerOpacity: number
  shellOpacity: number
}

export type OpacityPreviewPatch = Pick<Partial<AppSettings>, 'headerOpacity' | 'shellOpacity'>

export type { AuthUserRole } from './members'
import type { AuthUserRole } from './members'

export type AuthUser = {
  loginId: string
  role: AuthUserRole
}

export type LoginResult =
  | { ok: true; user: AuthUser }
  | { ok: false; error: string; locked?: boolean; retryAfterSec?: number }

export type ModeStatus = {
  mode: LaunchMode
  embedded: boolean
  bounds: WidgetBounds
  /** False while mode buttons are gated (cursor still on header after a switch). */
  switchReady: boolean
}

export type ClientHitRect = {
  x: number
  y: number
  width: number
  height: number
}

/** Period-toolbar zone: screen hit → inject click by stable action id. */
export type ClickForwardHitZone = ClientHitRect & {
  action: string
}

/** Stable ids for header `[data-toolbar-action]` buttons (WorkerW embedded click). */
export const PERIOD_TOOLBAR_ACTIONS = {
  viewYear: 'view-year',
  viewWeek: 'view-week',
  viewMonth: 'view-month',
  prevYear: 'prev-year',
  prev: 'prev',
  next: 'next',
  nextYear: 'next-year',
  today: 'today',
  webEditor: 'web-editor',
  dayListPreview: 'day-list-preview',
  toggleEvents: 'toggle-events',
  toggleCompleted: 'toggle-completed',
  densityDown: 'density-down',
  densityUp: 'density-up',
  letterSpacingDown: 'letter-spacing-down',
  letterSpacingUp: 'letter-spacing-up',
  letterWidthDown: 'letter-width-down',
  letterWidthUp: 'letter-width-up',
  periodScrollPrev: 'period-scroll-prev',
  periodScrollNext: 'period-scroll-next'
} as const

export const CHROME_TOOLBAR_ACTIONS = {
  search: 'search',
  settings: 'settings',
  /** Unified export options (Excel/PDF/HTML + layout/range). */
  export: 'export',
  /** All footer hints in a search-sized help panel. */
  footerHelp: 'footer-help',
  enterDesktop: 'enter-desktop',
  enterWindow: 'enter-window',
  authToggle: 'auth-toggle',
  /** App name click → full reload (WorkerW embedded). */
  reload: 'reload',
  /** Header calendar title click → edit panel (WorkerW embedded). */
  editHeaderTitle: 'edit-header-title',
  /** Collapse / expand the period row (WorkerW embedded). */
  toggleHeader: 'toggle-header'
} as const

/** Header actions that open floating panels while WorkerW-embedded. */
export const EMBEDDED_FLOATING_CHROME_ACTIONS = new Set<string>([
  CHROME_TOOLBAR_ACTIONS.search,
  CHROME_TOOLBAR_ACTIONS.settings,
  CHROME_TOOLBAR_ACTIONS.editHeaderTitle,
  CHROME_TOOLBAR_ACTIONS.footerHelp
])

/** Same-button toggle: action id → floating panel slot. */
export const CHROME_TOGGLE_ACTION_TO_SLOT = {
  [CHROME_TOOLBAR_ACTIONS.search]: 'search',
  [CHROME_TOOLBAR_ACTIONS.settings]: 'settings',
  [CHROME_TOOLBAR_ACTIONS.export]: 'exportOptions',
  [CHROME_TOOLBAR_ACTIONS.footerHelp]: 'footerHelp'
} as const

export type ChromeTogglePanelKind =
  (typeof CHROME_TOGGLE_ACTION_TO_SLOT)[keyof typeof CHROME_TOGGLE_ACTION_TO_SLOT]

export function isChromeTogglePanelKind(kind: string): kind is ChromeTogglePanelKind {
  return (
    kind === 'search' ||
    kind === 'settings' ||
    kind === 'exportOptions' ||
    kind === 'footerHelp'
  )
}

/** Header actions that detach from WorkerW and switch launch mode. */
export const EMBEDDED_MODE_CHROME_ACTIONS = new Set<string>([
  CHROME_TOOLBAR_ACTIONS.enterWindow,
  CHROME_TOOLBAR_ACTIONS.enterDesktop
])

/** Header export actions while WorkerW-embedded (undock briefly for dialogs). */
export const EMBEDDED_EXPORT_CHROME_ACTIONS = new Set<string>([
  CHROME_TOOLBAR_ACTIONS.export
])

/** Login / logout while WorkerW-embedded. */
export const EMBEDDED_AUTH_CHROME_ACTIONS = new Set<string>([
  CHROME_TOOLBAR_ACTIONS.authToggle
])

/** App-name reload while WorkerW-embedded (single click, same as search/settings). */
export const EMBEDDED_RELOAD_CHROME_ACTIONS = new Set<string>([
  CHROME_TOOLBAR_ACTIONS.reload
])

/** Header fold / unfold while WorkerW-embedded (stay under icons). */
export const EMBEDDED_HEADER_CHROME_ACTIONS = new Set<string>([
  CHROME_TOOLBAR_ACTIONS.toggleHeader
])

/** Year-view month title → open that month (`open-year-month-0` … `open-year-month-11`). */
export const YEAR_MONTH_OPEN_ACTION_PREFIX = 'open-year-month-'

export function yearMonthOpenAction(monthIndex: number): string {
  return `${YEAR_MONTH_OPEN_ACTION_PREFIX}${monthIndex}`
}

export function parseYearMonthOpenAction(action: string): number | null {
  if (!action.startsWith(YEAR_MONTH_OPEN_ACTION_PREFIX)) return null
  const n = Number(action.slice(YEAR_MONTH_OPEN_ACTION_PREFIX.length))
  return Number.isInteger(n) && n >= 0 && n <= 11 ? n : null
}

export const YEAR_MONTH_OPEN_ACTIONS: string[] = Array.from({ length: 12 }, (_, i) =>
  yearMonthOpenAction(i)
)

/**
 * Toolbar actions that fire only on WM_LBUTTONDBLCLK while embedded.
 * Year-view month titles require a double-click to enter month view.
 */
export const EMBEDDED_DOUBLE_CLICK_ACTIONS = new Set<string>(YEAR_MONTH_OPEN_ACTIONS)

/** Footer hint prev/pause/play/next while WorkerW-embedded. */
export const FOOTER_HINT_ACTIONS = {
  prev: 'footer-hint-prev',
  pause: 'footer-hint-pause',
  play: 'footer-hint-play',
  next: 'footer-hint-next'
} as const

export const EMBEDDED_FOOTER_HINT_ACTIONS = new Set<string>(Object.values(FOOTER_HINT_ACTIONS))

/** Footer site link — opens in the OS browser while WorkerW-embedded. */
export const FOOTER_LINK_ACTIONS = {
  site: 'footer-site-link'
} as const

export const EMBEDDED_FOOTER_LINK_ACTIONS = new Set<string>(Object.values(FOOTER_LINK_ACTIONS))

export type ToolbarClickPayload = {
  action: string
}

export type DayCellHitZone = ClientHitRect & {
  dateKey: string
}

export type OpenDayQuickEditPayload = {
  dateKey: string
  clientX?: number
  clientY?: number
}

export type FocusDayCellPayload = {
  dateKey: string
}

export type DayDblClickLogPayload = {
  msg: string
  data?: Record<string, unknown>
}

/** One entry per image attachment of the event — lets the viewer page through them. */
export type AttachmentImageEntry = {
  id: string
  name: string
}

export type AttachmentImageResult =
  | {
      ok: true
      /** `data:` URL — renderer CSP allows `img-src data:` without extra origins. */
      dataUrl: string
      name: string
      mime: string
      images: AttachmentImageEntry[]
    }
  | { ok: false; reason: 'not-image' | 'too-large' }

export type NeoCalendarApi = {
  setIgnoreMouse: (ignore: boolean, options?: SetIgnoreMouseOptions) => void
  getModeStatus: () => Promise<ModeStatus>
  enterDesktop: () => Promise<ModeStatus>
  enterWindow: () => Promise<ModeStatus>
  getWindowBounds: () => Promise<WidgetBounds>
  setWindowBounds: (bounds: WidgetBounds) => Promise<WidgetBounds>
  /** Legacy no-ops — unused hit-zone bridges. */
  setWindowModeHitZone: (rect: ClientHitRect | null) => void
  setHeaderHitZone: (rect: ClientHitRect | null) => void
  /** Legacy no-op — header hover wake removed. */
  setWakeHitZones: (zones: ClientHitRect[]) => void
  /** Period toolbar footprints for WorkerW embedded click → unlock + action. */
  setClickForwardHitZones: (zones: ClickForwardHitZone[]) => void
  /** Visible day-cell footprints for WorkerW custom double-click → quick edit. */
  setDayCellHitZones: (zones: DayCellHitZone[]) => void
  /** Client rects where day double-click must not fire (e.g. header/footer/weekday row). */
  setDayDblClickExcludeZones: (zones: ClientHitRect[]) => void
  setInteractionBusy: (busy: boolean) => void
  /** Activate OS keyboard/IME focus for Hangul (and other IME) text input. */
  focusForTextInput: (options?: { keepEmbedded?: boolean }) => void
  onModeChanged: (listener: (status: ModeStatus) => void) => () => void
  /** Main → renderer: open day quick edit after WorkerW double-click unlock. */
  onOpenDayQuickEdit: (listener: (payload: OpenDayQuickEditPayload) => void) => () => void
  /** Main → renderer: highlight/focus a day cell (e.g. while a floating quick-edit panel opens). */
  onFocusDayCell: (listener: (payload: FocusDayCellPayload) => void) => () => void
  /** WorkerW embedded: publish view context for floating quick-edit window. */
  setDesktopQuickEditContext: (context: DesktopQuickEditContext) => void
  /** Floating quick-edit window: read open payload after load. */
  getQuickEditInit: () => Promise<QuickEditWindowInit | null>
  closeQuickEditWindow: () => void
  /** Close floating quick edit and unlock main for editor/detail. */
  deferQuickEditToMain: (payload: QuickEditDeferToMainPayload) => Promise<boolean>
  /** Floating panel window (all panel kinds). */
  getPanelInit: () => Promise<PanelWindowInit | null>
  openPanelWindow: (request: OpenPanelWindowRequest) => Promise<boolean>
  closePanelWindow: () => void
  /** Close a floating panel by kind (sibling slots; e.g. eventDetail after recurring delete). */
  closePanelSlot: (kind: PanelKind) => void
  /**
   * Suppress outside-click dismiss for a short grace (ms).
   * Use when an in-panel modal closes so the same click does not wipe sibling panels.
   */
  blockPanelOutsideClose: (ms?: number) => void
  /**
   * Delete success: close detail/editor/scope; keep quickEdit (refreshes via store-changed).
   * Safe to call from a panel that is about to close.
   */
  closeAfterEventDelete: () => void
  routePanelWindow: (init: PanelWindowInit) => Promise<boolean>
  /** Shrink a floating panel BrowserWindow to fit its content (keeps x/y). */
  resizePanelWindow: (size: { width: number; height: number }) => Promise<boolean>
  /**
   * Floating panel: main asks the renderer to dismiss itself (save-if-dirty for eventEditor).
   * Outside-click uses this instead of destroying the window cold.
   */
  onPanelRequestDismiss: (listener: () => void) => () => void
  /** Main → main calendar: floating 세로보기 opened/closed (toolbar pressed state). */
  onDayListPreviewOpenChanged: (listener: (open: boolean) => void) => () => void
  /** Main → main calendar: search/settings/export/help opened/closed (toolbar toggle). */
  onChromePanelOpenChanged: (
    listener: (payload: { kind: ChromeTogglePanelKind; open: boolean }) => void
  ) => () => void
  /** Main → renderer: open editor/detail after floating quick edit defers. */
  onQuickEditDeferred: (listener: (payload: QuickEditDeferToMainPayload) => void) => () => void
  /** Main → renderer: run period toolbar action after embedded click unlock. */
  onToolbarClick: (listener: (payload: ToolbarClickPayload) => void) => () => void
  /** Dev: main-process day-dblclick logs mirrored into renderer DevTools. */
  onDayDblClickLog?: (listener: (payload: DayDblClickLogPayload) => void) => () => void
  /** Fired when calendar store mutates (web API or another client). */
  onStoreChanged: (listener: () => void) => () => void
  /** Main window: shell login / logout completed (including from floating login panel). */
  onAuthChanged: (listener: () => void) => () => void
  /** Floating panel → main window live opacity preview while dragging sliders. */
  applyMainOpacityPreview: (patch: OpacityPreviewPatch) => void
  /** Main window: receive opacity preview from floating settings panel. */
  onMainOpacityPreview: (listener: (patch: OpacityPreviewPatch) => void) => () => void
  getAuth: () => Promise<AuthUser | null>
  /** Show first-run admin/admin1234 hint on the login dialog. */
  showDefaultAdminHint: () => Promise<boolean>
  /** Logged-in user changes their own password. */
  changePassword: (input: {
    currentPassword: string
    nextPassword: string
  }) => Promise<{ ok: true }>
  /** Local/LAN HTTP(S) editor status (MDC /api/sync-info). */
  getSyncInfo: () => Promise<WebServerSyncInfo>
  /** Super-admin: start HTTP(S) server (local = loopback, lan = 0.0.0.0). Electron only. */
  startWebServer: (mode: 'local' | 'lan') => Promise<{
    ok: boolean
    message: string
    sync: WebServerSyncInfo
  }>
  /** Super-admin: stop HTTP(S) server. Electron only. */
  stopWebServer: () => Promise<{
    ok: boolean
    message: string
    sync: WebServerSyncInfo
  }>
  /** Super-admin: persist HTTPS and restart if the server is running. Electron only. */
  setWebServerHttps: (enabled: boolean) => Promise<{
    ok: boolean
    message: string
    sync: WebServerSyncInfo
  }>
  /** Super-admin: rebuild server cert for current LAN IPs. Electron only. */
  regenerateWebServerTls: () => Promise<{
    ok: boolean
    message: string
    sync: WebServerSyncInfo
  }>
  /** Super-admin: save ca.crt via native dialog. Electron only. */
  exportWebServerCa: () => Promise<{
    ok: boolean
    canceled?: boolean
    path?: string
    message?: string
    sync: WebServerSyncInfo
  }>
  /** Super-admin: open `{dataRoot}/tls` in Explorer. Electron only. */
  revealWebServerTlsFolder: () => Promise<{ ok: boolean; path: string }>
  /** Super-admin: Windows firewall inbound TCP allow (optional port). Electron only. */
  allowWebServerFirewall: (port?: number) => Promise<{
    ok: boolean
    message: string
    port: number
  }>
  /** Super-admin: remove Windows firewall inbound TCP allow (optional port). Electron only. */
  removeWebServerFirewall: (port?: number) => Promise<{
    ok: boolean
    message: string
    port: number
  }>
  login: (loginId: string, password: string, remember?: boolean) => Promise<LoginResult>
  logout: () => Promise<void>
  getSettings: () => Promise<AppSettings>
  patchSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>
  /** MDC-compatible calendar store */
  getCalendarStore: () => Promise<CalendarStoreSnapshot>
  patchStoreSettings: (patch: Partial<StoreSettings>) => Promise<CalendarStoreSnapshot>
  replaceCalendarStore: (store: CalendarStoreSnapshot) => Promise<CalendarStoreSnapshot>
  /** MDC import: full replace (keep holidays-kr) or single-calendar merge */
  importCalendarStore: (payload: unknown) => Promise<CalendarStoreSnapshot>
  exportBackupZip: () => Promise<{
    ok: boolean
    cancelled?: boolean
    path?: string
    attachmentFiles?: number
    eventsWithAttachments?: number
  }>
  importBackupZip: () => Promise<{
    ok: boolean
    cancelled?: boolean
    path?: string
    attachmentFiles?: number
    store?: CalendarStoreSnapshot
  }>
  /** Full-store ZIP restore from a path already chosen by the unified file picker. */
  importBackupZipFromPath: (zipPath: string) => Promise<{
    ok: boolean
    cancelled?: boolean
    path?: string
    attachmentFiles?: number
    store?: CalendarStoreSnapshot
  }>
  /** Super-admin scheduled folder backup (설정 → 백업 관리). Electron only for dest/run. */
  getStoreBackupStatus: () => Promise<StoreBackupStatus>
  saveStoreBackupConfig: (patch: Partial<StoreBackupSettings>) => Promise<StoreBackupSettings>
  runStoreBackupNow: () => Promise<StoreBackupRunResult>
  deleteStoreBackup: (fileName: string) => Promise<StoreBackupArchive[]>
  pickStoreBackupDest: () => Promise<string | null>
  exportCalendarZip: (calendarId: string) => Promise<{
    ok: boolean
    cancelled?: boolean
    path?: string
    attachmentFiles?: number
    eventsWithAttachments?: number
  }>
  importCalendarZipFromPath: (
    calendarId: string,
    zipPath: string
  ) => Promise<{
    ok: boolean
    cancelled?: boolean
    path?: string
    attachmentFiles?: number
    importedCount?: number
  }>
  pickCalendarImportFile: () => Promise<
    | { cancelled: true }
    | { cancelled: false; kind: 'text'; content: string; filename: string }
    | { cancelled: false; kind: 'zip'; filePath: string; filename: string }
    /** Browser: ZIP was already uploaded/restored during the picker step. */
    | {
        cancelled: false
        kind: 'zip-restored'
        filename: string
        attachmentFiles?: number
      }
  >
  addEvent: (input: EventInput) => Promise<CalendarEvent>
  editEvent: (id: string, patch: Partial<CalendarEvent>) => Promise<CalendarEvent>
  removeEvent: (id: string) => Promise<void>
  /** Native multi-file picker → copy into data/attachments/{eventId}/ */
  addEventAttachments: (eventId: string) => Promise<CalendarEvent>
  /** Paste / programmatic uploads (clipboard images, browser buffers). */
  addEventAttachmentBuffers: (
    eventId: string,
    uploads: Array<{ name: string; data: Uint8Array; mime?: string }>
  ) => Promise<CalendarEvent>
  /** Deep-copy attachment files from one event onto another (new file ids). */
  copyEventAttachments: (sourceEventId: string, targetEventId: string) => Promise<CalendarEvent>
  removeEventAttachment: (eventId: string, attachmentId: string) => Promise<CalendarEvent>
  openEventAttachment: (eventId: string, attachmentId: string) => Promise<void>
  /** Image attachment for the in-app viewer; non-images resolve to `{ ok: false }`. */
  readEventAttachmentImage: (
    eventId: string,
    attachmentId: string
  ) => Promise<AttachmentImageResult>
  createCalendar: (
    input: Partial<CalendarRecord> & { name: string; color: string }
  ) => Promise<CalendarRecord>
  patchCalendar: (id: string, patch: Partial<CalendarRecord>) => Promise<CalendarRecord>
  /** Persist DnD order in one round-trip (browser-safe; avoids WS refresh races). */
  reorderCalendars: (orderedIds: string[]) => Promise<CalendarRecord[]>
  deleteCalendar: (id: string) => Promise<void>
  clearCalendarEvents: (id: string) => Promise<void>
  importEventsIntoCalendar: (
    id: string,
    events: unknown[]
  ) => Promise<{ ok: true; importedCount: number; calendarId: string }>
  setTags: (tags: TagRecord[]) => Promise<TagRecord[]>
  createTag: (input: { name: string; color: string; sortOrder?: number }) => Promise<TagRecord>
  patchTag: (
    id: string,
    patch: Partial<Pick<TagRecord, 'name' | 'color' | 'sortOrder'>>
  ) => Promise<TagRecord>
  deleteTag: (id: string) => Promise<void>
  listMembers: () => Promise<MemberRecord[]>
  saveMembers: (members: MemberSaveInput[]) => Promise<MemberRecord[]>
  syncHolidays: (input?: SyncHolidaysInput) => Promise<SyncHolidaysResult>
  exportCalendar: (input: {
    format: 'excel' | 'pdf' | 'html'
    layout?: 'monthGrid' | 'dayList'
    startDate?: string
    endDate?: string
    /** @deprecated Prefer startDate/endDate. Still accepted for back-compat. */
    year?: number
    /** @deprecated Prefer startDate/endDate. Still accepted for back-compat. */
    month?: number
    includeCompleted?: boolean
    includeHolidays?: boolean
    excludeHiddenCalendars?: boolean
    dayListSortDesc?: boolean
    asAdmin?: boolean
  }) => Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>
  getDataRoot: () => Promise<string>
  /** Open http(s) URL in the system browser. */
  openExternal: (url: string) => Promise<void>
  /** Compare app version with GitHub Releases latest. */
  checkForUpdates: () => Promise<UpdateCheckResult>
}
