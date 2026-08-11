const RELATIVE_MAGNIFICATION = 1.5

export const eyedropperMagnifierPixelScale = (viewZoom: number, lensSize = 204, baselinePixelCount = 17): number => {
  const baselineScale = lensSize / baselinePixelCount
  const safeZoom = Number.isFinite(viewZoom) ? Math.max(0, viewZoom) : 0
  return Math.max(baselineScale, safeZoom * RELATIVE_MAGNIFICATION)
}
