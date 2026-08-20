import { DEFAULT_ACCENT_COLOR } from '../../../shared/calendarColorPalette'
import { normalizeSkin, skinDecls, type CalendarSkin } from '../../../shared/calendarSkin'

export type ColorScheme = 'light' | 'dark' | 'system'

const ACCENT_STYLE_ELEMENT_ID = 'neo-calendar-accent-color-style'
const SKIN_STYLE_ELEMENT_ID = 'neo-calendar-skin-style'
const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/

export function normalizeColorScheme(value: unknown): ColorScheme {
  if (value === 'dark' || value === 'system' || value === 'light') return value
  return 'light'
}

export function getColorScheme(viewOptions?: { colorScheme?: string } | null): ColorScheme {
  return normalizeColorScheme(viewOptions?.colorScheme)
}

export function applyColorScheme(scheme: ColorScheme): void {
  const root = document.documentElement
  const prefersDark =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
  const dark = scheme === 'dark' || (scheme === 'system' && prefersDark)
  root.classList.toggle('dark', dark)
  root.style.colorScheme = dark ? 'dark' : 'light'
  // Let calendar chips recompute MDC getCalendarTheme (reads `.dark` on documentElement).
  window.dispatchEvent(
    new CustomEvent('neocalendar:colorSchemeEffective', { detail: { dark } })
  )
}

/** Apply light/dark + accent + skin from calendar store settings (panel / quick-edit windows). */
export function applyThemeFromStoreSettings(settings: {
  accentColor?: string
  viewOptions?: { colorScheme?: string; accentColor?: string; skin?: CalendarSkin } | null
}): void {
  const viewOptions = settings.viewOptions
  applyColorScheme(getColorScheme(viewOptions))
  applyAccentColor(normalizeAccentColor(viewOptions?.accentColor ?? settings.accentColor))
  applySkin(viewOptions?.skin)
}

/** Apply theme as early as possible in panel / quick-edit HTML entries (before React mount). */
export function bootstrapPanelWindowTheme(): void {
  const api = window.neoCalendar
  if (!api?.getCalendarStore) return
  void api
    .getCalendarStore()
    .then((snap) => {
      applyThemeFromStoreSettings(snap.settings)
    })
    .catch(() => {
      /* ignore */
    })
}

export function normalizeAccentColor(
  value: unknown,
  fallback: string = DEFAULT_ACCENT_COLOR
): string {
  const s = String(value ?? '').trim()
  return HEX_PATTERN.test(s) ? s.toLowerCase() : fallback
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = hex.replace('#', '')
  return {
    r: parseInt(n.slice(0, 2), 16),
    g: parseInt(n.slice(2, 4), 16),
    b: parseInt(n.slice(4, 6), 16)
  }
}

function toHexByte(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
}

/** Mix `hex` toward `mixColor`; `weight` is the portion of `hex` kept. */
function mix(hex: string, mixColor: string, weight: number): string {
  const a = hexToRgb(hex)
  const b = hexToRgb(mixColor)
  return `#${[
    toHexByte(a.r * weight + b.r * (1 - weight)),
    toHexByte(a.g * weight + b.g * (1 - weight)),
    toHexByte(a.b * weight + b.b * (1 - weight))
  ].join('')}`
}

/**
 * MDC accentColor.js — derive light/dark --gcal-blue/-soft/-dark from one accent hex
 * so `.dark` keeps readable soft + text-on-soft shades.
 */
function deriveAccentVars(hex: string): {
  light: { base: string; soft: string; dark: string }
  dark: { base: string; soft: string; dark: string }
} {
  return {
    light: {
      base: hex,
      soft: mix(hex, '#ffffff', 0.12),
      dark: mix(hex, '#000000', 0.72)
    },
    dark: {
      base: mix(hex, '#ffffff', 0.65),
      soft: mix(hex, '#202124', 0.3),
      dark: mix(hex, '#ffffff', 0.55)
    }
  }
}

function ensureAccentStyleElement(): HTMLStyleElement | null {
  if (typeof document === 'undefined') return null
  let el = document.getElementById(ACCENT_STYLE_ELEMENT_ID) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = ACCENT_STYLE_ELEMENT_ID
    document.head.appendChild(el)
  }
  return el
}

/**
 * Inject :root + .dark accent vars (MDC style) so toggling dark mode does not
 * need to re-run this — `.dark` selector picks the right trio.
 */
export function applyAccentColor(color: string): void {
  if (typeof document === 'undefined') return

  const accent = normalizeAccentColor(color)
  const root = document.documentElement
  if (root.dataset.accentColor === accent) return

  // Drop legacy inline overrides so :root / .dark stylesheet rules win.
  root.style.removeProperty('--gcal-blue')
  root.style.removeProperty('--gcal-blue-soft')
  root.style.removeProperty('--gcal-blue-dark')

  const { light, dark } = deriveAccentVars(accent)
  const style = ensureAccentStyleElement()
  if (style) {
    style.textContent =
      `:root{--gcal-blue:${light.base};--gcal-blue-soft:${light.soft};--gcal-blue-dark:${light.dark};}` +
      `.dark{--gcal-blue:${dark.base};--gcal-blue-soft:${dark.soft};--gcal-blue-dark:${dark.dark};}`
  }

  root.dataset.accentColor = accent
}

export function effectiveColorScheme(scheme: ColorScheme): 'light' | 'dark' {
  if (scheme === 'dark') return 'dark'
  if (scheme === 'system') {
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  }
  return 'light'
}

function ensureSkinStyleElement(): HTMLStyleElement | null {
  if (typeof document === 'undefined') return null
  let el = document.getElementById(SKIN_STYLE_ELEMENT_ID) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = SKIN_STYLE_ELEMENT_ID
    document.head.appendChild(el)
  }
  return el
}

/** Inject :root / .dark chrome fills. Missing tokens keep the theme default. */
export function applySkin(skin: unknown): void {
  if (typeof document === 'undefined') return
  const normalized = normalizeSkin(skin)
  const signature = JSON.stringify(normalized)
  const root = document.documentElement
  if (root.dataset.calendarSkin === signature) return

  const lightDecls = skinDecls(normalized.light)
  const darkDecls = skinDecls(normalized.dark)
  const style = ensureSkinStyleElement()
  if (style) {
    style.textContent =
      (lightDecls ? `:root{${lightDecls}}` : '') + (darkDecls ? `.dark{${darkDecls}}` : '')
  }
  root.dataset.calendarSkin = signature
}
