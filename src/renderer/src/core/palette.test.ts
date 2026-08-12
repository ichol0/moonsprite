import { decode } from 'upng-js'
import { describe, expect, it } from 'vitest'
import { createDocument, getActiveLayer, writeLayerColor } from './document'
import { countUsedPaletteColors, encodePalettePng, extractPaletteColors, mergePaletteColors, paletteGradient, sortPaletteColors } from './palette'

describe('palette extraction', () => {
  it('counts palette colors used by RGBA and indexed animation surfaces', () => {
    const rgbaDocument = createDocument('rgba usage', 2, 1, 'rgba')
    writeLayerColor(rgbaDocument, getActiveLayer(rgbaDocument), 0, rgbaDocument.palette[1].color)
    expect(countUsedPaletteColors(rgbaDocument)).toBe(1)

    const indexedDocument = createDocument('indexed usage', 2, 1, 'indexed')
    const indexedLayer = getActiveLayer(indexedDocument)
    if (indexedLayer.format !== 'indexed') throw new Error('Indexed layer required')
    indexedLayer.pixels[0] = 1
    indexedLayer.pixels[1] = 2
    expect(countUsedPaletteColors(indexedDocument)).toBe(2)
  })

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

  it('sorts palette colors by hue, saturation, brightness, luminance, RGBA, and direction', () => {
    const darkGray = { r: 24, g: 24, b: 24, a: 255 }
    const lightGray = { r: 220, g: 220, b: 220, a: 255 }
    const red = { r: 255, g: 0, b: 0, a: 255 }
    const green = { r: 0, g: 255, b: 0, a: 255 }
    const transparentBlue = { r: 0, g: 0, b: 255, a: 64 }
    expect(sortPaletteColors([green, lightGray, red, darkGray], 'hue')).toEqual([darkGray, lightGray, red, green])
    expect(sortPaletteColors([red, lightGray, darkGray], 'saturation')).toEqual([darkGray, lightGray, red])
    expect(sortPaletteColors([lightGray, red, darkGray], 'brightness')).toEqual([darkGray, lightGray, red])
    expect(sortPaletteColors([red, transparentBlue], 'alpha')).toEqual([transparentBlue, red])
    expect(sortPaletteColors([red, green], 'red')).toEqual([green, red])
    expect(sortPaletteColors([red, green], 'green')).toEqual([red, green])
    expect(sortPaletteColors([red, transparentBlue], 'blue')).toEqual([red, transparentBlue])
    expect(sortPaletteColors([red, green], 'luminance')).toEqual([red, green])
    expect(sortPaletteColors([red, green], 'hue', 'descending')).toEqual([green, red])
  })

  it('creates RGB and shortest-path hue gradients while preserving endpoints', () => {
    const red = { r: 255, g: 0, b: 0, a: 255 }
    const blue = { r: 0, g: 0, b: 255, a: 127 }
    const rgb = paletteGradient(red, blue, 3)
    const hue = paletteGradient(red, blue, 3, true)
    expect(rgb).toEqual([red, { r: 128, g: 0, b: 128, a: 191 }, blue])
    expect(hue[0]).toEqual(red)
    expect(hue[1]).toEqual({ r: 255, g: 0, b: 255, a: 191 })
    expect(hue[2]).toEqual(blue)
  })
})
