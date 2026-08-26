import { describe, expect, it } from 'vitest'
import { applyColorAdjustment, applyColorAdjustmentDirect, adjustColor, buildCurveHistogram, buildCurveHistogramChunked, buildCurveLut, buildCurvePath, isColorAdjustmentIdentity, type ColorAdjustment } from './adjustments'
import { processAdjustmentPreview } from './adjustment-preview-processing'
import { createDocument, getActiveLayer, readLayerColor, writeLayerColor } from './document'

describe('color adjustments', () => {
  it('keeps alpha while applying brightness and contrast', () => {
    const next = adjustColor({ r: 80, g: 100, b: 120, a: 140 }, { kind: 'brightness-contrast', brightness: 20, contrast: 10 })
    expect(next.a).toBe(140)
    expect(next.r).toBeGreaterThan(80)
  })

  it('adjusts HSL lightness independently from RGB brightness', () => {
    const source = { r: 40, g: 100, b: 180, a: 140 }
    const lighter = adjustColor(source, { kind: 'hue-saturation', lightness: 100 })
    const darker = adjustColor(source, { kind: 'hue-saturation', lightness: -100 })
    expect(lighter).toEqual({ r: 255, g: 255, b: 255, a: 140 })
    expect(darker).toEqual({ r: 0, g: 0, b: 0, a: 140 })
  })

  it('records only changed active-layer pixels', () => {
    const document = createDocument('adjust', 2, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, { r: 10, g: 20, b: 30, a: 255 })
    const edit = applyColorAdjustment(document, layer, { kind: 'brightness-contrast', brightness: 10 })
    expect(edit.before.size).toBe(1)
    expect(readLayerColor(document, layer, 0).r).toBeGreaterThan(10)
  })

  it('limits adjustments to the selection in document coordinates', () => {
    const document = createDocument('selected adjustment', 4, 2, 'rgba')
    const layer = getActiveLayer(document)
    layer.offsetX = 1
    layer.offsetY = 1
    writeLayerColor(document, layer, 0, { r: 10, g: 20, b: 30, a: 255 })
    writeLayerColor(document, layer, 1, { r: 40, g: 50, b: 60, a: 255 })

    const edit = applyColorAdjustment(document, layer, { kind: 'brightness-contrast', brightness: 10 }, { x: 2, y: 1, width: 1, height: 1 })

    expect(edit.before.size).toBe(1)
    expect(readLayerColor(document, layer, 0).r).toBe(10)
    expect(readLayerColor(document, layer, 1).r).toBeGreaterThan(40)
  })

  it.each<ColorAdjustment>([
    { kind: 'brightness-contrast', brightness: 20, contrast: 10 },
    { kind: 'hue-saturation', hue: 25, saturation: 20, lightness: 10 },
    { kind: 'color-balance', midtonesCyanRed: 20, midtonesMagentaGreen: -15, highlightsYellowBlue: 10, preserveLuminosity: true },
    { kind: 'curves', curvePoints: [{ x: 0, y: 0 }, { x: 128, y: 170 }, { x: 255, y: 255 }] }
  ])('matches the history-producing RGBA path for $kind previews', (adjustment) => {
    const expectedDocument = createDocument('expected adjustment', 3, 2, 'rgba')
    const actualDocument = createDocument('direct adjustment', 3, 2, 'rgba')
    const expectedLayer = getActiveLayer(expectedDocument)
    const actualLayer = getActiveLayer(actualDocument)
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 255, 50, 60, 70, 180, 90, 100, 110, 0,
      120, 130, 140, 255, 160, 170, 180, 220, 200, 210, 220, 255
    ])
    expectedLayer.pixels.set(pixels)
    actualLayer.pixels.set(pixels)

    applyColorAdjustment(expectedDocument, expectedLayer, adjustment)
    applyColorAdjustmentDirect(actualDocument, actualLayer, adjustment)

    expect(actualLayer.pixels).toEqual(expectedLayer.pixels)
  })

  it('restores pixels outside a masked selection from the supplied preview baseline', () => {
    const document = createDocument('direct selected adjustment', 3, 1, 'rgba')
    const layer = getActiveLayer(document)
    const baseline = new Uint8ClampedArray([
      10, 20, 30, 255,
      40, 50, 60, 255,
      70, 80, 90, 255
    ])
    layer.pixels.fill(255)

    applyColorAdjustmentDirect(document, layer, { kind: 'brightness-contrast', brightness: 20 }, { x: 0, y: 0, width: 3, height: 1, mask: new Uint8Array([0, 1, 0]) }, baseline)

    expect(readLayerColor(document, layer, 0)).toEqual({ r: 10, g: 20, b: 30, a: 255 })
    expect(readLayerColor(document, layer, 1).r).toBeGreaterThan(40)
    expect(readLayerColor(document, layer, 2)).toEqual({ r: 70, g: 80, b: 90, a: 255 })
  })

  it('limits direct previews to the requested document region', () => {
    const document = createDocument('regional direct adjustment', 4, 2, 'rgba')
    const layer = getActiveLayer(document)
    const baseline = new Uint8ClampedArray(4 * 2 * 4)
    for (let index = 0; index < 8; index += 1) baseline.set([index * 10, 20, 30, 255], index * 4)
    layer.pixels.set(baseline)

    applyColorAdjustmentDirect(document, layer, { kind: 'brightness-contrast', brightness: 20 }, null, baseline, { x: 1, y: 0, width: 2, height: 1 })

    expect(readLayerColor(document, layer, 0)).toEqual({ r: 0, g: 20, b: 30, a: 255 })
    expect(readLayerColor(document, layer, 1).r).toBeGreaterThan(10)
    expect(readLayerColor(document, layer, 2).r).toBeGreaterThan(20)
    expect(readLayerColor(document, layer, 3)).toEqual({ r: 30, g: 20, b: 30, a: 255 })
    expect(readLayerColor(document, layer, 4)).toEqual({ r: 40, g: 20, b: 30, a: 255 })
  })

  it('produces worker preview pixels identical to the complete adjustment path', async () => {
    const document = createDocument('worker adjustment preview', 4, 2, 'rgba')
    const layer = getActiveLayer(document)
    const source = new Uint8ClampedArray([
      10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255,
      130, 140, 150, 255, 160, 170, 180, 255, 190, 200, 210, 255, 220, 230, 240, 255
    ])
    layer.pixels.set(source)
    const selection = { x: 1, y: 0, width: 2, height: 2, mask: new Uint8Array([1, 0, 1, 1]) }
    const adjustment: ColorAdjustment = { kind: 'hue-saturation', hue: 30, saturation: 25, lightness: 10 }
    applyColorAdjustmentDirect(document, layer, adjustment, selection, source)
    const expected = new Uint8ClampedArray(layer.pixels)

    const result = await processAdjustmentPreview({
      documentWidth: 4,
      documentHeight: 2,
      colorMode: 'rgba',
      palette: document.palette,
      paletteOrder: document.paletteOrder,
      nextColorId: document.nextColorId,
      selection,
      locale: 'zh-CN',
      layers: [{ layerId: layer.id, width: 4, height: 2, offsetX: 0, offsetY: 0, format: 'rgba', isMask: false, localContentBounds: { x: 0, y: 0, width: 4, height: 2 }, pixels: source }]
    }, 1, adjustment, { x: 0, y: 0, width: 4, height: 2 })

    expect(result).not.toBeNull()
    const previewLayer = result!.layers[0]
    const actual = new Uint8ClampedArray(source)
    for (let row = 0; row < previewLayer.height; row += 1) {
      const sourceOffset = row * previewLayer.width * 4
      const targetOffset = ((previewLayer.y + row) * 4 + previewLayer.x) * 4
      actual.set((previewLayer.pixels as Uint8ClampedArray).subarray(sourceOffset, sourceOffset + previewLayer.width * 4), targetOffset)
    }
    expect(actual).toEqual(expected)
  })

  it('recognizes neutral adjustment controls without processing pixels', () => {
    expect(isColorAdjustmentIdentity({ kind: 'brightness-contrast', brightness: 0, contrast: 0 })).toBe(true)
    expect(isColorAdjustmentIdentity({ kind: 'curves', curvePoints: [{ x: 0, y: 0 }, { x: 255, y: 255 }] })).toBe(true)
    expect(isColorAdjustmentIdentity({ kind: 'hue-saturation', saturation: 1 })).toBe(false)
  })

  it('builds chunked curve histograms with the same values as the synchronous path', async () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 255,
      10, 20, 30, 255,
      90, 80, 70, 128,
      1, 2, 3, 0
    ])
    expect(await buildCurveHistogramChunked(pixels, 'rgba', [])).toEqual(buildCurveHistogram(pixels, 'rgba', []))
  })

  it('matches indexed adjustment quantization while reusing transformed palette ids', () => {
    const expectedDocument = createDocument('expected indexed adjustment', 3, 1, 'indexed')
    const actualDocument = createDocument('direct indexed adjustment', 3, 1, 'indexed')
    expectedDocument.palette = [
      { id: 0, name: 'Transparent', color: { r: 0, g: 0, b: 0, a: 0 } },
      { id: 1, name: 'Dark', color: { r: 20, g: 30, b: 40, a: 255 } },
      { id: 2, name: 'Light', color: { r: 180, g: 190, b: 200, a: 255 } }
    ]
    actualDocument.palette = expectedDocument.palette.map((entry) => ({ ...entry, color: { ...entry.color } }))
    expectedDocument.paletteOrder = [1, 2]
    actualDocument.paletteOrder = [1, 2]
    expectedDocument.nextColorId = 3
    actualDocument.nextColorId = 3
    const expectedLayer = getActiveLayer(expectedDocument)
    const actualLayer = getActiveLayer(actualDocument)
    expectedLayer.pixels.set([1, 1, 2])
    actualLayer.pixels.set([1, 1, 2])

    applyColorAdjustment(expectedDocument, expectedLayer, { kind: 'brightness-contrast', brightness: 20 })
    applyColorAdjustmentDirect(actualDocument, actualLayer, { kind: 'brightness-contrast', brightness: 20 })

    expect(actualLayer.pixels).toEqual(expectedLayer.pixels)
  })

  it('matches grayscale normalization in the direct preview path', () => {
    const expectedDocument = createDocument('expected grayscale adjustment', 2, 1, 'grayscale')
    const actualDocument = createDocument('direct grayscale adjustment', 2, 1, 'grayscale')
    const expectedLayer = getActiveLayer(expectedDocument)
    const actualLayer = getActiveLayer(actualDocument)
    expectedLayer.pixels.set([20, 20, 20, 255, 180, 180, 180, 255])
    actualLayer.pixels.set(expectedLayer.pixels)

    applyColorAdjustment(expectedDocument, expectedLayer, { kind: 'color-balance', midtonesCyanRed: 35, preserveLuminosity: false })
    applyColorAdjustmentDirect(actualDocument, actualLayer, { kind: 'color-balance', midtonesCyanRed: 35, preserveLuminosity: false })

    expect(actualLayer.pixels).toEqual(expectedLayer.pixels)
  })

  it('matches transparent grayscale and indexed normalization', () => {
    const expectedGray = createDocument('expected transparent grayscale', 1, 1, 'grayscale')
    const actualGray = createDocument('direct transparent grayscale', 1, 1, 'grayscale')
    getActiveLayer(expectedGray).pixels.set([20, 80, 140, 0])
    getActiveLayer(actualGray).pixels.set([20, 80, 140, 0])
    applyColorAdjustment(expectedGray, getActiveLayer(expectedGray), { kind: 'brightness-contrast', brightness: 20 })
    applyColorAdjustmentDirect(actualGray, getActiveLayer(actualGray), { kind: 'brightness-contrast', brightness: 20 })
    expect(getActiveLayer(actualGray).pixels).toEqual(getActiveLayer(expectedGray).pixels)

    const expectedIndexed = createDocument('expected transparent indexed', 1, 1, 'indexed')
    const actualIndexed = createDocument('direct transparent indexed', 1, 1, 'indexed')
    const hidden = { id: 4, name: 'Hidden', color: { r: 20, g: 80, b: 140, a: 0 } }
    expectedIndexed.palette.push(hidden)
    actualIndexed.palette.push({ ...hidden, color: { ...hidden.color } })
    expectedIndexed.paletteOrder.push(hidden.id)
    actualIndexed.paletteOrder.push(hidden.id)
    getActiveLayer(expectedIndexed).pixels[0] = hidden.id
    getActiveLayer(actualIndexed).pixels[0] = hidden.id
    applyColorAdjustment(expectedIndexed, getActiveLayer(expectedIndexed), { kind: 'brightness-contrast', brightness: 20 })
    applyColorAdjustmentDirect(actualIndexed, getActiveLayer(actualIndexed), { kind: 'brightness-contrast', brightness: 20 })
    expect(getActiveLayer(actualIndexed).pixels).toEqual(getActiveLayer(expectedIndexed).pixels)
  })

  it('balances independent cyan-red, magenta-green and yellow-blue channels', () => {
    const source = { r: 128, g: 128, b: 128, a: 255 }
    const red = adjustColor(source, { kind: 'color-balance', midtonesCyanRed: 40, preserveLuminosity: false })
    const green = adjustColor(source, { kind: 'color-balance', midtonesMagentaGreen: 40, preserveLuminosity: false })
    const blue = adjustColor(source, { kind: 'color-balance', midtonesYellowBlue: 40, preserveLuminosity: false })
    expect(red.r).toBeGreaterThan(red.g)
    expect(green.g).toBeGreaterThan(green.r)
    expect(blue.b).toBeGreaterThan(blue.r)
  })

  it('builds an identity LUT from endpoint controls', () => {
    const lut = buildCurveLut([{ x: 0, y: 0 }, { x: 255, y: 255 }])
    expect(lut[0]).toBe(0)
    expect(lut[128]).toBe(128)
    expect(lut[255]).toBe(255)
  })

  it('applies manually positioned curve controls', () => {
    const next = adjustColor({ r: 128, g: 64, b: 200, a: 180 }, { kind: 'curves', curvePoints: [{ x: 0, y: 0 }, { x: 128, y: 192 }, { x: 255, y: 255 }] })
    expect(next.r).toBeGreaterThan(160)
    expect(next.g).toBeGreaterThan(64)
    expect(next.a).toBe(180)
  })

  it('applies RGB and independent channel bezier curves', () => {
    const next = adjustColor({ r: 64, g: 64, b: 64, a: 255 }, {
      kind: 'curves',
      curvePoints: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
      curveRedPoints: [{ x: 0, y: 0 }, { x: 64, y: 160 }, { x: 255, y: 255 }]
    })
    expect(next.r).toBeGreaterThan(next.g)
    expect(next.g).toBe(64)
    expect(next.b).toBe(64)
  })

  it('uses a cubic bezier path for curve editing', () => {
    expect(buildCurvePath([{ x: 0, y: 0 }, { x: 128, y: 220 }, { x: 255, y: 255 }])).toContain('C')
  })

  it('builds channel histograms from opaque RGBA pixels', () => {
    const histogram = buildCurveHistogram(new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 0
    ]), 'rgba', [])
    expect(histogram.red[255]).toBe(1)
    expect(histogram.green[255]).toBe(1)
    expect(histogram.blue[255]).toBe(0)
    expect(histogram.rgb[85]).toBe(2)
  })

  it('builds channel histograms from indexed palette pixels', () => {
    const histogram = buildCurveHistogram(new Uint32Array([2, 1]), 'indexed', [
      { id: 1, color: { r: 12, g: 34, b: 56, a: 255 } },
      { id: 2, color: { r: 200, g: 100, b: 50, a: 255 } }
    ])
    expect(histogram.red[200]).toBe(1)
    expect(histogram.green[34]).toBe(1)
    expect(histogram.blue[50]).toBe(1)
  })
})
