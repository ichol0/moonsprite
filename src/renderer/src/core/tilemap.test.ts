import { describe, expect, it } from 'vitest'
import type { TilemapCell } from '@shared/types'
import {
  applyTilemapEdit,
  appendBlankTilesetTile,
  beginTilemapEdit,
  createBlankTileset,
  createSolidTileset,
  createTilemapCelData,
  createTilesetFromRgba,
  deleteTilesetTile,
  deleteTilesetTiles,
  documentPointForTileRepeatCopies,
  expandSelectionToTilemapCells,
  normalizeSelectionForTileRepeatPreview,
  normalizeTilemapCelData,
  readTilesetTilePixels,
  recordTilemapCell,
  reorderTilesetTiles,
  repositionTilesetTileSlots,
  renderTilemapSurface,
  resizeTilemapCelDataToCanvas,
  setTilesetTileSlots,
  sliceRasterSurfaceToTilemap,
  tileRepeatDocumentOffsets,
  tileRepeatContinuousPreviewPlacements,
  tileRepeatFitZoom,
  tileRepeatLineSegments,
  tileRepeatMappedPointForCopies,
  tileRepeatOffsetsForViewport,
  tileRepeatPreviewPlacements,
  tilemapCellLineIndices,
  tilemapCellIndexAtPoint,
  tilemapCellTranslationForSelection,
  tilemapEditableSelectionAtPoint,
  tilesetHasOnlyTransparentTile,
  wrapDocumentPointForTileRepeat,
  wrapSelectionMaskForTileRepeat
} from './tilemap'
import { selectionContains } from './selection'

describe('tile repeat geometry', () => {
  it('wraps only enabled axes, including negative points', () => {
    expect(wrapDocumentPointForTileRepeat({ x: -1, y: 17 }, 16, 12, 'x')).toEqual({ x: 15, y: 17 })
    expect(wrapDocumentPointForTileRepeat({ x: 33.5, y: -0.5 }, 16, 12, 'both')).toEqual({ x: 1.5, y: 11.5 })
  })

  it('uses fixed surrounding copies without forcing disabled axes', () => {
    expect(tileRepeatOffsetsForViewport({ left: -17, top: -2, right: 33, bottom: 18 }, 0, 0, 16, 16, 'x')).toEqual([
      { x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }
    ])
    expect(tileRepeatOffsetsForViewport({ left: 0, top: 0, right: 1, bottom: 1 }, 0, 0, 1, 1, 'both')).toHaveLength(9)
  })

  it('provides document-space offsets for repeated composite previews', () => {
    expect(tileRepeatDocumentOffsets(16, 12, 'off')).toEqual([{ x: 0, y: 0 }])
    expect(tileRepeatDocumentOffsets(16, 12, 'x')).toEqual([
      { x: -16, y: 0 }, { x: 0, y: 0 }, { x: 16, y: 0 }
    ])
    expect(tileRepeatDocumentOffsets(16, 12, 'y')).toEqual([
      { x: 0, y: -12 }, { x: 0, y: 0 }, { x: 0, y: 12 }
    ])
    expect(tileRepeatDocumentOffsets(16, 12, 'both')).toHaveLength(9)
  })

  it('accepts input only inside the fixed repeated copies', () => {
    expect(documentPointForTileRepeatCopies({ x: -1, y: 3 }, 16, 12, 'x')).toEqual({ x: 15, y: 3 })
    expect(documentPointForTileRepeatCopies({ x: -17, y: 3 }, 16, 12, 'x')).toBeNull()
    expect(documentPointForTileRepeatCopies({ x: 3, y: 12 }, 16, 12, 'x')).toBeNull()
  })

  it('keeps an active repeated drag mapped after it passes the outer preview copy', () => {
    expect(tileRepeatMappedPointForCopies({ x: -33, y: 3 }, 16, 12, 'x', true)).toEqual({
      local: { x: 15, y: 3 },
      offset: { x: -3, y: 0 }
    })
    expect(tileRepeatMappedPointForCopies({ x: -33, y: 12 }, 16, 12, 'x', true)).toBeNull()
  })

  it('places a wrapped tool preview in every visible repeated copy', () => {
    const copies = tileRepeatOffsetsForViewport({ left: -4, top: -4, right: 8, bottom: 8 }, 0, 0, 4, 4, 'both')
      .map((offset) => ({ ...offset, fromX: 0, fromY: 0, toX: 4, toY: 4 }))
    const placements = tileRepeatPreviewPlacements({ x: 4, y: -1 }, 4, 4, 'both', copies)

    expect(placements).toHaveLength(9)
    expect(placements.every(({ point }) => point.x === 0 && point.y === 3)).toBe(true)
    expect(placements.map(({ copy }) => ({ x: copy.x, y: copy.y }))).toEqual(copies.map(({ x, y }) => ({ x, y })))
  })

  it('keeps an overflowing brush preview continuous across repeated copies', () => {
    const copies = tileRepeatOffsetsForViewport({ left: -4, top: 0, right: 8, bottom: 4 }, 0, 0, 4, 4, 'x')
    const placements = tileRepeatContinuousPreviewPlacements({ x: -1, y: 2 }, 4, 4, 'x', copies)

    expect(placements.map(({ point }) => point)).toEqual([{ x: -1, y: 2 }, { x: 3, y: 2 }])
    expect(placements.every(({ samplePoint }) => samplePoint.x === 3 && samplePoint.y === 2)).toBe(true)
  })

  it('splits repeated raster lines at seams instead of connecting opposite edges', () => {
    expect(tileRepeatLineSegments({ x: 14, y: 2 }, { x: 17, y: 2 }, 16, 8, 'x')).toEqual([
      { from: { x: 14, y: 2 }, to: { x: 15, y: 2 }, fromProgress: 0, toProgress: 1 / 3 },
      { from: { x: 0, y: 2 }, to: { x: 1, y: 2 }, fromProgress: 2 / 3, toProgress: 1 }
    ])
  })

  it('folds repeated marquee selections back into the original canvas', () => {
    expect(wrapSelectionMaskForTileRepeat({ x: 18, y: 2, width: 3, height: 2 }, 16, 8, 'x')).toEqual({
      x: 2, y: 2, width: 3, height: 2, mask: undefined
    })

    const wrapped = wrapSelectionMaskForTileRepeat({ x: 14, y: 2, width: 4, height: 1 }, 16, 8, 'x')
    expect(wrapped).toMatchObject({ x: 0, y: 2, width: 16, height: 1 })
    expect(selectionContains(wrapped, 0, 2)).toBe(true)
    expect(selectionContains(wrapped, 1, 2)).toBe(true)
    expect(selectionContains(wrapped, 2, 2)).toBe(false)
    expect(selectionContains(wrapped, 14, 2)).toBe(true)
    expect(selectionContains(wrapped, 15, 2)).toBe(true)
  })

  it('keeps tiled marquee previews continuous while centering an equivalent period', () => {
    expect(normalizeSelectionForTileRepeatPreview({ x: 18, y: 2, width: 3, height: 2 }, 16, 8, 'x')).toEqual({
      x: 2, y: 2, width: 3, height: 2, mask: undefined
    })
    expect(normalizeSelectionForTileRepeatPreview({ x: 14, y: 2, width: 4, height: 2 }, 16, 8, 'x')).toEqual({
      x: -2, y: 2, width: 4, height: 2, mask: undefined
    })
  })

  it('wraps masked marquee pixels while clipping disabled axes', () => {
    const wrapped = wrapSelectionMaskForTileRepeat({
      x: 15,
      y: -1,
      width: 2,
      height: 3,
      mask: Uint8Array.from([1, 0, 0, 1, 1, 0])
    }, 16, 8, 'x')

    expect(wrapped).toMatchObject({ x: 0, y: 0, width: 16, height: 2 })
    expect(selectionContains(wrapped, 0, 0)).toBe(true)
    expect(selectionContains(wrapped, 15, 1)).toBe(true)
    expect(selectionContains(wrapped, 15, 0)).toBe(false)
  })

  it('fits the complete repeated group while accounting for view rotation', () => {
    expect(tileRepeatFitZoom(300, 200, 10, 10, 'both')).toBeCloseTo(20 / 3)
    expect(tileRepeatFitZoom(300, 200, 20, 10, 'x', 90)).toBeCloseTo(10 / 3)
  })
})

describe('tilemap model', () => {
  it('arms original editing before the pointer enters an existing tile', () => {
    const tilemap = createTilemapCelData(4, 2, 2, 2)
    tilemap.cells[0] = { tilesetId: 'tileset-1', tileId: 'tile-1' }
    const bounds = { x: 0, y: 0, width: 4, height: 2 }

    expect(tilemapEditableSelectionAtPoint(tilemap, 0, 0, { x: 3, y: 0 }, bounds, null)).toBeNull()
    expect(tilemapEditableSelectionAtPoint(tilemap, 0, 0, { x: 3, y: 0 }, bounds, null, true)).toEqual({ x: 0, y: 0, width: 2, height: 2 })
    expect(tilemapEditableSelectionAtPoint(tilemap, 0, 0, { x: -1, y: 0 }, bounds, null, true)).toEqual({ x: 0, y: 0, width: 2, height: 2 })

    const emptyTilemap = createTilemapCelData(4, 2, 2, 2)
    expect(tilemapEditableSelectionAtPoint(emptyTilemap, 0, 0, { x: 3, y: 0 }, bounds, null, true, true)).toEqual({ x: 0, y: 0, width: 4, height: 2 })
  })

  it('recognizes only the single transparent placeholder tile', () => {
    const blank = createBlankTileset('tileset-1', 'Blank', 2, 2, 'tile-1')
    expect(tilesetHasOnlyTransparentTile(blank)).toBe(true)

    blank.pixels[3] = 255
    expect(tilesetHasOnlyTransparentTile(blank)).toBe(false)

    const multiple = appendBlankTilesetTile(createBlankTileset('tileset-2', 'Multiple', 2, 2, 'tile-1'), 'tile-2')
    expect(tilesetHasOnlyTransparentTile(multiple)).toBe(false)
  })

  it('recognizes only complete-cell selection translations', () => {
    const tilemap = createTilemapCelData(8, 4, 2, 2)
    expect(tilemapCellTranslationForSelection(tilemap, 0, 0, { x: 0, y: 0, width: 4, height: 2 }, { x: 2, y: 2, width: 4, height: 2 })).toEqual({ columns: 1, rows: 1 })
    expect(tilemapCellTranslationForSelection(tilemap, 0, 0, { x: 1, y: 0, width: 2, height: 2 }, { x: 3, y: 0, width: 2, height: 2 })).toBeNull()
    expect(tilemapCellTranslationForSelection(tilemap, 0, 0, { x: 0, y: 0, width: 2, height: 2 }, { x: 1, y: 0, width: 2, height: 2 })).toBeNull()
  })

  it('renders stable tile references into the raster cache', () => {
    const tileset = createSolidTileset('tileset-1', 'Solid', 2, 2, { r: 10, g: 20, b: 30, a: 255 }, 'tile-1')
    const tilemap = createTilemapCelData(4, 2, 2, 2)
    tilemap.cells[1] = { tilesetId: tileset.id, tileId: tileset.tileIds[0] }
    const surface = renderTilemapSurface(tilemap, [tileset], 'rgba')
    expect(surface.width).toBe(4)
    expect(surface.height).toBe(2)
    expect(Array.from(surface.pixels.slice(0, 4))).toEqual([0, 0, 0, 0])
    expect(Array.from(surface.pixels.slice(8, 12))).toEqual([10, 20, 30, 255])
  })

  it('slices raster content into deduplicated tiles and pads partial edge cells', () => {
    const red = [220, 30, 40, 255]
    const blue = [20, 60, 220, 255]
    const yellow = [240, 200, 20, 255]
    const surface = {
      format: 'rgba' as const,
      width: 5,
      height: 2,
      offsetX: 0,
      offsetY: 0,
      pixels: new Uint8ClampedArray([
        ...red, ...blue, ...red, ...blue, ...yellow,
        ...blue, ...red, ...blue, ...red, 0, 0, 0, 0
      ])
    }
    let nextTile = 0
    const sliced = sliceRasterSurfaceToTilemap(
      surface,
      [],
      5,
      2,
      createBlankTileset('tileset-sliced', 'Sliced', 2, 2, 'tile-transparent'),
      () => `tile-${nextTile++}`
    )

    expect(sliced.tilemap).toMatchObject({ columns: 3, rows: 1 })
    expect(sliced.tileset.tileIds).toHaveLength(3)
    expect(sliced.tilemap.cells[0]?.tileId).toBe(sliced.tilemap.cells[1]?.tileId)
    expect(sliced.tilemap.cells[2]?.tileId).not.toBe(sliced.tilemap.cells[0]?.tileId)
    expect(Array.from(readTilesetTilePixels(sliced.tileset, sliced.tilemap.cells[2]!.tileId)!)).toEqual([
      ...yellow, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0
    ])
  })

  it('resolves indexed colors while keeping fully transparent cells empty', () => {
    const sliced = sliceRasterSurfaceToTilemap(
      { format: 'indexed', width: 2, height: 1, offsetX: 0, offsetY: 0, pixels: new Uint32Array([7, 0]) },
      [{ id: 0, name: 'Transparent', color: { r: 0, g: 0, b: 0, a: 0 } }, { id: 7, name: 'Green', color: { r: 20, g: 180, b: 60, a: 255 } }],
      2,
      1,
      createBlankTileset('tileset-indexed', 'Indexed', 1, 1, 'tile-transparent'),
      () => 'tile-green'
    )

    expect(sliced.tilemap.cells[0]).toEqual({ tilesetId: 'tileset-indexed', tileId: 'tile-green' })
    expect(sliced.tilemap.cells[1]).toBeNull()
    expect(Array.from(readTilesetTilePixels(sliced.tileset, 'tile-green')!)).toEqual([20, 180, 60, 255])
  })

  it('records one reversible edit per changed grid cell', () => {
    const tilemap = createTilemapCelData(8, 8, 4, 4)
    const edit = beginTilemapEdit('layer-1', 'frame-1')
    const cell: TilemapCell = { tilesetId: 'tileset-1', tileId: 'tile-1' }
    const index = tilemapCellIndexAtPoint(tilemap, 0, 0, 5, 1)
    expect(index).toBe(1)
    expect(recordTilemapCell(tilemap, edit, index!, cell, 0, 0)).toBe(true)
    expect(recordTilemapCell(tilemap, edit, index!, cell, 0, 0)).toBe(false)
    expect(edit.before.size).toBe(1)
    applyTilemapEdit(tilemap, edit, 'before')
    expect(tilemap.cells[1]).toBeNull()
    applyTilemapEdit(tilemap, edit, 'after')
    expect(tilemap.cells[1]).toEqual(cell)
  })

  it('extends complete grid cells across newly exposed canvas areas', () => {
    const tilemap = createTilemapCelData(4, 1, 2, 1)
    const first: TilemapCell = { tilesetId: 'tileset-1', tileId: 'tile-1' }
    const second: TilemapCell = { tilesetId: 'tileset-1', tileId: 'tile-2' }
    tilemap.cells[0] = first
    tilemap.cells[1] = second

    const resized = resizeTilemapCelDataToCanvas(tilemap, 2, 0, 8, 1)

    expect(resized).toMatchObject({ offsetX: 0, offsetY: 0 })
    expect(resized.tilemap).toMatchObject({ columns: 4, rows: 1 })
    expect(resized.tilemap.cells).toEqual([null, first, second, null])
    expect(tilemapCellIndexAtPoint(resized.tilemap, resized.offsetX, resized.offsetY, 0, 0)).toBe(0)
    expect(tilemapCellIndexAtPoint(resized.tilemap, resized.offsetX, resized.offsetY, 7, 0)).toBe(3)
  })

  it('trims only complete grid cells while preserving the grid phase', () => {
    const tilemap = createTilemapCelData(8, 1, 2, 1)
    tilemap.cells = tilemap.cells.map((_, index) => ({ tilesetId: 'tileset-1', tileId: `tile-${index}` }))

    const resized = resizeTilemapCelDataToCanvas(tilemap, -2, 0, 4, 1, true)

    expect(resized).toMatchObject({ offsetX: 0, offsetY: 0 })
    expect(resized.tilemap).toMatchObject({ columns: 2, rows: 1 })
    expect(resized.tilemap.cells.map((cell) => cell?.tileId)).toEqual(['tile-1', 'tile-2'])
  })

  it('fills every crossed grid cell during a fast diagonal drag', () => {
    const tilemap = createTilemapCelData(16, 12, 4, 4)
    expect(tilemapCellLineIndices(tilemap, 0, 11)).toEqual([0, 5, 6, 11])
  })

  it('expands disjoint pixel selections to complete touched cells without filling gaps', () => {
    const tilemap = createTilemapCelData(6, 2, 2, 2)
    const source = {
      x: 0,
      y: 0,
      width: 6,
      height: 2,
      mask: new Uint8Array([
        0, 1, 0, 0, 0, 1,
        0, 0, 0, 0, 0, 0
      ])
    }
    const expanded = expandSelectionToTilemapCells(source, tilemap, 0, 0, { x: 0, y: 0, width: 6, height: 2 })

    expect(expanded).not.toBeNull()
    expect(expanded && selectionContains(expanded, 0, 0)).toBe(true)
    expect(expanded && selectionContains(expanded, 1, 1)).toBe(true)
    expect(expanded && selectionContains(expanded, 2, 0)).toBe(false)
    expect(expanded && selectionContains(expanded, 3, 1)).toBe(false)
    expect(expanded && selectionContains(expanded, 4, 0)).toBe(true)
    expect(expanded && selectionContains(expanded, 5, 1)).toBe(true)
  })

  it('uses the shortest wrapped path when a drag crosses a repeated edge', () => {
    const tilemap = createTilemapCelData(16, 8, 4, 4)
    expect(tilemapCellLineIndices(tilemap, 3, 0, 'x')).toEqual([3, 0])
    expect(tilemapCellLineIndices(tilemap, 7, 0, 'both')).toEqual([7, 0])
  })

  it('drops a cell from history when a stroke returns it to its original tile', () => {
    const tilemap = createTilemapCelData(2, 1, 1, 1)
    const original: TilemapCell = { tilesetId: 'tileset-1', tileId: 'tile-1' }
    tilemap.cells[0] = original
    const edit = beginTilemapEdit('layer-1', 'frame-1')
    expect(recordTilemapCell(tilemap, edit, 0, null, 0, 0)).toBe(true)
    expect(recordTilemapCell(tilemap, edit, 0, original, 0, 0)).toBe(true)
    expect(edit.before.size).toBe(0)
    expect(edit.after.size).toBe(0)
  })

  it('rejects malformed non-empty cells during strict project decoding', () => {
    expect(normalizeTilemapCelData({
      tileWidth: 1,
      tileHeight: 1,
      columns: 2,
      rows: 1,
      cells: [null, { tilesetId: 'missing', tileId: 'missing' }]
    }, new Map(), true)).toBeNull()
  })

  it('does not rotate rectangular tiles into invalid sheet coordinates', () => {
    const tileset = createTilesetFromRgba(
      'tileset-rect',
      'Rectangular',
      2,
      1,
      new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]),
      2,
      1,
      () => 'tile-rect'
    )
    const tilemap = createTilemapCelData(2, 1, 2, 1)
    tilemap.cells[0] = { tilesetId: tileset.id, tileId: 'tile-rect', rotation: 1 }
    expect(Array.from(renderTilemapSurface(tilemap, [tileset], 'rgba').pixels)).toEqual([
      255, 0, 0, 255,
      0, 0, 255, 255
    ])
  })

  it('adds blank tiles into spare capacity and compacts pixels while preserving remaining IDs', () => {
    const tileset = createTilesetFromRgba(
      'tileset-crud',
      'CRUD',
      2,
      1,
      new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]),
      1,
      1,
      (index) => `tile-${index + 1}`
    )
    const deleted = deleteTilesetTile(tileset, 'tile-1')!
    expect(deleted.tileIds).toEqual(['tile-2'])
    expect(Array.from(readTilesetTilePixels(deleted, 'tile-2')!)).toEqual([0, 0, 255, 255])
    expect(deleted.rows).toBe(1)

    const appended = appendBlankTilesetTile(deleted, 'tile-3')
    expect(appended.tileIds).toEqual(['tile-2', 'tile-3'])
    expect(Array.from(readTilesetTilePixels(appended, 'tile-3')!)).toEqual([0, 0, 0, 0])
    expect(appended.rows).toBe(1)
  })

  it('deletes multiple tiles together while retaining one required tileset entry', () => {
    const tileset = createTilesetFromRgba(
      'tileset-batch-delete',
      'Batch Delete',
      3,
      1,
      new Uint8ClampedArray([
        255, 0, 0, 255,
        0, 255, 0, 255,
        0, 0, 255, 255
      ]),
      1,
      1,
      (index) => `tile-${index + 1}`
    )
    const deleted = deleteTilesetTiles(tileset, ['tile-1', 'tile-3'])!
    expect(deleted.tileIds).toEqual(['tile-2'])
    expect(Array.from(readTilesetTilePixels(deleted, 'tile-2')!)).toEqual([0, 255, 0, 255])

    const deleteAll = deleteTilesetTiles(tileset, tileset.tileIds)!
    expect(deleteAll.tileIds).toEqual(['tile-1'])
  })

  it('reorders atlas slots while preserving every stable tile ID and its pixels', () => {
    const tileset = createTilesetFromRgba(
      'tileset-reorder',
      'Reorder',
      3,
      1,
      new Uint8ClampedArray([
        220, 20, 30, 255,
        40, 190, 60, 255,
        30, 70, 220, 255
      ]),
      1,
      1,
      (index) => `tile-${index}`
    )
    const beforeById = new Map(tileset.tileIds.map((tileId) => [tileId, Array.from(readTilesetTilePixels(tileset, tileId)!)]))
    const reordered = reorderTilesetTiles(tileset, ['tile-2', 'tile-0', 'tile-1'])

    expect(reordered?.tileIds).toEqual(['tile-2', 'tile-0', 'tile-1'])
    for (const tileId of tileset.tileIds) expect(Array.from(readTilesetTilePixels(reordered!, tileId)!)).toEqual(beforeById.get(tileId))
    expect(reorderTilesetTiles(tileset, ['tile-0', 'tile-0', 'tile-2'])).toBeNull()
    expect(reorderTilesetTiles(tileset, ['tile-0', 'tile-1', 'missing'])).toBeNull()
  })

  it('repositions one or several tiles into occupied or empty layout slots', () => {
    const slots = ['tile-0', 'tile-1', null, null, null, null, null, null]

    expect(repositionTilesetTileSlots(slots, ['tile-0'], 5, 'tile-0', 4)).toEqual([
      null, 'tile-1', null, null, null, 'tile-0', null, null
    ])
    expect(repositionTilesetTileSlots(slots, ['tile-0', 'tile-1'], 6, 'tile-0', 4)).toEqual([
      null, null, null, null, null, null, 'tile-0', 'tile-1'
    ])
    expect(repositionTilesetTileSlots(['tile-0', 'tile-1', 'tile-2', null], ['tile-0'], 2, 'tile-0', 4)).toEqual([
      'tile-2', 'tile-1', 'tile-0', null
    ])
    expect(repositionTilesetTileSlots(slots, ['missing'], 5, 'missing', 4)).toEqual(slots)
  })

  it('stores sparse layout slots separately from compact tile pixels', () => {
    const tileset = createSolidTileset('tileset-layout', 'Layout', 1, 1, { r: 20, g: 40, b: 60, a: 255 }, 'tile-0')
    const moved = setTilesetTileSlots(tileset, [null, null, null, 'tile-0'])

    expect(moved?.tileSlots).toEqual([null, null, null, 'tile-0'])
    expect(moved?.tileIds).toEqual(['tile-0'])
    expect(Array.from(readTilesetTilePixels(moved!, 'tile-0')!)).toEqual([20, 40, 60, 255])
    expect(setTilesetTileSlots(tileset, [null, null])).toBeNull()
  })
})
