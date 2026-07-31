import { describe, expect, it } from 'vitest'
import { applyWheelOuterOutline, closestTriangleWeights, MOON_RING_HUE_ROTATION, moonRingDragZone, parseColorHex, quantizedCellCenter, quantizedWheelVector, quantizeTriangleWeights, triangleHsvAtHue, triangleWeightsAt, triangleWeightsFromColor, triangleWeightsToColor, wheelCellIsInside } from './ColorPicker'

describe('color value input', () => {
  it('accepts six-digit HEX while keeping the current alpha', () => {
    expect(parseColorHex('#2979FF', 128)).toEqual({ r: 41, g: 121, b: 255, a: 128 })
  })

  it('accepts eight-digit RGBA HEX', () => {
    expect(parseColorHex('65556180', 255)).toEqual({ r: 101, g: 85, b: 97, a: 128 })
  })

  it('rejects incomplete values', () => {
    expect(parseColorHex('#1234', 255)).toBeNull()
  })
})

describe('HSL triangle coordinates', () => {
  const vertices = {
    tip: { x: 1, y: 0.5 },
    white: { x: 0, y: 0 },
    black: { x: 0, y: 1 }
  }

  it('maps triangle vertices to pure hue, white, and black', () => {
    expect(triangleWeightsToColor(0, triangleWeightsAt(vertices, 1, 0.5)!)).toEqual({ r: 255, g: 0, b: 0, a: 255 })
    expect(triangleWeightsToColor(0, triangleWeightsAt(vertices, 0, 0)!)).toEqual({ r: 255, g: 255, b: 255, a: 255 })
    expect(triangleWeightsToColor(0, triangleWeightsAt(vertices, 0, 1)!)).toEqual({ r: 0, g: 0, b: 0, a: 255 })
  })

  it('round-trips represented colors to the same barycentric position', () => {
    const weights = { tip: 0.5, white: 0.25, black: 0.25 }
    const restored = triangleWeightsFromColor(triangleWeightsToColor(210, weights))
    expect(restored.tip).toBeCloseTo(weights.tip, 2)
    expect(restored.white).toBeCloseTo(weights.white, 2)
    expect(restored.black).toBeCloseTo(weights.black, 2)
  })

  it('snaps all weights to a lattice whose coordinates still sum to one', () => {
    const snapped = quantizeTriangleWeights({ tip: 0.31, white: 0.21, black: 0.48 }, 5)
    expect(snapped).toEqual({ tip: 0.25, white: 0.25, black: 0.5 })
    expect(snapped.tip + snapped.white + snapped.black).toBe(1)
  })

  it('rejects points outside the triangle', () => {
    expect(triangleWeightsAt(vertices, 0.8, 0)).toBeNull()
  })

  it('projects pointer positions outside the triangle onto the nearest edge', () => {
    const weights = closestTriangleWeights(vertices, 0.8, 0)
    expect(weights.tip + weights.white + weights.black).toBeCloseTo(1)
    expect(weights.black).toBe(0)
  })

  it('keeps the selected hue on the achromatic triangle edge', () => {
    expect(triangleHsvAtHue(240, { tip: 0, white: 1, black: 0 }).h).toBe(240)
    expect(triangleHsvAtHue(240, { tip: 0, white: 0, black: 1 }).h).toBe(240)
  })

  it('places bright warm yellow at the top of the moon ring', () => {
    expect((-90 + MOON_RING_HUE_ROTATION + 360) % 360).toBe(60)
  })

  it('keeps triangle vertices in the field instead of treating them as ring input', () => {
    expect(moonRingDragZone(0.828, 0.84)).toBe('sv')
    expect(moonRingDragZone(0.84, 0.84)).toBe('hue')
  })
})

describe('quantized picker positions', () => {
  it('centers the cursor in the selected color cell', () => {
    expect(quantizedCellCenter(0, 5)).toBeCloseTo(0.1)
    expect(quantizedCellCenter(0.51, 5)).toBeCloseTo(0.5)
    expect(quantizedCellCenter(1, 5)).toBeCloseTo(0.9)
  })

  it('keeps exact positions in continuous mode', () => {
    expect(quantizedCellCenter(0.37, 0)).toBeCloseTo(0.37)
  })

  it('keeps quantized wheel points inside the circular field', () => {
    const point = quantizedWheelVector(1, 1, 15, 0.98)
    expect(Math.hypot(point.dx, point.dy)).toBeLessThanOrEqual(0.98)
    expect(quantizedWheelVector(1, 0, 5).dx).toBeCloseTo(0.8)
  })

  it('draws a non-selectable outer outline from the quantized wheel mask', () => {
    const pixels = new Uint8ClampedArray(5 * 5 * 4)
    const mask = new Uint8Array(5 * 5)
    mask[2 * 5 + 2] = 1
    pixels.set([12, 20, 32, 255], (2 * 5 + 2) * 4)

    applyWheelOuterOutline(pixels, mask, 5, 5)

    expect(Array.from(pixels.slice((1 * 5 + 1) * 4, (1 * 5 + 1) * 4 + 4))).toEqual([224, 224, 224, 255])
    expect(mask[1 * 5 + 1]).toBe(0)
    expect(pixels[(0 * 5 + 0) * 4 + 3]).toBe(0)
    expect(Array.from(pixels.slice((2 * 5 + 2) * 4, (2 * 5 + 2) * 4 + 4))).toEqual([12, 20, 32, 255])
  })

  it('keeps an entire quantized boundary cell instead of clipping it with a smooth circle', () => {
    expect(Math.hypot(0.35, -0.99)).toBeGreaterThan(1)
    expect(wheelCellIsInside(0.35, -0.99, 5)).toBe(true)
    expect(wheelCellIsInside(0.35, -0.99, 0)).toBe(false)
  })
})
