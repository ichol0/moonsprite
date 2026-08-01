import { describe, expect, it } from 'vitest'
import { canvasCursors, canvasToolCursor, selectionPreviewPixels, transparencyColorAt } from './canvas-visuals'

describe('canvas visual rules', () => {
  it('chooses a visible cursor from the sampled canvas color', () => {
    expect(canvasToolCursor('pencil', { r: 0, g: 0, b: 0, a: 255 })).toBe(canvasCursors.pencilWhite)
    expect(canvasToolCursor('pencil', { r: 255, g: 255, b: 255, a: 255 })).toBe(canvasCursors.pencilBlack)
    expect(canvasToolCursor('rotate', { r: 0, g: 0, b: 0, a: 255 }, false)).toBe(canvasCursors.rotate)
  })

  it('uses stable checkerboard colors at the same pixel coordinates', () => {
    expect(transparencyColorAt(0, 0)).toEqual({ r: 215, g: 215, b: 217, a: 255 })
    expect(transparencyColorAt(16, 0)).toEqual({ r: 155, g: 155, b: 159, a: 255 })
    expect(transparencyColorAt(32, 0)).toEqual({ r: 215, g: 215, b: 217, a: 255 })
  })

  it('returns only the outer boundary for irregular masked selections', () => {
    const pixels = selectionPreviewPixels({ x: 3, y: 5, width: 2, height: 2, mask: Uint8Array.from([1, 1, 1, 0]) })
    expect([...pixels].sort()).toEqual(['3:5', '3:6', '4:5'])
  })
})
