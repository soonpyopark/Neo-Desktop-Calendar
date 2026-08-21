import { setIgnoreMouseEvents } from './mouseBridge'

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

/**
 * When a text field receives focus, ask main to activate the HWND so
 * Windows Hangul IME can attach (DOM focus alone is not enough after
 * showInactive / WorkerW undock).
 */
export function installTextInputFocusBridge(): () => void {
  let lastRequestAt = 0

  const requestFocus = (): void => {
    const now = Date.now()
    if (now - lastRequestAt < 80) return
    lastRequestAt = now
    setIgnoreMouseEvents(false, { forwardToOverlay: true })
    window.neoCalendar?.focusForTextInput?.()
  }

  const onFocusIn = (event: FocusEvent): void => {
    if (!isEditableTarget(event.target)) return
    requestFocus()
  }

  const onPointerDown = (event: PointerEvent): void => {
    if (!isEditableTarget(event.target)) return
    requestFocus()
  }

  document.addEventListener('focusin', onFocusIn, true)
  document.addEventListener('pointerdown', onPointerDown, true)

  return () => {
    document.removeEventListener('focusin', onFocusIn, true)
    document.removeEventListener('pointerdown', onPointerDown, true)
  }
}
