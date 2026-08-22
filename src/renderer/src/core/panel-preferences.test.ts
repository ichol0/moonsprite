import { describe, expect, it } from 'vitest'
import { loadFloatingPosition, parseColorPickerConfig, resizeFloatingPosition, saveColorPickerConfig, saveFloatingPosition } from './panel-preferences'

function createStorage(): Storage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: (key) => { values.delete(key) },
    clear: () => { values.clear() },
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size }
  }
}

describe('panel preference boundaries', () => {
  it('keeps floating panels proportionally placed while preserving fit-content height', () => {
    const resized = resizeFloatingPosition(
      { x: 350, y: 270, width: 300 },
      { width: 1000, height: 800 },
      { width: 500, height: 400 },
      { responsiveToViewport: true, followViewportRight: false, userPositioned: false, initialRightOffset: 300, minWidth: 180, minHeight: 120 },
      { width: 300, height: 260 }
    )
    expect(resized).toEqual({ x: 100, y: 70, width: 300 })
  })

  it('keeps floating panel edges at the same horizontal and vertical percentages', () => {
    const resized = resizeFloatingPosition(
      { x: 800, y: 640, width: 200, height: 160 },
      { width: 1000, height: 800 },
      { width: 1600, height: 1000 },
      { responsiveToViewport: true, followViewportRight: false, userPositioned: true, initialRightOffset: 0, minWidth: 180, minHeight: 120 },
      {}
    )
    expect(resized).toEqual({ x: 1400, y: 840, width: 200, height: 160 })
  })

  it('restores floating positions with viewport-aware scaling and clamps', () => {
    const storage = createStorage()
    saveFloatingPosition('panel', { x: 350, y: 300, width: 300, height: 200 }, { width: 1000, height: 800 }, storage)
    expect(loadFloatingPosition('panel', null, { width: 500, height: 400 }, true, false, storage)).toEqual({ x: 100, y: 100, width: 300, height: 200 })
  })

  it('falls back to the initial position for malformed floating data', () => {
    const storage = createStorage()
    storage.setItem('panel', '{bad')
    expect(loadFloatingPosition('panel', { x: 10, y: 20 }, { width: 500, height: 400 }, false, false, storage)).toEqual({ x: 10, y: 20 })
  })

  it('normalizes color picker presets and persists one complete config', () => {
    const storage = createStorage()
    const config = parseColorPickerConfig(JSON.stringify({ scheme: 'wheel', hueSteps: 20, colorSteps: 8, moonField: 'hsl-triangle' }), null, [0, 6, 12, 24, 36], [0, 5, 9, 15])
    expect(config).toEqual({ scheme: 'wheel', hueSteps: 24, colorSteps: 9, moonField: 'hsl-triangle' })
    saveColorPickerConfig(config, storage)
    expect(parseColorPickerConfig(storage.getItem('moonsprite.color-picker-config'), storage.getItem('moonsprite.color-picker-scheme'), [0, 6, 12, 24, 36], [0, 5, 9, 15])).toEqual(config)
  })

  it('uses saturation and value as the default color picker scheme', () => {
    expect(parseColorPickerConfig(null, null, [0, 6, 12], [0, 5, 9])).toMatchObject({ scheme: 'sv-square' })
  })
})
