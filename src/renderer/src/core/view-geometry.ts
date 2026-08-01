import type { RotationIndicatorPosition } from './file-preferences'

export interface ViewGeometryState {
  zoom: number
  panX: number
  panY: number
  rotation: number
}

export interface ViewportPoint { x: number; y: number }
export interface ViewportBounds { left: number; top: number; right: number; bottom: number }

const ROTATION_INDICATOR_MAX_FOOTPRINT = 204
const ROTATION_INDICATOR_CLEARANCE_RATIO = 4 / 3

export function viewRotationPivot(width: number, height: number, panX: number, panY: number, position: RotationIndicatorPosition): { x: number; y: number } {
  return {
    x: width / 2 + (position === 'canvas' ? panX : 0),
    y: height / 2 + (position === 'canvas' ? panY : 0)
  }
}

export function viewPanDeltaFromScreen(deltaX: number, deltaY: number, rotation: number, position: RotationIndicatorPosition): { x: number; y: number } {
  if (position === 'canvas' || Math.abs(rotation) < 0.000001) return { x: deltaX, y: deltaY }
  const radians = -rotation * Math.PI / 180
  return {
    x: deltaX * Math.cos(radians) - deltaY * Math.sin(radians),
    y: deltaX * Math.sin(radians) + deltaY * Math.cos(radians)
  }
}

export function viewCanvasOrigin(viewportWidth: number, viewportHeight: number, documentWidth: number, documentHeight: number, view: Pick<ViewGeometryState, 'zoom' | 'panX' | 'panY'>): ViewportPoint {
  return {
    x: viewportWidth / 2 + view.panX - documentWidth * view.zoom / 2,
    y: viewportHeight / 2 + view.panY - documentHeight * view.zoom / 2
  }
}

export function rotateViewportPoint(point: ViewportPoint, pivot: ViewportPoint, degrees: number): ViewportPoint {
  const radians = degrees * Math.PI / 180
  const dx = point.x - pivot.x
  const dy = point.y - pivot.y
  return {
    x: pivot.x + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: pivot.y + dx * Math.sin(radians) + dy * Math.cos(radians)
  }
}

export function unrotateViewportPoint(point: ViewportPoint, pivot: ViewportPoint, degrees: number): ViewportPoint {
  return rotateViewportPoint(point, pivot, -degrees)
}

export function unrotatedViewportBounds(width: number, height: number, view: ViewGeometryState, position: RotationIndicatorPosition): ViewportBounds {
  if (Math.abs(view.rotation) < 0.000001) return { left: 0, top: 0, right: width, bottom: height }
  const pivot = viewRotationPivot(width, height, view.panX, view.panY, position)
  const corners = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: 0, y: height }, { x: width, y: height }].map((point) => unrotateViewportPoint(point, pivot, view.rotation))
  return {
    left: Math.min(...corners.map((point) => point.x)),
    top: Math.min(...corners.map((point) => point.y)),
    right: Math.max(...corners.map((point) => point.x)),
    bottom: Math.max(...corners.map((point) => point.y))
  }
}

export function documentPointFromViewportPoint(point: ViewportPoint, viewportWidth: number, viewportHeight: number, documentWidth: number, documentHeight: number, view: ViewGeometryState, position: RotationIndicatorPosition): ViewportPoint {
  const pivot = viewRotationPivot(viewportWidth, viewportHeight, view.panX, view.panY, position)
  const unrotated = unrotateViewportPoint(point, pivot, view.rotation)
  const origin = viewCanvasOrigin(viewportWidth, viewportHeight, documentWidth, documentHeight, view)
  return { x: Math.floor((unrotated.x - origin.x) / view.zoom), y: Math.floor((unrotated.y - origin.y) / view.zoom) }
}

export function zoomViewAroundViewportPoint(view: ViewGeometryState, nextZoom: number, point: ViewportPoint, viewportWidth: number, viewportHeight: number, documentWidth: number, documentHeight: number, position: RotationIndicatorPosition): ViewGeometryState {
  const pivot = viewRotationPivot(viewportWidth, viewportHeight, view.panX, view.panY, position)
  const unrotated = unrotateViewportPoint(point, pivot, view.rotation)
  const origin = viewCanvasOrigin(viewportWidth, viewportHeight, documentWidth, documentHeight, view)
  const documentPoint = { x: (unrotated.x - origin.x) / view.zoom, y: (unrotated.y - origin.y) / view.zoom }
  return {
    ...view,
    zoom: nextZoom,
    panX: unrotated.x - documentPoint.x * nextZoom - viewportWidth / 2 + documentWidth * nextZoom / 2,
    panY: unrotated.y - documentPoint.y * nextZoom - viewportHeight / 2 + documentHeight * nextZoom / 2
  }
}

export function rotationIndicatorFitsCanvas(documentWidth: number, documentHeight: number, zoom: number): boolean {
  if (![documentWidth, documentHeight, zoom].every(Number.isFinite) || documentWidth <= 0 || documentHeight <= 0 || zoom <= 0) return false
  const minimumCanvasSize = ROTATION_INDICATOR_MAX_FOOTPRINT * ROTATION_INDICATOR_CLEARANCE_RATIO
  return documentWidth * zoom > minimumCanvasSize && documentHeight * zoom > minimumCanvasSize
}
