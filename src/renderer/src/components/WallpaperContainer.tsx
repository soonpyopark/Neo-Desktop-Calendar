import { type ReactElement, type ReactNode, useEffect } from 'react'
import {
  resetIgnoreMouseCache,
  setClickThroughEnabled,
  setIgnoreMouseEvents
} from '../lib/mouseBridge'

export type WallpaperContainerProps = {
  children: ReactNode
  /** When false (window mode), mouse is always captured. */
  clickThrough?: boolean
}

/**
 * Full-viewport wallpaper shell with dynamic click-through.
 * Uses forwarded mousemove + elementFromPoint so interactive hotspots
 * (`.interaction-ui`) can reclaim mouse capture reliably.
 */
export function WallpaperContainer({
  children,
  clickThrough = true
}: WallpaperContainerProps): ReactElement {
  useEffect(() => {
    setClickThroughEnabled(clickThrough)
    resetIgnoreMouseCache()

    if (!clickThrough) {
      return
    }

    const syncMouseCapture = (clientX: number, clientY: number): void => {
      const el = document.elementFromPoint(clientX, clientY)
      const overInteractive = Boolean(
        el?.closest('.interaction-ui') && !el?.closest('[data-toolbar-action]')
      )
      setIgnoreMouseEvents(!overInteractive, { forwardToOverlay: true })
    }

    const onMouseMove = (event: MouseEvent): void => {
      syncMouseCapture(event.clientX, event.clientY)
    }

    const onWindowMouseLeave = (): void => {
      setIgnoreMouseEvents(true, { forwardToOverlay: true })
    }

    window.addEventListener('mousemove', onMouseMove)
    document.documentElement.addEventListener('mouseleave', onWindowMouseLeave)

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      document.documentElement.removeEventListener('mouseleave', onWindowMouseLeave)
    }
  }, [clickThrough])

  return (
    <div
      className={`wallpaper-root overflow-hidden bg-transparent${
        clickThrough ? ' is-desktop-embedded' : ' is-window-mode'
      }`}
      onMouseLeave={() => {
        if (clickThrough) {
          setIgnoreMouseEvents(true, { forwardToOverlay: true })
        }
      }}
    >
      {children}
    </div>
  )
}

export default WallpaperContainer
