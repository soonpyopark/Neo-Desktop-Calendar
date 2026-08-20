import { useEffect, useState, type ReactElement } from 'react'
import {
  applySkinPreset,
  isSkinCustomized,
  matchSkinPreset,
  normalizeSkin,
  resolveSkinToken,
  setSkinToken,
  skinPresetsFor,
  SKIN_TOKEN_KEYS,
  SKIN_TOKEN_LABELS,
  type CalendarSkin,
  type SkinTokenKey
} from '../../../shared/calendarSkin'
import {
  applySkin,
  effectiveColorScheme,
  getColorScheme,
  type ColorScheme
} from '../lib/colorScheme'

export type SkinSettingsFieldsProps = {
  skin: CalendarSkin | null | undefined
  colorScheme: ColorScheme
  onChange: (next: CalendarSkin) => void
}

function schemeLabel(scheme: 'light' | 'dark'): string {
  return scheme === 'dark' ? '다크' : '라이트'
}

export function SkinSettingsFields({
  skin,
  colorScheme,
  onChange
}: SkinSettingsFieldsProps): ReactElement {
  const normalized = normalizeSkin(skin)
  const [effective, setEffective] = useState<'light' | 'dark'>(() =>
    effectiveColorScheme(getColorScheme({ colorScheme }))
  )

  useEffect(() => {
    const update = (): void => {
      setEffective(effectiveColorScheme(getColorScheme({ colorScheme })))
    }
    update()
    if (colorScheme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [colorScheme])

  const persist = (next: CalendarSkin): void => {
    const normalizedNext = normalizeSkin(next)
    applySkin(normalizedNext)
    onChange(normalizedNext)
  }

  const handleToken = (key: SkinTokenKey, hex: string): void => {
    persist(setSkinToken(normalized, effective, key, hex))
  }

  const clearToken = (key: SkinTokenKey): void => {
    persist(setSkinToken(normalized, effective, key, null))
  }

  const resetAll = (): void => {
    persist({ light: {}, dark: {} })
  }

  const customized = isSkinCustomized(normalized)
  const presets = skinPresetsFor(effective)
  const activePresetId = matchSkinPreset(normalized, effective)

  const handlePreset = (presetId: string): void => {
    persist(applySkinPreset(normalized, effective, presetId))
  }

  return (
    <fieldset className="mt-8 border-0 p-0">
      <legend className="mb-3 text-[22px] font-normal text-gcal-heading">사용자 스킨</legend>
      <p className="mb-4 text-sm text-gcal-muted">
        지금 화면의 {schemeLabel(effective)} 테마용 프리셋을 고르거나, 아래에서 색을 직접 바꿀 수
        있어요. 라이트와 다크는 따로 저장됩니다.
      </p>
      <div className="skin-preset-grid" role="listbox" aria-label={`${schemeLabel(effective)} 스킨 프리셋`}>
        {presets.map((preset) => {
          const active = activePresetId === preset.id
          return (
            <button
              key={preset.id}
              type="button"
              role="option"
              aria-selected={active}
              className={active ? 'skin-preset-card is-active' : 'skin-preset-card'}
              title={preset.label}
              onClick={() => handlePreset(preset.id)}
            >
              <span className="skin-preset-preview" aria-hidden>
                <span
                  className="skin-preset-preview-header"
                  style={{ backgroundColor: preset.tokens.headerFill }}
                />
                <span className="skin-preset-preview-days">
                  <span style={{ backgroundColor: preset.tokens.sundayFill }} />
                  <span style={{ backgroundColor: preset.tokens.weekdayFill }} />
                  <span style={{ backgroundColor: preset.tokens.saturdayFill }} />
                </span>
              </span>
              <span className="skin-preset-name">{preset.label}</span>
            </button>
          )
        })}
      </div>
      <ul className="skin-token-list">
        {SKIN_TOKEN_KEYS.map((key) => {
          const value = resolveSkinToken(normalized, effective, key)
          const overridden = Boolean(normalized[effective][key])
          return (
            <li key={key} className="skin-token-row">
              <label className="skin-token-label" htmlFor={`skin-token-${key}`}>
                {SKIN_TOKEN_LABELS[key]}
              </label>
              <input
                id={`skin-token-${key}`}
                className="skin-token-swatch"
                type="color"
                value={value}
                title={SKIN_TOKEN_LABELS[key]}
                aria-label={SKIN_TOKEN_LABELS[key]}
                onChange={(event) => handleToken(key, event.target.value)}
              />
              <span className="skin-token-hex">{value}</span>
              <button
                type="button"
                className="skin-token-clear"
                disabled={!overridden}
                onClick={() => clearToken(key)}
              >
                기본
              </button>
            </li>
          )
        })}
      </ul>
      <div className="mt-4">
        <button
          type="button"
          className="skin-token-reset"
          disabled={!customized}
          onClick={resetAll}
        >
          스킨 초기화
        </button>
      </div>
    </fieldset>
  )
}
