import { create } from 'zustand'
import type { BlendMode, BrushPaintMode, BrushShape, BrushTexture, CanvasAnchor, ColorMode, FillMode, ImageBrush, ImageBrushSettings, ImageResizeInterpolation, OutlineDirections, OutlineKernel, OutlinePosition, ProceduralBrushId, ProceduralBrushSettings, RasterLayer, RecoveryRecord, RgbaColor, SelectionKind, SelectionMask, SelectionMode, SelectionRect, ShapeKind, SpriteDocument, ToolId, ViewState } from '@shared/types'
import { checkResourceLimit } from '@/core/resource-policy'
import { beginPixelEdit, commitPixelEdit, HistoryStack, recordPixel, revertPixelEdit, type HistoryEntry, type PixelEdit } from '@/core/history'
import { convertDocumentColorMode, createDocument, createId, createLayer, duplicateLayer, findOrAddPaletteColor, getDescendantGroupIds, getGroup, getLayerIdsInGroup, getLayer, getActiveLayer, isLayerEffectivelyLocked, isLayerEffectivelyVisible, layerContentBounds, readLayerColor, readLayerColorAt, resizeDocumentAt, resizeDocumentImage, writeLayerColor } from '@/core/document'
import { decodeProject, encodeProject } from '@/core/project-format'
import { fileNameFromPath } from '@/core/document-files'
import { createSelectionBrush } from '@/core/brushes'
import { applySelectionTransform, clampSelection, clearSelection, fillSelectionOrCanvas, flipLayer, flipSelection, moveSelection, outlineSelection, transformSelectionCopy, type SelectionTransformSource } from '@/core/tools'
import { colorEquals, packColor, pixelIndex, unpackColor } from '@/core/raster'
import { flipSelectionMask, selectionContains, shiftSelection } from '@/core/selection'
import { recordRecentProject } from '@/core/home-history'
import { createProceduralBrush, isProceduralBrushId, normalizeProceduralBrushSettings, PROCEDURAL_BRUSH_IDS } from '@/core/brushes'
import { mergeLayerDown, mergeLayerGroup, mergeRasterLayers, mergeVisibleLayers as mergeVisibleDocumentLayers, type LayerMergeSuccess } from '@/core/layer-merge'
import { applyColorAdjustment, type ColorAdjustment } from '@/core/adjustments'
import { assignGroupToGroup as assignGroupToGroupOperation, assignGroupToRoot as assignGroupToRootOperation, assignLayersAboveGroup as assignLayersAboveGroupOperation, assignLayersToGroup as assignLayersToGroupOperation, assignLayersToRoot as assignLayersToRootOperation, canMoveGroupInto, createLayerGroup as createLayerGroupOperation, reorderGroup as reorderGroupOperation, reorderLayers as reorderLayersOperation, ungroupSelected as ungroupSelectedOperation } from '@/core/layer-operations'
import { SAVE_FORMAT_PREFERENCE_KEY, saveImageKindForPreference } from '@/core/file-preferences'
import { cloneProceduralSettings, defaultToolSettings, loadToolSettings, normalizePersistedBrushProfile, saveToolSettings, type BrushTool, type PersistedBrushProfile, type PersistedToolSettings } from '@/core/tool-preferences'
import { readStoredString } from '@/core/storage'
import { exportDocumentFile, openDocumentFile, saveDocumentFile, type ExportOptions, type SaveAsOptions } from './document-file-service'
import { RecoveryService } from './recovery-service'
import { ClipboardService, selectionClipboardImage } from './clipboard-service'

export type { ExportOptions, SaveAsOptions } from './document-file-service'

export interface CanvasResizePreview {
  width: number
  height: number
  offsetX: number
  offsetY: number
}

export interface AdjustmentSnapshot {
  layerId: string
  pixels: Uint8ClampedArray | Uint32Array
  palette: SpriteDocument['palette']
  nextColorId: number
}

export interface OutlinePreview {
  color: RgbaColor
  thickness: number
  position: OutlinePosition
  directions: OutlineDirections
  kernel: OutlineKernel
}

export interface FloatingPaste {
  layerId: string
  beforeSelection: SelectionMask | null
  source: SelectionTransformSource
  target: SelectionMask
  previewEdit: PixelEdit
}

export interface DocumentSession {
  document: SpriteDocument
  history: HistoryStack
  tool: ToolId
  primaryColor: RgbaColor
  secondaryColor: RgbaColor
  brushSize: number
  brushShape: BrushShape
  brushTexture: BrushTexture
  brushTextureScale: number
  brushPaintMode: BrushPaintMode
  brushImageId: string | null
  brushImage: ImageBrush | null
  brushImageTemporary: boolean
  brushImageSettings: ImageBrushSettings
  brushProfiles: Record<BrushTool, BrushProfile>
  proceduralBrushSettings: Record<ProceduralBrushId, ProceduralBrushSettings>
  proceduralAntialias: boolean
  proceduralAntialiasStrength: number
  shapeKind: ShapeKind
  fillMode: FillMode
  moveAutoSelect: boolean
  selection: SelectionMask | null
  selectionKind: SelectionKind
  selectionMode: SelectionMode
  wandTolerance: number
  wandContiguous: boolean
  perfectPixels: boolean
  lastPencilPoint: { x: number; y: number } | null
  lastEraserPoint: { x: number; y: number } | null
  canvasResizePreview: CanvasResizePreview | null
  outlinePreview: OutlinePreview | null
  pendingPaste: FloatingPaste | null
  view: ViewState
  paletteSelectionId: number | null
  selectedPaletteIds: number[]
  selectedGroupId: string | null
  selectedLayerIds: string[]
  collapsedGroupIds: string[]
  revision: number
  recoverySuppressed: boolean
}

export interface DialogChoice { id: string; label: string; tone?: 'primary' | 'danger' | 'quiet' }
export interface AppDialog { title: string; message: string; detail?: string; choices: DialogChoice[]; resolve: (choice: string) => void }

interface WorkspaceState {
  sessions: DocumentSession[]
  activeId: string | null
  message: string | null
  saveProgress: { value: number; label: string } | null
  dialog: AppDialog | null
  recoveryRecords: RecoveryRecord[]
  newDocument(name: string, width: number, height: number, colorMode: ColorMode): Promise<void>
  addSession(document: SpriteDocument): void
  setActive(id: string): void
  setTool(tool: ToolId): void
  setBrushSize(size: number): void
  setBrushShape(shape: BrushShape): void
  setBrushTexture(texture: BrushTexture): void
  setBrushTextureScale(scale: number): void
  setBrushPaintMode(mode: BrushPaintMode): void
  setBrushImage(brush: ImageBrush | null): void
  setTemporaryBrush(brush: ImageBrush): void
  deleteProjectBrush(id: string): void
  createBrushFromSelection(): void
  setBrushImageSettings(settings: Partial<ImageBrushSettings>): void
  setProceduralBrushSettings(settings: Partial<ProceduralBrushSettings>): void
  setProceduralAntialias(enabled: boolean): void
  setProceduralAntialiasStrength(strength: number): void
  setShapeKind(kind: ShapeKind): void
  setFillMode(mode: FillMode): void
  setMoveAutoSelect(enabled: boolean): void
  setPrimaryColor(color: RgbaColor): void
  setSecondaryColor(color: RgbaColor): void
  setView(view: Partial<ViewState>): void
  setSelection(selection: SelectionMask | null): void
  beginLayerTransform(): void
  setSelectionKind(kind: SelectionKind): void
  commitSelectionChange(before: SelectionMask | null, after: SelectionMask | null, label: string): void
  setSelectionMode(mode: SelectionMode): void
  setWandTolerance(tolerance: number): void
  setWandContiguous(contiguous: boolean): void
  setPerfectPixels(enabled: boolean): void
  setLastPencilPoint(point: { x: number; y: number } | null): void
  setLastEraserPoint(point: { x: number; y: number } | null): void
  setCanvasResizePreview(preview: CanvasResizePreview | null): void
  toggleGrid(): void
  selectPaletteColor(id: number, additive?: boolean): void
  addPaletteColor(): void
  applyPalette(colors: RgbaColor[]): void
  deletePaletteColor(id: number): void
  deletePaletteColors(ids: number[]): void
  movePaletteColor(direction: -1 | 1): void
  reorderPaletteColors(ids: number[], targetId: number, insertAfter?: boolean): void
  mutateActive(mutator: (session: DocumentSession) => void, dirty?: boolean): void
  commitPixelEdit(edit: PixelEdit, label: string): void
  pushHistory(entry: HistoryEntry): void
  undo(): void
  redo(): void
  addLayer(): Promise<void>
  duplicateActiveLayer(): void
  duplicateLayers(layerIds: string[]): string[]
  deleteActiveLayer(): void
  mergeSelectedLayers(): void
  mergeActiveLayerDown(): void
  mergeSelectedGroup(): void
  mergeVisibleLayers(): void
  moveLayer(direction: -1 | 1): void
  moveLayerBy(layerId: string, deltaX: number, deltaY: number, label?: string): void
  reorderLayer(layerId: string, targetLayerId: string): void
  reorderLayers(layerIds: string[], targetLayerId: string, insertAfterTarget?: boolean): void
  assignLayerToGroup(layerId: string, groupId: string): void
  assignLayersToGroup(layerIds: string[], groupId: string, targetLayerId?: string, insertAfterTarget?: boolean): void
  assignLayersToRoot(layerIds: string[], targetLayerId?: string, insertAfterTarget?: boolean): void
  assignLayersAboveGroup(layerIds: string[], groupId: string): void
  reorderGroup(groupId: string, targetGroupId: string, insertAfterTarget?: boolean): void
  assignGroupToGroup(groupId: string, parentGroupId: string): void
  assignGroupToRoot(groupId: string): void
  createLayerGroup(): void
  ungroupSelected(): void
  selectGroup(groupId: string): void
  toggleGroupCollapsed(groupId: string): void
  toggleGroupVisibility(groupId: string): void
  setGroupProperties(groupId: string, name: string, opacity: number, blendMode: BlendMode, locked: boolean): void
  toggleLayerVisibility(layerId: string): void
  selectLayer(layerId: string, additive?: boolean): void
  renameLayer(layerId: string, name: string): void
  setLayerOpacity(layerId: string, opacity: number): void
  setLayerProperties(layerId: string, name: string, opacity: number): void
  setLayerPropertiesWithBlend(layerId: string, name: string, opacity: number, blendMode: BlendMode, locked?: boolean): void
  applyActiveLayerAdjustment(adjustment: ColorAdjustment): void
  captureActiveLayerAdjustmentSnapshot(): AdjustmentSnapshot | null
  previewActiveLayerAdjustment(adjustment: ColorAdjustment, baseline: AdjustmentSnapshot): void
  restoreActiveDocumentSnapshot(snapshot: AdjustmentSnapshot): void
  applyActiveLayerAdjustmentFromSnapshot(adjustment: ColorAdjustment, baseline: AdjustmentSnapshot): void
  deleteSelection(): void
  fillForeground(): void
  setOutlinePreview(preview: OutlinePreview | null): void
  outlineActiveSelection(color: RgbaColor, thickness: number, position: OutlinePosition, directions?: OutlineDirections, kernel?: OutlineKernel): boolean
  copySelection(): void
  copyActiveLayerToClipboard(): void
  cutSelection(): void
  pasteSelection(): Promise<void>
  pasteLayerFromClipboard(): boolean
  commitFloatingPaste(): void
  cancelFloatingPaste(): void
  updateFloatingPastePreview(edit: PixelEdit, target: SelectionMask): void
  moveActiveSelection(deltaX: number, deltaY: number): void
  moveActiveSelectionWithSelectionHistory(deltaX: number, deltaY: number): void
  flipActiveSelection(axis: 'horizontal' | 'vertical'): void
  transformActiveSelection(before: SelectionMask, after: SelectionMask, angle?: number): void
  commitSelectionTransform(edit: PixelEdit | null, before: SelectionMask, after: SelectionMask, label: string): void
  resizeActiveCanvas(width: number, height: number, anchor: CanvasAnchor, offsetX?: number, offsetY?: number, trimOutside?: boolean): Promise<void>
  resizeActiveImage(width: number, height: number, interpolation: ImageResizeInterpolation): Promise<void>
  convertColorMode(mode: ColorMode): Promise<void>
  saveActive(saveAs?: boolean, options?: SaveAsOptions): Promise<boolean>
  exportActive(options?: ExportOptions): Promise<boolean>
  openFiles(): Promise<void>
  openPath(filePath: string, options?: { duplicate?: boolean }): Promise<boolean>
  closeDocument(id: string): Promise<void>
  restoreRecoveries(): Promise<void>
  restoreRecovery(id: string): Promise<boolean>
  autosaveDirty(): Promise<void>
  discardRecovery(id: string): Promise<void>
  dismissSaveProgress(): void
  setMessage(message: string | null): void
  requestDialog(options: Omit<AppDialog, 'resolve'>): Promise<string>
  resolveDialog(choice: string): void
}

const defaultColor: RgbaColor = { r: 41, g: 121, b: 255, a: 255 }
const defaultSecondary: RgbaColor = { r: 241, g: 244, b: 248, a: 255 }
interface BrushProfile {
  brushSize: number
  brushShape: BrushShape
  brushTexture: BrushTexture
  brushTextureScale: number
  brushPaintMode: BrushPaintMode
  brushImageId: string | null
  brushImage: ImageBrush | null
  brushImageTemporary: boolean
  brushImageSettings: ImageBrushSettings
  proceduralBrushSettings: Record<ProceduralBrushId, ProceduralBrushSettings>
  proceduralAntialias: boolean
  proceduralAntialiasStrength: number
}

const isBrushTool = (tool: ToolId): tool is BrushTool => tool === 'pencil' || tool === 'eraser' || tool === 'fill'

const brushProfileFromSession = (session: DocumentSession): BrushProfile => ({
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

const applyBrushProfile = (session: DocumentSession, profile: BrushProfile): void => {
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

const remapSelectionBrushColors = (brush: ImageBrush, primary: RgbaColor, secondary: RgbaColor): ImageBrush => {
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

const clearSelectionBrushPaintColors = (brush: ImageBrush | null): ImageBrush | null => brush ? { ...brush, paintColors: undefined } : null

const rememberBrushProfile = (session: DocumentSession): void => {
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

function persistToolSettings(session: DocumentSession): void {
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

const sessionFromDocument = (document: SpriteDocument): DocumentSession => {
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

function touch(session: DocumentSession, dirty = true): void {
  if (dirty) {
    session.document.dirty = true
    session.document.updatedAt = new Date().toISOString()
    session.revision += 1
    session.recoverySuppressed = false
  }
}

function activeSession(state: WorkspaceState): DocumentSession | null {
  return state.sessions.find((session) => session.document.id === state.activeId) ?? null
}

function captureAdjustmentSnapshot(session: DocumentSession): AdjustmentSnapshot {
  const layer = getActiveLayer(session.document)
  return {
    layerId: layer.id,
    pixels: layer.format === 'rgba' ? new Uint8ClampedArray(layer.pixels) : new Uint32Array(layer.pixels),
    palette: session.document.palette.map((entry) => ({ ...entry, color: { ...entry.color } })),
    nextColorId: session.document.nextColorId
  }
}

function restoreAdjustmentSnapshot(session: DocumentSession, snapshot: AdjustmentSnapshot): void {
  const layer = getLayer(session.document, snapshot.layerId)
  if (layer.format === 'rgba' && snapshot.pixels instanceof Uint8ClampedArray) layer.pixels = new Uint8ClampedArray(snapshot.pixels)
  else if (layer.format === 'indexed' && snapshot.pixels instanceof Uint32Array) layer.pixels = new Uint32Array(snapshot.pixels)
  else throw new Error('调整预览的图层格式已发生变化。')
  session.document.palette = snapshot.palette.map((entry) => ({ ...entry, color: { ...entry.color } }))
  session.document.nextColorId = snapshot.nextColorId
}

function restoreDocumentSnapshot(target: SpriteDocument, data: Uint8Array): void {
  const restored = decodeProject(data)
  restored.id = target.id
  restored.filePath = target.filePath
  restored.dirty = true
  Object.assign(target, restored)
}

interface LayerUiSnapshot {
  selectedLayerIds: string[]
  selectedGroupId: string | null
  collapsedGroupIds: string[]
}

const captureLayerUi = (session: DocumentSession): LayerUiSnapshot => ({
  selectedLayerIds: [...session.selectedLayerIds],
  selectedGroupId: session.selectedGroupId,
  collapsedGroupIds: [...session.collapsedGroupIds]
})

const restoreLayerUi = (session: DocumentSession, snapshot: LayerUiSnapshot): void => {
  session.selectedLayerIds = [...snapshot.selectedLayerIds]
  session.selectedGroupId = snapshot.selectedGroupId
  session.collapsedGroupIds = [...snapshot.collapsedGroupIds]
}

function commitLayerMerge(session: DocumentSession, beforeDocument: Uint8Array, beforeUi: LayerUiSnapshot, result: LayerMergeSuccess, label: string): void {
  session.selectedGroupId = null
  session.selectedLayerIds = [result.layerId]
  session.collapsedGroupIds = session.collapsedGroupIds.filter((id) => !result.removedGroupIds.includes(id))
  touch(session)
  const afterDocument = encodeProject(session.document)
  const afterUi = captureLayerUi(session)
  session.history.push({
    label,
    bytes: beforeDocument.byteLength + afterDocument.byteLength,
    undo: () => { restoreDocumentSnapshot(session.document, beforeDocument); restoreLayerUi(session, beforeUi) },
    redo: () => { restoreDocumentSnapshot(session.document, afterDocument); restoreLayerUi(session, afterUi) }
  })
}

const recoveryService = new RecoveryService()
const clipboardService = new ClipboardService()

const cloneSelectionMask = (selection: SelectionMask | null): SelectionMask | null =>
  selection ? { ...selection, mask: selection.mask?.slice() } : null

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  sessions: [],
  activeId: null,
  message: null,
  saveProgress: null,
  dialog: null,
  recoveryRecords: [],

  async newDocument(name, width, height, colorMode) {
    try {
      const resource = await window.moonSprite.getResourceInfo()
      const check = checkResourceLimit(width, height, 1, colorMode, resource)
      if (!check.allowed) throw new Error(check.reason)
      get().addSession(createDocument(name || '未命名作品', width, height, colorMode))
    } catch (error) {
      set({ message: error instanceof Error ? error.message : '无法创建画布。' })
    }
  },

  async resizeActiveCanvas(width, height, anchor, offsetX, offsetY, trimOutside = false) {
    const current = activeSession(get())
    if (!current || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) { set({ message: '画布尺寸必须为正整数。' }); return }
    try {
      const resource = await window.moonSprite.getResourceInfo()
      const check = checkResourceLimit(width, height, current.document.layers.length, current.document.colorMode, resource)
      if (!check.allowed) throw new Error(check.reason)
      get().mutateActive((session) => {
        const before = encodeProject(session.document)
        const beforeSelection = session.selection ? { ...session.selection, mask: session.selection.mask?.slice() } : null
        const horizontal = offsetX ?? (anchor === 'nw' || anchor === 'w' || anchor === 'sw' ? 0 : anchor === 'ne' || anchor === 'e' || anchor === 'se' ? width - session.document.width : Math.floor((width - session.document.width) / 2))
        const vertical = offsetY ?? (anchor === 'nw' || anchor === 'n' || anchor === 'ne' ? 0 : anchor === 'sw' || anchor === 's' || anchor === 'se' ? height - session.document.height : Math.floor((height - session.document.height) / 2))
        const resized = resizeDocumentAt(session.document, width, height, horizontal, vertical, trimOutside)
        session.selection = shiftSelection(beforeSelection, resized.offsetX, resized.offsetY, width, height)
        const after = encodeProject(session.document)
        const afterSelection = session.selection ? { ...session.selection, mask: session.selection.mask?.slice() } : null
        session.history.push({
          label: '调整画布尺寸', bytes: before.byteLength + after.byteLength + (beforeSelection?.mask?.byteLength ?? 0) + (afterSelection?.mask?.byteLength ?? 0),
          undo: () => { restoreDocumentSnapshot(session.document, before); session.selection = beforeSelection ? { ...beforeSelection, mask: beforeSelection.mask?.slice() } : null },
          redo: () => { restoreDocumentSnapshot(session.document, after); session.selection = afterSelection ? { ...afterSelection, mask: afterSelection.mask?.slice() } : null }
        })
      })
    } catch (error) {
      set({ message: error instanceof Error ? error.message : '无法调整画布尺寸。' })
    }
  },

  async resizeActiveImage(width, height, interpolation) {
    const current = activeSession(get())
    if (!current || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) { set({ message: '图像尺寸必须为正整数。' }); return }
    try {
      const resource = await window.moonSprite.getResourceInfo()
      const check = checkResourceLimit(width, height, current.document.layers.length, current.document.colorMode, resource)
      if (!check.allowed) throw new Error(check.reason)
      get().mutateActive((session) => {
        const before = encodeProject(session.document)
        const beforeSelection = session.selection ? { ...session.selection, mask: session.selection.mask?.slice() } : null
        const sourceWidth = session.document.width
        const sourceHeight = session.document.height
        const scaleX = width / sourceWidth
        const scaleY = height / sourceHeight
        resizeDocumentImage(session.document, width, height, interpolation)
        if (beforeSelection) {
          const nextX = Math.floor(beforeSelection.x * scaleX)
          const nextY = Math.floor(beforeSelection.y * scaleY)
          const nextWidth = Math.max(1, Math.ceil((beforeSelection.x + beforeSelection.width) * scaleX) - nextX)
          const nextHeight = Math.max(1, Math.ceil((beforeSelection.y + beforeSelection.height) * scaleY) - nextY)
          const mask = beforeSelection.mask ? new Uint8Array(nextWidth * nextHeight) : undefined
          if (mask && beforeSelection.mask) for (let y = 0; y < nextHeight; y += 1) for (let x = 0; x < nextWidth; x += 1) {
            const sourceX = Math.floor((nextX + x + 0.5) / scaleX)
            const sourceY = Math.floor((nextY + y + 0.5) / scaleY)
            const localX = sourceX - beforeSelection.x
            const localY = sourceY - beforeSelection.y
            if (localX >= 0 && localY >= 0 && localX < beforeSelection.width && localY < beforeSelection.height && beforeSelection.mask[localY * beforeSelection.width + localX]) mask[y * nextWidth + x] = 1
          }
          session.selection = { x: nextX, y: nextY, width: nextWidth, height: nextHeight, mask }
        }
        const after = encodeProject(session.document)
        const afterSelection = session.selection ? { ...session.selection, mask: session.selection.mask?.slice() } : null
        session.history.push({
          label: '调整图像尺寸', bytes: before.byteLength + after.byteLength + (beforeSelection?.mask?.byteLength ?? 0) + (afterSelection?.mask?.byteLength ?? 0),
          undo: () => { restoreDocumentSnapshot(session.document, before); session.selection = beforeSelection ? { ...beforeSelection, mask: beforeSelection.mask?.slice() } : null },
          redo: () => { restoreDocumentSnapshot(session.document, after); session.selection = afterSelection ? { ...afterSelection, mask: afterSelection.mask?.slice() } : null }
        })
      })
    } catch (error) {
      set({ message: error instanceof Error ? error.message : '无法调整图像尺寸。' })
    }
  },

  addSession(document) {
    const existing = get().sessions.find((session) => session.document.id === document.id)
    if (existing) return
    const session = sessionFromDocument(document)
    set((state) => ({ sessions: [...state.sessions, session], activeId: document.id, message: null }))
  },

  setActive(id) { get().commitFloatingPaste(); set({ activeId: id }) },
  setTool(tool) {
    get().commitFloatingPaste()
    get().mutateActive((session) => {
      if (session.tool === tool) return
      if (isBrushTool(session.tool)) rememberBrushProfile(session)
      session.tool = tool
      if (isBrushTool(tool)) applyBrushProfile(session, session.brushProfiles[tool])
    }, false)
  },
  setBrushSize(size) { get().mutateActive((session) => { if (session.brushImage?.intrinsicSize) return; session.brushSize = Math.max(1, Math.min(128, Math.round(size))); rememberBrushProfile(session); persistToolSettings(session) }, false) },
  setBrushShape(shape) { get().mutateActive((session) => { session.brushShape = shape; rememberBrushProfile(session); persistToolSettings(session) }, false) },
  setBrushTexture(texture) { get().mutateActive((session) => { session.brushTexture = texture; rememberBrushProfile(session); persistToolSettings(session) }, false) },
  setBrushTextureScale(scale) { get().mutateActive((session) => { session.brushTextureScale = Math.max(1, Math.min(16, Math.round(scale))); rememberBrushProfile(session); persistToolSettings(session) }, false) },
  setBrushPaintMode(mode) { get().mutateActive((session) => { session.brushPaintMode = mode; rememberBrushProfile(session); persistToolSettings(session) }, false) },
  setBrushImage(brush) {
    get().mutateActive((session) => {
      session.brushImage = brush && isProceduralBrushId(brush.id)
        ? createProceduralBrush(brush.id, session.proceduralBrushSettings[brush.id])
        : clearSelectionBrushPaintColors(brush)
      session.brushImageId = brush?.id ?? null
      session.brushImageTemporary = false
      rememberBrushProfile(session)
      persistToolSettings(session)
    }, false)
  },
  setTemporaryBrush(brush) {
    get().mutateActive((session) => {
      session.brushImage = { ...brush, colors: brush.colors?.slice(), paintColors: undefined }
      session.brushImageId = brush.id
      session.brushImageTemporary = true
      session.brushPaintMode = 'pattern-source'
      session.selection = null
      session.tool = 'pencil'
      session.document.customBrushes = [...(session.document.customBrushes ?? []).filter((item) => item.id !== brush.id), { id: brush.id, name: brush.name, width: brush.width, height: brush.height, coverage: brush.coverage.slice(), colors: brush.colors?.slice(), sourceX: brush.sourceX, sourceY: brush.sourceY }]
      session.brushImageTemporary = false
      session.brushProfiles.pencil = brushProfileFromSession(session)
      persistToolSettings(session)
    })
  },
  deleteProjectBrush(id) {
    get().mutateActive((session) => {
      const before = session.document.customBrushes ?? []
      if (!before.some((brush) => brush.id === id)) return
      session.document.customBrushes = before.filter((brush) => brush.id !== id)
      if (session.brushImageId === id) {
        session.brushImageId = null
        session.brushImage = null
      }
      rememberBrushProfile(session)
    })
  },
  createBrushFromSelection() {
    get().commitFloatingPaste()
    const session = activeSession(get())
    if (!session?.selection) { set({ message: '请先创建选区。' }); return }
    const brush = createSelectionBrush(session.document, session.selection, `project-brush-${createId('brush')}`, '自定义笔刷')
    if (!brush) { set({ message: '选区内没有可用的非透明像素。' }); return }
    get().setTemporaryBrush(brush)
    set({ message: '已将选区保存为当前工程中的自定义笔刷。' })
  },
  setBrushImageSettings(settings) {
    get().mutateActive((session) => {
      const next = { ...session.brushImageSettings, ...settings }
      next.threshold = Math.max(0, Math.min(255, Math.round(next.threshold)))
      next.blackPoint = Math.max(0, Math.min(254, Math.round(next.blackPoint)))
      next.whitePoint = Math.max(next.blackPoint + 1, Math.min(255, Math.round(next.whitePoint)))
      session.brushImageSettings = next
      rememberBrushProfile(session)
      persistToolSettings(session)
    }, false)
  },
  setProceduralBrushSettings(settings) {
    get().mutateActive((session) => {
      const brushId = session.brushImage?.id
      if (!brushId || !isProceduralBrushId(brushId)) return
      const next = normalizeProceduralBrushSettings(brushId, { ...session.proceduralBrushSettings[brushId], ...settings })
      session.proceduralBrushSettings = { ...session.proceduralBrushSettings, [brushId]: next }
      session.brushImage = createProceduralBrush(brushId, next)
      rememberBrushProfile(session)
      persistToolSettings(session)
    }, false)
  },
  setProceduralAntialias(enabled) { get().mutateActive((session) => { session.proceduralAntialias = enabled; rememberBrushProfile(session); persistToolSettings(session) }, false) },
  setProceduralAntialiasStrength(strength) { get().mutateActive((session) => { session.proceduralAntialiasStrength = Math.max(1, Math.min(100, Math.round(strength))); rememberBrushProfile(session); persistToolSettings(session) }, false) },
  setShapeKind(kind) { get().mutateActive((session) => { session.shapeKind = kind; persistToolSettings(session) }, false) },
  setFillMode(mode) {
    get().mutateActive((session) => {
      session.fillMode = mode === 'contiguous' && session.fillMode === 'contiguous' ? 'global' : mode
      persistToolSettings(session)
    }, false)
  },
  setMoveAutoSelect(enabled) { get().mutateActive((session) => { session.moveAutoSelect = enabled; persistToolSettings(session) }, false) },
  setPrimaryColor(color) {
    get().mutateActive((session) => {
      session.primaryColor = { ...color }
      if (session.brushImage?.intrinsicSize) session.brushImage = remapSelectionBrushColors(session.brushImage, session.primaryColor, session.secondaryColor)
      const matching = session.document.palette.find((entry) => session.document.paletteOrder.includes(entry.id) && colorEquals(entry.color, color))
      session.paletteSelectionId = matching?.id ?? null
      session.selectedPaletteIds = matching ? [matching.id] : []
    }, false)
  },
  setSecondaryColor(color) { get().mutateActive((session) => { session.secondaryColor = { ...color }; if (session.brushImage?.intrinsicSize) session.brushImage = remapSelectionBrushColors(session.brushImage, session.primaryColor, session.secondaryColor) }, false) },
  setView(view) { get().mutateActive((session) => { Object.assign(session.view, view) }, false) },
  setSelection(selection) { get().mutateActive((session) => { session.selection = selection ? { ...selection, mask: selection.mask?.slice() } : null }, false) },
  beginLayerTransform() {
    get().commitFloatingPaste()
    const session = activeSession(get())
    if (!session) return
    if (session.selectedGroupId || session.selectedLayerIds.length !== 1) {
      set({ message: '请选择一个图层后再使用变换。' })
      return
    }
    const layer = session.document.layers.find((candidate) => candidate.id === session.selectedLayerIds[0])
    if (!layer) {
      set({ message: '当前没有可变换的图层。' })
      return
    }
    if (!isLayerEffectivelyVisible(session.document, layer)) {
      set({ message: '隐藏的图层无法变换。' })
      return
    }
    if (isLayerEffectivelyLocked(session.document, layer)) {
      set({ message: '锁定的图层无法变换。' })
      return
    }
    const contentBounds = layerContentBounds(session.document, layer)
    if (!contentBounds) {
      set({ message: '当前图层没有可变换的内容。' })
      return
    }
    const visibleBounds = clampSelection(session.document, contentBounds)
    if (!visibleBounds) {
      set({ message: '当前图层的内容位于画布外，请先使用移动工具将其移回画布。' })
      return
    }
    get().setTool('selection')
    get().mutateActive((active) => {
      active.document.activeLayerId = layer.id
      active.selectedGroupId = null
      active.selectedLayerIds = [layer.id]
      active.selection = visibleBounds
      active.selectionKind = 'rectangle'
      active.selectionMode = 'replace'
    }, false)
    set({ message: '已进入变换，可拖动选区或使用边缘手柄缩放、旋转。' })
  },
  setSelectionKind(kind) { get().mutateActive((session) => { session.selectionKind = kind; persistToolSettings(session) }, false) },
  setSelectionMode(mode) { get().mutateActive((session) => { session.selectionMode = mode; persistToolSettings(session) }, false) },
  setWandTolerance(tolerance) { get().mutateActive((session) => { session.wandTolerance = Math.max(0, Math.min(255, Math.round(tolerance) || 0)); persistToolSettings(session) }, false) },
  setWandContiguous(contiguous) { get().mutateActive((session) => { session.wandContiguous = contiguous; persistToolSettings(session) }, false) },
  setPerfectPixels(enabled) { get().mutateActive((session) => { session.perfectPixels = enabled; persistToolSettings(session) }, false) },
  setLastPencilPoint(point) { get().mutateActive((session) => { session.lastPencilPoint = point ? { ...point } : null }, false) },
  setLastEraserPoint(point) { get().mutateActive((session) => { session.lastEraserPoint = point ? { ...point } : null }, false) },
  setCanvasResizePreview(preview) {
    const session = activeSession(get())
    const current = session?.canvasResizePreview
    if (current?.width === preview?.width && current?.height === preview?.height && current?.offsetX === preview?.offsetX && current?.offsetY === preview?.offsetY) return
    get().mutateActive((active) => { active.canvasResizePreview = preview ? { ...preview } : null }, false)
  },
  setOutlinePreview(preview) {
    get().mutateActive((session) => { session.outlinePreview = preview ? { ...preview, color: { ...preview.color }, directions: { ...preview.directions } } : null }, false)
  },
  commitSelectionChange(before, after, label) {
    const sameMask = before?.mask === after?.mask || (before?.mask?.length === after?.mask?.length && before?.mask?.every((value, index) => value === after?.mask?.[index]))
    const same = before?.x === after?.x && before?.y === after?.y && before?.width === after?.width && before?.height === after?.height && sameMask
    if (same || (!before && !after)) return
    get().mutateActive((session) => {
      const clone = (value: SelectionMask | null): SelectionMask | null => value ? { ...value, mask: value.mask?.slice() } : null
      session.selection = clone(after)
      session.history.push({ label, bytes: 48 + (before?.mask?.byteLength ?? 0) + (after?.mask?.byteLength ?? 0), undo: () => { session.selection = clone(before) }, redo: () => { session.selection = clone(after) } })
    }, false)
  },
  toggleGrid() { get().mutateActive((session) => { session.view.showGrid = !session.view.showGrid }, false) },
  selectPaletteColor(id, additive = false) {
    get().mutateActive((session) => {
      const entry = session.document.palette.find((candidate) => candidate.id === id)
      if (!entry) return
      if (!additive) session.selectedPaletteIds = [id]
      else if (session.selectedPaletteIds.includes(id)) session.selectedPaletteIds = session.selectedPaletteIds.filter((entryId) => entryId !== id)
      else session.selectedPaletteIds = [...session.selectedPaletteIds, id]
      session.paletteSelectionId = session.selectedPaletteIds.includes(id) ? id : session.selectedPaletteIds.at(-1) ?? null
      const active = session.document.palette.find((candidate) => candidate.id === session.paletteSelectionId)
      if (active) {
        session.primaryColor = { ...active.color }
        if (session.brushImage?.intrinsicSize) session.brushImage = remapSelectionBrushColors(session.brushImage, session.primaryColor, session.secondaryColor)
      }
    }, false)
  },
  addPaletteColor() {
    get().mutateActive((session) => {
      const id = findOrAddPaletteColor(session.document, session.primaryColor, true)
      session.paletteSelectionId = id
      session.selectedPaletteIds = [id]
    })
  },
  applyPalette(colors) {
    get().mutateActive((session) => {
      const document = session.document
      const beforeOrder = [...document.paletteOrder]
      const beforeSelected = [...session.selectedPaletteIds]
      const beforePrimary = session.paletteSelectionId
      const colorIds = colors.map((color) => findOrAddPaletteColor(document, color, false))
      const afterOrder = [...new Set(document.colorMode === 'indexed' ? [0, ...colorIds] : colorIds)]
      if (afterOrder.length === beforeOrder.length && afterOrder.every((id, index) => id === beforeOrder[index])) return
      const matchingCurrent = afterOrder.find((id) => {
        const entry = document.palette.find((candidate) => candidate.id === id)
        return Boolean(entry && colorEquals(entry.color, session.primaryColor))
      })
      const afterSelected = matchingCurrent === undefined ? [] : [matchingCurrent]
      const afterPrimary = matchingCurrent ?? null
      const apply = (order: number[], selected: number[], primary: number | null): void => {
        document.paletteOrder = [...order]
        session.selectedPaletteIds = [...selected]
        session.paletteSelectionId = primary
      }
      apply(afterOrder, afterSelected, afterPrimary)
      session.history.push({
        label: '切换调色板',
        bytes: (beforeOrder.length + afterOrder.length + beforeSelected.length + afterSelected.length) * 4 + 32,
        undo: () => apply(beforeOrder, beforeSelected, beforePrimary),
        redo: () => apply(afterOrder, afterSelected, afterPrimary)
      })
    })
  },
  deletePaletteColor(id) {
    get().deletePaletteColors([id])
  },
  deletePaletteColors(ids) {
    get().mutateActive((session) => {
      const document = session.document
      const removed = new Set(ids.filter((id) => document.paletteOrder.includes(id)))
      if (removed.size === 0) return
      const beforeOrder = [...document.paletteOrder]
      const afterOrder = beforeOrder.filter((id) => !removed.has(id))
      const beforeSelected = [...session.selectedPaletteIds]
      const beforePrimary = session.paletteSelectionId
      const afterSelected = beforeSelected.filter((id) => !removed.has(id))
      const afterPrimary = afterSelected.includes(beforePrimary ?? -1) ? beforePrimary : afterSelected.at(-1) ?? null
      document.paletteOrder = afterOrder
      session.selectedPaletteIds = afterSelected
      session.paletteSelectionId = afterPrimary
      session.history.push({
        label: removed.size > 1 ? '批量移除调色板颜色' : '从调色板移除颜色',
        bytes: (beforeOrder.length + afterOrder.length + beforeSelected.length + afterSelected.length) * 4 + 32,
        undo: () => { document.paletteOrder = [...beforeOrder]; session.selectedPaletteIds = [...beforeSelected]; session.paletteSelectionId = beforePrimary },
        redo: () => { document.paletteOrder = [...afterOrder]; session.selectedPaletteIds = [...afterSelected]; session.paletteSelectionId = afterPrimary }
      })
    })
  },
  movePaletteColor(direction) {
    get().mutateActive((session) => {
      const document = session.document
      const order = session.document.paletteOrder
      const currentIndex = order.indexOf(session.paletteSelectionId ?? -1)
      const targetIndex = currentIndex + direction
      if (currentIndex < 0 || targetIndex < 0 || targetIndex >= order.length) return
      ;[order[currentIndex], order[targetIndex]] = [order[targetIndex], order[currentIndex]]
      const swap = (): void => { ;[document.paletteOrder[currentIndex], document.paletteOrder[targetIndex]] = [document.paletteOrder[targetIndex], document.paletteOrder[currentIndex]] }
      session.history.push({ label: '调整调色板顺序', bytes: 16, undo: swap, redo: swap })
    })
  },
  reorderPaletteColors(ids, targetId, insertAfter = false) {
    get().mutateActive((session) => {
      const document = session.document
      const selected = new Set(ids.filter((id) => document.paletteOrder.includes(id)))
      if (selected.size === 0 || selected.has(targetId)) return
      const before = [...document.paletteOrder]
      const moving = before.filter((id) => selected.has(id))
      const remaining = before.filter((id) => !selected.has(id))
      const targetIndex = remaining.indexOf(targetId)
      if (targetIndex < 0) return
      remaining.splice(targetIndex + (insertAfter ? 1 : 0), 0, ...moving)
      if (remaining.every((id, index) => id === before[index])) return
      const after = [...remaining]
      document.paletteOrder = after
      session.history.push({
        label: moving.length > 1 ? '批量调整调色板顺序' : '调整调色板顺序',
        bytes: (before.length + after.length) * 4,
        undo: () => { document.paletteOrder = [...before] },
        redo: () => { document.paletteOrder = [...after] }
      })
    })
  },

  mutateActive(mutator, dirty = true) {
    const state = get()
    const session = activeSession(state)
    if (!session) return
    mutator(session)
    touch(session, dirty)
    set({ sessions: [...state.sessions] })
  },

  commitPixelEdit(edit, label) {
    get().mutateActive((session) => {
      const entry = commitPixelEdit(session.document, edit, label)
      if (entry) {
        session.history.push(entry)
        touch(session)
      }
    }, false)
  },

  pushHistory(entry) {
    get().mutateActive((session) => session.history.push(entry))
  },

  undo() {
    const session = activeSession(get())
    if (session?.pendingPaste) { get().cancelFloatingPaste(); return }
    if (!session?.history.canUndo) return
    get().mutateActive((session) => {
      const view = { ...session.view }
      session.history.undo()
      Object.assign(session.view, view)
    })
  },

  redo() {
    const session = activeSession(get())
    if (!session?.history.canRedo) return
    get().mutateActive((session) => {
      const view = { ...session.view }
      session.history.redo()
      Object.assign(session.view, view)
    })
  },

  async addLayer() {
    get().commitFloatingPaste()
    const current = activeSession(get())
    if (!current) return
    const resources = await window.moonSprite.getResourceInfo()
    const check = checkResourceLimit(current.document.width, current.document.height, current.document.layers.length + 1, current.document.colorMode, resources)
    if (!check.allowed) { set({ message: check.reason }); return }
    get().mutateActive((session) => {
      const document = session.document
      const layer = createLayer(`图层 ${document.layers.length + 1}`, document.width, document.height, document.colorMode)
      const targetGroupId = session.selectedGroupId
      if (targetGroupId) layer.groupId = targetGroupId
      const groupMemberIds = targetGroupId ? new Set(getLayerIdsInGroup(document, targetGroupId)) : null
      const lastGroupMember = groupMemberIds ? document.layers.reduce((last, item, index) => groupMemberIds.has(item.id) ? index : last, -1) : -1
      const index = lastGroupMember >= 0 ? lastGroupMember + 1 : document.layers.findIndex((item) => item.id === document.activeLayerId) + 1
      document.layers.splice(index, 0, layer)
      document.activeLayerId = layer.id
      session.selectedGroupId = null
      session.selectedLayerIds = [layer.id]
      session.history.push({
        label: '新建图层', bytes: layer.pixels.byteLength,
        undo: () => { document.layers = document.layers.filter((item) => item.id !== layer.id); document.activeLayerId = document.layers[Math.max(0, index - 1)].id },
        redo: () => { document.layers.splice(index, 0, layer); document.activeLayerId = layer.id }
      })
    })
  },

  duplicateActiveLayer() {
    get().mutateActive((session) => {
      const document = session.document
      const priorId = document.activeLayerId
      const copy = duplicateLayer(document, priorId)
      session.selectedGroupId = null
      session.selectedLayerIds = [copy.id]
      const index = document.layers.findIndex((item) => item.id === copy.id)
      session.history.push({
        label: '复制图层', bytes: copy.pixels.byteLength,
        undo: () => { document.layers = document.layers.filter((item) => item.id !== copy.id); document.activeLayerId = priorId },
        redo: () => { document.layers.splice(index, 0, copy); document.activeLayerId = copy.id }
      })
    })
  },

  duplicateLayers(layerIds) {
    const createdIds: string[] = []
    get().mutateActive((session) => {
      const document = session.document
      const priorActiveId = document.activeLayerId
      const priorSelection = [...session.selectedLayerIds]
      const orderedIds = [...new Set(layerIds)]
        .filter((id) => document.layers.some((layer) => layer.id === id))
        .sort((left, right) => document.layers.findIndex((layer) => layer.id === left) - document.layers.findIndex((layer) => layer.id === right))
      const copies = orderedIds.map((id) => duplicateLayer(document, id))
      if (copies.length === 0) return
      createdIds.push(...copies.map((copy) => copy.id))
      const placements = copies.map((copy) => ({ copy, index: document.layers.indexOf(copy) }))
      document.activeLayerId = copies.at(-1)!.id
      session.selectedGroupId = null
      session.selectedLayerIds = [...createdIds]
      session.history.push({
        label: '复制图层',
        bytes: copies.reduce((sum, copy) => sum + copy.pixels.byteLength, 0),
        undo: () => {
          const ids = new Set(createdIds)
          document.layers = document.layers.filter((layer) => !ids.has(layer.id))
          document.activeLayerId = priorActiveId
          session.selectedLayerIds = priorSelection
          session.selectedGroupId = null
        },
        redo: () => {
          for (const { copy, index } of placements) if (!document.layers.some((layer) => layer.id === copy.id)) document.layers.splice(Math.min(index, document.layers.length), 0, copy)
          document.activeLayerId = copies.at(-1)!.id
          session.selectedLayerIds = [...createdIds]
          session.selectedGroupId = null
        }
      })
    })
    return createdIds
  },

  deleteActiveLayer() {
    get().mutateActive((session) => {
      const document = session.document
      if (document.layers.length === 1) { set({ message: '至少保留一个图层。' }); return }
      const index = document.layers.findIndex((item) => item.id === document.activeLayerId)
      const removed = document.layers[index]
      document.layers.splice(index, 1)
      const nextId = document.layers[Math.max(0, index - 1)].id
      document.activeLayerId = nextId
      session.selectedGroupId = null
      session.selectedLayerIds = [nextId]
      session.history.push({
        label: '删除图层', bytes: removed.pixels.byteLength,
        undo: () => { document.layers.splice(index, 0, removed); document.activeLayerId = removed.id },
        redo: () => { document.layers = document.layers.filter((item) => item.id !== removed.id); document.activeLayerId = nextId }
      })
    })
  },

  mergeSelectedLayers() {
    get().commitFloatingPaste()
    const state = get()
    const session = activeSession(state)
    if (!session) return
    const beforeDocument = encodeProject(session.document)
    const beforeUi = captureLayerUi(session)
    const result = mergeRasterLayers(session.document, session.selectedLayerIds)
    if (!result.ok) { set({ message: result.reason }); return }
    commitLayerMerge(session, beforeDocument, beforeUi, result, '合并所选图层')
    set({ sessions: [...state.sessions], message: '已合并所选图层。' })
  },

  mergeActiveLayerDown() {
    get().commitFloatingPaste()
    const state = get()
    const session = activeSession(state)
    if (!session) return
    const beforeDocument = encodeProject(session.document)
    const beforeUi = captureLayerUi(session)
    const result = mergeLayerDown(session.document, session.document.activeLayerId)
    if (!result.ok) { set({ message: result.reason }); return }
    commitLayerMerge(session, beforeDocument, beforeUi, result, '向下合并图层')
    set({ sessions: [...state.sessions], message: '已向下合并图层。' })
  },

  mergeSelectedGroup() {
    get().commitFloatingPaste()
    const state = get()
    const session = activeSession(state)
    if (!session?.selectedGroupId) { set({ message: '请先选择一个图层组。' }); return }
    const beforeDocument = encodeProject(session.document)
    const beforeUi = captureLayerUi(session)
    const result = mergeLayerGroup(session.document, session.selectedGroupId)
    if (!result.ok) { set({ message: result.reason }); return }
    commitLayerMerge(session, beforeDocument, beforeUi, result, '合并图层组')
    set({ sessions: [...state.sessions], message: '已将图层组合并为单个图层。' })
  },

  mergeVisibleLayers() {
    get().commitFloatingPaste()
    const state = get()
    const session = activeSession(state)
    if (!session) return
    const beforeDocument = encodeProject(session.document)
    const beforeUi = captureLayerUi(session)
    const result = mergeVisibleDocumentLayers(session.document)
    if (!result.ok) { set({ message: result.reason }); return }
    commitLayerMerge(session, beforeDocument, beforeUi, result, '合并可见图层')
    set({ sessions: [...state.sessions], message: '已合并可见图层，隐藏图层保持不变。' })
  },

  moveLayer(direction) {
    get().mutateActive((session) => {
      const document = session.document
      const index = document.layers.findIndex((layer) => layer.id === document.activeLayerId)
      const target = index + direction
      if (target < 0 || target >= document.layers.length) return
      ;[document.layers[index], document.layers[target]] = [document.layers[target], document.layers[index]]
      session.history.push({
        label: '移动图层', bytes: 32,
        undo: () => { ;[document.layers[index], document.layers[target]] = [document.layers[target], document.layers[index]] },
        redo: () => { ;[document.layers[index], document.layers[target]] = [document.layers[target], document.layers[index]] }
      })
    })
  },

  moveLayerBy(layerId, deltaX, deltaY, label = '移动图层内容') {
    get().mutateActive((session) => {
      const layer = session.document.layers.find((candidate) => candidate.id === layerId)
      if (!layer || isLayerEffectivelyLocked(session.document, layer)) return
      const before = { x: layer.offsetX, y: layer.offsetY }
      const after = { x: before.x + Math.trunc(deltaX), y: before.y + Math.trunc(deltaY) }
      if (before.x === after.x && before.y === after.y) return
      layer.offsetX = after.x
      layer.offsetY = after.y
      session.history.push({
        label, bytes: 32,
        undo: () => { layer.offsetX = before.x; layer.offsetY = before.y },
        redo: () => { layer.offsetX = after.x; layer.offsetY = after.y }
      })
    })
  },

  reorderLayer(layerId, targetLayerId) {
    get().reorderLayers([layerId], targetLayerId)
  },

  reorderLayers(layerIds, targetLayerId, insertAfterTarget = true) {
    get().mutateActive((session) => {
      const history = reorderLayersOperation(session, layerIds, targetLayerId, insertAfterTarget)
      if (history) session.history.push(history)
    })
  },

  assignLayerToGroup(layerId, groupId) {
    get().assignLayersToGroup([layerId], groupId)
  },

  assignLayersToGroup(layerIds, groupId, targetLayerId, insertAfterTarget = true) {
    get().mutateActive((session) => {
      const history = assignLayersToGroupOperation(session, layerIds, groupId, targetLayerId, insertAfterTarget)
      if (history) session.history.push(history)
    })
  },

  assignLayersToRoot(layerIds, targetLayerId, insertAfterTarget = true) {
    get().mutateActive((session) => {
      const history = assignLayersToRootOperation(session, layerIds, targetLayerId, insertAfterTarget)
      if (history) session.history.push(history)
    })
  },

  assignLayersAboveGroup(layerIds, groupId) {
    get().mutateActive((session) => {
      const history = assignLayersAboveGroupOperation(session, layerIds, groupId)
      if (history) session.history.push(history)
    })
  },

  reorderGroup(groupId, targetGroupId, insertAfterTarget = true) {
    if (groupId === targetGroupId) return
    get().mutateActive((session) => {
      if (!canMoveGroupInto(session.document, groupId, targetGroupId)) {
        set({ message: '不能把图层组移动到自己的子组旁。' })
        return
      }
      const history = reorderGroupOperation(session, groupId, targetGroupId, insertAfterTarget)
      if (history) session.history.push(history)
    })
  },

  assignGroupToGroup(groupId, parentGroupId) {
    if (groupId === parentGroupId) return
    get().mutateActive((session) => {
      if (!canMoveGroupInto(session.document, groupId, parentGroupId)) { set({ message: '不能把图层组移动到自己的子组中。' }); return }
      const history = assignGroupToGroupOperation(session, groupId, parentGroupId)
      if (history) session.history.push(history)
    })
  },

  assignGroupToRoot(groupId) {
    get().mutateActive((session) => {
      const history = assignGroupToRootOperation(session, groupId)
      if (history) session.history.push(history)
    })
  },

  createLayerGroup() {
    get().mutateActive((session) => {
      const history = createLayerGroupOperation(session, createId('group'), `组 ${session.document.groups.length + 1}`)
      if (history) session.history.push(history)
    })
  },

  ungroupSelected() {
    get().mutateActive((session) => {
      const history = ungroupSelectedOperation(session)
      if (history) session.history.push(history)
    })
  },

  toggleLayerVisibility(layerId) {
    get().mutateActive((session) => {
      const layer = getLayer(session.document, layerId)
      const before = layer.visible
      layer.visible = !before
      session.history.push({ label: '显示图层', bytes: 8, undo: () => { layer.visible = before }, redo: () => { layer.visible = !before } })
    })
  },

  selectLayer(layerId, additive = false) {
    get().commitFloatingPaste()
    get().mutateActive((session) => {
      session.selectedGroupId = null
      if (!additive) session.selectedLayerIds = [layerId]
      else if (session.selectedLayerIds.includes(layerId)) session.selectedLayerIds = session.selectedLayerIds.length > 1 ? session.selectedLayerIds.filter((id) => id !== layerId) : session.selectedLayerIds
      else session.selectedLayerIds = [...session.selectedLayerIds, layerId]
      session.document.activeLayerId = session.selectedLayerIds.includes(layerId) ? layerId : session.selectedLayerIds.at(-1) ?? layerId
    }, false)
  },

  selectGroup(groupId) {
    get().commitFloatingPaste()
    get().mutateActive((session) => {
      getGroup(session.document, groupId)
      session.selectedGroupId = groupId
      session.selectedLayerIds = getLayerIdsInGroup(session.document, groupId)
      const member = session.document.layers.find((layer) => session.selectedLayerIds.includes(layer.id))
      if (member) session.document.activeLayerId = member.id
    }, false)
  },

  toggleGroupCollapsed(groupId) {
    get().mutateActive((session) => {
      getGroup(session.document, groupId)
      session.collapsedGroupIds = session.collapsedGroupIds.includes(groupId)
        ? session.collapsedGroupIds.filter((id) => id !== groupId)
        : [...session.collapsedGroupIds, groupId]
    }, false)
  },

  toggleGroupVisibility(groupId) {
    get().mutateActive((session) => {
      const group = getGroup(session.document, groupId)
      const before = group.visible
      group.visible = !before
      session.history.push({ label: '显示图层组', bytes: 8, undo: () => { group.visible = before }, redo: () => { group.visible = !before } })
    })
  },

  setGroupProperties(groupId, name, opacity, blendMode, locked) {
    const trimmed = name.trim()
    if (!trimmed) return
    get().mutateActive((session) => {
      const group = getGroup(session.document, groupId)
      const before = { name: group.name, opacity: group.opacity, blendMode: group.blendMode, locked: group.locked }
      const after = { name: trimmed, opacity: Math.max(0, Math.min(1, opacity)), blendMode, locked }
      Object.assign(group, after)
      session.history.push({ label: '修改图层组属性', bytes: 48 + before.name.length + after.name.length, undo: () => Object.assign(group, before), redo: () => Object.assign(group, after) })
    })
  },

  renameLayer(layerId, name) {
    const trimmed = name.trim()
    if (!trimmed) return
    get().mutateActive((session) => {
      const layer = getLayer(session.document, layerId)
      const before = layer.name
      layer.name = trimmed
      session.history.push({ label: '重命名图层', bytes: before.length + trimmed.length, undo: () => { layer.name = before }, redo: () => { layer.name = trimmed } })
    })
  },

  setLayerOpacity(layerId, opacity) {
    get().mutateActive((session) => {
      const layer = getLayer(session.document, layerId)
      const before = layer.opacity
      const after = Math.max(0, Math.min(1, opacity))
      layer.opacity = after
      session.history.push({ label: '图层不透明度', bytes: 16, undo: () => { layer.opacity = before }, redo: () => { layer.opacity = after } })
    })
  },

  setLayerProperties(layerId, name, opacity) {
    const trimmed = name.trim()
    if (!trimmed) return
    get().mutateActive((session) => {
      const layer = getLayer(session.document, layerId)
      const before = { name: layer.name, opacity: layer.opacity }
      const after = { name: trimmed, opacity: Math.max(0, Math.min(1, opacity)) }
      layer.name = after.name
      layer.opacity = after.opacity
      session.history.push({ label: '修改图层属性', bytes: 32 + before.name.length + after.name.length, undo: () => { layer.name = before.name; layer.opacity = before.opacity }, redo: () => { layer.name = after.name; layer.opacity = after.opacity } })
    })
  },

  setLayerPropertiesWithBlend(layerId, name, opacity, blendMode, locked) {
    const trimmed = name.trim()
    if (!trimmed) return
    get().mutateActive((session) => {
      const layer = getLayer(session.document, layerId)
      const before = { name: layer.name, opacity: layer.opacity, blendMode: layer.blendMode, locked: layer.locked }
      const after = { name: trimmed, opacity: Math.max(0, Math.min(1, opacity)), blendMode, locked: locked ?? layer.locked }
      Object.assign(layer, after)
      session.history.push({ label: '修改图层属性', bytes: 40 + before.name.length + after.name.length, undo: () => Object.assign(layer, before), redo: () => Object.assign(layer, after) })
    })
  },
  applyActiveLayerAdjustment(adjustment) {
    get().mutateActive((session) => {
      const layer = getActiveLayer(session.document)
      if (isLayerEffectivelyLocked(session.document, layer)) return
      const edit = applyColorAdjustment(session.document, layer, adjustment, session.selection)
      const labels: Record<ColorAdjustment['kind'], string> = {
        'color-balance': '色彩平衡', 'brightness-contrast': '亮度/对比度', 'hue-saturation': '色相/饱和度', curves: '曲线'
      }
      const entry = commitPixelEdit(session.document, edit, labels[adjustment.kind])
      if (entry) session.history.push(entry)
    })
  },
  captureActiveLayerAdjustmentSnapshot() {
    const session = activeSession(get())
    return session ? captureAdjustmentSnapshot(session) : null
  },
  previewActiveLayerAdjustment(adjustment, baseline) {
    get().mutateActive((session) => {
      restoreAdjustmentSnapshot(session, baseline)
      const layer = getLayer(session.document, baseline.layerId)
      if (!isLayerEffectivelyLocked(session.document, layer)) applyColorAdjustment(session.document, layer, adjustment, session.selection)
      session.revision += 1
    }, false)
  },
  restoreActiveDocumentSnapshot(snapshot) {
    get().mutateActive((session) => {
      restoreAdjustmentSnapshot(session, snapshot)
      session.revision += 1
    }, false)
  },
  applyActiveLayerAdjustmentFromSnapshot(adjustment, baseline) {
    get().mutateActive((session) => {
      const before = {
        ...baseline,
        pixels: baseline.pixels instanceof Uint8ClampedArray ? new Uint8ClampedArray(baseline.pixels) : new Uint32Array(baseline.pixels),
        palette: baseline.palette.map((entry) => ({ ...entry, color: { ...entry.color } }))
      }
      restoreAdjustmentSnapshot(session, before)
      const layer = getLayer(session.document, before.layerId)
      if (isLayerEffectivelyLocked(session.document, layer)) return
      applyColorAdjustment(session.document, layer, adjustment, session.selection)
      const after = captureAdjustmentSnapshot(session)
      const labels: Record<ColorAdjustment['kind'], string> = {
        'color-balance': '色彩平衡', 'brightness-contrast': '亮度/对比度', 'hue-saturation': '色相/饱和度', curves: '曲线'
      }
      session.history.push({
        label: labels[adjustment.kind],
        bytes: before.pixels.byteLength + after.pixels.byteLength + (before.palette.length + after.palette.length) * 24,
        undo: () => { restoreAdjustmentSnapshot(session, before); session.revision += 1 },
        redo: () => { restoreAdjustmentSnapshot(session, after); session.revision += 1 }
      })
    })
  },

  deleteSelection() {
    const current = activeSession(get())
    if (current?.pendingPaste) { get().cancelFloatingPaste(); return }
    get().mutateActive((session) => {
      if (!session.selection) return
      const edit = clearSelection(session.document, session.selection)
      const entry = edit && commitPixelEdit(session.document, edit, '删除选区')
      if (entry) session.history.push(entry)
    })
  },

  fillForeground() {
    const current = activeSession(get())
    if (!current) return
    if (current.pendingPaste) get().commitFloatingPaste()
    const session = activeSession(get())
    if (!session) return
    const layer = getActiveLayer(session.document)
    if (!isLayerEffectivelyVisible(session.document, layer)) { set({ message: '当前图层不可见，无法填充。' }); return }
    if (isLayerEffectivelyLocked(session.document, layer)) { set({ message: '当前图层已锁定，无法填充。' }); return }
    const edit = fillSelectionOrCanvas(session.document, layer, session.primaryColor, session.selection)
    if (!edit) { set({ message: '没有可填充的像素区域。' }); return }
    get().commitPixelEdit(edit, session.selection ? '填充选区前景色' : '填充画布前景色')
  },

  outlineActiveSelection(color, thickness, position, directions, kernel = 'round') {
    const session = activeSession(get())
    if (!session?.selection) { set({ message: '请先创建选区。' }); return false }
    const layer = getActiveLayer(session.document)
    if (isLayerEffectivelyLocked(session.document, layer)) { set({ message: '当前图层已锁定。' }); return false }
    try {
      const edit = outlineSelection(session.document, layer, session.selection, color, thickness, position, directions, kernel)
      if (!edit) { set({ message: '选区内没有可描边的内容。' }); return false }
      get().commitPixelEdit(edit, position === 'inside' ? '内部描边' : '外部描边')
      set({ message: `已应用 ${Math.max(1, Math.min(64, Math.round(thickness)))} px ${position === 'inside' ? '内部' : '外部'}描边。` })
      return true
    } catch (error) {
      set({ message: error instanceof Error ? error.message : '无法应用描边。' })
      return false
    }
  },

  copyActiveLayerToClipboard() {
    get().commitFloatingPaste()
    const session = activeSession(get())
    if (!session || session.selectedGroupId || session.selectedLayerIds.length !== 1) {
      set({ message: '请选择一个图层后再复制图层。' })
      return
    }
    const layer = session.document.layers.find((candidate) => candidate.id === session.selectedLayerIds[0])
    if (!layer) return
    const pixels = new Uint8ClampedArray(layer.width * layer.height * 4)
    for (let y = 0; y < layer.height; y += 1) for (let x = 0; x < layer.width; x += 1) {
      const color = readLayerColorAt(session.document, layer, layer.offsetX + x, layer.offsetY + y)
      const offset = (y * layer.width + x) * 4
      pixels[offset] = color.r
      pixels[offset + 1] = color.g
      pixels[offset + 2] = color.b
      pixels[offset + 3] = color.a
    }
    clipboardService.setLayer({ name: layer.name, width: layer.width, height: layer.height, offsetX: layer.offsetX, offsetY: layer.offsetY, visible: layer.visible, locked: layer.locked, opacity: layer.opacity, blendMode: layer.blendMode, pixels })
    set({ message: `已复制图层“${layer.name}”。` })
  },

  pasteLayerFromClipboard() {
    const clipboard = clipboardService.getLayer()
    const current = activeSession(get())
    if (!clipboard || !current) return false
    get().mutateActive((session) => {
      const document = session.document
      const layer = createLayer(`${clipboard.name} 副本`, clipboard.width, clipboard.height, document.colorMode)
      layer.offsetX = clipboard.offsetX
      layer.offsetY = clipboard.offsetY
      layer.visible = clipboard.visible
      layer.locked = clipboard.locked
      layer.opacity = clipboard.opacity
      layer.blendMode = clipboard.blendMode
      if (layer.format === 'rgba') layer.pixels.set(clipboard.pixels)
      else for (let index = 0; index < clipboard.width * clipboard.height; index += 1) {
        const offset = index * 4
        layer.pixels[index] = findOrAddPaletteColor(document, { r: clipboard.pixels[offset], g: clipboard.pixels[offset + 1], b: clipboard.pixels[offset + 2], a: clipboard.pixels[offset + 3] })
      }
      if (session.selectedGroupId) layer.groupId = session.selectedGroupId
      const index = document.layers.findIndex((candidate) => candidate.id === document.activeLayerId) + 1
      document.layers.splice(Math.max(0, index), 0, layer)
      const previousActiveId = document.activeLayerId
      const previousSelection = [...session.selectedLayerIds]
      document.activeLayerId = layer.id
      session.selectedGroupId = null
      session.selectedLayerIds = [layer.id]
      session.history.push({
        label: '粘贴图层', bytes: layer.pixels.byteLength,
        undo: () => { document.layers = document.layers.filter((candidate) => candidate.id !== layer.id); document.activeLayerId = previousActiveId; session.selectedLayerIds = previousSelection },
        redo: () => { if (!document.layers.some((candidate) => candidate.id === layer.id)) document.layers.splice(Math.min(index, document.layers.length), 0, layer); document.activeLayerId = layer.id; session.selectedGroupId = null; session.selectedLayerIds = [layer.id] }
      })
    })
    set({ message: `已粘贴图层“${clipboard.name}”。` })
    return true
  },

  copySelection() {
    get().commitFloatingPaste()
    const session = activeSession(get())
    if (!session?.selection) { set({ message: '请先创建选区。' }); return }
    const layer = getActiveLayer(session.document)
    const document = session.document
    const selection = clampSelection(document, session.selection)
    if (!selection) { set({ message: '选区不在画布内。' }); return }
    const pixels = new Uint32Array(selection.width * selection.height)
    const mask = new Uint8Array(selection.width * selection.height)
    let copied = 0
    for (let y = 0; y < selection.height; y += 1) for (let x = 0; x < selection.width; x += 1) {
      if (!selectionContains(session.selection, selection.x + x, selection.y + y)) continue
        const color = readLayerColorAt(document, layer, selection.x + x, selection.y + y)
      if (color.a === 0) continue
      const clipboardIndex = y * selection.width + x
      pixels[clipboardIndex] = packColor(color)
      mask[clipboardIndex] = 1
      copied += 1
    }
    if (copied === 0) { clipboardService.clearSelection(); set({ message: '选区内没有可复制的非透明像素。' }); return }
    clipboardService.setSelection({ width: selection.width, height: selection.height, pixels, mask })
    const clipboard = clipboardService.getSelection()
    if (!clipboard) return
    void window.moonSprite.writeClipboardImage(selectionClipboardImage(clipboard)).catch(() => {
      set({ message: '已复制到软件内部剪贴板，但无法写入系统剪贴板。' })
    })
    set({ message: `已复制 ${copied} 个非透明像素。` })
  },

  cutSelection() {
    get().commitFloatingPaste()
    get().copySelection()
    get().deleteSelection()
  },

  async pasteSelection() {
    get().commitFloatingPaste()
    const clipboard = await clipboardService.readSelection(() => window.moonSprite.readClipboardImage())
    get().mutateActive((session) => {
      if (!clipboard) { set({ message: '剪贴板中没有像素内容。' }); return }
      const document = session.document
      const layer = getActiveLayer(document)
      if (isLayerEffectivelyLocked(document, layer)) { set({ message: '当前图层已锁定。' }); return }
      const beforeSelection = cloneSelectionMask(session.selection)
      // Keep the entire clipboard image, even when it is larger than the
      // document. The floating selection can then be moved until any part of
      // it reaches the canvas instead of losing off-canvas pixels on paste.
      const x = Math.floor((document.width - clipboard.width) / 2)
      const y = Math.floor((document.height - clipboard.height) / 2)
      const width = clipboard.width
      const height = clipboard.height
      const pastedMask = clipboard.mask.slice()
      const values = layer.format === 'rgba' ? clipboard.pixels.slice() : new Uint32Array(width * height)
      let pasted = 0
      if (layer.format === 'rgba') {
        for (const selected of pastedMask) pasted += selected
      } else {
        for (let offset = 0; offset < pastedMask.length; offset += 1) {
          if (pastedMask[offset] !== 1) continue
          values[offset] = findOrAddPaletteColor(document, unpackColor(clipboard.pixels[offset]))
          pasted += 1
        }
      }
      if (pasted === 0) { set({ message: '粘贴内容位于画布之外。' }); return }
      const target: SelectionMask = { x, y, width, height, mask: pastedMask }
      const source: SelectionTransformSource = {
        selection: cloneSelectionMask(target)!,
        values,
        // Floating copies use the visible destination fast path and retain the
        // full source arrays above. Avoid allocating huge JS offset arrays for
        // pasted images that extend beyond a small document.
        selectedOffsets: new Uint32Array(0),
        opaqueOffsets: new Uint32Array(0),
        opaqueIndices: new Uint32Array(0),
        opaqueValues: new Uint32Array(0)
      }
      const edit = applySelectionTransform(document, source, target, 0, true) ?? beginPixelEdit(layer.id)
      session.selection = cloneSelectionMask(target)
      session.pendingPaste = { layerId: layer.id, beforeSelection, source, target: cloneSelectionMask(target)!, previewEdit: edit }
      // A paste remains floating until confirmed, so its first drag should move
      // the pasted pixels instead of beginning a new pencil stroke.
      session.tool = 'selection'
      session.revision += 1
      set({ message: `已粘贴 ${pasted} 个非透明像素，可移动后按 Enter 确认。` })
    }, false)
  },

  updateFloatingPastePreview(edit, target) {
    get().mutateActive((session) => {
      if (!session.pendingPaste) return
      session.pendingPaste.previewEdit = edit
      session.pendingPaste.target = cloneSelectionMask(target)!
      session.selection = cloneSelectionMask(target)
      session.revision += 1
    }, false)
  },

  commitFloatingPaste() {
    const current = activeSession(get())
    if (!current?.pendingPaste) return
    get().mutateActive((session) => {
      const pending = session.pendingPaste
      if (!pending) return
      const pixelEntry = commitPixelEdit(session.document, pending.previewEdit, '粘贴到当前图层')
      const beforeSelection = cloneSelectionMask(pending.beforeSelection)
      const afterSelection = cloneSelectionMask(pending.target)
      session.pendingPaste = null
      session.selection = afterSelection
      if (pixelEntry) session.history.push({
        ...pixelEntry,
        bytes: pixelEntry.bytes + (beforeSelection?.mask?.byteLength ?? 0) + (afterSelection?.mask?.byteLength ?? 0) + 64,
        undo: () => { pixelEntry.undo(); session.selection = cloneSelectionMask(beforeSelection) },
        redo: () => { pixelEntry.redo(); session.selection = cloneSelectionMask(afterSelection) }
      })
    })
  },

  cancelFloatingPaste() {
    const current = activeSession(get())
    if (!current?.pendingPaste) return
    get().mutateActive((session) => {
      const pending = session.pendingPaste
      if (!pending) return
      revertPixelEdit(session.document, pending.previewEdit)
      session.selection = cloneSelectionMask(pending.beforeSelection)
      session.pendingPaste = null
      session.revision += 1
    }, false)
  },

  moveActiveSelectionWithSelectionHistory(deltaX, deltaY) {
    get().mutateActive((session) => {
      if (!session.selection) return
      const beforeSelection = { ...session.selection }
      const nextX = Math.max(0, Math.min(session.document.width - beforeSelection.width, beforeSelection.x + deltaX))
      const nextY = Math.max(0, Math.min(session.document.height - beforeSelection.height, beforeSelection.y + deltaY))
      const actualX = nextX - beforeSelection.x
      const actualY = nextY - beforeSelection.y
      const edit = moveSelection(session.document, beforeSelection, actualX, actualY)
      const entry = edit && commitPixelEdit(session.document, edit, '移动选区内容')
      if (!entry) return
      const afterSelection = { ...beforeSelection, x: nextX, y: nextY }
      session.selection = afterSelection
      session.history.push({ ...entry, bytes: entry.bytes + 48, undo: () => { entry.undo(); session.selection = { ...beforeSelection } }, redo: () => { entry.redo(); session.selection = { ...afterSelection } } })
    })
  },

  flipActiveSelection(axis) {
    get().mutateActive((session) => {
      const layer = getActiveLayer(session.document)
      if (isLayerEffectivelyLocked(session.document, layer)) return
      const beforeSelection = cloneSelectionMask(session.selection)
      const afterSelection = session.selection ? flipSelectionMask(session.selection, axis) : null
      const edit = session.selection ? flipSelection(session.document, session.selection, axis) : flipLayer(session.document, axis)
      const entry = edit && commitPixelEdit(session.document, edit, axis === 'horizontal' ? '水平翻转选区' : '垂直翻转选区')
      const sameMask = beforeSelection?.mask === afterSelection?.mask
        || (beforeSelection?.mask?.length === afterSelection?.mask?.length && beforeSelection?.mask?.every((value, index) => value === afterSelection?.mask?.[index]))
      const selectionChanged = !sameMask
      session.selection = afterSelection
      session.lastPencilPoint = null
      session.lastEraserPoint = null
      if (entry) {
        session.history.push({ ...entry, bytes: entry.bytes + (beforeSelection?.mask?.byteLength ?? 0) + (afterSelection?.mask?.byteLength ?? 0), undo: () => { entry.undo(); session.selection = cloneSelectionMask(beforeSelection) }, redo: () => { entry.redo(); session.selection = cloneSelectionMask(afterSelection) } })
      } else if (selectionChanged) {
        session.history.push({ label: axis === 'horizontal' ? '水平翻转选区' : '垂直翻转选区', bytes: (beforeSelection?.mask?.byteLength ?? 0) + (afterSelection?.mask?.byteLength ?? 0), undo: () => { session.selection = cloneSelectionMask(beforeSelection) }, redo: () => { session.selection = cloneSelectionMask(afterSelection) } })
      }
    })
  },

  transformActiveSelection(beforeSelection, afterSelection, angle = 0) {
    get().mutateActive((session) => {
      const edit = transformSelectionCopy(session.document, beforeSelection, afterSelection, angle)
      const entry = edit && commitPixelEdit(session.document, edit, angle === 0 ? '变换选区内容' : '旋转选区内容')
      const before = { ...beforeSelection }
      const after = { ...afterSelection }
      session.selection = after
      if (entry) {
        session.history.push({ ...entry, bytes: entry.bytes + 64, undo: () => { entry.undo(); session.selection = { ...before } }, redo: () => { entry.redo(); session.selection = { ...after } } })
      } else if (before.x !== after.x || before.y !== after.y || before.width !== after.width || before.height !== after.height) {
        session.history.push({ label: '变换选区', bytes: 48, undo: () => { session.selection = { ...before } }, redo: () => { session.selection = { ...after } } })
      }
    })
  },

  commitSelectionTransform(edit, beforeSelection, afterSelection, label) {
    get().mutateActive((session) => {
      const entry = edit && commitPixelEdit(session.document, edit, label)
      const before = cloneSelectionMask(beforeSelection)!
      const after = cloneSelectionMask(afterSelection)!
      const sameMask = before.mask === after.mask || (before.mask?.length === after.mask?.length && before.mask?.every((value, index) => value === after.mask?.[index]))
      const selectionChanged = before.x !== after.x || before.y !== after.y || before.width !== after.width || before.height !== after.height || !sameMask
      session.selection = after
      if (entry) {
        session.history.push({ ...entry, bytes: entry.bytes + 64 + (before.mask?.byteLength ?? 0) + (after.mask?.byteLength ?? 0), undo: () => { entry.undo(); session.selection = cloneSelectionMask(before) }, redo: () => { entry.redo(); session.selection = cloneSelectionMask(after) } })
        touch(session)
      } else if (selectionChanged) {
        session.history.push({ label, bytes: 48 + (before.mask?.byteLength ?? 0) + (after.mask?.byteLength ?? 0), undo: () => { session.selection = cloneSelectionMask(before) }, redo: () => { session.selection = cloneSelectionMask(after) } })
      }
    }, false)
  },

  moveActiveSelection(deltaX, deltaY) {
    get().mutateActive((session) => {
      if (!session.selection) return
      const edit = moveSelection(session.document, session.selection, deltaX, deltaY)
      const entry = edit && commitPixelEdit(session.document, edit, '移动选区')
      if (entry) session.history.push(entry)
      if (entry) session.selection = { ...session.selection, x: session.selection.x + deltaX, y: session.selection.y + deltaY }
    })
  },

  async convertColorMode(mode) {
    const current = activeSession(get())
    if (!current || current.document.colorMode === mode) return
    const resources = await window.moonSprite.getResourceInfo()
    const check = checkResourceLimit(current.document.width, current.document.height, current.document.layers.length, mode, resources)
    if (!check.allowed) { set({ message: check.reason }); return }
    get().mutateActive((session) => {
      if (session.document.colorMode === mode) return
      const before = encodeProject(session.document)
      convertDocumentColorMode(session.document, mode)
      const after = encodeProject(session.document)
      session.history.push({
        label: '转换颜色模式', bytes: before.byteLength + after.byteLength,
        undo: () => restoreDocumentSnapshot(session.document, before),
        redo: () => restoreDocumentSnapshot(session.document, after)
      })
    })
  },

  async saveActive(saveAs = false, options?: SaveAsOptions) {
    const session = activeSession(get())
    if (!session) return false
    const documentId = session.document.id
    get().commitFloatingPaste()
    const showProgress = saveAs || Boolean(options)
    if (showProgress) set({ saveProgress: { value: 0, label: '正在保存…' } })
    try {
      const filePath = await saveDocumentFile({
        api: window.moonSprite,
        documentId,
        getDocument: () => get().sessions.find((item) => item.document.id === documentId)?.document ?? null,
        saveAs,
        options,
        preferredImageFormat: saveImageKindForPreference(readStoredString(SAVE_FORMAT_PREFERENCE_KEY))
      })
      if (!filePath) { if (showProgress) set({ saveProgress: null }); return false }
      const saved = get().sessions.find((item) => item.document.id === documentId)
      if (!saved) { if (showProgress) set({ saveProgress: null }); return false }
      saved.document.filePath = filePath
      saved.document.name = fileNameFromPath(filePath)
      saved.document.dirty = false
      set({ sessions: [...get().sessions] })
      recordRecentProject(filePath, saved.document.name)
      await get().autosaveDirty()
      await recoveryService.delete(window.moonSprite, documentId)
      set({ message: '工程已保存。', ...(showProgress ? { saveProgress: { value: 100, label: '已保存' } } : {}) })
      if (showProgress) window.setTimeout(() => { if (get().saveProgress?.value === 100) set({ saveProgress: null }) }, 180)
      return true
    } catch (error) {
      set({ message: error instanceof Error ? error.message : '保存工程失败。', ...(showProgress ? { saveProgress: null } : {}) })
      return false
    }
  },

  async exportActive(options) {
    get().commitFloatingPaste()
    const session = activeSession(get())
    if (!session) return false
    try {
      const message = await exportDocumentFile(window.moonSprite, session.document, options)
      if (!message) return false
      set({ message })
      return true
    } catch (error) {
      set({ message: error instanceof Error ? error.message : '导出图像失败。' })
      return false
    }
  },

  async openFiles() {
    const result = await window.moonSprite.openFiles()
    if (!result.canceled) await Promise.all(result.filePaths.map((filePath) => get().openPath(filePath)))
  },

  async openPath(filePath, options) {
    try {
      const parsed = await openDocumentFile(window.moonSprite, filePath)
      if (options?.duplicate) parsed.id = createId('doc')
      get().addSession(parsed)
      recordRecentProject(filePath, parsed.name)
      return true
    } catch (error) {
      set({ message: error instanceof Error ? `${fileNameFromPath(filePath)}：${error.message}` : '打开文件失败。' })
      return false
    }
  },

  async closeDocument(id) {
    const session = get().sessions.find((item) => item.document.id === id)
    if (!session) return
    if (session.document.dirty) {
      const choice = await get().requestDialog({ title: '未保存的作品', message: `“${session.document.name}”包含未保存的修改。`, detail: '保存修改后关闭、放弃修改，或返回继续编辑。', choices: [{ id: 'cancel', label: '取消', tone: 'quiet' }, { id: 'discard', label: '放弃', tone: 'danger' }, { id: 'save', label: '保存', tone: 'primary' }] })
      if (choice === 'cancel') return
      if (choice === 'save') {
        get().setActive(id)
        const saved = await get().saveActive()
        if (!saved) return
      }
      if (choice === 'discard') await get().discardRecovery(id)
    }
    if (!session.document.dirty) await get().discardRecovery(id)
    set((state) => {
      const sessions = state.sessions.filter((item) => item.document.id !== id)
      return { sessions, activeId: state.activeId === id ? (sessions.at(-1)?.document.id ?? null) : state.activeId }
    })
  },

  async restoreRecoveries() {
    try {
      const recoveries = await recoveryService.list(window.moonSprite)
      set({ recoveryRecords: recoveries })
    } catch {
      set({ recoveryRecords: [], message: '读取恢复栏目时出现问题。' })
    }
  },

  async restoreRecovery(id) {
    const record = get().recoveryRecords.find((item) => item.id === id)
    if (!record) return false
    try {
      const document = await recoveryService.restore(window.moonSprite, record)
      get().addSession(document)
      await recoveryService.delete(window.moonSprite, record.id)
      set((state) => ({ recoveryRecords: state.recoveryRecords.filter((item) => item.id !== record.id), message: `已恢复“${record.name}”。` }))
      return true
    } catch {
      set({ message: `无法恢复“${record.name}”，草稿仍保留在恢复栏目。` })
      return false
    }
  },

  async autosaveDirty() {
    const dirty = get().sessions
      .filter((session) => session.document.dirty && !session.recoverySuppressed)
      .map((session) => session.document)
    await recoveryService.autosave(window.moonSprite, dirty)
  },

  async discardRecovery(id) {
    const session = get().sessions.find((item) => item.document.id === id)
    if (session) {
      session.recoverySuppressed = true
      set({ sessions: [...get().sessions] })
    }
    await recoveryService.discard(window.moonSprite, id)
    set((state) => ({ recoveryRecords: state.recoveryRecords.filter((item) => item.id !== id) }))
  },

  dismissSaveProgress() { set({ saveProgress: null }) },

  requestDialog(options) {
    return new Promise((resolve) => set({ dialog: { ...options, resolve } }))
  },

  resolveDialog(choice) {
    const dialog = get().dialog
    if (!dialog) return
    set({ dialog: null })
    dialog.resolve(choice)
  },

  setMessage(message) { set({ message }) }
}))
