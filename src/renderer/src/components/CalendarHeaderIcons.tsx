import type { ReactElement, ReactNode } from 'react'

function CalendarOutlineIcon({ children }: { children?: ReactNode }): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none">
      <path d="M7 2.5v3M17 2.5v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="3.25" y="4.5" width="17.5" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.25 9.25h17.5" stroke="currentColor" strokeWidth="1.6" />
      {children}
    </svg>
  )
}

export function MonthViewIcon(): ReactElement {
  return (
    <CalendarOutlineIcon>
      <rect x="5.75" y="11" width="3.4" height="2.6" rx="0.6" fill="currentColor" />
      <rect x="10.3" y="11" width="3.4" height="2.6" rx="0.6" fill="currentColor" />
      <rect x="14.85" y="11" width="3.4" height="2.6" rx="0.6" fill="currentColor" />
      <rect x="5.75" y="15.4" width="3.4" height="2.6" rx="0.6" fill="currentColor" />
      <rect x="10.3" y="15.4" width="3.4" height="2.6" rx="0.6" fill="currentColor" />
    </CalendarOutlineIcon>
  )
}

export function WeekViewIcon(): ReactElement {
  return (
    <CalendarOutlineIcon>
      <rect x="5.75" y="12.3" width="12.5" height="4" rx="0.8" fill="currentColor" />
    </CalendarOutlineIcon>
  )
}

export function YearViewIcon(): ReactElement {
  return (
    <CalendarOutlineIcon>
      {[11.05, 13.65, 16.25].flatMap((y) =>
        [5.75, 9.15, 12.55, 15.95].map((x) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="2.3" height="1.7" rx="0.4" fill="currentColor" />
        ))
      )}
    </CalendarOutlineIcon>
  )
}

export function DoubleChevronLeftIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M18.41 16.59 13.82 12l4.59-4.59L17 6l-6 6 6 6 1.41-1.41zM10 6H8v12h2V6z"
      />
    </svg>
  )
}

export function DoubleChevronRightIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M5.59 7.41 10.18 12l-4.59 4.59L7 18l6-6-6-6-1.41 1.41zM16 6h-2v12h2V6z"
      />
    </svg>
  )
}

export function ChevronLeftIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path fill="currentColor" d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
    </svg>
  )
}

export function ChevronRightIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path fill="currentColor" d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
    </svg>
  )
}

export function ChevronUpIcon({ size = 20 }: { size?: number }): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path fill="currentColor" d="M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6 1.41 1.41z" />
    </svg>
  )
}

export function PlusIcon({ size = 16 }: { size?: number }): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
    </svg>
  )
}

/** Upward triangle for day-cell quick-edit control. */
export function TriangleUpIcon({ size = 16 }: { size?: number }): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path fill="currentColor" d="M12 8.25 17.25 16.5H6.75L12 8.25z" />
    </svg>
  )
}

/** Right-pointing triangle for day-cell quick-edit control (inside circle chrome). */
export function TriangleRightIcon({ size = 16 }: { size?: number }): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path fill="currentColor" d="M8.25 6.75 16.5 12 8.25 17.25V6.75z" />
    </svg>
  )
}

export function PlusInSquareIcon({ size = 16 }: { size?: number }): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none">
      <rect
        x="4.25"
        y="4.25"
        width="15.5"
        height="15.5"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M12 8.25v7.5M8.25 12h7.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function WebBrowserIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"
      />
    </svg>
  )
}

/** Portrait day-list preview — tall page with 날짜/내용 rows. */
export function PortraitPreviewIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none">
      <rect x="5.25" y="2.75" width="13.5" height="18.5" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10.25 2.75v18.5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M12 7.25h5M12 11.5h5M12 15.75h5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Month density: smaller bars / more events before "더보기". */
export function DensityDownIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="currentColor" d="M19 13H5v-2h14z" />
    </svg>
  )
}

/** Month density: larger bars / fewer events before "더보기". */
export function DensityUpIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z" />
    </svg>
  )
}

export function HideEventsEyeIcon({ open }: { open: boolean }): ReactElement {
  if (open) {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5C21.27 7.61 17 4.5 12 4.5zm0 12.5c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"
        />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78 3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"
      />
    </svg>
  )
}

export function HideCompletedCheckIcon({ checked }: { checked: boolean }): ReactElement {
  if (checked) {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path
          fill="currentColor"
          d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
        />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"
      />
    </svg>
  )
}

export function SearchIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C8.01 14 6 11.99 6 9.5S8.01 5 10.5 5 15 7.01 15 9.5 12.99 14 10.5 14z"
      />
    </svg>
  )
}

export function SettingsIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"
      />
    </svg>
  )
}

export function DesktopModeIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M21 2H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h7l-2 3v1h8v-1l-2-3h7c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2m0 12H3V4h18v10z"
      />
    </svg>
  )
}

export function WindowModeIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2m0 16H5V8h14v11z"
      />
    </svg>
  )
}

function DocumentOutlineIcon({ children }: { children: ReactNode }): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"
      />
      {children}
    </svg>
  )
}

/** MDC Excel export icon (path-based X). */
export function ExcelIcon(): ReactElement {
  return (
    <DocumentOutlineIcon>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        d="M9.4 12.4 14.6 17.6M14.6 12.4 9.4 17.6"
      />
    </DocumentOutlineIcon>
  )
}

/** HTML export icon (document + markup chevrons). */
export function HtmlIcon(): ReactElement {
  return (
    <DocumentOutlineIcon>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.2 12.2 8.4 14.5 10.2 16.8M13.8 12.2 15.6 14.5 13.8 16.8"
      />
    </DocumentOutlineIcon>
  )
}

/** MDC PDF export icon. */
export function PdfIcon(): ReactElement {
  return (
    <DocumentOutlineIcon>
      <path
        fill="currentColor"
        d="M8.15 16.95V12.1h1.12v1.72h1.28V12.1h1.12v4.85h-1.12v-2.05H9.27v2.05H8.15zm5.02 0V12.1h1.95c.62 0 1.06.14 1.34.44.28.3.42.72.42 1.26 0 .52-.14.93-.42 1.22-.28.28-.7.43-1.26.43h-.88v1.5H13.17zm1.15-2.48h.72c.24 0 .42-.05.54-.16.12-.11.18-.28.18-.5s-.06-.4-.18-.5c-.12-.12-.3-.17-.54-.17h-.72v1.33zm3.2 2.48V12.1h1.12v3.78h1.58v1.07h-2.7z"
      />
    </DocumentOutlineIcon>
  )
}

/** Unified export (download) icon. */
export function ExportIcon(): ReactElement {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 3c.55 0 1 .45 1 1v8.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42L11 12.59V4c0-.55.45-1 1-1zm-7 14c0-.55.45-1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1z"
      />
    </svg>
  )
}

/** Header help (?) — opens the full footer-hints panel. */
export function HelpIcon(): ReactElement {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z"
      />
    </svg>
  )
}
