import type { RgbaColor } from '@shared/types'

export const CANVAS_COLOR_SAMPLED_EVENT = 'moonsprite:canvas-color-sampled'

export interface CanvasColorSampledDetail {
  color: RgbaColor
  secondary: boolean
}

export function publishCanvasColorSample(color: RgbaColor, secondary: boolean): void {
  window.dispatchEvent(new CustomEvent<CanvasColorSampledDetail>(CANVAS_COLOR_SAMPLED_EVENT, {
    detail: { color: { ...color }, secondary }
  }))
}
