import { describe, expect, it } from 'vitest'
import { commitPixelEdit, revertPixelEdit } from './history'
import { createDocument, getActiveLayer, readLayerColorAt, writeLayerColor } from './document'
import { applyGradient, constrainGradientEndpoint, createGradientColorSampler, gradientAmountAt, gradientColorAt, gradientColorForAmount, gradientRegionSelection, GRADIENT_DITHER_PRESETS, interpolateRgbaColor } from './gradient'

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

  it('interpolates RGBA channels directly with rounding', () => {
    expect(interpolateRgbaColor({ r: 10, g: 20, b: 30, a: 40 }, { r: 21, g: 31, b: 41, a: 51 }, 0.5)).toEqual({ r: 16, g: 26, b: 36, a: 46 })
    expect(interpolateRgbaColor(red, blue, -1)).toEqual(red)
    expect(interpolateRgbaColor(red, blue, 2)).toEqual(blue)
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

  it('uses the same amount resolver for all nine gradient modes', () => {
    for (const preset of GRADIENT_DITHER_PRESETS) {
      for (let x = -2; x <= 9; x += 1) {
        const amount = Math.max(0, Math.min(1, x / 7))
        expect(gradientColorForAmount(red, blue, amount, x, 3, preset)).toEqual(
          gradientColorAt(red, blue, x, 3, { x: 0, y: 3 }, { x: 7, y: 3 }, preset)
        )
      }
    }
  })

  it('matches the point API for floating endpoints, alpha colors, and every dither mode', () => {
    const startColor = { r: 11, g: 29, b: 47, a: 0 }
    const endColor = { r: 230, g: 170, b: 90, a: 137 }
    const start = { x: -0.75, y: 1.25 }
    const end = { x: 6.5, y: -2.125 }
    const points = [{ x: -3, y: 4 }, { x: 0, y: 0 }, { x: 2, y: -1 }, { x: 7, y: 3 }]

    for (const preset of GRADIENT_DITHER_PRESETS) {
      const sample = createGradientColorSampler(startColor, endColor, start, end, preset)
      for (const point of points) {
        const expected = gradientColorForAmount(startColor, endColor, gradientAmountAt(point.x, point.y, start, end), point.x, point.y, preset)
        expect(sample(point.x, point.y)).toEqual(expected)
        expect(gradientColorAt(startColor, endColor, point.x, point.y, start, end, preset)).toEqual(expected)
      }
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

  it('keeps large dense gradients exact and undoable without per-pixel maps', () => {
    const document = createDocument('dense gradient', 512, 512, 'rgba')
    const layer = getActiveLayer(document)
    const edit = applyGradient(document, layer, { x: 0, y: 0 }, { x: 511, y: 0 }, red, blue)

    expect(edit?.before.size).toBe(0)
    expect(edit?.denseRegion?.count).toBe(512 * 512)
    expect(readLayerColorAt(document, layer, 0, 256)).toEqual(red)
    expect(readLayerColorAt(document, layer, 511, 256)).toEqual(blue)

    const history = commitPixelEdit(document, edit!, 'Dense gradient')
    history?.undo()
    expect(readLayerColorAt(document, layer, 0, 256).a).toBe(0)
    expect(readLayerColorAt(document, layer, 511, 256).a).toBe(0)
    history?.redo()
    expect(readLayerColorAt(document, layer, 0, 256)).toEqual(red)
    expect(readLayerColorAt(document, layer, 511, 256)).toEqual(blue)
  })

  it('reverts a large dense gradient before it is committed', () => {
    const document = createDocument('revert dense gradient', 512, 512, 'rgba')
    const layer = getActiveLayer(document)
    const original = { r: 20, g: 40, b: 60, a: 255 }
    writeLayerColor(document, layer, 256 * 512 + 256, original)

    const edit = applyGradient(document, layer, { x: 0, y: 0 }, { x: 511, y: 0 }, red, blue)
    expect(edit?.denseRegion?.count).toBe(512 * 512)
    expect(readLayerColorAt(document, layer, 256, 256)).not.toEqual(original)

    revertPixelEdit(document, edit)
    expect(readLayerColorAt(document, layer, 0, 0).a).toBe(0)
    expect(readLayerColorAt(document, layer, 256, 256)).toEqual(original)
    expect(readLayerColorAt(document, layer, 511, 511).a).toBe(0)
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

  it('intersects canvas, selection, and paint-region bounds before applying their masks', () => {
    const document = createDocument('gradient bounds', 5, 3, 'rgba')
    const layer = getActiveLayer(document)
    const selectionMask = new Uint8Array(15)
    selectionMask[3] = 1
    selectionMask[9] = 1
    const paintMask = new Uint8Array(12)
    paintMask[4] = 1
    paintMask[9] = 1

    const edit = applyGradient(
      document,
      layer,
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      red,
      blue,
      { x: -1, y: 0, width: 5, height: 3, mask: selectionMask },
      'none',
      { x: 2, y: -1, width: 4, height: 3, mask: paintMask }
    )

    expect(Array.from(edit!.before.keys())).toEqual([2, 8])
    expect(readLayerColorAt(document, layer, 2, 0)).toEqual({ r: 128, g: 0, b: 128, a: 255 })
    expect(readLayerColorAt(document, layer, 3, 1)).toEqual({ r: 64, g: 0, b: 191, a: 255 })
    expect(readLayerColorAt(document, layer, 3, 0).a).toBe(0)
    expect(readLayerColorAt(document, layer, 2, 1).a).toBe(0)
  })

  it('returns without allocating an edit when selection and paint region do not intersect', () => {
    const document = createDocument('empty gradient intersection', 4000, 4000, 'rgba')
    const layer = getActiveLayer(document)

    const edit = applyGradient(
      document,
      layer,
      { x: 0, y: 0 },
      { x: 3999, y: 0 },
      red,
      blue,
      { x: 0, y: 0, width: 1000, height: 1000 },
      'none',
      { x: 3000, y: 3000, width: 1000, height: 1000 }
    )

    expect(edit).toBeNull()
    expect(readLayerColorAt(document, layer, 0, 0).a).toBe(0)
    expect(readLayerColorAt(document, layer, 3999, 3999).a).toBe(0)
  })

  it('maps indexed gradients to the existing palette without inserting colors', () => {
    const document = createDocument('indexed gradient', 3, 1, 'indexed')
    const layer = getActiveLayer(document)
    const startColor = { r: 200, g: 10, b: 20, a: 255 }
    const endColor = { r: 20, g: 30, b: 220, a: 255 }
    const originalPalette = document.palette.map((entry) => ({ ...entry, color: { ...entry.color } }))

    applyGradient(document, layer, { x: 0, y: 0 }, { x: 2, y: 0 }, startColor, endColor)

    expect([0, 1, 2].map((x) => readLayerColorAt(document, layer, x, 0))).toEqual([
      { r: 24, g: 27, b: 33, a: 255 },
      { r: 24, g: 27, b: 33, a: 255 },
      { r: 41, g: 121, b: 255, a: 255 }
    ])
    expect(document.palette).toEqual(originalPalette)
  })
})
