import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import { InteractionUI } from './InteractionUI'
import { ImportExportPanel } from './ImportExportPanel'
import { HolidaysSyncPanel } from './HolidaysSyncPanel'
import { MemberCalendarsPanel } from './MemberCalendarsPanel'
import { MembersPanel } from './MembersPanel'
import { AccountPanel } from './AccountPanel'
import { SecurityPanel } from './SecurityPanel'
import { ServerManagementPanel } from './ServerManagementPanel'
import { TagsPanel } from './TagsPanel'
import { CalendarColorPalette } from './CalendarColorPalette'
import { CalendarFileFormatButton } from './CalendarFileFormatButton'
import { getDefaultCalendarColor } from '../../../shared/calendarColorPalette'
import { sortCalendarsByOrder } from '../../../shared/calendarOrder'
import { HOLIDAYS_KR_CALENDAR_ID, isProtectedCalendarId } from '../../../shared/calendarDefaults'
import {
  detectCalendarFileFormat,
  downloadCalendarFile,
  exportSingleCalendar,
  extractEventsFromImportPayload,
  parseImportPayload,
  type CalendarFileFormat
} from '../../../shared/calendarInterchange'
import { getJsonExportTimestamp } from '../../../shared/exportTimestamp'
import { eventToMutationPayload } from '../lib/eventMutation'
import { isBrowserNeoCalendarHost } from '../lib/browserNeoCalendar'
import type {
  CalendarEvent,
  CalendarRecord,
  CalendarStoreSnapshot,
  EventInput,
  HeaderTitleOptions,
  MemberRecord,
  MemberSaveInput,
  StoreSettings,
  SyncHolidaysInput,
  SyncHolidaysResult,
  TagRecord,
  ViewOptions
} from '../../../shared/calendarTypes'
import { normalizeHeaderTitle } from '../../../shared/headerTitle'
import type { AppSettings, AuthUser, OpacityPreviewPatch } from '../../../shared/ipc'
import { isSuperAdminUser } from '../../../shared/members'
import {
  applyAccentColor,
  applyColorScheme,
  getColorScheme,
  normalizeAccentColor,
  normalizeColorScheme,
  type ColorScheme
} from '../lib/colorScheme'
import { useAppDialog } from './AppDialogProvider'

type SettingsSection =
  | 'general'
  | 'account'
  | 'add-calendar'
  | 'import-export'
  | 'tags'
  | 'security'
  | 'server'
  | 'members'
  | 'member-calendars'
  | 'holidays'
  | 'calendar-settings'

export type SettingsPanelProps = {
  open: boolean
  surface?: 'inline' | 'floating'
  settings: AppSettings | null
  store: CalendarStoreSnapshot
  user: AuthUser | null
  onClose: () => void
  onSave: (patch: Partial<AppSettings>) => void | Promise<void>
  onPatchStore: (patch: Partial<StoreSettings>) => Promise<void>
  onCreateCalendar: (
    input: Partial<CalendarRecord> & { name: string; color: string }
  ) => Promise<CalendarRecord>
  onPatchCalendar: (id: string, patch: Partial<CalendarRecord>) => Promise<CalendarRecord>
  onReorderCalendars?: (orderedIds: string[]) => Promise<void>
  onDeleteCalendar: (id: string) => Promise<void>
  onClearCalendarEvents: (id: string) => Promise<void>
  onImportIntoCalendar: (
    id: string,
    events: unknown[]
  ) => Promise<{ ok: true; importedCount: number; calendarId: string }>
  onCreateTag: (payload: { name: string; color: string }) => Promise<TagRecord>
  onUpdateTag: (
    id: string,
    patch: Partial<Pick<TagRecord, 'name' | 'color' | 'sortOrder'>>
  ) => Promise<TagRecord>
  onDeleteTag: (id: string) => Promise<void>
  onReplaceStore: (next: CalendarStoreSnapshot) => Promise<void>
  onImportStore: (payload: unknown) => Promise<void>
  onAddEvent: (input: EventInput) => Promise<CalendarEvent>
  onListMembers: () => Promise<MemberRecord[]>
  onSaveMembers: (members: MemberSaveInput[]) => Promise<MemberRecord[]>
  onSyncHolidays: (input?: SyncHolidaysInput) => Promise<SyncHolidaysResult>
  onRefresh: () => Promise<void>
  /** When set (floating panel), opacity sliders preview on the main calendar window. */
  onMainOpacityPreview?: (patch: OpacityPreviewPatch) => void
}

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

function EyeIcon({ open }: { open: boolean }): ReactElement {
  if (open) {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5C21.27 7.61 17 4.5 12 4.5zm0 12.5c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"
        />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78 3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"
      />
    </svg>
  )
}

function CalendarLockIcon(): ReactElement {
  return (
    <span
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-gcal-muted"
      title="삭제할 수 없음"
      aria-label="삭제할 수 없음"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path
          fill="currentColor"
          d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"
        />
      </svg>
    </span>
  )
}

function isSharedCalendar(calendar: CalendarRecord): boolean {
  return calendar.owner === 'shared'
}

function isMyCalendar(calendar: CalendarRecord, currentLoginId: string): boolean {
  if (isSharedCalendar(calendar)) return false
  const owner = String(calendar.ownerLoginId ?? '').trim()
  const me = currentLoginId.trim()
  if (!me) return owner.length === 0
  return owner.length === 0 || owner.toLowerCase() === me.toLowerCase()
}

function NavBtn({
  active,
  children,
  onClick
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      className={cn(
        'settings-nav-btn transition-colors',
        active ? 'is-active' : 'hover:bg-gcal-surface'
      )}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function ViewOptionsPanel({
  storeSettings,
  appSettings,
  currentLoginId,
  onPatchStore,
  onSaveApp,
  onMainOpacityPreview
}: {
  storeSettings: StoreSettings
  appSettings: AppSettings | null
  currentLoginId: string
  onPatchStore: (patch: Partial<StoreSettings>) => Promise<void>
  onSaveApp: (patch: Partial<AppSettings>) => void | Promise<void>
  onMainOpacityPreview?: (patch: OpacityPreviewPatch) => void
}): ReactElement {
  const browserHost = isBrowserNeoCalendarHost()
  const vo = storeSettings.viewOptions
  const [showWeekNumbers, setShowWeekNumbers] = useState(vo.showWeekNumbers !== false)
  const [weekStartsOnSunday, setWeekStartsOnSunday] = useState(vo.weekStartsOnSunday !== false)
  const [roundedCorners, setRoundedCorners] = useState(Boolean(vo.roundedCorners))
  const [headerTitle, setHeaderTitle] = useState<HeaderTitleOptions>(() =>
    normalizeHeaderTitle(vo.headerTitle)
  )
  const [colorScheme, setColorScheme] = useState<ColorScheme>(() => getColorScheme(vo))
  const [accentColor, setAccentColor] = useState(() =>
    normalizeAccentColor(vo.accentColor)
  )
  const [runAtStartup, setRunAtStartup] = useState(Boolean(vo.runAtStartup))
  const [headerOpacity, setHeaderOpacity] = useState(
    appSettings?.headerOpacity ?? storeSettings.headerOpacity
  )
  const [shellOpacity, setShellOpacity] = useState(
    appSettings?.shellOpacity ?? storeSettings.shellOpacity
  )
  const ownerName = currentLoginId || storeSettings.ownerName || ''
  const [dataRoot, setDataRoot] = useState('')

  useEffect(() => {
    setShowWeekNumbers(vo.showWeekNumbers !== false)
    setWeekStartsOnSunday(vo.weekStartsOnSunday !== false)
    setRoundedCorners(Boolean(vo.roundedCorners))
    setHeaderTitle(normalizeHeaderTitle(vo.headerTitle))
    setColorScheme(getColorScheme(vo))
    setAccentColor(normalizeAccentColor(vo.accentColor))
    setRunAtStartup(Boolean(vo.runAtStartup))
    setHeaderOpacity(appSettings?.headerOpacity ?? storeSettings.headerOpacity)
    setShellOpacity(appSettings?.shellOpacity ?? storeSettings.shellOpacity)
    void window.neoCalendar.getDataRoot().then(setDataRoot)
    applyColorScheme(getColorScheme(vo))
    applyAccentColor(normalizeAccentColor(vo.accentColor))
  }, [vo, appSettings, storeSettings])

  useEffect(() => {
    if (!currentLoginId) return
    if ((storeSettings.ownerName ?? '').trim() === currentLoginId) return
    void onPatchStore({ ownerName: currentLoginId })
  }, [currentLoginId, storeSettings.ownerName, onPatchStore])

  const persistView = async (patch: Partial<ViewOptions>): Promise<void> => {
    const next: ViewOptions = {
      ...storeSettings.viewOptions,
      showWeekNumbers,
      weekStartsOnSunday,
      roundedCorners,
      headerTitle,
      colorScheme,
      accentColor,
      runAtStartup,
      ...patch
    }
    if (patch.headerTitle) {
      next.headerTitle = normalizeHeaderTitle(patch.headerTitle)
    }
    await onPatchStore({ viewOptions: next })
    await onSaveApp({
      weekStartsOn: next.weekStartsOnSunday ? 0 : 1
    })
  }

  const persistHeaderTitle = (patch: Partial<HeaderTitleOptions>): void => {
    const next = normalizeHeaderTitle({ ...headerTitle, ...patch })
    setHeaderTitle(next)
    void persistView({ headerTitle: next })
  }

  return (
    <div className="w-full max-w-full text-left">
      <h2 className="mb-8 text-[22px] font-normal text-gcal-heading">보기 옵션</h2>
      <div className="space-y-4">
        <label className="flex items-center gap-2.5 text-sm text-gcal-body">
          <input
            type="checkbox"
            checked={showWeekNumbers}
            onChange={(e) => {
              setShowWeekNumbers(e.target.checked)
              void persistView({ showWeekNumbers: e.target.checked })
            }}
          />
          몇 번째 주인지 표시
        </label>
        <label className="flex items-center gap-2.5 text-sm text-gcal-body">
          <input
            type="checkbox"
            checked={weekStartsOnSunday}
            onChange={(e) => {
              setWeekStartsOnSunday(e.target.checked)
              void persistView({ weekStartsOnSunday: e.target.checked })
            }}
          />
          <span>
            1주일 시작일을 일요일로 하기
            <span className="text-gcal-muted"> (체크 해제 시 1주일 시작일이 월요일로 설정됨)</span>
          </span>
        </label>
        <label className="flex items-center gap-2.5 text-sm text-gcal-body">
          <input
            type="checkbox"
            checked={roundedCorners}
            onChange={(e) => {
              setRoundedCorners(e.target.checked)
              void persistView({ roundedCorners: e.target.checked })
            }}
          />
          <span>
            둥근 모서리
            <span className="text-gcal-muted"> (체크 해제 시 네모난 모서리)</span>
          </span>
        </label>
        <label className="flex items-center gap-2.5 text-sm text-gcal-body">
          <input
            type="checkbox"
            checked={headerTitle.enabled}
            onChange={(e) => persistHeaderTitle({ enabled: e.target.checked })}
          />
          <span>
            헤더에 내 캘린더 이름 표시
            <span className="text-gcal-muted">
              {' '}
              (로고와 검색 사이 · 클릭으로 이름·이모지·색·크기 편집)
            </span>
          </span>
        </label>
      </div>

      <fieldset className="mt-8 space-y-3 border-0 p-0">
        <legend className="mb-8 text-[22px] font-normal text-gcal-heading">테마</legend>
        {(
          [
            ['light', '라이트 모드'],
            ['dark', '다크 모드'],
            ['system', '시스템 설정']
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2.5 text-sm text-gcal-body">
            <input
              type="radio"
              name="colorScheme"
              checked={colorScheme === value}
              onChange={() => {
                const next = normalizeColorScheme(value)
                setColorScheme(next)
                applyColorScheme(next)
                void persistView({ colorScheme: next })
              }}
            />
            {label}
          </label>
        ))}
      </fieldset>

      <fieldset className="mt-8 border-0 p-0">
        <legend className="mb-3 text-[22px] font-normal text-gcal-heading">테마 색상</legend>
        <p className="mb-4 text-sm text-gcal-muted">
          버튼, 강조 표시, 선택된 날짜에 적용되는 강조 색상입니다. 라이트/다크 모드와 별개로 선택할 수
          있어요.
        </p>
        <CalendarColorPalette
          value={accentColor}
          onChange={(color) => {
            const next = normalizeAccentColor(color)
            setAccentColor(next)
            applyAccentColor(next)
            void persistView({ accentColor: next })
          }}
        />
      </fieldset>

      {!browserHost ? (
        <div className="mt-8">
          <h3 className="mb-8 text-[22px] font-normal text-gcal-heading">프로그램 시작시 실행 모드</h3>
          <label className="flex items-center gap-2.5 text-sm text-gcal-body">
            <input
              type="checkbox"
              checked={runAtStartup}
              onChange={(e) => {
                setRunAtStartup(e.target.checked)
                void persistView({ runAtStartup: e.target.checked })
              }}
            />
            컴퓨터 시작시 자동 실행
          </label>
        </div>
      ) : null}

      <div className="mt-8">
        <h3 className="mb-4 text-[22px] font-normal text-gcal-heading">Neo 투명도</h3>
        <label className="mb-4 block text-sm text-gcal-body">
          <span className="mb-1 block text-xs text-gcal-muted">소유자 이름 (회원 ID)</span>
          <input
            className="w-full rounded-lg border border-gcal-border bg-gcal-input px-4 py-3 text-gcal-heading outline-none disabled:opacity-70"
            value={ownerName}
            readOnly
            disabled
            title="로그인한 회원 ID로 자동 설정됩니다."
            placeholder="로그인 후 회원 ID가 표시됩니다"
          />
        </label>
        <label className="mb-4 block text-sm text-gcal-body">
          <span className="mb-1 block text-xs text-gcal-muted">
            헤더 불투명도 ({Math.round(headerOpacity * 100)}%)
          </span>
          <input
            type="range"
            className="w-full"
            min={0.15}
            max={1}
            step={0.01}
            value={headerOpacity}
            onChange={(e) => {
              const next = Number(e.target.value)
              setHeaderOpacity(next)
              if (onMainOpacityPreview) {
                onMainOpacityPreview({ headerOpacity: next })
              } else {
                document.documentElement.style.setProperty('--neo-header-opacity', String(next))
              }
            }}
            onMouseUp={(e) => {
              const next = Number((e.target as HTMLInputElement).value)
              setHeaderOpacity(next)
              void onSaveApp({ headerOpacity: next })
              void onPatchStore({ headerOpacity: next })
            }}
          />
        </label>
        <label className="mb-4 block text-sm text-gcal-body">
          <span className="mb-1 block text-xs text-gcal-muted">
            캘린더 불투명도 ({Math.round(shellOpacity * 100)}%)
          </span>
          <input
            type="range"
            className="w-full"
            min={0.15}
            max={1}
            step={0.01}
            value={shellOpacity}
            onChange={(e) => {
              const next = Number(e.target.value)
              setShellOpacity(next)
              if (onMainOpacityPreview) {
                onMainOpacityPreview({ shellOpacity: next })
              } else {
                document.documentElement.style.setProperty('--neo-shell-opacity', String(next))
              }
            }}
            onMouseUp={(e) => {
              const next = Number((e.target as HTMLInputElement).value)
              setShellOpacity(next)
              void onSaveApp({ shellOpacity: next })
              void onPatchStore({ shellOpacity: next })
            }}
          />
        </label>
        <p className="text-sm text-gcal-muted">데이터 폴더: {dataRoot || '…'}</p>
      </div>
    </div>
  )
}

const fieldBoxClass =
  'rounded-lg border border-gcal-border bg-gcal-input px-4 py-3 focus-within:border-gcal-blue focus-within:ring-2 focus-within:ring-gcal-blue/15'

function FieldLabel({ children }: { children: ReactNode }): ReactElement {
  return <span className="mb-1 block text-xs text-gcal-muted">{children}</span>
}

function CalendarDragHandleIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M9 5h2v2H9V5zm4 0h2v2h-2V5zM9 11h2v2H9v-2zm4 0h2v2h-2v-2zM9 17h2v2H9v-2zm4 0h2v2h-2v-2z"
      />
    </svg>
  )
}

function CalendarNavRow({
  calendar,
  active,
  onOpen,
  onToggleVisible
}: {
  calendar: CalendarRecord
  active: boolean
  onOpen: () => void
  onToggleVisible: () => void
}): ReactElement {
  const visible = calendar.visible !== false
  return (
    <div
      className={cn(
        'flex items-center gap-0.5 rounded-lg',
        active && 'bg-gcal-blue-soft'
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 px-4 py-2 text-left text-sm text-gcal-heading"
        onClick={onOpen}
      >
        <span
          className="inline-block h-3 w-3 shrink-0 rounded-sm"
          style={{ background: calendar.color }}
        />
        <span className="truncate">{calendar.name}</span>
      </button>
      {isProtectedCalendarId(calendar.id) ? <CalendarLockIcon /> : null}
      <button
        type="button"
        className="mr-1.5 inline-flex h-8 w-8 items-center justify-center rounded-lg text-gcal-muted hover:bg-gcal-surface hover:text-gcal-heading"
        title={visible ? '숨기기' : '보이기'}
        aria-label={visible ? '숨기기' : '보이기'}
        onClick={(e) => {
          e.stopPropagation()
          onToggleVisible()
        }}
      >
        <EyeIcon open={visible} />
      </button>
    </div>
  )
}

/** MDC MyCalendarsNavList — drag handle reorders via sortOrder patches. */
function MyCalendarsNavList({
  calendars,
  currentLoginId,
  activeCalendarId,
  activeSection,
  onOpenCalendarSettings,
  onToggleCalendarVisibility,
  onUpdateCalendar,
  onReorderCalendars
}: {
  calendars: CalendarRecord[]
  currentLoginId: string
  activeCalendarId: string | null
  activeSection: SettingsSection
  onOpenCalendarSettings: (id: string) => void
  onToggleCalendarVisibility: (id: string) => void
  onUpdateCalendar: (id: string, patch: Partial<CalendarRecord>) => Promise<CalendarRecord>
  onReorderCalendars?: (orderedIds: string[]) => Promise<void>
}): ReactElement | null {
  const { alert } = useAppDialog()
  const [orderIds, setOrderIds] = useState<string[] | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropId, setDropId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const myCalendars = useMemo(
    () => calendars.filter((calendar) => isMyCalendar(calendar, currentLoginId)),
    [calendars, currentLoginId]
  )

  const sorted = useMemo(() => {
    const base = sortCalendarsByOrder(myCalendars)
    if (!orderIds?.length) return base
    const byId = new Map(base.map((calendar) => [calendar.id, calendar]))
    const ordered: CalendarRecord[] = []
    for (const id of orderIds) {
      const calendar = byId.get(id)
      if (calendar) {
        ordered.push(calendar)
        byId.delete(id)
      }
    }
    ordered.push(...Array.from(byId.values()))
    return ordered
  }, [myCalendars, orderIds])

  useEffect(() => {
    if (!orderIds?.length) return
    const live = sortCalendarsByOrder(myCalendars)
      .map((calendar) => calendar.id)
      .join('\0')
    if (live === orderIds.join('\0')) setOrderIds(null)
  }, [myCalendars, orderIds])

  if (myCalendars.length === 0) return null

  const canDrag = !busy

  const reorderCalendars = async (fromId: string | null, toId: string): Promise<void> => {
    if (!canDrag || !fromId || !toId || fromId === toId) return
    const fromIndex = sorted.findIndex((calendar) => calendar.id === fromId)
    const toIndex = sorted.findIndex((calendar) => calendar.id === toId)
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return

    const next = [...sorted]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    const nextIds = next.map((calendar) => calendar.id)
    setOrderIds(nextIds)
    setBusy(true)
    try {
      if (onReorderCalendars) {
        await onReorderCalendars(nextIds)
      } else {
        for (let i = 0; i < next.length; i += 1) {
          const calendar = next[i]
          if (calendar.sortOrder === i) continue
          await onUpdateCalendar(calendar.id, { sortOrder: i })
        }
      }
    } catch (err) {
      setOrderIds(null)
      await alert(err instanceof Error ? err.message : '캘린더 순서를 바꾸지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="px-2 pt-1">
      <ul className="m-0 list-none space-y-0.5 p-0">
        {sorted.map((calendar) => {
          const isVisible = calendar.visible !== false
          const settingsActive =
            activeSection === 'calendar-settings' && activeCalendarId === calendar.id
          const isDragging = dragId === calendar.id
          const isDropTarget = dropId === calendar.id && dragId && dragId !== calendar.id

          return (
            <li key={calendar.id}>
              <div
                className={cn(
                  'flex items-center gap-0.5 rounded-lg py-2 pl-2 pr-2 text-sm transition-colors',
                  settingsActive ? 'bg-gcal-blue-soft text-gcal-blue-dark' : 'text-gcal-heading',
                  !isVisible && !settingsActive && 'opacity-60',
                  isDragging && 'opacity-45',
                  isDropTarget && 'ring-1 ring-inset ring-gcal-blue bg-gcal-blue-soft/40'
                )}
                onDragOver={(e) => {
                  if (!canDrag || !dragId || dragId === calendar.id) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (dropId !== calendar.id) setDropId(calendar.id)
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setDropId((current) => (current === calendar.id ? null : current))
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const fromId = e.dataTransfer.getData('text/plain') || dragId
                  setDragId(null)
                  setDropId(null)
                  void reorderCalendars(fromId, calendar.id)
                }}
              >
                <button
                  type="button"
                  className={cn(
                    'inline-flex h-8 w-5 shrink-0 items-center justify-center rounded text-gcal-muted',
                    canDrag
                      ? 'cursor-grab hover:bg-gcal-surface-2 hover:text-gcal-heading active:cursor-grabbing'
                      : 'cursor-default opacity-40'
                  )}
                  draggable={canDrag}
                  disabled={!canDrag}
                  tabIndex={canDrag ? 0 : -1}
                  title="끌어 순서 변경"
                  aria-label={`${calendar.name} 순서 변경`}
                  onDragStart={(e) => {
                    if (!canDrag) {
                      e.preventDefault()
                      return
                    }
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', calendar.id)
                    setDragId(calendar.id)
                  }}
                  onDragEnd={() => {
                    setDragId(null)
                    setDropId(null)
                  }}
                >
                  <CalendarDragHandleIcon />
                </button>
                <button
                  type="button"
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent p-0 text-left transition-colors',
                    settingsActive ? 'font-medium' : 'hover:text-gcal-blue'
                  )}
                  onClick={() => onOpenCalendarSettings(calendar.id)}
                >
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]"
                    style={{ background: calendar.color ?? '#039be5' }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate">{calendar.name}</span>
                </button>
                {isProtectedCalendarId(calendar.id) ? <CalendarLockIcon /> : null}
                <button
                  type="button"
                  className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-gcal-muted transition-colors hover:bg-gcal-surface-2 hover:text-gcal-heading"
                  aria-label={isVisible ? '캘린더 숨기기' : '캘린더 보이기'}
                  onClick={(event) => {
                    event.stopPropagation()
                    onToggleCalendarVisibility(calendar.id)
                  }}
                >
                  <EyeIcon open={isVisible} />
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function CalendarSettingsPanel({
  calendarId,
  calendars,
  store,
  currentLoginId,
  onUpdateCalendar,
  onCreateCalendar,
  onAddEvent,
  onClearCalendarEvents,
  onDeleteCalendar,
  onImportIntoCalendar,
  onDeleted,
  onDuplicated
}: {
  calendarId: string
  calendars: CalendarRecord[]
  store: CalendarStoreSnapshot
  currentLoginId: string
  onUpdateCalendar: (id: string, patch: Partial<CalendarRecord>) => Promise<CalendarRecord>
  onCreateCalendar: (
    input: Partial<CalendarRecord> & { name: string; color: string }
  ) => Promise<CalendarRecord>
  onAddEvent: (input: EventInput) => Promise<CalendarEvent>
  onClearCalendarEvents: (id: string) => Promise<void>
  onDeleteCalendar: (id: string) => Promise<void>
  onImportIntoCalendar: (
    id: string,
    events: unknown[]
  ) => Promise<{ ok: true; importedCount: number; calendarId: string }>
  onDeleted?: () => void
  onDuplicated?: (created: CalendarRecord) => void
}): ReactElement | null {
  const { alert, confirm } = useAppDialog()
  const calendar = calendars.find((item) => item.id === calendarId)
  const [name, setName] = useState(calendar?.name ?? '')
  const [description, setDescription] = useState(calendar?.description ?? '')
  const [color, setColor] = useState(calendar?.color ?? getDefaultCalendarColor(0))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    setName(calendar?.name ?? '')
    setDescription(calendar?.description ?? '')
    setColor(calendar?.color ?? getDefaultCalendarColor(0))
    setSaved(false)
  }, [calendar?.id, calendar?.name, calendar?.description, calendar?.color])

  if (!calendar) return null

  const isHolidaysKr = calendar.id === HOLIDAYS_KR_CALENDAR_ID
  const isProtected = isProtectedCalendarId(calendar.id)
  const trimmedName = name.trim()
  const trimmedDescription = description.trim()
  const isDirty =
    !isHolidaysKr &&
    (trimmedName !== calendar.name ||
      trimmedDescription !== (calendar.description ?? '') ||
      color !== calendar.color)

  const handleSave = async (): Promise<void> => {
    if (!trimmedName) {
      await alert('캘린더 이름을 입력해 주세요.')
      return
    }
    if (!isDirty) return

    const patch: Partial<CalendarRecord> = {}
    if (trimmedName !== calendar.name) patch.name = trimmedName
    if (trimmedDescription !== (calendar.description ?? '')) patch.description = trimmedDescription
    if (color !== calendar.color) patch.color = color

    setSaving(true)
    setSaved(false)
    try {
      await onUpdateCalendar(calendar.id, patch)
      setSaved(true)
    } catch (err) {
      await alert(err instanceof Error ? err.message : '캘린더 설정을 저장하지 못했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const handleDuplicate = async (): Promise<void> => {
    setDuplicating(true)
    try {
      const existingNames = new Set(calendars.map((item) => item.name))
      let suffix = 1
      let duplicateName = `${calendar.name} (${suffix})`
      while (existingNames.has(duplicateName)) {
        suffix += 1
        duplicateName = `${calendar.name} (${suffix})`
      }

      const created = await onCreateCalendar({
        name: duplicateName,
        description: calendar.description ?? '',
        color: calendar.color,
        ownerLoginId: currentLoginId || calendar.ownerLoginId,
        ownerName: currentLoginId || calendar.ownerName,
        custom: true
      })

      if (created?.id) {
        const sourceEvents = (store.events ?? []).filter(
          (event) => event.calendarId === calendar.id
        )
        for (const event of sourceEvents) {
          await onAddEvent({ ...eventToMutationPayload(event), calendarId: created.id })
        }
      }

      onDuplicated?.(created)
    } catch (err) {
      await alert(err instanceof Error ? err.message : '캘린더를 복사하지 못했습니다.')
    } finally {
      setDuplicating(false)
    }
  }

  const handleExportCalendar = async (format: CalendarFileFormat): Promise<void> => {
    try {
      if (format === 'zip') {
        const result = await window.neoCalendar.exportCalendarZip(calendar.id)
        if (result?.cancelled) return
        const files = Number(result?.attachmentFiles) || 0
        await alert(
          files > 0
            ? `「${calendar.name}」 캘린더와 첨부 파일 ${files}개를 ZIP으로 저장했습니다.`
            : `「${calendar.name}」 캘린더를 ZIP으로 저장했습니다.`,
          { title: '내보내기 완료' }
        )
        return
      }
      const exportData = {
        calendar,
        events: (store.events ?? []).filter((event) => event.calendarId === calendar.id)
      }
      const { content, filename, mimeType } = exportSingleCalendar(
        exportData,
        format,
        getJsonExportTimestamp()
      )
      downloadCalendarFile(content, filename, mimeType)
      await alert(`「${calendar.name}」 캘린더를 ${format.toUpperCase()} 파일로 내보냈습니다.`, {
        title: '내보내기 완료'
      })
    } catch (err) {
      await alert(err instanceof Error ? err.message : '캘린더 내보내기에 실패했습니다.')
    }
  }

  const handleImportCalendar = async (): Promise<void> => {
    if (importing) return

    setImporting(true)
    try {
      const picked = await window.neoCalendar.pickCalendarImportFile()
      if (picked.cancelled) return

      if (picked.kind === 'zip-restored') {
        throw new Error(
          '전체 ZIP 백업은 설정 → 가져오기 / 내보내기의 파일 선택으로 가져와 주세요.'
        )
      }

      if (picked.kind === 'zip') {
        const result = await window.neoCalendar.importCalendarZipFromPath(
          calendar.id,
          picked.filePath
        )
        if (result?.cancelled) return
        const count = Number(result?.importedCount) || 0
        const files = Number(result?.attachmentFiles) || 0
        await alert(
          files > 0
            ? `「${calendar.name}」에 일정 ${count}건과 첨부 파일 ${files}개를 가져왔습니다.`
            : `「${calendar.name}」에 일정 ${count}건을 가져왔습니다.`,
          { title: '가져오기 완료' }
        )
        return
      }

      const format = detectCalendarFileFormat(picked.filename)
      if (!format || format === 'zip') {
        throw new Error('JSON, ICS, CSV, ZIP 파일만 가져올 수 있습니다.')
      }
      const parsed = parseImportPayload(picked.content, format, picked.filename)
      const events = extractEventsFromImportPayload(parsed)
      if (!events.length) {
        throw new Error('가져올 일정이 없습니다.')
      }
      const result = await onImportIntoCalendar(calendar.id, events)
      const count = result?.importedCount ?? events.length
      await alert(`「${calendar.name}」에 일정 ${count}건을 가져왔습니다.`, {
        title: '가져오기 완료'
      })
    } catch (err) {
      await alert(err instanceof Error ? err.message : '캘린더 가져오기에 실패했습니다.')
    } finally {
      setImporting(false)
    }
  }

  const handleClearCalendarEvents = async (): Promise<void> => {
    const ok = await confirm('이 캘린더의 모든 일정이 삭제됩니다.', {
      variant: 'danger',
      confirmLabel: '초기화'
    })
    if (!ok) return

    setClearing(true)
    try {
      await onClearCalendarEvents(calendar.id)
    } catch (err) {
      await alert(err instanceof Error ? err.message : '캘린더를 초기화하지 못했습니다.')
    } finally {
      setClearing(false)
    }
  }

  const handleDeleteCalendar = async (): Promise<void> => {
    const ok = await confirm('이 캘린더의 모든 일정이 삭제됩니다.', {
      variant: 'danger',
      confirmLabel: '삭제'
    })
    if (!ok) return

    setDeleting(true)
    try {
      await onDeleteCalendar(calendar.id)
      onDeleted?.()
    } catch (err) {
      await alert(err instanceof Error ? err.message : '캘린더를 삭제하지 못했습니다.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="w-full max-w-full text-left">
      <h2 className="mb-8 text-[22px] font-normal text-gcal-heading">캘린더 설정</h2>
      {isHolidaysKr ? (
        <p className="mb-5 text-sm text-gcal-muted">
          이 캘린더의 일정은 설정 → 공휴일 동기화로만 갱신됩니다.
        </p>
      ) : null}
      <div className="space-y-5">
        <div>
          <FieldLabel>일정 색상</FieldLabel>
          <CalendarColorPalette
            value={color}
            onChange={(nextColor) => {
              if (isHolidaysKr) return
              setColor(nextColor)
              setSaved(false)
            }}
          />
        </div>

        <div className={fieldBoxClass}>
          <FieldLabel>이름</FieldLabel>
          <input
            className="w-full border-0 bg-transparent p-0 text-base text-gcal-heading outline-none disabled:opacity-70"
            value={name}
            disabled={isHolidaysKr}
            onChange={(e) => {
              setName(e.target.value)
              setSaved(false)
            }}
          />
        </div>

        <div className={fieldBoxClass}>
          <FieldLabel>설명</FieldLabel>
          <textarea
            className="min-h-[88px] w-full resize-y border-0 bg-transparent p-0 text-base text-gcal-heading outline-none disabled:opacity-70"
            value={description}
            disabled={isHolidaysKr}
            onChange={(e) => {
              setDescription(e.target.value)
              setSaved(false)
            }}
            rows={3}
          />
        </div>
      </div>

      <div className="mt-8 space-y-3">
        {isHolidaysKr ? (
          <div className="flex flex-wrap gap-3">
            <CalendarFileFormatButton
              label="내보내기"
              mode="export"
              className="settings-btn-secondary px-6 py-2.5"
              onSelectFormat={(format) => void handleExportCalendar(format)}
            />
          </div>
        ) : (
          <div className="cal-actions-container">
            <div className="cal-settings-actions">
              <button
                type="button"
                style={{ gridArea: 'save' }}
                onClick={() => void handleSave()}
                disabled={saving || !isDirty || !trimmedName}
                className="settings-btn-primary rounded-full px-6 py-2.5 text-sm font-medium disabled:opacity-60"
              >
                {saving ? '저장 중…' : '저장'}
              </button>

              <button
                type="button"
                style={{ gridArea: 'copy' }}
                onClick={() => void handleDuplicate()}
                disabled={duplicating || saving || clearing || deleting}
                className="settings-btn-secondary rounded-full px-6 py-2.5 text-sm font-medium disabled:opacity-60"
              >
                {duplicating ? '복사 중…' : '복사'}
              </button>

              <div className="min-w-0 w-full" style={{ gridArea: 'export' }}>
                <CalendarFileFormatButton
                  label="내보내기"
                  mode="export"
                  className="settings-btn-secondary w-full px-6 py-2.5"
                  onSelectFormat={(format) => void handleExportCalendar(format)}
                />
              </div>

              <button
                type="button"
                style={{ gridArea: 'import' }}
                onClick={() => void handleImportCalendar()}
                disabled={importing || clearing || deleting || duplicating || saving}
                className="settings-btn-secondary rounded-full px-6 py-2.5 text-sm font-medium disabled:opacity-60"
              >
                {importing ? '가져오는 중…' : '가져오기'}
              </button>

              <button
                type="button"
                style={{ gridArea: 'clear' }}
                onClick={() => void handleClearCalendarEvents()}
                disabled={clearing || deleting || duplicating || importing}
                className="settings-btn-danger rounded-full px-6 py-2.5 text-sm font-medium disabled:opacity-60"
              >
                {clearing ? '초기화 중…' : '초기화'}
              </button>

              {!isProtected ? (
                <button
                  type="button"
                  style={{ gridArea: 'delete' }}
                  onClick={() => void handleDeleteCalendar()}
                  disabled={clearing || deleting || duplicating || importing}
                  className="settings-btn-danger rounded-full px-6 py-2.5 text-sm font-medium disabled:opacity-60"
                >
                  {deleting ? '삭제 중…' : '삭제'}
                </button>
              ) : null}
            </div>
          </div>
        )}

        <p className="min-h-[1.25rem] text-sm text-gcal-muted">
          {saved && !saving ? '저장되었습니다.' : ''}
        </p>
      </div>
    </div>
  )
}

export function SettingsPanel({
  open,
  surface = 'inline',
  settings,
  store,
  user,
  onClose,
  onSave,
  onPatchStore,
  onCreateCalendar,
  onPatchCalendar,
  onReorderCalendars,
  onDeleteCalendar,
  onClearCalendarEvents,
  onImportIntoCalendar,
  onCreateTag,
  onUpdateTag,
  onDeleteTag,
  onReplaceStore,
  onImportStore,
  onAddEvent,
  onListMembers,
  onSaveMembers,
  onSyncHolidays,
  onRefresh,
  onMainOpacityPreview
}: SettingsPanelProps): ReactElement | null {
  const isFloating = surface === 'floating'
  const [section, setSection] = useState<SettingsSection>('general')
  const [selectedCalendarId, setSelectedCalendarId] = useState<string | null>(null)
  const [newCalName, setNewCalName] = useState('')
  const [newCalDesc, setNewCalDesc] = useState('')
  const [newCalColor, setNewCalColor] = useState(() => getDefaultCalendarColor(0))

  const currentLoginId = user?.loginId ?? ''
  const isSuperAdmin = isSuperAdminUser(user)

  const sharedCalendars = useMemo(
    () => sortCalendarsByOrder(store.calendars.filter((c) => isSharedCalendar(c))),
    [store.calendars]
  )
  useEffect(() => {
    if (!open) return
    setSection('general')
    setSelectedCalendarId(null)
    setNewCalColor(getDefaultCalendarColor(store.calendars.length))
  }, [open])

  useEffect(() => {
    if (!isSuperAdmin && ['import-export', 'security', 'server', 'members', 'member-calendars', 'holidays'].includes(section)) {
      setSection('general')
    }
  }, [isSuperAdmin, section])

  /** Trap wheel so only `.settings-scroll` scrolls (calendar underneath stays put). */
  const overlayRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return undefined
    const root = overlayRef.current
    if (!root) return undefined

    const onWheel = (event: WheelEvent): void => {
      const scrollable =
        event.target instanceof Element ? event.target.closest('.settings-scroll') : null
      if (scrollable instanceof HTMLElement) {
        const { scrollTop, scrollHeight, clientHeight } = scrollable
        const atTop = scrollTop <= 0
        const atBottom = scrollTop + clientHeight >= scrollHeight - 1
        if (
          (event.deltaY < 0 && atTop)
          || (event.deltaY > 0 && atBottom)
          || scrollHeight <= clientHeight
        ) {
          event.preventDefault()
        }
        event.stopPropagation()
        return
      }
      event.preventDefault()
      event.stopPropagation()
    }

    root.addEventListener('wheel', onWheel, { passive: false })
    return () => root.removeEventListener('wheel', onWheel)
  }, [open])

  if (!open) return null

  const openCalendarSettings = (id: string): void => {
    setSelectedCalendarId(id)
    setSection('calendar-settings')
  }

  // Defer unmount so the same click cannot retarget to header Excel/PDF underneath (MDC).
  const requestClose = (event?: { preventDefault?: () => void; stopPropagation?: () => void }): void => {
    event?.preventDefault?.()
    event?.stopPropagation?.()
    window.setTimeout(() => onClose(), 0)
  }

  return (
    <div
      className={isFloating ? 'h-full w-full' : 'interaction-ui fixed inset-0 z-[55]'}
      role="presentation"
      onClick={isFloating ? undefined : requestClose}
    >
      <div
        ref={overlayRef}
        className={
          isFloating
            ? 'flex h-full w-full'
            : 'pointer-events-none fixed inset-0 z-[56] flex items-center justify-center'
        }
        role="presentation"
      >
        <InteractionUI
          className={`shell-solid-surface settings-panel-shell pointer-events-auto relative z-[1] flex min-h-0 overflow-hidden rounded-xl${isFloating ? '' : ' shadow-[0_8px_28px_rgba(0,0,0,0.18)]'} ${isFloating ? 'h-full w-full max-h-full' : 'h-[80%] w-[90%] max-h-[80%]'}`}
          role="dialog"
          aria-label="설정"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="absolute right-3 top-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full text-gcal-muted transition-colors hover:bg-gcal-surface-2 hover:text-gcal-heading"
            onClick={requestClose}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label="설정 닫기"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                fill="currentColor"
                d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
              />
            </svg>
          </button>

          <aside
            className="settings-panel-line-r flex w-72 shrink-0 flex-col overflow-hidden py-4"
            style={{ backgroundColor: 'var(--gcal-page-solid)' }}
          >
            <nav className="settings-scroll flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pt-2">
              <NavBtn active={section === 'general'} onClick={() => setSection('general')}>
                일반
              </NavBtn>
              <NavBtn active={section === 'account'} onClick={() => setSection('account')}>
                내 계정
              </NavBtn>
              <NavBtn active={section === 'add-calendar'} onClick={() => setSection('add-calendar')}>
                새 캘린더 만들기
              </NavBtn>
              {isSuperAdmin ? (
                <NavBtn
                  active={section === 'import-export'}
                  onClick={() => setSection('import-export')}
                >
                  가져오기 / 내보내기
                </NavBtn>
              ) : null}
              <NavBtn active={section === 'tags'} onClick={() => setSection('tags')}>
                태그 관리
              </NavBtn>
              {isSuperAdmin ? (
                <>
                  <NavBtn active={section === 'security'} onClick={() => setSection('security')}>
                    보안 관리
                  </NavBtn>
                  <NavBtn active={section === 'server'} onClick={() => setSection('server')}>
                    서버 관리
                  </NavBtn>
                  <NavBtn active={section === 'members'} onClick={() => setSection('members')}>
                    회원 관리
                  </NavBtn>
                  <NavBtn
                    active={section === 'member-calendars'}
                    onClick={() => setSection('member-calendars')}
                  >
                    회원 캘린더 관리
                  </NavBtn>
                  <NavBtn active={section === 'holidays'} onClick={() => setSection('holidays')}>
                    대한민국의 휴일(공공데이터 API)
                  </NavBtn>
                </>
              ) : null}

              <div className="my-3" aria-hidden="true" />

              <p className="settings-aside-label">내 캘린더</p>
              <MyCalendarsNavList
                calendars={store.calendars}
                currentLoginId={currentLoginId}
                activeCalendarId={selectedCalendarId}
                activeSection={section}
                onOpenCalendarSettings={openCalendarSettings}
                onToggleCalendarVisibility={(id) => {
                  const cal = store.calendars.find((c) => c.id === id)
                  if (!cal) return
                  void onPatchCalendar(id, { visible: cal.visible === false })
                }}
                onUpdateCalendar={onPatchCalendar}
                onReorderCalendars={onReorderCalendars}
              />

              <p className="settings-aside-label settings-aside-label--gap">고정 캘린더</p>
              {sharedCalendars.map((cal) => (
                <CalendarNavRow
                  key={cal.id}
                  calendar={cal}
                  active={section === 'calendar-settings' && selectedCalendarId === cal.id}
                  onOpen={() => openCalendarSettings(cal.id)}
                  onToggleVisible={() =>
                    void onPatchCalendar(cal.id, { visible: cal.visible === false })
                  }
                />
              ))}
            </nav>
          </aside>

          <div className="settings-scroll min-h-0 min-w-0 flex-1 overflow-y-auto px-8 py-8 pr-14 text-left md:px-10 md:pr-14">
          {section === 'general' && (
            <ViewOptionsPanel
              storeSettings={store.settings}
              appSettings={settings}
              currentLoginId={currentLoginId}
              onPatchStore={onPatchStore}
              onSaveApp={onSave}
              onMainOpacityPreview={onMainOpacityPreview}
            />
          )}

          {section === 'add-calendar' && (
            <div className="w-full max-w-full text-left">
              <h2 className="mb-8 text-[22px] font-normal text-gcal-heading">새 캘린더 만들기</h2>
              <div className="space-y-5">
                <div>
                  <span className="mb-1 block text-xs text-gcal-muted">일정 색상</span>
                  <CalendarColorPalette value={newCalColor} onChange={setNewCalColor} />
                </div>
                <div className="rounded-lg border border-gcal-border bg-gcal-input px-4 py-3 focus-within:border-gcal-blue focus-within:ring-2 focus-within:ring-gcal-blue/15">
                  <span className="mb-1 block text-xs text-gcal-muted">이름</span>
                  <input
                    className="w-full border-0 bg-transparent p-0 text-base text-gcal-heading outline-none"
                    value={newCalName}
                    onChange={(e) => setNewCalName(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="rounded-lg border border-gcal-border bg-gcal-input px-4 py-3 focus-within:border-gcal-blue focus-within:ring-2 focus-within:ring-gcal-blue/15">
                  <span className="mb-1 block text-xs text-gcal-muted">설명</span>
                  <textarea
                    className="min-h-[88px] w-full resize-y border-0 bg-transparent p-0 text-base text-gcal-heading outline-none"
                    rows={3}
                    value={newCalDesc}
                    onChange={(e) => setNewCalDesc(e.target.value)}
                  />
                </div>
              </div>
              <button
                type="button"
                disabled={!newCalName.trim() || !user}
                className="settings-btn-primary mt-8 rounded-full px-6 py-2.5 text-sm font-medium disabled:opacity-60"
                onClick={() => {
                  void onCreateCalendar({
                    name: newCalName.trim(),
                    description: newCalDesc.trim(),
                    color: newCalColor,
                    custom: true,
                    ownerLoginId: currentLoginId || undefined,
                    ownerName: currentLoginId || undefined
                  }).then((created) => {
                    setNewCalName('')
                    setNewCalDesc('')
                    setNewCalColor(getDefaultCalendarColor(store.calendars.length + 1))
                    openCalendarSettings(created.id)
                  })
                }}
              >
                캘린더 만들기
              </button>
              {!user ? <p className="mt-4 text-sm text-gcal-muted">로그인 후 캘린더를 추가할 수 있습니다.</p> : null}
            </div>
          )}

          {section === 'import-export' && isSuperAdmin && (
            <ImportExportPanel
              store={store}
              onImport={onImportStore}
              onRefresh={onRefresh}
            />
          )}

          {section === 'account' && <AccountPanel user={user} />}

          {section === 'tags' && (
            <TagsPanel
              tags={store.tags}
              onCreateTag={onCreateTag}
              onUpdateTag={onUpdateTag}
              onDeleteTag={onDeleteTag}
            />
          )}

          {section === 'security' && isSuperAdmin && (
            <SecurityPanel settings={store.settings} onSaveSettings={onPatchStore} />
          )}

          {section === 'members' && isSuperAdmin && (
            <MembersPanel
              listMembers={onListMembers}
              saveMembers={onSaveMembers}
              settings={store.settings}
              onSaveSettings={onPatchStore}
            />
          )}

          {section === 'member-calendars' && isSuperAdmin && (
            <MemberCalendarsPanel
              calendars={store.calendars}
              currentLoginId={currentLoginId}
              onOpenCalendarSettings={openCalendarSettings}
              onToggleCalendarVisibility={(id) => {
                const cal = store.calendars.find((c) => c.id === id)
                if (!cal) return
                void onPatchCalendar(id, { visible: cal.visible === false })
              }}
            />
          )}

          {section === 'server' && isSuperAdmin && (
            <ServerManagementPanel
              settings={store.settings}
              onSaveSettings={onPatchStore}
            />
          )}

          {section === 'holidays' && isSuperAdmin && (
            <HolidaysSyncPanel
              settings={store.settings}
              onSyncHolidays={onSyncHolidays}
              onSaveSettings={onPatchStore}
            />
          )}

          {section === 'calendar-settings' && selectedCalendarId ? (
            <CalendarSettingsPanel
              calendarId={selectedCalendarId}
              calendars={store.calendars}
              store={store}
              currentLoginId={currentLoginId}
              onUpdateCalendar={onPatchCalendar}
              onCreateCalendar={onCreateCalendar}
              onAddEvent={onAddEvent}
              onClearCalendarEvents={onClearCalendarEvents}
              onDeleteCalendar={onDeleteCalendar}
              onImportIntoCalendar={onImportIntoCalendar}
              onDeleted={() => {
                setSelectedCalendarId(null)
                setSection('general')
              }}
              onDuplicated={(created) => {
                if (created?.id) openCalendarSettings(created.id)
              }}
            />
          ) : null}
          </div>
        </InteractionUI>
      </div>
    </div>
  )
}

export default SettingsPanel
