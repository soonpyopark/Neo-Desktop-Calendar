import {
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse
} from 'node:http'
import type { Server as HttpsServer } from 'node:https'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import { getEnvValue } from '../dotEnv'
import { AuthService } from '../auth'
import type { CalendarStore } from '../calendarStore/CalendarStore'
import type { EventAttachmentService } from '../calendarStore/eventAttachments'
import type { MembersStore } from '../calendarStore/membersStore'
import { tryHandleAttachmentRequest } from './attachmentRoutes'
import { tryHandleBrowserFileRequest } from './browserFileRoutes'
import { handleApiRequest } from './apiRouter'
import {
  isClientIpAllowed,
  isHostAllowed,
  isLoopbackOnlyHosts,
  normalizeClientIp,
  parseAllowedHosts
} from './ipAccess'
import { resolveWebServerMode, resolveWebServerPort } from '../../shared/webServerPort'
import {
  formatAccessUrl,
  normalizeHttpsEnabled,
  type WebServerSyncInfo
} from '../../shared/httpsConfig'
import { getLocalIPv4Addresses } from './lanAddresses'
import { createAppHttpServer, tlsStatusOrEmpty } from './tlsCerts'

type Server = HttpServer | HttpsServer

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json'
}

export type { WebServerSyncInfo }

export type CalendarWebServerOptions = {
  auth: AuthService
  calendarStore: CalendarStore
  membersStore: MembersStore
  attachments: EventAttachmentService
  /** Production static root (`out/renderer`). */
  getWwwroot: () => string
  /** Dev Vite origin, e.g. http://localhost:5173 */
  getViteOrigin: () => string | null
  /** Prefer store/UI port over .env when set. */
  getListenPort?: () => number
  /** Data root — TLS files live in `{dataRoot}/tls`. */
  getDataRoot: () => string
  /** Prefer store HTTPS flag over .env. */
  getHttpsEnabled?: () => boolean
  /** Called after a successful listen (tray + settings start). */
  onServerStarted?: (info: { mode: 'local' | 'lan'; port: number }) => void
  /**
   * Called after any HTTP API mutation. Prefer main's notifyStoreChanged so
   * Electron renderer + WebSocket browsers both refresh (avoid WS-only).
   */
  onStoreMutated?: () => void
}

export class CalendarWebServer {
  private server: Server | null = null
  private wss: WebSocketServer | null = null
  private readonly sockets = new Set<WebSocket>()
  port = 0
  hostname = '127.0.0.1'
  lanMode = false
  addresses: string[] = []
  httpsEnabled = false
  private allowedHosts: string[] = ['127.0.0.1', 'localhost']

  constructor(private readonly options: CalendarWebServerOptions) {}

  get isRunning(): boolean {
    return this.server !== null && this.server.listening
  }

  resolveHttpsEnabled(): boolean {
    if (this.options.getHttpsEnabled) {
      return this.options.getHttpsEnabled()
    }
    return resolveHttpsEnabledFromStore(
      this.options.calendarStore.getSnapshot().settings.httpsEnabled
    )
  }

  getSyncInfo(): WebServerSyncInfo {
    const running = this.isRunning
    const port = running ? this.port : null
    const httpsOn = running ? this.httpsEnabled : this.resolveHttpsEnabled()
    const vite = preferLoopbackOrigin(this.options.getViteOrigin())
    const local = port ? `${formatAccessUrl('127.0.0.1', port, httpsOn)}/` : null
    const preferredMode = resolveLaunchServerMode(
      this.options.calendarStore.getSnapshot().settings.webServerMode
    )
    return {
      running,
      port,
      configuredPort: this.resolveListenPort(),
      preferredMode,
      hostname: running ? this.hostname : null,
      lanMode: running ? this.lanMode : false,
      addresses: running ? [...this.addresses] : [],
      // HTTPS: stay on this server (self-signed). HTTP dev: prefer Vite.
      editorUrl: running ? (httpsOn ? local : vite ?? local) : null,
      httpsEnabled: httpsOn,
      tls: tlsStatusOrEmpty(this.options.getDataRoot())
    }
  }

  resolveListenPort(): number {
    if (this.options.getListenPort) {
      return this.options.getListenPort()
    }
    return resolveWebServerPort(
      null,
      getEnvValue('PORT', 'MYCALENDAR_PORT', 'NEOCALENDAR_PORT')
    )
  }

  /**
   * MDC StartWebServerOnLaunch / tray Start Server.
   * Local and Web are mutually exclusive: any existing listener is stopped first.
   * @param mode local = loopback ACL; lan = 0.0.0.0 + ALLOWED_HOSTS=*
   */
  async tryStart(options?: {
    mode?: 'local' | 'lan' | 'env'
    requirePortInEnv?: boolean
    /** When true (default), persist Local/Web into settings.json. */
    persistPreference?: boolean
  }): Promise<{ ok: boolean; message: string }> {
    // MDC: StopWebServerInternal() before binding the other (or same) mode.
    if (this.isRunning) {
      this.stop()
    }

    const requirePort = options?.requirePortInEnv === true
    let port = this.resolveListenPort()
    if (!Number.isFinite(port) || port <= 0) {
      if (requirePort) {
        return { ok: false, message: 'PORT not set — HTTP server skipped.' }
      }
      port = resolveWebServerPort(null, null)
    }

    const mode = options?.mode ?? 'env'
    let hostname =
      getEnvValue('HOSTNAME', 'MYCALENDAR_HOSTNAME', 'NEOCALENDAR_HOSTNAME') ?? '127.0.0.1'
    hostname = hostname.trim()
    if (!hostname || hostname === 'localhost') hostname = '127.0.0.1'

    let allowedHosts = parseAllowedHosts(
      getEnvValue('ALLOWED_HOSTS', 'MYCALENDAR_ALLOWED_HOSTS', 'NEOCALENDAR_ALLOWED_HOSTS')
    )

    if (mode === 'local') {
      // Loopback ACL; Node binds 127.0.0.1 (MDC uses + bind for http.sys URL ACL).
      hostname = '127.0.0.1'
      allowedHosts = ['127.0.0.1', 'localhost']
    } else if (mode === 'lan') {
      hostname = '0.0.0.0'
      allowedHosts = ['*']
    } else {
      // env launch: MDC ResolveLaunchServerMode — default Local unless HOSTNAME=0.0.0.0
      if (hostname === '0.0.0.0' || hostname === '*' || hostname === '+') {
        hostname = '0.0.0.0'
        allowedHosts = ['*']
      } else {
        hostname = '127.0.0.1'
        allowedHosts = ['127.0.0.1', 'localhost']
      }
    }

    const loopbackOnly = isLoopbackOnlyHosts(allowedHosts)
    const httpsOn = this.resolveHttpsEnabled()
    this.port = port
    this.hostname = hostname
    this.lanMode = !loopbackOnly
    this.httpsEnabled = httpsOn
    this.allowedHosts = allowedHosts
    this.addresses = loopbackOnly
      ? [`${formatAccessUrl('127.0.0.1', port, httpsOn)}/`]
      : buildAddressList(hostname, port, httpsOn)

    let server: Server
    try {
      server = await createAppHttpServer(
        httpsOn,
        (req, res) => {
          void this.handleRequest(req, res)
        },
        this.options.getDataRoot()
      )
    } catch (err) {
      this.httpsEnabled = false
      this.port = 0
      this.addresses = []
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, message: `TLS 인증서를 준비하지 못했습니다 (${message}).` }
    }

    // LAN: wildcard bind; Local: loopback only.
    const listenHost = this.lanMode ? '0.0.0.0' : '127.0.0.1'
    this.server = server
    this.wss = new WebSocketServer({ noServer: true })
    server.on('upgrade', (req, socket, head) => {
      const url = req.url ?? ''
      if (!url.startsWith('/ws')) {
        socket.destroy()
        return
      }
      if (!this.gateRequest(req)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }
      this.wss?.handleUpgrade(req, socket, head, (ws) => {
        this.sockets.add(ws)
        ws.on('close', () => this.sockets.delete(ws))
      })
    })

    const modeLabel = this.lanMode ? 'LAN' : 'local'
    const proto = httpsOn ? 'https' : 'http'
    const aclHint = this.lanMode
      ? `관리자 PowerShell에서 URL ACL이 필요할 수 있습니다:\nnetsh http add urlacl url=${proto}://+:${port}/ user=Everyone`
      : '다른 프로그램이 포트를 사용 중이거나 권한이 없습니다.'

    return await new Promise((resolve) => {
      const onError = (err: Error): void => {
        console.warn('[web-server] listen failed', err)
        this.server = null
        this.wss = null
        this.port = 0
        this.httpsEnabled = false
        this.addresses = []
        resolve({
          ok: false,
          message: `${httpsOn ? 'HTTPS' : 'HTTP'} listen failed (${err.message}). ${aclHint}`
        })
      }
      const onListening = (): void => {
        server.off('error', onError)
        console.log(
          `[web-server] Started (${modeLabel}) on port ${port}: ${this.addresses.join(', ')}`
        )
        try {
          if (options?.persistPreference !== false) {
            this.options.onServerStarted?.({
              mode: this.lanMode ? 'lan' : 'local',
              port
            })
          }
        } catch (err) {
          console.warn('[web-server] onServerStarted failed', err)
        }
        resolve({
          ok: true,
          message: `${httpsOn ? 'HTTPS' : 'HTTP'} server started (${modeLabel}) — ${this.addresses[0] ?? `port ${port}`}`
        })
      }
      server.once('error', onError)
      server.once('listening', onListening)
      try {
        server.listen(port, listenHost)
      } catch (err) {
        server.off('error', onError)
        server.off('listening', onListening)
        this.server = null
        this.wss = null
        this.httpsEnabled = false
        const message = err instanceof Error ? err.message : String(err)
        resolve({
          ok: false,
          message: `${httpsOn ? 'HTTPS' : 'HTTP'} listen failed (${message}). ${aclHint}`
        })
      }
    })
  }

  stop(): { ok: boolean; message: string } {
    if (!this.isRunning) {
      return { ok: false, message: '웹 서버가 실행 중이 아닙니다.' }
    }
    for (const ws of this.sockets) {
      try {
        ws.close()
      } catch {
        /* ignore */
      }
    }
    this.sockets.clear()
    this.wss?.close()
    this.wss = null
    const server = this.server
    this.server = null
    server?.close()
    this.port = 0
    this.hostname = '127.0.0.1'
    this.lanMode = false
    this.httpsEnabled = false
    this.addresses = []
    this.allowedHosts = ['127.0.0.1', 'localhost']
    console.log('[web-server] Stopped')
    return { ok: true, message: '웹 서버를 중지했습니다.' }
  }

  broadcastStoreChanged(): void {
    this.broadcastWs('store-changed')
  }

  private broadcastWs(type: string): void {
    const payload = JSON.stringify({ type })
    for (const ws of this.sockets) {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(payload)
        } catch {
          /* ignore */
        }
      }
    }
  }

  private gateRequest(req: IncomingMessage): boolean {
    if (!isHostAllowed(req.headers.host, this.allowedHosts)) return false
    const ip = normalizeClientIp(req.socket.remoteAddress)
    const allowed = this.options.calendarStore.getSnapshot().settings.allowedIpCidrs
    return isClientIpAllowed(ip, allowed)
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      applyCors(res)
      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      if (!this.gateRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: 'Forbidden' }))
        return
      }

      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
      const path = url.pathname

      if (path.startsWith('/api/')) {
        const onStoreMutated = (): void => {
          if (this.options.onStoreMutated) this.options.onStoreMutated()
          else this.broadcastStoreChanged()
        }

        const handledAttach = await tryHandleAttachmentRequest({
          req,
          res,
          path,
          auth: this.options.auth,
          attachments: this.options.attachments,
          onStoreMutated
        })
        if (handledAttach) return

        const handledFile = await tryHandleBrowserFileRequest({
          req,
          res,
          path,
          auth: this.options.auth,
          calendarStore: this.options.calendarStore,
          onStoreMutated
        })
        if (handledFile) return

        const body = await readJsonBody(req)
        const token = AuthService.extractToken(
          req.headers.authorization,
          headerValue(req.headers['x-admin-token'])
        )
        const result = await handleApiRequest(
          {
            auth: this.options.auth,
            calendarStore: this.options.calendarStore,
            membersStore: this.options.membersStore,
            getSyncInfo: () => this.getSyncInfo(),
            onStoreMutated
          },
          req.method ?? 'GET',
          path,
          body,
          token,
          req
        )
        res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(result.body))
        return
      }

      const vite = preferLoopbackOrigin(this.options.getViteOrigin())
      if (vite && !this.httpsEnabled) {
        // Redirect UI to Vite instead of proxying (proxy made localhost feel slow).
        // /api and /ws are handled above; Vite proxies those back to this server.
        const dest = new URL(req.url ?? '/', vite).toString()
        res.writeHead(302, { Location: dest, 'Cache-Control': 'no-store' })
        res.end()
        return
      }

      await serveStatic(req, res, this.options.getWwwroot(), path)
    } catch (err) {
      console.warn('[web-server] request failed', err)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(
          JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : 'Internal error'
          })
        )
      }
    }
  }
}

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function applyCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Admin-Token'
  )
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const method = (req.method ?? 'GET').toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'DELETE') return null
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  if (chunks.length === 0) return null
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Prefer 127.0.0.1 over localhost to avoid Windows IPv6 (::1) connect delays. */
function preferLoopbackOrigin(origin: string | null | undefined): string | null {
  const raw = String(origin ?? '').trim()
  if (!raw) return null
  try {
    const url = new URL(raw.endsWith('/') ? raw : `${raw}/`)
    if (url.hostname === 'localhost' || url.hostname === '::1') {
      url.hostname = '127.0.0.1'
    }
    return url.origin + '/'
  } catch {
    return raw.endsWith('/') ? raw : `${raw}/`
  }
}

async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  wwwroot: string,
  pathname: string
): Promise<void> {
  const root = normalize(wwwroot)
  let rel = decodeURIComponent(pathname)
  if (rel === '/' || rel === '') rel = '/index.html'
  const candidate = normalize(join(root, rel.replace(/^\//, '')))
  if (!candidate.startsWith(root + sep) && candidate !== root) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  let filePath = candidate
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    // SPA fallback
    filePath = join(root, 'index.html')
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404)
    res.end('Not found')
    return
  }

  const ext = extname(filePath).toLowerCase()
  const isHashedAsset = filePath.includes(`${sep}assets${sep}`)
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache'
  })
  createReadStream(filePath).pipe(res)
}

function buildAddressList(hostname: string, port: number, httpsEnabled: boolean): string[] {
  const urls = new Set<string>()
  urls.add(`${formatAccessUrl('127.0.0.1', port, httpsEnabled)}/`)
  if (hostname === '0.0.0.0' || hostname === '*' || hostname === '+') {
    for (const address of getLocalIPv4Addresses()) {
      urls.add(`${formatAccessUrl(address, port, httpsEnabled)}/`)
    }
  } else if (hostname !== '127.0.0.1') {
    urls.add(`${formatAccessUrl(hostname, port, httpsEnabled)}/`)
  }
  return [...urls]
}

/**
 * Prefer store webServerMode, then .env HOSTNAME (MDC ResolveLaunchServerMode).
 * Missing / empty / localhost / 127.0.0.1 → Local (default).
 * 0.0.0.0 (or * / +) → Web / LAN.
 */
export function resolveLaunchServerMode(preferredMode?: unknown): 'local' | 'lan' {
  return resolveWebServerMode(
    preferredMode,
    getEnvValue('HOSTNAME', 'MYCALENDAR_HOSTNAME', 'NEOCALENDAR_HOSTNAME')
  )
}

/** Prefer store httpsEnabled, then .env HTTPS_ENABLED. */
export function resolveHttpsEnabledFromStore(preferred?: unknown): boolean {
  if (preferred != null && preferred !== '') {
    return normalizeHttpsEnabled(preferred)
  }
  return normalizeHttpsEnabled(
    getEnvValue('HTTPS_ENABLED', 'NEOCALENDAR_HTTPS', 'MYCALENDAR_HTTPS')
  )
}
