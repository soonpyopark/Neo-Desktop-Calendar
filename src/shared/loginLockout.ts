export const LOGIN_LOCKOUT_MAX_FAILURES = 3
export const LOGIN_LOCKOUT_MS = 5 * 60 * 1000

export function normalizeLoginLockoutEnabled(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true'
}

export function formatLoginLockoutMessage(retryAfterSec?: number): string {
  const sec = Number(retryAfterSec)
  const minutes = Math.max(
    1,
    Math.ceil((Number.isFinite(sec) && sec > 0 ? sec : LOGIN_LOCKOUT_MS / 1000) / 60)
  )
  return `로그인이 일시적으로 제한되었습니다. ${minutes}분 후 다시 시도해 주세요.`
}
