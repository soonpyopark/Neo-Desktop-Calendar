import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { AttachmentUsage } from '../../../shared/calendarTypes'
import { formatByteSize } from '../../../shared/storeBackup'
import { useAppDialog } from './AppDialogProvider'

const btnSecondary =
  'settings-btn-secondary rounded-full px-4 py-2 text-sm font-medium disabled:opacity-60'
const btnDanger =
  'settings-btn-danger rounded-full px-4 py-2 text-sm font-medium disabled:opacity-60'

function usageLine(label: string, value: string): ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-gcal-muted">{label}</span>
      <span className="font-medium text-gcal-heading">{value}</span>
    </div>
  )
}

export function AttachmentStoragePanel(): ReactElement {
  const { alert, confirm } = useAppDialog()
  const [usage, setUsage] = useState<AttachmentUsage | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState('')

  const refresh = useCallback(async () => {
    try {
      const next = await window.neoCalendar.getAttachmentUsage()
      setUsage(next)
      setLoadError('')
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '첨부 저장 용량을 불러오지 못했습니다.')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const purge = async (): Promise<void> => {
    const ok = await confirm(
      '일정에 연결되지 않은 첨부 파일을 삭제합니다. 이 작업은 되돌릴 수 없습니다.',
      { variant: 'danger', confirmLabel: '삭제' }
    )
    if (!ok) return
    setBusy(true)
    try {
      const result = await window.neoCalendar.purgeOrphanAttachments()
      await refresh()
      await alert(
        `고아 첨부 ${result.removedFiles}개(${formatByteSize(result.removedBytes)})를 삭제했습니다.`,
        { title: '첨부 정리' }
      )
    } catch (error) {
      await alert(error instanceof Error ? error.message : '고아 첨부를 정리하지 못했습니다.', {
        title: '첨부 정리'
      })
    } finally {
      setBusy(false)
    }
  }

  const maxMb = usage ? Math.round(usage.maxAttachmentBytes / (1024 * 1024)) : 20

  return (
    <div className="mt-12">
      <h2 className="mb-8 text-[22px] font-normal text-gcal-heading">첨부 파일 저장소</h2>
      <div className="space-y-4">
        <div className="rounded-lg border border-gcal-border bg-gcal-surface p-5">
          <h3 className="mb-2 text-base font-medium text-gcal-heading">사용량</h3>
          <p className="mb-4 text-sm leading-relaxed text-gcal-muted">
            일정에 첨부된 파일은 일정당 최대 {usage?.maxAttachmentsPerEvent ?? 10}개, 파일당 최대{' '}
            {maxMb}MB까지 저장됩니다. 일정에서 뺀 뒤 남은 파일은 고아 첨부로 집계됩니다.
          </p>
          {loadError ? <p className="mb-3 text-sm text-red-600">{loadError}</p> : null}
          {usage ? (
            <div className="space-y-2">
              {usageLine('파일 수', `${usage.fileCount}개`)}
              {usageLine('전체 용량', formatByteSize(usage.bytes))}
              {usageLine('일정 폴더', `${usage.eventDirCount}개`)}
              {usageLine(
                '고아 첨부',
                `${usage.orphanFileCount}개 · ${formatByteSize(usage.orphanBytes)}`
              )}
            </div>
          ) : !loadError ? (
            <p className="text-sm text-gcal-muted">불러오는 중…</p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              className={btnSecondary}
              disabled={busy}
              onClick={() => void refresh()}
            >
              다시 확인
            </button>
            <button
              type="button"
              className={btnDanger}
              disabled={busy || !usage || usage.orphanFileCount === 0}
              onClick={() => void purge()}
            >
              {busy ? '정리 중…' : '고아 첨부 삭제'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
