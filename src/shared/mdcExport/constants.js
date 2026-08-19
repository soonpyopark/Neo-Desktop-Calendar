/** Shim for MDC export modules used by Neo Desktop Calendar. */
export const HOLIDAYS_KR_CALENDAR_ID = 'holidays-kr'

export const DEFAULT_VIEW_OPTIONS = {
  showWeekNumbers: true,
  weekStartsOnSunday: true,
  roundedCorners: false,
  headerTitle: {
    enabled: true,
    text: '😎 당신을 위한 데스크톱 캘린더 😍',
    color: '#795548',
    fontSizePx: 20
  },
  colorScheme: 'light',
  accentColor: '#795548',
  runAtStartup: true,
  eventsHidden: false,
  completedHidden: false,
  headerCollapsed: false
}
