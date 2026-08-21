import type { BrushDitherSettings, BrushDitherTemplate, GradientDither, RgbaColor } from '@shared/types'

export const GRADIENT_DITHER_PRESETS: readonly GradientDither[] = [
  'none', 'bayer-2', 'bayer-4', 'bayer-8', 'checker', 'diagonal', 'diagonal-reverse', 'horizontal', 'vertical'
]

export const BRUSH_DITHER_TEMPLATES: readonly BrushDitherTemplate[] = [
  'checker', 'diagonal', 'diagonal-reverse', 'horizontal', 'vertical', 'bayer-2', 'bayer-4', 'bayer-8'
]

const BAYER_2 = [
  [0, 2],
  [3, 1]
]

const expandBayer = (previous: number[][]): number[][] => {
  const size = previous.length
  const next = Array.from({ length: size * 2 }, () => Array<number>(size * 2).fill(0))
  const quadrants = [[0, 2], [3, 1]]
  for (let y = 0; y < size * 2; y += 1) for (let x = 0; x < size * 2; x += 1) {
    const quadrant = quadrants[Math.floor(y / size)][Math.floor(x / size)]
    next[y][x] = previous[y % size][x % size] * 4 + quadrant
  }
  return next
}

const BAYER_4 = expandBayer(BAYER_2)
const BAYER_8 = expandBayer(BAYER_4)

export const DEFAULT_BRUSH_DITHER_SETTINGS: BrushDitherSettings = {
  enabled: false,
  template: 'bayer-4',
  stage: 8
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

export const interpolateRgbaColor = (start: RgbaColor, end: RgbaColor, amount: number): RgbaColor => ({
  r: Math.round(start.r + (end.r - start.r) * clamp01(amount)),
  g: Math.round(start.g + (end.g - start.g) * clamp01(amount)),
  b: Math.round(start.b + (end.b - start.b) * clamp01(amount)),
  a: Math.round(start.a + (end.a - start.a) * clamp01(amount))
})

const bayerStage = (matrix: number[][], x: number, y: number): number => {
  const size = matrix.length
  return matrix[((y % size) + size) % size][((x % size) + size) % size]
}

export const ditherStageCount = (mode: GradientDither | BrushDitherTemplate): number => {
  if (mode === 'checker') return 2
  if (mode === 'diagonal' || mode === 'diagonal-reverse' || mode === 'horizontal' || mode === 'vertical') return 6
  if (mode === 'bayer-2') return 4
  if (mode === 'bayer-4') return 16
  if (mode === 'bayer-8') return 64
  return 1
}

export const ditherStageAt = (mode: BrushDitherTemplate, x: number, y: number): number => {
  if (mode === 'checker') return ((x + y) & 1) === 0 ? 0 : 1
  if (mode === 'diagonal') return ((x + y) % 6 + 6) % 6
  if (mode === 'diagonal-reverse') return ((x - y) % 6 + 6) % 6
  if (mode === 'horizontal') return (y % 6 + 6) % 6
  if (mode === 'vertical') return (x % 6 + 6) % 6
  if (mode === 'bayer-2') return bayerStage(BAYER_2, x, y)
  if (mode === 'bayer-4') return bayerStage(BAYER_4, x, y)
  return bayerStage(BAYER_8, x, y)
}

const ditherThreshold = (mode: Exclude<GradientDither, 'none'>, x: number, y: number): number => {
  const count = ditherStageCount(mode)
  return (ditherStageAt(mode, x, y) + 0.5) / count
}

export const normalizeBrushDitherSettings = (
  value: Partial<BrushDitherSettings> | null | undefined,
  fallback: BrushDitherSettings = DEFAULT_BRUSH_DITHER_SETTINGS
): BrushDitherSettings => {
  const template = BRUSH_DITHER_TEMPLATES.includes(value?.template as BrushDitherTemplate)
    ? value!.template as BrushDitherTemplate
    : fallback.template
  const maximumStage = ditherStageCount(template)
  const fallbackStage = Math.max(1, Math.min(maximumStage, Math.round(fallback.stage)))
  return {
    enabled: typeof value?.enabled === 'boolean' ? value.enabled : fallback.enabled,
    template,
    stage: Number.isFinite(value?.stage) ? Math.max(1, Math.min(maximumStage, Math.round(value!.stage!))) : fallbackStage
  }
}

export const brushDitherContains = (settings: BrushDitherSettings | null | undefined, x: number, y: number): boolean => {
  if (!settings?.enabled) return true
  return ditherStageAt(settings.template, x, y) < Math.max(1, Math.min(ditherStageCount(settings.template), Math.round(settings.stage)))
}

export const brushDitherSettingsForTemplate = (settings: BrushDitherSettings, template: BrushDitherTemplate): BrushDitherSettings => {
  const previousCount = ditherStageCount(settings.template)
  const nextCount = ditherStageCount(template)
  const nextStage = Math.max(1, Math.min(nextCount, Math.round((settings.stage / previousCount) * nextCount)))
  return { enabled: true, template, stage: nextStage }
}

export const gradientAmountAt = (x: number, y: number, start: { x: number; y: number }, end: { x: number; y: number }): number => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return 0
  return clamp01(((x - start.x) * dx + (y - start.y) * dy) / lengthSquared)
}

export const gradientColorForAmount = (
  startColor: RgbaColor,
  endColor: RgbaColor,
  amount: number,
  x: number,
  y: number,
  dither: GradientDither = 'none'
): RgbaColor => {
  const normalizedAmount = clamp01(amount)
  if (dither === 'none') return interpolateRgbaColor(startColor, endColor, normalizedAmount)
  return normalizedAmount >= ditherThreshold(dither, x, y) ? { ...endColor } : { ...startColor }
}

export const createGradientColorSampler = (
  startColor: RgbaColor,
  endColor: RgbaColor,
  start: { x: number; y: number },
  end: { x: number; y: number },
  dither: GradientDither = 'none'
): ((x: number, y: number) => RgbaColor) => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  const deltaR = endColor.r - startColor.r
  const deltaG = endColor.g - startColor.g
  const deltaB = endColor.b - startColor.b
  const deltaA = endColor.a - startColor.a
  const colorForAmount: (amount: number, x: number, y: number) => RgbaColor = dither === 'none'
    ? (amount: number): RgbaColor => ({
        r: Math.round(startColor.r + deltaR * amount),
        g: Math.round(startColor.g + deltaG * amount),
        b: Math.round(startColor.b + deltaB * amount),
        a: Math.round(startColor.a + deltaA * amount)
      })
    : (amount: number, x: number, y: number): RgbaColor => amount >= ditherThreshold(dither, x, y) ? { ...endColor } : { ...startColor }
  if (lengthSquared === 0) return (x, y) => colorForAmount(0, x, y)
  return (x, y) => {
    const numerator = (x - start.x) * dx + (y - start.y) * dy
    return colorForAmount(clamp01(numerator / lengthSquared), x, y)
  }
}

export const gradientColorAt = (
  startColor: RgbaColor,
  endColor: RgbaColor,
  x: number,
  y: number,
  start: { x: number; y: number },
  end: { x: number; y: number },
  dither: GradientDither = 'none'
): RgbaColor => gradientColorForAmount(startColor, endColor, gradientAmountAt(x, y, start, end), x, y, dither)
