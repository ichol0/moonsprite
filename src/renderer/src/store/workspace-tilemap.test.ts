import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MoonSpriteApi } from '@shared/types'
import { activateAnimationFrame, addBlankAnimationFrame, animationCelKey, animationCelOffsetsForKeys, ensureAnimationDocument, setAnimationCelOffsetsForKeys } from '@/core/animation'
import { createDocument, getActiveLayer, readLayerColorAt, writeLayerColor } from '@/core/document'
import { beginPixelEdit, recordPixel } from '@/core/history'
import { packColor } from '@/core/raster'
import { activeTilemapCelTarget, captureTilemapSelectionMove, previewTilemapSelectionMove, tilemapEditPreviewTilePixels, writeTilemapCell } from '@/core/tilemap-document'
import { activeFreeTileCelTarget, captureFreeTileSourceSnapshot } from '@/core/free-tile-document'
import { freeTileInstanceBounds, freeTileSourceRefs } from '@/core/free-tile'
import { createFreeTileSourceEditRaster, freeTileSelectionToEditRaster, freeTileSourceSnapshotFromEditRaster, freeTileTransformTargetToEditRaster } from '@/core/free-tile-edit'
import { beginTilemapEdit, createBlankTileset, readTilesetTilePixels, tilemapCellBounds, tilemapCellIndexAtPoint, writeTilesetTilePixels } from '@/core/tilemap'
import { applySelectionTranslationPreview, captureSelectionTransform, selectionTranslationPreviewEdit } from '@/core/tools'
import { isToolAvailableForSession } from './workspace-session'
import { useWorkspace } from './workspace'

beforeEach(() => {
  const api = {
    getResourceInfo: vi.fn(async () => ({ totalBytes: 8_000_000_000, freeBytes: 4_000_000_000 })),
    writeClipboardImage: vi.fn(async () => {})
  } as unknown as MoonSpriteApi
  Object.defineProperty(window, 'moonSprite', { configurable: true, writable: true, value: api })
  localStorage.clear()
  useWorkspace.setState({ sessions: [], activeId: null, message: null, saveProgress: null, dialog: null })
})

describe('workspace Free Tile layer ownership', () => {
  it('uses the requested default names for tile layers and sources', async () => {
    const document = createDocument('default tile names', 4, 4, 'rgba')
    useWorkspace.getState().addSession(document)

    await useWorkspace.getState().createTilemapLayer({ name: '   ', tileWidth: 2, tileHeight: 2 })
    expect(document.layers.find((candidate) => candidate.kind === 'tilemap')?.name).toBe('瓦片图层')

    await useWorkspace.getState().createFreeTileLayer({ name: '   ' })
    const layer = document.layers.find((candidate) => candidate.kind === 'free-tile')!
    expect(layer.name).toBe('自由瓦片图层')
    expect(layer.freeTileSources?.map((source) => source.name)).toEqual(['自由瓦片1'])

    expect(useWorkspace.getState().addFreeTileSource(layer.id)).toBeTruthy()
    expect(useWorkspace.getState().addFreeTileSource(layer.id)).toBeTruthy()
    expect(layer.freeTileSources?.map((source) => source.name)).toEqual(['自由瓦片1', '自由瓦片2', '自由瓦片3'])
  })

  it('stores source properties separately from instance appearance', async () => {
    const document = createDocument('free tile source properties', 4, 4, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createFreeTileLayer({ name: 'Props' })
    const layer = document.layers.find((candidate) => candidate.kind === 'free-tile')!
    const source = layer.freeTileSources![0]
    const initialDisplayColor = source.displayColor ? { ...source.displayColor } : undefined
    expect(initialDisplayColor).toBeDefined()

    expect(useWorkspace.getState().setFreeTileSourceProperties(source.id, {
      name: 'Glow',
      description: 'Reusable glow source',
      displayColor: { r: 12, g: 34, b: 56, a: 255 },
      offsetX: -2,
      offsetY: 3,
      locked: true,
      visible: false
    })).toBe(true)
    expect(layer.freeTileSources![0]).toMatchObject({ name: 'Glow', description: 'Reusable glow source', opacity: 1, offsetX: -2, offsetY: 3, locked: true, visible: false, blendMode: 'normal', displayColor: { r: 12, g: 34, b: 56, a: 255 } })

    useWorkspace.getState().undo()
    expect(layer.freeTileSources![0]).toMatchObject({ name: '自由瓦片1', opacity: 1, offsetX: 0, offsetY: 0, locked: false, visible: true, blendMode: 'normal', displayColor: initialDisplayColor })
    expect(layer.freeTileSources![0].description).toBeUndefined()
    useWorkspace.getState().redo()
    expect(layer.freeTileSources![0].displayColor).toEqual({ r: 12, g: 34, b: 56, a: 255 })

    expect(useWorkspace.getState().setFreeTileSourceProperties(source.id, { displayColor: null })).toBe(true)
    expect(layer.freeTileSources![0].displayColor).toBeUndefined()
    const placement = useWorkspace.getState().beginFreeTilePlacement()!
    placement.after.instances = [{ id: 'instance-properties', sourceId: source.id, x: 0, y: 0, opacity: 1, blendMode: 'normal' }]
    expect(useWorkspace.getState().previewFreeTilePlacement(placement)).toBe(true)
    expect(useWorkspace.getState().commitFreeTilePlacement(placement, 'Place instance')).not.toBeNull()
    expect(useWorkspace.getState().setFreeTileInstanceProperties('instance-properties', { opacity: 0.65, blendMode: 'screen' })).toBe(true)
    expect(layer.freeTileSources![0]).toMatchObject({ opacity: 1, blendMode: 'normal' })
    expect(activeFreeTileCelTarget(document)!.freeTiles.instances[0]).toMatchObject({ opacity: 0.65, blendMode: 'screen' })
  })

  it('previews Free Tile source properties without history and commits one undoable result', async () => {
    const document = createDocument('free tile source property transaction', 4, 4, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createFreeTileLayer({ name: 'Source Transaction' })
    const layer = document.layers.find((candidate) => candidate.kind === 'free-tile')!
    const source = layer.freeTileSources![0]
    const tileset = document.tilesets!.find((candidate) => candidate.id === source.tilesetId)!
    const original = { name: source.name, tilesetName: tileset.name, displayColor: source.displayColor ? { ...source.displayColor } : undefined, visible: source.visible, locked: source.locked }
    const originalUpdatedAt = document.updatedAt
    document.dirty = false

    const canceledTransaction = useWorkspace.getState().beginFreeTileSourcePropertiesTransaction(source.id)!
    expect(useWorkspace.getState().previewFreeTileSourcePropertiesTransaction(canceledTransaction, { name: 'Preview Source', visible: false, locked: true, displayColor: null })).toBe(true)
    expect(source).toMatchObject({ name: 'Preview Source', visible: false, locked: true })
    expect(source.displayColor).toBeUndefined()
    expect(tileset.name).toBe('Preview Source')
    expect(document.dirty).toBe(false)
    expect(document.updatedAt).toBe(originalUpdatedAt)
    expect(useWorkspace.getState().cancelFreeTileSourcePropertiesTransaction(canceledTransaction)).toBe(true)
    expect(source).toMatchObject({ name: original.name, visible: original.visible, locked: original.locked })
    expect(source.displayColor).toEqual(original.displayColor)
    expect(tileset.name).toBe(original.tilesetName)

    const committedTransaction = useWorkspace.getState().beginFreeTileSourcePropertiesTransaction(source.id)!
    expect(useWorkspace.getState().previewFreeTileSourcePropertiesTransaction(committedTransaction, { name: 'First Preview', visible: false })).toBe(true)
    expect(useWorkspace.getState().previewFreeTileSourcePropertiesTransaction(committedTransaction, { name: '  Final Source  ', visible: false, displayColor: { r: 12, g: 34, b: 56, a: 255 } })).toBe(true)
    expect(useWorkspace.getState().commitFreeTileSourcePropertiesTransaction(committedTransaction, { name: '  Final Source  ', visible: false, displayColor: { r: 12, g: 34, b: 56, a: 255 } })).toBe(true)
    expect(source).toMatchObject({ name: 'Final Source', visible: false, displayColor: { r: 12, g: 34, b: 56, a: 255 } })
    expect(tileset.name).toBe('Final Source')
    expect(document.dirty).toBe(true)

    useWorkspace.getState().undo()
    expect(source).toMatchObject({ name: original.name, visible: original.visible, locked: original.locked })
    expect(source.displayColor).toEqual(original.displayColor)
    expect(tileset.name).toBe(original.tilesetName)
    useWorkspace.getState().redo()
    expect(source).toMatchObject({ name: 'Final Source', visible: false, displayColor: { r: 12, g: 34, b: 56, a: 255 } })
  })

  it('previews Free Tile instance properties and commits all fields as one history step', async () => {
    const document = createDocument('free tile instance property transaction', 8, 8, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createFreeTileLayer({ name: 'Instance Transaction' })
    const target = activeFreeTileCelTarget(document)!
    const sourceId = target.layer.freeTileSources![0].id
    const placement = useWorkspace.getState().beginFreeTilePlacement()!
    placement.after.instances = [{ id: 'transaction-instance', sourceId, x: 1, y: 2 }]
    expect(useWorkspace.getState().previewFreeTilePlacement(placement)).toBe(true)
    expect(useWorkspace.getState().commitFreeTilePlacement(placement, 'Place instance')).not.toBeNull()
    const originalUpdatedAt = document.updatedAt
    document.dirty = false

    const canceledTransaction = useWorkspace.getState().beginFreeTileInstancePropertiesTransaction('transaction-instance')!
    expect(useWorkspace.getState().previewFreeTileInstancePropertiesTransaction(canceledTransaction, { x: 4, y: 5, rotation: 1, flipHorizontal: true, opacity: 0.5, blendMode: 'screen' })).toBe(true)
    expect(activeFreeTileCelTarget(document)!.freeTiles.instances[0]).toMatchObject({ rotation: 1, flipHorizontal: true, opacity: 0.5, blendMode: 'screen' })
    expect(freeTileInstanceBounds(activeFreeTileCelTarget(document)!.freeTiles.instances[0], activeFreeTileCelTarget(document)!.sources)).toMatchObject({ x: 4, y: 5 })
    expect(document.dirty).toBe(false)
    expect(document.updatedAt).toBe(originalUpdatedAt)
    expect(useWorkspace.getState().cancelFreeTileInstancePropertiesTransaction(canceledTransaction)).toBe(true)
    expect(activeFreeTileCelTarget(document)!.freeTiles.instances[0]).toMatchObject({ x: 1, y: 2 })
    expect(activeFreeTileCelTarget(document)!.freeTiles.instances[0]).not.toHaveProperty('rotation')

    const committedTransaction = useWorkspace.getState().beginFreeTileInstancePropertiesTransaction('transaction-instance')!
    expect(useWorkspace.getState().previewFreeTileInstancePropertiesTransaction(committedTransaction, { rotation: 1 })).toBe(true)
    const finalChanges = { x: 6, y: 7, rotation: 2 as const, flipVertical: true, opacity: 0.65, blendMode: 'multiply' as const }
    expect(useWorkspace.getState().previewFreeTileInstancePropertiesTransaction(committedTransaction, finalChanges)).toBe(true)
    expect(useWorkspace.getState().commitFreeTileInstancePropertiesTransaction(committedTransaction, finalChanges)).toBe(true)
    expect(activeFreeTileCelTarget(document)!.freeTiles.instances[0]).toMatchObject({ rotation: 2, flipVertical: true, opacity: 0.65, blendMode: 'multiply' })
    expect(freeTileInstanceBounds(activeFreeTileCelTarget(document)!.freeTiles.instances[0], activeFreeTileCelTarget(document)!.sources)).toMatchObject({ x: 6, y: 7 })

    useWorkspace.getState().undo()
    expect(activeFreeTileCelTarget(document)!.freeTiles.instances[0]).toMatchObject({ x: 1, y: 2 })
    expect(activeFreeTileCelTarget(document)!.freeTiles.instances[0]).not.toHaveProperty('rotation')
    expect(activeFreeTileCelTarget(document)!.freeTiles.instances[0]).not.toHaveProperty('flipVertical')
    useWorkspace.getState().redo()
    expect(activeFreeTileCelTarget(document)!.freeTiles.instances[0]).toMatchObject({ rotation: 2, flipVertical: true, opacity: 0.65, blendMode: 'multiply' })
  })

  it('batch-previews selected Free Tile instance properties and restores them with one undo', async () => {
    const document = createDocument('free tile batch instance properties', 8, 8, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createFreeTileLayer({ name: 'Batch Transaction' })
    const target = activeFreeTileCelTarget(document)!
    const sourceId = target.layer.freeTileSources![0].id
    const placement = useWorkspace.getState().beginFreeTilePlacement()!
    placement.after.instances = [
      { id: 'batch-instance-a', sourceId, x: 1, y: 2 },
      { id: 'batch-instance-b', sourceId, x: 3, y: 4, locked: true }
    ]
    expect(useWorkspace.getState().previewFreeTilePlacement(placement)).toBe(true)
    expect(useWorkspace.getState().commitFreeTilePlacement(placement, 'Place instances')).not.toBeNull()
    const originalUpdatedAt = document.updatedAt
    document.dirty = false

    const transaction = useWorkspace.getState().beginFreeTileInstancePropertiesTransaction(['batch-instance-a', 'batch-instance-b'])!
    const changes = { x: 6, y: 7, rotation: 1 as const, opacity: 0.5, blendMode: 'screen' as const }
    expect(useWorkspace.getState().previewFreeTileInstancePropertiesTransaction(transaction, changes)).toBe(true)
    const preview = activeFreeTileCelTarget(document)!
    expect(freeTileInstanceBounds(preview.freeTiles.instances[0], preview.sources)).toMatchObject({ x: 6, y: 7 })
    expect(freeTileInstanceBounds(preview.freeTiles.instances[1], preview.sources)).toMatchObject({ x: 3, y: 4 })
    expect(preview.freeTiles.instances.map((instance) => instance.opacity)).toEqual([0.5, 0.5])
    expect(document.dirty).toBe(false)
    expect(document.updatedAt).toBe(originalUpdatedAt)

    expect(useWorkspace.getState().commitFreeTileInstancePropertiesTransaction(transaction, changes)).toBe(true)
    expect(document.dirty).toBe(true)
    useWorkspace.getState().undo()
    const undone = activeFreeTileCelTarget(document)!
    expect(undone.freeTiles.instances[0]).toMatchObject({ x: 1, y: 2 })
    expect(undone.freeTiles.instances[1]).toMatchObject({ x: 3, y: 4, locked: true })
    expect(undone.freeTiles.instances.map((instance) => instance.opacity)).toEqual([undefined, undefined])
    useWorkspace.getState().redo()
    expect(activeFreeTileCelTarget(document)!.freeTiles.instances.map((instance) => instance.opacity)).toEqual([0.5, 0.5])
  })

  it('supports replace, Ctrl-toggle, and Shift-range selection for instance rows', async () => {
    const document = createDocument('free tile instance row selection', 8, 8, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createFreeTileLayer({ name: 'Selection' })
    const target = activeFreeTileCelTarget(document)!
    const sourceId = target.layer.freeTileSources![0].id
    const placement = useWorkspace.getState().beginFreeTilePlacement()!
    placement.after.instances = [
      { id: 'selection-a', sourceId, x: 0, y: 0 },
      { id: 'selection-b', sourceId, x: 2, y: 0 },
      { id: 'selection-c', sourceId, x: 4, y: 0 }
    ]
    expect(useWorkspace.getState().previewFreeTilePlacement(placement)).toBe(true)
    expect(useWorkspace.getState().commitFreeTilePlacement(placement, 'Place instances')).not.toBeNull()
    const order = ['selection-c', 'selection-b', 'selection-a']

    useWorkspace.getState().setFreeTileMode('paint')
    useWorkspace.getState().selectFreeTileInstanceRow('selection-c', 'replace', order)
    expect(useWorkspace.getState().sessions[0].freeTileMode).toBe('edit')
    useWorkspace.getState().selectFreeTileInstanceRow('selection-a', 'range', order)
    expect(useWorkspace.getState().sessions[0]).toMatchObject({
      selectedFreeTileInstanceId: 'selection-a',
      selectedFreeTileInstanceIds: order,
      freeTileInstanceSelectionAnchorId: 'selection-c'
    })

    useWorkspace.getState().selectFreeTileInstanceRow('selection-b', 'toggle', order)
    expect(useWorkspace.getState().sessions[0]).toMatchObject({
      selectedFreeTileInstanceId: 'selection-a',
      selectedFreeTileInstanceIds: ['selection-c', 'selection-a'],
      freeTileInstanceSelectionAnchorId: 'selection-b'
    })
  })

  it('commits a Free Tile source transform and its selection as one history step', async () => {
    const document = createDocument('free tile source selection history', 8, 4, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createFreeTileLayer({ name: 'Shared source' })
    const target = activeFreeTileCelTarget(document)!
    const source = target.layer.freeTileSources![0]
    const tileset = document.tilesets!.find((candidate) => candidate.id === source.tilesetId)!
    writeTilesetTilePixels(tileset, tileset.tileIds[0], new Uint8ClampedArray([220, 40, 60, 255]))
    const placement = useWorkspace.getState().beginFreeTilePlacement()!
    placement.after.instances = [
      { id: 'selected', sourceId: source.id, x: 1, y: 1 },
      { id: 'sibling', sourceId: source.id, x: 5, y: 1 }
    ]
    expect(useWorkspace.getState().previewFreeTilePlacement(placement)).toBe(true)
    expect(useWorkspace.getState().commitFreeTilePlacement(placement, 'Place instances')).not.toBeNull()
    const beforeSelection = { x: 1, y: 1, width: 1, height: 1 }
    const afterSelection = { x: 2, y: 1, width: 1, height: 1 }
    useWorkspace.getState().setSelection(beforeSelection)
    useWorkspace.getState().setSelectionPivot({ x: 1.5, y: 1.5 })
    const before = captureFreeTileSourceSnapshot(document, source.id)!
    const after = { ...before, pixels: before.pixels.slice(), offsetX: before.offsetX + 1 }

    expect(useWorkspace.getState().commitFreeTileSourceEdit(
      source.id,
      before,
      after,
      'Transform source selection',
      undefined,
      {
        before: beforeSelection,
        after: afterSelection,
        beforePivot: { x: 1.5, y: 1.5 },
        afterPivot: { x: 2.5, y: 1.5 }
      }
    )).not.toBeNull()
    expect(source.offsetX).toBe(1)
    expect(useWorkspace.getState().sessions[0].selection).toMatchObject(afterSelection)
    expect(useWorkspace.getState().sessions[0].selectionPivot).toEqual({ x: 2.5, y: 1.5 })
    expect(readLayerColorAt(document, target.layer, 2, 1)).toEqual({ r: 220, g: 40, b: 60, a: 255 })
    expect(readLayerColorAt(document, target.layer, 6, 1)).toEqual({ r: 220, g: 40, b: 60, a: 255 })

    useWorkspace.getState().undo()
    expect(source.offsetX).toBe(0)
    expect(useWorkspace.getState().sessions[0].selection).toMatchObject(beforeSelection)
    expect(useWorkspace.getState().sessions[0].selectionPivot).toEqual({ x: 1.5, y: 1.5 })
    expect(readLayerColorAt(document, target.layer, 1, 1)).toEqual({ r: 220, g: 40, b: 60, a: 255 })
    expect(readLayerColorAt(document, target.layer, 5, 1)).toEqual({ r: 220, g: 40, b: 60, a: 255 })

    useWorkspace.getState().redo()
    expect(source.offsetX).toBe(1)
    expect(useWorkspace.getState().sessions[0].selection).toMatchObject(afterSelection)
    expect(useWorkspace.getState().sessions[0].selectionPivot).toEqual({ x: 2.5, y: 1.5 })
  })

  it('keeps repeated Free Tile selection drags on one floating source baseline', async () => {
    const document = createDocument('free tile floating selection', 24, 16, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createFreeTileLayer({ name: 'Floating source' })
    const initialTarget = activeFreeTileCelTarget(document)!
    const sourceLayer = initialTarget.layer.freeTileSources![0]
    const tilesetIndex = document.tilesets!.findIndex((candidate) => candidate.id === sourceLayer.tilesetId)
    const previousTileset = document.tilesets![tilesetIndex]
    const tileset = createBlankTileset(previousTileset.id, previousTileset.name, 8, 8, previousTileset.tileIds[0], 1)
    document.tilesets![tilesetIndex] = tileset
    const pixels = new Uint8ClampedArray(8 * 8 * 4)
    const write = (x: number, y: number, color: [number, number, number, number]): void => pixels.set(color, (y * 8 + x) * 4)
    write(2, 2, [220, 40, 60, 255])
    write(3, 4, [220, 40, 60, 255])
    write(6, 0, [20, 80, 230, 255])
    writeTilesetTilePixels(tileset, tileset.tileIds[0], pixels)
    const placement = useWorkspace.getState().beginFreeTilePlacement()!
    placement.after.instances = [{ id: 'selected', sourceId: sourceLayer.id, x: 8, y: 3 }]
    expect(useWorkspace.getState().previewFreeTilePlacement(placement)).toBe(true)
    expect(useWorkspace.getState().commitFreeTilePlacement(placement, 'Place instance')).not.toBeNull()
    const target = activeFreeTileCelTarget(document)!

    const beforeSelection = { x: 9, y: 4, width: 4, height: 5 }
    const firstTarget = { ...beforeSelection, x: 2, y: 7 }
    useWorkspace.getState().setSelection(beforeSelection)
    useWorkspace.getState().setSelectionPivot({ x: 11, y: 6.5 })
    const sources = freeTileSourceRefs(target.layer.freeTileSources, document.tilesets!)
    const bounds = freeTileInstanceBounds(target.freeTiles.instances[0], sources, target.surface.offsetX, target.surface.offsetY)
    const sourceEdit = createFreeTileSourceEditRaster(document, sources[0], bounds, undefined, target.freeTiles.instances[0])!
    const localSelection = freeTileSelectionToEditRaster(sourceEdit, beforeSelection)!
    const transformSource = captureSelectionTransform(sourceEdit.document, localSelection, sourceEdit.layer)!
    const firstPreview = applySelectionTranslationPreview(
      sourceEdit.document,
      transformSource,
      freeTileTransformTargetToEditRaster(sourceEdit, firstTarget),
      false,
      null,
      sourceEdit.layer
    )
    const firstSnapshot = freeTileSourceSnapshotFromEditRaster(sourceEdit)
    expect(useWorkspace.getState().previewFreeTileSource(sourceLayer.id, firstSnapshot.width, firstSnapshot.height, firstSnapshot.pixels, firstSnapshot.offsetX, firstSnapshot.offsetY)).toBe(true)
    useWorkspace.getState().beginFreeTileFloatingSelectionTransform({
      sourceId: sourceLayer.id,
      instanceId: 'selected',
      edit: sourceEdit,
      selectionSource: beforeSelection,
      source: transformSource,
      previewEdit: null,
      before: beforeSelection,
      target: firstTarget,
      copy: false,
      label: 'Move source selection',
      translationPreview: firstPreview,
      transformTarget: firstTarget
    })

    const pending = useWorkspace.getState().sessions[0].pendingPaste!
    const secondTarget = { ...beforeSelection, x: 14, y: 5 }
    const secondPreview = applySelectionTranslationPreview(
      pending.freeTile!.edit.document,
      pending.source,
      freeTileTransformTargetToEditRaster(pending.freeTile!.edit, secondTarget),
      false,
      pending.translationPreview,
      pending.freeTile!.edit.layer
    )
    const secondSnapshot = freeTileSourceSnapshotFromEditRaster(pending.freeTile!.edit)
    expect(useWorkspace.getState().previewFreeTileSource(sourceLayer.id, secondSnapshot.width, secondSnapshot.height, secondSnapshot.pixels, secondSnapshot.offsetX, secondSnapshot.offsetY)).toBe(true)
    useWorkspace.getState().updateFloatingPastePreview(null, secondTarget, secondPreview, secondTarget, 0)
    useWorkspace.getState().setSelectionPivot({ x: 16, y: 7.5 })

    expect(useWorkspace.getState().sessions[0].pendingPaste?.freeTile?.edit).toBe(sourceEdit)
    expect(readLayerColorAt(document, target.layer, 3, 8).a).toBe(0)
    expect(readLayerColorAt(document, target.layer, 15, 6)).toEqual({ r: 220, g: 40, b: 60, a: 255 })
    expect(readLayerColorAt(document, target.layer, 16, 8)).toEqual({ r: 220, g: 40, b: 60, a: 255 })
    expect(readLayerColorAt(document, target.layer, 14, 3)).toEqual({ r: 20, g: 80, b: 230, a: 255 })

    useWorkspace.getState().commitFloatingPaste()
    expect(useWorkspace.getState().sessions[0].pendingPaste).toBeNull()
    expect(useWorkspace.getState().sessions[0].selection).toMatchObject(secondTarget)
    expect(useWorkspace.getState().sessions[0].selectionPivot).toEqual({ x: 16, y: 7.5 })

    useWorkspace.getState().undo()
    expect(useWorkspace.getState().sessions[0].selection).toMatchObject(beforeSelection)
    expect(readLayerColorAt(document, target.layer, 10, 5)).toEqual({ r: 220, g: 40, b: 60, a: 255 })
    expect(readLayerColorAt(document, target.layer, 11, 7)).toEqual({ r: 220, g: 40, b: 60, a: 255 })
    useWorkspace.getState().redo()
    expect(readLayerColorAt(document, target.layer, 15, 6)).toEqual({ r: 220, g: 40, b: 60, a: 255 })
    expect(readLayerColorAt(document, target.layer, 16, 8)).toEqual({ r: 220, g: 40, b: 60, a: 255 })
  })

  it('assigns a display color to every newly created Free Tile source', async () => {
    const document = createDocument('free tile source colors', 4, 4, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createFreeTileLayer({ name: 'Colored' })
    const layer = document.layers.find((candidate) => candidate.kind === 'free-tile')!
    const firstColor = layer.freeTileSources![0].displayColor

    expect(firstColor).toBeDefined()
    expect(useWorkspace.getState().addFreeTileSource(layer.id)).toBeTruthy()
    const secondColor = layer.freeTileSources![1].displayColor

    expect(secondColor).toBeDefined()
    expect(secondColor).not.toEqual(firstColor)
  })

  it('pastes a copied raster selection into the Free Tile canvas with undoable sources and instances', async () => {
    const document = createDocument('paste selection into free tile', 8, 6, 'rgba')
    const rasterLayer = getActiveLayer(document)
    const red = { r: 220, g: 40, b: 60, a: 255 }
    const blue = { r: 20, g: 80, b: 230, a: 255 }
    writeLayerColor(document, rasterLayer, 2 * document.width + 3, red)
    writeLayerColor(document, rasterLayer, 2 * document.width + 4, blue)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 3, y: 2, width: 2, height: 1 })
    useWorkspace.getState().copySelection()
    await useWorkspace.getState().createFreeTileLayer({ name: 'Pasted Props' })
    const freeTileLayer = document.layers.find((candidate) => candidate.kind === 'free-tile')!

    await useWorkspace.getState().pasteSelection()

    const pastedTarget = activeFreeTileCelTarget(document)!
    const pastedSource = freeTileLayer.freeTileSources!.at(-1)!
    const pastedTileset = document.tilesets!.find((candidate) => candidate.id === pastedSource.tilesetId)!
    const pastedInstance = pastedTarget.freeTiles.instances.at(-1)!
    expect(freeTileLayer.freeTileSources).toHaveLength(2)
    expect(document.tilesets).toHaveLength(2)
    expect(pastedTileset).toMatchObject({ tileWidth: 2, tileHeight: 1 })
    expect(readTilesetTilePixels(pastedTileset, pastedTileset.tileIds[0])).toEqual(new Uint8ClampedArray([
      220, 40, 60, 255,
      20, 80, 230, 255
    ]))
    expect(pastedInstance).toMatchObject({ sourceId: pastedSource.id, x: 3, y: 2 })
    expect(readLayerColorAt(document, freeTileLayer, 3, 2)).toEqual(red)
    expect(readLayerColorAt(document, freeTileLayer, 4, 2)).toEqual(blue)
    expect(useWorkspace.getState().sessions[0]).toMatchObject({
      pendingPaste: null,
      selectedTilesetId: pastedTileset.id,
      selectedFreeTileInstanceId: pastedInstance.id,
      freeTileMode: 'edit'
    })

    useWorkspace.getState().undo()
    expect(freeTileLayer.freeTileSources).toHaveLength(1)
    expect(document.tilesets).toHaveLength(1)
    expect(activeFreeTileCelTarget(document)!.freeTiles.instances).toHaveLength(0)

    useWorkspace.getState().redo()
    expect(freeTileLayer.freeTileSources).toHaveLength(2)
    expect(document.tilesets).toHaveLength(2)
    expect(activeFreeTileCelTarget(document)!.freeTiles.instances).toHaveLength(1)
    expect(readLayerColorAt(document, freeTileLayer, 4, 2)).toEqual(blue)
  })

  it('pastes a copied raster selection into the selected Free Tile instance source', async () => {
    const document = createDocument('paste selection into selected free tile instance', 8, 6, 'rgba')
    const rasterLayer = getActiveLayer(document)
    const red = { r: 220, g: 40, b: 60, a: 255 }
    const blue = { r: 20, g: 80, b: 230, a: 255 }
    writeLayerColor(document, rasterLayer, 2 * document.width + 3, red)
    writeLayerColor(document, rasterLayer, 2 * document.width + 4, blue)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 3, y: 2, width: 2, height: 1 })
    useWorkspace.getState().copySelection()
    await useWorkspace.getState().createFreeTileLayer({ name: 'Shared Props' })
    const freeTileLayer = document.layers.find((candidate) => candidate.kind === 'free-tile')!
    const target = activeFreeTileCelTarget(document)!
    const source = freeTileLayer.freeTileSources![0]
    const tileset = document.tilesets!.find((candidate) => candidate.id === source.tilesetId)!
    const placement = useWorkspace.getState().beginFreeTilePlacement()!
    placement.after.instances = [
      { id: 'selected-instance', sourceId: source.id, x: 3, y: 2 },
      { id: 'shared-instance', sourceId: source.id, x: 0, y: 0 }
    ]
    expect(useWorkspace.getState().previewFreeTilePlacement(placement)).toBe(true)
    expect(useWorkspace.getState().commitFreeTilePlacement(placement, 'Place shared instances')).not.toBeNull()
    useWorkspace.getState().setSelectedFreeTileInstance('selected-instance', 'edit')

    await useWorkspace.getState().pasteSelection()

    expect(freeTileLayer.freeTileSources).toHaveLength(1)
    expect(document.tilesets).toHaveLength(1)
    expect(activeFreeTileCelTarget(document)!.freeTiles.instances).toHaveLength(2)
    expect(tileset).toMatchObject({ tileWidth: 2, tileHeight: 1 })
    expect(readTilesetTilePixels(tileset, tileset.tileIds[0])).toEqual(new Uint8ClampedArray([
      220, 40, 60, 255,
      20, 80, 230, 255
    ]))
    expect(readLayerColorAt(document, freeTileLayer, 3, 2)).toEqual(red)
    expect(readLayerColorAt(document, freeTileLayer, 4, 2)).toEqual(blue)
    expect(readLayerColorAt(document, freeTileLayer, 0, 0)).toEqual(red)
    expect(readLayerColorAt(document, freeTileLayer, 1, 0)).toEqual(blue)
    expect(useWorkspace.getState().sessions[0]).toMatchObject({
      selectedTilesetId: tileset.id,
      selectedFreeTileInstanceId: 'selected-instance',
      freeTileMode: 'edit'
    })

    useWorkspace.getState().undo()
    expect(freeTileLayer.freeTileSources).toHaveLength(1)
    expect(document.tilesets).toHaveLength(1)
    expect(activeFreeTileCelTarget(document)!.freeTiles.instances).toHaveLength(2)
    expect(tileset).toMatchObject({ tileWidth: 1, tileHeight: 1 })
    expect(readLayerColorAt(document, freeTileLayer, 3, 2).a).toBe(0)
    expect(readLayerColorAt(document, freeTileLayer, 0, 0).a).toBe(0)

    useWorkspace.getState().redo()
    expect(tileset).toMatchObject({ tileWidth: 2, tileHeight: 1 })
    expect(readLayerColorAt(document, freeTileLayer, 1, 0)).toEqual(blue)
  })

  it('rejects pasting a raster animation cel into a Free Tile animation cel', async () => {
    const document = createDocument('reject raster cel paste into free tile', 4, 4, 'rgba')
    const rasterLayer = getActiveLayer(document)
    writeLayerColor(document, rasterLayer, 0, { r: 220, g: 40, b: 60, a: 255 })
    useWorkspace.getState().addSession(document)
    const frameId = ensureAnimationDocument(document).activeFrameId
    useWorkspace.getState().selectAnimationCell(animationCelKey(rasterLayer.id, frameId))
    useWorkspace.getState().copySelectedAnimationCels()
    await useWorkspace.getState().createFreeTileLayer({ name: 'Free Tile Target' })
    const freeTileLayer = document.layers.find((candidate) => candidate.kind === 'free-tile')!
    useWorkspace.getState().selectAnimationCell(animationCelKey(freeTileLayer.id, frameId))

    useWorkspace.getState().pasteAnimationCels()

    expect(useWorkspace.getState().message).toBe('来源单元格与目标单元格必须使用相同的图层类型。')
    expect(freeTileLayer.freeTileSources).toHaveLength(1)
    expect(document.tilesets).toHaveLength(1)
    expect(activeFreeTileCelTarget(document)!.freeTiles.instances).toHaveLength(0)
  })

  it('selects and deletes one Free Tile instance without changing its source siblings', async () => {
    const document = createDocument('free tile instances', 8, 8, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createFreeTileLayer({ name: 'Props' })
    const target = activeFreeTileCelTarget(document)!
    const sourceId = target.layer.freeTileSources![0].id
    const placement = useWorkspace.getState().beginFreeTilePlacement()!
    placement.after.instances = [
      { id: 'instance-a', sourceId, x: 1, y: 2 },
      { id: 'instance-b', sourceId, x: 4, y: 5 }
    ]
    expect(useWorkspace.getState().previewFreeTilePlacement(placement)).toBe(true)
    expect(useWorkspace.getState().commitFreeTilePlacement(placement, 'Place instances')).not.toBeNull()

    useWorkspace.getState().setSelectedFreeTileInstance('instance-b')
    expect(useWorkspace.getState().sessions[0].selectedFreeTileInstanceId).toBe('instance-b')
    expect(useWorkspace.getState().deleteFreeTileInstance('instance-b')).toBe(true)
    expect(activeFreeTileCelTarget(document)!.freeTiles.instances.map((instance) => instance.id)).toEqual(['instance-a'])
    expect(useWorkspace.getState().sessions[0].selectedFreeTileInstanceId).toBeNull()

    useWorkspace.getState().undo()
    expect(activeFreeTileCelTarget(document)!.freeTiles.instances.map((instance) => instance.id)).toEqual(['instance-a', 'instance-b'])
    useWorkspace.getState().redo()
    expect(activeFreeTileCelTarget(document)!.freeTiles.instances.map((instance) => instance.id)).toEqual(['instance-a'])
  })

  it('deletes multiple selected Free Tile instances as one undoable operation', async () => {
    const document = createDocument('batch delete free tile instances', 8, 8, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createFreeTileLayer({ name: 'Batch Delete' })
    const target = activeFreeTileCelTarget(document)!
    const sourceId = target.layer.freeTileSources![0].id
    const placement = useWorkspace.getState().beginFreeTilePlacement()!
    placement.after.instances = [
      { id: 'delete-a', sourceId, x: 1, y: 1 },
      { id: 'delete-b', sourceId, x: 3, y: 1 },
      { id: 'delete-c', sourceId, x: 5, y: 1 }
    ]
    expect(useWorkspace.getState().previewFreeTilePlacement(placement)).toBe(true)
    expect(useWorkspace.getState().commitFreeTilePlacement(placement, 'Place instances')).not.toBeNull()

    const order = ['delete-c', 'delete-b', 'delete-a']
    useWorkspace.getState().selectFreeTileInstanceRow('delete-a', 'replace', order)
    useWorkspace.getState().selectFreeTileInstanceRow('delete-b', 'toggle', order)
    const selectedIds = useWorkspace.getState().sessions[0].selectedFreeTileInstanceIds
    expect(useWorkspace.getState().deleteFreeTileInstances(selectedIds)).toBe(true)
    expect(activeFreeTileCelTarget(document)!.freeTiles.instances.map((instance) => instance.id)).toEqual(['delete-c'])
    expect(useWorkspace.getState().sessions[0].selectedFreeTileInstanceIds).toEqual([])

    useWorkspace.getState().undo()
    expect(activeFreeTileCelTarget(document)!.freeTiles.instances.map((instance) => instance.id)).toEqual(['delete-a', 'delete-b', 'delete-c'])
    useWorkspace.getState().redo()
    expect(activeFreeTileCelTarget(document)!.freeTiles.instances.map((instance) => instance.id)).toEqual(['delete-c'])
  })

  it('edits instance coordinates and reorders instances as one undoable operation', async () => {
    const document = createDocument('free tile instance commands', 8, 8, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createFreeTileLayer({ name: 'Props' })
    const target = activeFreeTileCelTarget(document)!
    const sourceId = target.layer.freeTileSources![0].id
    const placement = useWorkspace.getState().beginFreeTilePlacement()!
    placement.after.instances = [
      { id: 'instance-a', sourceId, x: 1, y: 2 },
      { id: 'instance-b', sourceId, x: 4, y: 5 },
      { id: 'instance-c', sourceId, x: 0, y: 0 }
    ]
    expect(useWorkspace.getState().previewFreeTilePlacement(placement)).toBe(true)
    expect(useWorkspace.getState().commitFreeTilePlacement(placement, 'Place instances')).not.toBeNull()

    expect(useWorkspace.getState().setFreeTileInstanceProperties('instance-a', { x: 6, y: 7 })).toBe(true)
    expect(activeFreeTileCelTarget(document)!.freeTiles.instances.find((instance) => instance.id === 'instance-a')).toMatchObject({ x: 6, y: 7 })
    useWorkspace.getState().undo()
    expect(activeFreeTileCelTarget(document)!.freeTiles.instances.find((instance) => instance.id === 'instance-a')).toMatchObject({ x: 1, y: 2 })
    useWorkspace.getState().redo()

    expect(useWorkspace.getState().reorderFreeTileInstance('instance-a', 'instance-b', 'before')).toBe(true)
    expect(activeFreeTileCelTarget(document)!.freeTiles.instances.map((instance) => instance.id)).toEqual(['instance-b', 'instance-a', 'instance-c'])
    useWorkspace.getState().undo()
    expect(activeFreeTileCelTarget(document)!.freeTiles.instances.map((instance) => instance.id)).toEqual(['instance-a', 'instance-b', 'instance-c'])
    useWorkspace.getState().redo()
    expect(activeFreeTileCelTarget(document)!.freeTiles.instances.map((instance) => instance.id)).toEqual(['instance-b', 'instance-a', 'instance-c'])
  })

  it('keeps the displayed instance position stable while rotating and mirroring', async () => {
    const document = createDocument('free tile instance transform', 8, 8, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createFreeTileLayer({ name: 'Transforms' })
    const target = activeFreeTileCelTarget(document)!
    const source = target.layer.freeTileSources![0]
    const tileset = document.tilesets!.find((candidate) => candidate.id === source.tilesetId)!
    tileset.tileWidth = 2
    tileset.tileHeight = 1
    tileset.pixels = new Uint8ClampedArray([220, 40, 60, 255, 20, 80, 230, 255])
    const placement = useWorkspace.getState().beginFreeTilePlacement()!
    placement.after.instances = [{ id: 'instance-transform', sourceId: source.id, x: 2, y: 3 }]
    expect(useWorkspace.getState().previewFreeTilePlacement(placement)).toBe(true)
    expect(useWorkspace.getState().commitFreeTilePlacement(placement, 'Place instance')).not.toBeNull()

    const before = freeTileInstanceBounds(activeFreeTileCelTarget(document)!.freeTiles.instances[0], activeFreeTileCelTarget(document)!.sources)
    expect(useWorkspace.getState().setFreeTileInstanceProperties('instance-transform', { rotation: 1, flipHorizontal: true })).toBe(true)
    const transformedTarget = activeFreeTileCelTarget(document)!
    const transformed = transformedTarget.freeTiles.instances[0]
    expect(freeTileInstanceBounds(transformed, transformedTarget.sources)).toEqual({ x: before.x, y: before.y, width: 1, height: 2 })
    expect(transformed).toMatchObject({ rotation: 1, flipHorizontal: true })

    useWorkspace.getState().undo()
    const restoredTarget = activeFreeTileCelTarget(document)!
    expect(restoredTarget.freeTiles.instances[0]).not.toHaveProperty('rotation')
    expect(freeTileInstanceBounds(restoredTarget.freeTiles.instances[0], restoredTarget.sources)).toEqual(before)
    useWorkspace.getState().redo()
    expect(activeFreeTileCelTarget(document)!.freeTiles.instances[0]).toMatchObject({ rotation: 1, flipHorizontal: true })
  })

  it('keeps instance visibility undoable and protects locked instances from edits', async () => {
    const document = createDocument('free tile instance state', 8, 8, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createFreeTileLayer({ name: 'Props' })
    const target = activeFreeTileCelTarget(document)!
    const sourceId = target.layer.freeTileSources![0].id
    const placement = useWorkspace.getState().beginFreeTilePlacement()!
    placement.after.instances = [{ id: 'instance-a', sourceId, x: 1, y: 2 }, { id: 'instance-b', sourceId, x: 4, y: 5 }]
    expect(useWorkspace.getState().previewFreeTilePlacement(placement)).toBe(true)
    expect(useWorkspace.getState().commitFreeTilePlacement(placement, 'Place instances')).not.toBeNull()

    expect(useWorkspace.getState().setFreeTileInstanceProperties('instance-a', { locked: true })).toBe(true)
    expect(useWorkspace.getState().setFreeTileInstanceProperties('instance-a', { x: 6, y: 7 })).toBe(false)
    expect(useWorkspace.getState().deleteFreeTileInstance('instance-a')).toBe(false)
    expect(useWorkspace.getState().reorderFreeTileInstance('instance-a', 'instance-b', 'before')).toBe(false)
    expect(activeFreeTileCelTarget(document)!.freeTiles.instances.find((instance) => instance.id === 'instance-a')).toMatchObject({ x: 1, y: 2, locked: true })

    expect(useWorkspace.getState().setFreeTileInstanceProperties('instance-a', { visible: false })).toBe(true)
    expect(activeFreeTileCelTarget(document)!.freeTiles.instances.find((instance) => instance.id === 'instance-a')).toMatchObject({ visible: false, locked: true })
    useWorkspace.getState().undo()
    const restored = activeFreeTileCelTarget(document)!.freeTiles.instances.find((instance) => instance.id === 'instance-a')!
    expect(restored.visible).not.toBe(false)
    expect(restored.locked).toBe(true)
    useWorkspace.getState().redo()
    expect(activeFreeTileCelTarget(document)!.freeTiles.instances.find((instance) => instance.id === 'instance-a')).toMatchObject({ visible: false, locked: true })
  })

  it('shows only one Free Tile instance as a single undoable visibility change', async () => {
    const document = createDocument('show only free tile instance', 8, 8, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createFreeTileLayer({ name: 'Props' })
    const target = activeFreeTileCelTarget(document)!
    const sourceId = target.layer.freeTileSources![0].id
    const placement = useWorkspace.getState().beginFreeTilePlacement()!
    placement.after.instances = [
      { id: 'instance-a', sourceId, x: 0, y: 0, visible: false },
      { id: 'instance-b', sourceId, x: 2, y: 0, visible: true },
      { id: 'instance-c', sourceId, x: 4, y: 0, visible: true }
    ]
    expect(useWorkspace.getState().previewFreeTilePlacement(placement)).toBe(true)
    expect(useWorkspace.getState().commitFreeTilePlacement(placement, 'Place instances')).not.toBeNull()

    expect(useWorkspace.getState().showOnlyFreeTileInstance('instance-a')).toBe(true)
    expect(activeFreeTileCelTarget(document)!.freeTiles.instances.map(({ id, visible }) => ({ id, visible }))).toEqual([
      { id: 'instance-a', visible: true },
      { id: 'instance-b', visible: false },
      { id: 'instance-c', visible: false }
    ])
    expect(useWorkspace.getState().sessions[0].selectedFreeTileInstanceId).toBe('instance-a')

    useWorkspace.getState().undo()
    expect(activeFreeTileCelTarget(document)!.freeTiles.instances.map(({ id, visible }) => ({ id, visible }))).toEqual([
      { id: 'instance-a', visible: false },
      { id: 'instance-b', visible: true },
      { id: 'instance-c', visible: true }
    ])
    useWorkspace.getState().redo()
    expect(activeFreeTileCelTarget(document)!.freeTiles.instances.map(({ id, visible }) => ({ id, visible }))).toEqual([
      { id: 'instance-a', visible: true },
      { id: 'instance-b', visible: false },
      { id: 'instance-c', visible: false }
    ])
  })

  it('selects a Free Tile instance and its source in one session update', async () => {
    const document = createDocument('free tile atomic selection', 8, 8, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createFreeTileLayer({ name: 'Props' })
    const layer = document.layers.find((candidate) => candidate.kind === 'free-tile')!
    const sourceA = layer.freeTileSources![0]
    expect(useWorkspace.getState().addFreeTileSource(layer.id)).toBeTruthy()
    const sourceB = layer.freeTileSources![1]
    const placement = useWorkspace.getState().beginFreeTilePlacement()!
    placement.after.instances = [{ id: 'instance-b', sourceId: sourceB.id, x: 2, y: 3 }]
    expect(useWorkspace.getState().previewFreeTilePlacement(placement)).toBe(true)
    expect(useWorkspace.getState().commitFreeTilePlacement(placement, 'Place source B')).not.toBeNull()

    useWorkspace.getState().setSelectedTile(sourceA.tilesetId, document.tilesets!.find((tileset) => tileset.id === sourceA.tilesetId)!.tileIds[0])
    useWorkspace.getState().setSelectedFreeTileInstance('instance-b', 'edit')
    const session = useWorkspace.getState().sessions[0]
    expect(session.selectedFreeTileInstanceId).toBe('instance-b')
    expect(session.selectedTilesetId).toBe(sourceB.tilesetId)
    expect(session.freeTileMode).toBe('edit')
  })

  it('allows pixel tools while editing a Free Tile source but keeps placement mode restricted', async () => {
    const document = createDocument('free tile tool availability', 4, 4, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createFreeTileLayer({ name: 'Props' })
    const session = useWorkspace.getState().sessions[0]

    useWorkspace.getState().setFreeTileMode('edit')
    expect(isToolAvailableForSession(session, 'fill')).toBe(true)
    expect(isToolAvailableForSession(session, 'shape')).toBe(true)
    expect(isToolAvailableForSession(session, 'line')).toBe(true)
    expect(isToolAvailableForSession(session, 'airbrush')).toBe(true)

    useWorkspace.getState().setFreeTileMode('paint')
    expect(isToolAvailableForSession(session, 'fill')).toBe(false)
    expect(isToolAvailableForSession(session, 'selection')).toBe(true)
  })

  it('removes the owned source and hides the panel when rasterizing the final Free Tile layer', async () => {
    const document = createDocument('rasterize free tiles', 4, 2, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createFreeTileLayer({ name: 'Props' })
    const layer = document.layers.find((candidate) => candidate.kind === 'free-tile')!
    const sourceId = layer.freeTileSources![0].id
    const tilesetId = layer.freeTileSources![0].tilesetId
    const hidePanel = vi.fn()
    window.addEventListener('moonsprite:hide-workspace-panel', hidePanel)

    useWorkspace.getState().rasterizeLayer(layer.id)

    window.removeEventListener('moonsprite:hide-workspace-panel', hidePanel)
    expect(layer.kind).toBeUndefined()
    expect(document.tilesets?.some((tileset) => tileset.id === tilesetId)).toBe(false)
    expect(hidePanel).toHaveBeenCalledTimes(1)
    expect((hidePanel.mock.calls[0][0] as CustomEvent).detail).toEqual({ id: 'tileset' })

    useWorkspace.getState().undo()
    expect(layer).toMatchObject({ kind: 'free-tile', freeTileSources: [{ id: sourceId, tilesetId }] })
    expect(document.tilesets?.some((tileset) => tileset.id === tilesetId)).toBe(true)

    useWorkspace.getState().redo()
    expect(layer.kind).toBeUndefined()
    expect(document.tilesets?.some((tileset) => tileset.id === tilesetId)).toBe(false)
  })

  it('removes the owned source before capturing a Free Tile layer merge', async () => {
    const document = createDocument('merge free tiles', 4, 2, 'rgba')
    const rasterLayerId = document.activeLayerId
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createFreeTileLayer({ name: 'Props' })
    const freeTileLayer = document.layers.find((candidate) => candidate.kind === 'free-tile')!
    const tilesetId = freeTileLayer.freeTileSources![0].tilesetId
    useWorkspace.getState().selectLayer(rasterLayerId)
    useWorkspace.getState().selectLayer(freeTileLayer.id, true)
    const hidePanel = vi.fn()
    window.addEventListener('moonsprite:hide-workspace-panel', hidePanel)

    useWorkspace.getState().mergeSelectedLayers()

    window.removeEventListener('moonsprite:hide-workspace-panel', hidePanel)
    expect(document.layers).toHaveLength(1)
    expect(document.layers[0].kind).toBeUndefined()
    expect(document.tilesets?.some((tileset) => tileset.id === tilesetId)).toBe(false)
    expect(hidePanel).toHaveBeenCalledTimes(1)
    expect((hidePanel.mock.calls[0][0] as CustomEvent).detail).toEqual({ id: 'tileset' })

    useWorkspace.getState().undo()
    expect(document.layers.some((layer) => layer.id === freeTileLayer.id && layer.kind === 'free-tile')).toBe(true)
    expect(document.tilesets?.some((tileset) => tileset.id === tilesetId)).toBe(true)

    useWorkspace.getState().redo()
    expect(document.layers).toHaveLength(1)
    expect(document.tilesets?.some((tileset) => tileset.id === tilesetId)).toBe(false)
  })
})

describe('workspace Tilemap layers', () => {
  it('requests the Tileset panel to stay hidden for a newly created document', async () => {
    const hidePanel = vi.fn()
    window.addEventListener('moonsprite:hide-workspace-panel', hidePanel)

    await useWorkspace.getState().newDocument('New Canvas', 4, 2, 'rgba')

    window.removeEventListener('moonsprite:hide-workspace-panel', hidePanel)
    expect(useWorkspace.getState().sessions).toHaveLength(1)
    expect(hidePanel.mock.calls.filter(([event]) => (event as CustomEvent).detail?.id === 'tileset')).toHaveLength(1)
  })

  it('shows the Tileset panel only for the active document that contains a Tilemap layer', async () => {
    const plainDocument = createDocument('plain document', 4, 2, 'rgba')
    const tileDocument = createDocument('tile document', 4, 2, 'rgba')
    useWorkspace.getState().addSession(plainDocument)
    useWorkspace.getState().addSession(tileDocument)
    await useWorkspace.getState().createTilemapLayer({ name: 'Terrain', tileWidth: 2, tileHeight: 1 })
    const showPanel = vi.fn()
    const hidePanel = vi.fn()
    window.addEventListener('moonsprite:show-workspace-panel', showPanel)
    window.addEventListener('moonsprite:hide-workspace-panel', hidePanel)

    useWorkspace.getState().setActive(plainDocument.id)
    expect(hidePanel.mock.calls.filter(([event]) => (event as CustomEvent).detail?.id === 'tileset')).toHaveLength(1)

    useWorkspace.getState().setActive(tileDocument.id)
    expect(showPanel).toHaveBeenCalledTimes(1)
    expect((showPanel.mock.calls[0][0] as CustomEvent).detail).toEqual({ id: 'tileset' })

    window.removeEventListener('moonsprite:show-workspace-panel', showPanel)
    window.removeEventListener('moonsprite:hide-workspace-panel', hidePanel)
  })

  it('creates an empty Tilemap with one transparent tile and restores the structure through history', async () => {
    const document = createDocument('empty tiles', 4, 2, 'rgba')
    const firstFrameId = ensureAnimationDocument(document).activeFrameId
    addBlankAnimationFrame(document)
    activateAnimationFrame(document, firstFrameId)
    useWorkspace.getState().addSession(document)

    await useWorkspace.getState().createTilemapLayer({ name: 'Terrain', tileWidth: 2, tileHeight: 1 })

    const tileLayer = document.layers.find((layer) => layer.kind === 'tilemap')
    expect(tileLayer).toBeDefined()
    expect(tileLayer!.name).toBe('Terrain')
    expect(document.tilesets).toHaveLength(1)
    expect(tileLayer!.tilemapTilesetId).toBe(document.tilesets![0].id)
    expect(document.tilesets![0].name).toBe('Terrain')
    expect(document.tilesets![0].tileIds).toHaveLength(1)
    expect(Array.from(readTilesetTilePixels(document.tilesets![0], document.tilesets![0].tileIds[0])!)).toEqual(new Array(8).fill(0))
    const timeline = ensureAnimationDocument(document)
    const tileCels = timeline.cels.filter((cel) => cel.layerId === tileLayer!.id)
    expect(tileCels).toHaveLength(2)
    expect(tileCels.every((cel) => cel.tilemap?.cells.length === 4 && cel.surface)).toBe(true)
    expect(tileCels.every((cel) => cel.tilemap?.cells.every((cell) => cell === null))).toBe(true)
    expect(readLayerColorAt(document, tileLayer!, 0, 0).a).toBe(0)
    expect(useWorkspace.getState().sessions[0].tilemapMode).toBe('hybrid')

    const hidePanel = vi.fn()
    const showPanel = vi.fn()
    window.addEventListener('moonsprite:hide-workspace-panel', hidePanel)
    window.addEventListener('moonsprite:show-workspace-panel', showPanel)

    useWorkspace.getState().undo()
    expect(document.layers.some((layer) => layer.kind === 'tilemap')).toBe(false)
    expect(document.tilesets).toEqual([])
    expect(hidePanel).toHaveBeenCalledTimes(1)
    expect((hidePanel.mock.calls[0][0] as CustomEvent).detail).toEqual({ id: 'tileset' })

    useWorkspace.getState().redo()
    const restoredLayer = document.layers.find((layer) => layer.kind === 'tilemap')
    const restoredSession = useWorkspace.getState().sessions[0]
    expect(restoredLayer).toBeDefined()
    expect(document.tilesets).toHaveLength(1)
    expect(restoredSession.selectedLayerIds).toEqual([restoredLayer!.id])
    expect(restoredSession.selectedTilesetId).toBe(document.tilesets![0].id)
    expect(restoredSession.selectedTileId).toBe(document.tilesets![0].tileIds[0])
    expect(restoredSession.tilemapMode).toBe('hybrid')
    expect(showPanel).toHaveBeenCalledTimes(1)
    expect((showPanel.mock.calls[0][0] as CustomEvent).detail).toEqual({ id: 'tileset' })

    window.removeEventListener('moonsprite:hide-workspace-panel', hidePanel)
    window.removeEventListener('moonsprite:show-workspace-panel', showPanel)
  })

  it('converts every frame of a background layer into cropped Tilemap cells and restores it through history', async () => {
    const document = createDocument('convert tiles', 3, 2, 'rgba')
    const layer = getActiveLayer(document)
    layer.name = 'Source Layer'
    layer.background = { mode: 'canvas' }
    const firstFrameId = ensureAnimationDocument(document).activeFrameId
    const red = { r: 220, g: 30, b: 40, a: 255 }
    const green = { r: 30, g: 190, b: 70, a: 255 }
    writeLayerColor(document, layer, 0, red)
    const secondFrameId = addBlankAnimationFrame(document)
    writeLayerColor(document, getActiveLayer(document), 0, green)
    activateAnimationFrame(document, firstFrameId)
    useWorkspace.getState().addSession(document)
    const showPanel = vi.fn()
    const hidePanel = vi.fn()
    window.addEventListener('moonsprite:show-workspace-panel', showPanel)
    window.addEventListener('moonsprite:hide-workspace-panel', hidePanel)

    await useWorkspace.getState().convertLayerToTilemap(layer.id, { name: 'Converted Tiles', tileWidth: 2, tileHeight: 2 })

    expect(layer).toMatchObject({ name: 'Converted Tiles', kind: 'tilemap' })
    expect(layer.background).toBeUndefined()
    expect(document.tilesets).toHaveLength(1)
    expect(document.tilesets![0].tileIds).toHaveLength(3)
    const convertedCels = ensureAnimationDocument(document).cels.filter((cel) => cel.layerId === layer.id)
    expect(convertedCels).toHaveLength(2)
    expect(convertedCels.every((cel) => cel.tilemap?.columns === 2 && cel.tilemap.rows === 1 && cel.surface?.width === 4)).toBe(true)
    expect(convertedCels.every((cel) => cel.tilemap?.cells[1] === null)).toBe(true)
    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(red)
    activateAnimationFrame(document, secondFrameId)
    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(green)
    expect(useWorkspace.getState().sessions[0]).toMatchObject({ selectedTilesetId: document.tilesets![0].id, tilemapMode: 'hybrid' })
    expect(showPanel).toHaveBeenCalledTimes(1)

    useWorkspace.getState().undo()
    expect(layer.name).toBe('Source Layer')
    expect(layer.kind).toBeUndefined()
    expect(layer.background).toEqual({ mode: 'canvas' })
    expect(document.tilesets).toEqual([])
    expect(ensureAnimationDocument(document).cels.filter((cel) => cel.layerId === layer.id).every((cel) => cel.tilemap === undefined)).toBe(true)
    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(green)
    activateAnimationFrame(document, firstFrameId)
    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(red)
    expect(hidePanel).toHaveBeenCalledTimes(1)

    useWorkspace.getState().redo()
    expect(layer).toMatchObject({ name: 'Converted Tiles', kind: 'tilemap' })
    expect(layer.background).toBeUndefined()
    expect(document.tilesets).toHaveLength(1)
    expect(showPanel).toHaveBeenCalledTimes(2)

    window.removeEventListener('moonsprite:show-workspace-panel', showPanel)
    window.removeEventListener('moonsprite:hide-workspace-panel', hidePanel)
  })

  it('converts a background layer to a normal layer in one reversible command', () => {
    const document = createDocument('normal conversion', 2, 1, 'rgba')
    const layer = getActiveLayer(document)
    layer.background = { mode: 'canvas' }
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().rasterizeLayer(layer.id)
    expect(layer.background).toBeUndefined()

    useWorkspace.getState().undo()
    expect(layer.background).toEqual({ mode: 'canvas' })

    useWorkspace.getState().redo()
    expect(layer.background).toBeUndefined()
  })

  it('creates the first real tile when original editing starts from the transparent placeholder', async () => {
    const document = createDocument('first original tile', 2, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createTilemapLayer({ name: 'First Tile', tileWidth: 1, tileHeight: 1 })
    useWorkspace.getState().setTilemapMode('edit')
    const target = activeTilemapCelTarget(document)!
    const tileset = document.tilesets![0]
    const placeholderTileId = tileset.tileIds[0]
    const firstColor = { r: 220, g: 40, b: 60, a: 255 }
    const secondColor = { r: 30, g: 80, b: 220, a: 255 }
    const edit = beginPixelEdit(target.layer.id)
    expect(recordPixel(document, target.layer, edit, 0, packColor(firstColor))).toBe(true)
    expect(recordPixel(document, target.layer, edit, 1, packColor(secondColor))).toBe(true)

    expect(useWorkspace.getState().commitPixelEdit(edit, 'Create first original tile')).not.toBeNull()

    expect(tileset.tileIds).toHaveLength(3)
    expect(target.tilemap.cells[0]?.tileId).not.toBe(placeholderTileId)
    expect(target.tilemap.cells[1]?.tileId).not.toBe(placeholderTileId)
    expect(target.tilemap.cells[1]?.tileId).not.toBe(target.tilemap.cells[0]?.tileId)
    expect(Array.from(readTilesetTilePixels(tileset, placeholderTileId)!)).toEqual([0, 0, 0, 0])
    expect(readLayerColorAt(document, target.layer, 0, 0)).toEqual(firstColor)
    expect(readLayerColorAt(document, target.layer, 1, 0)).toEqual(secondColor)

    useWorkspace.getState().undo()
    expect(document.tilesets![0].tileIds).toEqual([placeholderTileId])
    expect(activeTilemapCelTarget(document)!.tilemap.cells[0]).toBeNull()
    expect(activeTilemapCelTarget(document)!.tilemap.cells[1]).toBeNull()
  })

  it('requests the Tileset panel to hide only after deleting the final Tilemap layer', async () => {
    const document = createDocument('delete tiles', 4, 2, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createTilemapLayer({ name: 'First Tiles', tileWidth: 2, tileHeight: 1 })
    const firstTilemapId = document.activeLayerId
    await useWorkspace.getState().createTilemapLayer({ name: 'Second Tiles', tileWidth: 2, tileHeight: 1 })
    const hidePanel = vi.fn()
    window.addEventListener('moonsprite:hide-workspace-panel', hidePanel)

    useWorkspace.getState().deleteSelectedLayers()
    expect(document.layers.some((layer) => layer.kind === 'tilemap')).toBe(true)
    expect(hidePanel).not.toHaveBeenCalled()

    useWorkspace.getState().selectLayer(firstTilemapId)
    useWorkspace.getState().deleteSelectedLayers()

    window.removeEventListener('moonsprite:hide-workspace-panel', hidePanel)
    expect(document.layers.some((layer) => layer.kind === 'tilemap')).toBe(false)
    expect(hidePanel).toHaveBeenCalledTimes(1)
    expect((hidePanel.mock.calls[0][0] as CustomEvent).detail).toEqual({ id: 'tileset' })
  })

  it('extends every Tilemap cel into newly exposed canvas areas and restores the grid through history', async () => {
    const document = createDocument('resize tiles', 4, 2, 'rgba')
    const firstFrameId = ensureAnimationDocument(document).activeFrameId
    addBlankAnimationFrame(document)
    activateAnimationFrame(document, firstFrameId)
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createTilemapLayer({ name: 'Resizable Tiles', tileWidth: 2, tileHeight: 1 })

    await useWorkspace.getState().resizeActiveCanvas(8, 2, 'w')
    let tileLayer = document.layers.find((layer) => layer.kind === 'tilemap')!
    let tileCels = ensureAnimationDocument(document).cels.filter((cel) => cel.layerId === tileLayer.id)
    expect(tileCels.every((cel) => cel.tilemap?.columns === 4 && cel.tilemap.rows === 2)).toBe(true)
    expect(tileCels.every((cel) => cel.surface?.width === 8 && cel.surface.height === 2)).toBe(true)

    useWorkspace.getState().undo()
    tileLayer = document.layers.find((layer) => layer.kind === 'tilemap')!
    tileCels = ensureAnimationDocument(document).cels.filter((cel) => cel.layerId === tileLayer.id)
    expect(tileCels.every((cel) => cel.tilemap?.columns === 2 && cel.surface?.width === 4)).toBe(true)

    useWorkspace.getState().redo()
    const target = activeTilemapCelTarget(document)!
    const newCellIndex = tilemapCellIndexAtPoint(target.tilemap, target.surface.offsetX, target.surface.offsetY, 7, 0)
    expect(newCellIndex).toBe(3)
    const tileId = document.tilesets![0].tileIds[0]
    const edit = beginTilemapEdit(target.layer.id, target.cel.frameId)
    expect(writeTilemapCell(document, target, edit, newCellIndex!, { tilesetId: document.tilesets![0].id, tileId })).toBe(true)
    expect(target.tilemap.cells[3]).toMatchObject({ tileId })
  })

  it('converts normal pixel-tool edits into created and modified tiles', async () => {
    const document = createDocument('tool edits', 2, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createTilemapLayer({ name: 'Tool Edits', tileWidth: 1, tileHeight: 1 })
    const session = useWorkspace.getState().sessions[0]
    const target = activeTilemapCelTarget(document)!
    const tileset = document.tilesets![0]
    const red = { r: 220, g: 30, b: 40, a: 255 }

    expect(isToolAvailableForSession(session, 'fill')).toBe(true)
    expect(isToolAvailableForSession(session, 'shape')).toBe(true)
    const createEdit = beginPixelEdit(target.layer.id)
    expect(recordPixel(document, target.layer, createEdit, 0, packColor(red))).toBe(true)
    expect(useWorkspace.getState().commitPixelEdit(createEdit, 'Create with fill')).not.toBeNull()
    const createdTileId = target.tilemap.cells[0]?.tileId
    expect(createdTileId).toBeTruthy()
    expect(tileset.tileIds).toContain(createdTileId)
    expect(readLayerColorAt(document, target.layer, 0, 0)).toEqual(red)

    const paint = beginTilemapEdit(target.layer.id, target.cel.frameId)
    writeTilemapCell(document, target, paint, 1, { tilesetId: tileset.id, tileId: createdTileId! })
    useWorkspace.getState().commitTilemapEdit(paint, 'Reuse created tile')
    useWorkspace.getState().setTilemapMode('edit')
    const blue = { r: 20, g: 50, b: 230, a: 255 }
    const modifyEdit = beginPixelEdit(target.layer.id)
    expect(recordPixel(document, target.layer, modifyEdit, 0, packColor(blue))).toBe(true)
    expect(useWorkspace.getState().commitPixelEdit(modifyEdit, 'Modify with shape')).not.toBeNull()
    expect(readLayerColorAt(document, target.layer, 0, 0)).toEqual(blue)
    expect(readLayerColorAt(document, target.layer, 1, 0)).toEqual(blue)

    useWorkspace.getState().setTilemapMode('paint')
    expect(isToolAvailableForSession(session, 'fill')).toBe(false)
    expect(isToolAvailableForSession(session, 'selection')).toBe(true)
  })

  it('updates an occupied tile in hybrid mode without adding a variant', async () => {
    const document = createDocument('hybrid edits occupied tile', 2, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createTilemapLayer({ name: 'Occupied Create', tileWidth: 1, tileHeight: 1 })
    const target = activeTilemapCelTarget(document)!
    const tileset = document.tilesets![0]
    const tileId = tileset.tileIds[0]
    const red = new Uint8ClampedArray([220, 20, 30, 255])
    useWorkspace.getState().previewTilesetTilePixels(tileset.id, tileId, red)
    useWorkspace.getState().commitTilesetTileEdit(tileset.id, tileId, new Uint8ClampedArray(4), red)
    const paint = beginTilemapEdit(target.layer.id, target.cel.frameId)
    writeTilemapCell(document, target, paint, 0, { tilesetId: tileset.id, tileId })
    writeTilemapCell(document, target, paint, 1, { tilesetId: tileset.id, tileId })
    useWorkspace.getState().commitTilemapEdit(paint, 'Paint occupied tiles')
    useWorkspace.getState().setTilemapMode('hybrid')

    const beforeTileCount = tileset.tileIds.length
    const blue = { r: 20, g: 50, b: 230, a: 255 }
    const edit = beginPixelEdit(target.layer.id)
    expect(recordPixel(document, target.layer, edit, 0, packColor(blue))).toBe(true)
    expect(useWorkspace.getState().commitPixelEdit(edit, 'Edit occupied tile')).not.toBeNull()

    expect(document.tilesets![0].tileIds).toHaveLength(beforeTileCount)
    expect(target.tilemap.cells.map((cell) => cell?.tileId)).toEqual([tileId, tileId])
    expect(readLayerColorAt(document, target.layer, 0, 0)).toEqual(blue)
    expect(readLayerColorAt(document, target.layer, 1, 0)).toEqual(blue)

    useWorkspace.getState().undo()
    expect(readLayerColorAt(document, target.layer, 0, 0)).toEqual({ r: 220, g: 20, b: 30, a: 255 })
    expect(readLayerColorAt(document, target.layer, 1, 0)).toEqual({ r: 220, g: 20, b: 30, a: 255 })
  })

  it('keeps create mode variant generation for occupied tiles', async () => {
    const document = createDocument('create keeps variants', 2, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createTilemapLayer({ name: 'Create Variants', tileWidth: 1, tileHeight: 1 })
    useWorkspace.getState().setTilemapMode('create')
    const target = activeTilemapCelTarget(document)!
    const tileset = document.tilesets![0]
    const sourceTileId = tileset.tileIds[0]
    const red = new Uint8ClampedArray([220, 20, 30, 255])
    useWorkspace.getState().previewTilesetTilePixels(tileset.id, sourceTileId, red)
    useWorkspace.getState().commitTilesetTileEdit(tileset.id, sourceTileId, new Uint8ClampedArray(4), red)
    const paint = beginTilemapEdit(target.layer.id, target.cel.frameId)
    writeTilemapCell(document, target, paint, 0, { tilesetId: tileset.id, tileId: sourceTileId })
    writeTilemapCell(document, target, paint, 1, { tilesetId: tileset.id, tileId: sourceTileId })
    useWorkspace.getState().commitTilemapEdit(paint, 'Paint create variants')

    const blue = { r: 20, g: 50, b: 230, a: 255 }
    const edit = beginPixelEdit(target.layer.id)
    expect(recordPixel(document, target.layer, edit, 0, packColor(blue))).toBe(true)
    expect(useWorkspace.getState().commitPixelEdit(edit, 'Create tile variant')).not.toBeNull()

    expect(document.tilesets![0].tileIds).toHaveLength(2)
    expect(target.tilemap.cells[0]?.tileId).not.toBe(sourceTileId)
    expect(target.tilemap.cells[1]?.tileId).toBe(sourceTileId)
    expect(readLayerColorAt(document, target.layer, 0, 0)).toEqual(blue)
    expect(readLayerColorAt(document, target.layer, 1, 0)).toEqual({ r: 220, g: 20, b: 30, a: 255 })
  })

  it('keeps foreground and background tile roles independent and restores their deletion fallback', async () => {
    const document = createDocument('tile roles', 2, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createTilemapLayer({ name: 'Tile Roles', tileWidth: 1, tileHeight: 1 })
    const tileset = document.tilesets![0]
    const foregroundTileId = tileset.tileIds[0]
    const backgroundTileId = useWorkspace.getState().addTilesetTile(tileset.id)!

    useWorkspace.getState().setSelectedTile(tileset.id, foregroundTileId, 'primary')
    useWorkspace.getState().setSelectedTile(tileset.id, backgroundTileId, 'secondary')
    const session = useWorkspace.getState().sessions[0]
    expect(session.selectedTileId).toBe(foregroundTileId)
    expect(session.secondaryTileId).toBe(backgroundTileId)

    expect(useWorkspace.getState().deleteTilesetTile(tileset.id, backgroundTileId)).toBe(true)
    expect(session.selectedTileId).toBe(foregroundTileId)
    expect(session.secondaryTileId).toBe(foregroundTileId)

    useWorkspace.getState().undo()
    expect(session.selectedTileId).toBe(foregroundTileId)
    expect(session.secondaryTileId).toBe(backgroundTileId)
    useWorkspace.getState().redo()
    expect(session.secondaryTileId).toBe(foregroundTileId)
  })

  it('deletes multiple referenced tiles in one undoable operation', async () => {
    const document = createDocument('batch tile delete', 3, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createTilemapLayer({ name: 'Batch Delete', tileWidth: 1, tileHeight: 1 })
    const tileset = document.tilesets![0]
    const retainedTileId = tileset.tileIds[0]
    const firstDeletedTileId = useWorkspace.getState().addTilesetTile(tileset.id)!
    const secondDeletedTileId = useWorkspace.getState().addTilesetTile(tileset.id)!
    const target = activeTilemapCelTarget(document)!
    const paint = beginTilemapEdit(target.layer.id, target.cel.frameId)
    writeTilemapCell(document, target, paint, 0, { tilesetId: tileset.id, tileId: firstDeletedTileId })
    writeTilemapCell(document, target, paint, 1, { tilesetId: tileset.id, tileId: secondDeletedTileId })
    useWorkspace.getState().commitTilemapEdit(paint, 'Paint deleted tiles')

    expect(useWorkspace.getState().deleteTilesetTiles(tileset.id, [firstDeletedTileId, secondDeletedTileId])).toBe(true)
    expect(document.tilesets![0].tileIds).toEqual([retainedTileId])
    expect(target.tilemap.cells[0]).toBeNull()
    expect(target.tilemap.cells[1]).toBeNull()

    useWorkspace.getState().undo()
    expect(document.tilesets![0].tileIds).toEqual([retainedTileId, firstDeletedTileId, secondDeletedTileId])
    expect(target.tilemap.cells[0]).toEqual({ tilesetId: tileset.id, tileId: firstDeletedTileId })
    expect(target.tilemap.cells[1]).toEqual({ tilesetId: tileset.id, tileId: secondDeletedTileId })
  })

  it('reorders Tileset entries without changing stable references or rendered colors', async () => {
    const document = createDocument('reorder tiles', 2, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createTilemapLayer({ name: 'Reorder Tiles', tileWidth: 1, tileHeight: 1 })
    const tilesetId = document.tilesets![0].id
    const redTileId = document.tilesets![0].tileIds[0]
    const blueTileId = useWorkspace.getState().addTilesetTile(tilesetId)!
    const red = new Uint8ClampedArray([220, 20, 30, 255])
    const blue = new Uint8ClampedArray([30, 70, 220, 255])
    useWorkspace.getState().previewTilesetTilePixels(tilesetId, redTileId, red)
    useWorkspace.getState().commitTilesetTileEdit(tilesetId, redTileId, new Uint8ClampedArray(4), red)
    useWorkspace.getState().previewTilesetTilePixels(tilesetId, blueTileId, blue)
    useWorkspace.getState().commitTilesetTileEdit(tilesetId, blueTileId, new Uint8ClampedArray(4), blue)
    const target = activeTilemapCelTarget(document)!
    const paint = beginTilemapEdit(target.layer.id, target.cel.frameId)
    writeTilemapCell(document, target, paint, 0, { tilesetId, tileId: redTileId })
    writeTilemapCell(document, target, paint, 1, { tilesetId, tileId: blueTileId })
    useWorkspace.getState().commitTilemapEdit(paint, 'Paint reordered tiles')

    expect(useWorkspace.getState().reorderTilesetTiles(tilesetId, [blueTileId, redTileId])).toBe(true)
    expect(document.tilesets![0].tileIds).toEqual([blueTileId, redTileId])
    expect(Array.from(readTilesetTilePixels(document.tilesets![0], redTileId)!)).toEqual(Array.from(red))
    expect(Array.from(readTilesetTilePixels(document.tilesets![0], blueTileId)!)).toEqual(Array.from(blue))
    expect(target.tilemap.cells.map((cell) => cell?.tileId ?? null)).toEqual([redTileId, blueTileId])
    expect(readLayerColorAt(document, target.layer, 0, 0)).toEqual({ r: 220, g: 20, b: 30, a: 255 })
    expect(readLayerColorAt(document, target.layer, 1, 0)).toEqual({ r: 30, g: 70, b: 220, a: 255 })

    useWorkspace.getState().undo()
    expect(document.tilesets![0].tileIds).toEqual([redTileId, blueTileId])
    useWorkspace.getState().redo()
    expect(document.tilesets![0].tileIds).toEqual([blueTileId, redTileId])
  })

  it('moves Tileset entries into empty layout slots with one undo step', async () => {
    const document = createDocument('sparse tile layout', 2, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createTilemapLayer({ name: 'Sparse Layout', tileWidth: 1, tileHeight: 1 })
    const tileset = document.tilesets![0]
    const tileId = tileset.tileIds[0]

    expect(useWorkspace.getState().setTilesetTileSlots(tileset.id, [null, null, null, tileId])).toBe(true)
    expect(tileset.tileSlots).toEqual([null, null, null, tileId])
    expect(tileset.tileIds).toEqual([tileId])

    useWorkspace.getState().undo()
    expect(tileset.tileSlots).toEqual([tileId])
    useWorkspace.getState().redo()
    expect(tileset.tileSlots).toEqual([null, null, null, tileId])
  })

  it('moves whole Tilemap layers only by cel offset in every mode', async () => {
    const document = createDocument('offset-only tile move', 4, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createTilemapLayer({ name: 'Offset Move', tileWidth: 2, tileHeight: 1 })
    const tileset = document.tilesets![0]
    const tileId = tileset.tileIds[0]
    const pixels = new Uint8ClampedArray([220, 20, 30, 255, 30, 70, 220, 255])
    useWorkspace.getState().previewTilesetTilePixels(tileset.id, tileId, pixels)
    useWorkspace.getState().commitTilesetTileEdit(tileset.id, tileId, new Uint8ClampedArray(8), pixels)
    const target = activeTilemapCelTarget(document)!
    const paint = beginTilemapEdit(target.layer.id, target.cel.frameId)
    writeTilemapCell(document, target, paint, 0, { tilesetId: tileset.id, tileId })
    useWorkspace.getState().commitTilemapEdit(paint, 'Paint offset tile')
    const key = animationCelKey(target.layer.id, target.cel.frameId)
    const beforeOffsets = animationCelOffsetsForKeys(document, [key])
    const originalCells = target.tilemap.cells.map((cell) => cell ? { ...cell } : null)
    const originalTileIds = [...tileset.tileIds]
    const originalTilesetPixels = new Uint8ClampedArray(tileset.pixels)

    for (const mode of ['edit', 'create', 'hybrid', 'paint'] as const) {
      useWorkspace.getState().setTilemapMode(mode)
      const afterOffsets = { [key]: { x: beforeOffsets[key].x + 1, y: beforeOffsets[key].y } }
      setAnimationCelOffsetsForKeys(document, afterOffsets)
      const movedTarget = activeTilemapCelTarget(document)!

      expect(animationCelOffsetsForKeys(document, [key])).toEqual(afterOffsets)
      expect(tilemapCellBounds(movedTarget.tilemap, movedTarget.surface.offsetX, movedTarget.surface.offsetY, 0).x).toBe(1)
      expect(movedTarget.tilemap.cells).toEqual(originalCells)
      expect(tileset.tileIds).toEqual(originalTileIds)
      expect(Array.from(tileset.pixels)).toEqual(Array.from(originalTilesetPixels))
      expect(readLayerColorAt(document, movedTarget.layer, 0, 0).a).toBe(0)
      expect(readLayerColorAt(document, movedTarget.layer, 1, 0)).toEqual({ r: 220, g: 20, b: 30, a: 255 })

      setAnimationCelOffsetsForKeys(document, beforeOffsets)
      expect(animationCelOffsetsForKeys(document, [key])).toEqual(beforeOffsets)
      expect(movedTarget.tilemap.cells).toEqual(originalCells)
    }
  })

  it('moves a paint-mode selection by cell references without changing the Tileset', async () => {
    const document = createDocument('selection tile move', 3, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createTilemapLayer({ name: 'Selection Move', tileWidth: 1, tileHeight: 1 })
    const tileset = document.tilesets![0]
    const firstTileId = tileset.tileIds[0]
    const secondTileId = useWorkspace.getState().addTilesetTile(tileset.id)!
    const target = activeTilemapCelTarget(document)!
    const paint = beginTilemapEdit(target.layer.id, target.cel.frameId)
    writeTilemapCell(document, target, paint, 0, { tilesetId: tileset.id, tileId: firstTileId })
    writeTilemapCell(document, target, paint, 1, { tilesetId: tileset.id, tileId: secondTileId })
    useWorkspace.getState().commitTilemapEdit(paint, 'Paint move source')
    const beforeTileIds = [...document.tilesets![0].tileIds]
    const source = captureTilemapSelectionMove(target, { x: 0, y: 0, width: 2, height: 1 })!

    const edit = previewTilemapSelectionMove(document, source, 1, 0, false)!
    expect(target.tilemap.cells).toEqual([
      null,
      { tilesetId: tileset.id, tileId: firstTileId },
      { tilesetId: tileset.id, tileId: secondTileId }
    ])
    expect(document.tilesets![0].tileIds).toEqual(beforeTileIds)

    const beforeSelection = { x: 0, y: 0, width: 2, height: 1 }
    const afterSelection = { x: 1, y: 0, width: 2, height: 1 }
    useWorkspace.getState().commitTilemapSelectionMove(edit, beforeSelection, afterSelection, 'Move tile selection')
    expect(useWorkspace.getState().sessions[0].selection).toEqual(afterSelection)

    useWorkspace.getState().undo()
    expect(target.tilemap.cells).toEqual([
      { tilesetId: tileset.id, tileId: firstTileId },
      { tilesetId: tileset.id, tileId: secondTileId },
      null
    ])
    expect(useWorkspace.getState().sessions[0].selection).toEqual(beforeSelection)

    useWorkspace.getState().redo()
    expect(target.tilemap.cells[2]?.tileId).toBe(secondTileId)
    expect(useWorkspace.getState().sessions[0].selection).toEqual(afterSelection)
  })

  it('keeps the owned Tileset name and deletion lifecycle synchronized with its layer', async () => {
    const document = createDocument('owned tileset', 2, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createTilemapLayer({ name: 'Owned Tileset', tileWidth: 1, tileHeight: 1 })
    const layer = getActiveLayer(document)
    const tilesetId = layer.tilemapTilesetId!

    useWorkspace.getState().renameLayer(layer.id, 'Ground')
    expect(document.tilesets?.find((tileset) => tileset.id === tilesetId)?.name).toBe('Ground')
    useWorkspace.getState().deleteActiveLayer()
    expect(document.tilesets?.some((tileset) => tileset.id === tilesetId)).toBe(false)
    useWorkspace.getState().undo()
    expect(getActiveLayer(document).tilemapTilesetId).toBe(tilesetId)
    expect(document.tilesets?.find((tileset) => tileset.id === tilesetId)?.name).toBe('Ground')
  })

  it('selects the owning Tilemap layer when the Tileset dropdown changes', async () => {
    const document = createDocument('select tileset owner', 2, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createTilemapLayer({ name: 'Ground', tileWidth: 1, tileHeight: 1 })
    const groundLayer = getActiveLayer(document)
    const groundTilesetId = groundLayer.tilemapTilesetId!
    await useWorkspace.getState().createTilemapLayer({ name: 'Props', tileWidth: 1, tileHeight: 1 })
    expect(getActiveLayer(document).name).toBe('Props')

    useWorkspace.getState().setSelectedTileset(groundTilesetId)

    const session = useWorkspace.getState().sessions[0]
    expect(document.activeLayerId).toBe(groundLayer.id)
    expect(session.selectedLayerIds).toEqual([groundLayer.id])
    expect(session.selectedTilesetId).toBe(groundTilesetId)
  })

  it('creates a Tilemap layer that reuses an existing project Tileset', async () => {
    const document = createDocument('shared tilemap tileset', 4, 2, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createTilemapLayer({ name: 'Ground', tileWidth: 2, tileHeight: 1 })
    const firstLayer = document.layers.find((layer) => layer.kind === 'tilemap')!
    const tilesetId = firstLayer.tilemapTilesetId!
    const tileset = document.tilesets!.find((candidate) => candidate.id === tilesetId)!

    await useWorkspace.getState().createTilemapLayer({ name: 'Props', tileWidth: 99, tileHeight: 99, tilesetId })

    const tilemapLayers = document.layers.filter((layer) => layer.kind === 'tilemap')
    expect(tilemapLayers).toHaveLength(2)
    expect(tilemapLayers[1].tilemapTilesetId).toBe(tilesetId)
    expect(document.tilesets).toHaveLength(1)
    expect(activeTilemapCelTarget(document)?.tilemap).toMatchObject({ tileWidth: 2, tileHeight: 1 })
    expect(useWorkspace.getState().sessions[0].selectedTilesetId).toBe(tilesetId)

    useWorkspace.getState().renameLayer(tilemapLayers[1].id, 'Props Renamed')
    expect(tileset.name).toBe('Ground')

    useWorkspace.getState().deleteActiveLayer()
    expect(document.tilesets?.some((candidate) => candidate.id === tilesetId)).toBe(true)
    useWorkspace.getState().undo()
    expect(document.layers.filter((layer) => layer.kind === 'tilemap')).toHaveLength(2)
    expect(document.tilesets?.some((candidate) => candidate.id === tilesetId)).toBe(true)
  })

  it('adds exact pixel variants once per stroke and restores Tileset plus cells through undo and redo', async () => {
    const document = createDocument('create tiles', 4, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createTilemapLayer({ name: 'Create Tiles', tileWidth: 2, tileHeight: 1 })

    const session = useWorkspace.getState().sessions[0]
    const target = activeTilemapCelTarget(document)!
    const tileset = document.tilesets![0]
    expect(session.selectedTilesetId).toBe(tileset.id)
    expect(session.selectedTileId).toBe(tileset.tileIds[0])

    const color = { r: 12, g: 34, b: 56, a: 255 }
    const edit = beginPixelEdit(target.layer.id)
    expect(recordPixel(document, target.layer, edit, 0, packColor(color))).toBe(true)
    expect(recordPixel(document, target.layer, edit, 2, packColor(color))).toBe(true)
    expect(useWorkspace.getState().commitPixelEdit(edit, 'Add Tiles')).not.toBeNull()

    expect(document.tilesets![0].tileIds).toHaveLength(2)
    expect(target.tilemap.cells[0]?.tileId).toBe(target.tilemap.cells[1]?.tileId)
    expect(readLayerColorAt(document, target.layer, 0, 0)).toEqual(color)
    expect(readLayerColorAt(document, target.layer, 2, 0)).toEqual(color)

    useWorkspace.getState().undo()
    expect(document.tilesets![0].tileIds).toHaveLength(1)
    expect(target.tilemap.cells[0]).toBeNull()
    expect(target.tilemap.cells[1]).toBeNull()
    expect(readLayerColorAt(document, target.layer, 0, 0).a).toBe(0)

    useWorkspace.getState().redo()
    expect(document.tilesets![0].tileIds).toHaveLength(2)
    expect(target.tilemap.cells[0]?.tileId).toBe(target.tilemap.cells[1]?.tileId)
    expect(readLayerColorAt(document, target.layer, 2, 0)).toEqual(color)

    useWorkspace.getState().setSelectedTileset('missing')
    useWorkspace.getState().setSelectedTile(document.tilesets![0].id, 'missing')
    expect(session.selectedTilesetId).toBe(document.tilesets![0].id)
    expect(document.tilesets![0].tileIds).toContain(session.selectedTileId)
  })

  it('modifies the tile under the pointer and synchronizes every reference in one history entry', async () => {
    const document = createDocument('modify tile', 2, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createTilemapLayer({ name: 'Modify Tile', tileWidth: 1, tileHeight: 1 })
    const target = activeTilemapCelTarget(document)!
    const tileset = document.tilesets![0]
    const tileId = tileset.tileIds[0]
    const red = new Uint8ClampedArray([200, 10, 20, 255])
    useWorkspace.getState().previewTilesetTilePixels(tileset.id, tileId, red)
    useWorkspace.getState().commitTilesetTileEdit(tileset.id, tileId, new Uint8ClampedArray(4), red)
    const paint = beginTilemapEdit(target.layer.id, target.cel.frameId)
    writeTilemapCell(document, target, paint, 0, { tilesetId: tileset.id, tileId })
    writeTilemapCell(document, target, paint, 1, { tilesetId: tileset.id, tileId })
    useWorkspace.getState().commitTilemapEdit(paint, 'Paint references')

    useWorkspace.getState().setTilemapMode('edit')
    const blue = { r: 20, g: 40, b: 220, a: 255 }
    const edit = beginPixelEdit(target.layer.id)
    expect(recordPixel(document, target.layer, edit, 0, packColor(blue))).toBe(true)
    expect(Array.from(tilemapEditPreviewTilePixels(document, edit).get(tileId)!)).toEqual([20, 40, 220, 255])
    expect(readLayerColorAt(document, target.layer, 1, 0)).toEqual({ r: 200, g: 10, b: 20, a: 255 })
    expect(useWorkspace.getState().commitPixelEdit(edit, 'Modify Tile')).not.toBeNull()
    expect(readLayerColorAt(document, target.layer, 0, 0)).toEqual({ r: 20, g: 40, b: 220, a: 255 })
    expect(readLayerColorAt(document, target.layer, 1, 0)).toEqual({ r: 20, g: 40, b: 220, a: 255 })

    useWorkspace.getState().undo()
    expect(readLayerColorAt(document, target.layer, 0, 0)).toEqual({ r: 200, g: 10, b: 20, a: 255 })
    expect(readLayerColorAt(document, target.layer, 1, 0)).toEqual({ r: 200, g: 10, b: 20, a: 255 })
  })

  it('modifies multiple occupied tile cells in one continuous pixel edit', async () => {
    const document = createDocument('modify across tiles', 2, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createTilemapLayer({ name: 'Modify Across', tileWidth: 1, tileHeight: 1 })
    const target = activeTilemapCelTarget(document)!
    const tileset = document.tilesets![0]
    const firstTileId = tileset.tileIds[0]
    const secondTileId = useWorkspace.getState().addTilesetTile(tileset.id)!
    const firstPixels = new Uint8ClampedArray([200, 10, 20, 255])
    const secondPixels = new Uint8ClampedArray([20, 180, 40, 255])
    useWorkspace.getState().previewTilesetTilePixels(tileset.id, firstTileId, firstPixels)
    useWorkspace.getState().commitTilesetTileEdit(tileset.id, firstTileId, new Uint8ClampedArray(4), firstPixels)
    useWorkspace.getState().previewTilesetTilePixels(tileset.id, secondTileId, secondPixels)
    useWorkspace.getState().commitTilesetTileEdit(tileset.id, secondTileId, new Uint8ClampedArray(4), secondPixels)
    const paint = beginTilemapEdit(target.layer.id, target.cel.frameId)
    writeTilemapCell(document, target, paint, 0, { tilesetId: tileset.id, tileId: firstTileId })
    writeTilemapCell(document, target, paint, 1, { tilesetId: tileset.id, tileId: secondTileId })
    useWorkspace.getState().commitTilemapEdit(paint, 'Paint distinct tiles')
    useWorkspace.getState().setTilemapMode('edit')

    const blue = { r: 30, g: 60, b: 220, a: 255 }
    const yellow = { r: 230, g: 190, b: 20, a: 255 }
    const edit = beginPixelEdit(target.layer.id)
    expect(recordPixel(document, target.layer, edit, 0, packColor(blue))).toBe(true)
    expect(recordPixel(document, target.layer, edit, 1, packColor(yellow))).toBe(true)
    expect(useWorkspace.getState().commitPixelEdit(edit, 'Modify across cells')).not.toBeNull()

    expect(document.tilesets![0].tileIds).toEqual([firstTileId, secondTileId])
    expect(readLayerColorAt(document, target.layer, 0, 0)).toEqual(blue)
    expect(readLayerColorAt(document, target.layer, 1, 0)).toEqual(yellow)
    useWorkspace.getState().undo()
    expect(readLayerColorAt(document, target.layer, 0, 0)).toEqual({ r: 200, g: 10, b: 20, a: 255 })
    expect(readLayerColorAt(document, target.layer, 1, 0)).toEqual({ r: 20, g: 180, b: 40, a: 255 })
  })

  it('moves a complete-cell hybrid selection by references without adding a variant', async () => {
    const document = createDocument('hybrid selection move', 2, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createTilemapLayer({ name: 'Create Selection Move', tileWidth: 1, tileHeight: 1 })
    const target = activeTilemapCelTarget(document)!
    const tileset = document.tilesets![0]
    const sourceTileId = tileset.tileIds[0]
    const red = new Uint8ClampedArray([220, 20, 30, 255])
    useWorkspace.getState().previewTilesetTilePixels(tileset.id, sourceTileId, red)
    useWorkspace.getState().commitTilesetTileEdit(tileset.id, sourceTileId, new Uint8ClampedArray(4), red)
    const paint = beginTilemapEdit(target.layer.id, target.cel.frameId)
    writeTilemapCell(document, target, paint, 0, { tilesetId: tileset.id, tileId: sourceTileId })
    useWorkspace.getState().commitTilemapEdit(paint, 'Paint create move source')
    useWorkspace.getState().setTilemapMode('hybrid')

    const before = { x: 0, y: 0, width: 1, height: 1 }
    const after = { ...before, x: 1 }
    const source = captureSelectionTransform(document, before, target.layer)!
    const preview = applySelectionTranslationPreview(document, source, after, false, null, target.layer)
    useWorkspace.getState().beginFloatingSelectionTransform(source, null, before, after, false, 'Move into empty tile', preview, after)
    useWorkspace.getState().commitFloatingPaste()

    expect(document.tilesets![0].tileIds).toEqual([sourceTileId])
    expect(readLayerColorAt(document, target.layer, 0, 0).a).toBe(0)
    expect(readLayerColorAt(document, target.layer, 1, 0)).toEqual({ r: 220, g: 20, b: 30, a: 255 })
    expect(target.tilemap.cells[0]).toBeNull()
    expect(target.tilemap.cells[1]?.tileId).toBe(sourceTileId)

    useWorkspace.getState().undo()
    expect(document.tilesets![0].tileIds).toEqual([sourceTileId])
    expect(target.tilemap.cells[0]?.tileId).toBe(sourceTileId)
    expect(target.tilemap.cells[1]).toBeNull()
  })

  it('creates result variants when create-mode selection content moves by a complete cell', async () => {
    const document = createDocument('create selection move', 4, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createTilemapLayer({ name: 'Create Selection Move', tileWidth: 2, tileHeight: 1 })
    const target = activeTilemapCelTarget(document)!
    const tileset = document.tilesets![0]
    const sourceTileId = tileset.tileIds[0]
    const sourcePixels = new Uint8ClampedArray([220, 20, 30, 255, 30, 70, 220, 255])
    useWorkspace.getState().previewTilesetTilePixels(tileset.id, sourceTileId, sourcePixels)
    useWorkspace.getState().commitTilesetTileEdit(tileset.id, sourceTileId, new Uint8ClampedArray(8), sourcePixels)
    const paint = beginTilemapEdit(target.layer.id, target.cel.frameId)
    writeTilemapCell(document, target, paint, 0, { tilesetId: tileset.id, tileId: sourceTileId })
    useWorkspace.getState().commitTilemapEdit(paint, 'Paint create selection source')
    useWorkspace.getState().setTilemapMode('create')

    const before = { x: 0, y: 0, width: 2, height: 1 }
    const after = { ...before, x: 2 }
    const source = captureSelectionTransform(document, before, target.layer)!
    const preview = applySelectionTranslationPreview(document, source, after, false, null, target.layer)
    useWorkspace.getState().beginFloatingSelectionTransform(source, null, before, after, false, 'Move create selection', preview, after)
    useWorkspace.getState().commitFloatingPaste()

    expect(document.tilesets![0].tileIds).toHaveLength(2)
    expect(target.tilemap.cells[0]?.tileId).not.toBe(sourceTileId)
    expect(target.tilemap.cells[1]?.tileId).toBe(sourceTileId)
    expect(Array.from(readTilesetTilePixels(document.tilesets![0], sourceTileId)!)).toEqual(Array.from(sourcePixels))

    useWorkspace.getState().undo()
    expect(document.tilesets![0].tileIds).toEqual([sourceTileId])
    expect(target.tilemap.cells[0]?.tileId).toBe(sourceTileId)
    expect(target.tilemap.cells[1]).toBeNull()
  })

  it('creates result variants for a hybrid selection that is not moved by whole cells', async () => {
    const document = createDocument('hybrid partial selection move', 6, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createTilemapLayer({ name: 'Hybrid Partial Move', tileWidth: 2, tileHeight: 1 })
    const target = activeTilemapCelTarget(document)!
    const tileset = document.tilesets![0]
    const sourceTileId = tileset.tileIds[0]
    const sourcePixels = new Uint8ClampedArray([220, 20, 30, 255, 30, 70, 220, 255])
    useWorkspace.getState().previewTilesetTilePixels(tileset.id, sourceTileId, sourcePixels)
    useWorkspace.getState().commitTilesetTileEdit(tileset.id, sourceTileId, new Uint8ClampedArray(8), sourcePixels)
    const paint = beginTilemapEdit(target.layer.id, target.cel.frameId)
    writeTilemapCell(document, target, paint, 0, { tilesetId: tileset.id, tileId: sourceTileId })
    writeTilemapCell(document, target, paint, 2, { tilesetId: tileset.id, tileId: sourceTileId })
    useWorkspace.getState().commitTilemapEdit(paint, 'Paint hybrid partial sources')
    useWorkspace.getState().setTilemapMode('hybrid')

    const before = { x: 0, y: 0, width: 2, height: 1 }
    const after = { ...before, x: 1 }
    const source = captureSelectionTransform(document, before, target.layer)!
    const preview = applySelectionTranslationPreview(document, source, after, false, null, target.layer)
    useWorkspace.getState().beginFloatingSelectionTransform(source, null, before, after, false, 'Move hybrid partial selection', preview, after)
    useWorkspace.getState().commitFloatingPaste()

    expect(document.tilesets![0].tileIds).toHaveLength(3)
    expect(target.tilemap.cells[0]?.tileId).not.toBe(sourceTileId)
    expect(target.tilemap.cells[1]?.tileId).not.toBe(sourceTileId)
    expect(target.tilemap.cells[2]?.tileId).toBe(sourceTileId)
    expect(Array.from(readTilesetTilePixels(document.tilesets![0], sourceTileId)!)).toEqual(Array.from(sourcePixels))
    expect(readLayerColorAt(document, target.layer, 4, 0)).toEqual({ r: 220, g: 20, b: 30, a: 255 })
    expect(readLayerColorAt(document, target.layer, 5, 0)).toEqual({ r: 30, g: 70, b: 220, a: 255 })

    useWorkspace.getState().undo()
    expect(document.tilesets![0].tileIds).toEqual([sourceTileId])
    expect(target.tilemap.cells[0]?.tileId).toBe(sourceTileId)
    expect(target.tilemap.cells[1]).toBeNull()
    expect(target.tilemap.cells[2]?.tileId).toBe(sourceTileId)
  })

  it('clips moved selection pixels to the edited tile and synchronizes every reference', async () => {
    const document = createDocument('move tile selection', 4, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createTilemapLayer({ name: 'Move Tile Selection', tileWidth: 2, tileHeight: 1 })
    const target = activeTilemapCelTarget(document)!
    const tileset = document.tilesets![0]
    const tileId = tileset.tileIds[0]
    const red = [220, 20, 30, 255]
    const blue = [30, 70, 220, 255]
    const pixels = new Uint8ClampedArray([...red, ...blue])
    useWorkspace.getState().previewTilesetTilePixels(tileset.id, tileId, pixels)
    useWorkspace.getState().commitTilesetTileEdit(tileset.id, tileId, new Uint8ClampedArray(8), pixels)
    const paint = beginTilemapEdit(target.layer.id, target.cel.frameId)
    writeTilemapCell(document, target, paint, 0, { tilesetId: tileset.id, tileId })
    writeTilemapCell(document, target, paint, 1, { tilesetId: tileset.id, tileId })
    useWorkspace.getState().commitTilemapEdit(paint, 'Paint repeated tile')
    useWorkspace.getState().setTilemapMode('edit')

    const before = { x: 1, y: 0, width: 1, height: 1 }
    const after = { ...before, x: 2 }
    const source = captureSelectionTransform(document, before, target.layer)!
    const preview = applySelectionTranslationPreview(document, source, after, false, null, target.layer, { x: 0, y: 0, width: 2, height: 1 })
    const previewEdit = selectionTranslationPreviewEdit(document, preview)!

    expect(readLayerColorAt(document, target.layer, 1, 0).a).toBe(0)
    expect(readLayerColorAt(document, target.layer, 2, 0)).toEqual({ r: 220, g: 20, b: 30, a: 255 })
    expect(Array.from(tilemapEditPreviewTilePixels(document, previewEdit, 0).get(tileId)!)).toEqual([...red, 0, 0, 0, 0])

    useWorkspace.getState().beginFloatingSelectionTransform(source, null, before, after, false, 'Move tile selection', preview, after, 0, undefined, false, 0)
    useWorkspace.getState().commitFloatingPaste()

    expect(readLayerColorAt(document, target.layer, 0, 0)).toEqual({ r: 220, g: 20, b: 30, a: 255 })
    expect(readLayerColorAt(document, target.layer, 1, 0).a).toBe(0)
    expect(readLayerColorAt(document, target.layer, 2, 0)).toEqual({ r: 220, g: 20, b: 30, a: 255 })
    expect(readLayerColorAt(document, target.layer, 3, 0).a).toBe(0)

    useWorkspace.getState().undo()
    expect(readLayerColorAt(document, target.layer, 1, 0)).toEqual({ r: 30, g: 70, b: 220, a: 255 })
    expect(readLayerColorAt(document, target.layer, 3, 0)).toEqual({ r: 30, g: 70, b: 220, a: 255 })
  })

  it('copies Tilemap layers across documents with remapped Tileset references and one undoable paste', async () => {
    const source = createDocument('tile source', 2, 1, 'rgba')
    useWorkspace.getState().addSession(source)
    await useWorkspace.getState().createTilemapLayer({ name: 'Source Tiles', tileWidth: 1, tileHeight: 1 })
    const sourceTarget = activeTilemapCelTarget(source)!
    const sourceTileset = source.tilesets![0]
    const sourceColor = new Uint8ClampedArray([200, 90, 40, 255])
    useWorkspace.getState().previewTilesetTilePixels(sourceTileset.id, sourceTileset.tileIds[0], sourceColor)
    useWorkspace.getState().commitTilesetTileEdit(sourceTileset.id, sourceTileset.tileIds[0], new Uint8ClampedArray(4), sourceColor)
    const sourceEdit = beginTilemapEdit(sourceTarget.layer.id, sourceTarget.cel.frameId)
    writeTilemapCell(source, sourceTarget, sourceEdit, 0, { tilesetId: sourceTileset.id, tileId: sourceTileset.tileIds[0] })
    useWorkspace.getState().commitTilemapEdit(sourceEdit, 'Paint Tiles')
    useWorkspace.getState().copySelectedLayersToClipboard()

    const target = createDocument('tile target', 2, 1, 'rgba')
    useWorkspace.getState().addSession(target)
    expect(useWorkspace.getState().pasteLayersFromClipboard()).toBe(true)

    const pastedLayer = getActiveLayer(target)
    const pastedTileset = target.tilesets?.[0]
    const pastedCel = ensureAnimationDocument(target).cels.find((cel) => cel.layerId === pastedLayer.id)
    expect(pastedLayer.kind).toBe('tilemap')
    expect(pastedTileset).toBeDefined()
    expect(pastedTileset!.id).not.toBe(sourceTileset.id)
    expect(pastedLayer.tilemapTilesetId).toBe(pastedTileset!.id)
    expect(pastedTileset!.name).toBe(pastedLayer.name)
    expect(pastedCel?.tilemap?.cells[0]).toEqual({ tilesetId: pastedTileset!.id, tileId: sourceTileset.tileIds[0] })
    expect(readLayerColorAt(target, pastedLayer, 0, 0)).toEqual({ r: 200, g: 90, b: 40, a: 255 })

    useWorkspace.getState().undo()
    expect(target.layers.some((layer) => layer.kind === 'tilemap')).toBe(false)
    expect(target.tilesets).toEqual([])

    useWorkspace.getState().redo()
    const restoredLayer = getActiveLayer(target)
    const restoredCel = ensureAnimationDocument(target).cels.find((cel) => cel.layerId === restoredLayer.id)
    expect(restoredLayer.kind).toBe('tilemap')
    expect(target.tilesets).toHaveLength(1)
    expect(restoredCel?.tilemap?.cells[0]?.tilesetId).toBe(target.tilesets![0].id)
  })

  it('copies Free Tile layers across documents with remapped source references', async () => {
    const source = createDocument('free tile source', 3, 1, 'rgba')
    useWorkspace.getState().addSession(source)
    await useWorkspace.getState().createFreeTileLayer({ name: 'Reusable Props' })
    const sourceTarget = activeFreeTileCelTarget(source)!
    const sourceLayer = sourceTarget.layer
    const sourceEntry = sourceLayer.freeTileSources![0]
    const sourceTileset = source.tilesets!.find((tileset) => tileset.id === sourceEntry.tilesetId)!
    writeTilesetTilePixels(sourceTileset, sourceTileset.tileIds[0], new Uint8ClampedArray([80, 120, 200, 255]))
    const placement = useWorkspace.getState().beginFreeTilePlacement()!
    placement.after.instances = [{ id: 'placed-source', sourceId: sourceEntry.id, x: 1, y: 0 }]
    expect(useWorkspace.getState().previewFreeTilePlacement(placement)).toBe(true)
    expect(useWorkspace.getState().commitFreeTilePlacement(placement, 'Place Free Tile')).not.toBeNull()
    useWorkspace.getState().copySelectedLayersToClipboard()

    const target = createDocument('free tile target', 3, 1, 'rgba')
    useWorkspace.getState().addSession(target)
    expect(useWorkspace.getState().pasteLayersFromClipboard()).toBe(true)

    const pastedLayer = getActiveLayer(target)
    const pastedSource = pastedLayer.freeTileSources![0]
    const pastedCel = ensureAnimationDocument(target).cels.find((cel) => cel.layerId === pastedLayer.id)
    const pastedInstance = pastedCel?.freeTiles?.instances[0]
    expect(pastedLayer.kind).toBe('free-tile')
    expect(pastedSource.id).not.toBe(sourceEntry.id)
    expect(pastedSource.tilesetId).not.toBe(sourceEntry.tilesetId)
    expect(pastedInstance).toMatchObject({ id: 'placed-source', sourceId: pastedSource.id, x: 1, y: 0 })
    expect(pastedInstance?.sourceId).not.toBe(sourceEntry.id)
    expect(readLayerColorAt(target, pastedLayer, 1, 0)).toEqual({ r: 80, g: 120, b: 200, a: 255 })
  })

  it('edits, adds, deletes, and restores tiles while keeping every referenced cel synchronized', async () => {
    const document = createDocument('tile editing', 2, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().createTilemapLayer({ name: 'Tile Editing', tileWidth: 1, tileHeight: 1 })
    const target = activeTilemapCelTarget(document)!
    const tileset = document.tilesets![0]
    const originalTileId = tileset.tileIds[0]
    const originalPixels = new Uint8ClampedArray([20, 30, 40, 255])
    useWorkspace.getState().previewTilesetTilePixels(tileset.id, originalTileId, originalPixels)
    useWorkspace.getState().commitTilesetTileEdit(tileset.id, originalTileId, new Uint8ClampedArray(4), originalPixels)
    const originalEdit = beginTilemapEdit(target.layer.id, target.cel.frameId)
    writeTilemapCell(document, target, originalEdit, 0, { tilesetId: tileset.id, tileId: originalTileId })
    writeTilemapCell(document, target, originalEdit, 1, { tilesetId: tileset.id, tileId: originalTileId })
    useWorkspace.getState().commitTilemapEdit(originalEdit, 'Paint original tile')

    const before = readTilesetTilePixels(tileset, originalTileId)!
    const after = new Uint8ClampedArray([90, 80, 70, 255])
    expect(useWorkspace.getState().previewTilesetTilePixels(tileset.id, originalTileId, after)).toBe(true)
    expect(readLayerColorAt(document, target.layer, 0, 0)).toEqual({ r: 90, g: 80, b: 70, a: 255 })
    expect(readLayerColorAt(document, target.layer, 1, 0)).toEqual({ r: 90, g: 80, b: 70, a: 255 })
    expect(useWorkspace.getState().commitTilesetTileEdit(tileset.id, originalTileId, before, after)).toBe(true)
    useWorkspace.getState().undo()
    expect(readLayerColorAt(document, target.layer, 0, 0)).toEqual({ r: 20, g: 30, b: 40, a: 255 })
    expect(readLayerColorAt(document, target.layer, 1, 0)).toEqual({ r: 20, g: 30, b: 40, a: 255 })
    useWorkspace.getState().redo()
    expect(readLayerColorAt(document, target.layer, 0, 0)).toEqual({ r: 90, g: 80, b: 70, a: 255 })

    const addedTileId = useWorkspace.getState().addTilesetTile(tileset.id)
    expect(addedTileId).not.toBeNull()
    expect(Array.from(readTilesetTilePixels(document.tilesets![0], addedTileId!)!)).toEqual([0, 0, 0, 0])
    const addedPixels = new Uint8ClampedArray([1, 2, 3, 255])
    useWorkspace.getState().previewTilesetTilePixels(tileset.id, addedTileId!, addedPixels)
    useWorkspace.getState().commitTilesetTileEdit(tileset.id, addedTileId!, new Uint8ClampedArray(4), addedPixels)
    const addedTarget = activeTilemapCelTarget(document)!
    const addedEdit = beginTilemapEdit(addedTarget.layer.id, addedTarget.cel.frameId)
    writeTilemapCell(document, addedTarget, addedEdit, 1, { tilesetId: tileset.id, tileId: addedTileId! })
    useWorkspace.getState().commitTilemapEdit(addedEdit, 'Paint added tile')

    expect(useWorkspace.getState().deleteTilesetTile(tileset.id, addedTileId!)).toBe(true)
    expect(target.tilemap.cells[1]).toBeNull()
    useWorkspace.getState().undo()
    expect(document.tilesets![0].tileIds).toContain(addedTileId)
    expect(target.tilemap.cells[1]).toEqual({ tilesetId: tileset.id, tileId: addedTileId })
    expect(readLayerColorAt(document, target.layer, 1, 0)).toEqual({ r: 1, g: 2, b: 3, a: 255 })
  })
})
