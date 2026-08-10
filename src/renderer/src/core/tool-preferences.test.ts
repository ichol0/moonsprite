import { describe, expect, it } from 'vitest'
import { TOOL_SETTINGS_KEY, defaultToolSettings, loadToolSettings, saveToolSettings } from './tool-preferences'

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

describe('tool preferences persistence boundary', () => {
  it('loads defaults when storage is empty or malformed', () => {
    const storage = createStorage()
    expect(loadToolSettings(storage).brushSize).toBe(1)
    storage.setItem(TOOL_SETTINGS_KEY, '{bad')
    expect(loadToolSettings(storage).brushPaintMode).toBe(defaultToolSettings.brushPaintMode)
  })

  it('normalizes old and out-of-range brush values', () => {
    const storage = createStorage()
    storage.setItem(TOOL_SETTINGS_KEY, JSON.stringify({
      brushSize: 999,
      brushTextureScale: 0,
      brushPaintMode: 'paint',
      brushPaintModePreferenceVersion: 0,
      proceduralAntialiasStrength: 999,
      selectionMode: 'invalid'
    }))
    const settings = loadToolSettings(storage)
    expect(settings.brushSize).toBe(128)
    expect(settings.brushTextureScale).toBe(1)
    expect(settings.brushPaintMode).toBe('pattern-source')
    expect(settings.proceduralAntialiasStrength).toBe(100)
    expect(settings.selectionMode).toBe('replace')
    expect(settings.fillTolerance).toBe(0)
    expect(settings.gradientTolerance).toBe(0)
    expect(settings.gradientContiguous).toBe(true)
  })

  it('writes a complete snapshot through the storage boundary', () => {
    const storage = createStorage()
    saveToolSettings(defaultToolSettings, storage)
    expect(storage.getItem(TOOL_SETTINGS_KEY)).toContain('moveAutoSelect')
    expect(loadToolSettings(storage)).toMatchObject({ brushSize: 1, moveAutoSelect: true, selectionMode: 'replace', fillKind: 'bucket', gradientTolerance: 0, gradientContiguous: true, gradientDither: 'none' })
  })

  it('persists independent paint-bucket and gradient range settings', () => {
    const storage = createStorage()
    saveToolSettings({ ...defaultToolSettings, fillKind: 'gradient', gradientDither: 'bayer-4', fillTolerance: 37, gradientTolerance: 82, gradientContiguous: false }, storage)
    expect(loadToolSettings(storage)).toMatchObject({ fillKind: 'gradient', gradientDither: 'bayer-4', fillTolerance: 37, gradientTolerance: 82, gradientContiguous: false })
  })

  it('persists independent symmetry axes and defaults legacy data to disabled', () => {
    const storage = createStorage()
    expect(loadToolSettings(storage).symmetryAxes).toEqual({ horizontal: false, vertical: false, diagonalUp: false, diagonalDown: false })
    saveToolSettings({ ...defaultToolSettings, symmetryAxes: { horizontal: true, vertical: false, diagonalUp: true, diagonalDown: false } }, storage)
    expect(loadToolSettings(storage).symmetryAxes).toEqual({ horizontal: true, vertical: false, diagonalUp: true, diagonalDown: false })
    storage.setItem(TOOL_SETTINGS_KEY, JSON.stringify({ symmetryAxes: { horizontal: false, vertical: false, diagonal: true } }))
    expect(loadToolSettings(storage).symmetryAxes).toEqual({ horizontal: false, vertical: false, diagonalUp: false, diagonalDown: true })
  })
})
