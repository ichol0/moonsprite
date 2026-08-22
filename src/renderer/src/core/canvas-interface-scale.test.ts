import { describe, expect, it } from 'vitest'
import { canvasBackingRatioForInterfaceScale, canvasClientDeltaForInterfaceScale, canvasViewportPointForInterfaceScale, canvasViewportPointToCss, canvasViewportSizeForInterfaceScale } from './canvas-interface-scale'

describe('canvas interface scale compensation', () => {
  it('keeps the canvas viewport in physical-pixel logical units', () => {
    expect(canvasViewportSizeForInterfaceScale(800, 600, 1.5)).toEqual({ width: 1200, height: 900 })
    expect(canvasViewportPointForInterfaceScale(410, 320, 10, 20, 1.5)).toEqual({ x: 600, y: 450 })
    expect(canvasViewportPointToCss({ x: 600, y: 450 }, 1.5)).toEqual({ x: 400, y: 300 })
    expect(canvasClientDeltaForInterfaceScale(40, 1.5)).toBe(60)
  })

  it('removes interface zoom from the canvas backing ratio', () => {
    expect(canvasBackingRatioForInterfaceScale(1.5, 1.5)).toBe(1)
    expect(canvasBackingRatioForInterfaceScale(3, 1.5)).toBe(2)
  })
})
