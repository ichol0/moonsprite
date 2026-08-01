import { describe, expect, it } from 'vitest'
import { CanvasInputState, clampCanvasZoom, constrainedTranslation, resizeSelectionBounds, shapeBounds, steppedCanvasZoom, type CanvasDragState } from './canvas-input'

const drag = (): CanvasDragState => ({ kind: 'move-content', start: { x: 0, y: 0 }, last: { x: 0, y: 0 } })

describe('canvas input helpers', () => {
  it('keeps zoom levels within the supported range', () => {
    expect(clampCanvasZoom(100)).toBe(64)
    expect(steppedCanvasZoom(1, true)).toBe(1.25)
    expect(steppedCanvasZoom(0.0625, false)).toBe(0.0625)
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
