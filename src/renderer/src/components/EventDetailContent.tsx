import type { ReactElement } from 'react'
import { getSeriesId } from '../../../shared/mdcExport/eventOccurrences.js'
import { resolveEventTags } from '../../../shared/mdcExport/eventTags.js'
import { getEventLinks } from '../lib/eventLinks'
import { useOpenAttachment } from './AttachmentViewerProvider'
import {
  formatEventScheduleParts,
  formatRepeatLabel,
  type EventScheduleRelativeBadge
} from '../lib/eventFormat'
import { formatFileSize } from '../lib/formatFileSize'
import { openExternalUrl } from '../lib/openExternal'
import { getCalendarTheme } from '../lib/colors'
import { cn } from '../lib/cn'
import { EventTagIcons } from './EventTagIcons'
import { LinkChainIcon } from './LinkChainIcon'
import { EventDetailDescription } from './EventDetailDescription'
import type { CalendarEvent, CalendarRecord, TagRecord } from '../../../shared/calendarTypes'

export type EventDetailContentProps = {
  event: CalendarEvent
  calendar?: CalendarRecord | null
  dayKey?: string
  tags?: TagRecord[]
  onTitleDoubleClick?: () => void
}

export function EventDetailCalendarName({
  calendar,
  color
}: {
  calendar?: CalendarRecord | null
  color?: string | null
}): ReactElement {
  const calendarColor = color ?? calendar?.color ?? '#039be5'
  const theme = getCalendarTheme(calendarColor)
  const iconColor = theme.accent ?? theme.base

  return (
    <div className="flex min-w-0 items-center gap-1.5 text-sm text-gcal-muted">
      <svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        className="shrink-0"
        style={{ color: iconColor }}
        aria-hidden="true"
      >
        <path
          fill="currentColor"
          d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zM5 8V6h14v2H5z"
        />
      </svg>
      <span className="truncate">{calendar?.name ?? '기본 캘린더'}</span>
    </div>
  )
}

const RELATIVE_BADGE_LABEL: Record<EventScheduleRelativeBadge, string> = {
  today: '오늘',
  tomorrow: '내일',
  dayAfter: '모레'
}

export function EventDetailContent({
  event,
  calendar,
  dayKey,
  tags = [],
  onTitleDoubleClick
}: EventDetailContentProps): ReactElement {
  const openAttachment = useOpenAttachment()
  const calendarColor = calendar?.color ?? event.color ?? '#039be5'
  const theme = getCalendarTheme(calendarColor)
  const schedule = formatEventScheduleParts(event, dayKey)
  const repeatLine = formatRepeatLabel(event)
  const description = event.description?.trim() ?? ''
  const links = getEventLinks(event)
  const attachments = Array.isArray(event?.attachments) ? event.attachments : []
  const eventId = getSeriesId(event) || event?.id
  const completed = Boolean(event.completed)
  const title = event.title ?? ''
  const eventTags = resolveEventTags(event, tags)
  const titleEditable = typeof onTitleDoubleClick === 'function'
  const scheduleAccent = completed ? 'var(--gcal-muted)' : (theme.accent ?? theme.base)
  const scheduleInk = completed ? 'var(--gcal-body)' : theme.text

  return (
    <>
      <div className="flex items-start gap-3">
        <span
          className="mt-1 h-3.5 w-3.5 shrink-0 rounded-sm"
          style={{ background: calendarColor }}
        />
        <div className="min-w-0 flex-1">
          <h3
            className={cn(
              'm-0 flex flex-wrap items-center gap-1.5 text-xl font-normal leading-snug text-gcal-heading',
              completed && 'opacity-70',
              titleEditable && 'cursor-pointer'
            )}
            title={titleEditable ? '더블클릭하여 편집' : undefined}
            onDoubleClick={
              titleEditable
                ? (e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onTitleDoubleClick()
                  }
                : undefined
            }
          >
            {eventTags.length > 0 ? (
              <EventTagIcons event={event} tags={tags} className="event-tag-icons--detail" />
            ) : null}
            <span>{title}</span>
          </h3>

          <div
            className="event-detail-schedule mt-3 rounded-lg border px-3 py-2.5"
            style={{
              backgroundColor: completed ? 'var(--gcal-surface-2)' : theme.bg,
              borderColor: completed
                ? 'var(--gcal-border-light)'
                : `color-mix(in srgb, ${theme.accent ?? theme.base} 30%, var(--gcal-border-light))`,
              color: scheduleInk
            }}
          >
            <div className="flex flex-col gap-1.5">
              <div className="flex items-start gap-2.5">
                <span className="inline-flex w-[18px] shrink-0 justify-start">
                  <svg
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    className="mt-0.5 shrink-0"
                    style={{ color: scheduleAccent }}
                    aria-hidden="true"
                  >
                    <path
                      fill="currentColor"
                      d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zM5 8V6h14v2H5z"
                    />
                  </svg>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="m-0 text-base font-medium leading-snug">{schedule.dateLine}</p>
                    {schedule.relativeBadge ? (
                      <span
                        className="event-detail-schedule-badge"
                        style={{ backgroundColor: scheduleAccent }}
                      >
                        {RELATIVE_BADGE_LABEL[schedule.relativeBadge]}
                      </span>
                    ) : null}
                  </div>
                  {repeatLine ? (
                    <p className="mt-1.5 mb-0 text-sm leading-relaxed opacity-90">{repeatLine}</p>
                  ) : null}
                </div>
              </div>
              {schedule.timeLine ? (
                <div className="flex items-center gap-2.5">
                  <span className="inline-flex w-[18px] shrink-0 justify-start">
                    <svg
                      viewBox="0 0 24 24"
                      width="16"
                      height="16"
                      className="shrink-0 opacity-75"
                      style={{ color: scheduleAccent }}
                      aria-hidden="true"
                    >
                      <path
                        fill="currentColor"
                        d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"
                      />
                    </svg>
                  </span>
                  <p className="m-0 text-sm tabular-nums leading-snug opacity-90">
                    {schedule.timeLine}
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          {links.length > 0 ? (
            <ul className="mt-3 m-0 list-none space-y-1 p-0">
              {links.map((item) => (
                <li key={item.id} className="flex items-start gap-1.5 text-sm leading-relaxed">
                  <LinkChainIcon size={14} className="mt-0.5 shrink-0 text-gcal-muted" />
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 break-all text-gcal-blue hover:underline"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      void openExternalUrl(item.url)
                    }}
                  >
                    {item.title || item.url}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          {attachments.length > 0 ? (
            <ul className="mt-1.5 m-0 list-none space-y-1 p-0" aria-label="첨부파일">
              {attachments.map((item) => (
                <li key={item.id} className="flex items-start gap-1.5 text-sm leading-relaxed">
                  <svg
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    className="mt-0.5 shrink-0 text-gcal-muted"
                    aria-hidden="true"
                  >
                    <path
                      fill="currentColor"
                      d="M16.5 6.5v10.25a4.25 4.25 0 0 1-8.5 0V6.75a2.75 2.75 0 0 1 5.5 0v9.5a1.25 1.25 0 0 1-2.5 0V7.5H9.5v8.75a2.75 2.75 0 0 0 5.5 0V6.75a4.25 4.25 0 0 0-8.5 0v10a5.75 5.75 0 0 0 11.5 0V6.5h-1.5z"
                    />
                  </svg>
                  <button
                    type="button"
                    className="min-w-0 break-all text-left text-gcal-blue hover:underline"
                    title="첨부 파일 열기"
                    onClick={() => {
                      if (!eventId || !item?.id) return
                      void openAttachment(eventId, item.id)
                    }}
                  >
                    {item.name || '(파일)'}
                    {item.size != null ? (
                      <span className="ml-1.5 text-xs text-gcal-muted">{formatFileSize(item.size)}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {description ? <EventDetailDescription text={description} /> : null}
        </div>
      </div>
    </>
  )
}

export default EventDetailContent
