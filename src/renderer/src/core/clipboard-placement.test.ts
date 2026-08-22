import { describe, expect, it } from 'vitest'
import { resolveClipboardPlacement } from './clipboard-placement'

const view = { zoom: 1, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false }

const place = (overrides: Partial<Parameters<typeof resolveClipboardPlacement>[0]> = {}) => resolveClipboardPlacement({
  width: 4,
  height: 4,
  documentWidth: 100,
  documentHeight: 100,
  viewportWidth: 20,
  viewportHeight: 20,
  view,
  rotationIndicatorPosition: 'view',
  ...overrides
})

describe('clipboard placement', () => {
  it('keeps a copied origin when its center remains visible', () => {
    expect(place({ originX: 43, originY: 45 })).toEqual({ x: 43, y: 45 })
  })

  it('recenters only the axis whose copied center is outside the viewport', () => {
    expect(place({ originX: 43, originY: 5 })).toEqual({ x: 43, y: 48 })
    expect(place({ originX: 5, originY: 45 })).toEqual({ x: 48, y: 45 })
  })

  it('recenters copied content that only overlaps the edge of the viewport', () => {
    expect(place({ originX: 58, originY: 45 })).toEqual({ x: 48, y: 45 })
  })

  it('centers an external image in the current visible canvas area', () => {
    expect(place({ width: 1, height: 1, view: { ...view, panX: 20, panY: 10 } })).toEqual({ x: 30, y: 40 })
    expect(place({ documentWidth: 20, documentHeight: 20, view: { ...view, panX: 8 } })).toEqual({ x: 4, y: 8 })
  })

  it('keeps at least one pixel of smaller pasted content inside the canvas', () => {
    expect(place({ documentWidth: 20, documentHeight: 20, viewportWidth: 10, viewportHeight: 10, originX: -4, originY: 8, view: { ...view, panX: 10 } })).toEqual({ x: -3, y: 8 })
  })

  it('anchors oversized content from the canvas origin while centering the remaining axis', () => {
    const input = { documentWidth: 20, documentHeight: 20, viewportWidth: 20, viewportHeight: 20 }
    expect(place({ ...input, width: 24, height: 4 })).toEqual({ x: 0, y: 8 })
    expect(place({ ...input, width: 4, height: 24 })).toEqual({ x: 8, y: 0 })
    expect(place({ ...input, width: 20, height: 4 })).toEqual({ x: 0, y: 8 })
  })
})
