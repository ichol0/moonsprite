import type { ImageExportKind, SaveImageKind } from './png'
import { readStoredString, writeStoredString } from './storage'
import type { RgbaColor } from '@shared/types'

export const SAVE_FORMAT_PREFERENCE_KEY = 'moonsprite.preference.save-format'
export const EXPORT_FORMAT_PREFERENCE_KEY = 'moonsprite.preference.export-format'
export const NEW_DOCUMENT_SIZE_PRESETS_KEY = 'moonsprite.preference.new-document-size-presets'
export const EXPORT_SCALE_PRESETS_KEY = 'moonsprite.preference.export-scale-presets'
export const ROTATION_INDICATOR_POSITION_KEY = 'moonsprite.preference.rotation-indicator-position'
export const DRAWING_BRUSH_PREVIEW_ENABLED_KEY = 'moonsprite.preference.drawing-brush-preview-enabled'
export const RELATIVE_LUMINANCE_SCOPE_KEY = 'moonsprite.preference.relative-luminance-scope'
export const LANGUAGE_PREFERENCE_KEY = 'moonsprite.preference.language'
export const RECOVERY_PREFERENCE_KEY = 'moonsprite.preference.recovery'
export const RECOVERY_MINUTES_PREFERENCE_KEY = 'moonsprite.preference.recovery-minutes'
export const ZOOM_TOOL_DRAG_MODE_PREFERENCE_KEY = 'moonsprite.preference.zoom-tool-drag-mode'
export const BRUSH_SHIFT_LINE_ENABLED_KEY = 'moonsprite.preference.brush-shift-line-enabled'
export const USE_LOCAL_CURSORS_PREFERENCE_KEY = 'moonsprite.preference.use-local-cursors'
export const CURSOR_SCALE_PREFERENCE_KEY = 'moonsprite.preference.cursor-scale'
export const BRUSH_PREVIEW_MODE_PREFERENCE_KEY = 'moonsprite.preference.brush-preview-mode'
export const CHECKER_SIZE_PREFERENCE_KEY = 'moonsprite.preference.checker-size'
export const CHECKER_LIGHT_COLOR_PREFERENCE_KEY = 'moonsprite.preference.checker-light-color'
export const CHECKER_DARK_COLOR_PREFERENCE_KEY = 'moonsprite.preference.checker-dark-color'
export const WHEEL_ZOOM_ENABLED_PREFERENCE_KEY = 'moonsprite.preference.wheel-zoom-enabled'
export const SHIFT_LINE_PREVIEW_ENABLED_PREFERENCE_KEY = 'moonsprite.preference.shift-line-preview-enabled'

export type RotationIndicatorPosition = 'view' | 'canvas'
export type RelativeLuminanceScope = 'canvas' | 'app'
export type ZoomToolDragMode = 'smooth' | 'stepped'
export type CursorScale = 1 | 1.25 | 1.5 | 2
export type BrushPreviewMode = 'none' | 'edge' | 'full' | 'full-edge'
export type CheckerSize = 4 | 8 | 16 | 32

export interface CheckerboardPreferences {
  size: CheckerSize
  lightColor: RgbaColor
  darkColor: RgbaColor
}

export const DEFAULT_CHECKERBOARD_PREFERENCES: CheckerboardPreferences = {
  size: 16,
  lightColor: { r: 215, g: 215, b: 217, a: 255 },
  darkColor: { r: 155, g: 155, b: 159, a: 255 }
}

export function parseRotationIndicatorPosition(value: string | null): RotationIndicatorPosition {
  return value === 'canvas' ? 'canvas' : 'view'
}

export function parseDrawingBrushPreviewEnabled(value: string | null): boolean {
  return value !== 'false'
}

export function parseRelativeLuminanceScope(value: string | null): RelativeLuminanceScope {
  return value === 'app' ? 'app' : 'canvas'
}

export function parseZoomToolDragMode(value: string | null): ZoomToolDragMode {
  return value === 'stepped' ? 'stepped' : 'smooth'
}

export function parseBrushShiftLineEnabled(value: string | null): boolean {
  return value !== 'false'
}

export function parseCursorScale(value: string | null): CursorScale {
  const parsed = Number(value)
  return parsed === 1.25 || parsed === 1.5 || parsed === 2 ? parsed : 1
}

export function parseBrushPreviewMode(value: string | null): BrushPreviewMode {
  return value === 'none' || value === 'edge' || value === 'full' ? value : 'full-edge'
}

export function parseCheckerSize(value: string | null): CheckerSize {
  const parsed = Number(value)
  return parsed === 4 || parsed === 8 || parsed === 32 ? parsed : 16
}

const parseHexColor = (value: string | null, fallback: RgbaColor): RgbaColor => {
  const match = value?.trim().match(/^#?([0-9a-f]{6})([0-9a-f]{2})?$/i)
  if (!match) return { ...fallback }
  const rgb = Number.parseInt(match[1], 16)
  return { r: (rgb >> 16) & 255, g: (rgb >> 8) & 255, b: rgb & 255, a: match[2] ? Number.parseInt(match[2], 16) : 255 }
}

const colorHex = (color: RgbaColor): string => `#${[color.r, color.g, color.b, color.a].map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0')).join('')}`

export function loadCheckerboardPreferences(storage?: Storage): CheckerboardPreferences {
  const get = (key: string): string | null => readStoredString(key, storage)
  return {
    size: parseCheckerSize(get(CHECKER_SIZE_PREFERENCE_KEY)),
    lightColor: parseHexColor(get(CHECKER_LIGHT_COLOR_PREFERENCE_KEY), DEFAULT_CHECKERBOARD_PREFERENCES.lightColor),
    darkColor: parseHexColor(get(CHECKER_DARK_COLOR_PREFERENCE_KEY), DEFAULT_CHECKERBOARD_PREFERENCES.darkColor)
  }
}

export interface DocumentSizePreset { width: number; height: number }

export const DEFAULT_DOCUMENT_SIZE_PRESETS: DocumentSizePreset[] = [
  { width: 16, height: 16 }, { width: 32, height: 32 }, { width: 64, height: 64 },
  { width: 128, height: 128 }, { width: 256, height: 256 }, { width: 320, height: 180 }
]
export const DEFAULT_EXPORT_SCALE_PRESETS = [100, 200, 400, 1000, 2000]

export type SaveFormatPreference = 'moonsprite' | 'png' | 'jpeg' | 'webp' | 'ase' | 'aseprite'
export type ExportFormatPreference = 'png' | 'jpeg' | 'webp' | 'svg'

export interface EditorPreferences {
  language: 'zh-CN' | 'en-US'
  saveFormat: SaveFormatPreference
  exportFormat: ExportFormatPreference
  recovery: boolean
  recoveryMinutes: number
  documentSizePresets: DocumentSizePreset[]
  exportScalePresets: number[]
  rotationIndicatorPosition: RotationIndicatorPosition
  drawingBrushPreviewEnabled: boolean
  relativeLuminanceScope: RelativeLuminanceScope
  zoomToolDragMode: ZoomToolDragMode
  brushShiftLineEnabled: boolean
  useLocalCursors: boolean
  cursorScale: CursorScale
  brushPreviewMode: BrushPreviewMode
  checkerboard: CheckerboardPreferences
  wheelZoomEnabled: boolean
  shiftLinePreviewEnabled: boolean
}

export const DEFAULT_EDITOR_PREFERENCES: EditorPreferences = {
  language: 'zh-CN',
  saveFormat: 'moonsprite',
  exportFormat: 'png',
  recovery: true,
  recoveryMinutes: 5,
  documentSizePresets: DEFAULT_DOCUMENT_SIZE_PRESETS,
  exportScalePresets: DEFAULT_EXPORT_SCALE_PRESETS,
  rotationIndicatorPosition: 'view',
  drawingBrushPreviewEnabled: true,
  relativeLuminanceScope: 'canvas',
  zoomToolDragMode: 'smooth',
  brushShiftLineEnabled: true,
  useLocalCursors: true,
  cursorScale: 1,
  brushPreviewMode: 'full-edge',
  checkerboard: DEFAULT_CHECKERBOARD_PREFERENCES,
  wheelZoomEnabled: true,
  shiftLinePreviewEnabled: true
}

const boundedInteger = (value: unknown, max: number): number | null => {
  const parsed = typeof value === 'number' ? value : Number.NaN
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= max ? Math.round(parsed) : null
}

export function parseDocumentSizePresets(value: string | null): DocumentSizePreset[] {
  try {
    const parsed = JSON.parse(value ?? 'null') as unknown
    if (!Array.isArray(parsed)) return DEFAULT_DOCUMENT_SIZE_PRESETS.map((preset) => ({ ...preset }))
    const seen = new Set<string>()
    const presets = parsed.flatMap((candidate) => {
      if (!candidate || typeof candidate !== 'object') return []
      const width = boundedInteger((candidate as Partial<DocumentSizePreset>).width, 16384)
      const height = boundedInteger((candidate as Partial<DocumentSizePreset>).height, 16384)
      if (!width || !height || seen.has(`${width}x${height}`)) return []
      seen.add(`${width}x${height}`)
      return [{ width, height }]
    })
    return presets.length > 0 ? presets : DEFAULT_DOCUMENT_SIZE_PRESETS.map((preset) => ({ ...preset }))
  } catch {
    return DEFAULT_DOCUMENT_SIZE_PRESETS.map((preset) => ({ ...preset }))
  }
}

export function parseExportScalePresets(value: string | null): number[] {
  try {
    const parsed = JSON.parse(value ?? 'null') as unknown
    if (!Array.isArray(parsed)) return [...DEFAULT_EXPORT_SCALE_PRESETS]
    const presets = [...new Set(parsed.map((candidate) => boundedInteger(candidate, 6400)).filter((candidate): candidate is number => candidate !== null))]
    return presets.length > 0 ? presets : [...DEFAULT_EXPORT_SCALE_PRESETS]
  } catch {
    return [...DEFAULT_EXPORT_SCALE_PRESETS]
  }
}

export function imageExportKindForPreference(value: string | null): ImageExportKind {
  if (value === 'jpeg') return 'jpeg'
  if (value === 'webp') return 'webp'
  if (value === 'svg') return 'svg'
  if (value === 'png-rgba') return 'png-rgba'
  return 'png-auto'
}

export function saveImageKindForPreference(value: string | null): SaveImageKind | null {
  if (value === 'moonsprite' || !value) return null
  if (value === 'ase' || value === 'aseprite') return value
  if (value === 'jpeg') return 'jpeg'
  if (value === 'webp') return 'webp'
  if (value === 'png') return 'png-auto'
  return null
}

function parseSaveFormat(value: string | null): SaveFormatPreference {
  return value === 'png' || value === 'jpeg' || value === 'webp' || value === 'ase' || value === 'aseprite' ? value : 'moonsprite'
}

function parseExportFormat(value: string | null): ExportFormatPreference {
  return value === 'jpeg' || value === 'webp' || value === 'svg' ? value : 'png'
}

function parseLanguage(value: string | null): EditorPreferences['language'] {
  return value === 'en-US' ? 'en-US' : 'zh-CN'
}

export function parseRecoveryMinutes(value: string | null): number {
  if (!value?.trim()) return DEFAULT_EDITOR_PREFERENCES.recoveryMinutes
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0.5, Math.min(60, parsed)) : DEFAULT_EDITOR_PREFERENCES.recoveryMinutes
}

export function loadEditorPreferences(storage?: Storage): EditorPreferences {
  const get = (key: string): string | null => readStoredString(key, storage)
  return {
    language: parseLanguage(get(LANGUAGE_PREFERENCE_KEY)),
    saveFormat: parseSaveFormat(get(SAVE_FORMAT_PREFERENCE_KEY)),
    exportFormat: parseExportFormat(get(EXPORT_FORMAT_PREFERENCE_KEY)),
    recovery: get(RECOVERY_PREFERENCE_KEY) !== 'false',
    recoveryMinutes: parseRecoveryMinutes(get(RECOVERY_MINUTES_PREFERENCE_KEY)),
    documentSizePresets: parseDocumentSizePresets(get(NEW_DOCUMENT_SIZE_PRESETS_KEY)),
    exportScalePresets: parseExportScalePresets(get(EXPORT_SCALE_PRESETS_KEY)),
    rotationIndicatorPosition: parseRotationIndicatorPosition(get(ROTATION_INDICATOR_POSITION_KEY)),
    drawingBrushPreviewEnabled: parseDrawingBrushPreviewEnabled(get(DRAWING_BRUSH_PREVIEW_ENABLED_KEY)),
    relativeLuminanceScope: parseRelativeLuminanceScope(get(RELATIVE_LUMINANCE_SCOPE_KEY)),
    zoomToolDragMode: parseZoomToolDragMode(get(ZOOM_TOOL_DRAG_MODE_PREFERENCE_KEY)),
    brushShiftLineEnabled: parseBrushShiftLineEnabled(get(BRUSH_SHIFT_LINE_ENABLED_KEY)),
    useLocalCursors: get(USE_LOCAL_CURSORS_PREFERENCE_KEY) !== 'false',
    cursorScale: parseCursorScale(get(CURSOR_SCALE_PREFERENCE_KEY)),
    brushPreviewMode: parseBrushPreviewMode(get(BRUSH_PREVIEW_MODE_PREFERENCE_KEY)),
    checkerboard: loadCheckerboardPreferences(storage),
    wheelZoomEnabled: get(WHEEL_ZOOM_ENABLED_PREFERENCE_KEY) !== 'false',
    shiftLinePreviewEnabled: get(SHIFT_LINE_PREVIEW_ENABLED_PREFERENCE_KEY) !== 'false'
  }
}

export function saveEditorPreferences(preferences: EditorPreferences, storage?: Storage): void {
  const values: Record<string, string> = {
    [LANGUAGE_PREFERENCE_KEY]: preferences.language,
    [SAVE_FORMAT_PREFERENCE_KEY]: preferences.saveFormat,
    [EXPORT_FORMAT_PREFERENCE_KEY]: preferences.exportFormat,
    [RECOVERY_PREFERENCE_KEY]: String(preferences.recovery),
    [RECOVERY_MINUTES_PREFERENCE_KEY]: String(parseRecoveryMinutes(String(preferences.recoveryMinutes))),
    [NEW_DOCUMENT_SIZE_PRESETS_KEY]: JSON.stringify(parseDocumentSizePresets(JSON.stringify(preferences.documentSizePresets))),
    [EXPORT_SCALE_PRESETS_KEY]: JSON.stringify(parseExportScalePresets(JSON.stringify(preferences.exportScalePresets))),
    [ROTATION_INDICATOR_POSITION_KEY]: preferences.rotationIndicatorPosition,
    [DRAWING_BRUSH_PREVIEW_ENABLED_KEY]: String(preferences.drawingBrushPreviewEnabled),
    [RELATIVE_LUMINANCE_SCOPE_KEY]: preferences.relativeLuminanceScope,
    [ZOOM_TOOL_DRAG_MODE_PREFERENCE_KEY]: preferences.zoomToolDragMode,
    [BRUSH_SHIFT_LINE_ENABLED_KEY]: String(preferences.brushShiftLineEnabled),
    [USE_LOCAL_CURSORS_PREFERENCE_KEY]: String(preferences.useLocalCursors),
    [CURSOR_SCALE_PREFERENCE_KEY]: String(preferences.cursorScale),
    [BRUSH_PREVIEW_MODE_PREFERENCE_KEY]: preferences.brushPreviewMode,
    [CHECKER_SIZE_PREFERENCE_KEY]: String(preferences.checkerboard.size),
    [CHECKER_LIGHT_COLOR_PREFERENCE_KEY]: colorHex(preferences.checkerboard.lightColor),
    [CHECKER_DARK_COLOR_PREFERENCE_KEY]: colorHex(preferences.checkerboard.darkColor),
    [WHEEL_ZOOM_ENABLED_PREFERENCE_KEY]: String(preferences.wheelZoomEnabled),
    [SHIFT_LINE_PREVIEW_ENABLED_PREFERENCE_KEY]: String(preferences.shiftLinePreviewEnabled)
  }
  for (const [key, value] of Object.entries(values)) writeStoredString(key, value, storage)
}
