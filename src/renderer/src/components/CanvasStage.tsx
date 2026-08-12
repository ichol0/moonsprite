import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RasterLayer, RgbaColor, SelectionMask, SelectionMode, SelectionRect } from '@shared/types'
import { compositePixelWithLayerColor, compositeRegion, createCompositePointReplacementSampler, createCompositePointSampler, createNormalCompositePointReplacementSampler, createNormalCompositePointSampler, getActiveLayer, isLayerEffectivelyLocked, isLayerEffectivelyVisible, layerContentBounds, layerIndexAt, layerMaskDisplayColor, readLayerColor, readLayerColorAt, readLayerMaskDisplayColorAt, renderLayerMaskRegion } from '@/core/document'
import { beginPixelEdit, revertPixelEdit } from '@/core/history'
import { applyRelativeLuminance, blendOver, relativeLuminanceColor, TRANSPARENT } from '@/core/raster'
import { applyGradient, constrainGradientEndpoint, createGradientColorSampler, gradientRegionSelection } from '@/core/gradient'
import { DEFAULT_GRID_SETTINGS, gridCellBoundsAt, gridLinePositions, shouldRenderPixelGrid } from '@/core/grid'
import { appendPerfectPixelSegment, applySelectionTransform, applySelectionTranslationPreview, brushMaskOffsets, brushStampAnchor, brushStampDimensions, captureSelectionTransform, floodFillSymmetric, outlinePixelIndices, paintBrush, paintLine, paintShape, restoreSelectionTranslationPreview, rotatedShapePixelPoints, sampleCompositeColor, shapeContainsPixel, type BrushGradientSample } from '@/core/tools'
import { useWorkspace, type DocumentSession } from '@/store/workspace'
import { activeLayerMask, activePaintLayer } from '@/store/workspace-session'
import { DEFAULT_GRID_COLOR, loadEditorPreferences, type BrushPreviewMode, type CheckerboardPreferences, type EyedropperMagnifierStyle, type GridColorPreferences, type OnionSkinPreferences, type RotationIndicatorPosition, type SymmetryAxisPreferences, type WheelZoomMode, type ZoomToolDragMode } from '@/core/file-preferences'
import { clampCanvasViewPan, documentPointFromViewportPoint, documentPointFromViewportPointContinuous, mirrorViewportPoint, rotateViewAroundViewportPoint, rotateViewportPoint, rotationIndicatorFitsCanvas, rotationIndicatorPointBesidePointer, unrotateViewportPoint, viewPanDeltaFromScreen, viewRotationPivot, zoomViewAroundViewportPoint } from '@/core/view-geometry'
import { createCanvasRenderPlan, deviceAlignedPixelRect } from '@/core/canvas-render-plan'
import { balancedStairLinePoints, constrainLineEndpoint } from '@/core/pixel-line'
import { cloneSelection, combineSelection, lassoSelection, magicWandSelection, rasterLinePoints, rectSelection, rotatedEllipseSelection, rotatedRectSelection, selectionContains, shiftSelection, transformedSelectionControlPoints, transformSelectionMask } from '@/core/selection'
import { CANVAS_RESIZE_PREVIEW_EVENT, drawCanvasResizePreviewLayers } from '@/core/canvas-resize-preview'
import { loadShortcuts, modifierShortcutHeld } from '@/core/shortcuts'
import { CanvasInputState, appendPolygonLassoVertex, beginBrushSpeedTracking, canvasGestureForPreview, centeredShapeBounds, clampCanvasZoom as clampZoom, coalescedPointerClientPoints, constrainedTranslation, createCanvasPanDrag, createMarqueeResizeStart, finalizeMarqueeSelection, floatingSelectionCopyMode, polygonLassoClosedPathPoints, polygonLassoPreviewPoints, resizeRotatedMarqueeBounds, resizeTransformedSelectionBounds, restoreCanvasDragAfterPan, revertCancelledCanvasDragPixelChanges, selectionGestureMoved, selectionInteractionHit, selectionOverlayMaskForDrag, selectionRotationAngle, selectionTransformedInteractionHit, selectionTransformModifiers, selectionTransformPreviewChanged, shapeBounds, shouldClosePolygonLasso, shouldRestartFloatingSelectionForCopy, shouldStartCanvasPan, snapSelectionRotation, steppedCanvasZoom as steppedZoom, temporaryTransformOffset, translatedSelectionRect, updateBrushSpeedTracking, wheelCanvasZoom, zoomDragModeForModifiers, zoomDragTarget, type CanvasDragState as DragState, type CanvasPoint as Point, type SelectionHandle, type SelectionHit, type SelectionRotationHandle, type SelectionShearHandle } from '@/core/canvas-input'
import { canvasCursors, canvasStatusTextColor, canvasToolCursor, colorLuminance, previewCursorTools, resizeCursors, rotationCursors, selectionRotationCursorForPosition, shearCursors, selectionCreationCursor, selectionCursorCornerRects, selectionPathPreviewPixelVisible, selectionPreviewPixels, selectionTransformDragCursor, transparencyColorAt } from '@/core/canvas-visuals'
import { defaultSymmetryCenter, hasSymmetry, moveSymmetryCenter, symmetryAxisSegment, symmetryPoints, symmetrySelection, transformSymmetrySelection, type SymmetryAxis } from '@/core/symmetry'
import { beginAdjustmentPreviewEdit, endAdjustmentPreviewEdit, prepareAdjustmentPreviewEdit, renderAdjustmentPreviewEdit } from '@/core/adjustment-preview-lifecycle'
import { CanvasCompositeCache } from '@/components/canvas-composite-cache'
import { OnionSkinCompositeCache } from '@/components/onion-skin-composite-cache'
import { resolveCanvasMoveAnimationCellKeys } from '@/components/canvas-move-selection'
import { drawSelectionOutline, selectionScreenBox, selectionScreenPoint, type RasterContext2D, type SelectionBoundaryCache } from '@/components/canvas-selection-renderer'
import { useCanvasViewPreview } from '@/components/useCanvasViewPreview'
import { PerformanceProfiler } from '@/components/PerformanceProfiler'
import { useI18n } from '@/components/I18nProvider'
import { onionSkinFrameRefs } from '@/core/onion-skin'
import { resolveTheme } from '@/core/theme'
import { pixelSamplingMode } from '@/core/pixel-display'
import { finishAnimationCellOperation, revealLayerInPanel } from '@/components/layer-panel-reveal'
import { publishCanvasColorSample, publishCanvasColorSamplingCompleted } from '@/components/color-sampling-events'
import { eyedropperMagnifierPixelScale } from '@/core/eyedropper-magnifier'
import { resolveBrushDynamics, smoothBrushSizeEnvelope } from '@/core/pressure'
import { airbrushParticleSize, generateAirbrushParticles } from '@/core/airbrush'
import { animationCelKey, animationCelOffsetsForKeys, parseAnimationCelKey, setAnimationCelOffsets, setAnimationCelOffsetsForKeys } from '@/core/animation'
import rotationBackground1 from '@/assets/rotation-indicator/background-1.png'
import rotationBackground2 from '@/assets/rotation-indicator/background-2.png'
import rotationBackground3 from '@/assets/rotation-indicator/background-3.png'
import rotationBackground4 from '@/assets/rotation-indicator/background-4.png'
import rotationBackground5 from '@/assets/rotation-indicator/background-5.png'
import rotationBackground6 from '@/assets/rotation-indicator/background-6.png'
import rotationPointer from '@/assets/rotation-indicator/pointer.png'
import eyedropperPointerDark from '@/assets/pixel-icons/02-Slice-2.png'
import eyedropperPointerLight from '@/assets/pixel-icons/03-Slice-3.png'
import eyedropperMagnifierFrame from '@/assets/eyedropper-magnifier-frame.svg?raw'
import eyedropperMagnifierSampledMask from '@/assets/eyedropper-magnifier-sampled-mask.svg?raw'
import eyedropperMagnifierPreviousMask from '@/assets/eyedropper-magnifier-previous-mask.svg?raw'

interface CompositeSurface { canvas: OffscreenCanvas; revision: string }
interface GradientPreviewSurface { canvas: OffscreenCanvas; context: OffscreenCanvasRenderingContext2D; imageData: ImageData; pixels: Uint8ClampedArray; width: number; height: number }
interface GradientPreviewCoverageCache {
  selection: SelectionMask | null | undefined
  paintRegion: SelectionMask | null | undefined
  previewFromX: number
  previewFromY: number
  previewToX: number
  previewToY: number
  targetX: number
  targetY: number
  targetWidth: number
  targetHeight: number
  sourceWidth: number
  sourceHeight: number
  zoom: number
  originX: number
  originY: number
  dpr: number
  coverage: Uint8ClampedArray
  sampleX: Int32Array
  sampleY: Int32Array
}
interface SymmetryDragState { axis: SymmetryAxis | 'center'; pointerId: number }
interface MoveLayerContentPreview { layerId: string; bounds: SelectionRect; layerOffsetX: number; layerOffsetY: number }
const SMOOTH_GRADIENT_PREVIEW_SAMPLE_LIMIT = 96_000
const DITHERED_GRADIENT_PREVIEW_SAMPLE_LIMIT = 1_500_000
const insideSelection = (selection: SelectionMask, point: Point): boolean => selectionContains(selection, point.x, point.y)

export function CanvasStage({ session }: { session: DocumentSession }) {
  const { t } = useI18n()
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const selectionCanvasRef = useRef<HTMLCanvasElement>(null)
  const rotationSceneRef = useRef<OffscreenCanvas | null>(null)
  const checkerboardTileRef = useRef<{ key: string; canvas: OffscreenCanvas } | null>(null)
  const gradientPreviewSurfaceRef = useRef<GradientPreviewSurface | null>(null)
  const gradientPreviewCoverageCacheRef = useRef<GradientPreviewCoverageCache | null>(null)
  const compositeReplacementSamplerRef = useRef<{ document: DocumentSession['document']; revision: number; layerId: string; sampler: (x: number, y: number, replacement: RgbaColor) => RgbaColor } | null>(null)
  const selectionRotationSceneRef = useRef<OffscreenCanvas | null>(null)
  const rotationIndicatorRef = useRef<HTMLDivElement>(null)
  const rotationPointerRef = useRef<HTMLDivElement>(null)
  const rotationIndicatorAnchorRef = useRef<Point | null>(null)
  const eyedropperMagnifierRef = useRef<HTMLDivElement>(null)
  const eyedropperMagnifierCanvasRef = useRef<HTMLCanvasElement>(null)
  const eyedropperMagnifierSourceRef = useRef<OffscreenCanvas | null>(null)
  const eyedropperMagnifierSampledMaskRef = useRef<HTMLSpanElement>(null)
  const eyedropperMagnifierPreviousMaskRef = useRef<HTMLSpanElement>(null)
  const eyedropperPointerDarkRef = useRef<HTMLImageElement>(null)
  const eyedropperPointerLightRef = useRef<HTMLImageElement>(null)
  const eyedropperOriginalColorRef = useRef<RgbaColor | null>(null)
  const [rotationIndicatorPosition, setRotationIndicatorPosition] = useState<RotationIndicatorPosition>(() => loadEditorPreferences().rotationIndicatorPosition)
  const [drawingBrushPreviewEnabled, setDrawingBrushPreviewEnabled] = useState(() => loadEditorPreferences().drawingBrushPreviewEnabled)
  const [zoomToolDragMode, setZoomToolDragMode] = useState<ZoomToolDragMode>(() => loadEditorPreferences().zoomToolDragMode)
  const [brushPreviewMode, setBrushPreviewMode] = useState<BrushPreviewMode>(() => loadEditorPreferences().brushPreviewMode)
  const [checkerboard, setCheckerboard] = useState<CheckerboardPreferences>(() => loadEditorPreferences().checkerboard)
  const [gridColors, setGridColors] = useState<GridColorPreferences>(() => {
    const preferences = loadEditorPreferences()
    return { pixelGridColor: preferences.pixelGridColor, gridColor: preferences.gridColor }
  })
  const [wheelZoomEnabled, setWheelZoomEnabled] = useState(() => loadEditorPreferences().wheelZoomEnabled)
  const [wheelZoomMode, setWheelZoomMode] = useState<WheelZoomMode>(() => loadEditorPreferences().wheelZoomMode)
  const [shiftLinePreviewEnabled, setShiftLinePreviewEnabled] = useState(() => loadEditorPreferences().shiftLinePreviewEnabled)
  const [lassoPreviewClosed, setLassoPreviewClosed] = useState(() => loadEditorPreferences().lassoPreviewClosed)
  const [eyedropperSwitchToPencil, setEyedropperSwitchToPencil] = useState(() => loadEditorPreferences().eyedropperSwitchToPencil)
  const [eyedropperMagnifierEnabled, setEyedropperMagnifierEnabled] = useState(() => loadEditorPreferences().eyedropperMagnifierEnabled)
  const [eyedropperMagnifierStyle, setEyedropperMagnifierStyle] = useState<EyedropperMagnifierStyle>(() => loadEditorPreferences().eyedropperMagnifierStyle)
  const [eyedropperMagnifierDistortionEnabled, setEyedropperMagnifierDistortionEnabled] = useState(() => loadEditorPreferences().eyedropperMagnifierDistortionEnabled)
  const [moveLayerContentPreviewEnabled, setMoveLayerContentPreviewEnabled] = useState(() => loadEditorPreferences().moveLayerContentPreviewEnabled)
  const [selectionCrosshair, setSelectionCrosshair] = useState(() => loadEditorPreferences().selectionCrosshair)
  const [balancedShiftLineEnabled, setBalancedShiftLineEnabled] = useState(() => loadEditorPreferences().balancedShiftLineEnabled)
  const [lineDirectionStep, setLineDirectionStep] = useState(() => loadEditorPreferences().lineDirectionStep)
  const [onionSkin, setOnionSkin] = useState<OnionSkinPreferences>(() => loadEditorPreferences().onionSkin)
  const [timelineHidden, setTimelineHidden] = useState(() => loadEditorPreferences().timelineHidden)
  const [symmetryAxisPreferences, setSymmetryAxisPreferences] = useState<SymmetryAxisPreferences>(() => loadEditorPreferences().symmetryAxis)
  const [activeTheme, setActiveTheme] = useState(() => resolveTheme(loadEditorPreferences().theme))
  const [shortcuts, setShortcuts] = useState(loadShortcuts)
  const inputRef = useRef(new CanvasInputState())
  const symmetryDragRef = useRef<SymmetryDragState | null>(null)
  const rafRef = useRef<number | null>(null)
  const drawRequestRef = useRef<number | null>(null)
  // Keyboard listeners intentionally live across brush changes. Deferred draws
  // must therefore resolve the current render function instead of the brush
  // configuration that was active when the listener was registered.
  const drawRef = useRef<() => void>(() => {})
  const stageSizeRef = useRef({ width: 0, height: 0 })
  const compositeCacheRef = useRef(new CanvasCompositeCache())
  const compositePointSamplerRef = useRef<{ document: DocumentSession['document']; revision: number; sampler: (x: number, y: number) => RgbaColor } | null>(null)
  const renderDocumentSizeRef = useRef({ width: session.document.width, height: session.document.height })
  const onionSkinCacheRef = useRef(new OnionSkinCompositeCache())
  const canvasResizeSurfaceRef = useRef<CompositeSurface | null>(null)
  const outlinePreviewCacheRef = useRef<{ revision: number; layerId: string; selection: SelectionMask; preview: NonNullable<DocumentSession['outlinePreview']>; indices: number[] } | null>(null)
  const selectionBoundaryCacheRef = useRef<SelectionBoundaryCache | null>(null)
  const selectionOverlayVisibleRef = useRef(false)
  const selectionPreviewFrameRef = useRef<number | null>(null)
  const airbrushFrameRef = useRef<number | null>(null)
  const sprayAirbrushRef = useRef<(drag: DragState) => void>(() => {})
  const adjustmentPreviewEditRef = useRef(false)
  const canvasResizePreviewRef = useRef(session.canvasResizePreview)
  const pendingCanvasResizeRef = useRef<DocumentSession['canvasResizePreview']>(null)
  const canvasResizeFrameRef = useRef<number | null>(null)
  const moveLayerContentPreviewRef = useRef<MoveLayerContentPreview | null>(null)
  const moveLayerContentPreviewTimerRef = useRef<number | null>(null)
  canvasResizePreviewRef.current = session.canvasResizePreview
  const activeViewDrag = inputRef.current.drag?.kind === 'pan' || inputRef.current.drag?.kind === 'zoom-drag' || inputRef.current.drag?.kind === 'rotate-view'
  const { pendingViewRef, liveViewRef, zoomPreviewStartRef, applyRotationStyle, finishZoomPreview, scheduleZoomPreview, beginPanPreview, schedulePanPreview, finishPanPreview } = useCanvasViewPreview({ documentId: session.document.id, sessionView: session.view, activeViewDrag, canvasRef, selectionCanvasRef, drawRef })
  const lineAnchor = session.tool === 'eraser' ? session.lastEraserPoint : session.lastPencilPoint
  const selectedLayerMask = activeLayerMask(session)
  const hasSelectedRasterLayer = Boolean(selectedLayerMask) || (session.selectedGroupIds.length === 0 && session.selectedLayerIds.some((id) => session.document.layers.some((layer) => layer.id === id)))
  const activeLayer = activePaintLayer(session)
  // Sessions created before the symmetry center field was introduced may still
  // exist during hot reload. Resolve that legacy state once per render.
  const symmetryCenter = session.symmetryCenter ?? defaultSymmetryCenter(session.document.width, session.document.height)
  const fillKind = session.fillKind ?? 'bucket'
  const gradientDither = session.gradientDither ?? 'none'
  const activeLayerEditable = hasSelectedRasterLayer && isLayerEffectivelyVisible(session.document, activeLayer) && !isLayerEffectivelyLocked(session.document, activeLayer)
  const brushToolEnabled = session.tool === 'pencil' || session.tool === 'eraser' || (session.tool === 'fill' && fillKind === 'bucket')
  const activeBrushImage = brushToolEnabled ? session.brushImage : null
  const activeBrushTexture = brushToolEnabled ? session.brushTexture : 'solid'
  const activeBrushPaintMode = activeBrushImage?.intrinsicSize ? session.brushPaintMode : 'paint'
  const activeBrushPreviewMode = activeBrushPaintMode
  const brushDynamicsPreviewIsSinglePixel = (session.tool === 'pencil' || session.tool === 'eraser')
    && Object.values(session.brushDynamics.effects).some((mapping) => mapping.sensor !== null)
  const proceduralAntialiasStrength = brushToolEnabled && session.proceduralAntialias && activeBrushImage?.id.startsWith('procedural:') ? session.proceduralAntialiasStrength : 0
  const brushPatternOrigin = (point: Point): Point => {
    const anchor = brushStampAnchor(session.brushSize, activeBrushImage)
    return { x: point.x - anchor.x, y: point.y - anchor.y }
  }
  sprayAirbrushRef.current = (drag: DragState): void => {
    if (!drag.edit) return
    const paintLayer = activePaintLayer(session)
    const color = drag.color ?? session.primaryColor
    const particleSize = airbrushParticleSize(session.airbrushParticleRadius)
    const particles = generateAirbrushParticles(drag.last, {
      particleRadius: session.airbrushParticleRadius,
      scatterRadius: session.airbrushScatterRadius,
      density: session.airbrushDensity
    })
    for (const particle of particles) {
      paintBrush(session.document, paintLayer, drag.edit, particle.x, particle.y, particleSize, color, session.airbrushParticleShape, session.selection, 'solid', 1, null, session.brushImageSettings, 0, 'paint', particle, session.symmetryAxes, symmetryCenter)
    }
    const radius = session.airbrushScatterRadius + session.airbrushParticleRadius
    invalidateCompositeRect({ x: drag.last.x - radius, y: drag.last.y - radius, width: radius * 2 + 1, height: radius * 2 + 1 })
    scheduleDraw()
  }
  const stageBounds = (): DOMRect => stageRef.current?.getBoundingClientRect() ?? canvasRef.current?.getBoundingClientRect() ?? new DOMRect()
  const stageSize = (): { width: number; height: number } => {
    const cached = stageSizeRef.current
    if (cached.width > 0 && cached.height > 0) return cached
    const bounds = stageBounds()
    stageSizeRef.current = { width: bounds.width, height: bounds.height }
    return stageSizeRef.current
  }
  const constrainCanvasView = (view: DocumentSession['view'], size = stageSize()): DocumentSession['view'] => clampCanvasViewPan(size.width, size.height, session.document.width, session.document.height, view, rotationIndicatorPosition)
  const modifierActive = (event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, id: keyof typeof shortcuts): boolean => modifierShortcutHeld(event, shortcuts[id] ?? '')
  const selectionTransformModifierState = (event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>) => selectionTransformModifiers({
    ctrlKey: modifierActive(event, 'integerSelectionScale'),
    altKey: event.altKey,
    shiftKey: modifierActive(event, 'proportionalSelectionTransform')
  })
  const currentSelectionTransformModifierState = () => selectionTransformModifierState({
    ctrlKey: inputRef.current.ctrlHeld,
    metaKey: false,
    altKey: inputRef.current.altHeld,
    shiftKey: inputRef.current.shiftHeld
  })
  const selectionMarqueeModifierState = (event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>) => ({
    fromCenter: Boolean(event.ctrlKey || event.metaKey),
    proportional: event.shiftKey,
    rotate: event.altKey
  })
  const currentSelectionMarqueeModifierState = () => selectionMarqueeModifierState({
    ctrlKey: inputRef.current.ctrlHeld,
    metaKey: false,
    altKey: inputRef.current.altHeld,
    shiftKey: inputRef.current.shiftHeld
  })
  const lineConnectionShortcut = shortcuts.lineConnectionMode ?? ''
  const lineConnectionConfigured = Boolean(lineConnectionShortcut.trim())
  const lineConnectionActive = (event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): boolean => lineConnectionConfigured && modifierActive(event, 'lineConnectionMode')
  const constrainedLineTarget = (point: Point, event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): Point =>
    lineAnchor && modifierActive(event, 'constrainLineDirections') ? constrainLineEndpoint(lineAnchor, point, lineDirectionStep) : point

  useEffect(() => {
    const refresh = (): void => setShortcuts(loadShortcuts())
    window.addEventListener('moonsprite:shortcuts-changed', refresh)
    return () => window.removeEventListener('moonsprite:shortcuts-changed', refresh)
  }, [])

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
    const pointerElement = rotationPointerRef.current
    if (!indicator || !pointerElement) return
    const size = stageSize()
    const indicatorCenter = rotationIndicatorPosition === 'view' && rotationIndicatorAnchorRef.current
      ? rotationIndicatorAnchorRef.current
      : viewRotationPivot(size.width, size.height, liveViewRef.current.panX, liveViewRef.current.panY, rotationIndicatorPosition)
    indicator.hidden = !visible || !rotationIndicatorFitsCanvas(session.document.width, session.document.height, liveViewRef.current.zoom)
    indicator.style.left = `${indicatorCenter.x}px`
    indicator.style.top = `${indicatorCenter.y}px`
    pointerElement.style.transform = `rotate(${rotation}deg)`
    if (!visible) rotationIndicatorAnchorRef.current = null
  }

  useEffect(() => {
    const syncPreferences = (): void => {
      const preferences = loadEditorPreferences()
      setRotationIndicatorPosition(preferences.rotationIndicatorPosition)
      setDrawingBrushPreviewEnabled(preferences.drawingBrushPreviewEnabled)
      setZoomToolDragMode(preferences.zoomToolDragMode)
      setBrushPreviewMode(preferences.brushPreviewMode)
      setCheckerboard(preferences.checkerboard)
      setGridColors({ pixelGridColor: preferences.pixelGridColor, gridColor: preferences.gridColor })
      setWheelZoomEnabled(preferences.wheelZoomEnabled)
      setWheelZoomMode(preferences.wheelZoomMode)
      setShiftLinePreviewEnabled(preferences.shiftLinePreviewEnabled)
      setLassoPreviewClosed(preferences.lassoPreviewClosed)
      setEyedropperSwitchToPencil(preferences.eyedropperSwitchToPencil)
      setEyedropperMagnifierEnabled(preferences.eyedropperMagnifierEnabled)
      setEyedropperMagnifierStyle(preferences.eyedropperMagnifierStyle)
      setEyedropperMagnifierDistortionEnabled(preferences.eyedropperMagnifierDistortionEnabled)
      setMoveLayerContentPreviewEnabled(preferences.moveLayerContentPreviewEnabled)
      setSelectionCrosshair(preferences.selectionCrosshair)
      setBalancedShiftLineEnabled(preferences.balancedShiftLineEnabled)
      setLineDirectionStep(preferences.lineDirectionStep)
      setOnionSkin(preferences.onionSkin)
      setTimelineHidden(preferences.timelineHidden)
      setSymmetryAxisPreferences(preferences.symmetryAxis)
      setActiveTheme(resolveTheme(preferences.theme))
      if (preferences.symmetryAxis.locked) symmetryDragRef.current = null
      onionSkinCacheRef.current.invalidateAll()
      if (!preferences.eyedropperMagnifierEnabled && eyedropperMagnifierRef.current) eyedropperMagnifierRef.current.hidden = true
      if (eyedropperMagnifierRef.current) eyedropperMagnifierRef.current.dataset.style = preferences.eyedropperMagnifierStyle
      if (!preferences.moveLayerContentPreviewEnabled) {
        moveLayerContentPreviewRef.current = null
        if (moveLayerContentPreviewTimerRef.current !== null) window.clearTimeout(moveLayerContentPreviewTimerRef.current)
        moveLayerContentPreviewTimerRef.current = null
        scheduleDraw()
      }
    }
    window.addEventListener('moonsprite:preferences-changed', syncPreferences)
    return () => window.removeEventListener('moonsprite:preferences-changed', syncPreferences)
  }, [])

  useEffect(() => {
    moveLayerContentPreviewRef.current = null
    if (moveLayerContentPreviewTimerRef.current !== null) window.clearTimeout(moveLayerContentPreviewTimerRef.current)
    moveLayerContentPreviewTimerRef.current = null
    return () => {
      if (moveLayerContentPreviewTimerRef.current !== null) window.clearTimeout(moveLayerContentPreviewTimerRef.current)
    }
  }, [session.document.id])

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

  const invalidateCompositeRect = (selection: SelectionRect | null | undefined): void => {
    compositeCacheRef.current.invalidateRect(selection, session.document.width, session.document.height, session.document.animation?.activeFrameId)
  }

  const invalidateStrokeSegment = (from: Point, to: Point): void => {
    const stamp = brushStampDimensions(session.brushSize, activeBrushImage)
    const { x: beforeX, y: beforeY } = brushStampAnchor(session.brushSize, activeBrushImage)
    const afterX = stamp.width - beforeX - 1
    const afterY = stamp.height - beforeY - 1
    const fromPoints = symmetryPoints(from, session.document.width, session.document.height, session.symmetryAxes, symmetryCenter)
    const toPoints = symmetryPoints(to, session.document.width, session.document.height, session.symmetryAxes, symmetryCenter)
    const segments = fromPoints.length === toPoints.length
      ? fromPoints.map((start, index) => ({ start, end: toPoints[index] }))
      : fromPoints.flatMap((start) => toPoints.map((end) => ({ start, end })))
    for (const segment of segments) {
      const left = Math.min(segment.start.x, segment.end.x) - beforeX
      const top = Math.min(segment.start.y, segment.end.y) - beforeY
      const right = Math.max(segment.start.x, segment.end.x) + afterX
      const bottom = Math.max(segment.start.y, segment.end.y) + afterY
      invalidateCompositeRect({ x: left, y: top, width: right - left + 1, height: bottom - top + 1 })
    }
  }

  const stopAirbrushTimer = (): void => {
    if (airbrushFrameRef.current !== null) window.cancelAnimationFrame(airbrushFrameRef.current)
    airbrushFrameRef.current = null
  }

  const scheduleAirbrushTimer = (): void => {
    if (airbrushFrameRef.current !== null) return
    const tick = (now: number): void => {
      airbrushFrameRef.current = null
      const drag = inputRef.current.drag
      if (drag?.kind !== 'airbrush' || !drag.edit) return
      const interval = Math.max(16, session.airbrushIntervalMs)
      let batches = 0
      while (now >= (drag.nextAirbrushAt ?? now) && batches < 4) {
        sprayAirbrushRef.current(drag)
        drag.nextAirbrushAt = (drag.nextAirbrushAt ?? now) + interval
        batches += 1
      }
      airbrushFrameRef.current = window.requestAnimationFrame(tick)
    }
    airbrushFrameRef.current = window.requestAnimationFrame(tick)
  }

  const flushSelectionPreview = (drag: DragState, render = false): void => {
    if (!drag.previewPending || !drag.selectionStart || !drag.previewTarget) return
    if (adjustmentPreviewEditRef.current) prepareAdjustmentPreviewEdit(session.document.id)
    drag.previewPending = false
    const target = drag.previewTarget
    const angle = drag.previewAngle ?? 0
    const rawTarget = drag.kind === 'move-selection'
      ? { ...drag.selectionStart, x: target.x, y: target.y }
      : target
    const transformSourceSelection = drag.selectionSource?.selection ?? drag.selectionStart
    drag.previewSelection = hasSymmetry(session.symmetryAxes)
      ? transformSymmetrySelection(transformSourceSelection, rawTarget, session.document.width, session.document.height, angle, drag.previewShear, session.symmetryAxes, symmetryCenter, false)
      : drag.kind === 'move-selection'
        ? rawTarget
        : transformSelectionMask(transformSourceSelection, target, session.document.width, session.document.height, angle, drag.previewShear, false)

    if (drag.kind !== 'move-selection' && drag.selectionSource) {
      invalidateCompositeRect(drag.selectionStart)
      invalidateCompositeRect(drag.appliedSelection)
      invalidateCompositeRect(drag.previewSelection)
      const translation = drag.kind === 'move-content' && !hasSymmetry(session.symmetryAxes) && angle % 360 === 0 && !drag.previewShear && !target.flipHorizontal && !target.flipVertical && target.width === drag.selectionSource.selection.width && target.height === drag.selectionSource.selection.height
      if (translation) {
        if (drag.translationPreview) drag.previewEdit = null
        else if (drag.previewEdit) { revertPixelEdit(session.document, drag.previewEdit); drag.previewEdit = null }
        drag.translationPreview = applySelectionTranslationPreview(session.document, drag.selectionSource, target, drag.copy, drag.translationPreview, activePaintLayer(session))
      } else {
        if (drag.translationPreview) {
          restoreSelectionTranslationPreview(session.document, drag.translationPreview)
          drag.translationPreview = null
        }
        if (drag.previewEdit) revertPixelEdit(session.document, drag.previewEdit)
        drag.previewEdit = applySelectionTransform(session.document, drag.selectionSource, target, angle, drag.copy, drag.previewShear, session.symmetryAxes, symmetryCenter, activePaintLayer(session))
      }
      drag.appliedSelection = drag.previewSelection
    }
    if (render) {
      if (adjustmentPreviewEditRef.current) renderAdjustmentPreviewEdit(session.document.id, drag.previewSelection ?? null)
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

  const updateRotatableDragGeometry = (
    drag: DragState,
    point: Point,
    modifiers: ReturnType<typeof selectionMarqueeModifierState>
  ): { target: SelectionRect; angle: number } | null => {
    if (drag.kind !== 'marquee' && drag.kind !== 'shape') return null
    if (inputRef.current.spaceHeld && drag.transformMoveStart) drag.transformOffset = temporaryTransformOffset(drag.transformMoveStart, point)
    const offset = drag.transformOffset ?? { x: 0, y: 0 }
    const adjustedPoint = { x: point.x - offset.x, y: point.y - offset.y }
    const fixedRatio = drag.kind === 'shape' ? session.shapeRatio : null
    let bounds = drag.marqueeBounds ?? (modifiers.fromCenter
      ? centeredShapeBounds(drag.start, adjustedPoint, modifiers.proportional, fixedRatio)
      : shapeBounds(drag.start, adjustedPoint, modifiers.proportional, fixedRatio))
    let angle = drag.marqueeAngle ?? 0

    if (!modifiers.rotate && drag.marqueeRotationStart) {
      drag.marqueeResizeStart = createMarqueeResizeStart(drag.marqueeBounds ?? drag.marqueeRotationStart.bounds, drag.marqueeRotationStart.lastPointer)
      drag.marqueeRotationStart = undefined
    }

    if (modifiers.rotate) {
      if (!drag.marqueeRotationStart) drag.marqueeRotationStart = { pointer: adjustedPoint, lastPointer: adjustedPoint, angle, bounds: { ...bounds } }
      const rotationStart = drag.marqueeRotationStart
      bounds = rotationStart.bounds
      angle = rotationStart.angle + selectionRotationAngle(bounds, rotationStart.pointer, adjustedPoint)
      rotationStart.lastPointer = { ...adjustedPoint }
      drag.marqueeAngle = angle
    } else if (drag.marqueeResizeStart) {
      bounds = resizeRotatedMarqueeBounds(
        drag.marqueeResizeStart.bounds,
        { x: adjustedPoint.x - drag.marqueeResizeStart.pointer.x, y: adjustedPoint.y - drag.marqueeResizeStart.pointer.y },
        angle,
        drag.marqueeDirection ?? { x: 1, y: 1 },
        drag.marqueeResizeStart.fromCenter || modifiers.fromCenter,
        modifiers.proportional,
        fixedRatio
      )
      drag.marqueeBounds = bounds
    } else if (angle === 0) {
      bounds = modifiers.fromCenter
        ? centeredShapeBounds(drag.start, adjustedPoint, modifiers.proportional, fixedRatio)
        : shapeBounds(drag.start, adjustedPoint, modifiers.proportional, fixedRatio)
      drag.marqueeBounds = bounds
      drag.marqueeDirection = { x: adjustedPoint.x < drag.start.x ? -1 : 1, y: adjustedPoint.y < drag.start.y ? -1 : 1 }
    }

    const target = translatedSelectionRect(bounds, offset)
    drag.previewTarget = target
    drag.previewAngle = angle
    return { target, angle }
  }

  const updateMarqueePreview = (
    drag: DragState,
    point: Point,
    modifiers: ReturnType<typeof selectionMarqueeModifierState>
  ): void => {
    if (drag.kind !== 'marquee') return
    const geometry = updateRotatableDragGeometry(drag, point, modifiers)
    if (!geometry) return
    const { target, angle } = geometry
    const transformed = session.selectionKind === 'ellipse'
      ? rotatedEllipseSelection(target, session.document.width, session.document.height, angle)
      : rotatedRectSelection(target, session.document.width, session.document.height, angle)
    const incoming = transformed
      ? symmetrySelection(transformed, session.document.width, session.document.height, session.symmetryAxes, symmetryCenter)
      : null
    drag.marqueePreviewSelection = incoming
    drag.previewSelection = combineSelection(drag.selectionStart ?? null, incoming, drag.selectionMode ?? session.selectionMode)
    scheduleDraw()
  }

  const updateShapePreview = (
    drag: DragState,
    point: Point,
    modifiers: ReturnType<typeof selectionMarqueeModifierState>
  ): void => {
    if (drag.kind !== 'shape') return
    updateRotatableDragGeometry(drag, point, modifiers)
    scheduleDraw()
  }

  const updateSelectionTransformPreview = (
    drag: DragState,
    point: Point,
    modifiers: ReturnType<typeof selectionTransformModifierState>
  ): void => {
    if (drag.kind !== 'transform-content' || !drag.selectionStart || !drag.selectionSource || !drag.handle) return
    const transformStart = drag.transformStartTarget ?? drag.selectionStart
    const target = resizeTransformedSelectionBounds(
      transformStart,
      { x: point.x - drag.start.x, y: point.y - drag.start.y },
      drag.startAngle ?? 0,
      drag.handle,
      modifiers.proportional,
      modifiers.integerScale,
      modifiers.fromCenter
    )
    if (drag.previewTarget?.x === target.x && drag.previewTarget.y === target.y && drag.previewTarget.width === target.width && drag.previewTarget.height === target.height && drag.previewTarget.flipHorizontal === target.flipHorizontal && drag.previewTarget.flipVertical === target.flipVertical && drag.previewTarget.flipOriginX === target.flipOriginX && drag.previewTarget.flipOriginY === target.flipOriginY) return
    drag.previewTarget = target
    drag.previewAngle = drag.startAngle ?? 0
    drag.previewShear = drag.transformStartShear ? { ...drag.transformStartShear } : undefined
    scheduleSelectionPreview(drag)
  }

  const beginSelectionAdjustmentEdit = (): void => {
    if (adjustmentPreviewEditRef.current) return
    adjustmentPreviewEditRef.current = true
    beginAdjustmentPreviewEdit(session.document.id)
  }

  const endSelectionAdjustmentEdit = (): void => {
    if (!adjustmentPreviewEditRef.current) return
    adjustmentPreviewEditRef.current = false
    endAdjustmentPreviewEdit(session.document.id)
  }

  useEffect(() => () => {
    if (!adjustmentPreviewEditRef.current) return
    adjustmentPreviewEditRef.current = false
    endAdjustmentPreviewEdit(session.document.id)
  }, [session.document.id])

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

  const cancelActiveCanvasInteraction = (): void => {
    stopAirbrushTimer()
    hideMoveLayerContentPreview()
    gradientPreviewCoverageCacheRef.current = null
    const drag = inputRef.current.resetInteraction()
    symmetryDragRef.current = null
    if (selectionPreviewFrameRef.current !== null) {
      window.cancelAnimationFrame(selectionPreviewFrameRef.current)
      selectionPreviewFrameRef.current = null
    }
    if (!drag) {
      endSelectionAdjustmentEdit()
      return
    }
    if (adjustmentPreviewEditRef.current) prepareAdjustmentPreviewEdit(session.document.id)
    const state = useWorkspace.getState()
    let documentChanged = false
    if (drag.floatingPaste) {
      const target = drag.previewSelection ?? drag.selectionStart
      if (target && (drag.previewEdit || drag.translationPreview)) state.updateFloatingPastePreview(drag.previewEdit ?? null, target, drag.translationPreview, drag.previewTarget, drag.previewAngle, drag.previewShear)
    } else documentChanged = revertCancelledCanvasDragPixelChanges(session.document, drag)
    if (drag.kind === 'move-layer') {
      state.mutateActive((active) => {
        if (drag.duplicatedLayerId) {
          active.document.layers = active.document.layers.filter((layer) => layer.id !== drag.duplicatedLayerId)
          if (drag.layerId) active.document.activeLayerId = drag.layerId
          active.selectedLayerIds = drag.originalSelectedLayerIds?.length ? [...drag.originalSelectedLayerIds] : drag.layerId ? [drag.layerId] : []
          active.selectedGroupId = null
          active.selectedGroupIds = []
        } else if (drag.animationCellOffsets && drag.animationCellKeys?.length) {
          setAnimationCelOffsetsForKeys(active.document, drag.animationCellOffsets)
        } else {
          for (const layerId of drag.layerIds ?? (drag.layerId ? [drag.layerId] : [])) {
            const layer = active.document.layers.find((candidate) => candidate.id === layerId)
            const offset = drag.layerOffsets?.[layerId] ?? (layerId === drag.layerId ? drag.layerOffset : undefined)
            if (layer && offset) { layer.offsetX = offset.x; layer.offsetY = offset.y }
          }
        }
        if (drag.selectionStart !== undefined) active.selection = cloneSelection(drag.selectionStart)
      }, false)
      documentChanged = true
    }
    if ((drag.kind === 'canvas-resize' || drag.kind === 'canvas-move') && drag.canvasPreview) {
      if (canvasResizeFrameRef.current !== null) window.cancelAnimationFrame(canvasResizeFrameRef.current)
      canvasResizeFrameRef.current = null
      pendingCanvasResizeRef.current = null
      canvasResizePreviewRef.current = { ...drag.canvasPreview }
      state.setCanvasResizePreview(drag.canvasPreview)
    }
    if (drag.kind === 'pan') finishPanPreview()
    if (drag.kind === 'zoom-drag') finishZoomPreview()
    endSelectionAdjustmentEdit()
    if (documentChanged) compositeCacheRef.current.invalidateAll()
    scheduleDraw()
  }

  useEffect(() => {
    const prepareEscapeCancellation = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && inputRef.current.drag) cancelActiveCanvasInteraction()
    }
    window.addEventListener('keydown', prepareEscapeCancellation, true)
    return () => window.removeEventListener('keydown', prepareEscapeCancellation, true)
  // The capture phase updates floating preview ownership before App handles Escape.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.document.id])

  const drawSelectionOverlay = (): void => {
    const canvas = canvasRef.current
    const overlay = selectionCanvasRef.current
    if (!canvas || !overlay) return
    const currentSession = useWorkspace.getState().sessions.find((item) => item.document.id === session.document.id) ?? session
    const selectionDrag = canvasGestureForPreview(inputRef.current.drag)
    const creatingSelection = selectionDrag?.kind === 'marquee' || selectionDrag?.kind === 'lasso' || selectionDrag?.kind === 'polygon-lasso'
    const transformedDrag = selectionDrag && (selectionDrag.kind === 'move-content' || selectionDrag.kind === 'transform-content' || selectionDrag.kind === 'rotate-content' || selectionDrag.kind === 'shear-content')
      ? selectionDrag
      : null
    const rotatingDrag = transformedDrag?.kind === 'rotate-content' ? transformedDrag : null
    const rotatingSelection = Boolean(rotatingDrag)
    const visibleSelection = selectionOverlayMaskForDrag(currentSession.selection, selectionDrag)
    const rect = stageSize()
    const dpr = window.devicePixelRatio || 1
    const backingWidth = Math.max(1, Math.round(rect.width * dpr))
    const backingHeight = Math.max(1, Math.round(rect.height * dpr))
    if (overlay.width !== backingWidth || overlay.height !== backingHeight) { overlay.width = backingWidth; overlay.height = backingHeight }
    const displayContext = overlay.getContext('2d')
    if (!displayContext) return
    displayContext.setTransform(dpr, 0, 0, dpr, 0, 0)
    displayContext.clearRect(0, 0, rect.width, rect.height)
    const shouldDrawSelection = Boolean(visibleSelection)
    selectionOverlayVisibleRef.current = shouldDrawSelection
    if (!shouldDrawSelection || !visibleSelection) return
    const renderPlan = createCanvasRenderPlan(rect.width, rect.height, session.document, liveViewRef.current, rotationIndicatorPosition)
    const { rotated, sceneLeft, sceneTop, sceneWidth, sceneHeight } = renderPlan
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
    const floatingTransform = currentSession.pendingPaste
    const transformedTarget = transformedDrag
      ? transformedDrag.previewTarget ?? transformedDrag.transformStartTarget ?? transformedDrag.selectionStart ?? undefined
      : floatingTransform?.transformTarget
    const transformedAngle = transformedDrag
      ? transformedDrag.previewAngle ?? transformedDrag.startAngle ?? 0
      : floatingTransform?.transformAngle ?? 0
    const transformedShear = transformedDrag
      ? transformedDrag.previewShear ?? transformedDrag.transformStartShear
      : floatingTransform?.transformShear
    const transformedHandlePoints = transformedTarget
      ? transformedSelectionControlPoints(
          transformedTarget,
          transformedAngle,
          transformedShear
        ).map((point) => selectionScreenPoint(rect.width, rect.height, session.document.width, session.document.height, liveViewRef.current, point))
      : undefined
    const drawOverlaySelection = (selection: SelectionMask, showHandles: boolean): void => {
      selectionBoundaryCacheRef.current = drawSelectionOutline({
        context,
        selection,
        box: selectionScreenBox(rect.width, rect.height, session.document.width, session.document.height, liveViewRef.current, selection),
        view: liveViewRef.current,
        viewportWidth: rect.width,
        viewportHeight: rect.height,
        rotationIndicatorPosition,
        cache: selectionBoundaryCacheRef.current,
        outlineDark: activeTheme.variables['--theme-selection-outline-dark'],
        outlineLight: activeTheme.variables['--theme-selection-outline-light'],
        showOutline: !rotatingSelection && currentSession.view.showSelectionOutline !== false,
        showHandles,
        handlePoints: transformedHandlePoints
      })
    }
    drawOverlaySelection(visibleSelection, currentSession.tool === 'selection' && !creatingSelection)
    if (rotated) {
      displayContext.save()
      applyViewRotation(displayContext, rect.width, rect.height, liveViewRef.current)
      displayContext.imageSmoothingEnabled = false
      const scene = selectionRotationSceneRef.current!
      displayContext.drawImage(scene, 0, 0, scene.width, scene.height, sceneLeft, sceneTop, scene.width / dpr, scene.height / dpr)
      displayContext.restore()
    }
  }

  const draw = (): void => {
    const performanceProbe = window.__moonSpriteCanvasProbe
    const drawStartedAt = performanceProbe ? performance.now() : 0
    const canvas = canvasRef.current
    if (!canvas) return
    const currentSession = useWorkspace.getState().sessions.find((item) => item.document.id === session.document.id) ?? session
    const currentActiveLayer = activePaintLayer(currentSession)
    const currentLayerMask = activeLayerMask(currentSession)
    const isolatedLayerMask = currentSession.layerMaskIsolatedView ? currentLayerMask : null
    const currentHasRasterSelection = Boolean(currentLayerMask) || (currentSession.selectedGroupIds.length === 0 && currentSession.selectedLayerIds.some((id) => currentSession.document.layers.some((layer) => layer.id === id)))
    const canRenderToolPreview = !canvasResizePreviewRef.current && currentHasRasterSelection && isLayerEffectivelyVisible(currentSession.document, currentActiveLayer) && !isLayerEffectivelyLocked(currentSession.document, currentActiveLayer)
    const rect = stageSize()
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
    const smoothPixelSampling = pixelSamplingMode(view.zoom) === 'smooth'
    const renderPlan = createCanvasRenderPlan(rect.width, rect.height, document, view, rotationIndicatorPosition)
    const { rotated, viewport, sceneLeft, sceneTop, sceneWidth, sceneHeight, originX, originY, canvasWidth, canvasHeight, fromX, fromY, toX, toY } = renderPlan
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
    context.fillStyle = activeTheme.definition.seeds.canvasSurround
    context.fillRect(rotated ? sceneLeft : 0, rotated ? sceneTop : 0, rotated ? sceneWidth : rect.width, rotated ? sceneHeight : rect.height)
    context.save()
    context.save()
    context.beginPath()
    context.rect(originX, originY, canvasWidth, canvasHeight)
    context.clip()
    const checkerCell = checkerboard.size * view.zoom
    context.fillStyle = `rgb(${checkerboard.lightColor.r} ${checkerboard.lightColor.g} ${checkerboard.lightColor.b})`
    context.fillRect(originX, originY, canvasWidth, canvasHeight)
    if (checkerCell >= 2) {
      const integerCell = Number.isInteger(checkerCell)
      const tileKey = `${checkerCell}:${checkerboard.lightColor.r},${checkerboard.lightColor.g},${checkerboard.lightColor.b}:${checkerboard.darkColor.r},${checkerboard.darkColor.g},${checkerboard.darkColor.b}`
      let pattern: CanvasPattern | null = null
      if (integerCell && typeof context.createPattern === 'function') {
        let tile = checkerboardTileRef.current
        const tileSize = Math.max(1, Math.round(checkerCell))
        if (!tile || tile.key !== tileKey || tile.canvas.width !== tileSize * 2 || tile.canvas.height !== tileSize * 2) {
          const canvas = new OffscreenCanvas(tileSize * 2, tileSize * 2)
          const tileContext = canvas.getContext('2d')
          if (tileContext) {
            tileContext.fillStyle = `rgb(${checkerboard.lightColor.r} ${checkerboard.lightColor.g} ${checkerboard.lightColor.b})`
            tileContext.fillRect(0, 0, tileSize * 2, tileSize * 2)
            tileContext.fillStyle = `rgb(${checkerboard.darkColor.r} ${checkerboard.darkColor.g} ${checkerboard.darkColor.b})`
            tileContext.fillRect(tileSize, 0, tileSize, tileSize)
            tileContext.fillRect(0, tileSize, tileSize, tileSize)
          }
          tile = { key: tileKey, canvas }
          checkerboardTileRef.current = tile
        }
        pattern = context.createPattern(tile.canvas, 'repeat')
        pattern?.setTransform(new DOMMatrix([1, 0, 0, 1, originX, originY]))
      }
      if (pattern) {
        context.fillStyle = pattern
        context.fillRect(originX, originY, canvasWidth, canvasHeight)
      } else {
        const firstColumn = Math.max(0, Math.floor((viewport.left - originX) / checkerCell))
        const firstRow = Math.max(0, Math.floor((viewport.top - originY) / checkerCell))
        const lastColumn = Math.min(Math.ceil(document.width / checkerboard.size), Math.ceil((viewport.right - originX) / checkerCell))
        const lastRow = Math.min(Math.ceil(document.height / checkerboard.size), Math.ceil((viewport.bottom - originY) / checkerCell))
        context.fillStyle = `rgb(${checkerboard.darkColor.r} ${checkerboard.darkColor.g} ${checkerboard.darkColor.b})`
        for (let row = firstRow; row < lastRow; row += 1) {
          for (let column = firstColumn; column < lastColumn; column += 1) {
            if ((column + row) % 2 === 0) continue
            context.fillRect(originX + column * checkerCell, originY + row * checkerCell, checkerCell, checkerCell)
          }
        }
      }
    }
    context.restore()

    const drawGrid = (gridX: number, gridY: number, cellWidth: number, cellHeight: number, color: RgbaColor): void => {
      context.save()
      context.beginPath()
      context.rect(originX, originY, canvasWidth, canvasHeight)
      context.clip()
      context.globalCompositeOperation = 'source-over'
      context.globalAlpha = 1
      context.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a / 255})`
      const devicePixel = 1 / dpr
      const alignToDevicePixel = (value: number): number => Math.round(value * dpr) / dpr
      const visibleLeft = alignToDevicePixel(originX + fromX * view.zoom)
      const visibleTop = alignToDevicePixel(originY + fromY * view.zoom)
      const visibleRight = alignToDevicePixel(originX + toX * view.zoom)
      const visibleBottom = alignToDevicePixel(originY + toY * view.zoom)
      for (const x of gridLinePositions(gridX, cellWidth, fromX, toX, view.zoom)) {
        const screenX = alignToDevicePixel(originX + x * view.zoom)
        context.fillRect(screenX, visibleTop, devicePixel, Math.max(devicePixel, visibleBottom - visibleTop + devicePixel))
      }
      for (const y of gridLinePositions(gridY, cellHeight, fromY, toY, view.zoom)) {
        const screenY = alignToDevicePixel(originY + y * view.zoom)
        context.fillRect(visibleLeft, screenY, Math.max(devicePixel, visibleRight - visibleLeft + devicePixel), devicePixel)
      }
      context.restore()
    }

    if (toX > fromX && toY > fromY) {
      if (!isolatedLayerMask && !timelineHidden && onionSkin.enabled && !currentSession.animationPlaying) {
        const timeline = currentSession.document.animation
        if (timeline && timeline.frames.length > 1) {
          const refs = onionSkinFrameRefs(timeline, onionSkin.previousFrames, onionSkin.nextFrames)
          onionSkinCacheRef.current.draw({
            context,
            document: currentSession.document,
            refs,
            style: onionSkin,
            originX,
            originY,
            canvasWidth,
            canvasHeight,
            fromX,
            fromY,
            toX,
            toY,
            zoom: view.zoom,
            revision: currentSession.contentRevision,
            invalidation: currentSession.contentInvalidation,
            imageSmoothingEnabled: smoothPixelSampling
          })
        }
      }
      compositeCacheRef.current.draw({
        context,
        document,
        view,
        originX,
        originY,
        canvasWidth,
        canvasHeight,
        fromX,
        fromY,
        toX,
        toY,
        revision: currentSession.revision,
        contentRevision: currentSession.contentRevision,
        contentInvalidation: currentSession.contentInvalidation,
        frameId: document.animation?.activeFrameId,
        isolatedLayerMask: isolatedLayerMask ?? undefined,
        imageSmoothingEnabled: smoothPixelSampling
      })
      if (view.showPixelGrid && shouldRenderPixelGrid(view.zoom)) drawGrid(0, 0, 1, 1, gridColors.pixelGridColor)
    }

    const activeLayer = activePaintLayer(currentSession)
    const cachedPointSampler = compositePointSamplerRef.current
    const compositePointSampler = cachedPointSampler && cachedPointSampler.document === document && cachedPointSampler.revision === currentSession.contentRevision
      ? cachedPointSampler.sampler
      : createNormalCompositePointSampler(document) ?? createCompositePointSampler(document)
    if (compositePointSampler !== cachedPointSampler?.sampler) compositePointSamplerRef.current = { document, revision: currentSession.contentRevision, sampler: compositePointSampler }
    const cachedReplacementSampler = compositeReplacementSamplerRef.current
    const compositePointReplacementSampler = cachedReplacementSampler
      && cachedReplacementSampler.document === document
      && cachedReplacementSampler.revision === currentSession.revision
      && cachedReplacementSampler.layerId === activeLayer.id
      ? cachedReplacementSampler.sampler
      : createNormalCompositePointReplacementSampler(document, activeLayer.id) ?? createCompositePointReplacementSampler(document, activeLayer.id)
    if (compositePointReplacementSampler !== cachedReplacementSampler?.sampler) {
      compositeReplacementSamplerRef.current = { document, revision: currentSession.revision, layerId: activeLayer.id, sampler: compositePointReplacementSampler }
    }
    const sampleCompositeForPreview = (x: number, y: number): RgbaColor => {
      if (isolatedLayerMask) return readLayerMaskDisplayColorAt(isolatedLayerMask, x, y)
      return compositePointSampler(x, y)
    }
    const previewColorAt = (pixelX: number, pixelY: number, erase = false, coverage = 255, paintColor = session.primaryColor): RgbaColor => {
      const layerColor = readLayerColorAt(document, activeLayer, pixelX, pixelY)
      const replacement = erase
        ? coverage === 255 ? TRANSPARENT : { ...layerColor, a: Math.round(layerColor.a * (1 - coverage / 255)) }
        : coverage < 255 || (paintColor.a > 0 && paintColor.a < 255)
          ? blendOver(layerColor, { ...paintColor, a: Math.round(paintColor.a * coverage / 255) })
          : paintColor
      return isolatedLayerMask
        ? layerMaskDisplayColor(replacement)
        : compositePointReplacementSampler(pixelX, pixelY, replacement)
    }
    const previewPixelRect = (pixelX: number, pixelY: number): { x: number; y: number; width: number; height: number } =>
      deviceAlignedPixelRect(originX, originY, view.zoom, pixelX, pixelY, dpr)
    const drawPreviewPixel = (pixelX: number, pixelY: number, color: RgbaColor): { x: number; y: number; width: number; height: number } => {
      const pixelRect = previewPixelRect(pixelX, pixelY)
      const transparency = transparencyColorAt(pixelX, pixelY, checkerboard)
      const displayColor = view.relativeLuminance ? relativeLuminanceColor(color) : color
      context.fillStyle = `rgb(${transparency.r} ${transparency.g} ${transparency.b})`
      context.fillRect(pixelRect.x, pixelRect.y, pixelRect.width, pixelRect.height)
      if (displayColor.a > 0) {
        context.fillStyle = `rgb(${displayColor.r} ${displayColor.g} ${displayColor.b} / ${displayColor.a / 255})`
        context.fillRect(pixelRect.x, pixelRect.y, pixelRect.width, pixelRect.height)
      }
      return pixelRect
    }
    const drawSampledFilledShapePreview = (shape: SelectionRect, kind: 'rectangle' | 'ellipse', angle: number): boolean => {
      if (view.zoom >= 1 || Math.abs(angle % 360) > 1e-9 || hasSymmetry(session.symmetryAxes) || shape.width * shape.height < 128 * 128) return false
      const left = Math.max(0, fromX, shape.x)
      const top = Math.max(0, fromY, shape.y)
      const right = Math.min(document.width, toX, shape.x + shape.width)
      const bottom = Math.min(document.height, toY, shape.y + shape.height)
      if (right <= left || bottom <= top) return true

      const targetLeft = Math.floor((originX + left * view.zoom) * dpr)
      const targetTop = Math.floor((originY + top * view.zoom) * dpr)
      const targetRight = Math.ceil((originX + right * view.zoom) * dpr)
      const targetBottom = Math.ceil((originY + bottom * view.zoom) * dpr)
      const targetWidth = Math.max(1, targetRight - targetLeft)
      const targetHeight = Math.max(1, targetBottom - targetTop)
      const pixels = new Uint8ClampedArray(targetWidth * targetHeight * 4)

      for (let targetY = 0; targetY < targetHeight; targetY += 1) {
        const pixelY = Math.floor((((targetTop + targetY + 0.5) / dpr) - originY) / view.zoom)
        for (let targetX = 0; targetX < targetWidth; targetX += 1) {
          const pixelX = Math.floor((((targetLeft + targetX + 0.5) / dpr) - originX) / view.zoom)
          if (!shapeContainsPixel(shape, kind, pixelX, pixelY)) continue
          const color = previewColorAt(pixelX, pixelY)
          const displayColor = view.relativeLuminance ? relativeLuminanceColor(color) : color
          const transparency = transparencyColorAt(pixelX, pixelY, checkerboard)
          const alpha = displayColor.a / 255
          const index = (targetY * targetWidth + targetX) * 4
          pixels[index] = Math.round(displayColor.r * alpha + transparency.r * (1 - alpha))
          pixels[index + 1] = Math.round(displayColor.g * alpha + transparency.g * (1 - alpha))
          pixels[index + 2] = Math.round(displayColor.b * alpha + transparency.b * (1 - alpha))
          pixels[index + 3] = 255
        }
      }

      const surface = new OffscreenCanvas(targetWidth, targetHeight)
      surface.getContext('2d')?.putImageData(new ImageData(pixels, targetWidth, targetHeight), 0, 0)
      context.save()
      context.beginPath()
      context.rect(originX, originY, canvasWidth, canvasHeight)
      context.clip()
      context.imageSmoothingEnabled = false
      context.drawImage(surface, targetLeft / dpr, targetTop / dpr, targetWidth / dpr, targetHeight / dpr)
      context.restore()
      return true
    }
    const drawSelectionPathPreview = (previewPixels: Iterable<string>): void => {
      context.save()
      context.beginPath()
      context.rect(originX, originY, canvasWidth, canvasHeight)
      context.clip()
      for (const value of previewPixels) {
        const [x, y] = value.split(':').map(Number)
        const pixelRect = previewPixelRect(x, y)
        const insideDocument = x >= 0 && y >= 0 && x < document.width && y < document.height
        if (!selectionPathPreviewPixelVisible(pixelRect, rect.width, rect.height, insideDocument)) continue
        const sampled = sampleCompositeForPreview(x, y)
        const background = sampled.a > 0 ? sampled : transparencyColorAt(x, y, checkerboard)
        context.fillStyle = colorLuminance(background) > 145 ? activeTheme.variables['--theme-selection-outline-dark'] : activeTheme.variables['--theme-selection-outline-light']
        context.fillRect(pixelRect.x, pixelRect.y, pixelRect.width, pixelRect.height)
      }
      context.restore()
    }
    const drawSelectionCursorCorners = (pixelX: number, pixelY: number, color: string): void => {
      const pixelRect = previewPixelRect(pixelX, pixelY)
      context.save()
      context.fillStyle = color
      for (const mark of selectionCursorCornerRects(pixelRect, dpr)) context.fillRect(mark.x, mark.y, mark.width, mark.height)
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
          const sampled = sampleCompositeForPreview(x, y)
          const background = sampled.a > 0 ? sampled : transparencyColorAt(x, y, checkerboard)
          context.fillStyle = colorLuminance(background) > 145 ? activeTheme.variables['--theme-selection-outline-dark'] : activeTheme.variables['--theme-selection-outline-light']
          const pixelRect = previewPixelRect(x, y)
          context.fillRect(pixelRect.x, pixelRect.y, pixelRect.width, pixelRect.height)
        }
      }
      context.restore()
    }
    const drawStrokePreview = (from: Point, to: Point, erase = false): void => {
      const stamp = brushStampDimensions(session.brushSize, activeBrushImage)
      const { x: beforeX, y: beforeY } = brushStampAnchor(session.brushSize, activeBrushImage)
      const patternOrigin = brushPatternOrigin(from)
      const drawn = new Set<number>()
      const centers = balancedShiftLineEnabled ? balancedStairLinePoints(from, to) : rasterLinePoints(from, to)
      for (const center of centers) {
        const x = center.x
        const y = center.y
        const texture = session.tool === 'pencil' || session.tool === 'eraser' ? activeBrushTexture : 'solid'
        const mask = brushMaskOffsets(session.brushSize, session.brushShape, texture, session.brushTextureScale, x - beforeX, y - beforeY, session.tool === 'pencil' || session.tool === 'eraser' ? activeBrushImage : null, session.brushImageSettings, proceduralAntialiasStrength, activeBrushPreviewMode, patternOrigin.x, patternOrigin.y)
        for (const offset of mask) {
          for (const { x: pixelX, y: pixelY } of symmetryPoints({ x: x - beforeX + offset.x, y: y - beforeY + offset.y }, document.width, document.height, session.symmetryAxes, symmetryCenter)) {
            const index = pixelY * document.width + pixelX
            if (pixelX < fromX || pixelY < fromY || pixelX >= toX || pixelY >= toY || drawn.has(index) || (session.selection && !selectionContains(session.selection, pixelX, pixelY))) continue
            drawn.add(index)
            drawPreviewPixel(pixelX, pixelY, previewColorAt(pixelX, pixelY, erase, offset.coverage, offset.color ?? session.primaryColor))
          }
        }
      }
    }

    if (session.outlinePreview && session.selection) {
      const outlineLayer = activePaintLayer(currentSession)
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
        drawPreviewPixel(pixelX, pixelY, isolatedLayerMask ? layerMaskDisplayColor(color) : compositePixelWithLayerColor(document, index, outlineLayer.id, color))
      }
    }

    const drag = inputRef.current.drag
    if (canRenderToolPreview && drag?.kind === 'shape') {
      const shape = drag.previewTarget ?? shapeBounds(drag.start, drag.last, drag.constrain, session.shapeRatio)
      const angle = drag.previewAngle ?? 0
      const sampled = (session.shapeKind === 'rectangle' || session.shapeKind === 'ellipse')
        && drawSampledFilledShapePreview(shape, session.shapeKind, angle)
      if (!sampled) {
        for (const sourcePoint of rotatedShapePixelPoints(shape, session.shapeKind, document.width, document.height, angle)) {
          for (const point of symmetryPoints(sourcePoint, document.width, document.height, session.symmetryAxes, symmetryCenter)) {
            const color = previewColorAt(point.x, point.y)
            drawPreviewPixel(point.x, point.y, color)
          }
        }
      }
    }
    if (canRenderToolPreview && drag?.kind === 'gradient') {
      const moved = drag.start.x !== drag.last.x || drag.start.y !== drag.last.y
      if (moved) {
        const startColor = drag.color ?? session.primaryColor
        const endColor = drag.gradientEndColor ?? session.secondaryColor
        const selection = session.selection
        const paintRegion = drag.gradientPaintRegion
        let previewFromX = fromX
        let previewFromY = fromY
        let previewToX = toX
        let previewToY = toY
        if (selection) {
          previewFromX = Math.max(previewFromX, selection.x)
          previewFromY = Math.max(previewFromY, selection.y)
          previewToX = Math.min(previewToX, selection.x + selection.width)
          previewToY = Math.min(previewToY, selection.y + selection.height)
        }
        if (paintRegion) {
          previewFromX = Math.max(previewFromX, paintRegion.x)
          previewFromY = Math.max(previewFromY, paintRegion.y)
          previewToX = Math.min(previewToX, paintRegion.x + paintRegion.width)
          previewToY = Math.min(previewToY, paintRegion.y + paintRegion.height)
        }
        if (previewToX > previewFromX && previewToY > previewFromY) {
          const sampleGradient = createGradientColorSampler(startColor, endColor, drag.start, drag.last, gradientDither)
          const sampleCompositeReplacement = compositePointReplacementSampler
          const firstPixelRect = previewPixelRect(previewFromX, previewFromY)
          const lastPixelRect = previewPixelRect(previewToX - 1, previewToY - 1)
          const targetX = firstPixelRect.x
          const targetY = firstPixelRect.y
          const targetWidth = lastPixelRect.x + lastPixelRect.width - targetX
          const targetHeight = lastPixelRect.y + lastPixelRect.height - targetY
          const nativeSourceWidth = Math.max(1, Math.round(targetWidth * dpr))
          const nativeSourceHeight = Math.max(1, Math.round(targetHeight * dpr))
          const visibleDocumentWidth = previewToX - previewFromX
          const visibleDocumentHeight = previewToY - previewFromY
          const sourceBasisWidth = view.zoom < 1 && gradientDither !== 'none' ? visibleDocumentWidth : nativeSourceWidth
          const sourceBasisHeight = view.zoom < 1 && gradientDither !== 'none' ? visibleDocumentHeight : nativeSourceHeight
          const previewSampleLimit = view.zoom < 1 && gradientDither !== 'none'
            ? DITHERED_GRADIENT_PREVIEW_SAMPLE_LIMIT
            : view.zoom < 1 ? SMOOTH_GRADIENT_PREVIEW_SAMPLE_LIMIT : Number.POSITIVE_INFINITY
          const previewScale = Math.min(1, Math.sqrt(previewSampleLimit / (sourceBasisWidth * sourceBasisHeight)))
          const sourceWidth = Math.max(1, Math.round(sourceBasisWidth * previewScale))
          const sourceHeight = Math.max(1, Math.round(sourceBasisHeight * previewScale))
          let surface = gradientPreviewSurfaceRef.current
          if (!surface || surface.width !== sourceWidth || surface.height !== sourceHeight) {
            const surfaceCanvas = new OffscreenCanvas(sourceWidth, sourceHeight)
            const surfaceContext = surfaceCanvas.getContext('2d')
            surface = null
            if (surfaceContext) {
              const pixels = new Uint8ClampedArray(sourceWidth * sourceHeight * 4)
              surface = {
                canvas: surfaceCanvas,
                context: surfaceContext,
                imageData: new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, sourceWidth, sourceHeight),
                pixels,
                width: sourceWidth,
                height: sourceHeight
              }
              gradientPreviewSurfaceRef.current = surface
            }
          }
          if (surface) {
            const pixels = surface.pixels
            pixels.fill(0)
            const writeSample = (sampleX: number, sampleY: number, alpha: number, left: number, top: number, right: number, bottom: number, sampledGradientColor?: RgbaColor): void => {
              if (alpha <= 0 || right <= left || bottom <= top) return
              const gradientColor = sampledGradientColor ?? sampleGradient(sampleX, sampleY)
              const layerColor = readLayerColorAt(document, activeLayer, sampleX, sampleY)
              const replacement = gradientColor.a > 0 && gradientColor.a < 255 ? blendOver(layerColor, gradientColor) : gradientColor
              const previewColor = isolatedLayerMask ? layerMaskDisplayColor(replacement) : sampleCompositeReplacement(sampleX, sampleY, replacement)
              const displayColor = view.relativeLuminance ? relativeLuminanceColor(previewColor) : previewColor
              const transparency = transparencyColorAt(sampleX, sampleY, checkerboard)
              const composited = displayColor.a > 0
                ? blendOver({ r: transparency.r, g: transparency.g, b: transparency.b, a: 255 }, displayColor)
                : transparency
              for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) {
                const offset = (y * sourceWidth + x) * 4
                pixels[offset] = composited.r
                pixels[offset + 1] = composited.g
                pixels[offset + 2] = composited.b
                pixels[offset + 3] = alpha
              }
            }
            const previewDocumentBlockAt = (deviceX: number, deviceY: number): { fromX: number; fromY: number; toX: number; toY: number; centerX: number; centerY: number } | null => {
              if (sourceWidth === visibleDocumentWidth && sourceHeight === visibleDocumentHeight) {
                const x = previewFromX + deviceX
                const y = previewFromY + deviceY
                return { fromX: x, fromY: y, toX: x + 1, toY: y + 1, centerX: x, centerY: y }
              }
              const documentLeft = (targetX + deviceX / sourceWidth * targetWidth - originX) / view.zoom
              const documentTop = (targetY + deviceY / sourceHeight * targetHeight - originY) / view.zoom
              const documentRight = (targetX + (deviceX + 1) / sourceWidth * targetWidth - originX) / view.zoom
              const documentBottom = (targetY + (deviceY + 1) / sourceHeight * targetHeight - originY) / view.zoom
              const blockFromX = Math.max(previewFromX, Math.floor(documentLeft + 1e-9))
              const blockFromY = Math.max(previewFromY, Math.floor(documentTop + 1e-9))
              const blockToX = Math.min(previewToX, Math.ceil(documentRight - 1e-9))
              const blockToY = Math.min(previewToY, Math.ceil(documentBottom - 1e-9))
              if (blockToX <= blockFromX || blockToY <= blockFromY) return null
              return {
                fromX: blockFromX,
                fromY: blockFromY,
                toX: blockToX,
                toY: blockToY,
                centerX: Math.min(blockToX - 1, blockFromX + Math.floor((blockToX - blockFromX) / 2)),
                centerY: Math.min(blockToY - 1, blockFromY + Math.floor((blockToY - blockFromY) / 2))
              }
            }
            const averagedDitherColor = (block: NonNullable<ReturnType<typeof previewDocumentBlockAt>>, allowed?: (x: number, y: number) => boolean): RgbaColor | undefined => {
              if (gradientDither === 'none') return undefined
              let count = 0
              let alpha = 0
              let red = 0
              let green = 0
              let blue = 0
              for (let y = block.fromY; y < block.toY; y += 1) for (let x = block.fromX; x < block.toX; x += 1) {
                if (allowed && !allowed(x, y)) continue
                const color = sampleGradient(x, y)
                count += 1
                alpha += color.a
                red += color.r * color.a
                green += color.g * color.a
                blue += color.b * color.a
              }
              if (count === 0) return undefined
              return {
                r: alpha > 0 ? Math.round(red / alpha) : 0,
                g: alpha > 0 ? Math.round(green / alpha) : 0,
                b: alpha > 0 ? Math.round(blue / alpha) : 0,
                a: Math.round(alpha / count)
              }
            }
            if (view.zoom >= 1) {
              for (let y = previewFromY; y < previewToY; y += 1) for (let x = previewFromX; x < previewToX; x += 1) {
                if (selection && !selectionContains(selection, x, y)) continue
                if (paintRegion && !selectionContains(paintRegion, x, y)) continue
                const pixelRect = previewPixelRect(x, y)
                const left = Math.max(0, Math.round((pixelRect.x - targetX) * dpr))
                const top = Math.max(0, Math.round((pixelRect.y - targetY) * dpr))
                const right = Math.min(sourceWidth, Math.round((pixelRect.x + pixelRect.width - targetX) * dpr))
                const bottom = Math.min(sourceHeight, Math.round((pixelRect.y + pixelRect.height - targetY) * dpr))
                writeSample(x, y, 255, left, top, right, bottom)
              }
            } else {
              const selectionMask = selection?.mask
              const paintMask = paintRegion?.mask
              if (!selectionMask && !paintMask) {
                for (let deviceY = 0; deviceY < sourceHeight; deviceY += 1) for (let deviceX = 0; deviceX < sourceWidth; deviceX += 1) {
                  const block = previewDocumentBlockAt(deviceX, deviceY)
                  if (!block) continue
                  writeSample(block.centerX, block.centerY, 255, deviceX, deviceY, deviceX + 1, deviceY + 1, averagedDitherColor(block))
                }
              } else {
                const maskedPointAllowed = (x: number, y: number): boolean =>
                  (!selectionMask || selectionMask[(y - selection!.y) * selection!.width + x - selection!.x] === 1)
                  && (!paintMask || paintMask[(y - paintRegion!.y) * paintRegion!.width + x - paintRegion!.x] === 1)
                let coverageCache = gradientPreviewCoverageCacheRef.current
                const cacheMatches = coverageCache
                  && coverageCache.selection === selection
                  && coverageCache.paintRegion === paintRegion
                  && coverageCache.previewFromX === previewFromX
                  && coverageCache.previewFromY === previewFromY
                  && coverageCache.previewToX === previewToX
                  && coverageCache.previewToY === previewToY
                  && coverageCache.targetX === targetX
                  && coverageCache.targetY === targetY
                  && coverageCache.targetWidth === targetWidth
                  && coverageCache.targetHeight === targetHeight
                  && coverageCache.sourceWidth === sourceWidth
                  && coverageCache.sourceHeight === sourceHeight
                  && coverageCache.zoom === view.zoom
                  && coverageCache.originX === originX
                  && coverageCache.originY === originY
                  && coverageCache.dpr === dpr
                if (!cacheMatches) {
                  const coverage = new Uint8ClampedArray(sourceWidth * sourceHeight)
                  const sampleX = new Int32Array(sourceWidth * sourceHeight)
                  const sampleY = new Int32Array(sourceWidth * sourceHeight)
                  for (let deviceY = 0; deviceY < sourceHeight; deviceY += 1) for (let deviceX = 0; deviceX < sourceWidth; deviceX += 1) {
                    const block = previewDocumentBlockAt(deviceX, deviceY)
                    if (!block) continue
                    const total = (block.toX - block.fromX) * (block.toY - block.fromY)
                    let valid = 0
                    let firstValidX = -1
                    let firstValidY = -1
                    for (let y = block.fromY; y < block.toY; y += 1) for (let x = block.fromX; x < block.toX; x += 1) {
                      if (!maskedPointAllowed(x, y)) continue
                      valid += 1
                      if (firstValidX < 0) { firstValidX = x; firstValidY = y }
                    }
                    if (valid === 0) continue
                    const offset = deviceY * sourceWidth + deviceX
                    const centerValid = maskedPointAllowed(block.centerX, block.centerY)
                    coverage[offset] = Math.round(valid / total * 255)
                    sampleX[offset] = centerValid ? block.centerX : firstValidX
                    sampleY[offset] = centerValid ? block.centerY : firstValidY
                  }
                  coverageCache = {
                    selection,
                    paintRegion,
                    previewFromX,
                    previewFromY,
                    previewToX,
                    previewToY,
                    targetX,
                    targetY,
                    targetWidth,
                    targetHeight,
                    sourceWidth,
                    sourceHeight,
                    zoom: view.zoom,
                    originX,
                    originY,
                    dpr,
                    coverage,
                    sampleX,
                    sampleY
                  }
                  gradientPreviewCoverageCacheRef.current = coverageCache
                }
                if (coverageCache) {
                  for (let deviceY = 0; deviceY < sourceHeight; deviceY += 1) for (let deviceX = 0; deviceX < sourceWidth; deviceX += 1) {
                    const offset = deviceY * sourceWidth + deviceX
                    const alpha = coverageCache.coverage[offset]
                    if (alpha === 0) continue
                    const block = previewDocumentBlockAt(deviceX, deviceY)
                    if (!block) continue
                    writeSample(coverageCache.sampleX[offset], coverageCache.sampleY[offset], alpha, deviceX, deviceY, deviceX + 1, deviceY + 1, averagedDitherColor(block, maskedPointAllowed))
                  }
                }
              }
            }
            surface.context.putImageData(surface.imageData, 0, 0)
            context.save()
            context.globalCompositeOperation = 'source-over'
            context.globalAlpha = 1
            context.imageSmoothingEnabled = smoothPixelSampling
            if (smoothPixelSampling) context.imageSmoothingQuality = 'high'
            context.drawImage(
              surface.canvas,
              0,
              0,
              sourceWidth,
              sourceHeight,
              targetX,
              targetY,
              targetWidth,
              targetHeight
            )
            context.restore()
          }
        }
      }
      context.save()
      context.beginPath()
      context.rect(originX, originY, canvasWidth, canvasHeight)
      context.clip()
      context.strokeStyle = activeTheme.definition.seeds.accent
      context.fillStyle = activeTheme.definition.seeds.accent
      context.lineWidth = 1
      context.setLineDash([])
      const startX = originX + (drag.start.x + 0.5) * view.zoom
      const startY = originY + (drag.start.y + 0.5) * view.zoom
      const endX = originX + (drag.last.x + 0.5) * view.zoom
      const endY = originY + (drag.last.y + 0.5) * view.zoom
      context.beginPath()
      context.moveTo(startX, startY)
      context.lineTo(endX, endY)
      context.stroke()
      context.fillRect(startX - 2, startY - 2, 5, 5)
      context.fillRect(endX - 2, endY - 2, 5, 5)
      context.restore()
    }
    if (shiftLinePreviewEnabled && lineConnectionConfigured && canRenderToolPreview && !inputRef.current.spaceHeld && !inputRef.current.sampling && (session.tool === 'pencil' || session.tool === 'eraser') && inputRef.current.shiftLinePreview && inputRef.current.pointer.visible && lineAnchor) {
      const target = constrainedLineTarget(inputRef.current.pointer.point, { ctrlKey: inputRef.current.ctrlHeld, metaKey: false, altKey: inputRef.current.altHeld, shiftKey: inputRef.current.shiftHeld })
      drawStrokePreview(lineAnchor, target, session.tool === 'eraser')
    }

    if (hasSymmetry(session.symmetryAxes)) {
      context.save()
      context.beginPath()
      context.rect(originX, originY, canvasWidth, canvasHeight)
      context.clip()
      context.strokeStyle = `rgb(${symmetryAxisPreferences.color.r} ${symmetryAxisPreferences.color.g} ${symmetryAxisPreferences.color.b})`
      context.globalAlpha = symmetryAxisPreferences.color.a / 255
      context.lineWidth = symmetryAxisPreferences.thickness
      context.setLineDash([])
      for (const axis of (['horizontal', 'vertical', 'diagonalUp', 'diagonalDown'] as SymmetryAxis[])) {
        if (!session.symmetryAxes[axis]) continue
        const segment = symmetryAxisSegment(axis, document.width, document.height, symmetryCenter)
        if (!segment) continue
        context.beginPath()
        context.moveTo(originX + segment.start.x * view.zoom, originY + segment.start.y * view.zoom)
        context.lineTo(originX + segment.end.x * view.zoom, originY + segment.end.y * view.zoom)
        context.stroke()
      }
      const centerX = originX + symmetryCenter.x * view.zoom
      const centerY = originY + symmetryCenter.y * view.zoom
      const centerSize = Math.max(6, Math.min(12, view.zoom * 0.45))
      context.fillStyle = context.strokeStyle
      context.fillRect(centerX - centerSize / 2, centerY - centerSize / 2, centerSize, centerSize)
      context.restore()
    }

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
      drawCanvasResizePreviewLayers((layer) => {
        if (layer === 'checker') {
          context.save()
          context.beginPath()
          context.rect(x, y, previewWidth, previewHeight)
          context.clip()
          context.fillStyle = `rgb(${checkerboard.lightColor.r} ${checkerboard.lightColor.g} ${checkerboard.lightColor.b})`
          context.fillRect(x, y, previewWidth, previewHeight)
          const previewCheckerCell = checkerboard.size * view.zoom
          if (previewCheckerCell >= 2) {
            const firstColumn = Math.floor((Math.max(0, x) - originX) / previewCheckerCell)
            const firstRow = Math.floor((Math.max(0, y) - originY) / previewCheckerCell)
            const lastColumn = Math.ceil((Math.min(rect.width, x + previewWidth) - originX) / previewCheckerCell)
            const lastRow = Math.ceil((Math.min(rect.height, y + previewHeight) - originY) / previewCheckerCell)
            context.fillStyle = `rgb(${checkerboard.darkColor.r} ${checkerboard.darkColor.g} ${checkerboard.darkColor.b})`
            for (let row = firstRow; row < lastRow; row += 1) {
              for (let column = firstColumn; column < lastColumn; column += 1) {
                if ((column + row) % 2 === 0) continue
                context.fillRect(originX + column * previewCheckerCell, originY + row * previewCheckerCell, previewCheckerCell, previewCheckerCell)
              }
            }
          }
          context.restore()
          return
        }
        if (layer === 'content') {
          context.save()
          context.beginPath()
          context.rect(x, y, previewWidth, previewHeight)
          context.clip()
          context.imageSmoothingEnabled = smoothPixelSampling
          if (smoothPixelSampling) context.imageSmoothingQuality = 'high'
          context.drawImage(previewSurface.canvas, x, y, previewWidth, previewHeight)
          context.restore()
          return
        }
        if (layer === 'outside-mask') {
          context.save()
          context.fillStyle = activeTheme.variables['--theme-overlay']
          context.beginPath()
          context.rect(x, y, previewWidth, previewHeight)
          context.clip()
          context.beginPath()
          context.rect(0, 0, rect.width, rect.height)
          context.rect(originX, originY, canvasWidth, canvasHeight)
          context.clip('evenodd')
          context.fillRect(x, y, previewWidth, previewHeight)
          context.restore()
          return
        }
        context.save()
        context.strokeStyle = activeTheme.definition.seeds.workspace
        context.lineWidth = 1
        context.strokeRect(Math.round(originX) + 0.5, Math.round(originY) + 0.5, canvasWidth, canvasHeight)
        context.strokeStyle = activeTheme.definition.seeds.accent
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
      })
    }
    const selectionDrag = canvasGestureForPreview(inputRef.current.drag)
    if (selectionDrag?.kind === 'marquee' && selectionDrag.moved) {
      if (selectionDrag.marqueePreviewSelection) drawSelectionPathPreview(selectionPreviewPixels(selectionDrag.marqueePreviewSelection))
    }
    if ((selectionDrag?.kind === 'lasso' || selectionDrag?.kind === 'polygon-lasso') && (selectionDrag.path?.length ?? 0) > 0) {
      const previewPixels = new Set<string>()
      const addLine = (from: Point, to: Point): void => {
        for (const sourcePoint of rasterLinePoints(from, to)) for (const point of symmetryPoints(sourcePoint, document.width, document.height, session.symmetryAxes, symmetryCenter)) previewPixels.add(`${point.x}:${point.y}`)
      }
      const path = selectionDrag.path ?? []
      if (selectionDrag.kind === 'polygon-lasso') {
        for (const sourcePoint of polygonLassoPreviewPoints(path, selectionDrag.last, lassoPreviewClosed, balancedShiftLineEnabled)) for (const point of symmetryPoints(sourcePoint, document.width, document.height, session.symmetryAxes, symmetryCenter)) previewPixels.add(`${point.x}:${point.y}`)
      } else {
        for (let index = 1; index < path.length; index += 1) addLine(path[index - 1], path[index])
        if (lassoPreviewClosed && path.length > 1) addLine(path.at(-1)!, path[0])
      }
      drawSelectionPathPreview(previewPixels)
      const mode = selectionDrag.selectionMode ?? session.selectionMode
      const point = inputRef.current.pointer.point
      if (mode !== 'replace' && point.x >= 0 && point.y >= 0 && point.x < document.width && point.y < document.height) {
        const pixelRect = previewPixelRect(point.x, point.y)
        const sampled = sampleCompositeForPreview(point.x, point.y)
        const background = sampled.a > 0 ? sampled : transparencyColorAt(point.x, point.y, checkerboard)
        context.save()
        context.strokeStyle = colorLuminance(background) > 145 ? activeTheme.variables['--theme-selection-outline-dark'] : activeTheme.variables['--theme-selection-outline-light']
        context.lineWidth = 1
        context.strokeRect(pixelRect.x + 0.5, pixelRect.y + 0.5, Math.max(0, pixelRect.width - 1), Math.max(0, pixelRect.height - 1))
        context.restore()
      }
    }
    if (inputRef.current.drag?.kind === 'magic-preview' && inputRef.current.drag.previewSelection) {
      drawSelectionFillPreview(inputRef.current.drag.previewSelection)
      drawSelectionPathPreview(selectionPreviewPixels(inputRef.current.drag.previewSelection))
    }

    const activeSelectionCreation = selectionDrag?.kind === 'marquee' || selectionDrag?.kind === 'lasso' || selectionDrag?.kind === 'polygon-lasso'
    if (canRenderToolPreview && (!inputRef.current.drag || activeSelectionCreation) && (!inputRef.current.spaceHeld || selectionDrag?.kind === 'marquee') && !inputRef.current.sampling && inputRef.current.pointer.visible && session.tool === 'selection') {
      const point = inputRef.current.pointer.point
      const selectionHit = session.selection ? selectionHitAt(inputRef.current.pointer.clientX, inputRef.current.pointer.clientY) : 'outside'
      const combinationMode = session.selectionMode !== 'replace'
      const transformInteraction = selectionHit !== 'inside' && selectionHit !== 'outside'
      const addModeInteraction = !inputRef.current.shiftHeld && session.selectionMode === 'add' && selectionHit !== 'outside'
      const creatingSelection = activeSelectionCreation || inputRef.current.shiftHeld || combinationMode || (selectionHit === 'outside' && (!session.selection || !selectionContains(session.selection, point.x, point.y)))
      if (!transformInteraction && !addModeInteraction && creatingSelection) {
        const insideDocument = point.x >= 0 && point.y >= 0 && point.x < document.width && point.y < document.height
        const sampled = insideDocument ? sampleCompositeForPreview(point.x, point.y) : { r: 74, g: 74, b: 81, a: 255 }
        const background = sampled.a > 0 ? sampled : transparencyColorAt(point.x, point.y, checkerboard)
        drawSelectionCursorCorners(point.x, point.y, colorLuminance(background) > 145 ? activeTheme.variables['--theme-selection-outline-dark'] : activeTheme.variables['--theme-selection-outline-light'])
      }
    }

    if (canRenderToolPreview && !inputRef.current.spaceHeld && inputRef.current.pointer.visible && !inputRef.current.sampling && session.tool === 'fill' && fillKind === 'bucket') {
      const point = inputRef.current.pointer.point
      if (point.x >= 0 && point.y >= 0 && point.x < document.width && point.y < document.height && (!session.selection || selectionContains(session.selection, point.x, point.y))) {
        for (const target of symmetryPoints(point, document.width, document.height, session.symmetryAxes, symmetryCenter)) drawPreviewPixel(target.x, target.y, previewColorAt(target.x, target.y))
      }
    }

    if (canRenderToolPreview && !inputRef.current.spaceHeld && inputRef.current.pointer.visible && !inputRef.current.sampling && session.tool === 'shape' && drag?.kind !== 'shape') {
      const point = inputRef.current.pointer.point
      const layer = activePaintLayer(currentSession)
      if (point.x >= 0 && point.y >= 0 && point.x < document.width && point.y < document.height && !isLayerEffectivelyLocked(document, layer) && (!session.selection || selectionContains(session.selection, point.x, point.y))) {
        for (const target of symmetryPoints(point, document.width, document.height, session.symmetryAxes, symmetryCenter)) drawPreviewPixel(target.x, target.y, previewColorAt(target.x, target.y))
      }
    }

    if (brushPreviewMode !== 'none' && canRenderToolPreview && !inputRef.current.spaceHeld && inputRef.current.pointer.visible && !inputRef.current.sampling && (!drag || (drag.kind === 'draw' && drawingBrushPreviewEnabled)) && (session.tool === 'pencil' || session.tool === 'eraser')) {
      const point = inputRef.current.pointer.point
      const drawing = drag?.kind === 'draw'
      const erasing = session.tool === 'eraser'
      const previewBrushSize = brushDynamicsPreviewIsSinglePixel ? 1 : drawing ? drag.lastBrushSize ?? session.brushSize : session.brushSize
      const previewBrushImage = brushDynamicsPreviewIsSinglePixel ? null : activeBrushImage
      const { x: beforeX, y: beforeY } = brushStampAnchor(previewBrushSize, previewBrushImage)
      context.save()
      context.beginPath()
      context.rect(originX, originY, canvasWidth, canvasHeight)
      context.clip()
      const texture = brushDynamicsPreviewIsSinglePixel ? 'solid' : activeBrushTexture
      const patternOrigin = brushDynamicsPreviewIsSinglePixel ? point : brushPatternOrigin(point)
      const mask = brushMaskOffsets(previewBrushSize, session.brushShape, texture, session.brushTextureScale, point.x - beforeX, point.y - beforeY, previewBrushImage, session.brushImageSettings, brushDynamicsPreviewIsSinglePixel ? 0 : proceduralAntialiasStrength, brushDynamicsPreviewIsSinglePixel ? 'paint' : activeBrushPreviewMode, patternOrigin.x, patternOrigin.y)
      const previewPoints = new Map<string, { x: number; y: number; coverage: number; color: RgbaColor }>()
      for (const offset of mask) {
        const sourcePoint = { x: point.x - beforeX + offset.x, y: point.y - beforeY + offset.y }
      const previewTargets = hasSymmetry(session.symmetryAxes) ? [sourcePoint] : symmetryPoints(sourcePoint, document.width, document.height, session.symmetryAxes, symmetryCenter)
        for (const target of previewTargets) {
          previewPoints.set(`${target.x}:${target.y}`, { ...target, coverage: offset.coverage, color: offset.color ?? session.primaryColor })
        }
      }
      const occupied = new Set(previewPoints.keys())
      const sampled = erasing ? sampleCompositeForPreview(point.x, point.y) : drawing ? drag.color ?? session.primaryColor : session.primaryColor
      const luminance = colorLuminance(sampled)
      context.strokeStyle = luminance > 145 ? activeTheme.variables['--theme-selection-outline-dark'] : activeTheme.variables['--theme-selection-outline-light']
      context.lineWidth = Math.max(1, Math.min(2, view.zoom / 4))
      context.beginPath()
      for (const previewPoint of previewPoints.values()) {
        const documentX = previewPoint.x
        const documentY = previewPoint.y
        if (session.selection && !selectionContains(session.selection, documentX, documentY)) continue
        const pixelRect = drawing || (brushPreviewMode !== 'full' && brushPreviewMode !== 'full-edge')
          ? previewPixelRect(documentX, documentY)
          : drawPreviewPixel(documentX, documentY, previewColorAt(documentX, documentY, erasing, previewPoint.coverage, previewPoint.color))
        const drawPreviewOutline = brushPreviewMode === 'edge' || brushPreviewMode === 'full-edge' || (erasing && brushPreviewMode === 'full')
        if (!drawPreviewOutline) continue
        const left = !occupied.has(`${documentX - 1}:${documentY}`)
        const right = !occupied.has(`${documentX + 1}:${documentY}`)
        const top = !occupied.has(`${documentX}:${documentY - 1}`)
        const bottom = !occupied.has(`${documentX}:${documentY + 1}`)
        if (left) { context.moveTo(pixelRect.x, pixelRect.y); context.lineTo(pixelRect.x, pixelRect.y + pixelRect.height) }
        if (right) { context.moveTo(pixelRect.x + pixelRect.width, pixelRect.y); context.lineTo(pixelRect.x + pixelRect.width, pixelRect.y + pixelRect.height) }
        if (top) { context.moveTo(pixelRect.x, pixelRect.y); context.lineTo(pixelRect.x + pixelRect.width, pixelRect.y) }
        if (bottom) { context.moveTo(pixelRect.x, pixelRect.y + pixelRect.height); context.lineTo(pixelRect.x + pixelRect.width, pixelRect.y + pixelRect.height) }
      }
      if (brushPreviewMode === 'edge' || brushPreviewMode === 'full-edge' || (erasing && brushPreviewMode === 'full')) context.stroke()
      context.restore()
    }

    if (canRenderToolPreview && !inputRef.current.spaceHeld && inputRef.current.pointer.visible && !inputRef.current.sampling && session.tool === 'airbrush') {
      const point = inputRef.current.pointer.point
      const spraySize = session.airbrushScatterRadius * 2 + 1
      const sprayAnchor = brushStampAnchor(spraySize, null)
      const sprayMask = brushMaskOffsets(spraySize, 'round')
      const sprayPoints = new Map<string, { x: number; y: number }>()
      for (const offset of sprayMask) {
        const target = { x: point.x - sprayAnchor.x + offset.x, y: point.y - sprayAnchor.y + offset.y }
        sprayPoints.set(`${target.x}:${target.y}`, target)
      }
      const sampled = sampleCompositeForPreview(point.x, point.y)
      context.save()
      context.strokeStyle = colorLuminance(sampled) > 145 ? activeTheme.variables['--theme-selection-outline-dark'] : activeTheme.variables['--theme-selection-outline-light']
      context.lineWidth = Math.max(1, Math.min(2, view.zoom / 4))
      context.beginPath()
      for (const sprayPoint of sprayPoints.values()) {
        const pixelRect = previewPixelRect(sprayPoint.x, sprayPoint.y)
        const left = !sprayPoints.has(`${sprayPoint.x - 1}:${sprayPoint.y}`)
        const right = !sprayPoints.has(`${sprayPoint.x + 1}:${sprayPoint.y}`)
        const top = !sprayPoints.has(`${sprayPoint.x}:${sprayPoint.y - 1}`)
        const bottom = !sprayPoints.has(`${sprayPoint.x}:${sprayPoint.y + 1}`)
        if (left) { context.moveTo(pixelRect.x, pixelRect.y); context.lineTo(pixelRect.x, pixelRect.y + pixelRect.height) }
        if (right) { context.moveTo(pixelRect.x + pixelRect.width, pixelRect.y); context.lineTo(pixelRect.x + pixelRect.width, pixelRect.y + pixelRect.height) }
        if (top) { context.moveTo(pixelRect.x, pixelRect.y); context.lineTo(pixelRect.x + pixelRect.width, pixelRect.y) }
        if (bottom) { context.moveTo(pixelRect.x, pixelRect.y + pixelRect.height); context.lineTo(pixelRect.x + pixelRect.width, pixelRect.y + pixelRect.height) }
      }
      const particleSize = airbrushParticleSize(session.airbrushParticleRadius)
      const particleAnchor = brushStampAnchor(particleSize, null)
      for (const offset of brushMaskOffsets(particleSize, session.airbrushParticleShape)) {
        const x = point.x - particleAnchor.x + offset.x
        const y = point.y - particleAnchor.y + offset.y
        drawPreviewPixel(x, y, previewColorAt(x, y))
      }
      context.stroke()
      context.restore()
    }

    if (view.showGrid && toX > fromX && toY > fromY) {
      const grid = view.grid ?? DEFAULT_GRID_SETTINGS
      drawGrid(grid.x, grid.y, grid.width, grid.height, gridColors.gridColor)
    }

    const moveLayerPreview = moveLayerContentPreviewEnabled ? moveLayerContentPreviewRef.current : null
    if (moveLayerPreview) {
      const layer = document.layers.find((candidate) => candidate.id === moveLayerPreview.layerId)
      if (layer) {
        const left = originX + (moveLayerPreview.bounds.x + layer.offsetX - moveLayerPreview.layerOffsetX) * view.zoom
        const top = originY + (moveLayerPreview.bounds.y + layer.offsetY - moveLayerPreview.layerOffsetY) * view.zoom
        const right = left + moveLayerPreview.bounds.width * view.zoom
        const bottom = top + moveLayerPreview.bounds.height * view.zoom
        context.save()
        context.globalCompositeOperation = 'source-over'
        context.globalAlpha = 1
        context.strokeStyle = `rgba(${DEFAULT_GRID_COLOR.r}, ${DEFAULT_GRID_COLOR.g}, ${DEFAULT_GRID_COLOR.b}, ${DEFAULT_GRID_COLOR.a / 255})`
        context.lineWidth = 1
        context.setLineDash([])
        context.strokeRect(Math.round(left) + 0.5, Math.round(top) + 0.5, Math.max(1, Math.round(right) - Math.round(left)), Math.max(1, Math.round(bottom) - Math.round(top)))
        context.restore()
      }
    }

    // Keep the document boundary above selections, grids, and other previews.
    context.save()
    context.globalCompositeOperation = 'source-over'
    context.globalAlpha = 1
    context.strokeStyle = activeTheme.variables['--theme-selection-outline-dark']
    context.lineWidth = 1
    context.setLineDash([])
    context.strokeRect(Math.round(originX) + 0.5, Math.round(originY) + 0.5, canvasWidth, canvasHeight)
    context.restore()

    context.restore()
    if (rotated) {
      displayContext.fillStyle = activeTheme.definition.seeds.canvasSurround
      displayContext.fillRect(0, 0, rect.width, rect.height)
      displayContext.save()
      applyViewRotation(displayContext, rect.width, rect.height, view)
      displayContext.imageSmoothingEnabled = smoothPixelSampling
      if (smoothPixelSampling) displayContext.imageSmoothingQuality = 'high'
      const scene = rotationSceneRef.current!
      displayContext.drawImage(scene, 0, 0, scene.width, scene.height, sceneLeft, sceneTop, scene.width / dpr, scene.height / dpr)
      displayContext.restore()
    }
    const statusBackgroundAt = (viewportX: number, viewportY: number): RgbaColor => {
      const point = documentPointFromViewportPoint({ x: viewportX, y: viewportY }, rect.width, rect.height, document.width, document.height, view, rotationIndicatorPosition)
      if (point.x < 0 || point.y < 0 || point.x >= document.width || point.y >= document.height) return { r: 74, g: 74, b: 81, a: 255 }
      const sampled = isolatedLayerMask ? readLayerMaskDisplayColorAt(isolatedLayerMask, point.x, point.y) : compositePointSampler(point.x, point.y)
      const background = sampled.a < 255 ? blendOver(transparencyColorAt(point.x, point.y, checkerboard), sampled) : sampled
      return view.relativeLuminance ? relativeLuminanceColor(background) : background
    }
    const statusBackgrounds = [statusBackgroundAt(72, rect.height - 16)]
    if (view.mirrored || view.mirroredVertical) statusBackgrounds.push(statusBackgroundAt(92, rect.height - 34))
    displayContext.fillStyle = canvasStatusTextColor(statusBackgrounds, activeTheme.variables['--theme-selection-outline-dark'], activeTheme.variables['--theme-selection-outline-light'])
    displayContext.font = '12px ui-monospace, SFMono-Regular, Consolas, monospace'
    displayContext.fillText(`${document.width} x ${document.height}`, 12, rect.height - 12)
    if (view.mirrored || view.mirroredVertical) {
      const mirrorLabel = view.mirrored && view.mirroredVertical ? t('canvas.mirror.both') : view.mirrored ? t('canvas.mirror.horizontal') : t('canvas.mirror.vertical')
      displayContext.fillText(t('canvas.mirror.current', { label: mirrorLabel }), 12, rect.height - 30)
    }
    drawSelectionOverlay()
    performanceProbe?.recordDraw(performance.now() - drawStartedAt)
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
    const previousSize = renderDocumentSizeRef.current
    const documentSizeChanged = previousSize.width !== session.document.width || previousSize.height !== session.document.height
    if (documentSizeChanged) {
      renderDocumentSizeRef.current = { width: session.document.width, height: session.document.height }
      compositeCacheRef.current.invalidateAll()
      onionSkinCacheRef.current.invalidateAll()
      canvasResizeSurfaceRef.current = null
      canvasResizePreviewRef.current = null
      pendingCanvasResizeRef.current = null
      if (canvasResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(canvasResizeFrameRef.current)
        canvasResizeFrameRef.current = null
      }
      selectionBoundaryCacheRef.current = null
      inputRef.current.shiftLinePreview = false
      inputRef.current.sampling = false
    }
    const pointer = inputRef.current.pointer
    if (pointer.visible) {
      const point = localPointAt(pointer.clientX, pointer.clientY)
      if (point) inputRef.current.updatePointer({ point, clientX: pointer.clientX, clientY: pointer.clientY, ctrlKey: inputRef.current.ctrlHeld, altKey: inputRef.current.altHeld })
      updateCursorAt(pointer.clientX, pointer.clientY, inputRef.current.ctrlHeld, inputRef.current.altHeld, inputRef.current.shiftHeld)
    }
    scheduleDraw()
  // View rotation is rendered inside the canvas rather than by rotating the viewport element.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.document.width, session.document.height, session.view.rotation, session.view.mirrored, session.view.mirroredVertical, session.view.panX, session.view.panY, session.view.zoom])

  useEffect(() => {
    const updateShiftPreview = (active: boolean): void => {
      if (inputRef.current.shiftLinePreview === active) return
      inputRef.current.shiftLinePreview = active
      scheduleDraw()
    }
    const updateGradientEndpoint = (constrained: boolean): void => {
      const drag = inputRef.current.drag
      if (drag?.kind !== 'gradient') return
      const rawLast = drag.rawLast ?? drag.last
      drag.constrain = constrained
      drag.last = constrained ? constrainGradientEndpoint(drag.start, rawLast) : rawLast
      scheduleDraw()
    }
    const keyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Alt') inputRef.current.altHeld = true
      if (event.key === 'Control') {
        inputRef.current.ctrlHeld = true
      }
      if (event.key === 'Shift') {
        inputRef.current.shiftHeld = true
        updateGradientEndpoint(true)
      }
      const selectionNudge = event.key === 'ArrowLeft' ? { x: -1, y: 0 }
        : event.key === 'ArrowRight' ? { x: 1, y: 0 }
          : event.key === 'ArrowUp' ? { x: 0, y: -1 }
            : event.key === 'ArrowDown' ? { x: 0, y: 1 }
              : null
      const target = event.target instanceof Element ? event.target : null
      const selectionNudgeBlocked = Boolean(target?.closest('input, textarea, select, [contenteditable="true"], .modal-backdrop, .layer-list, .themed-select'))
      if (selectionNudge && session.selection && !selectionNudgeBlocked && !event.ctrlKey && !event.metaKey && !event.altKey && !inputRef.current.drag) {
        event.preventDefault()
        event.stopPropagation()
        useWorkspace.getState().moveActiveSelectionWithSelectionHistory(selectionNudge.x, selectionNudge.y)
        scheduleDraw()
        return
      }
      if (session.tool === 'rotate' && modifierActive(event, 'resetViewRotation')) {
        const drag = inputRef.current.drag
        if (drag?.kind === 'rotate-view') {
          liveViewRef.current = { ...liveViewRef.current, rotation: 0 }
          applyRotationStyle(liveViewRef.current)
          updateRotationIndicator(0, true)
          useWorkspace.getState().setView({ rotation: 0 })
          scheduleDraw()
        }
      }
      if (event.code === 'Space') {
        const target = event.target as HTMLElement | null
        if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT' || target?.isContentEditable) return
        event.preventDefault()
        if (!inputRef.current.spaceHeld) {
          inputRef.current.spaceHeld = true
          inputRef.current.sampling = false
          const drag = inputRef.current.drag
          if ((drag?.kind === 'marquee' || drag?.kind === 'shape') && inputRef.current.pointer.visible) {
            drag.transformMoveStart = {
              pointer: { ...inputRef.current.pointer.point },
              offset: { ...(drag.transformOffset ?? { x: 0, y: 0 }) }
            }
          }
          if (canvasRef.current && inputRef.current.pointer.visible) {
            canvasRef.current.style.cursor = drag?.kind === 'marquee'
              ? selectionCreationCursor(selectionCrosshair, activeLayerEditable)
              : drag?.kind === 'shape' ? canvasToolCursor(session.tool, session.primaryColor)
                : drag?.kind === 'pan' ? canvasCursors.grabbing : canvasCursors.grab
          }
          scheduleDraw()
        }
        return
      }
      if (inputRef.current.spaceHeld) return
      if (lineConnectionActive(event) && (session.tool === 'pencil' || session.tool === 'eraser') && lineAnchor && inputRef.current.pointer.visible) updateShiftPreview(true)
      const modifierSizing = modifierActive(event, 'brushSizeAdjust') && (session.tool === 'pencil' || session.tool === 'airbrush' || session.tool === 'eraser')
      if (modifierSizing) {
        inputRef.current.sampling = false
        scheduleDraw()
      } else if (event.key === 'Alt' && inputRef.current.pointer.visible) {
        event.preventDefault()
        updateCursorAt(inputRef.current.pointer.clientX, inputRef.current.pointer.clientY, inputRef.current.ctrlHeld, true, inputRef.current.shiftHeld)
        scheduleDraw()
      } else if (event.key === 'Control' && inputRef.current.pointer.visible) {
        updateCursorAt(inputRef.current.pointer.clientX, inputRef.current.pointer.clientY, true, inputRef.current.altHeld, inputRef.current.shiftHeld)
        scheduleDraw()
      } else if (event.key === 'Shift' && inputRef.current.pointer.visible) {
        updateCursorAt(inputRef.current.pointer.clientX, inputRef.current.pointer.clientY, inputRef.current.ctrlHeld, inputRef.current.altHeld, true)
        scheduleDraw()
      }
      if ((event.key === 'Alt' || event.key === 'Control' || event.key === 'Shift') && inputRef.current.pointer.visible) {
        const drag = inputRef.current.drag
        if (drag?.kind === 'marquee' && drag.moved) updateMarqueePreview(drag, inputRef.current.pointer.point, currentSelectionMarqueeModifierState())
        else if (drag?.kind === 'shape') updateShapePreview(drag, inputRef.current.pointer.point, currentSelectionMarqueeModifierState())
        else if (drag?.kind === 'transform-content') updateSelectionTransformPreview(drag, inputRef.current.pointer.point, currentSelectionTransformModifierState())
      }
    }
    const keyUp = (event: KeyboardEvent): void => {
      if (event.code === 'Space') {
        event.preventDefault()
        inputRef.current.spaceHeld = false
        const drag = inputRef.current.drag
        if (drag) drag.transformMoveStart = undefined
        if (canvasRef.current) canvasRef.current.style.cursor = drag?.kind === 'marquee'
          ? selectionCreationCursor(selectionCrosshair, activeLayerEditable)
          : canvasToolCursor(session.tool, session.primaryColor)
        scheduleDraw()
        return
      }
      if (lineConnectionConfigured && !lineConnectionActive(event)) updateShiftPreview(false)
      if (event.key === 'Alt' || event.key === 'Control' || event.key === 'Shift') {
        if (event.key === 'Alt') { event.preventDefault(); inputRef.current.altHeld = false }
        if (event.key === 'Control') inputRef.current.ctrlHeld = false
        if (event.key === 'Shift') {
          inputRef.current.shiftHeld = false
          updateGradientEndpoint(false)
        }
        inputRef.current.sampling = session.tool === 'eyedropper'
        inputRef.current.modifierBrushSize = null
        if (event.key === 'Alt' && (inputRef.current.drag?.kind === 'marquee' || inputRef.current.drag?.kind === 'shape')) {
          const drag = inputRef.current.drag
          const bounds = drag.marqueeBounds ?? drag.marqueeRotationStart?.bounds
          if (bounds) {
            const offset = drag.transformOffset ?? { x: 0, y: 0 }
            drag.marqueeResizeStart = createMarqueeResizeStart(bounds, { x: drag.last.x - offset.x, y: drag.last.y - offset.y })
            drag.marqueeRotationStart = undefined
          }
        }
        if (inputRef.current.pointer.visible) updateCursorAt(inputRef.current.pointer.clientX, inputRef.current.pointer.clientY, inputRef.current.ctrlHeld, inputRef.current.altHeld, inputRef.current.shiftHeld)
        else if (canvasRef.current) canvasRef.current.style.cursor = inputRef.current.sampling ? canvasCursors.eyedropper : canvasToolCursor(session.tool, session.primaryColor)
        const drag = inputRef.current.drag
        if (drag?.kind === 'marquee' && drag.moved && inputRef.current.pointer.visible) updateMarqueePreview(drag, inputRef.current.pointer.point, currentSelectionMarqueeModifierState())
        else if (drag?.kind === 'shape' && inputRef.current.pointer.visible) updateShapePreview(drag, inputRef.current.pointer.point, currentSelectionMarqueeModifierState())
        else if (drag?.kind === 'transform-content' && inputRef.current.pointer.visible) updateSelectionTransformPreview(drag, inputRef.current.pointer.point, currentSelectionTransformModifierState())
        scheduleDraw()
      }
    }
    const cancelSampling = (): void => {
      if (inputRef.current.drag?.kind === 'sample-color') inputRef.current.finish()
      inputRef.current.sampling = false
      eyedropperOriginalColorRef.current = null
      hideEyedropperMagnifier()
    }
    const blur = (): void => {
      updateShiftPreview(false)
      cancelActiveCanvasInteraction()
      cancelSampling()
      if (canvasRef.current) canvasRef.current.style.cursor = canvasToolCursor(session.tool, session.primaryColor)
    }
    const visibilityChange = (): void => { if (document.hidden) blur() }
    const focus = (): void => {
      cancelSampling()
      if (canvasRef.current) canvasRef.current.style.cursor = canvasToolCursor(session.tool, session.primaryColor)
    }
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('blur', blur)
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', visibilityChange)
    return () => { window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('blur', blur); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', visibilityChange) }
  }, [session.tool, lineAnchor, lineConnectionShortcut])

  useEffect(() => {
    scheduleDraw()
    const renderSelection = (): void => {
      drawSelectionOverlay()
      const currentSession = useWorkspace.getState().sessions.find((item) => item.document.id === session.document.id)
      if (currentSession?.selection) rafRef.current = window.setTimeout(renderSelection, 160)
    }
    if (session.selection) rafRef.current = window.setTimeout(renderSelection, 160)
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        stageSizeRef.current = { width: entry.contentRect.width, height: entry.contentRect.height }
        const state = useWorkspace.getState()
        state.setViewportSizeForDocument(session.document.id, stageSizeRef.current)
        const constrained = constrainCanvasView(liveViewRef.current, stageSizeRef.current)
        if (constrained.panX !== liveViewRef.current.panX || constrained.panY !== liveViewRef.current.panY) {
          liveViewRef.current = constrained
          state.setViewForDocument(session.document.id, { panX: constrained.panX, panY: constrained.panY })
        }
      }
      // ResizeObserver runs before paint. Redraw now so the browser never
      // stretches the previous canvas bitmap to the new dock layout for a frame.
      if (drawRequestRef.current !== null) window.cancelAnimationFrame(drawRequestRef.current)
      drawRequestRef.current = null
      drawRef.current()
    })
    if (stageRef.current) {
      const bounds = stageRef.current.getBoundingClientRect()
      stageSizeRef.current = { width: bounds.width, height: bounds.height }
      const state = useWorkspace.getState()
      state.setViewportSizeForDocument(session.document.id, stageSizeRef.current)
      const constrained = constrainCanvasView(liveViewRef.current, stageSizeRef.current)
      if (constrained.panX !== liveViewRef.current.panX || constrained.panY !== liveViewRef.current.panY) {
        liveViewRef.current = constrained
        state.setViewForDocument(session.document.id, { panX: constrained.panX, panY: constrained.panY })
      }
      observer.observe(stageRef.current)
    }
    return () => {
      observer.disconnect()
      stopAirbrushTimer()
      if (rafRef.current) window.clearTimeout(rafRef.current)
      if (drawRequestRef.current) window.cancelAnimationFrame(drawRequestRef.current)
      if (selectionPreviewFrameRef.current) window.cancelAnimationFrame(selectionPreviewFrameRef.current)
      drawRequestRef.current = null
      selectionPreviewFrameRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, session.revision, session.activeLayerMaskId, session.layerMaskIsolatedView, session.view.showPixelGrid, session.view.showGrid, session.view.grid?.x, session.view.grid?.y, session.view.grid?.width, session.view.grid?.height, session.view.relativeLuminance, session.view.mirrored, session.view.mirroredVertical, session.view.showSelectionOutline, session.selection, session.outlinePreview, session.brushSize, session.brushShape, session.shapeKind, session.shapeRatio, session.fillMode, fillKind, gradientDither, session.symmetryAxes.horizontal, session.symmetryAxes.vertical, session.symmetryAxes.diagonalUp, session.symmetryAxes.diagonalDown, symmetryCenter.x, symmetryCenter.y, drawingBrushPreviewEnabled, brushPreviewMode, checkerboard, gridColors, shiftLinePreviewEnabled, lassoPreviewClosed, selectionCrosshair, balancedShiftLineEnabled, lineDirectionStep, lineConnectionShortcut, rotationIndicatorPosition, onionSkin, timelineHidden, symmetryAxisPreferences])

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

  const localContinuousPointAt = (clientX: number, clientY: number): Point | null => {
    if (!canvasRef.current) return null
    const bounds = stageBounds()
    return documentPointFromViewportPointContinuous({ x: clientX - bounds.left, y: clientY - bounds.top }, bounds.width, bounds.height, session.document.width, session.document.height, liveViewRef.current, rotationIndicatorPosition)
  }

  const quickSelectCell = (event: React.MouseEvent<HTMLCanvasElement>): void => {
    if (inputRef.current.drag?.kind === 'polygon-lasso') {
      event.preventDefault()
      commitPolygonLasso()
      return
    }
    if (session.tool !== 'selection' || session.selectionKind !== 'rectangle') return
    const point = localPointAt(event.clientX, event.clientY)
    if (!point) return
    const state = useWorkspace.getState()
    state.commitFloatingPaste()
    const active = state.sessions.find((item) => item.document.id === session.document.id)
    if (!active || (!active.activeLayerMaskId && (active.selectedGroupIds.length > 0 || !active.selectedLayerIds.some((id) => active.document.layers.some((layer) => layer.id === id))))) return
    const layer = activePaintLayer(active)
    if (!isLayerEffectivelyVisible(active.document, layer) || isLayerEffectivelyLocked(active.document, layer)) return
    const grid = active.view.showGrid
      ? active.view.grid ?? DEFAULT_GRID_SETTINGS
      : { x: 0, y: 0, width: checkerboard.size, height: checkerboard.size }
    const cell = gridCellBoundsAt(point, grid, active.document.width, active.document.height)
    if (!cell) return
    const before = cloneSelection(active.selection)
    const mode: SelectionMode = event.shiftKey || modifierActive(event.nativeEvent, 'addToSelection') ? 'add' : active.selectionMode
    const after = combineSelection(before, rectSelection(cell.x, cell.y, cell.width, cell.height), mode)
    state.commitSelectionChange(before, after, t('canvas.history.createSelection'))
    event.preventDefault()
    scheduleDraw()
  }

  const hideEyedropperMagnifier = (): void => {
    if (eyedropperMagnifierRef.current) eyedropperMagnifierRef.current.hidden = true
  }

  const updateEyedropperMagnifier = (clientX: number, clientY: number, sampled: RgbaColor): void => {
    const magnifier = eyedropperMagnifierRef.current
    const magnifierCanvas = eyedropperMagnifierCanvasRef.current
    if (!eyedropperMagnifierEnabled || !magnifier || !magnifierCanvas) return
    magnifier.dataset.style = eyedropperMagnifierStyle
    const previousColor = eyedropperOriginalColorRef.current
    const colorCss = (color: RgbaColor): string => `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a / 255})`
    const sampledMask = eyedropperMagnifierSampledMaskRef.current
    const previousMask = eyedropperMagnifierPreviousMaskRef.current
    if (sampledMask) sampledMask.style.color = colorCss(sampled)
    if (previousMask && previousColor) previousMask.style.color = colorCss(previousColor)
    magnifier.style.setProperty('--eyedropper-sampled-color', colorCss(sampled))
    magnifier.style.setProperty('--eyedropper-previous-color', colorCss(previousColor ?? sampled))
    const bounds = stageBounds()
    const localX = clientX - bounds.left
    const localY = clientY - bounds.top
    if (localX < 0 || localY < 0 || localX > bounds.width || localY > bounds.height) {
      hideEyedropperMagnifier()
      return
    }
    const magnifierWidth = 256
    const magnifierHeight = 256
    const horizontalInset = Math.min(6, Math.max(0, (bounds.width - magnifierWidth) / 2))
    const verticalInset = Math.min(6, Math.max(0, (bounds.height - magnifierHeight) / 2))
    const maxLeft = Math.max(horizontalInset, bounds.width - magnifierWidth - horizontalInset)
    const maxTop = Math.max(verticalInset, bounds.height - magnifierHeight - verticalInset)
    const left = Math.min(maxLeft, Math.max(horizontalInset, localX - magnifierWidth / 2))
    const preferredTop = localY - magnifierHeight - 18
    const top = preferredTop >= verticalInset
      ? preferredTop
      : Math.min(maxTop, Math.max(verticalInset, localY + 18))
    magnifier.style.left = `${left}px`
    magnifier.style.top = `${top}px`
    const context = magnifierCanvas.getContext('2d')
    if (!context) return
    const dpr = window.devicePixelRatio || 1
    const size = 204
    const sourcePixelCount = 25
    const pixelScale = eyedropperMagnifierPixelScale(liveViewRef.current.zoom, size)
    const point = localContinuousPointAt(clientX, clientY)
    if (!point) { hideEyedropperMagnifier(); return }
    const centerX = Math.floor(point.x)
    const centerY = Math.floor(point.y)
    const startX = centerX - Math.floor(sourcePixelCount / 2)
    const startY = centerY - Math.floor(sourcePixelCount / 2)
    const mask = activeLayerMask(session)
    const pixels = mask
      ? renderLayerMaskRegion(mask, startX, startY, sourcePixelCount, sourcePixelCount)
      : compositeRegion(session.document, startX, startY, sourcePixelCount, sourcePixelCount)
    magnifierCanvas.width = size * dpr
    magnifierCanvas.height = size * dpr
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, size, size)
    context.imageSmoothingEnabled = false
    let sourceCanvas = eyedropperMagnifierSourceRef.current
    if (!sourceCanvas || sourceCanvas.width !== sourcePixelCount || sourceCanvas.height !== sourcePixelCount) {
      sourceCanvas = new OffscreenCanvas(sourcePixelCount, sourcePixelCount)
      eyedropperMagnifierSourceRef.current = sourceCanvas
    }
    const sourceContext = sourceCanvas.getContext('2d')
    if (!sourceContext) return
    const displayPixels = new Uint8ClampedArray(pixels.length)
    for (let y = 0; y < sourcePixelCount; y += 1) for (let x = 0; x < sourcePixelCount; x += 1) {
      const offset = (y * sourcePixelCount + x) * 4
      const color = { r: pixels[offset], g: pixels[offset + 1], b: pixels[offset + 2], a: pixels[offset + 3] }
      const displayColor = color.a < 255 ? blendOver(transparencyColorAt(startX + x, startY + y, checkerboard), color) : color
      displayPixels[offset] = displayColor.r
      displayPixels[offset + 1] = displayColor.g
      displayPixels[offset + 2] = displayColor.b
      displayPixels[offset + 3] = displayColor.a
    }
    sourceContext.putImageData(new ImageData(displayPixels as Uint8ClampedArray<ArrayBuffer>, sourcePixelCount, sourcePixelCount), 0, 0)
    // Keep the sampled point fixed under the center pointer while the pixel
    // field follows sub-pixel pointer movement continuously. Drawing one
    // nearest-neighbour source bitmap avoids antialiased gaps between blocks.
    const sourceLeft = size / 2 + (startX - point.x) * pixelScale
    const sourceTop = size / 2 + (startY - point.y) * pixelScale
    if (!eyedropperMagnifierDistortionEnabled) {
      context.drawImage(sourceCanvas, sourceLeft, sourceTop, sourcePixelCount * pixelScale, sourcePixelCount * pixelScale)
    } else {
      const outputWidth = magnifierCanvas.width
      const outputHeight = magnifierCanvas.height
      const distortedPixels = new Uint8ClampedArray(outputWidth * outputHeight * 4)
      const outputCenter = size / 2
      // The 64 px material is displayed at an exact 4x scale. Its inner
      // opening has a 25 px radius, so the lens edge is exactly 100 CSS px.
      const outputRadius = 100
      for (let y = 0; y < outputHeight; y += 1) for (let x = 0; x < outputWidth; x += 1) {
        const outputX = (x + 0.5) / dpr
        const outputY = (y + 0.5) / dpr
        const normalizedX = (outputX - outputCenter) / outputRadius
        const normalizedY = (outputY - outputCenter) / outputRadius
        const rawRadius = Math.hypot(normalizedX, normalizedY)
        const radius = Math.min(1, rawRadius)
        const outputOffset = (y * outputWidth + x) * 4
        if (rawRadius <= 0.82) {
          const directSourceX = Math.floor((outputX - sourceLeft) / pixelScale)
          const directSourceY = Math.floor((outputY - sourceTop) / pixelScale)
          if (directSourceX < 0 || directSourceY < 0 || directSourceX >= sourcePixelCount || directSourceY >= sourcePixelCount) continue
          const directOffset = (directSourceY * sourcePixelCount + directSourceX) * 4
          distortedPixels[outputOffset] = displayPixels[directOffset]
          distortedPixels[outputOffset + 1] = displayPixels[directOffset + 1]
          distortedPixels[outputOffset + 2] = displayPixels[directOffset + 2]
          distortedPixels[outputOffset + 3] = displayPixels[directOffset + 3]
          continue
        }
        // Preserve most of the lens as an exact hard-edge magnification. Optical
        // distortion, dispersion and diffuse light are restricted to the rim.
        const edgeProgress = Math.max(0, Math.min(1, (radius - 0.82) / 0.18))
        const edgeCurve = edgeProgress * edgeProgress * (3 - 2 * edgeProgress)
        const lensFactor = 1 + edgeCurve * 0.14
        const mappedX = outputCenter + (outputX - outputCenter) * lensFactor
        const mappedY = outputCenter + (outputY - outputCenter) * lensFactor
        const sourceX = Math.floor((mappedX - sourceLeft) / pixelScale)
        const sourceY = Math.floor((mappedY - sourceTop) / pixelScale)
        if (sourceX < 0 || sourceY < 0 || sourceX >= sourcePixelCount || sourceY >= sourcePixelCount) continue
        const sourceOffset = (sourceY * sourcePixelCount + sourceX) * 4
        let red = displayPixels[sourceOffset]
        let green = displayPixels[sourceOffset + 1]
        let blue = displayPixels[sourceOffset + 2]
        if (edgeCurve > 0 && radius > 0) {
          const radialX = normalizedX / radius
          const radialY = normalizedY / radius
          const scatterDistance = edgeCurve * 6
          const redX = Math.floor((mappedX + radialX * scatterDistance - sourceLeft) / pixelScale)
          const redY = Math.floor((mappedY + radialY * scatterDistance - sourceTop) / pixelScale)
          const blueX = Math.floor((mappedX - radialX * scatterDistance - sourceLeft) / pixelScale)
          const blueY = Math.floor((mappedY - radialY * scatterDistance - sourceTop) / pixelScale)
          if (redX >= 0 && redY >= 0 && redX < sourcePixelCount && redY < sourcePixelCount) red = displayPixels[(redY * sourcePixelCount + redX) * 4]
          if (blueX >= 0 && blueY >= 0 && blueX < sourcePixelCount && blueY < sourcePixelCount) blue = displayPixels[(blueY * sourcePixelCount + blueX) * 4 + 2]
          // Add a restrained inner-rim shadow. It starts outside the untouched
          // center and is slightly heavier toward the lower-right edge.
          const directionalShade = Math.max(0, (radialX + radialY) * Math.SQRT1_2)
          const lowerEdgeShade = Math.max(0, radialY)
          const rimShadow = edgeCurve * (0.028 + directionalShade * 0.09 + lowerEdgeShade * 0.035)
          red *= 1 - rimShadow
          green *= 1 - rimShadow
          blue *= 1 - rimShadow
        }
        distortedPixels[outputOffset] = red
        distortedPixels[outputOffset + 1] = green
        distortedPixels[outputOffset + 2] = blue
        distortedPixels[outputOffset + 3] = displayPixels[sourceOffset + 3]
      }
      context.putImageData(new ImageData(distortedPixels as Uint8ClampedArray<ArrayBuffer>, outputWidth, outputHeight), 0, 0)
      // Composite the untouched center with the same scale as the rim sampler.
      // Using a fixed 17-pixel crop here made the lens shrink once the canvas
      // itself was zoomed beyond the old baseline magnification.
      context.save()
      context.beginPath()
      context.arc(outputCenter, outputCenter, 82, 0, Math.PI * 2)
      context.clip()
      context.drawImage(sourceCanvas, sourceLeft, sourceTop, sourcePixelCount * pixelScale, sourcePixelCount * pixelScale)
      context.restore()
    }
    const pointerImage = colorLuminance(sampled) < 145 ? eyedropperPointerLightRef.current : eyedropperPointerDarkRef.current
    if (pointerImage?.complete && pointerImage.naturalWidth > 0) {
      context.globalAlpha = .5
      context.drawImage(pointerImage, Math.round(size / 2 - pointerImage.naturalWidth / 2), Math.round(size / 2 - pointerImage.naturalHeight / 2))
      context.globalAlpha = 1
    } else {
      context.fillStyle = colorLuminance(sampled) < 145 ? 'rgba(255, 255, 255, .5)' : 'rgba(0, 0, 0, .5)'
      context.fillRect(Math.floor(size / 2), Math.floor(size / 2) - 5, 1, 11)
      context.fillRect(Math.floor(size / 2) - 5, Math.floor(size / 2), 11, 1)
    }
    magnifier.hidden = false
  }

  const distanceToSegment = (point: Point, start: Point, end: Point): number => {
    const dx = end.x - start.x
    const dy = end.y - start.y
    const lengthSquared = dx * dx + dy * dy
    if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y)
    const ratio = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
    return Math.hypot(point.x - (start.x + ratio * dx), point.y - (start.y + ratio * dy))
  }

  const symmetryAxisHitAt = (clientX: number, clientY: number): SymmetryAxis | 'center' | null => {
    if (symmetryAxisPreferences.locked || !hasSymmetry(session.symmetryAxes)) return null
    const point = localContinuousPointAt(clientX, clientY)
    if (!point) return null
    const centerDistance = Math.hypot(point.x - symmetryCenter.x, point.y - symmetryCenter.y)
    const centerRadius = Math.max(0.35, 9 / liveViewRef.current.zoom)
    if (centerDistance <= centerRadius) return 'center'
    const lineRadius = Math.max(0.25, Math.max(7, symmetryAxisPreferences.thickness / 2 + 4) / liveViewRef.current.zoom)
    let best: { axis: SymmetryAxis; distance: number } | null = null
    for (const axis of (['horizontal', 'vertical', 'diagonalUp', 'diagonalDown'] as SymmetryAxis[])) {
      if (!session.symmetryAxes[axis]) continue
      const segment = symmetryAxisSegment(axis, session.document.width, session.document.height, symmetryCenter)
      if (!segment) continue
      const distance = distanceToSegment(point, segment.start, segment.end)
      if (distance <= lineRadius && (!best || distance < best.distance)) best = { axis, distance }
    }
    return best?.axis ?? null
  }

  const topEditableLayerAt = (point: Point) => {
    for (let index = session.document.layers.length - 1; index >= 0; index -= 1) {
      const layer = session.document.layers[index]
      if (!isLayerEffectivelyVisible(session.document, layer) || isLayerEffectivelyLocked(session.document, layer)) continue
      if (readLayerColorAt(session.document, layer, point.x, point.y).a > 0) return layer
    }
    return null
  }

  const hideMoveLayerContentPreview = (delayMs = 0): void => {
    if (moveLayerContentPreviewTimerRef.current !== null) window.clearTimeout(moveLayerContentPreviewTimerRef.current)
    moveLayerContentPreviewTimerRef.current = null
    if (!moveLayerContentPreviewRef.current) return
    if (delayMs > 0) {
      moveLayerContentPreviewTimerRef.current = window.setTimeout(() => {
        moveLayerContentPreviewRef.current = null
        moveLayerContentPreviewTimerRef.current = null
        scheduleDraw()
      }, delayMs)
      return
    }
    moveLayerContentPreviewRef.current = null
    scheduleDraw()
  }

  const showMoveLayerContentPreview = (layer: RasterLayer): void => {
    if (!moveLayerContentPreviewEnabled) return
    const bounds = layerContentBounds(session.document, layer)
    if (!bounds) {
      hideMoveLayerContentPreview()
      return
    }
    if (moveLayerContentPreviewTimerRef.current !== null) window.clearTimeout(moveLayerContentPreviewTimerRef.current)
    moveLayerContentPreviewTimerRef.current = null
    moveLayerContentPreviewRef.current = {
      layerId: layer.id,
      bounds,
      layerOffsetX: layer.offsetX,
      layerOffsetY: layer.offsetY
    }
    scheduleDraw()
  }

  const selectionHitAt = (clientX: number, clientY: number): SelectionHit => {
    const currentSession = useWorkspace.getState().sessions.find((item) => item.document.id === session.document.id) ?? session
    if (!currentSession.selection || !canvasRef.current) return 'outside'
    const bounds = stageBounds()
    const point = documentPointFromViewportPointContinuous({ x: clientX - bounds.left, y: clientY - bounds.top }, bounds.width, bounds.height, currentSession.document.width, currentSession.document.height, liveViewRef.current, rotationIndicatorPosition)
    const floating = currentSession.pendingPaste
    if (floating?.transformTarget) {
      return selectionTransformedInteractionHit(
        currentSession.selection,
        floating.transformTarget,
        floating.transformAngle ?? 0,
        floating.transformShear,
        point,
        liveViewRef.current.zoom
      )
    }
    return selectionInteractionHit(currentSession.selection, point, liveViewRef.current.zoom)
  }

  const selectionHit = (event: React.PointerEvent<HTMLCanvasElement>): SelectionHit => selectionHitAt(event.clientX, event.clientY)

  const displayedSelectionPoint = (point: Point): Point => {
    const bounds = stageBounds()
    const view = liveViewRef.current
    const pivot = viewRotationPivot(bounds.width, bounds.height, view.panX, view.panY, rotationIndicatorPosition)
    const untransformed = selectionScreenPoint(bounds.width, bounds.height, session.document.width, session.document.height, view, point)
    const mirrored = mirrorViewportPoint(untransformed, pivot, Boolean(view.mirrored), Boolean(view.mirroredVertical))
    return rotateViewportPoint(mirrored, pivot, view.rotation)
  }

  const rotationCursorForHit = (hit: SelectionRotationHandle): string => {
    const currentSession = useWorkspace.getState().sessions.find((item) => item.document.id === session.document.id) ?? session
    const floating = currentSession.pendingPaste
    const target = floating?.transformTarget ?? currentSession.selection
    if (!target) return rotationCursors[hit]
    const points = transformedSelectionControlPoints(target, floating?.transformAngle ?? 0, floating?.transformShear)
    const cornerIndex: Record<SelectionRotationHandle, number> = { 'rotate-nw': 0, 'rotate-ne': 2, 'rotate-sw': 5, 'rotate-se': 7 }
    const cornerPoints = [points[0], points[2], points[5], points[7]]
    const center = {
      x: cornerPoints.reduce((sum, point) => sum + point.x, 0) / cornerPoints.length,
      y: cornerPoints.reduce((sum, point) => sum + point.y, 0) / cornerPoints.length
    }
    const displayedCorner = displayedSelectionPoint(points[cornerIndex[hit]])
    const displayedCenter = displayedSelectionPoint(center)
    return rotationCursors[selectionRotationCursorForPosition(displayedCorner, displayedCenter)]
  }

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

  const updateCursorAt = (clientX: number, clientY: number, ctrlKey: boolean, altKey: boolean, shiftKey = false): void => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (inputRef.current.spaceHeld) {
      inputRef.current.sampling = false
      const drag = inputRef.current.drag
      canvas.style.cursor = drag?.kind === 'marquee'
        ? selectionCreationCursor(selectionCrosshair, activeLayerEditable)
        : drag?.kind === 'shape' ? canvasToolCursor(session.tool, session.primaryColor)
        : drag?.kind === 'pan' ? canvasCursors.grabbing : canvasCursors.grab
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
    if (!inputRef.current.drag && !session.animationPlaying && symmetryAxisHitAt(clientX, clientY)) {
      inputRef.current.sampling = false
      canvas.style.cursor = canvasCursors.move
      return
    }
    // During a pointer drag the cursor is already determined by the gesture.
    // Do this before composite sampling: sampling creates a compiled layer-tree
    // reader and was needlessly paid on every marquee/lasso pointer move.
    const drag = inputRef.current.drag
    if (drag?.kind === 'move-content' || drag?.kind === 'move-selection') {
      inputRef.current.sampling = false
      canvas.style.cursor = drag.kind === 'move-content'
        ? drag.copy ? canvasCursors.copy : canvasCursors.move
        : canvasCursors.selectionMove
      return
    }
    if (drag?.kind === 'move-layer') {
      inputRef.current.sampling = false
      canvas.style.cursor = drag.duplicateOnDrag ? canvasCursors.copy : canvasCursors.move
      return
    }
    const transformCursor = drag && selectionTransformDragCursor(drag.kind)
    if (transformCursor) {
      inputRef.current.sampling = false
      canvas.style.cursor = transformCursor
      return
    }
    if (drag?.kind === 'marquee' || drag?.kind === 'lasso' || drag?.kind === 'polygon-lasso' || drag?.kind === 'magic-preview') {
      inputRef.current.sampling = false
      canvas.style.cursor = selectionCreationCursor(selectionCrosshair, activeLayerEditable)
      return
    }
    if (drag?.kind === 'shape') {
      inputRef.current.sampling = false
      canvas.style.cursor = canvasToolCursor(session.tool, session.primaryColor)
      return
    }
    const point = localPointAt(clientX, clientY)
    const insideDocument = Boolean(point && point.x >= 0 && point.y >= 0 && point.x < session.document.width && point.y < session.document.height)
    const mask = activeLayerMask(session)
    let contrastColor = insideDocument && point
      ? mask ? readLayerMaskDisplayColorAt(mask, point.x, point.y) : sampleCompositeColor(session.document, point.x, point.y)
      : session.primaryColor
    if (insideDocument && point && activeLayerEditable && previewCursorTools.has(session.tool) && (!session.selection || selectionContains(session.selection, point.x, point.y))) {
      const layer = activePaintLayer(session)
      if (!isLayerEffectivelyLocked(session.document, layer)) {
        const index = point.y * session.document.width + point.x
        const source = session.tool === 'eraser' ? TRANSPARENT : session.primaryColor
        const replacement = source.a > 0 && source.a < 255 ? blendOver(readLayerColor(session.document, layer, index), source) : source
        contrastColor = mask ? layerMaskDisplayColor(replacement) : compositePixelWithLayerColor(session.document, index, layer.id, replacement)
      }
    }
    if (insideDocument && point && contrastColor.a < 255) contrastColor = blendOver(transparencyColorAt(point.x, point.y, checkerboard), contrastColor)
    const altActive = inputRef.current.altHeld || altKey
    const ctrlActive = inputRef.current.ctrlHeld || ctrlKey
    const modifierSizing = ctrlKey && altActive && (session.tool === 'pencil' || session.tool === 'airbrush' || session.tool === 'eraser')
    const rawSelectionHit = session.tool === 'selection' ? selectionHitAt(clientX, clientY) : 'outside'
    const selectionModifierActive = shiftKey
    const selectionHit = selectionModifierActive ? 'outside' : session.selectionMode === 'replace' || session.selectionMode === 'add' || rawSelectionHit !== 'inside' ? rawSelectionHit : 'outside'
    const centeredSelectionResize = session.tool === 'selection' && selectionHit in resizeCursors
    const moveCopyAvailable = session.tool === 'move' && insideDocument && Boolean(session.moveAutoSelect ? (point && (topEditableLayerAt(point) ?? (activeLayerEditable ? getActiveLayer(session.document) : null))) : activeLayerEditable)
    const selectionCopyAvailable = session.tool === 'selection' && !altActive && ctrlActive && selectionHit === 'inside' && activeLayerEditable && (!session.pendingPaste || shouldRestartFloatingSelectionForCopy(session.pendingPaste.copy, true))
    const copyAvailable = (altActive && moveCopyAvailable) || selectionCopyAvailable
    const sampling = session.tool === 'eyedropper' || (altActive && !centeredSelectionResize && !(session.tool === 'move' && moveCopyAvailable) && !modifierSizing)
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
        : hit in shearCursors
          ? shearCursors[hit as SelectionShearHandle]
        : hit in rotationCursors
          ? rotationCursorForHit(hit as SelectionRotationHandle)
          : hit === 'inside'
            ? canvasCursors.move
            : hit === 'edge'
              ? canvasCursors.selectionMove
            : selectionCreationCursor(selectionCrosshair, activeLayerEditable || selectionModifierActive)
    } else canvas.style.cursor = canvasToolCursor(session.tool, contrastColor, available)
  }

  const updateCursor = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const rotatableDragModifierReleaseOnly = inputRef.current.drag?.kind === 'marquee' || inputRef.current.drag?.kind === 'shape'
    inputRef.current.syncModifierKeys(event, rotatableDragModifierReleaseOnly)
    const ctrlKey = rotatableDragModifierReleaseOnly ? inputRef.current.ctrlHeld : event.ctrlKey
    const altKey = rotatableDragModifierReleaseOnly ? inputRef.current.altHeld : event.altKey
    const shiftKey = rotatableDragModifierReleaseOnly ? inputRef.current.shiftHeld : event.shiftKey
    const point = localPointAt(event.clientX, event.clientY)
    if (point) inputRef.current.updatePointer({ point, clientX: event.clientX, clientY: event.clientY, ctrlKey, altKey })
    updateCursorAt(event.clientX, event.clientY, ctrlKey, altKey, shiftKey)
  }

  useEffect(() => {
    const pointer = inputRef.current.pointer
    if (!pointer.visible) {
      if (!inputRef.current.drag && canvasRef.current) canvasRef.current.style.cursor = inputRef.current.spaceHeld ? canvasCursors.grab : canvasToolCursor(session.tool, session.primaryColor)
      return
    }
    updateCursorAt(pointer.clientX, pointer.clientY, inputRef.current.ctrlHeld, inputRef.current.altHeld, inputRef.current.shiftHeld)
    scheduleDraw()
  // Cursor assets and the preview under a stationary pointer must change with the selected tool.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.tool, session.selectionKind, session.selectionMode, session.selection, session.primaryColor.r, session.primaryColor.g, session.primaryColor.b, session.primaryColor.a, session.animationPlaying, session.symmetryAxes.horizontal, session.symmetryAxes.vertical, session.symmetryAxes.diagonalUp, session.symmetryAxes.diagonalDown, symmetryCenter.x, symmetryCenter.y, symmetryAxisPreferences.locked, symmetryAxisPreferences.thickness, activeLayerEditable])

  const activeColor = (button = 0): RgbaColor => session.tool === 'eraser'
    ? button === 2 ? session.secondaryColor : TRANSPARENT
    : button === 2 ? session.secondaryColor : session.primaryColor

  const brushDynamicsAt = (pointerType: string | undefined, pressure: number | undefined, speed = 0): { size: number; opacityScale: number; gradientAmount: number | null } => {
    const resolved = resolveBrushDynamics(session.brushDynamics, { pointerType, pressure, speed }, session.brushSize)
    return activeBrushImage?.intrinsicSize ? { ...resolved, size: session.brushSize } : resolved
  }

  const sameRgbaColor = (left: RgbaColor, right: RgbaColor): boolean => left.r === right.r && left.g === right.g && left.b === right.b && left.a === right.a

  const brushGradientAt = (buttonColor: RgbaColor, gradientAmount: number | null): BrushGradientSample | undefined => {
    if (session.tool !== 'pencil' || gradientAmount === null) return undefined
    const currentIsSecondary = sameRgbaColor(buttonColor, session.secondaryColor) && !sameRgbaColor(buttonColor, session.primaryColor)
    return {
      startColor: currentIsSecondary ? session.primaryColor : session.secondaryColor,
      endColor: buttonColor,
      gradientAmount,
      dither: session.brushDynamics.gradientDither
    }
  }

  const brushLineGradient = (from: BrushGradientSample | undefined, to: BrushGradientSample | undefined) => {
    const start = from ?? to
    const end = to ?? from
    if (!start || !end) return undefined
    return {
      startColor: start.startColor,
      endColor: start.endColor,
      fromAmount: start.gradientAmount,
      toAmount: end.gradientAmount,
      dither: end.dither
    }
  }

  const commitPolygonLasso = (): void => {
    const drag = inputRef.current.drag
    if (drag?.kind !== 'polygon-lasso') return
    inputRef.current.finish()
    const before = drag.selectionStart ?? null
    const path = polygonLassoClosedPathPoints(drag.path ?? [], balancedShiftLineEnabled)
    const incoming = symmetrySelection(lassoSelection(session.document, path), session.document.width, session.document.height, session.symmetryAxes, symmetryCenter)
    const after = combineSelection(before, incoming, drag.selectionMode ?? session.selectionMode)
    useWorkspace.getState().commitSelectionChange(before, after, t('canvas.history.polygonLasso'))
    scheduleDraw()
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    event.currentTarget.tabIndex = -1
    event.currentTarget.focus({ preventScroll: true })
    const state = useWorkspace.getState()
    if (zoomPreviewStartRef.current) finishZoomPreview()
    if (state.activeId !== session.document.id) { state.setActive(session.document.id); return }
    if (event.button === 1 || (event.button === 0 && inputRef.current.spaceHeld)) {
      const view = liveViewRef.current
      inputRef.current.drag = createCanvasPanDrag(
        { x: view.panX, y: view.panY },
        { x: event.clientX, y: event.clientY },
        inputRef.current.drag ?? undefined
      )
      beginPanPreview()
      event.currentTarget.setPointerCapture(event.pointerId)
      event.currentTarget.style.cursor = canvasCursors.grabbing
      event.preventDefault()
      return
    }
    if (session.animationPlaying) return
    const symmetryHit = event.button === 0 ? symmetryAxisHitAt(event.clientX, event.clientY) : null
    if (symmetryHit) {
      symmetryDragRef.current = { axis: symmetryHit, pointerId: event.pointerId }
      event.currentTarget.setPointerCapture(event.pointerId)
      event.currentTarget.style.cursor = canvasCursors.move
      event.preventDefault()
      return
    }
    const point = localPoint(event)
    if (!point) return
    updateCursor(event)
    event.currentTarget.setPointerCapture(event.pointerId)
    const activePolygon = inputRef.current.drag
    if (session.tool === 'selection' && activePolygon?.kind === 'polygon-lasso' && (event.button === 0 || event.button === 2)) {
      const path = activePolygon.path ?? []
      if (shouldClosePolygonLasso(path, point, event.detail)) {
        commitPolygonLasso()
        return
      }
      activePolygon.path = appendPolygonLassoVertex(path, point)
      activePolygon.last = point
      scheduleDraw()
      return
    }
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
    const eyedropperHeld = modifierActive(event.nativeEvent, 'temporaryEyedropper')
    const focusesRasterLayer = event.button === 0
      && session.tool !== 'hand'
      && session.tool !== 'zoom'
      && session.tool !== 'move'
      && session.tool !== 'eyedropper'
      && !eyedropperHeld
      && !session.activeLayerMaskId
      && (session.selectedGroupIds.length > 0 || session.selectedLayerIds.length > 1)
    if (focusesRasterLayer) state.selectLayer(session.document.activeLayerId)
    const hasRasterFocus = hasSelectedRasterLayer || focusesRasterLayer
    if (modifierActive(event.nativeEvent, 'brushSizeAdjust') && (session.tool === 'pencil' || session.tool === 'airbrush' || session.tool === 'eraser') && (session.tool === 'airbrush' || !activeBrushImage?.intrinsicSize) && event.button === 0) {
      inputRef.current.sampling = false
      inputRef.current.drag = { kind: 'brush-size', start: point, last: point, startClient: { x: event.clientX, y: event.clientY }, startBrushSize: session.tool === 'airbrush' ? session.airbrushScatterRadius : session.brushSize }
      event.currentTarget.style.cursor = canvasCursors.ewResize
      return
    }
    const sampleAtPoint = (temporarySampling = true): void => {
      if (point.x < 0 || point.y < 0 || point.x >= session.document.width || point.y >= session.document.height) return
      const secondary = event.button === 2
      const setSampledColor = secondary ? state.setSecondaryColor : state.setPrimaryColor
      const mask = activeLayerMask(session)
      const sampled = mask ? readLayerMaskDisplayColorAt(mask, point.x, point.y) : sampleCompositeColor(session.document, point.x, point.y)
      const previous = secondary ? session.secondaryColor : session.primaryColor
      setSampledColor(sampled)
      publishCanvasColorSample(sampled, secondary)
      eyedropperOriginalColorRef.current = { ...previous }
      inputRef.current.sampling = true
      inputRef.current.drag = { kind: 'sample-color', start: point, last: point, sampleSecondary: secondary, temporarySampling }
      updateEyedropperMagnifier(event.clientX, event.clientY, sampled)
      event.currentTarget.style.cursor = canvasCursors.eyedropper
      draw()
    }
    const selectionTool = session.tool === 'selection'
    const selectionMode = (): SelectionMode => event.button === 2 ? 'subtract' : (event.shiftKey || modifierActive(event.nativeEvent, 'addToSelection')) ? 'add' : session.selectionMode
    const editableLayer = activePaintLayer(session)
    const canEditLayer = hasRasterFocus && isLayerEffectivelyVisible(session.document, editableLayer) && !isLayerEffectivelyLocked(session.document, editableLayer)
    const movableActiveLayer = getActiveLayer(session.document)
    const canMoveActiveLayer = session.selectedGroupIds.length === 0
      && session.selectedLayerIds.includes(movableActiveLayer.id)
      && isLayerEffectivelyVisible(session.document, movableActiveLayer)
      && !isLayerEffectivelyLocked(session.document, movableActiveLayer)
    const copyLayerHeld = modifierActive(event.nativeEvent, 'copyLayerOnDrag')
    if (selectionTool && (event.button === 0 || event.button === 2) && !canEditLayer && !eyedropperHeld) return
    if (session.tool === 'move' && event.button === 0) {
      const additiveSelection = event.shiftKey
      const hitTarget = session.moveAutoSelect || additiveSelection ? topEditableLayerAt(point) : null
      let selectedLayerIds = session.selectedGroupIds.length > 0 ? [] : [...session.selectedLayerIds]
      if (additiveSelection && hitTarget) {
        state.selectMoveToolLayer(hitTarget.id, true)
        const selectedSession = useWorkspace.getState().sessions.find((item) => item.document.id === session.document.id)
        selectedLayerIds = selectedSession?.selectedLayerIds ?? selectedLayerIds
        revealLayerInPanel(session.document.id, hitTarget.id)
        if (selectedLayerIds.includes(hitTarget.id)) showMoveLayerContentPreview(hitTarget)
        else hideMoveLayerContentPreview()
        return
      }
      if (!additiveSelection && selectedLayerIds.length > 1 && hitTarget && !selectedLayerIds.includes(hitTarget.id)) {
        state.selectMoveToolLayer(hitTarget.id)
        selectedLayerIds = [hitTarget.id]
        revealLayerInPanel(session.document.id, hitTarget.id)
        showMoveLayerContentPreview(hitTarget)
      }
      let selectedMovableLayers = selectedLayerIds
        .map((id) => session.document.layers.find((layer) => layer.id === id))
        .filter((layer): layer is RasterLayer => Boolean(layer && isLayerEffectivelyVisible(session.document, layer) && !isLayerEffectivelyLocked(session.document, layer)))
      let moveAllSelectedLayers = selectedMovableLayers.length > 1
      const target = additiveSelection && hitTarget ? hitTarget : moveAllSelectedLayers
        ? selectedMovableLayers.find((layer) => layer.id === session.document.activeLayerId) ?? selectedMovableLayers[0]
        : session.moveAutoSelect ? (hitTarget ?? (canMoveActiveLayer ? movableActiveLayer : null)) : (canMoveActiveLayer ? movableActiveLayer : null)
      if (!target) { if (eyedropperHeld) sampleAtPoint(); return }
      if (!additiveSelection && session.moveAutoSelect && !moveAllSelectedLayers) {
        const currentFrameId = session.document.animation?.activeFrameId
        const targetKey = currentFrameId ? animationCelKey(target.id, currentFrameId) : null
        if (!targetKey || !session.selectedAnimationCellKeys.includes(targetKey)) {
          state.selectMoveToolLayer(target.id)
          selectedLayerIds = [target.id]
          selectedMovableLayers = [target]
          moveAllSelectedLayers = false
          revealLayerInPanel(session.document.id, target.id)
          showMoveLayerContentPreview(target)
        }
      }
      const activeSession = useWorkspace.getState().sessions.find((item) => item.document.id === session.document.id) ?? session
      const currentFrameId = activeSession.document.animation?.activeFrameId
      const selectedCellKeys = resolveCanvasMoveAnimationCellKeys({
        selectedAnimationCellKeys: activeSession.selectedAnimationCellKeys,
        selectedLayerIds: selectedMovableLayers.map((layer) => layer.id),
        currentFrameId,
        targetLayerId: target.id,
        moveAllSelectedLayers
      })
      const movableCellKeys = selectedCellKeys.filter((key) => {
        const parsed = parseAnimationCelKey(key)
        const layer = parsed ? activeSession.document.layers.find((candidate) => candidate.id === parsed.layerId) : null
        return Boolean(layer && isLayerEffectivelyVisible(activeSession.document, layer) && !isLayerEffectivelyLocked(activeSession.document, layer))
      })
      const animationCellOffsets = animationCelOffsetsForKeys(activeSession.document, movableCellKeys)
      const animationCellKeys = movableCellKeys.filter((key) => animationCellOffsets[key])
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
        layerOffset: { x: target.offsetX, y: target.offsetY }, layerIds, layerOffsets, layerFrameId: currentFrameId,
        animationCellKeys, animationCellOffsets, duplicateOnDrag: copyLayerHeld && layerIds.length === 1 && animationCellKeys.length <= 1,
        originalSelectedLayerIds: [...selectedLayerIds], selectionStart: cloneSelection(session.selection),
        clickLayerId: hitTarget?.id ?? session.document.activeLayerId,
        collapseLayerSelectionOnClick: !additiveSelection && (selectedLayerIds.length > 1 || activeSession.selectedAnimationCellKeys.length > 1)
      }
      event.currentTarget.style.cursor = copyLayerHeld ? canvasCursors.copy : canvasCursors.move
      return
    }
    if (session.tool === 'rotate' && eyedropperHeld && (event.button === 0 || event.button === 2)) {
      sampleAtPoint()
      return
    }
    if (session.tool === 'rotate' && event.button === 0) {
      const bounds = stageBounds()
      const pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
      const pivot = rotationIndicatorPosition === 'view'
        ? rotationIndicatorPointBesidePointer(bounds.width, bounds.height, pointer)
        : viewRotationPivot(bounds.width, bounds.height, liveViewRef.current.panX, liveViewRef.current.panY, rotationIndicatorPosition)
      rotationIndicatorAnchorRef.current = rotationIndicatorPosition === 'view' ? pivot : null
      const angle = Math.atan2(event.clientY - bounds.top - pivot.y, event.clientX - bounds.left - pivot.x) * 180 / Math.PI
      inputRef.current.drag = { kind: 'rotate-view', start: point, last: point, startAngle: angle, startRotation: liveViewRef.current.rotation, startPan: { x: liveViewRef.current.panX, y: liveViewRef.current.panY }, rotationPivot: pivot }
      updateRotationIndicator(liveViewRef.current.rotation, true)
      return
    }
    if (lineConnectionActive(event.nativeEvent) && hasRasterFocus && (session.tool === 'pencil' || session.tool === 'eraser') && lineAnchor && event.button === 0) {
      if (canEditLayer) {
        const target = constrainedLineTarget(point, event.nativeEvent)
        const edit = beginPixelEdit(editableLayer.id)
        const dynamics = brushDynamicsAt(event.pointerType, event.pressure, 0)
        const lineColor = activeColor()
        const gradient = brushGradientAt(lineColor, dynamics.gradientAmount)
        paintLine(session.document, editableLayer, edit, lineAnchor.x, lineAnchor.y, target.x, target.y, session.brushSize, lineColor, session.selection, session.brushShape, session.tool === 'pencil' || session.tool === 'eraser' ? activeBrushTexture : 'solid', session.brushTextureScale, session.tool === 'pencil' || session.tool === 'eraser' ? activeBrushImage : null, session.brushImageSettings, proceduralAntialiasStrength, activeBrushPaintMode, brushPatternOrigin(lineAnchor), balancedShiftLineEnabled ? 'balanced' : 'raster', session.symmetryAxes, symmetryCenter, undefined, {
          fromSize: dynamics.size,
          toSize: dynamics.size,
          fromOpacityScale: dynamics.opacityScale,
          toOpacityScale: dynamics.opacityScale,
          gradient: brushLineGradient(gradient, gradient)
        })
        state.commitPixelEdit(edit, session.tool === 'eraser' ? t('canvas.history.eraserLine') : t('canvas.history.pencilLine'), { stroke: true, durationMs: 1 })
        if (session.tool === 'eraser') state.setLastEraserPoint(target)
        else state.setLastPencilPoint(target)
      }
      return
    }
    if (selectionTool && (event.button === 0 || event.button === 2)) {
      const mode = selectionMode()
      const rawHit = selectionHit(event)
      const transformInteraction = event.button === 0 && !event.shiftKey
      const hit = transformInteraction && (mode === 'replace' || mode === 'add' || rawHit !== 'inside') ? rawHit : 'outside'
      if (eyedropperHeld && !(hit in resizeCursors)) { sampleAtPoint(); return }
      if (hit === 'inside' && session.selection) {
        beginSelectionAdjustmentEdit()
        let floating = session.pendingPaste
        const copyRequested = modifierActive(event.nativeEvent, 'copySelectionContent')
        if (floating && shouldRestartFloatingSelectionForCopy(floating.copy, copyRequested)) {
          state.commitFloatingPaste()
          floating = null
        }
        const copy = floatingSelectionCopyMode(floating?.copy ?? null, copyRequested)
        const source = floating?.source ?? captureSelectionTransform(session.document, session.selection, editableLayer)
        if (source) {
          const selectionStart = cloneSelection(session.selection)!
          const transformTarget = floating?.transformTarget ?? { x: selectionStart.x, y: selectionStart.y, width: selectionStart.width, height: selectionStart.height }
          const transformAngle = floating?.transformAngle ?? 0
          const transformShear = floating?.transformShear
          inputRef.current.drag = { kind: 'move-content', start: point, last: point, selectionStart, selectionSource: source, previewEdit: floating?.previewEdit, translationPreview: floating?.translationPreview, copy, floatingPaste: Boolean(floating), previewSelection: selectionStart, appliedSelection: selectionStart, transformStartTarget: { ...transformTarget }, startAngle: transformAngle, transformStartShear: transformShear ? { ...transformShear } : undefined, previewTarget: { ...transformTarget }, previewAngle: transformAngle, previewShear: transformShear ? { ...transformShear } : undefined }
          renderAdjustmentPreviewEdit(session.document.id, selectionStart)
          event.currentTarget.style.cursor = !floating && copy ? canvasCursors.copy : canvasCursors.move
          return
        }
        endSelectionAdjustmentEdit()
        return
      }
      if (hit === 'edge' && session.selection) {
        if (session.pendingPaste) {
          beginSelectionAdjustmentEdit()
          const selectionStart = cloneSelection(session.selection)
          const transformTarget = session.pendingPaste.transformTarget ?? { x: selectionStart!.x, y: selectionStart!.y, width: selectionStart!.width, height: selectionStart!.height }
          const transformAngle = session.pendingPaste.transformAngle ?? 0
          const transformShear = session.pendingPaste.transformShear
          inputRef.current.drag = { kind: 'move-content', start: point, last: point, selectionStart, selectionSource: session.pendingPaste.source, previewEdit: session.pendingPaste.previewEdit, translationPreview: session.pendingPaste.translationPreview, copy: session.pendingPaste.copy, floatingPaste: true, previewSelection: selectionStart, appliedSelection: selectionStart, transformStartTarget: { ...transformTarget }, startAngle: transformAngle, transformStartShear: transformShear ? { ...transformShear } : undefined, previewTarget: { ...transformTarget }, previewAngle: transformAngle, previewShear: transformShear ? { ...transformShear } : undefined }
          renderAdjustmentPreviewEdit(session.document.id, selectionStart)
          event.currentTarget.style.cursor = canvasCursors.selectionMove
          return
        }
        const selectionStart = cloneSelection(session.selection)
        inputRef.current.drag = { kind: 'move-selection', start: point, last: point, selectionStart, previewSelection: selectionStart }
        event.currentTarget.style.cursor = canvasCursors.selectionMove
        return
      }
      if (hit in shearCursors && session.selection) {
        beginSelectionAdjustmentEdit()
        const floating = session.pendingPaste
        const source = floating?.source ?? captureSelectionTransform(session.document, session.selection, editableLayer)
        if (source) {
          const selectionStart = cloneSelection(session.selection)
          const transformTarget = floating?.transformTarget ?? { x: selectionStart!.x, y: selectionStart!.y, width: selectionStart!.width, height: selectionStart!.height }
          const transformAngle = floating?.transformAngle ?? 0
          const transformShear = floating?.transformShear
          inputRef.current.drag = { kind: 'shear-content', start: point, last: point, selectionStart, selectionSource: source, previewEdit: floating?.previewEdit, translationPreview: floating?.translationPreview, shearHandle: hit as SelectionShearHandle, copy: floatingSelectionCopyMode(floating?.copy ?? null, modifierActive(event.nativeEvent, 'copySelectionContent')), floatingPaste: Boolean(floating), previewSelection: selectionStart, appliedSelection: selectionStart, transformStartTarget: { ...transformTarget }, startAngle: transformAngle, transformStartShear: transformShear ? { ...transformShear } : undefined, previewTarget: { ...transformTarget }, previewAngle: transformAngle, previewShear: transformShear ? { ...transformShear } : undefined }
          renderAdjustmentPreviewEdit(session.document.id, selectionStart)
        }
        if (!inputRef.current.drag) endSelectionAdjustmentEdit()
        event.currentTarget.style.cursor = canvasCursors.move
        return
      }
      if (hit in rotationCursors && session.selection) {
        beginSelectionAdjustmentEdit()
        const floating = session.pendingPaste
        const source = floating?.source ?? captureSelectionTransform(session.document, session.selection, editableLayer)
        if (source) {
          const selectionStart = cloneSelection(session.selection)!
          const transformTarget = floating?.transformTarget ?? { x: selectionStart.x, y: selectionStart.y, width: selectionStart.width, height: selectionStart.height }
          const transformAngle = floating?.transformAngle ?? 0
          const transformShear = floating?.transformShear
          inputRef.current.drag = { kind: 'rotate-content', start: point, last: point, selectionStart, selectionSource: source, previewEdit: floating?.previewEdit, translationPreview: floating?.translationPreview, angle: transformAngle, startAngle: transformAngle, copy: floatingSelectionCopyMode(floating?.copy ?? null, modifierActive(event.nativeEvent, 'copySelectionContent')), floatingPaste: Boolean(floating), previewSelection: selectionStart, appliedSelection: selectionStart, transformStartTarget: { ...transformTarget }, transformStartShear: transformShear ? { ...transformShear } : undefined, previewTarget: { ...transformTarget }, previewAngle: transformAngle, previewShear: transformShear ? { ...transformShear } : undefined }
          renderAdjustmentPreviewEdit(session.document.id, selectionStart)
        }
        if (!inputRef.current.drag) endSelectionAdjustmentEdit()
        event.currentTarget.style.cursor = canvasCursors.move
        return
      }
      if (hit in resizeCursors && session.selection) {
        beginSelectionAdjustmentEdit()
        const floating = session.pendingPaste
        const source = floating?.source ?? captureSelectionTransform(session.document, session.selection, editableLayer)
        if (source) {
          const selectionStart = cloneSelection(session.selection)
          const modifiers = selectionTransformModifierState(event.nativeEvent)
          const transformTarget = floating?.transformTarget ?? { x: selectionStart!.x, y: selectionStart!.y, width: selectionStart!.width, height: selectionStart!.height }
          const transformAngle = floating?.transformAngle ?? 0
          const transformShear = floating?.transformShear
          inputRef.current.drag = { kind: 'transform-content', start: point, last: point, selectionStart, selectionSource: source, previewEdit: floating?.previewEdit, translationPreview: floating?.translationPreview, handle: hit as SelectionHandle, copy: floatingSelectionCopyMode(floating?.copy ?? null, modifiers.copy), floatingPaste: Boolean(floating), previewSelection: selectionStart, appliedSelection: selectionStart, transformStartTarget: { ...transformTarget }, startAngle: transformAngle, transformStartShear: transformShear ? { ...transformShear } : undefined, previewTarget: { ...transformTarget }, previewAngle: transformAngle, previewShear: transformShear ? { ...transformShear } : undefined }
          renderAdjustmentPreviewEdit(session.document.id, selectionStart)
          event.currentTarget.style.cursor = canvasCursors.move
        }
        if (!inputRef.current.drag) endSelectionAdjustmentEdit()
        return
      }
      if (session.pendingPaste) state.commitFloatingPaste()
      if (session.selectionKind === 'magic') {
        const before = cloneSelection(session.selection)
        const incoming = symmetrySelection(magicWandSelection(session.document, editableLayer, point.x, point.y, session.wandTolerance, session.wandContiguous), session.document.width, session.document.height, session.symmetryAxes, symmetryCenter)
        const next = combineSelection(before, incoming, mode)
        inputRef.current.drag = { kind: 'magic-preview', start: point, last: point, selectionStart: before, selectionMode: mode, previewSelection: next }
        draw()
        return
      }
      if (session.selectionKind === 'lasso') { inputRef.current.drag = { kind: 'lasso', start: point, last: point, selectionStart: cloneSelection(session.selection), selectionMode: mode, previewSelection: cloneSelection(session.selection), path: [point] }; return }
      if (session.selectionKind === 'polygon-lasso') { inputRef.current.drag = { kind: 'polygon-lasso', start: point, last: point, selectionStart: cloneSelection(session.selection), selectionMode: mode, previewSelection: cloneSelection(session.selection), path: [point] }; return }
    }
    if (eyedropperHeld && (event.button === 0 || event.button === 2)) { sampleAtPoint(); return }
    if (shouldStartCanvasPan(session.tool, event.shiftKey, selectionTool)) {
      const view = liveViewRef.current
      inputRef.current.drag = createCanvasPanDrag(
        { x: view.panX, y: view.panY },
        { x: event.clientX, y: event.clientY }
      )
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
    if (session.tool === 'fill') {
      if (!canEditLayer) return
      if (fillKind === 'gradient' && (event.button === 0 || event.button === 2)) {
        if (session.selection && !selectionContains(session.selection, point.x, point.y)) return
        const gradientPaintRegion = gradientRegionSelection(session.document, editableLayer, point, session.gradientTolerance, session.gradientContiguous)
        if (!gradientPaintRegion) return
        gradientPreviewCoverageCacheRef.current = null
        inputRef.current.drag = {
          kind: 'gradient',
          start: point,
          last: point,
          rawLast: point,
          constrain: event.shiftKey,
          color: activeColor(event.button),
          gradientEndColor: event.button === 2 ? session.primaryColor : session.secondaryColor,
          gradientPaintRegion
        }
        draw()
        return
      }
      const edit = floodFillSymmetric(session.document, editableLayer, point.x, point.y, activeColor(event.button), session.selection, session.fillMode === 'contiguous', activeBrushImage, session.brushSize, session.brushImageSettings, activeBrushTexture, Math.max(1, Math.round(session.brushSize / 8)), proceduralAntialiasStrength, activeBrushPaintMode, session.symmetryAxes, symmetryCenter, session.fillTolerance)
      if (edit) state.commitPixelEdit(edit, activeBrushImage || activeBrushTexture !== 'solid' ? t('canvas.history.brushFill') : session.fillMode === 'contiguous' ? t('canvas.history.contiguousFill') : t('canvas.history.nonContiguousFill'))
      return
    }
    if (session.tool === 'eyedropper') { sampleAtPoint(false); return }
    if (session.tool === 'selection' && (session.selectionKind === 'rectangle' || session.selectionKind === 'ellipse') && (event.button === 0 || event.button === 2)) {
      const mode = selectionMode()
      inputRef.current.drag = { kind: 'marquee', start: point, last: point, startClient: { x: event.clientX, y: event.clientY }, selectionStart: cloneSelection(session.selection), selectionMode: mode, constrain: false }
      return
    }
    if (session.tool === 'shape') { if (!canEditLayer) return; inputRef.current.drag = { kind: 'shape', start: point, last: point, startClient: { x: event.clientX, y: event.clientY }, constrain: inputRef.current.shiftHeld }; draw(); return }
    if (session.tool === 'airbrush') {
      if (!hasRasterFocus || !canEditLayer || (event.button !== 0 && event.button !== 2)) return
      const drag: DragState = {
        kind: 'airbrush', start: point, last: point, edit: beginPixelEdit(editableLayer.id),
        color: activeColor(event.button), startedAt: Date.now(), nextAirbrushAt: performance.now() + session.airbrushIntervalMs
      }
      inputRef.current.drag = drag
      sprayAirbrushRef.current(drag)
      scheduleAirbrushTimer()
      return
    }
    if (session.tool !== 'pencil' && session.tool !== 'eraser') return
    if (!hasRasterFocus) return
    if (!canEditLayer) return
    const edit = beginPixelEdit(editableLayer.id)
    const patternOrigin = brushPatternOrigin(point)
    const colorReplacement = session.tool === 'eraser' && event.button === 2
      ? { source: { ...session.primaryColor }, target: { ...session.secondaryColor } }
      : undefined
    const dynamics = brushDynamicsAt(event.pointerType, event.pressure, 0)
    const strokeColor = activeColor(event.button)
    const gradient = colorReplacement ? undefined : brushGradientAt(strokeColor, dynamics.gradientAmount)
    paintBrush(session.document, editableLayer, edit, point.x, point.y, dynamics.size, strokeColor, session.brushShape, session.selection, session.tool === 'pencil' || session.tool === 'eraser' ? activeBrushTexture : 'solid', session.brushTextureScale, session.tool === 'pencil' || session.tool === 'eraser' ? activeBrushImage : null, session.brushImageSettings, proceduralAntialiasStrength, activeBrushPaintMode, patternOrigin, session.symmetryAxes, symmetryCenter, colorReplacement, dynamics.opacityScale, undefined, false, gradient)
    invalidateStrokeSegment(point, point)
    inputRef.current.drag = {
      kind: 'draw',
      start: point,
      last: point,
      edit,
      path: [{ ...point, size: dynamics.size, opacityScale: dynamics.opacityScale, color: strokeColor, gradient }],
      patternOrigin,
      color: activeColor(event.button),
      colorReplacement,
      lastBrushSize: dynamics.size,
      lastOpacityScale: dynamics.opacityScale,
      lastBrushColor: strokeColor,
      lastBrushGradientActive: Boolean(gradient),
      brushSpeed: beginBrushSpeedTracking({ clientX: event.clientX, clientY: event.clientY, timeStamp: event.timeStamp }),
      startedAt: Date.now()
    }
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const pointerSamples = coalescedPointerClientPoints(event.nativeEvent).map((sample) => ({
      ...sample,
      pointerType: sample.pointerType ?? event.pointerType
    }))
    const activeDrag = inputRef.current.drag
    if (activeDrag?.kind === 'pan' && activeDrag.startPan && activeDrag.startClient) {
      const delta = viewPanDeltaFromScreen(event.clientX - activeDrag.startClient.x, event.clientY - activeDrag.startClient.y, liveViewRef.current.rotation, rotationIndicatorPosition, liveViewRef.current.mirrored, liveViewRef.current.mirroredVertical)
      const constrained = constrainCanvasView({ ...liveViewRef.current, panX: activeDrag.startPan.x + delta.x, panY: activeDrag.startPan.y + delta.y })
      schedulePanPreview(
        constrained.panX,
        constrained.panY,
        activeDrag.startPan
      )
      event.currentTarget.style.cursor = canvasCursors.grabbing
      return
    }
    const symmetryDrag = symmetryDragRef.current
    if (symmetryDrag) {
      if (symmetryAxisPreferences.locked) {
        symmetryDragRef.current = null
        updateCursor(event)
        return
      }
      const point = localContinuousPointAt(event.clientX, event.clientY)
      if (point) useWorkspace.getState().setSymmetryCenter(moveSymmetryCenter(symmetryCenter, symmetryDrag.axis, point, session.document.width, session.document.height))
      event.currentTarget.style.cursor = canvasCursors.move
      scheduleDraw()
      return
    }
    const autoPanDrag = inputRef.current.drag
    if (autoPanDrag && ['marquee', 'lasso', 'polygon-lasso', 'move-selection', 'move-content', 'transform-content', 'rotate-content', 'shear-content'].includes(autoPanDrag.kind)) {
      const bounds = stageBounds()
      const edge = 28
      const edgeSpeed = (position: number, start: number, end: number): number => position < start + edge
        ? -Math.min(16, Math.max(2, (start + edge - position) * 0.4))
        : position > end - edge ? Math.min(16, Math.max(2, (position - (end - edge)) * 0.4)) : 0
      const screenX = edgeSpeed(event.clientX, bounds.left, bounds.right)
      const screenY = edgeSpeed(event.clientY, bounds.top, bounds.bottom)
      if (screenX !== 0 || screenY !== 0) {
        const view = liveViewRef.current
        const delta = viewPanDeltaFromScreen(-screenX, -screenY, view.rotation, rotationIndicatorPosition, view.mirrored, view.mirroredVertical)
        liveViewRef.current = constrainCanvasView({ ...view, panX: view.panX + delta.x, panY: view.panY + delta.y })
        useWorkspace.getState().setView({ panX: liveViewRef.current.panX, panY: liveViewRef.current.panY })
        applyRotationStyle(liveViewRef.current)
      }
    }
    updateCursor(event)
    inputRef.current.shiftLinePreview = Boolean(lineConnectionActive(event.nativeEvent) && !canvasResizePreviewRef.current && !inputRef.current.spaceHeld && (session.tool === 'pencil' || session.tool === 'eraser') && lineAnchor)
    const point = localPoint(event)
    if (point) inputRef.current.updatePointer({ point, clientX: event.clientX, clientY: event.clientY, ctrlKey: event.ctrlKey, altKey: event.altKey })
    const modifierSizing = modifierActive(event.nativeEvent, 'brushSizeAdjust') && (session.tool === 'pencil' || session.tool === 'airbrush' || session.tool === 'eraser')
    if (modifierSizing && !inputRef.current.drag) {
      if (!inputRef.current.modifierBrushSize) inputRef.current.modifierBrushSize = { x: event.clientX, y: event.clientY, size: session.tool === 'airbrush' ? session.airbrushScatterRadius : session.brushSize }
      else {
        const delta = event.clientX - inputRef.current.modifierBrushSize.x
        const nextSize = inputRef.current.modifierBrushSize.size + Math.round(delta / 4)
        if (session.tool === 'airbrush') useWorkspace.getState().setAirbrushScatterRadius(nextSize)
        else useWorkspace.getState().setBrushSize(nextSize)
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
    if (drag.kind === 'brush-size' && drag.startClient) {
      drag.last = point
      const delta = event.clientX - drag.startClient.x
      const nextSize = (drag.startBrushSize ?? (session.tool === 'airbrush' ? session.airbrushScatterRadius : session.brushSize)) + Math.round(delta / 4)
      if (session.tool === 'airbrush') state.setAirbrushScatterRadius(nextSize)
      else state.setBrushSize(nextSize)
      event.currentTarget.style.cursor = canvasCursors.ewResize
      return
    }
    if (drag.kind === 'gradient') {
      drag.rawLast = point
      drag.constrain = event.shiftKey
      drag.last = event.shiftKey ? constrainGradientEndpoint(drag.start, point) : point
      scheduleDraw()
      return
    }
    drag.last = point
    if (drag.kind === 'sample-color') {
      if (point.x >= 0 && point.y >= 0 && point.x < session.document.width && point.y < session.document.height) {
        const mask = activeLayerMask(session)
        const sampled = mask ? readLayerMaskDisplayColorAt(mask, point.x, point.y) : sampleCompositeColor(session.document, point.x, point.y)
        if (drag.sampleSecondary) state.setSecondaryColor(sampled)
        else state.setPrimaryColor(sampled)
        publishCanvasColorSample(sampled, Boolean(drag.sampleSecondary))
        inputRef.current.sampling = true
        updateEyedropperMagnifier(event.clientX, event.clientY, sampled)
      } else {
        hideEyedropperMagnifier()
      }
      event.currentTarget.style.cursor = canvasCursors.eyedropper
      scheduleDraw()
      return
    }
    if (drag.kind === 'zoom-drag' && drag.startClient) {
      const zoom = zoomDragTarget(drag.startZoom ?? session.view.zoom, event.clientX - drag.startClient.x, zoomDragModeForModifiers(zoomToolDragMode, event.shiftKey))
      const rect = stageBounds()
      scheduleZoomPreview(constrainCanvasView({ ...liveViewRef.current, ...zoomViewAroundViewportPoint(
        liveViewRef.current,
        zoom,
        { x: drag.startClient.x - rect.left, y: drag.startClient.y - rect.top },
        rect.width,
        rect.height,
        session.document.width,
        session.document.height,
        rotationIndicatorPosition
      ) }))
      return
    }
    if (drag.kind === 'rotate-view' && drag.startAngle !== undefined && drag.startRotation !== undefined) {
      const bounds = stageBounds()
      const resetRotation = modifierActive(event.nativeEvent, 'resetViewRotation')
      const startPan = drag.startPan ?? { x: liveViewRef.current.panX, y: liveViewRef.current.panY }
      const pivot = drag.rotationPivot ?? viewRotationPivot(bounds.width, bounds.height, startPan.x, startPan.y, rotationIndicatorPosition)
      const angle = Math.atan2(event.clientY - bounds.top - pivot.y, event.clientX - bounds.left - pivot.x) * 180 / Math.PI
      let rotation = drag.startRotation + angle - drag.startAngle
      if (modifierActive(event.nativeEvent, 'snapViewRotation')) rotation = Math.round(rotation / 45) * 45
      const normalizedRotation = resetRotation ? 0 : ((rotation % 360) + 360) % 360
      const rotatedView = rotateViewAroundViewportPoint(
        { ...liveViewRef.current, panX: startPan.x, panY: startPan.y, rotation: drag.startRotation },
        normalizedRotation,
        pivot,
        bounds.width,
        bounds.height,
        rotationIndicatorPosition
      )
      liveViewRef.current = constrainCanvasView({ ...liveViewRef.current, panX: rotatedView.panX, panY: rotatedView.panY, rotation: normalizedRotation })
      applyRotationStyle(liveViewRef.current)
      updateRotationIndicator(normalizedRotation, true)
      scheduleDraw()
      state.setView({ panX: liveViewRef.current.panX, panY: liveViewRef.current.panY, rotation: normalizedRotation })
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
      const distance = constrainedTranslation(drag, point.x - drag.start.x, point.y - drag.start.y, modifierActive(event.nativeEvent, 'constrainAxis'))
      scheduleCanvasResizePreview({
        ...drag.canvasPreview,
        offsetX: drag.canvasPreview.offsetX - distance.x,
        offsetY: drag.canvasPreview.offsetY - distance.y
      })
      event.currentTarget.style.cursor = canvasCursors.move
      return
    }
    if (drag.kind === 'move-layer' && drag.layerId && drag.layerOffset) {
      const distance = constrainedTranslation(drag, point.x - drag.start.x, point.y - drag.start.y, modifierActive(event.nativeEvent, 'constrainAxis'))
      const distanceX = distance.x
      const distanceY = distance.y
      drag.moved = drag.moved || distanceX !== 0 || distanceY !== 0
      if (drag.duplicateOnDrag && !drag.duplicatedLayerId && (distanceX !== 0 || distanceY !== 0)) {
        state.mutateActive((active) => {
          const source = active.document.layers.find((candidate) => candidate.id === drag.layerId)
          if (!source) return
          const copy = source.format === 'rgba'
            ? { ...source, id: `${source.id}-copy-${Date.now()}`, name: `${source.name} ${t('canvas.history.copySuffix')}`, pixels: new Uint8ClampedArray(source.pixels) } as RasterLayer
            : { ...source, id: `${source.id}-copy-${Date.now()}`, name: `${source.name} ${t('canvas.history.copySuffix')}`, pixels: new Uint32Array(source.pixels) } as RasterLayer
          const insertionIndex = active.document.layers.indexOf(source) + 1
          active.document.layers.splice(insertionIndex, 0, copy)
          active.document.activeLayerId = copy.id
          active.selectedLayerIds = [copy.id]
          active.selectedGroupId = null
          active.selectedGroupIds = []
          drag.duplicatedLayerId = copy.id
          drag.duplicatedLayer = copy
          drag.duplicatedLayerIndex = insertionIndex
        }, false)
      }
      const activeIds = drag.duplicatedLayerId ? [drag.duplicatedLayerId] : drag.layerIds ?? [drag.layerId]
      state.mutateActive((active) => {
        if (!drag.duplicatedLayerId && drag.animationCellOffsets && drag.animationCellKeys?.length) {
          const nextOffsets = Object.fromEntries(drag.animationCellKeys.map((key) => {
            const offset = drag.animationCellOffsets![key]
            return [key, { x: offset.x + distanceX, y: offset.y + distanceY }]
          }))
          setAnimationCelOffsetsForKeys(active.document, nextOffsets)
        } else {
          for (const layerId of activeIds) {
            const layer = active.document.layers.find((candidate) => candidate.id === layerId)
            const offset = drag.duplicatedLayerId ? drag.layerOffset : drag.layerOffsets?.[layerId]
            if (!layer || !offset) continue
            layer.offsetX = offset.x + distanceX
            layer.offsetY = offset.y + distanceY
          }
        }
        if (drag.selectionStart) active.selection = shiftSelection(drag.selectionStart, distanceX, distanceY, active.document.width, active.document.height)
      }, false)
      compositeCacheRef.current.invalidateAll()
      scheduleDraw()
      return
    }
    if (drag.kind === 'draw' && drag.edit) {
      let segmentStart = previousPoint
      let segmentStartSize = drag.lastBrushSize ?? session.brushSize
      let segmentStartOpacityScale = drag.lastOpacityScale ?? 1
      let segmentStartColor = drag.lastBrushColor ?? drag.color ?? activeColor()
      let segmentStartGradient = drag.path?.at(-1)?.gradient
      let rebuiltStroke = false
      for (const sample of pointerSamples) {
        const point = localPointAt(sample.clientX, sample.clientY)
        if (!point) continue
        const speedSample = updateBrushSpeedTracking(drag.brushSpeed, sample)
        drag.brushSpeed = speedSample.state
        const dynamics = brushDynamicsAt(sample.pointerType ?? event.pointerType, sample.pressure, speedSample.speed)
        const rasterDistance = Math.max(Math.abs(point.x - segmentStart.x), Math.abs(point.y - segmentStart.y))
        const acceptedSize = activeBrushImage?.intrinsicSize
          ? dynamics.size
          : smoothBrushSizeEnvelope(segmentStartSize, dynamics.size, session.brushSize, rasterDistance)
        const sampleColor = drag.color ?? activeColor()
        const sampleGradient = drag.colorReplacement ? undefined : brushGradientAt(sampleColor, dynamics.gradientAmount)
        const samePoint = point.x === segmentStart.x && point.y === segmentStart.y
        const sameColor = sampleColor.r === segmentStartColor.r && sampleColor.g === segmentStartColor.g && sampleColor.b === segmentStartColor.b && sampleColor.a === segmentStartColor.a
        const sameGradient = (!segmentStartGradient && !sampleGradient) || Boolean(segmentStartGradient && sampleGradient
          && segmentStartGradient.gradientAmount === sampleGradient.gradientAmount
          && segmentStartGradient.dither === sampleGradient.dither
          && sameRgbaColor(segmentStartGradient.startColor, sampleGradient.startColor)
          && sameRgbaColor(segmentStartGradient.endColor, sampleGradient.endColor))
        if (samePoint && acceptedSize === segmentStartSize && dynamics.opacityScale === segmentStartOpacityScale && sameColor && sameGradient) continue
        drag.last = point
        drag.lastBrushSize = acceptedSize
        drag.lastOpacityScale = dynamics.opacityScale
        drag.lastBrushColor = sampleColor
        drag.lastBrushGradientActive = Boolean(sampleGradient)
        if (session.perfectPixels) {
          const path = drag.path ?? [{ ...drag.start, size: segmentStartSize, opacityScale: segmentStartOpacityScale, color: segmentStartColor, gradient: segmentStartGradient }]
          if (samePoint) {
            const last = path.at(-1)
            if (last) {
              last.size = acceptedSize
              last.opacityScale = Math.max(last.opacityScale ?? dynamics.opacityScale, dynamics.opacityScale)
              last.color = sampleColor
              last.gradient = sampleGradient
            }
            paintBrush(session.document, activePaintLayer(session), drag.edit, point.x, point.y, acceptedSize, sampleColor, session.brushShape, session.selection, session.tool === 'pencil' || session.tool === 'eraser' ? activeBrushTexture : 'solid', session.brushTextureScale, session.tool === 'pencil' || session.tool === 'eraser' ? activeBrushImage : null, session.brushImageSettings, proceduralAntialiasStrength, activeBrushPaintMode, drag.patternOrigin, session.symmetryAxes, symmetryCenter, drag.colorReplacement, dynamics.opacityScale, undefined, false, sampleGradient)
          } else {
            const removedCorner = appendPerfectPixelSegment(path, { ...point, size: acceptedSize, opacityScale: dynamics.opacityScale, color: sampleColor, gradient: sampleGradient })
            if (removedCorner) {
              revertPixelEdit(session.document, drag.edit)
              const paintLayer = activePaintLayer(session)
              const edit = beginPixelEdit(paintLayer.id)
              for (const center of path) paintBrush(session.document, paintLayer, edit, center.x, center.y, center.size ?? session.brushSize, center.color ?? drag.color ?? activeColor(), session.brushShape, session.selection, session.tool === 'pencil' || session.tool === 'eraser' ? activeBrushTexture : 'solid', session.brushTextureScale, session.tool === 'pencil' || session.tool === 'eraser' ? activeBrushImage : null, session.brushImageSettings, proceduralAntialiasStrength, activeBrushPaintMode, drag.patternOrigin, session.symmetryAxes, symmetryCenter, drag.colorReplacement, center.opacityScale ?? 1, center.coverageKey, center.overrideImageBrushColor, center.gradient)
              drag.edit = edit
              rebuiltStroke = true
            } else {
              paintLine(session.document, activePaintLayer(session), drag.edit, segmentStart.x, segmentStart.y, point.x, point.y, session.brushSize, segmentStartColor, session.selection, session.brushShape, session.tool === 'pencil' || session.tool === 'eraser' ? activeBrushTexture : 'solid', session.brushTextureScale, session.tool === 'pencil' || session.tool === 'eraser' ? activeBrushImage : null, session.brushImageSettings, proceduralAntialiasStrength, activeBrushPaintMode, drag.patternOrigin, 'raster', session.symmetryAxes, symmetryCenter, drag.colorReplacement, {
                fromSize: segmentStartSize,
                toSize: acceptedSize,
                fromOpacityScale: segmentStartOpacityScale,
                toOpacityScale: dynamics.opacityScale,
                gradient: brushLineGradient(segmentStartGradient, sampleGradient)
              })
            }
            drag.path = path
          }
        } else {
          paintLine(session.document, activePaintLayer(session), drag.edit, segmentStart.x, segmentStart.y, point.x, point.y, session.brushSize, segmentStartColor, session.selection, session.brushShape, session.tool === 'pencil' || session.tool === 'eraser' ? activeBrushTexture : 'solid', session.brushTextureScale, session.tool === 'pencil' || session.tool === 'eraser' ? activeBrushImage : null, session.brushImageSettings, proceduralAntialiasStrength, activeBrushPaintMode, drag.patternOrigin, 'raster', session.symmetryAxes, symmetryCenter, drag.colorReplacement, {
            fromSize: segmentStartSize,
            toSize: acceptedSize,
            fromOpacityScale: segmentStartOpacityScale,
            toOpacityScale: dynamics.opacityScale,
            gradient: brushLineGradient(segmentStartGradient, sampleGradient)
          })
          drag.path = [{ ...point, size: acceptedSize, opacityScale: dynamics.opacityScale, color: sampleColor, gradient: sampleGradient }]
        }
        if (rebuiltStroke) compositeCacheRef.current.invalidateAll()
        else invalidateStrokeSegment(segmentStart, point)
        segmentStart = point
        segmentStartSize = acceptedSize
        segmentStartOpacityScale = dynamics.opacityScale
        segmentStartColor = sampleColor
        segmentStartGradient = sampleGradient
      }
      scheduleDraw(); return
    }
    if (drag.kind === 'airbrush') {
      scheduleDraw()
      return
    }
    if (drag.kind === 'shape') {
      const modifiers = currentSelectionMarqueeModifierState()
      drag.constrain = modifiers.proportional
      updateShapePreview(drag, point, modifiers)
      return
    }
    if (drag.kind === 'marquee') {
      drag.moved = drag.moved || selectionGestureMoved(drag.startClient, { x: event.clientX, y: event.clientY })
      if (!drag.moved) { scheduleDraw(); return }
      const modifiers = currentSelectionMarqueeModifierState()
      drag.constrain = modifiers.proportional
      updateMarqueePreview(drag, point, modifiers)
      return
    }
    if (drag.kind === 'magic-preview') {
      const mode = drag.selectionMode ?? session.selectionMode
      const incoming = symmetrySelection(magicWandSelection(session.document, activePaintLayer(session), point.x, point.y, session.wandTolerance, session.wandContiguous), session.document.width, session.document.height, session.symmetryAxes, symmetryCenter)
      drag.previewSelection = combineSelection(drag.selectionStart ?? null, incoming, mode)
      scheduleDraw()
      return
    }
    if (drag.kind === 'lasso') {
      const path = drag.path ?? []
      const last = path.at(-1)
      if (!last || last.x !== point.x || last.y !== point.y) drag.path = [...path, point]
      scheduleDraw()
      return
    }
    if (drag.kind === 'polygon-lasso') { scheduleDraw(); return }
    if (drag.kind === 'move-selection' && drag.selectionStart) {
      const start = drag.selectionStart
      const distance = constrainedTranslation(drag, point.x - drag.start.x, point.y - drag.start.y, modifierActive(event.nativeEvent, 'constrainAxis'))
      const target = { ...start, x: start.x + distance.x, y: start.y + distance.y }
      if (drag.previewTarget?.x === target.x && drag.previewTarget.y === target.y) return
      drag.previewTarget = target
      drag.previewAngle = 0
      scheduleSelectionPreview(drag)
      return
    }
    if (drag.kind === 'move-content' && drag.selectionStart) {
      const start = drag.transformStartTarget ?? drag.selectionStart
      const distance = constrainedTranslation(drag, point.x - drag.start.x, point.y - drag.start.y, modifierActive(event.nativeEvent, 'constrainAxis'))
      const target = { ...start, x: start.x + distance.x, y: start.y + distance.y }
      if (drag.previewTarget?.x === target.x && drag.previewTarget.y === target.y) return
      drag.previewTarget = target
      drag.previewAngle = drag.startAngle ?? 0
      drag.previewShear = drag.transformStartShear ? { ...drag.transformStartShear } : undefined
      scheduleSelectionPreview(drag)
      return
    }
    if (drag.kind === 'transform-content' && drag.selectionStart && drag.selectionSource && drag.handle) {
      updateSelectionTransformPreview(drag, point, selectionTransformModifierState(event.nativeEvent))
      return
    }
    if (drag.kind === 'shear-content' && drag.selectionStart && drag.selectionSource && drag.shearHandle) {
      const edge = drag.shearHandle.slice(-1) as 'n' | 'e' | 's' | 'w'
      const axis = edge === 'n' || edge === 's' ? 'x' : 'y'
      const angle = drag.startAngle ?? 0
      const radians = angle * Math.PI / 180
      const deltaX = point.x - drag.start.x
      const deltaY = point.y - drag.start.y
      const localDelta = axis === 'x'
        ? deltaX * Math.cos(radians) + deltaY * Math.sin(radians)
        : -deltaX * Math.sin(radians) + deltaY * Math.cos(radians)
      const startShear = drag.transformStartShear
      const baseAmount = startShear?.axis === axis && startShear.edge === edge ? startShear.amount : 0
      const amount = baseAmount + Math.round(localDelta)
      if (drag.previewShear?.axis === axis && drag.previewShear.edge === edge && drag.previewShear.amount === amount) return
      drag.previewTarget = { ...(drag.transformStartTarget ?? drag.selectionStart) }
      drag.previewAngle = angle
      drag.previewShear = { axis, edge, amount }
      scheduleSelectionPreview(drag)
      return
    }
    if (drag.kind === 'rotate-content' && drag.selectionStart) {
      const transformTarget = drag.transformStartTarget ?? drag.selectionStart
      const centerX = transformTarget.x + transformTarget.width / 2
      const centerY = transformTarget.y + transformTarget.height / 2
      const startAngle = Math.atan2(drag.start.y - centerY, drag.start.x - centerX)
      const rawAngle = (Math.atan2(point.y - centerY, point.x - centerX) - startAngle) * 180 / Math.PI
      const angle = snapSelectionRotation((drag.startAngle ?? 0) + rawAngle, modifierActive(event.nativeEvent, 'snapSelectionRotation'))
      if (drag.previewAngle === angle) return
      drag.angle = angle
      drag.previewAngle = angle
      drag.previewTarget ??= { ...transformTarget }
      drag.previewShear = drag.transformStartShear ? { ...drag.transformStartShear } : undefined
      scheduleSelectionPreview(drag)
    }
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    stopAirbrushTimer()
    if (symmetryDragRef.current) {
      symmetryDragRef.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      updateCursor(event)
      draw()
      return
    }
    if (inputRef.current.drag?.kind === 'polygon-lasso') {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      endSelectionAdjustmentEdit()
      scheduleDraw()
      return
    }
    const drag = inputRef.current.finish()
    if (!drag) {
      inputRef.current.resetPointerInteraction()
      updateCursor(event)
      hideEyedropperMagnifier()
      return
    }
    if (drag.kind === 'move-layer') hideMoveLayerContentPreview(220)
    if (drag.kind === 'canvas-resize' || drag.kind === 'canvas-move') flushCanvasResizePreview()
    if (selectionPreviewFrameRef.current !== null) {
      window.cancelAnimationFrame(selectionPreviewFrameRef.current)
      selectionPreviewFrameRef.current = null
    }
    const selectionPreviewWasPending = Boolean(drag.previewPending)
    flushSelectionPreview(drag)
    if (adjustmentPreviewEditRef.current && !selectionPreviewWasPending) prepareAdjustmentPreviewEdit(session.document.id)
    if (drag.kind === 'move-layer') compositeCacheRef.current.invalidateSurface()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const state = useWorkspace.getState()
    if (drag.kind === 'pan') {
      finishPanPreview()
      const resumedDrag = restoreCanvasDragAfterPan(drag, localPoint(event) ?? drag.resumeDrag?.last ?? drag.last)
      if (resumedDrag) inputRef.current.drag = resumedDrag
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
          scheduleZoomPreview(constrainCanvasView({ ...view, ...zoomViewAroundViewportPoint(view, nextZoom, { x: event.clientX - rect.left, y: event.clientY - rect.top }, rect.width, rect.height, session.document.width, session.document.height, rotationIndicatorPosition) }))
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
      hideEyedropperMagnifier()
      eyedropperOriginalColorRef.current = null
      publishCanvasColorSamplingCompleted()
      if (!drag.temporarySampling && eyedropperSwitchToPencil) {
        state.setTool('pencil')
        event.currentTarget.style.cursor = canvasToolCursor('pencil', session.primaryColor)
      } else updateCursor(event)
      draw()
      return
    }
    if (drag.kind === 'gradient') {
      gradientPreviewCoverageCacheRef.current = null
      if (drag.start.x !== drag.last.x || drag.start.y !== drag.last.y) {
        const layer = activePaintLayer(session)
        if (!isLayerEffectivelyLocked(session.document, layer)) {
          const edit = applyGradient(session.document, layer, drag.start, drag.last, drag.color ?? session.primaryColor, drag.gradientEndColor ?? session.secondaryColor, session.selection, gradientDither, drag.gradientPaintRegion)
          if (edit) state.commitPixelEdit(edit, t('canvas.history.gradient'))
        }
      }
      draw()
      return
    }
    updateCursor(event)
    if (drag.kind === 'draw' && drag.edit) {
      state.commitPixelEdit(drag.edit, session.tool === 'eraser' ? t('canvas.history.eraser') : t('canvas.history.draw'), { stroke: true, durationMs: Math.max(1, Date.now() - (drag.startedAt ?? Date.now())) })
      if (session.tool === 'eraser') state.setLastEraserPoint(drag.last)
      else state.setLastPencilPoint(drag.last)
    }
    if (drag.kind === 'airbrush' && drag.edit) {
      state.commitPixelEdit(drag.edit, t('canvas.history.airbrush'), { stroke: true, durationMs: Math.max(1, Date.now() - (drag.startedAt ?? Date.now())) })
    }
    if (drag.kind === 'move-layer' && !drag.duplicatedLayer && drag.animationCellOffsets && drag.animationCellKeys?.length) {
      const before = drag.animationCellOffsets
      const after = animationCelOffsetsForKeys(session.document, drag.animationCellKeys)
      const beforeSelection = cloneSelection(drag.selectionStart ?? null)
      const afterSelection = cloneSelection(session.selection)
      if (drag.animationCellKeys.some((key) => after[key] && (after[key].x !== before[key].x || after[key].y !== before[key].y))) {
        state.pushHistory({
          label: t(drag.animationCellKeys.length > 1 ? 'canvas.history.moveSelectedLayers' : 'canvas.history.moveLayer'), bytes: drag.animationCellKeys.length * 32,
          undo: () => { setAnimationCelOffsetsForKeys(session.document, before); session.selection = cloneSelection(beforeSelection) },
          redo: () => { setAnimationCelOffsetsForKeys(session.document, after); session.selection = cloneSelection(afterSelection) }
        })
        state.mutateActive(() => {}, true)
      }
    } else if (drag.kind === 'move-layer' && !drag.duplicatedLayer && drag.layerIds && drag.layerIds.length > 1 && drag.layerOffsets) {
      const before = drag.layerOffsets
      const beforeSelection = cloneSelection(drag.selectionStart ?? null)
      const afterSelection = cloneSelection(session.selection)
      const after = Object.fromEntries(drag.layerIds.map((id) => {
        const layer = session.document.layers.find((candidate) => candidate.id === id)
        return [id, { x: layer?.offsetX ?? before[id].x, y: layer?.offsetY ?? before[id].y }]
      }))
      if (drag.layerIds.some((id) => after[id].x !== before[id].x || after[id].y !== before[id].y)) {
        const frameId = drag.layerFrameId
        state.pushHistory({
          label: t('canvas.history.moveSelectedLayers'), bytes: drag.layerIds.length * 32,
          undo: () => { if (frameId) setAnimationCelOffsets(session.document, frameId, before); session.selection = cloneSelection(beforeSelection) },
          redo: () => { if (frameId) setAnimationCelOffsets(session.document, frameId, after); session.selection = cloneSelection(afterSelection) }
        })
        state.mutateActive(() => {}, true)
      }
    } else if (drag.kind === 'move-layer' && drag.layerId && drag.layerOffset) {
      const layerId = drag.duplicatedLayerId ?? drag.layerId
      const layer = session.document.layers.find((candidate) => candidate.id === layerId)
      if (layer && (layer.offsetX !== drag.layerOffset.x || layer.offsetY !== drag.layerOffset.y)) {
        const before = { ...drag.layerOffset }
        const after = { x: layer.offsetX, y: layer.offsetY }
        const beforeSelection = cloneSelection(drag.selectionStart ?? null)
        const afterSelection = cloneSelection(session.selection)
        state.pushHistory({
          label: t('canvas.history.moveLayer'), bytes: 32,
          undo: () => {
            if (drag.duplicatedLayer) {
              session.document.layers = session.document.layers.filter((candidate) => candidate.id !== layerId)
              session.document.activeLayerId = drag.layerId!
              session.selectedLayerIds = drag.originalSelectedLayerIds?.length ? [...drag.originalSelectedLayerIds] : [drag.layerId!]
              session.selectedGroupId = null
              session.selectedGroupIds = []
            }
            else if (drag.layerFrameId) setAnimationCelOffsets(session.document, drag.layerFrameId, { [layerId]: before })
            session.selection = cloneSelection(beforeSelection)
          },
          redo: () => {
            if (drag.duplicatedLayer) {
              if (!session.document.layers.some((candidate) => candidate.id === layerId)) session.document.layers.splice(drag.duplicatedLayerIndex ?? session.document.layers.length, 0, drag.duplicatedLayer)
              drag.duplicatedLayer.offsetX = after.x; drag.duplicatedLayer.offsetY = after.y
              session.document.activeLayerId = layerId
              session.selectedLayerIds = [layerId]
              session.selectedGroupId = null
              session.selectedGroupIds = []
            } else if (drag.layerFrameId) setAnimationCelOffsets(session.document, drag.layerFrameId, { [layerId]: after })
            session.selection = cloneSelection(afterSelection)
          }
        })
        state.mutateActive(() => {}, true)
      }
    }
    if (drag.kind === 'move-layer' && drag.collapseLayerSelectionOnClick && !drag.moved && drag.clickLayerId) {
      state.selectMoveToolLayer(drag.clickLayerId)
      revealLayerInPanel(session.document.id, drag.clickLayerId)
    }
    if (drag.kind === 'move-layer' && drag.moved && drag.animationCellKeys?.length) {
      finishAnimationCellOperation(session.document.id)
    }
    if (drag.kind === 'shape') {
      const layer = activePaintLayer(session)
      if (!isLayerEffectivelyLocked(session.document, layer)) {
        const edit = beginPixelEdit(layer.id)
        const bounds = drag.previewTarget ?? shapeBounds(drag.start, drag.last, drag.constrain, session.shapeRatio)
        paintShape(session.document, layer, edit, bounds, session.shapeKind, session.primaryColor, session.selection, session.symmetryAxes, symmetryCenter, drag.previewAngle ?? 0)
        const ellipse = session.shapeKind === 'ellipse' || session.shapeKind === 'ellipse-outline'
        state.commitPixelEdit(edit, ellipse ? t('canvas.history.drawEllipse') : t('canvas.history.drawRectangle'))
      }
    }
    if (drag.kind === 'marquee') {
      const moved = drag.moved || selectionGestureMoved(drag.startClient, { x: event.clientX, y: event.clientY })
      const after = finalizeMarqueeSelection(drag.selectionStart ?? null, drag.previewSelection ?? session.selection, moved, drag.selectionMode ?? session.selectionMode)
      state.commitSelectionChange(drag.selectionStart ?? null, after, t('canvas.history.createSelection'))
      updateCursor(event)
      scheduleDraw()
    }
    if (drag.kind === 'lasso') {
      const mode = drag.selectionMode ?? session.selectionMode
      const before = drag.selectionStart ?? null
      const incoming = symmetrySelection(lassoSelection(session.document, drag.path ?? []), session.document.width, session.document.height, session.symmetryAxes, symmetryCenter)
      const after = combineSelection(before, incoming, mode)
      state.commitSelectionChange(before, after, t('canvas.history.lassoSelection'))
    }
    if (drag.kind === 'magic-preview' && drag.selectionStart !== undefined) state.commitSelectionChange(drag.selectionStart ?? null, drag.previewSelection ?? null, t('canvas.history.magicSelection'))
    if (drag.kind === 'move-selection' && drag.selectionStart && drag.previewSelection) state.commitSelectionChange(drag.selectionStart, drag.previewSelection, t('canvas.history.moveSelectionBox'))
    if ((drag.kind === 'move-content' || drag.kind === 'transform-content' || drag.kind === 'rotate-content' || drag.kind === 'shear-content') && drag.selectionStart && drag.previewSelection) {
      const hasPixelPreview = Boolean(drag.previewEdit || drag.translationPreview?.count)
      const label = !hasPixelPreview
        ? t('workspace.history.transformSelection')
        : drag.copy
        ? t('workspace.history.copySelectionContent')
        : drag.kind === 'rotate-content'
          ? t('workspace.history.rotateSelectionContent')
          : drag.kind === 'move-content'
            ? t('workspace.history.moveSelectionContent')
            : t('workspace.history.transformSelectionContent')
      if (selectionTransformPreviewChanged(drag)) {
        if (drag.floatingPaste) state.updateFloatingPastePreview(drag.previewEdit ?? null, drag.previewSelection, drag.translationPreview, drag.previewTarget, drag.previewAngle, drag.previewShear)
        else if (drag.selectionSource) state.beginFloatingSelectionTransform(drag.selectionSource, drag.previewEdit ?? null, drag.selectionStart, drag.previewSelection, Boolean(drag.copy), label, drag.translationPreview, drag.previewTarget, drag.previewAngle, drag.previewShear)
      }
    }
    endSelectionAdjustmentEdit()
    draw()
  }

  useEffect(() => {
    const keyDown = (event: KeyboardEvent): void => {
      if (inputRef.current.drag?.kind !== 'polygon-lasso') return
      if (event.key === 'Enter') commitPolygonLasso()
      else if (event.key === 'Escape') { inputRef.current.finish(); scheduleDraw() }
      else return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener('keydown', keyDown, true)
    return () => window.removeEventListener('keydown', keyDown, true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.document.id, session.selectionMode])

  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (!canvasResizePreviewRef.current && modifierActive(event.nativeEvent, 'brushSizeWheelAdjust') && (session.tool === 'pencil' || session.tool === 'airbrush' || session.tool === 'eraser') && (session.tool === 'airbrush' || !activeBrushImage?.intrinsicSize)) {
      event.preventDefault()
      event.stopPropagation()
      if (session.tool === 'airbrush') useWorkspace.getState().setAirbrushScatterRadius(session.airbrushScatterRadius + (event.deltaY < 0 ? 1 : -1))
      else useWorkspace.getState().setBrushSize(session.brushSize + (event.deltaY < 0 ? 1 : -1))
      return
    }
    if (inputRef.current.drag?.kind === 'pan' || !wheelZoomEnabled) return
    const rect = stageBounds()
    event.preventDefault()
    const liveView = liveViewRef.current
    const oldZoom = liveView.zoom
    const newZoom = wheelCanvasZoom(oldZoom, event.deltaY, wheelZoomMode)
    if (newZoom === oldZoom) return
    scheduleZoomPreview(constrainCanvasView({ ...liveView, ...zoomViewAroundViewportPoint(liveView, newZoom, { x: event.clientX - rect.left, y: event.clientY - rect.top }, rect.width, rect.height, session.document.width, session.document.height, rotationIndicatorPosition) }))
  }

  const measurePointerInput = (kind: 'pointer-down' | 'pointer-move' | 'pointer-up', action: () => void): void => {
    const performanceProbe = window.__moonSpriteCanvasProbe
    if (!performanceProbe?.recordInput) { action(); return }
    const startedAt = performance.now()
    try { action() } finally { performanceProbe.recordInput(kind, performance.now() - startedAt) }
  }
  const pointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => measurePointerInput('pointer-down', () => handlePointerDown(event))
  const pointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => measurePointerInput('pointer-move', () => handlePointerMove(event))
  const pointerUp = (event: React.PointerEvent<HTMLCanvasElement>): void => measurePointerInput('pointer-up', () => handlePointerUp(event))
  const pointerCancel = (event: React.PointerEvent<HTMLCanvasElement>): void => measurePointerInput('pointer-up', () => {
    cancelActiveCanvasInteraction()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    hideEyedropperMagnifier()
    updateCursor(event)
  })
  const pointerLeave = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    inputRef.current.pointer.visible = false
    inputRef.current.resetPointerInteraction()
    inputRef.current.altHeld = false
    inputRef.current.ctrlHeld = false
    inputRef.current.shiftHeld = false
    hideEyedropperMagnifier()
    if (!inputRef.current.drag) event.currentTarget.style.cursor = canvasResizePreviewRef.current ? canvasCursors.unavailable : inputRef.current.spaceHeld ? canvasCursors.grab : canvasToolCursor(session.tool, session.primaryColor)
    draw()
  }
  const pointerEnter = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    updateCursor(event)
    inputRef.current.shiftLinePreview = lineConnectionActive(event.nativeEvent) && !canvasResizePreviewRef.current && !inputRef.current.sampling && (session.tool === 'pencil' || session.tool === 'eraser') && Boolean(lineAnchor)
    draw()
  }

  const rotationStyle = { transform: 'none', transformOrigin: '50% 50%' }
      return <PerformanceProfiler id="CanvasStage"><div ref={stageRef} className="stage-surface"><canvas ref={canvasRef} style={rotationStyle} className={`stage-canvas ${session.tool === 'zoom' ? 'zoom-tool-canvas' : ''}`} aria-label={t('canvas.aria')} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerCancel} onDoubleClick={quickSelectCell} onPointerLeave={pointerLeave} onPointerEnter={pointerEnter} onContextMenu={(event) => event.preventDefault()} onWheel={onWheel} /><canvas ref={selectionCanvasRef} style={rotationStyle} className="stage-selection-overlay" aria-hidden="true" /><div ref={eyedropperMagnifierRef} className="eyedropper-magnifier" data-style={eyedropperMagnifierStyle} hidden aria-hidden="true"><div className="eyedropper-magnifier-viewport"><canvas ref={eyedropperMagnifierCanvasRef} width={204} height={204} aria-hidden="true" /></div><span ref={eyedropperMagnifierSampledMaskRef} className="eyedropper-magnifier-color-mask eyedropper-magnifier-sampled-mask" aria-hidden="true" dangerouslySetInnerHTML={{ __html: eyedropperMagnifierSampledMask }} /><span ref={eyedropperMagnifierPreviousMaskRef} className="eyedropper-magnifier-color-mask eyedropper-magnifier-previous-mask" aria-hidden="true" dangerouslySetInnerHTML={{ __html: eyedropperMagnifierPreviousMask }} /><span className="eyedropper-magnifier-frame" aria-hidden="true" dangerouslySetInnerHTML={{ __html: eyedropperMagnifierFrame }} /><img ref={eyedropperPointerDarkRef} src={eyedropperPointerDark} alt="" aria-hidden="true" /><img ref={eyedropperPointerLightRef} src={eyedropperPointerLight} alt="" aria-hidden="true" /></div><div ref={rotationIndicatorRef} className="rotation-indicator" hidden aria-hidden="true"><span className="rotation-indicator-background">{[rotationBackground1, rotationBackground2, rotationBackground3, rotationBackground4, rotationBackground5, rotationBackground6].map((source) => <img key={source} src={source} alt="" />)}</span><span ref={rotationPointerRef} className="rotation-indicator-pointer"><img src={rotationPointer} alt="" /></span></div></div></PerformanceProfiler>
}
