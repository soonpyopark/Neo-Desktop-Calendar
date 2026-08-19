import { useState, type ReactElement } from 'react'
import {
  detectCalendarFileFormat,
  downloadCalendarFile,
  exportFullStore,
  parseImportPayload
} from '../../../shared/calendarInterchange'
import { getJsonExportTimestamp } from '../../../shared/exportTimestamp'
import type { CalendarStoreSnapshot } from '../../../shared/calendarTypes'
import { useAppDialog } from './AppDialogProvider'
import { BackupSettingsPanel } from './BackupSettingsPanel'
import { CalendarFileFormatButton } from './CalendarFileFormatButton'

export type ImportExportPanelProps = {
  store: CalendarStoreSnapshot
  onImport: (payload: unknown) => Promise<void>
  onRefresh: () => Promise<void>
}

export function ImportExportPanel({
  store,
  onImport,
  onRefresh
}: ImportExportPanelProps): ReactElement {
  const { alert, confirm } = useAppDialog()
  const [statusMessage, setStatusMessage] = useState('')
  const [importBusy, setImportBusy] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)

  const handleExport = async (format: 'json' | 'ics' | 'csv' | 'zip'): Promise<void> => {
    if (exportBusy) return
    setExportBusy(true)
    try {
      if (format === 'zip') {
        const result = await window.neoCalendar.exportBackupZip()
        if (result?.cancelled) return
        const files = Number(result?.attachmentFiles) || 0
        const message =
          files > 0
            ? `일정과 첨부 파일 ${files}개를 ZIP으로 저장했습니다.`
            : '일정을 ZIP으로 저장했습니다. (포함된 첨부 파일 없음)'
        setStatusMessage(message)
        await alert(message, { title: '내보내기 완료' })
        return
      }

      const { content, filename, mimeType } = exportFullStore(
        store,
        format,
        getJsonExportTimestamp()
      )
      downloadCalendarFile(content, filename, mimeType)
      const message = `전체 캘린더를 ${format.toUpperCase()} 파일로 내보냈습니다.`
      setStatusMessage(message)
      await alert(message, { title: '내보내기 완료' })
    } catch (err) {
      setStatusMessage('')
      await alert(err instanceof Error ? err.message : '내보내기에 실패했습니다.')
    } finally {
      setExportBusy(false)
    }
  }

  const handleImportFile = async (): Promise<void> => {
    if (importBusy) return
    setImportBusy(true)
    try {
      const picked = await window.neoCalendar.pickCalendarImportFile()
      if (picked.cancelled) return

      if (picked.kind === 'zip-restored') {
        await onRefresh()
        const files = Number(picked.attachmentFiles) || 0
        const message =
          files > 0
            ? `「${picked.filename}」 ZIP 백업을 가져왔습니다. 첨부 파일 ${files}개를 복원했습니다.`
            : `「${picked.filename}」 ZIP 백업을 가져왔습니다.`
        setStatusMessage(message)
        await alert(message, { title: '가져오기 완료' })
        return
      }

      if (picked.kind === 'zip') {
        const ok = await confirm(
          'ZIP 백업의 일정·설정·첨부 파일로 현재 데이터를 바꿉니다.\n「대한민국의 휴일」은 유지됩니다. 계속할까요?',
          { confirmLabel: '가져오기' }
        )
        if (!ok) return
        const result = await window.neoCalendar.importBackupZipFromPath(picked.filePath)
        if (result?.cancelled) return
        await onRefresh()
        const files = Number(result?.attachmentFiles) || 0
        const message =
          files > 0
            ? `「${picked.filename}」 ZIP 백업을 가져왔습니다. 첨부 파일 ${files}개를 복원했습니다.`
            : `「${picked.filename}」 ZIP 백업을 가져왔습니다.`
        setStatusMessage(message)
        await alert(message, { title: '가져오기 완료' })
        return
      }

      const format = detectCalendarFileFormat(picked.filename)
      if (!format || format === 'zip') {
        await alert('JSON, ICS, CSV, ZIP 파일만 가져올 수 있습니다.')
        return
      }

      const parsed = parseImportPayload(picked.content, format, picked.filename)
      await onImport(parsed.data)
      const message = `「${picked.filename}」 가져오기가 완료되었습니다.`
      setStatusMessage(message)
      await alert(message, { title: '가져오기 완료' })
    } catch (err) {
      setStatusMessage('')
      const message =
        err instanceof Error && err.message
          ? err.message
          : '가져오기에 실패했습니다. 파일 형식을 확인해 주세요.'
      await alert(message)
    } finally {
      setImportBusy(false)
    }
  }

  return (
    <div className="w-full max-w-full text-left">
      <h2 className="mb-8 text-[22px] font-normal text-gcal-heading">가져오기 / 내보내기</h2>
      <div className="space-y-4">
        <div className="rounded-lg border border-gcal-border bg-gcal-surface p-5">
          <h3 className="mb-2 text-base font-medium text-gcal-heading">가져오기</h3>
          <p className="mb-4 text-sm text-gcal-muted">
            JSON, ICS, CSV, ZIP 파일을 불러옵니다. JSON·ICS·CSV는 기존 데이터에 병합되고, ZIP
            백업은 첨부 파일까지 포함해 현재 데이터를 바꿉니다. 「대한민국의 휴일」은 동기화로만
            갱신되며 가져오기로 덮어쓰지 않습니다.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={importBusy}
              className="settings-btn-primary rounded-full px-5 py-2 text-sm font-medium disabled:opacity-60"
              onClick={() => void handleImportFile()}
            >
              {importBusy ? '처리 중…' : '파일 선택'}
            </button>
          </div>
        </div>
        <div className="rounded-lg border border-gcal-border bg-gcal-surface p-5">
          <h3 className="mb-2 text-base font-medium text-gcal-heading">내보내기</h3>
          <p className="mb-4 text-sm text-gcal-muted">
            모든 캘린더와 일정을 JSON, ICS, CSV, ZIP 형식으로 저장합니다. 첨부 파일까지 백업하려면
            ZIP을 선택하세요.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <CalendarFileFormatButton
              label={exportBusy ? '처리 중…' : '내보내기'}
              mode="export"
              disabled={exportBusy}
              onSelectFormat={(format) => void handleExport(format)}
            />
          </div>
        </div>
        {statusMessage ? (
          <p
            className="rounded-lg border border-[#ceead6] bg-[#e6f4ea] px-4 py-3 text-sm text-[#137333]"
            role="status"
          >
            {statusMessage}
          </p>
        ) : null}
        <div className="rounded-lg border border-gcal-border bg-gcal-surface p-5">
          <h3 className="mb-4 text-base font-medium text-gcal-heading">파일 형식 안내</h3>
          <div className="space-y-2.5 text-sm text-gcal-muted">
            <p>
              <span className="font-medium text-gcal-heading">ZIP</span>
              {' — '}
              일정 데이터(JSON)와 첨부 파일을 함께 담는 전체 백업입니다. 가져오면 현재 데이터를
              백업 내용으로 바꿉니다.
            </p>
            <p>
              <span className="font-medium text-gcal-heading">JSON</span>
              {' — '}
              이 앱 전용 백업 형식입니다. 캘린더·일정·설정을 그대로 저장하고, 나중에 이 앱에서 다시
              불러올 수 있습니다. 첨부 파일 본체는 포함되지 않습니다.
            </p>
            <p>
              <span className="font-medium text-gcal-heading">ICS</span>
              {' — '}
              iCalendar 표준 형식입니다. Google Calendar, Outlook 등 다른 캘린더 앱으로 가져와
              사용할 수 있습니다.
            </p>
            <p>
              <span className="font-medium text-gcal-heading">CSV</span>
              {' — '}
              표 형식 파일입니다. Google Calendar 가져오기나 Excel에서 열어 확인·편집하기에
              적합합니다.
            </p>
          </div>
        </div>
      </div>
      <div className="mt-12">
        <BackupSettingsPanel />
      </div>
    </div>
  )
}
