/**
 * MDC Header.jsx button class strings — keep in sync with
 * `My Desktop Calendar v1.1.6/src/components/Header.jsx`.
 */

export const iconBtnClass =
  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded border border-transparent text-gcal-muted transition-colors hover:border-gcal-border hover:bg-gcal-surface-2'

export const iconBtnDisabledClass =
  'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-transparent disabled:hover:bg-transparent'

export const navBtnClass =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-gcal-border bg-gcal-yellow-soft text-gcal-heading transition-colors hover:bg-[#fef0c3] dark:hover:bg-gcal-surface-2'

export const yearNavBtnClass =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-gcal-border bg-gcal-yellow-soft text-gcal-heading transition-colors hover:bg-[#fef0c3] dark:hover:bg-gcal-surface-2'

export const viewModeIconBtnClass =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-gcal-border bg-gcal-green-soft text-gcal-heading transition-colors hover:bg-[#dcefe0] dark:hover:bg-gcal-surface-2'

export const viewModeIconBtnActiveClass =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-gcal-blue bg-[#bbdefb] text-gcal-blue-dark transition-colors hover:bg-[#90caf9] dark:border-gcal-blue dark:bg-gcal-blue-soft'

export const desktopModeIconBtnClass =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border transition-colors disabled:cursor-not-allowed disabled:opacity-40'

/** Soft blue fill for web / eye / completed toolbar icons (MDC). */
export const softBlueIconBtnClass =
  'border-gcal-border bg-[#e3f2fd] text-gcal-blue-dark hover:bg-[#bbdefb] dark:border-gcal-border dark:bg-gcal-blue-soft dark:text-gcal-heading dark:hover:bg-gcal-surface-2'

export const softBlueIconBtnActiveClass =
  'border-gcal-blue bg-[#bbdefb] text-gcal-blue-dark hover:bg-[#90caf9] dark:border-gcal-blue dark:bg-gcal-blue-soft'

/** Month density −/+ next to 세로보기. */
export const densityIconBtnClass =
  'border-gcal-border bg-gcal-surface-2 text-gcal-heading hover:bg-[#e8eaed] dark:border-gcal-border dark:bg-gcal-surface-2 dark:hover:bg-gcal-surface'

/** 세로보기 — richer blue so it reads clearly next to the soft-blue hide toggles. */
export const dayListPreviewIconBtnClass =
  'border-[#64b5f6] bg-[#90caf9] text-[#0d47a1] hover:bg-[#64b5f6] dark:border-[#64b5f6] dark:bg-[#1565c0] dark:text-[#e3f2fd] dark:hover:bg-[#1976d2]'

export const dayListPreviewIconBtnActiveClass =
  'border-[#1e88e5] bg-[#42a5f5] text-[#0d47a1] hover:bg-[#1e88e5] dark:border-[#42a5f5] dark:bg-[#0d47a1] dark:text-[#e3f2fd] dark:hover:bg-[#1565c0]'

/** Pressed state for hide-all / hide-completed — red so the toggle is obvious. */
export const softRedIconBtnActiveClass =
  'border-[#e57373] bg-[#ef9a9a] text-[#b71c1c] hover:bg-[#e57373] dark:border-[#e57373] dark:bg-[#5c2b29] dark:text-[#fce8e6] dark:hover:bg-[#7a3b38]'

/** Current mode already applied — keep control but fade it. */
export const softBlueIconBtnMutedClass = 'opacity-45 hover:opacity-70'

export const actionBtnBase =
  'inline-flex h-9 shrink-0 items-center justify-center rounded border border-gcal-border px-2 text-xs font-semibold text-gcal-heading disabled:cursor-not-allowed disabled:opacity-40 sm:min-w-[72px] sm:px-3 sm:text-sm'

export const todayBtnClass =
  'inline-flex h-7 shrink-0 items-center justify-center rounded border border-gcal-border bg-gcal-red-soft px-2.5 text-xs font-medium text-gcal-heading transition-colors hover:bg-[#fad2cf] dark:hover:bg-gcal-surface-2'

/** 「오늘」 fill in the square icon geometry (세로보기). */
export const todayIconBtnClass =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-gcal-border bg-gcal-red-soft text-gcal-heading transition-colors hover:bg-[#fad2cf] dark:hover:bg-gcal-surface-2'

export const headerShellClass =
  'relative z-[60] flex shrink-0 flex-col gap-2 border-b border-gcal-border-light px-4 py-2 neo-mdc-chrome'

export const footerShellClass =
  'relative z-20 flex shrink-0 items-center justify-between gap-3 border-t border-gcal-grid-line px-4 py-2 neo-mdc-chrome'
