import { describe, expect, it } from 'vitest'
import { DEFAULT_GRID_SETTINGS, PIXEL_GRID_MIN_ZOOM, gridLinePositions, normalizeGridSettings, shouldRenderPixelGrid } from './grid'

describe('configurable grid geometry', () => {
  it('normalizes invalid settings without changing the default object', () => {
    expect(DEFAULT_GRID_SETTINGS).toEqual({ x: 0, y: 0, width: 16, height: 16 })
    expect(normalizeGridSettings({ x: 3.8, y: -2.9, width: 0, height: 4.9 })).toEqual({ x: 3, y: -2, width: 1, height: 4 })
    expect(normalizeGridSettings(null)).toEqual(DEFAULT_GRID_SETTINGS)
  })

  it('only renders the pixel grid when individual pixels have enough screen space', () => {
    expect(shouldRenderPixelGrid(PIXEL_GRID_MIN_ZOOM - 0.01)).toBe(false)
    expect(shouldRenderPixelGrid(PIXEL_GRID_MIN_ZOOM)).toBe(true)
    expect(shouldRenderPixelGrid(Number.NaN)).toBe(false)
  })

  it('starts from the configured origin and skips dense lines at low zoom', () => {
    expect(gridLinePositions(2, 4, 0, 16, 2)).toEqual([2, 6, 10, 14])
    expect(gridLinePositions(0, 1, 0, 20, 0.5)).toEqual([0, 8, 16])
  })
})
