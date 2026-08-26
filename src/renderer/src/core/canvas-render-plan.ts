import type { SpriteDocument, ViewState } from '@shared/types'
import type { RotationIndicatorPosition } from './file-preferences'
import { unrotatedViewportBounds, viewCanvasOrigin, type ViewportBounds } from './view-geometry'

export interface CanvasRenderPlan {
  viewportWidth: number
  viewportHeight: number
  rotated: boolean
  viewport: ViewportBounds
  sceneLeft: number
  sceneTop: number
  sceneWidth: number
  sceneHeight: number
  originX: number
  originY: number
  canvasWidth: number
  canvasHeight: number
  fromX: number
  fromY: number
  toX: number
  toY: number
}

export interface DeviceAlignedPixelRect { x: number; y: number; width: number; height: number }

export function deviceAlignedPixelRect(originX: number, originY: number, zoom: number, pixelX: number, pixelY: number, devicePixelRatio: number): DeviceAlignedPixelRect {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1
  // Canvas nearest-neighbour sampling assigns an exact half-device boundary
  // to the lower pixel. Match that tie rule so previews sit on committed pixels.
  const align = (value: number): number => Math.ceil(value * dpr - 0.5) / dpr
  const left = align(originX + pixelX * zoom)
  const top = align(originY + pixelY * zoom)
  const right = align(originX + (pixelX + 1) * zoom)
  const bottom = align(originY + (pixelY + 1) * zoom)
  return { x: left, y: top, width: Math.max(1 / dpr, right - left), height: Math.max(1 / dpr, bottom - top) }
}

export function createCanvasRenderPlan(
  viewportWidth: number,
  viewportHeight: number,
  document: Pick<SpriteDocument, 'width' | 'height'>,
  view: ViewState,
  rotationIndicatorPosition: RotationIndicatorPosition
): CanvasRenderPlan {
  const rotated = Math.abs(view.rotation) > 0.000001 || view.mirrored || view.mirroredVertical
  const viewport = unrotatedViewportBounds(viewportWidth, viewportHeight, view, rotationIndicatorPosition)
  const sceneLeft = Math.floor(viewport.left) - 2
  const sceneTop = Math.floor(viewport.top) - 2
  const sceneWidth = Math.ceil(viewport.right) - sceneLeft + 2
  const sceneHeight = Math.ceil(viewport.bottom) - sceneTop + 2
  const origin = viewCanvasOrigin(viewportWidth, viewportHeight, document.width, document.height, view)
  const canvasWidth = document.width * view.zoom
  const canvasHeight = document.height * view.zoom
  return {
    viewportWidth,
    viewportHeight,
    rotated,
    viewport,
    sceneLeft,
    sceneTop,
    sceneWidth,
    sceneHeight,
    originX: origin.x,
    originY: origin.y,
    canvasWidth,
    canvasHeight,
    fromX: Math.max(0, Math.floor((viewport.left - origin.x) / view.zoom)),
    fromY: Math.max(0, Math.floor((viewport.top - origin.y) / view.zoom)),
    toX: Math.min(document.width, Math.ceil((viewport.right - origin.x) / view.zoom)),
    toY: Math.min(document.height, Math.ceil((viewport.bottom - origin.y) / view.zoom))
  }
}
