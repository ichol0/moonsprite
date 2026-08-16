import { describe, expect, it } from 'vitest'
import { canvasCursors, canvasStatusTextColor, canvasToolCursor, selectionCornerResizeCursorForPoints, selectionCreationCursor, selectionCursorCornerRects, selectionPathPreviewPixelVisible, selectionPreviewPixels, selectionResizeCursorForDirection, selectionResizeCursorForHandle, selectionRotationCursorForPosition, selectionShearCursorForDirection, selectionTransformDragCursor, transparencyColorAt } from './canvas-visuals'

describe('canvas visual rules', () => {
  it('chooses rotation cursors from the displayed corner position', () => {
    const center = { x: 100, y: 100 }
    expect(selectionRotationCursorForPosition({ x: 80, y: 80 }, center)).toBe('rotate-nw')
    expect(selectionRotationCursorForPosition({ x: 120, y: 80 }, center)).toBe('rotate-ne')
    expect(selectionRotationCursorForPosition({ x: 100, y: 80 }, center)).toBe('rotate-n')
    expect(selectionRotationCursorForPosition({ x: 120, y: 120 }, center)).toBe('rotate-se')
    expect(selectionRotationCursorForPosition({ x: 100, y: 120 }, center)).toBe('rotate-s')
    expect(selectionRotationCursorForPosition({ x: 80, y: 120 }, center)).toBe('rotate-sw')
  })

  it('chooses horizontal, vertical, and diagonal shear cursors from the current edge direction', () => {
    expect(selectionShearCursorForDirection({ x: 1, y: 0 })).toBe('horizontal')
    expect(selectionShearCursorForDirection({ x: 0, y: 1 })).toBe('vertical')
    expect(selectionShearCursorForDirection({ x: 1, y: 1 })).toBe('nwse')
    expect(selectionShearCursorForDirection({ x: 1, y: -1 })).toBe('nesw')
    expect(selectionShearCursorForDirection({ x: 481, y: -210 })).toBe('nesw')
    expect(selectionShearCursorForDirection({ x: -481, y: 210 })).toBe('nesw')
    expect(selectionShearCursorForDirection({ x: 238, y: 359 })).toBe('nwse')
    expect(selectionShearCursorForDirection({ x: -238, y: -359 })).toBe('nwse')
    expect(selectionShearCursorForDirection({ x: 1, y: 10 })).toBe('vertical')
    expect(selectionShearCursorForDirection({ x: -1, y: 10 })).toBe('vertical')
    expect(selectionShearCursorForDirection({ x: 10, y: 1 })).toBe('horizontal')
    expect(selectionShearCursorForDirection({ x: 10, y: -1 })).toBe('horizontal')
  })

  it('rotates selection resize cursors with the selection and displayed canvas', () => {
    expect(selectionResizeCursorForHandle('n')).toBe('vertical')
    expect(selectionResizeCursorForHandle('e')).toBe('horizontal')
    expect(selectionResizeCursorForHandle('n', 0, 45)).toBe('nesw')
    expect((['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'] as const).map((handle) => selectionResizeCursorForHandle(handle, 0, 90))).toEqual([
      'nesw', 'horizontal', 'nwse', 'vertical', 'vertical', 'nwse', 'horizontal', 'nesw'
    ])
    expect(selectionResizeCursorForHandle('n', 45, 45)).toBe('horizontal')
    expect(selectionResizeCursorForHandle('nw', 0, 0, true)).toBe('nesw')
  })

  it('chooses corner resize cursors from the displayed diagonal direction', () => {
    expect(selectionResizeCursorForDirection({ x: 8, y: 8 })).toBe('nwse')
    expect(selectionResizeCursorForDirection({ x: 8, y: -8 })).toBe('nesw')
    expect(selectionResizeCursorForDirection({ x: 12, y: 2 })).toBe('horizontal')
    expect(selectionResizeCursorForDirection({ x: 2, y: 12 })).toBe('vertical')

    const shearedPoints = [
      { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 },
      { x: 4, y: 2 }, { x: 8, y: 2 },
      { x: 8, y: 4 }, { x: 10, y: 4 }, { x: 12, y: 4 }
    ]
    expect(selectionCornerResizeCursorForPoints('nw', shearedPoints)).toBe('horizontal')
    expect(selectionCornerResizeCursorForPoints('ne', shearedPoints)).toBe('nwse')
    expect(selectionCornerResizeCursorForPoints('n', shearedPoints)).toBeNull()
  })

  it('chooses a visible cursor from the sampled canvas color', () => {
    expect(canvasToolCursor('pencil', { r: 0, g: 0, b: 0, a: 255 })).toBe(canvasCursors.pencilWhite)
    expect(canvasToolCursor('pencil', { r: 255, g: 255, b: 255, a: 255 })).toBe(canvasCursors.pencilBlack)
    expect(canvasToolCursor('airbrush', { r: 0, g: 0, b: 0, a: 255 })).toBe(canvasCursors.pencilWhite)
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
    expect(canvasStatusTextColor([{ r: 18, g: 20, b: 24, a: 255 }, { r: 70, g: 72, b: 76, a: 255 }], 'dark', 'light')).toBe('light')
    expect(canvasStatusTextColor([{ r: 245, g: 245, b: 245, a: 255 }, { r: 210, g: 214, b: 220, a: 255 }], 'dark', 'light')).toBe('dark')
  })

  it('places compact selection marks at all four corners of the current pixel', () => {
    const marks = selectionCursorCornerRects({ x: 10, y: 20, width: 16, height: 16 }, 2)
    expect(marks).toHaveLength(8)
    expect(marks[0]).toEqual({ x: 10, y: 20, width: 4, height: 1 })
    expect(marks.at(-1)).toEqual({ x: 25, y: 32, width: 1, height: 4 })
  })

  it('keeps selection marks at least 8 CSS pixels wide with a fixed line width', () => {
    const marks = selectionCursorCornerRects({ x: 10, y: 20, width: 2, height: 3 }, 2)
    expect(Math.min(...marks.map((mark) => mark.x))).toBe(7)
    expect(Math.max(...marks.map((mark) => mark.x + mark.width))).toBe(15)
    expect(Math.min(...marks.map((mark) => mark.y))).toBe(17.5)
    expect(Math.max(...marks.map((mark) => mark.y + mark.height))).toBe(25.5)
    expect(marks.every((mark) => mark.width === 1 || mark.height === 1)).toBe(true)
  })

  it('uses the move cursor while dragging a selection transform', () => {
    expect(selectionTransformDragCursor('transform-content')).toBe(canvasCursors.move)
    expect(selectionTransformDragCursor('rotate-content')).toBe(canvasCursors.move)
    expect(selectionTransformDragCursor('shear-content')).toBe(canvasCursors.move)
    expect(selectionTransformDragCursor('marquee')).toBeNull()
  })

  it('clips selection creation preview pixels to the document', () => {
    const pixelRect = { x: 12, y: 20, width: 8, height: 8 }
    expect(selectionPathPreviewPixelVisible(pixelRect, 100, 80, false)).toBe(false)
    expect(selectionPathPreviewPixelVisible({ ...pixelRect, x: 120 }, 100, 80, true)).toBe(false)
    expect(selectionPathPreviewPixelVisible(pixelRect, 100, 80, true)).toBe(true)
  })

  it('uses only corner marks by default and an actual crosshair when requested', () => {
    expect(selectionCreationCursor(false)).toBe('none')
    expect(selectionCreationCursor(true)).toBe(canvasCursors.crosshair)
    expect(selectionCreationCursor(false, false)).toBe(canvasCursors.unavailable)
  })

  it('returns only the outer boundary for irregular masked selections', () => {
    const pixels = selectionPreviewPixels({ x: 3, y: 5, width: 2, height: 2, mask: Uint8Array.from([1, 1, 1, 0]) })
    expect([...pixels].sort()).toEqual(['3:5', '3:6', '4:5'])
  })
})
