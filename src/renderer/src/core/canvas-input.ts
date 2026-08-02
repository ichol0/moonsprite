import type { RasterLayer, RgbaColor, SelectionMask, SelectionMode, SelectionRect } from '@shared/types'
import type { PixelEdit } from './history'
import type { SelectionTransformSource, SelectionTranslationPreview } from './tools'
import { selectionContains } from './selection'

export interface CanvasPoint {
  x: number
  y: number
}

export type SelectionHandle = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se'
export type SelectionRotationHandle = 'rotate-ne' | 'rotate-se' | 'rotate-sw' | 'rotate-nw'
export type SelectionHit = 'inside' | 'edge' | 'outside' | SelectionRotationHandle | SelectionHandle
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
  kind: 'draw' | 'shape' | 'marquee' | 'lasso' | 'magic-preview' | 'sample-color' | 'move-content' | 'move-selection' | 'transform-content' | 'rotate-content' | 'move-layer' | 'brush-size' | 'canvas-resize' | 'canvas-move' | 'zoom-drag' | 'rotate-view' | 'pan'
  start: CanvasPoint
  last: CanvasPoint
  edit?: PixelEdit
  selectionStart?: SelectionMask | null
  selectionMode?: SelectionMode
  startPan?: CanvasPoint
  handle?: SelectionHandle
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
  axisLock?: 'x' | 'y'
  sampleSecondary?: boolean
  temporarySampling?: boolean
}

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

  syncModifierKeys(event: Pick<PointerEvent, 'altKey' | 'ctrlKey'>): void {
    this.altHeld = event.altKey
    this.ctrlHeld = event.ctrlKey
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

  const left = selection.x
  const top = selection.y
  const right = selection.x + selection.width
  const bottom = selection.y + selection.height
  const rotationHit = selectionRotationHit(selection, point, 1 / safeZoom)
  if (rotationHit) return rotationHit

  const edgeOuterRadius = 9 / safeZoom
  const edgeInnerRadius = 7 / safeZoom
  const spansHorizontalEdge = point.x >= left - edgeOuterRadius && point.x <= right + edgeOuterRadius
  const spansVerticalEdge = point.y >= top - edgeOuterRadius && point.y <= bottom + edgeOuterRadius
  const nearHorizontalEdge = spansHorizontalEdge && ((point.y >= top - edgeOuterRadius && point.y <= top + edgeInnerRadius) || (point.y >= bottom - edgeInnerRadius && point.y <= bottom + edgeOuterRadius))
  const nearVerticalEdge = spansVerticalEdge && ((point.x >= left - edgeOuterRadius && point.x <= left + edgeInnerRadius) || (point.x >= right - edgeInnerRadius && point.x <= right + edgeOuterRadius))
  if (nearHorizontalEdge || nearVerticalEdge) return 'edge'
  if (point.x < left || point.x > right || point.y < top || point.y > bottom) return 'outside'
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

export const snapSelectionRotation = (angle: number, enabled: boolean): number =>
  enabled ? Math.round(angle / 45) * 45 : angle

export const shapeBounds = (start: CanvasPoint, end: CanvasPoint, constrain = false): SelectionRect => {
  if (!constrain) {
    const x = Math.min(start.x, end.x)
    const y = Math.min(start.y, end.y)
    return { x, y, width: Math.abs(end.x - start.x) + 1, height: Math.abs(end.y - start.y) + 1 }
  }
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  const distance = Math.max(Math.abs(deltaX), Math.abs(deltaY))
  return shapeBounds(start, {
    x: start.x + (deltaX < 0 ? -distance : distance),
    y: start.y + (deltaY < 0 ? -distance : distance)
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
