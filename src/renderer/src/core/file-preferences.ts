import type { ImageExportKind, SaveImageKind } from './png'
import { DEFAULT_APP_LOCALE, LANGUAGE_PREFERENCE_KEY as APP_LANGUAGE_PREFERENCE_KEY, parseAppLocale, type AppLocale } from './localization'
import { readStoredString, writeStoredString } from './storage'
import type { RgbaColor } from '@shared/types'
import type { ColorValueMode } from './color-values'
import { DEFAULT_THEME_PREFERENCES, THEME_PREFERENCE_KEY, loadThemePreferences, normalizeThemePreferences, resolveTheme, rgbaHex, saveThemePreferences, withThemePaletteColors, type ThemePalette, type ThemePreferences } from './theme'

export const SAVE_FORMAT_PREFERENCE_KEY = 'moonsprite.preference.save-format'
export const EXPORT_FORMAT_PREFERENCE_KEY = 'moonsprite.preference.export-format'
export const SAVE_DIRECTORY_PREFERENCE_KEY = 'moonsprite.preference.save-directory'
export const EXPORT_DIRECTORY_PREFERENCE_KEY = 'moonsprite.preference.export-directory'
export const NEW_DOCUMENT_SIZE_PRESETS_KEY = 'moonsprite.preference.new-document-size-presets'
export const EXPORT_SCALE_PRESETS_KEY = 'moonsprite.preference.export-scale-presets'
export const ROTATION_INDICATOR_POSITION_KEY = 'moonsprite.preference.rotation-indicator-position'
export const DRAWING_BRUSH_PREVIEW_ENABLED_KEY = 'moonsprite.preference.drawing-brush-preview-enabled'
export const RELATIVE_LUMINANCE_SCOPE_KEY = 'moonsprite.preference.relative-luminance-scope'
export const LANGUAGE_PREFERENCE_KEY = APP_LANGUAGE_PREFERENCE_KEY
export const RECOVERY_PREFERENCE_KEY = 'moonsprite.preference.recovery'
export const RECOVERY_MINUTES_PREFERENCE_KEY = 'moonsprite.preference.recovery-minutes'
export const ZOOM_TOOL_DRAG_MODE_PREFERENCE_KEY = 'moonsprite.preference.zoom-tool-drag-mode'
export const WHEEL_ZOOM_MODE_PREFERENCE_KEY = 'moonsprite.preference.wheel-zoom-mode'
export const BRUSH_SHIFT_LINE_ENABLED_KEY = 'moonsprite.preference.brush-shift-line-enabled'
export const USE_LOCAL_CURSORS_PREFERENCE_KEY = 'moonsprite.preference.use-local-cursors'
export const CURSOR_SCALE_PREFERENCE_KEY = 'moonsprite.preference.cursor-scale'
export const BRUSH_PREVIEW_MODE_PREFERENCE_KEY = 'moonsprite.preference.brush-preview-mode'
export const CHECKER_SIZE_PREFERENCE_KEY = 'moonsprite.preference.checker-size'
export const CHECKER_LIGHT_COLOR_PREFERENCE_KEY = 'moonsprite.preference.checker-light-color'
export const CHECKER_DARK_COLOR_PREFERENCE_KEY = 'moonsprite.preference.checker-dark-color'
export const PIXEL_GRID_COLOR_PREFERENCE_KEY = 'moonsprite.preference.pixel-grid-color'
export const GRID_COLOR_PREFERENCE_KEY = 'moonsprite.preference.grid-color'
export const WHEEL_ZOOM_ENABLED_PREFERENCE_KEY = 'moonsprite.preference.wheel-zoom-enabled'
export const SHIFT_LINE_PREVIEW_ENABLED_PREFERENCE_KEY = 'moonsprite.preference.shift-line-preview-enabled'
export const LASSO_PREVIEW_CLOSED_PREFERENCE_KEY = 'moonsprite.preference.lasso-preview-closed'
export const EYEDROPPER_SWITCH_TO_PENCIL_PREFERENCE_KEY = 'moonsprite.preference.eyedropper-switch-to-pencil'
export const EYEDROPPER_MAGNIFIER_ENABLED_PREFERENCE_KEY = 'moonsprite.preference.eyedropper-magnifier-enabled'
export const EYEDROPPER_MAGNIFIER_STYLE_PREFERENCE_KEY = 'moonsprite.preference.eyedropper-magnifier-style'
export const EYEDROPPER_MAGNIFIER_DISTORTION_ENABLED_PREFERENCE_KEY = 'moonsprite.preference.eyedropper-magnifier-distortion-enabled'
export const MOVE_LAYER_CONTENT_PREVIEW_ENABLED_PREFERENCE_KEY = 'moonsprite.preference.move-layer-content-preview-enabled'
export const SELECTION_CROSSHAIR_PREFERENCE_KEY = 'moonsprite.preference.selection-crosshair'
export const BALANCED_SHIFT_LINE_ENABLED_PREFERENCE_KEY = 'moonsprite.preference.balanced-shift-line-enabled'
export const LINE_DIRECTION_STEP_PREFERENCE_KEY = 'moonsprite.preference.line-direction-step'
export const LAYER_DISPLAY_COLOR_PRESETS_KEY = 'moonsprite.preference.layer-display-color-presets'
export const COLOR_EDITOR_MODES_PREFERENCE_KEY = 'moonsprite.preference.color-editor-modes'
export const ONION_SKIN_PREFERENCE_KEY = 'moonsprite.preference.onion-skin'
export const SYMMETRY_AXIS_PREFERENCE_KEY = 'moonsprite.preference.symmetry-axis'
export const TIMELAPSE_RECORDING_ENABLED_PREFERENCE_KEY = 'moonsprite.preference.timelapse-recording-enabled'
export const UI_SCALE_PREFERENCE_KEY = 'moonsprite.preference.ui-scale'
export const TOOL_ICON_SCALE_PREFERENCE_KEY = 'moonsprite.preference.tool-icon-scale'
export { THEME_PREFERENCE_KEY }

export type RotationIndicatorPosition = 'view' | 'canvas'
export type RelativeLuminanceScope = 'canvas' | 'app'
export type ZoomToolDragMode = 'smooth' | 'stepped'
export type WheelZoomMode = 'smooth' | 'stepped'
export type CursorScale = 1 | 1.25 | 1.5 | 2
export const UI_SCALE_VALUES = [0.75, 1, 1.5, 2] as const
export type UiScale = typeof UI_SCALE_VALUES[number]
export type ToolIconScale = 1 | 2
export type BrushPreviewMode = 'none' | 'edge' | 'full' | 'full-edge'
export type EyedropperMagnifierStyle = 'pixel' | 'line'
export type CheckerSize = number

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

export const DEFAULT_PIXEL_GRID_COLOR: RgbaColor = { r: 69, g: 77, b: 92, a: 143 }
export const DEFAULT_GRID_COLOR: RgbaColor = { r: 0, g: 0, b: 255, a: 255 }

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

export function parseWheelZoomMode(value: string | null): WheelZoomMode {
  return value === 'smooth' ? 'smooth' : 'stepped'
}

export function parseBrushShiftLineEnabled(value: string | null): boolean {
  return value !== 'false'
}

export function parseCursorScale(value: string | null): CursorScale {
  const parsed = Number(value)
  return parsed === 1.25 || parsed === 1.5 || parsed === 2 ? parsed : 1
}

export function parseUiScale(value: string | null): UiScale {
  const parsed = Number(value)
  return UI_SCALE_VALUES.includes(parsed as UiScale) ? parsed as UiScale : 1
}

export function parseToolIconScale(value: string | null): ToolIconScale {
  return value === '1' ? 1 : 2
}

export function parseBrushPreviewMode(value: string | null): BrushPreviewMode {
  return value === 'none' || value === 'edge' || value === 'full' || value === 'full-edge' ? value : 'full'
}

export function parseEyedropperMagnifierStyle(value: string | null): EyedropperMagnifierStyle {
  return value === 'line' ? 'line' : 'pixel'
}

export function parseCheckerSize(value: string | null): CheckerSize {
  if (value === null || value.trim() === '') return DEFAULT_CHECKERBOARD_PREFERENCES.size
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(1, Math.min(256, Math.round(parsed))) : DEFAULT_CHECKERBOARD_PREFERENCES.size
}

export function parseLineDirectionStep(value: string | null): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(1, Math.min(16, Math.round(parsed))) : 1
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

export interface GridColorPreferences {
  pixelGridColor: RgbaColor
  gridColor: RgbaColor
}

export function loadGridColorPreferences(storage?: Storage): GridColorPreferences {
  const get = (key: string): string | null => readStoredString(key, storage)
  return {
    pixelGridColor: parseHexColor(get(PIXEL_GRID_COLOR_PREFERENCE_KEY), DEFAULT_PIXEL_GRID_COLOR),
    gridColor: parseHexColor(get(GRID_COLOR_PREFERENCE_KEY), DEFAULT_GRID_COLOR)
  }
}

export interface DocumentSizePreset { width: number; height: number }

export const DEFAULT_DOCUMENT_SIZE_PRESETS: DocumentSizePreset[] = [
  { width: 16, height: 16 }, { width: 32, height: 32 }, { width: 64, height: 64 },
  { width: 128, height: 128 }, { width: 256, height: 256 }, { width: 320, height: 180 }
]
export const DEFAULT_EXPORT_SCALE_PRESETS = [100, 200, 400, 1000, 2000]
export const DEFAULT_LAYER_DISPLAY_COLOR_PRESETS: RgbaColor[] = [
  { r: 239, g: 83, b: 80, a: 255 },
  { r: 255, g: 167, b: 38, a: 255 },
  { r: 253, g: 216, b: 53, a: 255 },
  { r: 102, g: 187, b: 106, a: 255 },
  { r: 38, g: 198, b: 218, a: 255 },
  { r: 41, g: 121, b: 255, a: 255 },
  { r: 171, g: 71, b: 188, a: 255 }
]
export interface ColorEditorModePreference { mode: ColorValueMode; enabled: boolean }
export const DEFAULT_COLOR_EDITOR_MODES: ColorEditorModePreference[] = (['rgb', 'hsv', 'hsl', 'gray', 'lab', 'cmyk'] as ColorValueMode[]).map((mode) => ({ mode, enabled: true }))
export interface OnionSkinPreferences {
  enabled: boolean
  previousFrames: number
  nextFrames: number
  previousOpacity: number
  nextOpacity: number
  previousColor: RgbaColor
  nextColor: RgbaColor
}
export const DEFAULT_ONION_SKIN_PREFERENCES: OnionSkinPreferences = {
  enabled: false,
  previousFrames: 1,
  nextFrames: 1,
  previousOpacity: 35,
  nextOpacity: 35,
  previousColor: { r: 239, g: 83, b: 80, a: 255 },
  nextColor: { r: 41, g: 121, b: 255, a: 255 }
}

export interface SymmetryAxisPreferences {
  locked: boolean
  color: RgbaColor
  thickness: number
}

export const MIN_SYMMETRY_AXIS_THICKNESS = 1
export const MAX_SYMMETRY_AXIS_THICKNESS = 8

export const DEFAULT_SYMMETRY_AXIS_PREFERENCES: SymmetryAxisPreferences = {
  locked: false,
  color: { r: 41, g: 121, b: 255, a: 242 },
  thickness: 1
}

export type SaveFormatPreference = 'moonsprite' | 'png' | 'jpeg' | 'webp' | 'ase' | 'aseprite'
export type ExportFormatPreference = 'png' | 'jpeg' | 'webp' | 'svg' | 'gif'

export interface EditorPreferences {
  language: AppLocale
  uiScale: UiScale
  toolIconScale: ToolIconScale
  saveFormat: SaveFormatPreference
  exportFormat: ExportFormatPreference
  saveDirectory: string
  exportDirectory: string
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
  pixelGridColor: RgbaColor
  gridColor: RgbaColor
  wheelZoomEnabled: boolean
  wheelZoomMode: WheelZoomMode
  shiftLinePreviewEnabled: boolean
  lassoPreviewClosed: boolean
  eyedropperSwitchToPencil: boolean
  eyedropperMagnifierEnabled: boolean
  eyedropperMagnifierStyle: EyedropperMagnifierStyle
  eyedropperMagnifierDistortionEnabled: boolean
  moveLayerContentPreviewEnabled: boolean
  selectionCrosshair: boolean
  balancedShiftLineEnabled: boolean
  lineDirectionStep: number
  layerDisplayColorPresets: RgbaColor[]
  colorEditorModes: ColorEditorModePreference[]
  onionSkin: OnionSkinPreferences
  symmetryAxis: SymmetryAxisPreferences
  timelapseRecordingEnabled: boolean
  theme: ThemePreferences
}

export const DEFAULT_EDITOR_PREFERENCES: EditorPreferences = {
  language: DEFAULT_APP_LOCALE,
  uiScale: 1,
  toolIconScale: 2,
  saveFormat: 'moonsprite',
  exportFormat: 'png',
  saveDirectory: '',
  exportDirectory: '',
  recovery: true,
  recoveryMinutes: 5,
  documentSizePresets: DEFAULT_DOCUMENT_SIZE_PRESETS,
  exportScalePresets: DEFAULT_EXPORT_SCALE_PRESETS,
  rotationIndicatorPosition: 'view',
  drawingBrushPreviewEnabled: true,
  relativeLuminanceScope: 'canvas',
  zoomToolDragMode: 'smooth',
  brushShiftLineEnabled: true,
  useLocalCursors: false,
  cursorScale: 1,
  brushPreviewMode: 'full',
  checkerboard: DEFAULT_CHECKERBOARD_PREFERENCES,
  pixelGridColor: DEFAULT_PIXEL_GRID_COLOR,
  gridColor: DEFAULT_GRID_COLOR,
  wheelZoomEnabled: true,
  wheelZoomMode: 'stepped',
  shiftLinePreviewEnabled: true,
  lassoPreviewClosed: false,
  eyedropperSwitchToPencil: false,
  eyedropperMagnifierEnabled: true,
  eyedropperMagnifierStyle: 'pixel',
  eyedropperMagnifierDistortionEnabled: true,
  moveLayerContentPreviewEnabled: true,
  selectionCrosshair: false,
  balancedShiftLineEnabled: true,
  lineDirectionStep: 1,
  layerDisplayColorPresets: DEFAULT_LAYER_DISPLAY_COLOR_PRESETS,
  colorEditorModes: DEFAULT_COLOR_EDITOR_MODES,
  onionSkin: DEFAULT_ONION_SKIN_PREFERENCES,
  symmetryAxis: DEFAULT_SYMMETRY_AXIS_PREFERENCES,
  timelapseRecordingEnabled: true,
  theme: DEFAULT_THEME_PREFERENCES
}

let previewPreferences: EditorPreferences | null = null

export function setEditorPreferencesPreview(preferences: EditorPreferences | null): void {
  previewPreferences = preferences
}

const sameColor = (a: RgbaColor, b: RgbaColor): boolean => a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a
const copyPreferences = (preferences: EditorPreferences): EditorPreferences => structuredClone(preferences)

const migrateLegacyThemeColors = (theme: ThemePreferences, get: (key: string) => string | null, checkerboard: CheckerboardPreferences, grid: GridColorPreferences, onionSkin: OnionSkinPreferences, symmetryAxis: SymmetryAxisPreferences): ThemePreferences => {
  if (get(THEME_PREFERENCE_KEY) !== null) return theme
  const colors: Partial<ThemePalette> = {}
  if (get(CHECKER_LIGHT_COLOR_PREFERENCE_KEY) !== null) colors.checkerLight = rgbaHex(checkerboard.lightColor)
  if (get(CHECKER_DARK_COLOR_PREFERENCE_KEY) !== null) colors.checkerDark = rgbaHex(checkerboard.darkColor)
  if (get(PIXEL_GRID_COLOR_PREFERENCE_KEY) !== null) colors.pixelGrid = rgbaHex(grid.pixelGridColor)
  if (get(GRID_COLOR_PREFERENCE_KEY) !== null) colors.customGrid = rgbaHex(grid.gridColor)
  if (get(ONION_SKIN_PREFERENCE_KEY) !== null) {
    colors.onionPrevious = rgbaHex(onionSkin.previousColor)
    colors.onionNext = rgbaHex(onionSkin.nextColor)
  }
  if (get(SYMMETRY_AXIS_PREFERENCE_KEY) !== null) colors.symmetryAxis = rgbaHex(symmetryAxis.color)
  return Object.keys(colors).length > 0 ? withThemePaletteColors(theme, colors) : theme
}

const effectiveThemeColors = (theme: ThemePreferences, get: (key: string) => string | null, storage?: Storage): { theme: ThemePreferences; checkerboard: CheckerboardPreferences; grid: GridColorPreferences; onionSkin: OnionSkinPreferences; symmetryAxis: SymmetryAxisPreferences } => {
  const storedCheckerboard = loadCheckerboardPreferences(storage)
  const storedGrid = loadGridColorPreferences(storage)
  const storedOnionSkin = parseOnionSkinPreferences(get(ONION_SKIN_PREFERENCE_KEY))
  const storedSymmetryAxis = parseSymmetryAxisPreferences(get(SYMMETRY_AXIS_PREFERENCE_KEY))
  const migrated = migrateLegacyThemeColors(theme, get, storedCheckerboard, storedGrid, storedOnionSkin, storedSymmetryAxis)
  const finalTheme = normalizeThemePreferences(migrated)
  const finalResolved = resolveTheme(finalTheme)
  return {
    theme: finalTheme,
    checkerboard: { size: parseCheckerSize(get(CHECKER_SIZE_PREFERENCE_KEY)), lightColor: { ...finalResolved.visualDefaults.checkerLight }, darkColor: { ...finalResolved.visualDefaults.checkerDark } },
    grid: { pixelGridColor: { ...finalResolved.visualDefaults.pixelGrid }, gridColor: { ...finalResolved.visualDefaults.customGrid } },
    onionSkin: { ...storedOnionSkin, previousColor: { ...finalResolved.visualDefaults.onionPrevious }, nextColor: { ...finalResolved.visualDefaults.onionNext } },
    symmetryAxis: { ...storedSymmetryAxis, color: { ...finalResolved.visualDefaults.symmetryAxis } }
  }
}

const themeWithInferredVisualColors = (preferences: EditorPreferences): ThemePreferences => {
  const theme = normalizeThemePreferences(preferences.theme)
  const defaults = resolveTheme(theme).visualDefaults
  const values: Array<[keyof Pick<ThemePalette, 'checkerLight' | 'checkerDark' | 'pixelGrid' | 'customGrid' | 'onionPrevious' | 'onionNext' | 'symmetryAxis'>, RgbaColor, RgbaColor]> = [
    ['checkerLight', preferences.checkerboard.lightColor, defaults.checkerLight],
    ['checkerDark', preferences.checkerboard.darkColor, defaults.checkerDark],
    ['pixelGrid', preferences.pixelGridColor, defaults.pixelGrid],
    ['customGrid', preferences.gridColor, defaults.customGrid],
    ['onionPrevious', preferences.onionSkin.previousColor, defaults.onionPrevious],
    ['onionNext', preferences.onionSkin.nextColor, defaults.onionNext],
    ['symmetryAxis', preferences.symmetryAxis.color, defaults.symmetryAxis]
  ]
  const colors: Partial<ThemePalette> = {}
  for (const [key, value, fallback] of values) {
    if (!sameColor(value, fallback)) colors[key] = rgbaHex(value)
  }
  return Object.keys(colors).length > 0 ? withThemePaletteColors(theme, colors) : theme
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

export function parseLayerDisplayColorPresets(value: string | null): RgbaColor[] {
  const fallback = (): RgbaColor[] => DEFAULT_LAYER_DISPLAY_COLOR_PRESETS.map((color) => ({ ...color }))
  try {
    const parsed = JSON.parse(value ?? 'null') as unknown
    if (!Array.isArray(parsed)) return fallback()
    const seen = new Set<string>()
    const colors: RgbaColor[] = []
    for (const candidate of parsed) {
      if (!candidate || typeof candidate !== 'object') continue
      const value = candidate as Partial<RgbaColor>
      const channels = [value.r, value.g, value.b]
      if (channels.some((channel) => typeof channel !== 'number' || !Number.isFinite(channel) || channel < 0 || channel > 255)) continue
      const color = { r: Math.round(value.r!), g: Math.round(value.g!), b: Math.round(value.b!), a: 255 }
      const key = `${color.r}:${color.g}:${color.b}`
      if (seen.has(key)) continue
      seen.add(key)
      colors.push(color)
      if (colors.length === 12) break
    }
    return colors.length > 0 ? colors : fallback()
  } catch {
    return fallback()
  }
}

export function parseColorEditorModes(value: string | null): ColorEditorModePreference[] {
  const supported = DEFAULT_COLOR_EDITOR_MODES.map(({ mode }) => mode)
  try {
    const parsed = JSON.parse(value ?? 'null') as unknown
    if (!Array.isArray(parsed)) return DEFAULT_COLOR_EDITOR_MODES.map((item) => ({ ...item }))
    const seen = new Set<ColorValueMode>()
    const result: ColorEditorModePreference[] = []
    for (const candidate of parsed) {
      if (!candidate || typeof candidate !== 'object') continue
      const item = candidate as Partial<ColorEditorModePreference>
      if (!supported.includes(item.mode as ColorValueMode) || seen.has(item.mode as ColorValueMode)) continue
      seen.add(item.mode as ColorValueMode)
      result.push({ mode: item.mode as ColorValueMode, enabled: item.enabled !== false })
    }
    for (const mode of supported) if (!seen.has(mode)) result.push({ mode, enabled: true })
    if (!result.some((item) => item.enabled)) result[0].enabled = true
    return result
  } catch {
    return DEFAULT_COLOR_EDITOR_MODES.map((item) => ({ ...item }))
  }
}

export function parseOnionSkinPreferences(value: string | null): OnionSkinPreferences {
  try {
    const parsed = JSON.parse(value ?? 'null') as Partial<OnionSkinPreferences> | null
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid onion skin preferences')
    const count = (candidate: unknown, fallback: number): number => typeof candidate === 'number' && Number.isFinite(candidate) ? Math.max(0, Math.min(8, Math.round(candidate))) : fallback
    const opacity = (candidate: unknown, fallback: number): number => typeof candidate === 'number' && Number.isFinite(candidate) ? Math.max(0, Math.min(100, Math.round(candidate))) : fallback
    return {
      enabled: parsed.enabled === true,
      previousFrames: count(parsed.previousFrames, DEFAULT_ONION_SKIN_PREFERENCES.previousFrames),
      nextFrames: count(parsed.nextFrames, DEFAULT_ONION_SKIN_PREFERENCES.nextFrames),
      previousOpacity: opacity(parsed.previousOpacity, DEFAULT_ONION_SKIN_PREFERENCES.previousOpacity),
      nextOpacity: opacity(parsed.nextOpacity, DEFAULT_ONION_SKIN_PREFERENCES.nextOpacity),
      previousColor: parseHexColor(typeof parsed.previousColor === 'object' ? colorHex(parsed.previousColor as RgbaColor) : null, DEFAULT_ONION_SKIN_PREFERENCES.previousColor),
      nextColor: parseHexColor(typeof parsed.nextColor === 'object' ? colorHex(parsed.nextColor as RgbaColor) : null, DEFAULT_ONION_SKIN_PREFERENCES.nextColor)
    }
  } catch {
    return { ...DEFAULT_ONION_SKIN_PREFERENCES, previousColor: { ...DEFAULT_ONION_SKIN_PREFERENCES.previousColor }, nextColor: { ...DEFAULT_ONION_SKIN_PREFERENCES.nextColor } }
  }
}

export function parseSymmetryAxisPreferences(value: string | null): SymmetryAxisPreferences {
  const fallback = (): SymmetryAxisPreferences => ({
    ...DEFAULT_SYMMETRY_AXIS_PREFERENCES,
    color: { ...DEFAULT_SYMMETRY_AXIS_PREFERENCES.color }
  })
  try {
    const parsed = JSON.parse(value ?? 'null') as (Partial<SymmetryAxisPreferences> & { opacity?: unknown }) | null
    if (!parsed || typeof parsed !== 'object') return fallback()
    const storedColor = parsed.color && typeof parsed.color === 'object' ? parsed.color as Partial<RgbaColor> : null
    const channels = storedColor ? [storedColor.r, storedColor.g, storedColor.b] : []
    const legacyOpacity = typeof parsed.opacity === 'number' && Number.isFinite(parsed.opacity)
      ? Math.max(0, Math.min(100, parsed.opacity))
      : null
    const alpha = legacyOpacity !== null
      ? Math.round(legacyOpacity * 255 / 100)
      : typeof storedColor?.a === 'number' && Number.isFinite(storedColor.a) && storedColor.a >= 0 && storedColor.a <= 255
        ? Math.round(storedColor.a)
        : DEFAULT_SYMMETRY_AXIS_PREFERENCES.color.a
    const color = channels.length === 3 && channels.every((channel) => typeof channel === 'number' && Number.isFinite(channel) && channel >= 0 && channel <= 255)
      ? { r: Math.round(storedColor!.r!), g: Math.round(storedColor!.g!), b: Math.round(storedColor!.b!), a: alpha }
      : { ...DEFAULT_SYMMETRY_AXIS_PREFERENCES.color, a: alpha }
    const thickness = typeof parsed.thickness === 'number' && Number.isFinite(parsed.thickness)
      ? Math.max(MIN_SYMMETRY_AXIS_THICKNESS, Math.min(MAX_SYMMETRY_AXIS_THICKNESS, Math.round(parsed.thickness)))
      : DEFAULT_SYMMETRY_AXIS_PREFERENCES.thickness
    return { locked: parsed.locked === true, color, thickness }
  } catch {
    return fallback()
  }
}

export function imageExportKindForPreference(value: string | null): ImageExportKind {
  if (value === 'gif') return 'gif'
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
  return value === 'jpeg' || value === 'webp' || value === 'svg' || value === 'gif' ? value : 'png'
}

function parseDirectoryPreference(value: string | null): string {
  return value?.trim() ?? ''
}

export function parseRecoveryMinutes(value: string | null): number {
  if (!value?.trim()) return DEFAULT_EDITOR_PREFERENCES.recoveryMinutes
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0.5, Math.min(60, parsed)) : DEFAULT_EDITOR_PREFERENCES.recoveryMinutes
}

export function loadEditorPreferences(storage?: Storage): EditorPreferences {
  if (!storage && previewPreferences) return copyPreferences(previewPreferences)
  const get = (key: string): string | null => readStoredString(key, storage)
  const theme = effectiveThemeColors(loadThemePreferences(storage), get, storage)
  return {
    language: parseAppLocale(get(LANGUAGE_PREFERENCE_KEY)),
    uiScale: parseUiScale(get(UI_SCALE_PREFERENCE_KEY)),
    toolIconScale: parseToolIconScale(get(TOOL_ICON_SCALE_PREFERENCE_KEY)),
    saveFormat: parseSaveFormat(get(SAVE_FORMAT_PREFERENCE_KEY)),
    exportFormat: parseExportFormat(get(EXPORT_FORMAT_PREFERENCE_KEY)),
    saveDirectory: parseDirectoryPreference(get(SAVE_DIRECTORY_PREFERENCE_KEY)),
    exportDirectory: parseDirectoryPreference(get(EXPORT_DIRECTORY_PREFERENCE_KEY)),
    recovery: get(RECOVERY_PREFERENCE_KEY) !== 'false',
    recoveryMinutes: parseRecoveryMinutes(get(RECOVERY_MINUTES_PREFERENCE_KEY)),
    documentSizePresets: parseDocumentSizePresets(get(NEW_DOCUMENT_SIZE_PRESETS_KEY)),
    exportScalePresets: parseExportScalePresets(get(EXPORT_SCALE_PRESETS_KEY)),
    rotationIndicatorPosition: parseRotationIndicatorPosition(get(ROTATION_INDICATOR_POSITION_KEY)),
    drawingBrushPreviewEnabled: parseDrawingBrushPreviewEnabled(get(DRAWING_BRUSH_PREVIEW_ENABLED_KEY)),
    relativeLuminanceScope: parseRelativeLuminanceScope(get(RELATIVE_LUMINANCE_SCOPE_KEY)),
    zoomToolDragMode: parseZoomToolDragMode(get(ZOOM_TOOL_DRAG_MODE_PREFERENCE_KEY)),
    brushShiftLineEnabled: parseBrushShiftLineEnabled(get(BRUSH_SHIFT_LINE_ENABLED_KEY)),
    useLocalCursors: get(USE_LOCAL_CURSORS_PREFERENCE_KEY) === 'true',
    cursorScale: parseCursorScale(get(CURSOR_SCALE_PREFERENCE_KEY)),
    brushPreviewMode: parseBrushPreviewMode(get(BRUSH_PREVIEW_MODE_PREFERENCE_KEY)),
    checkerboard: theme.checkerboard,
    pixelGridColor: theme.grid.pixelGridColor,
    gridColor: theme.grid.gridColor,
    wheelZoomEnabled: get(WHEEL_ZOOM_ENABLED_PREFERENCE_KEY) !== 'false',
    wheelZoomMode: parseWheelZoomMode(get(WHEEL_ZOOM_MODE_PREFERENCE_KEY)),
    shiftLinePreviewEnabled: get(SHIFT_LINE_PREVIEW_ENABLED_PREFERENCE_KEY) !== 'false',
    lassoPreviewClosed: get(LASSO_PREVIEW_CLOSED_PREFERENCE_KEY) === 'true',
    eyedropperSwitchToPencil: get(EYEDROPPER_SWITCH_TO_PENCIL_PREFERENCE_KEY) === 'true',
    eyedropperMagnifierEnabled: get(EYEDROPPER_MAGNIFIER_ENABLED_PREFERENCE_KEY) !== 'false',
    eyedropperMagnifierStyle: parseEyedropperMagnifierStyle(get(EYEDROPPER_MAGNIFIER_STYLE_PREFERENCE_KEY)),
    eyedropperMagnifierDistortionEnabled: get(EYEDROPPER_MAGNIFIER_DISTORTION_ENABLED_PREFERENCE_KEY) !== 'false',
    moveLayerContentPreviewEnabled: get(MOVE_LAYER_CONTENT_PREVIEW_ENABLED_PREFERENCE_KEY) !== 'false',
    selectionCrosshair: get(SELECTION_CROSSHAIR_PREFERENCE_KEY) === 'true',
    balancedShiftLineEnabled: get(BALANCED_SHIFT_LINE_ENABLED_PREFERENCE_KEY) !== 'false',
    lineDirectionStep: parseLineDirectionStep(get(LINE_DIRECTION_STEP_PREFERENCE_KEY)),
    layerDisplayColorPresets: parseLayerDisplayColorPresets(get(LAYER_DISPLAY_COLOR_PRESETS_KEY)),
    colorEditorModes: parseColorEditorModes(get(COLOR_EDITOR_MODES_PREFERENCE_KEY)),
    onionSkin: theme.onionSkin,
    symmetryAxis: theme.symmetryAxis,
    timelapseRecordingEnabled: get(TIMELAPSE_RECORDING_ENABLED_PREFERENCE_KEY) !== 'false',
    theme: theme.theme
  }
}

export function saveEditorPreferences(preferences: EditorPreferences, storage?: Storage): void {
  const theme = themeWithInferredVisualColors(preferences)
  const values: Record<string, string> = {
    [LANGUAGE_PREFERENCE_KEY]: preferences.language,
    [UI_SCALE_PREFERENCE_KEY]: String(parseUiScale(String(preferences.uiScale))),
    [TOOL_ICON_SCALE_PREFERENCE_KEY]: String(parseToolIconScale(String(preferences.toolIconScale))),
    [SAVE_FORMAT_PREFERENCE_KEY]: preferences.saveFormat,
    [EXPORT_FORMAT_PREFERENCE_KEY]: preferences.exportFormat,
    [SAVE_DIRECTORY_PREFERENCE_KEY]: parseDirectoryPreference(preferences.saveDirectory),
    [EXPORT_DIRECTORY_PREFERENCE_KEY]: parseDirectoryPreference(preferences.exportDirectory),
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
    [PIXEL_GRID_COLOR_PREFERENCE_KEY]: colorHex(preferences.pixelGridColor),
    [GRID_COLOR_PREFERENCE_KEY]: colorHex(preferences.gridColor),
    [WHEEL_ZOOM_ENABLED_PREFERENCE_KEY]: String(preferences.wheelZoomEnabled),
    [WHEEL_ZOOM_MODE_PREFERENCE_KEY]: preferences.wheelZoomMode,
    [SHIFT_LINE_PREVIEW_ENABLED_PREFERENCE_KEY]: String(preferences.shiftLinePreviewEnabled),
    [LASSO_PREVIEW_CLOSED_PREFERENCE_KEY]: String(preferences.lassoPreviewClosed),
    [EYEDROPPER_SWITCH_TO_PENCIL_PREFERENCE_KEY]: String(preferences.eyedropperSwitchToPencil),
    [EYEDROPPER_MAGNIFIER_ENABLED_PREFERENCE_KEY]: String(preferences.eyedropperMagnifierEnabled),
    [EYEDROPPER_MAGNIFIER_STYLE_PREFERENCE_KEY]: preferences.eyedropperMagnifierStyle,
    [EYEDROPPER_MAGNIFIER_DISTORTION_ENABLED_PREFERENCE_KEY]: String(preferences.eyedropperMagnifierDistortionEnabled),
    [MOVE_LAYER_CONTENT_PREVIEW_ENABLED_PREFERENCE_KEY]: String(preferences.moveLayerContentPreviewEnabled),
    [SELECTION_CROSSHAIR_PREFERENCE_KEY]: String(preferences.selectionCrosshair),
    [BALANCED_SHIFT_LINE_ENABLED_PREFERENCE_KEY]: String(preferences.balancedShiftLineEnabled),
    [LINE_DIRECTION_STEP_PREFERENCE_KEY]: String(parseLineDirectionStep(String(preferences.lineDirectionStep))),
    [LAYER_DISPLAY_COLOR_PRESETS_KEY]: JSON.stringify(parseLayerDisplayColorPresets(JSON.stringify(preferences.layerDisplayColorPresets))),
    [COLOR_EDITOR_MODES_PREFERENCE_KEY]: JSON.stringify(parseColorEditorModes(JSON.stringify(preferences.colorEditorModes))),
    [ONION_SKIN_PREFERENCE_KEY]: JSON.stringify(parseOnionSkinPreferences(JSON.stringify(preferences.onionSkin))),
    [SYMMETRY_AXIS_PREFERENCE_KEY]: JSON.stringify(parseSymmetryAxisPreferences(JSON.stringify(preferences.symmetryAxis))),
    [TIMELAPSE_RECORDING_ENABLED_PREFERENCE_KEY]: String(preferences.timelapseRecordingEnabled)
  }
  for (const [key, value] of Object.entries(values)) writeStoredString(key, value, storage)
  saveThemePreferences(theme, storage)
}
