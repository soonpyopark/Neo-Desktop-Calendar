import type { MemberRole } from './calendarTypes'

/** Fixed id of the seeded .env bootstrap admin row. */
export const BOOTSTRAP_ADMIN_MEMBER_ID = 'member-bootstrap-admin'

/** Session role used by AuthUser / capability checks. */
export type AuthUserRole = 'super_admin' | 'member'

export type AuthUserLike = {
  loginId: string
  role: AuthUserRole
}

export type AppCapability =
  | 'manageMembers'
  | 'manageMemberCalendars'
  | 'manageSecurity'
  | 'manageWebServer'
  | 'syncHolidays'
  | 'backupStore'
  | 'importExportStore'

const SUPER_ADMIN_CAPABILITIES = new Set<AppCapability>([
  'manageMembers',
  'manageMemberCalendars',
  'manageSecurity',
  'manageWebServer',
  'syncHolidays',
  'backupStore',
  'importExportStore'
])

export function isBootstrapAdminMember(
  member: { id?: string; isBootstrapAdmin?: boolean } | null | undefined
): boolean {
  if (!member) return false
  if (member.isBootstrapAdmin === true) return true
  return member.id === BOOTSTRAP_ADMIN_MEMBER_ID
}

export function memberRoleToLabel(role: MemberRole | string | undefined): string {
  return role === 'super_admin' || role === 'admin' ? '총괄관리자' : '일반사용자'
}

export function defaultMemberPassword(loginId: string): string {
  return `${String(loginId ?? '').trim()}!!`
}

export function normalizeMemberRole(value: unknown): AuthUserRole {
  return value === 'super_admin' || value === 'admin' ? 'super_admin' : 'member'
}

export function authUserFromMember(member: {
  loginId: string
  role?: MemberRole | string | null
}): AuthUserLike {
  return {
    loginId: String(member.loginId ?? '').trim(),
    role: normalizeMemberRole(member.role)
  }
}

export function isSuperAdminUser(user: AuthUserLike | null | undefined): boolean {
  return Boolean(user && user.role === 'super_admin')
}

export function can(
  user: AuthUserLike | null | undefined,
  capability: AppCapability
): boolean {
  if (!user) return false
  if (user.role === 'super_admin') return SUPER_ADMIN_CAPABILITIES.has(capability)
  return false
}

/** Settings keys that non-admins must not write. */
export function stripMemberAdminSettingsPatch<T extends Record<string, unknown>>(
  patch: T
): T {
  const next = { ...patch } as T & {
    allowedIpCidrs?: unknown
    holidaysKr?: Record<string, unknown>
    webServerPort?: unknown
    webServerMode?: unknown
    httpsEnabled?: unknown
    loginLockoutEnabled?: unknown
  }
  delete next.allowedIpCidrs
  delete next.webServerPort
  delete next.webServerMode
  delete next.httpsEnabled
  delete next.loginLockoutEnabled
  if (next.holidaysKr && typeof next.holidaysKr === 'object') {
    const holidays = { ...next.holidaysKr }
    delete holidays.serviceKey
    next.holidaysKr = holidays
  }
  return next
}
