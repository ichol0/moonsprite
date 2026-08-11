import { describe, expect, it } from 'vitest'
import { addBlankAnimationFrame, animationCelAt, ensureAnimationDocument } from './animation'
import { createDocument, getActiveLayer, writeLayerColor } from './document'
import { createHorizontalSpriteSheetDocument } from './sprite-sheet'

describe('sprite sheet document creation', () => {
  it('composites animation frames from left to right into one RGBA layer', () => {
    const source = createDocument('source', 2, 1, 'rgba')
    const layer = getActiveLayer(source)
    writeLayerColor(source, layer, 0, { r: 255, g: 0, b: 0, a: 255 })

    const secondFrameId = addBlankAnimationFrame(source)
    animationCelAt(ensureAnimationDocument(source), layer.id, secondFrameId)!.surface = {
      format: 'rgba',
      width: 2,
      height: 1,
      offsetX: 0,
      offsetY: 0,
      pixels: Uint8ClampedArray.from([
        0, 0, 0, 0,
        0, 80, 255, 255
      ])
    }

    const sheet = createHorizontalSpriteSheetDocument(source, {
      document: 'source - sprite sheet',
      layer: 'sprite sheet'
    })

    expect(sheet).toMatchObject({
      name: 'source - sprite sheet',
      width: 4,
      height: 1,
      colorMode: 'rgba'
    })
    expect(sheet.layers).toHaveLength(1)
    expect(sheet.groups).toHaveLength(0)
    expect(ensureAnimationDocument(sheet).frames).toHaveLength(1)
    expect(getActiveLayer(sheet).name).toBe('sprite sheet')
    expect(Array.from(getActiveLayer(sheet).pixels)).toEqual([
      255, 0, 0, 255,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 80, 255, 255
    ])
  })
})
