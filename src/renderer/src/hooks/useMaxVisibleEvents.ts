import { useEffect, useMemo, useState, type RefObject } from 'react'
import {
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
 * `density` scales bar/day-number metrics (lower → more bars visible).
 */
export function useMaxVisibleEvents(
  containerRef: RefObject<HTMLElement | null>,
  weeksInViewport = 5,
  density = 1,
  /** Bump when chrome height changes so row capacity remeasures without a window resize. */
  layoutKey?: unknown
): { maxAll: number; maxWithMore: number } {
  const normalizedDensity = normalizeEventDensity(density)
  const [capacity, setCapacity] = useState(() =>
    getEventRowCapacity(0, normalizedDensity)
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container || weeksInViewport <= 0) return

    let raf = 0
    const update = (): void => {
      const rowHeight = container.clientHeight / weeksInViewport
      setCapacity(getEventRowCapacity(rowHeight, normalizedDensity))
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

  return capacity
}

export function useEventLayoutCssVars(density = 1): Record<string, string> {
  const normalizedDensity = normalizeEventDensity(density)
  return useMemo(
    () => getEventLayoutCssVars(normalizedDensity),
    [normalizedDensity]
  )
}
