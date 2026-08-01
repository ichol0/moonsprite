import type { ImageExportKind, SaveImageKind } from './png'

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

export type RotationIndicatorPosition = 'view' | 'canvas'
export type RelativeLuminanceScope = 'canvas' | 'app'

export function parseRotationIndicatorPosition(value: string | null): RotationIndicatorPosition {
  return value === 'canvas' ? 'canvas' : 'view'
}

export function parseDrawingBrushPreviewEnabled(value: string | null): boolean {
  return value !== 'false'
}

export function parseRelativeLuminanceScope(value: string | null): RelativeLuminanceScope {
  return value === 'app' ? 'app' : 'canvas'
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
  relativeLuminanceScope: 'canvas'
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

function readStorage(storage?: Storage): Storage | null {
  try { return storage ?? window.localStorage } catch { return null }
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

function parseRecoveryMinutes(value: string | null): number {
  if (!value?.trim()) return DEFAULT_EDITOR_PREFERENCES.recoveryMinutes
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(1, Math.min(60, Math.round(parsed))) : DEFAULT_EDITOR_PREFERENCES.recoveryMinutes
}

export function loadEditorPreferences(storage?: Storage): EditorPreferences {
  const source = readStorage(storage)
  const get = (key: string): string | null => {
    try { return source?.getItem(key) ?? null } catch { return null }
  }
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
    relativeLuminanceScope: parseRelativeLuminanceScope(get(RELATIVE_LUMINANCE_SCOPE_KEY))
  }
}

export function saveEditorPreferences(preferences: EditorPreferences, storage?: Storage): void {
  const target = readStorage(storage)
  if (!target) return
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
    [RELATIVE_LUMINANCE_SCOPE_KEY]: preferences.relativeLuminanceScope
  }
  try {
    for (const [key, value] of Object.entries(values)) target.setItem(key, value)
  } catch {
    return
  }
}
