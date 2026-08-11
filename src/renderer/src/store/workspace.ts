import { create } from 'zustand'
import type { AnimationCel, BlendMode, BrushPaintMode, BrushShape, BrushTexture, CanvasAnchor, ColorMode, FillKind, FillMode, GradientDither, ImageBrush, ImageBrushSettings, ImageResizeInterpolation, LayerGroup, LayerMask, OutlineDirections, OutlineKernel, OutlinePosition, PaletteSlotLayout, ProceduralBrushId, ProceduralBrushSettings, RasterLayer, RecoveryRecord, RgbaColor, SelectionKind, SelectionMask, SelectionMode, SelectionRect, ShapeKind, ShapeRatio, SpriteDocument, TimelapseSettings, TimelapseVideoFormat, ToolId, ViewState } from '@shared/types'
import { checkResourceLimit } from '@/core/resource-policy'
import { beginPixelEdit, commitPixelEdit, HistoryStack, recordPixel, revertPixelEdit, type HistoryEntry, type PixelEdit } from '@/core/history'
import { animationMaskAt, animationMaskSlotAt, convertDocumentColorMode, createDocument, createId, createLayer, createLayerMask as createAttachedLayerMask, duplicateLayer, findLayerMask, findOrAddPaletteColor, getDescendantGroupIds, getGroup, getGroupLockingAncestor, getLayerIdsInGroup, getLayer, getActiveLayer, getLayerLockingGroup, isGroupEffectivelyLocked, isLayerEffectivelyLocked, isLayerEffectivelyVisible, isLayerMask, layerContentBounds, readLayerColor, readLayerColorAt, resolveAnimationMask, resizeDocumentAt, resizeDocumentImage, writeLayerColor } from '@/core/document'
import { decodeProject, encodeProject } from '@/core/project-format'
import { activateAnimationFrame, addBlankAnimationFrame, animationCelContentSelection, animationCelHasContent, animationCelKey, animationGroupMaskAt, animationLayerAtFrame, cloneAnimationCel, cloneAnimationCelSurface, cloneAnimationCelsForLayer, cloneAnimationGroupMask, connectAnimationCels, deleteAnimationFrame, disconnectAnimationCels, duplicateAnimationFrame, ensureAnimationDocument, mapAnimationCelBlock, nextAnimationFrameId, parseAnimationCelKey, refreshActiveAnimationFrame, removeAnimationCelsForLayers, resolveAnimationCel, resizeAnimationCelsAt, restoreAnimationCels, setAnimationFrameDuration, setAnimationLoop, syncActiveAnimationFrame } from '@/core/animation'
import { flushViewPreview } from '@/core/view-preview-lifecycle'
import { fileNameFromPath } from '@/core/document-files'
import { createSelectionBrush } from '@/core/brushes'
import { createHorizontalSpriteSheetDocument } from '@/core/sprite-sheet'
import { applySelectionTransform, applySelectionTranslationPreview, captureSelectionTransform, clampSelection, clearSelection, fillSelectionOrCanvas, flipLayer, flipSelection, flipSelectionTransformSource, moveSelection, outlineSelection, replaceLayerColor, restoreSelectionTranslationPreview, selectionTranslationPreviewEdit, transformSelectionCopy, type SelectionTransformSource, type SelectionTranslationPreview } from '@/core/tools'
import { colorEquals, packColor, pixelIndex, relativeLuminanceColor, unpackColor } from '@/core/raster'
import { combineSelection, flipSelectionMask, invertSelectionMask, selectionContains, shiftSelection, transformSelectionMask, type SelectionShearTransform } from '@/core/selection'
import { recordRecentProject } from '@/core/home-history'
import { createProceduralBrush, isProceduralBrushId, normalizeProceduralBrushSettings, PROCEDURAL_BRUSH_IDS } from '@/core/brushes'
import { mergeLayerDown, mergeLayerGroup, mergeRasterLayers, mergeVisibleLayers as mergeVisibleDocumentLayers, type LayerMergeSuccess } from '@/core/layer-merge'
import { applyColorAdjustment, type ColorAdjustment } from '@/core/adjustments'
import { assignGroupToGroup as assignGroupToGroupOperation, assignGroupToRoot as assignGroupToRootOperation, assignLayersAboveGroup as assignLayersAboveGroupOperation, assignLayersToGroup as assignLayersToGroupOperation, assignLayersToRoot as assignLayersToRootOperation, canMoveGroupInto, createLayerGroup as createLayerGroupOperation, moveGroupToRootEdge as moveGroupToRootEdgeOperation, moveLayerPanelRows as moveLayerPanelRowsOperation, moveLayersToRootEdge as moveLayersToRootEdgeOperation, positionGroupNextToLayer as positionGroupNextToLayerOperation, reorderGroup as reorderGroupOperation, reorderLayers as reorderLayersOperation, ungroupSelected as ungroupSelectedOperation, type LayerPanelRowMoveTarget } from '@/core/layer-operations'
import { buildLayerPanelTree } from '@/core/layer-panel-layout'
import { loadEditorPreferences, SAVE_FORMAT_PREFERENCE_KEY, saveImageKindForPreference } from '@/core/file-preferences'
import { normalizeProjectDisplaySettings, normalizeProjectStatistics, normalizeTimelapseSettings } from '@/core/project-metadata'
import { captureTimelapseSnapshot, createTimelapseCaptureCache, type TimelapseCaptureCache, type TimelapseExportOptions } from '@/core/timelapse'
import { translate, type TranslationKey, type TranslationParams } from '@/core/localization'
import { resolveClipboardPlacement } from '@/core/clipboard-placement'
import { cloneProceduralSettings, defaultToolSettings, loadToolSettings, normalizePersistedBrushProfile, saveToolSettings, type BrushTool, type PersistedBrushProfile, type PersistedToolSettings } from '@/core/tool-preferences'
import { readStoredString } from '@/core/storage'
import { moveSymmetryCenter, type SymmetryAxes, type SymmetryCenter } from '@/core/symmetry'
import { brushPressureFromDynamics, migrateBrushPressureSettings, normalizeBrushPressureSettings, patchBrushDynamicsGradientDither, patchBrushDynamicsMapping, type BrushDynamicsEffect, type BrushDynamicsMapping, type BrushPressureSettings } from '@/core/pressure'
import { exportDocumentFile, exportTimelapseFile, openDocumentFile, saveDocumentFile, type ExportOptions, type SaveAsOptions } from './document-file-service'
import { RecoveryService } from './recovery-service'
import { ClipboardService, selectionClipboardImage, type LayerClipboard, type LayerCollectionClipboard, type LayerMaskClipboard } from './clipboard-service'
import { captureAdjustmentSnapshot, captureLayerUi, commitLayerMerge, restoreAdjustmentSnapshot, restoreDocumentSnapshot } from './workspace-history'
import { activePaintLayer, applyBrushProfile, brushProfileFromSession, clearSelectionBrushPaintColors, cloneSelectionMask, isBrushTool, persistToolSettings, remapSelectionBrushColors, rememberBrushProfile, sessionFromDocument, touch } from './workspace-session'
import { addPaletteColor as addPaletteColorCommand, applyPalette as applyPaletteCommand, deletePaletteColors as deletePaletteColorsCommand, movePaletteColor as movePaletteColorCommand, reorderPaletteColors as reorderPaletteColorsCommand, selectPaletteColor as selectPaletteColorCommand, selectPaletteColors as selectPaletteColorsCommand, updatePaletteColor as updatePaletteColorCommand } from './workspace-palette'
import type { AdjustmentSnapshot, AnimationFrameClipboardItem, AnimationMaskClipboardItem, AppDialog, CanvasResizePreview, DocumentSession, OutlinePreview } from './workspace-types'

export type { ExportOptions, SaveAsOptions } from './document-file-service'
export type { AdjustmentSnapshot, AppDialog, CanvasResizePreview, DialogChoice, DocumentSession, FloatingPaste, OutlinePreview } from './workspace-types'

export type ColorReplacementTarget = 'layer' | 'document' | 'selection' | 'layers' | 'frames' | 'cells' | 'palette'

export interface ColorReplacementPreview {
  documentId: string
  edits: PixelEdit[]
  palette: SpriteDocument['palette']
  nextColorId: number
  primaryColor: RgbaColor
  secondaryColor: RgbaColor
}

interface WorkspaceState {
  sessions: DocumentSession[]
  activeId: string | null
  sharedPrimaryColor: RgbaColor
  sharedSecondaryColor: RgbaColor
  message: string | null
  saveProgress: { title: string; value: number; label: string; requiresConfirmation?: boolean } | null
  dialog: AppDialog | null
  recoveryRecords: RecoveryRecord[]
  newDocument(name: string, width: number, height: number, colorMode: ColorMode): Promise<void>
  createSpriteSheetFromActive(): Promise<boolean>
  addSession(document: SpriteDocument): void
  reorderSessions(documentIds: string[]): void
  setActive(id: string): void
  setTool(tool: ToolId): void
  setBrushSize(size: number): void
  setBrushShape(shape: BrushShape): void
  setBrushTexture(texture: BrushTexture): void
  setBrushTextureScale(scale: number): void
  setBrushPaintMode(mode: BrushPaintMode): void
  setBrushDynamicsMapping(effect: BrushDynamicsEffect, patch: Partial<BrushDynamicsMapping>): void
  setBrushDynamicsGradientDither(dither: GradientDither): void
  setBrushPressure(settings: Partial<BrushPressureSettings>): void
  setBrushImage(brush: ImageBrush | null): void
  setTemporaryBrush(brush: ImageBrush): void
  deleteProjectBrush(id: string): void
  createBrushFromSelection(): void
  setBrushImageSettings(settings: Partial<ImageBrushSettings>): void
  setProceduralBrushSettings(settings: Partial<ProceduralBrushSettings>): void
  setProceduralAntialias(enabled: boolean): void
  setProceduralAntialiasStrength(strength: number): void
  setShapeKind(kind: ShapeKind): void
  setShapeRatio(ratio: ShapeRatio | null): void
  setFillMode(mode: FillMode): void
  setFillKind(kind: FillKind): void
  setFillTolerance(tolerance: number): void
  setGradientTolerance(tolerance: number): void
  setGradientContiguous(contiguous: boolean): void
  setGradientDither(dither: GradientDither): void
  setMoveAutoSelect(enabled: boolean): void
  setPrimaryColor(color: RgbaColor): void
  setSecondaryColor(color: RgbaColor): void
  replaceColor(target: ColorReplacementTarget, sourceColor: RgbaColor, replacementColor: RgbaColor): void
  previewColorReplacement(target: ColorReplacementTarget, sourceColor: RgbaColor, replacementColor: RgbaColor, previous?: ColorReplacementPreview | null): ColorReplacementPreview | null
  restoreColorReplacementPreview(preview: ColorReplacementPreview | null): void
  selectSecondaryPaletteColor(id: number): void
  swapPrimarySecondaryColors(): void
  setView(view: Partial<ViewState>): void
  setViewForDocument(documentId: string, view: Partial<ViewState>): void
  setViewportSize(size: { width: number; height: number }): void
  setViewportSizeForDocument(documentId: string, size: { width: number; height: number }): void
  setSelection(selection: SelectionMask | null): void
  invertSelection(): void
  toggleSelectionOutline(): void
  beginLayerTransform(): void
  setSelectionKind(kind: SelectionKind): void
  commitSelectionChange(before: SelectionMask | null, after: SelectionMask | null, label: string): void
  setSelectionMode(mode: SelectionMode): void
  setWandTolerance(tolerance: number): void
  setWandContiguous(contiguous: boolean): void
  setPerfectPixels(enabled: boolean): void
  setSymmetryAxis(axis: keyof SymmetryAxes, enabled: boolean): void
  setSymmetryCenter(center: SymmetryCenter): void
  resetSymmetryCenter(): void
  setLastPencilPoint(point: { x: number; y: number } | null): void
  setLastEraserPoint(point: { x: number; y: number } | null): void
  setCanvasResizePreview(preview: CanvasResizePreview | null): void
  togglePixelGrid(): void
  toggleGrid(): void
  selectPaletteColor(id: number, additive?: boolean): void
  selectPaletteColors(ids: number[], primaryId: number): void
  addPaletteColor(color?: RgbaColor): void
  updatePaletteColor(id: number, color: RgbaColor): void
  applyPalette(colors: RgbaColor[], layout?: PaletteSlotLayout): void
  deletePaletteColor(id: number): void
  deletePaletteColors(ids: number[]): void
  movePaletteColor(direction: -1 | 1): void
  reorderPaletteColors(ids: number[], targetSlots: Array<number | null>, targetColumns: number): void
  mutateActive(mutator: (session: DocumentSession) => void, dirty?: boolean): void
  commitPixelEdit(edit: PixelEdit, label: string, activity?: { stroke?: boolean; durationMs?: number }): void
  setTimelapseSettings(settings: Partial<Omit<TimelapseSettings, 'snapshots'>>): void
  clearTimelapse(): void
  exportTimelapse(format: TimelapseVideoFormat, options: TimelapseExportOptions): Promise<boolean>
  pushHistory(entry: HistoryEntry): void
  undo(): void
  redo(): void
  setActiveAnimationFrame(frameId: string): void
  stepAnimationFrame(delta: number): void
  selectAnimationFrame(frameId: string, mode?: 'replace' | 'toggle' | 'range'): void
  selectAnimationCell(key: string, mode?: 'replace' | 'toggle' | 'range'): void
  selectAnimationMaskCell(key: string, mode?: 'replace' | 'toggle' | 'range'): void
  selectAnimationCelContent(key: string, additive?: boolean): void
  clearAnimationSelection(): void
  setAnimationCelOpacity(layerId: string, frameId: string, opacity: number): void
  connectSelectedAnimationCels(): void
  disconnectSelectedAnimationCels(): void
  copySelectedAnimationCels(): void
  pasteAnimationCels(): void
  moveSelectedAnimationCels(layerId: string, frameId: string, sourceAnchorKey: string): void
  copySelectedAnimationMasks(): void
  pasteAnimationMasks(ownerId?: string, frameId?: string): void
  moveSelectedAnimationMasks(ownerId: string, frameId: string, sourceAnchorKey: string): void
  connectSelectedAnimationMasks(): void
  disconnectSelectedAnimationMasks(): void
  copySelectedAnimationFrames(): void
  pasteAnimationFrames(): void
  moveSelectedAnimationFrames(targetFrameId: string, insertAfter: boolean): void
  deleteSelectedAnimationItems(): void
  setAnimationPlaying(playing: boolean, completed?: boolean): void
  setAnimationPlaybackRate(rate: number): void
  setAnimationReturnToStart(enabled: boolean): void
  advanceAnimationFrame(): void
  addAnimationFrame(): void
  duplicateAnimationFrame(): void
  deleteAnimationFrame(): void
  setActiveAnimationFrameDuration(duration: number): void
  setAnimationLoop(loop: boolean): void
  addLayer(): Promise<void>
  duplicateActiveLayer(): void
  duplicateLayers(layerIds: string[]): string[]
  duplicateSelectedLayerRows(): { layerIds: string[]; groupIds: string[] }
  deleteActiveLayer(): void
  deleteSelectedLayers(): void
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
  positionGroupNextToLayer(groupId: string, targetLayerId: string, insertAfterTarget?: boolean): void
  assignGroupToGroup(groupId: string, parentGroupId: string): void
  assignGroupToRoot(groupId: string): void
  moveLayersToRootEdge(layerIds: string[], edge: 'top' | 'bottom'): void
  moveGroupToRootEdge(groupId: string, edge: 'top' | 'bottom'): void
  moveLayerRows(layerIds: string[], groupIds: string[], target: LayerPanelRowMoveTarget): void
  createLayerGroup(): void
  ungroupSelected(): void
  selectGroup(groupId: string, mode?: boolean | 'replace' | 'toggle' | 'range'): void
  selectLayerRows(layerIds: string[], groupIds: string[]): void
  clearLayerSelection(): void
  toggleGroupCollapsed(groupId: string): void
  toggleGroupVisibility(groupId: string): void
  selectLayerMask(celId: string, additive?: boolean): void
  selectGroupMask(groupId: string, frameId: string, additive?: boolean): void
  toggleLayerMaskVisibility(celId: string): void
  toggleGroupMaskVisibility(groupId: string, frameId: string): void
  createLayerMask(celIdOrLayerId: string, frameId?: string): void
  createLayerMasksForLayer(layerId: string): void
  createGroupMask(groupId: string, frameId?: string): void
  deleteLayerMask(celId: string): void
  deleteGroupMask(groupId: string, frameId?: string): void
  deleteSelectedLayerMasks(): void
  toggleActiveClippingMask(): void
  setClippingMask(kind: 'layer' | 'group', id: string, enabled: boolean): void
  setGroupProperties(groupId: string, name: string, opacity: number, blendMode: BlendMode, locked: boolean, displayColor?: RgbaColor | null, description?: string, cumulativeBlend?: boolean): void
  toggleLayerVisibility(layerId: string): void
  selectLayer(layerId: string, mode?: boolean | 'replace' | 'toggle' | 'range'): void
  selectMoveToolLayer(layerId: string, additive?: boolean): void
  renameLayer(layerId: string, name: string): void
  setLayerOpacity(layerId: string, opacity: number): void
  setLayerProperties(layerId: string, name: string, opacity: number): void
  setLayerPropertiesWithBlend(layerId: string, name: string, opacity: number, blendMode: BlendMode, locked?: boolean, displayColor?: RgbaColor | null, description?: string): void
  applyActiveLayerAdjustment(adjustment: ColorAdjustment): void
  captureActiveLayerAdjustmentSnapshot(): AdjustmentSnapshot | null
  previewActiveLayerAdjustment(adjustment: ColorAdjustment, baseline: AdjustmentSnapshot, selection?: SelectionMask | null): void
  restoreActiveDocumentSnapshot(snapshot: AdjustmentSnapshot): void
  applyActiveLayerAdjustmentFromSnapshot(adjustment: ColorAdjustment, baseline: AdjustmentSnapshot): void
  deleteSelection(): void
  fillForeground(): void
  setOutlinePreview(preview: OutlinePreview | null): void
  outlineActiveSelection(color: RgbaColor, thickness: number, position: OutlinePosition, directions?: OutlineDirections, kernel?: OutlineKernel, previewEnabled?: boolean): boolean
  copySelection(): void
  copyActiveLayerToClipboard(): void
  copySelectedLayersToClipboard(): void
  cutSelection(): void
  pasteSelection(): Promise<void>
  pasteAsNewLayer(): Promise<boolean>
  pasteAsNewDocument(): Promise<boolean>
  pasteLayerFromClipboard(): boolean
  pasteLayersFromClipboard(): boolean
  beginFloatingSelectionTransform(source: SelectionTransformSource, edit: PixelEdit | null, before: SelectionMask, target: SelectionMask, copy: boolean, label: string, translationPreview?: SelectionTranslationPreview | null, transformTarget?: SelectionRect, transformAngle?: number, transformShear?: SelectionShearTransform): void
  commitFloatingPaste(): void
  cancelFloatingPaste(): void
  updateFloatingPastePreview(edit: PixelEdit | null, target: SelectionMask, translationPreview?: SelectionTranslationPreview | null, transformTarget?: SelectionRect, transformAngle?: number, transformShear?: SelectionShearTransform): void
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

function activeSession(state: WorkspaceState): DocumentSession | null {
  return state.sessions.find((session) => session.document.id === state.activeId) ?? null
}

const hasSelectedPaintTarget = (session: DocumentSession): boolean =>
  Boolean(session.activeLayerMaskId && findLayerMask(session.document, session.activeLayerMaskId))
  || session.selectedLayerIds.includes(session.document.activeLayerId)

const mergeSelectionRects = (first: SelectionRect, second: SelectionRect): SelectionRect => {
  const left = Math.min(first.x, second.x)
  const top = Math.min(first.y, second.y)
  const right = Math.max(first.x + first.width, second.x + second.width)
  const bottom = Math.max(first.y + first.height, second.y + second.height)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

const markFloatingPreviewChanged = (session: DocumentSession, before: SelectionRect, after: SelectionRect): void => {
  const fromRevision = session.contentRevision
  session.revision += 1
  session.contentRevision += 1
  session.contentInvalidation = {
    kind: 'region',
    frameId: session.document.animation?.activeFrameId,
    rect: mergeSelectionRects(before, after),
    fromRevision,
    revision: session.contentRevision
  }
}

const restoreFloatingPreview = (session: DocumentSession): void => {
  const pending = session.pendingPaste
  if (!pending) return
  if (pending.translationPreview) restoreSelectionTranslationPreview(session.document, pending.translationPreview)
  else if (pending.previewEdit) revertPixelEdit(session.document, pending.previewEdit)
}

const TIMELAPSE_CAPTURE_IDLE_MS = 300
const TIMELAPSE_CAPTURE_MIN_INTERVAL_MS = 1000
const TIMELAPSE_CAPTURE_MAX_WAIT_MS = 1200
interface PendingTimelapseCapture { timer: number; idleCallback?: number }
const pendingTimelapseCaptures = new Map<string, PendingTimelapseCapture>()
const timelapseCaptureCaches = new WeakMap<SpriteDocument, TimelapseCaptureCache>()

const captureCacheFor = (document: SpriteDocument): TimelapseCaptureCache => {
  const cached = timelapseCaptureCaches.get(document)
  if (cached) return cached
  const created = createTimelapseCaptureCache()
  timelapseCaptureCaches.set(document, created)
  return created
}

const cancelTimelapseCapture = (documentId: string): void => {
  const pending = pendingTimelapseCaptures.get(documentId)
  if (pending) {
    window.clearTimeout(pending.timer)
    if (pending.idleCallback !== undefined && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(pending.idleCallback)
  }
  pendingTimelapseCaptures.delete(documentId)
}

const scheduleTimelapseCapture = (session: DocumentSession): void => {
  const settings = normalizeTimelapseSettings(session.document.timelapse, session.document.timelapse?.snapshots ?? [])
  session.document.timelapse = settings
  cancelTimelapseCapture(session.document.id)
  if (!settings.enabled) return
  const document = session.document
  const lastSnapshotAt = settings.snapshots.at(-1)?.capturedAt ?? 0
  const elapsedSinceLastSnapshot = lastSnapshotAt > 0 ? Math.max(0, Date.now() - lastSnapshotAt) : Number.POSITIVE_INFINITY
  const captureDelay = Math.max(TIMELAPSE_CAPTURE_IDLE_MS, TIMELAPSE_CAPTURE_MIN_INTERVAL_MS - elapsedSinceLastSnapshot)
  const pending: PendingTimelapseCapture = { timer: 0 }
  const capture = (): void => {
    if (pendingTimelapseCaptures.get(document.id) !== pending) return
    pendingTimelapseCaptures.delete(document.id)
    const current = useWorkspace.getState().sessions.find((candidate) => candidate.document === document)
    if (!current || !normalizeTimelapseSettings(document.timelapse, document.timelapse?.snapshots ?? []).enabled) return
    if (current.animationPlaying) {
      scheduleTimelapseCapture(current)
      return
    }
    captureTimelapseSnapshot(document, Date.now(), {
      cache: captureCacheFor(document),
      contentRevision: current.contentRevision,
      contentInvalidation: current.contentInvalidation
    })
    useWorkspace.setState({ sessions: [...useWorkspace.getState().sessions] })
  }
  pending.timer = window.setTimeout(() => {
    if (pendingTimelapseCaptures.get(document.id) !== pending) return
    if (typeof window.requestIdleCallback === 'function') pending.idleCallback = window.requestIdleCallback(capture, { timeout: TIMELAPSE_CAPTURE_MAX_WAIT_MS })
    else capture()
  }, captureDelay)
  pendingTimelapseCaptures.set(document.id, pending)
}

const flushTimelapseCapture = (session: DocumentSession): void => {
  if (!pendingTimelapseCaptures.has(session.document.id) || session.animationPlaying) return
  cancelTimelapseCapture(session.document.id)
  if (normalizeTimelapseSettings(session.document.timelapse, session.document.timelapse?.snapshots ?? []).enabled) {
    captureTimelapseSnapshot(session.document, Date.now(), {
      cache: captureCacheFor(session.document),
      contentRevision: session.contentRevision,
      contentInvalidation: session.contentInvalidation
    })
  }
}

const recordDocumentOperation = (session: DocumentSession, activity?: { stroke?: boolean; durationMs?: number }): void => {
  const statistics = normalizeProjectStatistics(session.document.statistics)
  statistics.operationCount += 1
  if (activity?.stroke) statistics.strokeCount += 1
  if (activity?.durationMs) statistics.drawingTimeMs += Math.max(0, Math.round(activity.durationMs))
  session.document.statistics = statistics
  scheduleTimelapseCapture(session)
}

const persistDisplaySettings = (session: DocumentSession, view: Partial<ViewState>): boolean => {
  if (!('showPixelGrid' in view) && !('showGrid' in view) && !('grid' in view)) return false
  const current = normalizeProjectDisplaySettings(session.document.displaySettings)
  session.document.displaySettings = normalizeProjectDisplaySettings({
    ...current,
    ...('showPixelGrid' in view ? { showPixelGrid: view.showPixelGrid } : {}),
    ...('showGrid' in view ? { showGrid: view.showGrid } : {}),
    ...('grid' in view ? { grid: view.grid } : {})
  })
  return true
}

const cloneAnimationCelsForLayerIds = (document: SpriteDocument, layerIds: readonly string[], frameId?: string): AnimationCel[] => {
  syncActiveAnimationFrame(document)
  const ids = new Set(layerIds)
  const timeline = ensureAnimationDocument(document)
  return timeline.cels
    .filter((cel) => ids.has(cel.layerId) && (!frameId || cel.frameId === frameId))
    .map((cel) => {
      const mask = animationMaskAt(timeline, cel.layerId, cel.frameId)
      return { ...cel, surface: cel.surface ? cloneAnimationCelSurface(cel.surface) : undefined, mask: mask ? layerMaskFromClipboard(layerMaskClipboard(mask), cel.id) : undefined }
    })
}

type LayerRowSelectionMode = boolean | 'replace' | 'toggle' | 'range'

const selectedGroupRows = (session: DocumentSession): string[] =>
  session.selectedGroupIds.length > 0 ? [...session.selectedGroupIds] : session.selectedGroupId ? [session.selectedGroupId] : []

const selectedDirectLayerRows = (session: DocumentSession): string[] =>
  session.selectedGroupId && selectedGroupRows(session).length === 1 ? [] : [...session.selectedLayerIds]

const applyLayerCurrentFrameCellSelection = (session: DocumentSession, layerIds: readonly string[], anchorLayerId: string): void => {
  const timeline = ensureAnimationDocument(session.document)
  const selectedKeys = layerIds.map((id) => animationCelKey(id, timeline.activeFrameId))
  const anchorKey = animationCelKey(anchorLayerId, timeline.activeFrameId)
  session.selectedAnimationFrameIds = []
  session.animationFrameSelectionAnchorId = null
  session.selectedAnimationMaskCellKeys = []
  session.animationMaskCellSelectionAnchorKey = null
  session.selectedAnimationCellKeys = selectedKeys
  session.animationCellSelectionAnchorKey = selectedKeys.includes(anchorKey) ? anchorKey : selectedKeys.at(-1) ?? null
}

const layerHistoryBytes = (layer: RasterLayer): number => layer.pixels.byteLength
const groupHistoryBytes = (_group: LayerGroup): number => 96

const applyLayerRowSelection = (session: DocumentSession, layerIds: readonly string[], groupIds: readonly string[], focus: { kind: 'layer' | 'group'; id: string }): void => {
  session.activeLayerMaskId = null
  session.layerMaskIsolatedView = false
  const selectedLayers = [...new Set(layerIds)].filter((id) => session.document.layers.some((layer) => layer.id === id))
  const selectedGroups = [...new Set(groupIds)].filter((id) => session.document.groups.some((group) => group.id === id))
  session.selectedGroupIds = selectedGroups
  if (selectedGroups.length === 1 && selectedLayers.length === 0) {
    session.selectedGroupId = selectedGroups[0]
    session.selectedLayerIds = getLayerIdsInGroup(session.document, selectedGroups[0])
  } else {
    session.selectedGroupId = null
    session.selectedLayerIds = selectedLayers
  }
  if (focus.kind === 'layer' && session.document.layers.some((layer) => layer.id === focus.id)) session.document.activeLayerId = focus.id
  else if (focus.kind === 'group') {
    const member = session.document.layers.find((layer) => getLayerIdsInGroup(session.document, focus.id).includes(layer.id))
    if (member) session.document.activeLayerId = member.id
  }
}

const applyLayerRowRange = (session: DocumentSession, target: { kind: 'layer' | 'group'; id: string }): void => {
  const nodes = buildLayerPanelTree({
    layers: session.document.layers,
    groups: session.document.groups,
    collapsedGroupIds: session.collapsedGroupIds
  })
  const visibleIds = nodes.map((node) => node.id)
  const currentRows = [...selectedGroupRows(session), ...selectedDirectLayerRows(session)]
  const anchorId = session.layerSelectionAnchorId && visibleIds.includes(session.layerSelectionAnchorId)
    ? session.layerSelectionAnchorId
    : currentRows.find((id) => visibleIds.includes(id)) ?? target.id
  const anchorIndex = visibleIds.indexOf(anchorId)
  const targetIndex = visibleIds.indexOf(target.id)
  if (anchorIndex < 0 || targetIndex < 0) {
    applyLayerRowSelection(session, target.kind === 'layer' ? [target.id] : [], target.kind === 'group' ? [target.id] : [], target)
    return
  }
  const selectedNodes = nodes.slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1)
  applyLayerRowSelection(
    session,
    selectedNodes.filter((node) => node.kind === 'layer').map((node) => node.id),
    selectedNodes.filter((node) => node.kind === 'group').map((node) => node.id),
    target
  )
}

const targetContainerTopIndex = (document: SpriteDocument, groupId: string | null): number => {
  if (!groupId) return document.layers.length
  const members = new Set(getLayerIdsInGroup(document, groupId))
  return document.layers.reduce((last, layer, index) => members.has(layer.id) ? index + 1 : last, 0)
}

const selectedRowInsertionTarget = (session: DocumentSession): LayerPanelRowMoveTarget => {
  const selectedGroups = new Set(selectedGroupRows(session))
  const selectedLayers = new Set(selectedDirectLayerRows(session))
  const row = buildLayerPanelTree({ layers: session.document.layers, groups: session.document.groups })
    .find((node) => node.kind === 'group' ? selectedGroups.has(node.id) : selectedLayers.has(node.id))
  return row
    ? { kind: 'row', rowKind: row.kind, id: row.id, position: 'above' }
    : { kind: 'edge', edge: 'top' }
}

const insertionTargetParent = (document: SpriteDocument, target: LayerPanelRowMoveTarget): string | null => {
  if (target.kind !== 'row' || !target.id || !target.rowKind) return null
  return target.rowKind === 'group'
    ? document.groups.find((group) => group.id === target.id)?.parentGroupId ?? null
    : document.layers.find((layer) => layer.id === target.id)?.groupId ?? null
}

const lockedLayerStructure = (document: SpriteDocument, layerIds: readonly string[]): boolean =>
  document.layers.some((layer) => layerIds.includes(layer.id) && isLayerEffectivelyLocked(document, layer))

const lockedGroupStructure = (document: SpriteDocument, groupId: string): boolean => {
  const groupIds = new Set([groupId, ...getDescendantGroupIds(document, groupId)])
  return document.groups.some((group) => groupIds.has(group.id) && isGroupEffectivelyLocked(document, group))
    || document.layers.some((layer) => Boolean(layer.groupId && groupIds.has(layer.groupId)) && isLayerEffectivelyLocked(document, layer))
}

const recoveryService = new RecoveryService()
const clipboardService = new ClipboardService()

const cloneColorReplacementPalette = (palette: SpriteDocument['palette']): SpriteDocument['palette'] =>
  palette.map((entry) => ({ ...entry, color: { ...entry.color } }))

const colorReplacementPalettesEqual = (left: SpriteDocument['palette'], right: SpriteDocument['palette']): boolean =>
  left.length === right.length && left.every((entry, index) => {
    const candidate = right[index]
    return Boolean(candidate && entry.id === candidate.id && colorEquals(entry.color, candidate.color))
  })

interface ColorReplacementResult {
  edits: PixelEdit[]
  pixelCount: number
  paletteCount: number
  lockedCount: number
}

const applyColorReplacementTarget = (session: DocumentSession, target: ColorReplacementTarget, sourceColor: RgbaColor, replacementColor: RgbaColor): ColorReplacementResult => {
  const edits: PixelEdit[] = []
  const seenPixels = new Set<object>()
  let lockedCount = 0
  const collect = (layer: RasterLayer | null, frameId?: string, selection: SelectionMask | null = null): void => {
    if (!layer || seenPixels.has(layer.pixels)) return
    seenPixels.add(layer.pixels)
    if (isLayerEffectivelyLocked(session.document, layer)) {
      lockedCount += 1
      return
    }
    const edit = replaceLayerColor(session.document, layer, sourceColor, replacementColor, selection)
    if (!edit) return
    if (frameId) edit.frameId = frameId
    edits.push(edit)
  }

  syncActiveAnimationFrame(session.document)
  const timeline = ensureAnimationDocument(session.document)
  if (target === 'palette') {
    let paletteCount = 0
    for (const entry of session.document.palette) {
      if (entry.id === 0 || !colorEquals(entry.color, sourceColor)) continue
      entry.color = { ...replacementColor }
      paletteCount += 1
    }
    if (colorEquals(session.primaryColor, sourceColor)) session.primaryColor = { ...replacementColor }
    if (colorEquals(session.secondaryColor, sourceColor)) session.secondaryColor = { ...replacementColor }
    return { edits, pixelCount: 0, paletteCount, lockedCount }
  }

  if (target === 'layer') {
    collect(activePaintLayer(session), timeline.activeFrameId)
  } else if (target === 'selection') {
    if (session.selection) collect(activePaintLayer(session), timeline.activeFrameId, session.selection)
  } else if (target === 'document') {
    for (const frame of timeline.frames) for (const layer of session.document.layers) collect(animationLayerAtFrame(session.document, layer.id, frame.id), frame.id)
  } else if (target === 'layers') {
    const layerIds = new Set(session.selectedLayerIds)
    for (const frame of timeline.frames) for (const layerId of layerIds) collect(animationLayerAtFrame(session.document, layerId, frame.id), frame.id)
  } else if (target === 'frames') {
    const frameIds = new Set(session.selectedAnimationFrameIds)
    for (const frameId of frameIds) for (const layer of session.document.layers) collect(animationLayerAtFrame(session.document, layer.id, frameId), frameId)
  } else {
    for (const key of session.selectedAnimationCellKeys) {
      const cell = parseAnimationCelKey(key)
      if (cell) collect(animationLayerAtFrame(session.document, cell.layerId, cell.frameId), cell.frameId)
    }
  }

  return {
    edits,
    pixelCount: edits.reduce((count, edit) => count + edit.before.size, 0),
    paletteCount: 0,
    lockedCount
  }
}

const restoreColorReplacementPreviewState = (session: DocumentSession, preview: ColorReplacementPreview): void => {
  for (let index = preview.edits.length - 1; index >= 0; index -= 1) revertPixelEdit(session.document, preview.edits[index])
  session.document.palette = cloneColorReplacementPalette(preview.palette)
  session.document.nextColorId = preview.nextColorId
  session.primaryColor = { ...preview.primaryColor }
  session.secondaryColor = { ...preview.secondaryColor }
  syncActiveAnimationFrame(session.document)
}

const invalidateColorReplacementPreview = (session: DocumentSession): void => {
  session.revision += 1
  session.contentRevision += 1
}

const tr = (key: TranslationKey, params?: TranslationParams): string => translate(loadEditorPreferences().language, key, params)
const paletteEditSynchronizationLocked = (): boolean => readStoredString('moonsprite.palette-edit-locked') !== 'false'

const layerMaskClipboard = (mask: LayerMask | undefined): LayerMaskClipboard | undefined => mask ? {
  width: mask.width,
  height: mask.height,
  offsetX: mask.offsetX,
  offsetY: mask.offsetY,
  pixels: new Uint8ClampedArray(mask.pixels)
} : undefined

const layerMaskFromClipboard = (source: LayerMaskClipboard | undefined, ownerId: string): LayerMask | undefined => {
  if (!source) return undefined
  const mask = createAttachedLayerMask(ownerId, source.width, source.height)
  mask.offsetX = source.offsetX
  mask.offsetY = source.offsetY
  mask.pixels.set(source.pixels)
  return mask
}

type AnimationMaskOwnerKind = 'layer' | 'group'
interface AnimationMaskSlotSnapshot {
  ownerId: string
  frameId: string
  ownerKind: AnimationMaskOwnerKind
  mask: LayerMask | null
}

const animationMaskOwnerKind = (document: SpriteDocument, ownerId: string): AnimationMaskOwnerKind | null =>
  document.layers.some((layer) => layer.id === ownerId) ? 'layer' : document.groups.some((group) => group.id === ownerId) ? 'group' : null

const directAnimationMaskAt = (document: SpriteDocument, ownerId: string, frameId: string): LayerMask | null => {
  const timeline = ensureAnimationDocument(document)
  const kind = animationMaskOwnerKind(document, ownerId)
  if (kind === 'layer') return timeline.cels.find((cel) => cel.layerId === ownerId && cel.frameId === frameId)?.mask ?? null
  if (kind === 'group') return (timeline.groupMasks ?? []).find((entry) => entry.groupId === ownerId && entry.frameId === frameId)?.mask ?? null
  return null
}

const cloneAnimationMaskForOwner = (source: LayerMask, ownerKind: AnimationMaskOwnerKind, ownerStorageId: string, options: { id?: string; preserveLink?: boolean } = {}): LayerMask => ({
  ...source,
  id: options.id ?? source.id,
  ownerKind: ownerKind === 'layer' ? 'cel' : 'group',
  ownerId: ownerStorageId,
  linkedMaskId: options.preserveLink === false ? null : source.linkedMaskId,
  pixels: new Uint8ClampedArray(source.pixels)
})

const ensureAnimationCelSlot = (document: SpriteDocument, layerId: string, frameId: string): { cel: AnimationCel; created: boolean } | null => {
  const timeline = ensureAnimationDocument(document)
  const existing = timeline.cels.find((candidate) => candidate.layerId === layerId && candidate.frameId === frameId)
  if (existing) return { cel: existing, created: false }
  const layer = document.layers.find((candidate) => candidate.id === layerId)
  if (!layer || !timeline.frames.some((frame) => frame.id === frameId)) return null
  const cel: AnimationCel = {
    id: createId('cel'),
    layerId,
    frameId,
    opacity: layer.opacity,
    surface: layer.format === 'rgba'
      ? { format: 'rgba', width: 1, height: 1, offsetX: 0, offsetY: 0, pixels: new Uint8ClampedArray(4) }
      : { format: 'indexed', width: 1, height: 1, offsetX: 0, offsetY: 0, pixels: new Uint32Array(1) }
  }
  timeline.cels.push(cel)
  return { cel, created: true }
}

const setAnimationMaskSlot = (document: SpriteDocument, ownerId: string, frameId: string, mask: LayerMask | null): void => {
  const timeline = ensureAnimationDocument(document)
  const ownerKind = animationMaskOwnerKind(document, ownerId)
  if (ownerKind === 'layer') {
    const cel = timeline.cels.find((candidate) => candidate.layerId === ownerId && candidate.frameId === frameId)
      ?? (mask ? ensureAnimationCelSlot(document, ownerId, frameId)?.cel : undefined)
    if (!cel) return
    cel.mask = mask ? cloneAnimationMaskForOwner(mask, ownerKind, cel.id) : undefined
    return
  }
  if (ownerKind !== 'group') return
  timeline.groupMasks = (timeline.groupMasks ?? []).filter((entry) => entry.groupId !== ownerId || entry.frameId !== frameId)
  if (mask) {
    timeline.groupMasks.push({ groupId: ownerId, frameId, mask: cloneAnimationMaskForOwner(mask, ownerKind, ownerId) })
  }
}

const animationMaskSlotSnapshot = (document: SpriteDocument, ownerId: string, frameId: string): AnimationMaskSlotSnapshot | null => {
  const ownerKind = animationMaskOwnerKind(document, ownerId)
  if (!ownerKind) return null
  const mask = directAnimationMaskAt(document, ownerId, frameId)
  return { ownerId, frameId, ownerKind, mask: mask ? cloneAnimationMaskForOwner(mask, ownerKind, mask.ownerId) : null }
}

const restoreAnimationMaskSlots = (document: SpriteDocument, snapshots: readonly AnimationMaskSlotSnapshot[]): void => {
  for (const snapshot of snapshots) setAnimationMaskSlot(document, snapshot.ownerId, snapshot.frameId, snapshot.mask)
}

const animationMaskOwnerIds = (session: DocumentSession): string[] => buildLayerPanelTree({
  layers: session.document.layers,
  groups: session.document.groups,
  collapsedGroupIds: []
}).map((node) => node.id)

const mapAnimationMaskBlock = (session: DocumentSession, sourceKeys: readonly string[], sourceAnchorKey: string, targetOwnerId: string, targetFrameId: string): Array<{ sourceKey: string; targetKey: string }> => {
  const timeline = ensureAnimationDocument(session.document)
  const ownerIds = animationMaskOwnerIds(session)
  const sourceAnchor = parseAnimationCelKey(sourceAnchorKey)
  const targetOwnerIndex = ownerIds.indexOf(targetOwnerId)
  const targetFrameIndex = timeline.frames.findIndex((frame) => frame.id === targetFrameId)
  if (!sourceAnchor || targetOwnerIndex < 0 || targetFrameIndex < 0) return []
  const sourceOwnerIndex = ownerIds.indexOf(sourceAnchor.layerId)
  const sourceFrameIndex = timeline.frames.findIndex((frame) => frame.id === sourceAnchor.frameId)
  if (sourceOwnerIndex < 0 || sourceFrameIndex < 0) return []
  const placements = sourceKeys.flatMap((sourceKey) => {
    const source = parseAnimationCelKey(sourceKey)
    if (!source) return []
    const ownerIndex = ownerIds.indexOf(source.layerId)
    const frameIndex = timeline.frames.findIndex((frame) => frame.id === source.frameId)
    const destinationOwner = ownerIds[targetOwnerIndex + ownerIndex - sourceOwnerIndex]
    const destinationFrame = timeline.frames[targetFrameIndex + frameIndex - sourceFrameIndex]
    return destinationOwner && destinationFrame ? [{ sourceKey, targetKey: animationCelKey(destinationOwner, destinationFrame.id) }] : []
  })
  return placements.length === sourceKeys.length && new Set(placements.map((placement) => placement.targetKey)).size === placements.length ? placements : []
}

const animationMaskPlacementsTargetEmptyLayerCel = (session: DocumentSession, placements: readonly { targetKey: string }[]): boolean => {
  const timeline = ensureAnimationDocument(session.document)
  return placements.some(({ targetKey }) => {
    const target = parseAnimationCelKey(targetKey)
    if (!target || animationMaskOwnerKind(session.document, target.layerId) !== 'layer') return false
    const cel = timeline.cels.find((candidate) => candidate.layerId === target.layerId && candidate.frameId === target.frameId) ?? null
    return !animationCelHasContent(resolveAnimationCel(timeline, cel), session.document.palette)
  })
}

const animationMaskOwnerLocked = (document: SpriteDocument, ownerId: string): boolean => {
  const layer = document.layers.find((candidate) => candidate.id === ownerId)
  if (layer) return isLayerEffectivelyLocked(document, layer)
  const group = document.groups.find((candidate) => candidate.id === ownerId)
  return group ? isGroupEffectivelyLocked(document, group) : true
}

function layerClipboardFromDocument(document: SpriteDocument, layer: RasterLayer, groupKey: string | null = null): LayerClipboard {
  const pixels = new Uint8ClampedArray(layer.width * layer.height * 4)
  for (let y = 0; y < layer.height; y += 1) for (let x = 0; x < layer.width; x += 1) {
    const color = readLayerColorAt(document, layer, layer.offsetX + x, layer.offsetY + y)
    const offset = (y * layer.width + x) * 4
    pixels[offset] = color.r
    pixels[offset + 1] = color.g
    pixels[offset + 2] = color.b
    pixels[offset + 3] = color.a
  }
  const timeline = ensureAnimationDocument(document)
  const paletteById = new Map(document.palette.map((entry) => [entry.id, entry.color]))
  const animationCels = timeline.frames.flatMap((frame, frameIndex) => {
    const cel = timeline.cels.find((candidate) => candidate.layerId === layer.id && candidate.frameId === frame.id)
    const surface = cel?.surface
    if (!surface) return []
    const rgba = new Uint8ClampedArray(surface.width * surface.height * 4)
    if (surface.format === 'rgba') rgba.set(surface.pixels)
    else for (let index = 0; index < surface.pixels.length; index += 1) {
      const color = paletteById.get(surface.pixels[index]) ?? { r: 0, g: 0, b: 0, a: 0 }
      const offset = index * 4
      rgba[offset] = color.r
      rgba[offset + 1] = color.g
      rgba[offset + 2] = color.b
      rgba[offset + 3] = color.a
    }
    return [{
      frameIndex,
      width: surface.width,
      height: surface.height,
      offsetX: surface.offsetX,
      offsetY: surface.offsetY,
      storageOriginX: surface.storageOriginX,
      storageOriginY: surface.storageOriginY,
      opacity: cel.opacity,
      pixels: rgba,
      mask: layerMaskClipboard(animationMaskAt(timeline, layer.id, frame.id) ?? undefined)
    }]
  })
  return {
    name: layer.name,
    width: layer.width,
    height: layer.height,
    offsetX: layer.offsetX,
    offsetY: layer.offsetY,
    visible: layer.visible,
    locked: layer.locked,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    clippingMask: layer.clippingMask === true,
    displayColor: layer.displayColor ? { ...layer.displayColor } : undefined,
    description: layer.description ?? '',
    groupKey,
    pixels,
    animationCels
  }
}

function applyLayerClipboardAnimationCel(document: SpriteDocument, layer: RasterLayer, source: NonNullable<LayerClipboard['animationCels']>[number]): void {
  const timeline = ensureAnimationDocument(document)
  const frame = timeline.frames[source.frameIndex]
  const cel = frame ? timeline.cels.find((candidate) => candidate.layerId === layer.id && candidate.frameId === frame.id) : null
  if (!cel) return
  cel.opacity = source.opacity ?? layer.opacity
  cel.surface = layer.format === 'rgba'
    ? { format: 'rgba', width: source.width, height: source.height, offsetX: source.offsetX, offsetY: source.offsetY, storageOriginX: source.storageOriginX, storageOriginY: source.storageOriginY, pixels: source.pixels.slice() }
    : {
        format: 'indexed', width: source.width, height: source.height, offsetX: source.offsetX, offsetY: source.offsetY, storageOriginX: source.storageOriginX, storageOriginY: source.storageOriginY,
        pixels: Uint32Array.from({ length: source.width * source.height }, (_, index) => {
          const offset = index * 4
          return findOrAddPaletteColor(document, { r: source.pixels[offset], g: source.pixels[offset + 1], b: source.pixels[offset + 2], a: source.pixels[offset + 3] })
        })
      }
  cel.mask = layerMaskFromClipboard(source.mask, cel.id)
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  sessions: [],
  activeId: null,
  sharedPrimaryColor: { r: 41, g: 121, b: 255, a: 255 },
  sharedSecondaryColor: { r: 241, g: 244, b: 248, a: 255 },
  message: null,
  saveProgress: null,
  dialog: null,
  recoveryRecords: [],

  async newDocument(name, width, height, colorMode) {
    try {
      const resource = await window.moonSprite.getResourceInfo()
      const check = checkResourceLimit(width, height, 1, colorMode, resource)
      if (!check.allowed) throw new Error(check.reason)
      get().addSession(createDocument(name || tr('workspace.defaultName'), width, height, colorMode))
    } catch (error) {
      set({ message: error instanceof Error ? error.message : tr('workspace.canvasCreateError') })
    }
  },

  async createSpriteSheetFromActive() {
    get().commitFloatingPaste()
    const sourceSession = activeSession(get())
    if (!sourceSession) return false
    const source = sourceSession.document
    const frameCount = ensureAnimationDocument(source).frames.length
    const width = source.width * frameCount
    try {
      const resource = await window.moonSprite.getResourceInfo()
      const check = checkResourceLimit(width, source.height, 1, 'rgba', resource)
      if (!check.allowed) throw new Error(check.reason)
      const document = createHorizontalSpriteSheetDocument(source, {
        document: tr('workspace.spriteSheet.documentName', { name: source.name }),
        layer: tr('workspace.spriteSheet.layerName')
      })
      document.dirty = true
      get().addSession(document)
      set({ message: tr('workspace.spriteSheet.created', { count: frameCount }) })
      return true
    } catch (error) {
      set({ message: error instanceof Error ? error.message : tr('workspace.spriteSheet.error') })
      return false
    }
  },

  async resizeActiveCanvas(width, height, anchor, offsetX, offsetY, trimOutside = false) {
    const current = activeSession(get())
    if (!current || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) { set({ message: tr('workspace.canvasSizePositive') }); return }
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
        resizeAnimationCelsAt(session.document, resized.offsetX, resized.offsetY, trimOutside)
        session.selection = shiftSelection(beforeSelection, resized.offsetX, resized.offsetY, width, height)
        session.canvasResizePreview = null
        session.lastPencilPoint = null
        session.lastEraserPoint = null
        const after = encodeProject(session.document)
        const afterSelection = session.selection ? { ...session.selection, mask: session.selection.mask?.slice() } : null
        session.history.push({
          label: tr('canvasResize.title'), bytes: before.byteLength + after.byteLength + (beforeSelection?.mask?.byteLength ?? 0) + (afterSelection?.mask?.byteLength ?? 0),
          undo: () => { restoreDocumentSnapshot(session.document, before); session.selection = beforeSelection ? { ...beforeSelection, mask: beforeSelection.mask?.slice() } : null },
          redo: () => { restoreDocumentSnapshot(session.document, after); session.selection = afterSelection ? { ...afterSelection, mask: afterSelection.mask?.slice() } : null }
        })
      })
    } catch (error) {
      set({ message: error instanceof Error ? error.message : tr('workspace.canvasResizeError') })
    }
  },

  async resizeActiveImage(width, height, interpolation) {
    const current = activeSession(get())
    if (!current || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) { set({ message: tr('workspace.imageSizePositive') }); return }
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
          label: tr('imageResize.title'), bytes: before.byteLength + after.byteLength + (beforeSelection?.mask?.byteLength ?? 0) + (afterSelection?.mask?.byteLength ?? 0),
          undo: () => { restoreDocumentSnapshot(session.document, before); session.selection = beforeSelection ? { ...beforeSelection, mask: beforeSelection.mask?.slice() } : null },
          redo: () => { restoreDocumentSnapshot(session.document, after); session.selection = afterSelection ? { ...afterSelection, mask: afterSelection.mask?.slice() } : null }
        })
      })
    } catch (error) {
      set({ message: error instanceof Error ? error.message : tr('workspace.imageResizeError') })
    }
  },

  addSession(document) {
    const existing = get().sessions.find((session) => session.document.id === document.id)
    if (existing) return
    const session = sessionFromDocument(document)
    session.primaryColor = { ...get().sharedPrimaryColor }
    session.secondaryColor = { ...get().sharedSecondaryColor }
    set((state) => ({ sessions: [...state.sessions, session], activeId: document.id, message: null }))
  },

  reorderSessions(documentIds) {
    set((state) => {
      const byId = new Map(state.sessions.map((session) => [session.document.id, session]))
      const seen = new Set<string>()
      const ordered = documentIds.flatMap((documentId) => {
        const session = byId.get(documentId)
        if (!session || seen.has(documentId)) return []
        seen.add(documentId)
        return [session]
      })
      for (const session of state.sessions) if (!seen.has(session.document.id)) ordered.push(session)
      return { sessions: ordered }
    })
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
  setBrushDynamicsMapping(effect, patch) {
    get().mutateActive((session) => {
      if (session.tool !== 'pencil' && session.tool !== 'eraser') return
      session.brushDynamics = patchBrushDynamicsMapping(session.brushDynamics, effect, patch)
      session.brushPressure = brushPressureFromDynamics(session.brushDynamics)
      rememberBrushProfile(session)
      persistToolSettings(session)
    }, false)
  },
  setBrushDynamicsGradientDither(dither) {
    get().mutateActive((session) => {
      if (session.tool !== 'pencil' && session.tool !== 'eraser') return
      session.brushDynamics = patchBrushDynamicsGradientDither(session.brushDynamics, dither)
      rememberBrushProfile(session)
      persistToolSettings(session)
    }, false)
  },
  setBrushPressure(settings) {
    get().mutateActive((session) => {
      if (session.tool !== 'pencil' && session.tool !== 'eraser') return
      session.brushPressure = normalizeBrushPressureSettings(settings, session.brushPressure)
      session.brushDynamics = migrateBrushPressureSettings(session.brushPressure)
      rememberBrushProfile(session)
      persistToolSettings(session)
    }, false)
  },
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
    if (!session?.selection) { set({ message: tr('workspace.selectionRequired') }); return }
    const brush = createSelectionBrush(session.document, session.selection, `project-brush-${createId('brush')}`, tr('brush.defaultName'))
    if (!brush) { set({ message: tr('workspace.brushEmpty') }); return }
    get().setTemporaryBrush(brush)
    set({ message: tr('workspace.brushSaved') })
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
  setShapeRatio(ratio) {
    get().mutateActive((session) => {
      session.shapeRatio = ratio === null ? null : {
        width: Math.round(Math.max(0.1, Math.min(100, ratio.width)) * 10) / 10,
        height: Math.round(Math.max(0.1, Math.min(100, ratio.height)) * 10) / 10
      }
      persistToolSettings(session)
    }, false)
  },
  setFillMode(mode) {
    get().mutateActive((session) => {
      session.fillMode = mode === 'contiguous' && session.fillMode === 'contiguous' ? 'global' : mode
      persistToolSettings(session)
    }, false)
  },
  setFillKind(kind) { get().mutateActive((session) => { session.fillKind = kind; persistToolSettings(session) }, false) },
  setFillTolerance(tolerance) { get().mutateActive((session) => { session.fillTolerance = Math.max(0, Math.min(255, Math.round(tolerance) || 0)); persistToolSettings(session) }, false) },
  setGradientTolerance(tolerance) { get().mutateActive((session) => { session.gradientTolerance = Math.max(0, Math.min(255, Math.round(tolerance) || 0)); persistToolSettings(session) }, false) },
  setGradientContiguous(contiguous) { get().mutateActive((session) => { session.gradientContiguous = contiguous; persistToolSettings(session) }, false) },
  setGradientDither(dither) { get().mutateActive((session) => { session.gradientDither = dither; persistToolSettings(session) }, false) },
  setMoveAutoSelect(enabled) { get().mutateActive((session) => { session.moveAutoSelect = enabled; persistToolSettings(session) }, false) },
  setPrimaryColor(color) {
    const state = get()
    for (const session of state.sessions) {
      const previous = { ...session.primaryColor }
      const paletteId = session.paletteSelectionId
      const paletteEntry = paletteId === null ? null : session.document.palette.find((entry) => entry.id === paletteId)
      if (paletteId !== null && paletteEntry && !paletteEditSynchronizationLocked() && colorEquals(paletteEntry.color, previous)) updatePaletteColorCommand(session, paletteId, color)
      session.primaryColor = { ...color }
      if (session.brushImage?.intrinsicSize) session.brushImage = remapSelectionBrushColors(session.brushImage, session.primaryColor, session.secondaryColor)
      const matching = paletteEntry && colorEquals(paletteEntry.color, color)
        ? paletteEntry
        : session.document.palette.find((entry) => session.document.paletteOrder.includes(entry.id) && colorEquals(entry.color, color))
      session.paletteSelectionId = matching?.id ?? null
      session.selectedPaletteIds = matching
        ? session.selectedPaletteIds.includes(matching.id) ? session.selectedPaletteIds : [matching.id]
        : []
    }
    set({ sharedPrimaryColor: { ...color }, sessions: [...state.sessions] })
  },
  setSecondaryColor(color) {
    const state = get()
    for (const session of state.sessions) {
      const previous = { ...session.secondaryColor }
      const paletteId = session.paletteSecondarySelectionId
      const paletteEntry = paletteId === null ? null : session.document.palette.find((entry) => entry.id === paletteId)
      if (paletteId !== null && paletteEntry && !paletteEditSynchronizationLocked() && colorEquals(paletteEntry.color, previous)) updatePaletteColorCommand(session, paletteId, color)
      session.secondaryColor = { ...color }
      if (session.brushImage?.intrinsicSize) session.brushImage = remapSelectionBrushColors(session.brushImage, session.primaryColor, session.secondaryColor)
      const matching = paletteEntry && colorEquals(paletteEntry.color, color)
        ? paletteEntry
        : session.document.palette.find((entry) => session.document.paletteOrder.includes(entry.id) && colorEquals(entry.color, color))
      session.paletteSecondarySelectionId = matching?.id ?? null
    }
    set({ sharedSecondaryColor: { ...color }, sessions: [...state.sessions] })
  },
  replaceColor(target, sourceColor, replacementColor) {
    const state = get()
    const session = activeSession(state)
    if (!session) return
    if (colorEquals(sourceColor, replacementColor)) {
      set({ message: tr('workspace.colorReplace.sameColor') })
      return
    }
    const beforePalette = cloneColorReplacementPalette(session.document.palette)
    const beforeNextColorId = session.document.nextColorId
    const beforePrimaryColor = { ...session.primaryColor }
    const beforeSecondaryColor = { ...session.secondaryColor }
    const result = applyColorReplacementTarget(session, target, sourceColor, replacementColor)
    const labels: Record<ColorReplacementTarget, string> = {
      layer: tr('workspace.history.replaceColorLayer'),
      document: tr('workspace.history.replaceColorDocument'),
      selection: tr('workspace.history.replaceColorSelection'),
      layers: tr('workspace.history.replaceColorLayers'),
      frames: tr('workspace.history.replaceColorFrames'),
      cells: tr('workspace.history.replaceColorCells'),
      palette: tr('workspace.history.replaceColorPalette')
    }
    const label = labels[target]
    const entries = result.edits.map((edit) => commitPixelEdit(session.document, edit, label)).filter((entry): entry is HistoryEntry => Boolean(entry))
    const afterPalette = cloneColorReplacementPalette(session.document.palette)
    const afterNextColorId = session.document.nextColorId
    const afterPrimaryColor = { ...session.primaryColor }
    const afterSecondaryColor = { ...session.secondaryColor }
    const paletteChanged = beforeNextColorId !== afterNextColorId || !colorReplacementPalettesEqual(beforePalette, afterPalette)
    if (entries.length === 0 && !paletteChanged) {
      set({ message: tr(result.lockedCount > 0 ? 'workspace.colorReplace.locked' : 'workspace.colorReplace.noMatch') })
      return
    }
    session.history.push({
      label,
      bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0) + (beforePalette.length + afterPalette.length) * 24,
      undo: () => {
        for (let index = entries.length - 1; index >= 0; index -= 1) entries[index].undo()
        session.document.palette = cloneColorReplacementPalette(beforePalette)
        session.document.nextColorId = beforeNextColorId
        session.primaryColor = { ...beforePrimaryColor }
        session.secondaryColor = { ...beforeSecondaryColor }
      },
      redo: () => {
        session.document.palette = cloneColorReplacementPalette(afterPalette)
        session.document.nextColorId = afterNextColorId
        session.primaryColor = { ...afterPrimaryColor }
        session.secondaryColor = { ...afterSecondaryColor }
        for (const entry of entries) entry.redo()
      },
      invalidation: { kind: 'full' }
    })
    syncActiveAnimationFrame(session.document)
    touch(session, true, { kind: 'full' })
    recordDocumentOperation(session)
    set({ sessions: [...state.sessions], message: tr('workspace.colorReplace.done', { count: result.pixelCount + result.paletteCount }) })
  },
  previewColorReplacement(target, sourceColor, replacementColor, previous = null) {
    const state = get()
    const changedSessions = new Set<DocumentSession>()
    if (previous) {
      const previousSession = state.sessions.find((candidate) => candidate.document.id === previous.documentId)
      if (previousSession) {
        restoreColorReplacementPreviewState(previousSession, previous)
        changedSessions.add(previousSession)
      }
    }
    const session = activeSession(state)
    if (!session || colorEquals(sourceColor, replacementColor)) {
      for (const changed of changedSessions) invalidateColorReplacementPreview(changed)
      if (changedSessions.size > 0) set({ sessions: [...state.sessions] })
      return null
    }
    const preview: ColorReplacementPreview = {
      documentId: session.document.id,
      edits: [],
      palette: cloneColorReplacementPalette(session.document.palette),
      nextColorId: session.document.nextColorId,
      primaryColor: { ...session.primaryColor },
      secondaryColor: { ...session.secondaryColor }
    }
    const result = applyColorReplacementTarget(session, target, sourceColor, replacementColor)
    preview.edits = result.edits
    const paletteChanged = preview.nextColorId !== session.document.nextColorId || !colorReplacementPalettesEqual(preview.palette, session.document.palette)
    if (result.edits.length === 0 && !paletteChanged) {
      for (const changed of changedSessions) invalidateColorReplacementPreview(changed)
      if (changedSessions.size > 0) set({ sessions: [...state.sessions] })
      return null
    }
    syncActiveAnimationFrame(session.document)
    changedSessions.add(session)
    for (const changed of changedSessions) invalidateColorReplacementPreview(changed)
    set({ sessions: [...state.sessions] })
    return preview
  },
  restoreColorReplacementPreview(preview) {
    if (!preview) return
    const state = get()
    const session = state.sessions.find((candidate) => candidate.document.id === preview.documentId)
    if (!session) return
    restoreColorReplacementPreviewState(session, preview)
    invalidateColorReplacementPreview(session)
    set({ sessions: [...state.sessions] })
  },
  selectSecondaryPaletteColor(id) {
    get().mutateActive((session) => {
      const entry = session.document.palette.find((candidate) => candidate.id === id)
      if (!entry) return
      session.paletteSecondarySelectionId = id
      session.secondaryColor = { ...entry.color }
    }, false)
    const session = activeSession(get())
    if (session) set({ sharedSecondaryColor: { ...session.secondaryColor } })
  },
  swapPrimarySecondaryColors() {
    const state = get()
    const primary = { ...state.sharedPrimaryColor }
    const secondary = { ...state.sharedSecondaryColor }
    for (const session of state.sessions) {
      session.primaryColor = { ...secondary }
      session.secondaryColor = { ...primary }
      const previousPrimaryId = session.paletteSelectionId
      session.paletteSecondarySelectionId = previousPrimaryId
      if (session.brushImage?.intrinsicSize) session.brushImage = remapSelectionBrushColors(session.brushImage, session.primaryColor, session.secondaryColor)
      const matching = session.document.palette.find((entry) => session.document.paletteOrder.includes(entry.id) && colorEquals(entry.color, session.primaryColor))
      session.paletteSelectionId = matching?.id ?? null
      session.selectedPaletteIds = matching
        ? session.selectedPaletteIds.includes(matching.id) ? session.selectedPaletteIds : [matching.id]
        : []
    }
    set({ sharedPrimaryColor: secondary, sharedSecondaryColor: primary, sessions: [...state.sessions] })
  },
  setView(view) {
    const state = get()
    const session = activeSession(state)
    if (!session) return
    Object.assign(session.view, view)
    if (persistDisplaySettings(session, view)) touch(session)
    set({ sessions: [...state.sessions] })
  },
  setViewForDocument(documentId, view) {
    const state = get()
    const session = state.sessions.find((item) => item.document.id === documentId)
    if (!session) return
    Object.assign(session.view, view)
    if (persistDisplaySettings(session, view)) touch(session)
    set({ sessions: [...state.sessions] })
  },
  setViewportSize(size) {
    get().mutateActive((session) => {
      session.viewportSize = { width: Math.max(0, size.width), height: Math.max(0, size.height) }
    }, false)
  },
  setViewportSizeForDocument(documentId, size) {
    const state = get()
    const session = state.sessions.find((item) => item.document.id === documentId)
    if (!session) return
    session.viewportSize = { width: Math.max(0, size.width), height: Math.max(0, size.height) }
    set({ sessions: [...state.sessions] })
  },
  setSelection(selection) { get().mutateActive((session) => { session.selection = selection ? { ...selection, mask: selection.mask?.slice() } : null }, false) },
  invertSelection() {
    const session = activeSession(get())
    if (!session?.selection) { set({ message: tr('workspace.selectionRequired') }); return }
    const before = cloneSelectionMask(session.selection)
    const after = invertSelectionMask(session.selection, session.document.width, session.document.height)
    get().commitSelectionChange(before, after, tr('app.menu.edit.invertSelection'))
  },
  toggleSelectionOutline() {
    get().mutateActive((session) => {
      session.view.showSelectionOutline = session.view.showSelectionOutline === false
      // 选区描边是视图状态，但切换时必须让合成缓存重新读取浮动粘贴的当前像素。
      session.revision += 1
    }, false)
  },
  beginLayerTransform() {
    get().commitFloatingPaste()
    const session = activeSession(get())
    if (!session) return
    if (session.selectedGroupId || session.selectedLayerIds.length !== 1) {
      set({ message: tr('workspace.transform.selectLayer') })
      return
    }
    const layer = session.document.layers.find((candidate) => candidate.id === session.selectedLayerIds[0])
    if (!layer) {
      set({ message: tr('workspace.transform.noLayer') })
      return
    }
    if (!isLayerEffectivelyVisible(session.document, layer)) {
      set({ message: tr('workspace.transform.hidden') })
      return
    }
    if (isLayerEffectivelyLocked(session.document, layer)) {
      set({ message: tr('workspace.transform.locked') })
      return
    }
    const contentBounds = layerContentBounds(session.document, layer)
    if (!contentBounds) {
      set({ message: tr('workspace.transform.empty') })
      return
    }
    const visibleBounds = clampSelection(session.document, contentBounds)
    if (!visibleBounds) {
      set({ message: tr('workspace.transform.outside') })
      return
    }
    get().setTool('selection')
    get().mutateActive((active) => {
      active.document.activeLayerId = layer.id
      active.selectedGroupId = null
      active.selectedGroupIds = []
      active.selectedLayerIds = [layer.id]
      active.selection = visibleBounds
      active.selectionKind = 'rectangle'
      active.selectionMode = 'replace'
    }, false)
    set({ message: tr('workspace.transform.started') })
  },
  setSelectionKind(kind) { get().mutateActive((session) => { session.selectionKind = kind; persistToolSettings(session) }, false) },
  setSelectionMode(mode) { get().mutateActive((session) => { session.selectionMode = mode; persistToolSettings(session) }, false) },
  setWandTolerance(tolerance) { get().mutateActive((session) => { session.wandTolerance = Math.max(0, Math.min(255, Math.round(tolerance) || 0)); persistToolSettings(session) }, false) },
  setWandContiguous(contiguous) { get().mutateActive((session) => { session.wandContiguous = contiguous; persistToolSettings(session) }, false) },
  setPerfectPixels(enabled) { get().mutateActive((session) => { session.perfectPixels = enabled; persistToolSettings(session) }, false) },
  setSymmetryAxis(axis, enabled) { get().mutateActive((session) => { session.symmetryAxes = { ...session.symmetryAxes, [axis]: enabled }; persistToolSettings(session) }, false) },
  setSymmetryCenter(center) { get().mutateActive((session) => { session.symmetryCenter = { ...center }; }, false) },
  resetSymmetryCenter() { get().mutateActive((session) => { session.symmetryCenter = { x: session.document.width / 2, y: session.document.height / 2 }; }, false) },
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
  togglePixelGrid() {
    const session = activeSession(get())
    if (session) get().setView({ showPixelGrid: !session.view.showPixelGrid })
  },
  toggleGrid() {
    const session = activeSession(get())
    if (session) get().setView({ showGrid: !session.view.showGrid })
  },
  selectPaletteColor(id, additive = false) {
    get().mutateActive((session) => selectPaletteColorCommand(session, id, additive), false)
    const session = activeSession(get())
    if (session && session.paletteSelectionId !== null) get().setPrimaryColor(session.primaryColor)
  },
  selectPaletteColors(ids, primaryId) {
    get().mutateActive((session) => selectPaletteColorsCommand(session, ids, primaryId), false)
    const session = activeSession(get())
    if (session && session.paletteSelectionId !== null) get().setPrimaryColor(session.primaryColor)
  },
  addPaletteColor(color) {
    get().mutateActive((session) => addPaletteColorCommand(session, color))
  },
  updatePaletteColor(id, color) {
    get().mutateActive((session) => updatePaletteColorCommand(session, id, color))
  },
  applyPalette(colors, layout) {
    get().mutateActive((session) => applyPaletteCommand(session, colors, layout))
  },
  deletePaletteColor(id) {
    get().deletePaletteColors([id])
  },
  deletePaletteColors(ids) {
    get().mutateActive((session) => deletePaletteColorsCommand(session, ids))
  },
  movePaletteColor(direction) {
    get().mutateActive((session) => movePaletteColorCommand(session, direction))
  },
  reorderPaletteColors(ids, targetSlots, targetColumns) {
    get().mutateActive((session) => reorderPaletteColorsCommand(session, ids, targetSlots, targetColumns))
  },

  mutateActive(mutator, dirty = true) {
    const state = get()
    const session = activeSession(state)
    if (!session) return
    mutator(session)
    if (session.activeLayerMaskId && !findLayerMask(session.document, session.activeLayerMaskId)) session.activeLayerMaskId = null
    if (dirty) syncActiveAnimationFrame(session.document)
    touch(session, dirty)
    if (dirty) recordDocumentOperation(session)
    set({ sessions: [...state.sessions] })
  },

  commitPixelEdit(edit, label, activity) {
    get().mutateActive((session) => {
      const entry = commitPixelEdit(session.document, edit, label)
      if (entry) {
        session.history.push(entry)
        syncActiveAnimationFrame(session.document)
        touch(session, true, entry.invalidation)
        recordDocumentOperation(session, activity)
      }
    }, false)
  },

  setTimelapseSettings(settings) {
    const state = get()
    const session = activeSession(state)
    if (!session) return
    const current = normalizeTimelapseSettings(session.document.timelapse, session.document.timelapse?.snapshots ?? [])
    const next = normalizeTimelapseSettings({ ...current, ...settings }, current.snapshots)
    session.document.timelapse = next
    if (next.enabled && next.snapshots.length === 0) scheduleTimelapseCapture(session)
    else if (!next.enabled) cancelTimelapseCapture(session.document.id)
    touch(session)
    set({ sessions: [...state.sessions] })
  },

  clearTimelapse() {
    const state = get()
    const session = activeSession(state)
    if (!session) return
    cancelTimelapseCapture(session.document.id)
    session.document.timelapse = { ...normalizeTimelapseSettings(session.document.timelapse), snapshots: [] }
    touch(session)
    set({ sessions: [...state.sessions] })
  },

  async exportTimelapse(format, options) {
    const session = activeSession(get())
    if (!session) return false
    flushTimelapseCapture(session)
    let progressStarted = false
    const updateProgress = (value: number, label: string): void => {
      if (progressStarted && !get().saveProgress) return
      progressStarted = true
      set({ saveProgress: { title: tr('workspace.export.progressTitle'), value: Math.max(0, Math.min(100, Math.round(value))), label } })
    }
    try {
      const message = await exportTimelapseFile(window.moonSprite, session.document, format, options, {
        onEncodeStart: () => updateProgress(8, tr('workspace.export.videoEncoding')),
        onEncodeProgress: (value) => updateProgress(8 + value * 0.7, tr('workspace.export.videoEncoding')),
        onWriteStart: () => updateProgress(82, tr('workspace.save.writing'))
      })
      if (!message) return false
      set({ message, saveProgress: progressStarted ? { title: tr('workspace.export.progressTitle'), value: 100, label: tr('workspace.export.done'), requiresConfirmation: true } : null })
      return true
    } catch (error) {
      set({ message: error instanceof Error ? error.message : tr('timelapse.exportFailed'), ...(progressStarted ? { saveProgress: null } : {}) })
      return false
    }
  },

  pushHistory(entry) {
    get().mutateActive((session) => session.history.push(entry))
  },

  undo() {
    let session = activeSession(get())
    if (session) flushViewPreview(session.document.id)
    session = activeSession(get())
    if (session?.pendingPaste) { get().cancelFloatingPaste(); return }
    if (!session?.history.canUndo) return
    get().mutateActive((session) => {
      const view = { ...session.view }
      const entry = session.history.undo()
      Object.assign(session.view, view)
      if (!entry) return
      if (session.activeLayerMaskId && !findLayerMask(session.document, session.activeLayerMaskId)) session.activeLayerMaskId = null
      syncActiveAnimationFrame(session.document)
      touch(session, true, entry.invalidation)
      recordDocumentOperation(session)
    }, false)
  },

  redo() {
    let session = activeSession(get())
    if (session) flushViewPreview(session.document.id)
    session = activeSession(get())
    if (!session?.history.canRedo) return
    get().mutateActive((session) => {
      const view = { ...session.view }
      const entry = session.history.redo()
      Object.assign(session.view, view)
      if (!entry) return
      if (session.activeLayerMaskId && !findLayerMask(session.document, session.activeLayerMaskId)) session.activeLayerMaskId = null
      syncActiveAnimationFrame(session.document)
      touch(session, true, entry.invalidation)
      recordDocumentOperation(session)
    }, false)
  },

  setActiveAnimationFrame(frameId) {
    get().commitFloatingPaste()
    get().mutateActive((session) => {
      if (!activateAnimationFrame(session.document, frameId)) return
      session.activeLayerMaskId = null
      session.layerMaskIsolatedView = false
      session.selection = null
      session.lastPencilPoint = null
      session.lastEraserPoint = null
      session.revision += 1
    }, false)
  },

  stepAnimationFrame(delta) {
    const session = activeSession(get())
    if (!session) return
    const timeline = ensureAnimationDocument(session.document)
    const current = timeline.frames.findIndex((frame) => frame.id === timeline.activeFrameId)
    const target = Math.max(0, Math.min(timeline.frames.length - 1, current + Math.sign(delta)))
    const frame = timeline.frames[target]
    if (!frame || frame.id === timeline.activeFrameId) return
    get().selectAnimationFrame(frame.id)
  },

  selectAnimationFrame(frameId, mode = 'replace') {
    get().mutateActive((session) => {
      const timeline = ensureAnimationDocument(session.document)
      if (!timeline.frames.some((frame) => frame.id === frameId)) return
      session.selectedAnimationCellKeys = []
      session.animationCellSelectionAnchorKey = null
      session.selectedAnimationMaskCellKeys = []
      session.animationMaskCellSelectionAnchorKey = null
      const current = new Set(session.selectedAnimationFrameIds)
      if (mode === 'range' && session.animationFrameSelectionAnchorId) {
        const start = timeline.frames.findIndex((frame) => frame.id === session.animationFrameSelectionAnchorId)
        const end = timeline.frames.findIndex((frame) => frame.id === frameId)
        if (start >= 0 && end >= 0) {
          const [from, to] = start <= end ? [start, end] : [end, start]
          session.selectedAnimationFrameIds = timeline.frames.slice(from, to + 1).map((frame) => frame.id)
        }
      } else if (mode === 'toggle') {
        if (current.has(frameId)) current.delete(frameId)
        else current.add(frameId)
        session.selectedAnimationFrameIds = timeline.frames.map((frame) => frame.id).filter((id) => current.has(id))
      } else {
        session.selectedAnimationFrameIds = [frameId]
      }
      session.animationFrameSelectionAnchorId = frameId
    }, false)
    get().setActiveAnimationFrame(frameId)
  },

  selectAnimationCell(key, mode = 'replace') {
    get().mutateActive((session) => {
      const target = parseAnimationCelKey(key)
      const timeline = ensureAnimationDocument(session.document)
      if (!target || !timeline.frames.some((frame) => frame.id === target.frameId) || !session.document.layers.some((layer) => layer.id === target.layerId)) return
      const preservedLayerIds = mode !== 'replace' && session.selectedLayerIds.length > 1 ? [...session.selectedLayerIds] : null
      const implicitAnchorKey = mode !== 'replace' && session.selectedAnimationCellKeys.length === 0
        ? animationCelKey(session.document.activeLayerId, timeline.activeFrameId)
        : null
      session.selectedAnimationFrameIds = []
      session.animationFrameSelectionAnchorId = null
      session.selectedAnimationMaskCellKeys = []
      session.animationMaskCellSelectionAnchorKey = null
      session.document.activeLayerId = target.layerId
      session.selectedGroupId = null
      session.selectedGroupIds = []
      session.activeLayerMaskId = null
      session.layerMaskIsolatedView = false
      const current = new Set(session.selectedAnimationCellKeys)
      if (implicitAnchorKey) current.add(implicitAnchorKey)
      if (mode === 'toggle') {
        if (current.has(key)) current.delete(key)
        else current.add(key)
      } else if (mode === 'range') {
        const anchor = session.animationCellSelectionAnchorKey ?? session.selectedAnimationCellKeys.at(-1) ?? implicitAnchorKey
        const parsedAnchor = anchor ? parseAnimationCelKey(anchor) : null
        if (parsedAnchor) {
          const frames = timeline.frames
          const layers = session.document.layers
          const startFrame = frames.findIndex((frame) => frame.id === parsedAnchor.frameId)
          const endFrame = frames.findIndex((frame) => frame.id === target.frameId)
          const startLayer = layers.findIndex((layer) => layer.id === parsedAnchor.layerId)
          const endLayer = layers.findIndex((layer) => layer.id === target.layerId)
          if (startFrame >= 0 && endFrame >= 0 && startLayer >= 0 && endLayer >= 0) {
            const [fromFrame, toFrame] = startFrame <= endFrame ? [startFrame, endFrame] : [endFrame, startFrame]
            const [fromLayer, toLayer] = startLayer <= endLayer ? [startLayer, endLayer] : [endLayer, startLayer]
            for (const layer of layers.slice(fromLayer, toLayer + 1)) for (const frame of frames.slice(fromFrame, toFrame + 1)) current.add(animationCelKey(layer.id, frame.id))
          } else current.add(key)
        } else current.add(key)
      } else {
        current.clear()
        current.add(key)
      }
      session.selectedAnimationCellKeys = [...current]
      if (preservedLayerIds) session.selectedLayerIds = preservedLayerIds
      else {
        const focusKey = current.has(key) ? key : session.selectedAnimationCellKeys.at(-1)
        const focus = focusKey ? parseAnimationCelKey(focusKey) : null
        session.selectedLayerIds = focus ? [focus.layerId] : []
        if (focus) session.document.activeLayerId = focus.layerId
      }
      session.animationCellSelectionAnchorKey = current.has(key) ? key : session.selectedAnimationCellKeys.at(-1) ?? null
    }, false)
    const parsed = parseAnimationCelKey(key)
    if (parsed) get().setActiveAnimationFrame(parsed.frameId)
  },

  selectAnimationMaskCell(key, mode = 'replace') {
    const current = activeSession(get())
    const parsed = parseAnimationCelKey(key)
    const timeline = current ? ensureAnimationDocument(current.document) : null
    const mask = timeline && parsed ? animationMaskAt(timeline, parsed.layerId, parsed.frameId) : null
    const ownerKind = current?.document.layers.some((layer) => layer.id === parsed?.layerId)
      ? 'layer'
      : current?.document.groups.some((group) => group.id === parsed?.layerId) ? 'group' : null
    if (!current || !parsed || !timeline?.frames.some((frame) => frame.id === parsed.frameId) || !ownerKind || !mask) return
    get().setActiveAnimationFrame(parsed.frameId)
    get().mutateActive((session) => {
      const target = parseAnimationCelKey(key)
      const timeline = ensureAnimationDocument(session.document)
      const cel = target
        ? timeline.cels.find((candidate) => candidate.layerId === target.layerId && candidate.frameId === target.frameId)
        : null
      const ownerKind = session.document.layers.some((layer) => layer.id === target?.layerId)
        ? 'layer'
        : session.document.groups.some((group) => group.id === target?.layerId) ? 'group' : null
      if (!target || !ownerKind || !timeline.frames.some((frame) => frame.id === target.frameId)) return
      const mask = animationMaskAt(timeline, target.layerId, target.frameId)
      if (!mask) return
      session.selectedAnimationFrameIds = []
      session.animationFrameSelectionAnchorId = null
      session.selectedAnimationCellKeys = []
      session.animationCellSelectionAnchorKey = null
      applyLayerRowSelection(session, ownerKind === 'layer' ? [target.layerId] : [], ownerKind === 'group' ? [target.layerId] : [], { kind: ownerKind, id: target.layerId })
      const current = new Set(session.selectedAnimationMaskCellKeys)
      if (mode === 'toggle') {
        if (current.has(key)) current.delete(key)
        else current.add(key)
      } else if (mode === 'range') {
        const anchor = session.animationMaskCellSelectionAnchorKey ?? session.selectedAnimationMaskCellKeys.at(-1)
        const parsedAnchor = anchor ? parseAnimationCelKey(anchor) : null
        if (parsedAnchor) {
          const frames = timeline.frames
          const owners = ownerKind === 'layer' ? session.document.layers : session.document.groups
          const startFrame = frames.findIndex((frame) => frame.id === parsedAnchor.frameId)
          const endFrame = frames.findIndex((frame) => frame.id === target.frameId)
          const startLayer = owners.findIndex((owner) => owner.id === parsedAnchor.layerId)
          const endLayer = owners.findIndex((owner) => owner.id === target.layerId)
          if (startFrame >= 0 && endFrame >= 0 && startLayer >= 0 && endLayer >= 0) {
            const [fromFrame, toFrame] = startFrame <= endFrame ? [startFrame, endFrame] : [endFrame, startFrame]
            const [fromLayer, toLayer] = startLayer <= endLayer ? [startLayer, endLayer] : [endLayer, startLayer]
            for (const owner of owners.slice(fromLayer, toLayer + 1)) for (const frame of frames.slice(fromFrame, toFrame + 1)) {
              const candidateKey = animationCelKey(owner.id, frame.id)
              const candidateMask = animationMaskAt(timeline, owner.id, frame.id)
              if (candidateMask) current.add(candidateKey)
            }
          } else current.add(key)
        } else current.add(key)
      } else {
        current.clear()
        current.add(key)
      }
      session.selectedAnimationMaskCellKeys = [...current]
      session.animationMaskCellSelectionAnchorKey = key
      session.activeLayerMaskId = current.has(key) ? mask.id : null
      session.layerMaskIsolatedView = false
    }, false)
  },

  selectAnimationCelContent(key, additive = false) {
    get().commitFloatingPaste()
    const current = activeSession(get())
    const target = parseAnimationCelKey(key)
    if (!current || !target) return
    const timeline = ensureAnimationDocument(current.document)
    if (!timeline.frames.some((frame) => frame.id === target.frameId) || !current.document.layers.some((layer) => layer.id === target.layerId)) return
    const before = cloneSelectionMask(current.selection)
    const cel = resolveAnimationCel(timeline, timeline.cels.find((candidate) => candidate.layerId === target.layerId && candidate.frameId === target.frameId) ?? null)
    const incoming = animationCelContentSelection(cel, current.document.palette, current.document.width, current.document.height)
    const after = combineSelection(before, incoming, additive ? 'add' : 'replace')
    get().selectAnimationCell(key)
    get().mutateActive((session) => { session.selection = cloneSelectionMask(before) }, false)
    get().commitSelectionChange(before, after, tr('canvas.history.createSelection'))
  },

  clearAnimationSelection() {
    get().mutateActive((session) => {
      session.selectedAnimationFrameIds = []
      session.selectedAnimationCellKeys = []
      session.selectedAnimationMaskCellKeys = []
      session.animationFrameSelectionAnchorId = null
      session.animationCellSelectionAnchorKey = null
      session.animationMaskCellSelectionAnchorKey = null
    }, false)
  },

  setAnimationCelOpacity(layerId, frameId, opacity) {
    get().mutateActive((session) => {
      const timeline = ensureAnimationDocument(session.document)
      const cel = timeline.cels.find((candidate) => candidate.layerId === layerId && candidate.frameId === frameId)
      const source = resolveAnimationCel(timeline, cel ?? null)
      if (!cel || !source) return
      const linked = timeline.cels.filter((candidate) => resolveAnimationCel(timeline, candidate)?.id === source.id)
      const before = source.opacity ?? 1
      const after = Math.max(0, Math.min(1, opacity))
      if (before === after) return
      const apply = (value: number): void => {
        for (const candidate of linked) candidate.opacity = value
        if (timeline.activeFrameId === cel.frameId) {
          const layer = session.document.layers.find((candidate) => candidate.id === cel.layerId)
          if (layer) layer.opacity = value
        }
      }
      apply(after)
      session.history.push({ label: tr('workspace.history.animationCelOpacity'), bytes: 16, undo: () => apply(before), redo: () => apply(after) })
    })
  },

  connectSelectedAnimationCels() {
    get().mutateActive((session) => {
      const timeline = ensureAnimationDocument(session.document)
      const selected = new Set(session.selectedAnimationCellKeys)
      const targets = timeline.cels.filter((cel) => selected.has(animationCelKey(cel.layerId, cel.frameId)))
      const layerCounts = new Map<string, number>()
      for (const cel of targets) layerCounts.set(cel.layerId, (layerCounts.get(cel.layerId) ?? 0) + 1)
      if (![...layerCounts.values()].some((count) => count > 1)) return
      syncActiveAnimationFrame(session.document)
      const before = timeline.cels.map(cloneAnimationCel)
      if (!connectAnimationCels(session.document, targets.map((cel) => cel.id))) return
      const after = ensureAnimationDocument(session.document).cels.map(cloneAnimationCel)
      const restore = (snapshot: AnimationCel[]): void => {
        restoreAnimationCels(session.document, snapshot)
        refreshActiveAnimationFrame(session.document)
      }
      session.history.push({
        label: tr('workspace.history.animationCelLink'),
        bytes: [...before, ...after].reduce((sum, cel) => sum + (cel.surface?.pixels.byteLength ?? 0) + 24, 0),
        undo: () => restore(before),
        redo: () => restore(after)
      })
    })
  },

  disconnectSelectedAnimationCels() {
    get().mutateActive((session) => {
      const timeline = ensureAnimationDocument(session.document)
      const selected = new Set(session.selectedAnimationCellKeys)
      const targets = timeline.cels.filter((cel) => selected.has(animationCelKey(cel.layerId, cel.frameId)))
      syncActiveAnimationFrame(session.document)
      const before = timeline.cels.map(cloneAnimationCel)
      if (!disconnectAnimationCels(session.document, targets.map((cel) => cel.id))) return
      const after = ensureAnimationDocument(session.document).cels.map(cloneAnimationCel)
      const restore = (snapshot: AnimationCel[]): void => {
        restoreAnimationCels(session.document, snapshot)
        refreshActiveAnimationFrame(session.document)
      }
      session.history.push({
        label: tr('workspace.history.animationCelUnlink'),
        bytes: [...before, ...after].reduce((sum, cel) => sum + (cel.surface?.pixels.byteLength ?? 0) + 24, 0),
        undo: () => restore(before),
        redo: () => restore(after)
      })
    })
  },

  copySelectedAnimationCels() {
    get().mutateActive((session) => {
      const timeline = ensureAnimationDocument(session.document)
      const keys = new Set(session.selectedAnimationCellKeys)
      const layerIndexes = new Map(session.document.layers.map((layer, index) => [layer.id, index]))
      const frameIndexes = new Map(timeline.frames.map((frame, index) => [frame.id, index]))
      const cels = timeline.cels
        .filter((cel) => keys.has(animationCelKey(cel.layerId, cel.frameId)))
        .sort((left, right) => (layerIndexes.get(left.layerId) ?? 0) - (layerIndexes.get(right.layerId) ?? 0) || (frameIndexes.get(left.frameId) ?? 0) - (frameIndexes.get(right.frameId) ?? 0))
        .map((cel) => {
          const mask = animationMaskAt(timeline, cel.layerId, cel.frameId)
          return { ...cloneAnimationCel(cel), linkedCelId: null, mask: mask ? layerMaskFromClipboard(layerMaskClipboard(mask), cel.id) : undefined }
        })
      session.animationCellClipboard = cels
      session.animationCellClipboardAnchorKey = cels[0] ? animationCelKey(cels[0].layerId, cels[0].frameId) : null
    }, false)
  },

  copySelectedAnimationFrames() {
    get().mutateActive((session) => {
      const timeline = ensureAnimationDocument(session.document)
      syncActiveAnimationFrame(session.document)
      const selectedIds = new Set(session.selectedAnimationFrameIds.length ? session.selectedAnimationFrameIds : [timeline.activeFrameId])
      session.animationFrameClipboard = timeline.frames.filter((frame) => selectedIds.has(frame.id)).map((frame): AnimationFrameClipboardItem => ({
        frameId: frame.id,
        duration: frame.duration,
        cels: timeline.cels.filter((cel) => cel.frameId === frame.id).map((cel) => {
          const mask = animationMaskAt(timeline, cel.layerId, cel.frameId)
          return { ...cloneAnimationCel(cel), linkedCelId: null, mask: mask ? layerMaskFromClipboard(layerMaskClipboard(mask), cel.id) : undefined }
        }),
        groupMasks: (timeline.groupMasks ?? []).filter((entry) => entry.frameId === frame.id).map((entry) => cloneAnimationGroupMask(entry))
      }))
    }, false)
  },

  pasteAnimationFrames() {
    get().mutateActive((session) => {
      const timeline = ensureAnimationDocument(session.document)
      const clipboard = session.animationFrameClipboard
      if (!clipboard.length) return
      const selectedIds = new Set(session.selectedAnimationFrameIds.length ? session.selectedAnimationFrameIds : [timeline.activeFrameId])
      const anchorIndex = Math.max(-1, ...timeline.frames.map((frame, index) => selectedIds.has(frame.id) ? index : -1))
      const insertIndex = anchorIndex + 1
      const insertedFrames = clipboard.map((item) => ({ id: createId('frame'), duration: item.duration }))
      const insertedCels = clipboard.flatMap((item, index) => item.cels.map((cel) => {
        const id = createId('cel')
        return { ...cloneAnimationCel(cel), id, frameId: insertedFrames[index].id, mask: layerMaskFromClipboard(layerMaskClipboard(cel.mask), id) }
      }))
      const insertedGroupMasks = clipboard.flatMap((item, index) => (item.groupMasks ?? []).map((entry) => cloneAnimationGroupMask(entry, entry.groupId, insertedFrames[index].id, createId('mask'))))
      const previousActiveFrameId = timeline.activeFrameId
      const previousSelectedFrameIds = [...session.selectedAnimationFrameIds]
      const insertedIds = new Set(insertedFrames.map((frame) => frame.id))
      const restoreInserted = (): void => {
        const current = ensureAnimationDocument(session.document)
        current.frames = current.frames.filter((frame) => !insertedIds.has(frame.id))
        current.cels = current.cels.filter((cel) => !insertedIds.has(cel.frameId))
        current.groupMasks = (current.groupMasks ?? []).filter((entry) => !insertedIds.has(entry.frameId))
        const fallback = current.frames.find((frame) => frame.id === previousActiveFrameId)?.id ?? current.frames[0]?.id
        if (fallback) activateAnimationFrame(session.document, fallback)
        session.activeLayerMaskId = null
        session.selectedAnimationFrameIds = previousSelectedFrameIds
        session.selectedAnimationCellKeys = []
      }
      const reapplyInserted = (): void => {
        const current = ensureAnimationDocument(session.document)
        const index = Math.min(insertIndex, current.frames.length)
        current.frames.splice(index, 0, ...insertedFrames.map((frame) => ({ ...frame })))
        current.cels.push(...insertedCels.map((cel) => cloneAnimationCel(cel)))
        current.groupMasks ??= []
        current.groupMasks.push(...insertedGroupMasks.map((entry) => cloneAnimationGroupMask(entry)))
        activateAnimationFrame(session.document, insertedFrames[0].id)
        session.activeLayerMaskId = null
        session.selectedAnimationFrameIds = insertedFrames.map((frame) => frame.id)
        session.selectedAnimationCellKeys = []
      }
      timeline.frames.splice(insertIndex, 0, ...insertedFrames)
      timeline.cels.push(...insertedCels)
      timeline.groupMasks ??= []
      timeline.groupMasks.push(...insertedGroupMasks)
      activateAnimationFrame(session.document, insertedFrames[0].id)
      session.activeLayerMaskId = null
      session.selectedAnimationFrameIds = insertedFrames.map((frame) => frame.id)
      session.selectedAnimationCellKeys = []
      session.history.push({ label: tr('workspace.history.pasteAnimationFrame'), bytes: insertedCels.reduce((sum, cel) => sum + (cel.surface?.pixels.byteLength ?? 0), 0) + insertedGroupMasks.reduce((sum, entry) => sum + entry.mask.pixels.byteLength, 0) + insertedFrames.length * 64, undo: restoreInserted, redo: reapplyInserted })
    })
  },

  moveSelectedAnimationFrames(targetFrameId, insertAfter) {
    get().mutateActive((session) => {
      const timeline = ensureAnimationDocument(session.document)
      const selected = new Set(session.selectedAnimationFrameIds.length ? session.selectedAnimationFrameIds : [timeline.activeFrameId])
      if (selected.has(targetFrameId)) return
      const beforeIds = timeline.frames.map((frame) => frame.id)
      const moving = timeline.frames.filter((frame) => selected.has(frame.id))
      const remaining = timeline.frames.filter((frame) => !selected.has(frame.id))
      const targetIndex = remaining.findIndex((frame) => frame.id === targetFrameId)
      if (targetIndex < 0 || moving.length === 0) return
      remaining.splice(targetIndex + (insertAfter ? 1 : 0), 0, ...moving)
      const afterIds = remaining.map((frame) => frame.id)
      if (beforeIds.join('|') === afterIds.join('|')) return
      const apply = (ids: readonly string[]): void => {
        const current = ensureAnimationDocument(session.document)
        const byId = new Map(current.frames.map((frame) => [frame.id, frame]))
        current.frames = ids.flatMap((id) => { const frame = byId.get(id); return frame ? [frame] : [] })
      }
      apply(afterIds)
      session.selectedAnimationFrameIds = afterIds.filter((id) => selected.has(id))
      session.history.push({ label: tr('workspace.history.moveAnimationFrame'), bytes: 64, undo: () => apply(beforeIds), redo: () => apply(afterIds) })
    })
  },

  pasteAnimationCels() {
    get().mutateActive((session) => {
      const timeline = ensureAnimationDocument(session.document)
      if (!session.animationCellClipboard.length) return
      const targetKey = session.selectedAnimationCellKeys.at(-1) ?? animationCelKey(session.document.activeLayerId, timeline.activeFrameId)
      const target = parseAnimationCelKey(targetKey)
      const sourceAnchorKey = session.animationCellClipboardAnchorKey ?? animationCelKey(session.animationCellClipboard[0].layerId, session.animationCellClipboard[0].frameId)
      const sourceAnchor = parseAnimationCelKey(sourceAnchorKey)
      if (!target || !sourceAnchor) return
      const sourceAnchorFrameIndex = timeline.frames.findIndex((frame) => frame.id === sourceAnchor.frameId)
      const targetFrameIndex = timeline.frames.findIndex((frame) => frame.id === target.frameId)
      const sourceFrameIndexes = session.animationCellClipboard.map((cel) => timeline.frames.findIndex((frame) => frame.id === cel.frameId))
      if (sourceAnchorFrameIndex < 0 || targetFrameIndex < 0 || sourceFrameIndexes.some((index) => index < 0)) return
      const minimumDestination = targetFrameIndex + Math.min(...sourceFrameIndexes.map((index) => index - sourceAnchorFrameIndex))
      if (minimumDestination < 0) return
      const maximumDestination = targetFrameIndex + Math.max(...sourceFrameIndexes.map((index) => index - sourceAnchorFrameIndex))
      const appendedFrames = Array.from({ length: Math.max(0, maximumDestination - timeline.frames.length + 1) }, () => ({ id: createId('frame'), duration: 100 }))
      const previousSelection = [...session.selectedAnimationCellKeys]
      if (appendedFrames.length > 0) timeline.frames.push(...appendedFrames)
      ensureAnimationDocument(session.document)
      const appendedFrameIds = new Set(appendedFrames.map((frame) => frame.id))
      const appendedBaseCels = timeline.cels.filter((cel) => appendedFrameIds.has(cel.frameId)).map(cloneAnimationCel)
      const placements = mapAnimationCelBlock(timeline, session.document.layers.map((layer) => layer.id), session.animationCellClipboard, sourceAnchorKey, target.layerId, target.frameId)
      if (placements.length !== session.animationCellClipboard.length) {
        timeline.frames = timeline.frames.filter((frame) => !appendedFrameIds.has(frame.id))
        timeline.cels = timeline.cels.filter((cel) => !appendedFrameIds.has(cel.frameId))
        return
      }
      const writeTargets = [...new Map(placements.flatMap(({ target: destination }) => {
        const shared = resolveAnimationCel(timeline, destination) ?? destination
        return [[shared.id, shared] as const, [destination.id, destination] as const]
      })).values()]
      const before = writeTargets.filter((cel) => !appendedFrameIds.has(cel.frameId)).map(cloneAnimationCel)
      for (const { source, target: destination } of placements) {
        const shared = resolveAnimationCel(timeline, destination) ?? destination
        shared.surface = source.surface ? cloneAnimationCelSurface(source.surface) : undefined
        shared.opacity = source.opacity
        shared.mask = layerMaskFromClipboard(layerMaskClipboard(source.mask), shared.id)
        if (destination !== shared) delete destination.mask
      }
      refreshActiveAnimationFrame(session.document)
      session.activeLayerMaskId = null
      session.selectedAnimationCellKeys = placements.map(({ target: destination }) => animationCelKey(destination.layerId, destination.frameId))
      const after = writeTargets.map(cloneAnimationCel)
      const afterSelection = [...session.selectedAnimationCellKeys]
      if (after.length) session.history.push({
        label: tr('workspace.history.pasteAnimationCel'),
        bytes: [...before, ...after, ...appendedBaseCels].reduce((sum, cel) => sum + (cel.surface?.pixels.byteLength ?? 0), 0) + appendedFrames.length * 32,
        undo: () => {
          restoreAnimationCels(session.document, before)
          const current = ensureAnimationDocument(session.document)
          current.frames = current.frames.filter((frame) => !appendedFrameIds.has(frame.id))
          current.cels = current.cels.filter((cel) => !appendedFrameIds.has(cel.frameId))
          session.selectedAnimationCellKeys = previousSelection
          refreshActiveAnimationFrame(session.document)
        },
        redo: () => {
          const current = ensureAnimationDocument(session.document)
          for (const frame of appendedFrames) if (!current.frames.some((candidate) => candidate.id === frame.id)) current.frames.push({ ...frame })
          ensureAnimationDocument(session.document)
          restoreAnimationCels(session.document, [...appendedBaseCels, ...after])
          session.selectedAnimationCellKeys = afterSelection
          refreshActiveAnimationFrame(session.document)
        }
      })
    })
  },

  moveSelectedAnimationCels(layerId, frameId, sourceAnchorKey) {
    get().mutateActive((session) => {
      const timeline = ensureAnimationDocument(session.document)
      const selected = new Set(session.selectedAnimationCellKeys)
      const sources = timeline.cels.filter((candidate) => selected.has(animationCelKey(candidate.layerId, candidate.frameId))).map(cloneAnimationCel)
      const placements = mapAnimationCelBlock(timeline, session.document.layers.map((layer) => layer.id), sources, sourceAnchorKey, layerId, frameId)
      const affected = new Map<string, AnimationCel>()
      if (!placements.length || placements.length !== sources.length || placements.every(({ source, target }) => source.layerId === target.layerId && source.frameId === target.frameId)) return
      for (const source of sources) {
        const original = timeline.cels.find((cel) => cel.layerId === source.layerId && cel.frameId === source.frameId)
        if (original) affected.set(animationCelKey(original.layerId, original.frameId), cloneAnimationCel(original))
      }
      for (const { target: destination } of placements) affected.set(animationCelKey(destination.layerId, destination.frameId), cloneAnimationCel(destination))
      for (const source of sources) {
        const original = timeline.cels.find((cel) => cel.layerId === source.layerId && cel.frameId === source.frameId)
        if (original?.surface) original.surface = original.surface.format === 'rgba' ? { ...original.surface, pixels: new Uint8ClampedArray(original.surface.pixels.length) } : { ...original.surface, pixels: new Uint32Array(original.surface.pixels.length) }
        if (original) delete original.mask
      }
      for (const { source, target: destination } of placements) {
        destination.linkedCelId = null
        destination.surface = source.surface ? cloneAnimationCelSurface(source.surface) : undefined
        destination.opacity = source.opacity
        destination.mask = layerMaskFromClipboard(layerMaskClipboard(source.mask), destination.id)
      }
      refreshActiveAnimationFrame(session.document)
      if (ensureAnimationDocument(session.document).activeFrameId !== frameId) activateAnimationFrame(session.document, frameId)
      session.activeLayerMaskId = null
      session.selectedAnimationCellKeys = placements.map(({ target: destination }) => animationCelKey(destination.layerId, destination.frameId))
      const after = [...affected.keys()].flatMap((key) => {
        const parsed = parseAnimationCelKey(key)
        const cel = parsed ? timeline.cels.find((candidate) => candidate.layerId === parsed.layerId && candidate.frameId === parsed.frameId) : null
        return cel ? [cloneAnimationCel(cel)] : []
      })
      const before = [...affected.values()]
      if (after.length) session.history.push({ label: tr('workspace.history.moveAnimationCel'), bytes: [...before, ...after].reduce((sum, cel) => sum + (cel.surface?.pixels.byteLength ?? 0), 0), undo: () => restoreAnimationCels(session.document, before), redo: () => restoreAnimationCels(session.document, after) })
    })
  },

  copySelectedAnimationMasks() {
    get().mutateActive((session) => {
      const timeline = ensureAnimationDocument(session.document)
      const selected = new Set(session.selectedAnimationMaskCellKeys)
      const ownerIndexes = new Map(animationMaskOwnerIds(session).map((id, index) => [id, index]))
      const frameIndexes = new Map(timeline.frames.map((frame, index) => [frame.id, index]))
      const clipboard = [...selected].flatMap((key): AnimationMaskClipboardItem[] => {
        const target = parseAnimationCelKey(key)
        const ownerKind = target ? animationMaskOwnerKind(session.document, target.layerId) : null
        const mask = target ? animationMaskAt(timeline, target.layerId, target.frameId) : null
        return target && ownerKind && mask ? [{ key, mask: cloneAnimationMaskForOwner(mask, ownerKind, mask.ownerId, { preserveLink: false }) }] : []
      }).sort((left, right) => {
        const leftTarget = parseAnimationCelKey(left.key)!
        const rightTarget = parseAnimationCelKey(right.key)!
        return (ownerIndexes.get(leftTarget.layerId) ?? 0) - (ownerIndexes.get(rightTarget.layerId) ?? 0)
          || (frameIndexes.get(leftTarget.frameId) ?? 0) - (frameIndexes.get(rightTarget.frameId) ?? 0)
      })
      session.animationMaskClipboard = clipboard
      session.animationMaskClipboardAnchorKey = clipboard[0]?.key ?? null
    }, false)
  },

  pasteAnimationMasks(ownerId, frameId) {
    const current = activeSession(get())
    if (!current || !current.animationMaskClipboard.length) return
    const currentTimeline = ensureAnimationDocument(current.document)
    const currentFallback = parseAnimationCelKey(current.selectedAnimationMaskCellKeys.at(-1) ?? '')
    const currentTargetOwnerId = ownerId ?? currentFallback?.layerId
    const currentTargetFrameId = frameId ?? currentFallback?.frameId
    const currentSourceAnchorKey = current.animationMaskClipboardAnchorKey ?? current.animationMaskClipboard[0].key
    if (!currentTargetOwnerId || !currentTargetFrameId) return
    const currentPlacements = mapAnimationMaskBlock(current, current.animationMaskClipboard.map((item) => item.key), currentSourceAnchorKey, currentTargetOwnerId, currentTargetFrameId)
    if (animationMaskPlacementsTargetEmptyLayerCel(current, currentPlacements)) { set({ message: tr('workspace.layerMask.emptyCel') }); return }
    get().mutateActive((session) => {
      const timeline = ensureAnimationDocument(session.document)
      if (!session.animationMaskClipboard.length) return
      const fallback = parseAnimationCelKey(session.selectedAnimationMaskCellKeys.at(-1) ?? '')
      const targetOwnerId = ownerId ?? fallback?.layerId
      const targetFrameId = frameId ?? fallback?.frameId
      const sourceAnchorKey = session.animationMaskClipboardAnchorKey ?? session.animationMaskClipboard[0].key
      if (!targetOwnerId || !targetFrameId) return
      const placements = mapAnimationMaskBlock(session, session.animationMaskClipboard.map((item) => item.key), sourceAnchorKey, targetOwnerId, targetFrameId)
      if (!placements.length || placements.some((placement) => animationMaskOwnerLocked(session.document, parseAnimationCelKey(placement.targetKey)?.layerId ?? ''))) return
      if (animationMaskPlacementsTargetEmptyLayerCel(session, placements)) return
      const sourceByKey = new Map(session.animationMaskClipboard.map((item) => [item.key, item]))
      const before = placements.flatMap(({ targetKey }) => {
        const target = parseAnimationCelKey(targetKey)
        const snapshot = target ? animationMaskSlotSnapshot(session.document, target.layerId, target.frameId) : null
        return snapshot ? [snapshot] : []
      })
      for (const placement of placements) {
        const source = sourceByKey.get(placement.sourceKey)
        const target = parseAnimationCelKey(placement.targetKey)
        const ownerKind = target ? animationMaskOwnerKind(session.document, target.layerId) : null
        if (!source || !target || !ownerKind) continue
        const copied = cloneAnimationMaskForOwner(source.mask, ownerKind, source.mask.ownerId, { id: createId('mask'), preserveLink: false })
        setAnimationMaskSlot(session.document, target.layerId, target.frameId, copied)
      }
      const afterKeys = placements.map((placement) => placement.targetKey)
      const after = afterKeys.flatMap((key) => {
        const target = parseAnimationCelKey(key)
        const snapshot = target ? animationMaskSlotSnapshot(session.document, target.layerId, target.frameId) : null
        return snapshot ? [snapshot] : []
      })
      const beforeSelection = [...session.selectedAnimationMaskCellKeys]
      session.selectedAnimationMaskCellKeys = afterKeys
      session.animationMaskCellSelectionAnchorKey = afterKeys.at(-1) ?? null
      session.activeLayerMaskId = null
      session.history.push({
        label: tr('workspace.history.pasteAnimationMask'),
        bytes: [...before, ...after].reduce((sum, item) => sum + (item.mask?.pixels.byteLength ?? 0), 0),
        undo: () => { restoreAnimationMaskSlots(session.document, before); session.selectedAnimationMaskCellKeys = beforeSelection },
        redo: () => { restoreAnimationMaskSlots(session.document, after); session.selectedAnimationMaskCellKeys = afterKeys },
        invalidation: { kind: 'full' }
      })
    })
  },

  moveSelectedAnimationMasks(ownerId, frameId, sourceAnchorKey) {
    get().mutateActive((session) => {
      const sourceKeys = session.selectedAnimationMaskCellKeys.filter((key) => {
        const target = parseAnimationCelKey(key)
        return Boolean(target && directAnimationMaskAt(session.document, target.layerId, target.frameId))
      })
      const placements = mapAnimationMaskBlock(session, sourceKeys, sourceAnchorKey, ownerId, frameId)
      if (!placements.length || placements.length !== sourceKeys.length || placements.every((placement) => placement.sourceKey === placement.targetKey)) return
      if (placements.some((placement) => animationMaskOwnerLocked(session.document, parseAnimationCelKey(placement.targetKey)?.layerId ?? ''))) return
      const affectedKeys = [...new Set(placements.flatMap((placement) => [placement.sourceKey, placement.targetKey]))]
      const before = affectedKeys.flatMap((key) => {
        const target = parseAnimationCelKey(key)
        const snapshot = target ? animationMaskSlotSnapshot(session.document, target.layerId, target.frameId) : null
        return snapshot ? [snapshot] : []
      })
      const sourceMasks = new Map(placements.flatMap((placement) => {
        const target = parseAnimationCelKey(placement.sourceKey)
        const mask = target ? directAnimationMaskAt(session.document, target.layerId, target.frameId) : null
        const ownerKind = target ? animationMaskOwnerKind(session.document, target.layerId) : null
        return target && mask && ownerKind ? [[placement.sourceKey, cloneAnimationMaskForOwner(mask, ownerKind, mask.ownerId)] as const] : []
      }))
      for (const sourceKey of sourceKeys) {
        const target = parseAnimationCelKey(sourceKey)
        if (target) setAnimationMaskSlot(session.document, target.layerId, target.frameId, null)
      }
      for (const placement of placements) {
        const source = sourceMasks.get(placement.sourceKey)
        const target = parseAnimationCelKey(placement.targetKey)
        if (source && target) setAnimationMaskSlot(session.document, target.layerId, target.frameId, source)
      }
      const after = affectedKeys.flatMap((key) => {
        const target = parseAnimationCelKey(key)
        const snapshot = target ? animationMaskSlotSnapshot(session.document, target.layerId, target.frameId) : null
        return snapshot ? [snapshot] : []
      })
      const afterKeys = placements.map((placement) => placement.targetKey)
      session.selectedAnimationMaskCellKeys = afterKeys
      session.animationMaskCellSelectionAnchorKey = afterKeys.at(-1) ?? null
      session.history.push({
        label: tr('workspace.history.moveAnimationMask'),
        bytes: [...before, ...after].reduce((sum, item) => sum + (item.mask?.pixels.byteLength ?? 0), 0),
        undo: () => restoreAnimationMaskSlots(session.document, before),
        redo: () => restoreAnimationMaskSlots(session.document, after),
        invalidation: { kind: 'full' }
      })
    })
  },

  connectSelectedAnimationMasks() {
    get().mutateActive((session) => {
      const timeline = ensureAnimationDocument(session.document)
      const frameIndexes = new Map(timeline.frames.map((frame, index) => [frame.id, index]))
      const selected = session.selectedAnimationMaskCellKeys.flatMap((key) => {
        const target = parseAnimationCelKey(key)
        const mask = target ? directAnimationMaskAt(session.document, target.layerId, target.frameId) : null
        return target && mask ? [{ key, target, mask }] : []
      })
      const byOwner = new Map<string, typeof selected>()
      for (const item of selected) byOwner.set(item.target.layerId, [...(byOwner.get(item.target.layerId) ?? []), item])
      const linkable = [...byOwner.values()].filter((items) => items.length > 1)
      if (!linkable.length || linkable.some((items) => animationMaskOwnerLocked(session.document, items[0].target.layerId))) return
      const affectedKeys = linkable.flatMap((items) => items.map((item) => item.key))
      const before = affectedKeys.flatMap((key) => {
        const target = parseAnimationCelKey(key)
        const snapshot = target ? animationMaskSlotSnapshot(session.document, target.layerId, target.frameId) : null
        return snapshot ? [snapshot] : []
      })
      let changed = false
      for (const items of linkable) {
        items.sort((left, right) => (frameIndexes.get(left.target.frameId) ?? 0) - (frameIndexes.get(right.target.frameId) ?? 0))
        const source = resolveAnimationMask(timeline, items[0].mask) ?? items[0].mask
        for (const item of items) {
          if (item.mask.id === source.id) continue
          if (item.mask.linkedMaskId !== source.id) changed = true
          item.mask.linkedMaskId = source.id
        }
      }
      if (!changed) return
      const after = affectedKeys.flatMap((key) => {
        const target = parseAnimationCelKey(key)
        const snapshot = target ? animationMaskSlotSnapshot(session.document, target.layerId, target.frameId) : null
        return snapshot ? [snapshot] : []
      })
      session.history.push({
        label: tr('workspace.history.animationMaskLink'),
        bytes: [...before, ...after].reduce((sum, item) => sum + (item.mask?.pixels.byteLength ?? 0), 0),
        undo: () => restoreAnimationMaskSlots(session.document, before),
        redo: () => restoreAnimationMaskSlots(session.document, after),
        invalidation: { kind: 'full' }
      })
    })
  },

  disconnectSelectedAnimationMasks() {
    get().mutateActive((session) => {
      const timeline = ensureAnimationDocument(session.document)
      const selectedKeys = new Set(session.selectedAnimationMaskCellKeys)
      const slots = [
        ...timeline.cels.flatMap((cel) => cel.mask ? [{ ownerId: cel.layerId, frameId: cel.frameId, mask: cel.mask }] : []),
        ...(timeline.groupMasks ?? []).map((entry) => ({ ownerId: entry.groupId, frameId: entry.frameId, mask: entry.mask }))
      ]
      const selectedRootIds = new Set(slots.flatMap((slot) => selectedKeys.has(animationCelKey(slot.ownerId, slot.frameId)) ? [resolveAnimationMask(timeline, slot.mask)?.id ?? slot.mask.id] : []))
      const affected = slots.filter((slot) => slot.mask.linkedMaskId && (selectedKeys.has(animationCelKey(slot.ownerId, slot.frameId)) || selectedRootIds.has(resolveAnimationMask(timeline, slot.mask)?.id ?? '')))
      if (!affected.length || affected.some((slot) => animationMaskOwnerLocked(session.document, slot.ownerId))) return
      const affectedKeys = affected.map((slot) => animationCelKey(slot.ownerId, slot.frameId))
      const before = affectedKeys.flatMap((key) => {
        const target = parseAnimationCelKey(key)
        const snapshot = target ? animationMaskSlotSnapshot(session.document, target.layerId, target.frameId) : null
        return snapshot ? [snapshot] : []
      })
      for (const slot of affected) {
        const resolved = resolveAnimationMask(timeline, slot.mask)
        if (!resolved) continue
        const ownerKind = animationMaskOwnerKind(session.document, slot.ownerId)
        if (!ownerKind) continue
        const independent = cloneAnimationMaskForOwner(resolved, ownerKind, slot.mask.ownerId, { id: slot.mask.id, preserveLink: false })
        setAnimationMaskSlot(session.document, slot.ownerId, slot.frameId, independent)
      }
      const after = affectedKeys.flatMap((key) => {
        const target = parseAnimationCelKey(key)
        const snapshot = target ? animationMaskSlotSnapshot(session.document, target.layerId, target.frameId) : null
        return snapshot ? [snapshot] : []
      })
      session.history.push({
        label: tr('workspace.history.animationMaskUnlink'),
        bytes: [...before, ...after].reduce((sum, item) => sum + (item.mask?.pixels.byteLength ?? 0), 0),
        undo: () => restoreAnimationMaskSlots(session.document, before),
        redo: () => restoreAnimationMaskSlots(session.document, after),
        invalidation: { kind: 'full' }
      })
    })
  },

  deleteSelectedAnimationItems() {
    const current = activeSession(get())
    if (!current) return
    const timeline = ensureAnimationDocument(current.document)
    if (current.selectedAnimationCellKeys.length) {
      get().mutateActive((session) => {
        const timeline = ensureAnimationDocument(session.document)
        const selected = new Set(session.selectedAnimationCellKeys)
        const selectedCels = timeline.cels.filter((cel) => selected.has(animationCelKey(cel.layerId, cel.frameId)))
        const linkedSourceIds = new Set(selectedCels.flatMap((cel) => {
          const source = resolveAnimationCel(timeline, cel)
          if (!source) return []
          const linked = Boolean(cel.linkedCelId) || timeline.cels.some((candidate) => candidate.linkedCelId === source.id)
          return linked ? [source.id] : []
        }))
        const affected = timeline.cels.filter((cel) => selected.has(animationCelKey(cel.layerId, cel.frameId)) || (() => {
          const source = resolveAnimationCel(timeline, cel)
          return Boolean(source && linkedSourceIds.has(source.id))
        })())
        const before = affected.map(cloneAnimationCel)
        if (linkedSourceIds.size > 0) {
          for (const cel of timeline.cels) {
            const source = resolveAnimationCel(timeline, cel)
            if (!source || !linkedSourceIds.has(source.id)) continue
            cel.surface = source.surface ? cloneAnimationCelSurface(source.surface) : undefined
            cel.opacity = source.opacity
            cel.mask = source.mask ? layerMaskFromClipboard(layerMaskClipboard(source.mask), cel.id) : undefined
            cel.linkedCelId = null
          }
        }
        for (const cel of selectedCels) {
          cel.surface = cel.surface?.format === 'rgba' ? { ...cel.surface, pixels: new Uint8ClampedArray(cel.surface.pixels.length) } : cel.surface ? { ...cel.surface, pixels: new Uint32Array(cel.surface.pixels.length) } : undefined
          cel.linkedCelId = null
          delete cel.mask
        }
        refreshActiveAnimationFrame(session.document)
        session.activeLayerMaskId = null
        const after = affected.map((cel) => cloneAnimationCel(timeline.cels.find((candidate) => candidate.id === cel.id) ?? cel))
        session.selectedAnimationCellKeys = []
        if (before.length) session.history.push({ label: tr('workspace.history.deleteAnimationCel'), bytes: [...before, ...after].reduce((sum, cel) => sum + (cel.surface?.pixels.byteLength ?? 0), 0), undo: () => restoreAnimationCels(session.document, before), redo: () => restoreAnimationCels(session.document, after) })
      })
      return
    }
    const selectedFrames = current.selectedAnimationFrameIds.length ? [...current.selectedAnimationFrameIds] : [timeline.activeFrameId]
    current.history.beginCompound()
    for (const frameId of selectedFrames) {
      if (ensureAnimationDocument(current.document).frames.length <= 1) break
      get().setActiveAnimationFrame(frameId)
      get().deleteAnimationFrame()
    }
    current.history.endCompound(tr('workspace.history.deleteAnimationFrame'))
    get().mutateActive((session) => { session.selectedAnimationFrameIds = [] }, false)
  },

  setAnimationPlaying(playing, completed = false) {
    get().mutateActive((session) => {
      if (session.animationPlaying === playing) return
      const timeline = ensureAnimationDocument(session.document)
      if (playing) {
        session.animationPlaybackStartFrameId = timeline.activeFrameId
        if (!timeline.loop && timeline.frames[0] && timeline.activeFrameId !== timeline.frames[0].id) {
          activateAnimationFrame(session.document, timeline.frames[0].id)
          session.selection = null
          session.lastPencilPoint = null
          session.lastEraserPoint = null
          session.revision += 1
        }
        session.animationPlaying = true
        return
      }
      session.animationPlaying = false
      const startFrameId = session.animationPlaybackStartFrameId
      session.animationPlaybackStartFrameId = null
      const returnFrameId = session.animationReturnToStart
        ? startFrameId
        : completed && !timeline.loop ? timeline.frames[0]?.id : null
      if (returnFrameId && returnFrameId !== timeline.activeFrameId && activateAnimationFrame(session.document, returnFrameId)) {
        session.selection = null
        session.lastPencilPoint = null
        session.lastEraserPoint = null
        session.revision += 1
      }
    }, false)
  },

  setAnimationPlaybackRate(rate) {
    const normalized = [0.25, 0.5, 1, 1.5, 2, 3].includes(rate) ? rate : 1
    get().mutateActive((session) => { session.animationPlaybackRate = normalized }, false)
  },

  setAnimationReturnToStart(enabled) {
    get().mutateActive((session) => { session.animationReturnToStart = enabled }, false)
  },

  advanceAnimationFrame() {
    const session = activeSession(get())
    if (!session) return
    const timeline = ensureAnimationDocument(session.document)
    get().setActiveAnimationFrame(nextAnimationFrameId(timeline, timeline.activeFrameId))
  },

  addAnimationFrame() {
    get().mutateActive((session) => {
      const timeline = ensureAnimationDocument(session.document)
      const previousFrameId = timeline.activeFrameId
      const frameId = addBlankAnimationFrame(session.document)
      const frameIndex = timeline.frames.findIndex((frame) => frame.id === frameId)
      const frame = { ...timeline.frames[frameIndex] }
      const cels = cloneAnimationCelsForLayerIds(session.document, session.document.layers.map((layer) => layer.id), frameId)
      const restore = (): void => {
        const current = ensureAnimationDocument(session.document)
        if (!current.frames.some((candidate) => candidate.id === frameId)) current.frames.splice(Math.min(frameIndex, current.frames.length), 0, { ...frame })
        restoreAnimationCels(session.document, cels)
        activateAnimationFrame(session.document, frameId)
      }
      session.history.push({ label: tr('workspace.history.addAnimationFrame'), bytes: cels.reduce((sum, cel) => sum + (cel.surface?.pixels.byteLength ?? 0), 0) + 64, undo: () => { deleteAnimationFrame(session.document, frameId); activateAnimationFrame(session.document, previousFrameId); session.activeLayerMaskId = null }, redo: () => { restore(); session.activeLayerMaskId = null } })
      session.animationPlaying = false
      session.activeLayerMaskId = null
      session.selection = null
    })
  },

  duplicateAnimationFrame() {
    get().mutateActive((session) => {
      const timeline = ensureAnimationDocument(session.document)
      const previousFrameId = timeline.activeFrameId
      const frameId = duplicateAnimationFrame(session.document)
      const frameIndex = timeline.frames.findIndex((frame) => frame.id === frameId)
      const frame = { ...timeline.frames[frameIndex] }
      const cels = cloneAnimationCelsForLayerIds(session.document, session.document.layers.map((layer) => layer.id), frameId)
      const groupMasks = (timeline.groupMasks ?? []).filter((entry) => entry.frameId === frameId).map((entry) => cloneAnimationGroupMask(entry))
      const restore = (): void => {
        const current = ensureAnimationDocument(session.document)
        if (!current.frames.some((candidate) => candidate.id === frameId)) current.frames.splice(Math.min(frameIndex, current.frames.length), 0, { ...frame })
        restoreAnimationCels(session.document, cels)
        current.groupMasks ??= []
        current.groupMasks.push(...groupMasks.filter((entry) => !current.groupMasks!.some((candidate) => candidate.mask.id === entry.mask.id)).map((entry) => cloneAnimationGroupMask(entry)))
        activateAnimationFrame(session.document, frameId)
      }
      session.history.push({ label: tr('workspace.history.duplicateAnimationFrame'), bytes: cels.reduce((sum, cel) => sum + (cel.surface?.pixels.byteLength ?? 0), 0) + groupMasks.reduce((sum, entry) => sum + entry.mask.pixels.byteLength, 0) + 64, undo: () => { deleteAnimationFrame(session.document, frameId); activateAnimationFrame(session.document, previousFrameId); session.activeLayerMaskId = null }, redo: () => { restore(); session.activeLayerMaskId = null } })
      session.animationPlaying = false
      session.activeLayerMaskId = null
      session.selection = null
    })
  },

  deleteAnimationFrame() {
    get().mutateActive((session) => {
      const timeline = ensureAnimationDocument(session.document)
      const frameId = timeline.activeFrameId
      const frameIndex = timeline.frames.findIndex((frame) => frame.id === frameId)
      const frame = { ...timeline.frames[frameIndex] }
      const cels = cloneAnimationCelsForLayerIds(session.document, session.document.layers.map((layer) => layer.id), frameId)
      const groupMasks = (timeline.groupMasks ?? []).filter((entry) => entry.frameId === frameId).map((entry) => cloneAnimationGroupMask(entry))
      if (!deleteAnimationFrame(session.document, frameId)) { set({ message: tr('workspace.animation.minimumFrame') }); return }
      const nextFrameId = ensureAnimationDocument(session.document).activeFrameId
      const restore = (): void => {
        const current = ensureAnimationDocument(session.document)
        if (!current.frames.some((candidate) => candidate.id === frameId)) current.frames.splice(Math.min(frameIndex, current.frames.length), 0, { ...frame })
        restoreAnimationCels(session.document, cels)
        current.groupMasks ??= []
        current.groupMasks.push(...groupMasks.filter((entry) => !current.groupMasks!.some((candidate) => candidate.mask.id === entry.mask.id)).map((entry) => cloneAnimationGroupMask(entry)))
        activateAnimationFrame(session.document, frameId)
      }
      session.history.push({ label: tr('workspace.history.deleteAnimationFrame'), bytes: cels.reduce((sum, cel) => sum + (cel.surface?.pixels.byteLength ?? 0), 0) + groupMasks.reduce((sum, entry) => sum + entry.mask.pixels.byteLength, 0) + 64, undo: () => { restore(); session.activeLayerMaskId = null }, redo: () => { deleteAnimationFrame(session.document, frameId); activateAnimationFrame(session.document, nextFrameId); session.activeLayerMaskId = null } })
      session.animationPlaying = false
      session.activeLayerMaskId = null
      session.selection = null
    })
  },

  setActiveAnimationFrameDuration(duration) {
    get().mutateActive((session) => {
      const timeline = ensureAnimationDocument(session.document)
      const selected = session.selectedAnimationFrameIds.includes(timeline.activeFrameId) ? new Set(session.selectedAnimationFrameIds) : new Set([timeline.activeFrameId])
      const frames = timeline.frames.filter((frame) => selected.has(frame.id))
      const nextDuration = Math.max(1, Math.min(60_000, Math.trunc(duration) || 100))
      const before = frames.map((frame) => ({ id: frame.id, duration: frame.duration }))
      if (!before.some((frame) => frame.duration !== nextDuration)) return
      for (const frame of frames) setAnimationFrameDuration(session.document, frame.id, nextDuration)
      const apply = (values: Array<{ id: string; duration: number }>): void => {
        const current = ensureAnimationDocument(session.document)
        for (const value of values) {
          const target = current.frames.find((frame) => frame.id === value.id)
          if (target) target.duration = value.duration
        }
      }
      const after = frames.map((frame) => ({ id: frame.id, duration: frame.duration }))
      session.history.push({ label: tr('workspace.history.animationFrameDuration'), bytes: frames.length * 32, undo: () => apply(before), redo: () => apply(after) })
    })
  },

  setAnimationLoop(loop) {
    get().mutateActive((session) => {
      const timeline = ensureAnimationDocument(session.document)
      const before = timeline.loop
      if (before === loop) return
      setAnimationLoop(session.document, loop)
      session.history.push({ label: tr('workspace.history.animationLoop'), bytes: 16, undo: () => { ensureAnimationDocument(session.document).loop = before }, redo: () => { ensureAnimationDocument(session.document).loop = loop } })
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
      const placement = selectedRowInsertionTarget(session)
      const layer = createLayer(tr('workspace.layer.defaultName', { index: document.layers.length + 1 }), document.width, document.height, document.colorMode)
      const targetGroupId = insertionTargetParent(document, placement)
      if (targetGroupId) layer.groupId = targetGroupId
      const groupMemberIds = targetGroupId ? new Set(getLayerIdsInGroup(document, targetGroupId)) : null
      const lastGroupMember = groupMemberIds ? document.layers.reduce((last, item, index) => groupMemberIds.has(item.id) ? index : last, -1) : -1
      const index = lastGroupMember >= 0 ? lastGroupMember + 1 : document.layers.length
      document.layers.splice(index, 0, layer)
      ensureAnimationDocument(document)
      const animationCels = cloneAnimationCelsForLayerIds(document, [layer.id])
      document.activeLayerId = layer.id
      session.selectedGroupId = null
      session.selectedGroupIds = []
      session.selectedLayerIds = [layer.id]
      session.history.beginCompound()
      session.history.push({
        label: tr('workspace.history.newLayer'), bytes: layer.pixels.byteLength,
        undo: () => { document.layers = document.layers.filter((item) => item.id !== layer.id); removeAnimationCelsForLayers(document, [layer.id]); document.activeLayerId = document.layers[Math.max(0, index - 1)].id },
        redo: () => { document.layers.splice(index, 0, layer); restoreAnimationCels(document, animationCels); document.activeLayerId = layer.id }
      })
      const placementHistory = moveLayerPanelRowsOperation(session, [layer.id], [], placement)
      if (placementHistory) session.history.push(placementHistory)
      session.history.endCompound(tr('workspace.history.newLayer'))
    })
  },

  duplicateActiveLayer() {
    get().mutateActive((session) => {
      const document = session.document
      const priorId = document.activeLayerId
      syncActiveAnimationFrame(document)
      const copy = duplicateLayer(document, priorId)
      cloneAnimationCelsForLayer(document, priorId, copy)
      const animationCels = cloneAnimationCelsForLayerIds(document, [copy.id])
      session.selectedGroupId = null
      session.selectedGroupIds = []
      session.selectedLayerIds = [copy.id]
      const index = document.layers.findIndex((item) => item.id === copy.id)
      session.history.push({
        label: tr('workspace.history.copyLayer'), bytes: layerHistoryBytes(copy),
        undo: () => { document.layers = document.layers.filter((item) => item.id !== copy.id); removeAnimationCelsForLayers(document, [copy.id]); document.activeLayerId = priorId },
        redo: () => { document.layers.splice(index, 0, copy); restoreAnimationCels(document, animationCels); document.activeLayerId = copy.id }
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
      syncActiveAnimationFrame(document)
      const copies = orderedIds.map((id) => {
        const copy = duplicateLayer(document, id)
        cloneAnimationCelsForLayer(document, id, copy)
        return copy
      })
      if (copies.length === 0) return
      createdIds.push(...copies.map((copy) => copy.id))
      const placements = copies.map((copy) => ({ copy, index: document.layers.indexOf(copy) }))
      const animationCels = cloneAnimationCelsForLayerIds(document, createdIds)
      document.activeLayerId = copies.at(-1)!.id
      session.selectedGroupId = null
      session.selectedGroupIds = []
      session.selectedLayerIds = [...createdIds]
      session.history.push({
        label: tr('workspace.history.copyLayer'),
        bytes: copies.reduce((sum, copy) => sum + layerHistoryBytes(copy), 0),
        undo: () => {
          const ids = new Set(createdIds)
          document.layers = document.layers.filter((layer) => !ids.has(layer.id))
          removeAnimationCelsForLayers(document, createdIds)
          document.activeLayerId = priorActiveId
          session.selectedLayerIds = priorSelection
          session.selectedGroupId = null
          session.selectedGroupIds = []
        },
        redo: () => {
          for (const { copy, index } of placements) if (!document.layers.some((layer) => layer.id === copy.id)) document.layers.splice(Math.min(index, document.layers.length), 0, copy)
          restoreAnimationCels(document, animationCels)
          document.activeLayerId = copies.at(-1)!.id
          session.selectedLayerIds = [...createdIds]
          session.selectedGroupId = null
          session.selectedGroupIds = []
        }
      })
    })
    return createdIds
  },

  duplicateSelectedLayerRows() {
    const result = { layerIds: [] as string[], groupIds: [] as string[] }
    const current = activeSession(get())
    if (!current) return result
    const selectedGroups = new Set(selectedGroupRows(current))
    const rootGroupIds = [...selectedGroups].filter((groupId) => !current.document.groups.some((candidate) => selectedGroups.has(candidate.id) && getDescendantGroupIds(current.document, candidate.id).includes(groupId)))
    const copiedGroupIds = new Set<string>()
    for (const rootGroupId of rootGroupIds) {
      copiedGroupIds.add(rootGroupId)
      for (const descendantId of getDescendantGroupIds(current.document, rootGroupId)) copiedGroupIds.add(descendantId)
    }
    const directLayerIds = selectedDirectLayerRows(current).filter((layerId) => {
      const layer = current.document.layers.find((candidate) => candidate.id === layerId)
      return Boolean(layer && (!layer.groupId || !copiedGroupIds.has(layer.groupId)))
    })
    if (rootGroupIds.length === 0 && directLayerIds.length === 0) return result
    get().mutateActive((session) => {
      const document = session.document
      const placement = selectedRowInsertionTarget(session)
      const previousActiveId = document.activeLayerId
      const previousLayerIds = [...session.selectedLayerIds]
      const previousGroupId = session.selectedGroupId
      const previousGroupIds = [...session.selectedGroupIds]
      const previousCollapsedGroupIds = [...session.collapsedGroupIds]
      const groupIdMap = new Map([...copiedGroupIds].map((id) => [id, createId('group')]))
      const groups = document.groups.filter((group) => copiedGroupIds.has(group.id)).map((group): LayerGroup => ({
        ...group,
        id: groupIdMap.get(group.id)!,
        name: `${group.name} ${tr('canvas.history.copySuffix')}`,
        parentGroupId: group.parentGroupId && groupIdMap.has(group.parentGroupId) ? groupIdMap.get(group.parentGroupId)! : group.parentGroupId ?? null,
        panelOrder: typeof group.panelOrder === 'number' ? group.panelOrder + 0.01 : group.panelOrder,
        displayColor: group.displayColor ? { ...group.displayColor } : undefined
      }))
      const timeline = ensureAnimationDocument(document)
      const groupMasks = (timeline.groupMasks ?? [])
        .filter((entry) => copiedGroupIds.has(entry.groupId))
        .map((entry) => cloneAnimationGroupMask(entry, groupIdMap.get(entry.groupId)!, entry.frameId, createId('mask')))
      const copiedCollapsedGroupIds = [...copiedGroupIds]
        .filter((id) => previousCollapsedGroupIds.includes(id))
        .map((id) => groupIdMap.get(id)!)
      const allLayerIds = new Set(directLayerIds)
      for (const groupId of copiedGroupIds) for (const layerId of getLayerIdsInGroup(document, groupId)) allLayerIds.add(layerId)
      syncActiveAnimationFrame(document)
      const sourceLayers = document.layers.filter((layer) => allLayerIds.has(layer.id))
      const layers = sourceLayers.map((source): RasterLayer => {
        const id = createId('layer')
        const common = { ...source, id, name: `${source.name} ${tr('canvas.history.copySuffix')}`, groupId: source.groupId && groupIdMap.has(source.groupId) ? groupIdMap.get(source.groupId)! : source.groupId, displayColor: source.displayColor ? { ...source.displayColor } : undefined }
        return source.format === 'rgba'
          ? { ...common, format: 'rgba', pixels: new Uint8ClampedArray(source.pixels) }
          : { ...common, format: 'indexed', pixels: new Uint32Array(source.pixels) }
      })
      const directSourceIds = new Set(directLayerIds)
      result.layerIds = layers.filter((_, index) => directSourceIds.has(sourceLayers[index].id)).map((layer) => layer.id)
      result.groupIds = rootGroupIds.map((id) => groupIdMap.get(id)!).filter(Boolean)
      const insertionIndex = Math.max(0, ...sourceLayers.map((layer) => document.layers.indexOf(layer))) + 1
      document.groups.push(...groups)
      timeline.groupMasks ??= []
      timeline.groupMasks.push(...groupMasks)
      document.layers.splice(insertionIndex, 0, ...layers)
      layers.forEach((layer, index) => cloneAnimationCelsForLayer(document, sourceLayers[index].id, layer))
      const animationCels = cloneAnimationCelsForLayerIds(document, layers.map((layer) => layer.id))
      document.activeLayerId = layers.at(-1)?.id ?? previousActiveId
      session.collapsedGroupIds = [...new Set([...previousCollapsedGroupIds, ...copiedCollapsedGroupIds])]
      applyLayerRowSelection(session, layers.map((layer) => layer.id), result.groupIds, layers.length > 0 ? { kind: 'layer', id: layers.at(-1)!.id } : { kind: 'group', id: result.groupIds.at(-1)! })
      const createdLayerIds = new Set(layers.map((layer) => layer.id))
      const createdGroupIds = new Set(groups.map((group) => group.id))
      const creationHistory: HistoryEntry = {
        label: tr('workspace.history.copyLayer'),
        bytes: layers.reduce((sum, layer) => sum + layerHistoryBytes(layer), 0) + groups.reduce((sum, group) => sum + groupHistoryBytes(group), 0) + groupMasks.reduce((sum, entry) => sum + entry.mask.pixels.byteLength, 0),
        undo: () => {
          document.layers = document.layers.filter((layer) => !createdLayerIds.has(layer.id))
          removeAnimationCelsForLayers(document, layers.map((layer) => layer.id))
          document.groups = document.groups.filter((group) => !createdGroupIds.has(group.id))
          timeline.groupMasks = (timeline.groupMasks ?? []).filter((entry) => !createdGroupIds.has(entry.groupId))
          document.activeLayerId = previousActiveId
          session.selectedLayerIds = previousLayerIds
          session.selectedGroupId = previousGroupId
          session.selectedGroupIds = previousGroupIds
          session.collapsedGroupIds = previousCollapsedGroupIds
        },
        redo: () => {
          for (const group of groups) if (!document.groups.includes(group)) document.groups.push(group)
          timeline.groupMasks ??= []
          for (const entry of groupMasks) if (!timeline.groupMasks.some((candidate) => candidate.mask.id === entry.mask.id)) timeline.groupMasks.push(entry)
          const missing = layers.filter((layer) => !document.layers.includes(layer))
          if (missing.length > 0) document.layers.splice(Math.min(insertionIndex, document.layers.length), 0, ...missing)
          restoreAnimationCels(document, animationCels)
          document.activeLayerId = layers.at(-1)?.id ?? previousActiveId
          session.collapsedGroupIds = [...new Set([...previousCollapsedGroupIds, ...copiedCollapsedGroupIds])]
          applyLayerRowSelection(session, layers.map((layer) => layer.id), result.groupIds, layers.length > 0 ? { kind: 'layer', id: layers.at(-1)!.id } : { kind: 'group', id: result.groupIds.at(-1)! })
        }
      }
      const placementHistory = moveLayerPanelRowsOperation(session, result.layerIds, result.groupIds, placement)
      session.history.push(placementHistory ? {
        label: creationHistory.label,
        bytes: creationHistory.bytes + placementHistory.bytes,
        undo: () => { placementHistory.undo(); creationHistory.undo() },
        redo: () => { creationHistory.redo(); placementHistory.redo() }
      } : creationHistory)
    })
    return result
  },

  deleteActiveLayer() {
    if ((activeSession(get())?.selectedLayerIds.length ?? 0) > 1) {
      get().deleteSelectedLayers()
      return
    }
    get().mutateActive((session) => {
      const document = session.document
      if (document.layers.length === 1) { set({ message: tr('workspace.layer.minimum') }); return }
      const index = document.layers.findIndex((item) => item.id === document.activeLayerId)
      const removed = document.layers[index]
      if (!removed || isLayerEffectivelyLocked(document, removed)) { set({ message: tr('workspace.layer.lockedDelete') }); return }
      const animationCels = cloneAnimationCelsForLayerIds(document, [removed.id])
      document.layers.splice(index, 1)
      removeAnimationCelsForLayers(document, [removed.id])
      const nextId = document.layers[Math.max(0, index - 1)].id
      document.activeLayerId = nextId
      session.selectedGroupId = null
      session.selectedGroupIds = []
      session.selectedLayerIds = [nextId]
      session.history.push({
        label: tr('workspace.history.deleteLayer'), bytes: layerHistoryBytes(removed),
        undo: () => { document.layers.splice(index, 0, removed); restoreAnimationCels(document, animationCels); document.activeLayerId = removed.id },
        redo: () => { document.layers = document.layers.filter((item) => item.id !== removed.id); removeAnimationCelsForLayers(document, [removed.id]); document.activeLayerId = nextId }
      })
    })
  },

  deleteSelectedLayers() {
    const current = activeSession(get())
    if (!current) return
    const selectedGroupIdSet = new Set<string>()
    for (const groupId of selectedGroupRows(current)) {
      selectedGroupIdSet.add(groupId)
      for (const descendantId of getDescendantGroupIds(current.document, groupId)) selectedGroupIdSet.add(descendantId)
    }
    const selectedIds = new Set(selectedDirectLayerRows(current))
    for (const groupId of selectedGroupIdSet) for (const layerId of getLayerIdsInGroup(current.document, groupId)) selectedIds.add(layerId)
    const removedGroups = current.document.groups.map((group, index) => ({ group, index })).filter(({ group }) => selectedGroupIdSet.has(group.id))
    const removed = current.document.layers.map((layer, index) => ({ layer, index })).filter(({ layer }) => selectedIds.has(layer.id))
    if (removed.length === 0 && removedGroups.length === 0) return
    const locked = removed.some(({ layer }) => isLayerEffectivelyLocked(current.document, layer))
      || removedGroups.some(({ group }) => isGroupEffectivelyLocked(current.document, group))
    if (locked) { set({ message: tr('workspace.layer.structureLocked') }); return }
    if (removed.length >= current.document.layers.length) { set({ message: tr('workspace.layer.minimum') }); return }
    get().mutateActive((session) => {
      const document = session.document
      const previousActiveId = document.activeLayerId
      const previousSelection = [...session.selectedLayerIds]
      const previousGroupId = session.selectedGroupId
      const previousGroupIds = [...session.selectedGroupIds]
      const animationCels = cloneAnimationCelsForLayerIds(document, [...selectedIds])
      const timeline = ensureAnimationDocument(document)
      const removedGroupMasks = (timeline.groupMasks ?? []).filter((entry) => selectedGroupIdSet.has(entry.groupId)).map((entry) => cloneAnimationGroupMask(entry))
      document.layers = document.layers.filter((layer) => !selectedIds.has(layer.id))
      removeAnimationCelsForLayers(document, [...selectedIds])
      timeline.groupMasks = (timeline.groupMasks ?? []).filter((entry) => !selectedGroupIdSet.has(entry.groupId))
      if (removedGroups.length > 0) document.groups = document.groups.filter((group) => !selectedGroupIdSet.has(group.id))
      const nearestIndex = removed.length > 0 ? Math.max(0, Math.min(document.layers.length - 1, removed[0].index - 1)) : document.layers.findIndex((layer) => layer.id === previousActiveId)
      const nextId = document.layers[Math.max(0, nearestIndex)]?.id ?? previousActiveId
      document.activeLayerId = nextId
      session.selectedGroupId = null
      session.selectedGroupIds = []
      session.selectedLayerIds = [nextId]
      session.history.push({
        label: removedGroups.length > 0 ? tr('workspace.history.deleteGroup') : removed.length === 1 ? tr('workspace.history.deleteLayer') : tr('workspace.history.deleteLayers'),
        bytes: removed.reduce((sum, item) => sum + layerHistoryBytes(item.layer), 0) + removedGroups.reduce((sum, item) => sum + groupHistoryBytes(item.group), 0) + removedGroupMasks.reduce((sum, entry) => sum + entry.mask.pixels.byteLength, 0),
        undo: () => {
          for (const item of removedGroups) if (!document.groups.some((group) => group.id === item.group.id)) document.groups.splice(Math.min(item.index, document.groups.length), 0, item.group)
          for (const item of removed) if (!document.layers.some((layer) => layer.id === item.layer.id)) document.layers.splice(Math.min(item.index, document.layers.length), 0, item.layer)
          restoreAnimationCels(document, animationCels)
          timeline.groupMasks ??= []
          for (const entry of removedGroupMasks) if (!timeline.groupMasks.some((candidate) => candidate.mask.id === entry.mask.id)) timeline.groupMasks.push(cloneAnimationGroupMask(entry))
          document.activeLayerId = previousActiveId
          session.selectedLayerIds = previousSelection
          session.selectedGroupId = previousGroupId
          session.selectedGroupIds = previousGroupIds
        },
        redo: () => {
          document.layers = document.layers.filter((layer) => !selectedIds.has(layer.id))
          removeAnimationCelsForLayers(document, [...selectedIds])
          document.groups = document.groups.filter((group) => !selectedGroupIdSet.has(group.id))
          timeline.groupMasks = (timeline.groupMasks ?? []).filter((entry) => !selectedGroupIdSet.has(entry.groupId))
          document.activeLayerId = nextId
          session.selectedLayerIds = [nextId]
          session.selectedGroupId = null
          session.selectedGroupIds = []
        }
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
    commitLayerMerge(session, beforeDocument, beforeUi, result, tr('workspace.history.mergeSelected'))
    set({ sessions: [...state.sessions], message: tr('workspace.layer.mergedSelected') })
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
    commitLayerMerge(session, beforeDocument, beforeUi, result, tr('workspace.history.mergeDown'))
    set({ sessions: [...state.sessions], message: tr('workspace.layer.mergedDown') })
  },

  mergeSelectedGroup() {
    get().commitFloatingPaste()
    const state = get()
    const session = activeSession(state)
    if (!session?.selectedGroupId) { set({ message: tr('workspace.group.selectFirst') }); return }
    const beforeDocument = encodeProject(session.document)
    const beforeUi = captureLayerUi(session)
    const result = mergeLayerGroup(session.document, session.selectedGroupId)
    if (!result.ok) { set({ message: result.reason }); return }
    commitLayerMerge(session, beforeDocument, beforeUi, result, tr('workspace.history.mergeGroup'))
    set({ sessions: [...state.sessions], message: tr('workspace.group.merged') })
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
    commitLayerMerge(session, beforeDocument, beforeUi, result, tr('workspace.history.mergeVisible'))
    set({ sessions: [...state.sessions], message: tr('workspace.layers.visibleMerged') })
  },

  moveLayer(direction) {
    get().mutateActive((session) => {
      const document = session.document
      const index = document.layers.findIndex((layer) => layer.id === document.activeLayerId)
      const target = index + direction
      if (target < 0 || target >= document.layers.length) return
      ;[document.layers[index], document.layers[target]] = [document.layers[target], document.layers[index]]
      session.history.push({
        label: tr('canvas.history.moveLayer'), bytes: 32,
        undo: () => { ;[document.layers[index], document.layers[target]] = [document.layers[target], document.layers[index]] },
        redo: () => { ;[document.layers[index], document.layers[target]] = [document.layers[target], document.layers[index]] }
      })
    })
  },

  moveLayerBy(layerId, deltaX, deltaY, label = tr('canvas.history.moveLayer')) {
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
    const current = activeSession(get())
    if (current && lockedLayerStructure(current.document, layerIds)) { set({ message: tr('workspace.layer.lockedMove') }); return }
    get().mutateActive((session) => {
      const history = reorderLayersOperation(session, layerIds, targetLayerId, insertAfterTarget)
      if (history) session.history.push(history)
    })
  },

  assignLayerToGroup(layerId, groupId) {
    get().assignLayersToGroup([layerId], groupId)
  },

  assignLayersToGroup(layerIds, groupId, targetLayerId, insertAfterTarget = true) {
    const current = activeSession(get())
    if (current && lockedLayerStructure(current.document, layerIds)) { set({ message: tr('workspace.layer.lockedMove') }); return }
    get().mutateActive((session) => {
      const history = assignLayersToGroupOperation(session, layerIds, groupId, targetLayerId, insertAfterTarget)
      if (history) session.history.push(history)
    })
  },

  assignLayersToRoot(layerIds, targetLayerId, insertAfterTarget = true) {
    const current = activeSession(get())
    if (current && lockedLayerStructure(current.document, layerIds)) { set({ message: tr('workspace.layer.lockedMove') }); return }
    get().mutateActive((session) => {
      const history = assignLayersToRootOperation(session, layerIds, targetLayerId, insertAfterTarget)
      if (history) session.history.push(history)
    })
  },

  assignLayersAboveGroup(layerIds, groupId) {
    const current = activeSession(get())
    if (current && lockedLayerStructure(current.document, layerIds)) { set({ message: tr('workspace.layer.lockedMove') }); return }
    get().mutateActive((session) => {
      const history = assignLayersAboveGroupOperation(session, layerIds, groupId)
      if (history) session.history.push(history)
    })
  },

  reorderGroup(groupId, targetGroupId, insertAfterTarget = true) {
    if (groupId === targetGroupId) return
    const current = activeSession(get())
    if (current && lockedGroupStructure(current.document, groupId)) { set({ message: tr('workspace.group.lockedMove') }); return }
    get().mutateActive((session) => {
      if (!canMoveGroupInto(session.document, groupId, targetGroupId)) {
        set({ message: tr('workspace.group.moveNextToChild') })
        return
      }
      const history = reorderGroupOperation(session, groupId, targetGroupId, insertAfterTarget)
      if (history) session.history.push(history)
    })
  },

  positionGroupNextToLayer(groupId, targetLayerId, insertAfterTarget = true) {
    const current = activeSession(get())
    if (current && lockedGroupStructure(current.document, groupId)) { set({ message: tr('workspace.group.lockedMove') }); return }
    get().mutateActive((session) => {
      const history = positionGroupNextToLayerOperation(session, groupId, targetLayerId, insertAfterTarget)
      if (history) session.history.push(history)
    })
  },

  assignGroupToGroup(groupId, parentGroupId) {
    if (groupId === parentGroupId) return
    const current = activeSession(get())
    if (current && lockedGroupStructure(current.document, groupId)) { set({ message: tr('workspace.group.lockedMove') }); return }
    get().mutateActive((session) => {
      if (!canMoveGroupInto(session.document, groupId, parentGroupId)) { set({ message: tr('workspace.group.moveIntoChild') }); return }
      const history = assignGroupToGroupOperation(session, groupId, parentGroupId)
      if (history) session.history.push(history)
    })
  },

  assignGroupToRoot(groupId) {
    const current = activeSession(get())
    if (current && lockedGroupStructure(current.document, groupId)) { set({ message: tr('workspace.group.lockedMove') }); return }
    get().mutateActive((session) => {
      const history = assignGroupToRootOperation(session, groupId)
      if (history) session.history.push(history)
    })
  },

  moveLayersToRootEdge(layerIds, edge) {
    const current = activeSession(get())
    if (current && lockedLayerStructure(current.document, layerIds)) { set({ message: tr('workspace.layer.lockedMove') }); return }
    get().mutateActive((session) => {
      const history = moveLayersToRootEdgeOperation(session, layerIds, edge)
      if (history) session.history.push(history)
    })
  },

  moveGroupToRootEdge(groupId, edge) {
    const current = activeSession(get())
    if (current && lockedGroupStructure(current.document, groupId)) { set({ message: tr('workspace.group.lockedMove') }); return }
    get().mutateActive((session) => {
      const history = moveGroupToRootEdgeOperation(session, groupId, edge)
      if (history) session.history.push(history)
    })
  },

  moveLayerRows(layerIds, groupIds, target) {
    const current = activeSession(get())
    if (current && (lockedLayerStructure(current.document, layerIds) || groupIds.some((groupId) => lockedGroupStructure(current.document, groupId)))) {
      set({ message: tr('workspace.layer.lockedMove') })
      return
    }
    get().mutateActive((session) => {
      const history = moveLayerPanelRowsOperation(session, layerIds, groupIds, target)
      if (history) session.history.push(history)
    })
  },

  createLayerGroup() {
    get().mutateActive((session) => {
      const placement = selectedRowInsertionTarget(session)
      const placeRelativeToSelectedGroup = Boolean(session.selectedGroupId)
      session.history.beginCompound()
      const history = createLayerGroupOperation(session, createId('group'), tr('workspace.group.defaultName', { index: session.document.groups.length + 1 }))
      if (history) session.history.push(history)
      if (history && placeRelativeToSelectedGroup && session.selectedGroupId) {
        const placementHistory = moveLayerPanelRowsOperation(session, [], [session.selectedGroupId], placement)
        if (placementHistory) session.history.push(placementHistory)
      }
      session.history.endCompound(history?.label ?? tr('workspace.history.newLayer'))
    })
  },

  ungroupSelected() {
    const current = activeSession(get())
    const groupIds = current?.selectedGroupId ? [current.selectedGroupId] : current?.document.layers.filter((layer) => current.selectedLayerIds.includes(layer.id) && layer.groupId).map((layer) => layer.groupId!) ?? []
    if (current && groupIds.some((groupId) => lockedGroupStructure(current.document, groupId))) { set({ message: tr('workspace.group.lockedUngroup') }); return }
    get().mutateActive((session) => {
      const timeline = ensureAnimationDocument(session.document)
      const removedGroupMasks = (timeline.groupMasks ?? []).filter((entry) => groupIds.includes(entry.groupId)).map((entry) => cloneAnimationGroupMask(entry))
      const history = ungroupSelectedOperation(session)
      if (!history) return
      const maskIds = new Set(removedGroupMasks.map((entry) => entry.mask.id))
      const removeMasks = (): void => { timeline.groupMasks = (timeline.groupMasks ?? []).filter((entry) => !maskIds.has(entry.mask.id)) }
      const restoreMasks = (): void => { timeline.groupMasks ??= []; for (const entry of removedGroupMasks) if (!timeline.groupMasks.some((candidate) => candidate.mask.id === entry.mask.id)) timeline.groupMasks.push(cloneAnimationGroupMask(entry)) }
      removeMasks()
      session.history.push({ label: history.label, bytes: history.bytes + removedGroupMasks.reduce((sum, entry) => sum + entry.mask.pixels.byteLength, 0), undo: () => { history.undo(); restoreMasks() }, redo: () => { history.redo(); removeMasks() } })
    })
  },

  toggleLayerVisibility(layerId) {
    get().mutateActive((session) => {
      const layer = getLayer(session.document, layerId)
      const before = layer.visible
      layer.visible = !before
      session.history.push({ label: tr('workspace.history.showLayer'), bytes: 8, undo: () => { layer.visible = before }, redo: () => { layer.visible = !before } })
    })
  },

  selectLayer(layerId, mode = 'replace') {
    get().commitFloatingPaste()
    get().mutateActive((session) => {
      const selectionMode: Exclude<LayerRowSelectionMode, boolean> = mode === true ? 'toggle' : mode === false ? 'replace' : mode
      if (selectionMode === 'range') {
        applyLayerRowRange(session, { kind: 'layer', id: layerId })
      } else if (selectionMode === 'toggle') {
        const layers = selectedDirectLayerRows(session)
        const nextLayers = layers.includes(layerId) ? layers.filter((id) => id !== layerId) : [...layers, layerId]
        applyLayerRowSelection(session, nextLayers, selectedGroupRows(session), { kind: 'layer', id: layerId })
        session.layerSelectionAnchorId = layerId
      } else {
        applyLayerRowSelection(session, [layerId], [], { kind: 'layer', id: layerId })
        session.layerSelectionAnchorId = layerId
      }
      if (selectionMode !== 'replace') applyLayerCurrentFrameCellSelection(session, selectedDirectLayerRows(session), layerId)
    }, false)
  },

  selectMoveToolLayer(layerId, additive = false) {
    get().commitFloatingPaste()
    get().mutateActive((session) => {
      if (!session.document.layers.some((layer) => layer.id === layerId)) return
      const currentLayerIds = selectedDirectLayerRows(session)
      const selectedLayerIds = additive
        ? currentLayerIds.includes(layerId)
          ? currentLayerIds.filter((candidate) => candidate !== layerId)
          : [...currentLayerIds, layerId]
        : [layerId]
      applyLayerRowSelection(session, selectedLayerIds, [], { kind: 'layer', id: layerId })
      applyLayerCurrentFrameCellSelection(session, selectedLayerIds, layerId)
    }, false)
  },

  selectGroup(groupId, mode = 'replace') {
    get().commitFloatingPaste()
    get().mutateActive((session) => {
      getGroup(session.document, groupId)
      const selectionMode: Exclude<LayerRowSelectionMode, boolean> = mode === true ? 'toggle' : mode === false ? 'replace' : mode
      if (selectionMode === 'range') applyLayerRowRange(session, { kind: 'group', id: groupId })
      else if (selectionMode === 'toggle') {
        const groups = selectedGroupRows(session)
        const nextGroups = groups.includes(groupId) ? groups.filter((id) => id !== groupId) : [...groups, groupId]
        applyLayerRowSelection(session, selectedDirectLayerRows(session), nextGroups, { kind: 'group', id: groupId })
        session.layerSelectionAnchorId = groupId
      } else {
        applyLayerRowSelection(session, [], [groupId], { kind: 'group', id: groupId })
        session.layerSelectionAnchorId = groupId
      }
    }, false)
  },

  selectLayerRows(layerIds, groupIds) {
    get().mutateActive((session) => {
      const focus = layerIds.length > 0 ? { kind: 'layer' as const, id: layerIds.at(-1)! } : { kind: 'group' as const, id: groupIds.at(-1)! }
      applyLayerRowSelection(session, layerIds, groupIds, focus)
    }, false)
  },

  clearLayerSelection() {
    get().commitFloatingPaste()
    get().mutateActive((session) => {
      session.selectedGroupId = null
      session.selectedGroupIds = []
      session.selectedLayerIds = []
      session.activeLayerMaskId = null
      session.layerSelectionAnchorId = null
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
      session.history.push({ label: tr('workspace.history.showGroup'), bytes: 8, undo: () => { group.visible = before }, redo: () => { group.visible = !before } })
    })
  },

  selectLayerMask(celId, additive = false) {
    get().commitFloatingPaste()
    get().mutateActive((session) => {
      const timeline = ensureAnimationDocument(session.document)
      const cel = timeline.cels.find((candidate) => candidate.id === celId)
      const mask = cel ? animationMaskAt(timeline, cel.layerId, cel.frameId) : null
      if (!cel || !mask) return
      activateAnimationFrame(session.document, cel.frameId)
      applyLayerRowSelection(session, [], [], { kind: 'layer', id: cel.layerId })
      session.activeLayerMaskId = mask.id
      session.layerMaskIsolatedView = true
      const key = animationCelKey(cel.layerId, cel.frameId)
      session.selectedAnimationCellKeys = []
      session.animationCellSelectionAnchorKey = null
      const selected = new Set(additive ? session.selectedAnimationMaskCellKeys : [])
      selected.add(key)
      session.selectedAnimationMaskCellKeys = [...selected]
      session.animationMaskCellSelectionAnchorKey = key
    }, false)
  },

  selectGroupMask(groupId, frameId, additive = false) {
    get().commitFloatingPaste()
    get().mutateActive((session) => {
      const timeline = ensureAnimationDocument(session.document)
      const mask = animationMaskAt(timeline, groupId, frameId)
      if (!mask || !session.document.groups.some((group) => group.id === groupId)) return
      activateAnimationFrame(session.document, frameId)
      applyLayerRowSelection(session, [], [groupId], { kind: 'group', id: groupId })
      session.activeLayerMaskId = mask.id
      session.layerMaskIsolatedView = true
      const key = animationCelKey(groupId, frameId)
      session.selectedAnimationCellKeys = []
      session.animationCellSelectionAnchorKey = null
      const selected = new Set(additive ? session.selectedAnimationMaskCellKeys : [])
      selected.add(key)
      session.selectedAnimationMaskCellKeys = [...selected]
      session.animationMaskCellSelectionAnchorKey = key
    }, false)
  },

  toggleLayerMaskVisibility(celId) {
    get().mutateActive((session) => {
      const timeline = ensureAnimationDocument(session.document)
      const cel = timeline.cels.find((candidate) => candidate.id === celId)
      const mask = cel ? animationMaskAt(timeline, cel.layerId, cel.frameId) : null
      if (!mask) return
      const before = mask.visible
      mask.visible = !before
      session.history.push({ label: tr('workspace.history.showLayer'), bytes: 8, undo: () => { mask.visible = before }, redo: () => { mask.visible = !before } })
    })
  },

  toggleGroupMaskVisibility(groupId, frameId) {
    get().mutateActive((session) => {
      const mask = animationMaskAt(ensureAnimationDocument(session.document), groupId, frameId)
      if (!mask) return
      const before = mask.visible
      mask.visible = !before
      session.history.push({ label: tr('workspace.history.showLayer'), bytes: 8, undo: () => { mask.visible = before }, redo: () => { mask.visible = !before } })
    })
  },

  createLayerMask(celId, frameId) {
    const current = activeSession(get())
    if (!current) return
    const currentTimeline = ensureAnimationDocument(current.document)
    const directCel = currentTimeline.cels.find((candidate) => candidate.id === celId)
    const targetLayerId = directCel?.layerId ?? celId
    const targetFrameId = directCel?.frameId ?? frameId ?? currentTimeline.activeFrameId
    const currentCel = directCel ?? currentTimeline.cels.find((candidate) => candidate.layerId === targetLayerId && candidate.frameId === targetFrameId)
    const currentSourceCel = resolveAnimationCel(currentTimeline, currentCel ?? null) ?? currentCel
    const currentLayer = current.document.layers.find((layer) => layer.id === targetLayerId)
    if (!currentLayer || !currentTimeline.frames.some((candidate) => candidate.id === targetFrameId)) return
    if (isLayerEffectivelyLocked(current.document, currentLayer)) { set({ message: tr('workspace.layerMask.locked') }); return }
    if (currentSourceCel?.mask) { get().selectLayerMask(currentSourceCel.id); return }
    if (!animationCelHasContent(currentSourceCel ?? null, current.document.palette)) { set({ message: tr('workspace.layerMask.emptyCel') }); return }
    get().mutateActive((session) => {
      const timeline = ensureAnimationDocument(session.document)
      const ensured = ensureAnimationCelSlot(session.document, targetLayerId, targetFrameId)
      const cel = directCel ?? ensured?.cel ?? timeline.cels.find((candidate) => candidate.layerId === targetLayerId && candidate.frameId === targetFrameId)
      const sourceCel = resolveAnimationCel(timeline, cel ?? null) ?? cel
      if (!cel || !sourceCel) return
      if (sourceCel.mask) { session.activeLayerMaskId = sourceCel.mask.id; return }
      if (!animationCelHasContent(sourceCel, session.document.palette)) return
      const mask = createAttachedLayerMask(sourceCel.id, session.document.width, session.document.height)
      sourceCel.mask = mask
      activateAnimationFrame(session.document, targetFrameId)
      refreshActiveAnimationFrame(session.document)
      applyLayerRowSelection(session, [], [], { kind: 'layer', id: targetLayerId })
      session.activeLayerMaskId = mask.id
      session.layerMaskIsolatedView = false
      const key = animationCelKey(targetLayerId, targetFrameId)
      session.selectedAnimationCellKeys = []
      session.animationCellSelectionAnchorKey = null
      session.selectedAnimationMaskCellKeys = [key]
      session.animationMaskCellSelectionAnchorKey = key
      session.history.push({
        label: tr('workspace.history.createLayerMask'),
        bytes: mask.pixels.byteLength,
        undo: () => { delete sourceCel.mask; if (ensured?.created) timeline.cels = timeline.cels.filter((candidate) => candidate !== cel); if (session.activeLayerMaskId === mask.id) { session.activeLayerMaskId = null; session.layerMaskIsolatedView = false } },
        redo: () => { if (ensured?.created && !timeline.cels.includes(cel)) timeline.cels.push(cel); sourceCel.mask = mask; session.activeLayerMaskId = mask.id; session.layerMaskIsolatedView = false; refreshActiveAnimationFrame(session.document) },
        invalidation: { kind: 'full' }
      })
    })
  },

  createLayerMasksForLayer(layerId) {
    const current = activeSession(get())
    if (!current) return
    const layer = current.document.layers.find((candidate) => candidate.id === layerId)
    if (!layer) return
    if (isLayerEffectivelyLocked(current.document, layer)) { set({ message: tr('workspace.layerMask.locked') }); return }
    const currentTimeline = ensureAnimationDocument(current.document)
    const currentSources = new Map<string, AnimationCel>()
    for (const cel of currentTimeline.cels) {
      if (cel.layerId !== layerId) continue
      const source = resolveAnimationCel(currentTimeline, cel) ?? cel
      if (animationCelHasContent(source, current.document.palette)) currentSources.set(source.id, source)
    }
    if (currentSources.size === 0) { set({ message: tr('workspace.layerMask.emptyCel') }); return }
    if (![...currentSources.values()].some((source) => !source.mask)) return
    get().mutateActive((session) => {
      const timeline = ensureAnimationDocument(session.document)
      const sources = new Map<string, AnimationCel>()
      for (const cel of timeline.cels) {
        if (cel.layerId !== layerId) continue
        const source = resolveAnimationCel(timeline, cel) ?? cel
        if (animationCelHasContent(source, session.document.palette)) sources.set(source.id, source)
      }
      const created = [...sources.values()].flatMap((source) => {
        if (source.mask) return []
        const mask = createAttachedLayerMask(source.id, session.document.width, session.document.height)
        source.mask = mask
        return [{ source, mask }]
      })
      if (created.length === 0) return
      const activeCel = timeline.cels.find((cel) => cel.layerId === layerId && cel.frameId === timeline.activeFrameId)
      const activeSource = resolveAnimationCel(timeline, activeCel ?? null) ?? activeCel
      const activeMask = activeSource?.mask ?? null
      applyLayerRowSelection(session, [layerId], [], { kind: 'layer', id: layerId })
      session.activeLayerMaskId = activeMask?.id ?? null
      session.layerMaskIsolatedView = false
      session.selectedAnimationCellKeys = []
      session.animationCellSelectionAnchorKey = null
      session.selectedAnimationMaskCellKeys = activeMask ? [animationCelKey(layerId, timeline.activeFrameId)] : []
      session.animationMaskCellSelectionAnchorKey = session.selectedAnimationMaskCellKeys[0] ?? null
      refreshActiveAnimationFrame(session.document)
      const createdMaskIds = new Set(created.map(({ mask }) => mask.id))
      const remove = (): void => {
        for (const { source, mask } of created) if (source.mask === mask) delete source.mask
        if (session.activeLayerMaskId && createdMaskIds.has(session.activeLayerMaskId)) session.activeLayerMaskId = null
        refreshActiveAnimationFrame(session.document)
      }
      const restore = (): void => {
        for (const { source, mask } of created) source.mask = mask
        session.activeLayerMaskId = activeMask?.id ?? null
        session.layerMaskIsolatedView = false
        refreshActiveAnimationFrame(session.document)
      }
      session.history.push({
        label: tr('workspace.history.createLayerMask'),
        bytes: created.reduce((sum, { mask }) => sum + mask.pixels.byteLength, 0),
        undo: remove,
        redo: restore,
        invalidation: { kind: 'full' }
      })
    })
  },

  createGroupMask(groupId, frameId) {
    const current = activeSession(get())
    if (!current) return
    const group = current.document.groups.find((candidate) => candidate.id === groupId)
    const targetFrameId = frameId ?? ensureAnimationDocument(current.document).activeFrameId
    if (!group) return
    if (isGroupEffectivelyLocked(current.document, group)) { set({ message: tr('workspace.layerMask.locked') }); return }
    const existing = animationGroupMaskAt(ensureAnimationDocument(current.document), groupId, targetFrameId)
    if (existing) { get().selectGroupMask(groupId, targetFrameId); return }
    get().mutateActive((session) => {
      const timeline = ensureAnimationDocument(session.document)
      const mask = createAttachedLayerMask(groupId, session.document.width, session.document.height, 'group')
      const entry = { groupId, frameId: targetFrameId, mask }
      timeline.groupMasks ??= []
      timeline.groupMasks.push(entry)
      activateAnimationFrame(session.document, targetFrameId)
      applyLayerRowSelection(session, [], [groupId], { kind: 'group', id: groupId })
      session.activeLayerMaskId = mask.id
      session.layerMaskIsolatedView = false
      const key = animationCelKey(groupId, targetFrameId)
      session.selectedAnimationCellKeys = []
      session.animationCellSelectionAnchorKey = null
      session.selectedAnimationMaskCellKeys = [key]
      session.animationMaskCellSelectionAnchorKey = key
      const restore = (): void => { if (!timeline.groupMasks?.some((candidate) => candidate.mask.id === mask.id)) timeline.groupMasks?.push(entry) }
      const remove = (): void => { timeline.groupMasks = (timeline.groupMasks ?? []).filter((candidate) => candidate.mask.id !== mask.id); if (session.activeLayerMaskId === mask.id) session.activeLayerMaskId = null }
      session.history.push({ label: tr('workspace.history.createLayerGroupMask'), bytes: mask.pixels.byteLength, undo: remove, redo: restore, invalidation: { kind: 'full' } })
    })
  },

  deleteLayerMask(celId) {
    const current = activeSession(get())
    if (!current) return
    const currentTimeline = ensureAnimationDocument(current.document)
    const currentCel = currentTimeline.cels.find((candidate) => candidate.id === celId)
    const currentSourceCel = resolveAnimationCel(currentTimeline, currentCel ?? null) ?? currentCel
    const currentLayer = currentCel ? current.document.layers.find((layer) => layer.id === currentCel.layerId) : null
    if (!currentSourceCel?.mask || !currentLayer) return
    if (isLayerEffectivelyLocked(current.document, currentLayer)) { set({ message: tr('workspace.layerMask.locked') }); return }
    get().mutateActive((session) => {
      const timeline = ensureAnimationDocument(session.document)
      const cel = timeline.cels.find((candidate) => candidate.id === celId)
      const sourceCel = resolveAnimationCel(timeline, cel ?? null) ?? cel
      const mask = sourceCel?.mask
      if (!mask) return
      const wasActive = session.activeLayerMaskId === mask.id
      delete sourceCel.mask
      if (wasActive) session.activeLayerMaskId = null
      session.selectedAnimationMaskCellKeys = session.selectedAnimationMaskCellKeys.filter((key) => {
        const target = parseAnimationCelKey(key)
        const selectedCel = target ? timeline.cels.find((candidate) => candidate.layerId === target.layerId && candidate.frameId === target.frameId) : null
        return resolveAnimationCel(timeline, selectedCel ?? null)?.id !== sourceCel.id
      })
      if (session.selectedAnimationMaskCellKeys.length === 0) session.animationMaskCellSelectionAnchorKey = null
      session.history.push({
        label: tr('workspace.history.deleteLayerMask'),
        bytes: mask.pixels.byteLength,
        undo: () => { sourceCel.mask = mask; if (wasActive) session.activeLayerMaskId = mask.id },
        redo: () => { delete sourceCel.mask; if (session.activeLayerMaskId === mask.id) session.activeLayerMaskId = null },
        invalidation: { kind: 'full' }
      })
    })
  },

  deleteGroupMask(groupId, frameId) {
    const current = activeSession(get())
    if (!current) return
    const group = current.document.groups.find((candidate) => candidate.id === groupId)
    const targetFrameId = frameId ?? ensureAnimationDocument(current.document).activeFrameId
    const mask = animationGroupMaskAt(ensureAnimationDocument(current.document), groupId, targetFrameId)
    if (!group || !mask) return
    if (isGroupEffectivelyLocked(current.document, group)) { set({ message: tr('workspace.layerMask.locked') }); return }
    get().mutateActive((session) => {
      const timeline = ensureAnimationDocument(session.document)
      const entry = timeline.groupMasks?.find((candidate) => candidate.groupId === groupId && candidate.frameId === targetFrameId)
      if (!entry) return
      const wasActive = session.activeLayerMaskId === entry.mask.id
      const remove = (): void => { timeline.groupMasks = (timeline.groupMasks ?? []).filter((candidate) => candidate !== entry); if (session.activeLayerMaskId === entry.mask.id) session.activeLayerMaskId = null }
      const restore = (): void => { timeline.groupMasks ??= []; if (!timeline.groupMasks.includes(entry)) timeline.groupMasks.push(entry); if (wasActive) session.activeLayerMaskId = entry.mask.id }
      remove()
      const key = animationCelKey(groupId, targetFrameId)
      session.selectedAnimationMaskCellKeys = session.selectedAnimationMaskCellKeys.filter((candidate) => candidate !== key)
      if (session.selectedAnimationMaskCellKeys.length === 0) session.animationMaskCellSelectionAnchorKey = null
      session.history.push({ label: tr('workspace.history.deleteLayerGroupMask'), bytes: entry.mask.pixels.byteLength, undo: restore, redo: remove, invalidation: { kind: 'full' } })
    })
  },

  deleteSelectedLayerMasks() {
    const current = activeSession(get())
    if (!current || current.selectedAnimationMaskCellKeys.length === 0) return
    const timeline = ensureAnimationDocument(current.document)
    const sourceCels = [...new Map(current.selectedAnimationMaskCellKeys.flatMap((key) => {
      const target = parseAnimationCelKey(key)
      const cel = target ? timeline.cels.find((candidate) => candidate.layerId === target.layerId && candidate.frameId === target.frameId) : null
      const source = resolveAnimationCel(timeline, cel ?? null) ?? cel
      return source?.mask ? [[source.id, source] as const] : []
    })).values()]
    if (sourceCels.length === 0) return
    if (sourceCels.some((source) => {
      const owner = timeline.cels.find((cel) => resolveAnimationCel(timeline, cel)?.id === source.id)
      const layer = owner ? current.document.layers.find((candidate) => candidate.id === owner.layerId) : null
      return layer ? isLayerEffectivelyLocked(current.document, layer) : false
    })) { set({ message: tr('workspace.layerMask.locked') }); return }
    get().mutateActive((session) => {
      const snapshots = sourceCels.flatMap((source) => source.mask ? [{ source, mask: source.mask }] : [])
      if (snapshots.length === 0) return
      const activeMaskId = session.activeLayerMaskId
      const restore = (): void => { for (const item of snapshots) item.source.mask = item.mask }
      const remove = (): void => {
        for (const item of snapshots) delete item.source.mask
        if (activeMaskId && snapshots.some((item) => item.mask.id === activeMaskId)) session.activeLayerMaskId = null
      }
      remove()
      session.selectedAnimationMaskCellKeys = []
      session.animationMaskCellSelectionAnchorKey = null
      session.history.push({
        label: tr('workspace.history.deleteLayerMask'),
        bytes: snapshots.reduce((sum, item) => sum + item.mask.pixels.byteLength, 0),
        undo: () => { restore(); if (activeMaskId) session.activeLayerMaskId = activeMaskId },
        redo: remove,
        invalidation: { kind: 'full' }
      })
    })
  },

  toggleActiveClippingMask() {
    const current = activeSession(get())
    if (!current) return
    if (current.selectedGroupId) {
      const group = current.document.groups.find((candidate) => candidate.id === current.selectedGroupId)
      if (group) get().setClippingMask('group', group.id, group.clippingMask !== true)
      return
    }
    const layer = current.document.layers.find((candidate) => candidate.id === current.document.activeLayerId)
    if (layer) get().setClippingMask('layer', layer.id, layer.clippingMask !== true)
  },

  setClippingMask(kind, id, enabled) {
    const current = activeSession(get())
    if (!current) return
    const currentTarget = kind === 'layer'
      ? current.document.layers.find((layer) => layer.id === id)
      : current.document.groups.find((group) => group.id === id)
    if (!currentTarget) return
    const locked = kind === 'layer'
      ? isLayerEffectivelyLocked(current.document, currentTarget as RasterLayer)
      : isGroupEffectivelyLocked(current.document, currentTarget as LayerGroup)
    if (locked) {
      set({ message: tr('workspace.clippingMask.locked') })
      return
    }
    const before = currentTarget.clippingMask === true
    if (before === enabled) return
    get().mutateActive((session) => {
      const target = kind === 'layer' ? getLayer(session.document, id) : getGroup(session.document, id)
      const apply = (value: boolean): void => {
        if (value) target.clippingMask = true
        else delete target.clippingMask
      }
      apply(enabled)
      session.history.push({
        label: tr('workspace.history.clippingMask'),
        bytes: 8,
        undo: () => apply(before),
        redo: () => apply(enabled)
      })
    })
  },

  setGroupProperties(groupId, name, opacity, blendMode, locked, displayColor, description, cumulativeBlend) {
    const trimmed = name.trim()
    if (!trimmed) return
    get().mutateActive((session) => {
      const group = getGroup(session.document, groupId)
      const lockingAncestor = getGroupLockingAncestor(session.document, group)
      if (!locked && lockingAncestor) {
        set({ message: tr('workspace.group.lockedUnlock') })
        return
      }
      const before = { name: group.name, opacity: group.opacity, blendMode: group.blendMode, locked: group.locked, displayColor: group.displayColor, description: group.description ?? '', cumulativeBlend: group.cumulativeBlend === true }
      const visualLocked = group.locked || Boolean(lockingAncestor)
      const after = { name: trimmed, opacity: visualLocked ? group.opacity : Math.max(0, Math.min(1, opacity)), blendMode: visualLocked ? group.blendMode : blendMode, locked: lockingAncestor ? group.locked : locked, displayColor: displayColor === undefined ? group.displayColor : displayColor ?? undefined, description: description ?? group.description ?? '', cumulativeBlend: visualLocked || cumulativeBlend === undefined ? group.cumulativeBlend === true : cumulativeBlend }
      Object.assign(group, after)
      session.history.push({ label: tr('workspace.history.groupProperties'), bytes: 48 + before.name.length + after.name.length, undo: () => Object.assign(group, before), redo: () => Object.assign(group, after) })
    })
  },

  renameLayer(layerId, name) {
    const trimmed = name.trim()
    if (!trimmed) return
    get().mutateActive((session) => {
      const layer = getLayer(session.document, layerId)
      const before = layer.name
      layer.name = trimmed
      session.history.push({ label: tr('workspace.history.renameLayer'), bytes: before.length + trimmed.length, undo: () => { layer.name = before }, redo: () => { layer.name = trimmed } })
    })
  },

  setLayerOpacity(layerId, opacity) {
    const current = activeSession(get())
    if (!current) return
    const currentLayer = getLayer(current.document, layerId)
    if (isLayerEffectivelyLocked(current.document, currentLayer)) return
    const after = Math.max(0, Math.min(1, opacity))
    if (currentLayer.opacity === after) return
    get().mutateActive((session) => {
      const layer = getLayer(session.document, layerId)
      const before = layer.opacity
      layer.opacity = after
      session.history.push({ label: tr('workspace.history.layerOpacity'), bytes: 16, undo: () => { layer.opacity = before }, redo: () => { layer.opacity = after } })
    })
  },

  setLayerProperties(layerId, name, opacity) {
    const trimmed = name.trim()
    if (!trimmed) return
    const current = activeSession(get())
    if (!current) return
    const currentLayer = getLayer(current.document, layerId)
    const nextOpacity = isLayerEffectivelyLocked(current.document, currentLayer) ? currentLayer.opacity : Math.max(0, Math.min(1, opacity))
    if (currentLayer.name === trimmed && currentLayer.opacity === nextOpacity) return
    get().mutateActive((session) => {
      const layer = getLayer(session.document, layerId)
      const before = { name: layer.name, opacity: layer.opacity }
      const after = { name: trimmed, opacity: nextOpacity }
      layer.name = after.name
      layer.opacity = after.opacity
      session.history.push({ label: tr('workspace.history.layerProperties'), bytes: 32 + before.name.length + after.name.length, undo: () => { layer.name = before.name; layer.opacity = before.opacity }, redo: () => { layer.name = after.name; layer.opacity = after.opacity } })
    })
  },

  setLayerPropertiesWithBlend(layerId, name, opacity, blendMode, locked, displayColor, description) {
    const trimmed = name.trim()
    if (!trimmed) return
    get().mutateActive((session) => {
      const layer = getLayer(session.document, layerId)
      const lockingGroup = getLayerLockingGroup(session.document, layer)
      if (locked === false && lockingGroup) {
        set({ message: tr('workspace.group.lockedUnlock') })
        return
      }
      const before = { name: layer.name, opacity: layer.opacity, blendMode: layer.blendMode, locked: layer.locked, displayColor: layer.displayColor, description: layer.description ?? '' }
      const visualLocked = layer.locked || Boolean(lockingGroup)
      const after = { name: trimmed, opacity: visualLocked ? layer.opacity : Math.max(0, Math.min(1, opacity)), blendMode: visualLocked ? layer.blendMode : blendMode, locked: lockingGroup ? layer.locked : locked ?? layer.locked, displayColor: displayColor === undefined ? layer.displayColor : displayColor ?? undefined, description: description ?? layer.description ?? '' }
      Object.assign(layer, after)
      session.history.push({ label: tr('workspace.history.layerProperties'), bytes: 40 + before.name.length + after.name.length, undo: () => Object.assign(layer, before), redo: () => Object.assign(layer, after) })
    })
  },
  applyActiveLayerAdjustment(adjustment) {
    get().mutateActive((session) => {
      const labels: Record<ColorAdjustment['kind'], string> = {
        'color-balance': tr('adjustment.title.colorBalance'), 'brightness-contrast': tr('adjustment.title.brightnessContrast'), 'hue-saturation': tr('adjustment.title.hueSaturation'), curves: tr('adjustment.title.curves')
      }
      const targetIds = session.selection
        ? [getActiveLayer(session.document).id]
        : [...new Set(session.selectedLayerIds.length > 0 ? session.selectedLayerIds : [session.document.activeLayerId])]
      session.history.beginCompound()
      for (const layerId of targetIds) {
        const layer = session.document.layers.find((candidate) => candidate.id === layerId)
        if (!layer || isLayerEffectivelyLocked(session.document, layer)) continue
        const edit = applyColorAdjustment(session.document, layer, adjustment, session.selection)
        const entry = commitPixelEdit(session.document, edit, labels[adjustment.kind])
        if (entry) session.history.push(entry)
      }
      session.history.endCompound(labels[adjustment.kind])
    })
  },
  captureActiveLayerAdjustmentSnapshot() {
    const session = activeSession(get())
    return session ? captureAdjustmentSnapshot(session) : null
  },
  previewActiveLayerAdjustment(adjustment, baseline, selection) {
    get().mutateActive((session) => {
      restoreAdjustmentSnapshot(session, baseline)
      const targetSelection = selection === undefined ? session.selection : selection
      for (const layerSnapshot of baseline.layers) {
        const layer = session.document.layers.find((candidate) => candidate.id === layerSnapshot.layerId)
        if (layer && !isLayerEffectivelyLocked(session.document, layer)) applyColorAdjustment(session.document, layer, adjustment, targetSelection)
      }
      session.revision += 1
      session.contentRevision += 1
    }, false)
  },
  restoreActiveDocumentSnapshot(snapshot) {
    get().mutateActive((session) => {
      restoreAdjustmentSnapshot(session, snapshot)
      session.revision += 1
      session.contentRevision += 1
    }, false)
  },
  applyActiveLayerAdjustmentFromSnapshot(adjustment, baseline) {
    get().mutateActive((session) => {
      const before = {
        ...baseline,
        layers: baseline.layers.map((layer) => ({ ...layer, pixels: layer.pixels instanceof Uint8ClampedArray ? new Uint8ClampedArray(layer.pixels) : new Uint32Array(layer.pixels) })),
        palette: baseline.palette.map((entry) => ({ ...entry, color: { ...entry.color } }))
      }
      restoreAdjustmentSnapshot(session, before)
      for (const layerSnapshot of before.layers) {
        const layer = session.document.layers.find((candidate) => candidate.id === layerSnapshot.layerId)
        if (layer && !isLayerEffectivelyLocked(session.document, layer)) applyColorAdjustment(session.document, layer, adjustment, session.selection)
      }
      const after = captureAdjustmentSnapshot(session, before.layers.map((layer) => layer.layerId))
      const labels: Record<ColorAdjustment['kind'], string> = {
        'color-balance': tr('adjustment.title.colorBalance'), 'brightness-contrast': tr('adjustment.title.brightnessContrast'), 'hue-saturation': tr('adjustment.title.hueSaturation'), curves: tr('adjustment.title.curves')
      }
      session.history.push({
        label: labels[adjustment.kind],
        bytes: before.layers.reduce((bytes, layer) => bytes + layer.pixels.byteLength, 0) + after.layers.reduce((bytes, layer) => bytes + layer.pixels.byteLength, 0) + (before.palette.length + after.palette.length) * 24,
        undo: () => { restoreAdjustmentSnapshot(session, before); session.revision += 1; session.contentRevision += 1 },
        redo: () => { restoreAdjustmentSnapshot(session, after); session.revision += 1; session.contentRevision += 1 }
      })
    })
  },

  deleteSelection() {
    const current = activeSession(get())
    if (current?.pendingPaste) { get().cancelFloatingPaste(); return }
    get().mutateActive((session) => {
      if (!session.selection) return
      const edit = clearSelection(session.document, session.selection, activePaintLayer(session))
      const entry = edit && commitPixelEdit(session.document, edit, tr('workspace.history.deleteSelection'))
      if (entry) session.history.push(entry)
    })
  },

  fillForeground() {
    const current = activeSession(get())
    if (!current) return
    if (current.pendingPaste) get().commitFloatingPaste()
    const session = activeSession(get())
    if (!session) return
    const layer = activePaintLayer(session)
    if (!isLayerEffectivelyVisible(session.document, layer)) { set({ message: tr('workspace.fill.invisible') }); return }
    if (isLayerEffectivelyLocked(session.document, layer)) { set({ message: tr('workspace.fill.locked') }); return }
    const edit = fillSelectionOrCanvas(session.document, layer, session.primaryColor, session.selection)
    if (!edit) { set({ message: tr('workspace.fill.empty') }); return }
    get().commitPixelEdit(edit, session.selection ? tr('workspace.history.fillSelectionForeground') : tr('workspace.history.fillCanvasForeground'))
  },

  outlineActiveSelection(color, thickness, position, directions, kernel = 'round', previewEnabled = true) {
    const session = activeSession(get())
    if (!session?.selection) { set({ message: tr('workspace.selectionRequired') }); return false }
    const layer = activePaintLayer(session)
    if (isLayerEffectivelyLocked(session.document, layer)) { set({ message: tr('workspace.clipboard.layerLocked') }); return false }
    try {
      const edit = outlineSelection(session.document, layer, session.selection, color, thickness, position, directions, kernel)
      if (!edit) { set({ message: tr('workspace.outline.noContent') }); return false }
      session.document.outlineSettings = {
        color: { ...color },
        thickness: Math.max(1, Math.min(64, Math.round(thickness))),
        position,
        kernel,
        directions: directions ? { ...directions } : { nw: false, n: true, ne: false, w: true, e: true, sw: false, s: true, se: false },
        previewEnabled
      }
      get().commitPixelEdit(edit, position === 'inside' ? tr('workspace.history.outlineInside') : tr('workspace.history.outlineOutside'))
      set({ message: tr('workspace.outline.applied', { thickness: Math.max(1, Math.min(64, Math.round(thickness))), position: position === 'inside' ? tr('outline.inside') : tr('outline.outside') }) })
      return true
    } catch (error) {
      set({ message: error instanceof Error ? error.message : tr('workspace.outline.applyError') })
      return false
    }
  },

  copyActiveLayerToClipboard() {
    get().copySelectedLayersToClipboard()
  },

  copySelectedLayersToClipboard() {
    get().commitFloatingPaste()
    const session = activeSession(get())
    if (!session) return
    const document = session.document
    syncActiveAnimationFrame(document)
    const selectedGroupIdSet = new Set<string>()
    for (const groupId of selectedGroupRows(session)) {
      selectedGroupIdSet.add(groupId)
      for (const descendantId of getDescendantGroupIds(document, groupId)) selectedGroupIdSet.add(descendantId)
    }
    const selectedLayerIdSet = new Set(selectedDirectLayerRows(session))
    for (const groupId of selectedGroupIdSet) for (const layerId of getLayerIdsInGroup(document, groupId)) selectedLayerIdSet.add(layerId)
    const layers = document.layers.filter((layer) => selectedLayerIdSet.has(layer.id))
    if (layers.length === 0) {
      set({ message: tr('workspace.copy.layerRequired') })
      return
    }
    const clipboard: LayerCollectionClipboard = {
      sourceDocumentId: document.id,
      animationFrames: ensureAnimationDocument(document).frames.map((frame) => ({ duration: frame.duration })),
      layers: layers.map((layer) => layerClipboardFromDocument(document, layer, layer.groupId && selectedGroupIdSet.has(layer.groupId) ? layer.groupId : null)),
      groups: document.groups.filter((group) => selectedGroupIdSet.has(group.id)).map((group) => ({
        key: group.id,
        name: group.name,
        visible: group.visible,
        locked: group.locked,
        opacity: group.opacity,
        blendMode: group.blendMode,
        clippingMask: group.clippingMask === true,
        cumulativeBlend: group.cumulativeBlend === true,
        displayColor: group.displayColor ? { ...group.displayColor } : undefined,
        description: group.description ?? '',
        parentKey: group.parentGroupId ?? null,
        collapsed: session.collapsedGroupIds.includes(group.id)
      }))
    }
    clipboardService.setLayers(clipboard)
    set({ message: clipboard.groups.length > 0 ? tr('workspace.copy.group', { name: clipboard.groups[0].name, count: layers.length }) : layers.length === 1 ? tr('workspace.copy.layer', { name: layers[0].name }) : tr('workspace.copy.layers', { count: layers.length }) })
  },

  pasteLayerFromClipboard() {
    return get().pasteLayersFromClipboard()
  },

  pasteLayersFromClipboard() {
    const clipboard = clipboardService.getLayers()
    const current = activeSession(get())
    if (!clipboard || clipboard.layers.length === 0 || !current) return false
    get().mutateActive((session) => {
      const document = session.document
      const timeline = ensureAnimationDocument(document)
      syncActiveAnimationFrame(document)
      const clipboardFrameCount = Math.max(
        clipboard.animationFrames?.length ?? 0,
        ...clipboard.layers.flatMap((layer) => layer.animationCels?.map((cel) => cel.frameIndex + 1) ?? []),
        1
      )
      const appendedFrames = Array.from({ length: Math.max(0, clipboardFrameCount - timeline.frames.length) }, (_, index) => ({
        id: createId('frame'),
        duration: clipboard.animationFrames?.[timeline.frames.length + index]?.duration ?? 100
      }))
      if (appendedFrames.length > 0) {
        timeline.frames.push(...appendedFrames)
        ensureAnimationDocument(document)
      }
      const placement = selectedRowInsertionTarget(session)
      const targetGroupId = insertionTargetParent(document, placement)
      const groupIdByKey = new Map(clipboard.groups.map((group) => [group.key, createId('group')]))
      const resolveGroupParent = (parentKey?: string | null): string | null => {
        if (!parentKey) return targetGroupId
        const pastedParent = groupIdByKey.get(parentKey)
        if (pastedParent) return pastedParent
        return targetGroupId
      }
      const groups: LayerGroup[] = clipboard.groups.map((group) => {
        const id = groupIdByKey.get(group.key)!
        return {
        id,
        name: `${group.name} ${tr('canvas.history.copySuffix')}`,
        description: group.description ?? '',
        displayColor: group.displayColor ? { ...group.displayColor } : undefined,
        parentGroupId: resolveGroupParent(group.parentKey),
        visible: group.visible,
        locked: group.locked,
        opacity: group.opacity,
        blendMode: group.blendMode,
        clippingMask: group.clippingMask === true,
        cumulativeBlend: group.cumulativeBlend === true
      }})
      const layers = clipboard.layers.map((source) => {
        const layer = createLayer(`${source.name} ${tr('canvas.history.copySuffix')}`, source.width, source.height, document.colorMode)
        layer.offsetX = source.offsetX
        layer.offsetY = source.offsetY
        layer.visible = source.visible
        layer.locked = source.locked
        layer.opacity = source.opacity
        layer.blendMode = source.blendMode
        if (source.clippingMask === true) layer.clippingMask = true
        layer.description = source.description ?? ''
        if (source.displayColor) layer.displayColor = { ...source.displayColor }
        layer.groupId = source.groupKey ? groupIdByKey.get(source.groupKey) ?? targetGroupId : targetGroupId
        if (layer.format === 'rgba') layer.pixels.set(source.pixels)
        else for (let index = 0; index < source.width * source.height; index += 1) {
          const offset = index * 4
          layer.pixels[index] = findOrAddPaletteColor(document, { r: source.pixels[offset], g: source.pixels[offset + 1], b: source.pixels[offset + 2], a: source.pixels[offset + 3] })
        }
        return layer
      })
      const index = targetContainerTopIndex(document, targetGroupId)
      const previousActiveId = document.activeLayerId
      const previousSelection = [...session.selectedLayerIds]
      const previousGroupId = session.selectedGroupId
      const previousGroupIds = [...session.selectedGroupIds]
      const previousCollapsedGroupIds = [...session.collapsedGroupIds]
      document.groups.push(...groups)
      document.layers.splice(index, 0, ...layers)
      ensureAnimationDocument(document)
      layers.forEach((layer, layerIndex) => {
        for (const cel of clipboard.layers[layerIndex].animationCels ?? []) applyLayerClipboardAnimationCel(document, layer, cel)
      })
      refreshActiveAnimationFrame(document)
      const pastedIds = layers.map((layer) => layer.id)
      const pastedGroupIds = new Set(groups.map((group) => group.id))
      const appendedFrameIds = new Set(appendedFrames.map((frame) => frame.id))
      const animationCels = ensureAnimationDocument(document).cels
        .filter((cel) => pastedIds.includes(cel.layerId) || appendedFrameIds.has(cel.frameId))
        .map(cloneAnimationCel)
      const pastedCollapsedGroupIds = clipboard.groups
        .filter((group) => group.collapsed)
        .map((group) => groupIdByKey.get(group.key)!)
      document.activeLayerId = layers.at(-1)!.id
      session.collapsedGroupIds = [...new Set([...previousCollapsedGroupIds, ...pastedCollapsedGroupIds])]
      applyLayerRowSelection(session, pastedIds, groups.map((group) => group.id), { kind: 'layer', id: layers.at(-1)!.id })
      session.history.beginCompound()
      session.history.push({
        label: layers.length === 1 && groups.length === 0 ? tr('workspace.history.pasteLayer') : tr('workspace.history.pasteCollection'),
        bytes: layers.reduce((sum, layer) => sum + layer.pixels.byteLength, 0) + animationCels.reduce((sum, cel) => sum + (cel.surface?.pixels.byteLength ?? 0) + (cel.mask?.pixels.byteLength ?? 0), 0) + groups.length * 96 + appendedFrames.length * 32,
        undo: () => {
          const currentTimeline = ensureAnimationDocument(document)
          currentTimeline.cels = currentTimeline.cels.filter((cel) => !pastedIds.includes(cel.layerId) && !appendedFrameIds.has(cel.frameId))
          currentTimeline.frames = currentTimeline.frames.filter((frame) => !appendedFrameIds.has(frame.id))
          if (appendedFrameIds.has(currentTimeline.activeFrameId)) currentTimeline.activeFrameId = currentTimeline.frames[0].id
          document.layers = document.layers.filter((candidate) => !pastedIds.includes(candidate.id))
          document.groups = document.groups.filter((candidate) => !pastedGroupIds.has(candidate.id))
          document.activeLayerId = previousActiveId
          session.selectedLayerIds = previousSelection
          session.selectedGroupId = previousGroupId
          session.selectedGroupIds = previousGroupIds
          session.collapsedGroupIds = previousCollapsedGroupIds
          refreshActiveAnimationFrame(document)
        },
        redo: () => {
          const currentTimeline = ensureAnimationDocument(document)
          for (const frame of appendedFrames) if (!currentTimeline.frames.some((candidate) => candidate.id === frame.id)) currentTimeline.frames.push({ ...frame })
          for (const group of groups) if (!document.groups.some((candidate) => candidate.id === group.id)) document.groups.push(group)
          const missingLayers = layers.filter((layer) => !document.layers.some((candidate) => candidate.id === layer.id))
          if (missingLayers.length > 0) document.layers.splice(Math.min(index, document.layers.length), 0, ...missingLayers)
          restoreAnimationCels(document, animationCels)
          document.activeLayerId = layers.at(-1)!.id
          session.collapsedGroupIds = [...new Set([...previousCollapsedGroupIds, ...pastedCollapsedGroupIds])]
          applyLayerRowSelection(session, pastedIds, groups.map((group) => group.id), { kind: 'layer', id: layers.at(-1)!.id })
        }
      })
      const createdGroupIds = new Set(groups.map((group) => group.id))
      const rootGroupIds = groups.filter((group) => !group.parentGroupId || !createdGroupIds.has(group.parentGroupId)).map((group) => group.id)
      const directLayerIds = layers.filter((layer) => !layer.groupId || !createdGroupIds.has(layer.groupId)).map((layer) => layer.id)
      const placementHistory = moveLayerPanelRowsOperation(session, directLayerIds, rootGroupIds, placement)
      if (placementHistory) session.history.push(placementHistory)
      session.history.endCompound(layers.length === 1 && groups.length === 0 ? tr('workspace.history.pasteLayer') : tr('workspace.history.pasteCollection'))
    })
    set({ message: clipboard.groups.length > 0 ? tr('workspace.clipboard.pastedLayer') : clipboard.layers.length === 1 ? tr('workspace.copy.layer', { name: clipboard.layers[0].name }) : tr('workspace.copy.layers', { count: clipboard.layers.length }) })
    return true
  },

  copySelection() {
    get().commitFloatingPaste()
    const session = activeSession(get())
    if (!session?.selection) { set({ message: tr('workspace.selectionRequired') }); return }
    const layer = getActiveLayer(session.document)
    const document = session.document
    const selection = clampSelection(document, session.selection)
    if (!selection) { set({ message: tr('workspace.clipboard.outside') }); return }
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
    if (copied === 0) { clipboardService.clearSelection(); set({ message: tr('workspace.copyContent.empty') }); return }
    clipboardService.setSelection({ width: selection.width, height: selection.height, originX: selection.x, originY: selection.y, pixels, mask })
    const clipboard = clipboardService.getSelection()
    if (!clipboard) return
    void window.moonSprite.writeClipboardImage(selectionClipboardImage(clipboard)).catch(() => {
      set({ message: tr('workspace.copyContent.internalOnly') })
    })
    set({ message: tr('workspace.copyContent.done', { count: copied }) })
  },

  cutSelection() {
    get().commitFloatingPaste()
    get().copySelection()
    get().deleteSelection()
  },

  async pasteSelection() {
    const targetSession = activeSession(get())
    if (!targetSession || !hasSelectedPaintTarget(targetSession)) {
      set({ message: tr('workspace.clipboard.selectTarget') })
      return
    }
    get().commitFloatingPaste()
    const clipboard = await clipboardService.readSelection(() => window.moonSprite.readClipboardImage())
    get().mutateActive((session) => {
      if (!clipboard) { set({ message: tr('workspace.clipboard.emptyPixels') }); return }
      const document = session.document
      const layer = activePaintLayer(session)
      if (isLayerEffectivelyLocked(document, layer)) { set({ message: tr('workspace.clipboard.layerLocked') }); return }
      const beforeSelection = cloneSelectionMask(session.selection)
      // Keep the entire clipboard image, even when it is larger than the
      // document. The floating selection can then be moved until any part of
      // it reaches the canvas instead of losing off-canvas pixels on paste.
      const { x, y } = resolveClipboardPlacement({
        width: clipboard.width,
        height: clipboard.height,
        originX: clipboard.originX,
        originY: clipboard.originY,
        documentWidth: document.width,
        documentHeight: document.height,
        viewportWidth: session.viewportSize.width || document.width * session.view.zoom,
        viewportHeight: session.viewportSize.height || document.height * session.view.zoom,
        view: session.view,
        rotationIndicatorPosition: loadEditorPreferences().rotationIndicatorPosition
      })
      const width = clipboard.width
      const height = clipboard.height
      const pastedMask = clipboard.mask.slice()
      const values = layer.format === 'rgba' ? clipboard.pixels.slice() : new Uint32Array(width * height)
      if (isLayerMask(layer)) {
        for (let offset = 0; offset < values.length; offset += 1) {
          const color = unpackColor(values[offset])
          values[offset] = packColor(relativeLuminanceColor(color))
        }
      }
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
      if (pasted === 0) { set({ message: tr('workspace.clipboard.outside') }); return }
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
      const edit = applySelectionTransform(document, source, target, 0, true, undefined, undefined, undefined, layer) ?? beginPixelEdit(layer.id)
      session.selection = cloneSelectionMask(target)
      session.pendingPaste = { layerId: layer.id, beforeSelection, source, target: cloneSelectionMask(target)!, transformTarget: { x: target.x, y: target.y, width: target.width, height: target.height }, transformAngle: 0, previewEdit: edit, translationPreview: null, copy: true, label: tr('workspace.history.pasteToLayer') }
      // A paste remains floating until confirmed, so its first drag should move
      // the pasted pixels instead of beginning a new pencil stroke.
      session.tool = 'selection'
      session.revision += 1
      session.contentRevision += 1
      set({ message: tr('workspace.clipboard.pastedPixels', { count: pasted }) })
    }, false)
  },

  async pasteAsNewLayer() {
    if (clipboardService.getLayers()) return get().pasteLayersFromClipboard()
    const clipboard = await clipboardService.readSelection(() => window.moonSprite.readClipboardImage())
    const current = activeSession(get())
    if (!clipboard || !current) { set({ message: tr('workspace.clipboard.noContent') }); return false }
    get().mutateActive((session) => {
      const document = session.document
      const placement = resolveClipboardPlacement({
        width: clipboard.width,
        height: clipboard.height,
        originX: clipboard.originX,
        originY: clipboard.originY,
        documentWidth: document.width,
        documentHeight: document.height,
        viewportWidth: session.viewportSize.width || document.width * session.view.zoom,
        viewportHeight: session.viewportSize.height || document.height * session.view.zoom,
        view: session.view,
        rotationIndicatorPosition: loadEditorPreferences().rotationIndicatorPosition
      })
      const layer = createLayer(tr('layers.pasteLayer'), clipboard.width, clipboard.height, document.colorMode)
      layer.offsetX = placement.x
      layer.offsetY = placement.y
      for (let index = 0; index < clipboard.mask.length; index += 1) {
        if (clipboard.mask[index] !== 1) continue
        writeLayerColor(document, layer, index, unpackColor(clipboard.pixels[index]))
      }
      const insertionIndex = document.layers.length
      const previousActiveId = document.activeLayerId
      const previousSelection = [...session.selectedLayerIds]
      document.layers.push(layer)
      document.activeLayerId = layer.id
      session.selectedGroupId = null
      session.selectedGroupIds = []
      session.selectedLayerIds = [layer.id]
      session.layerSelectionAnchorId = layer.id
      session.history.push({
        label: tr('workspace.history.pasteAsLayer'),
        bytes: layer.pixels.byteLength + 64,
        undo: () => {
          document.layers = document.layers.filter((candidate) => candidate.id !== layer.id)
          document.activeLayerId = previousActiveId
          session.selectedLayerIds = previousSelection
        },
        redo: () => {
          if (!document.layers.some((candidate) => candidate.id === layer.id)) document.layers.splice(Math.min(insertionIndex, document.layers.length), 0, layer)
          document.activeLayerId = layer.id
          session.selectedLayerIds = [layer.id]
        }
      })
    })
    set({ message: tr('workspace.clipboard.pastedLayer') })
    return true
  },

  async pasteAsNewDocument() {
    const clipboard = await clipboardService.readSelection(() => window.moonSprite.readClipboardImage())
    if (!clipboard) { set({ message: tr('workspace.clipboard.noImage') }); return false }
    const document = createDocument(tr('document.pastedImage'), clipboard.width, clipboard.height, 'rgba')
    const layer = getActiveLayer(document)
    for (let index = 0; index < clipboard.mask.length; index += 1) {
      if (clipboard.mask[index] === 1) writeLayerColor(document, layer, index, unpackColor(clipboard.pixels[index]))
    }
    document.dirty = true
    get().addSession(document)
    set({ message: tr('workspace.clipboard.pastedDocument') })
    return true
  },

  updateFloatingPastePreview(edit, target, translationPreview = null, transformTarget, transformAngle, transformShear) {
    get().mutateActive((session) => {
      if (!session.pendingPaste) return
      const previousTarget = session.pendingPaste.target
      session.pendingPaste.previewEdit = edit
      session.pendingPaste.translationPreview = translationPreview
      session.pendingPaste.target = cloneSelectionMask(target)!
      if (transformTarget) session.pendingPaste.transformTarget = { ...transformTarget }
      else if ((session.pendingPaste.transformAngle ?? 0) % 360 === 0 && !session.pendingPaste.transformShear) {
        session.pendingPaste.transformTarget = { x: target.x, y: target.y, width: target.width, height: target.height }
      }
      if (transformAngle !== undefined) session.pendingPaste.transformAngle = transformAngle
      if (transformShear !== undefined) session.pendingPaste.transformShear = { ...transformShear }
      session.selection = cloneSelectionMask(target)
      markFloatingPreviewChanged(session, previousTarget, target)
    }, false)
  },

  beginFloatingSelectionTransform(source, edit, before, target, copy, label, translationPreview = null, transformTarget, transformAngle = 0, transformShear) {
    get().mutateActive((session) => {
      const layer = getActiveLayer(session.document)
      session.pendingPaste = {
        layerId: layer.id,
        beforeSelection: cloneSelectionMask(before),
        source,
        target: cloneSelectionMask(target)!,
        transformTarget: transformTarget ? { ...transformTarget } : { x: target.x, y: target.y, width: target.width, height: target.height },
        transformAngle,
        transformShear: transformShear ? { ...transformShear } : undefined,
        previewEdit: edit,
        translationPreview,
        copy,
        label
      }
      session.selection = cloneSelectionMask(target)
      markFloatingPreviewChanged(session, before, target)
    }, false)
  },

  commitFloatingPaste() {
    const current = activeSession(get())
    if (!current?.pendingPaste) return
    const documentChanged = Boolean(current.pendingPaste.previewEdit || current.pendingPaste.translationPreview?.count)
    get().mutateActive((session) => {
      const pending = session.pendingPaste
      if (!pending) return
      const edit = pending.previewEdit ?? (pending.translationPreview ? selectionTranslationPreviewEdit(session.document, pending.translationPreview) : null)
      const pixelEntry = edit ? commitPixelEdit(session.document, edit, pending.label) : null
      const beforeSelection = cloneSelectionMask(pending.beforeSelection)
      const afterSelection = cloneSelectionMask(pending.target)
      const sameMask = beforeSelection?.mask === afterSelection?.mask
        || (beforeSelection?.mask?.length === afterSelection?.mask?.length && beforeSelection?.mask?.every((value, index) => value === afterSelection?.mask?.[index]))
      const selectionChanged = beforeSelection?.x !== afterSelection?.x || beforeSelection?.y !== afterSelection?.y
        || beforeSelection?.width !== afterSelection?.width || beforeSelection?.height !== afterSelection?.height || !sameMask
      session.pendingPaste = null
      session.selection = afterSelection
      if (pixelEntry) session.history.push({
        ...pixelEntry,
        bytes: pixelEntry.bytes + (beforeSelection?.mask?.byteLength ?? 0) + (afterSelection?.mask?.byteLength ?? 0) + 64,
        undo: () => { pixelEntry.undo(); session.selection = cloneSelectionMask(beforeSelection) },
        redo: () => { pixelEntry.redo(); session.selection = cloneSelectionMask(afterSelection) }
      })
      else if (selectionChanged) session.history.push({
        label: pending.label,
        bytes: 48 + (beforeSelection?.mask?.byteLength ?? 0) + (afterSelection?.mask?.byteLength ?? 0),
        undo: () => { session.selection = cloneSelectionMask(beforeSelection) },
        redo: () => { session.selection = cloneSelectionMask(afterSelection) }
      })
    }, documentChanged)
  },

  cancelFloatingPaste() {
    const current = activeSession(get())
    if (!current?.pendingPaste) return
    get().mutateActive((session) => {
      const pending = session.pendingPaste
      if (!pending) return
      restoreFloatingPreview(session)
      session.selection = cloneSelectionMask(pending.beforeSelection)
      session.pendingPaste = null
      markFloatingPreviewChanged(session, pending.target, pending.beforeSelection ?? pending.target)
    }, false)
  },

  moveActiveSelectionWithSelectionHistory(deltaX, deltaY) {
    get().mutateActive((session) => {
      if (!session.selection) return
      const currentSelection = cloneSelectionMask(session.selection)!
      const nextX = Math.max(0, Math.min(session.document.width - currentSelection.width, currentSelection.x + Math.trunc(deltaX)))
      const nextY = Math.max(0, Math.min(session.document.height - currentSelection.height, currentSelection.y + Math.trunc(deltaY)))
      const actualX = nextX - currentSelection.x
      const actualY = nextY - currentSelection.y
      if (actualX === 0 && actualY === 0) return
      const layer = activePaintLayer(session)
      if (isLayerEffectivelyLocked(session.document, layer)) return

      const pending = session.pendingPaste
      if (pending) {
        const previousTarget = cloneSelectionMask(pending.target)!
        const angle = pending.transformAngle ?? 0
        const shear = pending.transformShear
        const transformTarget = pending.transformTarget ?? {
          x: pending.target.x,
          y: pending.target.y,
          width: pending.target.width,
          height: pending.target.height
        }
        const nextTransformTarget = { ...transformTarget, x: transformTarget.x + actualX, y: transformTarget.y + actualY }
        restoreFloatingPreview(session)
        const nextSelection = transformSelectionMask(pending.source.selection, nextTransformTarget, session.document.width, session.document.height, angle, shear, false)
        if (!nextSelection) return
        const simpleTranslation = angle % 360 === 0
          && !shear
          && nextTransformTarget.width === pending.source.selection.width
          && nextTransformTarget.height === pending.source.selection.height
          && !nextTransformTarget.flipHorizontal
          && !nextTransformTarget.flipVertical
        pending.previewEdit = null
        pending.translationPreview = simpleTranslation
          ? applySelectionTranslationPreview(session.document, pending.source, nextTransformTarget, pending.copy, pending.translationPreview, layer)
          : null
        if (!simpleTranslation) pending.previewEdit = applySelectionTransform(session.document, pending.source, nextTransformTarget, angle, pending.copy, shear, undefined, undefined, layer)
        pending.target = cloneSelectionMask(nextSelection)!
        pending.transformTarget = nextTransformTarget
        session.selection = cloneSelectionMask(nextSelection)
        markFloatingPreviewChanged(session, previousTarget, nextSelection)
        return
      }

      const source = captureSelectionTransform(session.document, currentSelection, layer)
      if (!source) return
      const nextSelection = { ...currentSelection, x: nextX, y: nextY }
      const translationPreview = applySelectionTranslationPreview(session.document, source, nextSelection, false, null, layer)
      session.pendingPaste = {
        layerId: layer.id,
        beforeSelection: cloneSelectionMask(currentSelection),
        source,
        target: cloneSelectionMask(nextSelection)!,
        transformTarget: { x: nextSelection.x, y: nextSelection.y, width: nextSelection.width, height: nextSelection.height },
        transformAngle: 0,
        previewEdit: null,
        translationPreview,
        copy: false,
        label: tr('workspace.history.moveSelectionContent')
      }
      session.selection = cloneSelectionMask(nextSelection)
      markFloatingPreviewChanged(session, currentSelection, nextSelection)
    }, false)
  },

  flipActiveSelection(axis) {
    get().mutateActive((session) => {
      if (session.pendingPaste) {
        const pending = session.pendingPaste
        const previousTarget = pending.target
        restoreFloatingPreview(session)
        pending.source = flipSelectionTransformSource(pending.source, axis)
        const transformTarget = pending.transformTarget ?? { x: pending.target.x, y: pending.target.y, width: pending.target.width, height: pending.target.height }
        const angle = pending.transformAngle ?? 0
        const shear = pending.transformShear
        const transformed = transformSelectionMask(pending.source.selection, transformTarget, session.document.width, session.document.height, angle, shear, false)
        if (!transformed) return
        pending.target = transformed
        session.selection = cloneSelectionMask(transformed)
        pending.previewEdit = null
        pending.translationPreview = null
        const preview = applySelectionTransform(session.document, pending.source, transformTarget, angle, pending.copy, shear, undefined, undefined, activePaintLayer(session))
        if (preview) pending.previewEdit = preview
        markFloatingPreviewChanged(session, previousTarget, transformed)
        return
      }
      const layer = activePaintLayer(session)
      if (isLayerEffectivelyLocked(session.document, layer)) return
      const beforeSelection = cloneSelectionMask(session.selection)
      const afterSelection = session.selection ? flipSelectionMask(session.selection, axis) : null
      const edit = session.selection ? flipSelection(session.document, session.selection, axis, layer) : flipLayer(session.document, axis)
      const entry = edit && commitPixelEdit(session.document, edit, axis === 'horizontal' ? tr('workspace.history.flipSelectionHorizontal') : tr('workspace.history.flipSelectionVertical'))
      const sameMask = beforeSelection?.mask === afterSelection?.mask
        || (beforeSelection?.mask?.length === afterSelection?.mask?.length && beforeSelection?.mask?.every((value, index) => value === afterSelection?.mask?.[index]))
      const selectionChanged = !sameMask
      session.selection = afterSelection
      session.lastPencilPoint = null
      session.lastEraserPoint = null
      if (entry) {
        session.history.push({ ...entry, bytes: entry.bytes + (beforeSelection?.mask?.byteLength ?? 0) + (afterSelection?.mask?.byteLength ?? 0), undo: () => { entry.undo(); session.selection = cloneSelectionMask(beforeSelection) }, redo: () => { entry.redo(); session.selection = cloneSelectionMask(afterSelection) } })
      } else if (selectionChanged) {
        session.history.push({ label: axis === 'horizontal' ? tr('workspace.history.flipSelectionHorizontal') : tr('workspace.history.flipSelectionVertical'), bytes: (beforeSelection?.mask?.byteLength ?? 0) + (afterSelection?.mask?.byteLength ?? 0), undo: () => { session.selection = cloneSelectionMask(beforeSelection) }, redo: () => { session.selection = cloneSelectionMask(afterSelection) } })
      }
    })
  },

  transformActiveSelection(beforeSelection, afterSelection, angle = 0) {
    get().mutateActive((session) => {
      const edit = transformSelectionCopy(session.document, beforeSelection, afterSelection, angle, undefined, undefined, undefined, activePaintLayer(session))
      const entry = edit && commitPixelEdit(session.document, edit, angle === 0 ? tr('workspace.history.transformSelectionContent') : tr('workspace.history.rotateSelectionContent'))
      const before = { ...beforeSelection }
      const after = { ...afterSelection }
      session.selection = after
      if (entry) {
        session.history.push({ ...entry, bytes: entry.bytes + 64, undo: () => { entry.undo(); session.selection = { ...before } }, redo: () => { entry.redo(); session.selection = { ...after } } })
      } else if (before.x !== after.x || before.y !== after.y || before.width !== after.width || before.height !== after.height) {
        session.history.push({ label: tr('workspace.history.transformSelection'), bytes: 48, undo: () => { session.selection = { ...before } }, redo: () => { session.selection = { ...after } } })
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
      const edit = moveSelection(session.document, session.selection, deltaX, deltaY, false, activePaintLayer(session))
      const entry = edit && commitPixelEdit(session.document, edit, tr('workspace.history.moveSelection'))
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
        label: tr('workspace.history.convertColorMode'), bytes: before.byteLength + after.byteLength,
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
    flushTimelapseCapture(session)
    const showProgress = true
    const progressTitle = tr(saveAs ? 'workspace.saveAs.progressTitle' : 'workspace.save.progressTitle')
    const progressDone = tr(saveAs ? 'workspace.saveAs.progressDone' : 'workspace.save.progressDone')
    let progressStarted = false
    const updateProgress = (value: number, label: string): void => {
      if (!showProgress) return
      if (progressStarted && !get().saveProgress) return
      progressStarted = true
      set({ saveProgress: { title: progressTitle, value, label } })
    }
    try {
      const result = await saveDocumentFile({
        api: window.moonSprite,
        documentId,
        getDocument: () => {
          const current = get().sessions.find((item) => item.document.id === documentId)
          return current ? { document: current.document, revision: current.contentRevision } : null
        },
        saveAs,
        options,
        preferredImageFormat: saveImageKindForPreference(readStoredString(SAVE_FORMAT_PREFERENCE_KEY)),
        lifecycle: {
          onEncodeStart: () => updateProgress(12, tr('workspace.save.encodingProject')),
          onWriteStart: () => updateProgress(72, tr('workspace.save.writing'))
        }
      })
      if (!result) { if (progressStarted) set({ saveProgress: null }); return false }
      const saved = get().sessions.find((item) => item.document.id === documentId)
      if (!saved) { if (progressStarted) set({ saveProgress: null }); return false }
      saved.document.filePath = result.filePath
      saved.document.name = fileNameFromPath(result.filePath)
      const fullySaved = saved.contentRevision === result.revision
      saved.document.dirty = !fullySaved
      set({ sessions: [...get().sessions] })
      recordRecentProject(result.filePath, saved.document.name)
      await get().autosaveDirty()
      const latest = get().sessions.find((item) => item.document.id === documentId)
      if (latest && latest.contentRevision === result.revision && !latest.document.dirty) await recoveryService.delete(window.moonSprite, documentId)
      const progressVisible = progressStarted && Boolean(get().saveProgress)
      set({ message: fullySaved ? tr('workspace.save.done') : tr('workspace.save.newerChanges'), ...(progressVisible ? { saveProgress: { title: progressTitle, value: 100, label: progressDone } } : {}) })
      if (progressVisible) window.setTimeout(() => { if (get().saveProgress?.value === 100) set({ saveProgress: null }) }, 60)
      return true
    } catch (error) {
      set({ message: error instanceof Error ? error.message : tr('workspace.save.error'), ...(progressStarted ? { saveProgress: null } : {}) })
      return false
    }
  },

  async exportActive(options) {
    get().commitFloatingPaste()
    const session = activeSession(get())
    if (!session) return false
    let progressStarted = false
    const updateProgress = (value: number, label: string): void => {
      if (progressStarted && !get().saveProgress) return
      progressStarted = true
      set({ saveProgress: { title: tr('workspace.export.progressTitle'), value, label } })
    }
    try {
      const message = await exportDocumentFile(window.moonSprite, session.document, options, {
        onEncodeStart: () => updateProgress(12, tr('workspace.export.encoding')),
        onWriteStart: () => updateProgress(72, tr('workspace.save.writing'))
      })
      if (!message) { if (progressStarted) set({ saveProgress: null }); return false }
      const progressVisible = progressStarted && Boolean(get().saveProgress)
      set({ message, ...(progressVisible ? { saveProgress: { title: tr('workspace.export.progressTitle'), value: 100, label: tr('workspace.export.done') } } : {}) })
      if (progressVisible) window.setTimeout(() => { if (get().saveProgress?.value === 100) set({ saveProgress: null }) }, 180)
      return true
    } catch (error) {
      set({ message: error instanceof Error ? error.message : tr('workspace.export.error'), ...(progressStarted ? { saveProgress: null } : {}) })
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
      set({ message: error instanceof Error ? `${fileNameFromPath(filePath)}: ${error.message}` : tr('workspace.open.error') })
      return false
    }
  },

  async closeDocument(id) {
    const session = get().sessions.find((item) => item.document.id === id)
    if (!session) return
    if (session.document.dirty) {
      const choice = await get().requestDialog({ title: tr('workspace.unsaved.title'), message: tr('workspace.unsaved.message', { name: session.document.name }), detail: tr('workspace.unsaved.detail'), choices: [{ id: 'cancel', label: tr('common.cancel'), tone: 'quiet' }, { id: 'discard', label: tr('app.discard'), tone: 'danger' }, { id: 'save', label: tr('common.save'), tone: 'primary' }] })
      if (choice === 'cancel') return
      if (choice === 'save') {
        get().setActive(id)
        const saved = await get().saveActive()
        if (!saved) return
      }
      if (choice === 'discard') await get().discardRecovery(id)
    }
    if (!session.document.dirty) await get().discardRecovery(id)
    cancelTimelapseCapture(id)
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
      set({ recoveryRecords: [], message: tr('workspace.recovery.readError') })
    }
  },

  async restoreRecovery(id) {
    const record = get().recoveryRecords.find((item) => item.id === id)
    if (!record) return false
    try {
      const document = await recoveryService.restore(window.moonSprite, record)
      get().addSession(document)
      await recoveryService.delete(window.moonSprite, record.id)
      set((state) => ({ recoveryRecords: state.recoveryRecords.filter((item) => item.id !== record.id), message: tr('workspace.recovery.restored', { name: record.name }) }))
      return true
    } catch {
      set({ message: tr('workspace.recovery.restoreError', { name: record.name }) })
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
