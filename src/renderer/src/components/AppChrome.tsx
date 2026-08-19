import { useRef, type ReactElement, type Ref } from 'react'
import { InteractionUI } from './InteractionUI'
import { APP_NAME, APP_VERSION } from '../../../shared/constants'
import { actionBtnBase } from '../lib/headerButtonClasses'
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
  /** WorkerW-embedded: clicks via main bridge, not hover wake. */
  embedded?: boolean
  chromeRef?: Ref<HTMLDivElement | null>
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
  embedded = false,
  chromeRef,
  onAuthToggle,
  onHeaderTitleEdit,
  onLoginRequired
}: AppChromeProps): ReactElement {
  const isWindow = mode === 'window'
  const loggedIn = loggedInProp ?? Boolean(user)
  const localChromeRef = useRef<HTMLDivElement | null>(null)
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
