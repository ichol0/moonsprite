import { describe, expect, it } from 'vitest'
import { commitPixelEdit } from './history'
import { createDocument, getActiveLayer, readLayerColorAt, writeLayerColor } from './document'
import { applyGradient, constrainGradientEndpoint, gradientColorAt, gradientRegionSelection, GRADIENT_DITHER_PRESETS } from './gradient'

const red = { r: 255, g: 0, b: 0, a: 255 }
const blue = { r: 0, g: 0, b: 255, a: 255 }

describe('gradient tool core', () => {
  it('snaps constrained endpoints to sixteen directions while preserving distance', () => {
    expect(constrainGradientEndpoint({ x: 2, y: 3 }, { x: 12, y: 3 })).toEqual({ x: 12, y: 3 })
    expect(constrainGradientEndpoint({ x: 2, y: 3 }, { x: 2, y: 13 })).toEqual({ x: 2, y: 13 })
    expect(constrainGradientEndpoint({ x: 0, y: 0 }, { x: 10, y: 10 })).toEqual({ x: 10, y: 10 })

    const snapped = constrainGradientEndpoint({ x: 0, y: 0 }, { x: 10, y: 3 })
    const angle = Math.atan2(snapped.y, snapped.x)
    const directionStep = Math.PI / 8
    expect(Math.abs(angle / directionStep - Math.round(angle / directionStep))).toBeLessThan(0.000001)
    expect(Math.hypot(snapped.x, snapped.y)).toBeGreaterThan(0)
  })

  it('interpolates exact endpoint colors without dithering', () => {
    expect(gradientColorAt(red, blue, 0, 0, { x: 0, y: 0 }, { x: 4, y: 0 }, 'none')).toEqual(red)
    expect(gradientColorAt(red, blue, 2, 0, { x: 0, y: 0 }, { x: 4, y: 0 }, 'none')).toEqual({ r: 128, g: 0, b: 128, a: 255 })
    expect(gradientColorAt(red, blue, 4, 0, { x: 0, y: 0 }, { x: 4, y: 0 }, 'none')).toEqual(blue)
  })

  it('provides deterministic built-in dither presets', () => {
    expect(GRADIENT_DITHER_PRESETS).toEqual(['none', 'bayer-2', 'bayer-4', 'bayer-8', 'checker', 'diagonal', 'diagonal-reverse', 'horizontal', 'vertical'])
    for (const preset of GRADIENT_DITHER_PRESETS.filter((item) => item !== 'none')) {
      const colors = Array.from({ length: 8 }, (_, x) => gradientColorAt(red, blue, x, 1, { x: 0, y: 0 }, { x: 7, y: 0 }, preset))
      expect(colors[0]).toEqual(red)
      expect(colors[7]).toEqual(blue)
      expect(colors.every((color) => color.r === 255 || color.b === 255)).toBe(true)
    }
  })

  it('provides both diagonal dither directions', () => {
    const left = gradientColorAt(red, blue, 2, 1, { x: 0, y: 0 }, { x: 4, y: 0 }, 'diagonal')
    const right = gradientColorAt(red, blue, 2, 1, { x: 0, y: 0 }, { x: 4, y: 0 }, 'diagonal-reverse')
    expect(left).toEqual(red)
    expect(right).toEqual(blue)
  })

  it('clips to the active selection and remains one undo step', () => {
    const document = createDocument('gradient', 4, 1, 'rgba')
    const layer = getActiveLayer(document)
    const edit = applyGradient(document, layer, { x: 1, y: 0 }, { x: 2, y: 0 }, red, blue, { x: 1, y: 0, width: 2, height: 1 })
    expect(edit).not.toBeNull()
    expect(readLayerColorAt(document, layer, 0, 0).a).toBe(0)
    expect(readLayerColorAt(document, layer, 1, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, 2, 0)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 3, 0).a).toBe(0)

    const history = commitPixelEdit(document, edit!, 'Gradient')
    history?.undo()
    expect(readLayerColorAt(document, layer, 1, 0).a).toBe(0)
    expect(readLayerColorAt(document, layer, 2, 0).a).toBe(0)
    history?.redo()
    expect(readLayerColorAt(document, layer, 1, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, 2, 0)).toEqual(blue)
  })

  it('limits gradients to tolerance-matched contiguous or global regions', () => {
    const createRegionDocument = () => {
      const document = createDocument('gradient region', 5, 1, 'rgba')
      const layer = getActiveLayer(document)
      const colors = [
        { r: 20, g: 20, b: 20, a: 255 },
        { r: 23, g: 20, b: 20, a: 255 },
        { r: 180, g: 180, b: 180, a: 255 },
        { r: 22, g: 20, b: 20, a: 255 },
        { r: 20, g: 20, b: 20, a: 255 }
      ]
      colors.forEach((color, index) => writeLayerColor(document, layer, index, color))
      return { document, layer, colors }
    }

    const contiguous = createRegionDocument()
    const contiguousRegion = gradientRegionSelection(contiguous.document, contiguous.layer, { x: 0, y: 0 }, 3, true)
    applyGradient(contiguous.document, contiguous.layer, { x: 0, y: 0 }, { x: 4, y: 0 }, red, blue, null, 'none', contiguousRegion)
    expect(readLayerColorAt(contiguous.document, contiguous.layer, 0, 0)).toEqual(red)
    expect(readLayerColorAt(contiguous.document, contiguous.layer, 1, 0)).toEqual({ r: 191, g: 0, b: 64, a: 255 })
    expect(readLayerColorAt(contiguous.document, contiguous.layer, 3, 0)).toEqual(contiguous.colors[3])

    const global = createRegionDocument()
    const globalRegion = gradientRegionSelection(global.document, global.layer, { x: 0, y: 0 }, 3, false)
    applyGradient(global.document, global.layer, { x: 0, y: 0 }, { x: 4, y: 0 }, red, blue, null, 'none', globalRegion)
    expect(readLayerColorAt(global.document, global.layer, 0, 0)).toEqual(red)
    expect(readLayerColorAt(global.document, global.layer, 1, 0)).toEqual({ r: 191, g: 0, b: 64, a: 255 })
    expect(readLayerColorAt(global.document, global.layer, 3, 0)).toEqual({ r: 64, g: 0, b: 191, a: 255 })
    expect(readLayerColorAt(global.document, global.layer, 4, 0)).toEqual(blue)
    expect(readLayerColorAt(global.document, global.layer, 2, 0)).toEqual(global.colors[2])
  })
})
