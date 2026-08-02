import { describe, expect, it } from 'vitest'
import { loadFloatingPosition, parseColorPickerConfig, saveColorPickerConfig, saveFloatingPosition } from './panel-preferences'

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
  it('restores floating positions with viewport-aware scaling and clamps', () => {
    const storage = createStorage()
    saveFloatingPosition('panel', { x: 700, y: 500, width: 300, height: 200 }, { width: 1000, height: 800 }, storage)
    expect(loadFloatingPosition('panel', null, { width: 500, height: 400 }, true, false, storage)).toEqual({ x: 320, y: 250, width: 180, height: 120 })
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
})
