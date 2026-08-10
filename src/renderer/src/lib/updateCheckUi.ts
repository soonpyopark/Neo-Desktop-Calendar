import type { UpdateCheckResult } from '../../../shared/updateCheck'
import {
  RELEASES_PAGE_URL,
  isUpdateAvailable,
  resolveUpdateKind,
  versionLabel
} from '../../../shared/updateCheck'

type DialogApi = {
  alert: (
    message: string,
    options?: { title?: string; confirmLabel?: string }
  ) => Promise<void>
  confirm: (
    message: string,
    options?: { title?: string; confirmLabel?: string; cancelLabel?: string }
  ) => Promise<boolean>
}

/**
 * Tiny PDF Editor–style result UI via AppDialog (help panel / in-app).
 */
export async function presentUpdateCheckResult(
  result: UpdateCheckResult,
  dialog: DialogApi
): Promise<void> {
  const title = '업데이트 확인'
  const current = versionLabel(result.current)
  const currentHint = result.currentBuildStamp
    ? `${current} (${result.currentBuildStamp})`
    : current

  if (!result.ok) {
    const open = await dialog.confirm(
      `업데이트 정보를 확인할 수 없습니다.\n\n${result.error || '알 수 없는 오류'}\n\n현재 버전: ${current}`,
      {
        title,
        confirmLabel: '릴리스 페이지 열기',
        cancelLabel: '닫기'
      }
    )
    if (open) {
      await window.neoCalendar?.openExternal?.(RELEASES_PAGE_URL)
    }
    return
  }

  if (isUpdateAvailable(result)) {
    const kind = resolveUpdateKind(result)
    const latest = versionLabel(result.latest || '')
    const stampHint =
      kind === 'build' && result.latestBuildStamp
        ? `\n최신 빌드: ${result.latestBuildStamp}`
        : ''
    const message =
      kind === 'build'
        ? `같은 버전의 새 빌드가 있습니다: ${latest}\n\n현재 버전: ${currentHint}${stampHint}`
        : `새 버전이 있습니다: ${latest}\n\n현재 버전: ${currentHint}`
    const open = await dialog.confirm(message, {
      title,
      confirmLabel: '다운로드',
      cancelLabel: '나중에'
    })
    if (open) {
      await window.neoCalendar?.openExternal?.(result.releaseUrl || RELEASES_PAGE_URL)
    }
    return
  }

  await dialog.alert(`최신 버전입니다.\n\n현재 버전: ${currentHint}`, { title })
}

/** Run GitHub Releases check then show the result dialog. */
export async function runUpdateCheck(dialog: DialogApi): Promise<void> {
  const api = window.neoCalendar
  if (!api?.checkForUpdates) {
    await dialog.alert('업데이트 확인을 사용할 수 없습니다.', { title: '업데이트 확인' })
    return
  }
  const result = await api.checkForUpdates()
  await presentUpdateCheckResult(result, dialog)
}
