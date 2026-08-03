import { describe, expect, it } from 'vitest'
import { BRUSH_SHIFT_LINE_ENABLED_KEY, EXPORT_FORMAT_PREFERENCE_KEY, LAYER_DISPLAY_COLOR_PRESETS_KEY, NEW_DOCUMENT_SIZE_PRESETS_KEY, RECOVERY_MINUTES_PREFERENCE_KEY, SAVE_FORMAT_PREFERENCE_KEY, ZOOM_TOOL_DRAG_MODE_PREFERENCE_KEY, imageExportKindForPreference, loadEditorPreferences, parseBrushPreviewMode, parseBrushShiftLineEnabled, parseCheckerSize, parseCursorScale, parseDocumentSizePresets, parseDrawingBrushPreviewEnabled, parseExportScalePresets, parseLayerDisplayColorPresets, parseRelativeLuminanceScope, parseZoomToolDragMode, saveEditorPreferences, saveImageKindForPreference } from './file-preferences'

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

  it('validates, deduplicates and limits layer display color presets', () => {
    const colors = Array.from({ length: 14 }, (_, index) => ({ r: index, g: index + 1, b: index + 2, a: 100 }))
    expect(parseLayerDisplayColorPresets(JSON.stringify([colors[0], colors[0], { r: -1, g: 0, b: 0 }, ...colors.slice(1)]))).toHaveLength(12)
    expect(parseLayerDisplayColorPresets(JSON.stringify([colors[0]]))).toEqual([{ r: 0, g: 1, b: 2, a: 255 }])
    expect(parseLayerDisplayColorPresets('[]').length).toBeGreaterThan(0)
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

  it('defaults zoom-tool dragging to smooth and restores stepped zoom', () => {
    expect(parseZoomToolDragMode(null)).toBe('smooth')
    expect(parseZoomToolDragMode('stepped')).toBe('stepped')
    expect(parseZoomToolDragMode('unexpected')).toBe('smooth')
  })

  it('keeps Shift line drawing enabled by default and restores an explicit disabled value', () => {
    expect(parseBrushShiftLineEnabled(null)).toBe(true)
    expect(parseBrushShiftLineEnabled('true')).toBe(true)
    expect(parseBrushShiftLineEnabled('false')).toBe(false)
  })

  it('validates cursor and checkerboard presets', () => {
    expect(parseCursorScale('1.5')).toBe(1.5)
    expect(parseCursorScale('9')).toBe(1)
    expect(parseBrushPreviewMode('edge')).toBe('edge')
    expect(parseBrushPreviewMode('unknown')).toBe('full-edge')
    expect(parseCheckerSize('32')).toBe(32)
    expect(parseCheckerSize('12')).toBe(16)
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
    expect(defaults.useLocalCursors).toBe(true)
    expect(defaults.brushPreviewMode).toBe('full-edge')
    expect(defaults.checkerboard.size).toBe(16)
    expect(defaults.wheelZoomEnabled).toBe(true)
    expect(defaults.lassoPreviewClosed).toBe(false)
    expect(defaults.eyedropperSwitchToPencil).toBe(false)
    expect(defaults.selectionCrosshair).toBe(false)
    expect(defaults.balancedShiftLineEnabled).toBe(true)
    expect(defaults.layerDisplayColorPresets.length).toBeGreaterThan(0)

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
    saveEditorPreferences({ ...loadEditorPreferences(adapter), zoomToolDragMode: 'stepped' }, adapter)
    expect(storage.get(ZOOM_TOOL_DRAG_MODE_PREFERENCE_KEY)).toBe('stepped')
    saveEditorPreferences({ ...loadEditorPreferences(adapter), brushShiftLineEnabled: false }, adapter)
    expect(storage.get(BRUSH_SHIFT_LINE_ENABLED_KEY)).toBe('false')
    saveEditorPreferences({ ...loadEditorPreferences(adapter), useLocalCursors: false, cursorScale: 1.5, brushPreviewMode: 'edge', checkerboard: { size: 8, lightColor: { r: 1, g: 2, b: 3, a: 255 }, darkColor: { r: 4, g: 5, b: 6, a: 255 } }, wheelZoomEnabled: false, shiftLinePreviewEnabled: false, lassoPreviewClosed: true, eyedropperSwitchToPencil: true, balancedShiftLineEnabled: false, layerDisplayColorPresets: [{ r: 12, g: 34, b: 56, a: 99 }] }, adapter)
    const customized = loadEditorPreferences(adapter)
    expect(customized.useLocalCursors).toBe(false)
    expect(customized.cursorScale).toBe(1.5)
    expect(customized.brushPreviewMode).toBe('edge')
    expect(customized.checkerboard).toEqual({ size: 8, lightColor: { r: 1, g: 2, b: 3, a: 255 }, darkColor: { r: 4, g: 5, b: 6, a: 255 } })
    expect(customized.wheelZoomEnabled).toBe(false)
    expect(customized.shiftLinePreviewEnabled).toBe(false)
    expect(customized.lassoPreviewClosed).toBe(true)
    expect(customized.eyedropperSwitchToPencil).toBe(true)
    expect(customized.balancedShiftLineEnabled).toBe(false)
    expect(customized.layerDisplayColorPresets).toEqual([{ r: 12, g: 34, b: 56, a: 255 }])
    expect(storage.has(LAYER_DISPLAY_COLOR_PRESETS_KEY)).toBe(true)
  })
})
