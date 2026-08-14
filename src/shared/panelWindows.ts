import {
  computeQuickEditWindowBounds,
  type QuickEditAnchorRect,
  type QuickEditViewMode
} from './quickEditLayout'

export type PanelKind =
  | 'quickEdit'
  | 'eventEditor'
  | 'settings'
  | 'search'
  | 'eventDetail'
  | 'exportOptions'
  | 'recurrenceScope'
  | 'login'
  | 'dayListPreview'
  | 'eventResourceList'
  | 'attachmentViewer'
  | 'headerTitleEditor'
  | 'footerHelp'

/** Compact header-title editor (name / size / color) — initial size; host resizes to content. */
export const HEADER_TITLE_EDITOR_PANEL_WIDTH = 450
export const HEADER_TITLE_EDITOR_PANEL_HEIGHT = 380

/** Link / attachment chooser floating panel size. */
export const EVENT_RESOURCE_LIST_PANEL_WIDTH = 448
export const EVENT_RESOURCE_LIST_PANEL_HEIGHT = 420

export type PanelAnchorRect = QuickEditAnchorRect

export type PanelReturnQuickEdit = {
  dateKey: string
  anchor?: PanelAnchorRect | null
}

export type PanelWindowInit =
  | {
      kind: 'quickEdit'
      dateKey: string
      viewMode: QuickEditViewMode
      eventsHidden: boolean
      anchor?: PanelAnchorRect | null
    }
  | {
      kind: 'eventEditor'
      eventId?: string | null
      defaultDate?: string
      occurrenceDate?: string | null
      returnQuickEdit?: PanelReturnQuickEdit | null
    }
  | {
      kind: 'settings'
    }
  | {
      kind: 'search'
      eventsHidden: boolean
    }
  | {
      kind: 'eventDetail'
      eventId: string
      dayKey?: string
      anchor?: PanelAnchorRect | null
      /** Screen DIP pointer — used when opening from another floating panel window. */
      pointerScreen?: { x: number; y: number } | null
      fromSearch?: boolean
    }
  | {
      kind: 'exportOptions'
      /** Reference date for presets (usually current view month). YYYY-MM-DD */
      referenceDate?: string
      weekStartsOnSunday?: boolean
    }
  | {
      kind: 'recurrenceScope'
      mode: 'complete' | 'delete' | 'edit'
      eventId: string
      occurrenceDate: string
      /** Required when mode is `complete`. */
      completed?: boolean
      /** Close these sibling panels after a successful delete (e.g. eventDetail). */
      closePanels?: Array<Exclude<PanelKind, 'recurrenceScope'>>
    }
  | {
      kind: 'login'
      /** When false, backdrop/close/cancel cannot dismiss (login wall). */
      dismissible?: boolean
    }
  | {
      kind: 'dayListPreview'
      /** Month shown in the portrait day-list preview (same layout as PDF export). */
      year: number
      /** 0-based month. */
      month: number
    }
  | {
      kind: 'eventResourceList'
      /** Which resource list to show. */
      type: 'links' | 'attachments'
      eventId: string
    }
  | {
      kind: 'attachmentViewer'
      eventId: string
      attachmentId: string
    }
  | {
      kind: 'headerTitleEditor'
    }
  | {
      /** All footer tips in one search-sized panel. */
      kind: 'footerHelp'
    }

export type OpenPanelWindowRequest = PanelWindowInit & {
  /** Client-space anchor when opening from the main renderer. */
  anchorClient?: PanelAnchorRect | null
}

const VIEWPORT_PAD = 5

/** Event detail popover / floating panel size (px) — fixed across all modes. */
export const EVENT_DETAIL_PANEL_WIDTH = 500
export const EVENT_DETAIL_PANEL_HEIGHT = 336

/** Settings + search panel width — 90% of main calendar / shell width. */
export const MAIN_PANEL_WIDTH_RATIO = 0.9

/** Main panel height — 80% of main calendar / shell height (settings + search). */
export const MAIN_PANEL_HEIGHT_RATIO = 0.8

export function computeMainPanelWidth(containerWidth: number): number {
  const inner = Math.max(0, containerWidth)
  return Math.max(280, Math.round(inner * MAIN_PANEL_WIDTH_RATIO))
}

export function computeMainPanelHeight(containerHeight: number): number {
  const inner = Math.max(0, containerHeight)
  return Math.max(240, Math.round(inner * MAIN_PANEL_HEIGHT_RATIO))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function centeredBounds(options: {
  mainOrigin: { x: number; y: number }
  mainSize: { width: number; height: number }
  workArea: { x: number; y: number; width: number; height: number }
  width: number
  height: number
  topBias?: number
}): { x: number; y: number; width: number; height: number } {
  const pad = VIEWPORT_PAD
  const { mainOrigin, mainSize, workArea, topBias = 0 } = options
  const safeWidth = Math.min(options.width, Math.max(0, workArea.width - pad * 2))
  const safeHeight = Math.min(options.height, Math.max(0, workArea.height - pad * 2))
  const centerX = mainOrigin.x + mainSize.width / 2
  const centerY = mainOrigin.y + mainSize.height / 2 + topBias
  const left = centerX - safeWidth / 2
  const top = centerY - safeHeight / 2
  const minLeft = workArea.x + pad
  const minTop = workArea.y + pad
  const maxLeft = workArea.x + workArea.width - pad - safeWidth
  const maxTop = workArea.y + workArea.height - pad - safeHeight
  return {
    x: Math.round(clamp(left, minLeft, Math.max(minLeft, maxLeft))),
    y: Math.round(clamp(top, minTop, Math.max(minTop, maxTop))),
    width: Math.round(safeWidth),
    height: Math.round(safeHeight)
  }
}

/** Center within the main calendar window; clamp only if the panel exceeds work area. */
function centerInMainWindow(options: {
  mainOrigin: { x: number; y: number }
  mainSize: { width: number; height: number }
  workArea: { x: number; y: number; width: number; height: number }
  width: number
  height: number
}): { x: number; y: number; width: number; height: number } {
  const pad = VIEWPORT_PAD
  const { mainOrigin, mainSize, workArea } = options
  const safeWidth = Math.min(
    options.width,
    Math.max(0, mainSize.width - pad * 2),
    Math.max(0, workArea.width - pad * 2)
  )
  const safeHeight = Math.min(
    options.height,
    Math.max(0, mainSize.height - pad * 2),
    Math.max(0, workArea.height - pad * 2)
  )
  let x = mainOrigin.x + Math.round((mainSize.width - safeWidth) / 2)
  let y = mainOrigin.y + Math.round((mainSize.height - safeHeight) / 2)
  const minX = workArea.x + pad
  const minY = workArea.y + pad
  const maxX = workArea.x + workArea.width - pad - safeWidth
  const maxY = workArea.y + workArea.height - pad - safeHeight
  return {
    x: Math.round(clamp(x, minX, Math.max(minX, maxX))),
    y: Math.round(clamp(y, minY, Math.max(minY, maxY))),
    width: Math.round(safeWidth),
    height: Math.round(safeHeight)
  }
}

function anchoredBounds(options: {
  anchorScreen: PanelAnchorRect
  panelWidth: number
  panelHeight: number
  workArea: { x: number; y: number; width: number; height: number }
}): { x: number; y: number; width: number; height: number } {
  const pad = VIEWPORT_PAD
  const { anchorScreen, workArea } = options
  const panelWidth = Math.min(options.panelWidth, Math.max(0, workArea.width - pad * 2))
  const panelHeight = Math.min(options.panelHeight, Math.max(0, workArea.height - pad * 2))
  let left = anchorScreen.left + anchorScreen.width / 2 - panelWidth / 2
  let top = anchorScreen.top + anchorScreen.height / 2 - panelHeight / 2
  const minLeft = workArea.x + pad
  const minTop = workArea.y + pad
  const maxLeft = workArea.x + workArea.width - pad - panelWidth
  const maxTop = workArea.y + workArea.height - pad - panelHeight
  return {
    x: Math.round(clamp(left, minLeft, Math.max(minLeft, maxLeft))),
    y: Math.round(clamp(top, minTop, Math.max(minTop, maxTop))),
    width: Math.round(panelWidth),
    height: Math.round(panelHeight)
  }
}

function isPointerAnchorRect(anchor: PanelAnchorRect): boolean {
  return anchor.width > 0 && anchor.height > 0 && anchor.width <= 32 && anchor.height <= 32
}

/** Place near the pointer (below/right with flip), clamped to the main calendar window. */
function pointerAnchoredBounds(options: {
  pointerClient: { x: number; y: number }
  mainOrigin: { x: number; y: number }
  mainSize: { width: number; height: number }
  workArea: { x: number; y: number; width: number; height: number }
  panelWidth: number
  panelHeight: number
  gap?: number
}): { x: number; y: number; width: number; height: number } {
  const pad = VIEWPORT_PAD
  const gap = options.gap ?? 8
  const { pointerClient, mainOrigin, mainSize, workArea } = options
  const panelWidth = Math.min(
    options.panelWidth,
    Math.max(0, mainSize.width - pad * 2),
    Math.max(0, workArea.width - pad * 2)
  )
  const panelHeight = Math.min(
    options.panelHeight,
    Math.max(0, mainSize.height - pad * 2),
    Math.max(0, workArea.height - pad * 2)
  )
  const boundsLeft = mainOrigin.x + pad
  const boundsTop = mainOrigin.y + pad
  const boundsRight = mainOrigin.x + mainSize.width - pad
  const boundsBottom = mainOrigin.y + mainSize.height - pad

  const screenX = mainOrigin.x + pointerClient.x
  const screenY = mainOrigin.y + pointerClient.y

  let left = screenX + gap
  if (left + panelWidth > boundsRight) {
    left = screenX - panelWidth - gap
  }
  left = clamp(left, boundsLeft, Math.max(boundsLeft, boundsRight - panelWidth))

  let top = screenY + gap
  if (top + panelHeight > boundsBottom) {
    const aboveTop = screenY - gap - panelHeight
    if (aboveTop >= boundsTop) {
      top = aboveTop
    }
  }
  top = clamp(top, boundsTop, Math.max(boundsTop, boundsBottom - panelHeight))

  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(panelWidth),
    height: Math.round(panelHeight)
  }
}

/** Screen DIP bounds for a floating panel BrowserWindow. */
export function computePanelWindowBounds(options: {
  init: PanelWindowInit
  anchorClient: PanelAnchorRect | null
  mainOrigin: { x: number; y: number }
  mainSize: { width: number; height: number }
  workArea: { x: number; y: number; width: number; height: number }
}): { x: number; y: number; width: number; height: number } {
  const { init, anchorClient, mainOrigin, mainSize, workArea } = options

  if (init.kind === 'quickEdit') {
    return computeQuickEditWindowBounds({
      viewMode: init.viewMode,
      anchorClient,
      mainOrigin,
      mainSize,
      workArea
    })
  }

  if (init.kind === 'eventDetail') {
    const detailInit = init
    if (detailInit.pointerScreen) {
      return pointerAnchoredBounds({
        pointerClient: {
          x: detailInit.pointerScreen.x - mainOrigin.x,
          y: detailInit.pointerScreen.y - mainOrigin.y
        },
        mainOrigin,
        mainSize,
        workArea,
        panelWidth: EVENT_DETAIL_PANEL_WIDTH,
        panelHeight: EVENT_DETAIL_PANEL_HEIGHT
      })
    }

    const usable =
      anchorClient && anchorClient.width > 0 && anchorClient.height > 0 ? anchorClient : null
    if (usable) {
      if (isPointerAnchorRect(usable)) {
        return pointerAnchoredBounds({
          pointerClient: {
            x: usable.left + usable.width / 2,
            y: usable.top + usable.height / 2
          },
          mainOrigin,
          mainSize,
          workArea,
          panelWidth: EVENT_DETAIL_PANEL_WIDTH,
          panelHeight: EVENT_DETAIL_PANEL_HEIGHT
        })
      }
      const anchorScreen = {
        top: mainOrigin.y + usable.top,
        left: mainOrigin.x + usable.left,
        width: usable.width,
        height: usable.height
      }
      return anchoredBounds({
        anchorScreen,
        panelWidth: EVENT_DETAIL_PANEL_WIDTH,
        panelHeight: EVENT_DETAIL_PANEL_HEIGHT,
        workArea
      })
    }
    return centeredBounds({
      mainOrigin,
      mainSize,
      workArea,
      width: EVENT_DETAIL_PANEL_WIDTH,
      height: EVENT_DETAIL_PANEL_HEIGHT
    })
  }

  if (init.kind === 'eventEditor') {
    // Extra +56px for the title row moved below the toolbar (edit existing: ±1D / copy).
    return centerInMainWindow({
      mainOrigin,
      mainSize,
      workArea,
      width: Math.min(752, mainSize.width - 32, workArea.width - VIEWPORT_PAD * 2),
      height: Math.min(
        Math.round(mainSize.height * 0.92) + 100,
        mainSize.height - VIEWPORT_PAD * 2,
        workArea.height - VIEWPORT_PAD * 2
      )
    })
  }

  if (
    init.kind === 'settings'
    || init.kind === 'search'
    || init.kind === 'dayListPreview'
    || init.kind === 'attachmentViewer'
    || init.kind === 'footerHelp'
  ) {
    return centerInMainWindow({
      mainOrigin,
      mainSize,
      workArea,
      width: computeMainPanelWidth(mainSize.width),
      height: Math.min(computeMainPanelHeight(mainSize.height), workArea.height - VIEWPORT_PAD * 2)
    })
  }

  if (init.kind === 'exportOptions') {
    return centeredBounds({
      mainOrigin,
      mainSize,
      workArea,
      width: 440,
      height: 640
    })
  }

  if (init.kind === 'eventResourceList') {
    return centeredBounds({
      mainOrigin,
      mainSize,
      workArea,
      width: EVENT_RESOURCE_LIST_PANEL_WIDTH,
      height: EVENT_RESOURCE_LIST_PANEL_HEIGHT
    })
  }

  if (init.kind === 'recurrenceScope') {
    return centeredBounds({
      mainOrigin,
      mainSize,
      workArea,
      width: 400,
      height: 360
    })
  }

  if (init.kind === 'login') {
    return centeredBounds({
      mainOrigin,
      mainSize,
      workArea,
      width: 392,
      height: 340
    })
  }

  if (init.kind === 'headerTitleEditor') {
    return centeredBounds({
      mainOrigin,
      mainSize,
      workArea,
      width: HEADER_TITLE_EDITOR_PANEL_WIDTH,
      height: HEADER_TITLE_EDITOR_PANEL_HEIGHT
    })
  }

  return centeredBounds({
    mainOrigin,
    mainSize,
    workArea,
    width: 320,
    height: 280
  })
}
