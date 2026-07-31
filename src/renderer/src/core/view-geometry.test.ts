import { describe, expect, it } from 'vitest'
import { rotationIndicatorFitsCanvas, viewPanDeltaFromScreen, viewRotationPivot } from './view-geometry'

describe('view rotation geometry', () => {
  it('uses the viewport center for a view-centered rotation indicator', () => {
    expect(viewRotationPivot(800, 600, 120, -45, 'view')).toEqual({ x: 400, y: 300 })
  })

  it('uses the panned canvas center for a canvas-centered rotation indicator', () => {
    expect(viewRotationPivot(800, 600, 120, -45, 'canvas')).toEqual({ x: 520, y: 255 })
  })

  it('converts screen dragging into scene panning around a fixed view center', () => {
    const delta = viewPanDeltaFromScreen(10, 0, 90, 'view')
    expect(delta.x).toBeCloseTo(0)
    expect(delta.y).toBeCloseTo(-10)
  })

  it('keeps canvas-centered panning in screen coordinates', () => {
    expect(viewPanDeltaFromScreen(10, -4, 90, 'canvas')).toEqual({ x: 10, y: -4 })
  })

  it('hides the rotation indicator when zoom makes it approach the canvas size', () => {
    expect(rotationIndicatorFitsCanvas(64, 64, 4)).toBe(false)
    expect(rotationIndicatorFitsCanvas(64, 64, 5)).toBe(true)
  })

  it('hides the rotation indicator when either canvas dimension is too small', () => {
    expect(rotationIndicatorFitsCanvas(512, 32, 8)).toBe(false)
    expect(rotationIndicatorFitsCanvas(512, 64, 8)).toBe(true)
  })
})
