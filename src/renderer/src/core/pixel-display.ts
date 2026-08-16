export type PixelSamplingMode = 'hard' | 'smooth'

/** Integer magnification keeps every source pixel on an even display grid.
 * Fractional magnification produces uneven nearest-neighbour columns, while
 * downscaling necessarily drops source pixels, so both use smooth sampling.
 */
export const pixelSamplingMode = (displayScale: number): PixelSamplingMode => {
  if (!Number.isFinite(displayScale) || displayScale < 1) return 'smooth'
  return Math.abs(displayScale - Math.round(displayScale)) < 0.000001 ? 'hard' : 'smooth'
}
