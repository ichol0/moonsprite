import { describe, expect, it } from 'vitest'
import type { AnimationCelSurface } from '@shared/types'
import { BACKGROUND_PATTERN_IDS, backgroundPatternColorAt, backgroundPatternSize, normalizeBackgroundLayerSettings, renderBackgroundPatternIndexed, renderBackgroundTileIndexed, renderBackgroundTileRgba, tileBackgroundSurfaceToCanvas, type BackgroundPatternTile } from './background-patterns'

describe('background patterns', () => {
  it('keeps solid first and reproduces the six preset tiles at their native pixel sizes', () => {
    expect(BACKGROUND_PATTERN_IDS[0]).toBe('solid')
    expect(backgroundPatternSize('solid')).toEqual({ width: 1, height: 1 })
    expect(backgroundPatternColorAt('solid', 0, 0)).toEqual({ r: 228, g: 228, b: 228, a: 255 })
    expect(backgroundPatternSize('grid')).toEqual({ width: 32, height: 32 })
    expect(backgroundPatternColorAt('grid', 0, 0).r).toBe(180)
    expect(backgroundPatternColorAt('grid', 16, 0).r).toBe(191)
    expect(backgroundPatternColorAt('stripes', 31, 31).r).toBe(119)
    expect(backgroundPatternColorAt('diamond', 7, 0).r).toBe(143)
    expect(backgroundPatternColorAt('diamond', 0, 0).r).toBe(119)
    expect(backgroundPatternSize('diamond-nested')).toEqual({ width: 22, height: 22 })
    expect(backgroundPatternColorAt('diamond-nested', 0, 0).r).toBe(171)
    expect(backgroundPatternSize('circles')).toEqual({ width: 16, height: 16 })
    expect(backgroundPatternColorAt('circles', 0, 0).r).toBe(152)
    expect(backgroundPatternColorAt('circles', 16, 16)).toEqual(backgroundPatternColorAt('circles', 0, 0))
  })

  it('normalizes only supported persisted settings', () => {
    expect(normalizeBackgroundLayerSettings({ mode: 'canvas', pattern: 'grid' })).toEqual({ mode: 'canvas' })
    expect(normalizeBackgroundLayerSettings({ mode: 'preset', pattern: 'solid' })).toEqual({ mode: 'preset', pattern: 'solid' })
    expect(normalizeBackgroundLayerSettings({ mode: 'preset', pattern: 'circles' })).toEqual({ mode: 'preset', pattern: 'circles' })
    expect(normalizeBackgroundLayerSettings({ mode: 'preset', pattern: 'unknown' })).toBeUndefined()
    expect(normalizeBackgroundLayerSettings({ mode: 'unknown' })).toBeUndefined()
  })

  it('tiles RGBA canvas pixels with the resize anchor phase', () => {
    const surface: AnimationCelSurface = {
      format: 'rgba', width: 2, height: 1, offsetX: 0, offsetY: 0,
      pixels: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255])
    }
    tileBackgroundSurfaceToCanvas(surface, 2, 1, 5, 1, 1, 0)
    expect(surface).toMatchObject({ width: 5, height: 1, offsetX: 0, offsetY: 0, storageOriginX: 0, storageOriginY: 0 })
    expect(Array.from(surface.pixels)).toEqual([
      0, 0, 255, 255,
      255, 0, 0, 255,
      0, 0, 255, 255,
      255, 0, 0, 255,
      0, 0, 255, 255
    ])
  })

  it('uses the whole old canvas as the repeat unit for converted sparse content', () => {
    const surface: AnimationCelSurface = {
      format: 'rgba', width: 1, height: 1, offsetX: 1, offsetY: 0,
      pixels: new Uint8ClampedArray([80, 90, 100, 255])
    }
    tileBackgroundSurfaceToCanvas(surface, 3, 1, 6, 1, 0, 0)
    expect(Array.from(surface.pixels.filter((_, index) => index % 4 === 3))).toEqual([0, 255, 0, 0, 255, 0])
  })

  it('renders indexed presets through stable palette ids', () => {
    const ids = new Map<number, number>([[180, 7], [191, 9]])
    const pixels = renderBackgroundPatternIndexed(32, 1, 'grid', (color) => ids.get(color.r) ?? 0)
    expect(Array.from(pixels.slice(0, 18))).toEqual([...new Array(16).fill(7), 9, 9])
  })

  it('repeats custom RGBA tiles without dropping transparent pixels', () => {
    const tile: BackgroundPatternTile = {
      id: 'custom.png', name: 'custom', width: 2, height: 1,
      pixels: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 96])
    }
    expect(Array.from(renderBackgroundTileRgba(5, 1, tile))).toEqual([
      255, 0, 0, 255,
      0, 255, 0, 96,
      255, 0, 0, 255,
      0, 255, 0, 96,
      255, 0, 0, 255
    ])
  })

  it('reuses indexed palette ids for duplicate custom tile colors', () => {
    const tile: BackgroundPatternTile = {
      id: 'custom.png', name: 'custom', width: 2, height: 1,
      pixels: new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 128])
    }
    const resolved: number[] = []
    const pixels = renderBackgroundTileIndexed(4, 1, tile, (color) => {
      resolved.push(color.r)
      return resolved.length
    })
    expect(Array.from(pixels)).toEqual([1, 2, 1, 2])
    expect(resolved).toEqual([10, 40])
  })
})
