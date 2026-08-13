import type { ImageBrush, LayerMask, ProceduralBrushId, ProceduralBrushSettings, RasterLayer, RgbaColor, SelectionMask, SpriteDocument, ToolId } from '@shared/types'
import { HistoryStack, type ContentInvalidationHint } from '@/core/history'
import { PROCEDURAL_BRUSH_IDS } from '@/core/brushes'
import { packColor, unpackColor } from '@/core/raster'
import {
  cloneProceduralSettings,
  BRUSH_TOOLS,
  defaultToolSettings,
  loadToolSettings,
  normalizePersistedBrushProfile,
  saveToolSettings,
  type BrushTool,
  type PersistedBrushProfile,
  type PersistedToolSettings
} from '@/core/tool-preferences'
import type { BrushProfile, DocumentSession } from './workspace-types'
import { defaultSymmetryCenter } from '@/core/symmetry'
import { ensureAnimationDocument, refreshActiveAnimationFrame } from '@/core/animation'
import { normalizeProjectDisplaySettings, normalizeProjectStatistics, normalizeTimelapseSettings } from '@/core/project-metadata'
import { findLayerMask, getActiveLayer } from '@/core/document'
import { cloneBrushDynamicsSettings, normalizeBrushDynamicsSettings } from '@/core/pressure'
import { applyProjectLayerPanelState, loadLocalLayerPanelState, normalizeProjectLayerPanelState } from '@/core/layer-panel-state'

const defaultColor: RgbaColor = { r: 41, g: 121, b: 255, a: 255 }
const defaultSecondary: RgbaColor = { r: 241, g: 244, b: 248, a: 255 }

export const isBrushTool = (tool: ToolId): tool is BrushTool => BRUSH_TOOLS.includes(tool as BrushTool)

const TEXT_LAYER_ALLOWED_TOOLS = new Set<ToolId>(['text', 'move', 'eyedropper', 'hand', 'zoom', 'rotate'])

export const isToolAvailableForSession = (session: DocumentSession, tool: ToolId): boolean => {
  if (session.activeLayerMaskId || session.selectedGroupIds.length > 0) return true
  const textLayerSelected = session.selectedLayerIds.some((id) => session.document.layers.some((layer) => layer.id === id && layer.kind === 'text'))
  return !textLayerSelected || TEXT_LAYER_ALLOWED_TOOLS.has(tool)
}

export const activeLayerMask = (session: DocumentSession): LayerMask | null => session.activeLayerMaskId
  ? findLayerMask(session.document, session.activeLayerMaskId)
  : null

export const activePaintLayer = (session: DocumentSession): RasterLayer => activeLayerMask(session) ?? getActiveLayer(session.document)

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
  proceduralAntialiasStrength: session.proceduralAntialiasStrength,
  brushDynamics: cloneBrushDynamicsSettings(session.brushDynamics),
  brushPressure: { ...session.brushPressure }
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
  session.brushDynamics = cloneBrushDynamicsSettings(profile.brushDynamics)
  session.brushPressure = { ...profile.brushPressure }
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
    proceduralAntialiasStrength: profile.proceduralAntialiasStrength,
    brushDynamics: cloneBrushDynamicsSettings(profile.brushDynamics),
    brushPressure: { ...profile.brushPressure }
  }
}

function brushProfileFromPersisted(profile: PersistedBrushProfile): BrushProfile {
  return {
    ...profile,
    brushImage: null,
    brushImageTemporary: false,
    brushImageSettings: { ...profile.brushImageSettings },
    proceduralBrushSettings: cloneProceduralSettings(profile.proceduralBrushSettings),
    brushDynamics: normalizeBrushDynamicsSettings(profile.brushDynamics),
    brushPressure: { ...profile.brushPressure }
  }
}

export function persistToolSettings(session: DocumentSession): void {
  const activeProfile = brushProfileFromSession(session)
  if (isBrushTool(session.tool)) session.brushProfiles[session.tool] = activeProfile
  const profiles = Object.fromEntries(BRUSH_TOOLS.map((tool) => [
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
    lineKind: session.lineKind,
    curveAnchorCount: session.curveAnchorCount,
    shapeRatio: session.shapeRatio ? { ...session.shapeRatio } : null,
    fillMode: session.fillMode,
    fillKind: session.fillKind ?? 'bucket',
    fillTolerance: session.fillTolerance,
    gradientTolerance: session.gradientTolerance,
    gradientContiguous: session.gradientContiguous,
    gradientDither: session.gradientDither ?? 'none',
    moveAutoSelect: session.moveAutoSelect,
    selectionKind: session.selectionKind,
    selectionMode: session.selectionMode,
    wandTolerance: session.wandTolerance,
    wandContiguous: session.wandContiguous,
    perfectPixels: session.perfectPixels,
    airbrushParticleRadius: session.airbrushParticleRadius,
    airbrushParticleShape: session.airbrushParticleShape,
    airbrushScatterRadius: session.airbrushScatterRadius,
    airbrushDensity: session.airbrushDensity,
    airbrushIntervalMs: session.airbrushIntervalMs,
    symmetryAxes: { ...session.symmetryAxes }
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
  if (!document.layers.some((layer) => layer.id === document.activeLayerId)) {
    const fallbackLayerId = document.layers.at(-1)?.id
    if (fallbackLayerId) document.activeLayerId = fallbackLayerId
  }
  ensureAnimationDocument(document)
  refreshActiveAnimationFrame(document)
  document.displaySettings = normalizeProjectDisplaySettings(document.displaySettings)
  document.statistics = normalizeProjectStatistics(document.statistics)
  document.timelapse = normalizeTimelapseSettings(document.timelapse, document.timelapse?.snapshots ?? [])
  const layerPanelState = loadLocalLayerPanelState(document) ?? normalizeProjectLayerPanelState(document, document.layerPanelState)
  const settings = loadToolSettings()
  const fallbackProfile = normalizePersistedBrushProfile(settings, defaultToolSettings)
  const persistedProfiles = settings.brushProfiles ?? Object.fromEntries(BRUSH_TOOLS.map((tool) => [tool, fallbackProfile])) as Record<BrushTool, PersistedBrushProfile>
  const brushProfiles = Object.fromEntries(BRUSH_TOOLS.map((tool) => [
    tool,
    brushProfileFromPersisted(persistedProfiles[tool] ?? fallbackProfile)
  ])) as Record<BrushTool, BrushProfile>
  const session = {
    document,
    history: new HistoryStack(),
    tool: 'pencil',
    moveKind: 'move',
    selectedSliceId: null,
    selectedSliceIds: [],
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
    brushDynamics: normalizeBrushDynamicsSettings(settings.brushDynamics),
    brushPressure: { ...settings.brushPressure },
    shapeKind: settings.shapeKind,
    lineKind: settings.lineKind,
    curveAnchorCount: settings.curveAnchorCount,
    shapeRatio: typeof settings.shapeRatio === 'number' ? { width: settings.shapeRatio, height: 1 } : settings.shapeRatio ? { ...settings.shapeRatio } : null,
    fillMode: settings.fillMode,
    fillKind: settings.fillKind,
    fillTolerance: settings.fillTolerance,
    gradientTolerance: settings.gradientTolerance,
    gradientContiguous: settings.gradientContiguous,
    gradientDither: settings.gradientDither,
    moveAutoSelect: settings.moveAutoSelect,
    selection: null,
    selectionKind: settings.selectionKind,
    selectionMode: settings.selectionMode,
    wandTolerance: settings.wandTolerance,
    wandContiguous: settings.wandContiguous,
    perfectPixels: settings.perfectPixels,
    airbrushParticleRadius: settings.airbrushParticleRadius,
    airbrushParticleShape: settings.airbrushParticleShape,
    airbrushScatterRadius: settings.airbrushScatterRadius,
    airbrushDensity: settings.airbrushDensity,
    airbrushIntervalMs: settings.airbrushIntervalMs,
    symmetryAxes: { ...settings.symmetryAxes },
    symmetryCenter: defaultSymmetryCenter(document.width, document.height),
    lastPencilPoint: null,
    lastEraserPoint: null,
    canvasResizePreview: null,
    outlinePreview: null,
    pendingPaste: null,
    textBoxTransform: null,
    view: {
      zoom: 16,
      panX: 0,
      panY: 0,
      rotation: 0,
      mirrored: false,
      mirroredVertical: false,
      showPixelGrid: document.displaySettings.showPixelGrid,
      showGrid: document.displaySettings.showGrid,
      relativeLuminance: false,
      showSelectionOutline: true,
      grid: { ...document.displaySettings.grid }
    },
    viewportSize: { width: 0, height: 0 },
    paletteSelectionId: document.palette.find((entry) => entry.id !== 0)?.id ?? document.palette[0]?.id ?? null,
    paletteSecondarySelectionId: null,
    selectedPaletteIds: document.palette.find((entry) => entry.id !== 0)?.id !== undefined
      ? [document.palette.find((entry) => entry.id !== 0)!.id]
      : document.palette[0] ? [document.palette[0].id] : [],
    selectedGroupId: null,
    selectedGroupIds: [],
    selectedLayerIds: [document.activeLayerId],
    activeLayerMaskId: null,
    layerMaskIsolatedView: false,
    layerSelectionAnchorId: document.activeLayerId,
    collapsedGroupIds: [],
    animationPlaying: false,
    animationPlaybackRate: 1,
    animationPlaybackStartFrameId: null,
    animationReturnToStart: false,
    selectedAnimationFrameIds: [],
    animationFrameSelectionAnchorId: null,
    selectedAnimationCellKeys: [],
    animationCellSelectionAnchorKey: null,
    selectedAnimationMaskCellKeys: [],
    animationMaskCellSelectionAnchorKey: null,
    animationCellClipboard: [],
    animationCellClipboardAnchorKey: null,
    animationMaskClipboard: [],
    animationMaskClipboardAnchorKey: null,
    animationFrameClipboard: [],
    revision: 0,
    contentRevision: 0,
    layersPanelRevision: 0,
    contentInvalidation: null,
    recoverySuppressed: false
  } as DocumentSession
  applyBrushProfile(session, brushProfiles.pencil)
  session.brushProfiles = brushProfiles
  applyProjectLayerPanelState(session, layerPanelState)
  return session
}

export function touch(session: DocumentSession, dirty = true, invalidation: ContentInvalidationHint = { kind: 'full' }): void {
  if (dirty) {
    const fromRevision = session.contentRevision
    session.document.dirty = true
    session.document.updatedAt = new Date().toISOString()
    session.revision += 1
    session.contentRevision += 1
    if (invalidation.kind === 'full') session.layersPanelRevision += 1
    session.contentInvalidation = invalidation.kind === 'region'
      ? { ...invalidation, rect: { ...invalidation.rect }, fromRevision, revision: session.contentRevision }
      : { kind: 'full', fromRevision, revision: session.contentRevision }
    session.recoverySuppressed = false
  }
}

export function touchMetadata(session: DocumentSession): void {
  session.document.dirty = true
  session.document.updatedAt = new Date().toISOString()
  session.layersPanelRevision += 1
  session.recoverySuppressed = false
}

export const cloneSelectionMask = (selection: SelectionMask | null): SelectionMask | null =>
  selection ? { ...selection, mask: selection.mask?.slice() } : null
