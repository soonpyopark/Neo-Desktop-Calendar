import { BrowserWindow, screen } from 'electron'
import koffi from 'koffi'

/** Taskbar / notify-area — not foreign apps, but must not open calendar UI. */
const TASKBAR_SHELL_CLASSES = new Set([
  'Shell_TrayWnd',
  'Shell_SecondaryTrayWnd',
  'NotifyIconOverflowWindow',
  'TopLevelWindowForOverflowXamlIsland'
])

/**
 * Wallpaper / desktop-icon host only. Do not include SysListView32 / DirectUIHWND /
 * SHELLDLL_DefView — File Explorer folders reuse those classes.
 */
const DESKTOP_WALLPAPER_HOST_CLASSES = new Set(['Progman', 'WorkerW'])

/** Explorer folder / This PC frames — same child classes as the desktop icon list. */
const EXPLORER_FRAME_CLASSES = new Set(['CabinetWClass', 'ExploreWClass'])

type WindowAtPointApi = {
  WindowFromPoint: (x: number, y: number) => unknown
  GetForegroundWindow: () => unknown
  GetWindowThreadProcessId: (hwnd: unknown, pidOut: Buffer) => number
  GetClassNameW: (hwnd: unknown, buf: Buffer, max: number) => number
  IsChild: (parent: unknown, child: unknown) => number
  GetAncestor: (hwnd: unknown, flags: number) => unknown
  GetWindowRect: (
    hwnd: unknown,
    rectOut: { left: number; top: number; right: number; bottom: number }
  ) => number
}

const GA_PARENT = 3
const GA_ROOT = 2

let user32Api: WindowAtPointApi | null = null

function getUser32(): WindowAtPointApi {
  if (user32Api) return user32Api
  const user32 = koffi.load('user32.dll')
  const RECT = koffi.struct('NeoWindowAtPointRect', {
    left: 'long',
    top: 'long',
    right: 'long',
    bottom: 'long'
  })
  user32Api = {
    WindowFromPoint: user32.func('WindowFromPoint', 'void *', ['long', 'long']) as WindowAtPointApi['WindowFromPoint'],
    GetForegroundWindow: user32.func('GetForegroundWindow', 'void *', []) as WindowAtPointApi['GetForegroundWindow'],
    GetWindowThreadProcessId: user32.func('GetWindowThreadProcessId', 'uint32', [
      'void *',
      'uint32 *'
    ]) as WindowAtPointApi['GetWindowThreadProcessId'],
    GetClassNameW: user32.func('GetClassNameW', 'int', ['void *', 'void *', 'int']) as WindowAtPointApi['GetClassNameW'],
    IsChild: user32.func('IsChild', 'bool', ['void *', 'void *']) as WindowAtPointApi['IsChild'],
    GetAncestor: user32.func('GetAncestor', 'void *', ['void *', 'uint32']) as WindowAtPointApi['GetAncestor'],
    GetWindowRect: user32.func('GetWindowRect', 'bool', [
      'void *',
      koffi.out(koffi.pointer(RECT))
    ]) as WindowAtPointApi['GetWindowRect']
  }
  return user32Api
}

function hwndFromBuffer(handle: Buffer): bigint {
  return process.arch === 'x64' || process.arch === 'arm64'
    ? handle.readBigUInt64LE(0)
    : BigInt(handle.readUInt32LE(0))
}

function asHwnd(value: unknown): bigint {
  if (value == null) return 0n
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') return BigInt(value)
  try {
    return BigInt(koffi.address(value as object))
  } catch {
    return 0n
  }
}

function dipToPhysicalPoint(pt: { x: number; y: number }): { x: number; y: number } {
  try {
    return screen.dipToScreenPoint(pt)
  } catch {
    const display = screen.getDisplayNearestPoint(pt)
    const s = display.scaleFactor || 1
    return { x: Math.round(pt.x * s), y: Math.round(pt.y * s) }
  }
}

function readPid(user32: WindowAtPointApi, hwnd: unknown): number {
  try {
    const pidOut = Buffer.alloc(4)
    user32.GetWindowThreadProcessId(hwnd, pidOut)
    return pidOut.readUInt32LE(0)
  } catch {
    return 0
  }
}

function readClassName(user32: WindowAtPointApi, hwnd: unknown): string {
  try {
    const buf = Buffer.alloc(512)
    const len = user32.GetClassNameW(hwnd, buf, 256)
    if (len <= 0) return ''
    return buf.toString('utf16le', 0, len * 2)
  } catch {
    return ''
  }
}

function isOurHwnd(user32: WindowAtPointApi, hwnd: unknown, ourHwnd: bigint): boolean {
  const at = asHwnd(hwnd)
  if (at === 0n) return false
  if (at === ourHwnd) return true
  try {
    return Boolean(user32.IsChild(ourHwnd, hwnd))
  } catch {
    return false
  }
}

function hwndMatchesClassSet(
  user32: WindowAtPointApi,
  hwnd: unknown,
  classes: Set<string>
): boolean {
  let current: unknown = hwnd
  for (let depth = 0; depth < 10 && current; depth += 1) {
    const className = readClassName(user32, current)
    if (classes.has(className)) return true
    try {
      const parent = user32.GetAncestor(current, GA_PARENT)
      if (!parent || asHwnd(parent) === asHwnd(current)) break
      current = parent
    } catch {
      break
    }
  }
  return false
}

function isDesktopShellHwnd(user32: WindowAtPointApi, hwnd: unknown): boolean {
  if (hwndMatchesClassSet(user32, hwnd, EXPLORER_FRAME_CLASSES)) return false
  return hwndMatchesClassSet(user32, hwnd, DESKTOP_WALLPAPER_HOST_CLASSES)
}

function isTaskbarShellHwnd(user32: WindowAtPointApi, hwnd: unknown): boolean {
  return hwndMatchesClassSet(user32, hwnd, TASKBAR_SHELL_CLASSES)
}

function hwndAtPhysicalPoint(user32: WindowAtPointApi, ptDip: { x: number; y: number }): unknown {
  const physical = dipToPhysicalPoint(ptDip)
  return user32.WindowFromPoint(Math.round(physical.x), Math.round(physical.y))
}

function isForeignProcessHwnd(
  user32: WindowAtPointApi,
  hwnd: unknown,
  ourHwnd: bigint
): boolean {
  if (!hwnd) return false
  if (isOurHwnd(user32, hwnd, ourHwnd)) return false
  if (isDesktopShellHwnd(user32, hwnd)) return false
  const pid = readPid(user32, hwnd)
  if (pid === 0) return false
  return pid !== process.pid
}

function readWindowRectPhysical(
  user32: WindowAtPointApi,
  hwnd: unknown
): { left: number; top: number; right: number; bottom: number } | null {
  try {
    const rect = { left: 0, top: 0, right: 0, bottom: 0 }
    if (!user32.GetWindowRect(hwnd, rect)) return null
    return rect
  } catch {
    return null
  }
}

function isPhysicalPointInRect(
  pt: { x: number; y: number },
  rect: { left: number; top: number; right: number; bottom: number }
): boolean {
  return (
    pt.x >= rect.left && pt.x < rect.right && pt.y >= rect.top && pt.y < rect.bottom
  )
}

/**
 * WindowFromPoint can return WorkerW/desktop under layered apps. Also block when
 * the foreground foreign app's window contains the click.
 */
function isClickInsideForeignForeground(
  user32: WindowAtPointApi,
  ptDip: { x: number; y: number },
  ourHwnd: bigint
): boolean {
  const fg = user32.GetForegroundWindow()
  if (!fg) return false
  if (isOurHwnd(user32, fg, ourHwnd)) return false
  if (isDesktopShellHwnd(user32, fg)) return false
  const pid = readPid(user32, fg)
  if (pid === 0 || pid === process.pid) return false

  let target: unknown = fg
  try {
    const root = user32.GetAncestor(fg, GA_ROOT)
    if (root) target = root
  } catch {
    /* ignore */
  }

  const rect = readWindowRectPhysical(user32, target)
  if (!rect) return false
  return isPhysicalPointInRect(dipToPhysicalPoint(ptDip), rect)
}

/**
 * True when the topmost window under `pt` belongs to another application.
 */
export function isForeignAppAtPoint(
  win: BrowserWindow | null | undefined,
  ptDip: { x: number; y: number }
): boolean {
  if (process.platform !== 'win32') return false
  if (!win || win.isDestroyed()) return false

  const user32 = getUser32()
  const ourHwnd = hwndFromBuffer(win.getNativeWindowHandle())
  const atPoint = hwndAtPhysicalPoint(user32, ptDip)
  if (atPoint && isForeignProcessHwnd(user32, atPoint, ourHwnd)) return true
  return isClickInsideForeignForeground(user32, ptDip, ourHwnd)
}

/**
 * WorkerW-embedded global hook: accept only when the click target is the OS
 * desktop shell, or our own window while we already have focus.
 * Blocks other apps and click-through on our surface while another app is focused.
 */
export function shouldProcessEmbeddedGlobalClick(
  win: BrowserWindow | null | undefined,
  ptDip: { x: number; y: number }
): boolean {
  if (process.platform !== 'win32') return true
  if (!win || win.isDestroyed()) return true

  const user32 = getUser32()
  const ourHwnd = hwndFromBuffer(win.getNativeWindowHandle())
  const atPoint = hwndAtPhysicalPoint(user32, ptDip)
  const fg = user32.GetForegroundWindow()

  if (!atPoint) return false

  // Tray / taskbar sit on Shell_TrayWnd. Treating them as desktop-shell used to
  // open quick-edit when the last week of cells sat under an auto-hide taskbar.
  if (isTaskbarShellHwnd(user32, atPoint)) return false

  // WindowFromPoint can return WorkerW/desktop under layered apps (e.g. Chrome).
  // Always honor foreground foreign window bounds before the desktop-shell shortcut.
  if (isClickInsideForeignForeground(user32, ptDip, ourHwnd)) return false
  if (isForeignProcessHwnd(user32, atPoint, ourHwnd)) return false

  // Empty wallpaper / WorkerW (not Explorer folders — those share listview classes).
  // Desktop *icon items* are filtered by Neo-Desktop-Calendar.exe helper in main.ts.
  if (isDesktopShellHwnd(user32, atPoint)) return true

  if (isOurHwnd(user32, atPoint, ourHwnd)) {
    return isOurHwnd(user32, fg, ourHwnd)
  }

  return false
}
