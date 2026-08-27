import { app } from 'electron'
import { dirname, join } from 'node:path'

/** Chromium / Electron profile next to the exe (or project root in dev). */
export const ELECTRON_PROFILE_DIR = join('.neo-desktop-calendar', 'electron-profile')

/** Default Electron `userData` name under %APPDATA% (package.json `name`). */
export const LEGACY_USER_DATA_NAME = 'neo-desktop-calendar'

/**
 * Redirect Electron/Chromium `userData` so portable/MSI installs do not write
 * %APPDATA%\neo-desktop-calendar. Must run before `requestSingleInstanceLock()`.
 */
export function applyPortableUserData(): string {
  const exeRoot = app.isPackaged ? dirname(process.execPath) : process.cwd()
  const userData = join(exeRoot, ELECTRON_PROFILE_DIR)
  app.setPath('userData', userData)
  return userData
}

/** Previous Electron default: `%APPDATA%\neo-desktop-calendar`. */
export function getLegacyUserDataPath(): string {
  try {
    return join(app.getPath('appData'), LEGACY_USER_DATA_NAME)
  } catch {
    return ''
  }
}
