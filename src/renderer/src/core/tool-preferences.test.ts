import { describe, expect, it } from 'vitest'
import { DEFAULT_BRUSH_DYNAMICS_SETTINGS, DEFAULT_BRUSH_PRESSURE_SETTINGS, brushPressureFromDynamics, patchBrushDynamicsGradientDither, patchBrushDynamicsMapping } from './pressure'
import { TOOL_SETTINGS_KEY, defaultToolSettings, loadToolSettings, normalizePersistedBrushProfile, saveToolSettings } from './tool-preferences'

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

  it('persists every shape child tool and rejects unknown shape kinds', () => {
    for (const shapeKind of ['freeform', 'polygon'] as const) {
      const storage = createStorage()
      saveToolSettings({ ...defaultToolSettings, shapeKind }, storage)
      expect(loadToolSettings(storage).shapeKind).toBe(shapeKind)
    }
    const storage = createStorage()
    storage.setItem(TOOL_SETTINGS_KEY, JSON.stringify({ shapeKind: 'unknown-shape' }))
    expect(loadToolSettings(storage).shapeKind).toBe(defaultToolSettings.shapeKind)
  })

  it('normalizes and persists the curve anchor count', () => {
    const storage = createStorage()
    saveToolSettings({ ...defaultToolSettings, lineKind: 'curve', curveAnchorCount: 6 }, storage)
    expect(loadToolSettings(storage)).toMatchObject({ lineKind: 'curve', curveAnchorCount: 6 })
    storage.setItem(TOOL_SETTINGS_KEY, JSON.stringify({ curveAnchorCount: 99 }))
    expect(loadToolSettings(storage).curveAnchorCount).toBe(8)
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
    expect(settings.brushPressure).toEqual(DEFAULT_BRUSH_PRESSURE_SETTINGS)
    expect(settings.brushDynamics).toEqual(DEFAULT_BRUSH_DYNAMICS_SETTINGS)
    expect(settings.brushDynamics.effects.gradient).toMatchObject({ sensor: null, outputMin: 0, outputMax: 100 })
    expect(settings.brushProfiles?.pencil?.brushPressure).toEqual(DEFAULT_BRUSH_PRESSURE_SETTINGS)
    expect(settings).toMatchObject({ airbrushParticleRadius: 1, airbrushParticleShape: 'round', airbrushScatterRadius: 12, airbrushDensity: 8, airbrushIntervalMs: 50 })
  })

  it('migrates legacy pressure settings when no version 2 dynamics exist', () => {
    const storage = createStorage()
    storage.setItem(TOOL_SETTINGS_KEY, JSON.stringify({
      brushPressure: { enabled: true, affectsSize: true, affectsOpacity: true, minSizePercent: 35, minOpacityPercent: 8, curve: 'hard' }
    }))

    const restored = loadToolSettings(storage)
    expect(restored.brushDynamics.effects.size).toMatchObject({ sensor: 'pressure', outputMin: 35, outputMax: 100, curve: 'hard' })
    expect(restored.brushDynamics.effects.strength).toMatchObject({ sensor: 'pressure', outputMin: 8, outputMax: 100, curve: 'hard' })
    expect(restored.brushDynamics.effects.gradient).toMatchObject({ sensor: null, outputMin: 0, outputMax: 100 })
  })

  it('migrates v2 factory sensor ranges without rewriting custom mappings', () => {
    const storage = createStorage()
    storage.setItem(TOOL_SETTINGS_KEY, JSON.stringify({
      brushDynamics: {
        version: 2,
        effects: {
          size: { sensor: 'pressure', outputMin: 20, outputMax: 100, inputMin: 0, inputMax: 100, curve: 'linear', direction: 'direct' },
          strength: { sensor: 'speed', outputMin: 12, outputMax: 100, inputMin: 0, inputMax: 1200, curve: 'linear', direction: 'direct' }
        }
      }
    }))

    const restored = loadToolSettings(storage)
    expect(restored.brushDynamics.effects.size).toMatchObject({ inputMin: 0, inputMax: 70, curve: 'hard' })
    expect(restored.brushDynamics.effects.strength).toMatchObject({ outputMin: 12, inputMin: 0, inputMax: 1200, curve: 'linear' })
    expect(restored.brushDynamics.effects.gradient).toMatchObject({ sensor: null, outputMin: 0, outputMax: 100 })
    expect(restored.brushDynamics.gradientDither).toBe('none')
  })

  it('migrates v3 profiles to v4 with dithering disabled', () => {
    const storage = createStorage()
    storage.setItem(TOOL_SETTINGS_KEY, JSON.stringify({
      brushDynamics: {
        version: 3,
        effects: DEFAULT_BRUSH_DYNAMICS_SETTINGS.effects,
        gradientDither: 'bayer-8'
      }
    }))

    expect(loadToolSettings(storage).brushDynamics).toMatchObject({ version: 4, gradientDither: 'none' })
  })

  it('falls back invalid v4 dithering to the profile fallback', () => {
    const fallback = {
      ...defaultToolSettings,
      brushDynamics: patchBrushDynamicsGradientDither(defaultToolSettings.brushDynamics, 'diagonal')
    }
    const restored = normalizePersistedBrushProfile({
      brushDynamics: { ...fallback.brushDynamics, gradientDither: 'invalid' as 'none' }
    }, fallback)
    expect(restored.brushDynamics.gradientDither).toBe('diagonal')
  })

  it('persists dynamics independently for each brush profile', () => {
    const storage = createStorage()
    const profile = normalizePersistedBrushProfile(defaultToolSettings, defaultToolSettings)
    const pencilDynamics = patchBrushDynamicsMapping(profile.brushDynamics, 'size', { sensor: 'pressure', outputMin: 35, curve: 'soft' })
    const eraserDynamics = patchBrushDynamicsMapping(profile.brushDynamics, 'strength', { sensor: 'speed', outputMin: 8, inputMax: 900, curve: 'hard' })
    const pencilGradientDynamics = patchBrushDynamicsGradientDither(
      patchBrushDynamicsMapping(pencilDynamics, 'gradient', { sensor: 'pressure', outputMin: 0, inputMax: 70, curve: 'hard' }),
      'bayer-4'
    )
    const eraserDitherDynamics = patchBrushDynamicsGradientDither(eraserDynamics, 'vertical')
    saveToolSettings({
      ...defaultToolSettings,
      brushProfiles: {
        pencil: { ...profile, brushDynamics: pencilGradientDynamics, brushPressure: brushPressureFromDynamics(pencilGradientDynamics) },
        eraser: { ...profile, brushDynamics: eraserDitherDynamics, brushPressure: brushPressureFromDynamics(eraserDitherDynamics) },
        fill: profile,
        line: { ...profile, brushSize: 7, brushShape: 'square' }
      }
    }, storage)

    const restored = loadToolSettings(storage)
    expect(restored.brushProfiles?.pencil?.brushDynamics.effects.size).toMatchObject({ sensor: 'pressure', outputMin: 35, curve: 'soft' })
    expect(restored.brushProfiles?.pencil?.brushDynamics.effects.gradient).toMatchObject({ sensor: 'pressure', outputMin: 0, inputMax: 70, curve: 'hard' })
    expect(restored.brushProfiles?.pencil?.brushDynamics.gradientDither).toBe('bayer-4')
    expect(restored.brushProfiles?.eraser?.brushDynamics.effects.strength).toMatchObject({ sensor: 'speed', outputMin: 8, inputMax: 900, curve: 'hard' })
    expect(restored.brushProfiles?.eraser?.brushDynamics.gradientDither).toBe('vertical')
    expect(restored.brushProfiles?.line).toMatchObject({ brushSize: 7, brushShape: 'square' })
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

  it('normalizes and persists airbrush settings', () => {
    const storage = createStorage()
    saveToolSettings({ ...defaultToolSettings, airbrushParticleRadius: 9, airbrushParticleShape: 'square', airbrushScatterRadius: 48, airbrushDensity: 36, airbrushIntervalMs: 24 }, storage)
    expect(loadToolSettings(storage)).toMatchObject({ airbrushParticleRadius: 9, airbrushParticleShape: 'square', airbrushScatterRadius: 48, airbrushDensity: 36, airbrushIntervalMs: 24 })
    storage.setItem(TOOL_SETTINGS_KEY, JSON.stringify({ airbrushParticleRadius: 99, airbrushScatterRadius: 99, airbrushDensity: 0, airbrushIntervalMs: 1 }))
    expect(loadToolSettings(storage)).toMatchObject({ airbrushParticleRadius: 16, airbrushScatterRadius: 64, airbrushDensity: 1, airbrushIntervalMs: 16 })
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
