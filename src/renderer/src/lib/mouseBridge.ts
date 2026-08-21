import type { SetIgnoreMouseOptions } from '../../../shared/ipc'

let lastIgnore: boolean | null = null
let clickThroughEnabled = true

/**
 * Idempotent bridge to main-process `set-ignore-mouse`.
 * Avoids flooding IPC when the pointer rapidly crosses interactive bounds.
 */
export function setIgnoreMouseEvents(
  ignore: boolean,
  options: SetIgnoreMouseOptions = { forwardToOverlay: true }
): void {
  if (!clickThroughEnabled) {
    if (lastIgnore === false) return
    lastIgnore = false
    window.neoCalendar?.setIgnoreMouse(false)
    return
  }

  if (options.allowWhileEmbedded && !ignore) {
    lastIgnore = false
    window.neoCalendar?.setIgnoreMouse(false, options)
    return
  }

  if (lastIgnore === ignore) return
  lastIgnore = ignore

  if (typeof window !== 'undefined' && window.neoCalendar?.setIgnoreMouse) {
    window.neoCalendar.setIgnoreMouse(ignore, options)
  }
}

export function setClickThroughEnabled(enabled: boolean): void {
  clickThroughEnabled = enabled
  resetIgnoreMouseCache()
  if (!enabled) {
    setIgnoreMouseEvents(false)
  } else {
    setIgnoreMouseEvents(true, { forwardToOverlay: true })
  }
}

export function resetIgnoreMouseCache(): void {
  lastIgnore = null
}
