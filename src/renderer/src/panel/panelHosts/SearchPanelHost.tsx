import { type ReactElement } from 'react'
import { SearchPanel } from '../../components/SearchPanel'
import { useCalendarStore } from '../../hooks/useCalendarStore'
import type { PanelWindowInit } from '../../../../shared/panelWindows'
import { usePanelRouter, usePanelTheme } from '../usePanelEventHelpers'

type Init = Extract<PanelWindowInit, { kind: 'search' }>

export function SearchPanelHost({ init }: { init: Init }): ReactElement | null {
  const { closePanel, routePanel } = usePanelRouter()
  const { store, loading, visibleEvents, ensureEvent } = useCalendarStore()
  usePanelTheme(store.settings, loading)

  // Mount immediately so the query input can focus on panel ready-to-show
  // (do not wait for store loading).
  return (
    <div className="neo-panel-shell h-screen w-screen overflow-hidden">
      <SearchPanel
        surface="floating"
        open
        events={loading || init.eventsHidden ? [] : visibleEvents}
        calendars={store.calendars}
        tags={store.tags}
        onClose={closePanel}
        onSelectResult={({ event, dayKey, screenX, screenY }) => {
          void ensureEvent(event.id)
          // Keep search open; open detail at the click pointer (screen DIP).
          routePanel({
            kind: 'eventDetail',
            eventId: event.id,
            dayKey,
            fromSearch: true,
            anchor: null,
            pointerScreen: { x: screenX, y: screenY }
          })
        }}
        onEditResult={({ event, dayKey }) => {
          void ensureEvent(event.id)
          // Keep search open; open the full detail editor for this occurrence.
          routePanel({
            kind: 'eventEditor',
            eventId: event.id,
            defaultDate: dayKey,
            occurrenceDate: dayKey,
            returnQuickEdit: null
          })
        }}
      />
    </div>
  )
}

export default SearchPanelHost
