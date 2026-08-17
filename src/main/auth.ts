import { randomBytes } from 'node:crypto'
import type { AuthUser, LoginResult } from '../shared/ipc'
import {
  formatLoginLockoutMessage,
  LOGIN_LOCKOUT_MAX_FAILURES,
  LOGIN_LOCKOUT_MS
} from '../shared/loginLockout'
import {
  authUserFromMember,
  can,
  isSuperAdminUser,
  type AppCapability
} from '../shared/members'
import type { MembersStore } from './calendarStore/membersStore'
import type { SettingsStore } from './settingsStore'
import { resolveAdminCredentials } from './dotEnv'
import { normalizeClientIp } from './webServer/ipAccess'

export type BrowserLoginResult =
  | { ok: true; user: AuthUser; token: string }
  | { ok: false; error: string; locked?: boolean; retryAfterSec?: number }

export type LoginAttemptContext = {
  clientIp?: string | null
  proxied?: boolean
}

type LoginAttemptState = { failCount: number; lockedUntil: number | null }

const loginAttempts = new Map<string, LoginAttemptState>()

function normalizeLoginAttemptKey(id: string): string {
  return String(id ?? '').trim().toLowerCase()
}

/** Direct 127.0.0.1 only. Proxied requests are not exempt. */
function isLoginLockoutExempt(
  clientIp: string | null | undefined,
  proxied = false
): boolean {
  if (proxied) return false
  return normalizeClientIp(clientIp ?? '') === '127.0.0.1'
}

function getLoginAttemptState(key: string): LoginAttemptState | null {
  const state = loginAttempts.get(key)
  if (!state) return null
  if (state.lockedUntil && state.lockedUntil <= Date.now()) {
    loginAttempts.delete(key)
    return null
  }
  return state
}

function lockedLoginResult(state: LoginAttemptState): {
  ok: false
  error: string
  locked: true
  retryAfterSec: number
} {
  const remainingMs = (state.lockedUntil ?? 0) - Date.now()
  const retryAfterSec = Math.max(1, Math.ceil(remainingMs / 1000))
  return {
    ok: false,
    error: formatLoginLockoutMessage(retryAfterSec),
    locked: true,
    retryAfterSec
  }
}

function recordLoginFailure(key: string): LoginAttemptState {
  const now = Date.now()
  const state = getLoginAttemptState(key) ?? { failCount: 0, lockedUntil: null }
  if (state.lockedUntil && state.lockedUntil > now) return state
  state.failCount += 1
  if (state.failCount >= LOGIN_LOCKOUT_MAX_FAILURES) {
    state.lockedUntil = now + LOGIN_LOCKOUT_MS
  }
  loginAttempts.set(key, state)
  return state
}

/**
 * Desktop shell keeps a single IPC session; browser HTTP uses a separate token map
 * (MDC: shell login does not steal browser Bearer sessions).
 */
export class AuthService {
  private sessionToken: string | null = null
  private sessionUser: AuthUser | null = null
  private readonly browserSessions = new Map<string, AuthUser>()

  constructor(
    private readonly store: SettingsStore,
    private readonly members: MembersStore,
    private readonly options: {
      isLoginLockoutEnabled?: () => boolean
    } = {}
  ) {
    const saved = store.getAuthSession()
    if (saved) {
      this.sessionToken = saved.token
      this.sessionUser = this.resolveUserByLoginId(saved.loginId)
    }
  }

  getUser(): AuthUser | null {
    if (!this.sessionUser) return null
    // Re-resolve role so demotions apply without re-login when possible.
    const fresh = this.resolveUserByLoginId(this.sessionUser.loginId)
    if (!fresh) {
      this.logout()
      return null
    }
    this.sessionUser = fresh
    return { ...fresh }
  }

  isSuperAdmin(): boolean {
    return isSuperAdminUser(this.getUser())
  }

  requireCapability(capability: AppCapability): AuthUser {
    const user = this.getUser()
    if (!user) throw new Error('로그인이 필요합니다.')
    if (!can(user, capability)) {
      throw new Error('권한이 없습니다.')
    }
    return user
  }

  login(loginId: string, password: string, remember = false): LoginResult {
    const member = this.authenticate(loginId, password, {
      clientIp: '127.0.0.1',
      proxied: false
    })
    if (!member.ok) return member

    const user = member.user
    this.sessionUser = user
    this.sessionToken = randomBytes(24).toString('hex')

    if (remember) {
      this.store.setAuthSession({ token: this.sessionToken, loginId: user.loginId })
    } else {
      this.store.setAuthSession(null)
    }

    return { ok: true, user }
  }

  /** HTTP/browser login — returns Bearer token (separate from shell session). */
  loginBrowser(
    loginId: string,
    password: string,
    remember = false,
    context: LoginAttemptContext = {}
  ): BrowserLoginResult {
    const member = this.authenticate(loginId, password, context)
    if (!member.ok) return member

    const token = randomBytes(24).toString('hex')
    this.browserSessions.set(token, member.user)
    if (remember) {
      // Persist browser token alongside shell format for cold start convenience.
      this.store.setAuthSession({ token, loginId: member.user.loginId })
    } else {
      this.store.setAuthSession(null)
    }
    return { ok: true, user: member.user, token }
  }

  logout(): void {
    this.sessionToken = null
    this.sessionUser = null
    this.store.setAuthSession(null)
  }

  logoutBrowser(token: string | null | undefined): void {
    const t = String(token ?? '').trim()
    if (!t) return
    this.browserSessions.delete(t)
    const saved = this.store.getAuthSession()
    if (saved?.token === t) this.store.setAuthSession(null)
  }

  getBrowserUser(token: string | null | undefined): AuthUser | null {
    const t = String(token ?? '').trim()
    if (!t) return null
    const cached = this.browserSessions.get(t)
    if (cached) {
      const fresh = this.resolveUserByLoginId(cached.loginId)
      if (!fresh) {
        this.browserSessions.delete(t)
        return null
      }
      this.browserSessions.set(t, fresh)
      return { ...fresh }
    }
    // Accept persisted token from previous run (restore into map).
    const saved = this.store.getAuthSession()
    if (saved?.token === t && saved.loginId) {
      const restored = this.resolveUserByLoginId(saved.loginId)
      if (!restored) return null
      this.browserSessions.set(t, restored)
      return { ...restored }
    }
    return null
  }

  requireBrowserCapability(
    token: string | null | undefined,
    capability: AppCapability
  ): AuthUser {
    const user = this.getBrowserUser(token)
    if (!user) throw new Error('로그인이 필요합니다.')
    if (!can(user, capability)) {
      throw new Error('권한이 없습니다.')
    }
    return user
  }

  isBrowserTokenValid(token: string | null | undefined): boolean {
    return this.getBrowserUser(token) !== null
  }

  revokeSessionsForLoginId(loginId: string): void {
    const target = loginId.trim().toLowerCase()
    if (!target) return
    for (const [token, user] of this.browserSessions) {
      if (user.loginId.toLowerCase() === target) this.browserSessions.delete(token)
    }
    if (this.sessionUser?.loginId.toLowerCase() === target) {
      this.logout()
    }
  }

  static extractToken(
    authorizationHeader: string | null | undefined,
    adminTokenHeader?: string | null
  ): string | null {
    const auth = String(authorizationHeader ?? '').trim()
    if (auth.toLowerCase().startsWith('bearer ')) {
      return auth.slice(7).trim() || null
    }
    const admin = String(adminTokenHeader ?? '').trim()
    return admin || null
  }

  private resolveUserByLoginId(loginId: string | null | undefined): AuthUser | null {
    const member = this.members.findActiveByLoginId(loginId)
    if (member) return authUserFromMember(member)
    const id = String(loginId ?? '').trim()
    if (!id) return null
    // Safety net: env bootstrap admin id without a members.json row.
    if (id === resolveAdminCredentials().id) {
      return { loginId: id, role: 'super_admin' }
    }
    return null
  }

  private authenticate(
    loginId: string,
    password: string,
    context: LoginAttemptContext = {}
  ): { ok: true; user: AuthUser } | Extract<LoginResult, { ok: false }> {
    const id = String(loginId ?? '').trim()
    const pw = String(password ?? '')
    if (!id || !pw) {
      return { ok: false, error: '아이디와 비밀번호를 입력하세요.' }
    }

    const attemptKey = normalizeLoginAttemptKey(id)
    const lockoutEnabled = this.options.isLoginLockoutEnabled?.() === true
    const enforceLockout =
      lockoutEnabled &&
      Boolean(attemptKey) &&
      !isLoginLockoutExempt(context.clientIp, Boolean(context.proxied))

    if (enforceLockout) {
      const locked = getLoginAttemptState(attemptKey)
      if (locked?.lockedUntil && locked.lockedUntil > Date.now()) {
        return lockedLoginResult(locked)
      }
    }

    const member = this.members.verifyLogin(id, pw)
    if (member) {
      if (attemptKey) loginAttempts.delete(attemptKey)
      return { ok: true, user: authUserFromMember(member) }
    }

    if (enforceLockout) {
      const state = recordLoginFailure(attemptKey)
      if (state.lockedUntil && state.lockedUntil > Date.now()) {
        return lockedLoginResult(state)
      }
    }

    return { ok: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' }
  }
}
