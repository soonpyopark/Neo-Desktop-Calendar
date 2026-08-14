import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement
} from 'react'
import { prepareDayListExportLayout } from '../../../shared/mdcExport/dayListExportLayout.js'
import { splitEventTitleRuns } from '../../../shared/mdcExport/eventTags.js'
import { isImageAttachment } from '../../../shared/attachmentKinds'
import { parseSimpleMarkdown } from '../../../shared/simpleMarkdown.js'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DoubleChevronLeftIcon,
  DoubleChevronRightIcon,
  ExcelIcon,
  HtmlIcon,
  PdfIcon
} from './CalendarHeaderIcons'
import type { CalendarStoreSnapshot } from '../../../shared/calendarTypes'
import { HOLIDAYS_KR_CALENDAR_ID } from '../../../shared/calendarDefaults'
import { exportFormatLabel, formatExportRangeLabel } from '../../../shared/exportCalendarHelpers.js'
import type { ExportCalendarFormat } from '../../../shared/exportCalendar'
import { splitLinkifySegments } from '../lib/linkify'
import { readEventAttachmentImage } from '../lib/eventAttachments'
import { useOpenAttachment } from './AttachmentViewerProvider'
import { useImageActionMenu } from './ImageActionMenu'
import { openExternalUrl } from '../lib/openExternal'
import { cn } from '../lib/cn'
import { useAppDialog } from './AppDialogProvider'
import { SimpleMarkdownText } from './SimpleMarkdownText'

export type DayListPreviewPanelProps = {
  open: boolean
  surface?: 'inline' | 'floating'
  store: CalendarStoreSnapshot
  /** Month to preview. */
  year: number
  /** 0-based month. */
  month: number
  /** 눈 아이콘 — hide every event, keeping the date rows. */
  eventsHidden?: boolean
  completedHidden?: boolean
  /** Double-click a date → add a new event on that day (this preview stays open). */
  onOpenDay?: (dayKey: string) => void
  /** Double-click an event title → open the detail editor (preview stays open). */
  onOpenEvent?: (eventId: string, dayKey: string) => void
  /** Persist 세로보기 sort preference (보기 옵션 · dayListSortDesc). */
  onSortDirChange?: (dir: 'asc' | 'desc') => void
  /**
   * Inline surface only: another overlay (the event editor) sits above this panel,
   * so Esc / Ctrl+F must belong to that overlay instead of closing the preview.
   */
  shortcutsSuspended?: boolean
  onClose: () => void
}

const FONT_SCALE_MIN = 0.8
const FONT_SCALE_MAX = 1.8
const FONT_SCALE_STEP = 0.1

/**
 * One text run. `matchIndex` is the panel-wide ordinal of an in-panel find hit,
 * `url` marks runs that belong to a URL detected inside the text.
 * `completed` styles the `(완료)` marker (#0070CE bold).
 */
type TextPart = {
  text: string
  matchIndex: number | null
  url: string | null
  completed?: boolean
  bold?: boolean
  italic?: boolean
  strike?: boolean
  code?: boolean
}

type AttachmentRef = { eventId: string; attachmentId: string }

type PreviewDetailLine = {
  kind: 'description' | 'link' | 'attachment' | 'other'
  /** Original detail text (markdown source for descriptions). */
  text: string
  parts: TextPart[]
  /** Set when the line is a 첨부 entry — clicking opens that file. */
  attachment: AttachmentRef | null
  /** Image attachments render an inline preview under the file name. */
  isImage: boolean
  /** Original attachment file name (for download / copy). */
  filename: string
}

type PreviewEvent = {
  id: string
  eventId: string
  dayKey: string
  /** False for 대한민국의 휴일 — title is not editable. */
  editable: boolean
  color: string
  /** Title line runs. */
  parts: TextPart[]
  /** 설명 / 링크 / 첨부 lines, rendered inside the boxed block. */
  detailLines: PreviewDetailLine[]
}

type PreviewRow = {
  dayKey: string
  dayOfWeek: number
  isHoliday: boolean
  dateParts: TextPart[]
  events: PreviewEvent[]
}

function toDateKey(year: number, month: number, day: number): string {
  const mm = String(month + 1).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

function dayOfWeekFromKey(dayKey: string): number {
  const [year, month, day] = dayKey.split('-').map(Number)
  return new Date(year, (month ?? 1) - 1, day ?? 1).getDay()
}

/** Split one segment on `needle`, numbering hits from `startIndex`. */
function splitOnQuery(
  text: string,
  needle: string,
  startIndex: number,
  url: string | null,
  completed = false
): { parts: TextPart[]; nextIndex: number } {
  if (!needle || !text) {
    return { parts: [{ text, matchIndex: null, url, completed }], nextIndex: startIndex }
  }

  const parts: TextPart[] = []
  const haystack = text.toLowerCase()
  const target = needle.toLowerCase()
  let cursor = 0
  let index = startIndex

  for (;;) {
    const hit = haystack.indexOf(target, cursor)
    if (hit < 0) break
    if (hit > cursor) {
      parts.push({ text: text.slice(cursor, hit), matchIndex: null, url, completed })
    }
    parts.push({
      text: text.slice(hit, hit + needle.length),
      matchIndex: index,
      url,
      completed
    })
    index += 1
    cursor = hit + needle.length
  }

  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), matchIndex: null, url, completed })
  }
  return { parts, nextIndex: index }
}

/** Detect URLs first, then number find hits inside each segment. */
function buildTextParts(
  text: string,
  needle: string,
  startIndex: number,
  completed = false
): { parts: TextPart[]; nextIndex: number } {
  const parts: TextPart[] = []
  let index = startIndex
  for (const segment of splitLinkifySegments(text)) {
    const split = splitOnQuery(segment.text, needle, index, segment.url, completed)
    parts.push(...split.parts)
    index = split.nextIndex
  }
  return { parts, nextIndex: index }
}

/** Description lines: markdown runs + linkify + find hits. */
function buildMarkdownTextParts(
  text: string,
  needle: string,
  startIndex: number
): { parts: TextPart[]; nextIndex: number } {
  const parts: TextPart[] = []
  let index = startIndex
  for (const run of parseSimpleMarkdown(text)) {
    if (run.href) {
      const split = splitOnQuery(run.text, needle, index, run.href)
      for (const part of split.parts) {
        parts.push({
          ...part,
          bold: run.bold,
          italic: run.italic,
          strike: run.strike,
          code: run.code
        })
      }
      index = split.nextIndex
      continue
    }
    const segments = run.code
      ? [{ text: run.text, url: null as string | null }]
      : splitLinkifySegments(run.text)
    for (const segment of segments) {
      const split = splitOnQuery(segment.text, needle, index, segment.url)
      for (const part of split.parts) {
        parts.push({
          ...part,
          bold: run.bold,
          italic: run.italic,
          strike: run.strike,
          code: run.code
        })
      }
      index = split.nextIndex
    }
  }
  return { parts, nextIndex: index }
}

/** Title line: keep `(완료)` as its own styled run, then linkify / find-highlight. */
function buildTitleParts(
  text: string,
  needle: string,
  startIndex: number
): { parts: TextPart[]; nextIndex: number } {
  const parts: TextPart[] = []
  let index = startIndex
  for (const run of splitEventTitleRuns(text)) {
    const split = buildTextParts(run.text, needle, index, run.completed)
    parts.push(...split.parts)
    index = split.nextIndex
  }
  return { parts, nextIndex: index }
}

function CloseIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
      />
    </svg>
  )
}

function AttachIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
      <path
        fill="currentColor"
        d="M16.5 6.5v10.25a4.25 4.25 0 0 1-8.5 0V6.75a2.75 2.75 0 0 1 5.5 0v9.5a1.25 1.25 0 0 1-2.5 0V7.5H9.5v8.75a2.75 2.75 0 0 0 5.5 0V6.75a4.25 4.25 0 0 0-8.5 0v10a5.75 5.75 0 0 0 11.5 0V6.5h-1.5z"
      />
    </svg>
  )
}

function findAttachmentMeta(
  store: CalendarStoreSnapshot,
  eventId: string,
  attachmentId: string
): { name: string; mime?: string; storedName?: string } | null {
  const event = store.events.find((item) => item.id === eventId)
  const meta = event?.attachments?.find((item) => item.id === attachmentId)
  return meta ?? null
}

/** Attachment row: file name (+ inline image inside the purple detail box). */
function DayListAttachmentDetail({
  attachment,
  isImage,
  filename,
  parts,
  activeIndex,
  onOpen
}: {
  attachment: AttachmentRef
  isImage: boolean
  filename: string
  parts: TextPart[]
  activeIndex: number
  onOpen: () => void
}): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [loadTried, setLoadTried] = useState(false)
  const { openMenu, copyCurrent, Menu: imageMenu } = useImageActionMenu()

  useEffect(() => {
    if (!isImage) return undefined
    const host = hostRef.current
    if (!host) return undefined
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true)
      },
      { rootMargin: '120px' }
    )
    observer.observe(host)
    return () => observer.disconnect()
  }, [isImage])

  useEffect(() => {
    if (!isImage || !visible) return undefined
    let cancelled = false
    void readEventAttachmentImage(attachment.eventId, attachment.attachmentId).then((image) => {
      if (cancelled) return
      setLoadTried(true)
      if (image) setDataUrl(image.dataUrl)
    })
    return () => {
      cancelled = true
    }
  }, [attachment.attachmentId, attachment.eventId, isImage, visible])

  const showThumb = isImage && (!loadTried || Boolean(dataUrl))

  return (
    <div ref={hostRef} className="day-list-preview-detail-attach-block">
      <button
        type="button"
        className="day-list-preview-detail-attach"
        title="첨부파일 열기"
        onClick={onOpen}
      >
        <AttachIcon />
        <HighlightedText parts={parts} activeIndex={activeIndex} />
      </button>
      {showThumb ? (
        <button
          type="button"
          className={cn(
            'day-list-preview-detail-thumb',
            dataUrl ? 'has-image' : 'is-loading'
          )}
          title="이미지 크게 보기 · 우클릭: 복사/다운로드"
          aria-label="이미지 첨부 미리보기"
          onClick={onOpen}
          onContextMenu={(event) => {
            if (!dataUrl) return
            openMenu(event, { dataUrl, filename })
          }}
          onKeyDown={(event) => {
            if (!dataUrl) return
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
              event.preventDefault()
              event.stopPropagation()
              void copyCurrent({ dataUrl, filename })
            }
          }}
        >
          {dataUrl ? (
            <img src={dataUrl} alt="" className="day-list-preview-detail-thumb-img" />
          ) : null}
        </button>
      ) : null}
      {imageMenu}
    </div>
  )
}

function SortAscIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="currentColor" d="M12 4l5.5 5.5-1.41 1.41L13 7.83V20h-2V7.83l-3.09 3.08L6.5 9.5z" />
    </svg>
  )
}

function SortDescIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="currentColor" d="M12 20l-5.5-5.5 1.41-1.41L11 16.17V4h2v12.17l3.09-3.08 1.41 1.41z" />
    </svg>
  )
}

function ZoomOutIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="currentColor" d="M19 13H5v-2h14z" />
    </svg>
  )
}

function ZoomInIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z" />
    </svg>
  )
}

function FindPrevIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path fill="currentColor" d="M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z" />
    </svg>
  )
}

function FindNextIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path fill="currentColor" d="M12 15.41 6 9.41 7.41 8 12 12.58 16.59 8 18 9.41z" />
    </svg>
  )
}

function PartRuns({
  parts,
  activeIndex
}: {
  parts: TextPart[]
  activeIndex: number
}): ReactElement {
  return (
    <>
      {parts.map((part, i) => {
        const formatClass = cn(
          part.completed ? 'day-list-preview-completed' : undefined,
          part.bold && 'font-semibold',
          part.italic && 'italic',
          part.strike && 'line-through opacity-80',
          part.code && 'rounded bg-black/5 px-0.5 font-mono text-[0.92em] dark:bg-white/10'
        )
        if (part.matchIndex === null) {
          return (
            <span key={i} className={formatClass || undefined}>
              {part.text}
            </span>
          )
        }
        return (
          <mark
            key={i}
            className={cn(
              'day-list-find-hit',
              formatClass,
              part.matchIndex === activeIndex && 'is-active'
            )}
            data-find-index={part.matchIndex}
          >
            {part.text}
          </mark>
        )
      })}
    </>
  )
}

/** Render find-highlighted text, turning detected URLs into single-click links. */
function HighlightedText({
  parts,
  activeIndex
}: {
  parts: TextPart[]
  activeIndex: number
}): ReactElement {
  // Group neighbouring runs of the same URL so one link renders per URL.
  const groups: Array<{ url: string | null; parts: TextPart[] }> = []
  for (const part of parts) {
    const last = groups[groups.length - 1]
    if (last && last.url === part.url) last.parts.push(part)
    else groups.push({ url: part.url, parts: [part] })
  }

  return (
    <>
      {groups.map((group, i) =>
        group.url ? (
          <a
            key={i}
            href={group.url}
            className="day-list-preview-inline-link"
            title={`바로가기 열기: ${group.url}`}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              void openExternalUrl(group.url as string)
            }}
          >
            <PartRuns parts={group.parts} activeIndex={activeIndex} />
          </a>
        ) : (
          <PartRuns key={i} parts={group.parts} activeIndex={activeIndex} />
        )
      )}
    </>
  )
}

/** Portrait month preview using the same day-list model as the PDF/Excel export. */
export function DayListPreviewPanel({
  open,
  surface = 'inline',
  store,
  year,
  month,
  eventsHidden = false,
  completedHidden = false,
  onOpenDay,
  onOpenEvent,
  onSortDirChange,
  shortcutsSuspended = false,
  onClose
}: DayListPreviewPanelProps): ReactElement | null {
  const isFloating = surface === 'floating'
  const { alert } = useAppDialog()
  const openAttachmentInViewer = useOpenAttachment()
  // Month shown inside the panel; the props only seed it so the header arrows can browse.
  const [viewMonth, setViewMonth] = useState(() => year * 12 + month)
  // Prefer 보기 옵션 (default 내림차순); toolbar toggles persist through onSortDirChange.
  const sortDir: 'asc' | 'desc' =
    store.settings.viewOptions.dayListSortDesc === false ? 'asc' : 'desc'
  const setSortDir = (dir: 'asc' | 'desc'): void => {
    onSortDirChange?.(dir)
  }
  const [fontScale, setFontScale] = useState(1)
  const [todayRequest, setTodayRequest] = useState(0)
  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [exporting, setExporting] = useState(false)
  const findInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const shownYear = Math.floor(viewMonth / 12)
  const shownMonth = viewMonth % 12

  useEffect(() => {
    setViewMonth(year * 12 + month)
  }, [month, year])

  const layout = useMemo(() => {
    const startDate = toDateKey(shownYear, shownMonth, 1)
    const endDate = toDateKey(
      shownYear,
      shownMonth,
      new Date(shownYear, shownMonth + 1, 0).getDate()
    )
    try {
      return prepareDayListExportLayout(store, { startDate, endDate }, {
        includeCompleted: !completedHidden,
        includeHolidays: true,
        excludeHiddenCalendars: true
      })
    } catch {
      return null
    }
  }, [completedHidden, shownMonth, shownYear, store])

  const { rows, matchCount } = useMemo(() => {
    const needle = query.trim()
    let index = 0
    // Sort before numbering hits so find navigation follows the visible order.
    const source = layout?.rows ?? []
    const ordered = sortDir === 'desc' ? [...source].reverse() : source
    const built: PreviewRow[] = ordered.map((row) => {
      const dateSplit = buildTextParts(row.dateLabel, needle, index)
      index = dateSplit.nextIndex
      const events = eventsHidden
        ? []
        : row.events.map((event) => {
            const split = buildTitleParts(event.head, needle, index)
            index = split.nextIndex
            const detailLines: PreviewDetailLine[] = event.details.map((detail) => {
              const kind =
                detail.kind === 'description' ||
                detail.kind === 'link' ||
                detail.kind === 'attachment'
                  ? detail.kind
                  : 'other'
              const detailSplit =
                kind === 'description'
                  ? buildMarkdownTextParts(detail.text, needle, index)
                  : buildTextParts(detail.text, needle, index)
              index = detailSplit.nextIndex
              const attachmentId =
                kind === 'attachment' && detail.attachmentId ? detail.attachmentId : ''
              const attachment =
                attachmentId
                  ? { eventId: event.eventId, attachmentId }
                  : null
              const meta = attachment
                ? findAttachmentMeta(store, attachment.eventId, attachment.attachmentId)
                : null
              return {
                kind,
                text: detail.text,
                parts: detailSplit.parts,
                attachment,
                isImage: Boolean(meta && isImageAttachment(meta)),
                filename: String(meta?.name ?? detail.text ?? 'image.png')
              }
            })
            return {
              id: event.id,
              eventId: event.eventId,
              dayKey: row.dayKey,
              editable: event.calendarId !== HOLIDAYS_KR_CALENDAR_ID,
              color: event.color,
              parts: split.parts,
              detailLines
            }
          })
      return {
        dayKey: row.dayKey,
        dayOfWeek: dayOfWeekFromKey(row.dayKey),
        isHoliday: Boolean(row.isHoliday),
        dateParts: dateSplit.parts,
        events
      }
    })
    return { rows: built, matchCount: index }
  }, [eventsHidden, layout, query, sortDir, store])

  const openAttachment = useCallback(
    async (attachment: AttachmentRef | null): Promise<void> => {
      if (!attachment) return
      await openAttachmentInViewer(attachment.eventId, attachment.attachmentId)
    },
    [openAttachmentInViewer]
  )

  const stepFontScale = useCallback((delta: number): void => {
    setFontScale((prev) => {
      const next = Math.round((prev + delta) * 10) / 10
      return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, next))
    })
  }, [])

  const goToday = useCallback((): void => {
    const now = new Date()
    setViewMonth(now.getFullYear() * 12 + now.getMonth())
    setTodayRequest((prev) => prev + 1)
  }, [])

  /** Same day-list export as the main 내보내기 dialog (current preview month). */
  const exportShownMonth = useCallback(
    async (format: ExportCalendarFormat): Promise<void> => {
      if (exporting) return
      const startDate = toDateKey(shownYear, shownMonth, 1)
      const endDate = toDateKey(
        shownYear,
        shownMonth,
        new Date(shownYear, shownMonth + 1, 0).getDate()
      )
      const formatLabel = exportFormatLabel(format)
      const rangeLabel = formatExportRangeLabel(startDate, endDate)
      setExporting(true)
      try {
        const result = await window.neoCalendar.exportCalendar({
          format,
          layout: 'dayList',
          startDate,
          endDate,
          includeCompleted: true,
          includeHolidays: true,
          excludeHiddenCalendars: true,
          dayListSortDesc: sortDir === 'desc',
          asAdmin: true
        })
        if (result.canceled) return
        if (!result.ok) {
          await alert(result.error || `${formatLabel} 내보내기에 실패했습니다.`)
          return
        }
        await alert(`${rangeLabel} 일간 목록을(를) ${formatLabel} 파일로 저장했습니다.`)
      } catch (error) {
        await alert(
          error instanceof Error ? error.message : `${formatLabel} 내보내기에 실패했습니다.`
        )
      } finally {
        setExporting(false)
      }
    },
    [alert, exporting, shownMonth, shownYear, sortDir]
  )

  const closeFind = useCallback((): void => {
    setFindOpen(false)
    setQuery('')
    setActiveIndex(0)
  }, [])

  const stepMatch = useCallback(
    (delta: number): void => {
      if (matchCount === 0) return
      setActiveIndex((prev) => (prev + delta + matchCount) % matchCount)
    },
    [matchCount]
  )

  useEffect(() => {
    setActiveIndex(0)
  }, [query, sortDir, viewMonth])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [viewMonth])

  // [오늘] — declared after the reset above so it wins when the month also changed.
  useEffect(() => {
    if (todayRequest === 0) return
    const now = new Date()
    const todayKey = toDateKey(now.getFullYear(), now.getMonth(), now.getDate())
    scrollRef.current
      ?.querySelector(`[data-day-key="${todayKey}"]`)
      ?.scrollIntoView({ block: 'center' })
  }, [rows, todayRequest])

  useEffect(() => {
    if (activeIndex >= matchCount) setActiveIndex(0)
  }, [activeIndex, matchCount])

  useEffect(() => {
    if (!open) closeFind()
  }, [closeFind, open])

  useEffect(() => {
    if (findOpen) findInputRef.current?.focus()
  }, [findOpen])

  // Keep the current hit visible while stepping through matches.
  useEffect(() => {
    if (!findOpen || matchCount === 0) return
    const hit = scrollRef.current?.querySelector(`[data-find-index="${activeIndex}"]`)
    hit?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, findOpen, matchCount, rows])

  useEffect(() => {
    if (!open || shortcutsSuspended) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key === 'f' || event.key === 'F')) {
        event.preventDefault()
        setFindOpen(true)
        findInputRef.current?.select()
        return
      }
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (findOpen) {
        closeFind()
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeFind, findOpen, onClose, open, shortcutsSuspended])

  if (!open) return null

  const monthLabel = `${shownYear}년 ${shownMonth + 1}월`
  const title = `${monthLabel} 세로보기`

  return (
    <div
      className={isFloating ? 'h-full w-full' : 'interaction-ui fixed inset-0 z-[55]'}
      role="presentation"
      onClick={isFloating ? undefined : onClose}
    >
      <div
        className={
          isFloating
            ? 'flex h-full w-full'
            : 'pointer-events-none fixed inset-0 z-[56] flex items-center justify-center'
        }
        role="presentation"
      >
        <div
          className={cn(
            'day-list-preview-shell shell-solid-surface pointer-events-auto relative z-[1] flex min-h-0 flex-col overflow-hidden rounded-xl',
            isFloating
              ? 'h-full max-h-full w-full'
              : 'h-[80%] max-h-[80%] w-[90%] shadow-[0_8px_28px_rgba(0,0,0,0.18)]'
          )}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          style={{ '--day-list-font-scale': fontScale } as CSSProperties}
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <header className="day-list-preview-header">
            <div className="flex min-w-0 items-center gap-1">
              <button
                type="button"
                className="day-list-preview-nav"
                onClick={() => setViewMonth((prev) => prev - 12)}
                aria-label="이전 년도"
                title="이전 년도"
              >
                <DoubleChevronLeftIcon />
              </button>
              <button
                type="button"
                className="day-list-preview-nav"
                onClick={() => setViewMonth((prev) => prev - 1)}
                aria-label="이전 달"
                title="이전 달"
              >
                <ChevronLeftIcon />
              </button>
              <h2 className="day-list-preview-title shrink-0 px-1">{monthLabel}</h2>
              <button
                type="button"
                className="day-list-preview-nav"
                onClick={() => setViewMonth((prev) => prev + 1)}
                aria-label="다음 달"
                title="다음 달"
              >
                <ChevronRightIcon />
              </button>
              <button
                type="button"
                className="day-list-preview-nav"
                onClick={() => setViewMonth((prev) => prev + 12)}
                aria-label="다음 년도"
                title="다음 년도"
              >
                <DoubleChevronRightIcon />
              </button>
              <button
                type="button"
                className="day-list-preview-today"
                onClick={goToday}
                aria-label="오늘"
                title="오늘"
              >
                오늘
              </button>
              <button
                type="button"
                className="day-quick-edit-close"
                disabled={exporting}
                onClick={() => void exportShownMonth('excel')}
                aria-label="Excel로 저장"
                title="Excel로 저장 (일자별 목록)"
              >
                <ExcelIcon />
              </button>
              <button
                type="button"
                className="day-quick-edit-close"
                disabled={exporting}
                onClick={() => void exportShownMonth('pdf')}
                aria-label="PDF로 저장"
                title="PDF로 저장 (일자별 목록)"
              >
                <PdfIcon />
              </button>
              <button
                type="button"
                className="day-quick-edit-close"
                disabled={exporting}
                onClick={() => void exportShownMonth('html')}
                aria-label="HTML로 저장"
                title="HTML로 저장 (일자별 목록)"
              >
                <HtmlIcon />
              </button>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                className="day-quick-edit-close"
                onClick={() => setFindOpen((prev) => !prev)}
                aria-label="화면 내 검색"
                title="화면 내 검색 (Ctrl+F)"
                aria-pressed={findOpen}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"
                  />
                </svg>
              </button>
              <button
                type="button"
                className={cn('day-quick-edit-close', sortDir === 'asc' && 'is-active')}
                onClick={() => setSortDir('asc')}
                aria-label="날짜 오름차순 정렬"
                title="날짜 오름차순 (1일 → 말일)"
                aria-pressed={sortDir === 'asc'}
              >
                <SortAscIcon />
              </button>
              <button
                type="button"
                className={cn('day-quick-edit-close', sortDir === 'desc' && 'is-active')}
                onClick={() => setSortDir('desc')}
                aria-label="날짜 내림차순 정렬"
                title="날짜 내림차순 (말일 → 1일)"
                aria-pressed={sortDir === 'desc'}
              >
                <SortDescIcon />
              </button>
              <button
                type="button"
                className="day-quick-edit-close"
                onClick={() => stepFontScale(-FONT_SCALE_STEP)}
                disabled={fontScale <= FONT_SCALE_MIN}
                aria-label="글자 작게"
                title="글자 작게"
              >
                <ZoomOutIcon />
              </button>
              <button
                type="button"
                className="day-quick-edit-close"
                onClick={() => stepFontScale(FONT_SCALE_STEP)}
                disabled={fontScale >= FONT_SCALE_MAX}
                aria-label="글자 크게"
                title="글자 크게"
              >
                <ZoomInIcon />
              </button>
              <button
                type="button"
                className="day-quick-edit-close"
                onClick={onClose}
                aria-label="닫기"
                title="닫기"
              >
                <CloseIcon />
              </button>
            </div>
          </header>

          {findOpen ? (
            <div className="day-list-find">
              <input
                ref={findInputRef}
                className="day-list-find-input"
                type="text"
                value={query}
                placeholder="화면에서 찾기"
                spellCheck={false}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  stepMatch(event.shiftKey ? -1 : 1)
                }}
              />
              <span className="day-list-find-count">
                {query.trim() ? `${matchCount === 0 ? 0 : activeIndex + 1}/${matchCount}` : '0/0'}
              </span>
              <button
                type="button"
                className="day-list-find-btn"
                onClick={() => stepMatch(-1)}
                disabled={matchCount === 0}
                aria-label="이전 결과"
                title="이전 결과 (Shift+Enter)"
              >
                <FindPrevIcon />
              </button>
              <button
                type="button"
                className="day-list-find-btn"
                onClick={() => stepMatch(1)}
                disabled={matchCount === 0}
                aria-label="다음 결과"
                title="다음 결과 (Enter)"
              >
                <FindNextIcon />
              </button>
              <button
                type="button"
                className="day-list-find-btn"
                onClick={closeFind}
                aria-label="검색 닫기"
                title="검색 닫기 (Esc)"
              >
                <CloseIcon />
              </button>
            </div>
          ) : null}

          <div
            ref={scrollRef}
            className="day-list-preview-table settings-scroll min-h-0 flex-1 overflow-auto"
          >
            <div className="day-list-preview-row day-list-preview-row--head">
              <div className="day-list-preview-date">날짜</div>
              <div className="day-list-preview-content">내용</div>
            </div>

            {rows.length ? (
              rows.map((row) => {
                // 대한민국의 휴일 borrows the Sunday date color / weekend fill.
                const isSunday = row.dayOfWeek === 0 || row.isHoliday
                const isWeekend = isSunday || row.dayOfWeek === 6
                return (
                  <div
                    key={row.dayKey}
                    className="day-list-preview-row"
                    data-day-key={row.dayKey}
                  >
                    <div
                      className={cn(
                        'day-list-preview-date',
                        isSunday && 'is-sunday',
                        !isSunday && row.dayOfWeek === 6 && 'is-saturday',
                        isWeekend && 'is-weekend',
                        onOpenDay && 'is-openable'
                      )}
                      title={onOpenDay ? '더블클릭: 이 날짜에 새 일정 추가' : undefined}
                      onDoubleClick={onOpenDay ? () => onOpenDay(row.dayKey) : undefined}
                    >
                      <HighlightedText parts={row.dateParts} activeIndex={activeIndex} />
                    </div>
                    <div
                      className={cn('day-list-preview-content', isWeekend && 'is-weekend')}
                    >
                      {row.events.map((event) => (
                        <div key={event.id} className="day-list-preview-event">
                          {/* 제목 문구는 내보내기와 동일: "[태그] (완료) 제목" — 취소선 등 별도 스타일은 넣지 않음. */}
                          <p
                            className={cn(
                              'day-list-preview-line',
                              onOpenEvent && event.editable && 'is-openable'
                            )}
                            title={
                              onOpenEvent && event.editable
                                ? '더블클릭: 상세 편집'
                                : undefined
                            }
                            onDoubleClick={
                              onOpenEvent && event.editable
                                ? (domEvent) => {
                                    domEvent.preventDefault()
                                    domEvent.stopPropagation()
                                    onOpenEvent(event.eventId, event.dayKey)
                                  }
                                : undefined
                            }
                          >
                            <span
                              className="day-list-preview-dot"
                              style={{ backgroundColor: event.color }}
                              aria-hidden="true"
                            />
                            <span className="min-w-0">
                              <HighlightedText parts={event.parts} activeIndex={activeIndex} />
                            </span>
                          </p>
                          {event.detailLines.length ? (
                            <div className="day-list-preview-details">
                              {event.detailLines.map((line, lineIndex) => (
                                <div key={lineIndex} className="day-list-preview-detail-line">
                                  {line.attachment ? (
                                    <DayListAttachmentDetail
                                      attachment={line.attachment}
                                      isImage={line.isImage}
                                      filename={line.filename}
                                      parts={line.parts}
                                      activeIndex={activeIndex}
                                      onOpen={() => void openAttachment(line.attachment)}
                                    />
                                  ) : line.kind === 'description' && !query.trim() ? (
                                    <SimpleMarkdownText
                                      text={line.text}
                                      className="day-list-preview-md whitespace-pre-wrap break-words"
                                    />
                                  ) : (
                                    <HighlightedText parts={line.parts} activeIndex={activeIndex} />
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })
            ) : (
              <div className="day-list-preview-empty">표시할 일정이 없습니다</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default DayListPreviewPanel
