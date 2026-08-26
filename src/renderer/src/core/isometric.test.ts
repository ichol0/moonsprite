import { describe, expect, it } from 'vitest'
import { balancedStairLinePoints } from './pixel-line'
import { advanceIsoAlignedStrokeSegment, ISO_GUIDE_BASE_SPACING, isoGridLineEndpoint, isoGridLineSegment, isoGuidePixelPattern, isoGuideSegments, isoGuideSpacingForZoom, isoLineEndpoint, snapIsoPointToGridVertex, traceIsoGridPointerEdges, updateIsoAlignedStrokePath, type IsoAlignedStrokeSegmentState } from './isometric'

const runLengths = (points: Array<{ x: number; y: number }>, major: 'x' | 'y'): number[] => {
  const minor = major === 'x' ? 'y' : 'x'
  const runs: number[] = []
  for (const point of points) {
    const previous = points[runs.reduce((total, length) => total + length, 0) - 1]
    if (!previous || point[minor] !== previous[minor]) runs.push(1)
    else runs[runs.length - 1] += 1
  }
  return runs
}

describe('ISO view geometry', () => {
  it('constrains lines to the configured isometric stair or a cardinal direction', () => {
    const diagonalEnd = isoLineEndpoint({ x: 2, y: 3 }, { x: 13, y: 8 })
    const diagonal = balancedStairLinePoints({ x: 2, y: 3 }, diagonalEnd)
    expect(runLengths(diagonal, 'x')).toEqual(new Array(6).fill(2))

    const threeStepEnd = isoLineEndpoint({ x: 2, y: 3 }, { x: 20, y: 9 }, 3)
    const threeStepDiagonal = balancedStairLinePoints({ x: 2, y: 3 }, threeStepEnd)
    expect(runLengths(threeStepDiagonal, 'x')).toEqual(new Array(6).fill(3))

    expect(isoLineEndpoint({ x: 4, y: 4 }, { x: 4, y: 18 })).toEqual({ x: 4, y: 18 })
    expect(isoLineEndpoint({ x: 4, y: 4 }, { x: 18, y: 4 })).toEqual({ x: 18, y: 4 })
    expect(isoLineEndpoint({ x: 0, y: 0 }, { x: 3, y: 12 })).toEqual({ x: 0, y: 12 })
  })

  it('keeps the active ISO segment anchored while its direction stays the same', () => {
    const start: IsoAlignedStrokeSegmentState = { anchor: { x: 0, y: 0 }, endpoint: { x: 0, y: 0 }, direction: null }
    const first = advanceIsoAlignedStrokeSegment(start, { x: 10, y: -5 })
    const extended = advanceIsoAlignedStrokeSegment(first, { x: 18, y: -9 })

    expect(first).toMatchObject({ anchor: { x: 0, y: 0 }, endpoint: { x: 11, y: -5 }, direction: 'up-right' })
    expect(extended).toMatchObject({ anchor: { x: 0, y: 0 }, endpoint: { x: 19, y: -9 }, direction: 'up-right' })
    expect(extended.lockedEndpoint).toBeUndefined()
  })

  it('lets the initial pixel steps settle before locking the first direction', () => {
    const start: IsoAlignedStrokeSegmentState = { anchor: { x: 0, y: 0 }, endpoint: { x: 0, y: 0 }, direction: null }
    const horizontalSample = advanceIsoAlignedStrokeSegment(start, { x: 1, y: 0 })
    const diagonalSample = advanceIsoAlignedStrokeSegment(horizontalSample, { x: 1, y: 1 })
    const establishedDiagonal = advanceIsoAlignedStrokeSegment(diagonalSample, { x: 3, y: 2 })

    expect(horizontalSample.direction).toBe('right')
    expect(diagonalSample.lockedEndpoint).toBeUndefined()
    expect(diagonalSample.anchor).toEqual(start.anchor)
    expect(diagonalSample.direction).toBe('down-right')
    expect(establishedDiagonal.lockedEndpoint).toBeUndefined()
    expect(establishedDiagonal.endpoint).toEqual({ x: 3, y: 1 })
  })

  it('locks the previous endpoint and continues a changed direction from that turn', () => {
    const diagonal: IsoAlignedStrokeSegmentState = {
      anchor: { x: 0, y: 0 },
      endpoint: { x: 19, y: -9 },
      rawAnchor: { x: 0, y: 0 },
      rawEndpoint: { x: 18, y: -9 },
      direction: 'up-right',
      directionSamples: 4
    }
    const turned = advanceIsoAlignedStrokeSegment(diagonal, { x: 26, y: -5 })

    expect(turned.lockedEndpoint).toEqual({ x: 19, y: -9 })
    expect(turned.anchor).toEqual({ x: 19, y: -9 })
    expect(turned.direction).toBe('down-right')
    expect(turned.endpoint).toEqual({ x: 28, y: -5 })
  })

  it('continues cardinal direction changes from each locked turn', () => {
    const horizontal: IsoAlignedStrokeSegmentState = {
      anchor: { x: 0, y: 0 },
      endpoint: { x: 8, y: 0 },
      rawAnchor: { x: 0, y: 0 },
      rawEndpoint: { x: 8, y: 0 },
      direction: 'right',
      directionSamples: 4
    }
    const vertical = advanceIsoAlignedStrokeSegment(horizontal, { x: 9, y: 5 })
    const establishedVertical: IsoAlignedStrokeSegmentState = {
      ...vertical,
      endpoint: { x: 8, y: 9 },
      rawEndpoint: { x: 9, y: 9 },
      directionSamples: 4
    }
    const left = advanceIsoAlignedStrokeSegment(establishedVertical, { x: 0, y: 10 })

    expect(vertical.lockedEndpoint).toEqual({ x: 8, y: 0 })
    expect(vertical.endpoint).toEqual({ x: 8, y: 5 })
    expect(left.lockedEndpoint).toEqual({ x: 8, y: 9 })
    expect(left.endpoint).toEqual({ x: -1, y: 9 })
  })

  it('uses the configured stair step after a direction change', () => {
    const diagonal: IsoAlignedStrokeSegmentState = {
      anchor: { x: 2, y: 3 },
      endpoint: { x: 19, y: 8 },
      rawAnchor: { x: 2, y: 3 },
      rawEndpoint: { x: 20, y: 9 },
      direction: 'down-right',
      directionSamples: 4
    }
    const turned = advanceIsoAlignedStrokeSegment(diagonal, { x: 25, y: 4 }, 3)

    expect(diagonal.endpoint).toEqual({ x: 19, y: 8 })
    expect(turned.lockedEndpoint).toEqual(diagonal.endpoint)
    expect(turned.anchor).toEqual(diagonal.endpoint)
    expect(turned.endpoint).not.toEqual(isoLineEndpoint({ x: 2, y: 3 }, { x: 25, y: 4 }, 3))
  })

  it('maps a turn from raw pointer movement instead of bridging to its offset aligned endpoint', () => {
    const turned = advanceIsoAlignedStrokeSegment({
      anchor: { x: 0, y: 0 },
      endpoint: { x: 11, y: 5 },
      rawAnchor: { x: 0, y: 0 },
      rawEndpoint: { x: 14, y: 1 },
      direction: 'down-right',
      directionSamples: 8
    }, { x: 15, y: 0 })

    expect(turned.lockedEndpoint).toEqual({ x: 11, y: 5 })
    expect(turned.rawAnchor).toEqual({ x: 14, y: 1 })
    expect(turned.direction).toBe('up-right')
    expect(turned.endpoint).toEqual({ x: 12, y: 5 })
  })

  it('snaps stroke starts to the nearest ISO grid vertex', () => {
    expect(snapIsoPointToGridVertex({ x: 7, y: 3 }, 2, 8)).toEqual({ x: 8, y: 4 })
    expect(snapIsoPointToGridVertex({ x: 12, y: 1 }, 2, 8, { x: 5, y: -2 })).toEqual({ x: 13, y: 2 })
  })

  it('keeps grid-snapped straight lines on a diagonal grid family', () => {
    const endpoint = isoGridLineEndpoint({ x: 0, y: 0 }, { x: 12, y: 1 }, 2)
    expect(endpoint).toEqual({ x: 9, y: 4 })
    expect(balancedStairLinePoints({ x: 0, y: 0 }, endpoint)).toEqual(expect.arrayContaining([
      { x: 0, y: 0 },
      { x: 8, y: 4 },
      { x: 9, y: 4 }
    ]))
  })

  it('starts snapped straight lines on the raster side of each grid vertex', () => {
    expect(isoGridLineSegment({ x: 0, y: 0 }, { x: 8, y: 4 }, 2)).toEqual({ from: { x: 0, y: 0 }, to: { x: 7, y: 3 } })
    expect(isoGridLineSegment({ x: 0, y: 0 }, { x: 8, y: -4 }, 2)).toEqual({ from: { x: 0, y: -1 }, to: { x: 7, y: -4 } })
    expect(isoGridLineSegment({ x: 0, y: 0 }, { x: -8, y: 4 }, 2)).toEqual({ from: { x: -1, y: 0 }, to: { x: -8, y: 3 } })
    expect(isoGridLineSegment({ x: 0, y: 0 }, { x: -8, y: -4 }, 2)).toEqual({ from: { x: -1, y: -1 }, to: { x: -8, y: -4 } })
  })

  it('returns the complete grid edge actually crossed by the pointer', () => {
    const traced = traceIsoGridPointerEdges({ x: 3, y: 0 }, { x: 3, y: 3 }, {
      stairStep: 2,
      spacing: 8
    })

    expect(traced.edges).toEqual([{
      key: '0:0:1',
      from: { x: 0, y: 0 },
      to: { x: 7, y: 3 },
      startVertex: { x: 0, y: 0 },
      endVertex: { x: 8, y: 4 }
    }])
    expect(traced.hoveredEdgeKey).toBeNull()
  })

  it('does not invent a grid edge while the pointer stays inside a cell', () => {
    const traced = traceIsoGridPointerEdges({ x: 3.5, y: 4 }, { x: 4.5, y: 4 }, {
      stairStep: 2,
      spacing: 8
    })

    expect(traced.edges).toEqual([])
    expect(traced.hoveredEdgeKey).toBeNull()
  })

  it('records every grid edge crossed by a fast pointer movement', () => {
    const traced = traceIsoGridPointerEdges({ x: 4, y: -8 }, { x: 4, y: 16 }, {
      stairStep: 2,
      spacing: 8
    })
    const keys = traced.edges.map((edge) => edge.key)

    expect(keys).toHaveLength(6)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('does not repeatedly emit the same edge while the pointer remains over it', () => {
    const first = traceIsoGridPointerEdges({ x: 2, y: 1 }, { x: 4, y: 2 }, {
      stairStep: 2,
      spacing: 8
    })
    const continued = traceIsoGridPointerEdges({ x: 4, y: 2 }, { x: 6, y: 3 }, {
      stairStep: 2,
      spacing: 8,
      hoveredEdgeKey: first.hoveredEdgeKey
    })

    expect(first.edges.map((edge) => edge.key)).toEqual(['0:0:1'])
    expect(continued.edges).toEqual([])
    expect(continued.hoveredEdgeKey).toBe('0:0:1')
  })

  it('switches the complete active edge to the direction under the pointer', () => {
    const held = advanceIsoAlignedStrokeSegment({
      anchor: { x: 0, y: 0 },
      endpoint: { x: 3, y: 1 },
      rawAnchor: { x: 0, y: 0 },
      rawEndpoint: { x: 3, y: 1 },
      direction: 'down-right',
      directionSamples: 4
    }, { x: 4, y: -1 }, 2, {
      diagonalOnly: true,
      grid: { spacing: 8 }
    })

    expect(held.lockedEndpoints).toBeUndefined()
    expect(held.anchor).toEqual({ x: 0, y: -1 })
    expect(held.direction).toBe('up-right')
    expect(held.endpoint).toEqual({ x: 7, y: -4 })
  })

  it('follows the current pointer instead of preserving the raw press offset', () => {
    const followed = advanceIsoAlignedStrokeSegment({
      anchor: { x: 0, y: 0 },
      endpoint: { x: 0, y: 0 },
      rawAnchor: { x: 3, y: 3 },
      rawEndpoint: { x: 3, y: 3 },
      direction: null,
      directionSamples: 0
    }, { x: 4, y: -2 }, 2, {
      diagonalOnly: true,
      grid: { spacing: 8 }
    })

    expect(followed.direction).toBe('up-right')
    expect(followed.anchor).toEqual({ x: 0, y: -1 })
    expect(followed.endpoint).toEqual({ x: 7, y: -4 })
  })

  it('keeps the whole grid edge visible while the pointer moves inside it', () => {
    const start: IsoAlignedStrokeSegmentState = {
      anchor: { x: 0, y: 0 },
      endpoint: { x: 0, y: 0 },
      gridVertex: { x: 0, y: 0 },
      direction: null,
      directionSamples: 0
    }
    const nearStart = advanceIsoAlignedStrokeSegment(start, { x: 1.25, y: 0.5 }, 2, {
      diagonalOnly: true,
      grid: { spacing: 8 }
    })
    const nearEnd = advanceIsoAlignedStrokeSegment(nearStart, { x: 6.75, y: 3.25 }, 2, {
      diagonalOnly: true,
      grid: { spacing: 8 }
    })

    expect(nearStart.endpoint).toEqual({ x: 7, y: 3 })
    expect(nearEnd.endpoint).toEqual(nearStart.endpoint)
    expect(nearEnd.lockedEndpoints).toBeUndefined()
  })

  it('turns only after completing the active grid edge', () => {
    const turned = advanceIsoAlignedStrokeSegment({
      anchor: { x: 0, y: 0 },
      endpoint: { x: 6, y: 3 },
      rawAnchor: { x: 0, y: 0 },
      rawEndpoint: { x: 6, y: 3 },
      direction: 'down-right',
      directionSamples: 4
    }, { x: 11, y: -1 }, 2, {
      diagonalOnly: true,
      grid: { spacing: 8 }
    })

    expect(turned.lockedEndpoints).toEqual([{ x: 7, y: 3 }, { x: 8, y: 3 }])
    expect(turned.anchor).toEqual({ x: 8, y: 3 })
    expect(turned.direction).toBe('up-right')
    expect(turned.endpoint).toEqual({ x: 15, y: 0 })
    expect(balancedStairLinePoints({ x: 0, y: 0 }, { x: 7, y: 3 })).toHaveLength(8)
    expect(runLengths(balancedStairLinePoints({ x: 8, y: 3 }, turned.endpoint), 'x')).toEqual(new Array(4).fill(2))
  })

  it('joins every grid-edge turn with an axis-adjacent corner', () => {
    const turn = (direction: IsoAlignedStrokeSegmentState['direction'], target: { x: number; y: number }) => advanceIsoAlignedStrokeSegment({
      anchor: { x: 0, y: 0 },
      endpoint: { x: 5 * Math.sign(target.x || 1), y: 2 * Math.sign(target.y || 1) },
      gridVertex: { x: 0, y: 0 },
      direction,
      directionSamples: 4
    }, target, 2, {
      diagonalOnly: true,
      grid: { spacing: 8 }
    }).lockedEndpoints

    expect(turn('down-right', { x: 11, y: -1 })).toEqual([{ x: 7, y: 3 }, { x: 8, y: 3 }])
    expect(turn('down-right', { x: 6, y: 10 })).toEqual([{ x: 7, y: 3 }, { x: 7, y: 4 }])
    expect(turn('down-left', { x: -11, y: 1 })).toEqual([{ x: -8, y: 3 }, { x: -9, y: 3 }])
    expect(turn('up-left', { x: -6, y: -10 })).toEqual([{ x: -8, y: -4 }, { x: -8, y: -5 }])
  })

  it('records every crossed grid edge during a fast pointer sample', () => {
    const advanced = advanceIsoAlignedStrokeSegment({
      anchor: { x: 0, y: 0 },
      endpoint: { x: 0, y: 0 },
      rawAnchor: { x: 0, y: 0 },
      rawEndpoint: { x: 0, y: 0 },
      direction: 'down-right',
      directionSamples: 4
    }, { x: 20, y: 10 }, 2, {
      diagonalOnly: true,
      grid: { spacing: 8 }
    })

    expect(advanced.lockedEndpoints).toEqual([
      { x: 7, y: 3 },
      { x: 8, y: 4 },
      { x: 15, y: 7 },
      { x: 16, y: 8 }
    ])
    expect(advanced.anchor).toEqual({ x: 16, y: 8 })
    expect(advanced.endpoint).toEqual({ x: 23, y: 11 })
  })

  it('waits at an exact grid vertex without starting a phantom edge', () => {
    const advanced = advanceIsoAlignedStrokeSegment({
      anchor: { x: 0, y: 0 },
      endpoint: { x: 0, y: 0 },
      gridVertex: { x: 0, y: 0 },
      direction: 'down-right',
      directionSamples: 4
    }, { x: 16, y: 8 }, 2, {
      diagonalOnly: true,
      grid: { spacing: 16 }
    })

    expect(advanced.lockedEndpoints).toEqual([{ x: 15, y: 7 }])
    expect(advanced.anchor).toEqual({ x: 15, y: 7 })
    expect(advanced.endpoint).toEqual({ x: 15, y: 7 })
    expect(advanced.gridVertex).toEqual({ x: 16, y: 8 })
    expect(advanced.direction).toBeNull()
  })

  it('preserves a completed grid edge when drawing continues from an exact vertex', () => {
    const path = [
      { x: 0, y: 7, pressure: 0.2 },
      { x: 15, y: 0, pressure: 0.5 },
      { x: 15, y: 0, pressure: 0.5 }
    ]

    updateIsoAlignedStrokePath(path, {
      anchor: { x: 16, y: 0 },
      endpoint: { x: 17, y: 0 },
      gridVertex: { x: 16, y: 0 },
      direction: 'down-right',
      directionSamples: 1
    }, { x: 17, y: 0, pressure: 0.8 })

    expect(path).toEqual([
      { x: 0, y: 7, pressure: 0.2 },
      { x: 15, y: 0, pressure: 0.5 },
      { x: 16, y: 0, pressure: 0.5 },
      { x: 17, y: 0, pressure: 0.8 }
    ])
    expect(runLengths(balancedStairLinePoints(path[0], path[1]), 'x')).toEqual(new Array(8).fill(2))
  })

  it('replaces an initial zero-length marker instead of treating it as a completed edge', () => {
    const path = [
      { x: 0, y: 0, pressure: 0.2 },
      { x: 0, y: 0, pressure: 0.2 }
    ]

    updateIsoAlignedStrokePath(path, {
      anchor: { x: 0, y: -1 },
      endpoint: { x: 1, y: -1 },
      gridVertex: { x: 0, y: 0 },
      direction: 'up-right',
      directionSamples: 1
    }, { x: 1, y: -1, pressure: 0.8 })

    expect(path).toEqual([
      { x: 0, y: -1, pressure: 0.2 },
      { x: 1, y: -1, pressure: 0.8 }
    ])
  })

  it('clips both isometric guide families to the visible document bounds', () => {
    const bounds = { left: 8, top: 4, right: 24, bottom: 16 }
    const segments = isoGuideSegments(32, 24, bounds, { spacing: ISO_GUIDE_BASE_SPACING })
    expect(segments.length).toBeGreaterThan(0)
    expect(segments.some(({ start, end }) => (end.y - start.y) / (end.x - start.x) > 0)).toBe(true)
    expect(segments.some(({ start, end }) => (end.y - start.y) / (end.x - start.x) < 0)).toBe(true)
    for (const { start, end } of segments) {
      for (const point of [start, end]) {
        expect(point.x).toBeGreaterThanOrEqual(bounds.left)
        expect(point.x).toBeLessThanOrEqual(bounds.right)
        expect(point.y).toBeGreaterThanOrEqual(bounds.top)
        expect(point.y).toBeLessThanOrEqual(bounds.bottom)
      }
      expect(Math.abs((end.y - start.y) / (end.x - start.x))).toBeCloseTo(0.5)
    }
  })

  it('uses the configured stair slope, origin, and guide unit', () => {
    const origin = { x: 5, y: 7 }
    const segments = isoGuideSegments(40, 32, { left: 0, top: 0, right: 40, bottom: 32 }, {
      spacing: 10,
      stairStep: 4,
      origin
    })
    expect(segments.length).toBeGreaterThan(0)
    expect(segments.every(({ start, end }) => Math.abs((end.y - start.y) / (end.x - start.x)) === 0.25)).toBe(true)
    expect(segments.some(({ start, end }) => {
      const slope = (end.y - start.y) / (end.x - start.x)
      const intercept = start.y - slope * start.x
      return slope > 0 && Math.abs(origin.y - (slope * origin.x + intercept)) < 1e-9
    })).toBe(true)
    expect(segments.some(({ start, end }) => {
      const slope = (end.y - start.y) / (end.x - start.x)
      const intercept = start.y - slope * start.x
      return slope < 0 && Math.abs(origin.y - (slope * origin.x + intercept)) < 1e-9
    })).toBe(true)
  })

  it('builds a repeating pixel guide tile from both stair directions', () => {
    const pattern = isoGuidePixelPattern(2, 4)
    expect(pattern.width).toBe(8)
    expect(pattern.height).toBe(4)
    expect(pattern.pixels).toContainEqual({ x: 0, y: 0 })
    expect(pattern.pixels).toContainEqual({ x: 1, y: 0 })
    expect(pattern.pixels).toContainEqual({ x: 2, y: 1 })
    expect(pattern.pixels).toContainEqual({ x: 2, y: 3 })
    expect(pattern.pixels).toContainEqual({ x: 4, y: 2 })
    expect(pattern.pixels.filter(({ x, y }) => x === 4 && y === 2)).toHaveLength(1)
  })

  it('skips guide lines as needed to keep low zoom views readable', () => {
    expect(isoGuideSpacingForZoom(16)).toBe(16)
    expect(isoGuideSpacingForZoom(1)).toBe(16)
    expect(isoGuideSpacingForZoom(0.5)).toBe(16)
    expect(isoGuideSpacingForZoom(0.125)).toBe(64)
    expect(isoGuideSpacingForZoom(1, 6)).toBe(12)
    expect(isoGuideSpacingForZoom(0.5, 6)).toBe(24)
  })
})
