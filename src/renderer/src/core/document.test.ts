import { describe, expect, it } from 'vitest'
import { blendWithMode } from './raster'
import { compositeRegion, createCompositePointSampler, createCompositeSampler, createDocument, createLayer, layerContentBounds, readLayerColor, readLayerColorAt, resizeDocumentAt, resizeDocumentImage, writeLayerColor } from './document'

const red = { r: 255, g: 0, b: 0, a: 255 }
const blue = { r: 0, g: 0, b: 255, a: 128 }

describe('document compositing', () => {
  it('creates layers without a display color marker by default', () => {
    expect(createLayer('plain', 1, 1, 'rgba').displayColor).toBeUndefined()
  })

  it('starts new documents with timelapse recording enabled by default', () => {
    expect(createDocument('timelapse default', 1, 1, 'rgba').timelapse?.enabled).toBe(true)
  })

  it('copies a single RGBA layer region without changing transparent pixels', () => {
    const document = createDocument('single layer', 3, 2, 'rgba')
    const layer = document.layers[0]
    writeLayerColor(document, layer, 4, red)

    expect(Array.from(compositeRegion(document, 1, 1, 2, 1))).toEqual([255, 0, 0, 255, 0, 0, 0, 0])
  })

  it('preserves normal alpha compositing across flat layers', () => {
    const document = createDocument('flat layers', 1, 1, 'rgba')
    const bottom = document.layers[0]
    const top = createLayer('top', 1, 1, 'rgba')
    document.layers.push(top)
    writeLayerColor(document, bottom, 0, red)
    writeLayerColor(document, top, 0, blue)

    expect(Array.from(compositeRegion(document, 0, 0, 1, 1))).toEqual(Object.values(blendWithMode(red, blue, 1, 'normal')))
  })

  it('preserves nested group order and opacity', () => {
    const document = createDocument('nested groups', 1, 1, 'rgba')
    const bottom = document.layers[0]
    const grouped = createLayer('grouped', 1, 1, 'rgba')
    grouped.groupId = 'child'
    document.layers.push(grouped)
    document.groups.push(
      { id: 'parent', name: 'parent', parentGroupId: null, visible: true, locked: false, opacity: 0.5, blendMode: 'normal' },
      { id: 'child', name: 'child', parentGroupId: 'parent', visible: true, locked: false, opacity: 1, blendMode: 'normal' }
    )
    writeLayerColor(document, bottom, 0, red)
    writeLayerColor(document, grouped, 0, { ...blue, a: 255 })

    const expected = blendWithMode(red, { ...blue, a: 255 }, 0.5, 'normal')
    expect(Array.from(compositeRegion(document, 0, 0, 1, 1))).toEqual(Object.values(expected))
  })

  it('substitutes an active-layer color in a compiled sampler', () => {
    const document = createDocument('replacement', 1, 1, 'rgba')
    const layer = document.layers[0]
    writeLayerColor(document, layer, 0, red)
    const replacement = { r: 10, g: 220, b: 30, a: 255 }

    expect(createCompositeSampler(document, layer.id, replacement)(0)).toEqual(replacement)
  })

  it('previews a replacement color in newly expanded canvas space', () => {
    const document = createDocument('expanded preview', 2, 1, 'rgba')
    const layer = document.layers[0]
    resizeDocumentAt(document, 4, 1, 2, 0)
    const replacement = { r: 10, g: 220, b: 30, a: 255 }
    const samplePreview = createCompositePointSampler(document, layer.id, replacement)
    const sampleDocument = createCompositePointSampler(document)

    expect(layer).toMatchObject({ offsetX: 2, width: 2 })
    expect(samplePreview(0, 0)).toEqual(replacement)
    expect(sampleDocument(0, 0)).toEqual({ r: 0, g: 0, b: 0, a: 0 })
    expect(samplePreview(-1, 0)).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })

  it('keeps a moved layer bitmap intact outside the canvas and composites it after moving back', () => {
    const document = createDocument('offset layer', 2, 1, 'rgba')
    const layer = document.layers[0]
    writeLayerColor(document, layer, 0, red)
    layer.offsetX = 3
    expect(Array.from(compositeRegion(document, 0, 0, 2, 1))).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    expect(readLayerColorAt(document, layer, 3, 0)).toEqual(red)
    layer.offsetX = 1
    expect(Array.from(compositeRegion(document, 0, 0, 2, 1))).toEqual([0, 0, 0, 0, 255, 0, 0, 255])
  })

  it('composites grouped layer pixels outside the current canvas bounds', () => {
    const document = createDocument('outside composite', 2, 1, 'rgba')
    const layer = document.layers[0]
    layer.width = 1
    layer.height = 1
    layer.offsetX = -1
    layer.offsetY = 0
    layer.pixels = new Uint8ClampedArray(4)
    writeLayerColor(document, layer, 0, { r: 255, g: 0, b: 0, a: 255 })
    document.groups.push({ id: 'group', name: 'group', visible: true, locked: false, opacity: 1, blendMode: 'normal', parentGroupId: null })
    layer.groupId = 'group'

    expect(Array.from(compositeRegion(document, -1, 0, 1, 1))).toEqual([255, 0, 0, 255])
  })

  it('finds sparse layer content in canvas coordinates', () => {
    const document = createDocument('content bounds', 6, 5, 'rgba')
    const layer = document.layers[0]
    layer.offsetX = -2
    layer.offsetY = 3
    writeLayerColor(document, layer, 1 + layer.width, red)
    writeLayerColor(document, layer, 4 + layer.width * 3, blue)

    expect(layerContentBounds(document, layer)).toEqual({ x: -1, y: 4, width: 4, height: 3 })
  })

  it('returns no content bounds for a transparent layer', () => {
    const document = createDocument('empty bounds', 3, 2, 'indexed')
    expect(layerContentBounds(document, document.layers[0])).toBeNull()
  })

  it('permanently crops layer pixels outside the resized canvas when requested', () => {
    const document = createDocument('trim canvas', 4, 2, 'rgba')
    const layer = document.layers[0]
    writeLayerColor(document, layer, 0, red)
    writeLayerColor(document, layer, 3, blue)

    resizeDocumentAt(document, 2, 2, 0, 0, true)

    expect(layer).toMatchObject({ offsetX: 0, offsetY: 0, width: 2, height: 2 })
    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, 3, 0).a).toBe(0)
    expect(layerContentBounds(document, layer)).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })

  it('resizes layer pixels, offsets, and the document together', () => {
    const document = createDocument('image resize', 2, 1, 'rgba')
    const layer = document.layers[0]
    layer.offsetX = 1
    writeLayerColor(document, layer, 0, red)

    resizeDocumentImage(document, 4, 2, 'nearest')

    expect(document.width).toBe(4)
    expect(document.height).toBe(2)
    expect(layer.width).toBe(4)
    expect(layer.height).toBe(2)
    expect(layer.offsetX).toBe(2)
    expect(layer.offsetY).toBe(0)
    expect(readLayerColor(document, layer, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, 2, 0)).toEqual(red)
  })
})
