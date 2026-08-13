import type { GifDirection } from './gif'
import type { ImageExportKind } from './png'
import { readStoredJson, writeStoredJson } from './storage'

export const EXPORT_PRESETS_STORAGE_KEY = 'moonsprite.export-presets.v2'
export const LEGACY_EXPORT_PRESETS_STORAGE_KEY = 'moonsprite.export-presets.v1'
export const RECENT_EXPORT_PATHS_STORAGE_KEY = 'moonsprite.recent-export-paths.v1'
export const RECENT_EXPORTS_CHANGED_EVENT = 'moonsprite:recent-exports-changed'

const EXPORT_PRESET_SCHEMA_VERSION = 2
const RECENT_EXPORT_PATHS_SCHEMA_VERSION = 1
const MAX_RECENT_EXPORT_PATHS = 10
const exportFormats: readonly ImageExportKind[] = ['png-auto', 'png-rgba', 'jpeg', 'webp', 'svg', 'gif']

export interface ExportPreset {
  presetName: string
  name: string
  format: ImageExportKind
  scalePercent: number
  target?: 'document' | 'slices' | 'frames'
  directory?: string
  gifFrameRange?: 'all' | 'range'
  gifFrameStart?: number
  gifFrameEnd?: number
  gifDirection?: GifDirection
}

export interface RecentExportPath {
  filePath: string
  exportedAt: string
}

interface StoredExportPresets {
  schemaVersion: number
  presets: unknown[]
}

interface StoredRecentExportPaths {
  schemaVersion: number
  paths: unknown[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isExportFormat = (value: unknown): value is ImageExportKind => typeof value === 'string' && exportFormats.includes(value as ImageExportKind)
const finiteInteger = (value: unknown, fallback: number, min: number, max: number): number => {
  const number = typeof value === 'number' ? value : Number.NaN
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback
}
const optionalFiniteInteger = (value: unknown, min: number, max: number): number | undefined => typeof value === 'number' && Number.isFinite(value)
  ? Math.max(min, Math.min(max, Math.round(value)))
  : undefined

function normalizeExportPreset(value: unknown): ExportPreset | null {
  if (!isRecord(value)) return null
  const presetName = typeof value.presetName === 'string' ? value.presetName.trim() : ''
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  if (!presetName || !name) return null
  const format = isExportFormat(value.format) ? value.format : 'png-auto'
  const legacyScalePercent = typeof value.scale === 'number' ? value.scale * 100 : 100
  const scalePercent = finiteInteger(value.scalePercent, finiteInteger(legacyScalePercent, 100, 1, 6400), 1, 6400)
  const directory = typeof value.directory === 'string' ? value.directory.trim() : ''
  const target = format !== 'gif' && (value.target === 'slices' || value.target === 'frames') ? value.target : 'document'
  const gifFrameRange = value.gifFrameRange === 'range' ? 'range' : 'all'
  const gifDirection: GifDirection = value.gifDirection === 'reverse'
    || value.gifDirection === 'forward-ping-pong'
    || value.gifDirection === 'reverse-ping-pong'
    ? value.gifDirection
    : 'forward'
  const gifFrameStart = optionalFiniteInteger(value.gifFrameStart, 1, 1_000_000)
  const gifFrameEnd = optionalFiniteInteger(value.gifFrameEnd, 1, 1_000_000)
  return {
    presetName,
    name: withExportFileExtension(name, format),
    format,
    scalePercent,
    ...(target !== 'document' ? { target } : {}),
    ...(directory ? { directory } : {}),
    ...(format === 'gif' ? {
      gifFrameRange,
      ...(gifFrameStart !== undefined ? { gifFrameStart } : {}),
      ...(gifFrameEnd !== undefined ? { gifFrameEnd } : {}),
      gifDirection
    } : {})
  }
}

export function loadExportPresets(storage?: Storage): ExportPreset[] {
  const current = readStoredJson<unknown>(EXPORT_PRESETS_STORAGE_KEY, null, storage)
  const values = isRecord(current)
    && current.schemaVersion === EXPORT_PRESET_SCHEMA_VERSION
    && Array.isArray(current.presets)
    ? current.presets
    : readStoredJson<unknown>(LEGACY_EXPORT_PRESETS_STORAGE_KEY, [], storage)
  if (!Array.isArray(values)) return []
  return values.flatMap((value) => {
    const preset = normalizeExportPreset(value)
    return preset ? [preset] : []
  })
}

export function saveExportPresets(presets: readonly ExportPreset[], storage?: Storage): boolean {
  const normalized = presets.flatMap((preset) => {
    const value = normalizeExportPreset(preset)
    return value ? [value] : []
  })
  return writeStoredJson(EXPORT_PRESETS_STORAGE_KEY, {
    schemaVersion: EXPORT_PRESET_SCHEMA_VERSION,
    presets: normalized
  } satisfies StoredExportPresets, storage)
}

export function exportFileExtension(format: ImageExportKind): 'png' | 'jpg' | 'webp' | 'svg' | 'gif' {
  if (format === 'jpeg') return 'jpg'
  if (format === 'webp') return 'webp'
  if (format === 'svg') return 'svg'
  if (format === 'gif') return 'gif'
  return 'png'
}

export function withExportFileExtension(name: string, format: ImageExportKind): string {
  const fallback = 'MoonSprite-export'
  const stem = name.trim().replace(/\.(moonsprite|aseprite|ase|png|jpe?g|webp|svg|gif)$/i, '').trim() || fallback
  return `${stem}.${exportFileExtension(format)}`
}

export function parentDirectoryFromPath(filePath: string): string {
  const normalized = filePath.trim().replace(/[\\/]+$/, '')
  const separatorIndex = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'))
  if (separatorIndex < 0) return ''
  if (separatorIndex === 0) return normalized.slice(0, 1)
  if (separatorIndex === 2 && /^[A-Za-z]:/.test(normalized)) return normalized.slice(0, 3)
  return normalized.slice(0, separatorIndex)
}

function normalizeRecentExportPath(value: unknown): RecentExportPath | null {
  if (!isRecord(value) || typeof value.filePath !== 'string') return null
  const filePath = value.filePath.trim()
  if (!filePath) return null
  const exportedAt = typeof value.exportedAt === 'string' && Number.isFinite(Date.parse(value.exportedAt))
    ? value.exportedAt
    : new Date(0).toISOString()
  return { filePath, exportedAt }
}

export function loadRecentExportPaths(storage?: Storage): RecentExportPath[] {
  const stored = readStoredJson<unknown>(RECENT_EXPORT_PATHS_STORAGE_KEY, null, storage)
  if (!isRecord(stored) || stored.schemaVersion !== RECENT_EXPORT_PATHS_SCHEMA_VERSION || !Array.isArray(stored.paths)) return []
  const seen = new Set<string>()
  return stored.paths.flatMap((value) => {
    const item = normalizeRecentExportPath(value)
    if (!item) return []
    const key = item.filePath.toLocaleLowerCase()
    if (seen.has(key)) return []
    seen.add(key)
    return [item]
  }).slice(0, MAX_RECENT_EXPORT_PATHS)
}

export function recordRecentExportPath(filePath: string, storage?: Storage, now = new Date()): boolean {
  const normalizedPath = filePath.trim()
  if (!normalizedPath) return false
  const key = normalizedPath.toLocaleLowerCase()
  const next = [
    { filePath: normalizedPath, exportedAt: now.toISOString() },
    ...loadRecentExportPaths(storage).filter((item) => item.filePath.toLocaleLowerCase() !== key)
  ].slice(0, MAX_RECENT_EXPORT_PATHS)
  return writeStoredJson(RECENT_EXPORT_PATHS_STORAGE_KEY, {
    schemaVersion: RECENT_EXPORT_PATHS_SCHEMA_VERSION,
    paths: next
  } satisfies StoredRecentExportPaths, storage)
}
