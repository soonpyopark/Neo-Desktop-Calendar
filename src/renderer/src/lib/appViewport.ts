/**
 * Bind the app shell to the *visible* viewport.
 *
 * Tablet/mobile Chrome `100vh` / `position:fixed; inset:0` use the large
 * layout viewport (behind the address / toolbar). Combined with overflow
 * hidden, the last month row and footer get clipped.
 */
export function syncAppViewportSize(): void {
  const vv = window.visualViewport
  const height = Math.max(1, Math.round(vv?.height ?? window.innerHeight))
  const width = Math.max(1, Math.round(vv?.width ?? window.innerWidth))
  const top = Math.max(0, Math.round(vv?.offsetTop ?? 0))
  const left = Math.max(0, Math.round(vv?.offsetLeft ?? 0))
  const root = document.documentElement
  root.style.setProperty('--app-height', `${height}px`)
  root.style.setProperty('--app-width', `${width}px`)
  root.style.setProperty('--app-offset-top', `${top}px`)
  root.style.setProperty('--app-offset-left', `${left}px`)
}

export function subscribeAppViewportSize(): () => void {
  syncAppViewportSize()
  const vv = window.visualViewport
  const onChange = (): void => {
    syncAppViewportSize()
  }
  window.addEventListener('resize', onChange)
  vv?.addEventListener('resize', onChange)
  vv?.addEventListener('scroll', onChange)
  return () => {
    window.removeEventListener('resize', onChange)
    vv?.removeEventListener('resize', onChange)
    vv?.removeEventListener('scroll', onChange)
  }
}
