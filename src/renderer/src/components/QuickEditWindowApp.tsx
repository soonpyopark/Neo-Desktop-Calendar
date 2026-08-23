import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement
} from 'react'
import { useAppDialog } from './AppDialogProvider'
import { DayQuickEditPopover } from './DayQuickEditPopover'
import { RecurrenceScopeDialog } from './RecurrenceScopeDialog'
import { useCalendarStore } from '../hooks/useCalendarStore'
import { parseDateKey as parseDateKeyLocal } from '../lib/calendarUtils'
import {
  getOccurrenceDate,
  getSeriesId,
  isRecurringEvent
} from '../../../shared/mdcExport/eventOccurrences.js'
import {
  buildRecurringCompletePayload,
  openRecurrenceCompletePanel
} from '../lib/recurrenceComplete'
import { applyRecurringEdit as applyRecurringEditCore } from '../lib/recurrenceMutations'
import { copyEventToDate } from '../lib/copyEventToDate'
import { applyEventDateShift } from '../lib/shiftEventDates'
import {
  getPrimaryEventLinkUrl,
  normalizeEventLinksArray
} from '../lib/eventLinks'
import { normalizeTagIds } from '../../../shared/mdcExport/eventTags.js'
import {
  getEventSortOrderForDay,
  mergeSortOrderByDay
} from '../../../shared/mdcExport/eventBarFormat.js'
import { HOLIDAYS_KR_CALENDAR_ID, PRIMARY_CALENDAR_ID } from '../../../shared/calendarDefaults'
import {
  normalizeEventDensity,
  normalizeEventLetterSpacing,
  normalizeEventLetterWidth
} from '../../../shared/eventLayoutMetrics'
import type { CalendarEvent, EventLink } from '../../../shared/calendarTypes'
import {
  QUICK_EDIT_YEAR_MIN_BODY,
  type QuickEditWindowInit
} from '../../../shared/quickEditLayout'
import type { DayReorderItem } from '../lib/dayReorder'
import { usePanelTheme } from '../panel/usePanelEventHelpers'

function parseDateKey(dateKey: string): Date | null {
  const [y, m, d] = dateKey.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

export function QuickEditWindowApp(): ReactElement | null {
  const { alert } = useAppDialog()
  const {
    store,
    loading,
    refresh,
    addEvent,
    editEvent,
    removeEvent,
    patchStoreSettings,
    visibleEvents,
    deleteCompletedForDay
  } = useCalendarStore()

  const [init, setInit] = useState<QuickEditWindowInit | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [canEdit, setCanEdit] = useState(false)
  const [scopeDialog, setScopeDialog] = useState<{
    mode: 'complete' | 'shift'
  } | null>(null)
  const [pendingComplete, setPendingComplete] = useState<{
    master: CalendarEvent
    occurrenceDate: string
    completed: boolean
  } | null>(null)
  const [pendingShift, setPendingShift] = useState<{
    master: CalendarEvent
    occurrenceDate: string
    deltaDays: number
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const payload = await window.neoCalendar.getQuickEditInit?.()
        if (cancelled) return
        if (payload?.dateKey) {
          setInit(payload)
        }
      } catch (error) {
        console.error('[quick-edit-window] init failed', error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const user = await window.neoCalendar.getAuth()
        if (cancelled) return
        setCanEdit(Boolean(user))
        setAuthReady(true)
      } catch {
        if (!cancelled) setAuthReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  usePanelTheme(store.settings, loading)

  const date = useMemo(() => {
    if (!init?.dateKey) return null
    return parseDateKeyLocal(init.dateKey) ?? parseDateKey(init.dateKey)
  }, [init?.dateKey])

  const dayColors = store.settings.dayColors ?? {}
  const dayHighlights = store.settings.dayHighlights ?? {}
  const eventsHidden = init?.eventsHidden ?? false
  const viewMode = init?.viewMode ?? 'month'
  const anchorRect = init?.anchor
    ? {
        top: init.anchor.top,
        left: init.anchor.left,
        width: init.anchor.width,
        height: init.anchor.height
      }
    : null

  const findMasterEvent = useCallback(
    (eventOrId: CalendarEvent | string | null | undefined): CalendarEvent | null => {
      if (!eventOrId) return null
      const seriesId =
        typeof eventOrId === 'string' ? eventOrId : getSeriesId(eventOrId) || eventOrId.id
      if (!seriesId) return null
      return store.events.find((item) => item.id === seriesId) ?? null
    },
    [store.events]
  )

  const applyRecurringEdit = useCallback(
    async (
      master: CalendarEvent,
      payload: Record<string, unknown>,
      occurrenceDate: string,
      scope: 'single' | 'following' | 'all'
    ): Promise<void> => {
      await applyRecurringEditCore(
        { addEvent, editEvent, removeEvent },
        master,
        payload,
        occurrenceDate,
        scope,
        store.events
      )
    },
    [addEvent, editEvent, removeEvent, store.events]
  )

  const handleQuickEditEventPatch = useCallback(
    async (
      event: CalendarEvent,
      patch: Partial<CalendarEvent>,
      errorMessage: string
    ): Promise<void> => {
      if (!canEdit) return
      const master = findMasterEvent(event)
      if (!master || master.calendarId === HOLIDAYS_KR_CALENDAR_ID) return
      try {
        await editEvent(master.id, patch)
      } catch (error) {
        await alert(error instanceof Error ? error.message : errorMessage)
      }
    },
    [alert, canEdit, editEvent, findMasterEvent]
  )

  const handleQuickEditToggleCompleted = useCallback(
    async (event: CalendarEvent, completed: boolean): Promise<void> => {
      if (!canEdit || !init?.dateKey) return
      const master = findMasterEvent(event)
      if (!master || master.calendarId === HOLIDAYS_KR_CALENDAR_ID) return
      const nextCompleted = Boolean(completed)
      try {
        if (!isRecurringEvent(master)) {
          await editEvent(master.id, { completed: nextCompleted })
          return
        }
        const occurrenceDate =
          getOccurrenceDate(event, init.dateKey) ?? master.startDate
        const opened = await openRecurrenceCompletePanel({
          eventId: master.id,
          occurrenceDate,
          completed: nextCompleted
        })
        if (!opened) {
          setPendingComplete({
            master,
            occurrenceDate,
            completed: nextCompleted
          })
          setScopeDialog({ mode: 'complete' })
        }
      } catch (error) {
        await alert(
          error instanceof Error ? error.message : '완료 상태를 변경하지 못했습니다.'
        )
      }
    },
    [alert, canEdit, editEvent, findMasterEvent, init?.dateKey]
  )

  const handleQuickEditShift = useCallback(
    async (event: CalendarEvent, deltaDays: number): Promise<void> => {
      if (!canEdit || !init?.dateKey) return
      const master = findMasterEvent(event)
      if (!master || master.calendarId === HOLIDAYS_KR_CALENDAR_ID) return
      const occurrenceDate = getOccurrenceDate(event, init.dateKey) || master.startDate
      if (isRecurringEvent(master)) {
        setPendingShift({ master, occurrenceDate, deltaDays })
        setScopeDialog({ mode: 'shift' })
        return
      }
      try {
        await applyEventDateShift(
          { addEvent, editEvent, removeEvent },
          { master, occurrenceDate, deltaDays }
        )
      } catch (error) {
        await alert(error instanceof Error ? error.message : '일정을 이동하지 못했습니다.')
      }
    },
    [
      addEvent,
      alert,
      canEdit,
      editEvent,
      findMasterEvent,
      init?.dateKey,
      removeEvent
    ]
  )

  const handleQuickEditCopy = useCallback(
    async (event: CalendarEvent, targetDateKey: string): Promise<void> => {
      if (!canEdit || !init?.dateKey) return
      const master = findMasterEvent(event)
      if (!master || master.calendarId === HOLIDAYS_KR_CALENDAR_ID) return
      const occurrenceDate = getOccurrenceDate(event, init.dateKey) || master.startDate
      try {
        await copyEventToDate({
          master,
          occurrenceDate,
          targetStartDate: targetDateKey,
          addEvent
        })
        window.neoCalendar.closeQuickEditWindow?.()
      } catch (error) {
        await alert(error instanceof Error ? error.message : '일정을 복사하지 못했습니다.')
        throw error
      }
    },
    [addEvent, alert, canEdit, findMasterEvent, init?.dateKey]
  )

  const handleQuickEditDeleteCompleted = useCallback(
    async (completedEvents: CalendarEvent[]): Promise<void> => {
      if (!canEdit || !init?.dateKey) return
      try {
        const { deleted, failed } = await deleteCompletedForDay(
          completedEvents,
          init.dateKey
        )
        if (failed > 0) {
          await alert(
            deleted > 0
              ? `완료된 일정 ${deleted}건을 삭제했습니다. ${failed}건은 삭제하지 못했습니다.`
              : '완료된 일정을 삭제하지 못했습니다.'
          )
        }
      } catch (error) {
        await alert(error instanceof Error ? error.message : '완료된 일정을 삭제하지 못했습니다.')
      }
    },
    [alert, canEdit, deleteCompletedForDay, init?.dateKey]
  )

  const handleReorderEvents = useCallback(
    async (ordered: DayReorderItem[], dayKey: string): Promise<void> => {
      if (!canEdit || !dayKey) return
      try {
        for (const { event, sortOrder } of ordered ?? []) {
          const master =
            store.events.find((item) => item.id === (getSeriesId(event) || event.id)) ?? null
          if (!master || master.calendarId === HOLIDAYS_KR_CALENDAR_ID) continue
          if (getEventSortOrderForDay(master, dayKey) === sortOrder) continue
          await editEvent(master.id, {
            sortOrderByDay: mergeSortOrderByDay(master, dayKey, sortOrder)
          })
        }
      } catch (error) {
        await alert(error instanceof Error ? error.message : '일정 순서를 저장하지 못했습니다.')
      }
    },
    [alert, canEdit, editEvent, store.events]
  )

  const handleScopeSelect = async (scope: 'single' | 'following' | 'all'): Promise<void> => {
    const mode = scopeDialog?.mode
    setScopeDialog(null)
    try {
      if (mode === 'complete' && pendingComplete?.master) {
        const { master, occurrenceDate, completed } = pendingComplete
        setPendingComplete(null)
        const payload = buildRecurringCompletePayload(master, occurrenceDate, Boolean(completed))
        await applyRecurringEdit(master, payload, occurrenceDate, scope)
        return
      }
      if (mode === 'shift' && pendingShift?.master) {
        const { master, occurrenceDate, deltaDays } = pendingShift
        setPendingShift(null)
        await applyEventDateShift(
          { addEvent, editEvent, removeEvent },
          {
            master,
            occurrenceDate,
            deltaDays,
            scope,
            allEvents: store.events
          }
        )
      }
    } catch (error) {
      await alert(error instanceof Error ? error.message : '반복 일정 처리에 실패했습니다.')
    }
  }

  const routeFromQuickEdit = useCallback(
    (
      kind: 'editor' | 'detail',
      event?: CalendarEvent | null,
      pointer?: { x: number; y: number; screenX?: number; screenY?: number }
    ): void => {
      if (!init?.dateKey) return
      const returnQuickEdit = { dateKey: init.dateKey, anchor: init.anchor ?? null }
      if (kind === 'detail') {
        if (!event?.id) return
        void window.neoCalendar.routePanelWindow?.({
          kind: 'eventDetail',
          eventId: event.id,
          dayKey: init.dateKey,
          pointerScreen:
            pointer?.screenX != null && pointer?.screenY != null
              ? { x: pointer.screenX, y: pointer.screenY }
              : null
        })
        return
      }
      if (event?.calendarId === HOLIDAYS_KR_CALENDAR_ID) return
      void window.neoCalendar.routePanelWindow?.({
        kind: 'eventEditor',
        eventId: event?.id ?? null,
        defaultDate: init.dateKey,
        occurrenceDate: init.dateKey,
        returnQuickEdit
      })
    },
    [init?.anchor, init?.dateKey]
  )

  const handleClose = useCallback((): void => {
    if (scopeDialog) return
    window.neoCalendar.closeQuickEditWindow?.()
  }, [scopeDialog])

  if (!init || !date || loading || !authReady) {
    return null
  }

  return (
    <div className="neo-quick-edit-shell h-screen w-screen overflow-hidden">
      <DayQuickEditPopover
        surface="floating"
        viewMode={viewMode}
        dateKey={init.dateKey}
        date={date}
        events={eventsHidden ? [] : visibleEvents}
        calendars={store.calendars}
        tags={store.tags}
        dayColor={dayColors[init.dateKey] ?? null}
        dayHighlight={dayHighlights[init.dateKey] ?? null}
        anchorRect={anchorRect}
        canEdit={canEdit}
        expandBody={viewMode === 'month'}
        minBodyHeight={viewMode === 'year' ? QUICK_EDIT_YEAR_MIN_BODY : undefined}
        eventDensity={normalizeEventDensity(store.settings.viewOptions.eventDensity)}
        eventLetterSpacing={normalizeEventLetterSpacing(
          store.settings.viewOptions.eventLetterSpacing
        )}
        eventLetterWidth={normalizeEventLetterWidth(store.settings.viewOptions.eventLetterWidth)}
        onReorderEvents={handleReorderEvents}
        onClose={handleClose}
        onDismissEventDetail={() => {
          // Match browser inline: clicking QE chrome (not the event title) closes detail.
          window.neoCalendar.closePanelSlot?.('eventDetail')
        }}
        onCreate={(title, calendarId, tagIds, links) =>
          void addEvent({
            title,
            calendarId: calendarId || PRIMARY_CALENDAR_ID,
            startDate: init.dateKey,
            endDate: init.dateKey,
            allDay: true,
            tagIds,
            links
          })
        }
        onToggleCompleted={(event, completed) => {
          void handleQuickEditToggleCompleted(event, completed)
        }}
        onDeleteCompleted={(completedEvents) => {
          void handleQuickEditDeleteCompleted(completedEvents)
        }}
        onDayColorChange={(color) => {
          const next = { ...dayColors }
          if (!color) delete next[init.dateKey]
          else next[init.dateKey] = color
          void patchStoreSettings({ dayColors: next })
        }}
        onDayHighlightChange={(color) => {
          const next = { ...dayHighlights }
          if (!color) delete next[init.dateKey]
          else next[init.dateKey] = color
          void patchStoreSettings({ dayHighlights: next })
        }}
        onEventCalendarChange={(event, calendarId) => {
          void handleQuickEditEventPatch(event, { calendarId }, '캘린더를 변경하지 못했습니다.')
        }}
        onEventTagChange={(event, tagIds) => {
          void handleQuickEditEventPatch(
            event,
            { tagIds: normalizeTagIds(tagIds) },
            '태그를 변경하지 못했습니다.'
          )
        }}
        onEventMarkerShapeChange={(event, markerShape) => {
          void handleQuickEditEventPatch(event, { markerShape }, '표시 도형을 변경하지 못했습니다.')
        }}
        onEventLinkChange={(event, links: EventLink[]) => {
          const normalized = normalizeEventLinksArray(links)
          void handleQuickEditEventPatch(
            event,
            {
              links: normalized,
              link: getPrimaryEventLinkUrl({ links: normalized })
            },
            '바로가기를 변경하지 못했습니다.'
          )
        }}
        onShiftEvent={handleQuickEditShift}
        onCopyEvent={handleQuickEditCopy}
        onOpenMore={(event) => routeFromQuickEdit('editor', event)}
        onOpenEvent={(event, pointer) => routeFromQuickEdit('detail', event, pointer)}
        onEditEvent={(event) => routeFromQuickEdit('editor', event)}
        onAttachFiles={async (event) => {
          if (!canEdit) {
            await alert('관리자 로그인 후 파일을 첨부할 수 있습니다.')
            return
          }
          const master =
            store.events.find((item) => item.id === (getSeriesId(event) || event.id)) ?? event
          if (!master?.id || master.calendarId === HOLIDAYS_KR_CALENDAR_ID) {
            await alert('저장된 일정에만 파일을 첨부할 수 있습니다.')
            return
          }
          try {
            await window.neoCalendar.addEventAttachments(master.id)
            await refresh()
          } catch (error) {
            await alert(error instanceof Error ? error.message : '파일을 첨부하지 못했습니다.')
          }
        }}
      />

      <RecurrenceScopeDialog
        open={Boolean(scopeDialog)}
        surface="overlay"
        mode={scopeDialog?.mode ?? 'complete'}
        onClose={() => {
          setScopeDialog(null)
          if (scopeDialog?.mode === 'complete') setPendingComplete(null)
          else setPendingShift(null)
        }}
        onSelect={(scope) => {
          void handleScopeSelect(scope)
        }}
      />
    </div>
  )
}

export default QuickEditWindowApp
