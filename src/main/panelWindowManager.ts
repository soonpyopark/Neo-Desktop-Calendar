import { BrowserWindow, ipcMain, screen, shell } from 'electron'
import { join } from 'node:path'
import {
  focusWindowForTextInput,
  lowerFloatingPanelWindow,
  orderFloatingPanelFront,
  presentFloatingPanelWindow,
  raiseFloatingPanelWindow
} from './windowFocus'
import { subscribeGlobalMouseDown, type ScreenPoint } from './globalMouseHook'
import { isNativeDialogOpen } from './nativeDialogGuard'
import { getWindowDipScreenBounds } from './wallpaper'
import {
  computePanelWindowBounds,
  type OpenPanelWindowRequest,
  type PanelAnchorRect,
  type PanelKind,
  type PanelWindowInit
} from '../shared/panelWindows'
import type { QuickEditDeferToMainPayload } from '../shared/quickEditLayout'
import type { OpenDayQuickEditPayload, WidgetBounds } from '../shared/ipc'
import { isChromeTogglePanelKind, type ChromeTogglePanelKind } from '../shared/ipc'
import type { QuickEditViewMode } from '../shared/quickEditLayout'
import type { WallpaperBrowserWindow } from './wallpaper'

const OUTSIDE_CLOSE_GRACE_MS = 350
const OUTSIDE_CLOSE_COOLDOWN_MS = 400
/** Year grid publishes hundreds of mini day zones; month/week stay well below this. */
const EMBEDDED_YEAR_GRID_ZONE_MIN = 120

function isEmbeddedYearQuickEdit(
  context: { viewMode: QuickEditViewMode },
  zones: Array<{ width?: number; height?: number }>
): boolean {
  if (context.viewMode === 'year') return true
  return zones.length >= EMBEDDED_YEAR_GRID_ZONE_MIN
}

function isWinAlive(win: BrowserWindow | null | undefined): win is BrowserWindow {
  if (!win) return false
  try {
    return !win.isDestroyed()
  } catch {
    return false
  }
}

function winBounds(win: BrowserWindow): { x: number; y: number; width: number; height: number } | null {
  if (!isWinAlive(win)) return null
  try {
    return win.getBounds()
  } catch {
    return null
  }
}

type PanelSlot = PanelKind

/**
 * Panels that only the user dismisses (X / Esc). The day-list preview is a reading
 * surface: it stays put while links, attachments and editors are opened from it.
 */
const EXPLICIT_CLOSE_ONLY_SLOTS = new Set<PanelSlot>(['dayListPreview'])

/**
 * Stay above the under-icons calendar as normal top-level windows (not WS_EX_TOPMOST),
 * so other apps can cover them when focused. Quick-edit / dialogs remain topmost.
 */
const NORMAL_ZORDER_SLOTS = new Set<PanelSlot>(['dayListPreview'])

/**
 * Confirm / scope dialogs (and the full event editor) that must stay above sibling
 * panels (quickEdit, detail). Without this, a click/focus bounce in quickEdit can
 * cover a newly opened editor or recurrence-complete dialog.
 * Order matters: earlier slots win when several are open (scope above editor).
 */
const MODAL_ABOVE_SIBLINGS = new Set<PanelSlot>([
  'recurrenceScope',
  'exportOptions',
  'login',
  'eventResourceList',
  'attachmentViewer',
  'headerTitleEditor',
  'eventEditor'
])

type PanelEntry = {
  slot: PanelSlot
  win: BrowserWindow
  webContentsId: number
  init: PanelWindowInit
  anchorScreen: PanelAnchorRect | null
}

type OpenEmbeddedOptions = {
  init: PanelWindowInit
  anchorClient: PanelAnchorRect | null
  mainWindow: WallpaperBrowserWindow
  /** WorkerW desktop: top-level window above desktop icons (never parent to embedded main). */
  topLevel?: boolean
}

type PanelWindowManagerOptions = {
  /** Fired when the floating panel stack becomes non-empty or empty. */
  onPanelStackChanged?: (hasOpenPanels: boolean) => void
  /** WorkerW-embedded desktop: panels must be top-level (above desktop icons). */
  isWorkerEmbedded?: () => boolean
  /** Calendar footprint in screen DIP (locked bounds when WorkerW-embedded). */
  getMainFootprint?: () => WidgetBounds | null
  /** True when the topmost window at the click point belongs to another app. */
  isForeignAppAtPoint?: (pt: ScreenPoint) => boolean
  /**
   * Screen point is on a chrome toolbar button that toggles this panel.
   * Skip outside-close so the same click can toggle the panel shut.
   */
  getChromeToggleHit?: (pt: ScreenPoint) => ChromeTogglePanelKind | null
}

export class PanelWindowManager {
  private entriesBySlot = new Map<PanelSlot, PanelEntry>()
  private slotByWebContentsId = new Map<number, PanelSlot>()
  private lastMainWindow: WallpaperBrowserWindow | null = null
  private unsubscribeOutside: (() => void) | null = null
  private outsideBlockedUntil = 0
  private lastOutsideCloseAt = 0
  /** A panel handed a link / attachment to another app — see {@link notePanelExternalOpen}. */
  private awaitingReturnFromExternalApp = false

  constructor(
    private readonly getMainWindow: () => WallpaperBrowserWindow | null,
    private readonly options: PanelWindowManagerOptions = {}
  ) {
    ipcMain.handle('panel-get-init', (event) => this.getInitForWebContents(event.sender.id))

    ipcMain.on('panel-close', (event) => {
      const slot = this.slotByWebContentsId.get(event.sender.id)
      if (slot) this.closeSlot(slot)
    })

    ipcMain.on('panel-close-slot', (_event, kind: PanelKind) => {
      if (typeof kind === 'string' && kind) this.closeSlot(kind)
    })

    // AppDialog / scope dismiss: suppress click-through that would close sibling panels (e.g. quickEdit).
    ipcMain.on('panel-block-outside-close', (_event, ms?: number) => {
      const duration =
        typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms : OUTSIDE_CLOSE_GRACE_MS
      this.blockOutsideClose(duration)
    })

    // Close detail/editor/scope after delete; keep quickEdit open (store-changed refreshes it).
    ipcMain.on('panel-close-after-event-delete', () => {
      this.closeAfterEventDelete()
    })

    ipcMain.handle('panel-resize', (event, size: { width: number; height: number }) =>
      this.resizeFromSender(event, size)
    )

    ipcMain.handle('panel-open', (event, request: OpenPanelWindowRequest) => {
      const senderWin = BrowserWindow.fromWebContents(event.sender)
      const mainWindow = this.resolveMainWindow(senderWin)
      if (!mainWindow) return false
      const { anchorClient, ...init } = request
      this.openEmbedded({
        mainWindow,
        init,
        anchorClient: anchorClient ?? null
      })
      return true
    })

    ipcMain.handle('panel-route', (event, init: PanelWindowInit) => {
      if (!this.slotByWebContentsId.has(event.sender.id)) return false
      const mainWindow = this.lastMainWindow ?? this.getMainWindow()
      if (!mainWindow || mainWindow.isDestroyed()) return false
      const anchorClient =
        init.kind === 'quickEdit'
          ? (init.anchor ?? null)
          : init.kind === 'eventDetail'
            ? (init.anchor ?? null)
            : null
      this.openEmbedded({ mainWindow, init, anchorClient })
      return true
    })

    ipcMain.handle('quick-edit-get-init', (event) => {
      const entry = this.getEntryForWebContents(event.sender.id)
      if (!entry || entry.init.kind !== 'quickEdit') return null
      const init = entry.init
      return {
        dateKey: init.dateKey,
        viewMode: init.viewMode,
        eventsHidden: init.eventsHidden,
        anchor: init.anchor ?? null
      }
    })

    ipcMain.on('quick-edit-close', (event) => {
      const slot = this.slotByWebContentsId.get(event.sender.id)
      if (slot === 'quickEdit') this.closeSlot(slot)
    })

    ipcMain.handle('quick-edit-resize', (event, size: { width: number; height: number }) =>
      this.resizeFromSender(event, size)
    )

    ipcMain.handle('quick-edit-defer-to-main', (event, payload: QuickEditDeferToMainPayload) => {
      if (!this.slotByWebContentsId.has(event.sender.id)) return false
      return this.routeFromQuickEdit(payload)
    })
  }

  private getEntryForWebContents(webContentsId: number): PanelEntry | null {
    const slot = this.slotByWebContentsId.get(webContentsId)
    if (!slot) return null
    return this.entriesBySlot.get(slot) ?? null
  }

  private getInitForWebContents(webContentsId: number): PanelWindowInit | null {
    return this.getEntryForWebContents(webContentsId)?.init ?? null
  }

  private resizeFromSender(
    event: Electron.IpcMainInvokeEvent,
    size: { width: number; height: number }
  ): boolean {
    const entry = this.getEntryForWebContents(event.sender.id)
    if (!entry || !isWinAlive(entry.win)) return false
    const w = Number(size?.width)
    const h = Number(size?.height)
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 200 || h < 120) return false
    const bounds = winBounds(entry.win)
    if (!bounds) return false
    entry.win.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: Math.round(w),
      height: Math.round(h)
    })
    return true
  }

  private routeFromQuickEdit(payload: QuickEditDeferToMainPayload): boolean {
    const mainWindow = this.lastMainWindow ?? this.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return false

    const quickEditEntry = this.entriesBySlot.get('quickEdit')
    const returnQuickEdit =
      quickEditEntry?.init.kind === 'quickEdit'
        ? {
            dateKey: quickEditEntry.init.dateKey,
            anchor: quickEditEntry.init.anchor ?? null
          }
        : { dateKey: payload.dateKey, anchor: payload.anchorScreen ?? null }

    if (payload.kind === 'editor') {
      this.openEmbedded({
        mainWindow,
        init: {
          kind: 'eventEditor',
          eventId: payload.eventId ?? null,
          defaultDate: payload.dateKey,
          occurrenceDate: payload.dateKey,
          returnQuickEdit
        },
        anchorClient: null
      })
      return true
    }

    if (payload.kind === 'detail' && payload.eventId) {
      this.openEmbedded({
        mainWindow,
        init: {
          kind: 'eventDetail',
          eventId: payload.eventId,
          dayKey: payload.dateKey,
          anchor: payload.anchorScreen ?? quickEditEntry?.anchorScreen ?? null
        },
        anchorClient: null
      })
      return true
    }

    return false
  }

  private resolveMainWindow(senderWin: BrowserWindow | null): WallpaperBrowserWindow | null {
    const main = this.getMainWindow()
    if (main && !main.isDestroyed()) return main
    if (senderWin && !senderWin.isDestroyed()) return senderWin as WallpaperBrowserWindow
    return this.lastMainWindow && !this.lastMainWindow.isDestroyed()
      ? this.lastMainWindow
      : null
  }

  private beforeOpenSlot(slot: PanelSlot): void {
    if (slot === 'eventEditor') {
      // Close detail under the editor, but keep quickEdit so delete-cancel / editor X
      // can return to the day list (desktop + window floating panels).
      this.evictSlot('eventDetail')
    }
    if (slot === 'quickEdit') {
      this.evictSlot('eventDetail')
      this.evictSlot('eventEditor')
    }
    this.evictSlot(slot)
  }

  private notifyDayListPreviewOpen(open: boolean): void {
    const main = this.getMainWindow() ?? this.lastMainWindow
    if (!main || main.isDestroyed()) return
    try {
      main.webContents.send('day-list-preview-open-changed', open)
    } catch {
      /* ignore */
    }
  }

  private notifyChromePanelOpen(kind: ChromeTogglePanelKind, open: boolean): void {
    const main = this.getMainWindow() ?? this.lastMainWindow
    if (!main || main.isDestroyed()) return
    try {
      main.webContents.send('chrome-panel-open-changed', { kind, open })
    } catch {
      /* ignore */
    }
  }

  private registerEntry(
    slot: PanelSlot,
    win: BrowserWindow,
    init: PanelWindowInit,
    anchorScreen: PanelAnchorRect | null
  ): void {
    const webContentsId = win.webContents.id
    const entry: PanelEntry = { slot, win, webContentsId, init, anchorScreen }
    this.entriesBySlot.set(slot, entry)
    this.slotByWebContentsId.set(webContentsId, slot)
    if (slot === 'dayListPreview') this.notifyDayListPreviewOpen(true)
    if (isChromeTogglePanelKind(slot)) this.notifyChromePanelOpen(slot, true)
    this.notifyPanelStackChanged()
  }

  private unregisterEntry(slot: PanelSlot, webContentsId: number): void {
    try {
      const entry = this.entriesBySlot.get(slot)
      if (entry?.webContentsId === webContentsId) {
        this.entriesBySlot.delete(slot)
      }
      if (this.slotByWebContentsId.get(webContentsId) === slot) {
        this.slotByWebContentsId.delete(webContentsId)
      }
      if (slot === 'dayListPreview') this.notifyDayListPreviewOpen(false)
      if (isChromeTogglePanelKind(slot)) this.notifyChromePanelOpen(slot, false)
      if (this.entriesBySlot.size === 0) {
        this.stopOutsideListener()
      }
      this.notifyPanelStackChanged()
    } catch {
      this.entriesBySlot.delete(slot)
      this.slotByWebContentsId.delete(webContentsId)
      if (slot === 'dayListPreview') this.notifyDayListPreviewOpen(false)
      if (isChromeTogglePanelKind(slot)) this.notifyChromePanelOpen(slot, false)
      if (this.entriesBySlot.size === 0) {
        this.stopOutsideListener()
      }
      this.notifyPanelStackChanged()
    }
  }

  private notifyPanelStackChanged(): void {
    // The day-list preview can stay open for a long time; it must not shield the
    // calendar's mouse handling the way a transient popover does.
    const hasBlockingPanel = Array.from(this.entriesBySlot.keys()).some(
      (slot) => !EXPLICIT_CLOSE_ONLY_SLOTS.has(slot)
    )
    this.options.onPanelStackChanged?.(hasBlockingPanel)
  }

  /** Remove slot tracking and close the window without relying on `closed` cleanup. */
  private evictSlot(slot: PanelSlot): void {
    const entry = this.entriesBySlot.get(slot)
    if (!entry) return
    const { webContentsId, win } = entry
    this.unregisterEntry(slot, webContentsId)
    if (!isWinAlive(win)) return
    try {
      win.removeAllListeners('closed')
      win.close()
    } catch {
      /* already destroyed */
    }
  }

  closeSlot(slot: PanelSlot): void {
    this.evictSlot(slot)
  }

  /** Ignore global outside-clicks for a short grace (modal dismiss / panel swap). */
  blockOutsideClose(ms = OUTSIDE_CLOSE_GRACE_MS): void {
    this.outsideBlockedUntil = Math.max(this.outsideBlockedUntil, Date.now() + ms)
  }

  /**
   * A panel opened a link / attachment in another app (browser, viewer, …).
   * Clicks in that app must not dismiss the panel the user came from — it stays
   * until they click back on the calendar or the desktop.
   */
  notePanelExternalOpen(): void {
    if (this.entriesBySlot.size === 0) return
    this.awaitingReturnFromExternalApp = true
    // Panels sit in the topmost band; step aside so the viewer / browser opens above.
    for (const entry of this.entriesBySlot.values()) {
      lowerFloatingPanelWindow(entry.win)
    }
  }

  /** Back on a panel: retake z-order the external app borrowed. */
  private restoreTopMostPanels(): void {
    for (const entry of this.entriesBySlot.values()) {
      if (NORMAL_ZORDER_SLOTS.has(entry.slot)) {
        presentFloatingPanelWindow(entry.win)
      } else {
        raiseFloatingPanelWindow(entry.win)
      }
    }
    this.raiseFrontModalIfAny()
  }

  private presentPanelWindow(slot: PanelSlot, win: BrowserWindow): void {
    if (NORMAL_ZORDER_SLOTS.has(slot)) {
      presentFloatingPanelWindow(win)
    } else {
      raiseFloatingPanelWindow(win)
    }
  }

  /** Prefer modal confirm/scope windows over quickEdit / detail siblings. */
  private frontModalEntry(): PanelEntry | null {
    for (const slot of MODAL_ABOVE_SIBLINGS) {
      const entry = this.entriesBySlot.get(slot)
      if (entry && isWinAlive(entry.win)) return entry
    }
    return null
  }

  private raiseFrontModalIfAny(): void {
    const modal = this.frontModalEntry()
    if (!modal) return
    raiseFloatingPanelWindow(modal.win)
  }

  /**
   * True while a click belongs to the app a panel just handed a link to.
   * Clicking anything of ours clears the wait so normal dismissal resumes.
   */
  shouldKeepPanelsForForeignClick(pt: ScreenPoint): boolean {
    if (!this.awaitingReturnFromExternalApp) return false
    if (this.entriesBySlot.size === 0) {
      this.awaitingReturnFromExternalApp = false
      return false
    }
    if (this.options.isForeignAppAtPoint?.(pt)) return true
    this.awaitingReturnFromExternalApp = false
    this.restoreTopMostPanels()
    return false
  }

  /**
   * Delete success: close scope/editor/detail. Keep quickEdit open — it refreshes via store-changed.
   * Must run in the main process — renderer timers die when the caller panel closes.
   */
  closeAfterEventDelete(): void {
    this.blockOutsideClose(500)
    for (const slot of ['recurrenceScope', 'eventEditor', 'eventDetail'] as const) {
      this.closeSlot(slot)
    }
  }

  /** Notify all floating panel renderers that the calendar store mutated. */
  broadcastStoreChanged(): void {
    for (const entry of this.entriesBySlot.values()) {
      if (!isWinAlive(entry.win)) continue
      try {
        entry.win.webContents.send('store-changed')
      } catch {
        /* ignore */
      }
    }
  }

  isOpen(): boolean {
    return this.entriesBySlot.size > 0
  }

  getWindow(): BrowserWindow | null {
    const first = this.entriesBySlot.values().next().value as PanelEntry | undefined
    if (!first || !isWinAlive(first.win)) return null
    return first.win
  }

  getWindowForWebContents(webContentsId: number): BrowserWindow | null {
    const entry = this.getEntryForWebContents(webContentsId)
    if (!entry || !isWinAlive(entry.win)) return null
    return entry.win
  }

  isPanelWebContents(webContentsId: number): boolean {
    return this.slotByWebContentsId.has(webContentsId)
  }

  isPointInsideAnyPanel(pt: ScreenPoint): boolean {
    for (const entry of this.entriesBySlot.values()) {
      const bounds = winBounds(entry.win)
      if (!bounds) continue
      if (
        pt.x >= bounds.x &&
        pt.y >= bounds.y &&
        pt.x < bounds.x + bounds.width &&
        pt.y < bounds.y + bounds.height
      ) {
        return true
      }
    }
    return false
  }

  /**
   * Tear down floating panels.
   * - Default: soft path — eventEditor gets save-if-dirty dismiss; dayListPreview stays
   *   (user-owned reading surface).
   * - `force: true`: hard-close every slot immediately (mode switch / re-embed). Soft
   *   dismiss can leave an editor or 세로보기 stranded above a click-through WorkerW
   *   calendar where the user cannot reliably dismiss it.
   */
  closeAll(options?: { force?: boolean }): void {
    if (options?.force) {
      const slots = Array.from(this.entriesBySlot.keys())
      for (const slot of slots) {
        this.closeSlot(slot)
      }
      return
    }

    const dismissableSlots = Array.from(this.entriesBySlot.keys()).filter(
      (slot) => !EXPLICIT_CLOSE_ONLY_SLOTS.has(slot)
    )
    const editor = this.entriesBySlot.get('eventEditor')
    if (editor && isWinAlive(editor.win)) {
      this.blockOutsideClose(900)
      for (const slot of dismissableSlots) {
        if (slot !== 'eventEditor') this.closeSlot(slot)
      }
      try {
        editor.win.webContents.send('panel-request-dismiss')
      } catch {
        this.closeSlot('eventEditor')
        return
      }
      // Fallback if renderer never closes (hung save / no listener).
      setTimeout(() => {
        if (this.entriesBySlot.has('eventEditor')) this.closeSlot('eventEditor')
      }, 1200)
      return
    }
    for (const slot of dismissableSlots) {
      this.closeSlot(slot)
    }
  }

  private computeWindowBounds(options: {
    init: PanelWindowInit
    resolvedAnchor: PanelAnchorRect | null
    origin: { x: number; y: number }
    mainSize: { width: number; height: number }
    workArea: { x: number; y: number; width: number; height: number }
  }): { x: number; y: number; width: number; height: number } {
    const { init, resolvedAnchor, origin, mainSize, workArea } = options
    return computePanelWindowBounds({
      init,
      anchorClient: resolvedAnchor,
      mainOrigin: origin,
      mainSize,
      workArea
    })
  }

  openEmbedded(options: OpenEmbeddedOptions): void {
    const { mainWindow, init, anchorClient, topLevel: topLevelOption } = options
    if (mainWindow.isDestroyed()) return

    const slot = init.kind
    // Same event detail already open → toggle closed (e.g. QE title click again).
    // Covers window + WorkerW floating panels (all Electron modes that use this manager).
    if (init.kind === 'eventDetail') {
      const existing = this.entriesBySlot.get('eventDetail')
      if (
        existing
        && !existing.win.isDestroyed()
        && existing.init.kind === 'eventDetail'
        && String(existing.init.eventId) === String(init.eventId)
        && String(existing.init.dayKey ?? '') === String(init.dayKey ?? '')
      ) {
        this.closeSlot('eventDetail')
        return
      }
    }
    // Chrome toolbar: click the same button again to close the floating window.
    if (
      init.kind === 'dayListPreview'
      || init.kind === 'search'
      || init.kind === 'settings'
      || init.kind === 'exportOptions'
      || init.kind === 'footerHelp'
    ) {
      const existing = this.entriesBySlot.get(init.kind)
      if (existing && isWinAlive(existing.win)) {
        this.closeSlot(init.kind)
        return
      }
    }
    // Block the outside-click listener on this same mousedown (day-dblclick opens then
    // handleOutsideClick would immediately close before the panel is shown).
    this.outsideBlockedUntil = Date.now() + OUTSIDE_CLOSE_GRACE_MS
    if (this.awaitingReturnFromExternalApp) {
      this.awaitingReturnFromExternalApp = false
      this.restoreTopMostPanels()
    }
    this.beforeOpenSlot(slot)
    this.lastMainWindow = mainWindow
    this.ensureOutsideListener()

    const mainBounds =
      this.options.getMainFootprint?.() ?? getWindowDipScreenBounds(mainWindow)
    if (!mainBounds) return

    const origin = { x: mainBounds.x, y: mainBounds.y }
    const mainSize = { width: mainBounds.width, height: mainBounds.height }
    const display = screen.getDisplayNearestPoint({
      x: origin.x + Math.round(mainSize.width / 2),
      y: origin.y + Math.round(mainSize.height / 2)
    })

    const resolvedAnchor =
      anchorClient ??
      (init.kind === 'quickEdit' || init.kind === 'eventDetail' ? (init.anchor ?? null) : null)

    const windowBounds = this.computeWindowBounds({
      init,
      resolvedAnchor,
      origin,
      mainSize,
      workArea: display.workArea
    })

    const anchorScreen: PanelAnchorRect = {
      top: windowBounds.y,
      left: windowBounds.x,
      width: windowBounds.width,
      height: windowBounds.height
    }

    const resizable = init.kind === 'eventEditor' || init.kind === 'settings'
    // Scope / confirm dialogs must stay above sibling panels (detail/quick-edit).
    const forceTopLevel =
      init.kind === 'recurrenceScope'
      || init.kind === 'exportOptions'
      || init.kind === 'login'
      || init.kind === 'eventResourceList'
      || init.kind === 'attachmentViewer'
      || init.kind === 'headerTitleEditor'
    const topLevel =
      topLevelOption ?? (forceTopLevel || (this.options.isWorkerEmbedded?.() ?? false))
    // 세로보기: top-level (above WorkerW) but not always-on-top over other apps.
    const pinAboveOtherApps = topLevel && !NORMAL_ZORDER_SLOTS.has(slot)

    const win = new BrowserWindow({
      x: windowBounds.x,
      y: windowBounds.y,
      width: windowBounds.width,
      height: windowBounds.height,
      ...(topLevel ? {} : { parent: mainWindow }),
      frame: false,
      transparent: true,
      skipTaskbar: true,
      resizable,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: true,
      show: false,
      hasShadow: false,
      alwaysOnTop: pinAboveOtherApps,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        spellcheck: false
      }
    })

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) {
        void shell.openExternal(url)
      }
      return { action: 'deny' }
    })

    const webContentsId = win.webContents.id
    win.setIgnoreMouseEvents(false)
    // Raise so scope dialogs appear above sibling panels (quickEdit / eventDetail).
    this.presentPanelWindow(slot, win)
    this.registerEntry(slot, win, init, anchorScreen)

    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return
      this.presentPanelWindow(slot, win)
      win.show()
      focusWindowForTextInput(win)
      this.outsideBlockedUntil = Math.max(
        this.outsideBlockedUntil,
        Date.now() + OUTSIDE_CLOSE_GRACE_MS
      )
      // After QE checkbox click, sibling may briefly reorder above — push modal
      // back visually only. Re-focusing here causes QE ↔ scope flicker loops.
      if (MODAL_ABOVE_SIBLINGS.has(slot)) {
        setTimeout(() => {
          if (!isWinAlive(win)) return
          orderFloatingPanelFront(win)
        }, 50)
      }
    })

    win.on('focus', () => {
      if (this.awaitingReturnFromExternalApp) {
        this.awaitingReturnFromExternalApp = false
        this.restoreTopMostPanels()
        return
      }
      // Modal confirm/scope must stay above quickEdit / detail. Visual reorder
      // only — calling focusWindowForTextInput here ping-pongs focus and flickers.
      const modal = this.frontModalEntry()
      if (modal && modal.win !== win) {
        orderFloatingPanelFront(modal.win)
        return
      }
      // Focused panel above siblings (light reorder — full raise flickers).
      orderFloatingPanelFront(win)
    })

    win.once('closed', () => {
      // Fallback if the window is destroyed without evictSlot (e.g. OS close).
      if (this.entriesBySlot.get(slot)?.webContentsId === webContentsId) {
        this.unregisterEntry(slot, webContentsId)
      }
    })

    if (process.env.ELECTRON_RENDERER_URL) {
      const base = process.env.ELECTRON_RENDERER_URL.replace(/\/$/, '')
      void win.loadURL(`${base}/panel.html`)
    } else {
      void win.loadFile(join(__dirname, '../renderer/panel.html'))
    }
  }

  openQuickEditFromEmbeddedDblClick(
    mainWindow: WallpaperBrowserWindow,
    payload: OpenDayQuickEditPayload,
    context: { viewMode: QuickEditViewMode; eventsHidden: boolean },
    zones: Array<{ x: number; y: number; width: number; height: number; dateKey: string }>
  ): void {
    let anchorClient: PanelAnchorRect | null = null
    const clientX = payload.clientX
    const clientY = payload.clientY
    const hasPointer = typeof clientX === 'number' && typeof clientY === 'number'
    const yearView = isEmbeddedYearQuickEdit(context, zones)
    const effectiveViewMode: QuickEditViewMode = yearView ? 'year' : context.viewMode

    // Year view: pointer anchor (same as window mode CalendarGrid double-click).
    if (yearView && hasPointer) {
      anchorClient = {
        left: clientX,
        top: clientY,
        width: 1,
        height: 1
      }
    } else {
      const zone = zones.find((z) => z.dateKey === payload.dateKey)
      if (zone) {
        anchorClient = {
          top: zone.y,
          left: zone.x,
          width: zone.width,
          height: zone.height
        }
      } else if (hasPointer) {
        anchorClient = {
          left: clientX - 24,
          top: clientY - 24,
          width: 48,
          height: 48
        }
      }
    }

    this.openEmbedded({
      mainWindow,
      topLevel: true,
      init: {
        kind: 'quickEdit',
        dateKey: payload.dateKey,
        viewMode: effectiveViewMode,
        eventsHidden: context.eventsHidden,
        anchor: anchorClient
      },
      anchorClient
    })
  }

  private ensureOutsideListener(): void {
    if (this.unsubscribeOutside) return
    this.unsubscribeOutside = subscribeGlobalMouseDown((pt, _button) => {
      this.handleOutsideClick(pt)
    })
  }

  private stopOutsideListener(): void {
    this.unsubscribeOutside?.()
    this.unsubscribeOutside = null
    this.awaitingReturnFromExternalApp = false
  }

  private handleOutsideClick(pt: ScreenPoint): void {
    if (this.entriesBySlot.size === 0) return
    // File/save dialogs are outside panel bounds — do not close the parent panel.
    if (isNativeDialogOpen()) return
    const now = Date.now()
    if (now < this.outsideBlockedUntil) return
    if (now - this.lastOutsideCloseAt < OUTSIDE_CLOSE_COOLDOWN_MS) return

    const entries = Array.from(this.entriesBySlot.values())
    const insideAnyPanel = entries.some((entry) => {
      const bounds = winBounds(entry.win)
      if (!bounds) return false
      return (
        pt.x >= bounds.x &&
        pt.y >= bounds.y &&
        pt.x < bounds.x + bounds.width &&
        pt.y < bounds.y + bounds.height
      )
    })

    // Click on any floating panel — keep all panels open; z-order follows focus.
    if (insideAnyPanel) return

    // Same toolbar button that opened this panel — let the button toggle it closed.
    // Without this, outside-close + the same click reopening looks like "never toggles".
    const toggleHit = this.options.getChromeToggleHit?.(pt)
    if (toggleHit) {
      const existing = this.entriesBySlot.get(toggleHit)
      if (existing && isWinAlive(existing.win)) return
    }

    // Working in the app a panel just opened a link / attachment in.
    if (this.shouldKeepPanelsForForeignClick(pt)) return

    this.lastOutsideCloseAt = now
    const dismissableSlots = Array.from(this.entriesBySlot.keys()).filter(
      (slot) => !EXPLICIT_CLOSE_ONLY_SLOTS.has(slot)
    )

    // Event editor: ask renderer to save-if-dirty then close (do not destroy cold).
    // Do not force-close on a timer — recurring edit may open a scope dialog and stay open.
    const editor = this.entriesBySlot.get('eventEditor')
    if (editor && isWinAlive(editor.win)) {
      this.blockOutsideClose(900)
      for (const slot of dismissableSlots) {
        if (slot !== 'eventEditor') this.closeSlot(slot)
      }
      try {
        editor.win.webContents.send('panel-request-dismiss')
      } catch {
        this.closeSlot('eventEditor')
      }
      return
    }

    for (const slot of dismissableSlots) {
      this.closeSlot(slot)
    }
  }
}
