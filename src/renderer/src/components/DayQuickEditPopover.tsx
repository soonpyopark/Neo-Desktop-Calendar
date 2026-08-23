import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactElement
} from 'react'
import { createPortal } from 'react-dom'
import { useAppDialog } from './AppDialogProvider'
import { InteractionUI } from './InteractionUI'
import { listDeletableCompletedEvents } from '../lib/deleteCompletedForDay'
import { DayColorPalette } from './DayColorPalette'
import { DayHighlightPalette } from './DayHighlightPalette'
import { EventCopyDateFlyout } from './EventCopyDateFlyout'
import { EmojiPickerButton } from './EmojiPickerButton'
import { shiftDateKey } from '../lib/shiftEventDates'
import { EventAccentGlyph } from './EventAccentGlyph'
import { EventAttachButton } from './EventAttachButton'
import { EventLinkButton } from './EventLinkButton'
import { EventMarkerShapeButton } from './EventMarkerShapeButton'
import { EventTagIcons } from './EventTagIcons'
import { QuickEditCalendarButton } from './QuickEditCalendarButton'
import { QuickEditTagButton } from './QuickEditTagButton'
import { EventAttachIcon } from './EventAttachIcon'
import { EventLinkIcon } from './EventLinkIcon'
import { getEventLinks, normalizeEventLinksArray } from '../lib/eventLinks'
import { normalizeTagIds } from '../../../shared/mdcExport/eventTags.js'
import { insertTextAtCursor } from '../lib/insertAtCursor'
import { toDateKey } from '../lib/calendarUtils'
import { formatDayHeaderTitle } from '../lib/dayHeaderFormat'
import { setClickThroughEnabled, setIgnoreMouseEvents } from '../lib/mouseBridge'
import { clampFixedPosition, clampRectToViewport } from '../lib/popoverPosition'
import { HOLIDAYS_KR_CALENDAR_ID, PRIMARY_CALENDAR_ID } from '../../../shared/calendarDefaults'
import { getSeriesId, expandEventsForRange } from '../../../shared/mdcExport/eventOccurrences.js'
import { compareEventsForDayDisplay } from '../../../shared/mdcExport/eventBarFormat.js'
import type { CalendarEvent, CalendarRecord, EventLink, TagRecord } from '../../../shared/calendarTypes'
import {
  normalizeEventDensity,
  normalizeEventLetterSpacing,
  normalizeEventLetterWidth
} from '../../../shared/eventLayoutMetrics'
import type { DayReorderItem } from '../lib/dayReorder'

import {
  QUICK_EDIT_CHROME_HEIGHT,
  QUICK_EDIT_BODY_EXTRA_MONTH,
  QUICK_EDIT_MIN_BODY_HEIGHT,
  QUICK_EDIT_MONTH_YEAR_HEIGHT,
  QUICK_EDIT_MONTH_YEAR_WIDTH,
  QUICK_EDIT_YEAR_MIN_BODY,
  type QuickEditViewMode
} from '../../../shared/quickEditLayout'

export { QUICK_EDIT_YEAR_MIN_BODY } from '../../../shared/quickEditLayout'

const COLOR_PANEL_PAD = 8
/** Inset from shell content edges (principle #4). */
const VIEWPORT_PAD = 5

/** Footer swatch flyouts open above the footer and stay inside the shell. */
function buildFooterFlyoutStyle(
  trigger: HTMLElement | null,
  flyout: HTMLElement | null,
  fallback: { width: number; height: number }
): CSSProperties | undefined {
  if (!trigger) return undefined
  const ar = trigger.getBoundingClientRect()
  const footer = trigger.closest('.day-quick-edit-footer')?.getBoundingClientRect()
  const width = flyout?.offsetWidth || fallback.width
  const height = flyout?.offsetHeight || fallback.height
  const left = ar.left
  let top = (footer?.top ?? ar.top) - height - COLOR_PANEL_PAD
  if (top < VIEWPORT_PAD) top = ar.bottom + COLOR_PANEL_PAD
  const clamped = clampFixedPosition({ left, top, width, height, padding: VIEWPORT_PAD })
  return {
    position: 'fixed',
    left: Math.round(clamped.left),
    top: Math.round(clamped.top),
    zIndex: 80
  }
}

export type AnchorRect = {
  top: number
  left: number
  width: number
  height: number
}

export type DayQuickEditPopoverProps = {
  /** Inline overlay (default) or dedicated floating BrowserWindow. */
  surface?: 'inline' | 'floating'
  viewMode?: QuickEditViewMode
  dateKey: string
  date: Date
  events: CalendarEvent[]
  calendars: CalendarRecord[]
  tags: TagRecord[]
  dayColor?: string | null
  /** 형광펜 color painted behind the date number. */
  dayHighlight?: string | null
  anchorRect: AnchorRect | null
  canEdit?: boolean
  /** Pre-select a row (e.g. opened from an event bar). */
  focusEvent?: CalendarEvent | null
  /** Month view: grow taller than the day cell (MDC). */
  expandBody?: boolean
  /** Year view: minimum body height (mini day cells in year grid). */
  minBodyHeight?: number
  /** Month density (−/+ toolbar); scales list title size with main calendar. */
  eventDensity?: number
  /** Event-bar letter-spacing (−/+ AA toolbar); applies to list titles. */
  eventLetterSpacing?: number
  /** Event-title scaleX (narrow/wide A toolbar). */
  eventLetterWidth?: number
  onClose: () => void
  onCreate: (title: string, calendarId: string, tagIds?: string[], links?: EventLink[]) => void
  onToggleCompleted: (event: CalendarEvent, completed: boolean) => void
  onRemove?: (id: string) => void
  onDayColorChange: (color: string | null) => void
  onDayHighlightChange?: (color: string | null) => void
  onEventCalendarChange?: (event: CalendarEvent, calendarId: string) => void
  onEventTagChange?: (event: CalendarEvent, tagIds: string[]) => void
  onEventMarkerShapeChange?: (event: CalendarEvent, shapeId: string) => void
  onEventLinkChange?: (event: CalendarEvent, links: EventLink[]) => void
  onReorderEvents?: (ordered: DayReorderItem[], dayKey: string) => void | Promise<void>
  onShiftEvent?: (event: CalendarEvent, deltaDays: number) => void | Promise<void>
  /** Copy selected event onto another date (single instance; closes panel after). */
  onCopyEvent?: (event: CalendarEvent, targetDateKey: string) => void | Promise<void>
  onOpenMore: (event?: CalendarEvent | null) => void
  onOpenEvent?: (
    event: CalendarEvent,
    pointer?: { x: number; y: number; screenX?: number; screenY?: number }
  ) => void
  onEditEvent?: (event: CalendarEvent) => void
  onAttachFiles?: (event: CalendarEvent) => void | Promise<void>
  /** Bulk-delete completed rows for this day (recurring = this date only). */
  onDeleteCompleted?: (completedEvents: CalendarEvent[]) => void | Promise<void>
  /** Inline stack order (browser / unlocked desktop). Default 35. */
  zIndex?: number
  /** Raise this panel above sibling overlays (e.g. event detail). */
  onRaise?: () => void
  /**
   * Close a sibling event-detail popover when the user goes back to working in
   * this panel (padding, checkbox, marker, footer) — event titles keep opening it.
   */
  onDismissEventDetail?: () => void
}


function buildQuickEditStyle(
  anchorRect: AnchorRect | null,
  options?: {
    viewMode?: QuickEditViewMode
    bodyExtra?: number
    minBodyHeight?: number
  }
): CSSProperties | undefined {
  const viewMode = options?.viewMode ?? 'week'
  const bodyExtra = options?.bodyExtra ?? 0
  const floorBody = options?.minBodyHeight ?? 0
  // Pointer-only anchors (0×0) must not drive cell-relative sizing — use the
  // centered fallback panel instead of collapsing to the minimum height.
  const usableAnchor =
    anchorRect && anchorRect.width > 0 && anchorRect.height > 0 ? anchorRect : null

  if (viewMode !== 'week') {
    const width = QUICK_EDIT_MONTH_YEAR_WIDTH
    const height = QUICK_EDIT_MONTH_YEAR_HEIGHT
    const left = usableAnchor
      ? usableAnchor.left + usableAnchor.width / 2 - width / 2
      : (window.innerWidth - width) / 2
    const top = usableAnchor
      ? usableAnchor.top + usableAnchor.height / 2 - height / 2
      : (window.innerHeight - height) / 2
    const clamped = clampRectToViewport({
      top,
      left,
      width,
      height,
      padding: VIEWPORT_PAD
    })
    const fittedBody = Math.max(
      QUICK_EDIT_MIN_BODY_HEIGHT,
      clamped.maxHeight - QUICK_EDIT_CHROME_HEIGHT
    )
    return {
      top: clamped.top,
      left: clamped.left,
      width: clamped.width,
      height: clamped.maxHeight,
      maxHeight: clamped.maxHeight,
      '--day-quick-edit-body-height': `${fittedBody}px`
    } as CSSProperties
  }

  if (!usableAnchor) {
    const width = QUICK_EDIT_MONTH_YEAR_WIDTH
    const height = Math.max(280, floorBody + QUICK_EDIT_CHROME_HEIGHT)
    const clamped = clampRectToViewport({
      top: (window.innerHeight - height) / 2,
      left: (window.innerWidth - width) / 2,
      width,
      height,
      padding: VIEWPORT_PAD
    })
    const fittedBody = Math.max(
      floorBody || QUICK_EDIT_MIN_BODY_HEIGHT,
      clamped.maxHeight - QUICK_EDIT_CHROME_HEIGHT
    )
    return {
      top: clamped.top,
      left: clamped.left,
      width: clamped.width,
      height: clamped.maxHeight,
      maxHeight: clamped.maxHeight,
      '--day-quick-edit-body-height': `${fittedBody}px`
    } as CSSProperties
  }

  const padX = 12
  const width = Math.max(usableAnchor.width + padX * 2, QUICK_EDIT_MONTH_YEAR_WIDTH)
  const desiredBody = Math.max(
    floorBody,
    Math.round(usableAnchor.height) + bodyExtra,
    bodyExtra > 0 ? 160 : QUICK_EDIT_MIN_BODY_HEIGHT
  )
  const height = desiredBody + QUICK_EDIT_CHROME_HEIGHT
  const left = usableAnchor.left + usableAnchor.width / 2 - width / 2
  const top = usableAnchor.top + usableAnchor.height / 2 - height / 2
  const clamped = clampRectToViewport({
    top,
    left,
    width,
    height,
    padding: VIEWPORT_PAD
  })
  // Keep chrome + body inside the clamped panel height (principle #4).
  const fittedBody = Math.max(
    floorBody || QUICK_EDIT_MIN_BODY_HEIGHT,
    clamped.maxHeight - QUICK_EDIT_CHROME_HEIGHT
  )

  return {
    top: clamped.top,
    left: clamped.left,
    width: clamped.width,
    height: clamped.maxHeight,
    maxHeight: clamped.maxHeight,
    '--day-quick-edit-body-height': `${fittedBody}px`
  } as CSSProperties
}

function defaultCalendarId(calendars: CalendarRecord[]): string {
  const editable = calendars.filter(
    (c) => c.id !== HOLIDAYS_KR_CALENDAR_ID && c.visible !== false
  )
  return editable[0]?.id || PRIMARY_CALENDAR_ID
}

export function DayQuickEditPopover({
  surface = 'inline',
  viewMode = 'month',
  dateKey,
  date,
  events,
  calendars,
  tags,
  dayColor = null,
  dayHighlight = null,
  anchorRect,
  canEdit = true,
  focusEvent = null,
  expandBody = false,
  minBodyHeight = 0,
  eventDensity = 1,
  eventLetterSpacing,
  eventLetterWidth,
  onClose,
  onCreate,
  onToggleCompleted,
  onDayColorChange,
  onDayHighlightChange,
  onEventCalendarChange,
  onEventTagChange,
  onEventMarkerShapeChange,
  onEventLinkChange,
  onReorderEvents,
  onShiftEvent,
  onCopyEvent,
  onOpenMore,
  onEditEvent,
  onOpenEvent,
  onAttachFiles,
  onDeleteCompleted,
  zIndex = 35,
  onRaise,
  onDismissEventDetail
}: DayQuickEditPopoverProps): ReactElement {
  const { confirm } = useAppDialog()
  const isFloating = surface === 'floating'
  const [title, setTitle] = useState('')
  const [draftCalendarId, setDraftCalendarId] = useState(() => defaultCalendarId(calendars))
  const [draftTagIds, setDraftTagIds] = useState<string[]>([])
  const [draftLinks, setDraftLinks] = useState<EventLink[]>([])
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(focusEvent)
  const [copyFlyoutOpen, setCopyFlyoutOpen] = useState(false)
  const [copyBusy, setCopyBusy] = useState(false)
  const copyTriggerRef = useRef<HTMLButtonElement>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteStyle, setPaletteStyle] = useState<CSSProperties | undefined>()
  const [optimisticDayColor, setOptimisticDayColor] = useState<string | null>(dayColor)
  const [highlightOpen, setHighlightOpen] = useState(false)
  const [highlightStyle, setHighlightStyle] = useState<CSSProperties | undefined>()
  const [optimisticDayHighlight, setOptimisticDayHighlight] = useState<string | null>(dayHighlight)
  const [saving, setSaving] = useState(false)
  const [deletingCompleted, setDeletingCompleted] = useState(false)
  const [orderOverride, setOrderOverride] = useState<string[] | null>(null)
  const [dragSeriesId, setDragSeriesId] = useState<string | null>(null)
  const [dropSeriesId, setDropSeriesId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const colorTriggerRef = useRef<HTMLButtonElement>(null)
  const paletteFlyoutRef = useRef<HTMLDivElement>(null)
  const highlightTriggerRef = useRef<HTMLButtonElement>(null)
  const highlightFlyoutRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const eventClickTimerRef = useRef<number | null>(null)
  const suppressEventClickRef = useRef(false)
  const bodyExtra = expandBody ? QUICK_EDIT_BODY_EXTRA_MONTH : 0
  const styleOptions = {
    viewMode,
    bodyExtra,
    minBodyHeight: minBodyHeight || undefined
  }
  const densityCssVars = useMemo(
    () =>
      ({
        '--event-density': String(normalizeEventDensity(eventDensity)),
        '--event-letter-spacing': `${normalizeEventLetterSpacing(eventLetterSpacing)}em`,
        '--event-letter-width': String(normalizeEventLetterWidth(eventLetterWidth))
      }) as CSSProperties,
    [eventDensity, eventLetterSpacing, eventLetterWidth]
  )

  // Reopening the panel on another day must not keep the previous day's swatches.
  const optimisticDayKeyRef = useRef(dateKey)
  useEffect(() => {
    if (optimisticDayKeyRef.current === dateKey) return
    optimisticDayKeyRef.current = dateKey
    setOptimisticDayColor(dayColor)
    setOptimisticDayHighlight(dayHighlight)
  }, [dateKey, dayColor, dayHighlight])

  const clearEventClickTimer = (): void => {
    if (eventClickTimerRef.current != null) {
      window.clearTimeout(eventClickTimerRef.current)
      eventClickTimerRef.current = null
    }
  }

  useEffect(
    () => () => {
      clearEventClickTimer()
    },
    []
  )

  const openEventDetailFromRow = (
    item: CalendarEvent,
    pointer?: { x: number; y: number; screenX?: number; screenY?: number }
  ): void => {
    setSelectedEvent(item)
    clearEventClickTimer()
    eventClickTimerRef.current = window.setTimeout(() => {
      eventClickTimerRef.current = null
      if (suppressEventClickRef.current) {
        suppressEventClickRef.current = false
        return
      }
      onOpenEvent?.(item, pointer)
    }, 250)
  }

  const [style, setStyle] = useState<CSSProperties | undefined>(() =>
    buildQuickEditStyle(anchorRect, styleOptions)
  )

  // Portaled flyouts (calendar/tag/emoji/…) sit outside this InteractionUI box.
  // While open, keep click-through off so desktop mode still delivers clicks to them.
  useEffect(() => {
    if (isFloating) return
    setClickThroughEnabled(false)
    setIgnoreMouseEvents(false)
    return () => {
      // Restore shell policy: window mode / undocked desktop keep capture;
      // only WorkerW-embedded resumes click-through.
      const windowLike = Boolean(document.querySelector('.wallpaper-root.is-window-mode'))
      setClickThroughEnabled(!windowLike)
    }
  }, [isFloating])

  // Principle #4: remeasure after layout / resize so the panel never leaves the window.
  useLayoutEffect(() => {
    if (isFloating) {
      const base = buildQuickEditStyle(anchorRect, styleOptions)
      const bodyVar = (base as CSSProperties & { '--day-quick-edit-body-height'?: string })[
        '--day-quick-edit-body-height'
      ]
      setStyle({
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        maxHeight: '100%',
        ...(bodyVar ? { '--day-quick-edit-body-height': bodyVar } : {})
      } as CSSProperties)
      return undefined
    }

    const base = buildQuickEditStyle(anchorRect, styleOptions)
    setStyle(base)

    const panel = panelRef.current
    if (!panel || !base) return undefined

    const minPanelFromBody = minBodyHeight
      ? minBodyHeight + QUICK_EDIT_CHROME_HEIGHT
      : 0

    const apply = (): void => {
      const desiredTop = typeof base.top === 'number' ? base.top : panel.getBoundingClientRect().top
      const desiredLeft =
        typeof base.left === 'number' ? base.left : panel.getBoundingClientRect().left
      const measured = panel.getBoundingClientRect()
      const width = Math.max(measured.width, Number(base.width) || 300)
      const height = Math.max(
        measured.height,
        Number(base.height) || 120,
        minPanelFromBody
      )
      const clamped = clampRectToViewport({
        top: desiredTop,
        left: desiredLeft,
        width,
        height,
        padding: VIEWPORT_PAD
      })
      const fittedBody = Math.max(
        minBodyHeight || QUICK_EDIT_MIN_BODY_HEIGHT,
        clamped.maxHeight - QUICK_EDIT_CHROME_HEIGHT
      )
      const next: CSSProperties = {
        top: clamped.top,
        left: clamped.left,
        width: clamped.width,
        height: clamped.maxHeight,
        maxHeight: clamped.maxHeight,
        '--day-quick-edit-body-height': `${fittedBody}px`
      } as CSSProperties
      setStyle((prev) => {
        if (
          prev &&
          prev.top === next.top &&
          prev.left === next.left &&
          prev.width === next.width &&
          prev.height === next.height &&
          prev.maxHeight === next.maxHeight &&
          (prev as CSSProperties & { ['--day-quick-edit-body-height']?: string })[
            '--day-quick-edit-body-height'
          ] === fittedBody + 'px'
        ) {
          return prev
        }
        return next
      })
    }

    apply()
    const raf = window.requestAnimationFrame(apply)
    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => apply()) : null
    ro?.observe(panel)
    window.addEventListener('resize', apply)
    return () => {
      window.cancelAnimationFrame(raf)
      ro?.disconnect()
      window.removeEventListener('resize', apply)
    }
  }, [anchorRect, bodyExtra, expandBody, isFloating, minBodyHeight])

  const resolvedDayKey = dateKey || (date ? toDateKey(date) : '')

  const storeDayEvents = useMemo(() => {
    if (!resolvedDayKey) return []
    return expandEventsForRange(events, resolvedDayKey, resolvedDayKey)
      .slice()
      .sort((a, b) => compareEventsForDayDisplay(a, b, resolvedDayKey))
  }, [events, resolvedDayKey])
  const dayEvents = useMemo(() => {
    if (!orderOverride?.length) return storeDayEvents
    const holidays = storeDayEvents.filter((event) => event.calendarId === HOLIDAYS_KR_CALENDAR_ID)
    const movable = storeDayEvents.filter((event) => event.calendarId !== HOLIDAYS_KR_CALENDAR_ID)
    const byId = new Map(movable.map((event) => [getSeriesId(event) || event.id, event]))
    const ordered: CalendarEvent[] = []
    for (const id of orderOverride) {
      const event = byId.get(id)
      if (event) {
        ordered.push(event)
        byId.delete(id)
      }
    }
    for (const event of Array.from(byId.values())) ordered.push(event)
    return [...holidays, ...ordered]
  }, [storeDayEvents, orderOverride])

  const completedDeletable = useMemo(
    () => listDeletableCompletedEvents(dayEvents),
    [dayEvents]
  )

  const handleDeleteCompleted = (): void => {
    if (!canEdit || !onDeleteCompleted || deletingCompleted) return
    const targets = listDeletableCompletedEvents(dayEvents)
    if (targets.length === 0) return
    void (async () => {
      const ok = await confirm(
        `완료된 일정 ${targets.length}건을 삭제할까요?\n(반복 일정은 이 날짜만 삭제됩니다.)`,
        { variant: 'danger', confirmLabel: '삭제' }
      )
      if (!ok) return
      setDeletingCompleted(true)
      try {
        await onDeleteCompleted(targets)
      } finally {
        setDeletingCompleted(false)
      }
    })()
  }

  const displayDayColor = optimisticDayColor
  const displayDayHighlight = optimisticDayHighlight

  const activeCalendarId =
    selectedEvent && selectedEvent.calendarId !== HOLIDAYS_KR_CALENDAR_ID
      ? selectedEvent.calendarId
      : draftCalendarId
  const activeTagIds =
    selectedEvent && selectedEvent.calendarId !== HOLIDAYS_KR_CALENDAR_ID
      ? normalizeTagIds(selectedEvent.tagIds)
      : draftTagIds
  const linkList = selectedEvent ? getEventLinks(selectedEvent) : draftLinks

  useEffect(() => {
    setTitle('')
    setDraftLinks([])
    setDraftCalendarId(defaultCalendarId(calendars))
    setDraftTagIds([])
    setPaletteOpen(false)
    setSelectedEvent(focusEvent)
    setOptimisticDayColor(dayColor)
    setOrderOverride(null)
    setDragSeriesId(null)
    setDropSeriesId(null)
    setSaving(false)
    setDeletingCompleted(false)
    const id = window.setTimeout(() => {
      if (!focusEvent) inputRef.current?.focus()
    }, 30)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed only when day/focus changes
  }, [resolvedDayKey, focusEvent])

  useEffect(() => {
    setOptimisticDayColor(dayColor)
  }, [dayColor])

  useEffect(() => {
    if (!orderOverride) return
    const movable = storeDayEvents.filter((event) => event.calendarId !== HOLIDAYS_KR_CALENDAR_ID)
    const current = movable.map((event) => getSeriesId(event) || event.id)
    if (
      current.length === orderOverride.length &&
      current.every((id, index) => id === orderOverride[index])
    ) {
      setOrderOverride(null)
    }
  }, [storeDayEvents, orderOverride])

  const reorderMovable = (fromSeriesId: string, toSeriesId: string): void => {
    if (!canEdit || !fromSeriesId || !toSeriesId || fromSeriesId === toSeriesId) return
    const movable = dayEvents.filter((event) => event.calendarId !== HOLIDAYS_KR_CALENDAR_ID)
    const fromIndex = movable.findIndex(
      (event) => (getSeriesId(event) || event.id) === fromSeriesId
    )
    const toIndex = movable.findIndex((event) => (getSeriesId(event) || event.id) === toSeriesId)
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return
    const next = [...movable]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    setOrderOverride(next.map((event) => getSeriesId(event) || event.id))
    setSelectedEvent(moved)
    void onReorderEvents?.(
      next.map((event, index) => ({ event, sortOrder: index })),
      resolvedDayKey
    )
  }

  // Keep selected row in sync when store patches the same occurrence (MDC).
  useEffect(() => {
    if (!selectedEvent) return
    const sid = getSeriesId(selectedEvent) || selectedEvent.id
    const live = dayEvents.find((event) => (getSeriesId(event) || event.id) === sid)
    if (!live) {
      setSelectedEvent(null)
      return
    }
    const prevCount = Array.isArray(selectedEvent.attachments) ? selectedEvent.attachments.length : 0
    const nextCount = Array.isArray(live.attachments) ? live.attachments.length : 0
    const prevTags = normalizeTagIds(selectedEvent.tagIds).join('\0')
    const nextTags = normalizeTagIds(live.tagIds).join('\0')
    if (
      prevCount !== nextCount ||
      selectedEvent.completed !== live.completed ||
      selectedEvent.calendarId !== live.calendarId ||
      selectedEvent.title !== live.title ||
      prevTags !== nextTags
    ) {
      setSelectedEvent(live)
    }
  }, [dayEvents, selectedEvent])

  useEffect(() => {
    if (!selectedEvent) return
    const live = dayEvents.find((event) => event.id === selectedEvent.id)
    if (!live) {
      setSelectedEvent(null)
      return
    }
    if (
      live.completed !== selectedEvent.completed
      || live.calendarId !== selectedEvent.calendarId
      || live.title !== selectedEvent.title
      || (live.tagIds ?? []).join('\0') !== (selectedEvent.tagIds ?? []).join('\0')
      || live.markerShape !== selectedEvent.markerShape
      || JSON.stringify(live.links ?? []) !== JSON.stringify(selectedEvent.links ?? [])
    ) {
      setSelectedEvent(live)
    }
  }, [dayEvents, selectedEvent])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // Portaled choosers / viewers handle Esc first — leave quick edit alone.
      if (document.querySelector('.event-resource-list-root')) return
      if (document.querySelector('.attachment-viewer-root')) return
      if (paletteOpen) {
        setPaletteOpen(false)
        return
      }
      if (highlightOpen) {
        setHighlightOpen(false)
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, paletteOpen, highlightOpen])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      // Keep open while interacting with the panel or its portaled flyouts.
      if (target.closest('.day-quick-edit')) return
      if (target.closest('.day-quick-edit-palette-flyout')) return
      if (target.closest('.day-quick-edit-highlight-flyout')) return
      if (target.closest('.quick-edit-calendar-flyout')) return
      if (target.closest('.quick-edit-tag-root')) return
      if (target.closest('.marker-shape-flyout-panel')) return
      if (target.closest('.event-link-flyout')) return
      if (target.closest('.emoji-picker-panel')) return
      if (target.closest('.custom-color-panel')) return
      // Sibling overlays opened from this day list (browser / unlocked desktop).
      // Without these, clicking detail trash / delete confirm closes QE too early.
      if (target.closest('.app-dialog-root')) return
      if (target.closest('.event-detail-shell')) return
      if (target.closest('.event-copy-date-flyout')) return
      if (target.closest('.recurrence-scope-shell')) return
      if (target.closest('.event-editor-shell')) return
      // Link / attachment chooser + image viewer are portaled to body.
      if (target.closest('.event-resource-list-root')) return
      if (target.closest('.attachment-viewer-root')) return
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [onClose])

  // Day-color / highlight palettes close when the click is outside the flyout
  // (including clicks inside the quick-edit panel itself).
  useEffect(() => {
    if (!paletteOpen && !highlightOpen) return undefined
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (paletteOpen) {
        const inPalette =
          Boolean(target.closest('.day-quick-edit-palette-flyout'))
          || Boolean(target.closest('.custom-color-panel'))
          || Boolean(colorTriggerRef.current?.contains(target))
        if (!inPalette) setPaletteOpen(false)
      }
      if (highlightOpen) {
        const inHighlight =
          Boolean(target.closest('.day-quick-edit-highlight-flyout'))
          || Boolean(target.closest('.custom-color-panel'))
          || Boolean(highlightTriggerRef.current?.contains(target))
        if (!inHighlight) setHighlightOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [paletteOpen, highlightOpen])

  useEffect(() => {
    if (!paletteOpen) {
      setPaletteStyle(undefined)
      return
    }
    const place = (): void => {
      setPaletteStyle(
        buildFooterFlyoutStyle(colorTriggerRef.current, paletteFlyoutRef.current, {
          width: 210,
          height: 100
        })
      )
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [paletteOpen])

  useEffect(() => {
    if (!highlightOpen) {
      setHighlightStyle(undefined)
      return
    }
    const place = (): void => {
      setHighlightStyle(
        buildFooterFlyoutStyle(highlightTriggerRef.current, highlightFlyoutRef.current, {
          width: 210,
          height: 100
        })
      )
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [highlightOpen])

  const submitTitle = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const next = title.trim()
    if (!canEdit || !next || saving) return
    setSaving(true)
    try {
      onCreate(next, draftCalendarId, draftTagIds, draftLinks)
      setTitle('')
      setDraftTagIds([])
      setDraftLinks([])
      setSelectedEvent(null)
    } finally {
      setSaving(false)
    }
  }

  const handleCalendarChange = (calendarId: string): void => {
    if (selectedEvent && selectedEvent.calendarId !== HOLIDAYS_KR_CALENDAR_ID) {
      onEventCalendarChange?.(selectedEvent, calendarId)
      return
    }
    setDraftCalendarId(calendarId)
  }

  const handleTagChange = (tagIds: string[]): void => {
    const next = normalizeTagIds(tagIds)
    if (selectedEvent && selectedEvent.calendarId !== HOLIDAYS_KR_CALENDAR_ID) {
      onEventTagChange?.(selectedEvent, next)
      return
    }
    setDraftTagIds(next)
  }

  const handleLinksChange = (links: EventLink[]): void => {
    const normalized = normalizeEventLinksArray(links)
    if (selectedEvent && selectedEvent.calendarId !== HOLIDAYS_KR_CALENDAR_ID) {
      onEventLinkChange?.(selectedEvent, normalized)
      return
    }
    setDraftLinks(normalized)
  }

  const insertEmoji = (emoji: string): void => {
    const el = inputRef.current
    const { nextValue, nextPos } = insertTextAtCursor(el, title, emoji)
    setTitle(nextValue)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(nextPos, nextPos)
    })
  }

  return (
    <>
      {!isFloating ? (
        <div
          className="day-quick-edit-backdrop interaction-ui"
          role="presentation"
          onClick={onClose}
          onMouseEnter={() => setIgnoreMouseEvents(false)}
          onMouseLeave={() => setIgnoreMouseEvents(true, { forwardToOverlay: true })}
        />
      ) : null}
      <InteractionUI
        ref={panelRef}
        captureOnHover={!isFloating}
        className={`day-quick-edit day-quick-edit--event fixed flex flex-col overflow-hidden rounded-xl bg-gcal-surface${isFloating ? '' : ' shadow-g-lg'}`}
        style={{ ...style, ...densityCssVars, zIndex }}
        role="dialog"
        aria-label={`${formatDayHeaderTitle(date)} 빠른 편집`}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => {
          e.stopPropagation()
          onRaise?.()
          const target = e.target as HTMLElement | null
          if (!target?.closest('.day-quick-edit-item-title')) {
            onDismissEventDetail?.()
          }
        }}
      >
        <header className="day-quick-edit-header">
          <h2 className="day-quick-edit-title">{formatDayHeaderTitle(date)}</h2>
          <button type="button" className="day-quick-edit-close" onClick={onClose} aria-label="닫기">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
              <path
                fill="currentColor"
                d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
              />
            </svg>
          </button>
        </header>

        <div className="day-quick-edit-body">
          <form
            className="day-quick-edit-create flex items-center gap-1.5"
            onSubmit={(e) => void submitTitle(e)}
            onMouseDown={(e) => {
              if (!canEdit || saving) return
              const target = e.target as Element
              // Emoji/calendar/shape triggers & panels manage their own focus — don't steal it mid-click.
              if (target.closest?.('.emoji-picker-root')) return
              if (target.closest?.('.quick-edit-calendar-root')) return
              if (target.closest?.('.quick-edit-tag-root')) return
              if (target.closest?.('.marker-shape-picker-root')) return
              if (e.target === inputRef.current) return
              e.preventDefault()
              inputRef.current?.focus({ preventScroll: true })
            }}
          >
            <EmojiPickerButton
              title="이모지 추가"
              disabled={!canEdit || saving}
              flyoutAnchor="quick-edit-input-row"
              onSelect={insertEmoji}
            />
            <QuickEditCalendarButton
              calendars={calendars}
              value={activeCalendarId}
              disabled={
                !canEdit
                || saving
                || Boolean(selectedEvent && selectedEvent.calendarId === HOLIDAYS_KR_CALENDAR_ID)
              }
              onChange={handleCalendarChange}
            />
            <QuickEditTagButton
              tags={tags}
              value={activeTagIds}
              disabled={
                !canEdit
                || saving
                || Boolean(selectedEvent && selectedEvent.calendarId === HOLIDAYS_KR_CALENDAR_ID)
              }
              onChange={handleTagChange}
            />
            <input
              ref={inputRef}
              type="text"
              className="day-quick-edit-input flex-1"
              placeholder={canEdit ? '일정 추가 (종일)' : '로그인 후 추가할 수 있습니다'}
              value={title}
              disabled={!canEdit || saving}
              onChange={(e) => setTitle(e.target.value)}
              onFocus={() => setSelectedEvent(null)}
            />
          </form>

          <ul
            className="day-quick-edit-list settings-scroll"
            onMouseDown={(e) => {
              // Empty list area below items — clear the selected row highlight / footer target.
              if (e.target === e.currentTarget) {
                setSelectedEvent(null)
              }
            }}
          >
            {dayEvents.length === 0 ? (
              <li className="day-quick-edit-empty">등록된 일정이 없습니다</li>
            ) : (
              dayEvents.map((item) => {
                const isHoliday = item.calendarId === HOLIDAYS_KR_CALENDAR_ID
                const canDrag = canEdit && Boolean(onReorderEvents) && !isHoliday
                const completed = Boolean(item.completed)
                const cal = calendars.find((c) => c.id === item.calendarId)
                const accent = completed ? '#9aa0a6' : (item.color ?? cal?.color ?? '#f6bf26')
                const seriesId = getSeriesId(item) || item.id
                const selectedId = selectedEvent
                  ? getSeriesId(selectedEvent) || selectedEvent.id
                  : null
                const isSelected = Boolean(selectedId && seriesId === selectedId)
                const isDragging = dragSeriesId === seriesId
                const isDropTarget = Boolean(
                  canDrag && dropSeriesId === seriesId && dragSeriesId && dragSeriesId !== seriesId
                )
                const hasLinkOrAttach =
                  getEventLinks(item).length > 0 ||
                  (Array.isArray(item.attachments) && item.attachments.length > 0)
                return (
                  <li
                    key={`${seriesId}-${resolvedDayKey}`}
                    className={`day-quick-edit-item${isDragging ? ' is-dragging' : ''}${
                      isDropTarget ? ' is-drop-target' : ''
                    }`}
                  >
                    <div
                      className={`day-quick-edit-row${completed ? ' is-completed' : ''}${
                        isSelected ? ' is-selected' : ''
                      }${canDrag ? ' is-draggable' : ''}`}
                      draggable={canDrag}
                      onDragStart={(e) => {
                        if (!canDrag) return
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/plain', seriesId)
                        setDragSeriesId(seriesId)
                        setSelectedEvent(item)
                      }}
                      onDragEnd={() => {
                        setDragSeriesId(null)
                        setDropSeriesId(null)
                      }}
                      onDragOver={(e) => {
                        if (!canDrag || !dragSeriesId || dragSeriesId === seriesId) return
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                        if (dropSeriesId !== seriesId) setDropSeriesId(seriesId)
                      }}
                      onDragLeave={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                          setDropSeriesId((current) => (current === seriesId ? null : current))
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        const fromId = e.dataTransfer.getData('text/plain') || dragSeriesId
                        setDragSeriesId(null)
                        setDropSeriesId(null)
                        if (fromId) reorderMovable(fromId, seriesId)
                      }}
                    >
                      <input
                        type="checkbox"
                        className="day-quick-edit-check"
                        checked={completed}
                        disabled={!canEdit || isHoliday}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          if (isHoliday) return
                          setSelectedEvent(item)
                          onToggleCompleted(item, e.target.checked)
                        }}
                      />
                      {/* Marks focus the row (footer target); dblclick opens the editor. */}
                      <span
                        className="day-quick-edit-row-marks"
                        role="presentation"
                        onClick={(e) => {
                          e.stopPropagation()
                          clearEventClickTimer()
                          setSelectedEvent(item)
                        }}
                        onDoubleClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          clearEventClickTimer()
                          suppressEventClickRef.current = true
                          setSelectedEvent(item)
                          if (isHoliday) return
                          onEditEvent?.(item)
                        }}
                      >
                        <EventAccentGlyph
                          shapeId={item.markerShape}
                          color={accent}
                          variant="dot"
                          className="shrink-0"
                          title={cal?.name}
                        />
                        <EventTagIcons event={item} tags={tags} />
                      </span>
                      <span
                        className="day-quick-edit-item-title"
                        title={item.title}
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation()
                          openEventDetailFromRow(item, {
                            x: e.clientX,
                            y: e.clientY,
                            screenX: e.screenX,
                            screenY: e.screenY
                          })
                        }}
                        onDoubleClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          clearEventClickTimer()
                          suppressEventClickRef.current = true
                          setSelectedEvent(item)
                          if (isHoliday) return
                          onEditEvent?.(item)
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return
                          e.preventDefault()
                          e.stopPropagation()
                          clearEventClickTimer()
                          setSelectedEvent(item)
                          if (e.key === 'Enter') onOpenEvent?.(item)
                        }}
                      >
                        {item.title}
                      </span>
                      {hasLinkOrAttach ? (
                        <span className="day-quick-edit-trailing">
                          <EventLinkIcon event={item} />
                          <EventAttachIcon event={item} />
                        </span>
                      ) : null}
                    </div>
                  </li>
                )
              })
            )}
          </ul>
        </div>

        <footer className="day-quick-edit-footer">
          <div className="day-quick-edit-footer-left">
            {onDayHighlightChange ? (
              <button
                ref={highlightTriggerRef}
                type="button"
                className={`day-quick-edit-highlight-trigger${
                  displayDayHighlight ? ' has-highlight' : ''
                }`}
                title="날짜 강조"
                aria-label="날짜 강조"
                aria-expanded={highlightOpen}
                disabled={!canEdit}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setPaletteOpen(false)
                  setHighlightOpen((open) => !open)
                }}
              >
                <svg
                  className="day-quick-edit-highlight-icon"
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  aria-hidden
                >
                  <path
                    d="M12 2.6l2.7 5.48 6.05.88-4.38 4.27 1.03 6.02L12 16.4l-5.4 2.85 1.03-6.02-4.38-4.27 6.05-.88L12 2.6z"
                    fill={displayDayHighlight ?? 'currentColor'}
                  />
                </svg>
              </button>
            ) : null}
            <button
              ref={colorTriggerRef}
              type="button"
              className={`day-quick-edit-color-trigger${displayDayColor ? ' has-color' : ''}`}
              style={displayDayColor ? { backgroundColor: displayDayColor } : undefined}
              title="날짜 칸 테두리 색상"
              aria-label="날짜 칸 테두리 색상"
              aria-expanded={paletteOpen}
              disabled={!canEdit}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setHighlightOpen(false)
                setPaletteOpen((open) => !open)
              }}
            >
              {!displayDayColor ? (
                <svg
                  className="day-quick-edit-color-palette-icon"
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  aria-hidden
                >
                  <path
                    fill="currentColor"
                    d="M12 22C6.49 22 2 17.51 2 12S6.49 2 12 2s10 4.04 10 9c0 3.31-2.69 6-6 6h-1.77c-.28 0-.5.22-.5.5 0 .12.05.23.13.33.41.47.64 1.06.64 1.67A2.5 2.5 0 0 1 12 22zm0-16c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3zm-5 3.5c-.83 0-1.5-.67-1.5-1.5S6.17 6.5 7 6.5s1.5.67 1.5 1.5S7.83 9.5 7 9.5zm10 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM7 15.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm3-8c-.83 0-1.5-.67-1.5-1.5S9.17 4.5 10 4.5s1.5.67 1.5 1.5S10.83 7.5 10 7.5z"
                  />
                </svg>
              ) : null}
            </button>
            <EventMarkerShapeButton
              value={selectedEvent?.markerShape}
              color={
                selectedEvent
                  ? (calendars.find((c) => c.id === selectedEvent.calendarId)?.color ??
                    selectedEvent.color ??
                    '#1a73e8')
                  : '#1a73e8'
              }
              disabled={
                !canEdit
                || !selectedEvent
                || selectedEvent.calendarId === HOLIDAYS_KR_CALENDAR_ID
              }
              onChange={(shapeId) => {
                if (selectedEvent) onEventMarkerShapeChange?.(selectedEvent, shapeId)
              }}
            />
            <EventLinkButton
              links={linkList}
              onChange={handleLinksChange}
              disabled={
                !canEdit
                || Boolean(selectedEvent && selectedEvent.calendarId === HOLIDAYS_KR_CALENDAR_ID)
              }
            />
            <EventAttachButton
              count={Array.isArray(selectedEvent?.attachments) ? selectedEvent.attachments.length : 0}
              disabled={
                !canEdit
                || !selectedEvent
                || selectedEvent.calendarId === HOLIDAYS_KR_CALENDAR_ID
              }
              title="파일 첨부"
              onClick={() => {
                if (selectedEvent) void onAttachFiles?.(selectedEvent)
              }}
            />
            {[-1, 1].map((deltaDays) => {
              const label = deltaDays < 0 ? '-1D' : '+1D'
              const disabled =
                !canEdit ||
                !selectedEvent ||
                selectedEvent.calendarId === HOLIDAYS_KR_CALENDAR_ID ||
                !onShiftEvent
              return (
                <button
                  key={deltaDays}
                  type="button"
                  className="day-quick-edit-edit text-[9px] font-bold tabular-nums"
                  title={deltaDays < 0 ? '1일 전으로 이동' : '1일 후로 이동'}
                  aria-label={deltaDays < 0 ? '1일 전으로 이동' : '1일 후로 이동'}
                  disabled={disabled}
                  onClick={() => {
                    if (!selectedEvent || disabled) return
                    void onShiftEvent(selectedEvent, deltaDays)
                  }}
                >
                  {label}
                </button>
              )
            })}
            {(() => {
              const copyDisabled =
                !canEdit ||
                !selectedEvent ||
                selectedEvent.calendarId === HOLIDAYS_KR_CALENDAR_ID ||
                !onCopyEvent ||
                copyBusy
              return (
                <button
                  ref={copyTriggerRef}
                  type="button"
                  className="day-quick-edit-edit"
                  title="다른 날짜로 복사"
                  aria-label="다른 날짜로 복사"
                  aria-expanded={copyFlyoutOpen}
                  disabled={copyDisabled}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (copyDisabled) return
                    setCopyFlyoutOpen((open) => !open)
                  }}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
                    <path
                      fill="currentColor"
                      d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"
                    />
                  </svg>
                </button>
              )
            })()}
            <button
              type="button"
              className="day-quick-edit-edit"
              title="상세 일정 편집"
              aria-label="상세 일정 편집"
              onClick={() => onOpenMore(selectedEvent)}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
                <path
                  fill="currentColor"
                  d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"
                />
              </svg>
            </button>
            {onDeleteCompleted ? (
              <button
                type="button"
                className="day-quick-edit-edit"
                title={
                  completedDeletable.length > 0
                    ? `완료된 일정 ${completedDeletable.length}건 삭제`
                    : '완료된 일정 삭제'
                }
                aria-label="완료된 일정 삭제"
                disabled={
                  !canEdit || completedDeletable.length === 0 || deletingCompleted
                }
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handleDeleteCompleted()
                }}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
                  <path
                    fill="currentColor"
                    d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
                  />
                </svg>
              </button>
            ) : null}
          </div>
        </footer>
      </InteractionUI>

      <EventCopyDateFlyout
        open={copyFlyoutOpen}
        defaultDate={shiftDateKey(dateKey, 1)}
        anchorRef={copyTriggerRef}
        busy={copyBusy}
        onClose={() => {
          if (!copyBusy) setCopyFlyoutOpen(false)
        }}
        onConfirm={async (targetDate) => {
          if (!selectedEvent || !onCopyEvent || copyBusy) return
          setCopyBusy(true)
          try {
            await onCopyEvent(selectedEvent, targetDate)
            setCopyFlyoutOpen(false)
          } finally {
            setCopyBusy(false)
          }
        }}
      />

      {paletteOpen && canEdit
        ? createPortal(
            <InteractionUI
              ref={paletteFlyoutRef}
              className="day-quick-edit-palette-flyout"
              style={paletteStyle ?? { position: 'fixed', visibility: 'hidden', zIndex: 80 }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <DayColorPalette
                compact
                value={displayDayColor}
                onChange={(color) => {
                  setOptimisticDayColor(color)
                  onDayColorChange(color)
                }}
                onRequestClose={() => setPaletteOpen(false)}
              />
            </InteractionUI>,
            document.body
          )
        : null}

      {highlightOpen && canEdit && onDayHighlightChange
        ? createPortal(
            <InteractionUI
              ref={highlightFlyoutRef}
              className="day-quick-edit-highlight-flyout"
              style={highlightStyle ?? { position: 'fixed', visibility: 'hidden', zIndex: 80 }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <DayHighlightPalette
                compact
                value={displayDayHighlight}
                onChange={(color) => {
                  setOptimisticDayHighlight(color)
                  onDayHighlightChange(color)
                }}
                onRequestClose={() => setHighlightOpen(false)}
              />
            </InteractionUI>,
            document.body
          )
        : null}
    </>
  )
}

export default DayQuickEditPopover
