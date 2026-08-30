import koffi from 'koffi'
import type { WidgetBounds } from '../shared/ipc'
import { subscribeGlobalMouseDown, type MouseButton, type ScreenPoint } from './globalMouseHook'

/** Fallback if GetDoubleClickTime is unavailable. */
const DEFAULT_DBLCLICK_MS = 500
const COOLDOWN_MS = 400
/** Second click may jitter over desktop icons above WorkerW. */
const CLICK_JITTER_PX = 48

export type DayCellClientZone = {
  x: number
  y: number
  width: number
  height: number
  dateKey: string
}

type Point = { x: number; y: number }

type BridgeOptions = {
  isArmed: () => boolean
  /** Same screen DIP origin as header hover wake. */
  getScreenOrigin: () => { x: number; y: number } | null
  getZones: () => DayCellClientZone[]
  /** Shell chrome rects (header, footer, etc.) — clicks here must not open day quick edit. */
  getExcludeZones?: () => Array<Pick<WidgetBounds, 'x' | 'y' | 'width' | 'height'>>
  /** Called once a full double-click is confirmed on a day header zone. */
  onQuickEditClick: (payload: { dateKey: string; clientX: number; clientY: number }) => void
  /** Dev-only: mirror main-process logs into renderer DevTools. */
  onDebug?: (msg: string, data?: Record<string, unknown>) => void
  /** Skip when click should not reach the embedded calendar. */
  shouldProcessEmbeddedClick?: (pt: ScreenPoint) => boolean
}

/**
 * WorkerW child windows do not receive reliable in-window clicks on date headers.
 * Uses the shared WH_MOUSE_LL hook + GetDoubleClickTime().
 */
export class DayCellDblClickBridge {
  private unsubscribe: (() => void) | null = null
  private lastPress: { dateKey: string; at: number; x: number; y: number } | null = null
  private lastOpenAt = 0
  private lastOpenedKey: string | null = null
  private lastZoneCount = -1
  private lastMissLogAt = 0
  private lastEmptyZonesLogAt = 0
  private readonly GetDoubleClickTime: () => number
  private readonly options: BridgeOptions

  private debug(msg: string, data?: Record<string, unknown>): void {
    if (data) console.log(msg, data)
    else console.log(msg)
    this.options.onDebug?.(msg, data)
  }

  constructor(options: BridgeOptions) {
    this.options = options
    const user32 = koffi.load('user32.dll')
    this.GetDoubleClickTime = user32.func('GetDoubleClickTime', 'uint', []) as () => number
  }

  start(): void {
    if (process.platform !== 'win32' || this.unsubscribe) return
    this.unsubscribe = subscribeGlobalMouseDown((pt, button) => {
      if (button === 'left' || button === 'left-dblclick') {
        this.handleMouseDown(pt, button)
      }
    })
    console.log('[day-dblclick] global mouse hook armed (GetDoubleClickTime)')
    this.debug('[day-dblclick] hook ready — waiting for embedded clicks')
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.lastPress = null
    this.lastZoneCount = -1
  }

  private handleMouseDown(pt: ScreenPoint, button: MouseButton): void {
    if (!this.options.isArmed()) {
      this.lastPress = null
      this.lastZoneCount = -1
      return
    }
    if (this.options.shouldProcessEmbeddedClick && !this.options.shouldProcessEmbeddedClick(pt)) {
      // Icon / foreign click — drop half-finished double-click pairing.
      this.lastPress = null
      return
    }

    const zones = this.options.getZones()
    if (zones.length === 0) {
      const now = Date.now()
      if (now - this.lastEmptyZonesLogAt > 1500) {
        this.lastEmptyZonesLogAt = now
        this.debug('[day-dblclick] click ignored — main has 0 zones')
      }
      return
    }
    if (zones.length !== this.lastZoneCount) {
      this.lastZoneCount = zones.length
      this.debug('[day-dblclick] tracking', { zones: zones.length })
    }

    const origin = this.options.getScreenOrigin()
    if (!origin) {
      this.debug('[day-dblclick] click ignored — no screen origin')
      return
    }

    if (this.isExcluded(pt, origin)) {
      this.lastPress = null
      return
    }

    if (button === 'left-dblclick') {
      this.handleSystemDoubleClick(pt, origin, zones)
      return
    }

    const now = Date.now()
    const dblWindow = this.GetDoubleClickTime() || DEFAULT_DBLCLICK_MS
    const prev = this.lastPress

    let hit = this.hitDayCell(pt, origin, zones)

    if (
      !hit &&
      prev &&
      now - prev.at <= dblWindow &&
      Math.hypot(pt.x - prev.x, pt.y - prev.y) <= CLICK_JITTER_PX
    ) {
      hit = {
        dateKey: prev.dateKey,
        clientX: Math.round(pt.x - origin.x),
        clientY: Math.round(pt.y - origin.y)
      }
    }

    if (!hit) {
      if (now - this.lastMissLogAt > 800) {
        this.lastMissLogAt = now
        this.debug('[day-dblclick] click missed all zones', {
          x: pt.x,
          y: pt.y,
          origin,
          zones: zones.length
        })
      }
      if (!prev || now - prev.at > dblWindow) {
        this.lastPress = null
      }
      return
    }

    if (hit.dateKey === this.lastOpenedKey && now - this.lastOpenAt < COOLDOWN_MS) {
      return
    }

    if (prev && prev.dateKey === hit.dateKey && now - prev.at <= dblWindow) {
      this.confirmQuickEdit(pt, hit)
      return
    }

    this.lastPress = { dateKey: hit.dateKey, at: now, x: pt.x, y: pt.y }
    this.debug('[day-dblclick] first click recorded', {
      dateKey: hit.dateKey,
      dblWindowMs: dblWindow
    })
  }

  /** OS WM_LBUTTONDBLCLK — Windows already validated double-click timing. */
  private handleSystemDoubleClick(
    pt: ScreenPoint,
    origin: { x: number; y: number },
    zones: DayCellClientZone[]
  ): void {
    const now = Date.now()
    if (this.lastOpenedKey && now - this.lastOpenAt < COOLDOWN_MS) {
      return
    }

    const prev = this.lastPress
    const dblWindow = this.GetDoubleClickTime() || DEFAULT_DBLCLICK_MS
    // Orphan WM_LBUTTONDBLCLK: another app's double-click after its window
    // closes can hit WorkerW. Require a prior accepted desktop press.
    if (!prev || now - prev.at > dblWindow) {
      this.debug('[day-dblclick] dblclk ignored — no prior desktop press', {
        x: pt.x,
        y: pt.y
      })
      this.lastPress = null
      return
    }
    let hit = this.hitDayCell(pt, origin, zones)
    if (
      !hit &&
      prev &&
      Math.hypot(pt.x - prev.x, pt.y - prev.y) <= CLICK_JITTER_PX
    ) {
      hit = {
        dateKey: prev.dateKey,
        clientX: Math.round(pt.x - origin.x),
        clientY: Math.round(pt.y - origin.y)
      }
    }
    if (!hit) {
      this.debug('[day-dblclick] dblclk missed all zones', { x: pt.x, y: pt.y })
      return
    }

    this.confirmQuickEdit(pt, hit)
  }

  private confirmQuickEdit(
    pt: ScreenPoint,
    hit: { dateKey: string; clientX: number; clientY: number }
  ): void {
    const now = Date.now()
    this.lastPress = null
    this.lastOpenAt = now
    this.lastOpenedKey = hit.dateKey
    this.debug('[day-dblclick] confirmed → floating quick edit (parallel with desktop icons)', {
      dateKey: hit.dateKey,
      x: pt.x,
      y: pt.y
    })
    this.options.onQuickEditClick({
      dateKey: hit.dateKey,
      clientX: hit.clientX,
      clientY: hit.clientY
    })
  }

  private isExcluded(pt: Point, origin: { x: number; y: number }): boolean {
    const zones = this.options.getExcludeZones?.() ?? []
    for (const zone of zones) {
      const screenZone: WidgetBounds = {
        x: origin.x + zone.x,
        y: origin.y + zone.y,
        width: zone.width,
        height: zone.height
      }
      if (contains(screenZone, pt, 0)) return true
    }
    return false
  }

  private hitDayCell(
    pt: Point,
    origin: { x: number; y: number },
    zones: DayCellClientZone[]
  ): { dateKey: string; clientX: number; clientY: number } | null {
    let best: { dateKey: string; clientX: number; clientY: number } | null = null
    let bestArea = Infinity
    for (const zone of zones) {
      const screenZone: WidgetBounds = {
        x: origin.x + zone.x,
        y: origin.y + zone.y,
        width: zone.width,
        height: zone.height
      }
      if (contains(screenZone, pt)) {
        const area = screenZone.width * screenZone.height
        if (area < bestArea) {
          bestArea = area
          best = {
            dateKey: zone.dateKey,
            clientX: Math.round(pt.x - origin.x),
            clientY: Math.round(pt.y - origin.y)
          }
        }
      }
    }
    return best
  }
}

function contains(bounds: WidgetBounds, pt: Point, pad = 4): boolean {
  return (
    pt.x >= bounds.x - pad &&
    pt.y >= bounds.y - pad &&
    pt.x < bounds.x + bounds.width + pad &&
    pt.y < bounds.y + bounds.height + pad
  )
}
