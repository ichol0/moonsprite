import { describe, expect, it } from 'vitest'
import { canvasCursors, canvasStatusTextColor, canvasToolCursor, selectionPreviewPixels, selectionTransformDragCursor, transparencyColorAt } from './canvas-visuals'

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
    const custom = { size: 4 as const, lightColor: { r: 1, g: 2, b: 3, a: 255 }, darkColor: { r: 4, g: 5, b: 6, a: 255 } }
    expect(transparencyColorAt(3, 0, custom)).toEqual(custom.lightColor)
    expect(transparencyColorAt(4, 0, custom)).toEqual(custom.darkColor)
  })

  it('uses one contrasting color for all canvas status labels', () => {
    expect(canvasStatusTextColor([{ r: 18, g: 20, b: 24, a: 255 }, { r: 70, g: 72, b: 76, a: 255 }])).toBe('#f1f4f8')
    expect(canvasStatusTextColor([{ r: 245, g: 245, b: 245, a: 255 }, { r: 210, g: 214, b: 220, a: 255 }])).toBe('#111318')
  })

  it('uses the move cursor while dragging a selection transform', () => {
    expect(selectionTransformDragCursor('transform-content')).toBe(canvasCursors.move)
    expect(selectionTransformDragCursor('rotate-content')).toBe(canvasCursors.move)
    expect(selectionTransformDragCursor('marquee')).toBeNull()
  })

  it('returns only the outer boundary for irregular masked selections', () => {
    const pixels = selectionPreviewPixels({ x: 3, y: 5, width: 2, height: 2, mask: Uint8Array.from([1, 1, 1, 0]) })
    expect([...pixels].sort()).toEqual(['3:5', '3:6', '4:5'])
  })
})
