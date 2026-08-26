import { describe, expect, it } from 'vitest'
import { blendWithMode, packColor, writeRgbaPixel } from './raster'
import { createDefaultLayerStyles } from './layer-styles'
import { activateAnimationFrame, duplicateAnimationFrame, ensureAnimationDocument } from './animation'
import { cachedLayerContentBounds, captureDocumentImageResizeSnapshot, compositePixelWithLayerColor, compositeRegion, createCompositePointReplacementSampler, createCompositePointSampler, createCompositeSampler, createDocument, createLayer, createLayerMask, createNormalCompositePointReplacementSampler, createNormalCompositePointSampler, DocumentCompositeCache, getPaletteEntry, layerContentBounds, markLayerContentChanged, normalCompositeLayers, paletteColorIdForCanvas, readLayerColor, readLayerColorAt, readLayerMaskDisplayColorAt, renderLayerMaskRegion, resizeDocumentAt, resizeDocumentImage, resolveLayerCanvasColor, restoreDocumentImageResizeSnapshot, writeLayerColor, writeLayerPackedRun } from './document'
import { assignRasterStorage, installRuntimeRaster, surfacePixelsMaterialized } from './runtime-raster'

const red = { r: 255, g: 0, b: 0, a: 255 }
const blue = { r: 0, g: 0, b: 255, a: 128 }

describe('document compositing', () => {
  it('distinguishes unknown content bounds from cached empty or populated bounds', () => {
    const document = createDocument('known bounds', 8, 6, 'rgba')
    const layer = document.layers[0]
    writeLayerColor(document, layer, 3 * layer.width + 4, red)

    expect(cachedLayerContentBounds(document, layer)).toBeUndefined()
    expect(layerContentBounds(document, layer)).toEqual({ x: 4, y: 3, width: 1, height: 1 })
    expect(cachedLayerContentBounds(document, layer)).toEqual({ x: 4, y: 3, width: 1, height: 1 })
  })

  it('keeps binary-alpha cached shadow and inner glow pixel-identical', () => {
    const document = createDocument('binary style cache', 18, 14, 'rgba')
    const layer = document.layers[0]
    for (let y = 4; y < 10; y += 1) for (let x = 5; x < 13; x += 1) {
      if (x === 8 && y >= 6 && y <= 8) continue
      writeLayerColor(document, layer, y * layer.width + x, red)
    }
    const styles = createDefaultLayerStyles()
    styles.shadow = { ...styles.shadow, enabled: true, offsetX: 2, offsetY: -1, blur: 4 }
    styles.innerGlow = { ...styles.innerGlow, enabled: true, size: 3 }
    layer.layerStyles = styles

    const cached = compositeRegion(document, 0, 0, document.width, document.height, new DocumentCompositeCache(), 1)
    const direct = compositeRegion(document, 0, 0, document.width, document.height)

    expect(Array.from(cached)).toEqual(Array.from(direct))
  })

  it('keeps the center of a large hollow binary shadow pixel-identical', () => {
    const document = createDocument('large hollow style cache', 520, 520, 'rgba')
    const layer = document.layers[0]
    for (let x = 0; x < layer.width; x += 1) {
      writeLayerColor(document, layer, x, red)
      writeLayerColor(document, layer, (layer.height - 1) * layer.width + x, red)
    }
    for (let y = 1; y < layer.height - 1; y += 1) {
      writeLayerColor(document, layer, y * layer.width, red)
      writeLayerColor(document, layer, y * layer.width + layer.width - 1, red)
    }
    const styles = createDefaultLayerStyles()
    styles.shadow = { ...styles.shadow, enabled: true, offsetX: 0, offsetY: 0, blur: 4 }
    layer.layerStyles = styles

    const cached = compositeRegion(document, 260, 260, 1, 1, new DocumentCompositeCache(), 1)
    const direct = compositeRegion(document, 260, 260, 1, 1)

    expect(Array.from(cached)).toEqual(Array.from(direct))
  })

  it('keeps cached styled-layer compositing pixel-identical while the layer moves', () => {
    const document = createDocument('cached styled layer', 12, 10, 'rgba')
    const background = document.layers[0]
    const styled = createLayer('styled', 6, 5, 'rgba')
    styled.offsetX = 2
    styled.offsetY = 2
    document.layers.push(styled)
    writeLayerColor(document, background, 4 * background.width + 5, { r: 24, g: 32, b: 48, a: 255 })
    writeLayerColor(document, styled, 2 * styled.width + 2, blue)
    const styles = createDefaultLayerStyles()
    styles.shadow.enabled = true
    styles.shadow.offsetX = 1
    styles.shadow.offsetY = 1
    styles.shadow.blur = 2
    styles.innerGlow.enabled = true
    styles.innerGlow.size = 2
    styled.layerStyles = styles
    const cache = new DocumentCompositeCache()

    expect(Array.from(compositeRegion(document, 0, 0, 12, 10, cache, 1))).toEqual(Array.from(compositeRegion(document, 0, 0, 12, 10)))

    styled.offsetX += 2
    styled.offsetY -= 1
    expect(Array.from(compositeRegion(document, 0, 0, 12, 10, cache, 1))).toEqual(Array.from(compositeRegion(document, 0, 0, 12, 10)))
  })

  it('refreshes cached layer styles when raster storage is replaced at the same content revision', () => {
    const document = createDocument('styled storage replacement', 8, 6, 'rgba')
    const layer = document.layers[0]
    writeLayerColor(document, layer, layer.width + 1, red)
    const styles = createDefaultLayerStyles()
    styles.stroke.enabled = true
    styles.stroke.size = 1
    layer.layerStyles = styles
    const cache = new DocumentCompositeCache()
    const before = compositeRegion(document, 0, 0, document.width, document.height, cache, 1)

    const replacement = createLayer('replacement', layer.width, layer.height, 'rgba')
    writeLayerColor(document, replacement, 4 * replacement.width + 6, blue)
    assignRasterStorage(layer, replacement)

    const cached = compositeRegion(document, 0, 0, document.width, document.height, cache, 2)
    const direct = compositeRegion(document, 0, 0, document.width, document.height)
    expect(Array.from(cached)).toEqual(Array.from(direct))
    expect(Array.from(cached)).not.toEqual(Array.from(before))
  })

  it('keeps cached binary shadow geometry exact across blur previews and content changes', () => {
    const document = createDocument('cached shadow previews', 24, 20, 'rgba')
    const layer = document.layers[0]
    for (let x = 5; x < 19; x += 1) {
      writeLayerColor(document, layer, 4 * layer.width + x, red)
      writeLayerColor(document, layer, 15 * layer.width + x, red)
    }
    for (let y = 5; y < 15; y += 1) {
      writeLayerColor(document, layer, y * layer.width + 5, red)
      writeLayerColor(document, layer, y * layer.width + 18, red)
    }
    const styles = createDefaultLayerStyles()
    styles.shadow = { ...styles.shadow, enabled: true, offsetX: 2, offsetY: -1, blur: 2 }
    layer.layerStyles = styles
    const cache = new DocumentCompositeCache()
    let revision = 1

    for (const blur of [2, 3, 5, 1, 8]) {
      styles.shadow.blur = blur
      expect(Array.from(compositeRegion(document, 0, 0, document.width, document.height, cache, revision++))).toEqual(
        Array.from(compositeRegion(document, 0, 0, document.width, document.height))
      )
    }

    writeLayerColor(document, layer, 10 * layer.width + 12, red)
    markLayerContentChanged(layer)
    styles.shadow.blur = 5
    expect(Array.from(compositeRegion(document, 0, 0, document.width, document.height, cache, revision))).toEqual(
      Array.from(compositeRegion(document, 0, 0, document.width, document.height))
    )
  })

  it('creates layers without a display color marker by default', () => {
    expect(createLayer('plain', 1, 1, 'rgba').displayColor).toBeUndefined()
  })

  it('starts new documents with timelapse recording disabled by default', () => {
    expect(createDocument('timelapse default', 1, 1, 'rgba').timelapse?.enabled).toBe(false)
  })

  it('copies a single RGBA layer region without changing transparent pixels', () => {
    const document = createDocument('single layer', 3, 2, 'rgba')
    const layer = document.layers[0]
    writeLayerColor(document, layer, 4, red)

    expect(Array.from(compositeRegion(document, 1, 1, 2, 1))).toEqual([255, 0, 0, 255, 0, 0, 0, 0])
  })

  it('invalidates transparent-tile occupancy when a large layer changes', () => {
    const document = createDocument('large sparse layer', 1025, 1025, 'rgba')
    const layer = document.layers[0]
    const cache = new DocumentCompositeCache()

    expect(Array.from(compositeRegion(document, 1000, 1000, 1, 1, cache, 1))).toEqual([0, 0, 0, 0])
    const index = 1000 * layer.width + 1000
    layer.pixels.set([255, 0, 0, 255], index * 4)
    markLayerContentChanged(layer)

    expect(Array.from(compositeRegion(document, 1000, 1000, 1, 1, cache, 2))).toEqual([255, 0, 0, 255])
  })

  it('ignores transparent special-blend layers without changing exact output', () => {
    const document = createDocument('transparent special blend', 2, 1, 'rgba')
    writeLayerColor(document, document.layers[0], 0, red)
    const special = createLayer('empty color blend', 1, 1, 'rgba')
    special.blendMode = 'color'
    document.layers.push(special)

    expect(normalCompositeLayers(document)).toEqual([document.layers[0]])
    expect(Array.from(compositeRegion(document, 0, 0, 2, 1))).toEqual([255, 0, 0, 255, 0, 0, 0, 0])

    writeLayerColor(document, special, 0, blue)
    expect(normalCompositeLayers(document)).toBeNull()
  })

  it('keeps hidden non-default groups out of fast-path eligibility', () => {
    const document = createDocument('hidden complex group', 2, 1, 'rgba')
    const visible = document.layers[0]
    const hidden = createLayer('hidden member', 2, 1, 'rgba')
    hidden.groupId = 'hidden-group'
    hidden.blendMode = 'multiply'
    document.layers.push(hidden)
    document.groups.push({ id: 'hidden-group', name: 'Hidden', parentGroupId: null, visible: false, locked: false, opacity: 0.3, blendMode: 'multiply' })
    writeLayerColor(document, visible, 0, red)
    writeLayerColor(document, hidden, 0, blue)

    expect(normalCompositeLayers(document)).toEqual([visible])
    expect(Array.from(compositeRegion(document, 0, 0, 2, 1, new DocumentCompositeCache(), 1))).toEqual([
      255, 0, 0, 255,
      0, 0, 0, 0
    ])
  })

  it('keeps visible empty opacity groups out of fast-path eligibility', () => {
    const document = createDocument('visible empty opacity group', 2, 1, 'rgba')
    const visible = document.layers[0]
    document.groups.push({ id: 'empty-group', name: 'Empty', parentGroupId: null, visible: true, locked: false, opacity: 0.3, blendMode: 'normal' })
    const timeline = ensureAnimationDocument(document)
    const mask = createLayerMask('empty-group', document.width, document.height, 'group')
    writeLayerColor(document, mask, 0, { r: 0, g: 0, b: 0, a: 255 })
    timeline.groupMasks = [{ groupId: 'empty-group', frameId: timeline.activeFrameId, mask }]
    writeLayerColor(document, visible, 0, red)
    const cache = new DocumentCompositeCache()

    expect(normalCompositeLayers(document)).toEqual([visible])
    expect(cache.renderLayersFor(document, 1)).toEqual([visible])
  })

  it('ignores neutral legacy group masks but keeps painted masks on the generic path', () => {
    const document = createDocument('neutral legacy group mask', 2, 1, 'rgba')
    const layer = document.layers[0]
    layer.groupId = 'masked-group'
    document.groups.push({ id: 'masked-group', name: 'Masked', parentGroupId: null, visible: true, locked: false, opacity: 0.3, blendMode: 'normal' })
    writeLayerColor(document, layer, 0, red)
    const timeline = ensureAnimationDocument(document)
    const mask = createLayerMask('masked-group', document.width, document.height, 'group')
    timeline.groupMasks = [{ groupId: 'masked-group', frameId: timeline.activeFrameId, mask }]
    const cache = new DocumentCompositeCache()

    expect(cache.opacityGroupStackFor(document, 1)).not.toBeNull()
    writeLayerColor(document, mask, 0, { r: 0, g: 0, b: 0, a: 255 })
    expect(cache.opacityGroupStackFor(document, 2)).toBeNull()
  })

  it('matches the generic sampler for an isolated normal-opacity group', () => {
    const document = createDocument('isolated opacity group', 3, 1, 'rgba')
    const background = document.layers[0]
    const groupBottom = createLayer('group bottom', 3, 1, 'rgba')
    const groupTop = createLayer('group top', 3, 1, 'rgba')
    groupBottom.groupId = 'opacity-group'
    groupTop.groupId = 'opacity-group'
    groupBottom.opacity = 0.65
    groupTop.opacity = 0.8
    document.layers.push(groupBottom, groupTop)
    document.groups.push({ id: 'opacity-group', name: 'Opacity', parentGroupId: null, visible: true, locked: false, opacity: 0.3, blendMode: 'normal' })
    writeLayerColor(document, background, 0, { r: 32, g: 48, b: 64, a: 255 })
    writeLayerColor(document, background, 1, { r: 80, g: 96, b: 112, a: 180 })
    writeLayerColor(document, groupBottom, 0, { r: 220, g: 72, b: 40, a: 210 })
    writeLayerColor(document, groupBottom, 1, { r: 30, g: 180, b: 90, a: 160 })
    writeLayerColor(document, groupTop, 0, { r: 50, g: 90, b: 230, a: 150 })
    writeLayerColor(document, groupTop, 2, { r: 240, g: 210, b: 40, a: 255 })
    const sample = createCompositePointSampler(document)
    const expected = new Uint8ClampedArray(document.width * 4)
    for (let x = 0; x < document.width; x += 1) writeRgbaPixel(expected, x, sample(x, 0))

    expect(Array.from(compositeRegion(document, 0, 0, document.width, 1, new DocumentCompositeCache(), 1))).toEqual(Array.from(expected))
  })

  it('matches the generic sampler for an isolated multiply-opacity group', () => {
    const document = createDocument('isolated multiply group', 3, 1, 'rgba')
    const background = document.layers[0]
    const groupBottom = createLayer('group bottom', 3, 1, 'rgba')
    const groupTop = createLayer('group top', 3, 1, 'rgba')
    groupBottom.groupId = 'multiply-group'
    groupTop.groupId = 'multiply-group'
    groupBottom.opacity = 0.65
    groupTop.opacity = 0.8
    document.layers.push(groupBottom, groupTop)
    document.groups.push({ id: 'multiply-group', name: 'Multiply', parentGroupId: null, visible: true, locked: false, opacity: 0.32, blendMode: 'multiply' })
    writeLayerColor(document, background, 0, { r: 32, g: 48, b: 64, a: 255 })
    writeLayerColor(document, background, 1, { r: 80, g: 96, b: 112, a: 180 })
    writeLayerColor(document, groupBottom, 0, { r: 220, g: 72, b: 40, a: 210 })
    writeLayerColor(document, groupBottom, 1, { r: 30, g: 180, b: 90, a: 160 })
    writeLayerColor(document, groupTop, 0, { r: 50, g: 90, b: 230, a: 150 })
    writeLayerColor(document, groupTop, 2, { r: 240, g: 210, b: 40, a: 255 })
    const sample = createCompositePointSampler(document)
    const expected = new Uint8ClampedArray(document.width * 4)
    for (let x = 0; x < document.width; x += 1) writeRgbaPixel(expected, x, sample(x, 0))
    const cache = new DocumentCompositeCache()

    expect(cache.opacityGroupStackFor(document, 1)).not.toBeNull()
    expect(Array.from(compositeRegion(document, 0, 0, document.width, 1, cache, 1))).toEqual(Array.from(expected))
  })

  it('does not scan a large layer to composite a small dirty region', () => {
    const document = createDocument('large dirty region', 1025, 1025, 'rgba')
    const cache = new DocumentCompositeCache()
    cache.rowsFor = () => { throw new Error('large row scan should be skipped') }

    expect(Array.from(compositeRegion(document, 512, 512, 1, 1, cache, 1))).toEqual([0, 0, 0, 0])
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

  it('uses transparent, black, and gray cell-mask values as alpha coverage', () => {
    const document = createDocument('layer mask alpha', 3, 1, 'rgba')
    const layer = document.layers[0]
    const cel = ensureAnimationDocument(document).cels[0]
    cel.mask = createLayerMask(cel.id, 3, 1)
    writeLayerColor(document, layer, 0, red)
    writeLayerColor(document, layer, 1, red)
    writeLayerColor(document, layer, 2, red)
    writeLayerColor(document, cel.mask, 1, { r: 0, g: 0, b: 0, a: 255 })
    writeLayerColor(document, cel.mask, 2, { r: 128, g: 128, b: 128, a: 255 })

    expect(Array.from(compositeRegion(document, 0, 0, 3, 1))).toEqual([
      255, 0, 0, 255,
      0, 0, 0, 0,
      255, 0, 0, 128
    ])

    const sampleReplacement = createCompositePointReplacementSampler(document, layer.id)
    const replacement = { r: 20, g: 180, b: 90, a: 192 }
    for (let x = 0; x < document.width; x += 1) {
      expect(sampleReplacement(x, 0, replacement)).toEqual(compositePixelWithLayerColor(document, x, layer.id, replacement))
    }
  })

  it('skips a disabled layer mask during compositing', () => {
    const document = createDocument('disabled layer mask', 1, 1, 'rgba')
    const layer = document.layers[0]
    const cel = ensureAnimationDocument(document).cels[0]
    cel.mask = createLayerMask(cel.id, 1, 1)
    cel.mask.visible = false
    writeLayerColor(document, layer, 0, red)
    writeLayerColor(document, cel.mask, 0, { r: 0, g: 0, b: 0, a: 255 })

    expect(Array.from(compositeRegion(document, 0, 0, 1, 1))).toEqual([255, 0, 0, 255])
  })

  it('applies a frame-specific mask to the composited result of a layer group', () => {
    const document = createDocument('group mask alpha', 1, 1, 'rgba')
    const layer = document.layers[0]
    const group = { id: 'group-1', name: 'Group', visible: true, locked: false, opacity: 1, blendMode: 'normal' as const }
    document.groups.push(group)
    layer.groupId = group.id
    writeLayerColor(document, layer, 0, red)
    const timeline = ensureAnimationDocument(document)
    const mask = createLayerMask(group.id, 1, 1, 'group')
    writeLayerColor(document, mask, 0, { r: 0, g: 0, b: 0, a: 255 })
    timeline.groupMasks = [{ groupId: group.id, frameId: timeline.activeFrameId, mask }]

    expect(Array.from(compositeRegion(document, 0, 0, 1, 1))).toEqual([0, 0, 0, 0])
    mask.visible = false
    expect(Array.from(compositeRegion(document, 0, 0, 1, 1))).toEqual([255, 0, 0, 255])
  })

  it('keeps masks independent between animation cells', () => {
    const document = createDocument('cell masks', 1, 1, 'rgba')
    const layer = document.layers[0]
    writeLayerColor(document, layer, 0, red)
    const timeline = ensureAnimationDocument(document)
    const firstCel = timeline.cels[0]
    firstCel.mask = createLayerMask(firstCel.id, 1, 1)
    writeLayerColor(document, firstCel.mask, 0, { r: 0, g: 0, b: 0, a: 255 })
    const secondFrameId = duplicateAnimationFrame(document)
    const secondCel = ensureAnimationDocument(document).cels.find((cel) => cel.frameId === secondFrameId)!
    writeLayerColor(document, secondCel.mask!, 0, { r: 128, g: 128, b: 128, a: 255 })

    expect(Array.from(compositeRegion(document, 0, 0, 1, 1))).toEqual([255, 0, 0, 128])
    activateAnimationFrame(document, timeline.frames[0].id)
    expect(Array.from(compositeRegion(document, 0, 0, 1, 1))).toEqual([0, 0, 0, 0])
  })

  it('keeps empty mask pixels transparent and normalizes painted pixels to opaque grayscale', () => {
    const document = createDocument('mask grayscale', 1, 1, 'rgba')
    const cel = ensureAnimationDocument(document).cels[0]
    const mask = createLayerMask(cel.id, 1, 1)
    cel.mask = mask

    expect(readLayerColor(document, mask, 0)).toEqual({ r: 0, g: 0, b: 0, a: 0 })

    writeLayerColor(document, mask, 0, { r: 255, g: 0, b: 0, a: 255 })

    expect(readLayerColor(document, mask, 0)).toEqual({ r: 54, g: 54, b: 54, a: 255 })
    writeLayerColor(document, mask, 0, { r: 0, g: 0, b: 0, a: 0 })
    expect(readLayerColor(document, mask, 0)).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })

  it('renders an isolated layer mask as white-backed grayscale', () => {
    const document = createDocument('mask editing surface', 3, 1, 'rgba')
    const cel = ensureAnimationDocument(document).cels[0]
    const mask = createLayerMask(cel.id, 3, 1)
    cel.mask = mask
    writeLayerColor(document, mask, 1, { r: 255, g: 0, b: 0, a: 255 })
    writeLayerColor(document, mask, 2, { r: 0, g: 0, b: 0, a: 128 })

    expect(readLayerMaskDisplayColorAt(mask, 0, 0)).toEqual({ r: 255, g: 255, b: 255, a: 255 })
    expect(Array.from(renderLayerMaskRegion(mask, 0, 0, 3, 1))).toEqual([
      255, 255, 255, 255,
      54, 54, 54, 255,
      127, 127, 127, 255
    ])
  })

  it('clips a layer to the shape and opacity of its immediate lower sibling', () => {
    const document = createDocument('clipped layer', 2, 1, 'rgba')
    const bottom = document.layers[0]
    const top = createLayer('top', 2, 1, 'rgba')
    bottom.opacity = 0.5
    top.clippingMask = true
    document.layers.push(top)
    writeLayerColor(document, bottom, 0, { r: 145, g: 128, b: 77, a: 255 })
    writeLayerColor(document, top, 0, red)
    writeLayerColor(document, top, 1, red)

    expect(Array.from(compositeRegion(document, 0, 0, 2, 1))).toEqual([255, 0, 0, 128, 0, 0, 0, 0])
  })

  it('applies the base opacity once across consecutive clipped siblings', () => {
    const document = createDocument('clipping stack', 1, 1, 'rgba')
    const bottom = document.layers[0]
    const middle = createLayer('middle', 1, 1, 'rgba')
    const top = createLayer('top', 1, 1, 'rgba')
    bottom.opacity = 0.5
    middle.clippingMask = true
    top.clippingMask = true
    document.layers.push(middle, top)
    writeLayerColor(document, bottom, 0, { r: 145, g: 128, b: 77, a: 255 })
    writeLayerColor(document, middle, 0, { r: 0, g: 0, b: 255, a: 255 })
    writeLayerColor(document, top, 0, red)

    expect(Array.from(compositeRegion(document, 0, 0, 1, 1))).toEqual([255, 0, 0, 128])
  })

  it('clips an isolated layer group to its immediate lower sibling', () => {
    const document = createDocument('clipped group', 2, 1, 'rgba')
    const bottom = document.layers[0]
    const grouped = createLayer('grouped', 2, 1, 'rgba')
    grouped.groupId = 'group'
    document.layers.push(grouped)
    document.groups.push({ id: 'group', name: 'group', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal', clippingMask: true })
    writeLayerColor(document, bottom, 0, red)
    writeLayerColor(document, grouped, 0, { ...blue, a: 255 })
    writeLayerColor(document, grouped, 1, { ...blue, a: 255 })

    expect(Array.from(compositeRegion(document, 0, 0, 2, 1))).toEqual([0, 0, 255, 255, 0, 0, 0, 0])
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

  it('applies child-layer and group blend modes at their own compositing levels', () => {
    const document = createDocument('nested blend modes', 1, 1, 'rgba')
    const outsideBottom = document.layers[0]
    const groupBottom = createLayer('group bottom', 1, 1, 'rgba')
    const groupTop = createLayer('group top', 1, 1, 'rgba')
    groupBottom.groupId = 'group'
    groupTop.groupId = 'group'
    groupTop.blendMode = 'screen'
    document.layers.push(groupBottom, groupTop)
    document.groups.push({ id: 'group', name: 'group', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'multiply' })
    const outsideColor = { r: 76, g: 132, b: 218, a: 255 }
    const groupBottomColor = { r: 214, g: 92, b: 48, a: 255 }
    const groupTopColor = { r: 42, g: 188, b: 124, a: 255 }
    writeLayerColor(document, outsideBottom, 0, outsideColor)
    writeLayerColor(document, groupBottom, 0, groupBottomColor)
    writeLayerColor(document, groupTop, 0, groupTopColor)

    const groupColor = blendWithMode(groupBottomColor, groupTopColor, 1, 'screen')
    const expected = blendWithMode(outsideColor, groupColor, 1, 'multiply')
    expect(Array.from(compositeRegion(document, 0, 0, 1, 1))).toEqual(Object.values(expected))
  })

  it('keeps the group blend mode active when a child layer returns to normal', () => {
    const document = createDocument('normal child in blended group', 1, 1, 'rgba')
    const outsideBottom = document.layers[0]
    const groupBottom = createLayer('group bottom', 1, 1, 'rgba')
    const groupTop = createLayer('group top', 1, 1, 'rgba')
    groupBottom.groupId = 'group'
    groupTop.groupId = 'group'
    groupTop.blendMode = 'screen'
    document.layers.push(groupBottom, groupTop)
    document.groups.push({ id: 'group', name: 'group', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'multiply' })
    const outsideColor = { r: 76, g: 132, b: 218, a: 255 }
    const groupBottomColor = { r: 214, g: 92, b: 48, a: 255 }
    const groupTopColor = { r: 42, g: 188, b: 124, a: 255 }
    writeLayerColor(document, outsideBottom, 0, outsideColor)
    writeLayerColor(document, groupBottom, 0, groupBottomColor)
    writeLayerColor(document, groupTop, 0, groupTopColor)

    groupTop.blendMode = 'normal'

    const groupColor = blendWithMode(groupBottomColor, groupTopColor, 1, 'normal')
    const expected = blendWithMode(outsideColor, groupColor, 1, 'multiply')
    expect(Array.from(compositeRegion(document, 0, 0, 1, 1))).toEqual(Object.values(expected))
    expect(expected).not.toEqual(groupColor)
  })

  it('keeps multiply layers visually unchanged when they are placed in a normal full-opacity group', () => {
    const document = createDocument('pass-through normal group', 1, 1, 'rgba')
    const background = document.layers[0]
    const first = createLayer('first multiply', 1, 1, 'rgba')
    const second = createLayer('second multiply', 1, 1, 'rgba')
    const third = createLayer('third multiply', 1, 1, 'rgba')
    first.blendMode = 'multiply'
    second.blendMode = 'multiply'
    third.blendMode = 'multiply'
    document.layers.push(first, second, third)
    writeLayerColor(document, background, 0, { r: 206, g: 238, b: 224, a: 255 })
    writeLayerColor(document, first, 0, { r: 176, g: 92, b: 232, a: 255 })
    writeLayerColor(document, second, 0, { r: 72, g: 168, b: 244, a: 255 })
    writeLayerColor(document, third, 0, { r: 232, g: 72, b: 156, a: 255 })
    const beforeGrouping = compositeRegion(document, 0, 0, 1, 1)

    first.groupId = 'group'
    second.groupId = 'group'
    third.groupId = 'group'
    document.groups.push({ id: 'group', name: 'group', parentGroupId: null, panelOrder: 3, visible: true, locked: false, opacity: 1, blendMode: 'normal' })

    expect(Array.from(compositeRegion(document, 0, 0, 1, 1))).toEqual(Array.from(beforeGrouping))
  })

  it('applies a blended group to the fully composited Photoshop-style backdrop', () => {
    const document = createDocument('Photoshop blend chain', 1, 1, 'rgba')
    const background = document.layers[0]
    const screenLayer = createLayer('screen', 1, 1, 'rgba')
    const groupMember = createLayer('group member', 1, 1, 'rgba')
    screenLayer.blendMode = 'screen'
    groupMember.groupId = 'multiply-group'
    document.layers.push(screenLayer, groupMember)
    document.groups.push({ id: 'multiply-group', name: 'multiply group', parentGroupId: null, panelOrder: 2, visible: true, locked: false, opacity: 1, blendMode: 'multiply' })
    writeLayerColor(document, background, 0, { r: 0x91, g: 0x80, b: 0x4d, a: 255 })
    writeLayerColor(document, screenLayer, 0, { r: 0x91, g: 0x15, b: 0x22, a: 255 })
    writeLayerColor(document, groupMember, 0, { r: 0x91, g: 0x15, b: 0x22, a: 255 })

    expect(createCompositePointSampler(document)(0, 0)).toEqual({ r: 0x76, g: 0x0b, b: 0x0d, a: 255 })
  })

  it('optionally reapplies a group blend mode to its pass-through result', () => {
    const document = createDocument('cumulative group blend', 1, 1, 'rgba')
    const background = document.layers[0]
    const member = createLayer('multiply member', 1, 1, 'rgba')
    member.groupId = 'group'
    member.blendMode = 'multiply'
    document.layers.push(member)
    document.groups.push({ id: 'group', name: 'group', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'multiply' })
    writeLayerColor(document, background, 0, { r: 0x91, g: 0x80, b: 0x4d, a: 255 })
    writeLayerColor(document, member, 0, { r: 0x91, g: 0x15, b: 0x22, a: 255 })

    expect(createCompositePointSampler(document)(0, 0)).toEqual({ r: 0x52, g: 0x0b, b: 0x0a, a: 255 })

    document.groups[0].cumulativeBlend = true

    expect(createCompositePointSampler(document)(0, 0)).toEqual({ r: 0x2f, g: 0x06, b: 0x03, a: 255 })

    writeLayerColor(document, member, 0, { r: 0, g: 0, b: 0, a: 0 })
    expect(createCompositePointSampler(document)(0, 0)).toEqual({ r: 0x91, g: 0x80, b: 0x4d, a: 255 })
  })

  it('applies group opacity to the second cumulative blend only', () => {
    const document = createDocument('transparent cumulative group blend', 1, 1, 'rgba')
    const background = document.layers[0]
    const member = createLayer('multiply member', 1, 1, 'rgba')
    const backgroundColor = { r: 145, g: 128, b: 77, a: 255 }
    const memberColor = { r: 145, g: 21, b: 34, a: 255 }
    member.groupId = 'group'
    member.blendMode = 'multiply'
    document.layers.push(member)
    document.groups.push({ id: 'group', name: 'group', parentGroupId: null, visible: true, locked: false, opacity: 0.5, blendMode: 'multiply', cumulativeBlend: true })
    writeLayerColor(document, background, 0, backgroundColor)
    writeLayerColor(document, member, 0, memberColor)

    const passThroughResult = blendWithMode(backgroundColor, memberColor, 1, 'multiply')
    const expected = blendWithMode(backgroundColor, passThroughResult, 0.5, 'multiply')
    expect(createCompositePointSampler(document)(0, 0)).toEqual(expected)
  })

  it('applies nested group blend modes from the innermost group outward', () => {
    const document = createDocument('nested blended groups', 1, 1, 'rgba')
    const outsideBottom = document.layers[0]
    const parentBottom = createLayer('parent bottom', 1, 1, 'rgba')
    const childBottom = createLayer('child bottom', 1, 1, 'rgba')
    const childTop = createLayer('child top', 1, 1, 'rgba')
    parentBottom.groupId = 'parent'
    childBottom.groupId = 'child'
    childTop.groupId = 'child'
    childTop.blendMode = 'screen'
    document.layers.push(parentBottom, childBottom, childTop)
    document.groups.push(
      { id: 'parent', name: 'parent', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'multiply' },
      { id: 'child', name: 'child', parentGroupId: 'parent', visible: true, locked: false, opacity: 1, blendMode: 'overlay' }
    )
    const outsideColor = { r: 76, g: 132, b: 218, a: 255 }
    const parentBottomColor = { r: 214, g: 92, b: 48, a: 255 }
    const childBottomColor = { r: 42, g: 188, b: 124, a: 255 }
    const childTopColor = { r: 184, g: 66, b: 206, a: 255 }
    writeLayerColor(document, outsideBottom, 0, outsideColor)
    writeLayerColor(document, parentBottom, 0, parentBottomColor)
    writeLayerColor(document, childBottom, 0, childBottomColor)
    writeLayerColor(document, childTop, 0, childTopColor)

    const childColor = blendWithMode(childBottomColor, childTopColor, 1, 'screen')
    const childInParent = blendWithMode(parentBottomColor, childColor, 1, 'overlay')
    const expected = blendWithMode(outsideColor, childInParent, 1, 'multiply')
    expect(Array.from(compositeRegion(document, 0, 0, 1, 1))).toEqual(Object.values(expected))

    const sampleReplacement = createCompositePointReplacementSampler(document, childTop.id)
    for (const replacement of [
      { r: 0, g: 0, b: 0, a: 0 },
      { r: 33, g: 177, b: 91, a: 128 },
      { r: 241, g: 132, b: 18, a: 255 }
    ]) {
      const replacementChildColor = blendWithMode(childBottomColor, replacement, 1, 'screen')
      const replacementInParent = blendWithMode(parentBottomColor, replacementChildColor, 1, 'overlay')
      const replacementExpected = blendWithMode(outsideColor, replacementInParent, 1, 'multiply')
      expect(sampleReplacement(0, 0, replacement)).toEqual(replacementExpected)
      expect(compositePixelWithLayerColor(document, 0, childTop.id, replacement)).toEqual(replacementExpected)
    }
  })

  it('keeps a moved group at its panelOrder position across normal and blended compositing paths', () => {
    const document = createDocument('moved blended group', 1, 1, 'rgba')
    const bottom = document.layers[0]
    const member = createLayer('group member', 1, 1, 'rgba')
    const cover = createLayer('root cover', 1, 1, 'rgba')
    member.groupId = 'group'
    document.layers.push(member, cover)
    document.groups.push({ id: 'group', name: 'group', parentGroupId: null, panelOrder: 3, visible: true, locked: false, opacity: 1, blendMode: 'normal' })
    const bottomColor = { r: 248, g: 244, b: 236, a: 255 }
    const memberColor = { r: 220, g: 96, b: 48, a: 255 }
    const coverColor = { r: 64, g: 112, b: 208, a: 255 }
    writeLayerColor(document, bottom, 0, bottomColor)
    writeLayerColor(document, member, 0, memberColor)
    writeLayerColor(document, cover, 0, coverColor)

    expect(Array.from(compositeRegion(document, 0, 0, 1, 1))).toEqual(Object.values(memberColor))

    document.groups[0].blendMode = 'multiply'
    const expected = blendWithMode(coverColor, memberColor, 1, 'multiply')
    expect(Array.from(compositeRegion(document, 0, 0, 1, 1))).toEqual(Object.values(expected))
  })

  it('anchors legacy groups at their highest descendant instead of splitting them around root layers', () => {
    const document = createDocument('legacy group order', 1, 1, 'rgba')
    const bottom = document.layers[0]
    const groupBottom = createLayer('group bottom', 1, 1, 'rgba')
    const rootMiddle = createLayer('root middle', 1, 1, 'rgba')
    const groupTop = createLayer('group top', 1, 1, 'rgba')
    groupBottom.groupId = 'group'
    groupTop.groupId = 'group'
    document.layers.push(groupBottom, rootMiddle, groupTop)
    document.groups.push({ id: 'group', name: 'group', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'multiply' })
    const bottomColor = { r: 248, g: 244, b: 236, a: 255 }
    const groupBottomColor = { r: 220, g: 96, b: 48, a: 255 }
    const rootMiddleColor = { r: 64, g: 112, b: 208, a: 255 }
    const groupTopColor = { r: 112, g: 208, b: 92, a: 255 }
    writeLayerColor(document, bottom, 0, bottomColor)
    writeLayerColor(document, groupBottom, 0, groupBottomColor)
    writeLayerColor(document, rootMiddle, 0, rootMiddleColor)
    writeLayerColor(document, groupTop, 0, groupTopColor)

    const groupColor = blendWithMode(groupBottomColor, groupTopColor, 1, 'normal')
    const expected = blendWithMode(rootMiddleColor, groupColor, 1, 'multiply')
    expect(Array.from(compositeRegion(document, 0, 0, 1, 1))).toEqual(Object.values(expected))
  })

  it('matches the generic sampler for normal grouped layers', () => {
    const document = createDocument('normal fast path', 7, 5, 'rgba')
    document.palette.push(
      { id: 10, name: 'indexed red', color: { r: 210, g: 30, b: 20, a: 190 } },
      { id: 11, name: 'indexed blue', color: { r: 20, g: 80, b: 220, a: 130 } }
    )
    document.groups.push(
      { id: 'root', name: 'root', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' },
      { id: 'child', name: 'child', parentGroupId: 'root', visible: true, locked: false, opacity: 1, blendMode: 'normal' },
      { id: 'hidden', name: 'hidden', parentGroupId: null, visible: false, locked: false, opacity: 1, blendMode: 'normal' }
    )
    const rgba = createLayer('rgba', 5, 4, 'rgba')
    rgba.groupId = 'child'
    rgba.offsetX = -1
    rgba.offsetY = 1
    rgba.opacity = 0.65
    if (rgba.format !== 'rgba') throw new Error('RGBA layer required')
    for (let index = 0; index < rgba.width * rgba.height; index += 1) {
      const offset = index * 4
      rgba.pixels[offset] = index * 17 % 256
      rgba.pixels[offset + 1] = index * 43 % 256
      rgba.pixels[offset + 2] = index * 71 % 256
      rgba.pixels[offset + 3] = index % 3 === 0 ? 0 : 80 + index * 9 % 176
    }
    const indexed = createLayer('indexed', 4, 3, 'indexed')
    indexed.groupId = 'root'
    indexed.offsetX = 3
    indexed.offsetY = -1
    indexed.opacity = 0.8
    if (indexed.format !== 'indexed') throw new Error('Indexed layer required')
    indexed.pixels.set(indexed.pixels.map((_, index) => index % 3 === 0 ? 0 : index % 2 === 0 ? 10 : 11))
    const hidden = createLayer('hidden', 7, 5, 'rgba')
    hidden.groupId = 'hidden'
    if (hidden.format !== 'rgba') throw new Error('RGBA layer required')
    hidden.pixels.fill(255)
    document.layers.push(rgba, indexed, hidden)

    const sample = createCompositePointSampler(document)
    const expected: number[] = []
    for (let y = -1; y < 6; y += 1) for (let x = -2; x < 8; x += 1) expected.push(...Object.values(sample(x, y)))

    expect(Array.from(compositeRegion(document, -2, -1, 10, 7))).toEqual(expected)

    const sampleReplacement = createCompositePointReplacementSampler(document, rgba.id)
    const replacement = { r: 190, g: 70, b: 35, a: 144 }
    for (let y = 0; y < document.height; y += 1) for (let x = 0; x < document.width; x += 1) {
      const index = y * document.width + x
      expect(sampleReplacement(x, y, replacement)).toEqual(compositePixelWithLayerColor(document, index, rgba.id, replacement))
    }
  })

  it('invalidates cached sparse row ranges only for changed layer content', () => {
    const document = createDocument('cached rows', 3, 1, 'rgba')
    const top = createLayer('top', 3, 1, 'rgba')
    document.layers.push(top)
    const cache = new DocumentCompositeCache()
    writeLayerColor(document, top, 0, red)
    expect(Array.from(compositeRegion(document, 0, 0, 3, 1, cache, 1))).toEqual([
      255, 0, 0, 255,
      0, 0, 0, 0,
      0, 0, 0, 0
    ])

    writeLayerColor(document, top, 0, { r: 0, g: 0, b: 0, a: 0 })
    writeLayerColor(document, top, 2, blue)
    expect(Array.from(compositeRegion(document, 0, 0, 3, 1, cache, 2))).toEqual([
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 255, 128
    ])
  })

  it('rescans only dirty rows while retaining the cached row-range storage', () => {
    const document = createDocument('incremental cached rows', 4, 3, 'rgba')
    const layer = document.layers[0]
    const cache = new DocumentCompositeCache()
    writeLayerColor(document, layer, 0, red)
    writeLayerColor(document, layer, 2 * layer.width + 3, blue)

    const initial = cache.rowsFor(layer, document.palette, 1)
    expect(Array.from(initial)).toEqual([0, 1, 4, 0, 3, 4])

    writeLayerColor(document, layer, layer.width + 2, red)
    const updated = cache.rowsFor(layer, document.palette, 2, { x: 2, y: 1, width: 1, height: 1 })

    expect(updated).toBe(initial)
    expect(Array.from(updated)).toEqual([0, 1, 2, 3, 3, 4])
  })

  it('rescans every disjoint dirty row produced by one live content revision', () => {
    const document = createDocument('disjoint live rows', 4, 4, 'rgba')
    const layer = document.layers[0]
    const cache = new DocumentCompositeCache()
    const rows = cache.rowsFor(layer, document.palette, 1)

    writeLayerColor(document, layer, layer.width + 1, red)
    writeLayerColor(document, layer, 3 * layer.width + 2, blue)
    cache.rowsFor(layer, document.palette, 1, { x: 1, y: 1, width: 1, height: 1 })
    const updated = cache.rowsFor(layer, document.palette, 1, { x: 2, y: 3, width: 1, height: 1 })

    expect(updated).toBe(rows)
    expect(Array.from(updated)).toEqual([4, 0, 1, 2, 4, 0, 2, 3])
  })

  it('substitutes an active-layer color in a compiled sampler', () => {
    const document = createDocument('replacement', 1, 1, 'rgba')
    const layer = document.layers[0]
    writeLayerColor(document, layer, 0, red)
    const replacement = { r: 10, g: 220, b: 30, a: 255 }

    expect(createCompositeSampler(document, layer.id, replacement)(0)).toEqual(replacement)
  })

  it('matches the per-pixel API while changing replacement colors on a normal layer', () => {
    const document = createDocument('dynamic replacement', 3, 1, 'rgba')
    const layer = document.layers[0]
    layer.opacity = 0.6
    layer.offsetX = 1
    const sampleReplacement = createCompositePointReplacementSampler(document, layer.id)
    const replacements = [
      { r: 15, g: 25, b: 35, a: 255 },
      { r: 80, g: 120, b: 160, a: 128 },
      { r: 240, g: 210, b: 180, a: 0 }
    ]

    replacements.forEach((replacement, x) => {
      expect(sampleReplacement(x, 0, replacement)).toEqual(compositePixelWithLayerColor(document, x, layer.id, replacement))
    })
  })

  it('matches the generic replacement sampler with spatially bucketed normal layers', () => {
    const document = createDocument('normal replacement preview', 1025, 3, 'rgba')
    const background = document.layers[0]
    const active = createLayer('active', 1025, 3, 'rgba')
    const local = createLayer('local', 8, 3, 'rgba')
    background.opacity = 0.8
    active.opacity = 0.65
    local.offsetX = 510
    writeLayerColor(document, background, 0, { r: 30, g: 40, b: 50, a: 255 })
    writeLayerColor(document, background, 512, { r: 80, g: 90, b: 100, a: 180 })
    writeLayerColor(document, local, 1, { r: 220, g: 40, b: 80, a: 160 })
    document.layers = [background, active, local]
    document.activeLayerId = active.id
    const generic = createCompositePointReplacementSampler(document, active.id)
    const bucketed = createNormalCompositePointReplacementSampler(document, active.id)
    expect(bucketed).not.toBeNull()

    for (const replacement of [red, blue, { r: 15, g: 210, b: 90, a: 0 }]) {
      for (const [x, y] of [[0, 0], [511, 0], [512, 0], [517, 0], [1024, 2]]) {
        expect(bucketed!(x, y, replacement)).toEqual(generic(x, y, replacement))
      }
    }

    local.blendMode = 'multiply'
    expect(createNormalCompositePointReplacementSampler(document, active.id)).toBeNull()
  })

  it('matches the generic sampler with spatially bucketed normal layers', () => {
    const document = createDocument('normal point sampling', 1025, 3, 'rgba')
    const background = document.layers[0]
    const local = createLayer('local', 8, 3, 'rgba')
    background.opacity = 0.8
    local.offsetX = 510
    writeLayerColor(document, background, 0, { r: 30, g: 40, b: 50, a: 255 })
    writeLayerColor(document, background, 512, { r: 80, g: 90, b: 100, a: 180 })
    writeLayerColor(document, local, 1, { r: 220, g: 40, b: 80, a: 160 })
    document.layers = [background, local]
    const generic = createCompositePointSampler(document)
    const bucketed = createNormalCompositePointSampler(document)
    expect(bucketed).not.toBeNull()

    for (const [x, y] of [[0, 0], [511, 0], [512, 0], [517, 0], [1024, 2]]) expect(bucketed!(x, y)).toEqual(generic(x, y))

    local.blendMode = 'multiply'
    expect(createNormalCompositePointSampler(document)).toBeNull()
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

  it('reuses local content bounds while only the layer offset changes', () => {
    const document = createDocument('cached content bounds', 6, 5, 'rgba')
    const layer = document.layers[0]
    writeLayerColor(document, layer, 2 + layer.width * 3, red)

    expect(layerContentBounds(document, layer)).toEqual({ x: 2, y: 3, width: 1, height: 1 })
    layer.offsetX = 100
    layer.offsetY = -50
    expect(layerContentBounds(document, layer)).toEqual({ x: 102, y: -47, width: 1, height: 1 })

    writeLayerColor(document, layer, 4 + layer.width, blue)
    expect(layerContentBounds(document, layer)).toEqual({ x: 102, y: -49, width: 3, height: 3 })
  })

  it('reuses the normal composite plan until the content revision changes', () => {
    const document = createDocument('cached composite plan', 2, 1, 'rgba')
    const special = createLayer('special', 2, 1, 'rgba')
    special.blendMode = 'multiply'
    document.layers.push(special)
    const cache = new DocumentCompositeCache()

    expect(cache.normalLayersFor(document, 1)).toHaveLength(1)
    writeLayerColor(document, special, 0, red)
    expect(cache.normalLayersFor(document, 1)).toHaveLength(1)
    expect(cache.normalLayersFor(document, 2)).toBeNull()
  })

  it('returns no content bounds for a transparent layer', () => {
    const document = createDocument('empty bounds', 3, 2, 'indexed')
    expect(layerContentBounds(document, document.layers[0])).toBeNull()
  })

  it('reads sparse runtime content bounds without materializing the full layer', () => {
    const document = createDocument('runtime bounds', 4096, 2048, 'rgba')
    const layer = document.layers[0]
    layer.offsetX = 10
    layer.offsetY = -4
    installRuntimeRaster(layer, {
      kind: 'sparse-tiles-v1', format: 'rgba', width: layer.width, height: layer.height, tileSize: 2,
      data: new Uint8Array([0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0]),
      tileOffsets: new Int32Array(Math.ceil(layer.width / 2) * Math.ceil(layer.height / 2)).fill(0)
    })
    layer.runtimeRaster!.tileOffsets[1] = 1

    expect(layerContentBounds(document, layer)).toEqual({ x: 13, y: -4, width: 1, height: 1 })
    expect(surfacePixelsMaterialized(layer)).toBe(false)
  })

  it('composites a sparse RGBA layer by copying its stored tiles', () => {
    const document = createDocument('runtime composite', 4, 4, 'rgba')
    const layer = document.layers[0]
    const runtime = {
      kind: 'sparse-tiles-v1' as const,
      format: 'rgba' as const,
      width: 4,
      height: 4,
      tileSize: 2,
      data: new Uint8Array([
        255, 0, 0, 255, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 255, 128
      ]),
      tileOffsets: new Int32Array([1, 0, 0, 0])
    }
    installRuntimeRaster(layer, runtime)

    expect(Array.from(compositeRegion(document, 0, 0, 4, 4))).toEqual([
      255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 255, 128, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    ])
    expect(surfacePixelsMaterialized(layer)).toBe(false)
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

  it('keeps a fully cropped layer mask neutral instead of hiding the owner', () => {
    const document = createDocument('cropped mask', 2, 2, 'rgba')
    const layer = document.layers[0]
    const cel = ensureAnimationDocument(document).cels[0]
    cel.mask = createLayerMask(cel.id, 1, 1)
    cel.mask.offsetX = 8
    cel.mask.offsetY = 8
    writeLayerColor(document, cel.mask, 0, { r: 0, g: 0, b: 0, a: 255 })
    writeLayerColor(document, layer, 0, red)

    resizeDocumentAt(document, 1, 1, 0, 0, true)

    expect(Array.from(cel.mask.pixels)).toEqual([0, 0, 0, 0])
    expect(Array.from(compositeRegion(document, 0, 0, 1, 1))).toEqual([255, 0, 0, 255])
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

  it('keeps smoothly resized cell masks transparent or opaque grayscale', () => {
    const document = createDocument('mask image resize', 2, 1, 'rgba')
    const cel = ensureAnimationDocument(document).cels[0]
    cel.mask = createLayerMask(cel.id, 2, 1)
    writeLayerColor(document, cel.mask, 0, { r: 0, g: 0, b: 0, a: 255 })

    resizeDocumentImage(document, 5, 1, 'smooth')

    for (let offset = 0; offset < cel.mask.pixels.length; offset += 4) {
      expect(cel.mask.pixels[offset + 1]).toBe(cel.mask.pixels[offset])
      expect(cel.mask.pixels[offset + 2]).toBe(cel.mask.pixels[offset])
      expect([0, 255]).toContain(cel.mask.pixels[offset + 3])
    }
  })

  it('resizes inactive animation cels and preserves linked surface sharing', () => {
    const document = createDocument('animated image resize', 2, 1, 'rgba')
    const layer = document.layers[0]
    writeLayerColor(document, layer, 0, red)
    writeLayerColor(document, layer, 1, red)
    const timeline = ensureAnimationDocument(document)
    const firstFrameId = timeline.activeFrameId
    const secondFrameId = duplicateAnimationFrame(document)
    writeLayerColor(document, layer, 0, blue)
    writeLayerColor(document, layer, 1, blue)
    activateAnimationFrame(document, firstFrameId)
    const firstCel = timeline.cels.find((cel) => cel.layerId === layer.id && cel.frameId === firstFrameId)!
    const secondCel = timeline.cels.find((cel) => cel.layerId === layer.id && cel.frameId === secondFrameId)!

    resizeDocumentImage(document, 1, 1, 'nearest')

    expect(firstCel.surface).toMatchObject({ width: 1, height: 1 })
    expect(secondCel.surface).toMatchObject({ width: 1, height: 1 })
    expect(Array.from(firstCel.surface!.pixels)).toEqual([255, 0, 0, 255])
    expect(Array.from(secondCel.surface!.pixels)).toEqual([blue.r, blue.g, blue.b, blue.a])

    secondCel.linkedCelId = firstCel.id
    secondCel.surface = firstCel.surface
    resizeDocumentImage(document, 2, 2, 'nearest')
    expect(secondCel.surface!.pixels).toBe(firstCel.surface!.pixels)
  })

  it('restores image resize snapshots by reusing the old and new pixel buffers', () => {
    const document = createDocument('image resize snapshots', 2, 1, 'indexed')
    const layer = document.layers[0]
    layer.pixels.set([1, 2])
    const cel = ensureAnimationDocument(document).cels[0]
    const beforePixels = layer.pixels
    const before = captureDocumentImageResizeSnapshot(document)

    resizeDocumentImage(document, 4, 2, 'nearest')
    const afterPixels = layer.pixels
    const after = captureDocumentImageResizeSnapshot(document)
    expect(afterPixels).not.toBe(beforePixels)

    restoreDocumentImageResizeSnapshot(document, before)
    expect(document).toMatchObject({ width: 2, height: 1 })
    expect(layer.pixels).toBe(beforePixels)
    expect(cel.surface!.pixels).toBe(beforePixels)

    restoreDocumentImageResizeSnapshot(document, after)
    expect(document).toMatchObject({ width: 4, height: 2 })
    expect(layer.pixels).toBe(afterPixels)
    expect(cel.surface!.pixels).toBe(afterPixels)
  })

  it('shrinks a lazy raster without materializing its full source bitmap', () => {
    const document = createDocument('lazy image resize', 8, 8, 'rgba')
    const layer = document.layers[0]
    const runtime = {
      kind: 'sparse-tiles-v1' as const,
      format: 'rgba' as const,
      width: 8,
      height: 8,
      tileSize: 2,
      data: new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      tileOffsets: new Int32Array(16)
    }
    runtime.tileOffsets[5] = 1
    installRuntimeRaster(layer, runtime)
    const celSurface = ensureAnimationDocument(document).cels[0].surface!
    installRuntimeRaster(celSurface, runtime)
    const probe = { format: 'rgba' as const, width: 8, height: 8, offsetX: 0, offsetY: 0, pixels: new Uint8ClampedArray(4) }
    installRuntimeRaster(probe, runtime)

    resizeDocumentImage(document, 2, 2, 'nearest')

    expect(surfacePixelsMaterialized(probe)).toBe(false)
    expect(Array.from(layer.pixels.slice(0, 4))).toEqual([255, 0, 0, 255])
  })

  it('ignores hidden historical palette entries when resolving indexed canvas colors', () => {
    const document = createDocument('visible indexed palette', 1, 1, 'indexed')
    document.palette.push({ id: 9, name: 'hidden green', color: { r: 0, g: 255, b: 0, a: 255 } })

    const id = paletteColorIdForCanvas(document, { r: 0, g: 255, b: 0, a: 255 })

    expect(id).not.toBe(9)
    expect(document.paletteOrder).toContain(id)
  })

  it('resolves preview colors to the value visible in each document color mode', () => {
    const rgbaDocument = createDocument('rgba preview', 1, 1, 'rgba')
    const rgbaColor = { r: 240, g: 80, b: 20, a: 160 }
    expect(resolveLayerCanvasColor(rgbaDocument, rgbaDocument.layers[0], rgbaColor)).toEqual(rgbaColor)

    const grayscaleDocument = createDocument('grayscale preview', 1, 1, 'grayscale')
    const grayscaleColor = resolveLayerCanvasColor(grayscaleDocument, grayscaleDocument.layers[0], rgbaColor)
    expect(grayscaleColor.r).toBe(grayscaleColor.g)
    expect(grayscaleColor.g).toBe(grayscaleColor.b)
    expect(grayscaleColor.a).toBe(rgbaColor.a)

    const indexedDocument = createDocument('indexed preview', 1, 1, 'indexed')
    indexedDocument.palette.push({ id: 9, name: 'hidden exact', color: rgbaColor })
    const indexedColor = resolveLayerCanvasColor(indexedDocument, indexedDocument.layers[0], rgbaColor)
    expect(indexedColor).toEqual(getPaletteEntry(indexedDocument, paletteColorIdForCanvas(indexedDocument, rgbaColor)).color)
    expect(indexedColor).not.toEqual(rgbaColor)
  })

  it('normalizes direct grayscale writes across single pixels and runs', () => {
    const document = createDocument('grayscale writes', 2, 1, 'grayscale')
    const layer = document.layers[0]
    writeLayerColor(document, layer, 0, { r: 255, g: 0, b: 0, a: 120 })
    writeLayerPackedRun(document, layer, 1, 1, packColor({ r: 0, g: 255, b: 0, a: 200 }))

    for (let index = 0; index < 2; index += 1) {
      const color = readLayerColor(document, layer, index)
      expect(color.r).toBe(color.g)
      expect(color.g).toBe(color.b)
    }
    expect(readLayerColor(document, layer, 0).a).toBe(120)
    expect(readLayerColor(document, layer, 1).a).toBe(200)
  })
})
