import { app } from 'electron'
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { APP_NAME } from '../shared/constants'

/** Chromium / Electron profile next to the state root (or project root in dev). */
export const ELECTRON_PROFILE_DIR = join('.neo-desktop-calendar', 'electron-profile')

/** Optional marker beside a .app — treat that folder as a portable install. */
export const PORTABLE_MARKER = '.neo-desktop-calendar-portable'

/** macOS Application Support folder when the .app is not in a portable folder. */
export const MAC_APP_SUPPORT_NAME = APP_NAME

/** Default Electron `userData` name under %APPDATA% (package.json `name`). */
export const LEGACY_USER_DATA_NAME = 'neo-desktop-calendar'

const MAC_BUNDLE_STATE_DIRS = ['data', '.neo-desktop-calendar'] as const

/**
 * Walk `startDir` up until a `*.app` bundle is found.
 */
export function findEnclosingAppBundle(startDir: string): string {
  let current = resolve(startDir)
  for (let i = 0; i < 8; i++) {
    if (current.toLowerCase().endsWith('.app')) return current
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return ''
}

function getMacPersistentRoot(): string {
  try {
    return join(app.getPath('appData'), MAC_APP_SUPPORT_NAME)
  } catch {
    return ''
  }
}

function hasPortableState(dir: string): boolean {
  try {
    if (existsSync(join(dir, PORTABLE_MARKER))) return true
    if (existsSync(join(dir, 'data', 'settings.json'))) return true
  } catch {
    return false
  }
  return false
}

/**
 * macOS /Applications (or a lone .app): ~/Library/Application Support/Neo Desktop Calendar.
 * macOS portable: folder that contains the .app (marker or existing data/settings.json).
 */
function resolveMacStateRoot(): string {
  const execDir = dirname(process.execPath)
  const bundle = findEnclosingAppBundle(execDir)
  if (!bundle) return execDir
  const besideApp = dirname(bundle)
  if (hasPortableState(besideApp)) return besideApp
  return getMacPersistentRoot() || execDir
}

/**
 * Mutable state root: settings/calendars (`data/`) and Electron profile.
 * Windows packaged: folder that contains the exe.
 * macOS packaged: Application Support, unless the .app sits in a portable folder.
 * Dev: process.cwd().
 */
export function resolveStateRoot(): string {
  if (!app.isPackaged) return process.cwd()
  if (process.platform === 'darwin') return resolveMacStateRoot()
  return dirname(process.execPath)
}

function migrateDirTreeSync(from: string, to: string, skipIfDestHas?: string): boolean {
  if (!existsSync(from)) return false
  if (resolve(from) === resolve(to)) return false
  if (skipIfDestHas && existsSync(join(to, skipIfDestHas))) return false

  mkdirSync(dirname(to), { recursive: true })
  if (!existsSync(to)) {
    try {
      renameSync(from, to)
      return true
    } catch {
      cpSync(from, to, { recursive: true })
      try {
        rmSync(from, { recursive: true, force: true })
      } catch {
        /* bundle may be locked; the copy is enough */
      }
      return true
    }
  }

  cpSync(from, to, { recursive: true, force: false, errorOnExist: false })
  try {
    rmSync(from, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  return true
}

/**
 * Older Mac builds stored `data/` and the Electron profile inside Contents/MacOS.
 * Pull that live state out so replacing the .app no longer wipes it.
 */
export function migrateMacBundleStateToRoot(stateRoot: string): { migrated: string[] } {
  if (process.platform !== 'darwin') return { migrated: [] }
  const bundle = findEnclosingAppBundle(dirname(process.execPath))
  if (!bundle) return { migrated: [] }
  const macosDir = join(bundle, 'Contents', 'MacOS')
  if (!existsSync(macosDir)) return { migrated: [] }
  if (resolve(macosDir) === resolve(stateRoot)) return { migrated: [] }

  mkdirSync(stateRoot, { recursive: true })
  const migrated: string[] = []

  for (const name of MAC_BUNDLE_STATE_DIRS) {
    const from = join(macosDir, name)
    const to = join(stateRoot, name)
    const skipIfDestHas = name === 'data' ? 'settings.json' : undefined
    if (migrateDirTreeSync(from, to, skipIfDestHas)) migrated.push(name)
  }

  if (migrated.length > 0) {
    console.log(`[state] moved out of app bundle → ${stateRoot} (${migrated.join(', ')})`)
  }
  return { migrated }
}

/**
 * Redirect Electron/Chromium `userData` to the state root so portable/MSI
 * installs do not write %APPDATA%\\neo-desktop-calendar, and so macOS
 * packaged apps persist outside the .app bundle.
 * Must run before `requestSingleInstanceLock()`.
 */
export function applyPortableUserData(): string {
  const stateRoot = resolveStateRoot()
  if (app.isPackaged && process.platform === 'darwin') {
    migrateMacBundleStateToRoot(stateRoot)
  }
  const userData = join(stateRoot, ELECTRON_PROFILE_DIR)
  app.setPath('userData', userData)
  return userData
}

/** Previous Electron default: `%APPDATA%\\neo-desktop-calendar`. */
export function getLegacyUserDataPath(): string {
  try {
    return join(app.getPath('appData'), LEGACY_USER_DATA_NAME)
  } catch {
    return ''
  }
}
