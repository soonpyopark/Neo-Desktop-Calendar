import { BrowserWindow } from 'electron'
import { DEFAULT_WIDGET_BOUNDS, MIN_WIDGET_HEIGHT, MIN_WIDGET_WIDTH } from '../shared/constants'
import type { LaunchMode, ModeStatus, WidgetBounds, WidgetDisplayPlacement } from '../shared/ipc'
import type { SettingsStore } from './settingsStore'
import {
  captureDisplayPlacement,
  centerOnCursorDisplay,
  normalizeBoundsToDisplay,
  resolveDisplayPlacement
} from './displayGeometry'
import { clearWallpaperPin, isWorkerEmbedded, setAsWallpaper } from './wallpaper'
import { focusWindowForTextInput } from './windowFocus'

type DesktopModeOptions = {
  getWindow: () => BrowserWindow | null
  store: SettingsStore
  onModeChanged?: (status: ModeStatus) => void
}

/**
 * Desktop = WorkerW under-icons + click-through (or temporary unlocked).
 * Window = normal movable/resizable app window.
 *
 * Cold-start after desktop quit → unlocked; 10s idle → embed.
 * Window UI → 바탕화면 모드 → embed immediately.
 * Tray → 창 모드.
 */
export class DesktopModeController {
  private mode: LaunchMode = 'window'
  private lockedBounds: WidgetBounds | null = null
  /** Preferred monitor footprint — kept even when that display is temporarily offline. */
  private preferredPlacement: WidgetDisplayPlacement | null = null
  private modeSwitchAllowed = true
  private switchGateGeneration = 0
  private switchGateTimer: ReturnType<typeof setTimeout> | null = null
  private topologyTimer: ReturnType<typeof setTimeout> | null = null
  private topologyRetryTimer: ReturnType<typeof setTimeout> | null = null
  private inputLockedUntil = 0
  private inputUnlockTimer: ReturnType<typeof setTimeout> | null = null
  /**
   * Unlocked desktop: WorkerW detached, footprint locked, real mouse/IME.
   * Used for cold-start after a desktop session (10s idle then embeds).
   */
  private interactionSuspended = false
  /**
   * After cold-start window restore, ignore non-forced enterDesktop briefly.
   * Prevents a cursor sitting on the desktop-mode button from burying the UI.
   */
  private blockDesktopEnterUntil = 0
  private readonly getWindow: () => BrowserWindow | null
  private readonly store: SettingsStore
  private readonly onModeChanged?: (status: ModeStatus) => void

  constructor(options: DesktopModeOptions) {
    this.getWindow = options.getWindow
    this.store = options.store
    this.onModeChanged = options.onModeChanged
  }

  lockInput(ms: number): void {
    this.inputLockedUntil = Math.max(this.inputLockedUntil, Date.now() + ms)
    const win = this.getWindow()
    if (win && !win.isDestroyed()) {
      win.setIgnoreMouseEvents(true)
    }
    if (this.inputUnlockTimer) clearTimeout(this.inputUnlockTimer)
    this.inputUnlockTimer = setTimeout(() => {
      this.inputUnlockTimer = null
      this.releaseInputWhenSafe()
    }, ms + 20)
  }

  private releaseInputWhenSafe(): void {
    const current = this.getWindow()
    if (!current || current.isDestroyed()) return
    if (Date.now() < this.inputLockedUntil) return

    if (this.mode === 'window') {
      current.setIgnoreMouseEvents(false)
      current.setAlwaysOnTop(false)
      current.show()
      current.focus()
      current.moveTop()
    } else if (this.interactionSuspended) {
      current.setIgnoreMouseEvents(false)
    } else {
      current.setIgnoreMouseEvents(true)
    }
  }

  isInputLocked(): boolean {
    return Date.now() < this.inputLockedUntil
  }

  private armModeSwitchGate(ms = 280): void {
    this.modeSwitchAllowed = false
    this.switchGateGeneration += 1
    const generation = this.switchGateGeneration

    if (this.switchGateTimer) clearTimeout(this.switchGateTimer)

    this.onModeChanged?.(this.getStatus())

    this.switchGateTimer = setTimeout(() => {
      if (generation !== this.switchGateGeneration) return
      this.modeSwitchAllowed = true
      console.log('[desktop] Mode switch ready')
      this.onModeChanged?.(this.getStatus())
    }, ms)
  }

  private blurRendererChrome(): void {
    const win = this.getWindow()
    if (!win || win.isDestroyed()) return
    void win.webContents
      .executeJavaScript(
        `(() => { try { document.activeElement instanceof HTMLElement && document.activeElement.blur(); } catch {} })()`,
        true
      )
      .catch(() => undefined)
  }

  /**
   * After WorkerW attach + showInactive, pin HWND opacity to 1.
   * Header/shell transparency stays on CSS `--neo-*-opacity` (settings 일반).
   */
  private settleDesktopVisuals(win: BrowserWindow): void {
    try {
      win.setOpacity(1)
    } catch {
      /* ignore */
    }
  }

  private readStoredPlacement(): WidgetDisplayPlacement | null {
    const stored = this.store.getSettings().widget.displayPlacement
    return stored ? { ...stored } : null
  }

  /**
   * Normalize absolute bounds.
   * When `updatePreferred` is true (default), also remember the monitor as preferred.
   * Use `updatePreferred: false` for temporary hosts (preferred display offline).
   */
  private commitFootprint(
    bounds: WidgetBounds,
    options: { persist?: boolean; updatePreferred?: boolean } = {}
  ): WidgetBounds {
    const updatePreferred = options.updatePreferred !== false
    const next = normalizeBoundsToDisplay(bounds)
    this.lockedBounds = next
    if (updatePreferred) {
      this.preferredPlacement = captureDisplayPlacement(next)
    }
    if (options.persist !== false) {
      if (updatePreferred) {
        this.store.setWidget({
          launchMode: this.mode,
          bounds: next,
          displayPlacement: this.preferredPlacement
        })
      } else {
        this.store.setWidget({ launchMode: this.mode, bounds: next })
      }
    }
    return next
  }

  /** Resolve preferred monitor placement → absolute DIP bounds. */
  private resolveFootprint(fallback?: WidgetBounds | null): {
    bounds: WidgetBounds
    matchedPreferredDisplay: boolean
  } {
    const preferred = this.preferredPlacement ?? this.readStoredPlacement()
    const absolute =
      fallback ?? this.lockedBounds ?? this.store.getWidgetBounds() ?? DEFAULT_WIDGET_BOUNDS
    const resolved = resolveDisplayPlacement(preferred, absolute)
    this.lockedBounds = resolved.bounds
    if (resolved.matchedPreferredDisplay) {
      this.preferredPlacement = captureDisplayPlacement(resolved.bounds)
    } else if (!this.preferredPlacement && preferred) {
      this.preferredPlacement = preferred
    } else if (!this.preferredPlacement) {
      this.preferredPlacement = captureDisplayPlacement(resolved.bounds)
    }
    return {
      bounds: resolved.bounds,
      matchedPreferredDisplay: resolved.matchedPreferredDisplay
    }
  }

  private applyFootprintToWindow(
    bounds: WidgetBounds,
    options: { reembed?: boolean } = {}
  ): void {
    const win = this.getWindow()
    if (!win || win.isDestroyed()) return
    win.setBounds(bounds)
    if (options.reembed && this.mode === 'desktop' && !this.interactionSuspended) {
      setAsWallpaper(win, bounds)
    }
  }

  getLaunchMode(): LaunchMode {
    return this.mode
  }

  isWorkerEmbedded(): boolean {
    return this.mode === 'desktop' && isWorkerEmbedded() && !this.interactionSuspended
  }

  isInteractionSuspended(): boolean {
    return this.interactionSuspended
  }

  getStatus(): ModeStatus {
    return {
      mode: this.mode,
      embedded: this.isWorkerEmbedded(),
      bounds: this.lockedBounds ?? this.store.getWidgetBounds(),
      switchReady: this.modeSwitchAllowed
    }
  }

  /** Temporary undock for header hover wake / text IME. */
  suspendForInteraction(): void {
    if (this.mode !== 'desktop' || this.interactionSuspended) return
    const win = this.getWindow()
    if (!win || win.isDestroyed() || !this.lockedBounds) return

    const footprint = { ...this.lockedBounds }
    this.interactionSuspended = true
    clearWallpaperPin(win, footprint)
    win.setSkipTaskbar(true)
    win.setResizable(false)
    win.setMovable(false)
    win.setAlwaysOnTop(false)
    win.setHasShadow(false)
    win.setBounds(footprint)
    win.setIgnoreMouseEvents(false)
    win.setBounds(footprint)
    focusWindowForTextInput(win)
    win.setBounds(footprint)
    console.log('[desktop] Suspended under-icons — window-like input', footprint)
    this.onModeChanged?.(this.getStatus())
  }

  /** Embed unlocked desktop under icons (WorkerW). */
  resumeUnderIcons(): void {
    if (this.mode !== 'desktop' || !this.interactionSuspended) return
    const win = this.getWindow()
    if (!win || win.isDestroyed() || !this.lockedBounds) {
      this.interactionSuspended = false
      return
    }

    const { bounds: footprint } = this.resolveFootprint(this.lockedBounds)
    this.interactionSuspended = false
    win.setBounds(footprint)
    setAsWallpaper(win, footprint)
    win.setIgnoreMouseEvents(true)
    win.showInactive()
    this.settleDesktopVisuals(win)
    console.log('[desktop] Resumed under-icons (principle #1)', {
      footprint,
      displayId: this.preferredPlacement?.displayId
    })
    this.onModeChanged?.(this.getStatus())
  }

  /** IME/focus helper; undocks if still embedded unless `keepEmbedded`. */
  focusForTextInput(options?: { keepEmbedded?: boolean }): void {
    const win = this.getWindow()
    if (!win || win.isDestroyed()) return
    if (this.mode === 'desktop' && !this.interactionSuspended && !options?.keepEmbedded) {
      this.suspendForInteraction()
      return
    }
    win.setIgnoreMouseEvents(false)
    focusWindowForTextInput(win)
  }

  /**
   * Next launch: restore last quit mode + footprint.
   * Desktop quit → start unlocked; 10s idle embeds under icons.
   */
  restoreFromSettings(): void {
    const settings = this.store.getSettings()
    this.preferredPlacement = settings.widget.displayPlacement
      ? { ...settings.widget.displayPlacement }
      : null
    const saved = settings.widget.bounds
    const fallback = saved
      ? saved
      : centerOnCursorDisplay(DEFAULT_WIDGET_BOUNDS.width, DEFAULT_WIDGET_BOUNDS.height)
    const { bounds, matchedPreferredDisplay } = this.resolveFootprint(fallback)
    if (!this.preferredPlacement || matchedPreferredDisplay) {
      this.preferredPlacement = captureDisplayPlacement(bounds)
    }

    const mode = settings.widget.launchMode === 'desktop' ? 'desktop' : 'window'
    console.log('[desktop] Restoring session', {
      mode,
      bounds,
      displayId: this.preferredPlacement.displayId,
      matchedPreferredDisplay
    })

    if (mode === 'desktop') {
      this.restoreDesktopUnlocked(bounds, {
        updatePreferred: matchedPreferredDisplay || !this.preferredPlacement
      })
      return
    }

    this.enterWindow({ persist: true, fromRestore: true, force: true })
    setTimeout(() => {
      if (this.mode !== 'window') return
      const w = this.getWindow()
      if (!w || w.isDestroyed()) return
      w.setAlwaysOnTop(true, 'floating')
      w.show()
      w.focus()
      w.moveTop()
      setTimeout(() => {
        if (this.mode === 'window' && !w.isDestroyed()) w.setAlwaysOnTop(false)
      }, 1500)
    }, 200)
  }

  /**
   * Cold-start desktop: locked footprint + unlocked (not WorkerW yet).
   * Idle embed bridge attaches under icons after 10s without input.
   */
  private restoreDesktopUnlocked(
    bounds: WidgetBounds,
    options: { updatePreferred?: boolean } = {}
  ): void {
    const win = this.getWindow()
    if (!win || win.isDestroyed()) return

    // Set desktop before commitFootprint — otherwise launchMode is persisted as the
    // controller default (`window`) and the next reboot/auto-start restores window mode.
    this.mode = 'desktop'
    this.interactionSuspended = true
    const footprint = this.commitFootprint(bounds, {
      persist: true,
      updatePreferred: options.updatePreferred !== false
    })
    this.armModeSwitchGate(250)

    clearWallpaperPin(win, footprint)
    win.setSkipTaskbar(true)
    win.setResizable(false)
    win.setMovable(false)
    win.setMinimizable(false)
    win.setMaximizable(false)
    win.setHasShadow(false)
    win.setOpacity(1)
    win.setBounds(footprint)
    win.setIgnoreMouseEvents(false)
    win.setAlwaysOnTop(true, 'floating')
    win.show()
    win.focus()
    win.moveTop()
    focusWindowForTextInput(win)
    win.setBounds(footprint)

    console.log('[desktop] Restored desktop unlocked (no WorkerW yet)', {
      bounds: footprint,
      displayId: this.preferredPlacement?.displayId
    })
    this.onModeChanged?.(this.getStatus())

    setTimeout(() => {
      if (this.mode !== 'desktop' || !this.interactionSuspended) return
      const w = this.getWindow()
      if (!w || w.isDestroyed()) return
      w.setAlwaysOnTop(false)
    }, 1500)
  }

  /** Save mode + size/position for the next cold start (call on quit). */
  persistSession(): void {
    const win = this.getWindow()
    let bounds: WidgetBounds
    if (this.mode === 'desktop') {
      bounds = this.lockedBounds ?? this.store.getWidgetBounds() ?? DEFAULT_WIDGET_BOUNDS
    } else if (win && !win.isDestroyed()) {
      bounds = win.getBounds()
    } else {
      bounds = this.lockedBounds ?? this.store.getWidgetBounds() ?? DEFAULT_WIDGET_BOUNDS
    }
    this.commitFootprint(bounds, { persist: true })
    console.log('[desktop] Persisted session on quit', {
      mode: this.mode,
      bounds: this.lockedBounds,
      displayId: this.preferredPlacement?.displayId
    })
  }

  /**
   * Debounced re-clamp / re-pin after monitor plug/unplug, DPI change, or sleep wake.
   * Keeps preferred displayId even when that monitor is briefly offline.
   */
  onDisplayTopologyChanged(): void {
    if (this.topologyTimer) clearTimeout(this.topologyTimer)
    this.topologyTimer = setTimeout(() => {
      this.topologyTimer = null
      this.applyDisplayTopology('topology')
      // Sleep/wake often brings secondary monitors online a moment later.
      if (this.topologyRetryTimer) clearTimeout(this.topologyRetryTimer)
      this.topologyRetryTimer = setTimeout(() => {
        this.topologyRetryTimer = null
        this.applyDisplayTopology('topology-retry')
      }, 1500)
    }, 400)
  }

  /** Immediate re-apply after OS resume (sleep/hibernate). */
  onPowerResume(): void {
    if (this.topologyTimer) clearTimeout(this.topologyTimer)
    this.topologyTimer = setTimeout(() => {
      this.topologyTimer = null
      this.applyDisplayTopology('power-resume')
      if (this.topologyRetryTimer) clearTimeout(this.topologyRetryTimer)
      this.topologyRetryTimer = setTimeout(() => {
        this.topologyRetryTimer = null
        this.applyDisplayTopology('power-resume-retry')
      }, 2000)
    }, 800)
  }

  private applyDisplayTopology(reason: string): void {
    if (!this.preferredPlacement && !this.lockedBounds && !this.readStoredPlacement()) return

    const { bounds: next, matchedPreferredDisplay } = this.resolveFootprint(this.lockedBounds)
    const win = this.getWindow()
    if (!win || win.isDestroyed()) return

    this.applyFootprintToWindow(next, {
      reembed: this.mode === 'desktop' && !this.interactionSuspended
    })

    if (matchedPreferredDisplay) {
      this.preferredPlacement = captureDisplayPlacement(next)
      this.store.setWidget({
        launchMode: this.mode,
        bounds: next,
        displayPlacement: this.preferredPlacement
      })
      console.log(`[desktop] Re-applied footprint (${reason}) on preferred display`, {
        bounds: next,
        displayId: this.preferredPlacement.displayId
      })
    } else {
      // Temporary host only — keep preferred displayPlacement in settings.
      this.store.setWidget({ launchMode: this.mode, bounds: next })
      console.log(`[desktop] Preferred display offline (${reason}) — temporary clamp`, {
        bounds: next,
        preferredDisplayId: this.preferredPlacement?.displayId
      })
    }
    this.onModeChanged?.(this.getStatus())
  }

  enterDesktop(
    options: {
      persist?: boolean
      bounds?: WidgetBounds
      intentional?: boolean
      force?: boolean
      /** Tray / explicit restore only — bypasses startup window lock. */
      fromTray?: boolean
    } = {}
  ): ModeStatus {
    const win = this.getWindow()
    if (!win) return this.getStatus()

    if (!options.intentional) {
      console.log('[desktop] Ignoring non-intentional enterDesktop')
      return this.getStatus()
    }

    if (this.mode === 'desktop') {
      return this.getStatus()
    }

    if (!options.fromTray && Date.now() < this.blockDesktopEnterUntil) {
      console.log('[desktop] Ignoring enterDesktop — startup window lock', {
        force: Boolean(options.force),
        remainingMs: this.blockDesktopEnterUntil - Date.now()
      })
      return this.getStatus()
    }

    if (!options.force && !this.modeSwitchAllowed) {
      console.log('[desktop] Ignoring enterDesktop — mode switch gate')
      return this.getStatus()
    }

    const sourceBounds =
      options.bounds ??
      (this.mode === 'window' ? win.getBounds() : null) ??
      this.lockedBounds ??
      this.store.getWidgetBounds() ??
      win.getBounds()

    this.mode = 'desktop'
    this.interactionSuspended = false
    this.lockedBounds = this.commitFootprint(sourceBounds, { persist: options.persist !== false })
    this.armModeSwitchGate(250)
    this.lockInput(200)

    win.setSkipTaskbar(true)
    win.setResizable(false)
    win.setMovable(false)
    win.setMinimizable(false)
    win.setMaximizable(false)
    win.setAlwaysOnTop(false)
    win.setHasShadow(false)
    win.setBounds(this.lockedBounds)
    setAsWallpaper(win, this.lockedBounds)
    win.setIgnoreMouseEvents(true)
    if (!win.isVisible()) win.showInactive()
    else win.showInactive()
    this.settleDesktopVisuals(win)
    this.blurRendererChrome()

    console.log('[desktop] Desktop mode (under-icons)', {
      bounds: this.lockedBounds,
      displayId: this.preferredPlacement?.displayId,
      workerEmbedded: isWorkerEmbedded()
    })
    const status = this.getStatus()
    this.onModeChanged?.(status)
    return status
  }

  enterWindow(
    options: { persist?: boolean; fromRestore?: boolean; force?: boolean } = {}
  ): ModeStatus {
    const win = this.getWindow()
    if (!win) return this.getStatus()

    if (!options.fromRestore && this.mode === 'window') {
      win.show()
      win.focus()
      win.moveTop()
      return this.getStatus()
    }

    if (!options.fromRestore && !options.force && !this.modeSwitchAllowed) {
      console.log('[desktop] Ignoring enterWindow — mode switch gate')
      return this.getStatus()
    }

    this.mode = 'window'
    this.interactionSuspended = false
    if (options.fromRestore) {
      this.blockDesktopEnterUntil = Date.now() + 4000
    }
    this.armModeSwitchGate(options.fromRestore ? 1500 : 250)
    this.lockInput(options.fromRestore ? 250 : 200)

    const { bounds, matchedPreferredDisplay } = this.resolveFootprint(
      this.lockedBounds ?? this.store.getWidgetBounds() ?? win.getBounds() ?? DEFAULT_WIDGET_BOUNDS
    )
    this.lockedBounds = this.commitFootprint(bounds, {
      persist: options.persist !== false,
      // Cold-start restore may land on a temporary host — keep preferred monitor id.
      updatePreferred: !options.fromRestore || matchedPreferredDisplay || !this.preferredPlacement
    })

    clearWallpaperPin(win, this.lockedBounds)
    win.setSkipTaskbar(false)
    win.setMinimumSize(MIN_WIDGET_WIDTH, MIN_WIDGET_HEIGHT)
    win.setResizable(true)
    win.setMovable(true)
    win.setMinimizable(true)
    // Custom edge grips only — OS maximize blanks the transparent shell for a frame.
    win.setMaximizable(false)
    win.setFullScreenable(false)
    win.setHasShadow(true)
    win.setOpacity(1)
    win.setBounds(this.lockedBounds)
    win.setAlwaysOnTop(true, 'floating')
    win.setIgnoreMouseEvents(false)
    win.show()
    win.focus()
    win.moveTop()
    this.blurRendererChrome()

    console.log('[desktop] Window mode bounds', {
      bounds: this.lockedBounds,
      displayId: this.preferredPlacement?.displayId
    })

    const status = this.getStatus()
    this.onModeChanged?.(status)
    return status
  }

  persistWindowBounds(): void {
    const win = this.getWindow()
    if (!win) return
    this.commitFootprint(win.getBounds(), { persist: true })
  }

  getWindowBounds(): WidgetBounds {
    const win = this.getWindow()
    if (!win) return this.lockedBounds ?? this.store.getWidgetBounds()
    return normalizeBoundsToDisplay(win.getBounds())
  }

  getLockedBounds(): WidgetBounds | null {
    return this.lockedBounds ? { ...this.lockedBounds } : null
  }

  setWindowBounds(bounds: WidgetBounds): WidgetBounds {
    const win = this.getWindow()
    if (!win || this.mode !== 'window') {
      return this.getWindowBounds()
    }
    const next = this.commitFootprint(bounds, { persist: true })
    win.setBounds(next)
    return next
  }
}
