import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useAppDialog } from '../../components/AppDialogProvider'
import { EventEditor } from '../../components/EventEditor'
import { RecurrenceScopeDialog } from '../../components/RecurrenceScopeDialog'
import {
  closePanelsAfterEventDelete,
  openRecurrenceDeletePanel
} from '../../lib/recurrenceComplete'
import { useCalendarStore } from '../../hooks/useCalendarStore'
import { copyEventToDate } from '../../lib/copyEventToDate'
import {
  expandEventsForRange,
  getOccurrenceDate,
  getSeriesId,
  isRecurringEvent
} from '../../../../shared/mdcExport/eventOccurrences.js'
import { HOLIDAYS_KR_CALENDAR_ID } from '../../../../shared/calendarDefaults'
import type { CalendarEvent } from '../../../../shared/calendarTypes'
import type { PanelWindowInit } from '../../../../shared/panelWindows'
import {
  findMasterEvent,
  mergeOccurrenceForEditor,
  useApplyRecurringDelete,
  useApplyRecurringEdit,
  usePanelAuth,
  usePanelRouter,
  usePanelTheme
} from '../usePanelEventHelpers'

type Init = Extract<PanelWindowInit, { kind: 'eventEditor' }>

export function EventEditorPanelHost({ init }: { init: Init }): ReactElement | null {
  const { alert } = useAppDialog()
  const { closePanel } = usePanelRouter()
  const { authReady, canEdit } = usePanelAuth()
  const { store, loading, refresh, addEvent, editEvent, removeEvent, ensureEvent } = useCalendarStore()
  usePanelTheme(store.settings, loading)

  useEffect(() => {
    if (!init.eventId) return
    void ensureEvent(init.eventId)
  }, [ensureEvent, init.eventId])

  const [editorEvent, setEditorEvent] = useState<CalendarEvent | null>(null)
  const [pendingEdit, setPendingEdit] = useState<{
    master: CalendarEvent
    occurrenceDate: string
    needsScope: boolean
    payload?: Record<string, unknown>
  } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{
    master: CalendarEvent
    occurrenceDate: string
  } | null>(null)
  const [scopeDialog, setScopeDialog] = useState<{ mode: 'edit' | 'delete' } | null>(null)

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

  const resolvedEvent = useMemo(() => {
    if (editorEvent) return editorEvent
    if (!init.eventId) return null
    const seriesId = init.eventId.split('::')[0] ?? init.eventId
    const master = store.events.find((item) => item.id === seriesId) ?? null
    if (!master) return null
    const dayKey = init.occurrenceDate ?? init.defaultDate ?? init.eventId.split('::')[1] ?? master.startDate
    const expanded = expandEventsForRange([master], dayKey, dayKey)
    const occurrence =
      expanded.find((item) => item.id === init.eventId) ??
      expanded.find((item) => (getSeriesId(item) || item.id) === seriesId) ??
      expanded[0]
    if (!occurrence) return master
    return mergeOccurrenceForEditor(master, occurrence)
  }, [editorEvent, init.defaultDate, init.eventId, init.occurrenceDate, store.events])

  const dismissEditor = useCallback((): void => {
    closePanel()
  }, [closePanel])

  const handleScopeSelect = async (scope: 'single' | 'following' | 'all'): Promise<void> => {
    const dialogMode = scopeDialog?.mode
    setScopeDialog(null)
    try {
      if (dialogMode === 'edit' && pendingEdit?.payload && pendingEdit.master) {
        const { master, payload, occurrenceDate } = pendingEdit
        setPendingEdit(null)
        closePanel()
        await applyRecurringEdit(master, payload, occurrenceDate, scope)
        return
      }
      if (dialogMode === 'delete' && pendingDelete?.master) {
        const { master, occurrenceDate } = pendingDelete
        setPendingDelete(null)
        await applyRecurringDelete(master, occurrenceDate, scope)
        closePanelsAfterEventDelete()
      }
    } catch (error) {
      await alert(error instanceof Error ? error.message : '반복 일정 처리에 실패했습니다.')
    }
  }

  useEffect(() => {
    if (!init.eventId) {
      setPendingEdit(null)
      return
    }
    const master = findMasterEvent(store.events, init.eventId)
    if (!master) {
      setPendingEdit(null)
      return
    }
    if (isRecurringEvent(master)) {
      setPendingEdit({
        master,
        occurrenceDate: init.occurrenceDate ?? master.startDate,
        needsScope: true
      })
    } else {
      setPendingEdit(null)
    }
  }, [init.eventId, init.occurrenceDate, store.events])

  if (loading || !authReady) return null

  return (
    <div className="neo-panel-shell flex h-screen w-screen items-center justify-center overflow-hidden">
      <EventEditor
        surface="floating"
        open
        event={resolvedEvent}
        defaultDate={init.defaultDate}
        calendars={store.calendars}
        tags={store.tags}
        onEventRefresh={(updated) => {
          setEditorEvent(updated)
          void refresh()
        }}
        onClose={dismissEditor}
        onSave={async (payload, options) => {
          const keepOpen = Boolean(options?.keepOpen)
          try {
            if (!resolvedEvent) {
              const created = await addEvent({
                ...payload,
                allDay: payload.allDay !== false
              } as Parameters<typeof addEvent>[0])
              if (keepOpen) {
                setEditorEvent(created)
                void refresh()
                return
              }
              closePanel()
              return
            }

            const master = findMasterEvent(store.events, resolvedEvent)
            if (!master) {
              await alert('일정을 찾을 수 없습니다.')
              return
            }

            if (pendingEdit?.needsScope && pendingEdit.master) {
              setPendingEdit((prev) =>
                prev ? { ...prev, payload: payload as Record<string, unknown> } : prev
              )
              setScopeDialog({ mode: 'edit' })
              return
            }

            const updated = await editEvent(master.id, payload as Partial<CalendarEvent>)
            if (keepOpen) {
              setEditorEvent(updated)
              void refresh()
              return
            }
            closePanel()
          } catch (error) {
            await alert(error instanceof Error ? error.message : '일정을 저장하지 못했습니다.')
            throw error
          }
        }}
        onDelete={
          resolvedEvent
            ? async () => {
                const master = findMasterEvent(store.events, resolvedEvent)
                if (!master) {
                  await alert('일정을 찾을 수 없습니다.')
                  return
                }
                if (!isRecurringEvent(master)) {
                  await removeEvent(master.id)
                  closePanelsAfterEventDelete()
                  return
                }
                const occurrenceDate =
                  init.occurrenceDate ||
                  getOccurrenceDate(resolvedEvent, init.defaultDate) ||
                  master.startDate
                const opened = await openRecurrenceDeletePanel({
                  eventId: master.id,
                  occurrenceDate
                })
                if (!opened) {
                  setPendingDelete({ master, occurrenceDate })
                  setScopeDialog({ mode: 'delete' })
                }
              }
            : undefined
        }
        onCopyToDate={
          resolvedEvent
            ? async (targetDateKey) => {
                const master = findMasterEvent(store.events, resolvedEvent)
                if (!master || master.calendarId === HOLIDAYS_KR_CALENDAR_ID) {
                  await alert('일정을 찾을 수 없습니다.')
                  return
                }
                const occurrenceDate =
                  init.occurrenceDate ||
                  getOccurrenceDate(resolvedEvent, init.defaultDate) ||
                  master.startDate
                await copyEventToDate({
                  master,
                  occurrenceDate,
                  targetStartDate: targetDateKey,
                  addEvent
                })
                closePanel()
              }
            : undefined
        }
      />

      <RecurrenceScopeDialog
        open={Boolean(scopeDialog)}
        surface="overlay"
        mode={scopeDialog?.mode ?? 'edit'}
        onClose={() => {
          setScopeDialog(null)
          if (scopeDialog?.mode === 'delete') setPendingDelete(null)
        }}
        onSelect={(scope) => {
          void handleScopeSelect(scope)
        }}
      />
    </div>
  )
}

export default EventEditorPanelHost
