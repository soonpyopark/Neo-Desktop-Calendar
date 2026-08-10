import { APP_BUILD_STAMP, APP_NAME, APP_VERSION } from '../shared/constants'
import {
  RELEASES_LATEST_API,
  RELEASES_PAGE_URL,
  maxBuildStamp,
  parseReleaseTag,
  type UpdateCheckResult
} from '../shared/updateCheck'

const USER_AGENT = `${APP_NAME}/${APP_VERSION}`

export async function fetchLatestRelease(timeoutMs = 12_000): Promise<UpdateCheckResult> {
  const current = APP_VERSION
  const currentBuildStamp = APP_BUILD_STAMP
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
        error: `릴리스 버전을 해석할 수 없습니다: ${tagName || '(없음)'}`
      }
    }

    const assetNames = Array.isArray(payload.assets)
      ? payload.assets.map((item) => String(item?.name || ''))
      : []
    const latestBuildStamp = maxBuildStamp(assetNames)
    const releaseUpdatedAt =
      String(payload.updated_at || payload.published_at || '').trim() || null
    const htmlUrl = String(payload.html_url || '').trim() || RELEASES_PAGE_URL

    return {
      ok: true,
      current,
      currentBuildStamp,
      latest,
      latestBuildStamp,
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
      error: message
    }
  } finally {
    clearTimeout(timer)
  }
}
