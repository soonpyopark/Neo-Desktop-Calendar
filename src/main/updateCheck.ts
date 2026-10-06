import { APP_BUILD_STAMP, APP_NAME, APP_VERSION } from '../shared/constants'
import {
  RELEASES_LATEST_API,
  RELEASES_PAGE_URL,
  maxBuildStampForPlatform,
  normalizeUpdatePlatform,
  parseReleaseTag,
  type UpdateCheckResult
} from '../shared/updateCheck'

const USER_AGENT = `${APP_NAME}/${APP_VERSION}`

/** GitHub latest 릴리스를 조회하고, 이 OS용 자산 스탬프만 골라 비교 결과를 만든다. */
export async function fetchLatestRelease(timeoutMs = 12_000): Promise<UpdateCheckResult> {
  const current = APP_VERSION
  const currentBuildStamp = APP_BUILD_STAMP
  const updatePlatform = normalizeUpdatePlatform(process.platform)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(RELEASES_LATEST_API, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': USER_AGENT,
        'X-GitHub-Api-Version': '2022-11-28'
      },
      signal: controller.signal
    })

    if (!response.ok) {
      return {
        ok: false,
        current,
        currentBuildStamp,
        updatePlatform,
        error: `GitHub 응답 오류 (HTTP ${response.status})`
      }
    }

    const payload = (await response.json()) as {
      tag_name?: unknown
      html_url?: unknown
      updated_at?: unknown
      published_at?: unknown
      assets?: Array<{ name?: unknown }>
    }
    const tagName = String(payload.tag_name || '')
    const latest = parseReleaseTag(tagName)
    if (!latest) {
      return {
        ok: false,
        current,
        currentBuildStamp,
        updatePlatform,
        error: `릴리스 버전을 해석할 수 없습니다: ${tagName || '(없음)'}`
      }
    }

    const assetNames = Array.isArray(payload.assets)
      ? payload.assets.map((item) => String(item?.name || ''))
      : []
    const latestBuildStamp = maxBuildStampForPlatform(assetNames, updatePlatform)
    const releaseUpdatedAt =
      String(payload.updated_at || payload.published_at || '').trim() || null
    const htmlUrl = String(payload.html_url || '').trim() || RELEASES_PAGE_URL

    return {
      ok: true,
      current,
      currentBuildStamp,
      latest,
      latestBuildStamp,
      updatePlatform,
      releaseUpdatedAt,
      releaseUrl: htmlUrl
    }
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? '네트워크 오류 (시간 초과)'
        : error instanceof Error
          ? error.message || '네트워크 오류'
          : '네트워크 오류'
    return {
      ok: false,
      current,
      currentBuildStamp,
      updatePlatform,
      error: message
    }
  } finally {
    clearTimeout(timer)
  }
}
