import { describe, expect, it } from 'vitest'
import { CanvasInputState, SELECTION_CORNER_RESIZE_HIT_RADIUS, SELECTION_RESIZE_HIT_RADIUS, clampCanvasZoom, constrainedTranslation, resizeSelectionBounds, rotationHandles, selectionInteractionHit, selectionResizeHit, selectionRotationHit, selectionTransformModifiers, shapeBounds, shouldStartCanvasPan, snapSelectionRotation, steppedCanvasZoom, zoomDragModeForModifiers, zoomDragTarget, type CanvasDragState } from './canvas-input'

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

  it('keeps Shift zoom drags out of pan and temporarily uses stepped zoom', () => {
    expect(shouldStartCanvasPan('zoom', true, false)).toBe(false)
    expect(shouldStartCanvasPan('hand', true, false)).toBe(true)
    expect(zoomDragModeForModifiers('smooth', true)).toBe('stepped')
    expect(zoomDragModeForModifiers('smooth', false)).toBe('smooth')
  })

  it('keeps invisible rotation handles outside the visible resize handles', () => {
    expect(rotationHandles({ x: 10, y: 20, width: 30, height: 40 })).toContainEqual(['rotate-ne', 62, -2])
  })

  it('keeps rotation interaction close to the selection without stealing its interior', () => {
    const box = { x: 100, y: 100, width: 80, height: 60 }
    expect(selectionRotationHit(box, { x: 202, y: 78 })).toBe('rotate-ne')
    expect(selectionRotationHit(box, { x: 245, y: 35 })).toBeNull()
    expect(selectionRotationHit(box, { x: 110, y: 110 })).toBeNull()
  })

  it('prioritizes resize corners and keeps edge handles out of the corner zones', () => {
    const box = { x: 100, y: 100, width: 80, height: 60 }
    expect(selectionResizeHit(box, { x: 100, y: 100 }, 8)).toBe('nw')
    expect(selectionResizeHit(box, { x: 140, y: 100 }, 8)).toBe('n')
    expect(selectionResizeHit(box, { x: 107, y: 100 }, 8)).toBe('nw')
    expect(selectionRotationHit(box, { x: 107, y: 93 }, 1)).toBeNull()
  })

  it('keeps resize handles comfortable and rotation continuous around every corner', () => {
    const box = { x: 100, y: 100, width: 80, height: 60 }
    expect(SELECTION_RESIZE_HIT_RADIUS).toBe(12)
    expect(selectionResizeHit(box, { x: 111, y: 111 }, SELECTION_RESIZE_HIT_RADIUS)).toBe('nw')
    expect(selectionRotationHit(box, { x: 80, y: 80 })).toBe('rotate-nw')
    expect(selectionRotationHit(box, { x: 200, y: 80 })).toBe('rotate-ne')
    expect(selectionRotationHit(box, { x: 200, y: 180 })).toBe('rotate-se')
    expect(selectionRotationHit(box, { x: 80, y: 180 })).toBe('rotate-sw')
  })

  it('keeps the larger corner resize hit area toward the selection edges', () => {
    const selection = { x: 100, y: 100, width: 80, height: 60 }
    expect(SELECTION_CORNER_RESIZE_HIT_RADIUS).toBeGreaterThan(SELECTION_RESIZE_HIT_RADIUS)
    expect(selectionInteractionHit(selection, { x: 83, y: 103 }, 1)).toBe('nw')
    expect(selectionInteractionHit(selection, { x: 197, y: 103 }, 1)).toBe('ne')
    expect(selectionInteractionHit(selection, { x: 197, y: 157 }, 1)).toBe('se')
    expect(selectionInteractionHit(selection, { x: 83, y: 157 }, 1)).toBe('sw')
  })

  it('limits diagonal resize to the visible handle edge in each outer corner quadrant', () => {
    const selection = { x: 100, y: 100, width: 80, height: 60 }
    expect(selectionInteractionHit(selection, { x: 95, y: 95 }, 1)).toBe('nw')
    expect(selectionInteractionHit(selection, { x: 94, y: 94 }, 1)).toBe('rotate-nw')
    expect(selectionInteractionHit(selection, { x: 185, y: 95 }, 1)).toBe('ne')
    expect(selectionInteractionHit(selection, { x: 186, y: 94 }, 1)).toBe('rotate-ne')
    expect(selectionInteractionHit(selection, { x: 185, y: 165 }, 1)).toBe('se')
    expect(selectionInteractionHit(selection, { x: 186, y: 166 }, 1)).toBe('rotate-se')
    expect(selectionInteractionHit(selection, { x: 95, y: 165 }, 1)).toBe('sw')
    expect(selectionInteractionHit(selection, { x: 94, y: 166 }, 1)).toBe('rotate-sw')
    expect(selectionInteractionHit(selection, { x: 180 + 5 / 16, y: 100 - 5 / 16 }, 16)).toBe('ne')
    expect(selectionInteractionHit(selection, { x: 180 + 6 / 16, y: 100 - 6 / 16 }, 16)).toBe('rotate-ne')
    expect(selectionInteractionHit(selection, { x: 180 + 28 / 16, y: 100 - 28 / 16 }, 16)).toBe('rotate-ne')
    expect(selectionInteractionHit(selection, { x: 180 + 29 / 16, y: 100 - 29 / 16 }, 16)).toBe('outside')
  })

  it('keeps a compact rotation ring around each diagonal resize handle', () => {
    const selection = { x: 100, y: 100, width: 80, height: 60 }
    const corners = [
      { handle: 'rotate-nw', x: 100, y: 100, directionX: -1, directionY: -1 },
      { handle: 'rotate-ne', x: 180, y: 100, directionX: 1, directionY: -1 },
      { handle: 'rotate-se', x: 180, y: 160, directionX: 1, directionY: 1 },
      { handle: 'rotate-sw', x: 100, y: 160, directionX: -1, directionY: 1 }
    ] as const
    for (const corner of corners) {
      for (const distance of [6, 12, 20, 28]) {
        expect(selectionInteractionHit(selection, {
          x: corner.x + corner.directionX * distance,
          y: corner.y + corner.directionY * distance
        }, 1)).toBe(corner.handle)
      }
      expect(selectionInteractionHit(selection, {
        x: corner.x + corner.directionX * 29,
        y: corner.y + corner.directionY * 29
      }, 1)).toBe('outside')
      expect(selectionInteractionHit(selection, {
        x: corner.x + corner.directionX * 140,
        y: corner.y + corner.directionY * 24
      }, 1)).toBe('outside')
      expect(selectionInteractionHit(selection, {
        x: corner.x + corner.directionX * 7,
        y: corner.y + corner.directionY * 7
      }, 4)).toBe(corner.handle)
      expect(selectionInteractionHit(selection, {
        x: corner.x + corner.directionX * 7.25,
        y: corner.y + corner.directionY * 7.25
      }, 4)).toBe('outside')
    }
  })

  it('enters corner rotation immediately after diagonal resize even beside an edge band', () => {
    const selection = { x: 100, y: 100, width: 160, height: 120 }
    expect(selectionInteractionHit(selection, { x: 124, y: 95 }, 1)).toBe('rotate-nw')
    expect(selectionInteractionHit(selection, { x: 236, y: 95 }, 1)).toBe('rotate-ne')
    expect(selectionInteractionHit(selection, { x: 265, y: 124 }, 1)).toBe('rotate-ne')
    expect(selectionInteractionHit(selection, { x: 265, y: 196 }, 1)).toBe('rotate-se')
    expect(selectionInteractionHit(selection, { x: 236, y: 225 }, 1)).toBe('rotate-se')
    expect(selectionInteractionHit(selection, { x: 124, y: 225 }, 1)).toBe('rotate-sw')
    expect(selectionInteractionHit(selection, { x: 95, y: 196 }, 1)).toBe('rotate-sw')
    expect(selectionInteractionHit(selection, { x: 95, y: 124 }, 1)).toBe('rotate-nw')
  })

  it('keeps selection handle hit ranges symmetric around every visual boundary', () => {
    const selection = { x: 10, y: 20, width: 40, height: 30 }
    const zoom = 8
    expect(selectionInteractionHit(selection, { x: 8.51, y: 35 }, zoom)).toBe('w')
    expect(selectionInteractionHit(selection, { x: 11.49, y: 35 }, zoom)).toBe('w')
    expect(selectionInteractionHit(selection, { x: 48.51, y: 35 }, zoom)).toBe('e')
    expect(selectionInteractionHit(selection, { x: 51.49, y: 35 }, zoom)).toBe('e')
    expect(selectionInteractionHit(selection, { x: 30, y: 18.51 }, zoom)).toBe('n')
    expect(selectionInteractionHit(selection, { x: 30, y: 51.49 }, zoom)).toBe('s')
  })

  it('reserves the edge band for moving the selection before entering corner rotation', () => {
    const selection = { x: 100, y: 100, width: 160, height: 120 }
    expect(selectionInteractionHit(selection, { x: 155, y: 95 }, 1)).toBe('edge')
    expect(selectionInteractionHit(selection, { x: 155, y: 90 }, 1)).toBe('outside')
    expect(selectionInteractionHit(selection, { x: 205, y: 225 }, 1)).toBe('edge')
    expect(selectionInteractionHit(selection, { x: 245, y: 239 }, 1)).toBe('rotate-se')
  })

  it('uses Shift for proportional transform and Ctrl for integer scaling without copying', () => {
    expect(selectionTransformModifiers({ ctrlKey: true, shiftKey: false })).toEqual({ proportional: false, integerScale: true, copy: false })
    expect(selectionTransformModifiers({ ctrlKey: true, shiftKey: true })).toEqual({ proportional: true, integerScale: true, copy: false })
    expect(selectionTransformModifiers({ ctrlKey: false, shiftKey: true })).toEqual({ proportional: true, integerScale: false, copy: false })
  })

  it('snaps selection rotation to eight directions while Shift is held', () => {
    expect(snapSelectionRotation(31, false)).toBe(31)
    expect(snapSelectionRotation(31, true)).toBe(45)
    expect(snapSelectionRotation(-70, true)).toBe(-90)
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

  it('uses independent integer pixel multiples when Ctrl is held without Shift', () => {
    expect(resizeSelectionBounds({ x: 2, y: 2, width: 2, height: 3 }, { x: 8, y: 9 }, 'se', { width: 20, height: 20 }, false, true)).toEqual({ x: 2, y: 2, width: 8, height: 9 })
  })

  it('keeps the untouched axis unchanged for one-axis integer scaling', () => {
    expect(resizeSelectionBounds({ x: 2, y: 2, width: 2, height: 1 }, { x: 8, y: 2 }, 'e', { width: 20, height: 20 }, false, true)).toEqual({ x: 2, y: 2, width: 8, height: 1 })
    expect(resizeSelectionBounds({ x: 2, y: 2, width: 1, height: 2 }, { x: 2, y: 8 }, 's', { width: 20, height: 20 }, false, true)).toEqual({ x: 2, y: 2, width: 1, height: 8 })
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

  it('reconciles stale modifier state from the next pointer event', () => {
    const input = new CanvasInputState()
    input.altHeld = true
    input.ctrlHeld = true

    input.syncModifierKeys({ altKey: false, ctrlKey: false })

    expect(input.altHeld).toBe(false)
    expect(input.ctrlHeld).toBe(false)
  })
})
