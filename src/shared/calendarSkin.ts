/** User chrome skin — hex overrides for calendar surfaces (per light/dark). */

export const SKIN_TOKEN_KEYS = [
  'weekdayFill',
  'saturdayFill',
  'sundayFill',
  'headerFill',
  'footerFill',
  'gridLine'
] as const

export type SkinTokenKey = (typeof SKIN_TOKEN_KEYS)[number]

export type SkinTokens = Partial<Record<SkinTokenKey, string>>

export type CalendarSkin = {
  light: SkinTokens
  dark: SkinTokens
}

export const SKIN_CSS_VARS: Record<SkinTokenKey, string> = {
  weekdayFill: '--gcal-in-month-fill',
  saturdayFill: '--gcal-saturday-fill',
  sundayFill: '--gcal-sunday-fill',
  headerFill: '--neo-header-fill',
  footerFill: '--neo-footer-fill',
  gridLine: '--gcal-grid-line'
}

export const SKIN_TOKEN_LABELS: Record<SkinTokenKey, string> = {
  weekdayFill: '평일 날짜칸',
  saturdayFill: '토요일 칸',
  sundayFill: '일요일 칸',
  headerFill: '헤더',
  footerFill: '푸터',
  gridLine: '날짜칸 선'
}

const HEX6 = /^#[0-9a-fA-F]{6}$/
const HEX3 = /^#[0-9a-fA-F]{3}$/

const LIGHT_PAPER = '#fafbfc'
const DARK_PAPER = '#303134'
const SUNDAY_INK = '#d50000'
const SATURDAY_INK = '#039be5'

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

/** `weight` is the portion of `hex` kept; rest is `into`. */
function mixHex(hex: string, into: string, weight: number): string {
  const a = hexToRgb(hex)
  const b = hexToRgb(into)
  return `#${[
    toHexByte(a.r * weight + b.r * (1 - weight)),
    toHexByte(a.g * weight + b.g * (1 - weight)),
    toHexByte(a.b * weight + b.b * (1 - weight))
  ].join('')}`
}

function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const t = value.trim()
  if (HEX6.test(t)) return t.toLowerCase()
  if (HEX3.test(t)) {
    return `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`.toLowerCase()
  }
  return null
}

export const DEFAULT_SKIN_LIGHT: Record<SkinTokenKey, string> = {
  weekdayFill: LIGHT_PAPER,
  saturdayFill: mixHex(SATURDAY_INK, LIGHT_PAPER, 0.12),
  sundayFill: mixHex(SUNDAY_INK, LIGHT_PAPER, 0.12),
  headerFill: LIGHT_PAPER,
  footerFill: LIGHT_PAPER,
  gridLine: '#b6bbc0'
}

export const DEFAULT_SKIN_DARK: Record<SkinTokenKey, string> = {
  weekdayFill: DARK_PAPER,
  saturdayFill: mixHex(SATURDAY_INK, DARK_PAPER, 0.2),
  sundayFill: mixHex(SUNDAY_INK, DARK_PAPER, 0.2),
  headerFill: DARK_PAPER,
  footerFill: DARK_PAPER,
  gridLine: '#6b7075'
}

export const EMPTY_CALENDAR_SKIN: CalendarSkin = { light: {}, dark: {} }

export type SkinPreset = {
  id: string
  label: string
  tokens: Record<SkinTokenKey, string>
}

export const SKIN_PRESETS_LIGHT: SkinPreset[] = [
  { id: 'default', label: '기본', tokens: { ...DEFAULT_SKIN_LIGHT } },
  {
    id: 'warm',
    label: '따뜻한 종이',
    tokens: {
      weekdayFill: '#f7f1e8',
      saturdayFill: '#d7eaf4',
      sundayFill: '#f3ddd4',
      headerFill: '#f3eadc',
      footerFill: '#f3eadc',
      gridLine: '#c4b8a8'
    }
  },
  {
    id: 'sepia',
    label: '세피아',
    tokens: {
      weekdayFill: '#f3eee8',
      saturdayFill: '#d9e4ee',
      sundayFill: '#eddcd6',
      headerFill: '#ebe3da',
      footerFill: '#ebe3da',
      gridLine: '#b7aaa0'
    }
  },
  {
    id: 'sage',
    label: '세이지',
    tokens: {
      weekdayFill: '#eef3ee',
      saturdayFill: '#d5ebe8',
      sundayFill: '#ecdfe0',
      headerFill: '#e6eee8',
      footerFill: '#e6eee8',
      gridLine: '#a8b5aa'
    }
  },
  {
    id: 'lavender',
    label: '라벤더',
    tokens: {
      weekdayFill: '#f2eef6',
      saturdayFill: '#d8e4f4',
      sundayFill: '#f0dce6',
      headerFill: '#ebe6f2',
      footerFill: '#ebe6f2',
      gridLine: '#b4a8c0'
    }
  },
  {
    id: 'peach',
    label: '피치',
    tokens: {
      weekdayFill: '#f8efe8',
      saturdayFill: '#d6ebf2',
      sundayFill: '#f5d6d0',
      headerFill: '#f3e6dc',
      footerFill: '#f3e6dc',
      gridLine: '#c8b0a4'
    }
  },
  {
    id: 'ice',
    label: '아이스',
    tokens: {
      weekdayFill: '#eef4f7',
      saturdayFill: '#cfe4f2',
      sundayFill: '#ecdde2',
      headerFill: '#e4eef4',
      footerFill: '#e4eef4',
      gridLine: '#9aafbb'
    }
  },
  {
    id: 'olive',
    label: '올리브',
    tokens: {
      weekdayFill: '#f2f3e6',
      saturdayFill: '#d7ebe4',
      sundayFill: '#eedfd4',
      headerFill: '#e8ead8',
      footerFill: '#e8ead8',
      gridLine: '#b0b498'
    }
  },
  {
    id: 'stone',
    label: '스톤',
    tokens: {
      weekdayFill: '#f0f0ee',
      saturdayFill: '#d8e6ee',
      sundayFill: '#eadfde',
      headerFill: '#e6e6e3',
      footerFill: '#e6e6e3',
      gridLine: '#a8a8a2'
    }
  },
  {
    id: 'vivid',
    label: '선명',
    tokens: {
      weekdayFill: '#ffffff',
      saturdayFill: '#c9e6f7',
      sundayFill: '#f4c9c8',
      headerFill: '#f4f6f8',
      footerFill: '#f4f6f8',
      gridLine: '#8e959c'
    }
  }
]

export const SKIN_PRESETS_DARK: SkinPreset[] = [
  { id: 'default', label: '기본', tokens: { ...DEFAULT_SKIN_DARK } },
  {
    id: 'warm',
    label: '따뜻한 밤',
    tokens: {
      weekdayFill: '#3a342e',
      saturdayFill: '#2a4554',
      sundayFill: '#5a322c',
      headerFill: '#322c27',
      footerFill: '#322c27',
      gridLine: '#7a7066'
    }
  },
  {
    id: 'brown',
    label: '브라운',
    tokens: {
      weekdayFill: '#3b332f',
      saturdayFill: '#2c414e',
      sundayFill: '#553029',
      headerFill: '#322b28',
      footerFill: '#322b28',
      gridLine: '#7a6e67'
    }
  },
  {
    id: 'slate',
    label: '슬레이트',
    tokens: {
      weekdayFill: '#2c333c',
      saturdayFill: '#1f4454',
      sundayFill: '#4e2c32',
      headerFill: '#252b33',
      footerFill: '#252b33',
      gridLine: '#6e7a86'
    }
  },
  {
    id: 'violet',
    label: '바이올렛',
    tokens: {
      weekdayFill: '#332e3a',
      saturdayFill: '#2a4054',
      sundayFill: '#553044',
      headerFill: '#2b2632',
      footerFill: '#2b2632',
      gridLine: '#7a6e86'
    }
  },
  {
    id: 'forest',
    label: '포레스트',
    tokens: {
      weekdayFill: '#2c342e',
      saturdayFill: '#1f4a48',
      sundayFill: '#4e322c',
      headerFill: '#242c26',
      footerFill: '#242c26',
      gridLine: '#6e7a6e'
    }
  },
  {
    id: 'wine',
    label: '와인',
    tokens: {
      weekdayFill: '#3a2e30',
      saturdayFill: '#2a414e',
      sundayFill: '#5c2830',
      headerFill: '#322628',
      footerFill: '#322628',
      gridLine: '#7a666a'
    }
  },
  {
    id: 'midnight',
    label: '미드나잇',
    tokens: {
      weekdayFill: '#243044',
      saturdayFill: '#1a4860',
      sundayFill: '#4a3040',
      headerFill: '#1c2638',
      footerFill: '#1c2638',
      gridLine: '#6a7a92'
    }
  },
  {
    id: 'graphite',
    label: '그래파이트',
    tokens: {
      weekdayFill: '#2a2c2e',
      saturdayFill: '#1e404c',
      sundayFill: '#4a2c30',
      headerFill: '#222426',
      footerFill: '#222426',
      gridLine: '#7a7e82'
    }
  },
  {
    id: 'contrast',
    label: '고대비',
    tokens: {
      weekdayFill: '#1e1f22',
      saturdayFill: '#163948',
      sundayFill: '#4a1c20',
      headerFill: '#141516',
      footerFill: '#141516',
      gridLine: '#8a9096'
    }
  }
]

function tokensEqual(
  a: Record<SkinTokenKey, string>,
  b: Record<SkinTokenKey, string>
): boolean {
  return SKIN_TOKEN_KEYS.every((key) => a[key].toLowerCase() === b[key].toLowerCase())
}

export function skinPresetsFor(scheme: 'light' | 'dark'): SkinPreset[] {
  return scheme === 'dark' ? SKIN_PRESETS_DARK : SKIN_PRESETS_LIGHT
}

export function resolvedSkinTokens(
  skin: CalendarSkin,
  scheme: 'light' | 'dark'
): Record<SkinTokenKey, string> {
  return Object.fromEntries(
    SKIN_TOKEN_KEYS.map((key) => [key, resolveSkinToken(skin, scheme, key)])
  ) as Record<SkinTokenKey, string>
}

/** Matching preset id, or null when the current scheme is custom. */
export function matchSkinPreset(
  skin: CalendarSkin,
  scheme: 'light' | 'dark'
): string | null {
  const resolved = resolvedSkinTokens(skin, scheme)
  const found = skinPresetsFor(scheme).find((preset) => tokensEqual(resolved, preset.tokens))
  return found?.id ?? null
}

export function applySkinPreset(
  skin: CalendarSkin,
  scheme: 'light' | 'dark',
  presetId: string
): CalendarSkin {
  const preset = skinPresetsFor(scheme).find((item) => item.id === presetId)
  if (!preset) return normalizeSkin(skin)
  // Default = drop overrides so theme CSS tokens stay in charge.
  if (preset.id === 'default') {
    return normalizeSkin({ ...skin, [scheme]: {} })
  }
  return normalizeSkin({ ...skin, [scheme]: { ...preset.tokens } })
}

function normalizeTokens(input: unknown): SkinTokens {
  if (!input || typeof input !== 'object') return {}
  const raw = input as Record<string, unknown>
  const next: SkinTokens = {}
  for (const key of SKIN_TOKEN_KEYS) {
    const hex = normalizeHex(raw[key])
    if (hex) next[key] = hex
  }
  return next
}

export function normalizeSkin(input: unknown): CalendarSkin {
  if (!input || typeof input !== 'object') return { light: {}, dark: {} }
  const raw = input as Partial<CalendarSkin>
  return {
    light: normalizeTokens(raw.light),
    dark: normalizeTokens(raw.dark)
  }
}

export function isSkinCustomized(skin: CalendarSkin): boolean {
  return SKIN_TOKEN_KEYS.some((key) => Boolean(skin.light[key] || skin.dark[key]))
}

export function resolveSkinToken(
  skin: CalendarSkin,
  scheme: 'light' | 'dark',
  key: SkinTokenKey
): string {
  const override = skin[scheme][key]
  if (override) return override
  return scheme === 'dark' ? DEFAULT_SKIN_DARK[key] : DEFAULT_SKIN_LIGHT[key]
}

export function setSkinToken(
  skin: CalendarSkin,
  scheme: 'light' | 'dark',
  key: SkinTokenKey,
  hex: string | null
): CalendarSkin {
  const nextTokens = { ...skin[scheme] }
  const normalized = hex ? normalizeHex(hex) : null
  if (normalized) nextTokens[key] = normalized
  else delete nextTokens[key]
  return normalizeSkin({ ...skin, [scheme]: nextTokens })
}

export function skinDecls(tokens: SkinTokens): string {
  return SKIN_TOKEN_KEYS.filter((key) => tokens[key])
    .map((key) => `${SKIN_CSS_VARS[key]}:${tokens[key]}`)
    .join(';')
}
