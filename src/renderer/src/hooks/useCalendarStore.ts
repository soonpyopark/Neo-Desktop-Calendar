import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CalendarEvent,
  CalendarRecord,
  CalendarStoreSnapshot,
  EventInput,
  MemberRecord,
  MemberSaveInput,
  StoreSettings,
  SyncHolidaysInput,
  SyncHolidaysResult,
  TagRecord
} from '../../../shared/calendarTypes'
import { createEmptySnapshot } from '../../../shared/calendarDefaults'
import { headerTitleForBootstrap, writeCachedHeaderTitle } from '../../../shared/headerTitle'
import {
  applyAccentColor,
  applyColorScheme,
  applySkin,
  getColorScheme,
  normalizeAccentColor
} from '../lib/colorScheme'
import {
  hasBrowserAuthToken,
  isBrowserNeoCalendarHost,
  isAuthRequestError
} from '../lib/browserNeoCalendar'
import { deleteCompletedEventsForDay } from '../lib/deleteCompletedForDay'
import { calendarToPatch, eventToMutationPayload } from '../lib/eventMutation'
import {
  clearOfflineQueue,
  clearOfflineSnapshot,
  drainOfflineQueue,
  enqueueOfflineAction,
  isOfflineRequestError,
  loadOfflineSnapshot,
  saveOfflineSnapshot
} from '../lib/offlineStore'
import { useHistoryStack } from './useHistoryStack'

export type UseCalendarStoreResult = {
  store: CalendarStoreSnapshot
  loading: boolean
  refresh: () => Promise<void>
  addEvent: (input: EventInput) => Promise<CalendarEvent>
  editEvent: (id: string, patch: Partial<CalendarEvent>) => Promise<CalendarEvent>
  removeEvent: (id: string) => Promise<void>
  createCalendar: (
    input: Partial<CalendarRecord> & { name: string; color: string }
  ) => Promise<CalendarRecord>
  patchCalendar: (id: string, patch: Partial<CalendarRecord>) => Promise<CalendarRecord>
  reorderCalendars: (orderedIds: string[]) => Promise<void>
  deleteCalendar: (id: string) => Promise<void>
  clearCalendarEvents: (id: string) => Promise<void>
  importEventsIntoCalendar: (
    id: string,
    events: unknown[]
  ) => Promise<{ ok: true; importedCount: number; calendarId: string }>
  setTags: (tags: TagRecord[]) => Promise<TagRecord[]>
  createTag: (input: { name: string; color: string; sortOrder?: number }) => Promise<TagRecord>
  patchTag: (
    id: string,
    patch: Partial<Pick<TagRecord, 'name' | 'color' | 'sortOrder'>>
  ) => Promise<TagRecord>
  deleteTag: (id: string) => Promise<void>
  patchStoreSettings: (patch: Partial<StoreSettings>) => Promise<void>
  replaceStore: (next: CalendarStoreSnapshot) => Promise<void>
  importStore: (payload: unknown) => Promise<void>
  listMembers: () => Promise<MemberRecord[]>
  saveMembers: (members: MemberSaveInput[]) => Promise<MemberRecord[]>
  syncHolidays: (input?: SyncHolidaysInput) => Promise<SyncHolidaysResult>
  calendarsById: Map<string, CalendarRecord>
  visibleEvents: CalendarEvent[]
  undo: () => Promise<boolean>
  redo: () => Promise<boolean>
  canUndo: boolean
  canRedo: boolean
  clearHistory: () => void
  /** Bulk-delete completed day rows as one undo/redo entry (recurring = this date only). */
  deleteCompletedForDay: (
    completedEvents: CalendarEvent[],
    dateKey: string
  ) => Promise<{ deleted: number; failed: number }>
}

export function useCalendarStore(): UseCalendarStoreResult {
  const [store, setStore] = useState<CalendarStoreSnapshot>(() => {
    const snap = createEmptySnapshot()
    // Avoid flashing the factory header title before getCalendarStore resolves.
    snap.settings.viewOptions.headerTitle = headerTitleForBootstrap()
    return snap
  })
  const [loading, setLoading] = useState(true)
  const history = useHistoryStack()
  const suppressHistoryRef = useRef(false)
  const storeRef = useRef(store)
  storeRef.current = store

  const applyStore = useCallback(async (next: CalendarStoreSnapshot) => {
    storeRef.current = next
    setStore(next)
    writeCachedHeaderTitle(next.settings?.viewOptions?.headerTitle)
    if (isBrowserNeoCalendarHost()) {
      void saveOfflineSnapshot(next).catch(() => {
        /* best-effort cache */
      })
    }
  }, [])

  const refresh = useCallback(async () => {
    const api = window.neoCalendar
    if (!api?.getCalendarStore) return
    try {
      const next = await api.getCalendarStore()
      await applyStore(next)
    } catch (err) {
      if (!isBrowserNeoCalendarHost()) {
        throw err
      }
      if (isAuthRequestError(err)) {
        await clearOfflineSnapshot().catch(() => {
          /* best-effort */
        })
        // Keep the on-screen store when a Bearer token is still present — a stale
        // /api/store probe must not wipe view toggles (eventsHidden, etc.) after PATCH.
        if (isBrowserNeoCalendarHost() && hasBrowserAuthToken()) return
        await applyStore(createEmptySnapshot())
        return
      }
      if (isOfflineRequestError(err, true)) {
        const cached = await loadOfflineSnapshot<CalendarStoreSnapshot>()
        if (cached) {
          storeRef.current = cached
          setStore(cached)
        }
      } else {
        throw err
      }
    } finally {
      setLoading(false)
    }
  }, [applyStore])

  const flushOfflineQueue = useCallback(async () => {
    if (!isBrowserNeoCalendarHost()) return
    const queue = await drainOfflineQueue()
    if (!queue.length) return
    const api = window.neoCalendar
    for (const item of queue) {
      try {
        if (item.type === 'create-event') {
          await api.addEvent(item.payload as EventInput)
        } else if (item.type === 'update-event') {
          await api.editEvent(String(item.id), item.payload as Partial<CalendarEvent>)
        } else if (item.type === 'delete-event') {
          await api.removeEvent(String(item.id))
        } else if (item.type === 'patch-calendar') {
          await api.patchCalendar(String(item.id), item.payload as Partial<CalendarRecord>)
        } else if (item.type === 'delete-calendar') {
          await api.deleteCalendar(String(item.id))
        } else if (item.type === 'clear-calendar-events') {
          await api.clearCalendarEvents(String(item.id))
        } else if (item.type === 'create-calendar') {
          await api.createCalendar(
            item.payload as Partial<CalendarRecord> & { name: string; color: string }
          )
        } else if (item.type === 'import-store') {
          await api.importCalendarStore(item.payload)
        } else if (item.type === 'patch-settings') {
          await api.patchStoreSettings(item.payload as Partial<StoreSettings>)
        }
      } catch (err) {
        console.warn('[offline-queue] replay failed', item.type, err)
        // Keep remaining items for a later online event.
        return
      }
    }
    await clearOfflineQueue()
    await refresh()
  }, [refresh])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Browser: flush queued mutations when the OS reports connectivity again.
  useEffect(() => {
    if (!isBrowserNeoCalendarHost()) return
    const onOnline = (): void => {
      void flushOfflineQueue()
    }
    window.addEventListener('online', onOnline)
    void flushOfflineQueue()
    return () => window.removeEventListener('online', onOnline)
  }, [flushOfflineQueue])

  // Live refresh: browser WS (`neo-store-changed`) and Electron IPC (`onStoreChanged`).
  // Debounce so rapid patches (reorder) do not clobber local optimistic order.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const onChanged = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void refresh()
      }, 200)
    }
    window.addEventListener('neo-store-changed', onChanged)
    const unsubIpc =
      typeof window.neoCalendar?.onStoreChanged === 'function'
        ? window.neoCalendar.onStoreChanged(onChanged)
        : undefined
    return () => {
      window.removeEventListener('neo-store-changed', onChanged)
      unsubIpc?.()
      if (timer) clearTimeout(timer)
    }
  }, [refresh])

  const runOrQueue = useCallback(
    async <T>(
      type: string,
      fn: () => Promise<T>,
      queuePayload: Record<string, unknown>,
      mergeStore?: (current: CalendarStoreSnapshot, result: T) => CalendarStoreSnapshot
    ): Promise<T> => {
      if (!isBrowserNeoCalendarHost()) {
        const result = await fn()
        if (mergeStore && storeRef.current) {
          await applyStore(mergeStore(storeRef.current, result))
        } else {
          await refresh()
        }
        return result
      }

      let succeeded = false
      let result!: T
      try {
        result = await fn()
        succeeded = true
        if (mergeStore && storeRef.current) {
          await applyStore(mergeStore(storeRef.current, result))
        } else {
          try {
            await refresh()
          } catch {
            /* mutation ok; refresh can wait */
          }
        }
        return result
      } catch (err) {
        if (succeeded) return result
        if (!isOfflineRequestError(err, true)) {
          throw err instanceof Error ? err : new Error(String(err ?? '요청에 실패했습니다.'))
        }

        await enqueueOfflineAction({ type, ...queuePayload })
        const current = storeRef.current
        if (current && type === 'create-event') {
          const payload = (queuePayload.payload ?? {}) as EventInput
          const calendars = current.calendars ?? []
          const requestedId = payload.calendarId
          const calendarId =
            calendars.find((calendar) => calendar.id === requestedId)?.id ??
            calendars.find((calendar) => calendar.visible !== false)?.id ??
            calendars[0]?.id ??
            requestedId ??
            'primary'
          const optimistic = {
            ...payload,
            calendarId,
            id: `offline-${Date.now()}`,
            updatedAt: new Date().toISOString()
          } as CalendarEvent
          await applyStore({ ...current, events: [...current.events, optimistic] })
          return optimistic as T
        }
        if (current && type === 'create-calendar') {
          const payload = (queuePayload.payload ?? {}) as Partial<CalendarRecord> & {
            name: string
            color: string
          }
          const optimistic = {
            ...payload,
            id: `offline-${Date.now()}`,
            dataKey: `offline-${Date.now()}`,
            visible: payload.visible ?? true,
            custom: payload.custom ?? true,
            owner: payload.owner ?? 'local'
          } as CalendarRecord
          await applyStore({
            ...current,
            calendars: [...current.calendars, optimistic]
          })
          return optimistic as T
        }
        throw new Error('오프라인 상태입니다. 변경 사항은 연결 후 동기화됩니다.')
      }
    },
    [applyStore, refresh]
  )

  // Apply MDC light/dark + accent as soon as store settings load (not only Settings panel).
  useEffect(() => {
    if (loading) return
    const vo = store.settings.viewOptions
    applyColorScheme(getColorScheme(vo))
    applyAccentColor(normalizeAccentColor(vo.accentColor))
    applySkin(vo.skin)
  }, [
    loading,
    store.settings.viewOptions.colorScheme,
    store.settings.viewOptions.accentColor,
    store.settings.viewOptions.skin
  ])

  useEffect(() => {
    if (loading) return
    if (getColorScheme(store.settings.viewOptions) !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => {
      applyColorScheme('system')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [loading, store.settings.viewOptions.colorScheme])

  const withoutHistory = useCallback(async <T>(fn: () => Promise<T>): Promise<T> => {
    suppressHistoryRef.current = true
    try {
      return await fn()
    } finally {
      suppressHistoryRef.current = false
    }
  }, [])

  const recordHistory = useCallback(
    (entry: { undo: () => void | Promise<void>; redo: () => void | Promise<void> }) => {
      if (!suppressHistoryRef.current) history.push(entry)
    },
    [history]
  )

  const performCreateEvent = useCallback(
    async (input: EventInput) =>
      runOrQueue(
        'create-event',
        () => window.neoCalendar.addEvent(input),
        { payload: input },
        (current, created) => ({
          ...current,
          events: [...current.events.filter((e) => e.id !== created.id), created]
        })
      ),
    [runOrQueue]
  )

  const performUpdateEvent = useCallback(
    async (id: string, patch: Partial<CalendarEvent>) =>
      runOrQueue(
        'update-event',
        () => window.neoCalendar.editEvent(id, patch),
        { id, payload: patch },
        (current, updated) => ({
          ...current,
          events: current.events.map((e) => (e.id === id ? updated : e))
        })
      ),
    [runOrQueue]
  )

  const performDeleteEvent = useCallback(
    async (id: string) => {
      await runOrQueue(
        'delete-event',
        async () => {
          await window.neoCalendar.removeEvent(id)
          return id
        },
        { id },
        (current, deletedId) => ({
          ...current,
          events: current.events.filter((e) => e.id !== deletedId)
        })
      )
    },
    [runOrQueue]
  )

  const performPatchCalendar = useCallback(
    async (id: string, patch: Partial<CalendarRecord>) =>
      runOrQueue(
        'patch-calendar',
        () => window.neoCalendar.patchCalendar(id, patch),
        { id, payload: patch },
        (current, updated) => ({
          ...current,
          calendars: current.calendars.map((c) => (c.id === id ? updated : c))
        })
      ),
    [runOrQueue]
  )

  const addEvent = useCallback(
    async (input: EventInput) => {
      const created = await performCreateEvent(input)
      if (!created?.id) return created

      const createPayload = eventToMutationPayload(created)
      const state = { eventId: created.id }

      recordHistory({
        undo: async () => {
          await withoutHistory(() => performDeleteEvent(state.eventId))
        },
        redo: async () => {
          const next = await withoutHistory(() => performCreateEvent(createPayload))
          if (next?.id) state.eventId = next.id
        }
      })

      return created
    },
    [performCreateEvent, performDeleteEvent, recordHistory, withoutHistory]
  )

  const editEvent = useCallback(
    async (id: string, patch: Partial<CalendarEvent>) => {
      const previous = storeRef.current.events.find((event) => event.id === id)
      const result = await performUpdateEvent(id, patch)
      if (!previous) return result

      const beforePatch = eventToMutationPayload(previous)
      recordHistory({
        undo: async () => {
          await withoutHistory(() => performUpdateEvent(id, beforePatch))
        },
        redo: async () => {
          await withoutHistory(() => performUpdateEvent(id, patch))
        }
      })

      return result
    },
    [performUpdateEvent, recordHistory, withoutHistory]
  )

  const removeEvent = useCallback(
    async (id: string) => {
      const previous = storeRef.current.events.find((event) => event.id === id)
      await performDeleteEvent(id)
      if (!previous) return

      const createPayload = eventToMutationPayload(previous)
      const state = { eventId: id }

      recordHistory({
        undo: async () => {
          const restored = await withoutHistory(() => performCreateEvent(createPayload))
          if (restored?.id) state.eventId = restored.id
        },
        redo: async () => {
          await withoutHistory(() => performDeleteEvent(state.eventId))
        }
      })
    },
    [performCreateEvent, performDeleteEvent, recordHistory, withoutHistory]
  )

  const createCalendar = useCallback(
    async (input: Partial<CalendarRecord> & { name: string; color: string }) =>
      runOrQueue(
        'create-calendar',
        () => window.neoCalendar.createCalendar(input),
        { payload: input },
        (current, created) => ({
          ...current,
          calendars: [...current.calendars.filter((c) => c.id !== created.id), created]
        })
      ),
    [runOrQueue]
  )

  const patchCalendar = useCallback(
    async (id: string, patch: Partial<CalendarRecord>) => {
      const previous = storeRef.current.calendars.find((calendar) => calendar.id === id)
      const result = await performPatchCalendar(id, patch)
      if (!previous) return result

      // MDC records editCalendar (settings) but not eye-only toggleCalendar.
      const keys = Object.keys(patch)
      const visibilityOnly = keys.length === 1 && keys[0] === 'visible'
      if (!visibilityOnly) {
        const beforePatch = calendarToPatch(previous)
        recordHistory({
          undo: async () => {
            await withoutHistory(() => performPatchCalendar(id, beforePatch))
          },
          redo: async () => {
            await withoutHistory(() => performPatchCalendar(id, patch))
          }
        })
      }

      return result
    },
    [performPatchCalendar, recordHistory, withoutHistory]
  )

  const reorderCalendars = useCallback(
    async (orderedIds: string[]) => {
      const api = window.neoCalendar
      if (typeof api.reorderCalendars === 'function') {
        await api.reorderCalendars(orderedIds)
      } else {
        for (let i = 0; i < orderedIds.length; i += 1) {
          await api.patchCalendar(orderedIds[i], { sortOrder: i })
        }
      }
      await refresh()
    },
    [refresh]
  )

  const deleteCalendar = useCallback(
    async (id: string) => {
      await runOrQueue(
        'delete-calendar',
        async () => {
          await window.neoCalendar.deleteCalendar(id)
          return id
        },
        { id },
        (current, deletedId) => ({
          ...current,
          calendars: current.calendars.filter((c) => c.id !== deletedId),
          events: current.events.filter((e) => e.calendarId !== deletedId)
        })
      )
    },
    [runOrQueue]
  )

  const clearCalendarEvents = useCallback(
    async (id: string) => {
      await runOrQueue(
        'clear-calendar-events',
        async () => {
          await window.neoCalendar.clearCalendarEvents(id)
          return id
        },
        { id },
        (current, calendarId) => ({
          ...current,
          events: current.events.filter((e) => e.calendarId !== calendarId)
        })
      )
    },
    [runOrQueue]
  )

  const importEventsIntoCalendar = useCallback(
    async (id: string, events: unknown[]) => {
      const result = await window.neoCalendar.importEventsIntoCalendar(id, events)
      await refresh()
      return result
    },
    [refresh]
  )

  const setTags = useCallback(
    async (tags: TagRecord[]) => {
      const next = await window.neoCalendar.setTags(tags)
      await refresh()
      return next
    },
    [refresh]
  )

  const createTag = useCallback(
    async (input: { name: string; color: string; sortOrder?: number }) => {
      const created = await window.neoCalendar.createTag(input)
      await refresh()
      return created
    },
    [refresh]
  )

  const patchTag = useCallback(
    async (id: string, patch: Partial<Pick<TagRecord, 'name' | 'color' | 'sortOrder'>>) => {
      const updated = await window.neoCalendar.patchTag(id, patch)
      await refresh()
      return updated
    },
    [refresh]
  )

  const deleteTag = useCallback(
    async (id: string) => {
      await window.neoCalendar.deleteTag(id)
      await refresh()
    },
    [refresh]
  )

  const patchStoreSettings = useCallback(
    async (patch: Partial<StoreSettings>) => {
      // Optimistic: day cell colors should paint before IPC/refresh round-trip
      // (desktop mode store-changed used to briefly revert the tint).
      if (patch.dayColors) {
        setStore((prev) => {
          const next = {
            ...prev,
            settings: {
              ...prev.settings,
              dayColors: { ...patch.dayColors }
            }
          }
          storeRef.current = next
          return next
        })
      }
      if (patch.dayHighlights) {
        setStore((prev) => {
          const next = {
            ...prev,
            settings: {
              ...prev.settings,
              dayHighlights: { ...patch.dayHighlights }
            }
          }
          storeRef.current = next
          return next
        })
      }
      if (patch.viewOptions) {
        setStore((prev) => {
          const next = {
            ...prev,
            settings: {
              ...prev.settings,
              viewOptions: {
                ...prev.settings.viewOptions,
                ...patch.viewOptions
              }
            }
          }
          storeRef.current = next
          if (patch.viewOptions?.headerTitle !== undefined) {
            writeCachedHeaderTitle(next.settings.viewOptions.headerTitle)
          }
          return next
        })
      }
      await runOrQueue(
        'patch-settings',
        () => window.neoCalendar.patchStoreSettings(patch),
        { payload: patch },
        (_current, result) => result as CalendarStoreSnapshot
      )
    },
    [runOrQueue]
  )

  const replaceStore = useCallback(
    async (next: CalendarStoreSnapshot) => {
      await window.neoCalendar.replaceCalendarStore(next)
      await refresh()
      history.clear()
    },
    [history, refresh]
  )

  const importStore = useCallback(
    async (payload: unknown) => {
      await runOrQueue(
        'import-store',
        async () => {
          await window.neoCalendar.importCalendarStore(payload)
          return payload
        },
        { payload }
      )
      history.clear()
    },
    [history, runOrQueue]
  )

  const listMembers = useCallback(() => window.neoCalendar.listMembers(), [])
  const saveMembers = useCallback(
    async (members: MemberSaveInput[]) => {
      const next = await window.neoCalendar.saveMembers(members)
      await refresh()
      return next
    },
    [refresh]
  )

  const syncHolidays = useCallback(
    async (input?: SyncHolidaysInput) => {
      const result = await window.neoCalendar.syncHolidays(input)
      await refresh()
      return result
    },
    [refresh]
  )

  const calendarsById = useMemo(() => {
    const map = new Map<string, CalendarRecord>()
    for (const c of store.calendars) map.set(c.id, c)
    return map
  }, [store.calendars])

  const visibleEvents = useMemo(() => {
    const hiddenCompleted = store.settings.viewOptions.completedHidden
    return store.events.filter((e) => {
      const cal = calendarsById.get(e.calendarId)
      if (cal && cal.visible === false) return false
      if (hiddenCompleted && e.completed) return false
      return true
    })
  }, [store.events, store.settings.viewOptions.completedHidden, calendarsById])

  const deleteCompletedForDay = useCallback(
    async (completedEvents: CalendarEvent[], dateKey: string) => {
      const { deleted, failed, steps } = await withoutHistory(() =>
        deleteCompletedEventsForDay({
          completedEvents,
          dateKey,
          getEvents: () => storeRef.current.events,
          editEvent: performUpdateEvent,
          removeEvent: performDeleteEvent
        })
      )

      if (steps.length > 0) {
        recordHistory({
          undo: async () => {
            await withoutHistory(async () => {
              for (let i = steps.length - 1; i >= 0; i -= 1) {
                const step = steps[i]
                if (step.kind === 'deleted') {
                  const restored = await performCreateEvent(step.restore)
                  if (restored?.id) step.idRef.id = restored.id
                } else {
                  await performUpdateEvent(step.id, step.before)
                }
              }
            })
          },
          redo: async () => {
            await withoutHistory(async () => {
              for (const step of steps) {
                if (step.kind === 'deleted') {
                  await performDeleteEvent(step.idRef.id)
                } else {
                  await performUpdateEvent(step.id, step.after)
                }
              }
            })
          }
        })
      }

      return { deleted, failed }
    },
    [
      performCreateEvent,
      performDeleteEvent,
      performUpdateEvent,
      recordHistory,
      withoutHistory
    ]
  )

  return {
    store,
    loading,
    refresh,
    addEvent,
    editEvent,
    removeEvent,
    createCalendar,
    patchCalendar,
    reorderCalendars,
    deleteCalendar,
    clearCalendarEvents,
    importEventsIntoCalendar,
    setTags,
    createTag,
    patchTag,
    deleteTag,
    patchStoreSettings,
    replaceStore,
    importStore,
    listMembers,
    saveMembers,
    syncHolidays,
    calendarsById,
    visibleEvents,
    undo: history.undo,
    redo: history.redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    clearHistory: history.clear,
    deleteCompletedForDay
  }
}
