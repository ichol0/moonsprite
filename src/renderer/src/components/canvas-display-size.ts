export function syncCanvasDisplaySize(canvas: HTMLCanvasElement, width: number, height: number, dpr: number, cssWidth = width, cssHeight = height): void {
  const displayWidth = Math.max(0, width)
  const displayHeight = Math.max(0, height)
  const renderedCssWidth = Math.max(0, cssWidth)
  const renderedCssHeight = Math.max(0, cssHeight)
  const pixelRatio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1
  const cssWidthValue = `${renderedCssWidth}px`
  const cssHeightValue = `${renderedCssHeight}px`

  // Keep the last rendered CSS size fixed until the next draw. Otherwise a
  // percentage-sized canvas stretches its previous bitmap while a pane resizes.
  if (canvas.style.width !== cssWidthValue) canvas.style.width = cssWidthValue
  if (canvas.style.height !== cssHeightValue) canvas.style.height = cssHeightValue

  const backingWidth = Math.max(1, Math.round(displayWidth * pixelRatio))
  const backingHeight = Math.max(1, Math.round(displayHeight * pixelRatio))
  if (canvas.width !== backingWidth) canvas.width = backingWidth
  if (canvas.height !== backingHeight) canvas.height = backingHeight
}
