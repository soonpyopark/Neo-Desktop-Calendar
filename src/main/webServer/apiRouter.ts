import type { IncomingMessage } from 'node:http'
import type { AuthService } from '../auth'
import type { CalendarStore } from '../calendarStore/CalendarStore'
import type { MembersStore } from '../calendarStore/membersStore'
import type { EventInput, MemberSaveInput, SyncHolidaysInput, TagRecord } from '../../shared/calendarTypes'
import type { AuthUser } from '../../shared/ipc'
import {
  can,
  isSuperAdminUser,
  stripMemberAdminSettingsPatch,
  type AppCapability
} from '../../shared/members'
import { stripBrowserShellSettingsPatch } from '../../shared/viewOptionsBySurface'
import { syncKoreanHolidays } from '../calendarStore/holidaySync'
import { resolveAdminCredentials } from '../dotEnv'

export type ApiRouterDeps = {
  auth: AuthService
  calendarStore: CalendarStore
  membersStore: MembersStore
  getSyncInfo: () => Record<string, unknown>
  onStoreMutated: () => void
}

export type ApiResult = {
  status: number
  body: unknown
}

function jsonError(status: number, message: string): ApiResult {
  return { status, body: { ok: false, error: message } }
}

function requireUser(
  auth: AuthService,
  token: string | null
): ApiResult | { user: AuthUser } {
  const user = auth.getBrowserUser(token)
  if (!user) return jsonError(401, '로그인이 필요합니다.')
  return { user }
}

function requireCap(
  user: AuthUser,
  capability: AppCapability
): ApiResult | null {
  if (!can(user, capability)) return jsonError(403, '권한이 없습니다.')
  return null
}

/**
 * MDC-style /api router over CalendarStore (desktop-only routes rejected).
 */
export async function handleApiRequest(
  deps: ApiRouterDeps,
  method: string,
  path: string,
  body: unknown,
  token: string | null,
  req: IncomingMessage
): Promise<ApiResult> {
  const { auth, calendarStore, membersStore, getSyncInfo, onStoreMutated } =
    deps
  const m = method.toUpperCase()
  const p = path.split('?')[0]

  if (p === '/api/health' && m === 'GET') {
    return { status: 200, body: { ok: true } }
  }

  if (p === '/api/sync-info' && m === 'GET') {
    return { status: 200, body: getSyncInfo() }
  }

  if (p === '/api/auth/session' && m === 'GET') {
    const user = auth.getBrowserUser(token)
    return { status: 200, body: { user } }
  }

  if (p === '/api/auth/default-admin-hint' && m === 'GET') {
    return {
      status: 200,
      body: { show: membersStore.isDefaultAdminPasswordActive() }
    }
  }

  if (p === '/api/auth/login' && m === 'POST') {
    const payload = (body ?? {}) as { loginId?: string; password?: string; remember?: boolean }
    const proxied = Boolean(req.headers['x-forwarded-for'] || req.headers['x-real-ip'])
    const result = auth.loginBrowser(
      String(payload.loginId ?? ''),
      String(payload.password ?? ''),
      Boolean(payload.remember),
      {
        clientIp: req.socket.remoteAddress ?? '',
        proxied
      }
    )
    if (!result.ok) return { status: 401, body: result }
    onStoreMutated()
    return { status: 200, body: result }
  }

  if (p === '/api/auth/logout' && m === 'POST') {
    auth.logoutBrowser(token)
    return { status: 200, body: { ok: true } }
  }

  if (p === '/api/auth/password' && m === 'POST') {
    const gatePw = requireUser(auth, token)
    if ('status' in gatePw) return gatePw
    const payload = (body ?? {}) as { currentPassword?: string; nextPassword?: string }
    const result = membersStore.changeOwnPassword(
      gatePw.user.loginId,
      String(payload.currentPassword ?? ''),
      String(payload.nextPassword ?? '')
    )
    if (!result.ok) return jsonError(400, result.error)
    return { status: 200, body: { ok: true } }
  }

  // —— Authenticated routes ——
  const gate = requireUser(auth, token)
  if ('status' in gate) return gate
  const user = gate.user
  const loginId = user.loginId
  const asSuperAdmin = isSuperAdminUser(user)
  const snapshot = () => calendarStore.getSnapshotForLogin(loginId, 'browser', asSuperAdmin)

  if (p === '/api/store' && m === 'GET') {
    return { status: 200, body: snapshot() }
  }

  if (p === '/api/settings' && m === 'PATCH') {
    let patch = stripBrowserShellSettingsPatch((body ?? {}) as never)
    if (!asSuperAdmin) {
      patch = stripMemberAdminSettingsPatch(patch as Record<string, unknown>) as typeof patch
    }
    // dayColors are stored per login (dayColorsByLoginId), matching Electron IPC.
    // Presentation prefs go to viewOptionsBySurface.browser — not native.
    calendarStore.patchStoreSettings(patch as never, loginId, 'browser')
    onStoreMutated()
    return { status: 200, body: snapshot() }
  }

  if (p === '/api/store/import' && m === 'POST') {
    const denied = requireCap(user, 'importExportStore')
    if (denied) return denied
    calendarStore.importStore(body, loginId)
    onStoreMutated()
    return { status: 200, body: snapshot() }
  }

  if (p === '/api/events' && m === 'POST') {
    const input = body as EventInput
    const created = calendarStore.addEvent({
      ...input,
      createdBy: loginId,
      ownerLoginId: input.ownerLoginId ?? loginId
    })
    onStoreMutated()
    return { status: 200, body: created }
  }

  const eventMatch = p.match(/^\/api\/events\/([^/]+)$/)
  if (eventMatch) {
    const id = decodeURIComponent(eventMatch[1])
    if (m === 'PUT' || m === 'PATCH') {
      const updated = calendarStore.editEvent(id, (body ?? {}) as never)
      onStoreMutated()
      return { status: 200, body: updated }
    }
    if (m === 'DELETE') {
      calendarStore.removeEvent(id)
      onStoreMutated()
      return { status: 200, body: { ok: true } }
    }
  }

  if (p === '/api/calendars' && m === 'POST') {
    const input = (body ?? {}) as Partial<{
      name: string
      color: string
      ownerLoginId: string
      ownerName: string
    }> &
      Record<string, unknown>
    const name = typeof input.name === 'string' ? input.name : ''
    const color = typeof input.color === 'string' ? input.color : '#64748b'
    const created = calendarStore.createCalendar({
      ...input,
      name,
      color,
      ownerLoginId: input.ownerLoginId || loginId,
      ownerName: input.ownerName || loginId
    })
    const adminId = resolveAdminCredentials().id
    calendarStore.hideNewMemberCalendarForAdmin(created, adminId)
    onStoreMutated()
    const projected = snapshot().calendars.find((c) => c.id === created.id)
    return { status: 200, body: projected ?? created }
  }

  // Must be before /api/calendars/:id — otherwise "reorder" is treated as an id.
  if (p === '/api/calendars/reorder' && m === 'PUT') {
    const payload = (body ?? {}) as { orderedIds?: unknown }
    const orderedIds = Array.isArray(payload.orderedIds)
      ? payload.orderedIds.map((id) => String(id ?? '').trim()).filter(Boolean)
      : []
    if (orderedIds.length === 0) return jsonError(400, 'orderedIds가 필요합니다.')
    const calendars = calendarStore.reorderCalendars(orderedIds)
    onStoreMutated()
    return { status: 200, body: { ok: true, calendars } }
  }

  const calMatch = p.match(/^\/api\/calendars\/([^/]+)(?:\/(events|import))?$/)
  if (calMatch) {
    const id = decodeURIComponent(calMatch[1])
    const sub = calMatch[2]
    if (!sub && (m === 'PATCH' || m === 'PUT')) {
      const bodyObj = { ...((body ?? {}) as Record<string, unknown>) }
      if (Object.prototype.hasOwnProperty.call(bodyObj, 'visible')) {
        const wantVisible = bodyObj.visible !== false
        calendarStore.setCalendarHiddenForLogin(loginId, id, !wantVisible)
        delete bodyObj.visible
      }
      const updated =
        Object.keys(bodyObj).length > 0
          ? calendarStore.patchCalendar(id, bodyObj as never)
          : calendarStore.getSnapshot().calendars.find((c) => c.id === id)
      if (!updated) return jsonError(404, '캘린더를 찾을 수 없습니다.')
      onStoreMutated()
      const projected = snapshot().calendars.find((c) => c.id === id)
      return { status: 200, body: projected ?? updated }
    }
    if (!sub && m === 'DELETE') {
      calendarStore.deleteCalendar(id)
      onStoreMutated()
      return { status: 200, body: { ok: true } }
    }
    if (sub === 'events' && m === 'DELETE') {
      calendarStore.clearCalendarEvents(id)
      onStoreMutated()
      return { status: 200, body: { ok: true } }
    }
    if (sub === 'import' && m === 'POST') {
      const events = Array.isArray(body)
        ? body
        : Array.isArray((body as { events?: unknown[] })?.events)
          ? (body as { events: unknown[] }).events
          : []
      const result = calendarStore.importEventsIntoCalendar(id, events, loginId)
      onStoreMutated()
      return { status: 200, body: result }
    }
  }

  if (p === '/api/tags' && m === 'POST') {
    const input = body as { name: string; color: string; sortOrder?: number }
    const created = calendarStore.createTag(input)
    onStoreMutated()
    return { status: 200, body: created }
  }

  if (p === '/api/tags' && (m === 'PUT' || m === 'PATCH')) {
    // Bulk replace if array
    if (Array.isArray(body)) {
      const next = calendarStore.setTags(body as TagRecord[])
      onStoreMutated()
      return { status: 200, body: next }
    }
  }

  const tagMatch = p.match(/^\/api\/tags\/([^/]+)$/)
  if (tagMatch) {
    const id = decodeURIComponent(tagMatch[1])
    if (m === 'PATCH' || m === 'PUT') {
      const updated = calendarStore.patchTag(id, (body ?? {}) as never)
      onStoreMutated()
      return { status: 200, body: updated }
    }
    if (m === 'DELETE') {
      calendarStore.deleteTag(id)
      onStoreMutated()
      return { status: 200, body: { ok: true } }
    }
  }

  if (p === '/api/members' && m === 'GET') {
    const denied = requireCap(user, 'manageMembers')
    if (denied) return denied
    return { status: 200, body: membersStore.listPublic() }
  }

  if (p === '/api/members' && m === 'PUT') {
    const denied = requireCap(user, 'manageMembers')
    if (denied) return denied
    const members = Array.isArray(body)
      ? (body as MemberSaveInput[])
      : Array.isArray((body as { members?: MemberSaveInput[] })?.members)
        ? (body as { members: MemberSaveInput[] }).members
        : []
    const result = membersStore.saveMembers(members)
    for (const deleted of result.deletedLoginIds) {
      try {
        calendarStore.purgeMemberOwnedData(deleted)
        auth.revokeSessionsForLoginId(deleted)
      } catch {
        /* ignore */
      }
    }
    const adminId = user.loginId || resolveAdminCredentials().id
    for (const member of result.members) {
      if (member.active === false) continue
      const mid = String(member.loginId ?? '').trim()
      if (!mid) continue
      try {
        calendarStore.ensurePersonalCalendar(mid, member.displayName, adminId)
      } catch {
        /* ignore */
      }
    }
    onStoreMutated()
    return { status: 200, body: result.members }
  }

  if (p === '/api/holidays/sync' && m === 'POST') {
    const denied = requireCap(user, 'syncHolidays')
    if (denied) return denied
    try {
      const result = await syncKoreanHolidays(
        calendarStore,
        (body ?? {}) as SyncHolidaysInput
      )
      onStoreMutated()
      return { status: 200, body: result }
    } catch (err) {
      const message = err instanceof Error ? err.message : '휴일 동기화에 실패했습니다.'
      return jsonError(400, message)
    }
  }

  if (p.startsWith('/api/desktop') || p.startsWith('/api/window') || p.startsWith('/api/widget')) {
    return jsonError(401, '데스크톱 전용 API입니다.')
  }

  return jsonError(404, `Unknown API: ${m} ${p}`)
}
