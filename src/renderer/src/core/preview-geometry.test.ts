import { describe, expect, it } from 'vitest'
import { anchoredPreviewPan, pixelPerfectPreviewScale, previewCheckerCellSize } from './preview-geometry'

describe('preview zoom geometry', () => {
  it('quantizes preview scales to uniform pixel sizes', () => {
    expect(pixelPerfectPreviewScale(3.8)).toBe(4)
    expect(pixelPerfectPreviewScale(0.64)).toBe(0.5)
    expect(pixelPerfectPreviewScale(0.19)).toBeCloseTo(1 / 5)
  })

  it('keeps the document point under the pointer while zooming', () => {
    expect(anchoredPreviewPan({
      documentSize: { width: 100, height: 100 },
      viewportSize: { width: 200, height: 200 },
      pointer: { x: 150, y: 50 },
      pan: { x: 0, y: 0 },
      zoom: 1,
      nextZoom: 2
    })).toEqual({ x: -50, y: 50 })
  })

  it('preserves an existing preview pan while changing the scale anchor', () => {
    expect(anchoredPreviewPan({
      documentSize: { width: 100, height: 100 },
      viewportSize: { width: 200, height: 200 },
      pointer: { x: 140, y: 60 },
      pan: { x: 20, y: -10 },
      zoom: 1,
      nextZoom: 2
    })).toEqual({ x: 0, y: 20 })
  })

  it('matches the main canvas checkerboard rule at the final display scale', () => {
    expect(previewCheckerCellSize(8, 1)).toBe(8)
    expect(previewCheckerCellSize(8, 0.25)).toBe(2)
    expect(previewCheckerCellSize(8, 0.01)).toBeCloseTo(0.08)
  })
})
