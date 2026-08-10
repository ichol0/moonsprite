import { describe, expect, it } from 'vitest'
import { resolveClipboardPlacement } from './clipboard-placement'

const view = { zoom: 10, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false }

describe('clipboard placement', () => {
  it('keeps a copied origin that remains visible', () => {
    expect(resolveClipboardPlacement({ width: 4, height: 4, originX: 8, originY: 6, documentWidth: 20, documentHeight: 20, viewportWidth: 200, viewportHeight: 200, view, rotationIndicatorPosition: 'view' })).toEqual({ x: 8, y: 6 })
  })

  it('centers content on the document when its origin is outside the visible view', () => {
    expect(resolveClipboardPlacement({ width: 4, height: 2, originX: 100, originY: 100, documentWidth: 20, documentHeight: 20, viewportWidth: 200, viewportHeight: 200, view, rotationIndicatorPosition: 'view' })).toEqual({ x: 8, y: 9 })
  })

  it('uses the document center regardless of the current pan', () => {
    expect(resolveClipboardPlacement({ width: 4, height: 4, documentWidth: 20, documentHeight: 20, viewportWidth: 100, viewportHeight: 100, view: { ...view, panX: -50 }, rotationIndicatorPosition: 'view' })).toEqual({ x: 8, y: 8 })
  })

  it('uses the document top-left when centered content would exceed the document', () => {
    expect(resolveClipboardPlacement({ width: 24, height: 4, documentWidth: 20, documentHeight: 20, viewportWidth: 100, viewportHeight: 100, view, rotationIndicatorPosition: 'view' })).toEqual({ x: 0, y: 0 })
    expect(resolveClipboardPlacement({ width: 4, height: 24, documentWidth: 20, documentHeight: 20, viewportWidth: 100, viewportHeight: 100, view, rotationIndicatorPosition: 'view' })).toEqual({ x: 0, y: 0 })
  })
})
