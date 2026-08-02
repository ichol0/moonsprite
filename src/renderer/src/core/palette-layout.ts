import type { RgbaColor } from '@shared/types'
import { colorEquals } from './raster'

export type PaletteSwatchSize = 'small' | 'medium' | 'large'
export const PALETTE_SWATCH_PIXELS: Record<PaletteSwatchSize, number> = { small: 22, medium: 30, large: 40 }
export const isPaletteDeleteKey = (key: string): boolean => key === 'Delete' || key === 'Backspace'

export const paletteColorsEqual = (left: RgbaColor[], right: RgbaColor[]): boolean =>
  left.length === right.length && left.every((color, index) => colorEquals(color, right[index]))

export const paletteMarkerColor = (color: RgbaColor): string => {
  if (color.a < 128) return '#090a0d'
  const linear = (channel: number): number => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  const luminance = linear(color.r) * 0.2126 + linear(color.g) * 0.7152 + linear(color.b) * 0.0722
  return luminance > 0.179 ? '#090a0d' : '#fff'
}

export const paletteColorRoles = (color: RgbaColor, primary: RgbaColor, secondary: RgbaColor): { primary: boolean; secondary: boolean } => ({
  primary: colorEquals(color, primary),
  secondary: colorEquals(color, secondary)
})

export const reorderPalettePreview = (order: number[], ids: number[], targetSlot: number): number[] => {
  const selected = new Set(ids)
  const moving = order.filter((id) => selected.has(id))
  const remaining = order.filter((id) => !selected.has(id))
  if (moving.length === 0) return order
  remaining.splice(Math.max(0, Math.min(remaining.length, targetSlot)), 0, ...moving)
  return remaining
}

export const paletteReorderTarget = (order: number[], ids: number[], preview: number[]): { id: number; insertAfter: boolean } | null => {
  const selected = new Set(ids)
  const movingCount = order.filter((id) => selected.has(id)).length
  const firstMovingIndex = preview.findIndex((id) => selected.has(id))
  if (movingCount === 0 || firstMovingIndex < 0 || movingCount === preview.length) return null
  return firstMovingIndex === 0
    ? { id: preview[movingCount], insertAfter: false }
    : { id: preview[firstMovingIndex - 1], insertAfter: true }
}
