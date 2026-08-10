/** GitHub Releases update check (shared types + version helpers). */

export const GITHUB_REPO = 'soonpyopark/Neo-Desktop-Calendar'
export const RELEASES_PAGE_URL = `https://github.com/${GITHUB_REPO}/releases`
export const RELEASES_LATEST_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`

/** major.minor.patch with optional 4th build (e.g. 1.1.8.1). */
const VERSION_RE = /(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?/
/** MSI/portable build id embedded in asset names: …_YYMMDD_HHMMSS(.msi|_portable.zip) */
const BUILD_STAMP_RE = /(\d{6}_\d{6})/

export type UpdateCheckResult = {
  ok: boolean
  current: string
  /** Local MSI/portable build stamp (YYMMDD_HHMMSS). */
  currentBuildStamp?: string
  latest?: string | null
  /** Newest parseable build stamp on the latest GitHub release assets. */
  latestBuildStamp?: string | null
  /** GitHub release updated_at (ISO) — fallback when assets lack stamps. */
  releaseUpdatedAt?: string | null
  releaseUrl?: string | null
  error?: string | null
  /** Why an update is offered (UI copy). */
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

/** Extract YYMMDD_HHMMSS from a release asset / package file name. */
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

/** Compare semver-like tuples: positive if a > b. */
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
 * Update if remote version is newer, or same version with a newer package build stamp
 * (same tag / MSI-only republish — approach C).
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

  // Fallback: same version, no asset stamps — use release updated_at vs local stamp time.
  if (local && result.releaseUpdatedAt && !remote) {
    const localAt = buildStampToMs(local)
    const remoteAt = Date.parse(result.releaseUpdatedAt)
    if (localAt != null && Number.isFinite(remoteAt) && remoteAt > localAt) return 'build'
  }
  return null
}

/** YYMMDD_HHMMSS → epoch ms (assume 20xx). */
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
