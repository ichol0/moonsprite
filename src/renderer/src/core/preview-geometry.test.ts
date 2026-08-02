import { describe, expect, it } from 'vitest'
import { anchoredPreviewPan } from './preview-geometry'

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
})
