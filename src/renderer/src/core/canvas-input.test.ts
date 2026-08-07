import { describe, expect, it } from 'vitest'
import { CanvasInputState, SELECTION_CORNER_RESIZE_HIT_RADIUS, SELECTION_RESIZE_HIT_RADIUS, appendPolygonLassoVertex, canvasGestureForPreview, clampCanvasZoom, constrainedTranslation, createCanvasPanDrag, finalizeMarqueeSelection, polygonLassoClosedPathPoints, polygonLassoPreviewPoints, resizeSelectionBounds, restoreCanvasDragAfterPan, rotationHandles, selectionGestureMoved, selectionInteractionHit, selectionMarqueeUsesConstraint, selectionOverlayMaskForDrag, selectionResizeHit, selectionRotationHit, selectionShapeUsesConstraint, selectionShearHit, selectionTransformModifiers, shapeBounds, shouldClosePolygonLasso, shouldRestartFloatingSelectionForCopy, shouldStartCanvasPan, snapSelectionRotation, steppedCanvasZoom, zoomDragModeForModifiers, zoomDragTarget, type CanvasDragState } from './canvas-input'
import { balancedStairLinePoints } from './pixel-line'

const drag = (): CanvasDragState => ({ kind: 'move-content', start: { x: 0, y: 0 }, last: { x: 0, y: 0 } })

describe('canvas input helpers', () => {
  it('uses the balanced stair algorithm for polygon lasso preview and closed edges when enabled', () => {
    const path = [{ x: 0, y: 0 }, { x: 8, y: 2 }, { x: 7, y: 7 }]
    expect(polygonLassoPreviewPoints(path, { x: 2, y: 8 }, false, true)).toEqual([
      ...balancedStairLinePoints(path[0], path[1]),
      ...balancedStairLinePoints(path[1], path[2]),
      ...balancedStairLinePoints(path[2], { x: 2, y: 8 })
    ])
    expect(polygonLassoClosedPathPoints(path, true)).toEqual([
      ...balancedStairLinePoints(path[0], path[1]),
      ...balancedStairLinePoints(path[1], path[2]),
      ...balancedStairLinePoints(path[2], path[0])
    ])
  })

  it('distinguishes a click from a drag inside one document pixel', () => {
    expect(selectionGestureMoved({ x: 100, y: 100 }, { x: 102, y: 103 })).toBe(false)
    expect(selectionGestureMoved({ x: 100, y: 100 }, { x: 104, y: 100 })).toBe(true)
  })

  it('treats a marquee click as deselect only in replace mode', () => {
    const before = { x: 2, y: 2, width: 3, height: 3 }
    expect(finalizeMarqueeSelection(before, before, false, 'replace')).toBeNull()
    expect(finalizeMarqueeSelection(before, before, false, 'subtract')).toEqual(before)
    expect(finalizeMarqueeSelection(null, null, false, 'replace')).toBeNull()
  })

  it('keeps the existing selection outline visible while add or subtract gestures are being created', () => {
    const before = { x: 2, y: 2, width: 3, height: 3 }
    const incoming = { x: 8, y: 8, width: 2, height: 2 }
    const drag: CanvasDragState = {
      kind: 'marquee',
      start: { x: 8, y: 8 },
      last: { x: 9, y: 9 },
      selectionStart: before,
      selectionMode: 'add',
      previewSelection: incoming
    }

    expect(selectionOverlayMaskForDrag(incoming, drag)).toEqual(before)
    expect(selectionOverlayMaskForDrag(incoming, { ...drag, selectionMode: 'subtract' })).toEqual(before)
    expect(finalizeMarqueeSelection(before, incoming, false, 'add')).toEqual(before)
  })

  it('restores an unfinished polygon lasso after a temporary canvas pan', () => {
    const polygon: CanvasDragState = {
      kind: 'polygon-lasso',
      start: { x: 1, y: 1 },
      last: { x: 8, y: 4 },
      path: [{ x: 1, y: 1 }, { x: 8, y: 1 }, { x: 8, y: 4 }],
      selectionMode: 'add',
      selectionStart: { x: 0, y: 0, width: 2, height: 2 }
    }
    const pan = createCanvasPanDrag({ x: 10, y: 20 }, { x: 200, y: 120 }, polygon)
    const restored = restoreCanvasDragAfterPan(pan, { x: 6, y: 7 })

    expect(restored).toMatchObject({
      kind: 'polygon-lasso',
      last: { x: 6, y: 7 },
      path: polygon.path,
      selectionMode: 'add',
      selectionStart: polygon.selectionStart
    })
    expect(canvasGestureForPreview(pan)).toBe(polygon)
    expect(selectionOverlayMaskForDrag(null, pan)).toEqual(polygon.selectionStart)
  })

  it('keeps polygon vertices unique and closes when the first vertex is clicked', () => {
    const path = [{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 7 }]
    expect(appendPolygonLassoVertex(path, { x: 8, y: 7 })).toEqual(path)
    expect(appendPolygonLassoVertex(path, { x: 2, y: 7 })).toEqual([...path, { x: 2, y: 7 }])
    expect(shouldClosePolygonLasso(path, { x: 2, y: 2 }, 1)).toBe(true)
    expect(shouldClosePolygonLasso(path, { x: 4, y: 6 }, 2)).toBe(true)
    expect(shouldClosePolygonLasso(path.slice(0, 2), { x: 2, y: 2 }, 2)).toBe(false)
  })

  it('connects polygon vertices with rasterized straight lines instead of rectangular elbows', () => {
    const points = polygonLassoPreviewPoints([{ x: 1, y: 1 }, { x: 4, y: 3 }], { x: 6, y: 4 }, false)
    const pixels = new Set(points.map((point) => `${point.x}:${point.y}`))
    expect(pixels).toContain('2:2')
    expect(pixels).toContain('4:3')
    expect(pixels).not.toContain('4:1')
    expect(pixels).not.toContain('1:3')
  })

  it('restarts every floating selection when Ctrl begins another copy drag', () => {
    expect(shouldRestartFloatingSelectionForCopy(false, true)).toBe(true)
    expect(shouldRestartFloatingSelectionForCopy(true, true)).toBe(true)
    expect(shouldRestartFloatingSelectionForCopy(false, false)).toBe(false)
    expect(shouldRestartFloatingSelectionForCopy(true, false)).toBe(false)
  })

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

  it('hits compact shear bands immediately outside each midpoint resize handle', () => {
    const selection = { x: 100, y: 100, width: 80, height: 60 }
    expect(selectionShearHit(selection, { x: 140, y: 87 })).toBe('shear-n')
    expect(selectionShearHit(selection, { x: 140, y: 173 })).toBe('shear-s')
    expect(selectionShearHit(selection, { x: 87, y: 130 })).toBe('shear-w')
    expect(selectionShearHit(selection, { x: 193, y: 130 })).toBe('shear-e')
    expect(selectionInteractionHit(selection, { x: 140, y: 87 }, 1)).toBe('shear-n')
    expect(selectionInteractionHit(selection, { x: 140, y: 71 }, 1)).toBe('outside')
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

  it('uses Ctrl for proportional shape selection constraints, not Shift', () => {
    expect(selectionShapeUsesConstraint({ ctrlKey: true, metaKey: false })).toBe(true)
    expect(selectionShapeUsesConstraint({ ctrlKey: false, metaKey: false })).toBe(false)
  })

  it('uses Shift for a new square marquee but keeps Shift-add freeform unless Ctrl is also held', () => {
    expect(selectionMarqueeUsesConstraint({ ctrlKey: false, shiftKey: true }, false, 'replace')).toBe(true)
    expect(selectionMarqueeUsesConstraint({ ctrlKey: false, shiftKey: true }, true, 'add')).toBe(false)
    expect(selectionMarqueeUsesConstraint({ ctrlKey: true, shiftKey: true }, true, 'add')).toBe(true)
    expect(selectionMarqueeUsesConstraint({ ctrlKey: true, shiftKey: false }, true, 'replace')).toBe(true)
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

  it('keeps a fixed long-axis ratio in horizontal and vertical drags', () => {
    expect(shapeBounds({ x: 0, y: 0 }, { x: 7, y: 2 }, false, { width: 2, height: 1 })).toEqual({ x: 0, y: 0, width: 8, height: 5 })
    expect(shapeBounds({ x: 0, y: 0 }, { x: 2, y: 7 }, false, { width: 2, height: 1 })).toEqual({ x: 0, y: 0, width: 15, height: 8 })
  })

  it('hits the real masked boundary instead of the rectangular bounds', () => {
    const mask = new Uint8Array(20 * 20)
    for (let y = 5; y < 15; y += 1) for (let x = 5; x < 15; x += 1) mask[y * 20 + x] = 1
    const selection = { x: 10, y: 10, width: 20, height: 20, mask }
    expect(selectionInteractionHit(selection, { x: 10, y: 15 }, 8)).toBe('outside')
    expect(selectionInteractionHit(selection, { x: 15, y: 15 }, 8)).toBe('edge')
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

    input.shiftHeld = true
    input.syncModifierKeys({ altKey: false, ctrlKey: false, shiftKey: false })

    expect(input.altHeld).toBe(false)
    expect(input.ctrlHeld).toBe(false)
    expect(input.shiftHeld).toBe(false)
  })
})
