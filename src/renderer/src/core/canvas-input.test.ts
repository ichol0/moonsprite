import { describe, expect, it } from 'vitest'
import { CanvasInputState, clampCanvasZoom, constrainedTranslation, resizeSelectionBounds, rotationHandles, selectionResizeHit, selectionRotationHit, shapeBounds, steppedCanvasZoom, zoomDragTarget, type CanvasDragState } from './canvas-input'

const drag = (): CanvasDragState => ({ kind: 'move-content', start: { x: 0, y: 0 }, last: { x: 0, y: 0 } })

describe('canvas input helpers', () => {
  it('keeps zoom levels within the supported range', () => {
    expect(clampCanvasZoom(100)).toBe(64)
    expect(steppedCanvasZoom(1, true)).toBe(1.25)
    expect(steppedCanvasZoom(0.0625, false)).toBe(0.0625)
  })

  it('supports smooth and stepped zoom-tool drag preferences', () => {
    expect(zoomDragTarget(1, 96, 'smooth')).toBe(2)
    expect(zoomDragTarget(1, 48, 'stepped')).toBe(1.5)
    expect(zoomDragTarget(1, -48, 'stepped')).toBe(0.5)
  })

  it('keeps invisible rotation handles outside the visible resize handles', () => {
    expect(rotationHandles({ x: 10, y: 20, width: 30, height: 40 })).toContainEqual(['rotate-ne', 62, -2])
  })

  it('expands rotation interaction outside the selection without stealing its interior', () => {
    const box = { x: 100, y: 100, width: 80, height: 60 }
    expect(selectionRotationHit(box, { x: 245, y: 35 })).toBe('rotate-ne')
    expect(selectionRotationHit(box, { x: 110, y: 110 })).toBeNull()
  })

  it('prioritizes resize corners and keeps edge handles out of the corner zones', () => {
    const box = { x: 100, y: 100, width: 80, height: 60 }
    expect(selectionResizeHit(box, { x: 100, y: 100 }, 8)).toBe('nw')
    expect(selectionResizeHit(box, { x: 140, y: 100 }, 8)).toBe('n')
    expect(selectionResizeHit(box, { x: 107, y: 100 }, 8)).toBe('nw')
    expect(selectionRotationHit(box, { x: 107, y: 93 }, 1)).toBeNull()
  })

  it('locks translation to the dominant axis and can switch deliberately', () => {
    const state = drag()
    expect(constrainedTranslation(state, 8, 4, true)).toEqual({ x: 8, y: 0 })
    expect(constrainedTranslation(state, 4, 8, true)).toEqual({ x: 0, y: 8 })
    expect(constrainedTranslation(state, 4, 8, false)).toEqual({ x: 4, y: 8 })
  })

  it('creates constrained square bounds in every drag direction', () => {
    expect(shapeBounds({ x: 5, y: 5 }, { x: 2, y: 3 }, true)).toEqual({ x: 2, y: 2, width: 4, height: 4 })
  })

  it('keeps proportional integer scaling inside document bounds', () => {
    expect(resizeSelectionBounds({ x: 2, y: 2, width: 2, height: 2 }, { x: 8, y: 8 }, 'se', { width: 10, height: 10 }, true, true)).toEqual({ x: 2, y: 2, width: 8, height: 8 })
  })

  it('keeps the selection unchanged while a resize handle remains on its pixel boundary', () => {
    expect(resizeSelectionBounds({ x: 2, y: 2, width: 4, height: 3 }, { x: 6, y: 3 }, 'e', { width: 12, height: 12 })).toEqual({ x: 2, y: 2, width: 4, height: 3 })
  })

  it('flips horizontally when a side handle crosses the opposite side', () => {
    expect(resizeSelectionBounds({ x: 2, y: 2, width: 4, height: 3 }, { x: 8, y: 3 }, 'w', { width: 12, height: 12 })).toEqual({ x: 6, y: 2, width: 2, height: 3, flipHorizontal: true, flipOriginX: 8 })
    expect(resizeSelectionBounds({ x: 2, y: 2, width: 4, height: 3 }, { x: 0, y: 3 }, 'e', { width: 12, height: 12 })).toEqual({ x: 0, y: 2, width: 2, height: 3, flipHorizontal: true, flipOriginX: 0 })
  })

  it('flips both axes when a corner crosses both opposite sides', () => {
    expect(resizeSelectionBounds({ x: 2, y: 2, width: 4, height: 3 }, { x: 8, y: 7 }, 'nw', { width: 12, height: 12 })).toEqual({ x: 6, y: 5, width: 2, height: 2, flipHorizontal: true, flipVertical: true, flipOriginX: 8, flipOriginY: 7 })
  })

  it('finishes a gesture exactly once and clears transient pointer interaction state', () => {
    const input = new CanvasInputState()
    const active = drag()
    input.begin(active)
    input.sampling = true
    input.shiftLinePreview = true
    input.modifierBrushSize = { x: 1, y: 2, size: 3 }

    expect(input.finish()).toBe(active)
    expect(input.finish()).toBeNull()
    input.resetPointerInteraction()
    expect(input.sampling).toBe(false)
    expect(input.shiftLinePreview).toBe(false)
    expect(input.modifierBrushSize).toBeNull()
  })
})
