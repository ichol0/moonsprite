import type { ImageBrush, ProceduralBrushId, ProceduralBrushSettings, RgbaColor, SelectionMask, SpriteDocument, ToolId } from '@shared/types'
import { HistoryStack } from '@/core/history'
import { PROCEDURAL_BRUSH_IDS } from '@/core/brushes'
import { packColor, unpackColor } from '@/core/raster'
import {
  cloneProceduralSettings,
  defaultToolSettings,
  loadToolSettings,
  normalizePersistedBrushProfile,
  saveToolSettings,
  type BrushTool,
  type PersistedBrushProfile,
  type PersistedToolSettings
} from '@/core/tool-preferences'
import type { BrushProfile, DocumentSession } from './workspace-types'

const defaultColor: RgbaColor = { r: 41, g: 121, b: 255, a: 255 }
const defaultSecondary: RgbaColor = { r: 241, g: 244, b: 248, a: 255 }

export const isBrushTool = (tool: ToolId): tool is BrushTool => tool === 'pencil' || tool === 'eraser' || tool === 'fill'

export const brushProfileFromSession = (session: DocumentSession): BrushProfile => ({
  brushSize: session.brushSize,
  brushShape: session.brushShape,
  brushTexture: session.brushTexture,
  brushTextureScale: session.brushTextureScale,
  brushPaintMode: session.brushPaintMode,
  brushImageId: session.brushImageId,
  brushImage: session.brushImage,
  brushImageTemporary: session.brushImageTemporary,
  brushImageSettings: { ...session.brushImageSettings },
  proceduralBrushSettings: cloneProceduralSettings(session.proceduralBrushSettings),
  proceduralAntialias: session.proceduralAntialias,
  proceduralAntialiasStrength: session.proceduralAntialiasStrength
})

export const applyBrushProfile = (session: DocumentSession, profile: BrushProfile): void => {
  session.brushSize = profile.brushSize
  session.brushShape = profile.brushShape
  session.brushTexture = profile.brushTexture
  session.brushTextureScale = profile.brushTextureScale
  session.brushPaintMode = profile.brushPaintMode
  session.brushImageId = profile.brushImageId
  session.brushImage = profile.brushImage
  session.brushImageTemporary = profile.brushImageTemporary
  session.brushImageSettings = { ...profile.brushImageSettings }
  session.proceduralBrushSettings = cloneProceduralSettings(profile.proceduralBrushSettings)
  session.proceduralAntialias = profile.proceduralAntialias
  session.proceduralAntialiasStrength = profile.proceduralAntialiasStrength
}

export const remapSelectionBrushColors = (brush: ImageBrush, primary: RgbaColor, secondary: RgbaColor): ImageBrush => {
  if (!brush.intrinsicSize || !brush.colors || brush.colors.length !== brush.width * brush.height) return brush
  const paintColors = new Uint32Array(brush.colors.length)
  for (let index = 0; index < brush.colors.length; index += 1) {
    const source = unpackColor(brush.colors[index] ?? 0)
    if (source.a === 0) continue
    const luminance = (source.r * 2126 + source.g * 7152 + source.b * 722) / 10000
    const replacement = luminance >= 128 ? primary : secondary
    paintColors[index] = packColor({ ...replacement, a: Math.round(replacement.a * source.a / 255) })
  }
  return { ...brush, paintColors }
}

export const clearSelectionBrushPaintColors = (brush: ImageBrush | null): ImageBrush | null => brush ? { ...brush, paintColors: undefined } : null

export const rememberBrushProfile = (session: DocumentSession): void => {
  if (isBrushTool(session.tool)) session.brushProfiles[session.tool] = brushProfileFromSession(session)
}

let toolSettingsPersistTimer: number | null = null

function persistedBrushProfileFromSession(profile: BrushProfile): PersistedBrushProfile {
  return {
    brushSize: profile.brushSize,
    brushShape: profile.brushShape,
    brushTexture: profile.brushTexture,
    brushTextureScale: profile.brushTextureScale,
    brushPaintMode: profile.brushPaintMode,
    brushImageId: profile.brushImageTemporary ? null : profile.brushImageId,
    brushImageSettings: { ...profile.brushImageSettings },
    proceduralBrushSettings: cloneProceduralSettings(profile.proceduralBrushSettings),
    proceduralAntialias: profile.proceduralAntialias,
    proceduralAntialiasStrength: profile.proceduralAntialiasStrength
  }
}

function brushProfileFromPersisted(profile: PersistedBrushProfile): BrushProfile {
  return {
    ...profile,
    brushImage: null,
    brushImageTemporary: false,
    brushImageSettings: { ...profile.brushImageSettings },
    proceduralBrushSettings: cloneProceduralSettings(profile.proceduralBrushSettings)
  }
}

export function persistToolSettings(session: DocumentSession): void {
  const activeProfile = brushProfileFromSession(session)
  if (isBrushTool(session.tool)) session.brushProfiles[session.tool] = activeProfile
  const profiles = Object.fromEntries((['pencil', 'eraser', 'fill'] as BrushTool[]).map((tool) => [
    tool,
    persistedBrushProfileFromSession(session.brushProfiles[tool])
  ])) as Record<BrushTool, PersistedBrushProfile>
  const active = persistedBrushProfileFromSession(activeProfile)
  const snapshot: PersistedToolSettings = {
    ...active,
    brushPaintModePreferenceVersion: 1,
    proceduralAntialiasPreferenceVersion: 1,
    brushProfiles: profiles,
    shapeKind: session.shapeKind,
    fillMode: session.fillMode,
    moveAutoSelect: session.moveAutoSelect,
    selectionKind: session.selectionKind,
    selectionMode: session.selectionMode,
    wandTolerance: session.wandTolerance,
    wandContiguous: session.wandContiguous,
    perfectPixels: session.perfectPixels
  }
  try {
    if (toolSettingsPersistTimer !== null) window.clearTimeout(toolSettingsPersistTimer)
    toolSettingsPersistTimer = window.setTimeout(() => {
      saveToolSettings(snapshot)
      toolSettingsPersistTimer = null
    }, 100)
  } catch { /* Ignore unavailable renderer storage. */ }
}

export const sessionFromDocument = (document: SpriteDocument): DocumentSession => {
  const settings = loadToolSettings()
  const fallbackProfile = normalizePersistedBrushProfile(settings, defaultToolSettings)
  const persistedProfiles = settings.brushProfiles ?? Object.fromEntries((['pencil', 'eraser', 'fill'] as BrushTool[]).map((tool) => [tool, fallbackProfile])) as Record<BrushTool, PersistedBrushProfile>
  const brushProfiles = Object.fromEntries((['pencil', 'eraser', 'fill'] as BrushTool[]).map((tool) => [
    tool,
    brushProfileFromPersisted(persistedProfiles[tool] ?? fallbackProfile)
  ])) as Record<BrushTool, BrushProfile>
  const session = {
    document,
    history: new HistoryStack(),
    tool: 'pencil',
    primaryColor: document.palette.find((entry) => entry.id !== 0)?.color ?? defaultColor,
    secondaryColor: defaultSecondary,
    brushSize: settings.brushSize,
    brushShape: settings.brushShape,
    brushTexture: settings.brushTexture,
    brushTextureScale: settings.brushTextureScale,
    brushPaintMode: settings.brushPaintMode,
    brushImageId: settings.brushImageId,
    brushImage: null,
    brushImageTemporary: false,
    brushImageSettings: { ...settings.brushImageSettings },
    brushProfiles: {} as Record<BrushTool, BrushProfile>,
    proceduralBrushSettings: Object.fromEntries(PROCEDURAL_BRUSH_IDS.map((id) => [id, { ...settings.proceduralBrushSettings[id] }])) as Record<ProceduralBrushId, ProceduralBrushSettings>,
    proceduralAntialias: settings.proceduralAntialias,
    proceduralAntialiasStrength: settings.proceduralAntialiasStrength,
    shapeKind: settings.shapeKind,
    fillMode: settings.fillMode,
    moveAutoSelect: settings.moveAutoSelect,
    selection: null,
    selectionKind: settings.selectionKind,
    selectionMode: settings.selectionMode,
    wandTolerance: settings.wandTolerance,
    wandContiguous: settings.wandContiguous,
    perfectPixels: settings.perfectPixels,
    lastPencilPoint: null,
    lastEraserPoint: null,
    canvasResizePreview: null,
    outlinePreview: null,
    pendingPaste: null,
    view: { zoom: 16, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
    paletteSelectionId: document.palette.find((entry) => entry.id !== 0)?.id ?? document.palette[0]?.id ?? null,
    selectedPaletteIds: document.palette.find((entry) => entry.id !== 0)?.id !== undefined
      ? [document.palette.find((entry) => entry.id !== 0)!.id]
      : document.palette[0] ? [document.palette[0].id] : [],
    selectedGroupId: null,
    selectedLayerIds: [document.activeLayerId],
    collapsedGroupIds: [],
    revision: 0,
    recoverySuppressed: false
  } as DocumentSession
  applyBrushProfile(session, brushProfiles.pencil)
  session.brushProfiles = brushProfiles
  return session
}

export function touch(session: DocumentSession, dirty = true): void {
  if (dirty) {
    session.document.dirty = true
    session.document.updatedAt = new Date().toISOString()
    session.revision += 1
    session.recoverySuppressed = false
  }
}

export const cloneSelectionMask = (selection: SelectionMask | null): SelectionMask | null =>
  selection ? { ...selection, mask: selection.mask?.slice() } : null
