import type { RasterLayer, RgbaColor, SelectionMask, SelectionMode, SelectionRect, ShapeRatio } from '@shared/types'
import type { PixelEdit } from './history'
import type { SelectionTransformSource, SelectionTranslationPreview } from './tools'
import { rasterLinePoints, selectionBoundarySegments, selectionContains } from './selection'
import { balancedStairLinePoints } from './pixel-line'

const selectionHitBoundaryCache = new WeakMap<SelectionMask, Int32Array>()

const cachedSelectionBoundarySegments = (selection: SelectionMask): Int32Array => {
  const cached = selectionHitBoundaryCache.get(selection)
  if (cached) return cached
  const segments = selectionBoundarySegments(selection)
  selectionHitBoundaryCache.set(selection, segments)
  return segments
}

export interface CanvasPoint {
  x: number
  y: number
}

export type SelectionHandle = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se'
export type SelectionRotationHandle = 'rotate-ne' | 'rotate-se' | 'rotate-sw' | 'rotate-nw'
export type SelectionShearHandle = 'shear-n' | 'shear-e' | 'shear-s' | 'shear-w'
export type SelectionHit = 'inside' | 'edge' | 'outside' | SelectionRotationHandle | SelectionShearHandle | SelectionHandle
export const SELECTION_RESIZE_HIT_RADIUS = 12
export const SELECTION_CORNER_RESIZE_HIT_RADIUS = 18
export const SELECTION_CORNER_OUTWARD_RESIZE_HIT_RADIUS = 5

export const selectionResizeHit = (
  box: { x: number; y: number; width: number; height: number },
  point: CanvasPoint,
  radius: number,
  cornerRadius = radius,
  outwardCornerRadius = cornerRadius
): SelectionHandle | null => {
  const left = box.x
  const right = box.x + box.width
  const top = box.y
  const bottom = box.y + box.height
  const centerX = box.x + box.width / 2
  const centerY = box.y + box.height / 2
  const nearCorner = (handle: SelectionHandle, x: number, y: number): boolean => {
    const inOuterQuadrant = handle === 'nw'
      ? point.x <= x && point.y <= y
      : handle === 'ne'
        ? point.x >= x && point.y <= y
        : handle === 'se'
          ? point.x >= x && point.y >= y
          : point.x <= x && point.y >= y
    const hitRadius = inOuterQuadrant ? outwardCornerRadius : cornerRadius
    return Math.abs(point.x - x) <= hitRadius && Math.abs(point.y - y) <= hitRadius
  }

  // 角点优先。边中段会明确避开两个角点，避免缩放与旋转命中区重叠。
  const corners: Array<[SelectionHandle, number, number]> = [
    ['nw', left, top], ['ne', right, top], ['sw', left, bottom], ['se', right, bottom]
  ]
  for (const [handle, x, y] of corners) if (nearCorner(handle, x, y)) return handle

  // 边缩放只命中四个可见中点，不得让整条边都变成缩放区。
  const candidates: Array<[SelectionHandle, number, number]> = [
    ['n', centerX, top], ['s', centerX, bottom], ['w', left, centerY], ['e', right, centerY]
  ]
  let nearest: SelectionHandle | null = null
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const [handle, x, y] of candidates) {
    if (Math.abs(point.x - x) > radius || Math.abs(point.y - y) > radius) continue
    const distance = (point.x - x) ** 2 + (point.y - y) ** 2
    if (distance < nearestDistance) {
      nearest = handle
      nearestDistance = distance
    }
  }
  return nearest
}

export interface CanvasDragState {
  kind: 'draw' | 'shape' | 'gradient' | 'marquee' | 'lasso' | 'polygon-lasso' | 'magic-preview' | 'sample-color' | 'move-content' | 'move-selection' | 'transform-content' | 'rotate-content' | 'shear-content' | 'move-layer' | 'brush-size' | 'canvas-resize' | 'canvas-move' | 'zoom-drag' | 'rotate-view' | 'pan'
  start: CanvasPoint
  last: CanvasPoint
  edit?: PixelEdit
  selectionStart?: SelectionMask | null
  selectionMode?: SelectionMode
  startPan?: CanvasPoint
  handle?: SelectionHandle
  shearHandle?: SelectionShearHandle
  angle?: number
  selectionSource?: SelectionTransformSource
  previewEdit?: PixelEdit | null
  copy?: boolean
  startClient?: CanvasPoint
  startBrushSize?: number
  startZoom?: number
  startRotation?: number
  startAngle?: number
  patternOrigin?: CanvasPoint
  constrain?: boolean
  path?: CanvasPoint[]
  canvasEdge?: 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
  canvasPreview?: { width: number; height: number; offsetX: number; offsetY: number }
  floatingPaste?: boolean
  previewSelection?: SelectionMask | null
  appliedSelection?: SelectionMask | null
  previewTarget?: SelectionRect
  previewAngle?: number
  previewShear?: { axis: 'x' | 'y'; edge: 'n' | 'e' | 's' | 'w'; amount: number }
  previewPending?: boolean
  translationPreview?: SelectionTranslationPreview | null
  layerId?: string
  layerOffset?: CanvasPoint
  layerIds?: string[]
  layerOffsets?: Record<string, CanvasPoint>
  duplicateOnDrag?: boolean
  duplicatedLayerId?: string
  duplicatedLayer?: RasterLayer
  duplicatedLayerIndex?: number
  originalSelectedLayerIds?: string[]
  color?: RgbaColor
  gradientEndColor?: RgbaColor
  axisLock?: 'x' | 'y'
  sampleSecondary?: boolean
  temporarySampling?: boolean
  moved?: boolean
  startedAt?: number
  resumeDrag?: CanvasDragState
  /** Raw pointer endpoint retained while a gradient is direction-constrained. */
  rawLast?: CanvasPoint
}

export const selectionGestureMoved = (start: CanvasPoint | undefined, end: CanvasPoint, threshold = 3): boolean =>
  Boolean(start && (Math.abs(end.x - start.x) > threshold || Math.abs(end.y - start.y) > threshold))

const selectionCreationKinds = new Set<CanvasDragState['kind']>(['marquee', 'lasso', 'polygon-lasso'])
const selectionPreviewKinds = new Set<CanvasDragState['kind']>(['magic-preview', 'move-selection', 'move-content', 'transform-content', 'rotate-content', 'shear-content'])

export const canvasGestureForPreview = (drag: CanvasDragState | null | undefined): CanvasDragState | null =>
  drag?.kind === 'pan' && drag.resumeDrag?.kind === 'polygon-lasso' ? drag.resumeDrag : drag ?? null

export const selectionOverlayMaskForDrag = (
  currentSelection: SelectionMask | null,
  drag: CanvasDragState | null | undefined
): SelectionMask | null => {
  const previewDrag = canvasGestureForPreview(drag)
  if (!previewDrag) return currentSelection
  if (selectionCreationKinds.has(previewDrag.kind)) return previewDrag.selectionStart ?? null
  if (selectionPreviewKinds.has(previewDrag.kind)) return previewDrag.previewSelection ?? currentSelection
  return currentSelection
}

export const createCanvasPanDrag = (
  startPan: CanvasPoint,
  startClient: CanvasPoint,
  resumeDrag?: CanvasDragState
): CanvasDragState => ({
  kind: 'pan',
  start: { x: 0, y: 0 },
  last: { x: 0, y: 0 },
  startPan: { ...startPan },
  startClient: { ...startClient },
  resumeDrag: resumeDrag?.kind === 'polygon-lasso' ? resumeDrag : undefined
})

export const restoreCanvasDragAfterPan = (
  panDrag: CanvasDragState,
  pointer: CanvasPoint
): CanvasDragState | null => panDrag.kind === 'pan' && panDrag.resumeDrag?.kind === 'polygon-lasso'
  ? { ...panDrag.resumeDrag, last: { ...pointer } }
  : null

export const appendPolygonLassoVertex = (path: readonly CanvasPoint[], point: CanvasPoint): CanvasPoint[] => {
  const last = path.at(-1)
  return last?.x === point.x && last.y === point.y ? [...path] : [...path, { ...point }]
}

export const shouldClosePolygonLasso = (path: readonly CanvasPoint[], point: CanvasPoint, clickCount: number): boolean =>
  path.length >= 3 && (clickCount >= 2 || (path[0].x === point.x && path[0].y === point.y))

export const polygonLassoPreviewPoints = (
  path: readonly CanvasPoint[],
  pointer: CanvasPoint,
  closePreview: boolean,
  balanced = false
): CanvasPoint[] => {
  if (path.length === 0) return []
  const linePoints = balanced ? balancedStairLinePoints : rasterLinePoints
  const points: CanvasPoint[] = []
  for (let index = 1; index < path.length; index += 1) points.push(...linePoints(path[index - 1], path[index]))
  points.push(...linePoints(path.at(-1)!, pointer))
  if (closePreview && path.length > 1) points.push(...linePoints(pointer, path[0]))
  return points
}

export const polygonLassoClosedPathPoints = (path: readonly CanvasPoint[], balanced = false): CanvasPoint[] => {
  if (path.length < 2) return path.map((point) => ({ ...point }))
  const linePoints = balanced ? balancedStairLinePoints : rasterLinePoints
  const points: CanvasPoint[] = []
  for (let index = 1; index < path.length; index += 1) points.push(...linePoints(path[index - 1], path[index]))
  points.push(...linePoints(path.at(-1)!, path[0]))
  return points
}

export const shouldRestartFloatingSelectionForCopy = (_floatingCopy: boolean, copyRequested: boolean): boolean =>
  copyRequested

export const finalizeMarqueeSelection = (
  before: SelectionMask | null,
  preview: SelectionMask | null,
  moved: boolean,
  mode: SelectionMode
): SelectionMask | null => moved ? preview : mode === 'replace' ? null : before

export interface CanvasPointerState {
  point: CanvasPoint
  clientX: number
  clientY: number
  ctrlKey: boolean
  altKey: boolean
  visible: boolean
}

const EMPTY_POINTER: CanvasPointerState = {
  point: { x: 0, y: 0 },
  clientX: 0,
  clientY: 0,
  ctrlKey: false,
  altKey: false,
  visible: false
}

export class CanvasInputState {
  drag: CanvasDragState | null = null
  pointer: CanvasPointerState = { ...EMPTY_POINTER, point: { ...EMPTY_POINTER.point } }
  sampling = false
  altHeld = false
  ctrlHeld = false
  shiftHeld = false
  spaceHeld = false
  shiftLinePreview = false
  modifierBrushSize: { x: number; y: number; size: number } | null = null

  begin(drag: CanvasDragState): CanvasDragState {
    this.drag = drag
    return drag
  }

  finish(): CanvasDragState | null {
    const drag = this.drag
    this.drag = null
    return drag
  }

  updatePointer(pointer: Omit<CanvasPointerState, 'visible'>): void {
    this.pointer = { ...pointer, point: { ...pointer.point }, visible: true }
  }

  clearPointer(): void {
    this.pointer.visible = false
  }

  resetPointerInteraction(): void {
    this.sampling = false
    this.shiftLinePreview = false
    this.modifierBrushSize = null
  }

  syncModifierKeys(event: Pick<PointerEvent, 'altKey' | 'ctrlKey' | 'shiftKey'>): void {
    this.altHeld = event.altKey
    this.ctrlHeld = event.ctrlKey
    this.shiftHeld = event.shiftKey
  }
}

export const clampCanvasZoom = (zoom: number): number => Math.max(0.0625, Math.min(64, zoom))

export const CANVAS_ZOOM_LEVELS = [0.0625, 0.083333, 0.125, 0.166667, 0.25, 0.333333, 0.5, 0.666667, 1, 1.25, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64] as const

export const steppedCanvasZoom = (zoom: number, zoomIn: boolean): number => {
  const epsilon = 0.000001
  if (zoomIn) return CANVAS_ZOOM_LEVELS.find((level) => level > zoom + epsilon) ?? 64
  for (let index = CANVAS_ZOOM_LEVELS.length - 1; index >= 0; index -= 1) if (CANVAS_ZOOM_LEVELS[index] < zoom - epsilon) return CANVAS_ZOOM_LEVELS[index]
  return 0.0625
}

export const zoomDragTarget = (startZoom: number, horizontalDistance: number, mode: 'smooth' | 'stepped'): number => {
  if (mode === 'smooth') return clampCanvasZoom(startZoom * 2 ** (horizontalDistance / 96))
  const steps = Math.trunc(horizontalDistance / 24)
  let zoom = startZoom
  for (let index = 0; index < Math.abs(steps); index += 1) zoom = steppedCanvasZoom(zoom, steps > 0)
  return zoom
}

export const zoomDragModeForModifiers = (defaultMode: 'smooth' | 'stepped', shiftKey: boolean): 'smooth' | 'stepped' => shiftKey ? 'stepped' : defaultMode

export const shouldStartCanvasPan = (tool: string, shiftKey: boolean, selectionTool: boolean): boolean => tool === 'hand' || (
  shiftKey
  && !selectionTool
  && tool !== 'shape'
  && tool !== 'pencil'
  && tool !== 'eraser'
  && tool !== 'zoom'
)

export const rotationHandles = (box: { x: number; y: number; width: number; height: number }): Array<[SelectionRotationHandle, number, number]> => {
  const offset = 22
  return [
    ['rotate-ne', box.x + box.width + offset, box.y - offset],
    ['rotate-se', box.x + box.width + offset, box.y + box.height + offset],
    ['rotate-sw', box.x - offset, box.y + box.height + offset],
    ['rotate-nw', box.x - offset, box.y - offset]
  ]
}

// 旋转只占用角点附近的紧凑区域，避免阻挡套索继续选择周边像素。
export const ROTATION_HANDLE_HIT_RADIUS = 28

export const selectionShearHit = (
  box: { x: number; y: number; width: number; height: number },
  point: CanvasPoint,
  scale = 1
): SelectionShearHandle | null => {
  const safeScale = Math.max(0.0001, scale)
  const inner = SELECTION_RESIZE_HIT_RADIUS * safeScale
  const outer = ROTATION_HANDLE_HIT_RADIUS * safeScale
  const centerX = box.x + box.width / 2
  const centerY = box.y + box.height / 2
  const right = box.x + box.width
  const bottom = box.y + box.height
  if (point.y < box.y - inner && point.y >= box.y - outer && Math.abs(point.x - centerX) <= outer) return 'shear-n'
  if (point.y > bottom + inner && point.y <= bottom + outer && Math.abs(point.x - centerX) <= outer) return 'shear-s'
  if (point.x < box.x - inner && point.x >= box.x - outer && Math.abs(point.y - centerY) <= outer) return 'shear-w'
  if (point.x > right + inner && point.x <= right + outer && Math.abs(point.y - centerY) <= outer) return 'shear-e'
  return null
}

export const selectionRotationHit = (
  box: { x: number; y: number; width: number; height: number },
  point: CanvasPoint,
  scale = 1
): SelectionRotationHandle | null => {
  const safeScale = Math.max(0.0001, scale)
  const within = point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height
  if (within) return null
  if (selectionResizeHit(
    box,
    point,
    SELECTION_RESIZE_HIT_RADIUS * safeScale,
    SELECTION_CORNER_RESIZE_HIT_RADIUS * safeScale,
    SELECTION_CORNER_OUTWARD_RESIZE_HIT_RADIUS * safeScale
  )) return null

  const left = box.x
  const right = box.x + box.width
  const top = box.y
  const bottom = box.y + box.height
  let nearest: SelectionRotationHandle | null = null
  let nearestDistance = Number.POSITIVE_INFINITY
  const handles: Array<[SelectionRotationHandle, number, number]> = [
    ['rotate-ne', right, top],
    ['rotate-se', right, bottom],
    ['rotate-sw', left, bottom],
    ['rotate-nw', left, top]
  ]
  for (const [handle, handleX, handleY] of handles) {
    if (Math.abs(point.x - handleX) > ROTATION_HANDLE_HIT_RADIUS * safeScale || Math.abs(point.y - handleY) > ROTATION_HANDLE_HIT_RADIUS * safeScale) continue
    const distance = (point.x - handleX) ** 2 + (point.y - handleY) ** 2
    if (distance < nearestDistance) { nearest = handle; nearestDistance = distance }
  }
  return nearest
}

export const selectionInteractionHit = (
  selection: SelectionMask,
  point: CanvasPoint,
  zoom: number
): SelectionHit => {
  const safeZoom = Math.max(0.0001, zoom)
  const resizeHit = selectionResizeHit(
    selection,
    point,
    SELECTION_RESIZE_HIT_RADIUS / safeZoom,
    SELECTION_CORNER_RESIZE_HIT_RADIUS / safeZoom,
    SELECTION_CORNER_OUTWARD_RESIZE_HIT_RADIUS / safeZoom
  )
  if (resizeHit) return resizeHit

  const shearHit = selectionShearHit(selection, point, 1 / safeZoom)
  if (shearHit) return shearHit

  const rotationHit = selectionRotationHit(selection, point, 1 / safeZoom)
  if (rotationHit) return rotationHit

  const edgeRadius = 8 / safeZoom
  const localX = point.x - selection.x
  const localY = point.y - selection.y
  const segments = cachedSelectionBoundarySegments(selection)
  for (let index = 0; index < segments.length; index += 4) {
    const x1 = segments[index]
    const y1 = segments[index + 1]
    const x2 = segments[index + 2]
    const y2 = segments[index + 3]
    const closestX = Math.max(Math.min(x1, x2), Math.min(Math.max(x1, x2), localX))
    const closestY = Math.max(Math.min(y1, y2), Math.min(Math.max(y1, y2), localY))
    if (Math.hypot(localX - closestX, localY - closestY) <= edgeRadius) return 'edge'
  }
  return selectionContains(selection, Math.floor(point.x), Math.floor(point.y)) ? 'inside' : 'outside'
}

export const selectionTransformModifiers = (
  modifiers: { ctrlKey: boolean; metaKey?: boolean; shiftKey: boolean }
): { proportional: boolean; integerScale: boolean; copy: false } => {
  return {
    proportional: modifiers.shiftKey,
    integerScale: Boolean(modifiers.ctrlKey || modifiers.metaKey),
    copy: false
  }
}

export const selectionShapeUsesConstraint = (modifiers: { ctrlKey: boolean; metaKey?: boolean }): boolean =>
  Boolean(modifiers.ctrlKey || modifiers.metaKey)

export const selectionMarqueeUsesConstraint = (
  modifiers: { ctrlKey: boolean; metaKey?: boolean; shiftKey: boolean },
  hasSelection: boolean,
  mode: SelectionMode
): boolean => {
  if (modifiers.ctrlKey || modifiers.metaKey) return true
  return modifiers.shiftKey && (!hasSelection || mode !== 'add')
}

export const snapSelectionRotation = (angle: number, enabled: boolean): number =>
  enabled ? Math.round(angle / 45) * 45 : angle

export const shapeBounds = (start: CanvasPoint, end: CanvasPoint, constrain = false, fixedRatio: ShapeRatio | null = null): SelectionRect => {
  const ratio = fixedRatio && Number.isFinite(fixedRatio.width) && Number.isFinite(fixedRatio.height)
    ? Math.max(0.001, fixedRatio.width / fixedRatio.height)
    : constrain ? 1 : null
  if (ratio === null) {
    const x = Math.min(start.x, end.x)
    const y = Math.min(start.y, end.y)
    return { x, y, width: Math.abs(end.x - start.x) + 1, height: Math.abs(end.y - start.y) + 1 }
  }
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  const absoluteX = Math.abs(deltaX)
  const absoluteY = Math.abs(deltaY)
  const widthMajor = absoluteX / ratio >= absoluteY
  const widthDistance = widthMajor ? absoluteX : Math.round(absoluteY * ratio)
  const heightDistance = widthMajor ? Math.round(absoluteX / ratio) : absoluteY
  return shapeBounds(start, {
    x: start.x + (deltaX < 0 ? -widthDistance : widthDistance),
    y: start.y + (deltaY < 0 ? -heightDistance : heightDistance)
  })
}

export const constrainedTranslation = (drag: CanvasDragState, deltaX: number, deltaY: number, shift: boolean): CanvasPoint => {
  if (!shift) {
    drag.axisLock = undefined
    return { x: deltaX, y: deltaY }
  }
  const absoluteX = Math.abs(deltaX)
  const absoluteY = Math.abs(deltaY)
  if (!drag.axisLock && (absoluteX !== 0 || absoluteY !== 0)) drag.axisLock = absoluteX >= absoluteY ? 'x' : 'y'
  if (drag.axisLock === 'x' && absoluteY > absoluteX * 1.2) drag.axisLock = 'y'
  if (drag.axisLock === 'y' && absoluteX > absoluteY * 1.2) drag.axisLock = 'x'
  return drag.axisLock === 'x' ? { x: deltaX, y: 0 } : { x: 0, y: deltaY }
}

export const resizeSelectionBounds = (
  start: SelectionRect,
  point: CanvasPoint,
  handle: SelectionHandle,
  bounds: { width: number; height: number },
  proportional = false,
  integerScale = false
): SelectionRect => {
  const originalLeft = start.x
  const originalTop = start.y
  const originalRight = start.x + start.width
  const originalBottom = start.y + start.height
  const clampedX = Math.max(0, Math.min(bounds.width, point.x))
  const clampedY = Math.max(0, Math.min(bounds.height, point.y))
  let left = originalLeft
  let top = originalTop
  let right = originalRight
  let bottom = originalBottom
  let flipHorizontal = Boolean(start.flipHorizontal)
  let flipVertical = Boolean(start.flipVertical)
  let flipOriginX = start.flipOriginX
  let flipOriginY = start.flipOriginY
  let crossedHorizontal = false
  let crossedVertical = false
  if (handle.includes('w')) {
    crossedHorizontal = clampedX > originalRight
    left = crossedHorizontal ? originalRight : Math.min(originalRight - 1, clampedX)
    right = crossedHorizontal ? Math.max(originalRight + 1, clampedX) : originalRight
    flipHorizontal = crossedHorizontal ? !Boolean(start.flipHorizontal) : Boolean(start.flipHorizontal)
    flipOriginX = crossedHorizontal ? clampedX : (flipHorizontal ? start.flipOriginX : undefined)
  }
  if (handle.includes('e')) {
    crossedHorizontal = clampedX < originalLeft
    left = crossedHorizontal ? Math.min(originalLeft - 1, clampedX) : originalLeft
    right = crossedHorizontal ? originalLeft : Math.max(originalLeft + 1, clampedX)
    flipHorizontal = crossedHorizontal ? !Boolean(start.flipHorizontal) : Boolean(start.flipHorizontal)
    flipOriginX = crossedHorizontal ? clampedX : (flipHorizontal ? start.flipOriginX : undefined)
  }
  if (handle.includes('n')) {
    crossedVertical = clampedY > originalBottom
    top = crossedVertical ? originalBottom : Math.min(originalBottom - 1, clampedY)
    bottom = crossedVertical ? Math.max(originalBottom + 1, clampedY) : originalBottom
    flipVertical = crossedVertical ? !Boolean(start.flipVertical) : Boolean(start.flipVertical)
    flipOriginY = crossedVertical ? clampedY : (flipVertical ? start.flipOriginY : undefined)
  }
  if (handle.includes('s')) {
    crossedVertical = clampedY < originalTop
    top = crossedVertical ? Math.min(originalTop - 1, clampedY) : originalTop
    bottom = crossedVertical ? originalTop : Math.max(originalTop + 1, clampedY)
    flipVertical = crossedVertical ? !Boolean(start.flipVertical) : Boolean(start.flipVertical)
    flipOriginY = crossedVertical ? clampedY : (flipVertical ? start.flipOriginY : undefined)
  }

  if (proportional || integerScale) {
    const rawWidth = right - left
    const rawHeight = bottom - top
    const aspect = start.width / start.height
    const horizontalHandle = handle.includes('w') || handle.includes('e')
    const verticalHandle = handle.includes('n') || handle.includes('s')
    const widthDriven = horizontalHandle && !verticalHandle
      ? true
      : verticalHandle && !horizontalHandle
        ? false
        : rawWidth / start.width >= rawHeight / start.height
    let width = proportional
      ? (widthDriven ? rawWidth : Math.max(1, Math.round(rawHeight * aspect)))
      : rawWidth
    let height = proportional
      ? (widthDriven ? Math.max(1, Math.round(rawWidth / aspect)) : rawHeight)
      : rawHeight
    if (integerScale) {
      if (proportional) {
        const scale = Math.max(1, Math.round(widthDriven ? (rawWidth + 1) / start.width : (rawHeight + 1) / start.height))
        width = start.width * scale
        height = start.height * scale
      } else {
        if (horizontalHandle) width = start.width * Math.max(1, Math.round((rawWidth + 1) / start.width))
        if (verticalHandle) height = start.height * Math.max(1, Math.round((rawHeight + 1) / start.height))
      }
    }

    if (handle.includes('w')) {
      if (crossedHorizontal) { left = originalRight; right = originalRight + width }
      else { left = originalRight - width; right = originalRight }
    } else if (handle.includes('e')) {
      if (crossedHorizontal) { left = originalLeft - width; right = originalLeft }
      else { left = originalLeft; right = originalLeft + width }
    }
    else {
      const center = (left + right) / 2
      left = Math.round(center - width / 2)
      right = left + width
    }
    if (handle.includes('n')) {
      if (crossedVertical) { top = originalBottom; bottom = originalBottom + height }
      else { top = originalBottom - height; bottom = originalBottom }
    } else if (handle.includes('s')) {
      if (crossedVertical) { top = originalTop - height; bottom = originalTop }
      else { top = originalTop; bottom = originalTop + height }
    }
    else {
      const center = (top + bottom) / 2
      top = Math.round(center - height / 2)
      bottom = top + height
    }
  }
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    ...(flipHorizontal ? { flipHorizontal: true } : {}),
    ...(flipVertical ? { flipVertical: true } : {}),
    ...(flipHorizontal && Number.isFinite(flipOriginX) ? { flipOriginX } : {}),
    ...(flipVertical && Number.isFinite(flipOriginY) ? { flipOriginY } : {})
  }
}
