export const QUICK_EDIT_CHROME_HEIGHT = 82
export const QUICK_EDIT_BODY_EXTRA_MONTH = 96
export const QUICK_EDIT_YEAR_VISIBLE_ITEMS = 6
export const QUICK_EDIT_ITEM_ROW_PX = 32
/** Extra body height when the create form wraps onto a second row (single row now → 0). */
export const QUICK_EDIT_CREATE_EXTRA_PX = 0
export const QUICK_EDIT_CREATE_ROW_PX = 36 + QUICK_EDIT_CREATE_EXTRA_PX
export const QUICK_EDIT_BODY_LAYOUT_PX = 24
export const QUICK_EDIT_MIN_BODY_HEIGHT = 72
export const QUICK_EDIT_VIEWPORT_PAD = 5
/**
 * Fixed month/year quick-edit size, shared by inline and floating surfaces.
 * Wide enough for footer tools (color / mark / link / attach / edit / trash / ±1D / copy).
 */
export const QUICK_EDIT_MONTH_YEAR_WIDTH = 330
export const QUICK_EDIT_MONTH_YEAR_HEIGHT = 357 + QUICK_EDIT_CREATE_EXTRA_PX

export type QuickEditViewMode = 'year' | 'week' | 'month'

export type QuickEditAnchorRect = {
  top: number
  left: number
  width: number
  height: number
}

export type QuickEditWindowInit = {
  dateKey: string
  viewMode: QuickEditViewMode
  eventsHidden: boolean
  /** Day-cell footprint used for the same panel sizing as inline quick edit. */
  anchor?: QuickEditAnchorRect | null
}

export type DesktopQuickEditContext = {
  viewMode: QuickEditViewMode
  eventsHidden: boolean
}

export type QuickEditDeferToMainPayload = {
  kind: 'editor' | 'detail'
  dateKey: string
  eventId?: string
  /** Screen DIP anchor for reopening quick edit after editor closes. */
  anchorScreen?: QuickEditAnchorRect | null
}

export function quickEditBodyHeightForItems(itemCount: number): number {
  return (
    QUICK_EDIT_BODY_LAYOUT_PX +
    QUICK_EDIT_CREATE_ROW_PX +
    itemCount * QUICK_EDIT_ITEM_ROW_PX
  )
}

export const QUICK_EDIT_YEAR_MIN_BODY = quickEditBodyHeightForItems(QUICK_EDIT_YEAR_VISIBLE_ITEMS)

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function clampBoundsToWorkArea(
  bounds: { x: number; y: number; width: number; height: number },
  workArea: { x: number; y: number; width: number; height: number },
  pad: number
): { x: number; y: number; width: number; height: number } {
  const safeWidth = Math.min(bounds.width, Math.max(0, workArea.width - pad * 2))
  const safeHeight = Math.min(bounds.height, Math.max(0, workArea.height - pad * 2))
  const minLeft = workArea.x + pad
  const minTop = workArea.y + pad
  const maxLeft = workArea.x + workArea.width - pad - safeWidth
  const maxTop = workArea.y + workArea.height - pad - safeHeight

  return {
    x: Math.round(clamp(bounds.x, minLeft, Math.max(minLeft, maxLeft))),
    y: Math.round(clamp(bounds.y, minTop, Math.max(minTop, maxTop))),
    width: Math.round(safeWidth),
    height: Math.round(safeHeight)
  }
}

function isPointerAnchorRect(anchor: QuickEditAnchorRect): boolean {
  return anchor.width > 0 && anchor.height > 0 && anchor.width <= 32 && anchor.height <= 32
}

/** Year view: place near the pointer, clamped to the main calendar window. */
function pointerAnchoredQuickEditBounds(options: {
  pointerClient: { x: number; y: number }
  mainOrigin: { x: number; y: number }
  mainSize: { width: number; height: number }
  panelWidth: number
  panelHeight: number
  gap?: number
}): { x: number; y: number; width: number; height: number } {
  const pad = QUICK_EDIT_VIEWPORT_PAD
  const gap = options.gap ?? 8
  const { pointerClient, mainOrigin, mainSize } = options
  const panelWidth = Math.min(options.panelWidth, Math.max(0, mainSize.width - pad * 2))
  const panelHeight = Math.min(options.panelHeight, Math.max(0, mainSize.height - pad * 2))
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

/** Panel inner size (matches DayQuickEditPopover buildQuickEditStyle). */
export function computeQuickEditPanelSize(options: {
  viewMode: QuickEditViewMode
  anchor: QuickEditAnchorRect | null
}): { width: number; height: number } {
  const { viewMode, anchor } = options
  if (viewMode !== 'week') {
    return {
      width: QUICK_EDIT_MONTH_YEAR_WIDTH,
      height: QUICK_EDIT_MONTH_YEAR_HEIGHT
    }
  }
  const floorBody = QUICK_EDIT_MIN_BODY_HEIGHT
  const bodyExtra = 0
  const usableAnchor =
    anchor && anchor.width > 0 && anchor.height > 0 ? anchor : null

  if (!usableAnchor) {
    const width = QUICK_EDIT_MONTH_YEAR_WIDTH
    const height = Math.max(280, floorBody + QUICK_EDIT_CHROME_HEIGHT)
    return { width, height }
  }

  const padX = 12
  const width = Math.max(usableAnchor.width + padX * 2, QUICK_EDIT_MONTH_YEAR_WIDTH)
  const desiredBody = Math.max(
    floorBody,
    Math.round(usableAnchor.height) + bodyExtra,
    bodyExtra > 0 ? 160 : QUICK_EDIT_MIN_BODY_HEIGHT
  ) + QUICK_EDIT_CREATE_EXTRA_PX
  const height = desiredBody + QUICK_EDIT_CHROME_HEIGHT
  return { width, height }
}

/** Screen DIP bounds for the floating quick-edit BrowserWindow. */
export function computeQuickEditWindowBounds(options: {
  viewMode: QuickEditViewMode
  anchorClient: QuickEditAnchorRect | null
  mainOrigin: { x: number; y: number }
  mainSize: { width: number; height: number }
  workArea: { x: number; y: number; width: number; height: number }
}): { x: number; y: number; width: number; height: number } {
  const { viewMode, anchorClient, mainOrigin, mainSize, workArea } = options
  const pad = QUICK_EDIT_VIEWPORT_PAD
  const panel = computeQuickEditPanelSize({ viewMode, anchor: anchorClient })

  const usableAnchor =
    anchorClient && anchorClient.width > 0 && anchorClient.height > 0 ? anchorClient : null

  if (viewMode === 'year' && usableAnchor && isPointerAnchorRect(usableAnchor)) {
    const pointerBounds = pointerAnchoredQuickEditBounds({
      pointerClient: { x: usableAnchor.left, y: usableAnchor.top },
      mainOrigin,
      mainSize,
      panelWidth: panel.width,
      panelHeight: panel.height
    })
    return clampBoundsToWorkArea(pointerBounds, workArea, pad)
  }

  let left: number
  let top: number

  if (!usableAnchor) {
    left = mainOrigin.x + Math.max(0, (mainSize.width - panel.width) / 2)
    top = mainOrigin.y + Math.max(0, (mainSize.height - panel.height) / 2)
  } else {
    const anchorScreen = {
      top: mainOrigin.y + usableAnchor.top,
      left: mainOrigin.x + usableAnchor.left,
      width: usableAnchor.width,
      height: usableAnchor.height
    }
    left = anchorScreen.left + anchorScreen.width / 2 - panel.width / 2
    top = anchorScreen.top + anchorScreen.height / 2 - panel.height / 2
  }

  const safeWidth = Math.min(panel.width, Math.max(0, workArea.width - pad * 2))
  const safeHeight = Math.min(panel.height, Math.max(0, workArea.height - pad * 2))
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
