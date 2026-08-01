import type { SelectionMask, SelectionRect, ViewState } from '@shared/types'
import type { RotationIndicatorPosition } from '@/core/file-preferences'
import type { SelectionHandle } from '@/core/canvas-input'
import { selectionBoundarySegments } from '@/core/selection'
import { unrotatedViewportBounds, viewCanvasOrigin } from '@/core/view-geometry'

export type RasterContext2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export interface SelectionScreenBox {
  x: number
  y: number
  width: number
  height: number
}

export interface SelectionBoundaryCache {
  width: number
  height: number
  mask?: Uint8Array
  segments: Int32Array
  screenPaths: Map<string, Path2D>
}

export function selectionScreenBox(
  stageWidth: number,
  stageHeight: number,
  documentWidth: number,
  documentHeight: number,
  view: ViewState,
  selection: SelectionRect
): SelectionScreenBox {
  const origin = viewCanvasOrigin(stageWidth, stageHeight, documentWidth, documentHeight, view)
  return {
    x: origin.x + selection.x * view.zoom,
    y: origin.y + selection.y * view.zoom,
    width: selection.width * view.zoom,
    height: selection.height * view.zoom
  }
}

interface DrawSelectionOptions {
  context: RasterContext2D
  selection: SelectionMask
  box: SelectionScreenBox
  view: ViewState
  viewportWidth: number
  viewportHeight: number
  rotationIndicatorPosition: RotationIndicatorPosition
  cache: SelectionBoundaryCache | null
  showHandles?: boolean
}

export function drawSelectionOutline({
  context,
  selection,
  box,
  view,
  viewportWidth,
  viewportHeight,
  rotationIndicatorPosition,
  cache,
  showHandles = true
}: DrawSelectionOptions): SelectionBoundaryCache {
  const phase = Math.floor(performance.now() / 180) % 8
  let nextCache = cache
  if (!nextCache || nextCache.width !== selection.width || nextCache.height !== selection.height || nextCache.mask !== selection.mask) {
    const segments = selectionBoundarySegments(selection)
    nextCache = { width: selection.width, height: selection.height, mask: selection.mask, segments, screenPaths: new Map() }
  }

  const zoom = Math.max(0.0001, box.width / Math.max(1, selection.width))
  const viewport = unrotatedViewportBounds(viewportWidth, viewportHeight, view, rotationIndicatorPosition)
  const visibleLeft = Math.max(0, Math.floor((viewport.left - box.x) / zoom) - 1)
  const visibleTop = Math.max(0, Math.floor((viewport.top - box.y) / zoom) - 1)
  const visibleRight = Math.min(selection.width, Math.ceil((viewport.right - box.x) / zoom) + 1)
  const visibleBottom = Math.min(selection.height, Math.ceil((viewport.bottom - box.y) / zoom) + 1)
  const zoomKey = zoom.toFixed(6)
  const pathKey = `${zoomKey}:${visibleLeft}:${visibleTop}:${visibleRight}:${visibleBottom}`
  let screenPath = nextCache.screenPaths.get(pathKey)
  if (!screenPath) {
    screenPath = new Path2D()
    for (let index = 0; index < nextCache.segments.length; index += 4) {
      const x1 = nextCache.segments[index]
      const y1 = nextCache.segments[index + 1]
      const x2 = nextCache.segments[index + 2]
      const y2 = nextCache.segments[index + 3]
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
    nextCache.screenPaths.set(pathKey, screenPath)
    if (nextCache.screenPaths.size > 16) nextCache.screenPaths.delete(nextCache.screenPaths.keys().next().value!)
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
  if (!showHandles) return nextCache

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
  return nextCache
}
