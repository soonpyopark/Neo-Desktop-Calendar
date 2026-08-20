import { useCallback, useEffect, useState } from 'react'
import { getSeriesId } from '../../../shared/mdcExport/eventOccurrences.js'
import type { CalendarEvent, EventInput } from '../../../shared/calendarTypes'
import type { AuthUser } from '../../../shared/ipc'
import type { PanelWindowInit } from '../../../shared/panelWindows'
import {
  applyRecurringDelete as applyRecurringDeleteCore,
  applyRecurringEdit as applyRecurringEditCore,
  type RecurrenceScope
} from '../lib/recurrenceMutations'
import {
  applyThemeFromStoreSettings,
  getColorScheme
} from '../lib/colorScheme'
import type { StoreSettings } from '../../../shared/calendarTypes'

export function findMasterEvent(
  events: CalendarEvent[],
  eventOrId: CalendarEvent | string | null | undefined
): CalendarEvent | null {
  if (!eventOrId) return null
  const seriesId =
    typeof eventOrId === 'string' ? eventOrId : getSeriesId(eventOrId) || eventOrId.id
  if (!seriesId) return null
  return events.find((item) => item.id === seriesId) ?? null
}

export function mergeOccurrenceForEditor(
  master: CalendarEvent,
  occurrence: CalendarEvent
): CalendarEvent {
  return {
    ...master,
    startDate: occurrence.startDate ?? master.startDate,
    endDate: occurrence.endDate ?? master.endDate,
    startTime: occurrence.startTime ?? master.startTime,
    endTime: occurrence.endTime ?? master.endTime,
    allDay: occurrence.allDay ?? master.allDay
  }
}

export function useApplyRecurringEdit(options: {
  addEvent: (input: EventInput) => Promise<CalendarEvent>
  editEvent: (id: string, patch: Partial<CalendarEvent>) => Promise<CalendarEvent>
  removeEvent: (id: string) => Promise<void>
  /** Needed to clean detached "this only" exceptions. */
  getEvents?: () => CalendarEvent[]
}): (
  master: CalendarEvent,
  payload: Record<string, unknown>,
  occurrenceDate: string,
  scope: RecurrenceScope
) => Promise<void> {
  const { addEvent, editEvent, removeEvent, getEvents } = options

  return useCallback(
    async (master, payload, occurrenceDate, scope) => {
      await applyRecurringEditCore(
        { addEvent, editEvent, removeEvent },
        master,
        payload,
        occurrenceDate,
        scope,
        getEvents?.() ?? []
      )
    },
    [addEvent, editEvent, getEvents, removeEvent]
  )
}

export function useApplyRecurringDelete(options: {
  editEvent: (id: string, patch: Partial<CalendarEvent>) => Promise<CalendarEvent>
  removeEvent: (id: string) => Promise<void>
  getEvents?: () => CalendarEvent[]
}): (
  master: CalendarEvent,
  occurrenceDate: string,
  scope: RecurrenceScope
) => Promise<void> {
  const { editEvent, removeEvent, getEvents } = options

  return useCallback(
    async (master, occurrenceDate, scope) => {
      await applyRecurringDeleteCore(
        { editEvent, removeEvent },
        master,
        occurrenceDate,
        scope,
        getEvents?.() ?? []
      )
    },
    [editEvent, getEvents, removeEvent]
  )
}

export function usePanelRouter(): {
  /** Close only this panel window (keeps quickEdit open — e.g. detail X after canceling delete). */
  closePanel: () => void
  routePanel: (init: PanelWindowInit) => void
} {
  const closePanel = useCallback((): void => {
    window.neoCalendar.blockPanelOutsideClose?.(400)
    window.neoCalendar.closePanelWindow?.()
  }, [])

  const routePanel = useCallback((init: PanelWindowInit): void => {
    void window.neoCalendar.routePanelWindow?.(init)
  }, [])

  return { closePanel, routePanel }
}

export function usePanelAuth(): {
  authReady: boolean
  canEdit: boolean
  user: AuthUser | null
} {
  const [authReady, setAuthReady] = useState(false)
  const [canEdit, setCanEdit] = useState(false)
  const [user, setUser] = useState<AuthUser | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const nextUser = await window.neoCalendar.getAuth()
        if (cancelled) return
        setUser(nextUser)
        setCanEdit(Boolean(nextUser))
        setAuthReady(true)
      } catch {
        if (!cancelled) setAuthReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return { authReady, canEdit, user }
}

export function usePanelTheme(
  settings: Pick<StoreSettings, 'viewOptions'>,
  loading = false
): void {
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const appSettings = await window.neoCalendar.getSettings()
        if (cancelled) return
        document.documentElement.style.setProperty(
          '--neo-header-opacity',
          String(appSettings.headerOpacity)
        )
        document.documentElement.style.setProperty(
          '--neo-shell-opacity',
          String(appSettings.shellOpacity)
        )
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const api = window.neoCalendar
    if (!api?.getCalendarStore) return undefined
    let cancelled = false
    void api.getCalendarStore().then((snap) => {
      if (cancelled) return
      applyThemeFromStoreSettings(snap.settings)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (loading) return
    applyThemeFromStoreSettings(settings)
  }, [
    loading,
    settings.viewOptions?.colorScheme,
    settings.viewOptions?.accentColor,
    settings.viewOptions?.skin
  ])

  useEffect(() => {
    if (loading) return
    if (getColorScheme(settings.viewOptions) !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => {
      applyThemeFromStoreSettings(settings)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [loading, settings, settings.viewOptions?.colorScheme])

  useEffect(() => {
    const api = window.neoCalendar
    if (!api?.onStoreChanged) return
    return api.onStoreChanged(() => {
      void api.getCalendarStore().then((snap) => {
        applyThemeFromStoreSettings(snap.settings)
      })
    })
  }, [])
}
