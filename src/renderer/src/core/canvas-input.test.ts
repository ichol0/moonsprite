import { describe, expect, it } from 'vitest'
import { BRUSH_SPEED_STOP_MS, CanvasInputState, SELECTION_CORNER_RESIZE_HIT_RADIUS, SELECTION_RESIZE_HIT_RADIUS, appendCanvasPathStep, appendPolygonLassoVertex, beginBrushSpeedTracking, beginTemporaryCenteredMarqueeResize, brushLineConnectionOverridesTemporaryMove, cachedSelectionTransformSource, canvasGestureForPreview, centerMarqueeBoundsAtCreationPoint, centeredShapeBounds, clampCanvasZoom, coalescedPointerClientPoints, constrainedTranslation, consumePendingCanvasGestureHistory, createCanvasPanDrag, createMarqueeResizeStart, deferredSelectionCommitInvalidationRects, deferredSelectionPreviewOwner, finalizeMarqueeSelection, floatingSelectionCopyMode, isPendingCanvasPathGesture, isQuickSelectionSecondPress, marqueeSelectionCommit, normalizeCanvasWheelDelta, paletteSamplingShortcutStartsPrimarySample, polygonLassoClosedPathPoints, polygonLassoPreviewPoints, quickSelectCellDragBounds, quickSelectCellSelection, redoCanvasPathStep, registerPendingCanvasGestureHistory, resizeRotatedMarqueeBounds, resizeSelectionBounds, resizeTransformedSelectionBounds, resolveMarqueeModifierMode, restoreCanvasDragAfterPan, restoreTemporaryCenteredMarqueeResize, revertCancelledCanvasDragPixelChanges, rotationHandles, sampledForegroundColorToAdd, selectionGestureMoved, selectionInteractionHit, selectionInteractionOverridesTemporaryMove, selectionMarqueeUsesConstraint, selectionMovePointerDelta, selectionOverlayMaskForDrag, selectionPivotAfterResize, selectionPivotAtDragPoint, selectionPivotHit, selectionResizeHit, selectionRotationAngle, selectionRotationHit, selectionShearHit, selectionTransformedInteractionHit, selectionTransformDeferredPreviewEnabled, selectionTransformModifiers, selectionTransformPreviewChanged, shapeBounds, shouldClosePolygonLasso, shouldRestartFloatingSelectionForCopy, shouldStartCanvasPan, shouldUseTemporaryMoveForCanvasInteraction, shouldUseTemporaryMoveTool, snapSelectionRotation, steppedCanvasZoom, temporaryMoveSuppressesToolPreview, temporaryTransformOffset, translatedSelectionRect, undoActiveCanvasPathGesture, undoCanvasPathStep, updateBrushSpeedTracking, wheelCanvasZoom, zoomDragModeForModifiers, zoomDragTarget, type CanvasDragState } from './canvas-input'
import { balancedStairLinePoints } from './pixel-line'
import { createDocument, getActiveLayer, readLayerColor } from './document'
import { beginPixelEdit } from './history'
import { paintBrush } from './tools'

const drag = (): CanvasDragState => ({ kind: 'move-content', start: { x: 0, y: 0 }, last: { x: 0, y: 0 } })

describe('canvas input helpers', () => {
  it('normalizes standard, horizontal, line and legacy wheel input', () => {
    expect(normalizeCanvasWheelDelta({ deltaY: 120 })).toBe(120)
    expect(normalizeCanvasWheelDelta({ deltaX: -8, deltaY: 0 })).toBe(-8)
    expect(normalizeCanvasWheelDelta({ deltaY: 3, deltaMode: 1 })).toBe(48)
    expect(normalizeCanvasWheelDelta({ wheelDelta: 120 })).toBe(-120)
    expect(normalizeCanvasWheelDelta({ deltaY: 0, deltaX: 0, wheelDelta: 0 })).toBe(0)
  })
  it('adds only the final foreground sample while the palette shortcut remains held', () => {
    const color = { r: 12, g: 34, b: 56, a: 255 }
    const foreground = { kind: 'sample-color' as const, sampleSecondary: false, sampledColor: color }
    const background = { ...foreground, sampleSecondary: true }

    expect(sampledForegroundColorToAdd(foreground, true)).toEqual(color)
    expect(sampledForegroundColorToAdd(foreground, false)).toBeNull()
    expect(sampledForegroundColorToAdd(background, true)).toBeNull()
  })

  it('lets held palette sampling take priority only for primary-button sampling', () => {
    expect(paletteSamplingShortcutStartsPrimarySample(true, 0)).toBe(true)
    expect(paletteSamplingShortcutStartsPrimarySample(true, 2)).toBe(false)
    expect(paletteSamplingShortcutStartsPrimarySample(false, 0)).toBe(false)
  })

  it('reuses a prepared selection source only for the exact document version and selection', () => {
    const document = createDocument('cached source', 2, 2, 'rgba')
    const selection = { x: 0, y: 0, width: 1, height: 1 }
    const source = {
      selection,
      values: new Uint32Array(1),
      selectedOffsets: new Uint32Array(1),
      opaqueOffsets: new Uint32Array(0),
      opaqueIndices: new Uint32Array(0),
      opaqueValues: new Uint32Array(0)
    }
    const cached = {
      document,
      contentRevision: 4,
      layerId: document.activeLayerId,
      selection,
      source
    }

    expect(cachedSelectionTransformSource(cached, document, 4, document.activeLayerId, selection)).toBe(source)
    expect(cachedSelectionTransformSource(cached, document, 5, document.activeLayerId, selection)).toBeNull()
    expect(cachedSelectionTransformSource(cached, document, 4, document.activeLayerId, { ...selection })).toBeNull()
  })

  it('keeps temporary Move active only for tools without a dedicated Ctrl gesture', () => {
    const ctrl = { ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }
    expect(shouldUseTemporaryMoveTool('pencil', ctrl, 'Ctrl')).toBe(true)
    expect(shouldUseTemporaryMoveTool('text', ctrl, 'Ctrl')).toBe(true)
    expect(shouldUseTemporaryMoveTool('selection', ctrl, 'Ctrl')).toBe(false)
    expect(shouldUseTemporaryMoveTool('move', ctrl, 'Ctrl', 'slice')).toBe(true)
    expect(shouldUseTemporaryMoveTool('eyedropper', ctrl, 'Ctrl')).toBe(true)
    expect(shouldUseTemporaryMoveTool('zoom', ctrl, 'Ctrl')).toBe(true)
    expect(shouldUseTemporaryMoveTool('rotate', ctrl, 'Ctrl')).toBe(true)
    expect(shouldUseTemporaryMoveTool('shape', ctrl, 'Ctrl')).toBe(false)
    expect(shouldUseTemporaryMoveTool('move', { ...ctrl, altKey: true }, 'Ctrl', 'slice')).toBe(true)
    expect(shouldUseTemporaryMoveTool('move', { ...ctrl, shiftKey: true }, 'Ctrl', 'slice')).toBe(true)
    expect(shouldUseTemporaryMoveTool('move', ctrl, 'Ctrl')).toBe(false)
    expect(shouldUseTemporaryMoveTool('move', { ...ctrl, ctrlKey: false, altKey: true }, 'Ctrl', 'slice')).toBe(false)
  })

  it('keeps an anchored pencil or eraser line ahead of temporary Move', () => {
    const ctrlShift = { ctrlKey: true, metaKey: false, altKey: false, shiftKey: true }
    expect(brushLineConnectionOverridesTemporaryMove('pencil', ctrlShift, 'Shift', true)).toBe(true)
    expect(brushLineConnectionOverridesTemporaryMove('eraser', ctrlShift, 'Shift', true)).toBe(true)
    expect(brushLineConnectionOverridesTemporaryMove('pencil', ctrlShift, 'Shift', false)).toBe(false)
    expect(brushLineConnectionOverridesTemporaryMove('shape', ctrlShift, 'Shift', true)).toBe(false)
  })

  it('keeps existing selection interactions ahead of temporary Move', () => {
    expect(selectionInteractionOverridesTemporaryMove('selection', 'inside')).toBe(true)
    expect(selectionInteractionOverridesTemporaryMove('selection', 'edge')).toBe(true)
    expect(selectionInteractionOverridesTemporaryMove('selection', 'se')).toBe(true)
    expect(selectionInteractionOverridesTemporaryMove('selection', 'rotate-ne')).toBe(true)
    expect(selectionInteractionOverridesTemporaryMove('selection', 'outside')).toBe(false)
    expect(selectionInteractionOverridesTemporaryMove('selection', 'outside', true)).toBe(true)
    expect(selectionInteractionOverridesTemporaryMove('pencil', 'inside')).toBe(false)
  })

  it('keeps Ctrl inside every selection-tool interaction instead of activating temporary Move', () => {
    const ctrl = { ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }
    expect(shouldUseTemporaryMoveForCanvasInteraction('selection', ctrl, 'Ctrl', 'move', 'outside')).toBe(false)
    expect(shouldUseTemporaryMoveForCanvasInteraction('selection', ctrl, 'Ctrl', 'move', 'inside')).toBe(false)
    expect(shouldUseTemporaryMoveForCanvasInteraction('selection', ctrl, 'Ctrl', 'move', 'se')).toBe(false)
    expect(shouldUseTemporaryMoveForCanvasInteraction('selection', ctrl, 'Ctrl', 'move', 'outside', true)).toBe(false)
  })

  it('keeps the brush radius preview visible during wheel and pointer sizing', () => {
    expect(temporaryMoveSuppressesToolPreview(true)).toBe(true)
    expect(temporaryMoveSuppressesToolPreview(true, true)).toBe(false)
    expect(temporaryMoveSuppressesToolPreview(false, false)).toBe(false)
  })

  it('preserves coalesced pointer samples in order without duplicate endpoints', () => {
    const points = coalescedPointerClientPoints({
      clientX: 8,
      clientY: 7,
      getCoalescedEvents: () => [
        { clientX: 2, clientY: 3 },
        { clientX: 5, clientY: 6 },
        { clientX: 8, clientY: 7 }
      ]
    })
    expect(points).toEqual([{ clientX: 2, clientY: 3 }, { clientX: 5, clientY: 6 }, { clientX: 8, clientY: 7 }])
  })

  it('preserves pen pressure changes even when the pointer stays on one coordinate', () => {
    const points = coalescedPointerClientPoints({
      clientX: 8,
      clientY: 7,
      pressure: 0.8,
      pointerType: 'pen',
      getCoalescedEvents: () => [
        { clientX: 8, clientY: 7, pressure: 0.2, pointerType: 'pen' },
        { clientX: 8, clientY: 7, pressure: 0.5, pointerType: 'pen' }
      ]
    })
    expect(points).toEqual([
      { clientX: 8, clientY: 7, pressure: 0.2, pointerType: 'pen' },
      { clientX: 8, clientY: 7, pressure: 0.5, pointerType: 'pen' },
      { clientX: 8, clientY: 7, pressure: 0.8, pointerType: 'pen' }
    ])
  })

  it('keeps timestamp-distinct samples and removes only exact duplicate endpoints', () => {
    const points = coalescedPointerClientPoints({
      clientX: 8,
      clientY: 7,
      pressure: 0.5,
      pointerType: 'pen',
      timeStamp: 12,
      getCoalescedEvents: () => [
        { clientX: 8, clientY: 7, pressure: 0.5, pointerType: 'pen', timeStamp: 10 },
        { clientX: 8, clientY: 7, pressure: 0.5, pointerType: 'pen', timeStamp: 12 }
      ]
    })
    expect(points).toEqual([
      { clientX: 8, clientY: 7, pressure: 0.5, pointerType: 'pen', timeStamp: 10 },
      { clientX: 8, clientY: 7, pressure: 0.5, pointerType: 'pen', timeStamp: 12 }
    ])
  })

  it('tracks CSS pixel speed with zero-dt carry, stop reset, and EMA smoothing', () => {
    const start = beginBrushSpeedTracking({ clientX: 0, clientY: 0, timeStamp: 100 })
    expect(start?.speed).toBe(0)

    const first = updateBrushSpeedTracking(start, { clientX: 10, clientY: 0, timeStamp: 110 })
    expect(first.speed).toBeCloseTo(166.25, 2)

    const zeroDt = updateBrushSpeedTracking(first.state, { clientX: 30, clientY: 0, timeStamp: 110 })
    expect(zeroDt).toEqual({ state: first.state, speed: first.speed })

    const smoothed = updateBrushSpeedTracking(zeroDt.state, { clientX: 15, clientY: 0, timeStamp: 120 })
    expect(smoothed.speed).toBeCloseTo(221.73, 2)

    const stopped = updateBrushSpeedTracking(smoothed.state, { clientX: 16, clientY: 0, timeStamp: 120 + BRUSH_SPEED_STOP_MS })
    expect(stopped.speed).toBe(0)
  })

  it('clamps impossible speed spikes to the supported dynamics range', () => {
    const start = beginBrushSpeedTracking({ clientX: 0, clientY: 0, timeStamp: 0 })
    const spike = updateBrushSpeedTracking(start, { clientX: 1000, clientY: 0, timeStamp: 1 })
    expect(spike.speed).toBeLessThanOrEqual(4000)
  })

  it('reverts an unfinished drawing when the pointer interaction is cancelled', () => {
    const document = createDocument('cancelled stroke', 4, 4, 'rgba')
    const layer = getActiveLayer(document)
    const edit = beginPixelEdit(layer.id)
    paintBrush(document, layer, edit, 2, 1, 1, { r: 20, g: 40, b: 60, a: 255 }, 'square')
    expect(readLayerColor(document, layer, 1 * layer.width + 2).a).toBe(255)
    expect(revertCancelledCanvasDragPixelChanges(document, { kind: 'draw', start: { x: 2, y: 1 }, last: { x: 2, y: 1 }, edit })).toBe(true)
    expect(readLayerColor(document, layer, 1 * layer.width + 2).a).toBe(0)
  })

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

  it('previews a quick-selected cell on the second press and adds a dragged marquee', () => {
    const existing = { x: 0, y: 0, width: 1, height: 1 }
    const cell = { x: 4, y: 4, width: 2, height: 2 }
    const draggedCells = quickSelectCellDragBounds(cell, { x: 8, y: 6, width: 2, height: 2 })
    const base = quickSelectCellSelection(existing, cell, 'replace')
    const expanded = quickSelectCellSelection(existing, draggedCells, 'replace')
    const drag: CanvasDragState = {
      kind: 'marquee',
      start: { x: 4, y: 4 },
      last: { x: 7, y: 5 },
      selectionStart: existing,
      selectionCommitStart: existing,
      selectionMode: 'replace',
      previewSelection: expanded,
      quickSelectCell: cell
    }

    expect(base).toMatchObject(cell)
    expect(draggedCells).toEqual({ x: 4, y: 4, width: 6, height: 4 })
    expect(marqueeSelectionCommit({ ...drag, previewSelection: base }, existing, false, 'replace')).toEqual({ before: existing, after: base })
    expect(marqueeSelectionCommit(drag, existing, true, 'replace')).toEqual({ before: existing, after: expanded })
  })

  it('keeps the active selection combination mode while quick-select dragging', () => {
    const existing = { x: 0, y: 0, width: 8, height: 4 }
    const incoming = { x: 4, y: 0, width: 4, height: 4 }

    expect(quickSelectCellSelection(existing, incoming, 'add')).toMatchObject({ x: 0, y: 0, width: 8, height: 4 })
    expect(quickSelectCellSelection(existing, incoming, 'subtract')).toMatchObject({ x: 0, y: 0, width: 4, height: 4 })
    expect(quickSelectCellSelection(existing, incoming, 'intersect')).toMatchObject({ x: 4, y: 0, width: 4, height: 4 })
  })

  it('recognizes the second selection press when pointer detail is unavailable', () => {
    const first = { clientX: 100, clientY: 80, pointerId: 4, timeStamp: 1000 }

    expect(isQuickSelectionSecondPress(first, { ...first, clientX: 103, timeStamp: 1300 }, 0)).toBe(true)
    expect(isQuickSelectionSecondPress(first, { ...first, clientX: 110, timeStamp: 1300 }, 0)).toBe(false)
    expect(isQuickSelectionSecondPress(first, { ...first, timeStamp: 1600 }, 0)).toBe(false)
    expect(isQuickSelectionSecondPress(null, first, 2)).toBe(true)
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
    expect(selectionOverlayMaskForDrag(incoming, { ...drag, quickSelectCell: incoming })).toBeNull()
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

  it('undoes and redoes in-progress freeform and polygon path steps without touching document history', () => {
    for (const kind of ['freeform-shape', 'polygon-shape', 'lasso', 'polygon-lasso'] as const) {
      const gesture: CanvasDragState = {
        kind,
        start: { x: 1, y: 1 },
        last: { x: 3, y: 1 },
        path: [{ x: 1, y: 1 }, { x: 2, y: 1 }]
      }
      expect(isPendingCanvasPathGesture(gesture)).toBe(true)
      expect(appendCanvasPathStep(gesture, { x: 3, y: 1 })).toBe(true)
      expect(undoCanvasPathStep(gesture)).toBe(true)
      expect(gesture.path).toEqual([{ x: 1, y: 1 }, { x: 2, y: 1 }])
      expect(redoCanvasPathStep(gesture)).toBe(true)
      expect(gesture.path).toEqual([{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }])
      expect(undoCanvasPathStep(gesture)).toBe(true)
      expect(appendCanvasPathStep(gesture, { x: 4, y: 1 })).toBe(true)
      expect(redoCanvasPathStep(gesture)).toBe(false)
    }
    expect(isPendingCanvasPathGesture({ kind: 'draw', start: { x: 0, y: 0 }, last: { x: 0, y: 0 } })).toBe(false)

    const input = new CanvasInputState()
    input.begin({ kind: 'polygon-shape', start: { x: 1, y: 1 }, last: { x: 1, y: 1 }, path: [{ x: 1, y: 1 }] })
    expect(undoActiveCanvasPathGesture(input)).toBe(true)
    expect(input.drag).toBeNull()
    expect(undoActiveCanvasPathGesture(input)).toBe(false)
  })

  it('routes active canvas gesture history by document and unregisters without clearing replacements', () => {
    let firstUndo = 0
    let replacementUndo = 0
    const unregisterFirst = registerPendingCanvasGestureHistory('document', {
      undo: () => { firstUndo += 1; return true },
      redo: () => true
    })
    const unregisterReplacement = registerPendingCanvasGestureHistory('document', {
      undo: () => { replacementUndo += 1; return true },
      redo: () => true
    })

    unregisterFirst()
    expect(consumePendingCanvasGestureHistory('document', 'undo')).toBe(true)
    expect(firstUndo).toBe(0)
    expect(replacementUndo).toBe(1)
    unregisterReplacement()
    expect(consumePendingCanvasGestureHistory('document', 'undo')).toBe(false)
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

  it('preserves the floating copy mode while rotating after Ctrl is released', () => {
    expect(floatingSelectionCopyMode(true, false)).toBe(true)
    expect(floatingSelectionCopyMode(false, true)).toBe(false)
    expect(floatingSelectionCopyMode(null, true)).toBe(true)
  })

  it('hands the first floating-copy rotation preview to the active transform', () => {
    const rotating: CanvasDragState = {
      kind: 'rotate-content',
      start: { x: 0, y: 0 },
      last: { x: 0, y: 0 },
      selectionPreparationPending: true,
      deferredSelectionPreview: true,
      selectionSource: {} as NonNullable<CanvasDragState['selectionSource']>,
      previewTarget: { x: 4, y: 3, width: 2, height: 2 }
    }

    expect(selectionTransformDeferredPreviewEnabled('rotate-content', true)).toBe(true)
    expect(selectionTransformDeferredPreviewEnabled('shear-content', true, 45, { axis: 'x', edge: 's', amount: 2 })).toBe(true)
    expect(selectionTransformDeferredPreviewEnabled('transform-content', true, 45)).toBe(false)
    expect(deferredSelectionPreviewOwner(rotating, true)).toBe('pending')
    expect(deferredSelectionPreviewOwner({ ...rotating, selectionPreparationPending: false }, true)).toBe('active')
    expect(deferredSelectionPreviewOwner({ ...rotating, selectionPreparationPending: false, deferredSelectionPreview: false }, true)).toBeNull()
  })

  it('keeps zoom levels within the supported range', () => {
    expect(clampCanvasZoom(100)).toBe(64)
    expect(steppedCanvasZoom(1, true)).toBe(2)
    expect(steppedCanvasZoom(0.0625, false)).toBe(0.0625)
  })

  it('supports smooth and percentage wheel zoom modes', () => {
    expect(wheelCanvasZoom(1, -120, 'stepped')).toBe(2)
    expect(wheelCanvasZoom(1, 120, 'stepped')).toBe(0.666667)
    expect(wheelCanvasZoom(1, -120, 'smooth')).toBeGreaterThan(1)
    expect(wheelCanvasZoom(1, -120, 'smooth')).toBeLessThan(2)
    expect(wheelCanvasZoom(64, -120, 'smooth')).toBe(64)
  })

  it('supports smooth and stepped zoom-tool drag preferences', () => {
    expect(zoomDragTarget(1, 96, 'smooth')).toBe(2)
    expect(zoomDragTarget(1, 48, 'stepped')).toBe(3)
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

  it('uses Ctrl only for centered marquee creation and Shift for the 1:1 constraint', () => {
    expect(selectionMarqueeUsesConstraint({ ctrlKey: false, shiftKey: true }, false, 'replace')).toBe(true)
    expect(selectionMarqueeUsesConstraint({ ctrlKey: false, shiftKey: true }, true, 'add')).toBe(false)
    expect(selectionMarqueeUsesConstraint({ ctrlKey: true, shiftKey: true }, false, 'replace')).toBe(true)
    expect(selectionMarqueeUsesConstraint({ ctrlKey: true, shiftKey: true }, true, 'add')).toBe(false)
    expect(selectionMarqueeUsesConstraint({ ctrlKey: true, shiftKey: false }, true, 'replace')).toBe(false)
    expect(selectionMarqueeUsesConstraint({ ctrlKey: true, shiftKey: false }, true, 'replace', true)).toBe(false)
    expect(selectionMarqueeUsesConstraint({ ctrlKey: true, shiftKey: true }, true, 'add', true)).toBe(false)
  })

  it('uses Shift for proportional transform and Ctrl for integer scaling without copying', () => {
    expect(selectionTransformModifiers({ ctrlKey: true, shiftKey: false })).toEqual({ proportional: false, integerScale: true, fromCenter: false, copy: false })
    expect(selectionTransformModifiers({ ctrlKey: true, shiftKey: true })).toEqual({ proportional: true, integerScale: true, fromCenter: false, copy: false })
    expect(selectionTransformModifiers({ ctrlKey: false, altKey: true, shiftKey: true })).toEqual({ proportional: true, integerScale: false, fromCenter: true, copy: false })
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

  it('keeps selection movement continuous across a repeated-canvas seam', () => {
    const repeatedDrag: Pick<CanvasDragState, 'start' | 'tileRepeatStart'> = {
      start: { x: 15, y: 2 },
      tileRepeatStart: { x: 15.75, y: 2.25 }
    }
    expect(selectionMovePointerDelta(repeatedDrag, { x: 0, y: 2 }, { x: 16.1, y: 2.25 })).toEqual({ x: 1, y: 0 })
    expect(selectionMovePointerDelta(repeatedDrag, { x: 14, y: 3 }, { x: 14.9, y: 3.1 })).toEqual({ x: -1, y: 1 })
    expect(selectionMovePointerDelta({ start: { x: 4, y: 5 } }, { x: 7, y: 3 })).toEqual({ x: 3, y: -2 })
  })

  it('creates constrained square bounds in every drag direction', () => {
    expect(shapeBounds({ x: 5, y: 5 }, { x: 2, y: 3 }, true)).toEqual({ x: 2, y: 2, width: 4, height: 4 })
  })

  it('creates marquee bounds around the pressed pixel while Ctrl is held', () => {
    expect(centeredShapeBounds({ x: 5, y: 5 }, { x: 8, y: 7 })).toEqual({ x: 2, y: 3, width: 7, height: 5 })
    expect(centeredShapeBounds({ x: 5, y: 5 }, { x: 8, y: 7 }, true)).toEqual({ x: 2, y: 2, width: 7, height: 7 })
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

  it('keeps proportional integer scaling aligned to source pixels', () => {
    expect(resizeSelectionBounds({ x: 2, y: 2, width: 2, height: 2 }, { x: 8, y: 8 }, 'se', { width: 10, height: 10 }, true, true)).toEqual({ x: 2, y: 2, width: 8, height: 8 })
  })

  it('allows resize handles to move beyond every canvas edge', () => {
    const start = { x: 2, y: 2, width: 4, height: 3 }
    expect(resizeSelectionBounds(start, { x: -4, y: -5 }, 'nw', { width: 12, height: 12 })).toEqual({ x: -4, y: -5, width: 10, height: 10 })
    expect(resizeSelectionBounds(start, { x: 18, y: 16 }, 'se', { width: 12, height: 12 })).toEqual({ x: 2, y: 2, width: 16, height: 14 })
  })

  it('uses independent integer pixel multiples when Ctrl is held without Shift', () => {
    expect(resizeSelectionBounds({ x: 2, y: 2, width: 2, height: 3 }, { x: 8, y: 9 }, 'se', { width: 20, height: 20 }, false, true)).toEqual({ x: 2, y: 2, width: 8, height: 9 })
  })

  it('keeps the untouched axis unchanged for one-axis integer scaling', () => {
    expect(resizeSelectionBounds({ x: 2, y: 2, width: 2, height: 1 }, { x: 8, y: 2 }, 'e', { width: 20, height: 20 }, false, true)).toEqual({ x: 2, y: 2, width: 8, height: 1 })
    expect(resizeSelectionBounds({ x: 2, y: 2, width: 1, height: 2 }, { x: 2, y: 8 }, 's', { width: 20, height: 20 }, false, true)).toEqual({ x: 2, y: 2, width: 1, height: 8 })
  })

  it('resizes existing selections symmetrically around their center while Alt is held', () => {
    const start = { x: 2, y: 3, width: 4, height: 6 }
    expect(resizeSelectionBounds(start, { x: 8, y: 6 }, 'e', { width: 20, height: 20 }, false, false, true)).toEqual({ x: 0, y: 3, width: 8, height: 6 })
    expect(resizeSelectionBounds(start, { x: 8, y: 12 }, 'se', { width: 20, height: 20 }, false, false, true)).toEqual({ x: 0, y: 0, width: 8, height: 12 })
  })

  it('combines centered selection resizing with proportional and integer scaling', () => {
    const start = { x: 2, y: 3, width: 4, height: 2 }
    expect(resizeSelectionBounds(start, { x: 8, y: 5 }, 'se', { width: 20, height: 20 }, true, false, true)).toEqual({ x: 0, y: 2, width: 8, height: 4 })
    expect(resizeSelectionBounds(start, { x: 8, y: 4 }, 'e', { width: 20, height: 20 }, false, true, true)).toEqual({ x: 0, y: 3, width: 8, height: 2 })
  })

  it('flips a centered selection only after the dragged handle crosses its center', () => {
    expect(resizeSelectionBounds({ x: 2, y: 2, width: 4, height: 3 }, { x: 7, y: 3 }, 'w', { width: 20, height: 20 }, false, false, true)).toEqual({ x: 1, y: 2, width: 6, height: 3, flipHorizontal: true, flipOriginX: 4 })
  })

  it('keeps temporary marquee movement pointer-relative', () => {
    const move = { pointer: { x: 8, y: 6 }, offset: { x: 2, y: -1 } }
    expect(temporaryTransformOffset(move, { x: 11, y: 10 })).toEqual({ x: 5, y: 3 })
    expect(translatedSelectionRect({ x: 3, y: 4, width: 2, height: 3 }, { x: 5, y: 3 })).toEqual({ x: 8, y: 7, width: 2, height: 3 })
  })

  it('preserves marquee geometry while Space moves it from the pointer reference', () => {
    const beforeMove = shapeBounds({ x: 2, y: 2 }, { x: 9, y: 8 })
    const offset = temporaryTransformOffset({ pointer: { x: 9, y: 8 }, offset: { x: 0, y: 0 } }, { x: 13, y: 6 })
    const adjustedPointer = { x: 13 - offset.x, y: 6 - offset.y }
    expect(translatedSelectionRect(shapeBounds({ x: 2, y: 2 }, adjustedPointer), offset)).toEqual(translatedSelectionRect(beforeMove, offset))
  })

  it('calculates rotation from the original pointer direction and supports snapping', () => {
    const selection = { x: 0, y: 0, width: 10, height: 10 }
    expect(selectionRotationAngle(selection, { x: 10, y: 5 }, { x: 5, y: 10 })).toBe(90)
    expect(selectionRotationAngle(selection, { x: 10, y: 5 }, { x: 9, y: 8 }, true)).toBe(45)
    expect(selectionRotationAngle(selection, { x: 4, y: 0 }, { x: 0, y: 4 }, false, { x: 0, y: 0 })).toBe(90)
  })

  it('uses a larger screen-space hit area around the selection pivot marker', () => {
    expect(selectionPivotHit({ x: 20, y: 12 }, { x: 30, y: 22 })).toBe(true)
    expect(selectionPivotHit({ x: 20, y: 12 }, { x: 31, y: 22 })).toBe(false)
  })

  it('moves the selection pivot in whole document pixels without losing its fractional center', () => {
    const pivot = selectionPivotAtDragPoint(
      { x: 5.5, y: 4.5 },
      { x: 10.2, y: 8.8 },
      { x: 11.7, y: 6.3 }
    )

    expect(pivot).toEqual({ x: 7.5, y: 1.5 })
  })

  it('moves default and custom pivots correctly during resize while Alt keeps the pivot fixed', () => {
    const source = { x: 0, y: 0, width: 4, height: 4 }
    const destination = { x: 0, y: 0, width: 8, height: 6 }
    const pivot = { x: 2.5, y: 2.5 }

    expect(selectionPivotAfterResize(source, destination, pivot)).toEqual({ x: 4.5, y: 3.5 })
    expect(selectionPivotAfterResize(source, destination, pivot, { custom: true })).toEqual({ x: 5, y: 3.75 })
    expect(selectionPivotAfterResize(source, destination, pivot, { custom: true, fromCenter: true })).toEqual(pivot)
  })

  it('lets the most recently pressed marquee modifier take over while Alt and Ctrl remain held', () => {
    const bothHeld = { fromCenter: true, rotate: true }

    expect(resolveMarqueeModifierMode(bothHeld, 'resize')).toBe('resize')
    expect(resolveMarqueeModifierMode(bothHeld, 'rotate')).toBe('rotate')
    expect(resolveMarqueeModifierMode({ fromCenter: false, rotate: true }, 'resize')).toBe('rotate')
    expect(resolveMarqueeModifierMode({ fromCenter: true, rotate: false }, 'rotate')).toBe('resize')
  })

  it('returns a rotated marquee center to its original creation point before Ctrl resizing', () => {
    const centered = centerMarqueeBoundsAtCreationPoint({ x: 12, y: 8, width: 10, height: 6 }, { x: 4, y: 7 })

    expect(centered).toEqual({ x: -1, y: 4, width: 10, height: 6 })
    expect(centered.x + Math.floor(centered.width / 2)).toBe(4)
    expect(centered.y + Math.floor(centered.height / 2)).toBe(7)
  })

  it('restores the pre-Ctrl rotated marquee geometry when temporary centered resizing ends', () => {
    const beforeCtrl = { x: 12, y: 8, width: 10, height: 6 }
    const transition = beginTemporaryCenteredMarqueeResize(
      beforeCtrl,
      { x: 4, y: 7 },
      { x: 20, y: 14 },
      { x: -1, y: 1 },
      true
    )

    expect(transition.bounds).toEqual({ x: -1, y: 4, width: 10, height: 6 })
    expect(transition.resizeStart).toEqual({ pointer: { x: 20, y: 14 }, bounds: transition.bounds, fromCenter: true })

    const restored = restoreTemporaryCenteredMarqueeResize(transition.restore, { x: 27, y: 19 })
    expect(restored.bounds).toEqual(beforeCtrl)
    expect(restored.resizeStart).toEqual({ pointer: { x: 27, y: 19 }, bounds: beforeCtrl, fromCenter: true })
    expect(restored.direction).toEqual({ x: -1, y: 1 })
  })

  it('continues resizing along the rotated marquee axes after Alt is released', () => {
    const start = { x: 0, y: 0, width: 10, height: 6 }
    const continuation = createMarqueeResizeStart(start, { x: 5, y: 7 })
    expect(continuation.fromCenter).toBe(true)
    expect(resizeRotatedMarqueeBounds(continuation.bounds, { x: 5 - continuation.pointer.x, y: 11 - continuation.pointer.y }, 90, { x: 1, y: 1 }, continuation.fromCenter)).toEqual({ x: -4, y: 0, width: 18, height: 6 })
    expect(resizeRotatedMarqueeBounds(start, { x: 0, y: 4 }, 90, { x: 1, y: 1 }, true)).toEqual({ x: -4, y: 0, width: 18, height: 6 })
    expect(resizeRotatedMarqueeBounds(start, { x: -2, y: 4 }, 90, { x: 1, y: 1 }, false, true)).toEqual({ x: 0, y: 0, width: 14, height: 14 })
  })

  it('keeps the exact rotation center while resizing both sides after Alt is released', () => {
    const start = { x: 3, y: 4, width: 7, height: 5 }
    const resized = resizeRotatedMarqueeBounds(start, { x: 4, y: 3 }, 37, { x: 1, y: 1 }, true)
    expect(resized.x + resized.width / 2).toBe(start.x + start.width / 2)
    expect(resized.y + resized.height / 2).toBe(start.y + start.height / 2)
    expect((resized.width - start.width) % 2).toBe(0)
    expect((resized.height - start.height) % 2).toBe(0)
  })

  it('resizes transformed content along its rotated local axes without replacing the transform box with the visible bounds', () => {
    const start = { x: 2, y: 2, width: 4, height: 3 }
    const resized = resizeTransformedSelectionBounds(start, { x: 0, y: 2 }, 90, 'e')
    expect(resized.x).toBeCloseTo(1)
    expect(resized.y).toBeCloseTo(3)
    expect(resized.width).toBe(6)
    expect(resized.height).toBe(3)
  })

  it('keeps the transformed content center fixed during rotated centered resizing', () => {
    const start = { x: 3, y: 4, width: 7, height: 5 }
    const resized = resizeTransformedSelectionBounds(start, { x: 4, y: 3 }, 37, 'se', false, false, true)
    expect(resized.x + resized.width / 2).toBeCloseTo(start.x + start.width / 2)
    expect(resized.y + resized.height / 2).toBeCloseTo(start.y + start.height / 2)
  })

  it('keeps an off-center pivot fixed during rotated Alt resizing', () => {
    const start = { x: 10, y: 20, width: 8, height: 4 }
    const angle = 37
    const radians = angle * Math.PI / 180
    const cosine = Math.cos(radians)
    const sine = Math.sin(radians)
    const startCenter = { x: start.x + start.width / 2, y: start.y + start.height / 2 }
    const localPivot = { x: 2, y: 1 }
    const pivot = {
      x: startCenter.x + (localPivot.x - start.width / 2) * cosine - (localPivot.y - start.height / 2) * sine,
      y: startCenter.y + (localPivot.x - start.width / 2) * sine + (localPivot.y - start.height / 2) * cosine
    }
    const localPointerDelta = { x: 6, y: 3 }
    const pointerDelta = {
      x: localPointerDelta.x * cosine - localPointerDelta.y * sine,
      y: localPointerDelta.x * sine + localPointerDelta.y * cosine
    }
    const resized = resizeTransformedSelectionBounds(start, pointerDelta, angle, 'se', false, false, true, pivot)
    const pivotOffset = { x: pivot.x - startCenter.x, y: pivot.y - startCenter.y }
    const localPivotOffset = {
      x: pivotOffset.x * cosine + pivotOffset.y * sine,
      y: -pivotOffset.x * sine + pivotOffset.y * cosine
    }
    const resizedCenter = { x: resized.x + resized.width / 2, y: resized.y + resized.height / 2 }
    const mappedPivot = {
      x: resizedCenter.x + localPivotOffset.x * (resized.width / start.width) * cosine - localPivotOffset.y * (resized.height / start.height) * sine,
      y: resizedCenter.y + localPivotOffset.x * (resized.width / start.width) * sine + localPivotOffset.y * (resized.height / start.height) * cosine
    }
    const startHandle = {
      x: startCenter.x + start.width / 2 * cosine - start.height / 2 * sine,
      y: startCenter.y + start.width / 2 * sine + start.height / 2 * cosine
    }
    const resizedHandle = {
      x: resizedCenter.x + resized.width / 2 * cosine - resized.height / 2 * sine,
      y: resizedCenter.y + resized.width / 2 * sine + resized.height / 2 * cosine
    }

    expect(resized.width).toBe(16)
    expect(resized.height).toBe(8)
    expect(mappedPivot.x).toBeCloseTo(pivot.x)
    expect(mappedPivot.y).toBeCloseTo(pivot.y)
    expect(resizedHandle.x).toBeCloseTo(startHandle.x + pointerDelta.x)
    expect(resizedHandle.y).toBeCloseTo(startHandle.y + pointerDelta.y)
  })

  it('flips around an off-center pivot after an Alt resize handle crosses it', () => {
    const start = { x: 10, y: 20, width: 8, height: 4 }
    const pivot = { x: 12, y: 21 }
    const resized = resizeTransformedSelectionBounds(start, { x: -12, y: -6 }, 0, 'se', false, false, true, pivot)

    expect(resized).toMatchObject({ width: 8, height: 4, flipHorizontal: true, flipVertical: true })
    expect(resized.x + resized.width / 2).toBe(10)
    expect(resized.y + resized.height / 2).toBe(20)
  })

  it('keeps transform handle and rotation hits on the final rotated rectangle', () => {
    const target = { x: 10, y: 20, width: 40, height: 20 }
    const selection = { x: 20, y: 10, width: 20, height: 40 }

    expect(selectionTransformedInteractionHit(selection, target, 90, undefined, { x: 40, y: 10 }, 1)).toBe('nw')
    expect(selectionTransformedInteractionHit(selection, target, 90, undefined, { x: 46, y: 4 }, 1)).toBe('rotate-nw')
    expect(selectionTransformedInteractionHit(selection, target, 90, undefined, { x: 10, y: 20 }, 1)).not.toBe('nw')
    expect(selectionTransformedInteractionHit(selection, target, 90, undefined, { x: 20, y: 20 }, 8)).toBe('edge')
    expect(selectionTransformedInteractionHit(selection, target, 90, undefined, { x: 30, y: 30 }, 8)).toBe('inside')
  })

  it('persists selection-only transforms only after their geometry changes', () => {
    const selection = { x: 2, y: 3, width: 6, height: 4 }
    const unchanged: CanvasDragState = { kind: 'rotate-content', start: { x: 0, y: 0 }, last: { x: 0, y: 0 }, selectionStart: selection, transformStartTarget: selection, previewTarget: selection, startAngle: 0, previewAngle: 360 }
    expect(selectionTransformPreviewChanged(unchanged)).toBe(false)
    expect(selectionTransformPreviewChanged({ ...unchanged, previewAngle: 45 })).toBe(true)
    expect(selectionTransformPreviewChanged({ ...unchanged, previewTarget: { ...selection, x: 4 } })).toBe(true)
    expect(selectionTransformPreviewChanged({ ...unchanged, previewShear: { axis: 'x', edge: 's', amount: 2 } })).toBe(true)
  })

  it('invalidates the original source when committing a second deferred floating move', () => {
    const source = { x: 2, y: 3, width: 6, height: 4 }
    const previousTarget = { ...source, x: 12 }
    const nextTarget = { ...source, x: 20 }
    const drag = {
      selectionSource: { selection: source },
      selectionStart: previousTarget,
      previewSelection: nextTarget
    } as Pick<CanvasDragState, 'selectionSource' | 'selectionStart' | 'previewSelection'>

    expect(deferredSelectionCommitInvalidationRects(drag)).toEqual([
      source,
      previousTarget,
      nextTarget
    ])
  })

  it('keeps a shape ratio and fixed center while resizing after rotation', () => {
    const start = { x: 4, y: 6, width: 10, height: 5 }
    const angle = 37
    const distance = 4
    const resized = resizeRotatedMarqueeBounds(start, {
      x: Math.cos(angle * Math.PI / 180) * distance,
      y: Math.sin(angle * Math.PI / 180) * distance
    }, angle, { x: 1, y: 1 }, true, false, { width: 2, height: 1 })

    expect(resized).toEqual({ x: 0, y: 4, width: 18, height: 9 })
    expect(resized.x + resized.width / 2).toBe(start.x + start.width / 2)
    expect(resized.y + resized.height / 2).toBe(start.y + start.height / 2)
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

  it('only lets pointer events release marquee modifiers while keyboard events own activation', () => {
    const input = new CanvasInputState()
    input.altHeld = false
    input.ctrlHeld = true
    input.shiftHeld = true

    input.syncModifierKeys({ altKey: true, ctrlKey: false, shiftKey: true }, true)

    expect(input.altHeld).toBe(false)
    expect(input.ctrlHeld).toBe(false)
    expect(input.shiftHeld).toBe(true)
  })

  it('clears a lost pointer interaction so the next tool can receive shortcuts normally', () => {
    const input = new CanvasInputState()
    const active = drag()
    input.begin(active)
    input.pointer.visible = true
    input.sampling = true
    input.altHeld = true
    input.ctrlHeld = true
    input.shiftHeld = true
    input.spaceHeld = true

    expect(input.resetInteraction()).toBe(active)
    expect(input.drag).toBeNull()
    expect(input.pointer.visible).toBe(false)
    expect(input.sampling).toBe(false)
    expect(input.altHeld).toBe(false)
    expect(input.ctrlHeld).toBe(false)
    expect(input.shiftHeld).toBe(false)
    expect(input.spaceHeld).toBe(false)
  })
})
