import { describe, expect, it } from 'vitest'
import { BRUSH_SHIFT_LINE_ENABLED_KEY, DEFAULT_GRID_COLOR, DEFAULT_PIXEL_GRID_COLOR, EXPORT_DIRECTORY_PREFERENCE_KEY, EXPORT_FORMAT_PREFERENCE_KEY, GRID_COLOR_PREFERENCE_KEY, LANGUAGE_PREFERENCE_KEY, LAYER_DISPLAY_COLOR_PRESETS_KEY, MOVE_LAYER_CONTENT_PREVIEW_ENABLED_PREFERENCE_KEY, NEW_DOCUMENT_SIZE_PRESETS_KEY, PIXEL_GRID_COLOR_PREFERENCE_KEY, RECOVERY_MINUTES_PREFERENCE_KEY, SAVE_DIRECTORY_PREFERENCE_KEY, SAVE_FORMAT_PREFERENCE_KEY, SYMMETRY_AXIS_PREFERENCE_KEY, THEME_PREFERENCE_KEY, TIMELAPSE_RECORDING_ENABLED_PREFERENCE_KEY, TIMELINE_HIDDEN_PREFERENCE_KEY, TOOL_ICON_SCALE_PREFERENCE_KEY, UI_SCALE_PREFERENCE_KEY, WHEEL_ZOOM_MODE_PREFERENCE_KEY, ZOOM_TOOL_DRAG_MODE_PREFERENCE_KEY, imageExportKindForPreference, loadEditorPreferences, parseBrushPreviewMode, parseBrushShiftLineEnabled, parseCheckerSize, parseCursorScale, parseDocumentSizePresets, parseDrawingBrushPreviewEnabled, parseExportScalePresets, parseEyedropperMagnifierStyle, parseLayerDisplayColorPresets, parseLineDirectionStep, parseRelativeLuminanceScope, parseSymmetryAxisPreferences, parseToolIconScale, parseUiScale, parseWheelZoomMode, parseZoomToolDragMode, saveEditorPreferences, saveImageKindForPreference } from './file-preferences'
import { resolveTheme } from './theme'

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

  it('defaults wheel zoom to percentage steps and restores smooth zoom', () => {
    expect(parseWheelZoomMode(null)).toBe('stepped')
    expect(parseWheelZoomMode('smooth')).toBe('smooth')
    expect(parseWheelZoomMode('unexpected')).toBe('stepped')
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
    expect(parseBrushPreviewMode('full-edge')).toBe('full-edge')
    expect(parseBrushPreviewMode('unknown')).toBe('full')
    expect(parseCheckerSize('32')).toBe(32)
    expect(parseCheckerSize('12')).toBe(12)
    expect(parseCheckerSize('0')).toBe(1)
    expect(parseCheckerSize('512')).toBe(256)
    expect(parseLineDirectionStep('2')).toBe(2)
    expect(parseLineDirectionStep('99')).toBe(16)
  })

  it('normalizes symmetry axis appearance and lock preferences', () => {
    expect(parseSymmetryAxisPreferences(null)).toEqual({ locked: false, color: { r: 41, g: 121, b: 255, a: 242 }, thickness: 1 })
    expect(parseSymmetryAxisPreferences(JSON.stringify({ locked: true, color: { r: 12.4, g: 34.6, b: 56.2, a: 1 }, thickness: 20 }))).toEqual({ locked: true, color: { r: 12, g: 35, b: 56, a: 1 }, thickness: 8 })
    expect(parseSymmetryAxisPreferences(JSON.stringify({ color: { r: -1, g: 0, b: 0, a: 12 }, thickness: 0 }))).toEqual({ locked: false, color: { r: 41, g: 121, b: 255, a: 12 }, thickness: 1 })
    expect(parseSymmetryAxisPreferences(JSON.stringify({ color: { r: 12, g: 34, b: 56, a: 255 }, opacity: 42 }))).toEqual({ locked: false, color: { r: 12, g: 34, b: 56, a: 107 }, thickness: 1 })
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
    expect(defaults.language).toBe('zh-CN')
    expect(defaults.uiScale).toBe(1)
    expect(defaults.toolIconScale).toBe(2)
    expect(defaults.exportFormat).toBe('png')
    expect(defaults.saveDirectory).toBe('')
    expect(defaults.exportDirectory).toBe('')
    expect(defaults.recoveryMinutes).toBe(5)
    expect(defaults.useLocalCursors).toBe(false)
    expect(defaults.brushPreviewMode).toBe('full')
    expect(defaults.checkerboard.size).toBe(16)
    expect(defaults.pixelGridColor).toEqual(DEFAULT_PIXEL_GRID_COLOR)
    expect(defaults.gridColor).toEqual(DEFAULT_GRID_COLOR)
    expect(defaults.sliceColor).toEqual({ r: 0, g: 0, b: 255, a: 255 })
    expect(defaults.textBoxColor).toEqual({ r: 0, g: 0, b: 255, a: 255 })
    expect(defaults.sliceOutlinesVisible).toBe(true)
    expect(defaults.wheelZoomEnabled).toBe(true)
    expect(defaults.wheelZoomMode).toBe('stepped')
    expect(defaults.lassoPreviewClosed).toBe(false)
    expect(defaults.eyedropperSwitchToPencil).toBe(false)
    expect(defaults.eyedropperMagnifierEnabled).toBe(true)
    expect(defaults.eyedropperMagnifierStyle).toBe('pixel')
    expect(defaults.eyedropperMagnifierDistortionEnabled).toBe(true)
    expect(defaults.moveLayerContentPreviewEnabled).toBe(true)
    expect(defaults.moveLayerClickFlashEnabled).toBe(true)
    expect(defaults.selectionCrosshair).toBe(false)
    expect(defaults.balancedShiftLineEnabled).toBe(true)
    expect(defaults.lineDirectionStep).toBe(1)
    expect(defaults.layerDisplayColorPresets.length).toBeGreaterThan(0)
    expect(defaults.symmetryAxis).toEqual({ locked: false, color: { r: 41, g: 121, b: 255, a: 242 }, thickness: 1 })
    expect(defaults.timelapseRecordingEnabled).toBe(false)

    storage.set(RECOVERY_MINUTES_PREFERENCE_KEY, '999')
    expect(loadEditorPreferences(adapter).recoveryMinutes).toBe(60)
    storage.set(LANGUAGE_PREFERENCE_KEY, 'en-US')
    expect(loadEditorPreferences(adapter).language).toBe('en-US')
    storage.set(UI_SCALE_PREFERENCE_KEY, '0.75')
    expect(loadEditorPreferences(adapter).uiScale).toBe(0.75)
    storage.set(UI_SCALE_PREFERENCE_KEY, '1.23')
    expect(loadEditorPreferences(adapter).uiScale).toBe(1)
    storage.set(TOOL_ICON_SCALE_PREFERENCE_KEY, '1')
    expect(loadEditorPreferences(adapter).toolIconScale).toBe(1)
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
    saveEditorPreferences({ ...current, uiScale: 1.5, toolIconScale: 1, saveFormat: 'aseprite', exportFormat: 'svg', saveDirectory: '  D:\\MoonSprite\\gallery  ', exportDirectory: 'D:/MoonSprite/exports', recoveryMinutes: 12, documentSizePresets: [{ width: 32, height: 16 }, { width: 32, height: 16 }], exportScalePresets: [100, 100, 250] }, adapter)
    expect(storage.get(SAVE_FORMAT_PREFERENCE_KEY)).toBe('aseprite')
    expect(storage.get(EXPORT_FORMAT_PREFERENCE_KEY)).toBe('svg')
    expect(storage.get(UI_SCALE_PREFERENCE_KEY)).toBe('1.5')
    expect(storage.get(TOOL_ICON_SCALE_PREFERENCE_KEY)).toBe('1')
    expect(storage.get(SAVE_DIRECTORY_PREFERENCE_KEY)).toBe('D:\\MoonSprite\\gallery')
    expect(storage.get(EXPORT_DIRECTORY_PREFERENCE_KEY)).toBe('D:/MoonSprite/exports')
    expect(parseToolIconScale('1')).toBe(1)
    expect(parseToolIconScale('3')).toBe(2)
    expect(parseUiScale('0.5')).toBe(1)
    expect(parseUiScale('2')).toBe(2)
    expect(parseUiScale('1.25')).toBe(1)
    expect(loadEditorPreferences(adapter).recoveryMinutes).toBe(12)
    expect(loadEditorPreferences(adapter).documentSizePresets).toEqual([{ width: 32, height: 16 }])
    expect(loadEditorPreferences(adapter).exportScalePresets).toEqual([100, 250])
    expect(loadEditorPreferences(adapter).saveDirectory).toBe('D:\\MoonSprite\\gallery')
    expect(loadEditorPreferences(adapter).exportDirectory).toBe('D:/MoonSprite/exports')
    expect(storage.has(NEW_DOCUMENT_SIZE_PRESETS_KEY)).toBe(true)
    saveEditorPreferences({ ...loadEditorPreferences(adapter), zoomToolDragMode: 'stepped' }, adapter)
    expect(storage.get(ZOOM_TOOL_DRAG_MODE_PREFERENCE_KEY)).toBe('stepped')
    saveEditorPreferences({ ...loadEditorPreferences(adapter), wheelZoomMode: 'smooth' }, adapter)
    expect(storage.get(WHEEL_ZOOM_MODE_PREFERENCE_KEY)).toBe('smooth')
    expect(loadEditorPreferences(adapter).wheelZoomMode).toBe('smooth')
    saveEditorPreferences({ ...loadEditorPreferences(adapter), brushShiftLineEnabled: false }, adapter)
    expect(storage.get(BRUSH_SHIFT_LINE_ENABLED_KEY)).toBe('false')
    saveEditorPreferences({ ...loadEditorPreferences(adapter), timelapseRecordingEnabled: false, timelineHidden: true, sliceOutlinesVisible: false, eyedropperMagnifierEnabled: false, eyedropperMagnifierDistortionEnabled: false, moveLayerContentPreviewEnabled: false, moveLayerClickFlashEnabled: false }, adapter)
    expect(storage.get(TIMELAPSE_RECORDING_ENABLED_PREFERENCE_KEY)).toBe('false')
    expect(loadEditorPreferences(adapter).timelapseRecordingEnabled).toBe(false)
    expect(storage.get(TIMELINE_HIDDEN_PREFERENCE_KEY)).toBe('true')
    expect(loadEditorPreferences(adapter).timelineHidden).toBe(true)
    expect(loadEditorPreferences(adapter).sliceOutlinesVisible).toBe(false)
    expect(loadEditorPreferences(adapter).eyedropperMagnifierEnabled).toBe(false)
    expect(loadEditorPreferences(adapter).eyedropperMagnifierDistortionEnabled).toBe(false)
    expect(storage.get(MOVE_LAYER_CONTENT_PREVIEW_ENABLED_PREFERENCE_KEY)).toBe('false')
    expect(loadEditorPreferences(adapter).moveLayerContentPreviewEnabled).toBe(false)
    expect(loadEditorPreferences(adapter).moveLayerClickFlashEnabled).toBe(false)
    saveEditorPreferences({ ...loadEditorPreferences(adapter), eyedropperMagnifierStyle: 'line' }, adapter)
    expect(loadEditorPreferences(adapter).eyedropperMagnifierStyle).toBe('line')
    saveEditorPreferences({ ...loadEditorPreferences(adapter), useLocalCursors: false, cursorScale: 1.5, brushPreviewMode: 'edge', checkerboard: { size: 12, lightColor: { r: 1, g: 2, b: 3, a: 255 }, darkColor: { r: 4, g: 5, b: 6, a: 255 } }, pixelGridColor: { r: 10, g: 20, b: 30, a: 40 }, gridColor: { r: 50, g: 60, b: 70, a: 80 }, sliceColor: { r: 90, g: 100, b: 110, a: 120 }, textBoxColor: { r: 130, g: 140, b: 150, a: 160 }, wheelZoomEnabled: false, shiftLinePreviewEnabled: false, lassoPreviewClosed: true, eyedropperSwitchToPencil: true, balancedShiftLineEnabled: false, lineDirectionStep: 2, layerDisplayColorPresets: [{ r: 12, g: 34, b: 56, a: 99 }], symmetryAxis: { locked: true, color: { r: 22, g: 44, b: 66, a: 7 }, thickness: 6 } }, adapter)
    const customized = loadEditorPreferences(adapter)
    expect(customized.useLocalCursors).toBe(false)
    expect(customized.cursorScale).toBe(1.5)
    expect(customized.brushPreviewMode).toBe('edge')
    expect(customized.checkerboard).toEqual({ size: 12, lightColor: { r: 1, g: 2, b: 3, a: 255 }, darkColor: { r: 4, g: 5, b: 6, a: 255 } })
    expect(customized.pixelGridColor).toEqual({ r: 10, g: 20, b: 30, a: 40 })
    expect(customized.gridColor).toEqual({ r: 50, g: 60, b: 70, a: 80 })
    expect(customized.sliceColor).toEqual({ r: 90, g: 100, b: 110, a: 120 })
    expect(customized.textBoxColor).toEqual({ r: 130, g: 140, b: 150, a: 160 })
    expect(customized.wheelZoomEnabled).toBe(false)
    expect(customized.shiftLinePreviewEnabled).toBe(false)
    expect(customized.lassoPreviewClosed).toBe(true)
    expect(customized.eyedropperSwitchToPencil).toBe(true)
    expect(customized.balancedShiftLineEnabled).toBe(false)
    expect(customized.lineDirectionStep).toBe(2)
    expect(customized.layerDisplayColorPresets).toEqual([{ r: 12, g: 34, b: 56, a: 255 }])
    expect(customized.symmetryAxis).toEqual({ locked: true, color: { r: 22, g: 44, b: 66, a: 7 }, thickness: 6 })
    expect(storage.has(LAYER_DISPLAY_COLOR_PRESETS_KEY)).toBe(true)
    expect(storage.has(SYMMETRY_AXIS_PREFERENCE_KEY)).toBe(true)
    expect(storage.has(PIXEL_GRID_COLOR_PREFERENCE_KEY)).toBe(true)
    expect(storage.has(GRID_COLOR_PREFERENCE_KEY)).toBe(true)
  })

  it('accepts only the supported eyedropper magnifier styles', () => {
    expect(parseEyedropperMagnifierStyle('pixel')).toBe('pixel')
    expect(parseEyedropperMagnifierStyle('line')).toBe('line')
    expect(parseEyedropperMagnifierStyle('unknown')).toBe('pixel')
  })

  it('switches theme defaults while preserving explicit visual overrides', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
      clear: () => { values.clear() },
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size }
    } as Storage
    const current = loadEditorPreferences(storage)
    const theme = { ...current.theme, activeThemeId: 'light' }
    const visual = resolveTheme(theme).visualDefaults
    saveEditorPreferences({ ...current, theme, checkerboard: { ...current.checkerboard, lightColor: visual.checkerLight, darkColor: visual.checkerDark }, pixelGridColor: visual.pixelGrid, gridColor: visual.customGrid, onionSkin: { ...current.onionSkin, previousColor: visual.onionPrevious, nextColor: visual.onionNext }, symmetryAxis: { ...current.symmetryAxis, color: visual.symmetryAxis } }, storage)
    const light = loadEditorPreferences(storage)
    expect(light.theme.activeThemeId).toBe('light')
    expect(light.checkerboard.lightColor).toEqual(visual.checkerLight)
    saveEditorPreferences({ ...light, pixelGridColor: { r: 2, g: 4, b: 6, a: 8 } }, storage)
    expect(loadEditorPreferences(storage).pixelGridColor).toEqual({ r: 2, g: 4, b: 6, a: 8 })
  })

  it('migrates legacy stored visual colors to explicit theme overrides', () => {
    const values = new Map<string, string>([[PIXEL_GRID_COLOR_PREFERENCE_KEY, '#01020304']])
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
      clear: () => { values.clear() },
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size }
    } as Storage
    const loaded = loadEditorPreferences(storage)
    expect(loaded.pixelGridColor).toEqual({ r: 1, g: 2, b: 3, a: 4 })
    expect(loaded.theme.visualOverrides?.pixelGrid).toEqual({ r: 1, g: 2, b: 3, a: 4 })
    saveEditorPreferences(loaded, storage)
    expect(values.has(THEME_PREFERENCE_KEY)).toBe(true)
  })
})
