import type { UpdateCheckResult, SkippedUpdateNotice } from '../../../shared/updateCheck'
import {
  RELEASES_PAGE_URL,
  isStartupNoticeSkipped,
  isUpdateAvailable,
  resolveUpdateKind,
  updateNoticeKey,
  versionLabel
} from '../../../shared/updateCheck'
import { isBrowserNeoCalendarHost } from './browserNeoCalendar'
import type { DialogChoice } from '../components/AppDialogProvider'

const SKIPPED_UPDATE_KEY = 'neo-calendar-skipped-update'

type DialogApi = {
  alert: (
    message: string,
    options?: { title?: string; confirmLabel?: string }
  ) => Promise<void>
  confirm: (
    message: string,
    options?: { title?: string; confirmLabel?: string; cancelLabel?: string }
  ) => Promise<boolean>
  choice?: (
    message: string,
    options: {
      title?: string
      confirmLabel?: string
      cancelLabel?: string
      extraLabel: string
    }
  ) => Promise<DialogChoice>
}

/**
 * Tiny PDF Editor와 같은 결과 UI (앱 안 대화상자 / 도움말).
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

function runtimeUpdatePlatform(): string {
  if (isBrowserNeoCalendarHost()) return 'browser'
  const ua = navigator.userAgent
  if (/Windows/i.test(ua)) return 'win32'
  if (/Mac OS X|Macintosh/i.test(ua)) return 'darwin'
  return 'linux'
}

function readSkippedUpdate(): SkippedUpdateNotice | null {
  try {
    const raw = localStorage.getItem(SKIPPED_UPDATE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SkippedUpdateNotice>
    const platform = String(parsed.platform ?? '').trim()
    const version = String(parsed.version ?? '').trim()
    if (!platform || !version) return null
    return {
      platform,
      version,
      stamp: String(parsed.stamp ?? '').trim()
    }
  } catch {
    return null
  }
}

function writeSkippedUpdate(notice: SkippedUpdateNotice): void {
  try {
    localStorage.setItem(SKIPPED_UPDATE_KEY, JSON.stringify(notice))
  } catch {
    /* ignore quota / private mode */
  }
}

function availableUpdateMessage(result: UpdateCheckResult): string {
  const current = versionLabel(result.current)
  const currentHint = result.currentBuildStamp
    ? `${current} (${result.currentBuildStamp})`
    : current
  const kind = resolveUpdateKind(result)
  const latest = versionLabel(result.latest || '')
  const stampHint =
    kind === 'build' && result.latestBuildStamp
      ? `\n최신 빌드: ${result.latestBuildStamp}`
      : ''
  if (kind === 'build') {
    return `같은 버전의 새 빌드가 있습니다: ${latest}\n\n현재 버전: ${currentHint}${stampHint}`
  }
  return `새 버전이 있습니다: ${latest}\n\n현재 버전: ${currentHint}`
}

/** GitHub Releases를 확인한 뒤 결과 대화상자를 띄운다. */
export async function runUpdateCheck(dialog: DialogApi): Promise<void> {
  const api = window.neoCalendar
  if (!api?.checkForUpdates) {
    await dialog.alert('업데이트 확인을 사용할 수 없습니다.', { title: '업데이트 확인' })
    return
  }
  const result = await api.checkForUpdates()
  await presentUpdateCheckResult(result, dialog)
}

/**
 * Tiny PDF Editor처럼 조용히 시작 확인: 업데이트가 있고
 * 이 릴리스(OS·버전·스탬프)를 「알리지 않기」하지 않았을 때만 묻는다.
 */
export async function runStartupUpdateCheck(dialog: DialogApi): Promise<void> {
  const api = window.neoCalendar
  if (!api?.checkForUpdates) return
  const result = await api.checkForUpdates()
  if (!isUpdateAvailable(result)) return
  const platform = runtimeUpdatePlatform()
  if (isStartupNoticeSkipped(readSkippedUpdate(), result, platform)) return

  if (!dialog.choice) {
    await presentUpdateCheckResult(result, dialog)
    return
  }

  const picked = await dialog.choice(availableUpdateMessage(result), {
    title: '업데이트',
    confirmLabel: '다운로드',
    cancelLabel: '나중에',
    extraLabel: '이 버전은 알리지 않기'
  })
  if (picked === 'confirm') {
    await api.openExternal?.(result.releaseUrl || RELEASES_PAGE_URL)
    return
  }
  if (picked === 'extra') {
    writeSkippedUpdate(updateNoticeKey(result, platform))
  }
}
