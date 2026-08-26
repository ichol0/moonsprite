import { describe, expect, it } from 'vitest'
import { clampCanvasViewPan, displayedCanvasCenter, documentPointFromViewportPoint, documentPointFromViewportPointContinuous, rotateViewAroundViewportPoint, rotationIndicatorFitsCanvas, rotationIndicatorPointBetweenPointerAndCanvasCenter, unrotatedViewportBounds, viewCanvasOrigin, viewPanDeltaFromScreen, viewRotationPivot, zoomViewAroundViewportPoint } from './view-geometry'

describe('view rotation geometry', () => {
  it('uses the viewport center for a view-centered rotation indicator', () => {
    expect(viewRotationPivot(800, 600, 120, -45, 'view')).toEqual({ x: 400, y: 300 })
  })

  it('uses the panned canvas center for a canvas-centered rotation indicator', () => {
    expect(viewRotationPivot(800, 600, 120, -45, 'canvas')).toEqual({ x: 520, y: 255 })
  })

  it('places the rotation indicator midway between the click and displayed canvas center', () => {
    const canvasCenter = { x: 440, y: 260 }
    expect(rotationIndicatorPointBetweenPointerAndCanvasCenter(800, 600, { x: 600, y: 400 }, canvasCenter)).toEqual({ x: 520, y: 330 })
    expect(rotationIndicatorPointBetweenPointerAndCanvasCenter(800, 600, { x: 20, y: 20 }, { x: 40, y: 40 })).toEqual({ x: 64, y: 96 })
  })

  it('tracks the displayed canvas center through pan, mirror, and rotation', () => {
    expect(displayedCanvasCenter(800, 600, { zoom: 2, panX: 80, panY: 0, rotation: 90 }, 'view')).toEqual({ x: 400, y: 380 })
    expect(displayedCanvasCenter(800, 600, { zoom: 2, panX: 80, panY: 0, rotation: 90, mirrored: true }, 'view')).toEqual({ x: 400, y: 220 })
  })

  it('keeps the document point beneath a nearby rotation indicator fixed', () => {
    const view = { zoom: 2, panX: 36, panY: -18, rotation: 15, mirrored: true, mirroredVertical: false }
    const indicator = { x: 244, y: 188 }
    const before = documentPointFromViewportPointContinuous(indicator, 800, 600, 128, 96, view, 'view')
    const rotated = rotateViewAroundViewportPoint(view, 105, indicator, 800, 600, 'view')
    const after = documentPointFromViewportPointContinuous(indicator, 800, 600, 128, 96, rotated, 'view')
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
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

  it('preserves subpixel document coordinates for symmetric interaction hit testing', () => {
    const view = { zoom: 8, panX: 0, panY: 0, rotation: 0 }
    expect(documentPointFromViewportPointContinuous({ x: 403, y: 297 }, 800, 600, 100, 50, view, 'view')).toEqual({ x: 50.375, y: 24.625 })
  })

  it('includes mirrored viewport bounds around an off-center canvas pivot', () => {
    const view = { zoom: 4, panX: 80, panY: -30, rotation: 0, mirrored: true, mirroredVertical: true }
    expect(unrotatedViewportBounds(320, 240, view, 'canvas')).toEqual({ left: 160, top: -60, right: 480, bottom: 180 })
  })

  it('keeps the document pixel under the pointer when zooming', () => {
    const view = { zoom: 2, panX: 0, panY: 0, rotation: 0 }
    const next = zoomViewAroundViewportPoint(view, 4, { x: 450, y: 300 }, 800, 600, 100, 50, 'view')
    expect(documentPointFromViewportPoint({ x: 450, y: 300 }, 800, 600, 100, 50, next, 'view')).toEqual({ x: 75, y: 25 })
  })

  it('maps input through the inverse horizontal mirror while keeping the visual zoom anchor', () => {
    const view = { zoom: 2, panX: 0, panY: 0, rotation: 0, mirrored: true }
    expect(documentPointFromViewportPoint({ x: 450, y: 300 }, 800, 600, 100, 50, view, 'view')).toEqual({ x: 25, y: 25 })
    const next = zoomViewAroundViewportPoint(view, 4, { x: 450, y: 300 }, 800, 600, 100, 50, 'view')
    expect(documentPointFromViewportPoint({ x: 450, y: 300 }, 800, 600, 100, 50, next, 'view')).toEqual({ x: 25, y: 25 })
  })

  it('maps input through horizontal and vertical mirrors after inverse rotation', () => {
    const view = { zoom: 2, panX: 0, panY: 0, rotation: 0, mirrored: true, mirroredVertical: true }
    expect(documentPointFromViewportPoint({ x: 450, y: 320 }, 800, 600, 100, 50, view, 'view')).toEqual({ x: 25, y: 15 })
    expect(viewPanDeltaFromScreen(10, 4, 0, 'view', true, true)).toEqual({ x: -10, y: -4 })
    const rotated = viewPanDeltaFromScreen(10, 0, 90, 'view', true, true)
    expect(rotated.x).toBeCloseTo(0)
    expect(rotated.y).toBeCloseTo(10)
  })

  it('maps a vertical mirror independently from the horizontal mirror', () => {
    const view = { zoom: 2, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: true }
    expect(documentPointFromViewportPoint({ x: 450, y: 320 }, 800, 600, 100, 50, view, 'view')).toEqual({ x: 75, y: 15 })
    expect(viewPanDeltaFromScreen(10, 4, 0, 'view', false, true)).toEqual({ x: 10, y: -4 })
  })

  it('keeps an off-center document pixel under the pointer while zooming a mirrored view', () => {
    const view = { zoom: 2, panX: 0, panY: 0, rotation: 0, mirrored: true, mirroredVertical: true }
    const point = { x: 525, y: 365 }
    const before = documentPointFromViewportPoint(point, 800, 600, 100, 50, view, 'view')
    const next = zoomViewAroundViewportPoint(view, 4, point, 800, 600, 100, 50, 'view')
    expect(documentPointFromViewportPoint(point, 800, 600, 100, 50, next, 'view')).toEqual(before)
  })

  it('keeps an off-center document pixel under the pointer for canvas-centered mirrored zoom', () => {
    const view = { zoom: 2, panX: 60, panY: -30, rotation: 25, mirrored: true, mirroredVertical: false }
    const point = { x: 515, y: 340 }
    const before = documentPointFromViewportPoint(point, 800, 600, 100, 50, view, 'canvas')
    const next = zoomViewAroundViewportPoint(view, 4, point, 800, 600, 100, 50, 'canvas')
    expect(documentPointFromViewportPoint(point, 800, 600, 100, 50, next, 'canvas')).toEqual(before)
  })

  it('allows half of a small canvas to move outside the viewport', () => {
    expect(clampCanvasViewPan(800, 600, 64, 64, { zoom: 1, panX: 1000, panY: -1000, rotation: 0 }, 'view')).toEqual({ zoom: 1, panX: 400, panY: -300, rotation: 0 })
  })

  it('allows a large canvas edge to move to the viewport center', () => {
    expect(clampCanvasViewPan(800, 600, 200, 160, { zoom: 5, panX: 1000, panY: -1000, rotation: 0 }, 'view')).toEqual({ zoom: 5, panX: 500, panY: -400, rotation: 0 })
  })

  it('uses the same half-boundary rule at high zoom', () => {
    expect(clampCanvasViewPan(800, 600, 200, 160, { zoom: 8, panX: 1000, panY: -1000, rotation: 0 }, 'view')).toEqual({ zoom: 8, panX: 800, panY: -640, rotation: 0 })
    expect(clampCanvasViewPan(800, 600, 4, 4, { zoom: 8, panX: 1000, panY: 1000, rotation: 0 }, 'view')).toEqual({ zoom: 8, panX: 400, panY: 300, rotation: 0 })
  })

  it('keeps the half-boundary rule at the maximum zoom', () => {
    expect(clampCanvasViewPan(800, 600, 20, 20, { zoom: 64, panX: 1000, panY: -1000, rotation: 0 }, 'view')).toEqual({ zoom: 64, panX: 640, panY: -640, rotation: 0 })
    expect(clampCanvasViewPan(800, 600, 4, 4, { zoom: 64, panX: 1000, panY: 1000, rotation: 0 }, 'view')).toEqual({ zoom: 64, panX: 400, panY: 300, rotation: 0 })
  })

  it('clamps the displayed bounds of a rotated canvas', () => {
    const next = clampCanvasViewPan(300, 300, 100, 50, { zoom: 2, panX: 1000, panY: 0, rotation: 90 }, 'view')
    expect(next.panX).toBeCloseTo(150)
    expect(next.panY).toBeCloseTo(0)
  })

  it('uses oversized floating content bounds while zooming and panning a small canvas', () => {
    const floatingBounds = { x: 0, y: 0, width: 200, height: 100 }
    for (const zoom of [2, 4]) {
      const centered = { zoom, panX: -90 * zoom, panY: -40 * zoom, rotation: 0 }
      expect(clampCanvasViewPan(300, 200, 20, 20, centered, 'view', floatingBounds)).toEqual(centered)
    }

    const edge = clampCanvasViewPan(300, 200, 20, 20, { zoom: 2, panX: 1000, panY: -1000, rotation: 0 }, 'view', floatingBounds)
    expect(edge.panX).toBeCloseTo(20)
    expect(edge.panY).toBeCloseTo(-180)
  })

  it('keeps offset floating content navigable through rotation, mirror, and either rotation pivot', () => {
    const floatingBounds = { x: -80, y: 0, width: 200, height: 50 }
    const viewCentered = { zoom: 8, panX: -80, panY: -160, rotation: 90, mirrored: true }
    expect(clampCanvasViewPan(300, 300, 20, 10, viewCentered, 'view', floatingBounds)).toEqual(viewCentered)

    const canvasCentered = { zoom: 8, panX: 160, panY: 80, rotation: 90, mirrored: true }
    expect(clampCanvasViewPan(300, 300, 20, 10, canvasCentered, 'canvas', floatingBounds)).toEqual(canvasCentered)
  })
})
