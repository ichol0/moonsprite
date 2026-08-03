import { describe, expect, it } from 'vitest'
import type { ViewState } from '@shared/types'
import { createCanvasRenderPlan, deviceAlignedPixelRect } from './canvas-render-plan'

const view = (overrides: Partial<ViewState> = {}): ViewState => ({
  zoom: 4,
  panX: 0,
  panY: 0,
  rotation: 0,
  mirrored: false,
  mirroredVertical: false,
  showGrid: false,
  relativeLuminance: false,
  ...overrides
})

describe('createCanvasRenderPlan', () => {
  it('shares device-pixel boundaries between adjacent preview pixels', () => {
    const first = deviceAlignedPixelRect(10.2, 12.4, 3.13, 0, 0, 1.5)
    const second = deviceAlignedPixelRect(10.2, 12.4, 3.13, 1, 0, 1.5)
    expect(first.x + first.width).toBe(second.x)
    expect(first.x * 1.5).toBe(Math.round(first.x * 1.5))
    expect(second.x * 1.5).toBe(Math.round(second.x * 1.5))
  })

  it('computes the visible document rectangle for an unrotated view', () => {
    const plan = createCanvasRenderPlan(320, 240, { width: 128, height: 128 }, view(), 'view')
    expect(plan.rotated).toBe(false)
    expect(plan.originX).toBe(-96)
    expect(plan.originY).toBe(-136)
    expect({ x: plan.fromX, y: plan.fromY, right: plan.toX, bottom: plan.toY }).toEqual({ x: 24, y: 34, right: 104, bottom: 94 })
  })

  it('expands the scene for a rotated view while keeping visible pixels clamped', () => {
    const plan = createCanvasRenderPlan(320, 240, { width: 128, height: 128 }, view({ rotation: 45 }), 'view')
    expect(plan.rotated).toBe(true)
    expect(plan.sceneWidth).toBeGreaterThan(320)
    expect(plan.sceneHeight).toBeGreaterThan(240)
    expect(plan.fromX).toBeGreaterThanOrEqual(0)
    expect(plan.fromY).toBeGreaterThanOrEqual(0)
    expect(plan.toX).toBeLessThanOrEqual(128)
    expect(plan.toY).toBeLessThanOrEqual(128)
  })

  it('covers a mirrored viewport around a panned canvas pivot without clipping edges', () => {
    const plan = createCanvasRenderPlan(320, 240, { width: 128, height: 128 }, view({ panX: 80, panY: -30, mirrored: true, mirroredVertical: true }), 'canvas')
    expect(plan.rotated).toBe(true)
    expect(plan.viewport).toEqual({ left: 160, top: -60, right: 480, bottom: 180 })
    expect(plan.sceneLeft).toBeLessThanOrEqual(plan.viewport.left)
    expect(plan.sceneTop).toBeLessThanOrEqual(plan.viewport.top)
    expect(plan.sceneLeft + plan.sceneWidth).toBeGreaterThanOrEqual(plan.viewport.right)
    expect(plan.sceneTop + plan.sceneHeight).toBeGreaterThanOrEqual(plan.viewport.bottom)
  })
})
