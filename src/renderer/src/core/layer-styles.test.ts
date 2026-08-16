import { describe, expect, it } from 'vitest'
import { compositeRegion, createDocument, createLayer, createLayerMask, getActiveLayer, normalCompositeLayers, writeLayerColor } from './document'
import { ensureAnimationDocument } from './animation'
import { createDefaultLayerStyles, normalizeLayerStyles } from './layer-styles'

const red = { r: 255, g: 0, b: 0, a: 255 }
const blue = { r: 0, g: 0, b: 255, a: 255 }
const pixelAt = (pixels: Uint8ClampedArray, width: number, x: number, y: number) => {
  const offset = (y * width + x) * 4
  return Array.from(pixels.subarray(offset, offset + 4))
}

describe('non-destructive layer styles', () => {
  it('normalizes persisted parameters into bounded complete settings', () => {
    expect(normalizeLayerStyles({
      stroke: { enabled: true, color: { r: -10, g: 20, b: 999, a: 300 }, size: 99, position: 'invalid' },
      shadow: { enabled: true, offsetX: -999, offsetY: 999, blur: -5 }
    })).toMatchObject({
      stroke: { enabled: true, color: { r: 0, g: 20, b: 255, a: 255 }, size: 64, position: 'outside', kernel: 'round', directions: { nw: false, n: true, ne: false, w: true, e: true, sw: false, s: true, se: false }, smartHue: false, smartHueDarkness: 45 },
      shadow: { enabled: true, offsetX: -64, offsetY: 64, blur: 0, smartShadow: false, smartShadowDarkness: 45 },
      innerGlow: { enabled: false },
      colorOverlay: { enabled: false },
      gradientOverlay: { enabled: false, dither: 'none' }
    })
  })

  it('renders an outside stroke and disables the normal-layer fast path', () => {
    const document = createDocument('stroke', 5, 5, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 2 * 5 + 2, red)
    const styles = createDefaultLayerStyles()
    styles.stroke = { ...styles.stroke, enabled: true, color: blue, size: 1, position: 'outside' }
    layer.layerStyles = styles

    const output = compositeRegion(document, 0, 0, 5, 5)
    expect(normalCompositeLayers(document)).toBeNull()
    expect(pixelAt(output, 5, 2, 2)).toEqual([255, 0, 0, 255])
    expect(pixelAt(output, 5, 1, 2)).toEqual([0, 0, 255, 255])
    expect(pixelAt(output, 5, 1, 1)).toEqual([0, 0, 0, 0])
  })

  it('derives smart-hue stroke pixels from the nearest visible source color', () => {
    const document = createDocument('smart hue stroke', 3, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 1, { r: 200, g: 100, b: 50, a: 255 })
    const styles = createDefaultLayerStyles()
    styles.stroke = { ...styles.stroke, enabled: true, smartHue: true, smartHueDarkness: 50, size: 1, position: 'outside' }
    layer.layerStyles = styles

    const output = compositeRegion(document, 0, 0, 3, 1)
    expect(pixelAt(output, 3, 0, 0)).toEqual([100, 50, 25, 255])
    expect(pixelAt(output, 3, 1, 0)).toEqual([200, 100, 50, 255])
    expect(pixelAt(output, 3, 2, 0)).toEqual([100, 50, 25, 255])
  })

  it('maps generated smart-hue stroke colors through indexed document rules', () => {
    const document = createDocument('indexed smart hue stroke', 3, 1, 'indexed')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 1, { r: 41, g: 121, b: 255, a: 255 })
    const styles = createDefaultLayerStyles()
    styles.stroke = { ...styles.stroke, enabled: true, smartHue: true, smartHueDarkness: 50, size: 1, position: 'outside' }
    layer.layerStyles = styles

    const output = compositeRegion(document, 0, 0, 3, 1)
    expect(pixelAt(output, 3, 0, 0)).toEqual([24, 27, 33, 255])
    expect(pixelAt(output, 3, 1, 0)).toEqual([41, 121, 255, 255])
  })

  it('supports inside and two-sided stroke positions', () => {
    const insideDocument = createDocument('inside stroke', 3, 3, 'rgba')
    const insideLayer = getActiveLayer(insideDocument)
    for (let index = 0; index < 9; index += 1) writeLayerColor(insideDocument, insideLayer, index, red)
    const insideStyles = createDefaultLayerStyles()
    insideStyles.stroke = { ...insideStyles.stroke, enabled: true, color: blue, size: 1, position: 'inside' }
    insideLayer.layerStyles = insideStyles
    const insideOutput = compositeRegion(insideDocument, 0, 0, 3, 3)
    expect(pixelAt(insideOutput, 3, 0, 1)).toEqual([0, 0, 255, 255])
    expect(pixelAt(insideOutput, 3, 1, 1)).toEqual([255, 0, 0, 255])

    const bothDocument = createDocument('two-sided stroke', 3, 3, 'rgba')
    const bothLayer = getActiveLayer(bothDocument)
    writeLayerColor(bothDocument, bothLayer, 4, red)
    const bothStyles = createDefaultLayerStyles()
    bothStyles.stroke = { ...bothStyles.stroke, enabled: true, color: blue, size: 1, position: 'both' }
    bothLayer.layerStyles = bothStyles
    const bothOutput = compositeRegion(bothDocument, 0, 0, 3, 3)
    expect(pixelAt(bothOutput, 3, 1, 1)).toEqual([0, 0, 255, 255])
    expect(pixelAt(bothOutput, 3, 0, 1)).toEqual([0, 0, 255, 255])
  })

  it('uses the shared block shape and pixel-direction controls', () => {
    const document = createDocument('directional stroke', 3, 3, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 4, red)
    const styles = createDefaultLayerStyles()
    styles.stroke = {
      ...styles.stroke,
      enabled: true,
      color: blue,
      kernel: 'square',
      directions: { nw: true, n: false, ne: false, w: false, e: false, sw: false, s: false, se: false }
    }
    layer.layerStyles = styles

    const output = compositeRegion(document, 0, 0, 3, 3)
    expect(pixelAt(output, 3, 0, 0)).toEqual([0, 0, 255, 255])
    expect(pixelAt(output, 3, 1, 0)).toEqual([0, 0, 0, 0])
    expect(pixelAt(output, 3, 2, 2)).toEqual([0, 0, 0, 0])
  })

  it('applies styles to the composited contents of a layer group', () => {
    const document = createDocument('group stroke', 5, 5, 'rgba')
    const layer = getActiveLayer(document)
    layer.groupId = 'group'
    writeLayerColor(document, layer, 2 * 5 + 2, red)
    const styles = createDefaultLayerStyles()
    styles.stroke = { ...styles.stroke, enabled: true, color: blue, size: 1, position: 'outside' }
    document.groups.push({ id: 'group', name: 'Group', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal', layerStyles: styles })

    const output = compositeRegion(document, 0, 0, 5, 5)
    expect(normalCompositeLayers(document)).toBeNull()
    expect(pixelAt(output, 5, 2, 2)).toEqual([255, 0, 0, 255])
    expect(pixelAt(output, 5, 1, 2)).toEqual([0, 0, 255, 255])
  })

  it('renders an offset shadow behind the source', () => {
    const document = createDocument('shadow', 5, 5, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 1 * 5 + 1, red)
    const styles = createDefaultLayerStyles()
    styles.shadow = { ...styles.shadow, enabled: true, color: { r: 0, g: 0, b: 0, a: 160 }, offsetX: 1, offsetY: 1, blur: 0 }
    layer.layerStyles = styles

    const output = compositeRegion(document, 0, 0, 5, 5)
    expect(pixelAt(output, 5, 1, 1)).toEqual([255, 0, 0, 255])
    expect(pixelAt(output, 5, 2, 2)).toEqual([0, 0, 0, 160])
  })

  it('darkens the live background hue for a smart shadow', () => {
    const document = createDocument('smart shadow', 3, 1, 'rgba')
    const background = getActiveLayer(document)
    for (let index = 0; index < 3; index += 1) writeLayerColor(document, background, index, { r: 0, g: 200, b: 100, a: 255 })
    const subject = createLayer('subject', 3, 1, 'rgba')
    document.layers.push(subject)
    writeLayerColor(document, subject, 0, red)
    const styles = createDefaultLayerStyles()
    styles.shadow = { ...styles.shadow, enabled: true, offsetX: 1, offsetY: 0, blur: 0, smartShadow: true, smartShadowDarkness: 50 }
    subject.layerStyles = styles

    const output = compositeRegion(document, 0, 0, 3, 1)
    expect(pixelAt(output, 3, 0, 0)).toEqual([255, 0, 0, 255])
    expect(pixelAt(output, 3, 1, 0)).toEqual([0, 100, 50, 255])
    expect(pixelAt(output, 3, 2, 0)).toEqual([0, 200, 100, 255])
  })

  it('renders an inner glow only near transparent edges', () => {
    const document = createDocument('inner glow', 5, 5, 'rgba')
    const layer = getActiveLayer(document)
    for (let index = 0; index < 25; index += 1) writeLayerColor(document, layer, index, red)
    const styles = createDefaultLayerStyles()
    styles.innerGlow = { enabled: true, color: { r: 255, g: 255, b: 255, a: 255 }, size: 1 }
    layer.layerStyles = styles

    const output = compositeRegion(document, 0, 0, 5, 5)
    expect(pixelAt(output, 5, 0, 2)).toEqual([255, 255, 255, 255])
    expect(pixelAt(output, 5, 2, 2)).toEqual([255, 0, 0, 255])
  })

  it('applies color and gradient overlays while preserving source alpha', () => {
    const colorDocument = createDocument('color overlay', 1, 1, 'rgba')
    const colorLayer = getActiveLayer(colorDocument)
    writeLayerColor(colorDocument, colorLayer, 0, { ...red, a: 128 })
    const colorStyles = createDefaultLayerStyles()
    colorStyles.colorOverlay = { enabled: true, color: { r: 0, g: 255, b: 0, a: 255 } }
    colorLayer.layerStyles = colorStyles
    expect(Array.from(compositeRegion(colorDocument, 0, 0, 1, 1))).toEqual([0, 255, 0, 128])

    const gradientDocument = createDocument('gradient overlay', 3, 1, 'rgba')
    const gradientLayer = getActiveLayer(gradientDocument)
    for (let index = 0; index < 3; index += 1) writeLayerColor(gradientDocument, gradientLayer, index, red)
    const gradientStyles = createDefaultLayerStyles()
    gradientStyles.gradientOverlay = {
      enabled: true,
      from: { r: 0, g: 0, b: 0, a: 255 },
      to: { r: 255, g: 255, b: 255, a: 255 },
      angle: 0,
      dither: 'none'
    }
    gradientLayer.layerStyles = gradientStyles
    const output = compositeRegion(gradientDocument, 0, 0, 3, 1)
    expect(pixelAt(output, 3, 0, 0)).toEqual([0, 0, 0, 255])
    expect(pixelAt(output, 3, 1, 0)).toEqual([128, 128, 128, 255])
    expect(pixelAt(output, 3, 2, 0)).toEqual([255, 255, 255, 255])
  })

  it('uses endpoint colors for dithered gradient overlays', () => {
    const document = createDocument('dithered gradient overlay', 4, 1, 'rgba')
    const layer = getActiveLayer(document)
    for (let index = 0; index < 4; index += 1) writeLayerColor(document, layer, index, red)
    const styles = createDefaultLayerStyles()
    styles.gradientOverlay = {
      enabled: true,
      from: { r: 0, g: 0, b: 0, a: 255 },
      to: { r: 255, g: 255, b: 255, a: 255 },
      angle: 0,
      dither: 'checker'
    }
    layer.layerStyles = styles

    const output = compositeRegion(document, 0, 0, 4, 1)
    expect(Array.from({ length: 4 }, (_, x) => pixelAt(output, 4, x, 0))).toEqual([
      [0, 0, 0, 255],
      [0, 0, 0, 255],
      [255, 255, 255, 255],
      [255, 255, 255, 255]
    ])
  })

  it('derives style geometry from the visible layer-mask result', () => {
    const document = createDocument('masked stroke', 3, 3, 'rgba')
    const layer = getActiveLayer(document)
    for (let index = 0; index < 9; index += 1) writeLayerColor(document, layer, index, red)
    const cel = ensureAnimationDocument(document).cels[0]
    cel.mask = createLayerMask(cel.id, 3, 3)
    writeLayerColor(document, cel.mask, 4, { r: 0, g: 0, b: 0, a: 255 })
    const styles = createDefaultLayerStyles()
    styles.stroke = { ...styles.stroke, enabled: true, color: blue, size: 1, position: 'outside' }
    layer.layerStyles = styles

    expect(pixelAt(compositeRegion(document, 0, 0, 3, 3), 3, 1, 1)).toEqual([0, 0, 255, 255])
  })
})
