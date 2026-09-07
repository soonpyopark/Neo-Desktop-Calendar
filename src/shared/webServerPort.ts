import { APP_NAME } from './constants'

/** Default HTTP listen port when store / .env do not set one (Windows / dev). */
export const DEFAULT_WEB_SERVER_PORT = 3010

/** Packaged macOS default — can run beside Windows / `npm run dev` on 3010. */
export const DEFAULT_MAC_WEB_SERVER_PORT = 3012

export type WebServerMode = 'local' | 'lan'

type ProcessLike = {
  platform?: string
  env?: Record<string, string | undefined>
  defaultApp?: boolean
  resourcesPath?: string
  execPath?: string
}

function runtimeProcess(): ProcessLike | undefined {
  return (globalThis as { process?: ProcessLike }).process
}

function inferPackaged(): boolean {
  const proc = runtimeProcess()
  if (!proc) return false
  if (proc.env?.ELECTRON_RENDERER_URL) return false
  if (proc.defaultApp === true) return false
  const needle = `${APP_NAME}.app`
  if (String(proc.resourcesPath ?? '').includes(needle)) return true
  return String(proc.execPath ?? '').includes(needle)
}

/**
 * Built-in port when settings and `.env` are both unset.
 * Packaged macOS uses 3012 so it can run next to Windows / `npm run dev` (3010).
 */
export function fallbackWebServerPort(
  options: { platform?: string; packaged?: boolean } = {}
): number {
  const proc = runtimeProcess()
  const platform = options.platform ?? proc?.platform ?? ''
  const packaged = options.packaged ?? inferPackaged()
  if (packaged && platform === 'darwin') return DEFAULT_MAC_WEB_SERVER_PORT
  return DEFAULT_WEB_SERVER_PORT
}

/** Valid TCP port or null if unset / invalid. */
export function normalizeWebServerPort(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  if (!Number.isFinite(n)) return null
  const port = Math.trunc(n)
  if (port < 1 || port > 65535) return null
  return port
}

/**
 * Prefer stored setting, then env string, then platform default.
 */
export function resolveWebServerPort(
  preferred?: unknown,
  envRaw?: string | null,
  fallback?: number
): number {
  return (
    normalizeWebServerPort(preferred) ??
    normalizeWebServerPort(envRaw) ??
    fallback ??
    fallbackWebServerPort()
  )
}

export function normalizeWebServerMode(value: unknown): WebServerMode | null {
  return value === 'lan' || value === 'local' ? value : null
}

/**
 * Prefer stored Local/Web choice, then .env HOSTNAME, then local.
 */
export function resolveWebServerMode(
  preferred?: unknown,
  envHostname?: string | null
): WebServerMode {
  const fromStore = normalizeWebServerMode(preferred)
  if (fromStore) return fromStore
  const hostname = String(envHostname ?? '').trim()
  if (hostname === '0.0.0.0' || hostname === '*' || hostname === '+') return 'lan'
  return 'local'
}
