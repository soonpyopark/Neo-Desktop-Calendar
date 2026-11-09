import type { ReactElement } from 'react'
import { DAY_HIGHLIGHT_PALETTE } from '../../../shared/dayHighlightPalette'
import { CustomColorPicker } from './CustomColorPicker'

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

function ClearHighlightIcon({ className }: { className?: string }): ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" width="100%" height="100%" aria-hidden>
      <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.45" />
      <line x1="6.2" y1="17.8" x2="17.8" y2="6.2" stroke="#e53935" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export type DayHighlightPaletteProps = {
  value?: string | null
  onChange: (color: string | null) => void
  onRequestClose?: () => void
  compact?: boolean
  className?: string
}

/** 형광펜 palette for the date number — fixed highlighter colors, no custom picker. */
export function DayHighlightPalette({
  value,
  onChange,
  onRequestClose,
  compact = false,
  className
}: DayHighlightPaletteProps): ReactElement {
  const selected = (value ?? '').toLowerCase()
  const isCustomSelected = Boolean(
    value && !DAY_HIGHLIGHT_PALETTE.some((c) => c.toLowerCase() === selected)
  )

  const applyAndClose = (color: string | null): void => {
    onChange(color)
    onRequestClose?.()
  }

  return (
    <div
      className={cn(
        'day-color-palette day-highlight-palette',
        compact && 'day-color-palette--compact',
        className
      )}
      role="listbox"
      aria-label="날짜 강조 색상"
    >
      {DAY_HIGHLIGHT_PALETTE.map((color) => {
        const isActive = selected === color.toLowerCase()
        return (
          <button
            key={color}
            type="button"
            role="option"
            aria-selected={isActive}
            className={cn('day-color-swatch', isActive && 'active')}
            style={{ backgroundColor: color }}
            title={color}
            aria-label={`날짜 강조 ${color}`}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              applyAndClose(isActive ? null : color)
            }}
          />
        )
      })}
      <button
        type="button"
        role="option"
        aria-selected={!value}
        className={cn('day-color-swatch day-color-swatch--clear', !value && 'active')}
        title="날짜 강조 지우기"
        aria-label="날짜 강조 지우기"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          applyAndClose(null)
        }}
      >
        <ClearHighlightIcon className="day-color-clear-icon" />
      </button>
      <CustomColorPicker
        compact={compact}
        value={value}
        isActive={isCustomSelected}
        defaultDraft="#caa458"
        onApply={(color) => onChange(color)}
        onRequestClose={onRequestClose}
        swatchClassName="day-color-swatch day-color-swatch--picker"
      />
    </div>
  )
}

export default DayHighlightPalette
