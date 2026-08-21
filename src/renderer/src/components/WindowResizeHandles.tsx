import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type ReactElement } from 'react'
import { MIN_WIDGET_HEIGHT, MIN_WIDGET_WIDTH } from '../../../shared/constants'
import type { WidgetBounds } from '../../../shared/ipc'

type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const EDGES: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

type DragState = {
  edge: Edge
  startX: number
  startY: number
  origin: WidgetBounds
}

function applyEdgeDelta(origin: WidgetBounds, edge: Edge, dx: number, dy: number): WidgetBounds {
  let { x, y, width, height } = origin

  if (edge.includes('e')) width = origin.width + dx
  if (edge.includes('s')) height = origin.height + dy
  if (edge.includes('w')) {
    width = origin.width - dx
    x = origin.x + dx
  }
  if (edge.includes('n')) {
    height = origin.height - dy
    y = origin.y + dy
  }

  if (width < MIN_WIDGET_WIDTH) {
    if (edge.includes('w')) x -= MIN_WIDGET_WIDTH - width
    width = MIN_WIDGET_WIDTH
  }
  if (height < MIN_WIDGET_HEIGHT) {
    if (edge.includes('n')) y -= MIN_WIDGET_HEIGHT - height
    height = MIN_WIDGET_HEIGHT
  }

  return { x, y, width, height }
}

/**
 * Custom edge/corner grips for frameless transparent window mode.
 * Native OS resize borders are unreliable with transparent BrowserWindows on Windows.
 */
export function WindowResizeHandles(): ReactElement {
  const dragRef = useRef<DragState | null>(null)

  useEffect(() => {
    const onMove = (event: MouseEvent): void => {
      const drag = dragRef.current
      if (!drag) return
      const dx = event.screenX - drag.startX
      const dy = event.screenY - drag.startY
      const next = applyEdgeDelta(drag.origin, drag.edge, dx, dy)
      void window.neoCalendar.setWindowBounds(next)
    }

    const onUp = (): void => {
      dragRef.current = null
      document.body.classList.remove('is-resizing-window')
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const startDrag = async (edge: Edge, event: ReactMouseEvent): Promise<void> => {
    event.preventDefault()
    event.stopPropagation()
    const origin = await window.neoCalendar.getWindowBounds()
    dragRef.current = {
      edge,
      startX: event.screenX,
      startY: event.screenY,
      origin
    }
    document.body.classList.add('is-resizing-window')
  }

  return (
    <div className="window-resize-layer interaction-ui" aria-hidden>
      {/* Invisible edge/corner hit zones — no painted frame. */}
      {EDGES.map((edge) => (
        <div
          key={edge}
          className={`window-resize-handle window-resize-handle--${edge}`}
          onMouseDown={(event) => {
            void startDrag(edge, event)
          }}
        />
      ))}
    </div>
  )
}

export default WindowResizeHandles
