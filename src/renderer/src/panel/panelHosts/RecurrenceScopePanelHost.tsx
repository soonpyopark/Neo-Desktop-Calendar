import { useCallback, useEffect, useMemo, type ReactElement } from 'react'
import { RecurrenceScopeDialog, type RecurrenceScope } from '../../components/RecurrenceScopeDialog'
import { useAppDialog } from '../../components/AppDialogProvider'
import { useCalendarStore } from '../../hooks/useCalendarStore'
import {
  blockPanelOutsideClose,
  buildRecurringCompletePayload,
  closePanelsAfterEventDelete
} from '../../lib/recurrenceComplete'
import type { PanelWindowInit } from '../../../../shared/panelWindows'
import { isRecurringEvent } from '../../../../shared/mdcExport/eventOccurrences.js'
import {
  findMasterEvent,
  useApplyRecurringDelete,
  useApplyRecurringEdit,
  usePanelTheme
} from '../usePanelEventHelpers'

type Init = Extract<PanelWindowInit, { kind: 'recurrenceScope' }>

function closeThisPanel(): void {
  // Cancel / dismiss: keep detail + quickEdit. Block click-through after this window closes.
  blockPanelOutsideClose(450)
  window.neoCalendar.closePanelWindow?.()
}

function closeAfterDelete(): void {
  // Close detail/editor/scope; keep quickEdit (store-changed refreshes the list).
  closePanelsAfterEventDelete()
}

export function RecurrenceScopePanelHost({ init }: { init: Init }): ReactElement | null {
  const { alert } = useAppDialog()
  const { store, loading, addEvent, editEvent, removeEvent, ensureEvent } = useCalendarStore()
  const getEvents = useCallback(() => store.events, [store.events])
  const applyRecurringEdit = useApplyRecurringEdit({
    addEvent,
    editEvent,
    removeEvent,
    getEvents
  })
  const applyRecurringDelete = useApplyRecurringDelete({
    editEvent,
    removeEvent,
    getEvents
  })
  usePanelTheme(store.settings, loading)

  useEffect(() => {
    void ensureEvent(init.eventId)
  }, [ensureEvent, init.eventId])

  const master = useMemo(
    () => findMasterEvent(store.events, init.eventId),
    [init.eventId, store.events]
  )

  const handleClose = useCallback((): void => {
    closeThisPanel()
  }, [])

  const handleSelect = useCallback(
    async (scope: RecurrenceScope): Promise<void> => {
      if (!master) {
        await alert('일정을 찾을 수 없습니다.')
        closeThisPanel()
        return
      }
      try {
        if (init.mode === 'complete') {
          const payload = buildRecurringCompletePayload(
            master,
            init.occurrenceDate,
            Boolean(init.completed)
          )
          await applyRecurringEdit(master, payload, init.occurrenceDate, scope)
          closeThisPanel()
          return
        }

        if (init.mode === 'delete') {
          if (!isRecurringEvent(master)) {
            await removeEvent(master.id)
            closeAfterDelete()
            return
          }
          await applyRecurringDelete(master, init.occurrenceDate, scope)
          closeAfterDelete()
          return
        }

        closeThisPanel()
      } catch (error) {
        await alert(error instanceof Error ? error.message : '반복 일정 처리에 실패했습니다.')
        closeThisPanel()
      }
    },
    [
      alert,
      applyRecurringDelete,
      applyRecurringEdit,
      init.completed,
      init.mode,
      init.occurrenceDate,
      master,
      removeEvent
    ]
  )

  if (loading) return null

  return (
    <div className="neo-panel-shell h-screen w-screen overflow-hidden p-0">
      <RecurrenceScopeDialog
        open
        surface="panel"
        mode={init.mode}
        onClose={handleClose}
        onSelect={(scope) => {
          void handleSelect(scope)
        }}
      />
    </div>
  )
}

export default RecurrenceScopePanelHost
