import { describe, expect, it } from 'vitest'
import { ellipseSelection, invertSelectionMask, rasterLinePoints, remapTransformedSelectionPoint, rotateSelectionTargetAroundPivot, rotatedEllipseSelection, rotatedRectSelection, selectionContains, shearTransformedSelection, transformedSelectionBounds, transformedSelectionCenter, transformedSelectionControlPoints, transformedSelectionPivotPreset, transformedSelectionShearDirection, transformSelectionMask } from './selection'

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

  it('trims empty padding around a rotated masked selection', () => {
    const source = ellipseSelection(4, 5, 8, 4)!
    const rotated = transformSelectionMask(source, source, 20, 20, 45, undefined, false)!
    const hasSelectedPixel = (offsets: number[]): boolean => offsets.some((offset) => rotated.mask?.[offset] === 1)

    expect(hasSelectedPixel(Array.from({ length: rotated.width }, (_, x) => x))).toBe(true)
    expect(hasSelectedPixel(Array.from({ length: rotated.width }, (_, x) => (rotated.height - 1) * rotated.width + x))).toBe(true)
    expect(hasSelectedPixel(Array.from({ length: rotated.height }, (_, y) => y * rotated.width))).toBe(true)
    expect(hasSelectedPixel(Array.from({ length: rotated.height }, (_, y) => y * rotated.width + rotated.width - 1))).toBe(true)
  })

  it('rotates all eight transform control points around the selection center', () => {
    expect(transformedSelectionControlPoints({ x: 2, y: 3, width: 4, height: 2 }, 90)).toEqual([
      { x: 5, y: 2 }, { x: 5, y: 4 }, { x: 5, y: 6 },
      { x: 4, y: 2 }, { x: 4, y: 6 },
      { x: 3, y: 2 }, { x: 3, y: 4 }, { x: 3, y: 6 }
    ])
  })

  it('remaps the selection pivot with normal scaling, shear, and cross-boundary flips', () => {
    expect(remapTransformedSelectionPoint(
      { x: 2, y: 4, width: 4, height: 2 },
      { x: 2, y: 4, width: 8, height: 6 },
      { x: 3, y: 5 }
    )).toEqual({ x: 4, y: 7 })

    const source = { x: 0, y: 0, width: 8, height: 6 }
    const destination = { x: 1, y: 2, width: 12, height: 9 }
    const shear = { axis: 'x' as const, edge: 's' as const, amount: 3 }
    const sourcePoint = transformedSelectionControlPoints(source, 37, shear)[1]
    const expectedPoint = transformedSelectionControlPoints(destination, 37, shear)[1]
    const remappedPoint = remapTransformedSelectionPoint(source, destination, sourcePoint, 37, shear)
    expect(remappedPoint.x).toBeCloseTo(expectedPoint.x)
    expect(remappedPoint.y).toBeCloseTo(expectedPoint.y)

    expect(remapTransformedSelectionPoint(
      { x: 0, y: 0, width: 10, height: 10 },
      { x: -5, y: 0, width: 5, height: 10, flipHorizontal: true },
      { x: 0, y: 5 }
    )).toEqual({ x: 0, y: 5 })
  })

  it('resolves all nine pivot presets from the transformed selection geometry', () => {
    const target = { x: 0, y: 0, width: 4, height: 4 }
    const shear = { axis: 'x' as const, edge: 's' as const, amount: 4 }
    const expected = {
      nw: { x: 3.5, y: 1 }, n: { x: 3.5, y: 3 }, ne: { x: 3.5, y: 4 },
      w: { x: 1.5, y: 3 }, center: { x: 1.5, y: 5 }, e: { x: 1.5, y: 6 },
      sw: { x: 0.5, y: 4 }, s: { x: 0.5, y: 6 }, se: { x: 0.5, y: 7 }
    } as const

    for (const [preset, point] of Object.entries(expected)) {
      expect(transformedSelectionPivotPreset(target, preset as keyof typeof expected, 90, shear)).toEqual(point)
    }
  })

  it('places every pivot preset at a document pixel center', () => {
    const target = { x: 4, y: 7, width: 1, height: 1 }
    for (const preset of ['nw', 'n', 'ne', 'w', 'center', 'e', 'sw', 's', 'se'] as const) {
      expect(transformedSelectionPivotPreset(target, preset)).toEqual({ x: 4.5, y: 7.5 })
    }
  })

  it('keeps a sheared selection centered while rotating around its visible center', () => {
    const target = { x: 0, y: 0, width: 4, height: 4 }
    const shear = { axis: 'x' as const, edge: 's' as const, amount: 4 }
    const pivot = transformedSelectionCenter(target, 0, shear)
    const rotatedTarget = rotateSelectionTargetAroundPivot(target, pivot, 90)

    expect(pivot).toEqual({ x: 4, y: 2 })
    expect(rotatedTarget).toEqual({ x: 2, y: -2, width: 4, height: 4 })
    expect(transformedSelectionCenter(rotatedTarget, 90, shear)).toEqual(pivot)
  })

  it('moves the transform target center around a custom rotation pivot', () => {
    const target = { x: 2, y: 4, width: 4, height: 2, flipHorizontal: true, flipOriginX: 2 }

    expect(rotateSelectionTargetAroundPivot(target, { x: 0, y: 0 }, 90)).toEqual({
      x: -7,
      y: 3,
      width: 4,
      height: 2,
      flipHorizontal: true,
      flipOriginX: -7
    })
  })

  it('keeps the first sheared edge when another edge is sheared', () => {
    const start = { x: 2, y: 2, width: 4, height: 4 }
    const first = shearTransformedSelection(start, 0, undefined, 'n', 2)
    const second = shearTransformedSelection(first.target, first.angle, first.shear, 'e', -2)
    const points = transformedSelectionControlPoints(second.target, second.angle, second.shear)

    expect([points[0], points[2], points[5], points[7]]).toEqual([
      { x: 4, y: 2 },
      { x: 8, y: 0 },
      { x: 2, y: 6 },
      { x: 6, y: 4 }
    ])
    expect(transformedSelectionBounds(second.target, second.angle, second.shear)).toEqual({ x: 2, y: 0, width: 6, height: 6 })
  })

  it('keeps the local transform direction while continuing a single-axis shear', () => {
    const start = { x: 2, y: 2, width: 4, height: 4 }
    const first = shearTransformedSelection(start, 0, undefined, 'e', 2)
    const second = shearTransformedSelection(first.target, first.angle, first.shear, 'e', 1)

    expect(first).toEqual({ target: start, angle: 0, shear: { axis: 'y', edge: 'e', amount: 2 } })
    expect(second).toEqual({ target: start, angle: 0, shear: { axis: 'y', edge: 'e', amount: 3 } })
  })

  it('keeps the selection pivot fixed while shearing', () => {
    const start = { x: 0, y: 0, width: 4, height: 4 }
    const pivot = { x: 2, y: 2 }
    const transformed = shearTransformedSelection(start, 0, undefined, 'n', 2, pivot)
    const points = transformedSelectionControlPoints(transformed.target, transformed.angle, transformed.shear)

    expect([points[0], points[2], points[5], points[7]]).toEqual([
      { x: 2, y: 0 },
      { x: 6, y: 0 },
      { x: -2, y: 4 },
      { x: 2, y: 4 }
    ])
    expect(transformedSelectionCenter(transformed.target, transformed.angle, transformed.shear)).toEqual(pivot)
  })

  it('continues a second shear along the current slanted edge', () => {
    const start = { x: 2, y: 2, width: 4, height: 4 }
    const pivot = { x: 4, y: 4 }
    const first = shearTransformedSelection(start, 0, undefined, 'n', 1.5, pivot)
    const direction = transformedSelectionShearDirection(first.target, first.angle, first.shear, 'e')
    const second = shearTransformedSelection(first.target, first.angle, first.shear, 'e', 2.5, pivot)
    const points = transformedSelectionControlPoints(second.target, second.angle, second.shear)

    expect(direction?.x).toBeCloseTo(-0.6)
    expect(direction?.y).toBeCloseTo(0.8)
    const corners = [points[0], points[2], points[5], points[7]]
    const expectedCorners = [
      { x: 5, y: 0 },
      { x: 6, y: 4 },
      { x: 2, y: 4 },
      { x: 3, y: 8 }
    ]
    for (let index = 0; index < corners.length; index += 1) {
      expect(corners[index].x).toBeCloseTo(expectedCorners[index].x)
      expect(corners[index].y).toBeCloseTo(expectedCorners[index].y)
    }
    expect(transformedSelectionCenter(second.target, second.angle, second.shear)).toEqual(pivot)
  })

  it('rasterizes rotated ellipses directly in rotated pixel space', () => {
    const target = { x: 8, y: 9, width: 9, height: 5 }
    expect(rotatedEllipseSelection(target, 40, 40, 0)).toEqual(ellipseSelection(target.x, target.y, target.width, target.height))

    const quarterTurn = rotatedEllipseSelection(target, 40, 40, 90)
    expect(quarterTurn).toMatchObject({ x: 10, y: 7, width: 5, height: 9 })
    expect(quarterTurn?.mask).toEqual(ellipseSelection(10, 7, 5, 9).mask)

    const diagonal = rotatedEllipseSelection(target, 40, 40, 37)
    expect(diagonal).not.toBeNull()
    const boundarySelected = (offsets: number[]): boolean => offsets.some((offset) => diagonal!.mask?.[offset] === 1)
    expect(boundarySelected(Array.from({ length: diagonal!.width }, (_, x) => x))).toBe(true)
    expect(boundarySelected(Array.from({ length: diagonal!.width }, (_, x) => (diagonal!.height - 1) * diagonal!.width + x))).toBe(true)
    expect(boundarySelected(Array.from({ length: diagonal!.height }, (_, y) => y * diagonal!.width))).toBe(true)
    expect(boundarySelected(Array.from({ length: diagonal!.height }, (_, y) => y * diagonal!.width + diagonal!.width - 1))).toBe(true)
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

  it('rasterizes rounded rectangle selections with clamped radii', () => {
    const target = { x: 4, y: 5, width: 8, height: 6 }
    const square = rotatedRectSelection(target, 32, 32, 0, true, 0)
    const rounded = rotatedRectSelection(target, 32, 32, 0, true, 3)
    const clamped = rotatedRectSelection(target, 32, 32, 0, true, 99)

    expect(square).toEqual(target)
    expect(rounded).not.toBeNull()
    expect(selectionContains(rounded, target.x, target.y)).toBe(false)
    expect(selectionContains(rounded, target.x + Math.floor(target.width / 2), target.y)).toBe(true)
    expect(selectionContains(rounded, target.x, target.y + Math.floor(target.height / 2))).toBe(true)
    expect(selectionContains(rounded, target.x + target.width - 1, target.y + target.height - 1)).toBe(false)
    expect(clamped).toEqual(rounded)
  })

  it('keeps rounded corners in local space when rotating a selection', () => {
    const target = { x: 4, y: 5, width: 8, height: 6 }
    const rounded = rotatedRectSelection(target, 32, 32, 0, true, 3)!
    const quarterTurn = rotatedRectSelection(target, 32, 32, 90, true, 3)!
    const selectedCount = (selection: NonNullable<typeof rounded>): number => selection.mask
      ? selection.mask.reduce((count, value) => count + value, 0)
      : selection.width * selection.height

    expect(selectedCount(quarterTurn)).toBe(selectedCount(rounded))
    expect(selectionContains(quarterTurn, quarterTurn.x, quarterTurn.y)).toBe(false)
    expect(selectionContains(quarterTurn, quarterTurn.x + Math.floor(quarterTurn.width / 2), quarterTurn.y)).toBe(true)
  })
})
