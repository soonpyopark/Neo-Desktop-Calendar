/**
 * Day-cell frame colors — theme-neutral mid tones.
 * Hues step evenly around the wheel (red → amber → green → teal → blue → purple →
 * rose, plus one cool gray) at moderate saturation, each solved to the same relative
 * luminance (~0.33). That keeps the 2px frame visible on light *and* dark paper
 * without clashing with any skin (warm, cool, or neutral).
 * 19 presets + 색상 제거 + 사용자 정의 fill a 7 × 3 grid exactly.
 */
export const DAY_COLOR_PALETTE = [
  '#d88585',
  '#d08b69',
  '#c1953d',
  '#a69f34',
  '#88a735',
  '#5fae37',
  '#38b248',
  '#37af77',
  '#37ad9d',
  '#3fa8c2',
  '#6aa1d0',
  '#819bd7',
  '#9395dd',
  '#a68fdc',
  '#bb87d9',
  '#d37cd6',
  '#d77fb9',
  '#d8829c',
  '#989ca3'
] as const
