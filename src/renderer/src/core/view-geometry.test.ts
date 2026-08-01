import { describe, expect, it } from 'vitest'
import { documentPointFromViewportPoint, rotationIndicatorFitsCanvas, unrotatedViewportBounds, viewCanvasOrigin, viewPanDeltaFromScreen, viewRotationPivot, zoomViewAroundViewportPoint } from './view-geometry'

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

  it('maps viewport points to document pixels through rotation and pan', () => {
    const view = { zoom: 2, panX: 10, panY: -4, rotation: 90 }
    const origin = viewCanvasOrigin(800, 600, 100, 50, view)
    const pivot = viewRotationPivot(800, 600, view.panX, view.panY, 'view')
    const point = { x: pivot.x, y: pivot.y }
    expect(documentPointFromViewportPoint(point, 800, 600, 100, 50, view, 'view')).toEqual({ x: 45, y: 27 })
    const bounds = unrotatedViewportBounds(800, 600, view, 'view')
    expect(bounds.left).toBeCloseTo(100)
    expect(bounds.top).toBeCloseTo(-100)
    expect(bounds.right).toBeCloseTo(700)
    expect(bounds.bottom).toBeCloseTo(700)
    expect(origin).toEqual({ x: 310, y: 246 })
  })

  it('keeps the document pixel under the pointer when zooming', () => {
    const view = { zoom: 2, panX: 0, panY: 0, rotation: 0 }
    const next = zoomViewAroundViewportPoint(view, 4, { x: 450, y: 300 }, 800, 600, 100, 50, 'view')
    expect(documentPointFromViewportPoint({ x: 450, y: 300 }, 800, 600, 100, 50, next, 'view')).toEqual({ x: 75, y: 25 })
  })
})
