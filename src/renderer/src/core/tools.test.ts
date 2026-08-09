import { describe, expect, it } from 'vitest'
import { compositeRegion, createDocument, createLayer, DocumentCompositeCache, getActiveLayer, readLayerColor, readLayerColorAt, resizeDocumentAt, writeLayerColor } from './document'
import { beginPixelEdit, commitPixelEdit, HistoryStack } from './history'
import { appendPerfectPixelSegment, applySelectionTransform, applySelectionTranslationPreview, brushMaskOffsets, brushStampAnchor, brushStampDimensions, captureSelectionTransform, clearSelection, fillSelectionOrCanvas, flipLayer, flipSelection, floodFill, floodFillSymmetric, moveSelection, outlinePixelIndices, outlineSelection, paintBrush, paintLine, paintShape, selectionTranslationPreviewEdit } from './tools'
import { combineSelection, ellipseSelection, lassoSelection, magicWandSelection, rotatedSelectionBounds, selectionBoundarySegments, selectionContains, transformedSelectionBounds, transformSelectionMask } from './selection'
import { resizeDocument } from './document'
import { createProceduralBrush, createProceduralBrushes, createSelectionBrush, proceduralBrushCoverageAt } from './brushes'
import { packColor, unpackColor } from './raster'

const blue = { r: 41, g: 121, b: 255, a: 255 }
const red = { r: 255, g: 48, b: 48, a: 255 }

describe('pixel tools', () => {
  it('removes redundant perfect-pixel corners after fast pointer movement', () => {
    const path = [{ x: 2, y: 1 }]
    expect(appendPerfectPixelSegment(path, { x: 2, y: 6 })).toBe(false)
    expect(appendPerfectPixelSegment(path, { x: 8, y: 6 })).toBe(true)
    expect(path).toContainEqual({ x: 2, y: 5 })
    expect(path).not.toContainEqual({ x: 2, y: 6 })
    expect(path).toContainEqual({ x: 3, y: 6 })
  })

  it('cleans both outer corners without changing diagonal or reversed paths', () => {
    const corners = [{ x: 1, y: 4 }]
    appendPerfectPixelSegment(corners, { x: 6, y: 4 })
    expect(appendPerfectPixelSegment(corners, { x: 6, y: 1 })).toBe(true)
    expect(corners).not.toContainEqual({ x: 6, y: 4 })

    const diagonal = [{ x: 0, y: 0 }]
    expect(appendPerfectPixelSegment(diagonal, { x: 4, y: 4 })).toBe(false)
    expect(diagonal).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }, { x: 4, y: 4 }])
    expect(appendPerfectPixelSegment(diagonal, { x: 2, y: 2 })).toBe(false)
  })

  it('creates deterministic grayscale procedural brushes', () => {
    const first = createProceduralBrushes()
    const second = createProceduralBrushes()
    expect(first.map((brush) => brush.id)).toEqual(['procedural:noise', 'procedural:clouds', 'procedural:cells', 'procedural:fibers'])
    for (let index = 0; index < first.length; index += 1) {
      expect(first[index].coverage).toEqual(second[index].coverage)
      expect(new Set(first[index].coverage).size).toBeGreaterThan(8)
    }
  })

  it('paints a selection brush with its captured source colors', () => {
    const document = createDocument('colored brush', 4, 2, 'rgba')
    const layer = getActiveLayer(document)
    const brush = {
      id: 'project-brush-test',
      name: 'Captured colors',
      width: 2,
      height: 1,
      coverage: new Uint8Array([255, 255]),
      colors: new Uint32Array([
        0xff0000ff,
        0xff00ff00
      ]),
      intrinsicSize: true,
      sourceX: 0,
      sourceY: 0
    }
    const edit = beginPixelEdit(layer.id)

    paintBrush(document, layer, edit, 1, 0, 1, { r: 255, g: 255, b: 255, a: 255 }, 'square', null, 'solid', 1, brush, undefined, 0, 'pattern-source')

    expect(readLayerColor(document, layer, 0)).toEqual({ r: 255, g: 0, b: 0, a: 255 })
    expect(readLayerColor(document, layer, 1)).toEqual({ r: 0, g: 255, b: 0, a: 255 })
  })

  it('captures every non-transparent selection pixel and its original color', () => {
    const document = createDocument('capture colored selection', 3, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, { r: 245, g: 80, b: 20, a: 255 })
    writeLayerColor(document, layer, 1, { r: 20, g: 180, b: 240, a: 128 })

    const brush = createSelectionBrush(document, { x: 0, y: 0, width: 2, height: 1 }, 'project-brush-capture', 'Captured')

    expect(brush).not.toBeNull()
    expect(Array.from(brush?.coverage ?? [])).toEqual([255, 128])
    expect(unpackColor(brush?.colors?.[0] ?? packColor({ r: 0, g: 0, b: 0, a: 0 }))).toEqual({ r: 245, g: 80, b: 20, a: 255 })
    expect(unpackColor(brush?.colors?.[1] ?? 0)).toEqual({ r: 20, g: 180, b: 240, a: 128 })
  })

  it('captures old offset layers using canvas coordinates', () => {
    const document = createDocument('capture offset selection', 4, 1, 'rgba')
    const layer = getActiveLayer(document)
    layer.width = 2
    layer.height = 1
    layer.offsetX = 1
    layer.pixels = new Uint8ClampedArray(2 * 4)
    writeLayerColor(document, layer, 0, { r: 220, g: 40, b: 30, a: 255 })
    writeLayerColor(document, layer, 1, { r: 30, g: 140, b: 230, a: 255 })

    const brush = createSelectionBrush(document, { x: 1, y: 0, width: 2, height: 1 }, 'project-brush-offset', 'Offset')

    expect(brush).not.toBeNull()
    expect(unpackColor(brush?.colors?.[0] ?? 0)).toEqual({ r: 220, g: 40, b: 30, a: 255 })
    expect(unpackColor(brush?.colors?.[1] ?? 0)).toEqual({ r: 30, g: 140, b: 230, a: 255 })
  })

  it('remaps captured brush colors without changing its shape', () => {
    const document = createDocument('colored brush remap', 2, 1, 'rgba')
    const layer = getActiveLayer(document)
    const brush = {
      id: 'project-brush-remap-test',
      name: 'Captured colors',
      width: 2,
      height: 1,
      coverage: new Uint8Array([255, 255]),
      colors: new Uint32Array([0xff0000ff, 0xff00ff00]),
      paintColors: new Uint32Array([0xff1e140a, 0xffdcd2c8]),
      intrinsicSize: true
    }
    const edit = beginPixelEdit(layer.id)

    paintBrush(document, layer, edit, 1, 0, 1, { r: 255, g: 255, b: 255, a: 255 }, 'square', null, 'solid', 1, brush, undefined, 0, 'paint')

    expect(readLayerColor(document, layer, 0)).toEqual({ r: 10, g: 20, b: 30, a: 255 })
    expect(readLayerColor(document, layer, 1)).toEqual({ r: 200, g: 210, b: 220, a: 255 })
  })

  it('generates procedural fill coverage continuously instead of repeating a tile', () => {
    const first = Array.from({ length: 64 }, (_, x) => proceduralBrushCoverageAt('procedural:clouds', x, 7, 64))
    const second = Array.from({ length: 64 }, (_, x) => proceduralBrushCoverageAt('procedural:clouds', x + 64, 7, 64))
    expect(second).not.toEqual(first)
  })

  it('applies independent parameters to every procedural texture', () => {
    const variants = [
      ['procedural:noise', { seed: 311, scale: 6, detail: 78, variation: 82, angle: 0 }],
      ['procedural:clouds', { seed: 313, scale: 46, detail: 1, variation: 80, angle: 0 }],
      ['procedural:cells', { seed: 317, scale: 25, detail: 72, variation: 12, angle: 0 }],
      ['procedural:fibers', { seed: 319, scale: 18, detail: 86, variation: 75, angle: 25 }]
    ] as const
    for (const [id, settings] of variants) {
      const baseline = Array.from({ length: 32 * 32 }, (_, index) => proceduralBrushCoverageAt(id, index % 32, Math.floor(index / 32), 64))
      const customized = Array.from({ length: 32 * 32 }, (_, index) => proceduralBrushCoverageAt(id, index % 32, Math.floor(index / 32), 64, settings))
      expect(customized).not.toEqual(baseline)
      expect(new Set(customized).size).toBeGreaterThan(4)
    }
  })

  it('embeds normalized procedural settings in the generated brush', () => {
    const brush = createProceduralBrush('procedural:fibers', { scale: 999, detail: -10, variation: 130, angle: 220, seed: 12000 })
    expect(brush.proceduralSettings).toEqual({ scale: 32, detail: 0, variation: 100, angle: 180, seed: 9999 })
  })

  it('fills every point along a raster line and can undo it', () => {
    const document = createDocument('line', 8, 8, 'rgba')
    const layer = getActiveLayer(document)
    const edit = beginPixelEdit(layer.id)
    paintLine(document, layer, edit, 0, 0, 7, 7, 1, blue)
    expect(edit.before.size).toBe(8)
    const entry = commitPixelEdit(document, edit, 'line')!
    const history = new HistoryStack()
    history.push(entry)
    history.undo()
    expect(readLayerColor(document, layer, 0).a).toBe(0)
    history.redo()
    expect(readLayerColor(document, layer, 7 * 8 + 7)).toEqual(blue)
  })

  it('paints a balanced Shift line from the same stair points used by its preview', () => {
    const document = createDocument('balanced line', 9, 3, 'rgba')
    const layer = getActiveLayer(document)
    const edit = beginPixelEdit(layer.id)

    paintLine(document, layer, edit, 0, 0, 8, 2, 1, blue, null, 'square', 'solid', 1, null, undefined, 0, 'paint', undefined, 'balanced')

    const rows = Array.from({ length: 3 }, (_, y) => Array.from({ length: 9 }, (_, x) => readLayerColorAt(document, layer, x, y).a > 0 ? 1 : 0))
    expect(rows).toEqual([
      [1, 1, 1, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 1, 1, 1, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 1, 1, 1]
    ])
  })

  it('keeps an already painted anchor inside the first six-pixel stair', () => {
    const document = createDocument('anchored six-pixel stair', 18, 3, 'rgba')
    const layer = getActiveLayer(document)
    paintBrush(document, layer, beginPixelEdit(layer.id), 0, 0, 1, blue, 'square', null)

    paintLine(document, layer, beginPixelEdit(layer.id), 0, 0, 17, 2, 1, blue, null, 'square', 'solid', 1, null, undefined, 0, 'paint', undefined, 'balanced')

    const runs = Array.from({ length: 3 }, (_, y) => Array.from({ length: 18 }, (_, x) => readLayerColorAt(document, layer, x, y).a > 0).filter(Boolean).length)
    expect(runs).toEqual([6, 6, 6])
  })

  it('fills only the contiguous matching area', () => {
    const document = createDocument('fill', 4, 4, 'rgba')
    const layer = getActiveLayer(document)
    const divider = beginPixelEdit(layer.id)
    paintLine(document, layer, divider, 2, 0, 2, 3, 1, blue)
    const fill = floodFill(document, layer, 0, 0, { r: 255, g: 0, b: 0, a: 255 })!
    expect(fill.before.size).toBe(8)
  })

  it('fills and undoes a region larger than the initial typed fill stack', () => {
    const document = createDocument('large fill', 48, 48, 'rgba')
    const layer = getActiveLayer(document)
    const edit = floodFill(document, layer, 0, 0, red)!

    expect(edit.before.size).toBe(48 * 48)
    expect(edit.dirtyRect).toEqual({ x: 0, y: 0, width: 48, height: 48 })
    const entry = commitPixelEdit(document, edit, 'large fill')!
    entry.undo()
    expect(readLayerColorAt(document, layer, 47, 47).a).toBe(0)
    entry.redo()
    expect(readLayerColorAt(document, layer, 47, 47)).toEqual(red)
  })

  it('stores a large solid fill as row runs instead of one history entry per pixel', () => {
    const document = createDocument('compact fill', 512, 512, 'rgba')
    const layer = getActiveLayer(document)
    const edit = floodFill(document, layer, 0, 0, red)!

    expect(edit.before.size).toBe(0)
    expect(edit.runs).toHaveLength(512)
    expect(edit.dirtyRect).toEqual({ x: 0, y: 0, width: 512, height: 512 })
    const entry = commitPixelEdit(document, edit, 'compact fill')!
    entry.undo()
    expect(readLayerColorAt(document, layer, 511, 511).a).toBe(0)
    entry.redo()
    expect(readLayerColorAt(document, layer, 511, 511)).toEqual(red)
  })

  it('fills a selected region using canvas coordinates on an offset layer', () => {
    const document = createDocument('offset fill', 6, 4, 'rgba')
    const layer = getActiveLayer(document)
    layer.offsetX = 2
    layer.offsetY = 1
    const selection = { x: 3, y: 1, width: 2, height: 2 }
    const edit = floodFill(document, layer, 3, 1, blue, selection, true)
    expect(edit?.before.size).toBe(4)
    expect(readLayerColorAt(document, layer, 3, 1)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 4, 2)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 2, 1).a).toBe(0)
    expect(readLayerColorAt(document, layer, 5, 2).a).toBe(0)
  })

  it('expands a cropped layer before painting in an uncovered canvas corner', () => {
    const document = createDocument('cropped brush', 6, 5, 'rgba')
    const layer = getActiveLayer(document)
    if (layer.format !== 'rgba') throw new Error('wrong layer mode')
    layer.width = 2
    layer.height = 2
    layer.offsetX = 1
    layer.offsetY = 1
    layer.pixels = new Uint8ClampedArray(2 * 2 * 4)
    const edit = beginPixelEdit(layer.id)

    paintBrush(document, layer, edit, 5, 4, 1, blue, 'square')

    expect(readLayerColorAt(document, layer, 5, 4)).toEqual(blue)
    expect(layer.offsetX).toBe(0)
    expect(layer.offsetY).toBe(0)
    expect(layer.width).toBe(6)
    expect(layer.height).toBe(5)
  })

  it('keeps older pixel history aligned after expanding a moved layer', () => {
    const document = createDocument('history expansion', 3, 3, 'rgba')
    const layer = getActiveLayer(document)
    const firstEdit = beginPixelEdit(layer.id)
    paintBrush(document, layer, firstEdit, 1, 1, 1, blue, 'square')
    const firstEntry = commitPixelEdit(document, firstEdit, 'first pixel')!
    const history = new HistoryStack()
    history.push(firstEntry)

    layer.offsetX = 1
    const secondEdit = beginPixelEdit(layer.id)
    paintBrush(document, layer, secondEdit, 0, 0, 1, blue, 'square')
    expect(readLayerColorAt(document, layer, 2, 1)).toEqual(blue)

    history.undo()
    expect(readLayerColorAt(document, layer, 2, 1).a).toBe(0)
    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(blue)
  })

  it('groups multiple history entries into one undo step', () => {
    const history = new HistoryStack()
    const values: number[] = []
    history.beginCompound()
    history.push({ label: 'one', bytes: 1, undo: () => { values.pop() }, redo: () => { values.push(1) } })
    history.push({ label: 'two', bytes: 1, undo: () => { values.pop() }, redo: () => { values.push(2) } })
    history.endCompound('compound')
    values.push(1, 2)

    history.undo()
    expect(values).toEqual([])
    expect(history.canUndo).toBe(false)
    history.redo()
    expect(values).toEqual([1, 2])
  })

  it('uses canvas coordinates for shapes, clearing, and outlines on an offset layer', () => {
    const document = createDocument('offset editing', 5, 4, 'rgba')
    const layer = getActiveLayer(document)
    layer.offsetX = 2
    layer.offsetY = 1
    const shapeEdit = beginPixelEdit(layer.id)
    paintShape(document, layer, shapeEdit, { x: 4, y: 3, width: 1, height: 1 }, 'rectangle', blue)
    expect(readLayerColorAt(document, layer, 4, 3)).toEqual(blue)

    const outlined = outlineSelection(document, layer, { x: 4, y: 3, width: 1, height: 1 }, { r: 255, g: 0, b: 0, a: 255 }, 1, 'outside')
    expect(outlined).not.toBeNull()
    expect(readLayerColorAt(document, layer, 3, 3).a).toBe(255)

    const cleared = clearSelection(document, { x: 4, y: 3, width: 1, height: 1 })
    expect(cleared?.before.size).toBe(1)
    expect(readLayerColorAt(document, layer, 4, 3).a).toBe(0)
  })

  it('flood fills transparent canvas pixels outside a cropped layer bitmap', () => {
    const document = createDocument('cropped fill', 4, 3, 'indexed')
    const layer = getActiveLayer(document)
    if (layer.format !== 'indexed') throw new Error('wrong layer mode')
    layer.width = 1
    layer.height = 1
    layer.offsetX = 1
    layer.offsetY = 1
    layer.pixels = new Uint32Array(1)

    const edit = floodFill(document, layer, 3, 2, blue)

    expect(edit?.before.size).toBe(12)
    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 3, 2)).toEqual(blue)
  })

  it('fills only selected mask pixels with the foreground color', () => {
    const document = createDocument('foreground fill', 3, 2, 'rgba')
    const layer = getActiveLayer(document)
    const selection = { x: 0, y: 0, width: 3, height: 2, mask: Uint8Array.from([1, 0, 0, 0, 0, 1]) }
    const edit = fillSelectionOrCanvas(document, layer, blue, selection)
    expect(edit?.before.size).toBe(2)
    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 2, 1)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 1, 0).a).toBe(0)
  })

  it('fills an indexed canvas without changing its color mode', () => {
    const document = createDocument('indexed foreground fill', 2, 1, 'indexed')
    const layer = getActiveLayer(document)
    const edit = fillSelectionOrCanvas(document, layer, blue)
    expect(edit?.before.size).toBe(2)
    expect(document.colorMode).toBe('indexed')
    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 1, 0)).toEqual(blue)
  })

  it('replaces existing pixels with the exact foreground alpha', () => {
    const document = createDocument('exact foreground fill', 1, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, { r: 255, g: 0, b: 0, a: 255 })
    const translucentBlue = { ...blue, a: 96 }
    fillSelectionOrCanvas(document, layer, translucentBlue)
    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(translucentBlue)
  })

  it('traverses the whole contiguous region before applying a tiled texture', () => {
    const document = createDocument('texture fill', 4, 1, 'rgba')
    const layer = getActiveLayer(document)
    const texture = { id: 'stripe', name: 'stripe', width: 2, height: 1, coverage: new Uint8Array([255, 0]) }
    const edit = floodFill(document, layer, 1, 0, blue, null, true, texture, 2)!
    expect(edit.before.size).toBe(2)
    expect(readLayerColor(document, layer, 0)).toEqual(blue)
    expect(readLayerColor(document, layer, 1).a).toBe(0)
    expect(readLayerColor(document, layer, 2)).toEqual(blue)
    expect(readLayerColor(document, layer, 3).a).toBe(0)
  })

  it('moves selected indexed pixels and clears the source', () => {
    const document = createDocument('move', 4, 4, 'indexed')
    const layer = getActiveLayer(document)
    if (layer.format !== 'indexed') throw new Error('wrong layer mode')
    layer.pixels[0] = 2
    const edit = moveSelection(document, { x: 0, y: 0, width: 1, height: 1 }, 2, 1)!
    expect(edit.before.size).toBe(2)
    expect(layer.pixels[0]).toBe(0)
    expect(layer.pixels[1 * 4 + 2]).toBe(2)
  })

  it('copies selected pixels only when copy mode is requested', () => {
    const document = createDocument('copy', 4, 1, 'indexed')
    const layer = getActiveLayer(document)
    if (layer.format !== 'indexed') throw new Error('wrong layer mode')
    layer.pixels[0] = 2
    moveSelection(document, { x: 0, y: 0, width: 1, height: 1 }, 2, 0, true)
    expect(layer.pixels[0]).toBe(2)
    expect(layer.pixels[2]).toBe(2)
  })

  it('flips selected pixels in place without affecting pixels outside the selection', () => {
    const document = createDocument('flip selection', 5, 1, 'rgba')
    const layer = getActiveLayer(document)
    const green = { r: 40, g: 220, b: 90, a: 255 }
    writeLayerColor(document, layer, 1, blue)
    writeLayerColor(document, layer, 2, green)
    writeLayerColor(document, layer, 3, red)

    const edit = flipSelection(document, { x: 1, y: 0, width: 3, height: 1 }, 'horizontal')
    expect(edit).not.toBeNull()
    expect(readLayerColor(document, layer, 0)).toEqual({ r: 0, g: 0, b: 0, a: 0 })
    expect(readLayerColor(document, layer, 1)).toEqual(red)
    expect(readLayerColor(document, layer, 2)).toEqual(green)
    expect(readLayerColor(document, layer, 3)).toEqual(blue)
    expect(readLayerColor(document, layer, 4)).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })

  it('flips the complete active layer bitmap when no selection is used', () => {
    const document = createDocument('flip layer', 4, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, blue)
    writeLayerColor(document, layer, 1, red)

    const edit = flipLayer(document, 'horizontal')
    expect(edit).not.toBeNull()
    expect(readLayerColor(document, layer, 0)).toEqual({ r: 0, g: 0, b: 0, a: 0 })
    expect(readLayerColor(document, layer, 1)).toEqual({ r: 0, g: 0, b: 0, a: 0 })
    expect(readLayerColor(document, layer, 2)).toEqual(red)
    expect(readLayerColor(document, layer, 3)).toEqual(blue)
  })

  it('moves a full-canvas selection while clipping pixels that leave the canvas', () => {
    const document = createDocument('full canvas move', 3, 1, 'indexed')
    const layer = getActiveLayer(document)
    if (layer.format !== 'indexed') throw new Error('wrong layer mode')
    layer.pixels.set([2, 2, 2])

    moveSelection(document, { x: 0, y: 0, width: 3, height: 1 }, 1, 0)

    expect(Array.from(layer.pixels)).toEqual([0, 2, 2])
  })

  it('never writes transparent source pixels while moving a selection', () => {
    const document = createDocument('transparent move', 4, 1, 'rgba')
    const layer = getActiveLayer(document)
    const red = { r: 255, g: 0, b: 0, a: 255 }
    const destination = { r: 20, g: 200, b: 80, a: 255 }
    writeLayerColor(document, layer, 0, red)
    writeLayerColor(document, layer, 3, destination)
    moveSelection(document, { x: 0, y: 0, width: 2, height: 1 }, 2, 0)
    expect(readLayerColor(document, layer, 0).a).toBe(0)
    expect(readLayerColor(document, layer, 2)).toEqual(red)
    expect(readLayerColor(document, layer, 3)).toEqual(destination)
  })

  it('moves only selected pixels through an irregular-mask translation', () => {
    const document = createDocument('masked move', 6, 2, 'rgba')
    const layer = getActiveLayer(document)
    const red = { r: 255, g: 0, b: 0, a: 255 }
    const green = { r: 0, g: 255, b: 0, a: 255 }
    writeLayerColor(document, layer, 0, red)
    writeLayerColor(document, layer, 1, green)
    const selection = { x: 0, y: 0, width: 2, height: 1, mask: Uint8Array.from([1, 0]) }

    moveSelection(document, selection, 3, 0)

    expect(readLayerColor(document, layer, 0).a).toBe(0)
    expect(readLayerColor(document, layer, 1)).toEqual(green)
    expect(readLayerColor(document, layer, 3)).toEqual(red)
    expect(readLayerColor(document, layer, 4).a).toBe(0)
  })

  it('reuses a typed preview buffer while moving an irregular selection', () => {
    const document = createDocument('preview move', 6, 2, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, blue)
    writeLayerColor(document, layer, 1, { r: 255, g: 0, b: 0, a: 255 })
    const selection = { x: 0, y: 0, width: 2, height: 1, mask: Uint8Array.from([1, 0]) }
    const source = captureSelectionTransform(document, selection)!

    const first = applySelectionTranslationPreview(document, source, { ...selection, x: 2, y: 0 })
    expect(readLayerColor(document, layer, 2)).toEqual(blue)
    const second = applySelectionTranslationPreview(document, source, { ...selection, x: 3, y: 0 }, false, first)
    expect(second).toBe(first)
    expect(readLayerColor(document, layer, 2).a).toBe(0)
    expect(readLayerColor(document, layer, 3)).toEqual(blue)
    expect(selectionTranslationPreviewEdit(document, second)?.before.size).toBe(2)
  })

  it('invalidates cached opaque ranges after a selection translation preview', () => {
    const document = createDocument('cached preview move', 6, 1, 'rgba')
    const layer = getActiveLayer(document)
    document.layers.push(createLayer('empty layer', document.width, document.height, 'rgba'))
    writeLayerColor(document, layer, 0, red)
    const cache = new DocumentCompositeCache()
    compositeRegion(document, 0, 0, document.width, document.height, cache)
    const selection = { x: 0, y: 0, width: 1, height: 1 }
    const source = captureSelectionTransform(document, selection)!

    applySelectionTranslationPreview(document, source, { ...selection, x: 4 })

    const composite = compositeRegion(document, 0, 0, document.width, document.height, cache)
    expect(Array.from(composite.slice(4 * 4, 4 * 4 + 4))).toEqual([red.r, red.g, red.b, red.a])
  })

  it('moves a selection in canvas coordinates on a cropped offset layer', () => {
    const document = createDocument('legacy offset selection', 6, 4, 'rgba')
    const layer = getActiveLayer(document)
    if (layer.format !== 'rgba') throw new Error('wrong layer mode')
    layer.width = 2
    layer.height = 2
    layer.offsetX = 2
    layer.offsetY = 1
    layer.pixels = new Uint8ClampedArray(2 * 2 * 4)
    writeLayerColor(document, layer, 0, blue)
    const selection = { x: 2, y: 1, width: 1, height: 1 }

    const source = captureSelectionTransform(document, selection)!
    expect(source.opaqueValues).toHaveLength(1)
    applySelectionTransform(document, source, { ...selection, x: 4, y: 2 })

    expect(readLayerColorAt(document, layer, 2, 1).a).toBe(0)
    expect(readLayerColorAt(document, layer, 4, 2)).toEqual(blue)
  })

  it('keeps offset-layer selection preview and history aligned after expansion', () => {
    const document = createDocument('legacy offset preview', 6, 4, 'rgba')
    const layer = getActiveLayer(document)
    if (layer.format !== 'rgba') throw new Error('wrong layer mode')
    layer.width = 2
    layer.height = 2
    layer.offsetX = 2
    layer.offsetY = 1
    layer.pixels = new Uint8ClampedArray(2 * 2 * 4)
    writeLayerColor(document, layer, 0, blue)
    const selection = { x: 2, y: 1, width: 1, height: 1 }
    const source = captureSelectionTransform(document, selection)!

    const preview = applySelectionTranslationPreview(document, source, { ...selection, x: 4, y: 2 })
    expect(readLayerColorAt(document, layer, 2, 1).a).toBe(0)
    expect(readLayerColorAt(document, layer, 4, 2)).toEqual(blue)

    const edit = selectionTranslationPreviewEdit(document, preview)!
    const entry = commitPixelEdit(document, edit, 'move legacy selection')!
    const history = new HistoryStack()
    history.push(entry)
    history.undo()
    expect(readLayerColorAt(document, layer, 2, 1)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 4, 2).a).toBe(0)
    history.redo()
    expect(readLayerColorAt(document, layer, 2, 1).a).toBe(0)
    expect(readLayerColorAt(document, layer, 4, 2)).toEqual(blue)
  })

  it('draws a round brush and a rectangle with one pixel history edit', () => {
    const document = createDocument('shapes', 5, 5, 'rgba')
    const layer = getActiveLayer(document)
    const edit = beginPixelEdit(layer.id)
    paintLine(document, layer, edit, 2, 2, 2, 2, 3, blue, null, 'round')
    expect(edit.before.size).toBe(9)
    const shapeEdit = beginPixelEdit(layer.id)
    paintShape(document, layer, shapeEdit, { x: 0, y: 0, width: 2, height: 2 }, 'rectangle', blue)
    expect(shapeEdit.before.size).toBe(3)
  })

  it('draws hollow rectangles and ellipses without filling their centers', () => {
    const document = createDocument('outline shapes', 7, 7, 'rgba')
    const layer = getActiveLayer(document)
    const rectangleEdit = beginPixelEdit(layer.id)
    paintShape(document, layer, rectangleEdit, { x: 0, y: 0, width: 5, height: 5 }, 'rectangle-outline', blue)
    expect(readLayerColorAt(document, layer, 0, 0).a).toBe(255)
    expect(readLayerColorAt(document, layer, 2, 2).a).toBe(0)

    const ellipseEdit = beginPixelEdit(layer.id)
    paintShape(document, layer, ellipseEdit, { x: 1, y: 1, width: 5, height: 5 }, 'ellipse-outline', blue)
    expect(readLayerColorAt(document, layer, 3, 1).a).toBe(255)
    expect(readLayerColorAt(document, layer, 3, 3).a).toBe(0)
  })

  it('clips an off-center brush stamp to an irregular selection', () => {
    const document = createDocument('brush selection overlap', 7, 5, 'rgba')
    const layer = getActiveLayer(document)
    const edit = beginPixelEdit(layer.id)
    const selection = { x: 3, y: 2, width: 1, height: 1, mask: Uint8Array.from([1]) }

    // The 5px stamp center is outside the selection, but its footprint overlaps it.
    paintBrush(document, layer, edit, 1, 2, 5, blue, 'square', selection)

    expect(readLayerColor(document, layer, 3 + 2 * document.width)).toEqual(blue)
    expect(edit.before.size).toBe(1)
  })

  it('uses deterministic scaled masks for built-in texture brushes', () => {
    const solid = brushMaskOffsets(8, 'square')
    const cracks = brushMaskOffsets(8, 'square', 'cracks', 1, 0, 0)
    const largeCracks = brushMaskOffsets(8, 'square', 'cracks', 3, 0, 0)
    expect(cracks.length).toBeGreaterThan(0)
    expect(cracks.length).toBeLessThan(solid.length)
    expect(largeCracks).not.toEqual(cracks)

    const document = createDocument('texture brush', 12, 12, 'rgba')
    const layer = getActiveLayer(document)
    const edit = beginPixelEdit(layer.id)
    const centeredCracks = brushMaskOffsets(8, 'square', 'cracks', 1, 3, 3)
    paintLine(document, layer, edit, 6, 6, 6, 6, 8, blue, null, 'square', 'cracks', 1)
    expect(edit.before.size).toBe(centeredCracks.length)
  })

  it('uses grayscale image brush values as a one-color dithered stamp and skips black pixels', () => {
    const document = createDocument('gray brush', 4, 4, 'rgba')
    const layer = getActiveLayer(document)
    const edit = beginPixelEdit(layer.id)
    const coverage = new Uint8Array(16).fill(128)
    coverage[1] = 255
    coverage[2] = 0
    const brush = { id: 'gray.png', name: 'gray', width: 4, height: 4, coverage }
    paintBrush(document, layer, edit, 2, 2, 4, blue, 'square', null, 'solid', 1, brush)
    expect(edit.before.size).toBe(8)
    expect(readLayerColor(document, layer, 0)).toEqual(blue)
    expect(readLayerColor(document, layer, 1)).toEqual(blue)
    expect(readLayerColor(document, layer, 2).a).toBe(0)
    for (let index = 0; index < 16; index += 1) {
      const color = readLayerColor(document, layer, index)
      if (color.a > 0) expect(color).toEqual(blue)
    }
  })

  it('keeps selection-created brushes at their intrinsic rectangular dimensions', () => {
    const document = createDocument('selection brush', 5, 5, 'rgba')
    const layer = getActiveLayer(document)
    const edit = beginPixelEdit(layer.id)
    const brush = { id: 'temporary:selection:test', name: 'selection', width: 3, height: 2, coverage: new Uint8Array(6).fill(255), intrinsicSize: true }

    expect(brushStampDimensions(99, brush)).toEqual({ width: 3, height: 2 })
    expect(brushStampAnchor(99, brush)).toEqual({ x: 1, y: 1 })
    expect(brushMaskOffsets(99, 'square', 'solid', 1, 0, 0, brush)).toHaveLength(6)
    paintBrush(document, layer, edit, 2, 2, 99, blue, 'square', null, 'solid', 1, brush)

    expect(edit.before.size).toBe(6)
    expect(readLayerColor(document, layer, 1 * document.width + 1)).toEqual(blue)
    expect(readLayerColor(document, layer, 2 * document.width + 3)).toEqual(blue)
    expect(readLayerColor(document, layer, 3 * document.width + 2).a).toBe(0)
  })

  it('uses the lower-right center pixel as the pointer anchor for even brush sizes', () => {
    expect(brushStampAnchor(1)).toEqual({ x: 0, y: 0 })
    expect(brushStampAnchor(2)).toEqual({ x: 1, y: 1 })
    expect(brushStampAnchor(3)).toEqual({ x: 1, y: 1 })
    expect(brushStampAnchor(4)).toEqual({ x: 2, y: 2 })

    const document = createDocument('even brush anchor', 4, 4, 'rgba')
    const layer = getActiveLayer(document)
    paintBrush(document, layer, beginPixelEdit(layer.id), 2, 2, 2, blue, 'square')

    expect(readLayerColor(document, layer, 1 * document.width + 1)).toEqual(blue)
    expect(readLayerColor(document, layer, 2 * document.width + 2)).toEqual(blue)
    expect(readLayerColor(document, layer, 1 * document.width + 3).a).toBe(0)
    expect(readLayerColor(document, layer, 3 * document.width + 1).a).toBe(0)
  })

  it('adds one low-strength intermediate level only to procedural textures', () => {
    const procedural = createProceduralBrushes()[0]
    const settings = { mode: 'threshold' as const, threshold: 128, blackPoint: 0, whitePoint: 255, invert: false }
    const mask = brushMaskOffsets(64, 'square', 'solid', 1, 0, 0, procedural, settings, 20)
    expect(new Set(mask.map((point) => point.coverage))).toEqual(new Set([128, 255]))
  })

  it('keeps local grayscale image brushes hard-edged when procedural antialiasing is enabled', () => {
    const local = { id: 'local.png', name: 'local', width: 4, height: 1, coverage: new Uint8Array([127, 128, 140, 255]) }
    const settings = { mode: 'threshold' as const, threshold: 128, blackPoint: 0, whitePoint: 255, invert: false }
    const mask = brushMaskOffsets(4, 'square', 'solid', 1, 0, 0, local, settings, 100)
    expect(mask).toHaveLength(12)
    expect(new Set(mask.map((point) => point.x))).toEqual(new Set([1, 2, 3]))
    expect(mask.every((point) => point.coverage === 255)).toBe(true)
  })

  it('aligns image patterns to their canvas source or current target coordinates', () => {
    const brush = { id: 'stripe.png', name: 'stripe', width: 2, height: 1, coverage: new Uint8Array([255, 0]) }
    const source = brushMaskOffsets(4, 'square', 'solid', 1, 1, 0, brush, undefined, 0, 'pattern-source')
    const target = brushMaskOffsets(4, 'square', 'solid', 1, 1, 0, brush, undefined, 0, 'pattern-target')
    const paint = brushMaskOffsets(4, 'square', 'solid', 1, 1, 0, brush, undefined, 0, 'paint')

    expect([...new Set(source.map((point) => point.x))]).toEqual([1, 3])
    expect([...new Set(target.map((point) => point.x))]).toEqual([0, 2])
    expect([...new Set(paint.map((point) => point.x))]).toEqual([0, 1])
  })

  it('uses the source or first target stamp as the custom brush pattern anchor', () => {
    const brush = { id: 'selection.png', name: 'selection', width: 2, height: 1, coverage: new Uint8Array([255, 0]), intrinsicSize: true, sourceX: 3, sourceY: 0 }
    const source = brushMaskOffsets(2, 'square', 'solid', 1, 4, 0, brush, undefined, 0, 'pattern-source')
    const target = brushMaskOffsets(2, 'square', 'solid', 1, 4, 0, brush, undefined, 0, 'pattern-target')
    const continuedTarget = brushMaskOffsets(2, 'square', 'solid', 1, 5, 0, brush, undefined, 0, 'pattern-target', 4, 0)
    const paint = brushMaskOffsets(2, 'square', 'solid', 1, 4, 0, brush, undefined, 0, 'paint')

    expect(source.map((point) => point.x)).toEqual([1])
    expect(target.map((point) => point.x)).toEqual([0])
    expect(continuedTarget.map((point) => point.x)).toEqual([1])
    expect(paint.map((point) => point.x)).toEqual([0])
  })

  it('uses source and clicked-target phases consistently for patterned bucket fills', () => {
    const brush = { id: 'selection.png', name: 'selection', width: 2, height: 1, coverage: new Uint8Array([255, 0]), intrinsicSize: true, sourceX: 1, sourceY: 0 }
    const sourceDocument = createDocument('source fill', 6, 1, 'rgba')
    const targetDocument = createDocument('target fill', 6, 1, 'rgba')

    floodFill(sourceDocument, getActiveLayer(sourceDocument), 2, 0, blue, null, true, brush, 2, undefined, 'solid', 1, 0, 'pattern-source')
    floodFill(targetDocument, getActiveLayer(targetDocument), 2, 0, blue, null, true, brush, 2, undefined, 'solid', 1, 0, 'pattern-target')

    expect(Array.from({ length: 6 }, (_, index) => readLayerColor(sourceDocument, getActiveLayer(sourceDocument), index).a)).toEqual([0, 255, 0, 255, 0, 255])
    expect(Array.from({ length: 6 }, (_, index) => readLayerColor(targetDocument, getActiveLayer(targetDocument), index).a)).toEqual([255, 0, 255, 0, 255, 0])
  })

  it('keeps solid round brushes hard-edged when procedural antialiasing is enabled', () => {
    const mask = brushMaskOffsets(3, 'round', 'solid', 1, 0, 0, null, undefined, 100)
    expect(mask.every((point) => point.coverage === 255)).toBe(true)
  })

  it('paints the horizontal line brush as a centered pixel line', () => {
    const document = createDocument('line brush', 7, 5, 'rgba')
    const layer = getActiveLayer(document)
    const edit = beginPixelEdit(layer.id)
    paintBrush(document, layer, edit, 3, 2, 5, blue, 'line')
    expect(Array.from({ length: 7 }, (_, x) => readLayerColor(document, layer, 2 * 7 + x).a)).toEqual([0, 255, 255, 255, 255, 255, 0])
    expect(readLayerColor(document, layer, 1 * 7 + 3).a).toBe(0)
  })

  it('keeps an even horizontal line brush on its pointer row', () => {
    expect(brushMaskOffsets(2, 'line')).toEqual([
      { x: 0, y: 1, coverage: 255 },
      { x: 1, y: 1, coverage: 255 }
    ])
  })

  it('fully erases every covered pixel without intermediate edges', () => {
    const document = createDocument('eraser coverage', 3, 3, 'rgba')
    const layer = getActiveLayer(document)
    const base = beginPixelEdit(layer.id)
    paintBrush(document, layer, base, 1, 1, 3, blue, 'square')
    const edit = beginPixelEdit(layer.id)
    paintBrush(document, layer, edit, 1, 1, 3, { r: 0, g: 0, b: 0, a: 0 }, 'round', null, 'solid', 1, null, undefined, 100)
    for (let index = 0; index < 9; index += 1) expect(readLayerColor(document, layer, index).a).toBe(0)
  })

  it('clips painting to the active selection', () => {
    const document = createDocument('selection', 5, 1, 'rgba')
    const layer = getActiveLayer(document)
    const edit = beginPixelEdit(layer.id)
    paintLine(document, layer, edit, 0, 0, 4, 0, 1, blue, { x: 1, y: 0, width: 2, height: 1 })
    expect(edit.before.size).toBe(2)
    expect(readLayerColor(document, layer, 0).a).toBe(0)
    expect(readLayerColor(document, layer, 1)).toEqual(blue)
    expect(readLayerColor(document, layer, 2)).toEqual(blue)
    expect(readLayerColor(document, layer, 4).a).toBe(0)
  })

  it('blends a translucent pencil color once per stroke sample', () => {
    const document = createDocument('alpha pencil', 1, 1, 'rgba')
    const layer = getActiveLayer(document)
    const base = beginPixelEdit(layer.id)
    paintLine(document, layer, base, 0, 0, 0, 0, 1, blue)
    const edit = beginPixelEdit(layer.id)
    const translucentRed = { r: 255, g: 0, b: 0, a: 128 }
    paintLine(document, layer, edit, 0, 0, 0, 0, 1, translucentRed)
    paintLine(document, layer, edit, 0, 0, 0, 0, 1, translucentRed)
    expect(readLayerColor(document, layer, 0)).toEqual({ r: 148, g: 60, b: 127, a: 255 })
  })

  it('blends a translucent pencil color in indexed mode without repeated buildup', () => {
    const document = createDocument('indexed alpha pencil', 1, 1, 'indexed')
    const layer = getActiveLayer(document)
    const base = beginPixelEdit(layer.id)
    paintLine(document, layer, base, 0, 0, 0, 0, 1, blue)
    const edit = beginPixelEdit(layer.id)
    const translucentRed = { r: 255, g: 0, b: 0, a: 128 }
    paintLine(document, layer, edit, 0, 0, 0, 0, 1, translucentRed)
    paintLine(document, layer, edit, 0, 0, 0, 0, 1, translucentRed)
    expect(readLayerColor(document, layer, 0)).toEqual({ r: 148, g: 60, b: 127, a: 255 })
  })

  it('blends a translucent flood-fill color over the existing layer color', () => {
    const document = createDocument('alpha fill', 2, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, blue)
    writeLayerColor(document, layer, 1, blue)
    const translucentRed = { r: 255, g: 0, b: 0, a: 128 }
    const edit = floodFill(document, layer, 0, 0, translucentRed)!
    expect(edit.before.size).toBe(2)
    expect(readLayerColor(document, layer, 0)).toEqual({ r: 148, g: 60, b: 127, a: 255 })
    expect(readLayerColor(document, layer, 1)).toEqual({ r: 148, g: 60, b: 127, a: 255 })
  })

  it('outlines selected content outside and inside as a single pixel edit', () => {
    const outsideDocument = createDocument('outside outline', 5, 5, 'rgba')
    const outsideLayer = getActiveLayer(outsideDocument)
    paintLine(outsideDocument, outsideLayer, beginPixelEdit(outsideLayer.id), 2, 2, 2, 2, 1, blue)
    const outside = outlineSelection(outsideDocument, outsideLayer, { x: 1, y: 1, width: 3, height: 3 }, { r: 255, g: 0, b: 0, a: 255 }, 1, 'outside')!
    expect(outside.before.size).toBe(8)
    expect(readLayerColor(outsideDocument, outsideLayer, 2 * 5 + 2)).toEqual(blue)

    const insideDocument = createDocument('inside outline', 3, 3, 'rgba')
    const insideLayer = getActiveLayer(insideDocument)
    paintShape(insideDocument, insideLayer, beginPixelEdit(insideLayer.id), { x: 0, y: 0, width: 3, height: 3 }, 'rectangle', blue)
    const inside = outlineSelection(insideDocument, insideLayer, { x: 0, y: 0, width: 3, height: 3 }, { r: 255, g: 0, b: 0, a: 255 }, 1, 'inside')!
    expect(inside.before.size).toBe(8)
    expect(readLayerColor(insideDocument, insideLayer, 4)).toEqual(blue)
  })

  it('limits an outline to the configured neighboring pixel directions', () => {
    const document = createDocument('direction outline', 5, 5, 'rgba')
    const layer = getActiveLayer(document)
    paintLine(document, layer, beginPixelEdit(layer.id), 2, 2, 2, 2, 1, blue)
    const pixels = outlinePixelIndices(document, layer, { x: 1, y: 1, width: 3, height: 3 }, 1, 'outside', { nw: false, n: true, ne: false, w: true, e: true, sw: false, s: true, se: false })
    expect(pixels.sort((a, b) => a - b)).toEqual([7, 11, 13, 17])
  })

  it('allows custom diagonal directions through the full neighborhood kernel', () => {
    const document = createDocument('custom diagonal outline', 3, 3, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 4, blue)
    const onlyNorthWest = { nw: true, n: false, ne: false, w: false, e: false, sw: false, s: false, se: false }
    expect(outlinePixelIndices(document, layer, { x: 1, y: 1, width: 1, height: 1 }, 1, 'outside', onlyNorthWest, 'round')).toEqual([])
    expect(outlinePixelIndices(document, layer, { x: 1, y: 1, width: 1, height: 1 }, 1, 'outside', onlyNorthWest, 'square')).toEqual([0])
  })

  it('never paints outline pixels outside the active selection', () => {
    const document = createDocument('clipped outline', 5, 5, 'rgba')
    const layer = getActiveLayer(document)
    paintLine(document, layer, beginPixelEdit(layer.id), 1, 2, 1, 2, 1, blue)
    const selection = { x: 1, y: 1, width: 3, height: 3 }
    const pixels = outlinePixelIndices(document, layer, selection, 2, 'outside')
    expect(pixels.every((index) => {
      const x = index % document.width
      const y = Math.floor(index / document.width)
      return x >= selection.x && x < selection.x + selection.width && y >= selection.y && y < selection.y + selection.height
    })).toBe(true)
  })

  it('creates an outside outline when the selection tightly wraps its content', () => {
    const document = createDocument('tight outline', 3, 3, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 4, blue)
    const edit = outlineSelection(document, layer, { x: 1, y: 1, width: 1, height: 1 }, { r: 255, g: 0, b: 0, a: 255 }, 1, 'outside', undefined, 'round')
    expect(edit?.before.size).toBe(4)
    expect(readLayerColor(document, layer, 1)).toEqual({ r: 255, g: 0, b: 0, a: 255 })
  })

  it('keeps flood fill inside the active selection', () => {
    const document = createDocument('fill selection', 5, 1, 'rgba')
    const layer = getActiveLayer(document)
    const edit = floodFill(document, layer, 2, 0, blue, { x: 1, y: 0, width: 3, height: 1 })!
    expect(edit.before.size).toBe(3)
    expect(readLayerColor(document, layer, 0).a).toBe(0)
    expect(readLayerColor(document, layer, 4).a).toBe(0)
  })

  it('fills every matching pixel in non-contiguous mode', () => {
    const document = createDocument('global fill', 5, 1, 'rgba')
    const layer = getActiveLayer(document)
    const divider = beginPixelEdit(layer.id)
    paintLine(document, layer, divider, 2, 0, 2, 0, 1, blue)
    const red = { r: 255, g: 0, b: 0, a: 255 }
    const edit = floodFill(document, layer, 0, 0, red, null, false)!
    expect(edit.before.size).toBe(4)
    expect(readLayerColor(document, layer, 0)).toEqual(red)
    expect(readLayerColor(document, layer, 4)).toEqual(red)
    expect(readLayerColor(document, layer, 2)).toEqual(blue)
  })

  it('keeps non-contiguous fill inside a non-rectangular selection mask', () => {
    const document = createDocument('masked global fill', 3, 1, 'rgba')
    const layer = getActiveLayer(document)
    const selection = { x: 0, y: 0, width: 3, height: 1, mask: new Uint8Array([1, 0, 1]) }

    const edit = floodFill(document, layer, 0, 0, blue, selection, false)

    expect(edit?.before.size).toBe(2)
    expect(readLayerColor(document, layer, 0)).toEqual(blue)
    expect(readLayerColor(document, layer, 1).a).toBe(0)
    expect(readLayerColor(document, layer, 2)).toEqual(blue)
  })

  it('combines arbitrary selection masks with add, subtract, and intersect', () => {
    const left = { x: 0, y: 0, width: 2, height: 1, mask: new Uint8Array([1, 1]) }
    const right = { x: 1, y: 0, width: 2, height: 1, mask: new Uint8Array([1, 1]) }
    expect(selectionContains(combineSelection(left, right, 'add'), 2, 0)).toBe(true)
    expect(selectionContains(combineSelection(left, right, 'subtract'), 0, 0)).toBe(true)
    expect(selectionContains(combineSelection(left, right, 'subtract'), 1, 0)).toBe(false)
    expect(selectionContains(combineSelection(left, right, 'intersect'), 1, 0)).toBe(true)
  })

  it('merges adjacent mask boundaries into reusable line segments', () => {
    const solid = { x: 0, y: 0, width: 3, height: 3, mask: new Uint8Array(9).fill(1) }
    const withHole = { ...solid, mask: Uint8Array.from([1, 1, 1, 1, 0, 1, 1, 1, 1]) }

    expect(selectionBoundarySegments(solid)).toHaveLength(16)
    expect(selectionBoundarySegments(withHole)).toHaveLength(32)
  })

  it('rasterizes an ellipse selection without selecting its bounding-box corners', () => {
    const selection = ellipseSelection(2, 3, 5, 5)
    expect(selectionContains(selection, 4, 5)).toBe(true)
    expect(selectionContains(selection, 2, 3)).toBe(false)
    expect(selectionContains(selection, 6, 7)).toBe(false)
  })

  it('resizes an ellipse selection without turning its mask into a rectangle', () => {
    const source = ellipseSelection(2, 3, 5, 5)
    const resized = transformSelectionMask(source, { x: 1, y: 1, width: 9, height: 7 }, 12, 12)

    expect(resized).not.toBeNull()
    expect(selectionContains(resized, 5, 4)).toBe(true)
    expect(selectionContains(resized, 1, 1)).toBe(false)
    expect(selectionContains(resized, 9, 7)).toBe(false)
  })

  it('rotates an irregular selection mask with its selected pixels', () => {
    const source = {
      x: 0,
      y: 0,
      width: 3,
      height: 3,
      mask: Uint8Array.from([0, 0, 0, 1, 1, 1, 0, 0, 0])
    }
    const rotated = transformSelectionMask(source, source, 3, 3, 90)

    expect(selectionContains(rotated, 1, 0)).toBe(true)
    expect(selectionContains(rotated, 1, 1)).toBe(true)
    expect(selectionContains(rotated, 1, 2)).toBe(true)
    expect(selectionContains(rotated, 0, 1)).toBe(false)
    expect(selectionContains(rotated, 2, 1)).toBe(false)
  })

  it('shears horizontal and vertical edges without changing the untouched dimension', () => {
    const source = { x: 2, y: 2, width: 3, height: 3 }
    const horizontal = { axis: 'x' as const, edge: 'n' as const, amount: 2 }
    const vertical = { axis: 'y' as const, edge: 'e' as const, amount: -2 }

    expect(transformedSelectionBounds(source, 0, horizontal)).toEqual({ x: 2, y: 2, width: 5, height: 3 })
    expect(transformedSelectionBounds(source, 0, vertical)).toEqual({ x: 2, y: 0, width: 3, height: 5 })
    const sheared = transformSelectionMask(source, source, 10, 10, 0, horizontal)
    expect(selectionContains(sheared, 4, 2)).toBe(true)
    expect(selectionContains(sheared, 2, 2)).toBe(false)
    expect(selectionContains(sheared, 2, 4)).toBe(true)
  })

  it('moves selected pixels through the same shear mapping used by the selection mask', () => {
    const document = createDocument('shear selection', 10, 10, 'rgba')
    const layer = getActiveLayer(document)
    const selection = { x: 2, y: 2, width: 3, height: 3 }
    const edit = beginPixelEdit(layer.id)
    paintLine(document, layer, edit, 2, 2, 4, 2, 1, blue)
    paintLine(document, layer, edit, 2, 4, 4, 4, 1, red)
    const source = captureSelectionTransform(document, selection)!
    const shear = { axis: 'x' as const, edge: 'n' as const, amount: 2 }

    applySelectionTransform(document, source, selection, 0, false, shear)

    expect(readLayerColorAt(document, layer, 4, 2)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 2, 4)).toEqual(red)
  })

  it('preserves an irregular mask when capturing transform pixels', () => {
    const document = createDocument('capture mask', 5, 5, 'rgba')
    const selection = { x: 1, y: 1, width: 3, height: 3, mask: Uint8Array.from([0, 1, 0, 1, 1, 1, 0, 1, 0]) }
    const source = captureSelectionTransform(document, selection)!
    expect(Array.from(source.selection.mask ?? [])).toEqual(Array.from(selection.mask))
  })

  it('swaps a non-square selection bounds when rotating 90 degrees', () => {
    expect(rotatedSelectionBounds({ x: 2, y: 3, width: 3, height: 1 }, 90)).toEqual({ x: 3, y: 2, width: 1, height: 3 })

    const rotated = transformSelectionMask({ x: 2, y: 3, width: 3, height: 1 }, { x: 2, y: 3, width: 3, height: 1 }, 7, 7, 90)
    expect(rotated).toMatchObject({ x: 3, y: 2, width: 1, height: 3 })
    expect(selectionContains(rotated, 3, 2)).toBe(true)
    expect(selectionContains(rotated, 3, 4)).toBe(true)
  })

  it('expands both selected pixels and the mask beyond the old bounds while rotating', () => {
    const document = createDocument('rotate selection', 9, 9, 'rgba')
    const layer = getActiveLayer(document)
    const selection = { x: 3, y: 4, width: 3, height: 1 }
    const paint = beginPixelEdit(layer.id)
    paintLine(document, layer, paint, 3, 4, 5, 4, 1, blue)
    const source = captureSelectionTransform(document, selection)!

    applySelectionTransform(document, source, selection, 45)
    const rotated = transformSelectionMask(selection, selection, document.width, document.height, 45)

    expect(rotated).toMatchObject({ x: 3, y: 3, width: 3, height: 3 })
    expect(readLayerColor(document, layer, 3 * document.width + 3)).toEqual(blue)
    expect(readLayerColor(document, layer, 5 * document.width + 5)).toEqual(blue)
    expect(selectionContains(rotated, 3, 3)).toBe(true)
    expect(selectionContains(rotated, 5, 5)).toBe(true)
  })

  it('clips rotated selections safely at the canvas edge', () => {
    const rotated = transformSelectionMask({ x: 0, y: 0, width: 3, height: 1 }, { x: 0, y: 0, width: 3, height: 1 }, 5, 5, 90)
    expect(rotated).toMatchObject({ x: 1, y: 0, width: 1, height: 2 })
    expect(selectionContains(rotated, 1, 0)).toBe(true)
    expect(selectionContains(rotated, 1, 1)).toBe(true)
  })

  it('selects only the contiguous exact-color region with the magic wand', () => {
    const document = createDocument('wand', 4, 1, 'rgba')
    const layer = getActiveLayer(document)
    const edit = beginPixelEdit(layer.id)
    paintLine(document, layer, edit, 2, 0, 2, 0, 1, blue)
    const selection = magicWandSelection(document, layer, 0, 0)
    expect(selectionContains(selection, 0, 0)).toBe(true)
    expect(selectionContains(selection, 1, 0)).toBe(true)
    expect(selectionContains(selection, 2, 0)).toBe(false)
  })

  it('supports magic-wand tolerance and non-contiguous matching', () => {
    const document = createDocument('wand tolerance', 5, 1, 'rgba')
    const layer = getActiveLayer(document)
    const edit = beginPixelEdit(layer.id)
    paintLine(document, layer, edit, 1, 0, 1, 0, 1, { r: 10, g: 20, b: 30, a: 255 })
    paintLine(document, layer, edit, 3, 0, 3, 0, 1, { r: 13, g: 20, b: 30, a: 255 })
    const contiguous = magicWandSelection(document, layer, 1, 0, 3, true)
    const nonContiguous = magicWandSelection(document, layer, 1, 0, 3, false)
    expect(selectionContains(contiguous, 1, 0)).toBe(true)
    expect(selectionContains(contiguous, 3, 0)).toBe(false)
    expect(selectionContains(nonContiguous, 1, 0)).toBe(true)
    expect(selectionContains(nonContiguous, 3, 0)).toBe(true)
  })

  it('maps magic-wand pixels through the layer offset', () => {
    const document = createDocument('offset wand', 6, 3, 'rgba')
    const layer = getActiveLayer(document)
    layer.offsetX = 2
    layer.offsetY = 1
    const edit = beginPixelEdit(layer.id)
    paintLine(document, layer, edit, 3, 1, 3, 1, 1, blue)

    const selection = magicWandSelection(document, layer, 3, 1)

    expect(selection).toMatchObject({ x: 3, y: 1, width: 1, height: 1 })
    expect(selectionContains(selection, 3, 1)).toBe(true)
    expect(selectionContains(selection, 1, 0)).toBe(false)
  })

  it('does not treat empty mask holes as selected pixels', () => {
    const selection = { x: 0, y: 0, width: 3, height: 3, mask: new Uint8Array([1, 1, 1, 1, 0, 1, 1, 1, 1]) }
    expect(selectionContains(selection, 1, 1)).toBe(false)
    expect(selectionContains(selection, 0, 1)).toBe(true)
  })

  it('rasterizes a lasso polygon and resizes a canvas around its anchor', () => {
    const document = createDocument('resize', 2, 2, 'rgba')
    const layer = getActiveLayer(document)
    const edit = beginPixelEdit(layer.id)
    paintLine(document, layer, edit, 0, 0, 0, 0, 1, blue)
    const lasso = lassoSelection(document, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }])
    expect(selectionContains(lasso, 0, 0)).toBe(true)
    resizeDocument(document, 4, 4, 'center')
    expect(readLayerColor(document, layer, 0)).toEqual(blue)
    expect(layer.offsetX).toBe(1)
    expect(layer.offsetY).toBe(1)
  })

  it('includes the right and bottom boundary pixels of a closed lasso path', () => {
    const document = createDocument('lasso bounds', 10, 10, 'rgba')
    const lasso = lassoSelection(document, [
      { x: 2, y: 2 }, { x: 6, y: 2 }, { x: 6, y: 6 }, { x: 2, y: 6 }
    ])
    expect(lasso).toMatchObject({ x: 2, y: 2, width: 5, height: 5 })
    expect(selectionContains(lasso, 6, 2)).toBe(true)
    expect(selectionContains(lasso, 6, 6)).toBe(true)
    expect(selectionContains(lasso, 2, 6)).toBe(true)
  })

  it('resizes a canvas using explicit edge offsets', () => {
    const document = createDocument('edge resize', 2, 2, 'rgba')
    const layer = getActiveLayer(document)
    const edit = beginPixelEdit(layer.id)
    paintLine(document, layer, edit, 0, 0, 0, 0, 1, blue)
    resizeDocumentAt(document, 5, 4, 2, 1)
    expect(readLayerColor(document, layer, 0)).toEqual(blue)
    expect(layer.offsetX).toBe(2)
    expect(layer.offsetY).toBe(1)
  })

  it('paints every enabled symmetry result in one pixel edit', () => {
    const document = createDocument('symmetric brush', 5, 5, 'rgba')
    const layer = getActiveLayer(document)
    const edit = beginPixelEdit(layer.id)
    paintBrush(document, layer, edit, 0, 1, 1, blue, 'square', null, 'solid', 1, null, undefined, 0, 'paint', undefined, { horizontal: true, vertical: true, diagonalUp: false, diagonalDown: true })

    expect(edit.after.size).toBe(8)
    expect([[0, 1], [0, 3], [4, 1], [1, 0], [4, 3], [3, 0], [1, 4], [3, 4]].every(([x, y]) => readLayerColorAt(document, layer, x, y).a === 255)).toBe(true)
  })

  it('fills distinct mirrored regions as one edit', () => {
    const document = createDocument('symmetric fill', 5, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 1, blue)
    writeLayerColor(document, layer, 3, blue)

    const edit = floodFillSymmetric(document, layer, 0, 0, red, null, true, null, 1, undefined, 'solid', 1, 0, 'paint', { horizontal: false, vertical: true, diagonalUp: false, diagonalDown: false })!

    expect([...edit.after.keys()].sort((left, right) => left - right)).toEqual([0, 4])
    expect(edit.dirtyRect).toEqual({ x: 0, y: 0, width: 5, height: 1 })
    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, 4, 0)).toEqual(red)
  })

  it('moves an already symmetric selection once without duplicating its orbit', () => {
    const document = createDocument('symmetric selection transform', 5, 3, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 5, blue)
    writeLayerColor(document, layer, 9, blue)
    const selection = { x: 0, y: 1, width: 5, height: 1, mask: Uint8Array.from([1, 0, 0, 0, 1]) }
    const source = captureSelectionTransform(document, selection)!

    const edit = applySelectionTransform(document, source, { ...selection, y: 0 }, 0, false, undefined, { horizontal: false, vertical: true, diagonalUp: false, diagonalDown: false }, { x: 2.5, y: 1.5 })!

    expect(edit.after.size).toBe(4)
    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 4, 0)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 0, 1).a).toBe(0)
    expect(readLayerColorAt(document, layer, 4, 1).a).toBe(0)
  })

  it.each([
    ['resize', { x: 0, y: 1, width: 7, height: 3 }, 0, undefined],
    ['rotate', { x: 1, y: 2, width: 5, height: 1 }, 90, undefined],
    ['shear', { x: 1, y: 2, width: 5, height: 1 }, 0, { axis: 'x' as const, edge: 'n' as const, amount: 2 }]
  ])('keeps a symmetric selection mirrored after %s', (_operation, target, angle, shear) => {
    const document = createDocument('symmetric selection transform', 7, 7, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 2 * document.width + 1, blue)
    writeLayerColor(document, layer, 2 * document.width + 5, blue)
    const selection = { x: 1, y: 2, width: 5, height: 1, mask: Uint8Array.from([1, 0, 0, 0, 1]) }
    const source = captureSelectionTransform(document, selection)!

    const edit = applySelectionTransform(document, source, target, angle, false, shear, { horizontal: false, vertical: true, diagonalUp: false, diagonalDown: false }, { x: 3.5, y: 3.5 })
    const painted: Array<[number, number]> = []
    for (let y = 0; y < document.height; y += 1) for (let x = 0; x < document.width; x += 1) {
      if (readLayerColorAt(document, layer, x, y).a > 0) painted.push([x, y])
    }

    expect(edit).not.toBeNull()
    expect(painted.length).toBeGreaterThan(0)
    expect(painted.every(([x, y]) => readLayerColorAt(document, layer, document.width - x - 1, y).a > 0)).toBe(true)
  })
})
