import { describe, expect, it } from 'vitest'
import { compositeRegion, createDocument, createLayer, createSparseLayer, DocumentCompositeCache, findOrAddPaletteColor, getActiveLayer, readLayerColor, readLayerColorAt, resizeDocumentAt, writeLayerColor } from './document'
import { beginPixelEdit, commitPixelEdit, HistoryStack } from './history'
import { appendPerfectPixelSegment, applySelectionTransform, applySelectionTranslationCommit, applySelectionTranslationPreview, bezierCurvePixelPoints, brushMaskOffsets, brushPathStampPoints, brushStampAnchor, brushStampDimensions, brushStrokeInvalidationRects, captureSelectionTransform, clearSelection, filledShapePathPixelPoints, fillSelectionOrCanvas, flipLayer, flipSelection, floodFill, floodFillSymmetric, inheritBrushPaintBaseline, lineShapePixelPoints, moveSelection, outlinePixelIndices, outlineSelection, paintBrush, paintBrushPath, paintLine, paintShape, paintShapePixelPoints, perfectPixelPathPoints, replaceLayerColor, rotatedShapePixelPoints, sampleCompositeColor, selectionTransformPreviewPacked, selectionTranslationPreviewEdit, shapeContainsPixel, shapePixelPoints } from './tools'
import { combineSelection, ellipseSelection, lassoSelection, magicWandSelection, rasterLinePoints, rotatedSelectionBounds, selectionBoundarySegments, selectionContains, transformedSelectionBounds, transformedSelectionSourcePoint, transformSelectionMask } from './selection'
import { resizeDocument } from './document'
import { createProceduralBrush, createProceduralBrushes, createSelectionBrush, proceduralBrushCoverageAt } from './brushes'
import { packColor, unpackColor } from './raster'
import { balancedStairLinePoints } from './pixel-line'

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

  it('keeps interpolated brush dynamics in perfect-pixel paths', () => {
    const path = [{ x: 0, y: 0, size: 2, opacityScale: 0.25 }]
    appendPerfectPixelSegment(path, { x: 2, y: 0, size: 6, opacityScale: 1 })
    expect(path).toEqual([
      { x: 0, y: 0, size: 2, opacityScale: 0.25 },
      { x: 1, y: 0, size: 4, opacityScale: 0.625 },
      { x: 2, y: 0, size: 6, opacityScale: 1 }
    ])
  })

  it('paints and undoes overlapping large opaque stamps exactly once per pixel', () => {
    const document = createDocument('large overlapping brush', 80, 48, 'rgba')
    const layer = getActiveLayer(document)
    const edit = beginPixelEdit(layer.id)

    paintBrush(document, layer, edit, 24, 24, 32, blue, 'square')
    paintBrush(document, layer, edit, 28, 24, 32, blue, 'square')

    expect(edit.before.size).toBe(36 * 32)
    expect(readLayerColorAt(document, layer, 12, 8)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 43, 39)).toEqual(blue)
    const history = commitPixelEdit(document, edit, 'large brush')!
    history.undo()
    expect(readLayerColorAt(document, layer, 12, 8).a).toBe(0)
    expect(readLayerColorAt(document, layer, 43, 39).a).toBe(0)
  })

  it.each(['x', 'y', 'both'] as const)('wraps a brush footprint across the enabled %s tile-repeat seams', (mode) => {
    const document = createDocument(`repeat ${mode}`, 4, 4, 'rgba')
    const layer = getActiveLayer(document)
    const edit = beginPixelEdit(layer.id)

    paintBrush(document, layer, edit, 0, 0, 3, blue, 'square', null, 'solid', 1, null, undefined, 0, 'paint', undefined, undefined, undefined, undefined, 1, undefined, false, undefined, mode)

    const expectedXs = mode === 'x' || mode === 'both' ? [0, 1, 3] : [0, 1]
    const expectedYs = mode === 'y' || mode === 'both' ? [0, 1, 3] : [0, 1]
    const expected = expectedYs.flatMap((y) => expectedXs.map((x) => `${x}:${y}`)).sort()
    const painted: string[] = []
    for (let y = 0; y < document.height; y += 1) for (let x = 0; x < document.width; x += 1) {
      if (readLayerColorAt(document, layer, x, y).a > 0) painted.push(`${x}:${y}`)
    }
    expect(painted.sort()).toEqual(expected)

    const invalidation = brushStrokeInvalidationRects({ x: 0, y: 0 }, { x: 0, y: 0 }, 3, null, document.width, document.height, undefined, undefined, mode)
    for (const coordinate of expected) {
      const [x, y] = coordinate.split(':').map(Number)
      expect(invalidation.some((rect) => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height)).toBe(true)
    }
  })

  it('expands a sparse layer to both repeated edges and undoes the seam stroke as one edit', () => {
    const document = createDocument('repeat sparse layer', 8, 8, 'rgba')
    const layer = createSparseLayer('Sparse', 'rgba')
    document.layers = [layer]
    document.activeLayerId = layer.id
    const edit = beginPixelEdit(layer.id)

    paintBrush(document, layer, edit, 0, 0, 3, blue, 'square', null, 'solid', 1, null, undefined, 0, 'paint', undefined, undefined, undefined, undefined, 1, undefined, false, undefined, 'both')

    expect(readLayerColorAt(document, layer, 7, 7)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(blue)
    const history = new HistoryStack()
    history.push(commitPixelEdit(document, edit, 'repeat seam brush')!)
    history.undo()
    expect(history.canUndo).toBe(false)
    expect(readLayerColorAt(document, layer, 7, 7).a).toBe(0)
    expect(readLayerColorAt(document, layer, 0, 0).a).toBe(0)
  })

  it('deduplicates translucent coverage when a repeated brush spans multiple periods', () => {
    const document = createDocument('repeat translucent brush', 4, 1, 'rgba')
    const layer = getActiveLayer(document)
    const edit = beginPixelEdit(layer.id)
    const translucent = { r: 255, g: 48, b: 48, a: 128 }

    paintBrush(document, layer, edit, 0, 0, 9, translucent, 'square', null, 'solid', 1, null, undefined, 0, 'paint', undefined, undefined, undefined, undefined, 1, undefined, false, undefined, 'x')

    expect(edit.before.size).toBe(4)
    for (let x = 0; x < document.width; x += 1) expect(readLayerColorAt(document, layer, x, 0).a).toBe(128)
  })

  it('checks a selection after wrapping brush pixels into local document coordinates', () => {
    const document = createDocument('repeat selected brush', 4, 1, 'rgba')
    const layer = getActiveLayer(document)
    const edit = beginPixelEdit(layer.id)
    const selection = { x: 3, y: 0, width: 1, height: 1 }

    paintBrush(document, layer, edit, 0, 0, 3, blue, 'square', selection, 'solid', 1, null, undefined, 0, 'paint', undefined, undefined, undefined, undefined, 1, undefined, false, undefined, 'x')

    expect(edit.before.size).toBe(1)
    expect(readLayerColorAt(document, layer, 3, 0)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 0, 0).a).toBe(0)
  })

  it('keeps grayscale paint and erase semantics on the solid-stamp fast path', () => {
    const document = createDocument('grayscale solid stamp', 4, 4, 'grayscale')
    const layer = getActiveLayer(document)
    const paintEdit = beginPixelEdit(layer.id)

    paintBrush(document, layer, paintEdit, 1, 1, 2, red, 'square')
    const painted = readLayerColorAt(document, layer, 1, 1)
    expect(painted.r).toBe(painted.g)
    expect(painted.g).toBe(painted.b)
    expect(painted.a).toBe(255)

    const eraseEdit = beginPixelEdit(layer.id)
    paintBrush(document, layer, eraseEdit, 1, 1, 2, { r: 0, g: 0, b: 0, a: 0 }, 'square')
    expect(readLayerColorAt(document, layer, 1, 1).a).toBe(0)
  })

  it('moves a persisted transparent 1px layer to its first distant brush edit', () => {
    const document = createDocument('persisted sparse layer', 4596, 1767, 'rgba')
    const layer = createSparseLayer('Blank', 'rgba')
    document.layers = [layer]
    document.activeLayerId = layer.id
    const restoredLayer = createLayer(layer.name, 1, 1, 'rgba')
    document.layers = [restoredLayer]
    document.activeLayerId = restoredLayer.id
    const edit = beginPixelEdit(restoredLayer.id)

    paintBrush(document, restoredLayer, edit, 4000, 1500, 32, blue, 'square')

    expect(restoredLayer.width).toBeLessThanOrEqual(160)
    expect(restoredLayer.height).toBeLessThanOrEqual(160)
    expect(readLayerColorAt(document, restoredLayer, 4000, 1500)).toEqual(blue)
  })

  it('keeps interpolated gradient color in perfect-pixel paths', () => {
    const path = [{ x: 0, y: 0, color: red }]
    appendPerfectPixelSegment(path, { x: 2, y: 0, color: blue })
    expect(path).toEqual([
      { x: 0, y: 0, color: red },
      { x: 1, y: 0, color: { r: 148, g: 85, b: 152, a: 255 } },
      { x: 2, y: 0, color: blue }
    ])
  })

  it('rebuilds perfect-pixel gradient samples with the same document-space dither', () => {
    const path = [{
      x: 0,
      y: 0,
      gradient: { startColor: red, endColor: blue, gradientAmount: 0, dither: 'checker' as const }
    }]
    appendPerfectPixelSegment(path, {
      x: 2,
      y: 0,
      gradient: { startColor: red, endColor: blue, gradientAmount: 1, dither: 'checker' }
    })
    expect(path[1].gradient).toEqual({ startColor: red, endColor: blue, gradientAmount: 0.5, dither: 'checker' })

    const document = createDocument('perfect pixel gradient', 3, 1, 'rgba')
    const layer = getActiveLayer(document)
    const edit = beginPixelEdit(layer.id)
    for (const point of path) {
      paintBrush(document, layer, edit, point.x, point.y, 1, red, 'square', null, 'solid', 1, null, undefined, 0, 'paint', undefined, undefined, undefined, undefined, 1, undefined, false, point.gradient)
    }
    expect([0, 1, 2].map((index) => readLayerColor(document, layer, index))).toEqual([red, red, blue])
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

  it('cleans geometric path corners while preserving its endpoints', () => {
    const cleaned = perfectPixelPathPoints([
      { x: 1, y: 4 },
      { x: 2, y: 4 },
      { x: 3, y: 4 },
      { x: 3, y: 3 }
    ])

    expect(cleaned).toEqual([
      { x: 1, y: 4 },
      { x: 2, y: 4 },
      { x: 3, y: 3 }
    ])
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

  it('uses an explicit dynamic color override while preserving image-brush alpha', () => {
    const document = createDocument('gradient colored brush', 2, 1, 'rgba')
    const layer = getActiveLayer(document)
    const brush = {
      id: 'project-brush-gradient-test',
      name: 'Gradient colored brush',
      width: 2,
      height: 1,
      coverage: new Uint8Array([255, 128]),
      colors: new Uint32Array([
        packColor({ r: 255, g: 0, b: 0, a: 255 }),
        packColor({ r: 0, g: 255, b: 0, a: 128 })
      ]),
      intrinsicSize: true
    }
    const dynamicColor = { r: 120, g: 40, b: 220, a: 200 }

    paintBrush(document, layer, beginPixelEdit(layer.id), 1, 0, 1, dynamicColor, 'square', null, 'solid', 1, brush, undefined, 0, 'paint', undefined, undefined, undefined, undefined, 1, 'paint:brush-gradient', true)

    expect(readLayerColor(document, layer, 0)).toEqual(dynamicColor)
    expect(readLayerColor(document, layer, 1)).toEqual({ ...dynamicColor, a: 100 })
  })

  it('applies dynamic gradient RGB while preserving image-brush alpha', () => {
    const document = createDocument('dithered colored brush', 2, 1, 'rgba')
    const layer = getActiveLayer(document)
    const brush = {
      id: 'project-brush-gradient-v4',
      name: 'Gradient colored brush v4',
      width: 2,
      height: 1,
      coverage: new Uint8Array([255, 128]),
      colors: new Uint32Array([
        packColor({ r: 10, g: 20, b: 30, a: 255 }),
        packColor({ r: 40, g: 50, b: 60, a: 128 })
      ]),
      intrinsicSize: true
    }

    paintBrush(document, layer, beginPixelEdit(layer.id), 1, 0, 1, red, 'square', null, 'solid', 1, brush, undefined, 0, 'paint', undefined, undefined, undefined, undefined, 1, undefined, false, {
      startColor: red,
      endColor: blue,
      gradientAmount: 0.5,
      dither: 'none'
    })

    const purple = { r: 148, g: 85, b: 152, a: 255 }
    expect(readLayerColor(document, layer, 0)).toEqual(purple)
    expect(readLayerColor(document, layer, 1)).toEqual({ ...purple, a: 128 })
  })

  it('uses final transparent gradient pixels as alpha-preserving image-brush erasure', () => {
    const document = createDocument('transparent gradient brush', 1, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, blue)
    const transparent = { r: 0, g: 0, b: 0, a: 0 }
    const brush = {
      id: 'project-brush-transparent-gradient',
      name: 'Transparent gradient brush',
      width: 1,
      height: 1,
      coverage: new Uint8Array([128]),
      colors: new Uint32Array([packColor({ r: 40, g: 50, b: 60, a: 128 })]),
      intrinsicSize: true
    }

    paintBrush(document, layer, beginPixelEdit(layer.id), 0, 0, 1, red, 'square', null, 'solid', 1, brush, undefined, 0, 'paint', undefined, undefined, undefined, undefined, 1, undefined, false, {
      startColor: transparent,
      endColor: transparent,
      gradientAmount: 0.5,
      dither: 'none'
    })

    expect(readLayerColor(document, layer, 0)).toEqual({ ...blue, a: 127 })
  })

  it('uses imported image alpha as eraser strength', () => {
    const document = createDocument('rgba image eraser', 1, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, blue)
    const brush = {
      id: 'rgba-eraser.png',
      name: 'RGBA eraser',
      width: 1,
      height: 1,
      coverage: new Uint8Array([128]),
      colors: new Uint32Array([packColor({ r: 255, g: 255, b: 255, a: 128 })]),
      intrinsicSize: true
    }

    paintBrush(document, layer, beginPixelEdit(layer.id), 0, 0, 1, { r: 0, g: 0, b: 0, a: 0 }, 'square', null, 'solid', 1, brush)

    expect(readLayerColor(document, layer, 0)).toEqual({ ...blue, a: 127 })
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

  it('uses procedural bucket sizes as canvas pixels instead of a hidden brush size', () => {
    const filledAlpha = (scale: number, brushSize: number): number[] => {
      const document = createDocument(`procedural fill ${scale} ${brushSize}`, 48, 24, 'rgba')
      const layer = getActiveLayer(document)
      const brush = createProceduralBrush('procedural:fibers', { seed: 103, scale, detail: 35, variation: 28, angle: 90 })
      floodFill(document, layer, 0, 0, blue, null, false, brush, brushSize, undefined, 'solid', 1, 0, 'paint')
      return Array.from({ length: document.width * document.height }, (_, index) => readLayerColor(document, layer, index).a)
    }

    const fine = filledAlpha(5, 1)
    expect(filledAlpha(5, 128)).toEqual(fine)
    expect(filledAlpha(18, 1)).not.toEqual(fine)
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

  it('uses the same stamp centers for geometric brush-path preview and paint', () => {
    const document = createDocument('brush path', 48, 24, 'rgba')
    const layer = getActiveLayer(document)
    const edit = beginPixelEdit(layer.id)
    const path = lineShapePixelPoints({ x: 4, y: 12 }, { x: 36, y: 12 })
    const centers = brushPathStampPoints(path, 32)

    paintBrushPath(document, layer, edit, path, 32, blue, null, 'line')

    expect(centers.map((point) => point.x)).toEqual([4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36])
    expect(edit.before.size).toBeGreaterThan(path.length)
    for (const center of centers) expect(readLayerColorAt(document, layer, center.x, center.y).a).toBe(255)
  })

  it('paints a thick curved brush path instead of a one-pixel curve', () => {
    const document = createDocument('curved brush path', 24, 24, 'rgba')
    const layer = getActiveLayer(document)
    const edit = beginPixelEdit(layer.id)
    const path = bezierCurvePixelPoints({ x: 3, y: 18 }, [{ x: 8, y: 2 }, { x: 16, y: 2 }], { x: 21, y: 18 })

    paintBrushPath(document, layer, edit, path, 3, blue, null, 'square')

    expect(edit.before.size).toBeGreaterThan(path.length)
    expect(readLayerColorAt(document, layer, 3, 18)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 2, 17)).toEqual(blue)
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

  it('replaces paint-mode image brush pixels in path order and skips transparent source pixels', () => {
    const document = createDocument('image brush overwrite', 4, 1, 'rgba')
    const layer = getActiveLayer(document)
    const base = { r: 40, g: 180, b: 80, a: 255 }
    const translucentRed = { r: 255, g: 0, b: 0, a: 128 }
    const translucentBlue = { r: 0, g: 0, b: 255, a: 128 }
    const transparent = { r: 0, g: 0, b: 0, a: 0 }
    for (let index = 0; index < 4; index += 1) writeLayerColor(document, layer, index, base)
    const brush = {
      id: 'overwrite.png',
      name: 'Overwrite',
      width: 3,
      height: 1,
      coverage: new Uint8Array([0, 128, 128]),
      colors: new Uint32Array([packColor(transparent), packColor(translucentRed), packColor(translucentBlue)]),
      intrinsicSize: true
    }

    paintLine(document, layer, beginPixelEdit(layer.id), 1, 0, 2, 0, 1, red, null, 'square', 'solid', 1, brush, undefined, 0, 'paint')

    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(base)
    expect(readLayerColorAt(document, layer, 1, 0)).toEqual(translucentRed)
    expect(readLayerColorAt(document, layer, 2, 0)).toEqual(translucentRed)
    expect(readLayerColorAt(document, layer, 3, 0)).toEqual(translucentBlue)
  })

  it('uses each dynamic point size for raster and balanced stamp spacing', () => {
    const paintDynamicLine = (algorithm: 'raster' | 'balanced') => {
      const document = createDocument(`dynamic ${algorithm}`, 80, 21, 'rgba')
      const layer = getActiveLayer(document)
      paintLine(document, layer, beginPixelEdit(layer.id), 40, 0, 40, 20, 64, blue, null, 'line', 'solid', 1, null, undefined, 0, 'paint', undefined, algorithm, undefined, undefined, undefined, {
        fromSize: 64,
        toSize: 1
      })
      return Array.from({ length: 21 }, (_, y) => readLayerColorAt(document, layer, 40, y).a > 0)
    }

    const raster = paintDynamicLine('raster')
    const balanced = paintDynamicLine('balanced')
    expect(raster).toEqual(balanced)
    expect(raster[0]).toBe(true)
    expect(raster[3]).toBe(true)
    expect(raster[20]).toBe(true)
  })

  it('paints a zero-length dynamic line exactly once', () => {
    const document = createDocument('zero dynamic line', 1, 1, 'rgba')
    const layer = getActiveLayer(document)
    const edit = beginPixelEdit(layer.id)
    paintLine(document, layer, edit, 0, 0, 0, 0, 1, red, null, 'square', 'solid', 1, null, undefined, 0, 'paint', undefined, 'balanced', undefined, undefined, undefined, {
      fromOpacityScale: 0.25,
      toOpacityScale: 0.5
    })
    expect(edit.before.size).toBe(1)
    expect(readLayerColor(document, layer, 0).a).toBe(128)
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

  it('virtually closes line-art gaps and fills through the virtual bridge', () => {
    const createGappedOutline = () => {
      const document = createDocument('smart closure fill', 10, 10, 'rgba')
      const layer = getActiveLayer(document)
      for (let y = 2; y <= 7; y += 1) for (let x = 2; x <= 7; x += 1) {
        if (x !== 2 && x !== 7 && y !== 2 && y !== 7) continue
        if (y === 2 && (x === 4 || x === 5)) continue
        writeLayerColor(document, layer, y * document.width + x, blue)
      }
      return { document, layer }
    }

    const leaking = createGappedOutline()
    floodFill(leaking.document, leaking.layer, 4, 4, red)
    expect(readLayerColorAt(leaking.document, leaking.layer, 0, 0)).toEqual(red)

    const closed = createGappedOutline()
    floodFill(closed.document, closed.layer, 4, 4, red, null, true, null, 1, undefined, 'solid', 1, 0, 'paint', 0, 2)
    expect(readLayerColorAt(closed.document, closed.layer, 4, 4)).toEqual(red)
    expect(readLayerColorAt(closed.document, closed.layer, 0, 0).a).toBe(0)
    expect(readLayerColorAt(closed.document, closed.layer, 4, 2)).toEqual(red)
    expect(readLayerColorAt(closed.document, closed.layer, 3, 2)).toEqual(blue)
  })

  it('fills colors within tolerance while preserving contiguous boundaries', () => {
    const document = createDocument('fill tolerance', 4, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, { r: 10, g: 20, b: 30, a: 255 })
    writeLayerColor(document, layer, 1, { r: 13, g: 20, b: 30, a: 255 })
    writeLayerColor(document, layer, 2, { r: 40, g: 20, b: 30, a: 255 })
    writeLayerColor(document, layer, 3, { r: 12, g: 20, b: 30, a: 255 })

    floodFill(document, layer, 0, 0, red, null, true, null, 1, undefined, 'solid', 1, 0, 'paint', 3)

    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, 1, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, 2, 0)).toEqual({ r: 40, g: 20, b: 30, a: 255 })
    expect(readLayerColorAt(document, layer, 3, 0)).toEqual({ r: 12, g: 20, b: 30, a: 255 })
  })

  it('uses palette colors for indexed non-contiguous fill tolerance', () => {
    const document = createDocument('indexed fill tolerance', 3, 1, 'indexed')
    const layer = getActiveLayer(document)
    const first = { r: 10, g: 20, b: 30, a: 255 }
    const second = { r: 13, g: 20, b: 30, a: 255 }
    const third = { r: 30, g: 20, b: 30, a: 255 }
    for (const color of [first, second, third, red]) findOrAddPaletteColor(document, color, true)
    writeLayerColor(document, layer, 0, first)
    writeLayerColor(document, layer, 1, second)
    writeLayerColor(document, layer, 2, third)

    floodFill(document, layer, 0, 0, red, null, false, null, 1, undefined, 'solid', 1, 0, 'paint', 3)

    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, 1, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, 2, 0)).toEqual(third)
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

  it('keeps a large enclosed bucket fill dirty region exact across undo and redo', () => {
    const document = createDocument('large enclosed fill', 514, 514, 'rgba')
    const layer = getActiveLayer(document)
    for (let x = 0; x < 514; x += 1) {
      writeLayerColor(document, layer, x, red)
      writeLayerColor(document, layer, 513 * layer.width + x, red)
    }
    for (let y = 1; y < 513; y += 1) {
      writeLayerColor(document, layer, y * layer.width, red)
      writeLayerColor(document, layer, y * layer.width + 513, red)
    }

    const edit = floodFill(document, layer, 257, 257, blue)!

    expect(edit.before.size).toBe(0)
    expect(edit.runs).toHaveLength(512)
    expect(edit.dirtyRect).toEqual({ x: 1, y: 1, width: 512, height: 512 })
    const entry = commitPixelEdit(document, edit, 'large enclosed fill')!
    expect(entry.invalidation).toEqual({
      kind: 'region',
      frameId: document.animation?.activeFrameId,
      rect: { x: 1, y: 1, width: 512, height: 512 }
    })
    entry.undo()
    expect(readLayerColorAt(document, layer, 257, 257).a).toBe(0)
    entry.redo()
    expect(readLayerColorAt(document, layer, 257, 257)).toEqual(blue)
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

  it('keeps a large cropped layer local while painting and preserves undo across expansion', () => {
    const document = createDocument('large cropped brush', 4596, 1767, 'rgba')
    const layer = getActiveLayer(document)
    layer.width = 240
    layer.height = 131
    layer.offsetX = 162
    layer.offsetY = 1467
    layer.pixels = new Uint8ClampedArray(layer.width * layer.height * 4)
    const edit = beginPixelEdit(layer.id)

    paintBrush(document, layer, edit, 500, 1500, 1, blue, 'square')
    paintBrush(document, layer, edit, 700, 1500, 1, blue, 'square')

    expect(layer.width).toBeLessThan(1000)
    expect(layer.height).toBeLessThan(400)
    expect(readLayerColorAt(document, layer, 500, 1500)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 700, 1500)).toEqual(blue)
    const entry = commitPixelEdit(document, edit, 'local expansion')!
    entry.undo()
    expect(readLayerColorAt(document, layer, 500, 1500).a).toBe(0)
    expect(readLayerColorAt(document, layer, 700, 1500).a).toBe(0)
    entry.redo()
    expect(readLayerColorAt(document, layer, 500, 1500)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 700, 1500)).toEqual(blue)
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

  it('limits full-canvas clearing to the active layer content bounds', () => {
    const document = createDocument('bounded clear', 4000, 4000, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 1200 * layer.width + 1400, blue)
    writeLayerColor(document, layer, 1204 * layer.width + 1406, red)

    const edit = clearSelection(document, { x: 0, y: 0, width: 4000, height: 4000 })!

    expect(edit.before.size).toBe(2)
    expect(edit.dirtyRect).toEqual({ x: 1400, y: 1200, width: 7, height: 5 })
    const entry = commitPixelEdit(document, edit, 'bounded clear')!
    entry.undo()
    expect(readLayerColorAt(document, layer, 1400, 1200)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 1406, 1204)).toEqual(red)
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

  it('keeps an enclosed cropped-layer fill local to its cel bitmap', () => {
    const document = createDocument('cropped enclosed fill', 3, 3, 'rgba')
    const layer = getActiveLayer(document)
    if (layer.format !== 'rgba') throw new Error('wrong layer mode')
    document.width = 4000
    document.height = 2000
    layer.width = 3
    layer.height = 3
    layer.offsetX = 1200
    layer.offsetY = 700
    layer.pixels = new Uint8ClampedArray(3 * 3 * 4)
    for (let index = 0; index < 9; index += 1) layer.pixels[index * 4 + 3] = 255
    layer.pixels[(1 * 3 + 1) * 4 + 3] = 0

    const edit = floodFill(document, layer, 1201, 701, blue)

    expect(edit?.runs?.reduce((count, run) => count + run.length, 0)).toBe(1)
    expect(layer).toMatchObject({ width: 3, height: 3, offsetX: 1200, offsetY: 700 })
    expect(readLayerColorAt(document, layer, 1201, 701)).toEqual(blue)
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

  it('stores large masked selection fills as dense history without changing unselected pixels', () => {
    const document = createDocument('dense foreground fill', 512, 512, 'rgba')
    const layer = getActiveLayer(document)
    layer.pixels.fill(255)
    const mask = new Uint8Array(512 * 512).fill(1)
    mask[1] = 0
    const selection = { x: 0, y: 0, width: 512, height: 512, mask }

    const edit = fillSelectionOrCanvas(document, layer, blue, selection)!

    expect(edit.before.size).toBe(0)
    expect(edit.denseRegion?.count).toBe(512 * 512 - 1)
    expect(edit.dirtyRect).toEqual({ x: 0, y: 0, width: 512, height: 512 })
    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 1, 0)).toEqual({ r: 255, g: 255, b: 255, a: 255 })
    const entry = commitPixelEdit(document, edit, 'dense selection fill')!
    entry.undo()
    expect(readLayerColorAt(document, layer, 0, 0)).toEqual({ r: 255, g: 255, b: 255, a: 255 })
    expect(readLayerColorAt(document, layer, 1, 0)).toEqual({ r: 255, g: 255, b: 255, a: 255 })
    entry.redo()
    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 1, 0)).toEqual({ r: 255, g: 255, b: 255, a: 255 })
  })

  it('keeps sparse large selection fills on the compact point path', () => {
    const document = createDocument('sparse foreground fill', 512, 512, 'rgba')
    const layer = getActiveLayer(document)
    const mask = new Uint8Array(512 * 512)
    mask[0] = 1
    mask[mask.length - 1] = 1

    const edit = fillSelectionOrCanvas(document, layer, blue, { x: 0, y: 0, width: 512, height: 512, mask })!

    expect(edit.denseRegion).toBeUndefined()
    expect(edit.before.size).toBe(2)
    expect(edit.dirtyRect).toEqual({ x: 0, y: 0, width: 512, height: 512 })
  })

  it('preserves indexed and grayscale fill semantics on the dense path', () => {
    const indexedDocument = createDocument('dense indexed fill', 512, 512, 'indexed')
    const indexedLayer = getActiveLayer(indexedDocument)
    const indexedEdit = fillSelectionOrCanvas(indexedDocument, indexedLayer, blue)!
    expect(indexedEdit.denseRegion?.count).toBe(512 * 512)
    expect(readLayerColorAt(indexedDocument, indexedLayer, 511, 511)).toEqual(blue)
    const indexedEntry = commitPixelEdit(indexedDocument, indexedEdit, 'dense indexed fill')!
    indexedEntry.undo()
    expect(readLayerColorAt(indexedDocument, indexedLayer, 511, 511).a).toBe(0)
    indexedEntry.redo()
    expect(readLayerColorAt(indexedDocument, indexedLayer, 511, 511)).toEqual(blue)

    const grayscaleDocument = createDocument('dense grayscale fill', 512, 512, 'grayscale')
    const grayscaleLayer = getActiveLayer(grayscaleDocument)
    const grayscaleEdit = fillSelectionOrCanvas(grayscaleDocument, grayscaleLayer, blue)!
    expect(grayscaleEdit.denseRegion?.count).toBe(512 * 512)
    const grayscale = readLayerColorAt(grayscaleDocument, grayscaleLayer, 511, 511)
    expect(grayscale.r).toBe(grayscale.g)
    expect(grayscale.g).toBe(grayscale.b)
    expect(grayscale.a).toBe(255)
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

  it('replaces only pixels exactly matching the requested color', () => {
    const document = createDocument('replace exact color', 3, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, red)
    writeLayerColor(document, layer, 1, { ...red, a: 128 })
    writeLayerColor(document, layer, 2, red)

    const edit = replaceLayerColor(document, layer, red, blue)

    expect(edit?.before.size).toBe(2)
    expect(readLayerColor(document, layer, 0)).toEqual(blue)
    expect(readLayerColor(document, layer, 1)).toEqual({ ...red, a: 128 })
    expect(readLayerColor(document, layer, 2)).toEqual(blue)
  })

  it('limits color replacement to pixels covered by the selection mask', () => {
    const document = createDocument('replace selected color', 3, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, red)
    writeLayerColor(document, layer, 1, red)
    writeLayerColor(document, layer, 2, red)

    const edit = replaceLayerColor(document, layer, red, blue, { x: 0, y: 0, width: 3, height: 1, mask: new Uint8Array([1, 0, 1]) })

    expect(edit?.before.size).toBe(2)
    expect(readLayerColor(document, layer, 0)).toEqual(blue)
    expect(readLayerColor(document, layer, 1)).toEqual(red)
    expect(readLayerColor(document, layer, 2)).toEqual(blue)
  })

  it('replaces matching colors without leaving indexed mode', () => {
    const document = createDocument('replace indexed color', 2, 1, 'indexed')
    const layer = getActiveLayer(document)
    findOrAddPaletteColor(document, red, true)
    findOrAddPaletteColor(document, blue, true)
    writeLayerColor(document, layer, 0, red)
    writeLayerColor(document, layer, 1, red)

    const edit = replaceLayerColor(document, layer, red, blue)

    expect(edit?.before.size).toBe(2)
    expect(document.colorMode).toBe('indexed')
    expect(readLayerColor(document, layer, 0)).toEqual(blue)
    expect(readLayerColor(document, layer, 1)).toEqual(blue)
  })

  it('does not add an indexed palette color when no pixel matches', () => {
    const document = createDocument('replace missing indexed color', 1, 1, 'indexed')
    const layer = getActiveLayer(document)
    const before = document.palette.length

    expect(replaceLayerColor(document, layer, red, blue)).toBeNull()
    expect(document.palette).toHaveLength(before)
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

  it.each([
    ['x', 4, 2, { x: 3, y: 1 }, { x: 4, y: 1 }, { x: 0, y: 1 }],
    ['y', 3, 4, { x: 1, y: 3 }, { x: 1, y: 4 }, { x: 1, y: 0 }],
    ['both', 4, 4, { x: 3, y: 3 }, { x: 4, y: 4 }, { x: 0, y: 0 }]
  ] as const)('wraps a deferred selection translation across the %s tile-repeat boundary', (mode, width, height, sourcePoint, targetPoint, destinationPoint) => {
    const document = createDocument(`repeat ${mode} translation`, width, height, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, sourcePoint.y * layer.width + sourcePoint.x, blue)
    const selection = { ...sourcePoint, width: 1, height: 1 }
    const source = captureSelectionTransform(document, selection, layer, { cacheOpaqueOffsets: false })!

    const edit = applySelectionTranslationCommit(document, source, { ...selection, ...targetPoint }, false, layer, mode)!
    const entry = commitPixelEdit(document, edit, 'repeat move')!

    expect(readLayerColorAt(document, layer, sourcePoint.x, sourcePoint.y).a).toBe(0)
    expect(readLayerColorAt(document, layer, destinationPoint.x, destinationPoint.y)).toEqual(blue)
    entry.undo()
    expect(readLayerColorAt(document, layer, sourcePoint.x, sourcePoint.y)).toEqual(blue)
    expect(readLayerColorAt(document, layer, destinationPoint.x, destinationPoint.y).a).toBe(0)
    entry.redo()
    expect(readLayerColorAt(document, layer, destinationPoint.x, destinationPoint.y)).toEqual(blue)
  })

  it('keeps the source while previewing and committing a copied tile-repeat translation', () => {
    const document = createDocument('repeat copy translation', 4, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 3, blue)
    const selection = { x: 3, y: 0, width: 1, height: 1 }
    const source = captureSelectionTransform(document, selection, layer)!

    const preview = applySelectionTranslationPreview(document, source, { ...selection, x: 4 }, true, null, layer, undefined, 'x')
    const entry = commitPixelEdit(document, selectionTranslationPreviewEdit(document, preview)!, 'repeat copy')!

    expect(readLayerColorAt(document, layer, 3, 0)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(blue)
    entry.undo()
    expect(readLayerColorAt(document, layer, 3, 0)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 0, 0).a).toBe(0)
    entry.redo()
    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(blue)
  })

  it('stores large translation history in typed point arrays', () => {
    const document = createDocument('large preview history', 600, 300, 'rgba')
    const layer = getActiveLayer(document)
    if (layer.format !== 'rgba') throw new Error('wrong layer mode')
    for (let y = 0; y < 300; y += 1) for (let x = 0; x < 300; x += 1) {
      const offset = (y * layer.width + x) * 4
      layer.pixels[offset] = red.r
      layer.pixels[offset + 1] = red.g
      layer.pixels[offset + 2] = red.b
      layer.pixels[offset + 3] = red.a
    }
    const selection = { x: 0, y: 0, width: 300, height: 300 }
    const source = captureSelectionTransform(document, selection)!
    const preview = applySelectionTranslationPreview(document, source, { ...selection, x: 300 })

    const edit = selectionTranslationPreviewEdit(document, preview)!
    expect(edit.before.size).toBe(0)
    expect(edit.points?.count).toBe(180_000)
    expect(edit.dirtyRect).toEqual({ x: 0, y: 0, width: 600, height: 300 })

    const history = new HistoryStack()
    history.push(commitPixelEdit(document, edit, 'large move')!)
    history.undo()
    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, 300, 0).a).toBe(0)
    history.redo()
    expect(readLayerColorAt(document, layer, 0, 0).a).toBe(0)
    expect(readLayerColorAt(document, layer, 300, 0)).toEqual(red)
  })

  it('commits a large deferred translation from dense source pixels without opaque offset caches', () => {
    const document = createDocument('large deferred translation', 601, 500, 'rgba')
    const layer = getActiveLayer(document)
    if (layer.format !== 'rgba') throw new Error('wrong layer mode')
    const packed = (blue.r | blue.g << 8 | blue.b << 16 | blue.a << 24) >>> 0
    const words = new Uint32Array(layer.pixels.buffer)
    for (let y = 0; y < 500; y += 1) words.fill(packed, y * layer.width, y * layer.width + 600)
    const selection = { x: 0, y: 0, width: 600, height: 500 }
    const source = captureSelectionTransform(document, selection, layer, { cacheOpaqueOffsets: false })!

    expect(source.opaqueOffsets).toHaveLength(0)
    const edit = applySelectionTranslationCommit(document, source, { ...selection, x: 1 }, false, layer)!
    expect(edit.points?.count).toBe(1_000)
    expect(edit.dirtyRect).toEqual({ x: 0, y: 0, width: 601, height: 500 })

    const entry = commitPixelEdit(document, edit, 'deferred move')!
    expect(readLayerColorAt(document, layer, 0, 0).a).toBe(0)
    expect(readLayerColorAt(document, layer, 600, 0)).toEqual(blue)
    entry.undo()
    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 600, 0).a).toBe(0)
  })

  it('commits a deferred clipboard paste into a sparse layer at the target bounds', () => {
    const document = createDocument('sparse clipboard paste', 1000, 800, 'rgba')
    const layer = createSparseLayer('Blank', 'rgba')
    document.layers = [layer]
    document.activeLayerId = layer.id
    const selection = { x: 400, y: 300, width: 2, height: 1, mask: Uint8Array.from([1, 1]) }
    const source = {
      selection,
      values: Uint32Array.from([packColor(red), packColor(blue)]),
      selectedOffsets: new Uint32Array(0),
      opaqueOffsets: new Uint32Array(0),
      opaqueIndices: new Uint32Array(0),
      opaqueValues: new Uint32Array(0),
      origin: 'clipboard' as const
    }

    const edit = applySelectionTranslationCommit(document, source, selection, true, layer)!

    expect(layer).toMatchObject({ width: 2, height: 1, offsetX: 400, offsetY: 300 })
    expect(readLayerColorAt(document, layer, 400, 300)).toEqual(red)
    expect(readLayerColorAt(document, layer, 401, 300)).toEqual(blue)
    const entry = commitPixelEdit(document, edit, 'paste')!
    entry.undo()
    expect(readLayerColorAt(document, layer, 400, 300).a).toBe(0)
    expect(readLayerColorAt(document, layer, 401, 300).a).toBe(0)
    entry.redo()
    expect(readLayerColorAt(document, layer, 400, 300)).toEqual(red)
    expect(readLayerColorAt(document, layer, 401, 300)).toEqual(blue)
  })

  it('moves a fully selected compact layer by cel offset without expanding or copying pixels', () => {
    const document = createDocument('compact deferred translation', 1000, 800, 'rgba')
    const layer = getActiveLayer(document)
    layer.width = 2
    layer.height = 1
    layer.offsetX = 400
    layer.offsetY = 300
    layer.pixels = new Uint8ClampedArray([blue.r, blue.g, blue.b, blue.a, red.r, red.g, red.b, red.a])
    const pixels = layer.pixels
    const selection = { x: 0, y: 0, width: document.width, height: document.height }
    const source = captureSelectionTransform(document, selection, layer, { cacheOpaqueOffsets: false })!

    const edit = applySelectionTranslationCommit(document, source, { ...selection, x: 7, y: -3 }, false, layer)!

    expect(edit.layerOffset).toEqual({ beforeX: 400, beforeY: 300, afterX: 407, afterY: 297 })
    expect(edit.points).toBeUndefined()
    expect(layer.pixels).toBe(pixels)
    expect(layer).toMatchObject({ width: 2, height: 1, offsetX: 407, offsetY: 297 })
    expect(readLayerColorAt(document, layer, 407, 297)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 408, 297)).toEqual(red)

    const entry = commitPixelEdit(document, edit, 'compact move')!
    entry.undo()
    expect(layer.pixels).toBe(pixels)
    expect(layer).toMatchObject({ width: 2, height: 1, offsetX: 400, offsetY: 300 })
    entry.redo()
    expect(layer.pixels).toBe(pixels)
    expect(layer).toMatchObject({ width: 2, height: 1, offsetX: 407, offsetY: 297 })
  })

  it('keeps a partial compact selection local instead of expanding the layer to the document', () => {
    const document = createDocument('partial compact translation', 1000, 800, 'rgba')
    const layer = getActiveLayer(document)
    const green = { r: 0, g: 220, b: 80, a: 255 }
    layer.width = 4
    layer.height = 1
    layer.offsetX = 400
    layer.offsetY = 300
    layer.pixels = new Uint8ClampedArray([
      red.r, red.g, red.b, red.a,
      blue.r, blue.g, blue.b, blue.a,
      green.r, green.g, green.b, green.a,
      red.r, red.g, red.b, red.a
    ])
    const selection = { x: 400, y: 300, width: 2, height: 1 }
    const source = captureSelectionTransform(document, selection, layer, { cacheOpaqueOffsets: false })!

    const edit = applySelectionTranslationCommit(document, source, { ...selection, x: 410 }, false, layer)!

    expect(layer).toMatchObject({ width: 12, height: 1, offsetX: 400, offsetY: 300 })
    expect(readLayerColorAt(document, layer, 400, 300).a).toBe(0)
    expect(readLayerColorAt(document, layer, 402, 300)).toEqual(green)
    expect(readLayerColorAt(document, layer, 410, 300)).toEqual(red)
    expect(readLayerColorAt(document, layer, 411, 300)).toEqual(blue)

    const entry = commitPixelEdit(document, edit, 'partial compact move')!
    entry.undo()
    expect(readLayerColorAt(document, layer, 400, 300)).toEqual(red)
    expect(readLayerColorAt(document, layer, 401, 300)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 410, 300).a).toBe(0)
  })

  it('keeps unselected and transparent destination pixels intact in a deferred masked move', () => {
    const document = createDocument('masked deferred move', 6, 1, 'rgba')
    const layer = getActiveLayer(document)
    const green = { r: 0, g: 220, b: 80, a: 255 }
    writeLayerColor(document, layer, 0, blue)
    writeLayerColor(document, layer, 1, red)
    writeLayerColor(document, layer, 4, green)
    const selection = { x: 0, y: 0, width: 2, height: 1, mask: Uint8Array.from([1, 0]) }
    const source = captureSelectionTransform(document, selection, layer, { cacheOpaqueOffsets: false })!

    applySelectionTranslationCommit(document, source, { ...selection, x: 3 }, false, layer)

    expect(readLayerColorAt(document, layer, 0, 0).a).toBe(0)
    expect(readLayerColorAt(document, layer, 1, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, 3, 0)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 4, 0)).toEqual(green)
  })

  it('samples only the requested viewport for a non-destructive selection resize preview', () => {
    const document = createDocument('viewport selection preview', 8, 4, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 1 + layer.width, red)
    writeLayerColor(document, layer, 2 + layer.width, blue)
    const selection = { x: 1, y: 1, width: 2, height: 1 }
    const source = captureSelectionTransform(document, selection)!
    const before = Array.from(layer.pixels)

    const preview = selectionTransformPreviewPacked(document, source, { x: 4, y: 1, width: 4, height: 1 }, 5, 1, 2, 1, 0, undefined, layer)

    expect(Array.from(preview)).toEqual([
      (red.r | red.g << 8 | red.b << 16 | red.a << 24) >>> 0,
      (blue.r | blue.g << 8 | blue.b << 16 | blue.a << 24) >>> 0
    ])
    expect(Array.from(layer.pixels)).toEqual(before)
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
    expect(edit.before.size).toBe(5)
    const shapeEdit = beginPixelEdit(layer.id)
    paintShape(document, layer, shapeEdit, { x: 0, y: 0, width: 2, height: 2 }, 'rectangle', blue)
    expect(shapeEdit.before.size).toBe(4)
  })

  it('replaces only exact foreground-color pixels along an eraser replacement stroke', () => {
    const document = createDocument('eraser color replacement', 4, 1, 'rgba')
    const layer = getActiveLayer(document)
    const background = { r: 245, g: 220, b: 180, a: 255 }
    writeLayerColor(document, layer, 0, blue)
    writeLayerColor(document, layer, 1, red)
    writeLayerColor(document, layer, 2, blue)
    writeLayerColor(document, layer, 3, { ...blue, a: 128 })
    const edit = beginPixelEdit(layer.id)

    paintLine(document, layer, edit, 0, 0, 3, 0, 1, background, null, 'square', 'solid', 1, null, undefined, 0, 'paint', undefined, 'raster', undefined, undefined, { source: blue, target: background })

    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(background)
    expect(readLayerColorAt(document, layer, 1, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, 2, 0)).toEqual(background)
    expect(readLayerColorAt(document, layer, 3, 0)).toEqual({ ...blue, a: 128 })
    expect(edit.before.size).toBe(2)
  })

  it('supports foreground-to-background eraser replacement on indexed layers', () => {
    const document = createDocument('indexed eraser replacement', 2, 1, 'indexed')
    const layer = getActiveLayer(document)
    const background = { r: 16, g: 180, b: 120, a: 255 }
    findOrAddPaletteColor(document, red, true)
    findOrAddPaletteColor(document, background, true)
    writeLayerColor(document, layer, 0, blue)
    writeLayerColor(document, layer, 1, red)
    const edit = beginPixelEdit(layer.id)

    paintBrush(document, layer, edit, 0, 0, 2, background, 'square', null, 'solid', 1, null, undefined, 0, 'paint', undefined, undefined, undefined, { source: blue, target: background })

    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(background)
    expect(readLayerColorAt(document, layer, 1, 0)).toEqual(red)
    expect(edit.before.size).toBe(1)
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

  it('fills freeform and polygon paths with the same pixels used by their previews', () => {
    const document = createDocument('path shapes', 12, 12, 'rgba')
    const layer = getActiveLayer(document)
    const path = [{ x: 2, y: 2 }, { x: 9, y: 2 }, { x: 7, y: 9 }, { x: 3, y: 8 }]
    const preview = filledShapePathPixelPoints(document, path)
    const edit = beginPixelEdit(layer.id)
    paintShapePixelPoints(document, layer, edit, preview, blue)

    expect(preview.length).toBeGreaterThan(20)
    expect([...edit.before.keys()].sort((left, right) => left - right)).toEqual(
      preview.map(({ x, y }) => y * document.width + x).sort((left, right) => left - right)
    )
  })

  it('keeps line and cubic curve paths continuous and includes both endpoints', () => {
    const line = lineShapePixelPoints({ x: 1, y: 1 }, { x: 9, y: 6 }, true)
    const curve = bezierCurvePixelPoints({ x: 1, y: 8 }, [{ x: 3, y: 0 }, { x: 8, y: 0 }], { x: 10, y: 8 })
    expect(line[0]).toMatchObject({ x: 1, y: 1 })
    expect(line.at(-1)).toMatchObject({ x: 9, y: 6 })
    expect(curve[0]).toMatchObject({ x: 1, y: 8 })
    expect(curve.at(-1)).toMatchObject({ x: 10, y: 8 })
    for (const points of [line, curve]) {
      for (let index = 1; index < points.length; index += 1) {
        expect(Math.max(Math.abs(points[index].x - points[index - 1].x), Math.abs(points[index].y - points[index - 1].y))).toBeLessThanOrEqual(1)
      }
    }
  })

  it('lets both cubic curve control anchors influence the rasterized path', () => {
    const base = bezierCurvePixelPoints({ x: 1, y: 8 }, [{ x: 3, y: 8 }, { x: 8, y: 8 }], { x: 10, y: 8 })
    const firstBent = bezierCurvePixelPoints({ x: 1, y: 8 }, [{ x: 3, y: 1 }, { x: 8, y: 8 }], { x: 10, y: 8 })
    const secondBent = bezierCurvePixelPoints({ x: 1, y: 8 }, [{ x: 3, y: 8 }, { x: 8, y: 1 }], { x: 10, y: 8 })
    expect(firstBent).not.toEqual(base)
    expect(secondBent).not.toEqual(base)
    expect(firstBent).not.toEqual(secondBent)
  })

  it('supports a configurable number of curve anchors with stable endpoints', () => {
    for (const controls of [
      [{ x: 5, y: 1 }],
      [{ x: 3, y: 1 }, { x: 7, y: 1 }],
      [{ x: 2, y: 6 }, { x: 4, y: 1 }, { x: 7, y: 1 }, { x: 9, y: 6 }]
    ]) {
      const curve = bezierCurvePixelPoints({ x: 1, y: 8 }, controls, { x: 10, y: 8 })
      expect(curve[0]).toMatchObject({ x: 1, y: 8 })
      expect(curve.at(-1)).toMatchObject({ x: 10, y: 8 })
    }
  })

  it('clips path shapes to the active selection while keeping one pixel edit', () => {
    const document = createDocument('selected path shape', 8, 8, 'rgba')
    const layer = getActiveLayer(document)
    const edit = beginPixelEdit(layer.id)
    const points = filledShapePathPixelPoints(document, [{ x: 1, y: 1 }, { x: 6, y: 1 }, { x: 6, y: 6 }, { x: 1, y: 6 }])
    paintShapePixelPoints(document, layer, edit, points, blue, { x: 3, y: 3, width: 2, height: 2 })
    expect(edit.before.size).toBe(4)
    expect(readLayerColorAt(document, layer, 3, 3)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 2, 2).a).toBe(0)
  })

  it('keeps unrotated shape pixels compatible with the existing rasterizer', () => {
    const bounds = { x: 3, y: 4, width: 7, height: 5 }
    for (const kind of ['rectangle', 'rectangle-outline', 'ellipse', 'ellipse-outline'] as const) {
      expect(rotatedShapePixelPoints(bounds, kind, 20, 20, 0)).toEqual(shapePixelPoints(bounds, kind))
    }
  })

  it('uses the same filled-shape membership for sampled previews and exact rasterization', () => {
    for (const bounds of [
      { x: 3, y: 4, width: 1, height: 1 },
      { x: 3, y: 4, width: 2, height: 3 },
      { x: 3, y: 4, width: 7, height: 5 },
      { x: -2, y: 1, width: 8, height: 6 }
    ]) {
      for (const kind of ['rectangle', 'ellipse'] as const) {
        const exact = new Set(shapePixelPoints(bounds, kind).map(({ x, y }) => `${x}:${y}`))
        for (let y = bounds.y - 1; y <= bounds.y + bounds.height; y += 1) {
          for (let x = bounds.x - 1; x <= bounds.x + bounds.width; x += 1) {
            expect(shapeContainsPixel(bounds, kind, x, y)).toBe(exact.has(`${x}:${y}`))
          }
        }
      }
    }
  })

  it('commits exactly the same pixels shown by a rotated shape preview', () => {
    const document = createDocument('rotated shape preview', 24, 24, 'rgba')
    const layer = getActiveLayer(document)
    const bounds = { x: 5, y: 7, width: 11, height: 7 }
    const angle = 37
    const preview = rotatedShapePixelPoints(bounds, 'rectangle', document.width, document.height, angle)
    const edit = beginPixelEdit(layer.id)

    paintShape(document, layer, edit, bounds, 'rectangle', blue, null, undefined, undefined, angle)

    expect([...edit.before.keys()].sort((left, right) => left - right)).toEqual(
      preview.map(({ x, y }) => y * document.width + x).sort((left, right) => left - right)
    )
  })

  it('keeps rotated ellipse outlines hollow', () => {
    const bounds = { x: 6, y: 7, width: 9, height: 7 }
    const filled = rotatedShapePixelPoints(bounds, 'ellipse', 24, 24, 37)
    const outline = rotatedShapePixelPoints(bounds, 'ellipse-outline', 24, 24, 37)
    const center = { x: bounds.x + Math.floor(bounds.width / 2), y: bounds.y + Math.floor(bounds.height / 2) }

    expect(outline.length).toBeLessThan(filled.length)
    expect(filled).toContainEqual({ ...center, coverage: 255 })
    expect(outline).not.toContainEqual({ ...center, coverage: 255 })
  })

  it('does not reintroduce isolated corner tips in rotated rectangle shapes', () => {
    const points = rotatedShapePixelPoints({ x: 4, y: 5, width: 12, height: 8 }, 'rectangle', 32, 32, 37)
    const occupied = new Set(points.map(({ x, y }) => `${x}:${y}`))
    for (const { x, y } of points) {
      const neighbors = Number(occupied.has(`${x - 1}:${y}`))
        + Number(occupied.has(`${x + 1}:${y}`))
        + Number(occupied.has(`${x}:${y - 1}`))
        + Number(occupied.has(`${x}:${y + 1}`))
      expect(neighbors).toBeGreaterThanOrEqual(2)
    }
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

  it('keeps legacy coverage-mask brushes as one-color dithered stamps', () => {
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

  it('invalidates every reflected edge of an even brush stamp', () => {
    const document = createDocument('even symmetric invalidation', 32, 32, 'rgba')
    const layer = getActiveLayer(document)
    const edit = beginPixelEdit(layer.id)
    const axes = { horizontal: true, vertical: false, diagonalUp: false, diagonalDown: false }
    const center = { x: 16, y: 16 }
    const point = { x: 8, y: 8 }

    paintBrush(document, layer, edit, point.x, point.y, 8, blue, 'square', null, 'solid', 1, null, undefined, 0, 'paint', undefined, axes, center)
    const rects = brushStrokeInvalidationRects(point, point, 8, null, document.width, document.height, axes, center)

    expect(readLayerColorAt(document, layer, 4, 27)).toEqual(blue)
    expect(rects.some((rect) => 4 >= rect.x && 4 < rect.x + rect.width && 27 >= rect.y && 27 < rect.y + rect.height)).toBe(true)
    for (const index of edit.after.keys()) {
      const x = index % layer.width + layer.offsetX
      const y = Math.floor(index / layer.width) + layer.offsetY
      expect(rects.some((rect) => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height)).toBe(true)
    }
  })

  it('invalidates every rotated pixel of a non-square intrinsic brush', () => {
    const document = createDocument('rotational brush invalidation', 32, 32, 'rgba')
    const layer = getActiveLayer(document)
    const edit = beginPixelEdit(layer.id)
    const brush = { id: 'selection.png', name: 'selection', width: 4, height: 2, coverage: new Uint8Array(8).fill(255), intrinsicSize: true }
    const axes = { horizontal: false, vertical: false, diagonalUp: false, diagonalDown: false, rotational: true }
    const center = { x: 16, y: 16 }
    const point = { x: 8, y: 8 }

    paintBrush(document, layer, edit, point.x, point.y, 4, blue, 'square', null, 'solid', 1, brush, undefined, 0, 'paint', undefined, axes, center)
    const rects = brushStrokeInvalidationRects(point, point, 4, brush, document.width, document.height, axes, center)

    for (const index of edit.after.keys()) {
      const x = index % layer.width + layer.offsetX
      const y = Math.floor(index / layer.width) + layer.offsetY
      expect(rects.some((rect) => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height)).toBe(true)
    }
  })

  it('adds one low-strength intermediate level only to procedural textures', () => {
    const procedural = createProceduralBrushes()[0]
    const settings = { mode: 'threshold' as const, threshold: 128, blackPoint: 0, whitePoint: 255, invert: false }
    const mask = brushMaskOffsets(64, 'square', 'solid', 1, 0, 0, procedural, settings, 20)
    expect(new Set(mask.map((point) => point.coverage))).toEqual(new Set([128, 255]))
  })

  it('keeps legacy coverage-mask brushes hard-edged when procedural antialiasing is enabled', () => {
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

  it('uses integer hard-edged ellipse rows for round brush sizes', () => {
    const rowWidths = (size: number): number[] => {
      const rows = new Array<number>(size).fill(0)
      for (const point of brushMaskOffsets(size, 'round')) rows[point.y] += 1
      return rows
    }

    expect(rowWidths(2)).toEqual([2, 2])
    expect(rowWidths(3)).toEqual([1, 3, 1])
    expect(rowWidths(4)).toEqual([2, 4, 4, 2])
    expect(rowWidths(5)).toEqual([3, 5, 5, 5, 3])
    expect(rowWidths(6)).toEqual([2, 4, 6, 6, 4, 2])
    expect(rowWidths(8)).toEqual([4, 6, 8, 8, 8, 8, 6, 4])
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
    const covered = new Set(brushMaskOffsets(3, 'round').map((point) => point.y * 3 + point.x))
    for (let index = 0; index < 9; index += 1) {
      expect(readLayerColor(document, layer, index).a).toBe(covered.has(index) ? 0 : 255)
    }
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

  it('keeps translucent connected line joints at one stroke of coverage', () => {
    const document = createDocument('connected alpha lines', 3, 3, 'rgba')
    const layer = getActiveLayer(document)
    const color = { r: 41, g: 121, b: 255, a: 128 }
    const first = beginPixelEdit(layer.id)
    paintLine(document, layer, first, 0, 0, 2, 0, 1, color)
    const jointAfterFirst = readLayerColor(document, layer, 2)

    const second = beginPixelEdit(layer.id)
    inheritBrushPaintBaseline(second, first.before)
    paintLine(document, layer, second, 2, 0, 2, 2, 1, color)
    const secondBaseline = new Map(first.before)
    for (const [index, value] of second.before) if (!secondBaseline.has(index)) secondBaseline.set(index, value)
    const third = beginPixelEdit(layer.id)
    inheritBrushPaintBaseline(third, secondBaseline)
    paintLine(document, layer, third, 2, 2, 0, 2, 1, color)

    expect(readLayerColor(document, layer, 2)).toEqual(jointAfterFirst)
    expect(readLayerColor(document, layer, 2 + document.width * 2)).toEqual(jointAfterFirst)
    expect(second.before.has(2)).toBe(false)
    expect(third.before.has(2 + document.width * 2)).toBe(false)
  })

  it('scales pencil and eraser coverage without accumulating repeated samples', () => {
    const pencilDocument = createDocument('pressure pencil', 1, 1, 'rgba')
    const pencilLayer = getActiveLayer(pencilDocument)
    const pencilEdit = beginPixelEdit(pencilLayer.id)
    paintBrush(pencilDocument, pencilLayer, pencilEdit, 0, 0, 1, red, 'square', null, 'solid', 1, null, undefined, 0, 'paint', undefined, undefined, undefined, undefined, 0.5)
    paintBrush(pencilDocument, pencilLayer, pencilEdit, 0, 0, 1, red, 'square', null, 'solid', 1, null, undefined, 0, 'paint', undefined, undefined, undefined, undefined, 0.5)
    expect(readLayerColor(pencilDocument, pencilLayer, 0)).toEqual({ ...red, a: 128 })

    const eraserDocument = createDocument('pressure eraser', 1, 1, 'rgba')
    const eraserLayer = getActiveLayer(eraserDocument)
    writeLayerColor(eraserDocument, eraserLayer, 0, blue)
    const eraserEdit = beginPixelEdit(eraserLayer.id)
    const transparent = { r: 0, g: 0, b: 0, a: 0 }
    paintBrush(eraserDocument, eraserLayer, eraserEdit, 0, 0, 1, transparent, 'square', null, 'solid', 1, null, undefined, 0, 'paint', undefined, undefined, undefined, undefined, 0.5)
    paintBrush(eraserDocument, eraserLayer, eraserEdit, 0, 0, 1, transparent, 'square', null, 'solid', 1, null, undefined, 0, 'paint', undefined, undefined, undefined, undefined, 0.5)
    expect(readLayerColor(eraserDocument, eraserLayer, 0).a).toBe(127)
  })

  it('replaces equal-coverage gradient samples from the pre-stroke pixel', () => {
    const document = createDocument('dynamic gradient', 1, 1, 'rgba')
    const layer = getActiveLayer(document)
    const edit = beginPixelEdit(layer.id)
    paintBrush(document, layer, edit, 0, 0, 1, red, 'square', null, 'solid', 1, null, undefined, 0, 'paint', undefined, undefined, undefined, undefined, 0.5, 'paint:brush-gradient')
    paintBrush(document, layer, edit, 0, 0, 1, { r: 0, g: 255, b: 0, a: 255 }, 'square', null, 'solid', 1, null, undefined, 0, 'paint', undefined, undefined, undefined, undefined, 0.5, 'paint:brush-gradient')
    expect(readLayerColor(document, layer, 0)).toEqual({ r: 0, g: 255, b: 0, a: 128 })
  })

  it('resolves fixed dynamic amounts per absolute RGBA pixel with dithering', () => {
    const document = createDocument('dynamic dither', 2, 1, 'rgba')
    const layer = getActiveLayer(document)
    paintBrush(document, layer, beginPixelEdit(layer.id), 1, 0, 2, red, 'square', null, 'solid', 1, null, undefined, 0, 'paint', undefined, undefined, undefined, undefined, 1, undefined, false, {
      startColor: { r: 0, g: 0, b: 0, a: 0 },
      endColor: blue,
      gradientAmount: 0.5,
      dither: 'checker'
    })
    expect(readLayerColor(document, layer, 0)).toEqual(blue)
    expect(readLayerColor(document, layer, 1).a).toBe(0)
  })

  it('paints dynamic RGBA interpolation in indexed mode without palette growth', () => {
    const document = createDocument('indexed gradient v4', 1, 1, 'indexed')
    const layer = getActiveLayer(document)
    const initialPaletteSize = document.palette.length
    const gradient = { startColor: red, endColor: blue, gradientAmount: 0.5, dither: 'none' as const }
    const edit = beginPixelEdit(layer.id)
    for (let index = 0; index < 20; index += 1) {
      paintBrush(document, layer, edit, 0, 0, 1, red, 'square', null, 'solid', 1, null, undefined, 0, 'paint', undefined, undefined, undefined, undefined, 1, undefined, false, gradient)
    }
    expect(document.paletteOrder).toContain(layer.pixels[0])
    expect(readLayerColor(document, layer, 0)).toEqual(document.palette.find((entry) => entry.id === layer.pixels[0])!.color)
    expect(document.palette.length).toBe(initialPaletteSize)
  })

  it('does not add indexed palette colors across repeated gradient samples', () => {
    const document = createDocument('indexed dynamic gradient', 1, 1, 'indexed')
    const layer = getActiveLayer(document)
    const edit = beginPixelEdit(layer.id)
    const initialPaletteSize = document.palette.length
    for (let index = 0; index < 100; index += 1) {
      const color = index % 2 === 0 ? red : blue
      paintBrush(document, layer, edit, 0, 0, 1, color, 'square', null, 'solid', 1, null, undefined, 0, 'paint', undefined, undefined, undefined, undefined, 0.5, 'paint:brush-gradient')
    }
    expect(document.palette.length).toBe(initialPaletteSize)
  })

  it('interpolates pressure dynamics across a painted line', () => {
    const document = createDocument('pressure line', 3, 1, 'rgba')
    const layer = getActiveLayer(document)
    const edit = beginPixelEdit(layer.id)
    paintLine(document, layer, edit, 0, 0, 2, 0, 1, red, null, 'square', 'solid', 1, null, undefined, 0, 'paint', undefined, 'raster', undefined, undefined, undefined, {
      fromSize: 1,
      toSize: 1,
      fromOpacityScale: 0.25,
      toOpacityScale: 1
    })
    expect([0, 1, 2].map((index) => readLayerColor(document, layer, index).a)).toEqual([64, 159, 255])
  })

  it('interpolates gradient amounts across a painted line', () => {
    const document = createDocument('gradient line v4', 3, 1, 'rgba')
    const layer = getActiveLayer(document)
    paintLine(document, layer, beginPixelEdit(layer.id), 0, 0, 2, 0, 1, red, null, 'square', 'solid', 1, null, undefined, 0, 'paint', undefined, 'raster', undefined, undefined, undefined, {
      gradient: { startColor: red, endColor: blue, fromAmount: 0, toAmount: 1, dither: 'none' }
    })
    expect([0, 1, 2].map((index) => readLayerColor(document, layer, index))).toEqual([
      red,
      { r: 148, g: 85, b: 152, a: 255 },
      blue
    ])
  })

  it('stamps every candidate whose integer size changed for both line algorithms', () => {
    for (const algorithm of ['raster', 'balanced'] as const) {
      const start = { x: 40, y: 40 }
      const end = { x: 42, y: 41 }
      const points = algorithm === 'raster' ? rasterLinePoints(start, end) : balancedStairLinePoints(start, end)
      const footprint = (point: { x: number; y: number }, size: number): Set<string> => {
        const anchor = brushStampAnchor(size)
        return new Set(brushMaskOffsets(size, 'square').map((offset) => `${point.x - anchor.x + offset.x},${point.y - anchor.y + offset.y}`))
      }
      const first = footprint(points[0], 32)
      const middle = footprint(points[1], 31)
      const last = footprint(points[2], 30)
      const unique = [...middle].find((key) => !first.has(key) && !last.has(key))
      expect(unique).toBeDefined()
      const [targetX, targetY] = unique!.split(',').map(Number)
      const document = createDocument(`size spacing ${algorithm}`, 100, 100, 'rgba')
      const layer = getActiveLayer(document)
      paintLine(document, layer, beginPixelEdit(layer.id), start.x, start.y, end.x, end.y, 32, blue, { x: targetX, y: targetY, width: 1, height: 1 }, 'square', 'solid', 1, null, undefined, 0, 'paint', undefined, algorithm, undefined, undefined, undefined, {
        fromSize: 32,
        toSize: 30
      })
      expect(readLayerColorAt(document, layer, targetX, targetY)).toEqual(blue)
    }
  })

  it('blends a translucent pencil color in indexed mode without repeated buildup', () => {
    const document = createDocument('indexed alpha pencil', 1, 1, 'indexed')
    const layer = getActiveLayer(document)
    const base = beginPixelEdit(layer.id)
    paintLine(document, layer, base, 0, 0, 0, 0, 1, blue)
    const edit = beginPixelEdit(layer.id)
    const translucentRed = { r: 255, g: 0, b: 0, a: 128 }
    findOrAddPaletteColor(document, { r: 148, g: 60, b: 127, a: 255 }, true)
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

  it('includes both shear and rotation in the shared transformed bounds', () => {
    const source = { x: 2, y: 2, width: 3, height: 3 }
    const shear = { axis: 'x' as const, edge: 'n' as const, amount: 2 }
    expect(transformedSelectionBounds(source, 90, shear)).toEqual({ x: 2, y: 2, width: 3, height: 5 })
    const transformed = transformSelectionMask(source, source, 10, 10, 90, shear)
    expect(transformed && { x: transformed.x, y: transformed.y, width: transformed.width, height: transformed.height }).toEqual({ x: 2, y: 2, width: 3, height: 5 })
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

  it('moves compact selection sources without precomputed offset arrays', () => {
    const document = createDocument('compact capture', 4, 2, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, blue)
    writeLayerColor(document, layer, 1, red)
    const selection = { x: 0, y: 0, width: 2, height: 1, mask: Uint8Array.from([1, 0]) }
    const captured = captureSelectionTransform(document, selection, layer)!
    const source = {
      ...captured,
      selectedOffsets: new Uint32Array(0),
      opaqueOffsets: new Uint32Array(0),
      opaqueIndices: new Uint32Array(0),
      opaqueValues: new Uint32Array(0)
    }

    applySelectionTransform(document, source, { ...selection, x: 2 }, 0, false, undefined, undefined, undefined, layer)

    expect(readLayerColorAt(document, layer, 0, 0).a).toBe(0)
    expect(readLayerColorAt(document, layer, 1, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, 2, 0)).toEqual(blue)
  })

  it('keeps large transform captures to one dense pixel surface', () => {
    const document = createDocument('large compact capture', 513, 512, 'rgba')
    const source = captureSelectionTransform(document, { x: 0, y: 0, width: document.width, height: document.height })!

    expect(source.values).toHaveLength(document.width * document.height)
    expect(source.selectedOffsets).toHaveLength(0)
    expect(source.opaqueOffsets).toHaveLength(0)
    expect(source.opaqueIndices).toHaveLength(0)
    expect(source.opaqueValues).toHaveLength(0)
  })

  it('captures rectangular RGBA pixels and offsets in row order', () => {
    const document = createDocument('capture rectangle', 4, 3, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 1, blue)
    writeLayerColor(document, layer, 2 + document.width, red)

    const source = captureSelectionTransform(document, { x: 1, y: 0, width: 2, height: 2 })!

    expect(Array.from(source.selectedOffsets)).toEqual([0, 1, 2, 3])
    expect(Array.from(source.opaqueOffsets)).toEqual([0, 3])
    expect(Array.from(source.opaqueIndices)).toEqual([1, 6])
    expect(source.opaqueValues).toEqual(Uint32Array.from([packColor(blue), packColor(red)]))
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

  it('does not duplicate pixels when rotating rectangular layer content', () => {
    const document = createDocument('rotate rectangular layer content', 16, 16, 'rgba')
    const layer = getActiveLayer(document)
    const rows = [
      '.RRRR...',
      'RB..BR..',
      'R....R..',
      'R....R..',
      'R..RRRRR',
      'R...RRR.',
      '....R...'
    ]
    for (let localY = 0; localY < rows.length; localY += 1) {
      for (let localX = 0; localX < rows[localY].length; localX += 1) {
        const pixel = rows[localY][localX]
        if (pixel === '.') continue
        writeLayerColor(document, layer, (2 + localY) * document.width + 2 + localX, pixel === 'B' ? blue : red)
      }
    }
    const selection = { x: 2, y: 2, width: 8, height: 7 }
    const source = captureSelectionTransform(document, selection)!

    applySelectionTransform(document, source, selection, 82)

    let opaqueCount = 0
    for (let y = 0; y < document.height; y += 1) {
      for (let x = 0; x < document.width; x += 1) {
        if (readLayerColorAt(document, layer, x, y).a > 0) opaqueCount += 1
      }
    }
    expect(opaqueCount).toBe(23)
  })

  it('fills inverse-sampled pixels inside dense rotated content', () => {
    const document = createDocument('rotate dense layer content', 48, 48, 'rgba')
    const layer = getActiveLayer(document)
    const selection = { x: 12, y: 12, width: 24, height: 24 }
    const insideSource = (x: number, y: number): boolean => {
      const offsetX = x - selection.x - 11.5
      const offsetY = y - selection.y - 11.5
      return offsetX * offsetX + offsetY * offsetY <= 11.5 * 11.5
    }
    for (let y = selection.y; y < selection.y + selection.height; y += 1) {
      for (let x = selection.x; x < selection.x + selection.width; x += 1) {
        if (insideSource(x, y)) writeLayerColor(document, layer, y * document.width + x, blue)
      }
    }
    const source = captureSelectionTransform(document, selection)!

    applySelectionTransform(document, source, selection, 30)

    const transformed = transformedSelectionBounds(selection, 30)
    for (let y = transformed.y; y < transformed.y + transformed.height; y += 1) {
      for (let x = transformed.x; x < transformed.x + transformed.width; x += 1) {
        const sourcePoint = transformedSelectionSourcePoint(selection, selection, x, y, 30)
        if (sourcePoint && insideSource(sourcePoint.x, sourcePoint.y)) {
          expect(readLayerColorAt(document, layer, x, y).a, `missing rotated pixel at ${x},${y}`).toBeGreaterThan(0)
        }
      }
    }
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

  it('uses the same virtual gap boundary for smart-closure magic-wand selections', () => {
    const document = createDocument('smart closure wand', 10, 10, 'rgba')
    const layer = getActiveLayer(document)
    for (let y = 2; y <= 7; y += 1) for (let x = 2; x <= 7; x += 1) {
      if (x !== 2 && x !== 7 && y !== 2 && y !== 7) continue
      if (y === 2 && (x === 4 || x === 5)) continue
      writeLayerColor(document, layer, y * document.width + x, blue)
    }

    const leaking = magicWandSelection(document, layer, 4, 4)
    const closed = magicWandSelection(document, layer, 4, 4, 0, true, 2)

    expect(selectionContains(leaking, 0, 0)).toBe(true)
    expect(selectionContains(closed, 4, 4)).toBe(true)
    expect(selectionContains(closed, 0, 0)).toBe(false)
    expect(selectionContains(closed, 4, 2)).toBe(true)
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

  it('resolves gradient dithering at each final symmetric document coordinate', () => {
    const document = createDocument('symmetric gradient dither', 5, 1, 'rgba')
    const layer = getActiveLayer(document)
    paintBrush(document, layer, beginPixelEdit(layer.id), 1, 0, 1, red, 'square', null, 'solid', 1, null, undefined, 0, 'paint', undefined, { horizontal: false, vertical: true, diagonalUp: false, diagonalDown: false }, undefined, undefined, 1, undefined, false, {
      startColor: red,
      endColor: blue,
      gradientAmount: 0.5,
      dither: 'vertical'
    })
    expect(readLayerColorAt(document, layer, 1, 0)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 3, 0)).toEqual(red)
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

  it('treats background layers as transparent unless a background layer is active', () => {
    const document = createDocument('background sampling', 1, 1, 'rgba')
    const background = getActiveLayer(document)
    background.background = { mode: 'canvas' }
    writeLayerColor(document, background, 0, { r: 0, g: 0, b: 255, a: 255 })
    const foreground = createLayer('Foreground', 1, 1, 'rgba')
    writeLayerColor(document, foreground, 0, { r: 255, g: 0, b: 0, a: 128 })
    document.layers.push(foreground)

    expect(sampleCompositeColor(document, 0, 0, foreground.id)).toEqual({ r: 255, g: 0, b: 0, a: 128 })
    expect(sampleCompositeColor(document, 0, 0, background.id)).toEqual({ r: 128, g: 0, b: 127, a: 255 })
  })
})
