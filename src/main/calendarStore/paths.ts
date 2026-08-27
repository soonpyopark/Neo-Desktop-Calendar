import { app } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { getEnvValue } from '../dotEnv'

function isWritableDirCandidate(path: string): boolean {
  if (!existsSync(path)) return true
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * Resolve MDC-compatible data root.
 *
 * Packaged (MSI): never write under app.asar — use exe-side `data/`
 * (Electron profile lives in `.neo-desktop-calendar/electron-profile`).
 * Dev: DATA_ROOT → workspace `data/` → last-resort userData/data
 */
export function resolveDataRoot(): string {
  const fromEnv = getEnvValue('DATA_ROOT')
  if (fromEnv) {
    if (isAbsolute(fromEnv)) return fromEnv
    // Relative DATA_ROOT: beside the exe when packaged, else cwd (dev).
    const base =
      app.isPackaged && process.execPath ? dirname(process.execPath) : process.cwd()
    return join(base, fromEnv)
  }

  if (app.isPackaged) {
    const besideExe = process.execPath
      ? join(dirname(process.execPath), 'data')
      : null
    if (besideExe && isWritableDirCandidate(besideExe)) {
      return besideExe
    }
    return join(app.getPath('userData'), 'data')
  }

  const candidates: string[] = []
  if (process.execPath) {
    candidates.push(join(dirname(process.execPath), 'data'))
  }
  candidates.push(join(process.cwd(), 'data'))

  // Walk up from compiled main toward package.json/data (dev / electron-vite)
  let dir = __dirname
  for (let i = 0; i < 8 && dir; i++) {
    // Skip asar paths — not writable.
    if (dir.includes('.asar')) break
    candidates.push(join(dir, 'data'))
    if (existsSync(join(dir, 'package.json'))) {
      candidates.push(join(dir, 'data'))
      break
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  for (const c of candidates) {
    if (existsSync(c) && isWritableDirCandidate(c)) return c
  }

  // Prefer workspace data next to package.json even if missing (will create)
  dir = __dirname
  for (let i = 0; i < 8 && dir; i++) {
    if (dir.includes('.asar')) break
    if (existsSync(join(dir, 'package.json'))) {
      return join(dir, 'data')
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  return join(app.getPath('userData'), 'data')
}

export function sanitizeDataKey(key: string): string {
  return String(key || 'calendar').replace(/[^a-zA-Z0-9-]/g, '-')
}
