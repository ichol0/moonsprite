import type { RotationIndicatorPosition } from './file-preferences'

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

export function rotationIndicatorFitsCanvas(documentWidth: number, documentHeight: number, zoom: number): boolean {
  if (![documentWidth, documentHeight, zoom].every(Number.isFinite) || documentWidth <= 0 || documentHeight <= 0 || zoom <= 0) return false
  const minimumCanvasSize = ROTATION_INDICATOR_MAX_FOOTPRINT * ROTATION_INDICATOR_CLEARANCE_RATIO
  return documentWidth * zoom > minimumCanvasSize && documentHeight * zoom > minimumCanvasSize
}
