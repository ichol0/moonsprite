import { describe, expect, it } from 'vitest'
import { anchoredPreviewPan, followPreviewPosition, previewCheckerCellSize } from './preview-geometry'

describe('preview zoom geometry', () => {
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

describe('preview position following', () => {
  const sourceView = { zoom: 8, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false }

  it('keeps an independently scaled preview centered on the canvas view position', () => {
    expect(followPreviewPosition({
      documentSize: { width: 100, height: 50 },
      sourceViewportSize: { width: 800, height: 600 },
      previewViewportSize: { width: 500, height: 250 },
      previewScale: 5,
      sourceView,
      rotationIndicatorPosition: 'view'
    })).toEqual({ x: 0, y: 0 })
  })

  it('maps the canvas center position without copying its zoom', () => {
    expect(followPreviewPosition({
      documentSize: { width: 100, height: 50 },
      sourceViewportSize: { width: 800, height: 600 },
      previewViewportSize: { width: 240, height: 140 },
      previewScale: 2,
      sourceView: { ...sourceView, zoom: 16, panX: 80, panY: -40 },
      rotationIndicatorPosition: 'view'
    })).toEqual({ x: 10, y: -5 })
  })

  it('falls back to the preview center before the canvas viewport is measured', () => {
    expect(followPreviewPosition({
      documentSize: { width: 100, height: 50 },
      sourceViewportSize: { width: 0, height: 0 },
      previewViewportSize: { width: 200, height: 100 },
      previewScale: 2,
      sourceView,
      rotationIndicatorPosition: 'view'
    })).toEqual({ x: 0, y: 0 })
  })

  it('stops followed content at the preview edges without exposing extra empty space', () => {
    expect(followPreviewPosition({
      documentSize: { width: 100, height: 50 },
      sourceViewportSize: { width: 800, height: 600 },
      previewViewportSize: { width: 240, height: 140 },
      previewScale: 2,
      sourceView: { ...sourceView, zoom: 16, panX: 800, panY: 800 },
      rotationIndicatorPosition: 'view'
    })).toEqual({ x: 20, y: 20 })
  })
})
