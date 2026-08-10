import { describe, expect, it } from 'vitest'
import { selectionContains } from './selection'
import { moveSymmetryCenter, symmetryAxisSegment, symmetryPoints, symmetrySelection, transformSymmetrySelection, type SymmetryAxes } from './symmetry'

const axes = (values: Partial<SymmetryAxes>): SymmetryAxes => ({
  horizontal: false,
  vertical: false,
  diagonalUp: false,
  diagonalDown: false,
  ...values
})

describe('symmetry', () => {
  it('reflects points across each canvas-centered axis', () => {
    expect(symmetryPoints({ x: 1, y: 0 }, 6, 4, axes({ horizontal: true }))).toEqual([
      { x: 1, y: 0 },
      { x: 1, y: 3 }
    ])
    expect(symmetryPoints({ x: 1, y: 0 }, 6, 4, axes({ vertical: true }))).toEqual([
      { x: 1, y: 0 },
      { x: 4, y: 0 }
    ])
    expect(symmetryPoints({ x: 1, y: 0 }, 6, 4, axes({ diagonalDown: true }))).toEqual([
      { x: 1, y: 0 },
      { x: 1, y: 0 }
    ].filter((point, index, points) => points.findIndex((candidate) => candidate.x === point.x && candidate.y === point.y) === index))
    expect(symmetryPoints({ x: 2, y: 0 }, 6, 4, axes({ diagonalDown: true }))).toEqual([
      { x: 2, y: 0 },
      { x: 1, y: 1 }
    ])
    expect(symmetryPoints({ x: 1, y: 0 }, 6, 4, axes({ diagonalUp: true }))).toEqual([
      { x: 1, y: 0 },
      { x: 4, y: 3 }
    ])
  })

  it('computes the multi-axis closure and removes duplicate center pixels', () => {
    expect(symmetryPoints({ x: 0, y: 1 }, 5, 5, axes({ horizontal: true, vertical: true, diagonalDown: true }))).toEqual([
      { x: 0, y: 1 }, { x: 0, y: 3 }, { x: 4, y: 1 }, { x: 1, y: 0 },
      { x: 4, y: 3 }, { x: 3, y: 0 }, { x: 1, y: 4 }, { x: 3, y: 4 }
    ])
    expect(symmetryPoints({ x: 2, y: 2 }, 5, 5, axes({ horizontal: true, vertical: true, diagonalDown: true, diagonalUp: true }))).toEqual([{ x: 2, y: 2 }])
  })

  it('drops diagonal results outside a rectangular canvas', () => {
    expect(symmetryPoints({ x: 0, y: 0 }, 8, 2, axes({ diagonalDown: true }))).toEqual([{ x: 0, y: 0 }])
  })

  it('preserves mirrored transform previews outside the canvas when requested', () => {
    const transformed = transformSymmetrySelection(
      { x: 0, y: 1, width: 1, height: 1 },
      { x: -2, y: 1, width: 1, height: 1 },
      4,
      4,
      0,
      undefined,
      axes({ vertical: true }),
      undefined,
      false
    )

    expect(selectionContains(transformed, -2, 1)).toBe(true)
    expect(selectionContains(transformed, 5, 1)).toBe(true)
  })

  it('mirrors arbitrary selection masks with the same point mapping', () => {
    const selection = { x: 0, y: 0, width: 2, height: 2, mask: new Uint8Array([1, 0, 0, 1]) }
    const mirrored = symmetrySelection(selection, 4, 4, axes({ horizontal: true, vertical: true }))!
    expect([[0, 0], [1, 1], [3, 0], [2, 1], [0, 3], [1, 2], [3, 3], [2, 2]].every(([x, y]) => selectionContains(mirrored, x, y))).toBe(true)
    expect(Array.from(mirrored.mask ?? []).reduce((sum, value) => sum + value, 0)).toBe(8)
  })

  it('uses a movable half-pixel center for every reflection', () => {
    expect(symmetryPoints({ x: 0, y: 0 }, 6, 4, axes({ vertical: true }), { x: 2, y: 2 })).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 }
    ])
    expect(moveSymmetryCenter({ x: 3, y: 2 }, 'horizontal', { x: 5, y: 1.4 }, 6, 4)).toEqual({ x: 3, y: 1.5 })
    expect(moveSymmetryCenter({ x: 3, y: 2 }, 'vertical', { x: 4.4, y: 0 }, 6, 4)).toEqual({ x: 4.5, y: 2 })
    expect(moveSymmetryCenter({ x: 3, y: 2 }, 'diagonalDown', { x: 4, y: 2 }, 6, 4)).toEqual({ x: 3.5, y: 1.5 })
    expect(moveSymmetryCenter({ x: 3, y: 2 }, 'diagonalUp', { x: 4, y: 2 }, 6, 4)).toEqual({ x: 3.5, y: 2.5 })
  })

  it('clips all four axis segments to the canvas', () => {
    expect(symmetryAxisSegment('horizontal', 6, 4, { x: 3, y: 2 })).toEqual({ start: { x: 0, y: 2 }, end: { x: 6, y: 2 } })
    expect(symmetryAxisSegment('vertical', 6, 4, { x: 3, y: 2 })).toEqual({ start: { x: 3, y: 0 }, end: { x: 3, y: 4 } })
    expect(symmetryAxisSegment('diagonalDown', 6, 4, { x: 3, y: 2 })).toEqual({ start: { x: 1, y: 0 }, end: { x: 5, y: 4 } })
    expect(symmetryAxisSegment('diagonalUp', 6, 4, { x: 3, y: 2 })).toEqual({ start: { x: 1, y: 4 }, end: { x: 5, y: 0 } })
  })
})
