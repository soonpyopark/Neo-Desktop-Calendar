import { BrowserWindow, screen } from 'electron'
import koffi from 'koffi'
import { dipBoundsToPhysical } from './displayGeometry'
import type { WidgetBounds } from '../shared/ipc'

/**
 * Desktop wallpaper attachment.
 *
 * Principle #1: WorkerW SetParent (under icons).
 * Multi-monitor: WorkerW usually spans the virtual desktop; child position
 * is parent-relative via ScreenToClient / physical rect subtraction.
 */

const SMTO_NORMAL = 0x0000
const HWND_BOTTOM = 1
const HWND_TOP = 0
const SWP_NOSIZE = 0x0001
const SWP_NOMOVE = 0x0002
const SWP_NOACTIVATE = 0x0010
const SWP_SHOWWINDOW = 0x0040
const SWP_NOZORDER = 0x0004
const GW_HWNDPREV = 3
const WM_SPAWN_WORKERW = 0x052c

type User32Api = {
  FindWindowW: (...args: unknown[]) => unknown
  FindWindowExW: (...args: unknown[]) => unknown
  SendMessageTimeoutW: (...args: unknown[]) => unknown
  EnumWindows: (...args: unknown[]) => unknown
  SetParent: (...args: unknown[]) => unknown
  SetWindowPos: (...args: unknown[]) => unknown
  GetWindow: (...args: unknown[]) => unknown
  GetWindowRect: (...args: unknown[]) => unknown
  ScreenToClient: (...args: unknown[]) => unknown
  IsWindow: (...args: unknown[]) => unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  EnumWindowsProc: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  RECT: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  POINT: any
}

let user32Api: User32Api | null = null
let embeddedHwnd: bigint | null = null
let cachedWorkerW = 0n
let spawnedWorkerWThisSession = false
let lastResortSpawnUsed = false
const processStartedAt = Date.now()
/** 0x052C (0xD, 0x1) recreates the desktop and scatters icons at logon. */
const BOOT_SPAWN_GRACE_MS = 20_000

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

function getUser32(): User32Api {
  if (user32Api) return user32Api

  const user32 = koffi.load('user32.dll')
  const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(void *hwnd, intptr lParam)')
  const RECT = koffi.struct('NEO_RECT', {
    left: 'long',
    top: 'long',
    right: 'long',
    bottom: 'long'
  })
  const POINT = koffi.struct('NEO_POINT', {
    x: 'long',
    y: 'long'
  })

  user32Api = {
    FindWindowW: user32.func('FindWindowW', 'void *', ['str16', 'str16']),
    FindWindowExW: user32.func('FindWindowExW', 'void *', ['void *', 'void *', 'str16', 'str16']),
    SendMessageTimeoutW: user32.func('SendMessageTimeoutW', 'void *', [
      'void *',
      'uint32',
      'void *',
      'void *',
      'uint32',
      'uint32',
      'void *'
    ]),
    EnumWindows: user32.func('EnumWindows', 'bool', ['EnumWindowsProc *', 'intptr']),
    SetParent: user32.func('SetParent', 'void *', ['void *', 'void *']),
    SetWindowPos: user32.func('SetWindowPos', 'bool', [
      'void *',
      'void *',
      'int',
      'int',
      'int',
      'int',
      'uint32'
    ]),
    GetWindow: user32.func('GetWindow', 'void *', ['void *', 'uint32']),
    GetWindowRect: user32.func('GetWindowRect', 'bool', ['void *', koffi.out(koffi.pointer(RECT))]),
    ScreenToClient: user32.func('ScreenToClient', 'bool', [
      'void *',
      koffi.inout(koffi.pointer(POINT))
    ]),
    IsWindow: user32.func('IsWindow', 'bool', ['void *']),
    EnumWindowsProc,
    RECT,
    POINT
  }

  return user32Api
}

function isWindowAlive(hwnd: bigint): boolean {
  if (hwnd === 0n) return false
  try {
    return Boolean(getUser32().IsWindow(hwnd))
  } catch {
    return false
  }
}

/**
 * Locate an existing WorkerW behind SHELLDLL_DefView. Does not send 0x052C —
 * that message recreates the desktop host and can scatter icons, especially
 * when Explorer is still laying out a multi-monitor session at logon.
 */
function findExistingWorkerW(): bigint {
  const api = getUser32()
  let workerw = 0n
  const callback = koffi.register((topHwnd: unknown) => {
    const top = asHwnd(topHwnd)
    const defView = asHwnd(api.FindWindowExW(top, 0n, 'SHELLDLL_DefView', null))
    if (defView !== 0n) {
      workerw = asHwnd(api.FindWindowExW(0n, top, 'WorkerW', null))
      return false
    }
    return true
  }, koffi.pointer(api.EnumWindowsProc as never))

  try {
    api.EnumWindows(callback, 0)
  } finally {
    koffi.unregister(callback)
  }

  if (workerw !== 0n) return workerw
  const progman = asHwnd(api.FindWindowW('Progman', null))
  if (progman === 0n) return 0n
  return asHwnd(api.FindWindowExW(progman, 0n, 'WorkerW', null))
}

/** Progman + SHELLDLL_DefView exist — Explorer finished the desktop shell. */
export function isExplorerDesktopReady(): boolean {
  if (process.platform !== 'win32') return true
  try {
    const api = getUser32()
    const progman = asHwnd(api.FindWindowW('Progman', null))
    if (progman === 0n) return false
    return findDesktopShellWindow() !== 0n
  } catch {
    return false
  }
}

export function isWorkerWHostAvailable(): boolean {
  if (process.platform !== 'win32') return false
  try {
    return findWorkerW({ allowSpawn: false }) !== 0n
  } catch {
    return false
  }
}

/**
 * Find the WorkerW that sits behind SHELLDLL_DefView.
 * Reuse Explorer's existing host first. Spawn only when it is missing and
 * the desktop shell is already up — never on every topology / embed call.
 */
function findWorkerW(options?: { allowSpawn?: boolean }): bigint {
  if (cachedWorkerW !== 0n && isWindowAlive(cachedWorkerW)) return cachedWorkerW

  let workerw = findExistingWorkerW()
  if (workerw !== 0n) {
    cachedWorkerW = workerw
    return workerw
  }

  if (options?.allowSpawn === false) return 0n
  if (!isExplorerDesktopReady()) {
    console.warn('[wallpaper] Explorer desktop not ready — skip WorkerW spawn')
    return 0n
  }

  const api = getUser32()
  const progman = asHwnd(api.FindWindowW('Progman', null))
  if (progman === 0n) return 0n

  if (!spawnedWorkerWThisSession) {
    spawnedWorkerWThisSession = true
    console.log('[wallpaper] WorkerW missing — spawn (0,0) only')
    api.SendMessageTimeoutW(progman, WM_SPAWN_WORKERW, 0n, 0n, SMTO_NORMAL, 1000, null)
    workerw = findExistingWorkerW()
    if (workerw !== 0n) {
      cachedWorkerW = workerw
      return workerw
    }
  }

  // Some Win10/11 builds only create WorkerW via (0xD, 0x1). That variant
  // rebuilds the desktop and scatters icons — never during logon grace.
  if (!lastResortSpawnUsed && Date.now() - processStartedAt > BOOT_SPAWN_GRACE_MS) {
    lastResortSpawnUsed = true
    console.warn('[wallpaper] WorkerW still missing — last-resort spawn (0xD, 0x1)')
    api.SendMessageTimeoutW(progman, WM_SPAWN_WORKERW, 0xdn, 0x1n, SMTO_NORMAL, 1000, null)
    workerw = findExistingWorkerW()
    if (workerw !== 0n) {
      cachedWorkerW = workerw
      return workerw
    }
  }

  workerw = asHwnd(api.FindWindowExW(progman, 0n, 'WorkerW', null))
  cachedWorkerW = workerw
  return workerw
}

function findDesktopShellWindow(): bigint {
  const api = getUser32()
  const progman = asHwnd(api.FindWindowW('Progman', null))
  if (progman !== 0n && asHwnd(api.FindWindowExW(progman, 0n, 'SHELLDLL_DefView', null)) !== 0n) {
    return progman
  }

  let shell = 0n
  const callback = koffi.register((topHwnd: unknown) => {
    const top = asHwnd(topHwnd)
    if (asHwnd(api.FindWindowExW(top, 0n, 'SHELLDLL_DefView', null)) !== 0n) {
      shell = top
      return false
    }
    return true
  }, koffi.pointer(api.EnumWindowsProc as never))

  try {
    api.EnumWindows(callback, 0)
  } finally {
    koffi.unregister(callback)
  }
  return shell
}

function readScreenBounds(win: BrowserWindow): WidgetBounds {
  const b = win.getBounds()
  return { x: b.x, y: b.y, width: b.width, height: b.height }
}

function getWindowScreenRectPhysical(
  hwnd: bigint
): { left: number; top: number; right: number; bottom: number } | null {
  const api = getUser32()
  const rect = { left: 0, top: 0, right: 0, bottom: 0 }
  if (!api.GetWindowRect(hwnd, rect)) return null
  return rect
}

/** Place child so its screen footprint matches DIP `bounds` on any monitor. */
function placeChildOnVirtualDesktop(hwnd: bigint, parent: bigint, dipBounds: WidgetBounds): void {
  const api = getUser32()
  const physical = dipBoundsToPhysical(dipBounds)

  // Prefer ScreenToClient — correct across negative / multi-monitor origins.
  const pt = { x: physical.x, y: physical.y }
  const ok = api.ScreenToClient(parent, pt)
  let relX = pt.x
  let relY = pt.y

  if (!ok) {
    const parentRect = getWindowScreenRectPhysical(parent)
    if (parentRect) {
      relX = physical.x - parentRect.left
      relY = physical.y - parentRect.top
    }
  }

  api.SetWindowPos(
    hwnd,
    HWND_TOP,
    relX,
    relY,
    physical.width,
    physical.height,
    SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOZORDER
  )
}

export function isWorkerEmbedded(): boolean {
  return embeddedHwnd !== null
}

/** Actual content footprint in screen DIP (matches renderer getBoundingClientRect). */
export function getWindowDipScreenBounds(win: BrowserWindow): WidgetBounds | null {
  if (win.isDestroyed()) return null

  try {
    const content = win.getContentBounds()
    if (
      Number.isFinite(content.x) &&
      Number.isFinite(content.y) &&
      content.width > 0 &&
      content.height > 0
    ) {
      return {
        x: Math.round(content.x),
        y: Math.round(content.y),
        width: Math.round(content.width),
        height: Math.round(content.height)
      }
    }
  } catch {
    /* fall through */
  }

  try {
    const api = getUser32()
    const hwnd = hwndFromBuffer(win.getNativeWindowHandle())
    const rect = { left: 0, top: 0, right: 0, bottom: 0 }
    if (!api.GetWindowRect(hwnd, rect)) {
      const b = win.getBounds()
      return { x: b.x, y: b.y, width: b.width, height: b.height }
    }

    const physical = {
      x: rect.left,
      y: rect.top,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top
    }

    try {
      const dip = screen.screenToDipRect(null, physical)
      return {
        x: Math.round(dip.x),
        y: Math.round(dip.y),
        width: Math.round(dip.width),
        height: Math.round(dip.height)
      }
    } catch {
      const display = screen.getDisplayNearestPoint({ x: physical.x, y: physical.y })
      const s = display.scaleFactor || 1
      return {
        x: Math.round(physical.x / s),
        y: Math.round(physical.y / s),
        width: Math.round(physical.width / s),
        height: Math.round(physical.height / s)
      }
    }
  } catch {
    try {
      const b = win.getBounds()
      return { x: b.x, y: b.y, width: b.width, height: b.height }
    } catch {
      return null
    }
  }
}

export function setAsWallpaper(win: BrowserWindow, bounds?: WidgetBounds): void {
  if (process.platform !== 'win32') {
    win.setAlwaysOnTop(false)
    return
  }

  const footprint = bounds ?? readScreenBounds(win)
  const display = screen.getDisplayMatching({
    x: footprint.x,
    y: footprint.y,
    width: footprint.width,
    height: footprint.height
  })

  try {
    const api = getUser32()
    const hwnd = hwndFromBuffer(win.getNativeWindowHandle())
    win.setAlwaysOnTop(false)
    win.setBounds(footprint)

    if (
      embeddedHwnd === hwnd &&
      cachedWorkerW !== 0n &&
      isWindowAlive(cachedWorkerW)
    ) {
      placeChildOnVirtualDesktop(hwnd, cachedWorkerW, footprint)
      console.log('[wallpaper] Repositioned on existing WorkerW', {
        footprint,
        displayId: display.id
      })
      return
    }

    const workerw = findWorkerW()
    if (workerw !== 0n) {
      api.SetParent(hwnd, workerw)
      placeChildOnVirtualDesktop(hwnd, workerw, footprint)
      placeChildOnVirtualDesktop(hwnd, workerw, footprint)
      embeddedHwnd = hwnd
      console.log('[wallpaper] Attached to WorkerW (multi-monitor) — principle #1', {
        footprint,
        displayId: display.id,
        scaleFactor: display.scaleFactor
      })
      return
    }

    console.warn('[wallpaper] WorkerW not found — falling back to shell-bottom overlay')
    sendToDesktopBottom(win)
    win.setBounds(footprint)
    embeddedHwnd = null
  } catch (error) {
    console.error('[wallpaper] Failed to attach under icons:', error)
    try {
      sendToDesktopBottom(win)
      win.setBounds(footprint)
    } catch {
      /* ignore */
    }
    embeddedHwnd = null
  }
}

export function clearWallpaperPin(win?: BrowserWindow | null, bounds?: WidgetBounds): void {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return

  const footprint = bounds ?? readScreenBounds(win)

  try {
    const api = getUser32()
    const hwnd = hwndFromBuffer(win.getNativeWindowHandle())

    api.SetParent(hwnd, 0n)
    api.SetWindowPos(
      hwnd,
      HWND_TOP,
      0,
      0,
      0,
      0,
      SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW
    )
    win.setBounds(footprint)
    embeddedHwnd = null
    console.log('[wallpaper] Detached from WorkerW — footprint restored', footprint)
  } catch (error) {
    embeddedHwnd = null
    console.error('[wallpaper] Failed to detach wallpaper pin:', error)
    try {
      win.setBounds(footprint)
    } catch {
      /* ignore */
    }
  }
}

export function sendToDesktopBottom(win: BrowserWindow): void {
  if (process.platform !== 'win32') return

  try {
    const api = getUser32()
    const hwnd = hwndFromBuffer(win.getNativeWindowHandle())
    const shell = findDesktopShellWindow()

    win.setAlwaysOnTop(false)
    if (shell !== 0n) {
      const aboveShell = asHwnd(api.GetWindow(shell, GW_HWNDPREV))
      if (aboveShell !== 0n && aboveShell !== hwnd) {
        api.SetWindowPos(
          hwnd,
          aboveShell,
          0,
          0,
          0,
          0,
          SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW
        )
        console.log('[wallpaper] Pinned above desktop shell (fallback overlay)')
        return
      }
    }

    api.SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)
    console.log('[wallpaper] Pinned HWND_BOTTOM (fallback)')
  } catch (error) {
    console.error('[wallpaper] sendToDesktopBottom failed:', error)
  }
}

export type WallpaperBrowserWindow = BrowserWindow & {
  setAsWallpaper: () => void
}

export function withWallpaperApi(win: BrowserWindow): WallpaperBrowserWindow {
  const wallpaperWindow = win as WallpaperBrowserWindow
  wallpaperWindow.setAsWallpaper = () => {
    setAsWallpaper(win)
  }
  return wallpaperWindow
}
