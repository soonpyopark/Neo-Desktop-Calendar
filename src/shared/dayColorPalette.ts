/**
 * Day-cell frame colors — soft pastels (low saturation, high lightness).
 * Hues span the wheel evenly (plus one neutral) and every swatch is solved to the
 * same relative luminance (~0.70) so the grid reads as one family, whichever color
 * is picked. 19 presets + 색상 제거 + 사용자 정의 fill a 7 × 3 grid exactly.
 */
export const DAY_COLOR_PALETTE = [
  '#f3d2d1',
  '#f1d4c9',
  '#eed6be',
  '#ead9b0',
  '#e5db9d',
  '#d0e294',
  '#bce6a3',
  '#aae8b7',
  '#a6e7d3',
  '#a3e6e6',
  '#bce0ed',
  '#c6dcf0',
  '#d0daf3',
  '#d8d8f5',
  '#e0d5f4',
  '#ebd2f3',
  '#f2d0ec',
  '#f3d2de',
  '#dadada'
] as const
