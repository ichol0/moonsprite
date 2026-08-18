import type { AnimationCel, AnimationFrame, AnimationGroupMask, ColorMode, LayerGroup, PaletteEntry, RasterLayer, SpriteDocument, Tileset } from '@shared/types'
import { cloneAnimationCel, ensureAnimationDocument, refreshActiveAnimationFrame, restoreAnimationCels, syncActiveAnimationFrame } from '@/core/animation'
import { captureDocumentImageResizeSnapshot, documentImageResizeSnapshotBytes, restoreDocumentImageResizeSnapshot, type DocumentImageResizeSnapshot } from '@/core/document'
import { cloneLayerStyles } from '@/core/layer-styles'
import { rasterStorageIdentity, runtimeRasterForSurface } from '@/core/runtime-raster'
import { cloneTilemapCelData } from '@/core/tilemap'

interface AnimationStructureSnapshot {
  frames: AnimationFrame[]
  cels: AnimationCel[]
  groupMasks: AnimationGroupMask[]
  activeFrameId: string
  loop: boolean
}

export interface DocumentStructureSnapshot {
  layers: RasterLayer[]
  layerParents: Array<{ layer: RasterLayer; groupId: string | null }>
  groups: LayerGroup[]
  groupPositions: Array<{ group: LayerGroup; parentGroupId: string | null; panelOrder?: number }>
  activeLayerId: string
  tilesets: Tileset[]
  palette: PaletteEntry[]
  paletteOrder: number[]
  paletteSlots?: Array<number | null>
  paletteColumns?: number
  nextColorId: number
  animation: AnimationStructureSnapshot
}

const clonePalette = (palette: readonly PaletteEntry[]): PaletteEntry[] => palette.map((entry) => ({ ...entry, color: { ...entry.color } }))

export const captureDocumentStructureSnapshot = (document: SpriteDocument): DocumentStructureSnapshot => {
  syncActiveAnimationFrame(document)
  const timeline = ensureAnimationDocument(document)
  return {
    layers: [...document.layers],
    layerParents: document.layers.map((layer) => ({ layer, groupId: layer.groupId ?? null })),
    groups: [...document.groups],
    groupPositions: document.groups.map((group) => ({ group, parentGroupId: group.parentGroupId ?? null, panelOrder: group.panelOrder })),
    activeLayerId: document.activeLayerId,
    tilesets: [...(document.tilesets ?? [])],
    palette: clonePalette(document.palette),
    paletteOrder: [...document.paletteOrder],
    paletteSlots: document.paletteSlots ? [...document.paletteSlots] : undefined,
    paletteColumns: document.paletteColumns,
    nextColorId: document.nextColorId,
    animation: {
      frames: [...timeline.frames],
      cels: [...timeline.cels],
      groupMasks: [...(timeline.groupMasks ?? [])],
      activeFrameId: timeline.activeFrameId,
      loop: timeline.loop
    }
  }
}

export const restoreDocumentStructureSnapshot = (document: SpriteDocument, snapshot: DocumentStructureSnapshot): void => {
  for (const state of snapshot.layerParents) state.layer.groupId = state.groupId
  for (const state of snapshot.groupPositions) {
    state.group.parentGroupId = state.parentGroupId
    if (state.panelOrder === undefined) delete state.group.panelOrder
    else state.group.panelOrder = state.panelOrder
  }
  document.layers = [...snapshot.layers]
  document.groups = [...snapshot.groups]
  document.activeLayerId = snapshot.activeLayerId
  document.tilesets = [...snapshot.tilesets]
  document.palette = clonePalette(snapshot.palette)
  document.paletteOrder = [...snapshot.paletteOrder]
  document.paletteSlots = snapshot.paletteSlots ? [...snapshot.paletteSlots] : undefined
  document.paletteColumns = snapshot.paletteColumns
  document.nextColorId = snapshot.nextColorId
  const timeline = ensureAnimationDocument(document)
  timeline.frames = [...snapshot.animation.frames]
  timeline.cels = [...snapshot.animation.cels]
  timeline.groupMasks = [...snapshot.animation.groupMasks]
  timeline.activeFrameId = snapshot.animation.activeFrameId
  timeline.loop = snapshot.animation.loop
  refreshActiveAnimationFrame(document)
}

const snapshotObjects = (snapshot: DocumentStructureSnapshot): Set<object> => new Set<object>([
  ...snapshot.layers,
  ...snapshot.groups,
  ...snapshot.tilesets,
  ...snapshot.animation.frames,
  ...snapshot.animation.cels,
  ...snapshot.animation.groupMasks
])

const retainedBytesForObjects = (snapshot: DocumentStructureSnapshot, retained: ReadonlySet<object>): number => {
  const storage = new Set<object>()
  let bytes = 0
  const addSurface = (surface: RasterLayer | NonNullable<AnimationCel['surface']>): void => {
    const identity = rasterStorageIdentity(surface)
    if (storage.has(identity)) return
    storage.add(identity)
    const runtime = runtimeRasterForSurface(surface)
    bytes += runtime ? runtime.data.byteLength + runtime.tileOffsets.byteLength : surface.pixels.byteLength
  }
  for (const layer of snapshot.layers) if (retained.has(layer)) addSurface(layer)
  for (const cel of snapshot.animation.cels) if (retained.has(cel)) {
    if (cel.surface) addSurface(cel.surface)
    if (cel.mask) addSurface(cel.mask)
  }
  for (const entry of snapshot.animation.groupMasks) if (retained.has(entry)) addSurface(entry.mask)
  for (const tileset of snapshot.tilesets) if (retained.has(tileset) && !storage.has(tileset.pixels)) {
    storage.add(tileset.pixels)
    bytes += tileset.pixels.byteLength
  }
  return bytes
}

export const documentStructureDeltaBytes = (before: DocumentStructureSnapshot, after: DocumentStructureSnapshot): number => {
  const beforeObjects = snapshotObjects(before)
  const afterObjects = snapshotObjects(after)
  const beforeOnly = new Set([...beforeObjects].filter((object) => !afterObjects.has(object)))
  const afterOnly = new Set([...afterObjects].filter((object) => !beforeObjects.has(object)))
  return retainedBytesForObjects(before, beforeOnly)
    + retainedBytesForObjects(after, afterOnly)
    + (beforeObjects.size + afterObjects.size) * 24
    + (before.palette.length + after.palette.length) * 32
}

interface LayerDefinitionSnapshot {
  kind?: RasterLayer['kind']
  tilemapTilesetId?: string
  layerStyles?: RasterLayer['layerStyles']
}

export interface LayerContentSnapshot {
  layerId: string
  definition: LayerDefinitionSnapshot
  cels: AnimationCel[]
  tilesets: Tileset[]
  palette: PaletteEntry[]
  paletteOrder: number[]
  paletteSlots?: Array<number | null>
  paletteColumns?: number
  nextColorId: number
}

export const captureLayerContentSnapshot = (document: SpriteDocument, layerId: string): LayerContentSnapshot => {
  syncActiveAnimationFrame(document)
  const layer = document.layers.find((candidate) => candidate.id === layerId)
  if (!layer) throw new Error(`Layer not found: ${layerId}`)
  const timeline = ensureAnimationDocument(document)
  return {
    layerId,
    definition: {
      kind: layer.kind,
      tilemapTilesetId: layer.tilemapTilesetId,
      layerStyles: cloneLayerStyles(layer.layerStyles)
    },
    cels: timeline.cels.filter((cel) => cel.layerId === layerId).map(cloneAnimationCel),
    tilesets: [...(document.tilesets ?? [])],
    palette: clonePalette(document.palette),
    paletteOrder: [...document.paletteOrder],
    paletteSlots: document.paletteSlots ? [...document.paletteSlots] : undefined,
    paletteColumns: document.paletteColumns,
    nextColorId: document.nextColorId
  }
}

export const restoreLayerContentSnapshot = (document: SpriteDocument, snapshot: LayerContentSnapshot): void => {
  const layer = document.layers.find((candidate) => candidate.id === snapshot.layerId)
  if (!layer) return
  if (snapshot.definition.kind) layer.kind = snapshot.definition.kind
  else delete layer.kind
  if (snapshot.definition.tilemapTilesetId) layer.tilemapTilesetId = snapshot.definition.tilemapTilesetId
  else delete layer.tilemapTilesetId
  if (snapshot.definition.layerStyles) layer.layerStyles = cloneLayerStyles(snapshot.definition.layerStyles)
  else delete layer.layerStyles
  document.tilesets = [...snapshot.tilesets]
  document.palette = clonePalette(snapshot.palette)
  document.paletteOrder = [...snapshot.paletteOrder]
  document.paletteSlots = snapshot.paletteSlots ? [...snapshot.paletteSlots] : undefined
  document.paletteColumns = snapshot.paletteColumns
  document.nextColorId = snapshot.nextColorId
  restoreAnimationCels(document, snapshot.cels)
}

export const layerContentSnapshotBytes = (snapshot: LayerContentSnapshot): number => {
  const storage = new Set<object>()
  let bytes = 0
  for (const cel of snapshot.cels) {
    if (cel.surface) {
      const identity = rasterStorageIdentity(cel.surface)
      if (!storage.has(identity)) {
        storage.add(identity)
        const runtime = runtimeRasterForSurface(cel.surface)
        bytes += runtime ? runtime.data.byteLength + runtime.tileOffsets.byteLength : cel.surface.pixels.byteLength
      }
    }
    if (cel.mask && !storage.has(cel.mask.pixels)) {
      storage.add(cel.mask.pixels)
      bytes += cel.mask.pixels.byteLength
    }
  }
  for (const tileset of snapshot.tilesets) if (!storage.has(tileset.pixels)) {
    storage.add(tileset.pixels)
    bytes += tileset.pixels.byteLength
  }
  return bytes + snapshot.cels.length * 64 + snapshot.palette.length * 32
}

export interface DocumentColorModeSnapshot {
  colorMode: ColorMode
  surfaces: DocumentImageResizeSnapshot
  palette: PaletteEntry[]
  paletteOrder: number[]
  paletteSlots?: Array<number | null>
  paletteColumns?: number
  nextColorId: number
}

export const captureDocumentColorModeSnapshot = (document: SpriteDocument): DocumentColorModeSnapshot => ({
  colorMode: document.colorMode,
  surfaces: captureDocumentImageResizeSnapshot(document),
  palette: clonePalette(document.palette),
  paletteOrder: [...document.paletteOrder],
  paletteSlots: document.paletteSlots ? [...document.paletteSlots] : undefined,
  paletteColumns: document.paletteColumns,
  nextColorId: document.nextColorId
})

export const restoreDocumentColorModeSnapshot = (document: SpriteDocument, snapshot: DocumentColorModeSnapshot): void => {
  document.colorMode = snapshot.colorMode
  document.palette = clonePalette(snapshot.palette)
  document.paletteOrder = [...snapshot.paletteOrder]
  document.paletteSlots = snapshot.paletteSlots ? [...snapshot.paletteSlots] : undefined
  document.paletteColumns = snapshot.paletteColumns
  document.nextColorId = snapshot.nextColorId
  restoreDocumentImageResizeSnapshot(document, snapshot.surfaces)
  refreshActiveAnimationFrame(document)
}

export const documentColorModeSnapshotBytes = (snapshot: DocumentColorModeSnapshot): number =>
  documentImageResizeSnapshotBytes(snapshot.surfaces) + snapshot.palette.length * 32

export interface DocumentCanvasResizeSnapshot {
  surfaces: DocumentImageResizeSnapshot
  cels: Array<{ celId: string; surface?: AnimationCel['surface']; tilemap?: AnimationCel['tilemap'] }>
}

export const captureDocumentCanvasResizeSnapshot = (document: SpriteDocument): DocumentCanvasResizeSnapshot => ({
  surfaces: captureDocumentImageResizeSnapshot(document),
  cels: (document.animation?.cels ?? []).map((cel) => ({
    celId: cel.id,
    surface: cel.surface,
    tilemap: cel.tilemap ? cloneTilemapCelData(cel.tilemap) : undefined
  }))
})

export const restoreDocumentCanvasResizeSnapshot = (document: SpriteDocument, snapshot: DocumentCanvasResizeSnapshot): void => {
  const cels = new Map(snapshot.cels.map((entry) => [entry.celId, entry]))
  for (const cel of document.animation?.cels ?? []) {
    const state = cels.get(cel.id)
    if (!state) continue
    cel.surface = state.surface
    if (state.tilemap) cel.tilemap = cloneTilemapCelData(state.tilemap)
    else delete cel.tilemap
  }
  restoreDocumentImageResizeSnapshot(document, snapshot.surfaces)
}

export const documentCanvasResizeSnapshotBytes = (snapshot: DocumentCanvasResizeSnapshot): number =>
  documentImageResizeSnapshotBytes(snapshot.surfaces)
  + snapshot.cels.reduce((sum, entry) => sum + (entry.tilemap?.cells.length ?? 0) * 16 + 32, 0)
