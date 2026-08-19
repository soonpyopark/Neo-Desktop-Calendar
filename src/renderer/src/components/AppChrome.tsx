import { useRef, type MouseEvent, type ReactElement, type Ref } from 'react'
import { InteractionUI } from './InteractionUI'
import {
  DesktopModeIcon,
  ExportIcon,
  HelpIcon,
  SearchIcon,
  SettingsIcon,
  WindowModeIcon
} from './CalendarHeaderIcons'
import { APP_NAME, APP_VERSION } from '../../../shared/constants'
import {
  actionBtnBase,
  iconBtnClass,
  iconBtnDisabledClass,
  softBlueIconBtnMutedClass
} from '../lib/headerButtonClasses'
import type { HeaderTitleOptions } from '../../../shared/calendarTypes'
import { normalizeHeaderTitle } from '../../../shared/headerTitle'
import type { AuthUser, LaunchMode } from '../../../shared/ipc'
import { CHROME_TOOLBAR_ACTIONS } from '../../../shared/ipc'

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export type AppChromeProps = {
  mode: LaunchMode
  user: AuthUser | null
  /** When set, overrides `Boolean(user)` for toolbar enablement (browser token fallback). */
  loggedIn?: boolean
  /** Optional personal calendar name between logo and search. */
  headerTitle?: HeaderTitleOptions | null
  searchOpen: boolean
  settingsOpen: boolean
  exporting?: boolean
  modeBusy?: boolean
  /** From main: false while cursor must leave the header after a mode switch. */
  switchReady?: boolean
  /** WorkerW-embedded: clicks via main bridge, not hover wake. */
  embedded?: boolean
  chromeRef?: Ref<HTMLDivElement | null>
  onOpenSearch: (event: MouseEvent<HTMLElement>) => void
  onOpenSettings: () => void
  onExport: () => void
  /** Open the full footer-hints help panel (search-sized). */
  onOpenFooterHelp: () => void
  onEnterDesktop: () => void
  onEnterWindow: () => void
  onAuthToggle: () => void
  /** Open header-title editor (click / double-click on the title). */
  onHeaderTitleEdit?: () => void
  /** Logged-out click on edit-gated chrome controls. */
  onLoginRequired?: () => void
}

export function AppChrome({
  mode,
  user,
  loggedIn: loggedInProp,
  headerTitle: headerTitleProp = null,
  searchOpen,
  settingsOpen,
  exporting = false,
  modeBusy = false,
  switchReady = true,
  embedded = false,
  chromeRef,
  onOpenSearch,
  onOpenSettings,
  onExport,
  onOpenFooterHelp,
  onEnterDesktop,
  onEnterWindow,
  onAuthToggle,
  onHeaderTitleEdit,
  onLoginRequired
}: AppChromeProps): ReactElement {
  const isDesktop = mode === 'desktop'
  const isWindow = mode === 'window'
  const loggedIn = loggedInProp ?? Boolean(user)
  const localChromeRef = useRef<HTMLDivElement | null>(null)
  const modeButtonsReady = switchReady && !modeBusy
  const captureOnHover = !embedded
  const headerTitle = normalizeHeaderTitle(headerTitleProp)
  const showHeaderTitle = Boolean(headerTitle.enabled && headerTitle.text.trim())

  const setChromeRef = (node: HTMLDivElement | null): void => {
    localChromeRef.current = node
    if (typeof chromeRef === 'function') chromeRef(node)
    else if (chromeRef) (chromeRef as { current: HTMLDivElement | null }).current = node
  }

  const runReload = (): void => {
    if (!loggedIn) {
      onLoginRequired?.()
      return
    }
    window.location.reload()
  }

  const runHeaderTitleEdit = (): void => {
    if (!loggedIn) {
      onLoginRequired?.()
      return
    }
    onHeaderTitleEdit?.()
  }

  return (
    <div
      ref={setChromeRef}
      className={cn(
        'interaction-ui relative flex min-w-0 items-center gap-2',
        isWindow && 'is-window-mode'
      )}
      data-shell-chrome="header-actions"
    >
      <div className="relative z-10 flex min-w-0 shrink-0 items-center gap-2.5 whitespace-nowrap app-chrome-drag">
        <div className="flex items-baseline gap-2">
          <InteractionUI
            as="button"
            className={cn(
              'app-chrome-no-drag whitespace-nowrap border-0 bg-transparent p-0 text-[22px] tracking-tight text-gcal-muted transition-colors hover:text-gcal-blue',
              !loggedIn && 'cursor-not-allowed opacity-40 hover:text-gcal-muted'
            )}
            captureOnHover={captureOnHover}
            data-toolbar-action={CHROME_TOOLBAR_ACTIONS.reload}
            title={loggedIn ? '클릭하여 새로고침' : '로그인 후 사용할 수 있습니다'}
            aria-label="새로고침"
            onClick={(event) => {
              event.preventDefault()
              runReload()
            }}
          >
            {APP_NAME}
          </InteractionUI>
          <span className="shrink-0 text-xs font-medium text-gcal-muted/80">v{APP_VERSION}</span>
        </div>
      </div>

      {/* True horizontal center of the full header (not the leftover flex gap). */}
      {showHeaderTitle ? (
        <div className="app-chrome-header-title-slot pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-2">
          <InteractionUI
            as="button"
            type="button"
            className={cn(
              'app-chrome-header-title app-chrome-no-drag pointer-events-auto max-w-[min(100%,42%)] truncate border-0 bg-transparent px-1.5 py-1 font-semibold tracking-tight cursor-pointer'
            )}
            style={{
              color: headerTitle.color,
              fontSize: `${headerTitle.fontSizePx}px`,
              lineHeight: 1.2
            }}
            captureOnHover={captureOnHover}
            data-toolbar-action={CHROME_TOOLBAR_ACTIONS.editHeaderTitle}
            aria-label="내 캘린더 이름 편집"
            title={loggedIn ? `${headerTitle.text} (클릭하여 편집)` : headerTitle.text}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              runHeaderTitleEdit()
            }}
          >
            {headerTitle.text}
          </InteractionUI>
        </div>
      ) : null}

      <div className="app-chrome-no-drag relative z-10 ml-auto flex min-w-0 shrink-0 flex-nowrap items-center justify-end gap-0.5 sm:gap-1">
        <InteractionUI
          as="button"
          className={cn(
            iconBtnClass,
            (!loggedIn || settingsOpen) && 'cursor-not-allowed opacity-40'
          )}
          captureOnHover={captureOnHover}
          data-toolbar-action={CHROME_TOOLBAR_ACTIONS.search}
          aria-label="검색"
          title={
            !loggedIn
              ? '로그인 후 검색할 수 있습니다'
              : settingsOpen
                ? '설정을 닫은 후 검색할 수 있습니다'
                : '검색'
          }
          disabled={loggedIn ? settingsOpen : false}
          onClick={(event) => {
            if (!loggedIn) {
              onLoginRequired?.()
              return
            }
            if (settingsOpen) return
            onOpenSearch(event)
          }}
        >
          <SearchIcon />
        </InteractionUI>

        <InteractionUI
          as="button"
          className={cn(
            iconBtnClass,
            (!loggedIn || searchOpen) && 'cursor-not-allowed opacity-40'
          )}
          captureOnHover={captureOnHover}
          data-toolbar-action={CHROME_TOOLBAR_ACTIONS.settings}
          aria-label="설정"
          title={
            !loggedIn
              ? '로그인 후 설정을 사용할 수 있습니다'
              : searchOpen
                ? '검색을 닫은 후 설정할 수 있습니다'
                : '설정'
          }
          disabled={loggedIn ? searchOpen : false}
          onClick={() => {
            if (!loggedIn) {
              onLoginRequired?.()
              return
            }
            if (searchOpen) return
            onOpenSettings()
          }}
        >
          <SettingsIcon />
        </InteractionUI>

        <InteractionUI
          as="button"
          className={cn(
            iconBtnClass,
            (!loggedIn || exporting || settingsOpen || searchOpen) &&
              'cursor-not-allowed opacity-40'
          )}
          captureOnHover={captureOnHover}
          data-toolbar-action={CHROME_TOOLBAR_ACTIONS.export}
          aria-label="내보내기"
          title={!loggedIn ? '로그인 후 내보낼 수 있습니다' : '내보내기'}
          disabled={loggedIn ? exporting || settingsOpen || searchOpen : false}
          onClick={() => {
            if (!loggedIn) {
              onLoginRequired?.()
              return
            }
            onExport()
          }}
        >
          <ExportIcon />
        </InteractionUI>

        <InteractionUI
          as="button"
          className={iconBtnClass}
          captureOnHover={captureOnHover}
          data-toolbar-action={CHROME_TOOLBAR_ACTIONS.footerHelp}
          aria-label="도움말"
          title="도움말 — 모든 푸터 힌트"
          onClick={() => {
            onOpenFooterHelp()
          }}
        >
          <HelpIcon />
        </InteractionUI>

        <div className="inline-flex items-center gap-0.5">
          <InteractionUI
            as="button"
            className={cn(
              iconBtnClass,
              iconBtnDisabledClass,
              isDesktop && softBlueIconBtnMutedClass
            )}
            captureOnHover={captureOnHover}
            data-toolbar-action={CHROME_TOOLBAR_ACTIONS.enterDesktop}
            aria-label="바탕화면모드"
            aria-pressed={isDesktop}
            title={
              isDesktop
                ? '바탕화면 모드 — 아이콘 아래'
                : !switchReady
                  ? '잠시만 기다려 주세요'
                  : '바탕화면에 고정 (아이콘 아래로 들어감)'
            }
            disabled={modeBusy || isDesktop || !modeButtonsReady}
            onClick={() => {
              if (!modeButtonsReady) return
              onEnterDesktop()
            }}
          >
            <DesktopModeIcon />
          </InteractionUI>

          <InteractionUI
            as="button"
            className={cn(
              iconBtnClass,
              iconBtnDisabledClass,
              isWindow && softBlueIconBtnMutedClass
            )}
            captureOnHover={captureOnHover}
            data-toolbar-action={CHROME_TOOLBAR_ACTIONS.enterWindow}
            aria-label="창모드"
            aria-pressed={isWindow}
            title={
              !switchReady ? '잠시만 기다려 주세요' : '창 모드 — 이동·크기조절 가능'
            }
            disabled={modeBusy || isWindow || !modeButtonsReady}
            onClick={() => {
              if (!modeButtonsReady) return
              onEnterWindow()
            }}
          >
            <WindowModeIcon />
          </InteractionUI>
        </div>

        <InteractionUI
          as="button"
          className={cn(
            actionBtnBase,
            'bg-gcal-blue-soft hover:bg-[#d2e3fc] dark:hover:bg-gcal-surface-2'
          )}
          captureOnHover={captureOnHover}
          data-toolbar-action={CHROME_TOOLBAR_ACTIONS.authToggle}
          title={loggedIn && user ? `${user.loginId} 로그아웃` : '로그인'}
          onClick={() => {
            onAuthToggle()
          }}
        >
          {loggedIn ? '로그아웃' : '로그인'}
        </InteractionUI>
      </div>
    </div>
  )
}
