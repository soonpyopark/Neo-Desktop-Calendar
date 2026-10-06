/** GitHub Releases 업데이트 확인 (공유 타입·버전 헬퍼). */

export const GITHUB_REPO = 'soonpyopark/Neo-Desktop-Calendar'
export const RELEASES_PAGE_URL = `https://github.com/${GITHUB_REPO}/releases`
export const RELEASES_LATEST_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`

/** major.minor.patch (+ 선택적 4번째 빌드 번호, 예: 1.1.8.1). */
const VERSION_RE = /(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?/
/** 릴리스 자산 파일명의 빌드 스탬프: …_YYMMDD_HHMMSS… */
const BUILD_STAMP_RE = /(\d{6}_\d{6})/

/** 빌드 스탬프 비교 시 어떤 OS 자산을 볼지. */
export type UpdatePlatform = 'win32' | 'darwin' | 'linux' | 'browser'

export type UpdateCheckResult = {
  ok: boolean
  current: string
  /** 로컬 패키지 빌드 스탬프 (YYMMDD_HHMMSS). */
  currentBuildStamp?: string
  latest?: string | null
  /**
   * 이 OS에 해당하는 자산 중 가장 최신 빌드 스탬프.
   * Windows: `.msi` / `_portable.zip` · macOS: `_macOS.dmg` / `_macOS.zip`
   */
  latestBuildStamp?: string | null
  /** `latestBuildStamp`를 고를 때 쓴 플랫폼. */
  updatePlatform?: UpdatePlatform | string | null
  /** 릴리스 updated_at (ISO). 참고용 — OS 간 비교에는 쓰지 않음. */
  releaseUpdatedAt?: string | null
  releaseUrl?: string | null
  error?: string | null
  /** UI 문구용: 버전 상승인지, 동일 버전의 새 빌드인지. */
  updateKind?: 'version' | 'build' | null
}

export function versionTuple(text: string): number[] {
  const match = VERSION_RE.exec(text.trim())
  if (!match) return [0]
  return match.slice(1).filter((part): part is string => part != null).map((part) => Number(part))
}

export function parseReleaseTag(tagName: string): string | null {
  const match = VERSION_RE.exec(tagName || '')
  if (!match) return null
  return match.slice(1).filter((part): part is string => part != null).join('.')
}

/** 릴리스 자산·패키지 파일명에서 YYMMDD_HHMMSS 추출. */
export function parseBuildStamp(name: string): string | null {
  const match = BUILD_STAMP_RE.exec(String(name || ''))
  return match?.[1] ?? null
}

export function maxBuildStamp(names: string[]): string | null {
  let best: string | null = null
  for (const name of names) {
    const stamp = parseBuildStamp(name)
    if (!stamp) continue
    if (!best || stamp > best) best = stamp
  }
  return best
}

/** process.platform / UA 토큰을 UpdatePlatform으로 정규화. */
export function normalizeUpdatePlatform(platform: string | null | undefined): UpdatePlatform {
  const raw = String(platform ?? '').trim().toLowerCase()
  if (raw === 'win32' || raw === 'windows') return 'win32'
  if (raw === 'darwin' || raw === 'macos' || raw === 'mac') return 'darwin'
  if (raw === 'browser') return 'browser'
  if (raw === 'linux') return 'linux'
  return 'browser'
}

/**
 * Windows 패키지: `…_YYMMDD_HHMMSS.msi`, `…_YYMMDD_HHMMSS_portable.zip`
 * macOS 패키지: `…_YYMMDD_HHMMSS_macOS.dmg`, `…_YYMMDD_HHMMSS_macOS.zip`
 */
export function isReleaseAssetForPlatform(
  name: string,
  platform: string | null | undefined
): boolean {
  const base = String(name ?? '').trim()
  if (!base) return false
  const lower = base.toLowerCase()
  const isMac = /_macos\.(dmg|zip)$/i.test(base) || lower.endsWith('.dmg')
  const isWin = lower.endsWith('.msi') || /_portable\.zip$/i.test(base)

  switch (normalizeUpdatePlatform(platform)) {
    case 'darwin':
      return isMac
    case 'win32':
      return isWin
    case 'linux':
      return false
    case 'browser':
      // 브라우저 UI는 설치 패키지가 없으므로 스탬프를 만들지 않음.
      return false
    default:
      return false
  }
}

/** 해당 플랫폼 자산만 모아 가장 최신 빌드 스탬프. */
export function maxBuildStampForPlatform(
  names: string[],
  platform: string | null | undefined
): string | null {
  return maxBuildStamp(names.filter((name) => isReleaseAssetForPlatform(name, platform)))
}

/** 버전 튜플 비교: a > b 이면 양수. */
export function compareVersionTuples(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i += 1) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    if (left > right) return 1
    if (left < right) return -1
  }
  return 0
}

/**
 * 원격 버전이 더 높거나, 같은 버전인데 이 OS용 패키지 빌드 스탬프가 더 새것이면 업데이트.
 * (Windows ↔ Windows 자산, macOS ↔ macOS 자산만 비교)
 */
export function isUpdateAvailable(result: UpdateCheckResult): boolean {
  return resolveUpdateKind(result) != null
}

export function resolveUpdateKind(result: UpdateCheckResult): 'version' | 'build' | null {
  if (!result.ok || !result.latest) return null
  const cmp = compareVersionTuples(versionTuple(result.latest), versionTuple(result.current))
  if (cmp > 0) return 'version'
  if (cmp < 0) return null

  const local = String(result.currentBuildStamp || '').trim()
  const remote = String(result.latestBuildStamp || '').trim()
  if (local && remote && remote > local) return 'build'

  // 릴리스 updated_at으로는 판단하지 않음.
  // 다른 OS 자산을 올리면 릴리스 시각만 바뀌어 같은 버전 오탐이 난다.
  return null
}

/** YYMMDD_HHMMSS → epoch ms (연도는 20xx로 가정). */
export function buildStampToMs(stamp: string): number | null {
  const match = /^(\d{2})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/.exec(stamp.trim())
  if (!match) return null
  const year = 2000 + Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const ms = Date.UTC(year, month, day, hour, minute, second)
  return Number.isFinite(ms) ? ms : null
}

export function versionLabel(version: string): string {
  return version.startsWith('v') ? version : `v${version}`
}

export type SkippedUpdateNotice = {
  platform: string
  version: string
  stamp: string
}

/** 시작 알림을 끈 대상(플랫폼·버전·스탬프) 식별. */
export function updateNoticeKey(
  result: UpdateCheckResult,
  platform: string
): SkippedUpdateNotice {
  return {
    platform: String(platform ?? '').trim(),
    version: String(result.latest ?? '').trim(),
    stamp: String(result.latestBuildStamp ?? '').trim()
  }
}

export function isStartupNoticeSkipped(
  skipped: SkippedUpdateNotice | null | undefined,
  result: UpdateCheckResult,
  platform: string
): boolean {
  if (!skipped) return false
  const key = updateNoticeKey(result, platform)
  if (!key.version) return false
  return (
    skipped.platform === key.platform &&
    skipped.version === key.version &&
    skipped.stamp === key.stamp
  )
}
