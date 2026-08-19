import { useEffect, useMemo, useState, type RefObject } from 'react'
import {
  fitEventLayout,
  getEventLayoutCssVars,
  getEventRowCapacity,
  normalizeEventDensity,
  resolveDayVisibleEventLimit
} from '../../../shared/eventLayoutMetrics'

export {
  getEventRowCapacity,
  resolveDayVisibleEventLimit,
  getEventLayoutCssVars,
  normalizeEventDensity
}

/**
 * Measure month-body height / weeks-in-viewport → how many event bars fit
 * before showing "N개 더보기" (MDC useMaxVisibleEvents).
 * 6-week months shrink lanes so 5 bars + more still fit.
 * `density` scales bar/day-number metrics (lower → more bars visible).
 */
export function useMaxVisibleEvents(
  containerRef: RefObject<HTMLElement | null>,
  weeksInViewport = 5,
  density = 1,
  /** Bump when chrome height changes so row capacity remeasures without a window resize. */
  layoutKey?: unknown
): { maxAll: number; maxWithMore: number; cssVars: Record<string, string> } {
  const normalizedDensity = normalizeEventDensity(density)
  const [layout, setLayout] = useState(() =>
    fitEventLayout(0, normalizedDensity, weeksInViewport)
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container || weeksInViewport <= 0) return

    let raf = 0
    const update = (): void => {
      const rowHeight = container.clientHeight / weeksInViewport
      setLayout(fitEventLayout(rowHeight, normalizedDensity, weeksInViewport))
    }
    const schedule = (): void => {
      if (raf) return
      raf = window.requestAnimationFrame(() => {
        raf = 0
        update()
      })
    }

    update()
    const observer = new ResizeObserver(schedule)
    observer.observe(container)
    window.addEventListener('resize', schedule)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      if (raf) window.cancelAnimationFrame(raf)
    }
  }, [containerRef, weeksInViewport, normalizedDensity, layoutKey])

  return layout
}

export function useEventLayoutCssVars(density = 1): Record<string, string> {
  const normalizedDensity = normalizeEventDensity(density)
  return useMemo(
    () => getEventLayoutCssVars(normalizedDensity),
    [normalizedDensity]
  )
}
