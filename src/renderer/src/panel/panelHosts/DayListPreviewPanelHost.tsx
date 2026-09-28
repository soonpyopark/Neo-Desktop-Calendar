import { useCallback, useEffect, type ReactElement } from 'react'
import { DayListPreviewPanel } from '../../components/DayListPreviewPanel'
import { useCalendarStore } from '../../hooks/useCalendarStore'
import type { PanelWindowInit } from '../../../../shared/panelWindows'
import { usePanelRouter, usePanelTheme } from '../usePanelEventHelpers'

type Init = Extract<PanelWindowInit, { kind: 'dayListPreview' }>

export function DayListPreviewPanelHost({ init }: { init: Init }): ReactElement | null {
  const { closePanel, routePanel } = usePanelRouter()
  const { store, loading, patchStoreSettings, setEventRange } = useCalendarStore()
  usePanelTheme(store.settings, loading)

  useEffect(() => {
    const monthIndex = Number(init.month)
    const year = Number(init.year)
    if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) return
    const last = new Date(year, monthIndex + 1, 0).getDate()
    const mm = String(monthIndex + 1).padStart(2, '0')
    setEventRange(`${year}-${mm}-01`, `${year}-${mm}-${String(last).padStart(2, '0')}`)
  }, [init.month, init.year, setEventRange])

  const eventsHidden = Boolean(store.settings.viewOptions.eventsHidden)

  // Double-click a date: open a centered editor for a new event and keep this panel open.
  // The saved event lands here through the main process `store-changed` broadcast.
  const addEventOnDay = useCallback(
    (dayKey: string): void => {
      routePanel({
        kind: 'eventEditor',
        eventId: null,
        defaultDate: dayKey,
        occurrenceDate: dayKey,
        returnQuickEdit: null
      })
    },
    [routePanel]
  )

  // Double-click a title: open the detail editor for that series / occurrence day.
  const openEventEditor = useCallback(
    (eventId: string, dayKey: string): void => {
      routePanel({
        kind: 'eventEditor',
        eventId,
        defaultDate: dayKey,
        occurrenceDate: dayKey,
        returnQuickEdit: null
      })
    },
    [routePanel]
  )

  if (loading) return null

  return (
    <div className="neo-panel-shell h-screen w-screen overflow-hidden">
      <DayListPreviewPanel
        surface="floating"
        open
        store={store}
        year={init.year}
        month={init.month}
        eventsHidden={eventsHidden}
        completedHidden={Boolean(store.settings.viewOptions.completedHidden)}
        onOpenDay={addEventOnDay}
        onOpenEvent={openEventEditor}
        onSortDirChange={(dir) => {
          void patchStoreSettings({
            viewOptions: {
              ...store.settings.viewOptions,
              dayListSortDesc: dir === 'desc'
            }
          })
        }}
        onClose={closePanel}
      />
    </div>
  )
}

export default DayListPreviewPanelHost
