import { decode } from 'upng-js'
import { describe, expect, it } from 'vitest'
import { createDocument, getActiveLayer, writeLayerColor } from './document'
import { encodePalettePng, extractPaletteColors, mergePaletteColors } from './palette'

describe('palette extraction', () => {
  it('extracts visible exact colors, preserves alpha, and omits full transparency', () => {
    const document = createDocument('palette', 4, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, { r: 255, g: 0, b: 0, a: 255 })
    writeLayerColor(document, layer, 1, { r: 255, g: 0, b: 0, a: 255 })
    writeLayerColor(document, layer, 2, { r: 0, g: 80, b: 255, a: 128 })

    expect(extractPaletteColors(document, 16)).toEqual([
      { r: 255, g: 0, b: 0, a: 255 },
      { r: 0, g: 80, b: 255, a: 128 }
    ])
  })

  it('quantizes an image to the requested maximum color count', () => {
    const document = createDocument('quantized palette', 8, 1, 'rgba')
    const layer = getActiveLayer(document)
    for (let index = 0; index < 8; index += 1) {
      writeLayerColor(document, layer, index, { r: index * 30, g: 255 - index * 20, b: index * 10, a: 255 })
    }

    const colors = extractPaletteColors(document, 3)
    expect(colors.length).toBeGreaterThan(0)
    expect(colors.length).toBeLessThanOrEqual(3)
  })

  it('keeps more than four exact colors when the selected limit allows them', () => {
    const document = createDocument('large exact palette', 24, 1, 'rgba')
    const layer = getActiveLayer(document)
    for (let index = 0; index < 24; index += 1) {
      writeLayerColor(document, layer, index, { r: index * 10, g: 240 - index * 7, b: index * 5, a: 255 })
    }

    expect(extractPaletteColors(document, 32)).toHaveLength(24)
  })

  it('fills average-color collisions to the requested 16-color limit', () => {
    const document = createDocument('collision-safe palette', 64, 1, 'rgba')
    const layer = getActiveLayer(document)
    for (let index = 0; index < 64; index += 1) {
      writeLayerColor(document, layer, index, {
        r: (index * 67) % 256,
        g: (index * 131) % 256,
        b: (index * 197) % 256,
        a: 255
      })
    }

    expect(extractPaletteColors(document, 16)).toHaveLength(16)
  })

  it('merges colors without duplicates and exports an ordered PNG grid', () => {
    const red = { r: 255, g: 0, b: 0, a: 255 }
    const blue = { r: 0, g: 80, b: 255, a: 128 }
    const merged = mergePaletteColors([red], [red, blue])
    expect(merged).toEqual([red, blue])

    const exported = encodePalettePng(merged, 16, 8)
    const decoded = decode(new Uint8Array(exported.bytes).buffer as ArrayBuffer)
    expect(decoded.width).toBe(32)
    expect(decoded.height).toBe(16)
  })
})
