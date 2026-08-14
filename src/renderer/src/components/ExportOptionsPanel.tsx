import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { InteractionUI } from './InteractionUI'
import DateInput from './DateInput'
import { formatExportRangeLabel } from '../../../shared/exportCalendarHelpers.js'
import type {
  ExportCalendarFormat,
  ExportCalendarLayout,
  ExportCalendarRequest,
  ExportRangePreset
} from '../../../shared/exportCalendar'
import { resolveExportRangePreset } from '../../../shared/mdcExport/exportRange.js'

export type ExportOptionsPanelProps = {
  open: boolean
  busy?: boolean
  /** YYYY-MM-DD reference for presets (usually view month / today). */
  referenceDate: string
  weekStartsOnSunday?: boolean
  /** Floating panel shell omits backdrop; inline modal uses one. */
  variant?: 'floating' | 'inline'
  onClose: () => void
  onExport: (request: ExportCalendarRequest) => void | Promise<void>
}

function parseReferenceDate(referenceDate: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(referenceDate)
  if (!match) return new Date()
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function radioClass(active: boolean): string {
  return [
    'rounded-full border px-3 py-1.5 text-sm transition-colors',
    active
      ? 'border-gcal-blue bg-gcal-blue-soft text-gcal-blue-dark'
      : 'border-gcal-border bg-gcal-surface text-gcal-body hover:bg-gcal-surface-2'
  ].join(' ')
}

export function ExportOptionsPanel({
  open,
  busy = false,
  referenceDate,
  weekStartsOnSunday = true,
  variant = 'inline',
  onClose,
  onExport
}: ExportOptionsPanelProps): ReactElement | null {
  const weekStartsOn: 0 | 1 = weekStartsOnSunday === false ? 1 : 0
  const reference = useMemo(() => parseReferenceDate(referenceDate), [referenceDate])
  const defaultRange = useMemo(
    () => resolveExportRangePreset('thisMonth', reference, weekStartsOn),
    [reference, weekStartsOn]
  )

  const [format, setFormat] = useState<ExportCalendarFormat>('excel')
  const [layout, setLayout] = useState<ExportCalendarLayout>('dayList')
  const [preset, setPreset] = useState<ExportRangePreset>('thisMonth')
  const [startDate, setStartDate] = useState(defaultRange.startDate)
  const [endDate, setEndDate] = useState(defaultRange.endDate)
  const [includeCompleted, setIncludeCompleted] = useState(true)
  const [includeHolidays, setIncludeHolidays] = useState(true)
  const [excludeHiddenCalendars, setExcludeHiddenCalendars] = useState(true)

  useEffect(() => {
    if (!open) return
    const range = resolveExportRangePreset('thisMonth', reference, weekStartsOn)
    setFormat('excel')
    setLayout('dayList')
    setPreset('thisMonth')
    setStartDate(range.startDate)
    setEndDate(range.endDate)
    setIncludeCompleted(true)
    setIncludeHolidays(true)
    setExcludeHiddenCalendars(true)
  }, [open, reference, weekStartsOn])

  if (!open) return null

  const applyPreset = (next: ExportRangePreset): void => {
    setPreset(next)
    if (next === 'custom') return
    const range = resolveExportRangePreset(next, reference, weekStartsOn)
    setStartDate(range.startDate)
    setEndDate(range.endDate)
  }

  const rangeValid = Boolean(startDate && endDate && endDate >= startDate)
  const rangeLabel = rangeValid ? formatExportRangeLabel(startDate, endDate) : ''

  const handleSubmit = (): void => {
    if (busy || !rangeValid) return
    void onExport({
      format,
      layout,
      startDate,
      endDate,
      includeCompleted,
      includeHolidays,
      excludeHiddenCalendars,
      asAdmin: true
    })
  }

  const body = (
    <div
      className="export-options-shell neo-modal-shell flex max-h-full w-full max-w-[440px] flex-col overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-options-title"
    >
      <div className="neo-modal-shell-header flex items-center justify-between px-5 py-3">
        <h2 id="export-options-title" className="text-base font-semibold text-gcal-heading">
          내보내기
        </h2>
        <InteractionUI
          as="button"
          type="button"
          className="rounded-full px-2 py-1 text-sm text-gcal-muted hover:bg-gcal-surface-2 hover:text-gcal-body disabled:opacity-50"
          disabled={busy}
          aria-label="닫기"
          onClick={onClose}
        >
          ✕
        </InteractionUI>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-3 text-sm text-gcal-body">
        <section>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gcal-muted">
            형식
          </div>
          <div className="flex flex-wrap gap-2">
            <InteractionUI
              as="button"
              type="button"
              className={radioClass(format === 'excel')}
              disabled={busy}
              onClick={() => setFormat('excel')}
            >
              Excel
            </InteractionUI>
            <InteractionUI
              as="button"
              type="button"
              className={radioClass(format === 'pdf')}
              disabled={busy}
              onClick={() => setFormat('pdf')}
            >
              PDF
            </InteractionUI>
            <InteractionUI
              as="button"
              type="button"
              className={radioClass(format === 'html')}
              disabled={busy}
              onClick={() => setFormat('html')}
            >
              HTML
            </InteractionUI>
          </div>
        </section>

        <section>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gcal-muted">
            레이아웃
          </div>
          <div className="flex flex-wrap gap-2">
            <InteractionUI
              as="button"
              type="button"
              className={radioClass(layout === 'dayList')}
              disabled={busy}
              onClick={() => setLayout('dayList')}
            >
              일간 목록
            </InteractionUI>
            <InteractionUI
              as="button"
              type="button"
              className={radioClass(layout === 'monthGrid')}
              disabled={busy}
              onClick={() => setLayout('monthGrid')}
            >
              월간 달력
            </InteractionUI>
          </div>
        </section>

        <section>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gcal-muted">
            기간
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            {(
              [
                ['thisMonth', '이번 달'],
                ['thisWeek', '이번 주'],
                ['thisYear', '올해'],
                ['custom', '사용자 지정']
              ] as const
            ).map(([value, label]) => (
              <InteractionUI
                key={value}
                as="button"
                type="button"
                className={radioClass(preset === value)}
                disabled={busy}
                onClick={() => applyPreset(value)}
              >
                {label}
              </InteractionUI>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DateInput
              id="export-start-date"
              className="rounded border border-gcal-border bg-gcal-page py-1.5 text-gcal-heading"
              aria-label="시작일"
              value={startDate}
              min={undefined}
              max={endDate || undefined}
              disabled={busy}
              onChange={(value: string) => {
                setPreset('custom')
                setStartDate(value)
                if (endDate && value && endDate < value) setEndDate(value)
              }}
            />
            <span className="text-gcal-muted">~</span>
            <DateInput
              id="export-end-date"
              className="rounded border border-gcal-border bg-gcal-page py-1.5 text-gcal-heading"
              aria-label="종료일"
              value={endDate}
              min={startDate || undefined}
              max={undefined}
              disabled={busy}
              onChange={(value: string) => {
                setPreset('custom')
                setEndDate(value)
              }}
            />
          </div>
          {rangeLabel ? (
            <p className="mt-2 text-xs text-gcal-muted">선택 기간: {rangeLabel}</p>
          ) : (
            <p className="mt-2 text-xs text-red-500">시작일과 종료일을 확인해 주세요.</p>
          )}
        </section>

        <section>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gcal-muted">
            포함
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="accent-gcal-blue"
                checked={includeCompleted}
                disabled={busy}
                onChange={(event) => setIncludeCompleted(event.target.checked)}
              />
              완료 일정 포함
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="accent-gcal-blue"
                checked={includeHolidays}
                disabled={busy}
                onChange={(event) => setIncludeHolidays(event.target.checked)}
              />
              공휴일 포함
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="accent-gcal-blue"
                checked={excludeHiddenCalendars}
                disabled={busy}
                onChange={(event) => setExcludeHiddenCalendars(event.target.checked)}
              />
              숨긴 캘린더 제외
            </label>
          </div>
        </section>
      </div>

      <div className="neo-modal-shell-footer flex justify-end gap-2 px-4 py-3">
        <InteractionUI
          as="button"
          type="button"
          className="rounded-full px-5 py-2 text-sm font-medium text-gcal-body transition-colors hover:bg-gcal-surface-2 disabled:opacity-50"
          disabled={busy}
          onClick={onClose}
        >
          취소
        </InteractionUI>
        <InteractionUI
          as="button"
          type="button"
          className="rounded-full bg-gcal-blue px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1765cc] disabled:opacity-50"
          disabled={busy || !rangeValid}
          onClick={handleSubmit}
        >
          {busy ? '저장 중…' : '내보내기'}
        </InteractionUI>
      </div>
    </div>
  )

  if (variant === 'floating') {
    return (
      <div className="neo-panel-shell h-screen w-screen overflow-hidden p-2">
        <div className="flex h-full w-full items-stretch justify-center">{body}</div>
      </div>
    )
  }

  // Browser / inline: same transparent overlay as search & settings (no dim/blur).
  return (
    <div
      className="interaction-ui fixed inset-0 z-[55]"
      role="presentation"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="pointer-events-none fixed inset-0 z-[56] flex items-center justify-center"
        role="presentation"
      >
        <div
          className="pointer-events-auto relative z-[1] w-full max-w-[440px] shadow-[0_8px_28px_rgba(0,0,0,0.18)]"
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {body}
        </div>
      </div>
    </div>
  )
}

export default ExportOptionsPanel
