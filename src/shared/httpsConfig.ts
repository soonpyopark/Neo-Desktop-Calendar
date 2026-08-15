/** Treat store / .env / IPC values as a boolean HTTPS flag. */
export function normalizeHttpsEnabled(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true'
}

export function httpScheme(httpsEnabled: boolean): 'http' | 'https' {
  return httpsEnabled ? 'https' : 'http'
}

export function wsScheme(httpsEnabled: boolean): 'ws' | 'wss' {
  return httpsEnabled ? 'wss' : 'ws'
}

export function formatAccessUrl(host: string, port: number, httpsEnabled: boolean): string {
  return `${httpScheme(httpsEnabled)}://${host}:${port}`
}

export type WebServerTlsStatus = {
  dir: string
  caPath: string
  hasCa: boolean
  hasServer: boolean
  sans: string[]
  notAfter: string
  fingerprint256: string
}

export function emptyTlsStatus(dir = ''): WebServerTlsStatus {
  return {
    dir,
    caPath: '',
    hasCa: false,
    hasServer: false,
    sans: [],
    notAfter: '',
    fingerprint256: ''
  }
}

export type WebServerSyncInfo = {
  running: boolean
  port: number | null
  configuredPort: number
  preferredMode: 'local' | 'lan'
  hostname: string | null
  lanMode: boolean
  addresses: string[]
  editorUrl: string | null
  httpsEnabled: boolean
  tls: WebServerTlsStatus
}
