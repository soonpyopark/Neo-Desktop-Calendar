import { useCallback, useEffect, useRef } from 'react'
import {
  getWeekDisplayMonth,
  getWeekStartContainingMonth,
  startOfWeek,
  toDateKey
} from '../lib/calendarUtils'

/** Neo: wheel lock is controlled by `wheelLocked` (desktop overlays), not a host flag. */
function isDesktopSurfaceHost() {
  return false
}

export const WEEKS_IN_VIEWPORT = 5

/**
 * @param {object} options
 * @param {React.RefObject<HTMLElement | null>} options.scrollRef
 * @param {{ date: Date }[][]} options.weeks
 * @param {number} [options.weeksInViewport=5] How many weeks to jump per scroll/swipe
 * @param {(year: number, month: number) => void} [options.onVisibleMonthChange]
 * @param {(weekStart: Date) => void} [options.onVisibleWeekChange]
 * @param {boolean} [options.wheelLocked] When true, ignore wheel (overlays / desktop mode)
 */
export function useMonthWeekScroll({
  scrollRef,
  weeks,
  weeksInViewport = WEEKS_IN_VIEWPORT,
  onVisibleMonthChange,
  onVisibleWeekChange,
  wheelLocked = false
}) {
  const weekRefs = useRef(new Map())
  const skipNextScrollRef = useRef(false)
  const aligningRef = useRef(false)
  /** Ignore scroll→month reports until this timestamp (chrome nav / align settle). */
  const suppressVisibleUntilRef = useRef(0)
  /** Bumps on every programmatic align so a stale finishAlign cannot overwrite a newer nav. */
  const alignSeqRef = useRef(0)
  const rafRef = useRef(0)
  const wheelLockRef = useRef(false)
  const onVisibleMonthChangeRef = useRef(onVisibleMonthChange)
  const onVisibleWeekChangeRef = useRef(onVisibleWeekChange)
  const reportVisibleMonthRef = useRef(() => {})
  const weeksRef = useRef(weeks)
  weeksRef.current = weeks
  const step = Math.max(1, Number(weeksInViewport) || WEEKS_IN_VIEWPORT)
  const stepRef = useRef(step)
  stepRef.current = step

  useEffect(() => {
    onVisibleMonthChangeRef.current = onVisibleMonthChange
  }, [onVisibleMonthChange])

  useEffect(() => {
    onVisibleWeekChangeRef.current = onVisibleWeekChange
  }, [onVisibleWeekChange])

  const setWeekRef = useCallback((weekStartKey, node) => {
    if (node) {
      weekRefs.current.set(weekStartKey, node)
      return
    }
    weekRefs.current.delete(weekStartKey)
  }, [])

  const suppressVisibleReports = useCallback((ms = 400) => {
    suppressVisibleUntilRef.current = Date.now() + Math.max(0, ms)
  }, [])

  const findWeekIndexByStartKey = useCallback((weekStartKey) => {
    return weeksRef.current.findIndex((week) => toDateKey(week[0].date) === weekStartKey)
  }, [])

  const findWeekIndexContainingMonthDay = useCallback((year, monthIndex, day = 1) => {
    return weeksRef.current.findIndex((week) =>
      week.some(
        ({ date }) =>
          date.getFullYear() === year &&
          date.getMonth() === monthIndex &&
          date.getDate() === day
      )
    )
  }, [])

  /** Live week row from DOM (`data-week-start`). */
  const resolveWeekEl = useCallback(
    (weekStartKey) => {
      const container = scrollRef.current
      if (container && weekStartKey) {
        const live = container.querySelector(`[data-week-start="${weekStartKey}"]`)
        if (live instanceof HTMLElement) {
          weekRefs.current.set(weekStartKey, live)
          return live
        }
      }
      return weekRefs.current.get(weekStartKey) ?? null
    },
    [scrollRef]
  )

  const scrollTopForElement = useCallback((container, el) => {
    const cRect = container.getBoundingClientRect()
    const eRect = el.getBoundingClientRect()
    return container.scrollTop + (eRect.top - cRect.top)
  }, [])

  /** Visible week stride = month-body clientHeight ÷ weeks-in-viewport. */
  const weekStride = useCallback((container) => {
    const h = container?.clientHeight ?? 0
    const n = stepRef.current
    return h > 0 && n > 0 ? h / n : 0
  }, [])

  /**
   * Pin week row to the top of the month body.
   * Order: viewport-stride × index → offsetTop → rect fine-tune.
   */
  const pinWeekToTop = useCallback(
    (container, weekEl, weekIndex = -1) => {
      if (!container || !weekEl) return

      const stride = weekStride(container)
      if (weekIndex >= 0 && stride > 0) {
        container.scrollTop = weekIndex * stride
      } else if (weekEl.parentElement === container) {
        container.scrollTop = weekEl.offsetTop
      } else {
        container.scrollTop = scrollTopForElement(container, weekEl)
      }

      // Fine-tune until the row top matches the clip top (max 3 passes).
      for (let i = 0; i < 3; i += 1) {
        const residual =
          weekEl.getBoundingClientRect().top - container.getBoundingClientRect().top
        if (Math.abs(residual) <= 0.5) break
        container.scrollTop += residual
      }
    },
    [scrollTopForElement, weekStride]
  )

  /**
   * First week that owns the viewport top edge.
   * Prefer the week at/just below the top — never the previous week when slightly early.
   */
  const getFirstVisibleWeekIndex = useCallback(() => {
    const container = scrollRef.current
    const list = weeksRef.current
    if (!container || container.clientHeight < 8 || container.clientWidth < 8) return -1

    const containerTop = container.getBoundingClientRect().top
    const slop = 2
    let bestIndex = -1

    for (let index = 0; index < list.length; index += 1) {
      const weekStartKey = toDateKey(list[index][0].date)
      const weekEl = resolveWeekEl(weekStartKey)
      if (!weekEl) continue

      const rect = weekEl.getBoundingClientRect()
      if (rect.height < 1) continue

      // Week covers the top edge of the scrollport.
      if (rect.top <= containerTop + slop && rect.bottom > containerTop + slop) {
        return index
      }

      // Fallback: track closest top while scanning.
      if (bestIndex < 0) bestIndex = index
      const bestEl = resolveWeekEl(toDateKey(list[bestIndex][0].date))
      if (!bestEl) {
        bestIndex = index
        continue
      }
      const bestDist = Math.abs(bestEl.getBoundingClientRect().top - containerTop)
      const dist = Math.abs(rect.top - containerTop)
      if (dist < bestDist - 0.5 || (Math.abs(dist - bestDist) <= 0.5 && index > bestIndex)) {
        bestIndex = index
      }
    }

    return bestIndex
  }, [resolveWeekEl, scrollRef])

  const scrollToWeekIndex = useCallback(
    (weekIndex, behavior = 'auto') => {
      const container = scrollRef.current
      const list = weeksRef.current
      if (!container || weekIndex < 0 || weekIndex >= list.length) return false

      const weekStartKey = toDateKey(list[weekIndex][0].date)
      const weekEl = resolveWeekEl(weekStartKey)
      if (!weekEl) return false

      if (behavior === 'auto') {
        pinWeekToTop(container, weekEl, weekIndex)
        return true
      }

      aligningRef.current = true
      suppressVisibleReports(500)
      const stride = weekStride(container)
      const targetTop =
        stride > 0 ? weekIndex * stride : scrollTopForElement(container, weekEl)
      container.scrollTo({ top: targetTop, behavior })

      let finished = false
      const finishSmooth = () => {
        if (finished) return
        finished = true
        container.removeEventListener('scrollend', finishSmooth)
        const live = resolveWeekEl(weekStartKey)
        if (live) pinWeekToTop(container, live, weekIndex)
        aligningRef.current = false
        reportVisibleMonthRef.current()
      }

      container.addEventListener('scrollend', finishSmooth, { once: true })
      window.setTimeout(finishSmooth, 480)
      return true
    },
    [
      pinWeekToTop,
      resolveWeekEl,
      scrollRef,
      scrollTopForElement,
      suppressVisibleReports,
      weekStride
    ]
  )

  const scrollToWeekStart = useCallback(
    (weekStartKey, behavior = 'auto') => {
      const weekIndex = findWeekIndexByStartKey(weekStartKey)
      if (weekIndex < 0) return

      if (behavior === 'auto') {
        scrollToWeekIndex(weekIndex, behavior)
        return
      }

      requestAnimationFrame(() => {
        requestAnimationFrame(() => scrollToWeekIndex(weekIndex, behavior))
      })
    },
    [findWeekIndexByStartKey, scrollToWeekIndex]
  )

  const reportVisibleMonth = useCallback(() => {
    const container = scrollRef.current
    if (!container || aligningRef.current) return
    if (Date.now() < suppressVisibleUntilRef.current) return
    if (container.clientHeight < 8 || container.clientWidth < 8) return

    const weekIndex = getFirstVisibleWeekIndex()
    if (weekIndex < 0) return

    const firstWeek = weeksRef.current[weekIndex]
    if (!firstWeek) return

    const weekStart = firstWeek[0].date
    const onWeekChange = onVisibleWeekChangeRef.current
    if (onWeekChange) {
      skipNextScrollRef.current = true
      onWeekChange(weekStart)
    }

    const onChange = onVisibleMonthChangeRef.current
    if (!onChange) return

    const { year, month } = getWeekDisplayMonth(firstWeek)
    skipNextScrollRef.current = true
    onChange(year, month)
  }, [getFirstVisibleWeekIndex, scrollRef])

  reportVisibleMonthRef.current = reportVisibleMonth

  const scrollByWeek = useCallback(
    (direction, behavior = 'smooth', weekStep = step) => {
      if (direction === 0) return

      const list = weeksRef.current
      const delta = direction * Math.max(1, weekStep)
      const nextIndex = Math.max(
        0,
        Math.min(list.length - 1, getFirstVisibleWeekIndex() + delta)
      )
      scrollToWeekIndex(nextIndex, behavior)
    },
    [getFirstVisibleWeekIndex, scrollToWeekIndex, step]
  )

  const scrollByMonth = useCallback(
    (direction, behavior = 'smooth') => {
      if (direction === 0) return

      const weekIndex = getFirstVisibleWeekIndex()
      const firstWeek = weeksRef.current[weekIndex]
      if (!firstWeek) return

      const { year, month } = getWeekDisplayMonth(firstWeek)
      const current = new Date(year, month - 1, 1)
      current.setMonth(current.getMonth() + direction)
      const targetYear = current.getFullYear()
      const targetMonthIndex = current.getMonth()

      let nextIndex = findWeekIndexContainingMonthDay(targetYear, targetMonthIndex, 1)
      if (nextIndex < 0) {
        nextIndex = Math.max(
          0,
          Math.min(weeksRef.current.length - 1, weekIndex + direction * step)
        )
      }
      scrollToWeekIndex(nextIndex, behavior)
    },
    [findWeekIndexContainingMonthDay, getFirstVisibleWeekIndex, scrollToWeekIndex, step]
  )

  const scrollByViewport = useCallback(
    (direction, behavior = 'smooth') => {
      if (step >= 5) {
        scrollByMonth(direction, behavior)
        return
      }
      scrollByWeek(direction, behavior, step)
    },
    [scrollByMonth, scrollByWeek, step]
  )

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return

    const handleScroll = () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(reportVisibleMonth)
    }

    container.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      container.removeEventListener('scroll', handleScroll)
      cancelAnimationFrame(rafRef.current)
    }
  }, [reportVisibleMonth, scrollRef])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return undefined

    const WHEEL_UNLOCK_MS = 420

    const onWheel = (event) => {
      if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) return
      if (event.deltaY === 0) return

      event.preventDefault()
      // Period nav is header buttons only (desktop, window, tablet/browser).
      if (
        wheelLocked ||
        wheelLockRef.current ||
        aligningRef.current ||
        isDesktopSurfaceHost()
      ) {
        return
      }

      wheelLockRef.current = true
      const direction = event.deltaY > 0 ? 1 : -1
      scrollByViewport(direction, 'auto')

      window.setTimeout(() => {
        wheelLockRef.current = false
      }, WHEEL_UNLOCK_MS)
    }

    const onTouchMove = (event) => {
      if (!wheelLocked) return
      event.preventDefault()
    }

    container.addEventListener('wheel', onWheel, { passive: false })
    container.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => {
      container.removeEventListener('wheel', onWheel)
      container.removeEventListener('touchmove', onTouchMove)
    }
  }, [scrollByViewport, scrollRef, wheelLocked])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return

    const SWIPE_MIN_DISTANCE = 48
    const SWIPE_MAX_DURATION = 700

    /** @type {{ id: number, startX: number, startY: number, startTime: number, startWeekIndex: number } | null} */
    let activePointer = null

    const finishSwipe = (clientX, clientY) => {
      if (!activePointer) return

      const dx = clientX - activePointer.startX
      const dy = clientY - activePointer.startY
      const elapsed = Date.now() - activePointer.startTime
      const startWeekIndex = activePointer.startWeekIndex
      activePointer = null

      if (elapsed > SWIPE_MAX_DURATION) return
      if (Math.abs(dy) < SWIPE_MIN_DISTANCE) return
      if (Math.abs(dx) > Math.abs(dy)) return
      if (wheelLocked || aligningRef.current) return

      const direction = dy < 0 ? 1 : -1
      const movedWeeks = getFirstVisibleWeekIndex() - startWeekIndex
      const minMoved = step >= 5 ? 1 : step
      if (direction === 1 && movedWeeks >= minMoved) return
      if (direction === -1 && movedWeeks <= -minMoved) return

      scrollByViewport(direction, 'smooth')
    }

    const onPointerDown = (event) => {
      if (wheelLocked) return
      if (event.pointerType === 'mouse' && event.button !== 0) return
      activePointer = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startTime: Date.now(),
        startWeekIndex: getFirstVisibleWeekIndex()
      }
    }

    const onPointerUp = (event) => {
      if (!activePointer || event.pointerId !== activePointer.id) return
      finishSwipe(event.clientX, event.clientY)
    }

    const onPointerCancel = (event) => {
      if (!activePointer || event.pointerId !== activePointer.id) return
      activePointer = null
    }

    container.addEventListener('pointerdown', onPointerDown)
    container.addEventListener('pointerup', onPointerUp)
    container.addEventListener('pointercancel', onPointerCancel)

    return () => {
      container.removeEventListener('pointerdown', onPointerDown)
      container.removeEventListener('pointerup', onPointerUp)
      container.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [getFirstVisibleWeekIndex, scrollByViewport, scrollRef, step, wheelLocked])

  /**
   * Align so the week containing day-1 is flush with the top of the month body.
   * Does NOT publish onVisibleMonthChange — chrome / viewDate owns the header.
   */
  const scrollToMonth = useCallback(
    (year, monthIndex, weekStartsOn, behavior = 'auto') => {
      const day1Key = toDateKey(new Date(year, monthIndex, 1))
      const weekStartKey = toDateKey(getWeekStartContainingMonth(year, monthIndex, weekStartsOn))

      let weekIndex = findWeekIndexContainingMonthDay(year, monthIndex, 1)
      if (weekIndex < 0) weekIndex = findWeekIndexByStartKey(weekStartKey)
      if (weekIndex < 0) {
        skipNextScrollRef.current = true
        suppressVisibleReports(400)
        return
      }

      const seq = ++alignSeqRef.current
      skipNextScrollRef.current = true
      aligningRef.current = true
      suppressVisibleReports(600)

      let attempts = 0

      const resolveTargetIndex = () => {
        let index = findWeekIndexContainingMonthDay(year, monthIndex, 1)
        if (index < 0) index = findWeekIndexByStartKey(weekStartKey)
        if (index < 0) index = weekIndex
        return index
      }

      /** True when day-1's week is pinned at the top (Sunday-start → 1st in cell 0). */
      const isDay1WeekPinned = (index) => {
        const container = scrollRef.current
        const list = weeksRef.current
        if (!container || index < 0 || !list[index]) return false

        const key = toDateKey(list[index][0].date)
        const weekEl = resolveWeekEl(key)
        if (!weekEl) return false

        const residual = Math.abs(
          weekEl.getBoundingClientRect().top - container.getBoundingClientRect().top
        )
        if (residual > 2) return false

        // Must actually contain day-1 of the target month.
        const hasDay1 = list[index].some(
          ({ date }) =>
            date.getFullYear() === year &&
            date.getMonth() === monthIndex &&
            date.getDate() === 1
        )
        if (!hasDay1) return false

        // Top week must not be an earlier row (the Jul-25 bug).
        const visible = getFirstVisibleWeekIndex()
        if (visible >= 0 && visible !== index) return false

        // Sunday-start months: week start === day-1 key.
        if (key === day1Key || key === weekStartKey) return true
        return hasDay1
      }

      const pinTarget = () => {
        const container = scrollRef.current
        const index = resolveTargetIndex()
        const list = weeksRef.current
        if (!container || !list[index]) return false

        const key = toDateKey(list[index][0].date)
        const weekEl = resolveWeekEl(key)
        if (!weekEl) return false

        pinWeekToTop(container, weekEl, index)

        if (isDay1WeekPinned(index)) return true

        // Hard correction: jump exactly one stride if still one week early.
        const visible = getFirstVisibleWeekIndex()
        if (visible >= 0 && visible === index - 1) {
          const stride = weekStride(container)
          if (stride > 0) container.scrollTop += stride
          pinWeekToTop(container, weekEl, index)
        }

        return isDay1WeekPinned(index)
      }

      const finishAlign = () => {
        if (seq !== alignSeqRef.current) return

        for (let fix = 0; fix < 10; fix += 1) {
          if (seq !== alignSeqRef.current) return
          if (pinTarget()) break
        }

        if (seq !== alignSeqRef.current) return

        const rePin = () => {
          if (seq !== alignSeqRef.current) return
          pinTarget()
        }

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            rePin()
            if (seq !== alignSeqRef.current) return
            aligningRef.current = false
            suppressVisibleReports(350)
          })
        })
        window.setTimeout(rePin, 32)
        window.setTimeout(rePin, 100)
        window.setTimeout(() => {
          if (seq !== alignSeqRef.current) return
          rePin()
          aligningRef.current = false
        }, 200)
      }

      const runScroll = () => {
        if (seq !== alignSeqRef.current) return
        attempts += 1
        const index = resolveTargetIndex()
        const scrolled = scrollToWeekIndex(index, behavior)

        if (!scrolled && attempts < 10) {
          requestAnimationFrame(runScroll)
          return
        }

        if (behavior === 'auto') {
          finishAlign()
          return
        }

        requestAnimationFrame(finishAlign)
      }

      if (behavior === 'auto') {
        const index = resolveTargetIndex()
        if (scrollToWeekIndex(index, 'auto')) {
          finishAlign()
          return
        }
      }

      requestAnimationFrame(() => {
        requestAnimationFrame(runScroll)
      })
    },
    [
      findWeekIndexByStartKey,
      findWeekIndexContainingMonthDay,
      getFirstVisibleWeekIndex,
      pinWeekToTop,
      resolveWeekEl,
      scrollRef,
      scrollToWeekIndex,
      suppressVisibleReports,
      weekStride
    ]
  )

  const findWeekIndexContainingDate = useCallback((date) => {
    const targetKey = toDateKey(date)
    return weeksRef.current.findIndex((week) =>
      week.some(({ date: weekDate }) => toDateKey(weekDate) === targetKey)
    )
  }, [])

  const scrollToDateInViewport = useCallback(
    (date, leadingWeeks = 0, behavior = 'auto') => {
      const weekIndex = findWeekIndexContainingDate(date)
      if (weekIndex < 0) return

      const targetIndex = Math.max(
        0,
        Math.min(weeksRef.current.length - 1, weekIndex - leadingWeeks)
      )
      const seq = ++alignSeqRef.current

      skipNextScrollRef.current = true
      aligningRef.current = true
      suppressVisibleReports(450)

      const finishAlign = () => {
        if (seq !== alignSeqRef.current) return
        aligningRef.current = false
        if (getFirstVisibleWeekIndex() < 0) return

        if (date.getDate() === 1) {
          skipNextScrollRef.current = true
          suppressVisibleReports(350)
          return
        }

        reportVisibleMonth()
      }

      if (behavior === 'auto' && scrollToWeekIndex(targetIndex, 'auto')) {
        finishAlign()
        return
      }

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (seq !== alignSeqRef.current) return
          scrollToWeekIndex(targetIndex, behavior)
          requestAnimationFrame(finishAlign)
        })
      })
    },
    [
      findWeekIndexContainingDate,
      getFirstVisibleWeekIndex,
      reportVisibleMonth,
      scrollToWeekIndex,
      suppressVisibleReports
    ]
  )

  const scrollToDate = useCallback(
    (date, weekStartsOn, behavior = 'smooth') => {
      scrollToWeekStart(toDateKey(startOfWeek(date, weekStartsOn)), behavior)
    },
    [scrollToWeekStart]
  )

  const consumeSkipScroll = useCallback(() => {
    if (skipNextScrollRef.current) {
      skipNextScrollRef.current = false
      return true
    }
    return false
  }, [])

  return {
    setWeekRef,
    scrollToMonth,
    scrollToDate,
    scrollToDateInViewport,
    scrollToWeekStart,
    scrollByWeek,
    consumeSkipScroll
  }
}
