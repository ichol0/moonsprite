import { describe, expect, it } from 'vitest'
import { createDocument, getActiveLayer, readLayerColor } from './document'
import { applyImportedRgbaPalette, IMPORTED_PALETTE_COLOR_LIMIT, normalizeImportedIndexedPalette, sortImportedPaletteColors } from './imported-palette'

describe('imported palette normalization', () => {
  it('deduplicates actual RGBA pixels and orders them by perceptual luminance', () => {
    const document = createDocument('import', 4, 1, 'rgba')
    const layer = getActiveLayer(document)
    if (layer.format !== 'rgba') throw new Error('RGBA layer required')
    layer.pixels.set([
      255, 255, 255, 255,
      255, 0, 0, 255,
      255, 255, 255, 255,
      0, 0, 0, 0
    ])

    applyImportedRgbaPalette(document)

    expect(document.palette.map((entry) => entry.color)).toEqual([
      { r: 255, g: 0, b: 0, a: 255 },
      { r: 255, g: 255, b: 255, a: 255 }
    ])
    expect(document.paletteOrder).toEqual([1, 2])
  })

  it('removes unused indexed entries, collapses duplicate colors, and remaps pixels', () => {
    const document = createDocument('indexed import', 4, 1, 'indexed')
    const layer = getActiveLayer(document)
    if (layer.format !== 'indexed') throw new Error('Indexed layer required')
    document.palette = [
      { id: 0, name: 'Transparent', color: { r: 0, g: 0, b: 0, a: 0 } },
      { id: 1, name: 'White A', color: { r: 255, g: 255, b: 255, a: 255 } },
      { id: 2, name: 'Unused', color: { r: 0, g: 255, b: 0, a: 255 } },
      { id: 3, name: 'White B', color: { r: 255, g: 255, b: 255, a: 255 } },
      { id: 4, name: 'Red', color: { r: 255, g: 0, b: 0, a: 255 } }
    ]
    layer.pixels.set([1, 3, 4, 0])

    normalizeImportedIndexedPalette(document)

    expect(document.palette.map((entry) => entry.color)).toEqual([
      { r: 0, g: 0, b: 0, a: 0 },
      { r: 255, g: 0, b: 0, a: 255 },
      { r: 255, g: 255, b: 255, a: 255 }
    ])
    expect([...layer.pixels]).toEqual([2, 2, 1, 0])
    expect(readLayerColor(document, layer, 0)).toEqual({ r: 255, g: 255, b: 255, a: 255 })
  })

  it('keeps imported RGBA palettes bounded for high-color images', () => {
    const document = createDocument('photo', IMPORTED_PALETTE_COLOR_LIMIT + 32, 1, 'rgba')
    const layer = getActiveLayer(document)
    if (layer.format !== 'rgba') throw new Error('RGBA layer required')
    for (let index = 0; index < document.width; index += 1) {
      layer.pixels.set([index & 255, index >>> 8, index * 37 & 255, 255], index * 4)
    }

    applyImportedRgbaPalette(document)

    expect(document.palette).toHaveLength(IMPORTED_PALETTE_COLOR_LIMIT)
    expect(new Set(document.palette.map((entry) => `${entry.color.r},${entry.color.g},${entry.color.b},${entry.color.a}`)).size).toBe(document.palette.length)
  })

  it('does not miss rare colors in large low-color pixel art', () => {
    const width = 300_000
    const document = createDocument('large pixel art', width, 1, 'rgba')
    const layer = getActiveLayer(document)
    if (layer.format !== 'rgba') throw new Error('RGBA layer required')
    for (let index = 0; index < width; index += 1) layer.pixels.set([255, 255, 255, 255], index * 4)
    layer.pixels.set([255, 0, 0, 255], (width - 1) * 4)

    applyImportedRgbaPalette(document)

    expect(document.palette.map((entry) => entry.color)).toEqual([
      { r: 255, g: 0, b: 0, a: 255 },
      { r: 255, g: 255, b: 255, a: 255 }
    ])
  })

  it('sorts imported colors by perceptual luminance from dark to light', () => {
    expect(sortImportedPaletteColors([
      { r: 0, g: 0, b: 255, a: 255 },
      { r: 255, g: 255, b: 255, a: 255 },
      { r: 255, g: 0, b: 0, a: 255 },
      { r: 0, g: 0, b: 0, a: 255 }
    ])).toEqual([
      { r: 0, g: 0, b: 0, a: 255 },
      { r: 0, g: 0, b: 255, a: 255 },
      { r: 255, g: 0, b: 0, a: 255 },
      { r: 255, g: 255, b: 255, a: 255 }
    ])
  })
})
