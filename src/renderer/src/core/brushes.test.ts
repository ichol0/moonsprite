import { describe, expect, it } from 'vitest'
import type { ImageBrush } from '@shared/types'
import { packColor, unpackColor } from './raster'
import { activeBrushInputsForTool, createImageBrushFromRgba, decodeImageBrush, encodeBrushPng, MAX_BRUSH_DIMENSION } from './brushes'

describe('image brushes', () => {
  it('preserves imported RGBA pixels and intrinsic dimensions through PNG storage', async () => {
    const source = new Uint8ClampedArray([
      248, 91, 74, 255,
      41, 121, 255, 96
    ])
    const brush = createImageBrushFromRgba('import:test', 'RGBA', 2, 1, source)

    expect(brush.intrinsicSize).toBe(true)
    expect(brush.coverage).toEqual(Uint8Array.from([255, 96]))
    expect(Array.from(brush.colors ?? [], unpackColor)).toEqual([
      { r: 248, g: 91, b: 74, a: 255 },
      { r: 41, g: 121, b: 255, a: 96 }
    ])

    const decoded = await decodeImageBrush(
      { id: 'stored.png', name: 'RGBA', filePath: 'brushes/stored.png', intrinsicSize: true },
      encodeBrushPng(brush)
    )
    expect(decoded).toMatchObject({ id: 'stored.png', width: 2, height: 1, intrinsicSize: true })
    expect(Array.from(decoded.colors ?? [], unpackColor)).toEqual([
      { r: 248, g: 91, b: 74, a: 255 },
      { r: 41, g: 121, b: 255, a: 96 }
    ])
  })

  it('rejects imported brushes above the 256 by 256 limit', () => {
    const width = MAX_BRUSH_DIMENSION + 1
    expect(() => createImageBrushFromRgba('large', 'Large', width, 1, new Uint8ClampedArray(width * 4))).toThrow('256')
  })

  it('keeps system textures fill-only while allowing RGBA brushes on stroke tools', () => {
    const rgbaBrush: ImageBrush = {
      id: 'rgba.png', name: 'RGBA', width: 1, height: 1,
      coverage: Uint8Array.of(255), colors: Uint32Array.of(packColor({ r: 10, g: 20, b: 30, a: 255 })), intrinsicSize: true
    }
    const proceduralBrush: ImageBrush = { id: 'procedural:noise', name: 'Noise', width: 1, height: 1, coverage: Uint8Array.of(255) }

    expect(activeBrushInputsForTool('pencil', 'bucket', rgbaBrush, 'grain')).toEqual({ imageBrush: rgbaBrush, texture: 'solid', fillTextureEnabled: false })
    expect(activeBrushInputsForTool('eraser', 'bucket', proceduralBrush, 'wood')).toEqual({ imageBrush: null, texture: 'solid', fillTextureEnabled: false })
    expect(activeBrushInputsForTool('line', 'bucket', proceduralBrush, 'cracks')).toEqual({ imageBrush: null, texture: 'solid', fillTextureEnabled: false })
    expect(activeBrushInputsForTool('fill', 'bucket', proceduralBrush, 'grain')).toEqual({ imageBrush: proceduralBrush, texture: 'grain', fillTextureEnabled: true })
    expect(activeBrushInputsForTool('fill', 'gradient', proceduralBrush, 'grain')).toEqual({ imageBrush: null, texture: 'solid', fillTextureEnabled: false })
  })
})
