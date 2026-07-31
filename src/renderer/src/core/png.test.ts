import { describe, expect, it } from 'vitest'
import { decodePng, encodePng, exportDocumentImage } from './png'
import { createDocument, getActiveLayer, readLayerColor } from './document'

describe('PNG format', () => {
  it('uses indexed output for no more than 256 colors', () => {
    const rgba = new Uint8ClampedArray([41, 121, 255, 255, 0, 0, 0, 0])
    const result = encodePng(rgba, 2, 1)
    expect(result.indexed).toBe(true)
    const decoded = decodePng(result.bytes)
    expect(decoded.width).toBe(2)
    expect(decoded.height).toBe(1)
    expect(readLayerColor(decoded, getActiveLayer(decoded), 0)).toEqual({ r: 41, g: 121, b: 255, a: 255 })
    expect(readLayerColor(decoded, getActiveLayer(decoded), 1).a).toBe(0)
  })

  it('falls back to RGBA when the flattened image exceeds 256 colors', () => {
    const rgba = new Uint8ClampedArray(257 * 4)
    for (let index = 0; index < 257; index += 1) {
      rgba[index * 4] = index & 0xff
      rgba[index * 4 + 1] = index >>> 8
      rgba[index * 4 + 2] = (index * 13) & 0xff
      rgba[index * 4 + 3] = 255
    }
    expect(encodePng(rgba, 257, 1).indexed).toBe(false)
  })

  it('uses percentage-based nearest-neighbor export dimensions', async () => {
    const document = createDocument('scale', 2, 2, 'rgba')
    const result = await exportDocumentImage(document, 150, 'png-rgba')
    expect(result.width).toBe(3)
    expect(result.height).toBe(3)
    const decoded = decodePng(result.bytes)
    expect(decoded.width).toBe(3)
    expect(decoded.height).toBe(3)
  })

  it('exports transparent pixel art as crisp SVG rectangles', async () => {
    const document = createDocument('svg', 2, 1, 'rgba')
    const layer = getActiveLayer(document)
    if (layer.format !== 'rgba') throw new Error('expected rgba layer')
    layer.pixels.set([41, 121, 255, 255, 0, 0, 0, 0])
    const result = await exportDocumentImage(document, 200, 'svg')
    const svg = new TextDecoder().decode(result.bytes)
    expect(result.extension).toBe('svg')
    expect(result.width).toBe(4)
    expect(result.height).toBe(2)
    expect(svg).toContain('width="4" height="2"')
    expect(svg).toContain('shape-rendering="crispEdges"')
    expect(svg).toContain('fill="#2979ff"')
    expect(svg).not.toContain('M2 0')
  })
})
