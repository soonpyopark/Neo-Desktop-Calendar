/** Continues the My Desktop Calendar line (dev 1.1.x) rather than restarting at 1.0. */
export const APP_VERSION = '1.2.1'
/**
 * Package build id (YYMMDD_HHMMSS) — matches MSI/portable filename suffix.
 * Refreshed by `build:release` / `build:msi` / `build:portable` for update checks
 * when the GitHub tag version is unchanged (same-version republish).
 */
export const APP_BUILD_STAMP = '260820_124301'
export const APP_NAME = 'Neo Desktop Calendar'
export const APP_TITLE = `${APP_NAME} v${APP_VERSION}`
export const SITE_URL = 'https://note4all.tistory.com'
/** SPDX identifier — matches package.json / LICENSE. */
export const APP_LICENSE = 'AGPL-3.0-only'
export const APP_SOURCE_URL = 'https://github.com/soonpyopark/Neo-Desktop-Calendar'

export const DEFAULT_ADMIN_ID = 'admin'
export const DEFAULT_ADMIN_PW = 'admin1234'

/** First-run / fallback footprint on the primary monitor (values snapped to tens). */
export const DEFAULT_WIDGET_BOUNDS = {
  x: 610,
  y: 20,
  width: 1300,
  height: 1000
} as const

/** Main calendar shell — cannot resize below the month period toolbar. */
export const MIN_WIDGET_WIDTH = 900
export const MIN_WIDGET_HEIGHT = 800
