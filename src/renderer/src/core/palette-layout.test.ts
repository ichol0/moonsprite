import { describe, expect, it } from 'vitest'
import { PALETTE_SWATCH_PIXELS, isPaletteDeleteKey, paletteColorRoles, paletteColorsEqual, paletteMarkerColor, paletteReorderTarget, reorderPalettePreview } from './palette-layout'

describe('palette layout helpers', () => {
  it('recognizes both Windows palette deletion keys', () => {
    expect(isPaletteDeleteKey('Delete')).toBe(true)
    expect(isPaletteDeleteKey('Backspace')).toBe(true)
    expect(isPaletteDeleteKey('Enter')).toBe(false)
  })
  it('keeps swatch size presets stable', () => {
    expect(PALETTE_SWATCH_PIXELS).toEqual({ small: 22, medium: 30, large: 40 })
  })

  it('compares palette colors by RGBA values', () => {
    expect(paletteColorsEqual([{ r: 1, g: 2, b: 3, a: 255 }], [{ r: 1, g: 2, b: 3, a: 255 }])).toBe(true)
    expect(paletteColorsEqual([{ r: 1, g: 2, b: 3, a: 255 }], [{ r: 1, g: 2, b: 4, a: 255 }])).toBe(false)
  })

  it('chooses a readable marker color', () => {
    expect(paletteMarkerColor({ r: 255, g: 255, b: 255, a: 255 })).toBe('#090a0d')
    expect(paletteMarkerColor({ r: 0, g: 0, b: 0, a: 255 })).toBe('#fff')
    expect(paletteMarkerColor({ r: 255, g: 0, b: 0, a: 0 })).toBe('#090a0d')
  })

  it('tracks foreground and background roles independently, including the same swatch', () => {
    const color = { r: 41, g: 121, b: 255, a: 255 }
    expect(paletteColorRoles(color, color, { r: 255, g: 255, b: 255, a: 255 })).toEqual({ primary: true, secondary: false })
    expect(paletteColorRoles(color, color, color)).toEqual({ primary: true, secondary: true })
  })

  it('reorders selected swatches as one block and returns an insertion target', () => {
    const preview = reorderPalettePreview([1, 2, 3, 4], [2, 3], 2)
    expect(preview).toEqual([1, 4, 2, 3])
    expect(paletteReorderTarget([1, 2, 3, 4], [2, 3], preview)).toEqual({ id: 4, insertAfter: true })
  })
})
