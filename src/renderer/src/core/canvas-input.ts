import type { RasterLayer, RgbaColor, SelectionMask, SelectionMode, SelectionRect } from '@shared/types'
import type { PixelEdit } from './history'
import type { SelectionTransformSource, SelectionTranslationPreview } from './tools'

export interface CanvasPoint {
  x: number
  y: number
}

export type SelectionHandle = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se'
export type SelectionRotationHandle = 'rotate-ne' | 'rotate-se' | 'rotate-sw' | 'rotate-nw'
export type SelectionHit = 'inside' | 'edge' | 'outside' | SelectionRotationHandle | SelectionHandle

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
}

export const clampCanvasZoom = (zoom: number): number => Math.max(0.0625, Math.min(64, zoom))

export const CANVAS_ZOOM_LEVELS = [0.0625, 0.083333, 0.125, 0.166667, 0.25, 0.333333, 0.5, 0.666667, 1, 1.25, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64] as const

export const steppedCanvasZoom = (zoom: number, zoomIn: boolean): number => {
  const epsilon = 0.000001
  if (zoomIn) return CANVAS_ZOOM_LEVELS.find((level) => level > zoom + epsilon) ?? 64
  for (let index = CANVAS_ZOOM_LEVELS.length - 1; index >= 0; index -= 1) if (CANVAS_ZOOM_LEVELS[index] < zoom - epsilon) return CANVAS_ZOOM_LEVELS[index]
  return 0.0625
}

export const rotationHandles = (box: { x: number; y: number; width: number; height: number }): Array<[SelectionRotationHandle, number, number]> => {
  const offset = 15
  return [
    ['rotate-ne', box.x + box.width + offset, box.y - offset],
    ['rotate-se', box.x + box.width + offset, box.y + box.height + offset],
    ['rotate-sw', box.x - offset, box.y + box.height + offset],
    ['rotate-nw', box.x - offset, box.y - offset]
  ]
}

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
  let left = start.x
  let top = start.y
  let right = start.x + start.width - 1
  let bottom = start.y + start.height - 1
  if (handle.includes('w')) left = Math.min(right, Math.max(0, point.x))
  if (handle.includes('e')) right = Math.max(left, Math.min(bounds.width - 1, point.x))
  if (handle.includes('n')) top = Math.min(bottom, Math.max(0, point.y))
  if (handle.includes('s')) bottom = Math.max(top, Math.min(bounds.height - 1, point.y))

  if (proportional) {
    const rawWidth = right - left + 1
    const rawHeight = bottom - top + 1
    const aspect = start.width / start.height
    const horizontalHandle = handle.includes('w') || handle.includes('e')
    const verticalHandle = handle.includes('n') || handle.includes('s')
    const widthDriven = horizontalHandle && !verticalHandle
      ? true
      : verticalHandle && !horizontalHandle
        ? false
        : rawWidth / start.width >= rawHeight / start.height
    let width = widthDriven ? rawWidth : Math.max(1, Math.round(rawHeight * aspect))
    let height = widthDriven ? Math.max(1, Math.round(rawWidth / aspect)) : rawHeight
    if (integerScale) {
      const scale = Math.max(1, Math.round(widthDriven ? rawWidth / start.width : rawHeight / start.height))
      width = start.width * scale
      height = start.height * scale
    }

    if (handle.includes('w')) left = right - width + 1
    else if (handle.includes('e')) right = left + width - 1
    else {
      const center = (left + right) / 2
      left = Math.round(center - (width - 1) / 2)
      right = left + width - 1
    }
    if (handle.includes('n')) top = bottom - height + 1
    else if (handle.includes('s')) bottom = top + height - 1
    else {
      const center = (top + bottom) / 2
      top = Math.round(center - (height - 1) / 2)
      bottom = top + height - 1
    }

    if (left < 0) { right -= left; left = 0 }
    if (top < 0) { bottom -= top; top = 0 }
    if (right >= bounds.width) { left -= right - bounds.width + 1; right = bounds.width - 1 }
    if (bottom >= bounds.height) { top -= bottom - bounds.height + 1; bottom = bounds.height - 1 }
    left = Math.max(0, left)
    top = Math.max(0, top)
    right = Math.max(left, right)
    bottom = Math.max(top, bottom)
  }
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
}
