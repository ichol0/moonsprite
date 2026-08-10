import type { GradientDither, RasterLayer, RgbaColor, SelectionMask, SpriteDocument } from '@shared/types'
import { beginPixelEdit, recordPixel, type PixelEdit } from './history'
import { ensureLayerCoversCanvas, findOrAddPaletteColor, isLayerEffectivelyLocked, layerIndexAt, readLayerColor } from './document'
import { blendOver, packColor } from './raster'
import { magicWandSelection, selectionContains } from './selection'

export const GRADIENT_DITHER_PRESETS: readonly GradientDither[] = [
  'none', 'bayer-2', 'bayer-4', 'bayer-8', 'checker', 'diagonal', 'diagonal-reverse', 'horizontal', 'vertical'
]

/** Snaps a gradient endpoint to one of sixteen evenly spaced directions. */
export const constrainGradientEndpoint = (
  start: { x: number; y: number },
  end: { x: number; y: number }
): { x: number; y: number } => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const distance = Math.hypot(dx, dy)
  if (distance === 0) return { ...end }
  const step = Math.PI / 8
  const angle = Math.atan2(dy, dx)
  const snappedAngle = Math.round(angle / step) * step
  // Keep the snapped endpoint continuous. Rounding here would turn the
  // diagonal direction back into an arbitrary integer slope at short drags.
  const normalizeCoordinate = (value: number): number => Math.abs(value - Math.round(value)) < 1e-10 ? Math.round(value) : value
  return {
    x: normalizeCoordinate(start.x + Math.cos(snappedAngle) * distance),
    y: normalizeCoordinate(start.y + Math.sin(snappedAngle) * distance)
  }
}

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

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

const interpolate = (start: RgbaColor, end: RgbaColor, amount: number): RgbaColor => ({
  r: Math.round(start.r + (end.r - start.r) * amount),
  g: Math.round(start.g + (end.g - start.g) * amount),
  b: Math.round(start.b + (end.b - start.b) * amount),
  a: Math.round(start.a + (end.a - start.a) * amount)
})

const bayerThreshold = (matrix: number[][], x: number, y: number): number => {
  const size = matrix.length
  return (matrix[((y % size) + size) % size][((x % size) + size) % size] + 0.5) / (size * size)
}

const ditherThreshold = (mode: GradientDither, x: number, y: number): number => {
  if (mode === 'checker') return ((x + y) & 1) === 0 ? 0.25 : 0.75
  if (mode === 'diagonal') return ((((x + y) % 4) + 4) % 4 + 0.5) / 4
  if (mode === 'diagonal-reverse') return ((((x - y) % 4) + 4) % 4 + 0.5) / 4
  if (mode === 'horizontal') return ((((y % 4) + 4) % 4) + 0.5) / 4
  if (mode === 'vertical') return ((((x % 4) + 4) % 4) + 0.5) / 4
  if (mode === 'bayer-2') return bayerThreshold(BAYER_2, x, y)
  if (mode === 'bayer-4') return bayerThreshold(BAYER_4, x, y)
  return bayerThreshold(BAYER_8, x, y)
}

export const gradientAmountAt = (x: number, y: number, start: { x: number; y: number }, end: { x: number; y: number }): number => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return 0
  return clamp01(((x - start.x) * dx + (y - start.y) * dy) / lengthSquared)
}

export const gradientColorAt = (
  startColor: RgbaColor,
  endColor: RgbaColor,
  x: number,
  y: number,
  start: { x: number; y: number },
  end: { x: number; y: number },
  dither: GradientDither = 'none'
): RgbaColor => {
  const amount = gradientAmountAt(x, y, start, end)
  if (dither === 'none') return interpolate(startColor, endColor, amount)
  return amount >= ditherThreshold(dither, x, y) ? { ...endColor } : { ...startColor }
}

/** Resolves the color-matched area that a gradient is allowed to paint. */
export const gradientRegionSelection = (
  document: SpriteDocument,
  layer: RasterLayer,
  start: { x: number; y: number },
  tolerance = 0,
  contiguous = true
): SelectionMask | null => magicWandSelection(document, layer, start.x, start.y, tolerance, contiguous)

const gradientPaintValue = (document: SpriteDocument, layer: RasterLayer, index: number, color: RgbaColor): number => {
  if (color.a === 0) return layer.format === 'rgba' ? packColor(color) : 0
  if (color.a === 255) return layer.format === 'rgba' ? packColor(color) : findOrAddPaletteColor(document, color)
  return layer.format === 'rgba'
    ? packColor(blendOver(readLayerColor(document, layer, index), color))
    : findOrAddPaletteColor(document, blendOver(readLayerColor(document, layer, index), color))
}

/** Applies one linear gradient as a single undoable pixel edit. */
export const applyGradient = (
  document: SpriteDocument,
  layer: RasterLayer,
  start: { x: number; y: number },
  end: { x: number; y: number },
  startColor: RgbaColor,
  endColor: RgbaColor,
  selection?: SelectionMask | null,
  dither: GradientDither = 'none',
  paintRegion?: SelectionMask | null
): PixelEdit | null => {
  if (paintRegion === null || isLayerEffectivelyLocked(document, layer) || !ensureLayerCoversCanvas(document, layer)) return null
  const edit = beginPixelEdit(layer.id)
  for (let y = 0; y < document.height; y += 1) for (let x = 0; x < document.width; x += 1) {
    if (selection && !selectionContains(selection, x, y)) continue
    if (paintRegion && !selectionContains(paintRegion, x, y)) continue
    const index = layerIndexAt(layer, x, y)
    if (index === null) continue
    const color = gradientColorAt(startColor, endColor, x, y, start, end, dither)
    recordPixel(document, layer, edit, index, gradientPaintValue(document, layer, index, color))
  }
  return edit.before.size > 0 ? edit : null
}
