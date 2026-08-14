import { useCallback, useState, type ReactElement } from 'react'
import { useAppDialog } from '../../components/AppDialogProvider'
import { ExportOptionsPanel } from '../../components/ExportOptionsPanel'
import { useCalendarStore } from '../../hooks/useCalendarStore'
import { exportFormatLabel, formatExportRangeLabel } from '../../../../shared/exportCalendarHelpers.js'
import type { ExportCalendarRequest } from '../../../../shared/exportCalendar'
import type { PanelWindowInit } from '../../../../shared/panelWindows'
import { usePanelRouter, usePanelTheme } from '../usePanelEventHelpers'

type Init = Extract<PanelWindowInit, { kind: 'exportOptions' }>

function todayKey(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function ExportOptionsPanelHost({ init }: { init: Init }): ReactElement | null {
  const { closePanel } = usePanelRouter()
  const { alert } = useAppDialog()
  const { store, loading } = useCalendarStore()
  const [busy, setBusy] = useState(false)
  usePanelTheme(store.settings, loading)

  const referenceDate = init.referenceDate || todayKey()
  const weekStartsOnSunday = init.weekStartsOnSunday ?? store.settings.viewOptions.weekStartsOnSunday !== false

  const handleExport = useCallback(
    async (request: ExportCalendarRequest): Promise<void> => {
      if (busy) return
      setBusy(true)
      const formatLabel = exportFormatLabel(request.format)
      const layoutLabel = request.layout === 'dayList' ? '일간 목록' : '월간 달력'
      const rangeLabel = formatExportRangeLabel(request.startDate, request.endDate)
      try {
        const result = await window.neoCalendar.exportCalendar(request)
        if (result.canceled) {
          closePanel()
          return
        }
        if (!result.ok) {
          await alert(result.error || `${formatLabel} 내보내기에 실패했습니다.`)
          closePanel()
          return
        }
        await alert(`${rangeLabel} ${layoutLabel}을(를) ${formatLabel} 파일로 저장했습니다.`)
        closePanel()
      } catch (error) {
        await alert(error instanceof Error ? error.message : `${formatLabel} 내보내기에 실패했습니다.`)
        closePanel()
      } finally {
        setBusy(false)
      }
    },
    [alert, busy, closePanel]
  )

  if (loading) return null

  return (
    <ExportOptionsPanel
      open
      busy={busy}
      variant="floating"
      referenceDate={referenceDate}
      weekStartsOnSunday={weekStartsOnSunday}
      onClose={() => {
        if (!busy) closePanel()
      }}
      onExport={handleExport}
    />
  )
}

export default ExportOptionsPanelHost
