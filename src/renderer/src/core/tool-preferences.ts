import type { BrushPaintMode, BrushShape, BrushTexture, FillMode, ImageBrushSettings, ProceduralBrushId, ProceduralBrushSettings, SelectionKind, SelectionMode, ShapeKind, ToolId } from '@shared/types'
import { normalizeProceduralBrushSettings, PROCEDURAL_BRUSH_IDS } from './brushes'
import { readStoredJson, writeStoredJson } from './storage'

export const TOOL_SETTINGS_KEY = 'moonsprite.tool-settings.v1'
export type BrushTool = 'pencil' | 'eraser' | 'fill'

export interface PersistedBrushProfile {
  brushSize: number
  brushShape: BrushShape
  brushTexture: BrushTexture
  brushTextureScale: number
  brushPaintMode: BrushPaintMode
  brushImageId: string | null
  brushImageSettings: ImageBrushSettings
  proceduralBrushSettings: Record<ProceduralBrushId, ProceduralBrushSettings>
  proceduralAntialias: boolean
  proceduralAntialiasStrength: number
}

export interface PersistedToolSettings extends PersistedBrushProfile {
  brushPaintModePreferenceVersion: number
  proceduralAntialiasPreferenceVersion: number
  brushProfiles?: Partial<Record<BrushTool, PersistedBrushProfile>>
  shapeKind: ShapeKind
  fillMode: FillMode
  moveAutoSelect: boolean
  selectionKind: SelectionKind
  selectionMode: SelectionMode
  wandTolerance: number
  wandContiguous: boolean
  perfectPixels: boolean
}

const createDefaultProceduralBrushSettings = (): Record<ProceduralBrushId, ProceduralBrushSettings> => Object.fromEntries(
  PROCEDURAL_BRUSH_IDS.map((id) => [id, normalizeProceduralBrushSettings(id)])
) as Record<ProceduralBrushId, ProceduralBrushSettings>

export const defaultToolSettings: PersistedToolSettings = {
  brushSize: 1,
  brushShape: 'round',
  brushTexture: 'solid',
  brushTextureScale: 1,
  brushPaintMode: 'pattern-source',
  brushPaintModePreferenceVersion: 1,
  brushImageId: null,
  brushImageSettings: { mode: 'dither', threshold: 128, blackPoint: 0, whitePoint: 255, invert: false },
  proceduralBrushSettings: createDefaultProceduralBrushSettings(),
  proceduralAntialias: false,
  proceduralAntialiasPreferenceVersion: 1,
  proceduralAntialiasStrength: 20,
  brushProfiles: undefined,
  shapeKind: 'rectangle',
  fillMode: 'contiguous',
  moveAutoSelect: true,
  selectionKind: 'rectangle',
  selectionMode: 'replace',
  wandTolerance: 0,
  wandContiguous: true,
  perfectPixels: false
}

export const cloneProceduralSettings = (settings: Record<ProceduralBrushId, ProceduralBrushSettings>): Record<ProceduralBrushId, ProceduralBrushSettings> => Object.fromEntries(
  PROCEDURAL_BRUSH_IDS.map((id) => [id, { ...settings[id] }])
) as Record<ProceduralBrushId, ProceduralBrushSettings>

export function normalizePersistedBrushProfile(stored: Partial<PersistedBrushProfile> | undefined, fallback: PersistedBrushProfile): PersistedBrushProfile {
  const proceduralBrushSettings = Object.fromEntries(PROCEDURAL_BRUSH_IDS.map((id) => [
    id,
    normalizeProceduralBrushSettings(id, stored?.proceduralBrushSettings?.[id] ?? fallback.proceduralBrushSettings[id])
  ])) as Record<ProceduralBrushId, ProceduralBrushSettings>
  return {
    brushSize: Number.isFinite(stored?.brushSize) ? Math.max(1, Math.min(128, Math.round(stored!.brushSize!))) : fallback.brushSize,
    brushShape: stored?.brushShape === 'square' || stored?.brushShape === 'round' || stored?.brushShape === 'line' ? stored.brushShape : fallback.brushShape,
    brushTexture: stored?.brushTexture === 'cracks' || stored?.brushTexture === 'wood' || stored?.brushTexture === 'grain' || stored?.brushTexture === 'solid' ? stored.brushTexture : fallback.brushTexture,
    brushTextureScale: Number.isFinite(stored?.brushTextureScale) ? Math.max(1, Math.min(16, Math.round(stored!.brushTextureScale!))) : fallback.brushTextureScale,
    brushPaintMode: stored?.brushPaintMode === 'paint' || stored?.brushPaintMode === 'pattern-source' || stored?.brushPaintMode === 'pattern-target' ? stored.brushPaintMode : fallback.brushPaintMode,
    brushImageId: typeof stored?.brushImageId === 'string' && stored.brushImageId.length > 0 ? stored.brushImageId : null,
    brushImageSettings: {
      mode: stored?.brushImageSettings?.mode === 'threshold' ? 'threshold' : stored?.brushImageSettings?.mode === 'dither' ? 'dither' : fallback.brushImageSettings.mode,
      threshold: Number.isFinite(stored?.brushImageSettings?.threshold) ? Math.max(0, Math.min(255, Math.round(stored!.brushImageSettings!.threshold))) : fallback.brushImageSettings.threshold,
      blackPoint: Number.isFinite(stored?.brushImageSettings?.blackPoint) ? Math.max(0, Math.min(254, Math.round(stored!.brushImageSettings!.blackPoint))) : fallback.brushImageSettings.blackPoint,
      whitePoint: Number.isFinite(stored?.brushImageSettings?.whitePoint) ? Math.max(1, Math.min(255, Math.round(stored!.brushImageSettings!.whitePoint))) : fallback.brushImageSettings.whitePoint,
      invert: stored?.brushImageSettings?.invert === true
    },
    proceduralBrushSettings,
    proceduralAntialias: stored?.proceduralAntialias === true,
    proceduralAntialiasStrength: Number.isFinite(stored?.proceduralAntialiasStrength) ? Math.max(1, Math.min(100, Math.round(stored!.proceduralAntialiasStrength!))) : fallback.proceduralAntialiasStrength
  }
}

export function loadToolSettings(storage?: Storage): PersistedToolSettings {
  try {
    const stored = readStoredJson<Partial<PersistedToolSettings> | null>(TOOL_SETTINGS_KEY, null, storage)
    if (!stored) return { ...defaultToolSettings, proceduralBrushSettings: createDefaultProceduralBrushSettings() }
    const legacyProfile = normalizePersistedBrushProfile(stored, defaultToolSettings)
    if (stored.brushPaintModePreferenceVersion !== 1) legacyProfile.brushPaintMode = defaultToolSettings.brushPaintMode
    if (stored.proceduralAntialiasPreferenceVersion !== 1) legacyProfile.proceduralAntialias = defaultToolSettings.proceduralAntialias
    const storedProfiles = stored.brushProfiles
    const brushProfiles = Object.fromEntries((['pencil', 'eraser', 'fill'] as BrushTool[]).map((tool) => [
      tool,
      normalizePersistedBrushProfile(storedProfiles?.[tool], legacyProfile)
    ])) as Record<BrushTool, PersistedBrushProfile>
    return {
      ...legacyProfile,
      brushPaintModePreferenceVersion: 1,
      proceduralAntialiasPreferenceVersion: 1,
      brushProfiles,
      shapeKind: stored.shapeKind === 'ellipse' || stored.shapeKind === 'rectangle' ? stored.shapeKind : defaultToolSettings.shapeKind,
      fillMode: stored.fillMode === 'global' || stored.fillMode === 'contiguous' ? stored.fillMode : defaultToolSettings.fillMode,
      moveAutoSelect: typeof stored.moveAutoSelect === 'boolean' ? stored.moveAutoSelect : defaultToolSettings.moveAutoSelect,
      selectionKind: stored.selectionKind === 'magic' || stored.selectionKind === 'lasso' || stored.selectionKind === 'ellipse' || stored.selectionKind === 'rectangle' ? stored.selectionKind : defaultToolSettings.selectionKind,
      selectionMode: stored.selectionMode === 'add' || stored.selectionMode === 'subtract' || stored.selectionMode === 'intersect' || stored.selectionMode === 'replace' ? stored.selectionMode : defaultToolSettings.selectionMode,
      wandTolerance: Number.isFinite(stored.wandTolerance) ? Math.max(0, Math.min(255, Math.round(stored.wandTolerance!))) : defaultToolSettings.wandTolerance,
      wandContiguous: typeof stored.wandContiguous === 'boolean' ? stored.wandContiguous : defaultToolSettings.wandContiguous,
      perfectPixels: typeof stored.perfectPixels === 'boolean' ? stored.perfectPixels : defaultToolSettings.perfectPixels
    }
  } catch {
    return { ...defaultToolSettings, proceduralBrushSettings: createDefaultProceduralBrushSettings() }
  }
}

export function saveToolSettings(snapshot: PersistedToolSettings, storage?: Storage): void {
  writeStoredJson(TOOL_SETTINGS_KEY, snapshot, storage)
}
