import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { FOOTER_HINTS, groupFooterHintsByCategory } from '../content/footerHints'
import { cn } from '../lib/cn'
import { runUpdateCheck } from '../lib/updateCheckUi'
import { useAppDialog } from './AppDialogProvider'

export type FooterHelpPanelProps = {
  open: boolean
  surface?: 'inline' | 'floating'
  onClose: () => void
}

function HelpTitleIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        fill="currentColor"
        d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z"
      />
    </svg>
  )
}

export function FooterHelpPanel({
  open,
  surface = 'inline',
  onClose
}: FooterHelpPanelProps): ReactElement | null {
  const isFloating = surface === 'floating'
  const { alert, confirm } = useAppDialog()
  const [query, setQuery] = useState('')
  const [updateChecking, setUpdateChecking] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    const id = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const groups = useMemo(() => groupFooterHintsByCategory(FOOTER_HINTS), [])

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return groups
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          const hay = `${group.category} ${item.area} ${item.body}`.toLowerCase()
          return hay.includes(q)
        })
      }))
      .filter((group) => group.items.length > 0)
  }, [groups, query])

  const totalVisible = filteredGroups.reduce((sum, g) => sum + g.items.length, 0)

  const handleUpdateCheck = (): void => {
    if (updateChecking) return
    setUpdateChecking(true)
    void runUpdateCheck({ alert, confirm }).finally(() => setUpdateChecking(false))
  }

  if (!open) return null

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
            'search-panel-shell shell-solid-surface pointer-events-auto relative z-[1] flex min-h-0 overflow-hidden rounded-xl',
            isFloating
              ? 'h-full w-full max-h-full flex-col'
              : 'h-[80%] w-[90%] max-h-[80%] flex-col shadow-[0_8px_28px_rgba(0,0,0,0.18)]'
          )}
          role="dialog"
          aria-modal="true"
          aria-label="도움말"
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="search-panel-query-row search-panel-line-b flex h-14 shrink-0 items-center gap-1 px-3">
            <span
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center text-gcal-muted"
              aria-hidden="true"
            >
              <HelpTitleIcon />
            </span>
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="도움말 검색"
              className="search-panel-query-input min-w-0 h-9 flex-1 border-0 bg-transparent py-0 text-base leading-9 text-gcal-heading outline-none placeholder:text-gcal-muted"
              aria-label="도움말 검색"
              autoComplete="off"
              spellCheck={false}
            />
            {query.trim() ? (
              <button
                type="button"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gcal-muted transition-colors hover:bg-gcal-surface-2 hover:text-gcal-heading"
                onClick={() => {
                  setQuery('')
                  inputRef.current?.focus()
                }}
                aria-label="검색어 지우기"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"
                  />
                </svg>
              </button>
            ) : null}
            <button
              type="button"
              className="inline-flex h-9 shrink-0 items-center justify-center rounded-full px-3 text-sm font-medium leading-none text-gcal-blue transition-colors hover:bg-gcal-blue-soft disabled:opacity-60"
              onClick={handleUpdateCheck}
              disabled={updateChecking}
              title="GitHub Releases에서 새 버전·이 OS용 빌드를 확인합니다"
            >
              {updateChecking ? '확인 중…' : '업데이트 확인'}
            </button>
            <button
              type="button"
              className="inline-flex h-9 shrink-0 items-center justify-center rounded-full px-3 text-sm font-medium leading-none text-gcal-blue transition-colors hover:bg-gcal-blue-soft"
              onClick={onClose}
            >
              닫기
            </button>
          </div>

          <div className="search-panel-line-b flex shrink-0 items-center gap-2 bg-gcal-surface-2 px-4 py-2 text-xs text-gcal-muted">
            <span>
              {query.trim()
                ? `${totalVisible}개 표시 · 전체 ${FOOTER_HINTS.length}개`
                : `전체 ${FOOTER_HINTS.length}개 · 분야별 목록`}
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-0">
            {filteredGroups.length === 0 ? (
              <p className="m-0 px-2 py-8 text-center text-sm text-gcal-muted">
                검색 결과가 없습니다.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {filteredGroups.map((group) => (
                  <section key={group.category} className="min-w-0">
                    <h2 className="sticky top-0 z-[1] m-0 -mx-3 mb-1.5 border-b border-gcal-border/60 bg-[var(--gcal-page-solid)] px-5 py-2 text-sm font-semibold text-gcal-heading">
                      {group.category}
                      <span className="ml-2 text-xs font-normal text-gcal-muted">
                        {group.items.length}
                      </span>
                    </h2>
                    <ul className="m-0 list-none space-y-1 p-0">
                      {group.items.map((item) => (
                        <li
                          key={item.raw}
                          className="rounded-lg border border-gcal-border/70 bg-gcal-page/40 px-3 py-1.5"
                        >
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            {item.area ? (
                              <span className="inline-flex shrink-0 rounded-full border border-gcal-border bg-gcal-surface-2 px-2 py-0.5 text-[11px] font-medium text-gcal-muted">
                                {item.area}
                              </span>
                            ) : null}
                            <p className="m-0 min-w-0 flex-1 text-sm leading-snug text-gcal-body">
                              {item.body}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default FooterHelpPanel
