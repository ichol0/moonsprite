import { create } from 'zustand'
import type { BlendMode, BrushPaintMode, BrushShape, BrushTexture, CanvasAnchor, ColorMode, FillMode, ImageBrush, ImageBrushSettings, ImageResizeInterpolation, LayerGroup, OutlineDirections, OutlineKernel, OutlinePosition, ProceduralBrushId, ProceduralBrushSettings, RasterLayer, RecoveryRecord, RgbaColor, SelectionKind, SelectionMask, SelectionMode, SelectionRect, ShapeKind, ShapeRatio, SpriteDocument, ToolId, ViewState } from '@shared/types'
import { checkResourceLimit } from '@/core/resource-policy'
import { beginPixelEdit, commitPixelEdit, HistoryStack, recordPixel, revertPixelEdit, type HistoryEntry, type PixelEdit } from '@/core/history'
import { convertDocumentColorMode, createDocument, createId, createLayer, duplicateLayer, findOrAddPaletteColor, getDescendantGroupIds, getGroup, getGroupLockingAncestor, getLayerIdsInGroup, getLayer, getActiveLayer, getLayerLockingGroup, isGroupEffectivelyLocked, isLayerEffectivelyLocked, isLayerEffectivelyVisible, layerContentBounds, readLayerColor, readLayerColorAt, resizeDocumentAt, resizeDocumentImage, writeLayerColor } from '@/core/document'
import { decodeProject, encodeProject } from '@/core/project-format'
import { flushViewPreview } from '@/core/view-preview-lifecycle'
import { fileNameFromPath } from '@/core/document-files'
import { createSelectionBrush } from '@/core/brushes'
import { applySelectionTransform, clampSelection, clearSelection, fillSelectionOrCanvas, flipLayer, flipSelection, moveSelection, outlineSelection, transformSelectionCopy, type SelectionTransformSource } from '@/core/tools'
import { colorEquals, packColor, pixelIndex, unpackColor } from '@/core/raster'
import { flipSelectionMask, invertSelectionMask, selectionContains, shiftSelection } from '@/core/selection'
import { recordRecentProject } from '@/core/home-history'
import { createProceduralBrush, isProceduralBrushId, normalizeProceduralBrushSettings, PROCEDURAL_BRUSH_IDS } from '@/core/brushes'
import { mergeLayerDown, mergeLayerGroup, mergeRasterLayers, mergeVisibleLayers as mergeVisibleDocumentLayers, type LayerMergeSuccess } from '@/core/layer-merge'
import { applyColorAdjustment, type ColorAdjustment } from '@/core/adjustments'
import { assignGroupToGroup as assignGroupToGroupOperation, assignGroupToRoot as assignGroupToRootOperation, assignLayersAboveGroup as assignLayersAboveGroupOperation, assignLayersToGroup as assignLayersToGroupOperation, assignLayersToRoot as assignLayersToRootOperation, canMoveGroupInto, createLayerGroup as createLayerGroupOperation, moveGroupToRootEdge as moveGroupToRootEdgeOperation, moveLayersToRootEdge as moveLayersToRootEdgeOperation, positionGroupNextToLayer as positionGroupNextToLayerOperation, reorderGroup as reorderGroupOperation, reorderLayers as reorderLayersOperation, ungroupSelected as ungroupSelectedOperation } from '@/core/layer-operations'
import { buildLayerPanelTree } from '@/core/layer-panel-layout'
import { loadEditorPreferences, SAVE_FORMAT_PREFERENCE_KEY, saveImageKindForPreference } from '@/core/file-preferences'
import { resolveClipboardPlacement } from '@/core/clipboard-placement'
import { cloneProceduralSettings, defaultToolSettings, loadToolSettings, normalizePersistedBrushProfile, saveToolSettings, type BrushTool, type PersistedBrushProfile, type PersistedToolSettings } from '@/core/tool-preferences'
import { readStoredString } from '@/core/storage'
import { exportDocumentFile, openDocumentFile, saveDocumentFile, type ExportOptions, type SaveAsOptions } from './document-file-service'
import { RecoveryService } from './recovery-service'
import { ClipboardService, selectionClipboardImage, type LayerClipboard, type LayerCollectionClipboard } from './clipboard-service'
import { captureAdjustmentSnapshot, captureLayerUi, commitLayerMerge, restoreAdjustmentSnapshot, restoreDocumentSnapshot } from './workspace-history'
import { applyBrushProfile, brushProfileFromSession, clearSelectionBrushPaintColors, cloneSelectionMask, isBrushTool, persistToolSettings, remapSelectionBrushColors, rememberBrushProfile, sessionFromDocument, touch } from './workspace-session'
import { addPaletteColor as addPaletteColorCommand, applyPalette as applyPaletteCommand, deletePaletteColors as deletePaletteColorsCommand, movePaletteColor as movePaletteColorCommand, reorderPaletteColors as reorderPaletteColorsCommand, selectPaletteColor as selectPaletteColorCommand } from './workspace-palette'
import type { AdjustmentSnapshot, AppDialog, CanvasResizePreview, DocumentSession, OutlinePreview } from './workspace-types'

export type { ExportOptions, SaveAsOptions } from './document-file-service'
export type { AdjustmentSnapshot, AppDialog, CanvasResizePreview, DialogChoice, DocumentSession, FloatingPaste, OutlinePreview } from './workspace-types'

interface WorkspaceState {
  sessions: DocumentSession[]
  activeId: string | null
  sharedPrimaryColor: RgbaColor
  sharedSecondaryColor: RgbaColor
  message: string | null
  saveProgress: { title: string; value: number; label: string } | null
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
  setShapeRatio(ratio: ShapeRatio | null): void
  setFillMode(mode: FillMode): void
  setMoveAutoSelect(enabled: boolean): void
  setPrimaryColor(color: RgbaColor): void
  setSecondaryColor(color: RgbaColor): void
  swapPrimarySecondaryColors(): void
  setView(view: Partial<ViewState>): void
  setViewportSize(size: { width: number; height: number }): void
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
  createLayerGroup(): void
  ungroupSelected(): void
  selectGroup(groupId: string, mode?: boolean | 'replace' | 'toggle' | 'range'): void
  clearLayerSelection(): void
  toggleGroupCollapsed(groupId: string): void
  toggleGroupVisibility(groupId: string): void
  setGroupProperties(groupId: string, name: string, opacity: number, blendMode: BlendMode, locked: boolean, displayColor?: RgbaColor | null, description?: string): void
  toggleLayerVisibility(layerId: string): void
  selectLayer(layerId: string, mode?: boolean | 'replace' | 'toggle' | 'range'): void
  renameLayer(layerId: string, name: string): void
  setLayerOpacity(layerId: string, opacity: number): void
  setLayerProperties(layerId: string, name: string, opacity: number): void
  setLayerPropertiesWithBlend(layerId: string, name: string, opacity: number, blendMode: BlendMode, locked?: boolean, displayColor?: RgbaColor | null, description?: string): void
  applyActiveLayerAdjustment(adjustment: ColorAdjustment): void
  captureActiveLayerAdjustmentSnapshot(): AdjustmentSnapshot | null
  previewActiveLayerAdjustment(adjustment: ColorAdjustment, baseline: AdjustmentSnapshot): void
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
  beginFloatingSelectionTransform(source: SelectionTransformSource, edit: PixelEdit, before: SelectionMask, target: SelectionMask, copy: boolean, label: string): void
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

function activeSession(state: WorkspaceState): DocumentSession | null {
  return state.sessions.find((session) => session.document.id === state.activeId) ?? null
}

type LayerRowSelectionMode = boolean | 'replace' | 'toggle' | 'range'

const selectedGroupRows = (session: DocumentSession): string[] =>
  session.selectedGroupIds.length > 0 ? [...session.selectedGroupIds] : session.selectedGroupId ? [session.selectedGroupId] : []

const selectedDirectLayerRows = (session: DocumentSession): string[] =>
  session.selectedGroupId && selectedGroupRows(session).length === 1 ? [] : [...session.selectedLayerIds]

const applyLayerRowSelection = (session: DocumentSession, layerIds: readonly string[], groupIds: readonly string[], focus: { kind: 'layer' | 'group'; id: string }): void => {
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

const lockedLayerStructure = (document: SpriteDocument, layerIds: readonly string[]): boolean =>
  document.layers.some((layer) => layerIds.includes(layer.id) && isLayerEffectivelyLocked(document, layer))

const lockedGroupStructure = (document: SpriteDocument, groupId: string): boolean => {
  const groupIds = new Set([groupId, ...getDescendantGroupIds(document, groupId)])
  return document.groups.some((group) => groupIds.has(group.id) && isGroupEffectivelyLocked(document, group))
    || document.layers.some((layer) => Boolean(layer.groupId && groupIds.has(layer.groupId)) && isLayerEffectivelyLocked(document, layer))
}

const recoveryService = new RecoveryService()
const clipboardService = new ClipboardService()

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
    displayColor: layer.displayColor ? { ...layer.displayColor } : undefined,
    description: layer.description ?? '',
    groupKey,
    pixels
  }
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
    session.primaryColor = { ...get().sharedPrimaryColor }
    session.secondaryColor = { ...get().sharedSecondaryColor }
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
  setMoveAutoSelect(enabled) { get().mutateActive((session) => { session.moveAutoSelect = enabled; persistToolSettings(session) }, false) },
  setPrimaryColor(color) {
    const state = get()
    for (const session of state.sessions) {
      session.primaryColor = { ...color }
      if (session.brushImage?.intrinsicSize) session.brushImage = remapSelectionBrushColors(session.brushImage, session.primaryColor, session.secondaryColor)
      const matching = session.document.palette.find((entry) => session.document.paletteOrder.includes(entry.id) && colorEquals(entry.color, color))
      session.paletteSelectionId = matching?.id ?? null
      session.selectedPaletteIds = matching ? [matching.id] : []
    }
    set({ sharedPrimaryColor: { ...color }, sessions: [...state.sessions] })
  },
  setSecondaryColor(color) {
    const state = get()
    for (const session of state.sessions) {
      session.secondaryColor = { ...color }
      if (session.brushImage?.intrinsicSize) session.brushImage = remapSelectionBrushColors(session.brushImage, session.primaryColor, session.secondaryColor)
    }
    set({ sharedSecondaryColor: { ...color }, sessions: [...state.sessions] })
  },
  swapPrimarySecondaryColors() {
    const state = get()
    const primary = { ...state.sharedPrimaryColor }
    const secondary = { ...state.sharedSecondaryColor }
    for (const session of state.sessions) {
      session.primaryColor = { ...secondary }
      session.secondaryColor = { ...primary }
      if (session.brushImage?.intrinsicSize) session.brushImage = remapSelectionBrushColors(session.brushImage, session.primaryColor, session.secondaryColor)
      const matching = session.document.palette.find((entry) => session.document.paletteOrder.includes(entry.id) && colorEquals(entry.color, session.primaryColor))
      session.paletteSelectionId = matching?.id ?? null
      session.selectedPaletteIds = matching ? [matching.id] : []
    }
    set({ sharedPrimaryColor: secondary, sharedSecondaryColor: primary, sessions: [...state.sessions] })
  },
  setView(view) { get().mutateActive((session) => { Object.assign(session.view, view) }, false) },
  setViewportSize(size) {
    get().mutateActive((session) => {
      session.viewportSize = { width: Math.max(0, size.width), height: Math.max(0, size.height) }
    }, false)
  },
  setSelection(selection) { get().mutateActive((session) => { session.selection = selection ? { ...selection, mask: selection.mask?.slice() } : null }, false) },
  invertSelection() {
    const session = activeSession(get())
    if (!session?.selection) { set({ message: '请先创建选区。' }); return }
    const before = cloneSelectionMask(session.selection)
    const after = invertSelectionMask(session.selection, session.document.width, session.document.height)
    get().commitSelectionChange(before, after, '反选选区')
  },
  toggleSelectionOutline() {
    get().mutateActive((session) => {
      session.view.showSelectionOutline = session.view.showSelectionOutline === false
    }, false)
  },
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
      active.selectedGroupIds = []
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
    get().mutateActive((session) => selectPaletteColorCommand(session, id, additive), false)
    const session = activeSession(get())
    if (session && session.paletteSelectionId !== null) get().setPrimaryColor(session.primaryColor)
  },
  addPaletteColor() {
    get().mutateActive(addPaletteColorCommand)
  },
  applyPalette(colors) {
    get().mutateActive((session) => applyPaletteCommand(session, colors))
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
  reorderPaletteColors(ids, targetId, insertAfter = false) {
    get().mutateActive((session) => reorderPaletteColorsCommand(session, ids, targetId, insertAfter))
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
    let session = activeSession(get())
    if (session) flushViewPreview(session.document.id)
    session = activeSession(get())
    if (session?.pendingPaste) { get().cancelFloatingPaste(); return }
    if (!session?.history.canUndo) return
    get().mutateActive((session) => {
      const view = { ...session.view }
      session.history.undo()
      Object.assign(session.view, view)
    })
  },

  redo() {
    let session = activeSession(get())
    if (session) flushViewPreview(session.document.id)
    session = activeSession(get())
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
      const selectedLayer = session.selectedGroupId
        ? null
        : document.layers.find((candidate) => candidate.id === document.activeLayerId && session.selectedLayerIds.includes(candidate.id))
      const targetGroupId = session.selectedGroupId ?? selectedLayer?.groupId ?? null
      if (targetGroupId) layer.groupId = targetGroupId
      const groupMemberIds = targetGroupId ? new Set(getLayerIdsInGroup(document, targetGroupId)) : null
      const lastGroupMember = groupMemberIds ? document.layers.reduce((last, item, index) => groupMemberIds.has(item.id) ? index : last, -1) : -1
      const index = lastGroupMember >= 0 ? lastGroupMember + 1 : document.layers.length
      document.layers.splice(index, 0, layer)
      document.activeLayerId = layer.id
      session.selectedGroupId = null
      session.selectedGroupIds = []
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
      session.selectedGroupIds = []
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
      session.selectedGroupIds = []
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
          session.selectedGroupIds = []
        },
        redo: () => {
          for (const { copy, index } of placements) if (!document.layers.some((layer) => layer.id === copy.id)) document.layers.splice(Math.min(index, document.layers.length), 0, copy)
          document.activeLayerId = copies.at(-1)!.id
          session.selectedLayerIds = [...createdIds]
          session.selectedGroupId = null
          session.selectedGroupIds = []
        }
      })
    })
    return createdIds
  },

  deleteActiveLayer() {
    if ((activeSession(get())?.selectedLayerIds.length ?? 0) > 1) {
      get().deleteSelectedLayers()
      return
    }
    get().mutateActive((session) => {
      const document = session.document
      if (document.layers.length === 1) { set({ message: '至少保留一个图层。' }); return }
      const index = document.layers.findIndex((item) => item.id === document.activeLayerId)
      const removed = document.layers[index]
      if (!removed || isLayerEffectivelyLocked(document, removed)) { set({ message: '锁定的图层无法删除。' }); return }
      document.layers.splice(index, 1)
      const nextId = document.layers[Math.max(0, index - 1)].id
      document.activeLayerId = nextId
      session.selectedGroupId = null
      session.selectedGroupIds = []
      session.selectedLayerIds = [nextId]
      session.history.push({
        label: '删除图层', bytes: removed.pixels.byteLength,
        undo: () => { document.layers.splice(index, 0, removed); document.activeLayerId = removed.id },
        redo: () => { document.layers = document.layers.filter((item) => item.id !== removed.id); document.activeLayerId = nextId }
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
    if (locked) { set({ message: '锁定的图层或图层组无法删除。' }); return }
    if (removed.length >= current.document.layers.length) { set({ message: '至少保留一个图层。' }); return }
    get().mutateActive((session) => {
      const document = session.document
      const previousActiveId = document.activeLayerId
      const previousSelection = [...session.selectedLayerIds]
      const previousGroupId = session.selectedGroupId
      const previousGroupIds = [...session.selectedGroupIds]
      document.layers = document.layers.filter((layer) => !selectedIds.has(layer.id))
      if (removedGroups.length > 0) document.groups = document.groups.filter((group) => !selectedGroupIdSet.has(group.id))
      const nearestIndex = removed.length > 0 ? Math.max(0, Math.min(document.layers.length - 1, removed[0].index - 1)) : document.layers.findIndex((layer) => layer.id === previousActiveId)
      const nextId = document.layers[Math.max(0, nearestIndex)]?.id ?? previousActiveId
      document.activeLayerId = nextId
      session.selectedGroupId = null
      session.selectedGroupIds = []
      session.selectedLayerIds = [nextId]
      session.history.push({
        label: removedGroups.length > 0 ? '删除图层组' : removed.length === 1 ? '删除图层' : '删除所选图层',
        bytes: removed.reduce((sum, item) => sum + item.layer.pixels.byteLength, 0) + removedGroups.length * 96,
        undo: () => {
          for (const item of removedGroups) if (!document.groups.some((group) => group.id === item.group.id)) document.groups.splice(Math.min(item.index, document.groups.length), 0, item.group)
          for (const item of removed) if (!document.layers.some((layer) => layer.id === item.layer.id)) document.layers.splice(Math.min(item.index, document.layers.length), 0, item.layer)
          document.activeLayerId = previousActiveId
          session.selectedLayerIds = previousSelection
          session.selectedGroupId = previousGroupId
          session.selectedGroupIds = previousGroupIds
        },
        redo: () => {
          document.layers = document.layers.filter((layer) => !selectedIds.has(layer.id))
          document.groups = document.groups.filter((group) => !selectedGroupIdSet.has(group.id))
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
    const current = activeSession(get())
    if (current && lockedLayerStructure(current.document, layerIds)) { set({ message: '锁定的图层无法移动。' }); return }
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
    if (current && lockedLayerStructure(current.document, layerIds)) { set({ message: '锁定的图层无法移动。' }); return }
    get().mutateActive((session) => {
      const history = assignLayersToGroupOperation(session, layerIds, groupId, targetLayerId, insertAfterTarget)
      if (history) session.history.push(history)
    })
  },

  assignLayersToRoot(layerIds, targetLayerId, insertAfterTarget = true) {
    const current = activeSession(get())
    if (current && lockedLayerStructure(current.document, layerIds)) { set({ message: '锁定的图层无法移动。' }); return }
    get().mutateActive((session) => {
      const history = assignLayersToRootOperation(session, layerIds, targetLayerId, insertAfterTarget)
      if (history) session.history.push(history)
    })
  },

  assignLayersAboveGroup(layerIds, groupId) {
    const current = activeSession(get())
    if (current && lockedLayerStructure(current.document, layerIds)) { set({ message: '锁定的图层无法移动。' }); return }
    get().mutateActive((session) => {
      const history = assignLayersAboveGroupOperation(session, layerIds, groupId)
      if (history) session.history.push(history)
    })
  },

  reorderGroup(groupId, targetGroupId, insertAfterTarget = true) {
    if (groupId === targetGroupId) return
    const current = activeSession(get())
    if (current && lockedGroupStructure(current.document, groupId)) { set({ message: '锁定的图层组无法移动。' }); return }
    get().mutateActive((session) => {
      if (!canMoveGroupInto(session.document, groupId, targetGroupId)) {
        set({ message: '不能把图层组移动到自己的子组旁。' })
        return
      }
      const history = reorderGroupOperation(session, groupId, targetGroupId, insertAfterTarget)
      if (history) session.history.push(history)
    })
  },

  positionGroupNextToLayer(groupId, targetLayerId, insertAfterTarget = true) {
    const current = activeSession(get())
    if (current && lockedGroupStructure(current.document, groupId)) { set({ message: '锁定的图层组无法移动。' }); return }
    get().mutateActive((session) => {
      const history = positionGroupNextToLayerOperation(session, groupId, targetLayerId, insertAfterTarget)
      if (history) session.history.push(history)
    })
  },

  assignGroupToGroup(groupId, parentGroupId) {
    if (groupId === parentGroupId) return
    const current = activeSession(get())
    if (current && lockedGroupStructure(current.document, groupId)) { set({ message: '锁定的图层组无法移动。' }); return }
    get().mutateActive((session) => {
      if (!canMoveGroupInto(session.document, groupId, parentGroupId)) { set({ message: '不能把图层组移动到自己的子组中。' }); return }
      const history = assignGroupToGroupOperation(session, groupId, parentGroupId)
      if (history) session.history.push(history)
    })
  },

  assignGroupToRoot(groupId) {
    const current = activeSession(get())
    if (current && lockedGroupStructure(current.document, groupId)) { set({ message: '锁定的图层组无法移动。' }); return }
    get().mutateActive((session) => {
      const history = assignGroupToRootOperation(session, groupId)
      if (history) session.history.push(history)
    })
  },

  moveLayersToRootEdge(layerIds, edge) {
    const current = activeSession(get())
    if (current && lockedLayerStructure(current.document, layerIds)) { set({ message: '锁定的图层无法移动。' }); return }
    get().mutateActive((session) => {
      const history = moveLayersToRootEdgeOperation(session, layerIds, edge)
      if (history) session.history.push(history)
    })
  },

  moveGroupToRootEdge(groupId, edge) {
    const current = activeSession(get())
    if (current && lockedGroupStructure(current.document, groupId)) { set({ message: '锁定的图层组无法移动。' }); return }
    get().mutateActive((session) => {
      const history = moveGroupToRootEdgeOperation(session, groupId, edge)
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
    const current = activeSession(get())
    const groupIds = current?.selectedGroupId ? [current.selectedGroupId] : current?.document.layers.filter((layer) => current.selectedLayerIds.includes(layer.id) && layer.groupId).map((layer) => layer.groupId!) ?? []
    if (current && groupIds.some((groupId) => lockedGroupStructure(current.document, groupId))) { set({ message: '锁定的图层组无法解组。' }); return }
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

  clearLayerSelection() {
    get().commitFloatingPaste()
    get().mutateActive((session) => {
      session.selectedGroupId = null
      session.selectedGroupIds = []
      session.selectedLayerIds = []
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
      session.history.push({ label: '显示图层组', bytes: 8, undo: () => { group.visible = before }, redo: () => { group.visible = !before } })
    })
  },

  setGroupProperties(groupId, name, opacity, blendMode, locked, displayColor, description) {
    const trimmed = name.trim()
    if (!trimmed) return
    get().mutateActive((session) => {
      const group = getGroup(session.document, groupId)
      const lockingAncestor = getGroupLockingAncestor(session.document, group)
      if (!locked && lockingAncestor) {
        set({ message: '父级图层组已锁定，无法解锁。' })
        return
      }
      const before = { name: group.name, opacity: group.opacity, blendMode: group.blendMode, locked: group.locked, displayColor: group.displayColor, description: group.description ?? '' }
      const visualLocked = group.locked || Boolean(lockingAncestor)
      const after = { name: trimmed, opacity: visualLocked ? group.opacity : Math.max(0, Math.min(1, opacity)), blendMode: visualLocked ? group.blendMode : blendMode, locked: lockingAncestor ? group.locked : locked, displayColor: displayColor === undefined ? group.displayColor : displayColor ?? undefined, description: description ?? group.description ?? '' }
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
      session.history.push({ label: '图层不透明度', bytes: 16, undo: () => { layer.opacity = before }, redo: () => { layer.opacity = after } })
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
      session.history.push({ label: '修改图层属性', bytes: 32 + before.name.length + after.name.length, undo: () => { layer.name = before.name; layer.opacity = before.opacity }, redo: () => { layer.name = after.name; layer.opacity = after.opacity } })
    })
  },

  setLayerPropertiesWithBlend(layerId, name, opacity, blendMode, locked, displayColor, description) {
    const trimmed = name.trim()
    if (!trimmed) return
    get().mutateActive((session) => {
      const layer = getLayer(session.document, layerId)
      const lockingGroup = getLayerLockingGroup(session.document, layer)
      if (locked === false && lockingGroup) {
        set({ message: '父级图层组已锁定，无法解锁。' })
        return
      }
      const before = { name: layer.name, opacity: layer.opacity, blendMode: layer.blendMode, locked: layer.locked, displayColor: layer.displayColor, description: layer.description ?? '' }
      const visualLocked = layer.locked || Boolean(lockingGroup)
      const after = { name: trimmed, opacity: visualLocked ? layer.opacity : Math.max(0, Math.min(1, opacity)), blendMode: visualLocked ? layer.blendMode : blendMode, locked: lockingGroup ? layer.locked : locked ?? layer.locked, displayColor: displayColor === undefined ? layer.displayColor : displayColor ?? undefined, description: description ?? layer.description ?? '' }
      Object.assign(layer, after)
      session.history.push({ label: '修改图层属性', bytes: 40 + before.name.length + after.name.length, undo: () => Object.assign(layer, before), redo: () => Object.assign(layer, after) })
    })
  },
  applyActiveLayerAdjustment(adjustment) {
    get().mutateActive((session) => {
      const labels: Record<ColorAdjustment['kind'], string> = {
        'color-balance': '色彩平衡', 'brightness-contrast': '亮度/对比度', 'hue-saturation': '色相/饱和度', curves: '曲线'
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
  previewActiveLayerAdjustment(adjustment, baseline) {
    get().mutateActive((session) => {
      restoreAdjustmentSnapshot(session, baseline)
      for (const layerSnapshot of baseline.layers) {
        const layer = session.document.layers.find((candidate) => candidate.id === layerSnapshot.layerId)
        if (layer && !isLayerEffectivelyLocked(session.document, layer)) applyColorAdjustment(session.document, layer, adjustment, session.selection)
      }
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
        'color-balance': '色彩平衡', 'brightness-contrast': '亮度/对比度', 'hue-saturation': '色相/饱和度', curves: '曲线'
      }
      session.history.push({
        label: labels[adjustment.kind],
        bytes: before.layers.reduce((bytes, layer) => bytes + layer.pixels.byteLength, 0) + after.layers.reduce((bytes, layer) => bytes + layer.pixels.byteLength, 0) + (before.palette.length + after.palette.length) * 24,
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

  outlineActiveSelection(color, thickness, position, directions, kernel = 'round', previewEnabled = true) {
    const session = activeSession(get())
    if (!session?.selection) { set({ message: '请先创建选区。' }); return false }
    const layer = getActiveLayer(session.document)
    if (isLayerEffectivelyLocked(session.document, layer)) { set({ message: '当前图层已锁定。' }); return false }
    try {
      const edit = outlineSelection(session.document, layer, session.selection, color, thickness, position, directions, kernel)
      if (!edit) { set({ message: '选区内没有可描边的内容。' }); return false }
      session.document.outlineSettings = {
        color: { ...color },
        thickness: Math.max(1, Math.min(64, Math.round(thickness))),
        position,
        kernel,
        directions: directions ? { ...directions } : { nw: false, n: true, ne: false, w: true, e: true, sw: false, s: true, se: false },
        previewEnabled
      }
      get().commitPixelEdit(edit, position === 'inside' ? '内部描边' : '外部描边')
      set({ message: `已应用 ${Math.max(1, Math.min(64, Math.round(thickness)))} px ${position === 'inside' ? '内部' : '外部'}描边。` })
      return true
    } catch (error) {
      set({ message: error instanceof Error ? error.message : '无法应用描边。' })
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
    const selectedGroupIdSet = new Set<string>()
    for (const groupId of selectedGroupRows(session)) {
      selectedGroupIdSet.add(groupId)
      for (const descendantId of getDescendantGroupIds(document, groupId)) selectedGroupIdSet.add(descendantId)
    }
    const selectedLayerIdSet = new Set(selectedDirectLayerRows(session))
    for (const groupId of selectedGroupIdSet) for (const layerId of getLayerIdsInGroup(document, groupId)) selectedLayerIdSet.add(layerId)
    const layers = document.layers.filter((layer) => selectedLayerIdSet.has(layer.id))
    if (layers.length === 0) {
      set({ message: '请先选择要复制的图层或图层组。' })
      return
    }
    const clipboard: LayerCollectionClipboard = {
      sourceDocumentId: document.id,
      layers: layers.map((layer) => layerClipboardFromDocument(document, layer, layer.groupId && selectedGroupIdSet.has(layer.groupId) ? layer.groupId : null)),
      groups: document.groups.filter((group) => selectedGroupIdSet.has(group.id)).map((group) => ({
        key: group.id,
        name: group.name,
        visible: group.visible,
        locked: group.locked,
        opacity: group.opacity,
        blendMode: group.blendMode,
        displayColor: group.displayColor ? { ...group.displayColor } : undefined,
        description: group.description ?? '',
        parentKey: group.parentGroupId ?? null
      }))
    }
    clipboardService.setLayers(clipboard)
    set({ message: clipboard.groups.length > 0 ? `已复制图层组“${clipboard.groups[0].name}”，共 ${layers.length} 个图层。` : layers.length === 1 ? `已复制图层“${layers[0].name}”。` : `已复制 ${layers.length} 个图层。` })
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
      const selectedGroup = session.selectedGroupId ? document.groups.find((group) => group.id === session.selectedGroupId) : null
      const selectedLayer = session.selectedGroupId ? null : document.layers.find((layer) => layer.id === document.activeLayerId && session.selectedLayerIds.includes(layer.id))
      const targetGroupId = clipboard.groups.length > 0
        ? selectedGroup?.parentGroupId ?? selectedLayer?.groupId ?? null
        : selectedGroup?.id ?? selectedLayer?.groupId ?? null
      const groupIdByKey = new Map(clipboard.groups.map((group) => [group.key, createId('group')]))
      const resolveGroupParent = (parentKey?: string | null): string | null => {
        if (!parentKey) return targetGroupId
        const pastedParent = groupIdByKey.get(parentKey)
        if (pastedParent) return pastedParent
        return targetGroupId
      }
      const groups: LayerGroup[] = clipboard.groups.map((group) => ({
        id: groupIdByKey.get(group.key)!,
        name: `${group.name} 副本`,
        description: group.description ?? '',
        displayColor: group.displayColor ? { ...group.displayColor } : undefined,
        parentGroupId: resolveGroupParent(group.parentKey),
        visible: group.visible,
        locked: group.locked,
        opacity: group.opacity,
        blendMode: group.blendMode
      }))
      const layers = clipboard.layers.map((source) => {
        const layer = createLayer(`${source.name} 副本`, source.width, source.height, document.colorMode)
        layer.offsetX = source.offsetX
        layer.offsetY = source.offsetY
        layer.visible = source.visible
        layer.locked = source.locked
        layer.opacity = source.opacity
        layer.blendMode = source.blendMode
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
      document.groups.push(...groups)
      document.layers.splice(index, 0, ...layers)
      const pastedIds = layers.map((layer) => layer.id)
      const pastedGroupIds = new Set(groups.map((group) => group.id))
      document.activeLayerId = layers.at(-1)!.id
      session.selectedGroupId = null
      session.selectedGroupIds = groups.map((group) => group.id)
      session.selectedLayerIds = pastedIds
      session.history.push({
        label: layers.length === 1 && groups.length === 0 ? '粘贴图层' : '粘贴图层集合',
        bytes: layers.reduce((sum, layer) => sum + layer.pixels.byteLength, 0) + groups.length * 96,
        undo: () => {
          document.layers = document.layers.filter((candidate) => !pastedIds.includes(candidate.id))
          document.groups = document.groups.filter((candidate) => !pastedGroupIds.has(candidate.id))
          document.activeLayerId = previousActiveId
          session.selectedLayerIds = previousSelection
          session.selectedGroupId = previousGroupId
          session.selectedGroupIds = previousGroupIds
        },
        redo: () => {
          for (const group of groups) if (!document.groups.some((candidate) => candidate.id === group.id)) document.groups.push(group)
          const missingLayers = layers.filter((layer) => !document.layers.some((candidate) => candidate.id === layer.id))
          if (missingLayers.length > 0) document.layers.splice(Math.min(index, document.layers.length), 0, ...missingLayers)
          document.activeLayerId = layers.at(-1)!.id
          session.selectedGroupId = null
          session.selectedGroupIds = groups.map((group) => group.id)
          session.selectedLayerIds = pastedIds
        }
      })
    })
    set({ message: clipboard.groups.length > 0 ? `已粘贴图层组，共 ${clipboard.layers.length} 个图层。` : clipboard.layers.length === 1 ? `已粘贴图层“${clipboard.layers[0].name}”。` : `已粘贴 ${clipboard.layers.length} 个图层。` })
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
    clipboardService.setSelection({ width: selection.width, height: selection.height, originX: selection.x, originY: selection.y, pixels, mask })
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
      session.pendingPaste = { layerId: layer.id, beforeSelection, source, target: cloneSelectionMask(target)!, previewEdit: edit, copy: true, label: '粘贴到当前图层' }
      // A paste remains floating until confirmed, so its first drag should move
      // the pasted pixels instead of beginning a new pencil stroke.
      session.tool = 'selection'
      session.revision += 1
      set({ message: `已粘贴 ${pasted} 个非透明像素，可移动后按 Enter 确认。` })
    }, false)
  },

  async pasteAsNewLayer() {
    if (clipboardService.getLayers()) return get().pasteLayersFromClipboard()
    const clipboard = await clipboardService.readSelection(() => window.moonSprite.readClipboardImage())
    const current = activeSession(get())
    if (!clipboard || !current) { set({ message: '剪贴板中没有可粘贴的内容。' }); return false }
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
      const layer = createLayer('粘贴图层', clipboard.width, clipboard.height, document.colorMode)
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
        label: '粘贴为新图层',
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
    set({ message: '已粘贴为新图层。' })
    return true
  },

  async pasteAsNewDocument() {
    const clipboard = await clipboardService.readSelection(() => window.moonSprite.readClipboardImage())
    if (!clipboard) { set({ message: '剪贴板中没有可粘贴的图片。' }); return false }
    const document = createDocument('粘贴的图像', clipboard.width, clipboard.height, 'rgba')
    const layer = getActiveLayer(document)
    for (let index = 0; index < clipboard.mask.length; index += 1) {
      if (clipboard.mask[index] === 1) writeLayerColor(document, layer, index, unpackColor(clipboard.pixels[index]))
    }
    document.dirty = true
    get().addSession(document)
    set({ message: '已将剪贴板图片粘贴为新项目。' })
    return true
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

  beginFloatingSelectionTransform(source, edit, before, target, copy, label) {
    get().mutateActive((session) => {
      const layer = getActiveLayer(session.document)
      session.pendingPaste = {
        layerId: layer.id,
        beforeSelection: cloneSelectionMask(before),
        source,
        target: cloneSelectionMask(target)!,
        previewEdit: edit,
        copy,
        label
      }
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
      const pixelEntry = commitPixelEdit(session.document, pending.previewEdit, pending.label)
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
    let progressStarted = false
    const updateProgress = (value: number, label: string): void => {
      if (!showProgress) return
      if (progressStarted && !get().saveProgress) return
      progressStarted = true
      set({ saveProgress: { title: '正在另存为', value, label } })
    }
    try {
      const filePath = await saveDocumentFile({
        api: window.moonSprite,
        documentId,
        getDocument: () => get().sessions.find((item) => item.document.id === documentId)?.document ?? null,
        saveAs,
        options,
        preferredImageFormat: saveImageKindForPreference(readStoredString(SAVE_FORMAT_PREFERENCE_KEY)),
        lifecycle: {
          onEncodeStart: () => updateProgress(12, '正在生成工程数据…'),
          onWriteStart: () => updateProgress(72, '正在写入文件…')
        }
      })
      if (!filePath) { if (progressStarted) set({ saveProgress: null }); return false }
      const saved = get().sessions.find((item) => item.document.id === documentId)
      if (!saved) { if (progressStarted) set({ saveProgress: null }); return false }
      saved.document.filePath = filePath
      saved.document.name = fileNameFromPath(filePath)
      saved.document.dirty = false
      set({ sessions: [...get().sessions] })
      recordRecentProject(filePath, saved.document.name)
      await get().autosaveDirty()
      await recoveryService.delete(window.moonSprite, documentId)
      const progressVisible = progressStarted && Boolean(get().saveProgress)
      set({ message: '工程已保存。', ...(progressVisible ? { saveProgress: { title: '正在另存为', value: 100, label: '另存为完成' } } : {}) })
      if (progressVisible) window.setTimeout(() => { if (get().saveProgress?.value === 100) set({ saveProgress: null }) }, 180)
      return true
    } catch (error) {
      set({ message: error instanceof Error ? error.message : '保存工程失败。', ...(progressStarted ? { saveProgress: null } : {}) })
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
      set({ saveProgress: { title: '正在导出', value, label } })
    }
    try {
      const message = await exportDocumentFile(window.moonSprite, session.document, options, {
        onEncodeStart: () => updateProgress(12, '正在生成图像数据…'),
        onWriteStart: () => updateProgress(72, '正在写入文件…')
      })
      if (!message) { if (progressStarted) set({ saveProgress: null }); return false }
      const progressVisible = progressStarted && Boolean(get().saveProgress)
      set({ message, ...(progressVisible ? { saveProgress: { title: '正在导出', value: 100, label: '导出完成' } } : {}) })
      if (progressVisible) window.setTimeout(() => { if (get().saveProgress?.value === 100) set({ saveProgress: null }) }, 180)
      return true
    } catch (error) {
      set({ message: error instanceof Error ? error.message : '导出图像失败。', ...(progressStarted ? { saveProgress: null } : {}) })
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
