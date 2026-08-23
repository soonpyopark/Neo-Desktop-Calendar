/** Base event lane sizing at density 1 — row height + density decide visible count. */
export const EVENT_LAYOUT = {
  laneHeight: 18,
  laneGap: 2,
  dayEventGap: 1,
  moreOffset: 2,
  cellPaddingY: 6,
  dayNumberHeight: 22
} as const

export const EVENT_DENSITY_MIN = 0.75
export const EVENT_DENSITY_MAX = 1.25
export const EVENT_DENSITY_STEP = 0.1
export const EVENT_DENSITY_DEFAULT = 1

/** Clamp + round density to one decimal (0.75 … 1.25). */
export function normalizeEventDensity(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return EVENT_DENSITY_DEFAULT
  const clamped = Math.min(EVENT_DENSITY_MAX, Math.max(EVENT_DENSITY_MIN, n))
  return Math.round(clamped * 10) / 10
}

export function stepEventDensity(current: unknown, delta: number): number {
  return normalizeEventDensity(normalizeEventDensity(current) + delta)
}

/** Event-bar letter-spacing in em (matches current −0.06em default). */
export const EVENT_LETTER_SPACING_MIN = -0.12
export const EVENT_LETTER_SPACING_MAX = 0.08
export const EVENT_LETTER_SPACING_STEP = 0.02
export const EVENT_LETTER_SPACING_DEFAULT = -0.06

/** Clamp + snap letter-spacing to 0.02em steps. */
export function normalizeEventLetterSpacing(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return EVENT_LETTER_SPACING_DEFAULT
  const clamped = Math.min(
    EVENT_LETTER_SPACING_MAX,
    Math.max(EVENT_LETTER_SPACING_MIN, n)
  )
  return Math.round(clamped * 50) / 50
}

export function stepEventLetterSpacing(current: unknown, delta: number): number {
  return normalizeEventLetterSpacing(normalizeEventLetterSpacing(current) + delta)
}

/** Event-title scaleX (matches current condensed 0.88 default). */
export const EVENT_LETTER_WIDTH_MIN = 0.7
export const EVENT_LETTER_WIDTH_MAX = 1.16
export const EVENT_LETTER_WIDTH_STEP = 0.04
export const EVENT_LETTER_WIDTH_DEFAULT = 0.88

/** Clamp + snap glyph width to 0.04 steps. */
export function normalizeEventLetterWidth(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return EVENT_LETTER_WIDTH_DEFAULT
  const clamped = Math.min(EVENT_LETTER_WIDTH_MAX, Math.max(EVENT_LETTER_WIDTH_MIN, n))
  return Math.round(clamped * 25) / 25
}

export function stepEventLetterWidth(current: unknown, delta: number): number {
  return normalizeEventLetterWidth(normalizeEventLetterWidth(current) + delta)
}

export type ScaledEventLayout = {
  laneHeight: number
  laneGap: number
  dayEventGap: number
  moreOffset: number
  cellPaddingY: number
  dayNumberHeight: number
  density: number
}

/** Layout metrics scaled by density ([-] smaller → more bars fit). */
export function getScaledEventLayout(density: unknown = EVENT_DENSITY_DEFAULT): ScaledEventLayout {
  const d = normalizeEventDensity(density)
  const scale = (base: number, min: number): number => Math.max(min, Math.round(base * d))
  return {
    laneHeight: scale(EVENT_LAYOUT.laneHeight, 12),
    laneGap: scale(EVENT_LAYOUT.laneGap, 1),
    dayEventGap: scale(EVENT_LAYOUT.dayEventGap, 0),
    moreOffset: EVENT_LAYOUT.moreOffset,
    cellPaddingY: scale(EVENT_LAYOUT.cellPaddingY, 4),
    dayNumberHeight: scale(EVENT_LAYOUT.dayNumberHeight, 18),
    density: d
  }
}

export function getEventLaneStep(density: unknown = EVENT_DENSITY_DEFAULT): number {
  const layout = getScaledEventLayout(density)
  return layout.laneHeight + layout.laneGap
}

function moreTailPx(layout: ScaledEventLayout): number {
  return Math.max(10, Math.round(12 * layout.density)) + layout.moreOffset
}

function capacityFromLayout(
  rowHeight: number,
  layout: ScaledEventLayout
): { maxAll: number; maxWithMore: number } {
  if (rowHeight <= 0) return { maxAll: 0, maxWithMore: 0 }

  const laneStep = layout.laneHeight + layout.laneGap
  const available =
    rowHeight - layout.cellPaddingY - layout.dayNumberHeight - layout.dayEventGap
  if (available <= 0) return { maxAll: 0, maxWithMore: 0 }

  const maxAll = Math.max(0, Math.floor(available / laneStep))
  const maxWithMore = Math.max(
    0,
    Math.min(maxAll - 1, Math.floor((available - moreTailPx(layout)) / laneStep))
  )

  return { maxAll, maxWithMore }
}

export function getEventLayoutCssVars(
  density: unknown = EVENT_DENSITY_DEFAULT
): Record<string, string> {
  return cssVarsFromLayout(getScaledEventLayout(density))
}

export function cssVarsFromLayout(layout: ScaledEventLayout): Record<string, string> {
  const laneStep = layout.laneHeight + layout.laneGap
  return {
    '--event-density': String(layout.density),
    '--event-lane-height': `${layout.laneHeight}px`,
    '--event-lane-step': `${laneStep}px`,
    '--day-event-gap': `${layout.dayEventGap}px`,
    '--event-more-offset': `${layout.moreOffset}px`
  }
}

/** 6-week months: pack 5 event bars + "N개 더보기" into each day cell. */
export const SIX_WEEK_VISIBLE_WITH_MORE = 5

export function fitEventLayout(
  rowHeight: number,
  density: unknown = EVENT_DENSITY_DEFAULT,
  weeksInViewport = 5
): {
  maxAll: number
  maxWithMore: number
  cssVars: Record<string, string>
} {
  const layout = { ...getScaledEventLayout(density) }

  if (weeksInViewport === 6 && rowHeight > 0) {
    const target = SIX_WEEK_VISIBLE_WITH_MORE
    const fits = (next: ScaledEventLayout): boolean => {
      const available =
        rowHeight - next.cellPaddingY - next.dayNumberHeight - next.dayEventGap
      const laneStep = next.laneHeight + next.laneGap
      return available - moreTailPx(next) >= target * laneStep
    }

    if (!fits(layout) && layout.dayNumberHeight > 22) {
      layout.dayNumberHeight = 22
    }
    if (!fits(layout) && layout.laneGap > 1) {
      layout.laneGap = 1
    }

    const capacity = capacityFromLayout(rowHeight, layout)
    if (fits(layout)) {
      return {
        maxAll: Math.max(capacity.maxAll, target + 1),
        maxWithMore: Math.max(capacity.maxWithMore, target),
        cssVars: cssVarsFromLayout(layout)
      }
    }
    return { ...capacity, cssVars: cssVarsFromLayout(layout) }
  }

  const capacity = capacityFromLayout(rowHeight, layout)
  return { ...capacity, cssVars: cssVarsFromLayout(layout) }
}

export function getEventRowCapacity(
  rowHeight: number,
  density: unknown = EVENT_DENSITY_DEFAULT
): {
  maxAll: number
  maxWithMore: number
} {
  const { maxAll, maxWithMore } = fitEventLayout(rowHeight, density, 5)
  return { maxAll, maxWithMore }
}

export function resolveDayVisibleEventLimit(
  daySegments: Array<{ lane: number }>,
  capacity: { maxAll: number; maxWithMore: number }
): { visibleCount: number; hiddenEventCount: number } {
  const sortedSegments = [...daySegments].sort((a, b) => a.lane - b.lane)
  const eventCount = sortedSegments.length

  if (eventCount <= capacity.maxAll) {
    return {
      visibleCount: eventCount,
      hiddenEventCount: 0
    }
  }

  const visibleCount = Math.max(1, capacity.maxWithMore)
  return {
    visibleCount,
    hiddenEventCount: eventCount - visibleCount
  }
}
