import type { AuthUser, NeoCalendarApi } from '../../../shared/ipc'
import type {
  CalendarEvent,
  CalendarRecord,
  CalendarStoreSnapshot,
  EventInput,
  MemberSaveInput,
  StoreSettings,
  TagRecord
} from '../../../shared/calendarTypes'
import { isImageAttachment } from '../../../shared/attachmentKinds'
import { normalizeStoreBackup } from '../../../shared/storeBackup'
import { clearOfflineQueue, clearOfflineSnapshot } from './offlineStore'

const TOKEN_KEY = 'neo-calendar-auth-token'
const TOKEN_KEY_SESSION = 'neo-calendar-auth-token-session'

function getToken(): string | null {
  try {
    return (
      localStorage.getItem(TOKEN_KEY) ??
      sessionStorage.getItem(TOKEN_KEY_SESSION) ??
      null
    )
  } catch {
    return null
  }
}

/** True when the browser client still holds a Bearer token. */
export function hasBrowserAuthToken(): boolean {
  return Boolean(getToken())
}

/**
 * Avoid clearing React auth state when /api/auth/session briefly returns null
 * while a token is already stored (login race / stale session probe).
 */
export function shouldApplyAuthUserUpdate(next: AuthUser | null): boolean {
  if (next) return true
  if (!isBrowserNeoCalendarHost()) return true
  return !hasBrowserAuthToken()
}

/** Fetch session user; retry once when a stored token exists but session is null. */
export async function fetchAuthUser(): Promise<AuthUser | null> {
  const api = window.neoCalendar
  if (!api?.getAuth) return null
  let user = await api.getAuth()
  if (!user && isBrowserNeoCalendarHost() && hasBrowserAuthToken()) {
    user = await api.getAuth()
  }
  return user
}

/** Payload on `neo-auth-changed` — authoritative when present (avoids session probe race). */
export type NeoAuthChangedDetail = { user: AuthUser | null }

function dispatchNeoAuthChanged(user: AuthUser | null): void {
  window.dispatchEvent(
    new CustomEvent<NeoAuthChangedDetail>('neo-auth-changed', { detail: { user } })
  )
}

/** When detail carries `user`, that value wins over `/api/auth/session`. */
export function getAuthUserFromChangedEvent(event: Event): AuthUser | null | undefined {
  const detail = (event as CustomEvent<NeoAuthChangedDetail>).detail
  if (detail && typeof detail === 'object' && 'user' in detail) {
    return detail.user ?? null
  }
  return undefined
}

export async function resolveAuthUserAfterChange(event?: Event): Promise<AuthUser | null> {
  if (event) {
    const fromDetail = getAuthUserFromChangedEvent(event)
    if (fromDetail !== undefined) return fromDetail
  }
  return fetchAuthUser()
}

/**
 * Sync React auth state after login/logout.
 * Browser: listens to `neo-auth-changed` detail; Electron: IPC `onAuthChanged`.
 */
export function subscribeAuthUserSync(apply: (user: AuthUser | null) => void): () => void {
  const sync = (event?: Event): void => {
    void resolveAuthUserAfterChange(event).then((next) => {
      if (event && getAuthUserFromChangedEvent(event) !== undefined) {
        apply(next)
        return
      }
      if (shouldApplyAuthUserUpdate(next)) apply(next)
    })
  }

  if (isBrowserNeoCalendarHost()) {
    const onWindow = (event: Event): void => sync(event)
    window.addEventListener('neo-auth-changed', onWindow)
    return () => window.removeEventListener('neo-auth-changed', onWindow)
  }

  const api = window.neoCalendar
  return api?.onAuthChanged?.(() => sync()) ?? (() => undefined)
}

function setToken(token: string | null, remember: boolean): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(TOKEN_KEY_SESSION)
    if (!token) return
    if (remember) localStorage.setItem(TOKEN_KEY, token)
    else sessionStorage.setItem(TOKEN_KEY_SESSION, token)
  } catch {
    /* ignore */
  }
}

export class HttpRequestError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'HttpRequestError'
    this.status = status
  }
}

export function isAuthRequestError(err: unknown): boolean {
  if (err instanceof HttpRequestError) return err.status === 401
  const message = err instanceof Error ? err.message : String(err ?? '')
  return message === '로그인이 필요합니다.' || message === '로그인에 실패했습니다.'
}

async function http<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  if (!res.ok) {
    const err =
      data && typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error: unknown }).error)
        : `HTTP ${res.status}`
    throw new HttpRequestError(err, res.status)
  }
  return data as T
}

async function httpForm<T>(path: string, form: FormData): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  // Do not set Content-Type — browser sets multipart boundary.

  const res = await fetch(path, { method: 'POST', headers, body: form })
  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  if (!res.ok) {
    const err =
      data && typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error: unknown }).error)
        : `HTTP ${res.status}`
    throw new HttpRequestError(err, res.status)
  }
  return data as T
}

function pickLocalFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.style.display = 'none'
    const cleanup = (): void => {
      input.remove()
    }
    input.addEventListener('change', () => {
      const list = input.files ? Array.from(input.files) : []
      cleanup()
      resolve(list)
    })
    input.addEventListener('cancel', () => {
      cleanup()
      resolve([])
    })
    document.body.appendChild(input)
    input.click()
  })
}

async function findEventOrThrow(eventId: string): Promise<CalendarEvent> {
  const store = await http<CalendarStoreSnapshot>('GET', '/api/store')
  const found = store.events.find((e) => e.id === eventId)
  if (!found) throw new Error('일정을 찾을 수 없습니다.')
  return found
}

async function fetchAttachment(
  eventId: string,
  attachmentId: string
): Promise<{ blob: Blob; filename: string }> {
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(
    `/api/events/${encodeURIComponent(eventId)}/attachments/${encodeURIComponent(attachmentId)}/file`,
    { headers }
  )
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const data = (await res.json()) as { error?: string }
      if (data?.error) message = data.error
    } catch {
      /* ignore */
    }
    throw new Error(message)
  }
  const blob = await res.blob()
  const disposition = res.headers.get('Content-Disposition') ?? ''
  const utfMatch = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
  const plainMatch = /filename="([^"]+)"/i.exec(disposition)
  const filename = utfMatch ? decodeURIComponent(utfMatch[1]) : plainMatch?.[1] || 'attachment'
  return { blob, filename }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('첨부 파일을 읽을 수 없습니다.'))
    reader.readAsDataURL(blob)
  })
}

async function downloadAuthenticated(
  method: string,
  path: string,
  body?: BodyInit | null,
  contentType?: string | null
): Promise<{ blob: Blob; filename: string; attachmentFiles: number }> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  if (contentType) headers['Content-Type'] = contentType
  const res = await fetch(path, { method, headers, body: body ?? undefined })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const data = (await res.json()) as { error?: string }
      if (data?.error) message = data.error
    } catch {
      /* ignore */
    }
    throw new Error(message)
  }
  const disposition = res.headers.get('Content-Disposition') ?? ''
  const utfMatch = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
  const plainMatch = /filename="([^"]+)"/i.exec(disposition)
  const filename = utfMatch
    ? decodeURIComponent(utfMatch[1])
    : plainMatch?.[1] || 'download'
  const attachmentFiles = Number(res.headers.get('X-Attachment-Files') ?? 0) || 0
  return { blob: await res.blob(), filename, attachmentFiles }
}

function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }
}

function pickSingleFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'
    const cleanup = (): void => input.remove()
    input.addEventListener('change', () => {
      const file = input.files?.[0] ?? null
      cleanup()
      resolve(file)
    })
    input.addEventListener('cancel', () => {
      cleanup()
      resolve(null)
    })
    document.body.appendChild(input)
    input.click()
  })
}

let browserHostInstalled = false

function isHttpPageHost(): boolean {
  if (typeof window === 'undefined') return false
  const protocol = window.location?.protocol ?? ''
  return protocol === 'http:' || protocol === 'https:'
}

function isElectronRenderer(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron')
}

/** True when the UI is served over HTTP (not Electron preload). */
export function isBrowserNeoCalendarHost(): boolean {
  if (browserHostInstalled) return true
  if (isElectronRenderer()) return false
  return isHttpPageHost()
}

/**
 * Install window.neoCalendar backed by HTTP /api when running outside Electron.
 */
export function installBrowserNeoCalendar(): void {
  if (typeof window === 'undefined') return
  if (isElectronRenderer()) return

  const onHttp = isHttpPageHost()
  if (window.neoCalendar) {
    // Vite HMR re-evaluates modules but keeps window.neoCalendar — restore the flag.
    browserHostInstalled = onHttp
    return
  }

  if (!onHttp) return

  browserHostInstalled = true

  const browserApi: NeoCalendarApi = {
    setIgnoreMouse: () => undefined,
    getModeStatus: async () => ({
      mode: 'window',
      embedded: false,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      switchReady: true
    }),
    enterDesktop: async () => browserApi.getModeStatus(),
    enterWindow: async () => browserApi.getModeStatus(),
    getWindowBounds: async () => ({ x: 0, y: 0, width: 0, height: 0 }),
    setWindowBounds: async () => ({ x: 0, y: 0, width: 0, height: 0 }),
    setWindowModeHitZone: () => undefined,
    setHeaderHitZone: () => undefined,
    setWakeHitZones: () => undefined,
    setClickForwardHitZones: () => undefined,
    onToolbarClick: () => () => undefined,
    setDayCellHitZones: () => undefined,
    setDayDblClickExcludeZones: () => undefined,
    setInteractionBusy: () => undefined,
    focusForTextInput: () => undefined,
    onModeChanged: () => () => undefined,
    onOpenDayQuickEdit: () => () => undefined,
    onFocusDayCell: () => () => undefined,
    setDesktopQuickEditContext: () => undefined,
    getQuickEditInit: async () => null,
    closeQuickEditWindow: () => undefined,
    deferQuickEditToMain: async () => false,
    getPanelInit: async () => null,
    openPanelWindow: async () => false,
    closePanelSlot: () => undefined,
    closePanelWindow: () => undefined,
    blockPanelOutsideClose: () => undefined,
    closeAfterEventDelete: () => undefined,
    routePanelWindow: async () => false,
    resizePanelWindow: async () => false,
    onPanelRequestDismiss: () => () => undefined,
    onDayListPreviewOpenChanged: () => () => undefined,
    onQuickEditDeferred: () => () => undefined,
    onDayDblClickLog: () => () => undefined,
    // Browser already refreshes via WebSocket → neo-store-changed.
    onStoreChanged: () => () => undefined,
    onAuthChanged: (listener) => {
      const handler = (): void => {
        listener()
      }
      window.addEventListener('neo-auth-changed', handler)
      return () => window.removeEventListener('neo-auth-changed', handler)
    },
    applyMainOpacityPreview: () => undefined,
    onMainOpacityPreview: () => () => undefined,

    getAuth: async () => {
      const result = await http<{ user: { loginId: string; role: 'super_admin' | 'member' } | null }>(
        'GET',
        '/api/auth/session'
      )
      return result.user
    },
    showDefaultAdminHint: async () => {
      try {
        const result = await http<{ show?: boolean }>('GET', '/api/auth/default-admin-hint')
        return Boolean(result.show)
      } catch {
        return false
      }
    },
    changePassword: async (input) => {
      await http('POST', '/api/auth/password', {
        currentPassword: input.currentPassword,
        nextPassword: input.nextPassword
      })
      return { ok: true as const }
    },
    getSyncInfo: () => http('GET', '/api/sync-info'),
    startWebServer: async () => {
      throw new Error('서버 관리는 Electron 앱에서만 사용할 수 있습니다.')
    },
    stopWebServer: async () => {
      throw new Error('서버 관리는 Electron 앱에서만 사용할 수 있습니다.')
    },
    setWebServerHttps: async () => {
      throw new Error('서버 관리는 Electron 앱에서만 사용할 수 있습니다.')
    },
    regenerateWebServerTls: async () => {
      throw new Error('서버 관리는 Electron 앱에서만 사용할 수 있습니다.')
    },
    exportWebServerCa: async () => {
      throw new Error('서버 관리는 Electron 앱에서만 사용할 수 있습니다.')
    },
    revealWebServerTlsFolder: async () => {
      throw new Error('서버 관리는 Electron 앱에서만 사용할 수 있습니다.')
    },
    allowWebServerFirewall: async () => {
      throw new Error('방화벽 설정은 Electron 앱에서만 사용할 수 있습니다.')
    },
    removeWebServerFirewall: async () => {
      throw new Error('방화벽 설정은 Electron 앱에서만 사용할 수 있습니다.')
    },
    login: async (loginId, password, remember) => {
      try {
        const result = await http<{
          ok: boolean
          user?: { loginId: string; role: 'super_admin' | 'member' }
          token?: string
          error?: string
          locked?: boolean
          retryAfterSec?: number
        }>('POST', '/api/auth/login', {
          loginId,
          password,
          remember: Boolean(remember)
        })
        if (!result.ok || !result.user || !result.token) {
          return {
            ok: false,
            error: result.error ?? '로그인에 실패했습니다.',
            locked: result.locked,
            retryAfterSec: result.retryAfterSec
          }
        }
        setToken(result.token, Boolean(remember))
        // Full reload so toolbar/auth/store state matches Electron after login.
        window.location.reload()
        return { ok: true, user: result.user }
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : '로그인에 실패했습니다.'
        }
      }
    },
    logout: async () => {
      try {
        await http('POST', '/api/auth/logout')
      } finally {
        setToken(null, false)
        dispatchNeoAuthChanged(null)
        await clearOfflineSnapshot().catch(() => {
          /* best-effort */
        })
        await clearOfflineQueue().catch(() => {
          /* best-effort */
        })
      }
    },

    getSettings: async () => {
      const store = await http<CalendarStoreSnapshot>('GET', '/api/store')
      const s = store.settings
      return {
        widget: {
          launchMode: s.widget.launchMode === 'desktop' ? 'desktop' : 'window',
          bounds: { ...s.widget.bounds },
          displayPlacement: s.widget.displayPlacement
            ? { ...s.widget.displayPlacement }
            : null
        },
        weekStartsOn: s.viewOptions.weekStartsOnSunday ? 0 : 1,
        headerOpacity: s.headerOpacity,
        shellOpacity: s.shellOpacity
      }
    },
    patchSettings: async (patch) => {
      await http('PATCH', '/api/settings', {
        headerOpacity: patch.headerOpacity,
        shellOpacity: patch.shellOpacity,
        viewOptions:
          patch.weekStartsOn === undefined
            ? undefined
            : { weekStartsOnSunday: patch.weekStartsOn === 0 },
        widget: patch.widget
      })
      return browserApi.getSettings()
    },

    getCalendarStore: () => http<CalendarStoreSnapshot>('GET', '/api/store'),
    patchStoreSettings: (patch: Partial<StoreSettings>) =>
      http<CalendarStoreSnapshot>('PATCH', '/api/settings', patch),
    replaceCalendarStore: (store) =>
      http<CalendarStoreSnapshot>('POST', '/api/store/import', store),
    importCalendarStore: (payload) =>
      http<CalendarStoreSnapshot>('POST', '/api/store/import', payload),

    exportBackupZip: async () => {
      const { blob, filename, attachmentFiles } = await downloadAuthenticated(
        'GET',
        '/api/backup/export'
      )
      triggerBrowserDownload(blob, filename)
      return { ok: true, cancelled: false, attachmentFiles }
    },
    importBackupZip: async () => {
      const file = await pickSingleFile('.zip,application/zip')
      if (!file) return { ok: true, cancelled: true }
      const form = new FormData()
      form.append('file', file, file.name)
      const result = await httpForm<{
        ok: boolean
        cancelled?: boolean
        attachmentFiles?: number
        store?: CalendarStoreSnapshot
      }>('/api/backup/import', form)
      window.dispatchEvent(new CustomEvent('neo-store-changed'))
      return {
        ok: true,
        cancelled: false,
        attachmentFiles: result.attachmentFiles ?? 0,
        store: result.store
      }
    },
    importBackupZipFromPath: async () => {
      throw new Error('브라우저에서는 파일 선택으로 ZIP을 가져와 주세요.')
    },
    getStoreBackupStatus: async () => {
      const snap = await http<CalendarStoreSnapshot>('GET', '/api/store')
      return {
        config: normalizeStoreBackup(snap.settings.storeBackup),
        running: false,
        last: null,
        archives: []
      }
    },
    saveStoreBackupConfig: async (patch) => {
      const snap = await http<CalendarStoreSnapshot>('PATCH', '/api/settings', {
        storeBackup: patch
      })
      return normalizeStoreBackup(snap.settings.storeBackup)
    },
    runStoreBackupNow: async () => {
      throw new Error('지금 백업은 이 PC의 Neo Desktop Calendar 앱에서만 실행할 수 있습니다.')
    },
    deleteStoreBackup: async () => {
      throw new Error('백업 삭제는 이 PC의 Neo Desktop Calendar 앱에서만 할 수 있습니다.')
    },
    pickStoreBackupDest: async () => null,
    exportCalendarZip: async () => {
      throw new Error('브라우저에서는 전체 ZIP 백업 내보내기를 사용해 주세요.')
    },
    importCalendarZipFromPath: async () => {
      throw new Error('브라우저에서는 JSON·ICS·CSV 가져오기를 사용해 주세요.')
    },
    pickCalendarImportFile: async () => {
      const file = await pickSingleFile(
        '.json,.ics,.csv,.zip,application/json,text/calendar,text/csv,application/zip'
      )
      if (!file) return { cancelled: true as const }
      if (file.name.toLowerCase().endsWith('.zip')) {
        const form = new FormData()
        form.append('file', file, file.name)
        const result = await httpForm<{
          ok: boolean
          attachmentFiles?: number
        }>('/api/backup/import', form)
        window.dispatchEvent(new CustomEvent('neo-store-changed'))
        return {
          cancelled: false as const,
          kind: 'zip-restored' as const,
          filename: file.name,
          attachmentFiles: result.attachmentFiles ?? 0
        }
      }
      const content = await file.text()
      return {
        cancelled: false as const,
        kind: 'text' as const,
        content,
        filename: file.name
      }
    },

    addEvent: (input: EventInput) => http<CalendarEvent>('POST', '/api/events', input),
    editEvent: (id, patch) =>
      http<CalendarEvent>('PUT', `/api/events/${encodeURIComponent(id)}`, patch),
    removeEvent: async (id) => {
      await http('DELETE', `/api/events/${encodeURIComponent(id)}`)
    },
    addEventAttachments: async (eventId) => {
      const files = await pickLocalFiles()
      if (files.length === 0) return findEventOrThrow(eventId)
      const form = new FormData()
      for (const file of files) form.append('files', file, file.name)
      return httpForm<CalendarEvent>(
        `/api/events/${encodeURIComponent(eventId)}/attachments`,
        form
      )
    },
    addEventAttachmentBuffers: async (eventId, uploads) => {
      if (!uploads?.length) return findEventOrThrow(eventId)
      const form = new FormData()
      for (const item of uploads) {
        const bytes = item.data instanceof Uint8Array ? item.data : new Uint8Array(item.data)
        const blob = new Blob([bytes], {
          type: item.mime || 'application/octet-stream'
        })
        form.append('files', blob, item.name || 'clipboard.png')
      }
      return httpForm<CalendarEvent>(
        `/api/events/${encodeURIComponent(eventId)}/attachments`,
        form
      )
    },
    copyEventAttachments: (sourceEventId, targetEventId) =>
      http<CalendarEvent>(
        'POST',
        `/api/events/${encodeURIComponent(targetEventId)}/attachments/copy-from`,
        { sourceEventId }
      ),
    removeEventAttachment: (eventId, attachmentId) =>
      http<CalendarEvent>(
        'DELETE',
        `/api/events/${encodeURIComponent(eventId)}/attachments/${encodeURIComponent(attachmentId)}`
      ),
    openEventAttachment: async (eventId, attachmentId) => {
      const { blob, filename } = await fetchAttachment(eventId, attachmentId)
      const url = URL.createObjectURL(blob)
      try {
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.rel = 'noopener'
        a.target = '_blank'
        document.body.appendChild(a)
        a.click()
        a.remove()
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
      }
    },
    readEventAttachmentImage: async (eventId, attachmentId) => {
      const event = await findEventOrThrow(eventId)
      const attachments = event.attachments ?? []
      const meta = attachments.find((item) => item.id === attachmentId)
      if (!isImageAttachment(meta)) return { ok: false as const, reason: 'not-image' as const }
      const { blob, filename } = await fetchAttachment(eventId, attachmentId)
      // Data URL instead of a blob URL: the page CSP allows `img-src data:` only.
      const dataUrl = await blobToDataUrl(blob)
      return {
        ok: true as const,
        dataUrl,
        name: meta?.name || filename,
        mime: meta?.mime || blob.type || 'image/*',
        images: attachments
          .filter((item) => isImageAttachment(item))
          .map((item) => ({ id: item.id, name: item.name }))
      }
    },

    createCalendar: (input) => http<CalendarRecord>('POST', '/api/calendars', input),
    patchCalendar: (id, patch) =>
      http<CalendarRecord>('PATCH', `/api/calendars/${encodeURIComponent(id)}`, patch),
    reorderCalendars: async (orderedIds) => {
      const result = await http<{ ok: true; calendars: CalendarRecord[] }>(
        'PUT',
        '/api/calendars/reorder',
        { orderedIds }
      )
      return result.calendars
    },
    deleteCalendar: async (id) => {
      await http('DELETE', `/api/calendars/${encodeURIComponent(id)}`)
    },
    clearCalendarEvents: async (id) => {
      await http('DELETE', `/api/calendars/${encodeURIComponent(id)}/events`)
    },
    importEventsIntoCalendar: (id, events) =>
      http('POST', `/api/calendars/${encodeURIComponent(id)}/import`, { events }),

    setTags: (tags: TagRecord[]) => http('PUT', '/api/tags', tags),
    createTag: (input) => http('POST', '/api/tags', input),
    patchTag: (id, patch) => http('PATCH', `/api/tags/${encodeURIComponent(id)}`, patch),
    deleteTag: async (id) => {
      await http('DELETE', `/api/tags/${encodeURIComponent(id)}`)
    },

    listMembers: () => http('GET', '/api/members'),
    saveMembers: (members: MemberSaveInput[]) => http('PUT', '/api/members', members),
    syncHolidays: (input) => http('POST', '/api/holidays/sync', input ?? {}),

    exportCalendar: async (input) => {
      const { blob, filename } = await downloadAuthenticated(
        'POST',
        '/api/export',
        JSON.stringify({
          format: input.format,
          layout: input.layout === 'dayList' ? 'dayList' : 'monthGrid',
          startDate: input.startDate,
          endDate: input.endDate,
          year: input.year,
          month: input.month,
          includeCompleted: input.includeCompleted !== false,
          includeHolidays: input.includeHolidays !== false,
          excludeHiddenCalendars: Boolean(input.excludeHiddenCalendars),
          dayListSortDesc: Boolean(input.dayListSortDesc),
          asAdmin: input.asAdmin !== false
        }),
        'application/json'
      )
      triggerBrowserDownload(blob, filename)
      return { ok: true, path: filename }
    },
    getDataRoot: async () => '',
    openExternal: async (url: string) => {
      window.open(url, '_blank', 'noopener,noreferrer')
    },
    checkForUpdates: async () => {
      const { APP_BUILD_STAMP, APP_VERSION } = await import('../../../shared/constants')
      const {
        RELEASES_LATEST_API,
        RELEASES_PAGE_URL,
        maxBuildStamp,
        parseReleaseTag
      } = await import('../../../shared/updateCheck')
      try {
        const response = await fetch(RELEASES_LATEST_API, {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': `Neo Desktop Calendar/${APP_VERSION}`
          }
        })
        if (!response.ok) {
          return {
            ok: false,
            current: APP_VERSION,
            currentBuildStamp: APP_BUILD_STAMP,
            error: `GitHub 응답 오류 (HTTP ${response.status})`
          }
        }
        const payload = (await response.json()) as {
          tag_name?: string
          html_url?: string
          updated_at?: string
          published_at?: string
          assets?: Array<{ name?: string }>
        }
        const latest = parseReleaseTag(String(payload.tag_name || ''))
        if (!latest) {
          return {
            ok: false,
            current: APP_VERSION,
            currentBuildStamp: APP_BUILD_STAMP,
            error: `릴리스 버전을 해석할 수 없습니다: ${payload.tag_name || '(없음)'}`
          }
        }
        const assetNames = Array.isArray(payload.assets)
          ? payload.assets.map((item) => String(item?.name || ''))
          : []
        return {
          ok: true,
          current: APP_VERSION,
          currentBuildStamp: APP_BUILD_STAMP,
          latest,
          latestBuildStamp: maxBuildStamp(assetNames),
          releaseUpdatedAt:
            String(payload.updated_at || payload.published_at || '').trim() || null,
          releaseUrl: String(payload.html_url || '').trim() || RELEASES_PAGE_URL
        }
      } catch (error) {
        return {
          ok: false,
          current: APP_VERSION,
          currentBuildStamp: APP_BUILD_STAMP,
          error: error instanceof Error ? error.message || '네트워크 오류' : '네트워크 오류'
        }
      }
    }
  }

  window.neoCalendar = browserApi

  // Live refresh when desktop or another tab mutates the store.
  try {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws`)
    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as { type?: string }
        if (msg.type === 'store-changed') {
          window.dispatchEvent(new CustomEvent('neo-store-changed'))
        }
      } catch {
        /* ignore */
      }
    })
  } catch {
    /* ignore */
  }
}
