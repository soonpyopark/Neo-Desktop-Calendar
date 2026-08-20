import { type CSSProperties, type MouseEvent, type ReactElement } from 'react'
import { DayNumber } from './DayNumber'
import { EventAccentGlyph } from './EventAccentGlyph'
import { EventAttachIcon } from './EventAttachIcon'
import { EventLinkIcon } from './EventLinkIcon'
import { EventMoreButton } from './EventMoreButton'
import { EventTagIcons } from './EventTagIcons'
import { getCalendarTheme } from '../lib/colors'
import { getDayParts } from '../lib/lunar'
import { getEventLinks } from '../lib/eventLinks'
import { resolveDayVisibleEventLimit } from '../hooks/useMaxVisibleEvents'
import { getSeriesId } from '../../../shared/mdcExport/eventOccurrences.js'
import type { CalendarEvent, CalendarRecord, TagRecord } from '../../../shared/calendarTypes'

export type DayCellModel = {
  day: number
  dateKey: string
  inMonth: boolean
  isToday: boolean
  weekday: number
  date: Date
}

export type DaySegment = {
  event: CalendarEvent
  segment: 'single' | 'start' | 'middle' | 'end'
  lane: number
  label?: { time?: string; dayIndex?: number | null; title?: string } | null
  continuation?: boolean
}

export type MonthDayCellProps = {
  cell: DayCellModel
  segments: DaySegment[]
  calendarsById: Map<string, CalendarRecord>
  tags: TagRecord[]
  selected: boolean
  isKrHoliday: boolean
  dayColor?: string | null
  /** 형광펜 stroke behind the date number. */
  dayHighlight?: string | null
  eventCapacity: { maxAll: number; maxWithMore: number }
  eventsHidden?: boolean
  completedHidden?: boolean
  canEdit?: boolean
  tall?: boolean
  /** WorkerW embedded: day dblclick via main-process bridge, not renderer. */
  desktopEmbedded?: boolean
  themeEpoch?: number
  onLoginRequired?: () => void
  onDayQuickEdit: (date: Date, anchorRect: DOMRect) => void
}

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/** Month/week day cell — focus only with dblclick quick edit (all modes). */
export function MonthDayCell({
  cell,
  segments,
  calendarsById,
  tags,
  selected,
  isKrHoliday,
  dayColor = null,
  dayHighlight = null,
  eventCapacity,
  eventsHidden = false,
  completedHidden = false,
  canEdit = true,
  tall = false,
  desktopEmbedded = false,
  themeEpoch = 0,
  onLoginRequired,
  onDayQuickEdit
}: MonthDayCellProps): ReactElement {
  const interactive = canEdit
  const gateEdit = (): boolean => {
    if (canEdit) return true
    onLoginRequired?.()
    return false
  }
  const dayKey = cell.dateKey

  const uiSegments = completedHidden
    ? segments.filter((segment) => !segment.event?.completed)
    : segments
  const { visibleCount, hiddenEventCount } = resolveDayVisibleEventLimit(uiSegments, eventCapacity)
  const visibleSegments = eventsHidden ? [] : uiSegments.slice(0, visibleCount)
  // Hide day tint with events — but never tween through a fully clear cell (desktop flash).
  const displayDayColor = eventsHidden ? null : (dayColor ?? null)
  const displayDayHighlight = eventsHidden ? null : (dayHighlight ?? null)

  const weekdayClass = cell.weekday === 0 ? 'sunday' : cell.weekday === 6 ? 'saturday' : ''
  const cellStyle = displayDayColor
    ? ({ '--day-cell-bg': displayDayColor } as CSSProperties)
    : undefined
  const { solar, lunar, lunarDay, solarTerm } = getDayParts(
    cell.date.getFullYear(),
    cell.date.getMonth() + 1,
    cell.day
  )

  const openQuickEditFromCell = (target: HTMLElement): void => {
    // Adjacent-month pads must not open quick edit (clicks outside the
    // in-month grid / WorkerW leftover zones would otherwise hit them).
    if (!cell.inMonth) return
    const cellEl = target.closest('.day-cell') as HTMLElement | null
    const rect = (cellEl ?? target).getBoundingClientRect()
    onDayQuickEdit(cell.date, rect)
  }

  const handleQuickEditDoubleClick = (event: MouseEvent<HTMLElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    if (!cell.inMonth) return
    if (!gateEdit()) return
    openQuickEditFromCell(event.currentTarget)
  }
  const handleCellDoubleClick = (event: MouseEvent<HTMLDivElement>): void => {
    if ((event.target as Element | null)?.closest?.('[data-shell-chrome]')) return
    if ((event.target as Element | null)?.closest?.('.event-bar, .event-more')) return
    event.preventDefault()
    event.stopPropagation()
    if (!cell.inMonth) return
    if (!interactive) {
      onLoginRequired?.()
      return
    }
    openQuickEditFromCell(event.currentTarget)
  }

  return (
    <div
      className={cn(
        'day-cell',
        'interaction-ui',
        weekdayClass,
        isKrHoliday && 'holiday',
        !cell.inMonth && 'other-month',
        cell.isToday && 'today',
        selected && 'selected',
        displayDayColor && 'has-day-color',
        tall && 'day-cell--tall'
      )}
      style={cellStyle}
      data-date-key={dayKey}
      onClick={interactive ? undefined : () => onLoginRequired?.()}
      onDoubleClick={desktopEmbedded ? undefined : handleCellDoubleClick}
    >
      <DayNumber
        solar={solar}
        lunarLabel={lunar}
        lunarDay={lunarDay}
        solarTerm={solarTerm}
        highlight={displayDayHighlight}
      />

      <div className={cn('day-events', eventsHidden && 'is-hidden')}>
        {visibleSegments.map(({ event, segment, label, continuation, lane }) => {
          const cal = calendarsById.get(event.calendarId)
          const color = cal?.color ?? '#f6bf26'
          const theme = getCalendarTheme(color)
          const accent = event.completed ? '#9aa0a6' : (theme.accent ?? theme.base)
          const hasLinkOrAttach =
            getEventLinks(event).length > 0 ||
            (Array.isArray(event.attachments) && event.attachments.length > 0)
          const seriesId = getSeriesId(event) || event.id

          return (
            <div
              key={`${event.id}-${dayKey}-${themeEpoch}`}
              data-event-id={seriesId}
              data-day-key={dayKey}
              className={cn(
                'event-bar',
                'interaction-ui',
                segment === 'single' && 'event-bar--single',
                segment === 'start' && 'event-bar--start',
                segment === 'middle' && 'event-bar--middle',
                segment === 'end' && 'event-bar--end',
                continuation && 'event-bar--continuation',
                event.completed && 'is-completed'
              )}
              style={
                {
                  '--event-lane': Number.isFinite(lane) ? lane : 0,
                  '--event-accent': accent,
                  backgroundColor: event.completed ? 'transparent' : theme.bg,
                  color: event.completed ? '#80868b' : theme.text
                } as CSSProperties
              }
              onDoubleClick={desktopEmbedded ? undefined : handleQuickEditDoubleClick}
            >
              <EventAccentGlyph shapeId={event.markerShape} color={accent} variant="bar" />
              {label?.time ? <span className="event-time">{label.time}</span> : null}
              {label?.dayIndex != null ? (
                <span className="event-day-index">({label.dayIndex})</span>
              ) : null}
              <EventTagIcons event={event} tags={tags} />
              {label ? (
                <span className={cn('event-title', event.completed && 'line-through opacity-70')}>
                  {label.title}
                </span>
              ) : null}
              {hasLinkOrAttach ? (
                <span className="event-bar-trailing">
                  <EventLinkIcon event={event} />
                  <EventAttachIcon event={event} />
                </span>
              ) : null}
            </div>
          )
        })}
        {!eventsHidden && hiddenEventCount > 0 ? (
          <EventMoreButton
            count={hiddenEventCount}
            lane={visibleSegments.length}
            onDoubleClick={desktopEmbedded ? undefined : handleQuickEditDoubleClick}
          />
        ) : null}
      </div>
    </div>
  )
}

export default MonthDayCell
