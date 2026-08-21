import type {
  ClientSurface,
  StoreSettings,
  SurfaceViewOptions,
  ViewOptions
} from './calendarTypes'
import { DEFAULT_ACCENT_COLOR } from './calendarColorPalette'
import { normalizeSkin } from './calendarSkin'
import { normalizeHeaderTitle } from './headerTitle'
import { normalizeEventDensity, normalizeEventLetterSpacing } from './eventLayoutMetrics'

export const SURFACE_SCOPED_VIEW_OPTION_KEYS = [
  'eventsHidden',
  'completedHidden',
  'showWeekNumbers',
  'weekStartsOnSunday',
  'roundedCorners',
  'headerTitle',
  'dayListSortDesc',
  'eventDensity',
  'eventLetterSpacing',
  'colorScheme',
  'accentColor',
  'skin',
  'headerCollapsed'
] as const satisfies ReadonlyArray<keyof SurfaceViewOptions>

export type SurfaceScopedViewOptionKey = (typeof SURFACE_SCOPED_VIEW_OPTION_KEYS)[number]

const SHELL_VIEW_OPTION_KEYS = ['runAtStartup'] as const satisfies ReadonlyArray<
  keyof ViewOptions
>

export function normalizeClientSurface(surface?: string | null): ClientSurface {
  return surface === 'browser' ? 'browser' : 'native'
}

function pickSurfaceOptions(source: Partial<ViewOptions> | null | undefined): SurfaceViewOptions {
  const s = source ?? {}
  return {
    showWeekNumbers: s.showWeekNumbers !== false,
    weekStartsOnSunday: s.weekStartsOnSunday !== false,
    roundedCorners: Boolean(s.roundedCorners),
    headerTitle: normalizeHeaderTitle(s.headerTitle),
    dayListSortDesc: s.dayListSortDesc !== false,
    eventDensity: normalizeEventDensity(s.eventDensity),
    eventLetterSpacing: normalizeEventLetterSpacing(s.eventLetterSpacing),
    colorScheme:
      s.colorScheme === 'dark' || s.colorScheme === 'system' ? s.colorScheme : 'light',
    accentColor: typeof s.accentColor === 'string' && s.accentColor.trim()
      ? s.accentColor
      : DEFAULT_ACCENT_COLOR,
    skin: normalizeSkin(s.skin),
    eventsHidden: Boolean(s.eventsHidden),
    completedHidden: Boolean(s.completedHidden),
    headerCollapsed: Boolean(s.headerCollapsed)
  }
}

function pickShellOptions(source: Partial<ViewOptions> | null | undefined): Pick<
  ViewOptions,
  'runAtStartup'
> {
  return {
    runAtStartup: source?.runAtStartup !== false
  }
}

/**
 * Ensure both surface buckets exist (seeded from legacy flat viewOptions),
 * then leave flat viewOptions as shell-only on the returned settings object.
 */
export function ensureViewOptionsBySurfaceMigrated(settings: StoreSettings): StoreSettings {
  const flat = settings.viewOptions ?? ({} as ViewOptions)
  const bySurface = { ...(settings.viewOptionsBySurface ?? {}) }
  const seed = pickSurfaceOptions(flat)
  let changed = false

  for (const surface of ['native', 'browser'] as const) {
    if (!bySurface[surface] || typeof bySurface[surface] !== 'object') {
      bySurface[surface] = { ...seed }
      changed = true
    } else {
      bySurface[surface] = { ...seed, ...bySurface[surface] }
    }
  }

  const shell = pickShellOptions(flat)
  const hadSurfaceKeys = SURFACE_SCOPED_VIEW_OPTION_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(flat, key)
  )

  if (!changed && !hadSurfaceKeys && settings.viewOptionsBySurface) {
    return settings
  }

  return {
    ...settings,
    viewOptions: shell as ViewOptions,
    viewOptionsBySurface: bySurface
  }
}

/** Split a client patch into shell vs surface keys. */
export function applyViewOptionsPatch(
  settings: StoreSettings,
  patch: Partial<ViewOptions> | null | undefined,
  surface: ClientSurface
): StoreSettings {
  if (!patch || typeof patch !== 'object') return settings

  let next = ensureViewOptionsBySurfaceMigrated(settings)
  const surf = normalizeClientSurface(surface)
  const bySurface = {
    ...(next.viewOptionsBySurface ?? {}),
    [surf]: { ...(next.viewOptionsBySurface?.[surf] ?? {}) }
  }
  const shell = { ...pickShellOptions(next.viewOptions) }
  let touched = false

  for (const key of SURFACE_SCOPED_VIEW_OPTION_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue
    if (key === 'headerTitle') {
      ;(bySurface[surf] as Record<string, unknown>)[key] = normalizeHeaderTitle(patch.headerTitle)
    } else if (key === 'eventDensity') {
      ;(bySurface[surf] as Record<string, unknown>)[key] = normalizeEventDensity(
        patch.eventDensity
      )
    } else if (key === 'eventLetterSpacing') {
      ;(bySurface[surf] as Record<string, unknown>)[key] = normalizeEventLetterSpacing(
        patch.eventLetterSpacing
      )
    } else if (key === 'skin') {
      ;(bySurface[surf] as Record<string, unknown>)[key] = normalizeSkin(patch.skin)
    } else {
      ;(bySurface[surf] as Record<string, unknown>)[key] = patch[key]
    }
    touched = true
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'runAtStartup')) {
    // Only the Electron shell may change Windows login-item registration.
    if (surf === 'native') {
      shell.runAtStartup = Boolean(patch.runAtStartup)
      touched = true
    }
  }

  if (!touched) return next

  next = {
    ...next,
    viewOptions: shell as ViewOptions,
    viewOptionsBySurface: bySurface
  }
  return next
}

/** Flatten shell ∪ surface for a client response; strip viewOptionsBySurface. */
export function projectViewOptionsForClient(
  settings: StoreSettings,
  surface: ClientSurface
): StoreSettings {
  const migrated = ensureViewOptionsBySurfaceMigrated(settings)
  const surf = normalizeClientSurface(surface)
  const surfaceOpts = pickSurfaceOptions({
    ...pickSurfaceOptions(migrated.viewOptions),
    ...(migrated.viewOptionsBySurface?.[surf] ?? {})
  })
  const shell = pickShellOptions(migrated.viewOptions)
  const projected: StoreSettings = {
    ...migrated,
    viewOptions: {
      ...surfaceOpts,
      ...shell
    }
  }
  delete projected.viewOptionsBySurface
  return projected
}

export function getShellRunAtStartup(settings: StoreSettings): boolean {
  const migrated = ensureViewOptionsBySurfaceMigrated(settings)
  return migrated.viewOptions.runAtStartup !== false
}

/** Keys that must never be accepted from browser PATCH bodies. */
export function stripBrowserShellSettingsPatch(
  patch: Partial<StoreSettings>
): Partial<StoreSettings> {
  const next: Partial<StoreSettings> = { ...patch }
  delete next.viewOptionsBySurface
  delete next.widget
  if (next.viewOptions) {
    const vo = { ...next.viewOptions }
    for (const key of SHELL_VIEW_OPTION_KEYS) {
      delete (vo as Record<string, unknown>)[key]
    }
    next.viewOptions = vo
  }
  return next
}
