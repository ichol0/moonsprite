import { describe, expect, it } from 'vitest'
import { ellipseSelection, invertSelectionMask, rasterLinePoints, rotatedEllipseSelection, rotatedRectSelection, selectionContains, transformedSelectionControlPoints, transformSelectionMask } from './selection'

describe('selection preview geometry', () => {
  it('terminates at the requested endpoint for uneven diagonal segments', () => {
    const points = rasterLinePoints({ x: 1, y: 1 }, { x: 9, y: 3 })
    expect(points[0]).toEqual({ x: 1, y: 1 })
    expect(points.at(-1)).toEqual({ x: 9, y: 3 })
    expect(points).toHaveLength(9)
  })

  it('supports vertical and reverse segments', () => {
    expect(rasterLinePoints({ x: 4, y: 5 }, { x: 4, y: 2 })).toEqual([
      { x: 4, y: 5 }, { x: 4, y: 4 }, { x: 4, y: 3 }, { x: 4, y: 2 }
    ])
  })

  it('inverts an irregular selection across the complete canvas', () => {
    const inverted = invertSelectionMask({ x: 1, y: 0, width: 2, height: 2, mask: Uint8Array.from([1, 0, 0, 1]) }, 4, 3)

    expect(inverted).not.toBeNull()
    expect(selectionContains(inverted, 1, 0)).toBe(false)
    expect(selectionContains(inverted, 2, 1)).toBe(false)
    expect(selectionContains(inverted, 0, 0)).toBe(true)
    expect(selectionContains(inverted, 3, 2)).toBe(true)
  })

  it('preserves transformed selection bounds and masks outside the canvas', () => {
    const rectangle = transformSelectionMask(
      { x: 1, y: 1, width: 2, height: 2 },
      { x: -3, y: 4, width: 7, height: 5 },
      6,
      6,
      0,
      undefined,
      false
    )
    expect(rectangle).toEqual({ x: -3, y: 4, width: 7, height: 5 })

    const irregular = transformSelectionMask(
      { x: 1, y: 1, width: 2, height: 2, mask: Uint8Array.from([1, 0, 0, 1]) },
      { x: -2, y: -1, width: 2, height: 2 },
      6,
      6,
      0,
      undefined,
      false
    )
    expect(irregular).toMatchObject({ x: -2, y: -1, width: 2, height: 2 })
    expect(selectionContains(irregular, -2, -1)).toBe(true)
    expect(selectionContains(irregular, -1, 0)).toBe(true)
  })

  it('does not drop sparse masked pixels during diagonal rotation', () => {
    const source = { x: 2, y: 2, width: 2, height: 2, mask: Uint8Array.from([1, 0, 0, 1]) }
    const rotated = transformSelectionMask(source, source, 8, 8, 45, undefined, false)

    expect(selectionContains(rotated, 3, 2)).toBe(true)
    expect(selectionContains(rotated, 3, 3)).toBe(true)
  })

  it('rotates all eight transform control points around the selection center', () => {
    expect(transformedSelectionControlPoints({ x: 2, y: 3, width: 4, height: 2 }, 90)).toEqual([
      { x: 5, y: 2 }, { x: 5, y: 4 }, { x: 5, y: 6 },
      { x: 4, y: 2 }, { x: 4, y: 6 },
      { x: 3, y: 2 }, { x: 3, y: 4 }, { x: 3, y: 6 }
    ])
  })

  it('rasterizes rotated ellipses directly in rotated pixel space', () => {
    const target = { x: 8, y: 9, width: 9, height: 5 }
    expect(rotatedEllipseSelection(target, 40, 40, 0)).toEqual(ellipseSelection(target.x, target.y, target.width, target.height))

    const quarterTurn = rotatedEllipseSelection(target, 40, 40, 90)
    expect(quarterTurn).toMatchObject({ x: 10, y: 7, width: 5, height: 9 })
    expect(quarterTurn?.mask).toEqual(ellipseSelection(10, 7, 5, 9).mask)

    const diagonal = rotatedEllipseSelection(target, 40, 40, 37)
    expect(diagonal).not.toBeNull()
    for (let row = 0; row < (diagonal?.height ?? 0); row += 1) {
      const selectedColumns = Array.from({ length: diagonal!.width }, (_, column) => column)
        .filter((column) => diagonal!.mask?.[row * diagonal!.width + column] === 1)
      if (selectedColumns.length === 0) continue
      expect(selectedColumns.at(-1)! - selectedColumns[0] + 1).toBe(selectedColumns.length)
    }
  })

  it('removes single-pixel corner tips from rotated rectangle rasterization', () => {
    const rotated = rotatedRectSelection({ x: 4, y: 5, width: 12, height: 8 }, 32, 32, 37)
    expect(rotated).not.toBeNull()
    for (let offsetY = 0; offsetY < rotated!.height; offsetY += 1) {
      for (let offsetX = 0; offsetX < rotated!.width; offsetX += 1) {
        const index = offsetY * rotated!.width + offsetX
        if (rotated!.mask?.[index] !== 1) continue
        const neighbors = Number(offsetX > 0 && rotated!.mask[index - 1] === 1)
          + Number(offsetX + 1 < rotated!.width && rotated!.mask[index + 1] === 1)
          + Number(offsetY > 0 && rotated!.mask[index - rotated!.width] === 1)
          + Number(offsetY + 1 < rotated!.height && rotated!.mask[index + rotated!.width] === 1)
        expect(neighbors).toBeGreaterThanOrEqual(2)
      }
    }
  })
})
