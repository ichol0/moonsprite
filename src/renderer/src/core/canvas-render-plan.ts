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
