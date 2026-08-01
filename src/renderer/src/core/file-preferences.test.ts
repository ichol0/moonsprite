import { describe, expect, it } from 'vitest'
import { EXPORT_FORMAT_PREFERENCE_KEY, NEW_DOCUMENT_SIZE_PRESETS_KEY, RECOVERY_MINUTES_PREFERENCE_KEY, SAVE_FORMAT_PREFERENCE_KEY, imageExportKindForPreference, loadEditorPreferences, parseDocumentSizePresets, parseDrawingBrushPreviewEnabled, parseExportScalePresets, parseRelativeLuminanceScope, saveEditorPreferences, saveImageKindForPreference } from './file-preferences'

describe('file format preferences', () => {
  it('maps export formats to encoder kinds', () => {
    expect(imageExportKindForPreference('png')).toBe('png-auto')
    expect(imageExportKindForPreference('jpeg')).toBe('jpeg')
    expect(imageExportKindForPreference('webp')).toBe('webp')
    expect(imageExportKindForPreference('svg')).toBe('svg')
    expect(imageExportKindForPreference('aseprite')).toBe('png-auto')
  })

  it('keeps the native project format separate from image saves', () => {
    expect(saveImageKindForPreference('moonsprite')).toBeNull()
    expect(saveImageKindForPreference('png')).toBe('png-auto')
    expect(saveImageKindForPreference('ase')).toBe('ase')
    expect(saveImageKindForPreference('aseprite')).toBe('aseprite')
  })

  it('loads validated document-size and export-scale presets', () => {
    expect(parseDocumentSizePresets('[{"width":32,"height":16},{"width":32,"height":16},{"width":0,"height":4}]')).toEqual([{ width: 32, height: 16 }])
    expect(parseExportScalePresets('[100,250,250,0,7000]')).toEqual([100, 250])
  })

  it('falls back when stored preset lists are invalid or empty', () => {
    expect(parseDocumentSizePresets('[]').length).toBeGreaterThan(0)
    expect(parseExportScalePresets('invalid')).toContain(100)
  })
})

describe('canvas preferences', () => {
  it('keeps drawing-time brush preview enabled by default and restores an explicit disabled value', () => {
    expect(parseDrawingBrushPreviewEnabled(null)).toBe(true)
    expect(parseDrawingBrushPreviewEnabled('true')).toBe(true)
    expect(parseDrawingBrushPreviewEnabled('false')).toBe(false)
  })

  it('defaults relative luminance to the canvas and accepts the app-wide scope', () => {
    expect(parseRelativeLuminanceScope(null)).toBe('canvas')
    expect(parseRelativeLuminanceScope('canvas')).toBe('canvas')
    expect(parseRelativeLuminanceScope('app')).toBe('app')
    expect(parseRelativeLuminanceScope('unexpected')).toBe('canvas')
  })
})

describe('editor preferences persistence boundary', () => {
  it('uses defaults for missing values and clamps recovery interval', () => {
    const storage = new Map<string, string>()
    const adapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
      removeItem: (key: string) => { storage.delete(key) },
      clear: () => { storage.clear() },
      key: (index: number) => [...storage.keys()][index] ?? null,
      get length() { return storage.size }
    } as Storage
    const defaults = loadEditorPreferences(adapter)
    expect(defaults.saveFormat).toBe('moonsprite')
    expect(defaults.exportFormat).toBe('png')
    expect(defaults.recoveryMinutes).toBe(5)

    storage.set(RECOVERY_MINUTES_PREFERENCE_KEY, '999')
    expect(loadEditorPreferences(adapter).recoveryMinutes).toBe(60)
  })

  it('round-trips normalized values through storage', () => {
    const storage = new Map<string, string>()
    const adapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
      removeItem: (key: string) => { storage.delete(key) },
      clear: () => { storage.clear() },
      key: (index: number) => [...storage.keys()][index] ?? null,
      get length() { return storage.size }
    } as Storage
    const current = loadEditorPreferences(adapter)
    saveEditorPreferences({ ...current, saveFormat: 'aseprite', exportFormat: 'svg', recoveryMinutes: 12, documentSizePresets: [{ width: 32, height: 16 }, { width: 32, height: 16 }], exportScalePresets: [100, 100, 250] }, adapter)
    expect(storage.get(SAVE_FORMAT_PREFERENCE_KEY)).toBe('aseprite')
    expect(storage.get(EXPORT_FORMAT_PREFERENCE_KEY)).toBe('svg')
    expect(loadEditorPreferences(adapter).recoveryMinutes).toBe(12)
    expect(loadEditorPreferences(adapter).documentSizePresets).toEqual([{ width: 32, height: 16 }])
    expect(loadEditorPreferences(adapter).exportScalePresets).toEqual([100, 250])
    expect(storage.has(NEW_DOCUMENT_SIZE_PRESETS_KEY)).toBe(true)
  })
})
