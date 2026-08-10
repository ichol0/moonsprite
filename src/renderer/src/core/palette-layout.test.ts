import { describe, expect, it } from 'vitest'
import { fitPaletteSlotsToGrid, normalizePaletteSlots, PALETTE_GRID_COLUMNS, PALETTE_SWATCH_GAP, PALETTE_SWATCH_PIXELS, paletteGridCapacity, paletteOrderFromSlots, paletteRangeIds, paletteRangeIdsBySlots, paletteSlotRange, isPaletteDeleteKey, paletteColorRoles, paletteColorsEqual, paletteMarkerColor, repositionPaletteSlots } from './palette-layout'

describe('palette layout helpers', () => {
  it('recognizes both Windows palette deletion keys', () => {
    expect(isPaletteDeleteKey('Delete')).toBe(true)
    expect(isPaletteDeleteKey('Backspace')).toBe(true)
    expect(isPaletteDeleteKey('Enter')).toBe(false)
  })
  it('keeps swatch size presets stable', () => {
    expect(PALETTE_SWATCH_PIXELS).toEqual({ tiny: 22, small: 30, medium: 40, large: 52, huge: 64 })
    expect(PALETTE_SWATCH_GAP).toBe(0)
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

  it('normalizes legacy palette order into a complete default row', () => {
    const slots = normalizePaletteSlots([1, 2, 3], [1, 2, 3])
    expect(PALETTE_GRID_COLUMNS).toBe(8)
    expect(slots).toHaveLength(8)
    expect(slots.slice(0, 5)).toEqual([1, 2, 3, null, null])
  })

  it('preserves valid empty slots and repairs duplicate or missing entries', () => {
    const slots = normalizePaletteSlots([1, 2, 3], [1, 2, 3], [null, 2, 2, 99, null, 1])
    expect(slots.slice(0, 7)).toEqual([3, 2, null, null, null, 1, null])
    expect(paletteOrderFromSlots(slots)).toEqual([3, 2, 1])
  })

  it('moves colors into empty slots and swaps occupied destinations', () => {
    const emptyMove = repositionPaletteSlots([1, 2, null, 3, null, null, null, null], [2], 4, 2)
    expect(emptyMove.slice(0, 5)).toEqual([1, null, null, 3, 2])

    const swap = repositionPaletteSlots([1, 2, 3, 4, null, null, null, null], [2, 3], 3, 2)
    expect(swap.slice(0, 5)).toEqual([1, 4, null, 2, 3])
  })

  it('preserves two-dimensional color positions while fitting the panel viewport', () => {
    const expanded = fitPaletteSlotsToGrid([1, null, null, null, null, null, null, 2, 3], 8, 12, 3)
    expect(expanded.columns).toBe(12)
    expect(expanded.rows).toBe(3)
    expect(expanded.slots[0]).toBe(1)
    expect(expanded.slots[7]).toBe(2)
    expect(expanded.slots[12]).toBe(3)

    const protectedRightColumn = fitPaletteSlotsToGrid(expanded.slots, 12, 4, 1)
    expect(protectedRightColumn.columns).toBe(8)
    expect(protectedRightColumn.slots[7]).toBe(2)
  })

  it('calculates visible cells and selects rectangular ranges like animation cells', () => {
    expect(paletteGridCapacity(280, 148, 30)).toEqual({ columns: 8, rows: 4 })
    expect(paletteRangeIds([1, 2, 3, null, 4, 5, 6, null], 4, 2, 6)).toEqual([2, 3, 5, 6])
    expect(paletteSlotRange(4, 1, 6)).toEqual({ left: 1, top: 0, right: 2, bottom: 1 })
    expect(paletteRangeIdsBySlots([1, 2, 3, null, 4, 5, 6, null], 4, 1, 6)).toEqual([2, 3, 5, 6])
  })
})
