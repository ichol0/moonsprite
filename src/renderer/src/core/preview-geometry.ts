interface Point { x: number; y: number }
interface Size { width: number; height: number }

export const previewCheckerCellSize = (checkerSize: number, displayScale: number): number => checkerSize * displayScale

/** Keeps pixel-art previews on uniform integer or reciprocal-integer pixel scales. */
export const pixelPerfectPreviewScale = (scale: number): number => {
  if (!Number.isFinite(scale) || scale <= 0) return 1
  return scale >= 1 ? Math.max(1, Math.round(scale)) : 1 / Math.max(1, Math.round(1 / scale))
}

interface AnchoredPreviewPanOptions {
  documentSize: Size
  viewportSize: Size
  pointer: Point
  pan: Point
  zoom: number
  nextZoom: number
}

export const anchoredPreviewPan = ({ documentSize, viewportSize, pointer, pan, zoom, nextZoom }: AnchoredPreviewPanOptions): Point => {
  const fitScale = Math.min(viewportSize.width / documentSize.width, viewportSize.height / documentSize.height)
  const currentScale = pixelPerfectPreviewScale(fitScale * zoom)
  const targetScale = pixelPerfectPreviewScale(fitScale * nextZoom)
  const currentOriginX = (viewportSize.width - documentSize.width * currentScale) / 2 + pan.x
  const currentOriginY = (viewportSize.height - documentSize.height * currentScale) / 2 + pan.y
  const documentX = (pointer.x - currentOriginX) / currentScale
  const documentY = (pointer.y - currentOriginY) / currentScale
  return {
    x: pointer.x - (viewportSize.width - documentSize.width * targetScale) / 2 - documentX * targetScale,
    y: pointer.y - (viewportSize.height - documentSize.height * targetScale) / 2 - documentY * targetScale
  }
}
