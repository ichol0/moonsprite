import { describe, expect, it } from 'vitest'
import { invertSelectionMask, rasterLinePoints, selectionContains, transformSelectionMask } from './selection'

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
})
