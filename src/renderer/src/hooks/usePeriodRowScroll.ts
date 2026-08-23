import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from 'react'

const DRAG_THRESHOLD_PX = 6
const SCROLL_STEP_RATIO = 0.55

/**
 * Horizontal overflow for the period toolbar: drag-to-scroll + edge buttons.
 */
export function usePeriodRowScroll(): {
  scrollRef: RefObject<HTMLDivElement | null>
  canScrollLeft: boolean
  canScrollRight: boolean
  overflowing: boolean
  dragging: boolean
  scrollByStep: (dir: -1 | 1) => void
  updateOverflow: () => void
  scrollerProps: {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void
    onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void
    onClickCapture: (event: ReactMouseEvent) => void
  }
} {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startScroll: number
    moved: boolean
  } | null>(null)
  const suppressClickRef = useRef(false)

  const updateOverflow = useCallback((): void => {
    const el = scrollRef.current
    if (!el) {
      setCanScrollLeft(false)
      setCanScrollRight(false)
      return
    }
    const max = el.scrollWidth - el.clientWidth
    const left = el.scrollLeft
    setCanScrollLeft(max > 1 && left > 1)
    setCanScrollRight(max > 1 && left < max - 1)
  }, [])

  const scrollByStep = useCallback((dir: -1 | 1): void => {
    const el = scrollRef.current
    if (!el) return
    const step = Math.max(120, Math.round(el.clientWidth * SCROLL_STEP_RATIO))
    el.scrollBy({ left: dir * step, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    updateOverflow()
    const ro = new ResizeObserver(updateOverflow)
    ro.observe(el)
    const inner = el.firstElementChild
    if (inner instanceof HTMLElement) ro.observe(inner)
    el.addEventListener('scroll', updateOverflow, { passive: true })
    window.addEventListener('resize', updateOverflow)
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', updateOverflow)
      window.removeEventListener('resize', updateOverflow)
    }
  }, [updateOverflow])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const el = scrollRef.current
    if (!el || el.scrollWidth <= el.clientWidth + 1) return
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScroll: el.scrollLeft,
      moved: false
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    const el = scrollRef.current
    if (!drag || !el || event.pointerId !== drag.pointerId) return
    const dx = event.clientX - drag.startX
    if (!drag.moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return
    if (!drag.moved) {
      drag.moved = true
      setDragging(true)
      try {
        el.setPointerCapture(event.pointerId)
      } catch {
        /* ignore */
      }
    }
    event.preventDefault()
    el.scrollLeft = drag.startScroll - dx
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    if (drag.moved) suppressClickRef.current = true
    dragRef.current = null
    setDragging(false)
  }

  const onClickCapture = (event: ReactMouseEvent): void => {
    if (!suppressClickRef.current) return
    event.preventDefault()
    event.stopPropagation()
    suppressClickRef.current = false
  }

  return {
    scrollRef,
    canScrollLeft,
    canScrollRight,
    overflowing: canScrollLeft || canScrollRight,
    dragging,
    scrollByStep,
    updateOverflow,
    scrollerProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onClickCapture
    }
  }
}
