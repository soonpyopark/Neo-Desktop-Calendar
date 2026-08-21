import { app, BrowserWindow, dialog, ipcMain, powerMonitor, screen, shell } from 'electron'
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { AuthService } from './auth'
import { CalendarStore } from './calendarStore/CalendarStore'
import { EventAttachmentService } from './calendarStore/eventAttachments'
import { MembersStore } from './calendarStore/membersStore'
import { DesktopModeController } from './desktopMode'
import { DesktopIdleEmbedBridge } from './desktopIdleEmbedBridge'
import { PanelWindowManager } from './panelWindowManager'
import { DesktopOutsideClickEmbedBridge } from './desktopOutsideClickEmbedBridge'
import {
  DayCellDblClickBridge,
  type DayCellClientZone
} from './dayCellDblClickBridge'
import {
  PeriodToolbarClickBridge,
  type ClickForwardClientZone
} from './periodToolbarClickBridge'
import { getEnvValue, loadDotEnv, resolveAdminCredentials } from './dotEnv'
import {
  exportBackupZip,
  exportCalendarZip,
  importBackupZip,
  importBackupZipFromPath,
  importCalendarZipFromPath
} from './calendarStore/backupZip'
import { forgetEnvHolidayKey, syncKoreanHolidays } from './calendarStore/holidaySync'
import { exportCalendarMonth } from './export/exportService'
import { normalizeExportFormat } from '../shared/exportCalendarHelpers.js'
import { SettingsStore } from './settingsStore'
import { createAppTray, type AppTray } from './tray'
import { focusWindowForTextInput } from './windowFocus'
import { isForeignAppAtPoint, shouldProcessEmbeddedGlobalClick } from './windowAtPoint'
import { desktopHitHelperHost } from './desktopHitHelperHost'
import { isNativeDialogOpen, withNativeDialog } from './nativeDialogGuard'
import { fetchLatestRelease } from './updateCheck'
import { withWallpaperApi, getWindowDipScreenBounds, type WallpaperBrowserWindow } from './wallpaper'
import { snapToTen } from './displayGeometry'
import { APP_NAME, DEFAULT_WIDGET_BOUNDS, MIN_WIDGET_HEIGHT, MIN_WIDGET_WIDTH } from '../shared/constants'
import {
  CalendarWebServer,
  resolveHttpsEnabledFromStore,
  resolveLaunchServerMode
} from './webServer/CalendarWebServer'
import {
  ensureTlsMaterial,
  getCaCertificatePath,
  getTlsDir,
  isTrustedElectronCertificate,
  isTrustedServerFingerprint,
  tlsStatusOrEmpty
} from './webServer/tlsCerts'
import { type WebServerSyncInfo } from '../shared/httpsConfig'
import { resolveDataRoot } from './calendarStore/paths'
import {
  deleteStoreBackup,
  getStoreBackupStatus,
  runStoreBackup,
  saveStoreBackupSettings,
  startStoreBackupScheduler
} from './storeBackupService'
import {
  allowFirewallInbound,
  removeFirewallInbound
} from './webServer/allowFirewallInbound'
import { resolveWebServerPort } from '../shared/webServerPort'
import type {
  CalendarEvent,
  CalendarRecord,
  CalendarStoreSnapshot,
  EventInput,
  MemberSaveInput,
  StoreSettings,
  SyncHolidaysInput,
  TagRecord
} from '../shared/calendarTypes'
import type {
  AppSettings,
  ClientHitRect,
  ClickForwardHitZone,
  DayCellHitZone,
  DesktopQuickEditContext,
  LaunchMode,
  ModeStatus,
  OpenDayQuickEditPayload,
  QuickEditDeferToMainPayload,
  ToolbarClickPayload
} from '../shared/ipc'
import {
  CHROME_TOOLBAR_ACTIONS,
  EMBEDDED_AUTH_CHROME_ACTIONS,
  EMBEDDED_EXPORT_CHROME_ACTIONS,
  EMBEDDED_FLOATING_CHROME_ACTIONS,
  EMBEDDED_FOOTER_HINT_ACTIONS,
  EMBEDDED_FOOTER_LINK_ACTIONS,
  EMBEDDED_HEADER_CHROME_ACTIONS,
  EMBEDDED_RELOAD_CHROME_ACTIONS,
  PERIOD_TOOLBAR_ACTIONS,
  YEAR_MONTH_OPEN_ACTIONS
} from '../shared/ipc'
import {
  getShellRunAtStartup,
  projectViewOptionsForClient
} from '../shared/viewOptionsBySurface'
import {
  isSuperAdminUser,
  stripMemberAdminSettingsPatch,
  type AppCapability
} from '../shared/members'

function sanitizeClientHitRects(zones: unknown): ClientHitRect[] {
  if (!Array.isArray(zones)) return []
  const out: ClientHitRect[] = []
  for (const z of zones) {
    if (!z || typeof z !== 'object') continue
    const r = z as Partial<ClientHitRect>
    const x = Number(r.x)
    const y = Number(r.y)
    const width = Number(r.width)
    const height = Number(r.height)
    if (![x, y, width, height].every(Number.isFinite)) continue
    if (width < 1 || height < 1) continue
    out.push({ x, y, width, height })
  }
  return out
}

function sanitizeDayCellHitZones(zones: unknown): DayCellClientZone[] {
  if (!Array.isArray(zones)) return []
  const out: DayCellClientZone[] = []
  for (const z of zones) {
    if (!z || typeof z !== 'object') continue
    const r = z as Partial<DayCellHitZone>
    const x = Number(r.x)
    const y = Number(r.y)
    const width = Number(r.width)
    const height = Number(r.height)
    const dateKey = typeof r.dateKey === 'string' ? r.dateKey.trim() : ''
    if (!dateKey || ![x, y, width, height].every(Number.isFinite)) continue
    if (width < 1 || height < 1) continue
    out.push({ x, y, width, height, dateKey })
  }
  return out
}

/**
 * Align Windows login-item with store (MDC StartupRegistrationService.Sync).
 * Skipped in unpackaged/dev builds so electron-vite does not register itself.
 */
function syncLoginItemFromStore(store: CalendarStore): void {
  if (!app.isPackaged) return
  const enabled = getShellRunAtStartup(store.getSnapshot().settings)
  try {
    app.setLoginItemSettings({ openAtLogin: enabled })
    console.log('[startup] login item synced:', enabled)
  } catch (err) {
    console.warn('[startup] setLoginItemSettings failed', err)
  }
}

let mainWindow: WallpaperBrowserWindow | null = null
let calendarStore: CalendarStore
let attachmentService: EventAttachmentService
let membersStore: MembersStore
let settingsStore: SettingsStore
let auth: AuthService
let desktopMode: DesktopModeController
let webServer: CalendarWebServer | null = null
let tray: AppTray | null = null
const PERIOD_TOOLBAR_ACTION_IDS = new Set<string>([
  ...Object.values(PERIOD_TOOLBAR_ACTIONS),
  ...YEAR_MONTH_OPEN_ACTIONS
])
/** Visible day-cell footprints for WorkerW custom double-click → quick edit. */
let dayCellHitZones: DayCellClientZone[] = []
/** Header/shell rects where day double-click must not fire. */
let dayDblClickExcludeZones: ClientHitRect[] = []
/** View context for WorkerW embedded floating quick edit. */
let desktopQuickEditContext: DesktopQuickEditContext = {
  viewMode: 'month',
  eventsHidden: false
}
let panelWindowManager: PanelWindowManager | null = null
/** Period toolbar footprints for WorkerW embedded click → action (stay embedded). */
let clickForwardHitZones: ClickForwardClientZone[] = []

function tlsDataRoot(): string {
  try {
    return calendarStore.dataRoot
  } catch {
    return resolveDataRoot()
  }
}

function stoppedSyncInfo(): WebServerSyncInfo {
  const settings = calendarStore.getSnapshot().settings
  const port = resolveWebServerPort(
    settings.webServerPort,
    getEnvValue('PORT', 'MYCALENDAR_PORT', 'NEOCALENDAR_PORT')
  )
  return {
    running: false,
    port: null,
    configuredPort: port,
    preferredMode: resolveLaunchServerMode(settings.webServerMode),
    hostname: null,
    lanMode: false,
    addresses: [],
    editorUrl: null,
    httpsEnabled: resolveHttpsEnabledFromStore(settings.httpsEnabled),
    tls: tlsStatusOrEmpty(tlsDataRoot())
  }
}

function currentSyncInfo(): WebServerSyncInfo {
  return webServer?.getSyncInfo() ?? stoppedSyncInfo()
}

app.on('certificate-error', (event, _webContents, _url, _error, certificate, callback) => {
  try {
    const root = tlsDataRoot()
    if (
      isTrustedElectronCertificate(certificate, root) ||
      isTrustedServerFingerprint(
        (certificate as { fingerprint256?: string }).fingerprint256,
        root
      )
    ) {
      event.preventDefault()
      callback(true)
      return
    }
  } catch {
    /* store may not be ready */
  }
  callback(false)
})

function notifyAuthChanged(): void {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('auth-changed')
    }
  } catch {
    /* ignore */
  }
}

function notifyStoreChanged(): void {
  try {
    webServer?.broadcastStoreChanged()
  } catch {
    /* ignore */
  }
  // Push to Electron renderer + floating panels so QE/detail/editor stay in sync.
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('store-changed')
    }
  } catch {
    /* ignore */
  }
  try {
    panelWindowManager?.broadcastStoreChanged()
  } catch {
    /* ignore */
  }
  try {
    tray?.rebuildMenu?.()
  } catch {
    /* ignore */
  }
}
/** True only for tray "종료" / OS shutdown — otherwise close hides to tray (MDC). */
let forceQuit = false

function requestQuit(): void {
  forceQuit = true
  desktopMode?.persistSession()
  try {
    webServer?.stop()
  } catch {
    /* ignore */
  }
  app.quit()
}

/** Display owner name follows the signed-in member loginId. */
function syncOwnerNameFromLoginId(loginId: string): void {
  const id = loginId.trim()
  if (!id) return
  const current = calendarStore.getSnapshot().settings.ownerName?.trim() ?? ''
  if (current === id) return
  calendarStore.patchStoreSettings({ ownerName: id })
}

function hitTestScreenOrigin(): { x: number; y: number } | null {
  const locked = desktopMode?.getLockedBounds() ?? null
  const live =
    mainWindow && !mainWindow.isDestroyed() ? getWindowDipScreenBounds(mainWindow) : null
  const origin = live ?? locked
  return origin ? { x: origin.x, y: origin.y } : null
}

function isForeignClickAtPoint(pt: { x: number; y: number }): boolean {
  return isForeignAppAtPoint(mainWindow, pt)
}

function shouldProcessEmbeddedClickAtPoint(pt: { x: number; y: number }): boolean {
  if (isNativeDialogOpen()) return false
  if (panelWindowManager?.isPointInsideAnyPanel(pt)) return false
  if (!shouldProcessEmbeddedGlobalClick(mainWindow, pt)) return false
  // Hidden helper (Neo-Desktop-Calendar.exe): skip calendar actions when click is on a desktop icon.
  if (desktopHitHelperHost.isIconAtDipPoint(pt)) return false
  return true
}

function restoreMainWindowMouseAfterPanels(): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  if (desktopMode.isInputLocked()) {
    win.setIgnoreMouseEvents(true)
    return
  }
  if (desktopMode.getLaunchMode() === 'window' || desktopMode.isInteractionSuspended()) {
    win.setIgnoreMouseEvents(false)
    return
  }
  if (desktopMode.isWorkerEmbedded()) {
    win.setIgnoreMouseEvents(true)
    return
  }
  win.setIgnoreMouseEvents(true, { forward: true })
}

function shieldMainWindowWhilePanelsOpen(): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  win.setIgnoreMouseEvents(true, { forward: false })
}

/**
 * A floating panel opened a link / attachment elsewhere: keep the panel alive while
 * the user works in that app (day-list preview links, event detail attachments, …).
 */
function notePanelHandedOffToExternalApp(event: Electron.IpcMainInvokeEvent): void {
  if (!panelWindowManager?.isPanelWebContents(event.sender.id)) return
  panelWindowManager.notePanelExternalOpen()
}

function resolveNativeDialogParent(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  const senderWin = BrowserWindow.fromWebContents(event.sender)
  if (
    senderWin &&
    !senderWin.isDestroyed() &&
    panelWindowManager?.isPanelWebContents(event.sender.id)
  ) {
    return senderWin
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow
  }
  return null
}

/** Mirror main-process day-dblclick logs into renderer DevTools (dev only). */
function sendDayDblClickLog(msg: string, data?: Record<string, unknown>): void {
  if (app.isPackaged) return
  const win = mainWindow
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send('day-dblclick-log', { msg, data })
}

function sanitizeClickForwardHitZones(zones: unknown): ClickForwardClientZone[] {
  if (!Array.isArray(zones)) return []
  const out: ClickForwardClientZone[] = []
  for (const z of zones) {
    if (!z || typeof z !== 'object') continue
    const r = z as Partial<ClickForwardHitZone>
    const x = Number(r.x)
    const y = Number(r.y)
    const width = Number(r.width)
    const height = Number(r.height)
    const action = typeof r.action === 'string' ? r.action.trim() : ''
    if (!action || ![x, y, width, height].every(Number.isFinite)) continue
    if (width < 1 || height < 1) continue
    out.push({ x, y, width, height, action })
  }
  return out
}

/** Unlock WorkerW embed, focus HWND, then open quick edit in renderer. */
function unlockAndOpenDayQuickEdit(payload: OpenDayQuickEditPayload): void {
  desktopMode.suspendForInteraction()
  const win = mainWindow
  if (!win || win.isDestroyed()) return

  focusWindowForTextInput(win)
  win.setIgnoreMouseEvents(false)

  // Wait for detach + mode-changed before mounting the popover.
  setTimeout(() => {
    if (win.isDestroyed()) return
    win.setIgnoreMouseEvents(false)
    win.webContents.send('open-day-quick-edit', payload)
    focusWindowForTextInput(win)
  }, 60)
}

/** WorkerW embedded: open quick edit in a top-level window above desktop icons. */
function openFloatingDayQuickEdit(payload: OpenDayQuickEditPayload): void {
  const win = mainWindow
  if (!win || win.isDestroyed() || !panelWindowManager) return
  if (!auth?.getUser()) {
    panelWindowManager.openEmbedded({
      mainWindow: win,
      init: { kind: 'login', dismissible: true },
      anchorClient: null,
      topLevel: true
    })
    return
  }
  if (!win.webContents.isDestroyed()) {
    win.webContents.send('focus-day-cell', { dateKey: payload.dateKey })
  }
  panelWindowManager.openQuickEditFromEmbeddedDblClick(
    win,
    payload,
    desktopQuickEditContext,
    dayCellHitZones
  )
}

function deferQuickEditToMain(payload: QuickEditDeferToMainPayload): void {
  desktopMode.suspendForInteraction()
  const win = mainWindow
  if (!win || win.isDestroyed()) return

  focusWindowForTextInput(win)
  win.setIgnoreMouseEvents(false)

  setTimeout(() => {
    if (win.isDestroyed()) return
    win.setIgnoreMouseEvents(false)
    win.webContents.send('quick-edit-deferred', payload)
    focusWindowForTextInput(win)
  }, 60)
}

/** WorkerW embedded: run period-toolbar action in renderer without undocking. */
function triggerEmbeddedPeriodToolbar(payload: ToolbarClickPayload): void {
  if (payload.action === CHROME_TOOLBAR_ACTIONS.enterWindow) {
    // Panels are force-closed in broadcastMode when the mode actually changes.
    desktopMode.enterWindow()
    return
  }
  if (
    !PERIOD_TOOLBAR_ACTION_IDS.has(payload.action) &&
    !EMBEDDED_FLOATING_CHROME_ACTIONS.has(payload.action) &&
    !EMBEDDED_EXPORT_CHROME_ACTIONS.has(payload.action) &&
    !EMBEDDED_AUTH_CHROME_ACTIONS.has(payload.action) &&
    !EMBEDDED_HEADER_CHROME_ACTIONS.has(payload.action) &&
    !EMBEDDED_FOOTER_HINT_ACTIONS.has(payload.action) &&
    !EMBEDDED_FOOTER_LINK_ACTIONS.has(payload.action) &&
    !EMBEDDED_RELOAD_CHROME_ACTIONS.has(payload.action)
  ) {
    return
  }
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  win.webContents.send('toolbar-click', payload)
}

/** Last mode status sent to renderers — used to close panels only on real transitions. */
let lastBroadcastMode: LaunchMode | null = null
let lastBroadcastEmbedded: boolean | null = null

function broadcastMode(status: ModeStatus): void {
  // Force-close floating panels when entering desktop from window, leaving desktop
  // for window mode, or re-embedding under icons. Soft dismiss can leave editors /
  // 세로보기 above a click-through WorkerW surface the user cannot close.
  // Do NOT close on temporary unlock (suspend) — panels stay usable while undocked.
  const enteredDesktop = lastBroadcastMode === 'window' && status.mode === 'desktop'
  const enteredWindow = lastBroadcastMode === 'desktop' && status.mode === 'window'
  const reembedded =
    status.mode === 'desktop' && status.embedded && lastBroadcastEmbedded === false
  if (enteredDesktop || enteredWindow || reembedded) {
    panelWindowManager?.closeAll({ force: true })
  }
  lastBroadcastMode = status.mode
  lastBroadcastEmbedded = status.embedded
  mainWindow?.webContents.send('mode-changed', status)
  tray?.rebuildMenu?.()
}

function createWindow(): void {
  const saved = settingsStore.getSettings().widget.bounds ?? DEFAULT_WIDGET_BOUNDS
  // Prefer the monitor of the last footprint; otherwise the monitor under the cursor.
  const anchor = {
    x: Math.round(saved.x + saved.width / 2),
    y: Math.round(saved.y + saved.height / 2)
  }
  const hasSaved = Number.isFinite(saved.x) && Number.isFinite(saved.y)
  const display = hasSaved
    ? screen.getDisplayNearestPoint(anchor)
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const area = display.workArea
  const startWidth = Math.min(Math.max(MIN_WIDGET_WIDTH, snapToTen(saved.width)), area.width)
  const startHeight = Math.min(Math.max(MIN_WIDGET_HEIGHT, snapToTen(saved.height)), area.height)
  const startX = snapToTen(
    Math.min(
      Math.max(hasSaved ? saved.x : area.x + Math.round((area.width - startWidth) / 2), area.x),
      area.x + Math.max(0, area.width - startWidth)
    )
  )
  const startY = snapToTen(
    Math.min(
      Math.max(hasSaved ? saved.y : area.y + Math.round((area.height - startHeight) / 2), area.y),
      area.y + Math.max(0, area.height - startHeight)
    )
  )

  const win = withWallpaperApi(
    new BrowserWindow({
      x: startX,
      y: startY,
      width: startWidth,
      height: startHeight,
      frame: false,
      transparent: true,
      skipTaskbar: false,
      resizable: true,
      movable: true,
      // Keep false: drag-region double-click would maximize a transparent window
      // and flash a blank gray work-area before content paints.
      maximizable: false,
      minimizable: true,
      fullscreenable: false,
      hasShadow: true,
      focusable: true,
      show: false,
      backgroundColor: '#00000000',
      title: APP_NAME,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        spellcheck: false
      }
    })
  )

  mainWindow = win

  win.setMinimumSize(MIN_WIDGET_WIDTH, MIN_WIDGET_HEIGHT)

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  let sessionRestored = false
  const restoreSession = (): void => {
    if (sessionRestored) return
    sessionRestored = true
    desktopMode.restoreFromSettings()
  }

  win.once('ready-to-show', () => {
    restoreSession()
  })

  // Packaged / remote installs: if the renderer never paints, still surface a window
  // (or tray) instead of leaving a forever-hidden BrowserWindow.
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[main] did-fail-load', { code, desc, url })
  })
  setTimeout(() => {
    if (win.isDestroyed()) return
    if (!sessionRestored) {
      console.warn('[main] ready-to-show timed out — forcing window restore')
      restoreSession()
    }
  }, 4000)

  // Window mode: keep footprint in sync while dragging/resizing.
  const persistBounds = (): void => {
    if (desktopMode.getLaunchMode() === 'window') {
      desktopMode.persistWindowBounds()
    }
  }
  win.on('moved', persistBounds)
  win.on('resized', persistBounds)
  // Belt-and-suspenders: never stay maximized (transparent HWND blanks the desktop).
  win.on('maximize', () => {
    if (win.isDestroyed()) return
    win.unmaximize()
    const locked = desktopMode.getLockedBounds()
    if (locked) win.setBounds(locked)
  })
  win.on('close', (event) => {
    desktopMode.persistSession()
    if (forceQuit) return
    // MDC: Alt+F4 / system close → tray, not quit.
    event.preventDefault()
    tray?.hideToTray?.()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
    win.webContents.once('did-finish-load', () => {
      if (win.isDestroyed()) return
      win.webContents.openDevTools({ mode: 'detach' })
    })
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.on('closed', () => {
    mainWindow = null
  })
}

function registerIpc(): void {
  const snapshotForUser = (
    loginId: string | null | undefined = auth.getUser()?.loginId,
    surface: 'native' | 'browser' = 'native'
  ): CalendarStoreSnapshot => {
    const user = auth.getUser()
    const id = loginId ?? user?.loginId
    return calendarStore.getSnapshotForLogin(id, surface, isSuperAdminUser(user))
  }

  const requireCap = (capability: AppCapability) => auth.requireCapability(capability)
  ipcMain.on(
    'set-ignore-mouse',
    (_event, ignore: boolean, options?: { forward?: boolean; forwardToOverlay?: boolean; allowWhileEmbedded?: boolean }) => {
      if (!mainWindow) return
      // Mode-switch swallow: do not let renderer clear ignore-mouse early.
      if (desktopMode.isInputLocked()) {
        mainWindow.setIgnoreMouseEvents(true)
        return
      }
      // Window mode + unlocked desktop: always capture.
      if (
        desktopMode.getLaunchMode() === 'window' ||
        desktopMode.isInteractionSuspended()
      ) {
        mainWindow.setIgnoreMouseEvents(false)
        return
      }
      // WorkerW-embedded: full click-through, unless an in-shell surface
      // needs clicks without undocking.
      if (desktopMode.isWorkerEmbedded()) {
        if (options?.allowWhileEmbedded && !ignore) {
          mainWindow.setIgnoreMouseEvents(false)
          return
        }
        mainWindow.setIgnoreMouseEvents(true)
        return
      }
      const shouldForward = options?.forwardToOverlay ?? options?.forward ?? true
      if (ignore) {
        mainWindow.setIgnoreMouseEvents(true, { forward: shouldForward })
      } else {
        mainWindow.setIgnoreMouseEvents(false)
      }
    }
  )

  // Legacy hit-zone IPCs — period toolbar + day-cell bridges active when embedded.
  ipcMain.on('set-window-mode-hit-zone', () => undefined)
  ipcMain.on('set-header-hit-zone', () => undefined)
  ipcMain.on('set-wake-hit-zones', () => undefined)
  ipcMain.on('set-click-forward-hit-zones', (_event, zones: ClickForwardHitZone[]) => {
    clickForwardHitZones = sanitizeClickForwardHitZones(zones)
  })
  ipcMain.on('set-day-cell-hit-zones', (_event, zones: DayCellHitZone[]) => {
    dayCellHitZones = sanitizeDayCellHitZones(zones)
    sendDayDblClickLog('[day-dblclick] main received zones', { count: dayCellHitZones.length })
  })
  ipcMain.on('set-day-dblclick-exclude-zones', (_event, zones: ClientHitRect[]) => {
    dayDblClickExcludeZones = sanitizeClientHitRects(zones)
  })
  ipcMain.on('set-desktop-quick-edit-context', (_event, context: DesktopQuickEditContext) => {
    const viewMode = context?.viewMode
    desktopQuickEditContext = {
      viewMode:
        viewMode === 'year' || viewMode === 'week' || viewMode === 'month'
          ? viewMode
          : desktopQuickEditContext.viewMode,
      eventsHidden: Boolean(context?.eventsHidden)
    }
  })
  ipcMain.on('set-interaction-busy', () => undefined)

  ipcMain.on('focus-for-text-input', (event, options?: { keepEmbedded?: boolean }) => {
    if (panelWindowManager?.isPanelWebContents(event.sender.id)) {
      const panelWin = panelWindowManager.getWindowForWebContents(event.sender.id)
      if (panelWin && !panelWin.isDestroyed()) {
        focusWindowForTextInput(panelWin)
      }
      return
    }
    // Panel may unregister before a late focus IPC arrives (e.g. Ctrl+S save → close).
    // Never undock the WorkerW calendar for a non-main sender.
    const senderWin = BrowserWindow.fromWebContents(event.sender)
    if (senderWin && mainWindow && !mainWindow.isDestroyed() && senderWin !== mainWindow) {
      if (!senderWin.isDestroyed()) {
        focusWindowForTextInput(senderWin)
      }
      return
    }
    desktopMode.focusForTextInput({ keepEmbedded: Boolean(options?.keepEmbedded) })
  })

  ipcMain.handle('open-external', async (event, url: string) => {
    const target = String(url ?? '').trim()
    if (!/^https?:\/\//i.test(target)) {
      throw new Error('지원하지 않는 URL입니다.')
    }
    notePanelHandedOffToExternalApp(event)
    await shell.openExternal(target)
  })

  ipcMain.handle('check-for-updates', () => fetchLatestRelease())

  ipcMain.handle('get-mode-status', () => desktopMode.getStatus())
  // No force: respects post-restore switch gate so a stray click on the
  // desktop-mode button right after launch cannot yank the window under icons.
  ipcMain.handle('enter-desktop', () =>
    desktopMode.enterDesktop({ intentional: true, force: false })
  )
  ipcMain.handle('enter-window', () => desktopMode.enterWindow())
  ipcMain.handle('get-window-bounds', () => desktopMode.getWindowBounds())
  ipcMain.handle('set-window-bounds', (_event, bounds) => desktopMode.setWindowBounds(bounds))

  ipcMain.handle('get-auth', () => auth.getUser())
  ipcMain.handle('auth:show-default-admin-hint', () =>
    membersStore.isDefaultAdminPasswordActive()
  )
  ipcMain.handle(
    'auth:change-password',
    (
      _event,
      input: { currentPassword?: string; nextPassword?: string }
    ) => {
      const user = auth.getUser()
      if (!user) throw new Error('로그인이 필요합니다.')
      const result = membersStore.changeOwnPassword(
        user.loginId,
        String(input?.currentPassword ?? ''),
        String(input?.nextPassword ?? '')
      )
      if (!result.ok) throw new Error(result.error)
      return { ok: true as const }
    }
  )
  ipcMain.handle('get-sync-info', () => currentSyncInfo())
  ipcMain.handle('web-server:start', async (_event, mode: unknown) => {
    requireCap('manageWebServer')
    if (!webServer) throw new Error('웹 서버를 사용할 수 없습니다.')
    const startMode = mode === 'lan' ? 'lan' : 'local'
    const result = await webServer.tryStart({ mode: startMode, requirePortInEnv: false })
    tray?.rebuildMenu?.()
    return { ...result, sync: webServer.getSyncInfo() }
  })
  ipcMain.handle('web-server:stop', () => {
    requireCap('manageWebServer')
    if (!webServer) throw new Error('웹 서버를 사용할 수 없습니다.')
    const result = webServer.stop()
    tray?.rebuildMenu?.()
    return { ...result, sync: webServer.getSyncInfo() }
  })
  ipcMain.handle('web-server:set-https', async (_event, enabled: unknown) => {
    requireCap('manageWebServer')
    if (!webServer) throw new Error('웹 서버를 사용할 수 없습니다.')
    const httpsEnabled = Boolean(enabled)
    calendarStore.patchStoreSettings({ httpsEnabled }, auth.getUser()?.loginId, 'native')
    notifyStoreChanged()
    if (httpsEnabled) {
      await ensureTlsMaterial({ root: tlsDataRoot() })
    }
    if (!webServer.isRunning) {
      return {
        ok: true,
        message: httpsEnabled
          ? 'HTTPS를 켰습니다. 서버를 시작하면 TLS로 접속합니다.'
          : 'HTTPS를 껐습니다. 서버를 시작하면 HTTP로 접속합니다.',
        sync: currentSyncInfo()
      }
    }
    const mode = webServer.lanMode ? 'lan' : 'local'
    const result = await webServer.tryStart({ mode, requirePortInEnv: false })
    tray?.rebuildMenu?.()
    return {
      ...result,
      message: result.ok
        ? httpsEnabled
          ? `HTTPS를 켰습니다.\n${result.message}`
          : `HTTPS를 껐습니다. HTTP로 다시 시작합니다.\n${result.message}`
        : result.message,
      sync: webServer.getSyncInfo()
    }
  })
  ipcMain.handle('web-server:regenerate-tls', async () => {
    requireCap('manageWebServer')
    if (!webServer) throw new Error('웹 서버를 사용할 수 없습니다.')
    await ensureTlsMaterial({ root: tlsDataRoot(), forceServer: true })
    if (!webServer.isRunning || !webServer.resolveHttpsEnabled()) {
      return {
        ok: true,
        message: '서버 인증서를 다시 만들었습니다.',
        sync: currentSyncInfo()
      }
    }
    const mode = webServer.lanMode ? 'lan' : 'local'
    const result = await webServer.tryStart({ mode, requirePortInEnv: false })
    tray?.rebuildMenu?.()
    return {
      ...result,
      message: result.ok
        ? `서버 인증서를 다시 만들었습니다.\n${result.message}`
        : result.message,
      sync: webServer.getSyncInfo()
    }
  })
  ipcMain.handle('web-server:export-ca', async () => {
    requireCap('manageWebServer')
    const root = tlsDataRoot()
    await ensureTlsMaterial({ root })
    const caPath = getCaCertificatePath(root)
    const saveOpts = {
      title: 'CA 인증서 내보내기',
      defaultPath: 'Neo-Desktop-Calendar-Local-CA.crt',
      filters: [{ name: '인증서', extensions: ['crt', 'pem'] }]
    }
    const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
    const result = await withNativeDialog(async () =>
      owner ? dialog.showSaveDialog(owner, saveOpts) : dialog.showSaveDialog(saveOpts)
    )
    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true, sync: currentSyncInfo() }
    }
    await copyFile(caPath, result.filePath)
    return {
      ok: true,
      path: result.filePath,
      message: `저장했습니다.\n${result.filePath}\n\nWindows: 인증서 가져오기 → 로컬 컴퓨터 → 신뢰할 수 있는 루트 인증 기관`,
      sync: currentSyncInfo()
    }
  })
  ipcMain.handle('web-server:reveal-tls-folder', async () => {
    requireCap('manageWebServer')
    const dir = getTlsDir(tlsDataRoot())
    await mkdir(dir, { recursive: true })
    const error = await shell.openPath(dir)
    if (error) throw new Error(error)
    return { ok: true, path: dir }
  })
  ipcMain.handle('web-server:allow-firewall', async (_event, port?: unknown) => {
    requireCap('manageWebServer')
    const preferred =
      port ?? calendarStore.getSnapshot().settings.webServerPort
    return allowFirewallInbound(preferred)
  })
  ipcMain.handle('web-server:remove-firewall', async (_event, port?: unknown) => {
    requireCap('manageWebServer')
    const preferred =
      port ?? calendarStore.getSnapshot().settings.webServerPort
    return removeFirewallInbound(preferred)
  })
  ipcMain.handle(
    'login',
    (_event, loginId: string, password: string, remember?: boolean) => {
      const result = auth.login(loginId, password, Boolean(remember))
      if (result.ok && result.user?.loginId) {
        syncOwnerNameFromLoginId(result.user.loginId)
        notifyStoreChanged()
        notifyAuthChanged()
      }
      return result
    }
  )
  ipcMain.handle('logout', () => {
    auth.logout()
    notifyStoreChanged()
    notifyAuthChanged()
  })

  ipcMain.handle('get-settings', () => settingsStore.getSettings())
  ipcMain.handle('patch-settings', (_event, patch: Partial<AppSettings>) =>
    settingsStore.patchSettings(patch ?? {})
  )
  ipcMain.on('apply-main-opacity-preview', (_event, patch: Partial<AppSettings>) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send('main-opacity-preview', patch ?? {})
  })

  ipcMain.handle('calendar:get-store', () => snapshotForUser())
  ipcMain.handle('calendar:get-data-root', () => calendarStore.dataRoot)
  ipcMain.handle('calendar:patch-settings', (_event, patch: Partial<StoreSettings>) => {
    const user = auth.getUser()
    const loginId = user?.loginId
    const safePatch = isSuperAdminUser(user)
      ? (patch ?? {})
      : (stripMemberAdminSettingsPatch({ ...(patch ?? {}) }) as Partial<StoreSettings>)
    calendarStore.patchStoreSettings(safePatch, loginId, 'native')
    if (safePatch?.viewOptions && typeof safePatch.viewOptions.runAtStartup === 'boolean') {
      syncLoginItemFromStore(calendarStore)
    }
    notifyStoreChanged()
    return snapshotForUser(loginId, 'native')
  })
  ipcMain.handle('calendar:replace-store', (_event, store: CalendarStoreSnapshot) => {
    requireCap('importExportStore')
    const next = calendarStore.replaceStore(store)
    notifyStoreChanged()
    return snapshotForUser() ?? next
  })
  ipcMain.handle('calendar:import-store', (_event, payload: unknown) => {
    requireCap('importExportStore')
    const loginId = auth.getUser()?.loginId
    if (!loginId) {
      throw new Error('가져오기는 로그인 후 사용할 수 있습니다.')
    }
    calendarStore.importStore(payload, loginId)
    notifyStoreChanged()
    return snapshotForUser(loginId)
  })
  ipcMain.handle('calendar:export-backup-zip', async (event) => {
    requireCap('backupStore')
    return exportBackupZip(calendarStore, resolveNativeDialogParent(event))
  })
  ipcMain.handle('calendar:import-backup-zip', async (event) => {
    requireCap('backupStore')
    const loginId = auth.getUser()?.loginId
    if (!loginId) {
      throw new Error('가져오기는 로그인 후 사용할 수 있습니다.')
    }
    return importBackupZip(calendarStore, resolveNativeDialogParent(event), loginId)
  })
  ipcMain.handle('calendar:import-backup-zip-path', async (_event, zipPath: string) => {
    requireCap('backupStore')
    const loginId = auth.getUser()?.loginId
    if (!loginId) {
      throw new Error('가져오기는 로그인 후 사용할 수 있습니다.')
    }
    const path = String(zipPath ?? '').trim()
    if (!path) throw new Error('ZIP 경로가 없습니다.')
    const result = importBackupZipFromPath(calendarStore, path, loginId)
    notifyStoreChanged()
    return result
  })
  ipcMain.handle('store-backup:status', () => {
    requireCap('backupStore')
    return getStoreBackupStatus()
  })
  ipcMain.handle('store-backup:save-config', (_event, patch: unknown) => {
    requireCap('backupStore')
    const next = saveStoreBackupSettings(patch)
    notifyStoreChanged()
    return next
  })
  ipcMain.handle('store-backup:run-now', () => {
    requireCap('backupStore')
    return runStoreBackup('manual')
  })
  ipcMain.handle('store-backup:delete', (_event, fileName: string) => {
    requireCap('backupStore')
    return deleteStoreBackup(String(fileName ?? ''))
  })
  ipcMain.handle('store-backup:pick-dest', async (event) => {
    requireCap('backupStore')
    const options: Electron.OpenDialogOptions = {
      title: '백업 폴더 선택',
      properties: ['openDirectory', 'createDirectory']
    }
    const win = resolveNativeDialogParent(event) ?? undefined
    const result = await withNativeDialog(async () =>
      win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options)
    )
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
  ipcMain.handle('calendar:export-calendar-zip', async (event, calendarId: string) => {
    if (!auth.getUser()?.loginId) {
      throw new Error('내보내기는 로그인 후 사용할 수 있습니다.')
    }
    return exportCalendarZip(
      calendarStore,
      String(calendarId ?? ''),
      resolveNativeDialogParent(event)
    )
  })
  ipcMain.handle(
    'calendar:import-calendar-zip-path',
    async (_event, calendarId: string, zipPath: string) => {
      const loginId = auth.getUser()?.loginId
      if (!loginId) {
        throw new Error('가져오기는 로그인 후 사용할 수 있습니다.')
      }
      const path = String(zipPath ?? '').trim()
      if (!path) throw new Error('ZIP 경로가 없습니다.')
      const result = importCalendarZipFromPath(
        calendarStore,
        String(calendarId ?? ''),
        path,
        loginId
      )
      notifyStoreChanged()
      return result
    }
  )
  ipcMain.handle('calendar:pick-import-file', async (event) => {
    const options: Electron.OpenDialogOptions = {
      title: '캘린더 가져오기',
      filters: [
        { name: '캘린더 파일', extensions: ['json', 'ics', 'csv', 'zip'] },
        { name: '모든 파일', extensions: ['*'] }
      ],
      properties: ['openFile']
    }
    const win = resolveNativeDialogParent(event) ?? undefined
    const result = await withNativeDialog(async () =>
      win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options)
    )
    if (result.canceled || result.filePaths.length === 0) {
      return { cancelled: true as const }
    }
    const filePath = result.filePaths[0]
    const filename = basename(filePath)
    if (filename.toLowerCase().endsWith('.zip')) {
      return {
        cancelled: false as const,
        kind: 'zip' as const,
        filePath,
        filename
      }
    }
    const content = await readFile(filePath, 'utf8')
    return {
      cancelled: false as const,
      kind: 'text' as const,
      content,
      filename
    }
  })
  ipcMain.handle('calendar:add-event', (_event, input: EventInput) => {
    const created = calendarStore.addEvent(input)
    notifyStoreChanged()
    return created
  })
  ipcMain.handle('calendar:edit-event', (_event, id: string, patch: Partial<CalendarEvent>) => {
    const updated = calendarStore.editEvent(id, patch ?? {})
    notifyStoreChanged()
    return updated
  })
  ipcMain.handle('calendar:remove-event', (_event, id: string) => {
    calendarStore.removeEvent(id)
    attachmentService.deleteAllForEvent(id)
    notifyStoreChanged()
  })
  ipcMain.handle('calendar:add-attachments', async (event, eventId: string) => {
    const options: Electron.OpenDialogOptions = {
      title: '일정에 첨부할 파일 선택',
      properties: ['openFile', 'multiSelections'],
      buttonLabel: '첨부'
    }
    const win = resolveNativeDialogParent(event) ?? undefined
    const result = await withNativeDialog(async () =>
      win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options)
    )
    if (result.canceled || result.filePaths.length === 0) {
      const current = calendarStore.getSnapshot().events.find((item) => item.id === eventId)
      if (!current) throw new Error('일정을 찾을 수 없습니다.')
      return current
    }
    const updated = attachmentService.addFromPaths(eventId, result.filePaths)
    notifyStoreChanged()
    return updated
  })
  ipcMain.handle(
    'calendar:add-attachment-buffers',
    (
      _event,
      eventId: string,
      uploads: Array<{ name: string; data: Uint8Array | number[]; mime?: string }>
    ) => {
      const normalized = (Array.isArray(uploads) ? uploads : []).map((item) => ({
        name: String(item?.name ?? 'clipboard.png'),
        mime: item?.mime,
        data: Buffer.from(item?.data ?? [])
      }))
      const updated = attachmentService.addFromBuffers(eventId, normalized)
      notifyStoreChanged()
      return updated
    }
  )
  ipcMain.handle(
    'calendar:copy-attachments',
    (_event, sourceEventId: string, targetEventId: string) => {
      const updated = attachmentService.copyBetweenEvents(sourceEventId, targetEventId)
      notifyStoreChanged()
      return updated
    }
  )
  ipcMain.handle(
    'calendar:remove-attachment',
    (_event, eventId: string, attachmentId: string) => {
      const updated = attachmentService.remove(eventId, attachmentId)
      notifyStoreChanged()
      return updated
    }
  )
  ipcMain.handle(
    'calendar:open-attachment',
    async (event, eventId: string, attachmentId: string) => {
      notePanelHandedOffToExternalApp(event)
      await attachmentService.open(eventId, attachmentId)
    }
  )
  // Stays in-app (no external handoff), so panels keep their z-order untouched.
  ipcMain.handle(
    'calendar:read-attachment-image',
    (_event, eventId: string, attachmentId: string) =>
      attachmentService.readImage(eventId, attachmentId)
  )
  ipcMain.handle(
    'calendar:create-calendar',
    (_event, input: Partial<CalendarRecord> & { name: string; color: string }) => {
      const created = calendarStore.createCalendar(input)
      const adminId = resolveAdminCredentials().id
      calendarStore.hideNewMemberCalendarForAdmin(created, adminId)
      const projected = snapshotForUser().calendars.find((c) => c.id === created.id)
      notifyStoreChanged()
      return projected ?? created
    }
  )
  ipcMain.handle(
    'calendar:patch-calendar',
    (_event, id: string, patch: Partial<CalendarRecord>) => {
      const body = { ...(patch ?? {}) }
      const loginId = auth.getUser()?.loginId?.trim() ?? ''
      // Eye-toggle is per-member, not shared calendar.visible (MDC).
      if (Object.prototype.hasOwnProperty.call(body, 'visible') && loginId) {
        const wantVisible = body.visible !== false
        calendarStore.setCalendarHiddenForLogin(loginId, id, !wantVisible)
        delete body.visible
      }
      const updated =
        Object.keys(body).length > 0
          ? calendarStore.patchCalendar(id, body)
          : (calendarStore.getSnapshot().calendars.find((c) => c.id === id) ?? null)
      if (!updated) throw new Error('캘린더를 찾을 수 없습니다.')
      const projected = snapshotForUser(loginId || auth.getUser()?.loginId).calendars.find(
        (c) => c.id === id
      )
      notifyStoreChanged()
      return projected ?? updated
    }
  )
  ipcMain.handle('calendar:reorder-calendars', (_event, orderedIds: string[]) => {
    const ids = Array.isArray(orderedIds)
      ? orderedIds.map((id) => String(id ?? '').trim()).filter(Boolean)
      : []
    calendarStore.reorderCalendars(ids)
    notifyStoreChanged()
    return snapshotForUser().calendars
  })
  ipcMain.handle('calendar:delete-calendar', (_event, id: string) => {
    calendarStore.deleteCalendar(id)
    notifyStoreChanged()
  })
  ipcMain.handle('calendar:clear-events', (_event, id: string) => {
    calendarStore.clearCalendarEvents(id)
    notifyStoreChanged()
  })
  ipcMain.handle(
    'calendar:import-into-calendar',
    (_event, id: string, events: unknown[]) => {
      const loginId = auth.getUser()?.loginId ?? resolveAdminCredentials().id
      const result = calendarStore.importEventsIntoCalendar(
        id,
        Array.isArray(events) ? events : [],
        loginId
      )
      notifyStoreChanged()
      return result
    }
  )
  ipcMain.handle('calendar:set-tags', (_event, tags: TagRecord[]) => {
    const next = calendarStore.setTags(Array.isArray(tags) ? tags : [])
    notifyStoreChanged()
    return next
  })
  ipcMain.handle(
    'calendar:create-tag',
    (_event, input: { name: string; color: string; sortOrder?: number }) => {
      const created = calendarStore.createTag(input ?? { name: '', color: '' })
      notifyStoreChanged()
      return created
    }
  )
  ipcMain.handle(
    'calendar:patch-tag',
    (_event, id: string, patch: Partial<Pick<TagRecord, 'name' | 'color' | 'sortOrder'>>) => {
      const updated = calendarStore.patchTag(id, patch ?? {})
      notifyStoreChanged()
      return updated
    }
  )
  ipcMain.handle('calendar:delete-tag', (_event, id: string) => {
    calendarStore.deleteTag(id)
    notifyStoreChanged()
  })
  ipcMain.handle('calendar:list-members', () => {
    requireCap('manageMembers')
    return membersStore.listPublic()
  })
  ipcMain.handle('calendar:save-members', (_event, members: MemberSaveInput[]) => {
    requireCap('manageMembers')
    const result = membersStore.saveMembers(Array.isArray(members) ? members : [])
    for (const loginId of result.deletedLoginIds) {
      try {
        calendarStore.purgeMemberOwnedData(loginId)
        auth.revokeSessionsForLoginId(loginId)
      } catch (err) {
        console.warn('[members] purge failed', loginId, err)
      }
    }
    // MDC: ensure a personal calendar for every active member after each save.
    const adminId = auth.getUser()?.loginId ?? resolveAdminCredentials().id
    for (const member of result.members) {
      if (member.active === false) continue
      const loginId = String(member.loginId ?? '').trim()
      if (!loginId) continue
      try {
        calendarStore.ensurePersonalCalendar(loginId, member.displayName, adminId)
      } catch (err) {
        console.warn('[members] ensure personal calendar failed', loginId, err)
      }
    }
    notifyStoreChanged()
    return result.members
  })
  ipcMain.handle('calendar:sync-holidays', async (_event, body: SyncHolidaysInput) => {
    requireCap('syncHolidays')
    const result = await syncKoreanHolidays(calendarStore, body ?? {})
    notifyStoreChanged()
    return result
  })
  ipcMain.handle(
    'calendar:export',
    async (
      event,
      input: {
        format: 'excel' | 'pdf' | 'html'
        layout?: 'monthGrid' | 'dayList'
        startDate?: string
        endDate?: string
        year?: number
        month?: number
        includeCompleted?: boolean
        includeHolidays?: boolean
        excludeHiddenCalendars?: boolean
        dayListSortDesc?: boolean
        asAdmin?: boolean
      }
    ) => {
      const user = auth.getUser()
      const loginId = user?.loginId
      if (!loginId) throw new Error('로그인이 필요합니다.')
      const excludeHidden = Boolean(input?.excludeHiddenCalendars)
      const raw = snapshotForUser(loginId, 'native')
      const projected: CalendarStoreSnapshot = excludeHidden
        ? raw
        : {
            ...raw,
            calendars: raw.calendars.map((calendar) => ({ ...calendar, visible: true }))
          }
      const store: CalendarStoreSnapshot = {
        ...projected,
        settings: projectViewOptionsForClient(projected.settings, 'native')
      }
      const senderWin = BrowserWindow.fromWebContents(event.sender)
      const parent =
        senderWin &&
        !senderWin.isDestroyed() &&
        panelWindowManager?.isPanelWebContents(event.sender.id)
          ? senderWin
          : mainWindow
      return exportCalendarMonth(
        {
          store,
          format: normalizeExportFormat(input?.format),
          layout: input?.layout === 'dayList' ? 'dayList' : 'monthGrid',
          startDate: input?.startDate,
          endDate: input?.endDate,
          year: input?.year != null ? Number(input.year) : undefined,
          month: input?.month != null ? Number(input.month) : undefined,
          includeCompleted: input?.includeCompleted !== false,
          includeHolidays: input?.includeHolidays !== false,
          excludeHiddenCalendars: excludeHidden,
          dayListSortDesc: Boolean(input?.dayListSortDesc),
          asAdmin: isSuperAdminUser(user) && input?.asAdmin !== false
        },
        parent && !parent.isDestroyed() ? parent : null
      )
    }
  )
}

/** Reveal the already-running instance without changing its saved launch mode. */
function focusExistingInstance(): void {
  try {
    if (!desktopMode) return
    if (desktopMode.getLaunchMode() === 'desktop') {
      // Keep desktop mode persisted; temporarily detach from WorkerW for interaction.
      desktopMode.suspendForInteraction()
      const desktopWin = mainWindow
      if (desktopWin && !desktopWin.isDestroyed()) {
        desktopWin.show()
        desktopWin.focus()
        desktopWin.moveTop()
      }
      tray?.rebuildMenu?.()
      return
    }
    const win = mainWindow
    if (!win || win.isDestroyed()) {
      if (app.isReady()) createWindow()
      return
    }
    if (win.isMinimized()) win.restore()
    win.setAlwaysOnTop(true, 'floating')
    win.show()
    win.focus()
    win.moveTop()
    setTimeout(() => {
      if (!win.isDestroyed() && desktopMode?.getLaunchMode() === 'window') {
        win.setAlwaysOnTop(false)
      }
    }, 400)
    tray?.rebuildMenu?.()
  } catch (error) {
    console.warn('[main] second-instance focus failed', error)
  }
}

// One process only — second launch reveals the existing instance.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (app.isReady()) {
      focusExistingInstance()
      return
    }
    void app.whenReady().then(() => focusExistingInstance())
  })

  app.whenReady().then(() => {
    try {
      bootApp()
    } catch (error) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error)
      console.error('[main] startup failed:', message)
      try {
        dialog.showErrorBox(`${APP_NAME} 시작 실패`, message)
      } catch {
        /* ignore */
      }
      app.quit()
    }
  })
}

function bootApp(): void {
  loadDotEnv()
  calendarStore = new CalendarStore()
  attachmentService = new EventAttachmentService(calendarStore)
  // 공휴일 키는 빌드 시점(npm run seed:holidays) 전용 — 설정에는 심지 않고, 예전에 심긴 키는 지운다.
  forgetEnvHolidayKey(calendarStore, getEnvValue('DATA_GO_KR_SERVICE_KEY', 'HOLIDAY_API_KEY') ?? '')
  membersStore = new MembersStore(calendarStore.dataRoot)
  settingsStore = new SettingsStore(calendarStore)
  auth = new AuthService(settingsStore, membersStore, {
    isLoginLockoutEnabled: () =>
      calendarStore.getSnapshot().settings.loginLockoutEnabled === true
  })
  try {
    const adminId = resolveAdminCredentials().id
    const memberIds = membersStore
      .listPublic()
      .filter((m) => m.active !== false)
      .map((m) => m.loginId)
    calendarStore.ensureMemberOwnership(adminId, memberIds)
  } catch (err) {
    console.warn('[calendar-store] ensure member ownership failed', err)
  }
  const sessionUser = auth.getUser()
  if (sessionUser?.loginId) {
    syncOwnerNameFromLoginId(sessionUser.loginId)
  }
  syncLoginItemFromStore(calendarStore)
  console.log('[calendar-store] Data root:', calendarStore.dataRoot)
  desktopMode = new DesktopModeController({
    getWindow: () => mainWindow,
    store: settingsStore,
    onModeChanged: broadcastMode
  })

  registerIpc()
  startStoreBackupScheduler(calendarStore)
  desktopHitHelperHost.start()

  webServer = new CalendarWebServer({
    auth,
    calendarStore,
    membersStore,
    attachments: attachmentService,
    getWwwroot: () => join(__dirname, '../renderer'),
    getViteOrigin: () => process.env.ELECTRON_RENDERER_URL?.trim() || null,
    getDataRoot: () => calendarStore.dataRoot,
    getHttpsEnabled: () =>
      resolveHttpsEnabledFromStore(calendarStore.getSnapshot().settings.httpsEnabled),
    getListenPort: () =>
      resolveWebServerPort(
        calendarStore.getSnapshot().settings.webServerPort,
        getEnvValue('PORT', 'MYCALENDAR_PORT', 'NEOCALENDAR_PORT')
      ),
    onServerStarted: ({ mode }) => {
      const cur = calendarStore.getSnapshot().settings.webServerMode
      if (cur === mode) return
      calendarStore.patchStoreSettings(
        { webServerMode: mode },
        auth.getUser()?.loginId,
        'native'
      )
      notifyStoreChanged()
    },
    onStoreMutated: () => notifyStoreChanged()
  })
  // Tray first so a later window/bridge failure still leaves a visible shell icon.
  tray = createAppTray({
    getWindow: () => mainWindow,
    desktopMode,
    getDataRoot: () => calendarStore.dataRoot,
    requestQuit,
    webServer
  })

  // MDC StartWebServerOnLaunch — default Local; refresh tray checkmarks after listen.
  void (async () => {
    try {
      const mode = resolveLaunchServerMode(
        calendarStore.getSnapshot().settings.webServerMode
      )
      const started = await webServer.tryStart({
        mode,
        requirePortInEnv: false,
        persistPreference: false
      })
      if (!started.ok) {
        console.warn('[web-server] auto-start skipped:', started.message)
      } else {
        const info = webServer.getSyncInfo()
        if (info.editorUrl) {
          console.log(`[dev:browser] Browser test URL: ${info.editorUrl}`)
        } else if (info.port) {
          console.log(`[dev:browser] Browser test URL: http://127.0.0.1:${info.port}/`)
        }
      }
    } catch (err) {
      console.warn('[web-server] auto-start failed', err)
    } finally {
      try {
        tray?.rebuildMenu?.()
      } catch {
        /* ignore */
      }
    }
  })()

  createWindow()

  panelWindowManager = new PanelWindowManager(() => mainWindow, {
    onPanelStackChanged: (hasOpenPanels) => {
      if (hasOpenPanels) shieldMainWindowWhilePanelsOpen()
      else restoreMainWindowMouseAfterPanels()
    },
    isWorkerEmbedded: () => desktopMode.isWorkerEmbedded(),
    getMainFootprint: () => {
      const locked = desktopMode.getLockedBounds()
      if (desktopMode.isWorkerEmbedded() && locked) return locked
      const live =
        mainWindow && !mainWindow.isDestroyed() ? getWindowDipScreenBounds(mainWindow) : null
      return live ?? locked
    },
    isForeignAppAtPoint: (pt) => isForeignClickAtPoint(pt)
  })

  // Cold-start unlocked desktop: 10s without input → WorkerW embed.
  const idleEmbed = new DesktopIdleEmbedBridge({
    isArmed: () =>
      desktopMode.getLaunchMode() === 'desktop' && desktopMode.isInteractionSuspended(),
    onEmbed: () => {
      desktopMode.resumeUnderIcons()
    }
  })
  idleEmbed.start()
  mainWindow?.webContents.on('before-input-event', () => {
    idleEmbed.noteActivity()
  })

  // Unlocked desktop: click outside calendar → re-embed under icons.
  const outsideClickEmbed = new DesktopOutsideClickEmbedBridge({
    isArmed: () =>
      desktopMode.getLaunchMode() === 'desktop' && desktopMode.isInteractionSuspended(),
    getAppBounds: () => {
      const locked = desktopMode.getLockedBounds()
      const live =
        mainWindow && !mainWindow.isDestroyed() ? getWindowDipScreenBounds(mainWindow) : null
      return live ?? locked
    },
    isForeignAppAtPoint: (pt) => isForeignClickAtPoint(pt),
    shouldSkipClick: (pt) =>
      isNativeDialogOpen() ||
      (panelWindowManager?.isPointInsideAnyPanel(pt) ?? false) ||
      // Re-embedding closes every panel — not while a panel's link is being read elsewhere.
      (panelWindowManager?.shouldKeepPanelsForForeignClick(pt) ?? false),
    onEmbed: () => {
      desktopMode.resumeUnderIcons()
    }
  })
  outsideClickEmbed.start()

  // WorkerW-embedded: click period toolbar → action (stay embedded).
  const toolbarClick = new PeriodToolbarClickBridge({
    isArmed: () => desktopMode.isWorkerEmbedded(),
    getScreenOrigin: () => hitTestScreenOrigin(),
    getZones: () => clickForwardHitZones,
    shouldProcessEmbeddedClick: (pt) => shouldProcessEmbeddedClickAtPoint(pt),
    onToolbarClick: (payload) => {
      triggerEmbeddedPeriodToolbar({ action: payload.action })
    }
  })
  toolbarClick.start()

  // WorkerW-embedded: custom double-click on date cell → unlock + quick edit.
  const dayDblClick = new DayCellDblClickBridge({
    isArmed: () => desktopMode.isWorkerEmbedded(),
    getScreenOrigin: () => hitTestScreenOrigin(),
    getZones: () => dayCellHitZones,
    getExcludeZones: () => dayDblClickExcludeZones,
    shouldProcessEmbeddedClick: (pt) => shouldProcessEmbeddedClickAtPoint(pt),
    onDebug: (msg, data) => sendDayDblClickLog(msg, data),
    onQuickEditClick: (payload) => {
      openFloatingDayQuickEdit(payload)
    }
  })
  dayDblClick.start()

  const onDisplayChanged = (): void => {
    desktopMode.onDisplayTopologyChanged()
  }
  screen.on('display-added', onDisplayChanged)
  screen.on('display-removed', onDisplayChanged)
  screen.on('display-metrics-changed', onDisplayChanged)

  // Sleep/hibernate wake: re-resolve preferred monitor after displays settle.
  try {
    powerMonitor.on('resume', () => {
      console.log('[desktop] powerMonitor resume → reaffirm display placement')
      desktopMode.onPowerResume()
    })
  } catch (error) {
    console.warn('[desktop] powerMonitor resume unavailable:', error)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
}

app.on('before-quit', () => {
  forceQuit = true
  desktopMode?.persistSession()
  try {
    desktopHitHelperHost.stop()
  } catch {
    /* ignore */
  }
  try {
    webServer?.stop()
  } catch {
    /* ignore */
  }
})

app.on('window-all-closed', () => {
  // Keep running in the tray while the BrowserWindow is only hidden.
  if (!forceQuit) return
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
