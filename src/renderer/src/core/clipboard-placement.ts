import type { ViewState } from '@shared/types'
import type { RotationIndicatorPosition } from './file-preferences'
import { unrotatedViewportBounds, viewCanvasOrigin } from './view-geometry'

export interface ClipboardPlacementInput {
  width: number
  height: number
  originX?: number
  originY?: number
  documentWidth: number
  documentHeight: number
  viewportWidth: number
  viewportHeight: number
  view: ViewState
  rotationIndicatorPosition: RotationIndicatorPosition
}

export function resolveClipboardPlacement(input: ClipboardPlacementInput): { x: number; y: number } {
  const viewport = unrotatedViewportBounds(input.viewportWidth, input.viewportHeight, input.view, input.rotationIndicatorPosition)
  const origin = viewCanvasOrigin(input.viewportWidth, input.viewportHeight, input.documentWidth, input.documentHeight, input.view)
  const visible = {
    left: (viewport.left - origin.x) / input.view.zoom,
    top: (viewport.top - origin.y) / input.view.zoom,
    right: (viewport.right - origin.x) / input.view.zoom,
    bottom: (viewport.bottom - origin.y) / input.view.zoom
  }
  if (input.originX !== undefined && input.originY !== undefined) {
    const original = { left: input.originX, top: input.originY, right: input.originX + input.width, bottom: input.originY + input.height }
    if (original.right > visible.left && original.left < visible.right && original.bottom > visible.top && original.top < visible.bottom) {
      return { x: input.originX, y: input.originY }
    }
  }
  if (input.width > input.documentWidth || input.height > input.documentHeight) return { x: 0, y: 0 }
  return {
    x: Math.floor((input.documentWidth - input.width) / 2),
    y: Math.floor((input.documentHeight - input.height) / 2)
  }
}
