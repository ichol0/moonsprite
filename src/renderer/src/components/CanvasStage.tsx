import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RasterLayer, RgbaColor, SelectionMask, SelectionMode, SelectionRect } from '@shared/types'
import { compositePixelWithLayerColor, compositeRegion, getActiveLayer, isLayerEffectivelyLocked, isLayerEffectivelyVisible, layerIndexAt, readLayerColor, readLayerColorAt } from '@/core/document'
import { beginPixelEdit, revertPixelEdit } from '@/core/history'
import { applyRelativeLuminance, blendOver, relativeLuminanceColor, TRANSPARENT } from '@/core/raster'
import { appendPerfectPixelSegment, applySelectionTransform, applySelectionTranslationPreview, brushMaskOffsets, brushStampAnchor, brushStampDimensions, captureSelectionTransform, floodFill, outlinePixelIndices, paintBrush, paintLine, paintShape, sampleCompositeColor, selectionTranslationPreviewEdit, shapePixelPoints } from '@/core/tools'
import { useWorkspace, type DocumentSession } from '@/store/workspace'
import { DRAWING_BRUSH_PREVIEW_ENABLED_KEY, ROTATION_INDICATOR_POSITION_KEY, ZOOM_TOOL_DRAG_MODE_PREFERENCE_KEY, parseDrawingBrushPreviewEnabled, parseRotationIndicatorPosition, parseZoomToolDragMode, type RotationIndicatorPosition, type ZoomToolDragMode } from '@/core/file-preferences'
import { documentPointFromViewportPoint, rotationIndicatorFitsCanvas, unrotateViewportPoint, unrotatedViewportBounds, viewCanvasOrigin, viewPanDeltaFromScreen, viewRotationPivot, zoomViewAroundViewportPoint } from '@/core/view-geometry'
import { cloneSelection, combineSelection, ellipseSelection, lassoSelection, magicWandSelection, rectSelection, selectionBoundarySegments, selectionContains, transformSelectionMask } from '@/core/selection'
import { CANVAS_RESIZE_PREVIEW_EVENT } from '@/core/canvas-resize-preview'
import { loadShortcuts, modifierShortcutMatches } from '@/core/shortcuts'
import { CanvasInputState, clampCanvasZoom as clampZoom, constrainedTranslation, resizeSelectionBounds, selectionResizeHit, selectionRotationHit, shapeBounds, steppedCanvasZoom as steppedZoom, zoomDragTarget, type CanvasDragState as DragState, type CanvasPoint as Point, type SelectionHandle, type SelectionHit, type SelectionRotationHandle } from '@/core/canvas-input'
import { canvasCursors, canvasToolCursor, colorLuminance, previewCursorTools, resizeCursors, rotationCursors, selectionPreviewPixels, transparencyColorAt } from '@/core/canvas-visuals'
import rotationBackground1 from '@/assets/rotation-indicator/background-1.png'
import rotationBackground2 from '@/assets/rotation-indicator/background-2.png'
import rotationBackground3 from '@/assets/rotation-indicator/background-3.png'
import rotationBackground4 from '@/assets/rotation-indicator/background-4.png'
import rotationBackground5 from '@/assets/rotation-indicator/background-5.png'
import rotationBackground6 from '@/assets/rotation-indicator/background-6.png'
import rotationPointer from '@/assets/rotation-indicator/pointer.png'

type RasterContext2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
interface CompositeTile { canvas: OffscreenCanvas; x: number; y: number; width: number; height: number }
interface CompositeSurface { canvas: OffscreenCanvas; revision: string }
const COMPOSITE_TILE_SIZE = 128
const MAX_COMPOSITE_TILES = 192
const MAX_COMPOSITE_SURFACE_PIXELS = 2048 * 2048
const COMPOSITE_TILE_CACHE_VERSION = 2
const insideSelection = (selection: SelectionMask, point: Point): boolean => selectionContains(selection, point.x, point.y)

export function CanvasStage({ session }: { session: DocumentSession }) {
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const selectionCanvasRef = useRef<HTMLCanvasElement>(null)
  const rotationSceneRef = useRef<OffscreenCanvas | null>(null)
  const selectionRotationSceneRef = useRef<OffscreenCanvas | null>(null)
  const rotationIndicatorRef = useRef<HTMLDivElement>(null)
  const rotationPointerRef = useRef<HTMLDivElement>(null)
  const [rotationIndicatorPosition, setRotationIndicatorPosition] = useState<RotationIndicatorPosition>(() => parseRotationIndicatorPosition(localStorage.getItem(ROTATION_INDICATOR_POSITION_KEY)))
  const [drawingBrushPreviewEnabled, setDrawingBrushPreviewEnabled] = useState(() => parseDrawingBrushPreviewEnabled(localStorage.getItem(DRAWING_BRUSH_PREVIEW_ENABLED_KEY)))
  const [zoomToolDragMode, setZoomToolDragMode] = useState<ZoomToolDragMode>(() => parseZoomToolDragMode(localStorage.getItem(ZOOM_TOOL_DRAG_MODE_PREFERENCE_KEY)))
  const [shortcuts, setShortcuts] = useState(loadShortcuts)
  const inputRef = useRef(new CanvasInputState())
  const rafRef = useRef<number | null>(null)
  const drawRequestRef = useRef<number | null>(null)
  // Keyboard listeners intentionally live across brush changes. Deferred draws
  // must therefore resolve the current render function instead of the brush
  // configuration that was active when the listener was registered.
  const drawRef = useRef<() => void>(() => {})
  const compositeTilesRef = useRef(new Map<string, CompositeTile>())
  const compositeRevisionRef = useRef('')
  const compositeSurfaceRef = useRef<CompositeSurface | null>(null)
  const canvasResizeSurfaceRef = useRef<CompositeSurface | null>(null)
  const outlinePreviewCacheRef = useRef<{ revision: number; layerId: string; selection: SelectionMask; preview: NonNullable<DocumentSession['outlinePreview']>; indices: number[] } | null>(null)
  const selectionBoundaryCacheRef = useRef<{ width: number; height: number; mask?: Uint8Array; segments: Int32Array; screenPaths: Map<string, Path2D> } | null>(null)
  const selectionOverlayVisibleRef = useRef(false)
  const pendingViewRef = useRef<Partial<DocumentSession['view']> | null>(null)
  const liveViewRef = useRef(session.view)
  const viewFrameRef = useRef<number | null>(null)
  const zoomPreviewStartRef = useRef<DocumentSession['view'] | null>(null)
  const zoomCommitTimerRef = useRef<number | null>(null)
  const panPreviewFrameRef = useRef<number | null>(null)
  const selectionPreviewFrameRef = useRef<number | null>(null)
  const pendingPanPreviewOffsetRef = useRef<Point | null>(null)
  const appliedRotationStyleRef = useRef('')
  const canvasResizePreviewRef = useRef(session.canvasResizePreview)
  const pendingCanvasResizeRef = useRef<DocumentSession['canvasResizePreview']>(null)
  const canvasResizeFrameRef = useRef<number | null>(null)
  canvasResizePreviewRef.current = session.canvasResizePreview
  const activeViewDrag = inputRef.current.drag?.kind === 'pan' || inputRef.current.drag?.kind === 'zoom-drag' || inputRef.current.drag?.kind === 'rotate-view'
  if (!activeViewDrag) liveViewRef.current = { ...session.view, ...pendingViewRef.current }
  const lineAnchor = session.tool === 'eraser' ? session.lastEraserPoint : session.lastPencilPoint
  const hasSelectedRasterLayer = !session.selectedGroupId && session.selectedLayerIds.some((id) => session.document.layers.some((layer) => layer.id === id))
  const activeLayer = getActiveLayer(session.document)
  const activeLayerEditable = hasSelectedRasterLayer && isLayerEffectivelyVisible(session.document, activeLayer) && !isLayerEffectivelyLocked(session.document, activeLayer)
  const brushToolEnabled = session.tool === 'pencil' || session.tool === 'eraser' || session.tool === 'fill'
  const activeBrushImage = brushToolEnabled ? session.brushImage : null
  const activeBrushTexture = brushToolEnabled ? session.brushTexture : 'solid'
  const activeBrushPaintMode = activeBrushImage?.intrinsicSize ? session.brushPaintMode : 'paint'
  const activeBrushPreviewMode = activeBrushPaintMode
  const proceduralAntialiasStrength = brushToolEnabled && session.proceduralAntialias && activeBrushImage?.id.startsWith('procedural:') ? session.proceduralAntialiasStrength : 0
  const brushPatternOrigin = (point: Point): Point => {
    const anchor = brushStampAnchor(session.brushSize, activeBrushImage)
    return { x: point.x - anchor.x, y: point.y - anchor.y }
  }
  const stageBounds = (): DOMRect => stageRef.current?.getBoundingClientRect() ?? canvasRef.current?.getBoundingClientRect() ?? new DOMRect()
  const modifierActive = (event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, id: keyof typeof shortcuts): boolean => modifierShortcutMatches(event, shortcuts[id] ?? '')
  const lineConnectionShortcut = shortcuts.lineConnectionMode ?? ''
  const lineConnectionConfigured = Boolean(lineConnectionShortcut.trim())
  const lineConnectionActive = (event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): boolean => lineConnectionConfigured && modifierActive(event, 'lineConnectionMode')

  useEffect(() => {
    const refresh = (): void => setShortcuts(loadShortcuts())
    window.addEventListener('moonsprite:shortcuts-changed', refresh)
    return () => window.removeEventListener('moonsprite:shortcuts-changed', refresh)
  }, [])

  const applyRotationStyle = (_view: DocumentSession['view']): void => {
    const styleKey = 'internal-canvas-rotation'
    if (appliedRotationStyleRef.current === styleKey) return
    appliedRotationStyleRef.current = styleKey
    for (const canvas of [canvasRef.current, selectionCanvasRef.current]) {
      if (!canvas) continue
      canvas.style.transform = 'none'
      canvas.style.transformOrigin = '50% 50%'
      canvas.style.willChange = ''
    }
  }

  const applyViewRotation = (context: CanvasRenderingContext2D, width: number, height: number, view: DocumentSession['view']): void => {
    if (Math.abs(view.rotation) < 0.000001 && !view.mirrored && !view.mirroredVertical) return
    const pivot = viewRotationPivot(width, height, view.panX, view.panY, rotationIndicatorPosition)
    context.translate(pivot.x, pivot.y)
    context.rotate(view.rotation * Math.PI / 180)
    context.scale(view.mirrored ? -1 : 1, view.mirroredVertical ? -1 : 1)
    context.translate(-pivot.x, -pivot.y)
  }

  const updateRotationIndicator = (rotation: number, visible: boolean): void => {
    const indicator = rotationIndicatorRef.current
    const pointer = rotationPointerRef.current
    if (!indicator || !pointer) return
    const bounds = stageBounds()
    const indicatorCenter = viewRotationPivot(bounds.width, bounds.height, liveViewRef.current.panX, liveViewRef.current.panY, rotationIndicatorPosition)
    indicator.hidden = !visible || !rotationIndicatorFitsCanvas(session.document.width, session.document.height, liveViewRef.current.zoom)
    indicator.style.left = `${indicatorCenter.x}px`
    indicator.style.top = `${indicatorCenter.y}px`
    pointer.style.transform = `rotate(${rotation}deg)`
  }

  useEffect(() => {
    const syncPreferences = (): void => {
      setRotationIndicatorPosition(parseRotationIndicatorPosition(localStorage.getItem(ROTATION_INDICATOR_POSITION_KEY)))
      setDrawingBrushPreviewEnabled(parseDrawingBrushPreviewEnabled(localStorage.getItem(DRAWING_BRUSH_PREVIEW_ENABLED_KEY)))
      setZoomToolDragMode(parseZoomToolDragMode(localStorage.getItem(ZOOM_TOOL_DRAG_MODE_PREFERENCE_KEY)))
    }
    window.addEventListener('moonsprite:preferences-changed', syncPreferences)
    return () => window.removeEventListener('moonsprite:preferences-changed', syncPreferences)
  }, [])

  useEffect(() => {
    const updatePreview = (event: Event): void => {
      const detail = (event as CustomEvent<{ documentId: string; preview: DocumentSession['canvasResizePreview'] }>).detail
      if (detail.documentId !== session.document.id) return
      canvasResizePreviewRef.current = detail.preview ? { ...detail.preview } : null
      scheduleDraw()
    }
    window.addEventListener(CANVAS_RESIZE_PREVIEW_EVENT, updatePreview)
    return () => window.removeEventListener(CANVAS_RESIZE_PREVIEW_EVENT, updatePreview)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.document.id])

  useEffect(() => {
    const releaseModifierSizing = (): void => { inputRef.current.modifierBrushSize = null }
    window.addEventListener('keyup', releaseModifierSizing)
    window.addEventListener('blur', releaseModifierSizing)
    return () => {
      window.removeEventListener('keyup', releaseModifierSizing)
      window.removeEventListener('blur', releaseModifierSizing)
      if (canvasResizeFrameRef.current !== null) window.cancelAnimationFrame(canvasResizeFrameRef.current)
    }
  }, [])

  const finishZoomPreview = (): DocumentSession['view'] => {
    const view = { ...liveViewRef.current }
    if (!zoomPreviewStartRef.current) return view
    const needsFinalDraw = viewFrameRef.current !== null
    if (viewFrameRef.current !== null) window.cancelAnimationFrame(viewFrameRef.current)
    if (zoomCommitTimerRef.current !== null) window.clearTimeout(zoomCommitTimerRef.current)
    viewFrameRef.current = null
    zoomCommitTimerRef.current = null
    zoomPreviewStartRef.current = null
    liveViewRef.current = view
    applyRotationStyle(view)
    useWorkspace.getState().setView({ zoom: view.zoom, panX: view.panX, panY: view.panY })
    pendingViewRef.current = null
    if (needsFinalDraw) draw()
    return view
  }

  const scheduleZoomPreview = (next: DocumentSession['view']): void => {
    if (!zoomPreviewStartRef.current) {
      zoomPreviewStartRef.current = { ...liveViewRef.current }
    }
    liveViewRef.current = next
    pendingViewRef.current = next
    if (viewFrameRef.current === null) {
      viewFrameRef.current = window.requestAnimationFrame(() => {
        viewFrameRef.current = null
        if (!zoomPreviewStartRef.current) return
        applyRotationStyle(liveViewRef.current)
        draw()
      })
    }
    if (zoomCommitTimerRef.current !== null) window.clearTimeout(zoomCommitTimerRef.current)
    zoomCommitTimerRef.current = window.setTimeout(finishZoomPreview, 120)
  }

  const beginPanPreview = (): void => {
    if (zoomPreviewStartRef.current) finishZoomPreview()
    pendingPanPreviewOffsetRef.current = null
  }

  const schedulePanPreview = (panX: number, panY: number, startPan: Point): void => {
    liveViewRef.current = { ...liveViewRef.current, panX, panY }
    pendingViewRef.current = { ...liveViewRef.current }
    const offset = { x: panX - startPan.x, y: panY - startPan.y }
    pendingPanPreviewOffsetRef.current = offset
    if (panPreviewFrameRef.current !== null) return
    panPreviewFrameRef.current = window.requestAnimationFrame(() => {
      panPreviewFrameRef.current = null
      const pending = pendingPanPreviewOffsetRef.current
      pendingPanPreviewOffsetRef.current = null
      if (pending) {
        draw()
      }
    })
  }

  const finishPanPreview = (): DocumentSession['view'] => {
    const view = { ...liveViewRef.current }
    if (panPreviewFrameRef.current !== null) window.cancelAnimationFrame(panPreviewFrameRef.current)
    panPreviewFrameRef.current = null
    pendingPanPreviewOffsetRef.current = null
    applyRotationStyle(view)
    useWorkspace.getState().setView({ panX: view.panX, panY: view.panY })
    pendingViewRef.current = null
    return view
  }

  const invalidateCompositeRect = (selection: SelectionRect | null | undefined): void => {
    if (!selection) return
    // Tiles include a one-pixel gutter so their scaled edges overlap. Invalidate
    // neighboring gutters too, otherwise a changed edge pixel could retain a
    // stale copy in the adjacent tile during a live stroke.
    const left = Math.max(0, selection.x - 1)
    const top = Math.max(0, selection.y - 1)
    const right = Math.min(session.document.width, selection.x + selection.width + 1)
    const bottom = Math.min(session.document.height, selection.y + selection.height + 1)
    if (right <= left || bottom <= top) return
    const firstTileX = Math.floor(left / COMPOSITE_TILE_SIZE)
    const firstTileY = Math.floor(top / COMPOSITE_TILE_SIZE)
    const lastTileX = Math.floor((right - 1) / COMPOSITE_TILE_SIZE)
    const lastTileY = Math.floor((bottom - 1) / COMPOSITE_TILE_SIZE)
    for (let tileY = firstTileY; tileY <= lastTileY; tileY += 1) {
      for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) compositeTilesRef.current.delete(`${tileX}:${tileY}`)
    }
  }

  const invalidateStrokeSegment = (from: Point, to: Point): void => {
    compositeSurfaceRef.current = null
    const stamp = brushStampDimensions(session.brushSize, activeBrushImage)
    const { x: beforeX, y: beforeY } = brushStampAnchor(session.brushSize, activeBrushImage)
    const afterX = stamp.width - beforeX - 1
    const afterY = stamp.height - beforeY - 1
    const left = Math.min(from.x, to.x) - beforeX
    const top = Math.min(from.y, to.y) - beforeY
    const right = Math.max(from.x, to.x) + afterX
    const bottom = Math.max(from.y, to.y) + afterY
    invalidateCompositeRect({ x: left, y: top, width: right - left + 1, height: bottom - top + 1 })
  }

  const flushSelectionPreview = (drag: DragState, render = false): void => {
    if (!drag.previewPending || !drag.selectionStart || !drag.previewTarget) return
    drag.previewPending = false
    const target = drag.previewTarget
    const angle = drag.previewAngle ?? 0
    drag.previewSelection = drag.kind === 'move-selection' || drag.kind === 'move-content'
      ? { ...drag.selectionStart, x: target.x, y: target.y }
      : transformSelectionMask(drag.selectionStart, target, session.document.width, session.document.height, angle)

    if (drag.kind !== 'move-selection' && drag.selectionSource) {
      compositeSurfaceRef.current = null
      invalidateCompositeRect(drag.selectionStart)
      invalidateCompositeRect(drag.appliedSelection)
      invalidateCompositeRect(drag.previewSelection)
      const translation = drag.kind === 'move-content' && angle === 0 && !target.flipHorizontal && !target.flipVertical && target.width === drag.selectionSource.selection.width && target.height === drag.selectionSource.selection.height
      if (translation) {
        if (drag.previewEdit) { revertPixelEdit(session.document, drag.previewEdit); drag.previewEdit = null }
        drag.translationPreview = applySelectionTranslationPreview(session.document, drag.selectionSource, target, drag.copy, drag.translationPreview)
      } else {
        if (drag.previewEdit) revertPixelEdit(session.document, drag.previewEdit)
        drag.previewEdit = applySelectionTransform(session.document, drag.selectionSource, target, angle, drag.copy)
      }
      drag.appliedSelection = drag.previewSelection
    }
    if (render) {
      if (drag.kind === 'move-selection') drawSelectionOverlay()
      else draw()
    }
  }

  const scheduleSelectionPreview = (drag: DragState): void => {
    drag.previewPending = true
    if (selectionPreviewFrameRef.current !== null) return
    selectionPreviewFrameRef.current = window.requestAnimationFrame(() => {
      selectionPreviewFrameRef.current = null
      if (inputRef.current.drag === drag) flushSelectionPreview(drag, true)
    })
  }

  const flushCanvasResizePreview = (): void => {
    if (canvasResizeFrameRef.current !== null) {
      window.cancelAnimationFrame(canvasResizeFrameRef.current)
      canvasResizeFrameRef.current = null
    }
    const pending = pendingCanvasResizeRef.current
    pendingCanvasResizeRef.current = null
    if (pending) useWorkspace.getState().setCanvasResizePreview(pending)
  }

  const scheduleCanvasResizePreview = (preview: NonNullable<DocumentSession['canvasResizePreview']>): void => {
    pendingCanvasResizeRef.current = preview
    canvasResizePreviewRef.current = preview
    scheduleDraw()
    if (canvasResizeFrameRef.current !== null) return
    canvasResizeFrameRef.current = window.requestAnimationFrame(() => {
      canvasResizeFrameRef.current = null
      const pending = pendingCanvasResizeRef.current
      pendingCanvasResizeRef.current = null
      if (pending) useWorkspace.getState().setCanvasResizePreview(pending)
    })
  }

  const geometry = (canvas: HTMLCanvasElement, selection: SelectionRect): { x: number; y: number; width: number; height: number } => {
    const bounds = stageBounds()
    const view = liveViewRef.current
    const origin = viewCanvasOrigin(bounds.width, bounds.height, session.document.width, session.document.height, view)
    return { x: origin.x + selection.x * view.zoom, y: origin.y + selection.y * view.zoom, width: selection.width * view.zoom, height: selection.height * view.zoom }
  }

  const drawSelection = (context: RasterContext2D, selection: SelectionMask, box: { x: number; y: number; width: number; height: number }, showHandles = true): void => {
    const phase = Math.floor(performance.now() / 180) % 8
    let cachedBoundary = selectionBoundaryCacheRef.current
    if (!cachedBoundary || cachedBoundary.width !== selection.width || cachedBoundary.height !== selection.height || cachedBoundary.mask !== selection.mask) {
      const segments = selectionBoundarySegments(selection)
      cachedBoundary = { width: selection.width, height: selection.height, mask: selection.mask, segments, screenPaths: new Map() }
      selectionBoundaryCacheRef.current = cachedBoundary
    }

    const zoom = Math.max(0.0001, box.width / Math.max(1, selection.width))
    const canvas = canvasRef.current
    const canvasWidth = canvas?.clientWidth ?? 0
    const canvasHeight = canvas?.clientHeight ?? 0
    const viewport = unrotatedViewportBounds(canvasWidth, canvasHeight, liveViewRef.current, rotationIndicatorPosition)
    // A noisy magic-wand selection can contain hundreds of thousands of edge
    // segments. Only put segments that can reach the visible overlay into the
    // Path2D. The cache key also prevents rebuilding that clipped path while
    // the marching-ant phase animates.
    const visibleLeft = Math.max(0, Math.floor((viewport.left - box.x) / zoom) - 1)
    const visibleTop = Math.max(0, Math.floor((viewport.top - box.y) / zoom) - 1)
    const visibleRight = Math.min(selection.width, Math.ceil((viewport.right - box.x) / zoom) + 1)
    const visibleBottom = Math.min(selection.height, Math.ceil((viewport.bottom - box.y) / zoom) + 1)
    const zoomKey = zoom.toFixed(6)
    const pathKey = `${zoomKey}:${visibleLeft}:${visibleTop}:${visibleRight}:${visibleBottom}`
    let screenPath = cachedBoundary.screenPaths.get(pathKey)
    if (!screenPath) {
      screenPath = new Path2D()
      for (let index = 0; index < cachedBoundary.segments.length; index += 4) {
        const x1 = cachedBoundary.segments[index]
        const y1 = cachedBoundary.segments[index + 1]
        const x2 = cachedBoundary.segments[index + 2]
        const y2 = cachedBoundary.segments[index + 3]
        if (Math.max(x1, x2) < visibleLeft || Math.min(x1, x2) > visibleRight || Math.max(y1, y2) < visibleTop || Math.min(y1, y2) > visibleBottom) continue
        const clippedX1 = Math.max(visibleLeft, Math.min(visibleRight, x1))
        const clippedY1 = Math.max(visibleTop, Math.min(visibleBottom, y1))
        const clippedX2 = Math.max(visibleLeft, Math.min(visibleRight, x2))
        const clippedY2 = Math.max(visibleTop, Math.min(visibleBottom, y2))
        const screenX1 = Math.round(clippedX1 * zoom)
        const screenY1 = Math.round(clippedY1 * zoom)
        const screenX2 = Math.round(clippedX2 * zoom)
        const screenY2 = Math.round(clippedY2 * zoom)
        if (screenX1 === screenX2 && screenY1 === screenY2) continue
        screenPath.moveTo(screenX1, screenY1)
        screenPath.lineTo(screenX2, screenY2)
      }
      cachedBoundary.screenPaths.set(pathKey, screenPath)
      if (cachedBoundary.screenPaths.size > 16) cachedBoundary.screenPaths.delete(cachedBoundary.screenPaths.keys().next().value!)
    }
    context.save()
    context.translate(Math.round(box.x) + 0.5, Math.round(box.y) + 0.5)
    context.lineWidth = 1
    context.lineCap = 'butt'
    context.lineJoin = 'miter'
    context.setLineDash([4, 4])
    context.lineDashOffset = -phase
    context.strokeStyle = '#111318'
    context.stroke(screenPath)
    context.lineDashOffset = -(phase + 4)
    context.strokeStyle = '#f7f7f7'
    context.stroke(screenPath)
    context.restore()
    if (!showHandles) return
    const handles: Array<[SelectionHandle, number, number]> = [
      ['nw', box.x, box.y], ['n', box.x + box.width / 2, box.y], ['ne', box.x + box.width, box.y],
      ['w', box.x, box.y + box.height / 2], ['e', box.x + box.width, box.y + box.height / 2],
      ['sw', box.x, box.y + box.height], ['s', box.x + box.width / 2, box.y + box.height], ['se', box.x + box.width, box.y + box.height]
    ]
    for (const [, x, y] of handles) {
      context.fillStyle = '#f7f7f7'
      context.fillRect(Math.round(x) - 4, Math.round(y) - 4, 8, 8)
      context.strokeStyle = '#111318'
      context.strokeRect(Math.round(x) - 4.5, Math.round(y) - 4.5, 9, 9)
    }
  }

  const drawSelectionOverlay = (): void => {
    const canvas = canvasRef.current
    const overlay = selectionCanvasRef.current
    if (!canvas || !overlay) return
    const currentSession = useWorkspace.getState().sessions.find((item) => item.document.id === session.document.id) ?? session
    const selectionDrag = inputRef.current.drag
    const creatingSelection = selectionDrag?.kind === 'marquee' || selectionDrag?.kind === 'lasso'
    const previewingSelection = selectionDrag?.kind === 'magic-preview' || selectionDrag?.kind === 'move-selection' || selectionDrag?.kind === 'move-content' || selectionDrag?.kind === 'transform-content' || selectionDrag?.kind === 'rotate-content'
    const visibleSelection = previewingSelection ? selectionDrag.previewSelection ?? currentSession.selection : currentSession.selection
    const creationSelection = creatingSelection ? selectionDrag.selectionStart : null
    if (!visibleSelection && !creationSelection && !selectionOverlayVisibleRef.current) return
    const rect = stageBounds()
    const dpr = window.devicePixelRatio || 1
    const backingWidth = Math.max(1, Math.round(rect.width * dpr))
    const backingHeight = Math.max(1, Math.round(rect.height * dpr))
    if (overlay.width !== backingWidth || overlay.height !== backingHeight) { overlay.width = backingWidth; overlay.height = backingHeight }
    const displayContext = overlay.getContext('2d')
    if (!displayContext) return
    displayContext.setTransform(dpr, 0, 0, dpr, 0, 0)
    displayContext.clearRect(0, 0, rect.width, rect.height)
    const rotated = Math.abs(liveViewRef.current.rotation) > 0.000001 || liveViewRef.current.mirrored || liveViewRef.current.mirroredVertical
    const sceneBounds = rotated ? unrotatedViewportBounds(rect.width, rect.height, liveViewRef.current, rotationIndicatorPosition) : { left: 0, top: 0, right: rect.width, bottom: rect.height }
    const sceneLeft = Math.floor(sceneBounds.left) - 2
    const sceneTop = Math.floor(sceneBounds.top) - 2
    const sceneWidth = Math.ceil(sceneBounds.right) - sceneLeft + 2
    const sceneHeight = Math.ceil(sceneBounds.bottom) - sceneTop + 2
    let context: RasterContext2D = displayContext
    if (rotated) {
      let scene = selectionRotationSceneRef.current
      const sceneBackingWidth = Math.max(1, Math.ceil(sceneWidth * dpr))
      const sceneBackingHeight = Math.max(1, Math.ceil(sceneHeight * dpr))
      if (!scene || scene.width !== sceneBackingWidth || scene.height !== sceneBackingHeight) {
        scene = new OffscreenCanvas(sceneBackingWidth, sceneBackingHeight)
        selectionRotationSceneRef.current = scene
      }
      const sceneContext = scene.getContext('2d')
      if (!sceneContext) return
      sceneContext.setTransform(dpr, 0, 0, dpr, -sceneLeft * dpr, -sceneTop * dpr)
      sceneContext.clearRect(sceneLeft, sceneTop, sceneWidth, sceneHeight)
      context = sceneContext
    }
    selectionOverlayVisibleRef.current = Boolean(visibleSelection || creationSelection)
    if (visibleSelection && !creatingSelection) drawSelection(context, visibleSelection, geometry(canvas, visibleSelection), currentSession.tool === 'selection')
    if (creationSelection) drawSelection(context, creationSelection, geometry(canvas, creationSelection), false)
    if (rotated) {
      displayContext.save()
      applyViewRotation(displayContext, rect.width, rect.height, liveViewRef.current)
      displayContext.imageSmoothingEnabled = false
      const scene = selectionRotationSceneRef.current!
      displayContext.drawImage(scene, 0, 0, scene.width, scene.height, sceneLeft, sceneTop, sceneWidth, sceneHeight)
      displayContext.restore()
    }
  }

  const draw = (): void => {
    const canvas = canvasRef.current
    if (!canvas) return
    const currentSession = useWorkspace.getState().sessions.find((item) => item.document.id === session.document.id) ?? session
    const currentActiveLayer = getActiveLayer(currentSession.document)
    const currentHasRasterSelection = !currentSession.selectedGroupId && currentSession.selectedLayerIds.some((id) => currentSession.document.layers.some((layer) => layer.id === id))
    const canRenderToolPreview = !canvasResizePreviewRef.current && currentHasRasterSelection && isLayerEffectivelyVisible(currentSession.document, currentActiveLayer) && !isLayerEffectivelyLocked(currentSession.document, currentActiveLayer)
    const rect = stageBounds()
    const dpr = window.devicePixelRatio || 1
    const backingWidth = Math.max(1, Math.round(rect.width * dpr))
    const backingHeight = Math.max(1, Math.round(rect.height * dpr))
    if (canvas.width !== backingWidth || canvas.height !== backingHeight) { canvas.width = backingWidth; canvas.height = backingHeight }
    const displayContext = canvas.getContext('2d')
    if (!displayContext) return
    displayContext.setTransform(dpr, 0, 0, dpr, 0, 0)
    displayContext.clearRect(0, 0, rect.width, rect.height)
    const document = session.document
    const view = liveViewRef.current
    const rotated = Math.abs(view.rotation) > 0.000001 || view.mirrored || view.mirroredVertical
    const viewport = unrotatedViewportBounds(rect.width, rect.height, view, rotationIndicatorPosition)
    const sceneLeft = Math.floor(viewport.left) - 2
    const sceneTop = Math.floor(viewport.top) - 2
    const sceneWidth = Math.ceil(viewport.right) - sceneLeft + 2
    const sceneHeight = Math.ceil(viewport.bottom) - sceneTop + 2
    let context: RasterContext2D = displayContext
    if (rotated) {
      let scene = rotationSceneRef.current
      const sceneBackingWidth = Math.max(1, Math.ceil(sceneWidth * dpr))
      const sceneBackingHeight = Math.max(1, Math.ceil(sceneHeight * dpr))
      if (!scene || scene.width !== sceneBackingWidth || scene.height !== sceneBackingHeight) {
        scene = new OffscreenCanvas(sceneBackingWidth, sceneBackingHeight)
        rotationSceneRef.current = scene
      }
      const sceneContext = scene.getContext('2d')
      if (!sceneContext) return
      sceneContext.setTransform(dpr, 0, 0, dpr, -sceneLeft * dpr, -sceneTop * dpr)
      sceneContext.clearRect(sceneLeft, sceneTop, sceneWidth, sceneHeight)
      context = sceneContext
    }
    const originX = rect.width / 2 + view.panX - document.width * view.zoom / 2
    const originY = rect.height / 2 + view.panY - document.height * view.zoom / 2
    const canvasWidth = document.width * view.zoom
    const canvasHeight = document.height * view.zoom

    context.fillStyle = '#4a4a51'
    context.fillRect(rotated ? sceneLeft : 0, rotated ? sceneTop : 0, rotated ? sceneWidth : rect.width, rotated ? sceneHeight : rect.height)
    context.save()
    context.save()
    context.beginPath()
    context.rect(originX, originY, canvasWidth, canvasHeight)
    context.clip()
    const checkerCell = 16 * view.zoom
    context.fillStyle = '#d7d7d9'
    context.fillRect(originX, originY, canvasWidth, canvasHeight)
    if (checkerCell >= 2) {
      const firstColumn = Math.max(0, Math.floor((viewport.left - originX) / checkerCell))
      const firstRow = Math.max(0, Math.floor((viewport.top - originY) / checkerCell))
      const lastColumn = Math.min(Math.ceil(document.width / 16), Math.ceil((viewport.right - originX) / checkerCell))
      const lastRow = Math.min(Math.ceil(document.height / 16), Math.ceil((viewport.bottom - originY) / checkerCell))
      context.fillStyle = '#9b9b9f'
      for (let row = firstRow; row < lastRow; row += 1) {
        for (let column = firstColumn; column < lastColumn; column += 1) {
          if ((column + row) % 2 === 0) continue
          context.fillRect(originX + column * checkerCell, originY + row * checkerCell, checkerCell, checkerCell)
        }
      }
    }
    context.restore()

    const fromX = Math.max(0, Math.floor((viewport.left - originX) / view.zoom))
    const fromY = Math.max(0, Math.floor((viewport.top - originY) / view.zoom))
    const toX = Math.min(document.width, Math.ceil((viewport.right - originX) / view.zoom))
    const toY = Math.min(document.height, Math.ceil((viewport.bottom - originY) / view.zoom))
    if (toX > fromX && toY > fromY) {
      const contentRevision = `${COMPOSITE_TILE_CACHE_VERSION}:${document.id}:${currentSession.revision}:${view.relativeLuminance ? 'luminance' : 'color'}`
      if (compositeRevisionRef.current !== contentRevision) {
        compositeRevisionRef.current = contentRevision
        compositeTilesRef.current.clear()
        compositeSurfaceRef.current = null
      }
      const activeDrag = inputRef.current.drag?.kind
      context.save()
      context.beginPath()
      context.rect(originX, originY, canvasWidth, canvasHeight)
      context.clip()
      context.imageSmoothingEnabled = false
      const canUseCompositeSurface = activeDrag !== 'draw'
        && activeDrag !== 'move-content'
        && activeDrag !== 'transform-content'
        && activeDrag !== 'rotate-content'
        && document.width * document.height <= MAX_COMPOSITE_SURFACE_PIXELS
      if (canUseCompositeSurface) {
        let surface = compositeSurfaceRef.current
        if (!surface || surface.revision !== contentRevision || surface.canvas.width !== document.width || surface.canvas.height !== document.height) {
          const pixels = compositeRegion(document, 0, 0, document.width, document.height)
          if (view.relativeLuminance) applyRelativeLuminance(pixels)
          const canvas = new OffscreenCanvas(document.width, document.height)
          canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(pixels), document.width, document.height), 0, 0)
          surface = { canvas, revision: contentRevision }
          compositeSurfaceRef.current = surface
        }
        context.drawImage(surface.canvas, originX, originY, canvasWidth, canvasHeight)
      } else {
        const firstTileX = Math.floor(fromX / COMPOSITE_TILE_SIZE)
        const firstTileY = Math.floor(fromY / COMPOSITE_TILE_SIZE)
        const lastTileX = Math.floor((toX - 1) / COMPOSITE_TILE_SIZE)
        const lastTileY = Math.floor((toY - 1) / COMPOSITE_TILE_SIZE)
        for (let tileY = firstTileY; tileY <= lastTileY; tileY += 1) {
          for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) {
            const startX = tileX * COMPOSITE_TILE_SIZE
            const startY = tileY * COMPOSITE_TILE_SIZE
            const width = Math.min(COMPOSITE_TILE_SIZE, document.width - startX)
            const height = Math.min(COMPOSITE_TILE_SIZE, document.height - startY)
            const key = `${tileX}:${tileY}`
            let tile = compositeTilesRef.current.get(key)
            if (!tile) {
              // WebView can leave a sub-pixel gap when two separately composited
              // canvases meet. Cache one neighboring source pixel on every side
              // so adjacent tiles overlap with identical content instead.
              const sourceX = Math.max(0, startX - 1)
              const sourceY = Math.max(0, startY - 1)
              const sourceRight = Math.min(document.width, startX + width + 1)
              const sourceBottom = Math.min(document.height, startY + height + 1)
              const sourceWidth = sourceRight - sourceX
              const sourceHeight = sourceBottom - sourceY
              const pixels = compositeRegion(document, sourceX, sourceY, sourceWidth, sourceHeight)
              if (view.relativeLuminance) applyRelativeLuminance(pixels)
              const source = new OffscreenCanvas(sourceWidth, sourceHeight)
              source.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(pixels), sourceWidth, sourceHeight), 0, 0)
              tile = { canvas: source, x: sourceX, y: sourceY, width: sourceWidth, height: sourceHeight }
              compositeTilesRef.current.set(key, tile)
              if (compositeTilesRef.current.size > MAX_COMPOSITE_TILES) {
                const oldest = compositeTilesRef.current.keys().next().value
                if (oldest !== undefined) compositeTilesRef.current.delete(oldest)
              }
            }
            // Rasterize overlapping source gutters in document coordinates.
            context.save()
            context.translate(originX, originY)
            context.scale(view.zoom, view.zoom)
            context.drawImage(tile.canvas, tile.x, tile.y)
            context.restore()
          }
        }
      }
      context.restore()
      if (view.showGrid && view.zoom >= 8) {
        context.strokeStyle = 'rgba(69,77,92,0.56)'
        context.lineWidth = 1
        context.beginPath()
        for (let x = fromX; x <= toX; x += 1) { const screenX = Math.round(originX + x * view.zoom) + 0.5; context.moveTo(screenX, originY + fromY * view.zoom); context.lineTo(screenX, originY + toY * view.zoom) }
        for (let y = fromY; y <= toY; y += 1) { const screenY = Math.round(originY + y * view.zoom) + 0.5; context.moveTo(originX + fromX * view.zoom, screenY); context.lineTo(originX + toX * view.zoom, screenY) }
        context.stroke()
      }
    }

    const activeLayer = getActiveLayer(document)
    const previewColorAt = (pixelX: number, pixelY: number, erase = false, coverage = 255, paintColor = session.primaryColor): RgbaColor => {
      const index = pixelY * document.width + pixelX
      const layerColor = readLayerColorAt(document, activeLayer, pixelX, pixelY)
      const replacement = erase
        ? coverage === 255 ? TRANSPARENT : { ...layerColor, a: Math.round(layerColor.a * (1 - coverage / 255)) }
        : coverage < 255 || (paintColor.a > 0 && paintColor.a < 255)
          ? blendOver(layerColor, { ...paintColor, a: Math.round(paintColor.a * coverage / 255) })
          : paintColor
      return compositePixelWithLayerColor(document, index, activeLayer.id, replacement)
    }
    const previewPixelRect = (pixelX: number, pixelY: number): { x: number; y: number; width: number; height: number } => {
      const left = Math.round(originX + pixelX * view.zoom)
      const top = Math.round(originY + pixelY * view.zoom)
      const right = Math.round(originX + (pixelX + 1) * view.zoom)
      const bottom = Math.round(originY + (pixelY + 1) * view.zoom)
      return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }
    }
    const drawPreviewPixel = (pixelX: number, pixelY: number, color: RgbaColor): { x: number; y: number; width: number; height: number } => {
      const pixelRect = previewPixelRect(pixelX, pixelY)
      const transparency = transparencyColorAt(pixelX, pixelY)
      const displayColor = view.relativeLuminance ? relativeLuminanceColor(color) : color
      context.fillStyle = `rgb(${transparency.r} ${transparency.g} ${transparency.b})`
      context.fillRect(pixelRect.x, pixelRect.y, pixelRect.width, pixelRect.height)
      if (displayColor.a > 0) {
        context.fillStyle = `rgb(${displayColor.r} ${displayColor.g} ${displayColor.b} / ${displayColor.a / 255})`
        context.fillRect(pixelRect.x, pixelRect.y, pixelRect.width, pixelRect.height)
      }
      return pixelRect
    }
    const drawSelectionPathPreview = (previewPixels: Iterable<string>): void => {
      context.save()
      context.beginPath()
      context.rect(originX, originY, canvasWidth, canvasHeight)
      context.clip()
      for (const value of previewPixels) {
        const [x, y] = value.split(':').map(Number)
        if (x < 0 || y < 0 || x >= document.width || y >= document.height) continue
        const sampled = sampleCompositeColor(document, x, y)
        const background = sampled.a > 0 ? sampled : transparencyColorAt(x, y)
        context.fillStyle = colorLuminance(background) > 145 ? '#111318' : '#f7f7f7'
        const pixelRect = previewPixelRect(x, y)
        context.fillRect(pixelRect.x, pixelRect.y, pixelRect.width, pixelRect.height)
      }
      context.restore()
    }
    const drawSelectionFillPreview = (selection: SelectionMask): void => {
      const left = Math.max(selection.x, fromX)
      const top = Math.max(selection.y, fromY)
      const right = Math.min(selection.x + selection.width, toX)
      const bottom = Math.min(selection.y + selection.height, toY)
      if (right <= left || bottom <= top) return
      context.save()
      context.beginPath()
      context.rect(originX, originY, canvasWidth, canvasHeight)
      context.clip()
      for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) {
        if (selectionContains(selection, x, y)) {
          const sampled = sampleCompositeColor(document, x, y)
          const background = sampled.a > 0 ? sampled : transparencyColorAt(x, y)
          context.fillStyle = colorLuminance(background) > 145 ? '#111318' : '#f7f7f7'
          const pixelRect = previewPixelRect(x, y)
          context.fillRect(pixelRect.x, pixelRect.y, pixelRect.width, pixelRect.height)
        }
      }
      context.restore()
    }
    const drawStrokePreview = (from: Point, to: Point, erase = false): void => {
      const stamp = brushStampDimensions(session.brushSize, session.tool === 'pencil' || session.tool === 'eraser' ? activeBrushImage : null)
      const { x: beforeX, y: beforeY } = brushStampAnchor(session.brushSize, session.tool === 'pencil' || session.tool === 'eraser' ? activeBrushImage : null)
      const patternOrigin = brushPatternOrigin(from)
      const drawn = new Set<number>()
      let x = from.x; let y = from.y
      const deltaX = Math.abs(to.x - from.x); const stepX = from.x < to.x ? 1 : -1
      const deltaY = -Math.abs(to.y - from.y); const stepY = from.y < to.y ? 1 : -1
      let error = deltaX + deltaY
      while (true) {
        const texture = session.tool === 'pencil' || session.tool === 'eraser' ? activeBrushTexture : 'solid'
        const mask = brushMaskOffsets(session.brushSize, session.brushShape, texture, session.brushTextureScale, x - beforeX, y - beforeY, session.tool === 'pencil' || session.tool === 'eraser' ? activeBrushImage : null, session.brushImageSettings, proceduralAntialiasStrength, activeBrushPreviewMode, patternOrigin.x, patternOrigin.y)
        for (const offset of mask) {
          const pixelX = x - beforeX + offset.x; const pixelY = y - beforeY + offset.y
          const index = pixelY * document.width + pixelX
          if (pixelX < fromX || pixelY < fromY || pixelX >= toX || pixelY >= toY || drawn.has(index) || (session.selection && !selectionContains(session.selection, pixelX, pixelY))) continue
          drawn.add(index)
          drawPreviewPixel(pixelX, pixelY, previewColorAt(pixelX, pixelY, erase, offset.coverage, offset.color ?? session.primaryColor))
        }
        if (x === to.x && y === to.y) break
        const twice = error * 2
        if (twice >= deltaY) { error += deltaY; x += stepX }
        if (twice <= deltaX) { error += deltaX; y += stepY }
      }
    }

    if (session.outlinePreview && session.selection) {
      const outlineLayer = getActiveLayer(document)
      const cachedOutline = outlinePreviewCacheRef.current
      const outlinePixels = cachedOutline && cachedOutline.revision === session.revision && cachedOutline.layerId === outlineLayer.id && cachedOutline.selection === session.selection && cachedOutline.preview === session.outlinePreview
        ? cachedOutline.indices
        : outlinePixelIndices(document, outlineLayer, session.selection, session.outlinePreview.thickness, session.outlinePreview.position, session.outlinePreview.directions, session.outlinePreview.kernel)
      if (outlinePixels !== cachedOutline?.indices) outlinePreviewCacheRef.current = { revision: session.revision, layerId: outlineLayer.id, selection: session.selection, preview: session.outlinePreview, indices: outlinePixels }
      for (const index of outlinePixels) {
        const pixelX = index % document.width
        const pixelY = Math.floor(index / document.width)
        const base = readLayerColorAt(document, outlineLayer, pixelX, pixelY)
        const color = session.outlinePreview.color.a > 0 && session.outlinePreview.color.a < 255
          ? blendOver(base, session.outlinePreview.color)
          : session.outlinePreview.color
        drawPreviewPixel(pixelX, pixelY, compositePixelWithLayerColor(document, index, outlineLayer.id, color))
      }
    }

    const drag = inputRef.current.drag
    if (canRenderToolPreview && drag?.kind === 'shape') {
      const shape = shapeBounds(drag.start, drag.last, drag.constrain)
      for (const point of shapePixelPoints(shape, session.shapeKind)) {
        if (point.x < 0 || point.y < 0 || point.x >= document.width || point.y >= document.height) continue
        const color = previewColorAt(point.x, point.y)
        drawPreviewPixel(point.x, point.y, color)
      }
    }
    if (lineConnectionConfigured && canRenderToolPreview && !inputRef.current.spaceHeld && !inputRef.current.sampling && (session.tool === 'pencil' || session.tool === 'eraser') && inputRef.current.shiftLinePreview && inputRef.current.pointer.visible && lineAnchor) {
      drawStrokePreview(lineAnchor, inputRef.current.pointer.point, session.tool === 'eraser')
    }

    context.strokeStyle = '#303641'
    context.lineWidth = 1
    context.strokeRect(Math.round(originX) + 0.5, Math.round(originY) + 0.5, canvasWidth, canvasHeight)
    if (canvasResizePreviewRef.current) {
      const preview = canvasResizePreviewRef.current
      const x = originX - preview.offsetX * view.zoom
      const y = originY - preview.offsetY * view.zoom
      const previewWidth = preview.width * view.zoom
      const previewHeight = preview.height * view.zoom
      const previewRevision = `${document.id}:${currentSession.revision}:${preview.width}:${preview.height}:${preview.offsetX}:${preview.offsetY}:${view.relativeLuminance ? 'luminance' : 'color'}`
      let previewSurface = canvasResizeSurfaceRef.current
      if (!previewSurface || previewSurface.revision !== previewRevision || previewSurface.canvas.width !== preview.width || previewSurface.canvas.height !== preview.height) {
        const pixels = compositeRegion(document, -preview.offsetX, -preview.offsetY, preview.width, preview.height)
        if (view.relativeLuminance) applyRelativeLuminance(pixels)
        const surface = new OffscreenCanvas(preview.width, preview.height)
        surface.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(pixels), preview.width, preview.height), 0, 0)
        previewSurface = { canvas: surface, revision: previewRevision }
        canvasResizeSurfaceRef.current = previewSurface
      }
      context.save()
      context.beginPath()
      context.rect(x, y, previewWidth, previewHeight)
      context.clip()
      context.beginPath()
      context.rect(0, 0, rect.width, rect.height)
      context.rect(originX, originY, canvasWidth, canvasHeight)
      context.clip('evenodd')
      context.fillStyle = '#bfc0c3'
      context.fillRect(x, y, previewWidth, previewHeight)
      const previewCheckerCell = 16 * view.zoom
      if (previewCheckerCell >= 2) {
        const firstColumn = Math.floor((Math.max(0, x) - originX) / previewCheckerCell)
        const firstRow = Math.floor((Math.max(0, y) - originY) / previewCheckerCell)
        const lastColumn = Math.ceil((Math.min(rect.width, x + previewWidth) - originX) / previewCheckerCell)
        const lastRow = Math.ceil((Math.min(rect.height, y + previewHeight) - originY) / previewCheckerCell)
        context.fillStyle = '#85868b'
        for (let row = firstRow; row < lastRow; row += 1) {
          for (let column = firstColumn; column < lastColumn; column += 1) {
            if ((column + row) % 2 === 0) continue
            context.fillRect(originX + column * previewCheckerCell, originY + row * previewCheckerCell, previewCheckerCell, previewCheckerCell)
          }
        }
      }
      context.restore()
      context.save()
      context.strokeStyle = '#090a0d'
      context.lineWidth = 1
      context.strokeRect(Math.round(originX) + 0.5, Math.round(originY) + 0.5, canvasWidth, canvasHeight)
      context.restore()
      context.save()
      context.fillStyle = 'rgba(0, 0, 0, 0.40)'
      context.beginPath()
      context.rect(x, y, previewWidth, previewHeight)
      context.clip()
      context.beginPath()
      context.rect(0, 0, rect.width, rect.height)
      context.rect(originX, originY, canvasWidth, canvasHeight)
      context.clip('evenodd')
      context.fillRect(x, y, previewWidth, previewHeight)
      context.restore()
      context.save()
      context.beginPath()
      context.rect(x, y, previewWidth, previewHeight)
      context.clip()
      context.imageSmoothingEnabled = false
      context.drawImage(previewSurface.canvas, x, y, previewWidth, previewHeight)
      context.restore()
      context.save()
      context.strokeStyle = '#2979ff'
      context.lineWidth = 2
      context.setLineDash([])
      context.beginPath()
      context.moveTo(Math.round(x) + 0.5, 0)
      context.lineTo(Math.round(x) + 0.5, rect.height)
      context.moveTo(Math.round(x + previewWidth) + 0.5, 0)
      context.lineTo(Math.round(x + previewWidth) + 0.5, rect.height)
      context.moveTo(0, Math.round(y) + 0.5)
      context.lineTo(rect.width, Math.round(y) + 0.5)
      context.moveTo(0, Math.round(y + previewHeight) + 0.5)
      context.lineTo(rect.width, Math.round(y + previewHeight) + 0.5)
      context.stroke()
      context.restore()
    }
    const selectionDrag = inputRef.current.drag
    if (selectionDrag?.kind === 'marquee') {
      const drag = selectionDrag
      const bounds = shapeBounds(drag.start, drag.last, drag.constrain)
      const previewSelection = session.selectionKind === 'ellipse'
        ? ellipseSelection(bounds.x, bounds.y, bounds.width, bounds.height)
        : rectSelection(bounds.x, bounds.y, bounds.width, bounds.height)
      drawSelectionPathPreview(selectionPreviewPixels(previewSelection))
    }
    if (inputRef.current.drag?.kind === 'lasso' && (inputRef.current.drag.path?.length ?? 0) > 1) {
      const previewPixels = new Set<string>()
      const addAxisLine = (from: Point, to: Point): void => {
        const stepX = Math.sign(to.x - from.x)
        const stepY = Math.sign(to.y - from.y)
        let x = from.x
        let y = from.y
        previewPixels.add(`${x}:${y}`)
        while (x !== to.x || y !== to.y) {
          x += stepX
          y += stepY
          previewPixels.add(`${x}:${y}`)
        }
      }
      const path = inputRef.current.drag.path ?? []
      for (let index = 1; index < path.length; index += 1) {
        const previous = path[index - 1]
        const point = path[index]
        if (Math.abs(point.x - previous.x) >= Math.abs(point.y - previous.y)) {
          addAxisLine(previous, { x: point.x, y: previous.y })
          addAxisLine({ x: point.x, y: previous.y }, point)
        } else {
          addAxisLine(previous, { x: previous.x, y: point.y })
          addAxisLine({ x: previous.x, y: point.y }, point)
        }
      }
      drawSelectionPathPreview(previewPixels)
    }
    if (inputRef.current.drag?.kind === 'magic-preview' && inputRef.current.drag.previewSelection) {
      drawSelectionFillPreview(inputRef.current.drag.previewSelection)
      drawSelectionPathPreview(selectionPreviewPixels(inputRef.current.drag.previewSelection))
    }

    if (canRenderToolPreview && !inputRef.current.drag && !inputRef.current.spaceHeld && !inputRef.current.sampling && inputRef.current.pointer.visible && session.tool === 'selection') {
      const point = inputRef.current.pointer.point
      const selectionHit = session.selection ? selectionHitAt(inputRef.current.pointer.clientX, inputRef.current.pointer.clientY) : 'outside'
      if (point.x >= 0 && point.y >= 0 && point.x < document.width && point.y < document.height && selectionHit === 'outside' && (!session.selection || !selectionContains(session.selection, point.x, point.y))) {
        const sampled = sampleCompositeColor(document, point.x, point.y)
        const background = sampled.a > 0 ? sampled : transparencyColorAt(point.x, point.y)
        const pixelRect = previewPixelRect(point.x, point.y)
        context.save()
        context.strokeStyle = colorLuminance(background) > 145 ? '#111318' : '#f7f7f7'
        context.lineWidth = 1
        context.strokeRect(pixelRect.x + 0.5, pixelRect.y + 0.5, Math.max(0, pixelRect.width - 1), Math.max(0, pixelRect.height - 1))
        context.restore()
      }
    }

    if (canRenderToolPreview && !inputRef.current.spaceHeld && inputRef.current.pointer.visible && !inputRef.current.sampling && session.tool === 'fill') {
      const point = inputRef.current.pointer.point
      if (point.x >= 0 && point.y >= 0 && point.x < document.width && point.y < document.height && (!session.selection || selectionContains(session.selection, point.x, point.y))) {
        drawPreviewPixel(point.x, point.y, previewColorAt(point.x, point.y))
      }
    }

    if (canRenderToolPreview && !inputRef.current.spaceHeld && inputRef.current.pointer.visible && !inputRef.current.sampling && session.tool === 'shape' && drag?.kind !== 'shape') {
      const point = inputRef.current.pointer.point
      const layer = getActiveLayer(document)
      if (point.x >= 0 && point.y >= 0 && point.x < document.width && point.y < document.height && !isLayerEffectivelyLocked(document, layer) && (!session.selection || selectionContains(session.selection, point.x, point.y))) {
        drawPreviewPixel(point.x, point.y, previewColorAt(point.x, point.y))
      }
    }

    if (canRenderToolPreview && !inputRef.current.spaceHeld && inputRef.current.pointer.visible && !inputRef.current.sampling && (!drag || (drag.kind === 'draw' && drawingBrushPreviewEnabled)) && (session.tool === 'pencil' || session.tool === 'eraser')) {
      const point = inputRef.current.pointer.point
      const drawing = drag?.kind === 'draw'
      const stamp = brushStampDimensions(session.brushSize, session.tool === 'pencil' || session.tool === 'eraser' ? activeBrushImage : null)
      const { x: beforeX, y: beforeY } = brushStampAnchor(session.brushSize, session.tool === 'pencil' || session.tool === 'eraser' ? activeBrushImage : null)
      context.save()
      context.beginPath()
      context.rect(originX, originY, canvasWidth, canvasHeight)
      context.clip()
      const texture = session.tool === 'pencil' || session.tool === 'eraser' ? activeBrushTexture : 'solid'
      const patternOrigin = brushPatternOrigin(point)
      const mask = brushMaskOffsets(session.brushSize, session.brushShape, texture, session.brushTextureScale, point.x - beforeX, point.y - beforeY, session.tool === 'pencil' || session.tool === 'eraser' ? activeBrushImage : null, session.brushImageSettings, proceduralAntialiasStrength, activeBrushPreviewMode, patternOrigin.x, patternOrigin.y)
      const occupied = new Set(mask.map((offset) => `${offset.x}:${offset.y}`))
      const sampled = session.tool === 'pencil' ? (drawing ? drag.color ?? session.primaryColor : session.primaryColor) : sampleCompositeColor(document, point.x, point.y)
      const luminance = colorLuminance(sampled)
      context.strokeStyle = luminance > 145 ? '#111318' : '#f7f7f7'
      context.lineWidth = Math.max(1, Math.min(2, view.zoom / 4))
      context.beginPath()
      for (const offset of mask) {
        const documentX = point.x - beforeX + offset.x
        const documentY = point.y - beforeY + offset.y
        if (documentX < 0 || documentY < 0 || documentX >= document.width || documentY >= document.height) continue
        const pixelRect = drawing
          ? previewPixelRect(documentX, documentY)
          : drawPreviewPixel(documentX, documentY, previewColorAt(documentX, documentY, session.tool === 'eraser', offset.coverage, offset.color ?? session.primaryColor))
        const left = !occupied.has(`${offset.x - 1}:${offset.y}`)
        const right = !occupied.has(`${offset.x + 1}:${offset.y}`)
        const top = !occupied.has(`${offset.x}:${offset.y - 1}`)
        const bottom = !occupied.has(`${offset.x}:${offset.y + 1}`)
        if (left) { context.moveTo(pixelRect.x, pixelRect.y); context.lineTo(pixelRect.x, pixelRect.y + pixelRect.height) }
        if (right) { context.moveTo(pixelRect.x + pixelRect.width, pixelRect.y); context.lineTo(pixelRect.x + pixelRect.width, pixelRect.y + pixelRect.height) }
        if (top) { context.moveTo(pixelRect.x, pixelRect.y); context.lineTo(pixelRect.x + pixelRect.width, pixelRect.y) }
        if (bottom) { context.moveTo(pixelRect.x, pixelRect.y + pixelRect.height); context.lineTo(pixelRect.x + pixelRect.width, pixelRect.y + pixelRect.height) }
      }
      context.stroke()
      context.restore()
    }

    context.restore()
    if (rotated) {
      displayContext.fillStyle = '#4a4a51'
      displayContext.fillRect(0, 0, rect.width, rect.height)
      displayContext.save()
      applyViewRotation(displayContext, rect.width, rect.height, view)
      displayContext.imageSmoothingEnabled = false
      const scene = rotationSceneRef.current!
      displayContext.drawImage(scene, 0, 0, scene.width, scene.height, sceneLeft, sceneTop, sceneWidth, sceneHeight)
      displayContext.restore()
    }
    displayContext.fillStyle = '#9aa3b2'
    displayContext.font = '12px ui-monospace, SFMono-Regular, Consolas, monospace'
    displayContext.fillText(`${document.width} x ${document.height}`, 12, rect.height - 12)
    if (view.mirrored || view.mirroredVertical) {
      const mirrorLabel = view.mirrored && view.mirroredVertical ? '水平 + 垂直镜像' : view.mirrored ? '水平镜像' : '垂直镜像'
      displayContext.fillStyle = '#d6dbe5'
      displayContext.fillText(`当前视图：${mirrorLabel}`, 12, rect.height - 30)
    }
    drawSelectionOverlay()
  }

  const scheduleDraw = (): void => {
    if (drawRequestRef.current !== null) return
    drawRequestRef.current = window.requestAnimationFrame(() => {
      drawRequestRef.current = null
      drawRef.current()
    })
  }

  drawRef.current = draw

  useLayoutEffect(() => {
    const pointer = inputRef.current.pointer
    if (pointer.visible) {
      const point = localPointAt(pointer.clientX, pointer.clientY)
      if (point) inputRef.current.updatePointer({ point, clientX: pointer.clientX, clientY: pointer.clientY, ctrlKey: inputRef.current.ctrlHeld, altKey: inputRef.current.altHeld })
      updateCursorAt(pointer.clientX, pointer.clientY, inputRef.current.ctrlHeld, inputRef.current.altHeld)
    }
    drawRef.current()
  // View rotation is rendered inside the canvas rather than by rotating the viewport element.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.view.rotation, session.view.mirrored, session.view.mirroredVertical, session.view.panX, session.view.panY, session.view.zoom])

  useEffect(() => {
    const updateShiftPreview = (active: boolean): void => {
      if (inputRef.current.shiftLinePreview === active) return
      inputRef.current.shiftLinePreview = active
      scheduleDraw()
    }
    const keyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Alt') inputRef.current.altHeld = true
      if (event.key === 'Control') {
        inputRef.current.ctrlHeld = true
        if (session.tool === 'rotate') {
          const drag = inputRef.current.drag
          if (drag?.kind === 'rotate-view') {
            liveViewRef.current = { ...liveViewRef.current, rotation: 0 }
            applyRotationStyle(liveViewRef.current)
            updateRotationIndicator(0, true)
            useWorkspace.getState().setView({ rotation: 0 })
            scheduleDraw()
          }
        }
      }
      if (event.code === 'Space') {
        const target = event.target as HTMLElement | null
        if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT' || target?.isContentEditable) return
        event.preventDefault()
        if (!inputRef.current.spaceHeld) {
          inputRef.current.spaceHeld = true
          inputRef.current.sampling = false
          if (canvasRef.current && inputRef.current.pointer.visible) canvasRef.current.style.cursor = inputRef.current.drag?.kind === 'pan' ? canvasCursors.grabbing : canvasCursors.grab
          scheduleDraw()
        }
        return
      }
      if (inputRef.current.spaceHeld) return
      if (lineConnectionActive(event) && (session.tool === 'pencil' || session.tool === 'eraser') && lineAnchor && inputRef.current.pointer.visible) updateShiftPreview(true)
      const modifierSizing = event.ctrlKey && event.altKey && (session.tool === 'pencil' || session.tool === 'eraser')
      if (modifierSizing) {
        inputRef.current.sampling = false
        scheduleDraw()
      } else if (event.key === 'Alt' && inputRef.current.pointer.visible) {
        event.preventDefault()
        updateCursorAt(inputRef.current.pointer.clientX, inputRef.current.pointer.clientY, inputRef.current.ctrlHeld, true)
        scheduleDraw()
      } else if (event.key === 'Control' && inputRef.current.pointer.visible) {
        updateCursorAt(inputRef.current.pointer.clientX, inputRef.current.pointer.clientY, true, inputRef.current.altHeld)
        scheduleDraw()
      }
    }
    const keyUp = (event: KeyboardEvent): void => {
      if (event.code === 'Space') {
        event.preventDefault()
        inputRef.current.spaceHeld = false
        if (canvasRef.current) canvasRef.current.style.cursor = canvasToolCursor(session.tool, session.primaryColor)
        scheduleDraw()
        return
      }
      if (lineConnectionConfigured && !lineConnectionActive(event)) updateShiftPreview(false)
      if (event.key === 'Alt' || event.key === 'Control') {
        if (event.key === 'Alt') { event.preventDefault(); inputRef.current.altHeld = false }
        if (event.key === 'Control') inputRef.current.ctrlHeld = false
        inputRef.current.sampling = session.tool === 'eyedropper'
        inputRef.current.modifierBrushSize = null
        if (inputRef.current.pointer.visible) updateCursorAt(inputRef.current.pointer.clientX, inputRef.current.pointer.clientY, inputRef.current.ctrlHeld, inputRef.current.altHeld)
        else if (canvasRef.current) canvasRef.current.style.cursor = inputRef.current.sampling ? canvasCursors.eyedropper : canvasToolCursor(session.tool, session.primaryColor)
        scheduleDraw()
      }
    }
    const blur = (): void => {
      updateShiftPreview(false)
      inputRef.current.spaceHeld = false
      inputRef.current.sampling = false
      inputRef.current.altHeld = false
      inputRef.current.ctrlHeld = false
      inputRef.current.modifierBrushSize = null
      if (canvasRef.current) canvasRef.current.style.cursor = canvasToolCursor(session.tool, session.primaryColor)
    }
    const visibilityChange = (): void => { if (document.hidden) blur() }
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('blur', blur)
    document.addEventListener('visibilitychange', visibilityChange)
    return () => { window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibilityChange) }
  }, [session.tool, lineAnchor, lineConnectionShortcut])

  useEffect(() => {
    draw()
    const renderSelection = (): void => {
      drawSelectionOverlay()
      const currentSession = useWorkspace.getState().sessions.find((item) => item.document.id === session.document.id)
      if (currentSession?.selection) rafRef.current = window.setTimeout(renderSelection, 160)
    }
    if (session.selection) rafRef.current = window.setTimeout(renderSelection, 160)
    const observer = new ResizeObserver(() => draw())
    if (canvasRef.current) observer.observe(canvasRef.current)
    return () => {
      observer.disconnect()
      if (rafRef.current) window.clearTimeout(rafRef.current)
      if (drawRequestRef.current) window.cancelAnimationFrame(drawRequestRef.current)
      if (viewFrameRef.current) window.cancelAnimationFrame(viewFrameRef.current)
      if (zoomCommitTimerRef.current !== null) window.clearTimeout(zoomCommitTimerRef.current)
      if (panPreviewFrameRef.current) window.cancelAnimationFrame(panPreviewFrameRef.current)
      if (selectionPreviewFrameRef.current) window.cancelAnimationFrame(selectionPreviewFrameRef.current)
      drawRequestRef.current = null
      viewFrameRef.current = null
      zoomCommitTimerRef.current = null
      zoomPreviewStartRef.current = null
      panPreviewFrameRef.current = null
      selectionPreviewFrameRef.current = null
      pendingViewRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, session.revision, session.view.showGrid, session.view.relativeLuminance, session.view.mirrored, session.view.mirroredVertical, session.selection, session.outlinePreview, session.brushSize, session.brushShape, session.shapeKind, session.fillMode, drawingBrushPreviewEnabled, lineConnectionShortcut, rotationIndicatorPosition])

  const unrotatedStagePoint = (clientX: number, clientY: number): Point => {
    const bounds = stageBounds()
    const view = liveViewRef.current
    const pivot = viewRotationPivot(bounds.width, bounds.height, view.panX, view.panY, rotationIndicatorPosition)
    return unrotateViewportPoint({ x: clientX - bounds.left, y: clientY - bounds.top }, pivot, view.rotation)
  }

  const localPointAt = (clientX: number, clientY: number): Point | null => {
    if (!canvasRef.current) return null
    const bounds = stageBounds()
    return documentPointFromViewportPoint({ x: clientX - bounds.left, y: clientY - bounds.top }, bounds.width, bounds.height, session.document.width, session.document.height, liveViewRef.current, rotationIndicatorPosition)
  }

  const localPoint = (event: React.PointerEvent<HTMLCanvasElement>): Point | null => localPointAt(event.clientX, event.clientY)

  const clampSelectionPoint = (point: Point): Point => ({
    x: Math.max(0, Math.min(session.document.width - 1, point.x)),
    y: Math.max(0, Math.min(session.document.height - 1, point.y))
  })

  const topEditableLayerAt = (point: Point) => {
    for (let index = session.document.layers.length - 1; index >= 0; index -= 1) {
      const layer = session.document.layers[index]
      if (!isLayerEffectivelyVisible(session.document, layer) || isLayerEffectivelyLocked(session.document, layer)) continue
      if (readLayerColorAt(session.document, layer, point.x, point.y).a > 0) return layer
    }
    return null
  }

  const selectionHitAt = (clientX: number, clientY: number): SelectionHit => {
    if (!session.selection || !canvasRef.current) return 'outside'
    const point = localPointAt(clientX, clientY)
    if (!point) return 'outside'
    const box = session.selection
    const hitRadius = 7 / Math.max(0.0001, liveViewRef.current.zoom)
    const resizeHit = selectionResizeHit(box, point, hitRadius)
    if (resizeHit) return resizeHit
    // PS 风格：旋转仍然在四角外侧，但提供足够大的无形命中区。
    const rotationHit = selectionRotationHit(box, point, 1 / Math.max(0.0001, liveViewRef.current.zoom))
    if (rotationHit) return rotationHit
    const edgeOuterRadius = 9 / Math.max(0.0001, liveViewRef.current.zoom)
    const edgeInnerRadius = 7 / Math.max(0.0001, liveViewRef.current.zoom)
    const leftEdge = box.x
    const topEdge = box.y
    const rightEdge = box.x + box.width
    const bottomEdge = box.y + box.height
    const spansHorizontalEdge = point.x >= leftEdge - edgeOuterRadius && point.x <= rightEdge + edgeOuterRadius
    const spansVerticalEdge = point.y >= topEdge - edgeOuterRadius && point.y <= bottomEdge + edgeOuterRadius
    const nearTop = point.y >= topEdge - edgeOuterRadius && point.y <= topEdge + edgeInnerRadius
    const nearBottom = point.y >= bottomEdge - edgeInnerRadius && point.y <= bottomEdge + edgeOuterRadius
    const nearLeft = point.x >= leftEdge - edgeOuterRadius && point.x <= leftEdge + edgeInnerRadius
    const nearRight = point.x >= rightEdge - edgeInnerRadius && point.x <= rightEdge + edgeOuterRadius
    const nearHorizontalEdge = spansHorizontalEdge && (nearTop || nearBottom)
    const nearVerticalEdge = spansVerticalEdge && (nearLeft || nearRight)
    if (nearHorizontalEdge || nearVerticalEdge) return 'edge'
    const within = point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height
    if (!within) return 'outside'
    return point && selectionContains(session.selection, point.x, point.y) ? 'inside' : 'outside'
  }

  const selectionHit = (event: React.PointerEvent<HTMLCanvasElement>): SelectionHit => selectionHitAt(event.clientX, event.clientY)

  const canvasResizeHitAt = (clientX: number, clientY: number): DragState['canvasEdge'] | null => {
    const preview = canvasResizePreviewRef.current
    const canvas = canvasRef.current
    if (!preview || !canvas) return null
    const bounds = stageBounds()
    const view = liveViewRef.current
    const originX = bounds.width / 2 + view.panX - session.document.width * view.zoom / 2
    const originY = bounds.height / 2 + view.panY - session.document.height * view.zoom / 2
    const left = originX - preview.offsetX * view.zoom
    const top = originY - preview.offsetY * view.zoom
    const right = left + preview.width * view.zoom
    const bottom = top + preview.height * view.zoom
    const unrotated = unrotatedStagePoint(clientX, clientY)
    const x = unrotated.x; const y = unrotated.y
    const radius = 8
    const nearLeft = Math.abs(x - left) <= radius; const nearRight = Math.abs(x - right) <= radius
    const nearTop = Math.abs(y - top) <= radius; const nearBottom = Math.abs(y - bottom) <= radius
    if (nearTop && nearLeft) return 'nw'; if (nearTop && nearRight) return 'ne'; if (nearBottom && nearLeft) return 'sw'; if (nearBottom && nearRight) return 'se'
    if (nearTop && x >= left && x <= right) return 'n'; if (nearBottom && x >= left && x <= right) return 's'
    if (nearLeft && y >= top && y <= bottom) return 'w'; if (nearRight && y >= top && y <= bottom) return 'e'
    return null
  }

  const canvasResizeHit = (event: React.PointerEvent<HTMLCanvasElement>): DragState['canvasEdge'] | null => canvasResizeHitAt(event.clientX, event.clientY)

  const canvasResizeContainsAt = (clientX: number, clientY: number): boolean => {
    const preview = canvasResizePreviewRef.current
    const canvas = canvasRef.current
    if (!preview || !canvas) return false
    const bounds = stageBounds()
    const view = liveViewRef.current
    const originX = bounds.width / 2 + view.panX - session.document.width * view.zoom / 2
    const originY = bounds.height / 2 + view.panY - session.document.height * view.zoom / 2
    const left = originX - preview.offsetX * view.zoom
    const top = originY - preview.offsetY * view.zoom
    const unrotated = unrotatedStagePoint(clientX, clientY)
    const x = unrotated.x
    const y = unrotated.y
    return x >= left && x <= left + preview.width * view.zoom && y >= top && y <= top + preview.height * view.zoom
  }


  const canvasResizeContains = (event: React.PointerEvent<HTMLCanvasElement>): boolean => canvasResizeContainsAt(event.clientX, event.clientY)

  const updateCursorAt = (clientX: number, clientY: number, ctrlKey: boolean, altKey: boolean): void => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (inputRef.current.spaceHeld) {
      inputRef.current.sampling = false
      canvas.style.cursor = inputRef.current.drag?.kind === 'pan' ? canvasCursors.grabbing : canvasCursors.grab
      return
    }
    const activeResizePreview = canvasResizePreviewRef.current
    if (activeResizePreview) {
      inputRef.current.sampling = false
      inputRef.current.shiftLinePreview = false
      const drag = inputRef.current.drag
      const resizeEdge = drag?.kind === 'canvas-resize' ? drag.canvasEdge : canvasResizeHitAt(clientX, clientY)
      if (resizeEdge) canvas.style.cursor = resizeEdge === 'n' || resizeEdge === 's' ? canvasCursors.nsResize : resizeEdge === 'e' || resizeEdge === 'w' ? canvasCursors.ewResize : resizeEdge === 'nw' || resizeEdge === 'se' ? canvasCursors.nwseResize : canvasCursors.neswResize
      else if (drag?.kind === 'canvas-move') canvas.style.cursor = canvasCursors.move
      else canvas.style.cursor = canvasResizeContainsAt(clientX, clientY) ? canvasCursors.move : canvasCursors.unavailable
      return
    }
    const point = localPointAt(clientX, clientY)
    const insideDocument = Boolean(point && point.x >= 0 && point.y >= 0 && point.x < session.document.width && point.y < session.document.height)
    let contrastColor = insideDocument && point ? sampleCompositeColor(session.document, point.x, point.y) : session.primaryColor
    if (insideDocument && point && activeLayerEditable && previewCursorTools.has(session.tool) && (!session.selection || selectionContains(session.selection, point.x, point.y))) {
      const layer = getActiveLayer(session.document)
      if (!isLayerEffectivelyLocked(session.document, layer)) {
        const index = point.y * session.document.width + point.x
        const source = session.tool === 'eraser' ? TRANSPARENT : session.primaryColor
        const replacement = source.a > 0 && source.a < 255 ? blendOver(readLayerColor(session.document, layer, index), source) : source
        contrastColor = compositePixelWithLayerColor(session.document, index, layer.id, replacement)
      }
    }
    if (insideDocument && point && contrastColor.a < 255) contrastColor = blendOver(transparencyColorAt(point.x, point.y), contrastColor)
    if (inputRef.current.drag?.kind === 'move-content' || inputRef.current.drag?.kind === 'move-selection') {
      inputRef.current.sampling = false
      canvas.style.cursor = inputRef.current.drag.kind === 'move-content'
        ? inputRef.current.drag.copy ? canvasCursors.copy : canvasCursors.move
        : canvasCursors.selectionMove
      return
    }
    if (inputRef.current.drag?.kind === 'move-layer') {
      inputRef.current.sampling = false
      canvas.style.cursor = inputRef.current.drag.duplicateOnDrag ? canvasCursors.copy : canvasCursors.move
      return
    }
    if (inputRef.current.drag?.kind === 'marquee' || inputRef.current.drag?.kind === 'lasso' || inputRef.current.drag?.kind === 'magic-preview') {
      inputRef.current.sampling = false
      canvas.style.cursor = canvasToolCursor('selection', contrastColor)
      return
    }
    const altActive = inputRef.current.altHeld || altKey
    const ctrlActive = inputRef.current.ctrlHeld || ctrlKey
    const modifierSizing = ctrlKey && altActive && (session.tool === 'pencil' || session.tool === 'eraser')
    const selectionHit = session.tool === 'selection' ? selectionHitAt(clientX, clientY) : 'outside'
    const moveCopyAvailable = session.tool === 'move' && insideDocument && Boolean(session.moveAutoSelect ? (point && topEditableLayerAt(point)) : activeLayerEditable)
    const selectionCopyAvailable = session.tool === 'selection' && !altActive && ctrlActive && selectionHit === 'inside' && activeLayerEditable && !session.pendingPaste
    const copyAvailable = (altActive && moveCopyAvailable) || selectionCopyAvailable
    const sampling = session.tool === 'eyedropper' || (altActive && !(session.tool === 'move' && moveCopyAvailable) && !modifierSizing)
    inputRef.current.sampling = sampling
    const available = insideDocument && activeLayerEditable
    const resizeEdge = canvasResizeHitAt(clientX, clientY)
    if (resizeEdge) { canvas.style.cursor = resizeEdge === 'n' || resizeEdge === 's' ? canvasCursors.nsResize : resizeEdge === 'e' || resizeEdge === 'w' ? canvasCursors.ewResize : resizeEdge === 'nw' || resizeEdge === 'se' ? canvasCursors.nwseResize : canvasCursors.neswResize }
    else if (modifierSizing) canvas.style.cursor = canvasCursors.ewResize
    else if (copyAvailable) canvas.style.cursor = canvasCursors.copy
    else if (sampling) canvas.style.cursor = canvasCursors.eyedropper
    else if (session.tool === 'selection') {
      const hit = selectionHit
      canvas.style.cursor = hit in resizeCursors
        ? resizeCursors[hit as SelectionHandle]
        : hit in rotationCursors
          ? rotationCursors[hit as SelectionRotationHandle]
          : hit === 'inside'
            ? canvasCursors.move
            : hit === 'edge'
              ? canvasCursors.selectionMove
            : canvasToolCursor(session.tool, contrastColor, available)
    } else canvas.style.cursor = canvasToolCursor(session.tool, contrastColor, available)
  }

  const updateCursor = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const point = localPointAt(event.clientX, event.clientY)
    if (point) inputRef.current.updatePointer({ point, clientX: event.clientX, clientY: event.clientY, ctrlKey: event.ctrlKey, altKey: event.altKey })
    updateCursorAt(event.clientX, event.clientY, event.ctrlKey, event.altKey)
  }

  useEffect(() => {
    const pointer = inputRef.current.pointer
    if (!pointer.visible) return
    updateCursorAt(pointer.clientX, pointer.clientY, inputRef.current.ctrlHeld, inputRef.current.altHeld)
    scheduleDraw()
  // Cursor assets and the preview under a stationary pointer must change with the selected tool.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.tool, session.selectionKind, session.primaryColor.r, session.primaryColor.g, session.primaryColor.b, session.primaryColor.a, activeLayerEditable])

  const markChanged = (dirty = true): void => useWorkspace.getState().mutateActive(() => {}, dirty)
  const activeColor = (button = 0): RgbaColor => session.tool === 'eraser' ? TRANSPARENT : button === 2 ? session.secondaryColor : session.primaryColor

  const pointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    event.currentTarget.tabIndex = -1
    event.currentTarget.focus({ preventScroll: true })
    const state = useWorkspace.getState()
    if (zoomPreviewStartRef.current) finishZoomPreview()
    if (state.activeId !== session.document.id) { state.setActive(session.document.id); return }
    if (event.button === 1 || (event.button === 0 && inputRef.current.spaceHeld)) {
      const origin = { x: 0, y: 0 }
      const view = liveViewRef.current
      inputRef.current.drag = { kind: 'pan', start: origin, last: origin, startPan: { x: view.panX, y: view.panY }, startClient: { x: event.clientX, y: event.clientY } }
      beginPanPreview()
      event.currentTarget.setPointerCapture(event.pointerId)
      event.currentTarget.style.cursor = canvasCursors.grabbing
      event.preventDefault()
      return
    }
    const point = localPoint(event)
    if (!point) return
    const selectionPoint = clampSelectionPoint(point)
    inputRef.current.updatePointer({ point, clientX: event.clientX, clientY: event.clientY, ctrlKey: event.ctrlKey, altKey: event.altKey })
    event.currentTarget.setPointerCapture(event.pointerId)
    const resizeEdge = canvasResizeHit(event)
    const activeResizePreview = canvasResizePreviewRef.current
    if (activeResizePreview) {
      inputRef.current.sampling = false
      inputRef.current.shiftLinePreview = false
      if (event.button === 0 && resizeEdge) {
        inputRef.current.drag = { kind: 'canvas-resize', start: point, last: point, canvasEdge: resizeEdge, canvasPreview: { ...activeResizePreview } }
      } else if (event.button === 0 && canvasResizeContains(event)) {
        inputRef.current.drag = { kind: 'canvas-move', start: point, last: point, canvasPreview: { ...activeResizePreview } }
        event.currentTarget.style.cursor = canvasCursors.move
      }
      return
    }
    const focusesRasterLayer = event.button === 0
      && session.tool !== 'hand'
      && session.tool !== 'zoom'
      && session.tool !== 'move'
      && (session.selectedGroupId !== null || session.selectedLayerIds.length > 1)
    if (focusesRasterLayer) state.selectLayer(session.document.activeLayerId)
    const hasRasterFocus = hasSelectedRasterLayer || focusesRasterLayer
    if (event.ctrlKey && event.altKey && (session.tool === 'pencil' || session.tool === 'eraser') && !activeBrushImage?.intrinsicSize && event.button === 0) {
      inputRef.current.sampling = false
      inputRef.current.drag = { kind: 'brush-size', start: point, last: point, startClient: { x: event.clientX, y: event.clientY }, startBrushSize: session.brushSize }
      event.currentTarget.style.cursor = canvasCursors.ewResize
      return
    }
    const sampleAtPoint = (temporarySampling = true): void => {
      if (point.x < 0 || point.y < 0 || point.x >= session.document.width || point.y >= session.document.height) return
      const secondary = event.button === 2
      const setSampledColor = secondary ? state.setSecondaryColor : state.setPrimaryColor
      setSampledColor(sampleCompositeColor(session.document, point.x, point.y))
      inputRef.current.sampling = true
      inputRef.current.drag = { kind: 'sample-color', start: point, last: point, sampleSecondary: secondary, temporarySampling }
      event.currentTarget.style.cursor = canvasCursors.eyedropper
      draw()
    }
    const selectionTool = session.tool === 'selection'
    const selectionMode = (): SelectionMode => event.shiftKey ? 'add' : session.selectionMode
    const editableLayer = getActiveLayer(session.document)
    const canEditLayer = hasRasterFocus && isLayerEffectivelyVisible(session.document, editableLayer) && !isLayerEffectivelyLocked(session.document, editableLayer)
    const eyedropperHeld = modifierActive(event.nativeEvent, 'temporaryEyedropper')
    const copyLayerHeld = modifierActive(event.nativeEvent, 'copyLayerOnDrag')
    if (selectionTool && event.button === 0 && !canEditLayer && !eyedropperHeld) return
    if (session.tool === 'move' && event.button === 0) {
      const selectedMovableLayers = (session.selectedGroupId ? [] : session.selectedLayerIds)
        .map((id) => session.document.layers.find((layer) => layer.id === id))
        .filter((layer): layer is RasterLayer => Boolean(layer && isLayerEffectivelyVisible(session.document, layer) && !isLayerEffectivelyLocked(session.document, layer)))
      const moveAllSelectedLayers = selectedMovableLayers.length > 1
      const target = moveAllSelectedLayers
        ? selectedMovableLayers.find((layer) => layer.id === session.document.activeLayerId) ?? selectedMovableLayers[0]
        : session.moveAutoSelect ? topEditableLayerAt(point) : (canEditLayer ? editableLayer : null)
      if (!target) { if (eyedropperHeld) sampleAtPoint(); return }
      if (session.moveAutoSelect && !moveAllSelectedLayers) state.selectLayer(target.id)
      const layerIds = (moveAllSelectedLayers ? selectedMovableLayers.map((layer) => layer.id) : [target.id]).filter((id) => {
        const layer = session.document.layers.find((candidate) => candidate.id === id)
        return Boolean(layer && isLayerEffectivelyVisible(session.document, layer) && !isLayerEffectivelyLocked(session.document, layer))
      })
      const layerOffsets = Object.fromEntries(layerIds.map((id) => {
        const layer = session.document.layers.find((candidate) => candidate.id === id)!
        return [id, { x: layer.offsetX, y: layer.offsetY }]
      }))
      inputRef.current.drag = {
        kind: 'move-layer', start: point, last: point, layerId: target.id,
        layerOffset: { x: target.offsetX, y: target.offsetY }, layerIds, layerOffsets, duplicateOnDrag: copyLayerHeld && layerIds.length === 1,
        originalSelectedLayerIds: [...session.selectedLayerIds]
      }
      event.currentTarget.style.cursor = copyLayerHeld ? canvasCursors.copy : canvasCursors.move
      return
    }
    if (session.tool === 'rotate' && event.altKey && (event.button === 0 || event.button === 2)) {
      sampleAtPoint()
      return
    }
    if (session.tool === 'rotate' && event.button === 0) {
      const bounds = stageBounds()
      const pivot = viewRotationPivot(bounds.width, bounds.height, liveViewRef.current.panX, liveViewRef.current.panY, rotationIndicatorPosition)
      const angle = Math.atan2(event.clientY - bounds.top - pivot.y, event.clientX - bounds.left - pivot.x) * 180 / Math.PI
      inputRef.current.drag = { kind: 'rotate-view', start: point, last: point, startAngle: angle, startRotation: liveViewRef.current.rotation, startPan: { x: liveViewRef.current.panX, y: liveViewRef.current.panY } }
      updateRotationIndicator(liveViewRef.current.rotation, true)
      return
    }
    if (lineConnectionActive(event.nativeEvent) && hasRasterFocus && (session.tool === 'pencil' || session.tool === 'eraser') && lineAnchor && event.button === 0) {
      if (canEditLayer) {
        const edit = beginPixelEdit(editableLayer.id)
        paintLine(session.document, editableLayer, edit, lineAnchor.x, lineAnchor.y, point.x, point.y, session.brushSize, activeColor(), session.selection, session.brushShape, session.tool === 'pencil' || session.tool === 'eraser' ? activeBrushTexture : 'solid', session.brushTextureScale, session.tool === 'pencil' || session.tool === 'eraser' ? activeBrushImage : null, session.brushImageSettings, proceduralAntialiasStrength, activeBrushPaintMode, brushPatternOrigin(lineAnchor))
        state.commitPixelEdit(edit, session.tool === 'eraser' ? '橡皮擦直线' : '铅笔直线')
        if (session.tool === 'eraser') state.setLastEraserPoint(point)
        else state.setLastPencilPoint(point)
      }
      return
    }
    if (selectionTool && event.button === 0) {
      const mode = selectionMode()
      const hit = selectionHit(event)
      if (event.altKey) { sampleAtPoint(); return }
      if (hit === 'inside' && session.selection) {
        const floating = session.pendingPaste
        const source = floating?.source ?? captureSelectionTransform(session.document, session.selection)
        if (source) {
          const selectionStart = cloneSelection(session.selection)
          inputRef.current.drag = { kind: 'move-content', start: point, last: point, selectionStart, selectionSource: source, previewEdit: floating?.previewEdit, copy: floating ? true : event.ctrlKey, floatingPaste: Boolean(floating), previewSelection: selectionStart, appliedSelection: selectionStart }
          event.currentTarget.style.cursor = !floating && event.ctrlKey ? canvasCursors.copy : canvasCursors.move
          return
        }
        return
      }
      if (hit === 'edge' && session.selection) {
        if (session.pendingPaste) {
          const selectionStart = cloneSelection(session.selection)
          inputRef.current.drag = { kind: 'move-content', start: point, last: point, selectionStart, selectionSource: session.pendingPaste.source, previewEdit: session.pendingPaste.previewEdit, copy: true, floatingPaste: true, previewSelection: selectionStart, appliedSelection: selectionStart }
          event.currentTarget.style.cursor = canvasCursors.selectionMove
          return
        }
        const selectionStart = cloneSelection(session.selection)
        inputRef.current.drag = { kind: 'move-selection', start: point, last: point, selectionStart, previewSelection: selectionStart }
        event.currentTarget.style.cursor = canvasCursors.selectionMove
        return
      }
      if (hit in rotationCursors && session.selection) {
        const floating = session.pendingPaste
        const source = floating?.source ?? captureSelectionTransform(session.document, session.selection)
        if (source) {
          const selectionStart = cloneSelection(session.selection)
          inputRef.current.drag = { kind: 'rotate-content', start: point, last: point, selectionStart, selectionSource: source, previewEdit: floating?.previewEdit, angle: 0, copy: floating ? true : event.ctrlKey, floatingPaste: Boolean(floating), previewSelection: selectionStart, appliedSelection: selectionStart }
        }
        event.currentTarget.style.cursor = rotationCursors[hit as SelectionRotationHandle]
        return
      }
      if (hit in resizeCursors && session.selection) {
        const floating = session.pendingPaste
        const source = floating?.source ?? captureSelectionTransform(session.document, session.selection)
        if (source) {
          const selectionStart = cloneSelection(session.selection)
          inputRef.current.drag = { kind: 'transform-content', start: point, last: point, selectionStart, selectionSource: source, previewEdit: floating?.previewEdit, handle: hit as SelectionHandle, copy: floating ? true : event.ctrlKey, floatingPaste: Boolean(floating), previewSelection: selectionStart, appliedSelection: selectionStart }
        }
        return
      }
      if (session.pendingPaste) state.commitFloatingPaste()
      if (session.selectionKind === 'magic') {
        const before = cloneSelection(session.selection)
        const incoming = magicWandSelection(session.document, getActiveLayer(session.document), point.x, point.y, session.wandTolerance, session.wandContiguous)
        const next = combineSelection(before, incoming, mode)
        inputRef.current.drag = { kind: 'magic-preview', start: point, last: point, selectionStart: before, selectionMode: mode, previewSelection: next }
        draw()
        return
      }
      if (session.selectionKind === 'lasso') { inputRef.current.drag = { kind: 'lasso', start: point, last: point, selectionStart: cloneSelection(session.selection), selectionMode: mode, path: [point] }; return }
    }
    if (event.altKey && (event.button === 0 || event.button === 2)) { sampleAtPoint(); return }
    if (session.tool === 'hand' || (event.shiftKey && !selectionTool && session.tool !== 'shape' && session.tool !== 'pencil' && session.tool !== 'eraser')) {
      const view = liveViewRef.current
      inputRef.current.drag = { kind: 'pan', start: point, last: point, startPan: { x: view.panX, y: view.panY }, startClient: { x: event.clientX, y: event.clientY } }
      beginPanPreview()
      event.currentTarget.setPointerCapture(event.pointerId)
      event.currentTarget.style.cursor = canvasCursors.grabbing
      return
    }
    if (session.tool === 'zoom') {
      const view = liveViewRef.current
      inputRef.current.drag = { kind: 'zoom-drag', start: point, last: point, startClient: { x: event.clientX, y: event.clientY }, startZoom: view.zoom }
      return
    }
    if (session.tool === 'fill') { if (!canEditLayer) return; const edit = floodFill(session.document, editableLayer, point.x, point.y, activeColor(event.button), session.selection, session.fillMode === 'contiguous', activeBrushImage, session.brushSize, session.brushImageSettings, activeBrushTexture, Math.max(1, Math.round(session.brushSize / 8)), proceduralAntialiasStrength, activeBrushPaintMode); if (edit) state.commitPixelEdit(edit, activeBrushImage || activeBrushTexture !== 'solid' ? '笔刷填充' : session.fillMode === 'contiguous' ? '连续填充' : '不连续填充'); return }
    if (session.tool === 'eyedropper') { sampleAtPoint(false); return }
    if (session.tool === 'selection' && (session.selectionKind === 'rectangle' || session.selectionKind === 'ellipse')) {
      const mode = selectionMode()
      inputRef.current.drag = { kind: 'marquee', start: point, last: point, selectionStart: cloneSelection(session.selection), selectionMode: mode, constrain: event.shiftKey }
      const initial = session.selectionKind === 'ellipse' ? ellipseSelection(selectionPoint.x, selectionPoint.y, 1, 1) : rectSelection(selectionPoint.x, selectionPoint.y, 1, 1)
      state.setSelection(combineSelection(session.selection, initial, mode))
      return
    }
    if (session.tool === 'shape') { if (!canEditLayer) return; inputRef.current.drag = { kind: 'shape', start: point, last: point, constrain: event.shiftKey }; draw(); return }
    if (session.tool !== 'pencil' && session.tool !== 'eraser') return
    if (!hasRasterFocus) return
    if (!canEditLayer) return
    const edit = beginPixelEdit(editableLayer.id)
    const patternOrigin = brushPatternOrigin(point)
    paintBrush(session.document, editableLayer, edit, point.x, point.y, session.brushSize, activeColor(event.button), session.brushShape, session.selection, session.tool === 'pencil' || session.tool === 'eraser' ? activeBrushTexture : 'solid', session.brushTextureScale, session.tool === 'pencil' || session.tool === 'eraser' ? activeBrushImage : null, session.brushImageSettings, proceduralAntialiasStrength, activeBrushPaintMode, patternOrigin)
    invalidateStrokeSegment(point, point)
    inputRef.current.drag = { kind: 'draw', start: point, last: point, edit, path: [point], patternOrigin, color: activeColor(event.button) }
    markChanged()
  }

  const pointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const activeDrag = inputRef.current.drag
    if (activeDrag?.kind === 'pan' && activeDrag.startPan && activeDrag.startClient) {
      const delta = viewPanDeltaFromScreen(event.clientX - activeDrag.startClient.x, event.clientY - activeDrag.startClient.y, liveViewRef.current.rotation, rotationIndicatorPosition, liveViewRef.current.mirrored, liveViewRef.current.mirroredVertical)
      schedulePanPreview(
        activeDrag.startPan.x + delta.x,
        activeDrag.startPan.y + delta.y,
        activeDrag.startPan
      )
      event.currentTarget.style.cursor = canvasCursors.grabbing
      return
    }
    updateCursor(event)
    inputRef.current.shiftLinePreview = Boolean(lineConnectionActive(event.nativeEvent) && !canvasResizePreviewRef.current && !inputRef.current.spaceHeld && (session.tool === 'pencil' || session.tool === 'eraser') && lineAnchor)
    const point = localPoint(event)
    if (point) inputRef.current.updatePointer({ point, clientX: event.clientX, clientY: event.clientY, ctrlKey: event.ctrlKey, altKey: event.altKey })
    const modifierSizing = event.ctrlKey && event.altKey && (session.tool === 'pencil' || session.tool === 'eraser')
    if (modifierSizing && !inputRef.current.drag) {
      if (!inputRef.current.modifierBrushSize) inputRef.current.modifierBrushSize = { x: event.clientX, y: event.clientY, size: session.brushSize }
      else {
        const delta = event.clientX - inputRef.current.modifierBrushSize.x
        useWorkspace.getState().setBrushSize(inputRef.current.modifierBrushSize.size + Math.round(delta / 4))
      }
      event.currentTarget.style.cursor = canvasCursors.ewResize
      return
    }
    if (!modifierSizing) inputRef.current.modifierBrushSize = null
    if (!point) return
    const drag = inputRef.current.drag
    if (!drag) { scheduleDraw(); return }
    const state = useWorkspace.getState()
    const previousPoint = drag.last
    drag.last = point
    if (drag.kind === 'brush-size' && drag.startClient) {
      const delta = event.clientX - drag.startClient.x
      state.setBrushSize((drag.startBrushSize ?? session.brushSize) + Math.round(delta / 4))
      event.currentTarget.style.cursor = canvasCursors.ewResize
      return
    }
    if (drag.kind === 'sample-color') {
      if (point.x >= 0 && point.y >= 0 && point.x < session.document.width && point.y < session.document.height) {
        const sampled = sampleCompositeColor(session.document, point.x, point.y)
        if (drag.sampleSecondary) state.setSecondaryColor(sampled)
        else state.setPrimaryColor(sampled)
        inputRef.current.sampling = true
      }
      event.currentTarget.style.cursor = canvasCursors.eyedropper
      scheduleDraw()
      return
    }
    if (drag.kind === 'zoom-drag' && drag.startClient) {
      const zoom = zoomDragTarget(drag.startZoom ?? session.view.zoom, event.clientX - drag.startClient.x, zoomToolDragMode)
      scheduleZoomPreview({ ...liveViewRef.current, zoom })
      return
    }
    if (drag.kind === 'rotate-view' && drag.startAngle !== undefined && drag.startRotation !== undefined) {
      const bounds = stageBounds()
      const pan = event.ctrlKey && drag.startPan ? drag.startPan : { x: liveViewRef.current.panX, y: liveViewRef.current.panY }
      const pivot = viewRotationPivot(bounds.width, bounds.height, pan.x, pan.y, rotationIndicatorPosition)
      const angle = Math.atan2(event.clientY - bounds.top - pivot.y, event.clientX - bounds.left - pivot.x) * 180 / Math.PI
      let rotation = drag.startRotation + angle - drag.startAngle
      if (event.shiftKey) rotation = Math.round(rotation / 45) * 45
      const normalizedRotation = event.ctrlKey ? 0 : ((rotation % 360) + 360) % 360
      liveViewRef.current = { ...liveViewRef.current, panX: pan.x, panY: pan.y, rotation: normalizedRotation }
      applyRotationStyle(liveViewRef.current)
      updateRotationIndicator(normalizedRotation, true)
      scheduleDraw()
      state.setView({ panX: pan.x, panY: pan.y, rotation: normalizedRotation })
      return
    }
    if (drag.kind === 'canvas-resize' && drag.canvasPreview && drag.canvasEdge) {
      const start = drag.canvasPreview
      let left = -start.offsetX; let top = -start.offsetY
      let right = left + start.width; let bottom = top + start.height
      if (drag.canvasEdge.includes('w')) left = Math.min(right - 1, point.x)
      if (drag.canvasEdge.includes('e')) right = Math.max(left + 1, point.x + 1)
      if (drag.canvasEdge.includes('n')) top = Math.min(bottom - 1, point.y)
      if (drag.canvasEdge.includes('s')) bottom = Math.max(top + 1, point.y + 1)
      scheduleCanvasResizePreview({ width: right - left, height: bottom - top, offsetX: -left, offsetY: -top })
      return
    }
    if (drag.kind === 'canvas-move' && drag.canvasPreview) {
      scheduleCanvasResizePreview({
        ...drag.canvasPreview,
        offsetX: drag.canvasPreview.offsetX - (point.x - drag.start.x),
        offsetY: drag.canvasPreview.offsetY - (point.y - drag.start.y)
      })
      event.currentTarget.style.cursor = canvasCursors.move
      return
    }
    if (drag.kind === 'move-layer' && drag.layerId && drag.layerOffset) {
      const distance = constrainedTranslation(drag, point.x - drag.start.x, point.y - drag.start.y, event.shiftKey)
      const distanceX = distance.x
      const distanceY = distance.y
      if (drag.duplicateOnDrag && !drag.duplicatedLayerId && (distanceX !== 0 || distanceY !== 0)) {
        state.mutateActive((active) => {
          const source = active.document.layers.find((candidate) => candidate.id === drag.layerId)
          if (!source) return
          const copy = source.format === 'rgba'
            ? { ...source, id: `${source.id}-copy-${Date.now()}`, name: `${source.name} 副本`, pixels: new Uint8ClampedArray(source.pixels) } as RasterLayer
            : { ...source, id: `${source.id}-copy-${Date.now()}`, name: `${source.name} 副本`, pixels: new Uint32Array(source.pixels) } as RasterLayer
          const insertionIndex = active.document.layers.indexOf(source) + 1
          active.document.layers.splice(insertionIndex, 0, copy)
          active.document.activeLayerId = copy.id
          active.selectedLayerIds = [copy.id]
          active.selectedGroupId = null
          drag.duplicatedLayerId = copy.id
          drag.duplicatedLayer = copy
          drag.duplicatedLayerIndex = insertionIndex
        }, false)
      }
      const activeIds = drag.duplicatedLayerId ? [drag.duplicatedLayerId] : drag.layerIds ?? [drag.layerId]
      state.mutateActive((active) => {
        for (const layerId of activeIds) {
          const layer = active.document.layers.find((candidate) => candidate.id === layerId)
          const offset = drag.duplicatedLayerId ? drag.layerOffset : drag.layerOffsets?.[layerId]
          if (!layer || !offset) continue
          layer.offsetX = offset.x + distanceX
          layer.offsetY = offset.y + distanceY
        }
      }, false)
      compositeSurfaceRef.current = null
      compositeTilesRef.current.clear()
      scheduleDraw()
      return
    }
    if (drag.kind === 'draw' && drag.edit) {
      let rebuiltStroke = false
      if (session.perfectPixels) {
        const path = drag.path ?? [drag.start]
        const removedCorner = appendPerfectPixelSegment(path, point)
        if (removedCorner) {
          revertPixelEdit(session.document, drag.edit)
          const edit = beginPixelEdit(getActiveLayer(session.document).id)
          for (const center of path) paintBrush(session.document, getActiveLayer(session.document), edit, center.x, center.y, session.brushSize, drag.color ?? activeColor(), session.brushShape, session.selection, session.tool === 'pencil' || session.tool === 'eraser' ? activeBrushTexture : 'solid', session.brushTextureScale, session.tool === 'pencil' || session.tool === 'eraser' ? activeBrushImage : null, session.brushImageSettings, proceduralAntialiasStrength, activeBrushPaintMode, drag.patternOrigin)
          drag.edit = edit
          drag.path = path
          rebuiltStroke = true
        } else {
          paintLine(session.document, getActiveLayer(session.document), drag.edit, previousPoint.x, previousPoint.y, point.x, point.y, session.brushSize, drag.color ?? activeColor(), session.selection, session.brushShape, session.tool === 'pencil' || session.tool === 'eraser' ? activeBrushTexture : 'solid', session.brushTextureScale, session.tool === 'pencil' || session.tool === 'eraser' ? activeBrushImage : null, session.brushImageSettings, proceduralAntialiasStrength, activeBrushPaintMode, drag.patternOrigin)
          drag.path = path
        }
      } else paintLine(session.document, getActiveLayer(session.document), drag.edit, previousPoint.x, previousPoint.y, point.x, point.y, session.brushSize, drag.color ?? activeColor(), session.selection, session.brushShape, session.tool === 'pencil' || session.tool === 'eraser' ? activeBrushTexture : 'solid', session.brushTextureScale, session.tool === 'pencil' || session.tool === 'eraser' ? activeBrushImage : null, session.brushImageSettings, proceduralAntialiasStrength, activeBrushPaintMode, drag.patternOrigin)
      if (rebuiltStroke) {
        compositeSurfaceRef.current = null
        compositeTilesRef.current.clear()
      } else invalidateStrokeSegment(previousPoint, point)
      scheduleDraw(); return
    }
    if (drag.kind === 'shape') { drag.constrain = event.shiftKey; scheduleDraw(); return }
    if (drag.kind === 'marquee') {
      drag.constrain = event.shiftKey
      const mode = drag.selectionMode ?? session.selectionMode
      // Generate from the true drag bounds first. Clamping the bounding box
      // before rasterizing an ellipse squashes it against the edge and leaves
      // incorrect corners. Only the resulting mask is clipped to the canvas.
      const bounds = shapeBounds(drag.start, point, drag.constrain)
      const rawIncoming = session.selectionKind === 'ellipse'
        ? ellipseSelection(bounds.x, bounds.y, bounds.width, bounds.height)
        : rectSelection(bounds.x, bounds.y, bounds.width, bounds.height)
      const incoming = transformSelectionMask(rawIncoming, rawIncoming, session.document.width, session.document.height)
      state.setSelection(combineSelection(drag.selectionStart ?? null, incoming, mode)); return
    }
    if (drag.kind === 'magic-preview') {
      const mode = drag.selectionMode ?? session.selectionMode
      const incoming = magicWandSelection(session.document, getActiveLayer(session.document), point.x, point.y, session.wandTolerance, session.wandContiguous)
      drag.previewSelection = combineSelection(drag.selectionStart ?? null, incoming, mode)
      scheduleDraw()
      return
    }
    if (drag.kind === 'lasso') {
      drag.path = [...(drag.path ?? []), point]
      scheduleDraw()
      return
    }
    if ((drag.kind === 'move-selection' || drag.kind === 'move-content') && drag.selectionStart) {
      const start = drag.selectionStart
      // Keep at least one selected pixel on the canvas, while allowing a
      // full-canvas selection to move its pixels out of the original bounds.
      const distance = constrainedTranslation(drag, point.x - drag.start.x, point.y - drag.start.y, event.shiftKey)
      const distanceX = distance.x
      const distanceY = distance.y
      const x = Math.max(-start.width + 1, Math.min(session.document.width - 1, start.x + distanceX))
      const y = Math.max(-start.height + 1, Math.min(session.document.height - 1, start.y + distanceY))
      const target = { ...start, x, y }
      if (drag.previewTarget?.x === target.x && drag.previewTarget.y === target.y) return
      drag.previewTarget = target
      drag.previewAngle = 0
      scheduleSelectionPreview(drag)
      return
    }
    if (drag.kind === 'transform-content' && drag.selectionStart && drag.selectionSource && drag.handle) {
      const target = resizeSelectionBounds(drag.selectionStart, point, drag.handle, session.document, event.shiftKey, event.shiftKey && event.ctrlKey)
      if (drag.previewTarget?.x === target.x && drag.previewTarget.y === target.y && drag.previewTarget.width === target.width && drag.previewTarget.height === target.height && drag.previewTarget.flipHorizontal === target.flipHorizontal && drag.previewTarget.flipVertical === target.flipVertical && drag.previewTarget.flipOriginX === target.flipOriginX && drag.previewTarget.flipOriginY === target.flipOriginY) return
      drag.previewTarget = target
      drag.previewAngle = 0
      scheduleSelectionPreview(drag)
      return
    }
    if (drag.kind === 'rotate-content' && drag.selectionStart) {
      const centerX = drag.selectionStart.x + drag.selectionStart.width / 2
      const centerY = drag.selectionStart.y + drag.selectionStart.height / 2
      const startAngle = Math.atan2(drag.start.y - centerY, drag.start.x - centerX)
      const angle = (Math.atan2(point.y - centerY, point.x - centerX) - startAngle) * 180 / Math.PI
      if (drag.previewAngle === angle) return
      drag.angle = angle
      drag.previewAngle = angle
      drag.previewTarget = drag.selectionStart
      scheduleSelectionPreview(drag)
    }
  }

  const pointerUp = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const drag = inputRef.current.finish()
    if (!drag) return
    if (drag.kind === 'canvas-resize' || drag.kind === 'canvas-move') flushCanvasResizePreview()
    if (selectionPreviewFrameRef.current !== null) {
      window.cancelAnimationFrame(selectionPreviewFrameRef.current)
      selectionPreviewFrameRef.current = null
    }
    flushSelectionPreview(drag)
    if (drag.translationPreview) drag.previewEdit = selectionTranslationPreviewEdit(session.document, drag.translationPreview)
    if (drag.kind === 'draw' || drag.kind === 'shape' || drag.kind === 'move-content' || drag.kind === 'transform-content' || drag.kind === 'rotate-content' || drag.kind === 'move-layer') compositeSurfaceRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const state = useWorkspace.getState()
    if (drag.kind === 'pan') {
      finishPanPreview()
      updateCursor(event)
      draw()
      return
    }
    if (drag.kind === 'zoom-drag') {
      const startClient = drag.startClient ?? { x: event.clientX, y: event.clientY }
      const moved = Math.abs(event.clientX - startClient.x) > 3 || Math.abs(event.clientY - startClient.y) > 3
      if (!moved) {
        const rect = stageBounds()
        const view = liveViewRef.current
        const nextZoom = steppedZoom(view.zoom, event.button !== 2)
        if (nextZoom !== view.zoom) {
          scheduleZoomPreview({ ...view, ...zoomViewAroundViewportPoint(view, nextZoom, { x: event.clientX - rect.left, y: event.clientY - rect.top }, rect.width, rect.height, session.document.width, session.document.height, rotationIndicatorPosition) })
        }
      }
      finishZoomPreview()
      return
    }
    if (drag.kind === 'rotate-view') {
      updateRotationIndicator(liveViewRef.current.rotation, false)
      return
    }
    if (drag.kind === 'sample-color') {
      inputRef.current.sampling = false
      if (!drag.temporarySampling) {
        state.setTool('pencil')
        event.currentTarget.style.cursor = canvasToolCursor('pencil', session.primaryColor)
      } else updateCursor(event)
      draw()
      return
    }
    updateCursor(event)
    if (drag.kind === 'draw' && drag.edit) {
      state.commitPixelEdit(drag.edit, session.tool === 'eraser' ? '橡皮擦' : '绘制')
      if (session.tool === 'eraser') state.setLastEraserPoint(drag.last)
      else state.setLastPencilPoint(drag.last)
    }
    if (drag.kind === 'move-layer' && !drag.duplicatedLayer && drag.layerIds && drag.layerIds.length > 1 && drag.layerOffsets) {
      const before = drag.layerOffsets
      const after = Object.fromEntries(drag.layerIds.map((id) => {
        const layer = session.document.layers.find((candidate) => candidate.id === id)
        return [id, { x: layer?.offsetX ?? before[id].x, y: layer?.offsetY ?? before[id].y }]
      }))
      if (drag.layerIds.some((id) => after[id].x !== before[id].x || after[id].y !== before[id].y)) {
        state.pushHistory({
          label: '移动所选图层内容', bytes: drag.layerIds.length * 32,
          undo: () => { for (const id of drag.layerIds ?? []) { const layer = session.document.layers.find((candidate) => candidate.id === id); const offset = before[id]; if (layer && offset) { layer.offsetX = offset.x; layer.offsetY = offset.y } } },
          redo: () => { for (const id of drag.layerIds ?? []) { const layer = session.document.layers.find((candidate) => candidate.id === id); const offset = after[id]; if (layer && offset) { layer.offsetX = offset.x; layer.offsetY = offset.y } } }
        })
        state.mutateActive(() => {}, true)
      }
    } else if (drag.kind === 'move-layer' && drag.layerId && drag.layerOffset) {
      const layerId = drag.duplicatedLayerId ?? drag.layerId
      const layer = session.document.layers.find((candidate) => candidate.id === layerId)
      if (layer && (layer.offsetX !== drag.layerOffset.x || layer.offsetY !== drag.layerOffset.y)) {
        const before = { ...drag.layerOffset }
        const after = { x: layer.offsetX, y: layer.offsetY }
        state.pushHistory({
          label: '移动图层内容', bytes: 32,
          undo: () => {
            if (drag.duplicatedLayer) {
              session.document.layers = session.document.layers.filter((candidate) => candidate.id !== layerId)
              session.document.activeLayerId = drag.layerId!
              session.selectedLayerIds = drag.originalSelectedLayerIds?.length ? [...drag.originalSelectedLayerIds] : [drag.layerId!]
              session.selectedGroupId = null
            }
            else { const target = session.document.layers.find((candidate) => candidate.id === layerId); if (target) { target.offsetX = before.x; target.offsetY = before.y } }
          },
          redo: () => {
            if (drag.duplicatedLayer) {
              if (!session.document.layers.some((candidate) => candidate.id === layerId)) session.document.layers.splice(drag.duplicatedLayerIndex ?? session.document.layers.length, 0, drag.duplicatedLayer)
              drag.duplicatedLayer.offsetX = after.x; drag.duplicatedLayer.offsetY = after.y
              session.document.activeLayerId = layerId
              session.selectedLayerIds = [layerId]
              session.selectedGroupId = null
            } else { const target = session.document.layers.find((candidate) => candidate.id === layerId); if (target) { target.offsetX = after.x; target.offsetY = after.y } }
          }
        })
        state.mutateActive(() => {}, true)
      }
    }
    if (drag.kind === 'shape') {
      drag.constrain = event.shiftKey
      const layer = getActiveLayer(session.document)
      if (!isLayerEffectivelyLocked(session.document, layer)) {
        const edit = beginPixelEdit(layer.id)
        paintShape(session.document, layer, edit, shapeBounds(drag.start, drag.last, drag.constrain), session.shapeKind, session.primaryColor, session.selection)
        state.commitPixelEdit(edit, session.shapeKind === 'ellipse' ? '绘制圆形' : '绘制矩形')
      }
    }
    if (drag.kind === 'marquee') state.commitSelectionChange(drag.selectionStart ?? null, session.selection, '创建选区')
    if (drag.kind === 'lasso') {
      const mode = drag.selectionMode ?? session.selectionMode
      const before = drag.selectionStart ?? null
      const after = combineSelection(before, lassoSelection(session.document, drag.path ?? []), mode)
      state.commitSelectionChange(before, after, '套索选区')
    }
    if (drag.kind === 'magic-preview' && drag.selectionStart !== undefined) state.commitSelectionChange(drag.selectionStart ?? null, drag.previewSelection ?? null, '魔棒选区')
    if (drag.kind === 'move-selection' && drag.selectionStart && drag.previewSelection) state.commitSelectionChange(drag.selectionStart, drag.previewSelection, '移动选框')
    if ((drag.kind === 'move-content' || drag.kind === 'transform-content' || drag.kind === 'rotate-content') && drag.selectionStart && drag.previewSelection) {
      if (drag.floatingPaste && drag.previewEdit) state.updateFloatingPastePreview(drag.previewEdit, drag.previewSelection)
      else state.commitSelectionTransform(drag.previewEdit ?? null, drag.selectionStart, drag.previewSelection, drag.copy ? '复制选区内容' : '移动选区内容')
    }
    draw()
  }

  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (!canvasResizePreviewRef.current && event.ctrlKey && (session.tool === 'pencil' || session.tool === 'eraser') && !activeBrushImage?.intrinsicSize) {
      event.preventDefault()
      event.stopPropagation()
      useWorkspace.getState().setBrushSize(session.brushSize + (event.deltaY < 0 ? 1 : -1))
      return
    }
    if (inputRef.current.drag?.kind === 'pan') return
    const rect = stageBounds()
    event.preventDefault()
    const liveView = liveViewRef.current
    const oldZoom = liveView.zoom
    const newZoom = steppedZoom(oldZoom, event.deltaY < 0)
    if (newZoom === oldZoom) return
    scheduleZoomPreview({ ...liveView, ...zoomViewAroundViewportPoint(liveView, newZoom, { x: event.clientX - rect.left, y: event.clientY - rect.top }, rect.width, rect.height, session.document.width, session.document.height, rotationIndicatorPosition) })
  }

  const rotationStyle = { transform: 'none', transformOrigin: '50% 50%' }
  return <div ref={stageRef} className="stage-surface"><canvas ref={canvasRef} style={rotationStyle} className="stage-canvas" aria-label="像素画布" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onPointerLeave={(event) => { inputRef.current.pointer.visible = false; inputRef.current.shiftLinePreview = false; inputRef.current.sampling = false; if (!inputRef.current.drag) event.currentTarget.style.cursor = canvasResizePreviewRef.current ? canvasCursors.unavailable : inputRef.current.spaceHeld ? canvasCursors.grab : canvasToolCursor(session.tool, session.primaryColor); draw() }} onPointerEnter={(event) => { updateCursor(event); inputRef.current.shiftLinePreview = lineConnectionActive(event.nativeEvent) && !canvasResizePreviewRef.current && !inputRef.current.sampling && (session.tool === 'pencil' || session.tool === 'eraser') && Boolean(lineAnchor); draw() }} onContextMenu={(event) => event.preventDefault()} onWheel={onWheel} /><canvas ref={selectionCanvasRef} style={rotationStyle} className="stage-selection-overlay" aria-hidden="true" /><div ref={rotationIndicatorRef} className="rotation-indicator" hidden aria-hidden="true"><span className="rotation-indicator-background">{[rotationBackground1, rotationBackground2, rotationBackground3, rotationBackground4, rotationBackground5, rotationBackground6].map((source) => <img key={source} src={source} alt="" />)}</span><span ref={rotationPointerRef} className="rotation-indicator-pointer"><img src={rotationPointer} alt="" /></span></div></div>
}
