import { describe, expect, it } from 'vitest'
import { alignmentThresholdForZoom, resolveAlignment, unionAlignmentBounds } from './alignment'

describe('canvas alignment', () => {
  it('snaps a moving layer center to the canvas center', () => {
    const result = resolveAlignment({
      movingBounds: [{ x: 1, y: 20, width: 4, height: 4 }],
      delta: { x: 12, y: 0 },
      canvasWidth: 32,
      canvasHeight: 100,
      gridEnabled: false,
      smartEnabled: true,
      threshold: 2
    })
    expect(result.offset).toEqual({ x: 13, y: 0 })
    expect(result.guides).toContainEqual({ axis: 'x', position: 16, source: 'smart' })
  })

  it('snaps edges and centers to another layer independently on each axis', () => {
    const result = resolveAlignment({
      movingBounds: [{ x: 0, y: 0, width: 4, height: 4 }],
      targetBounds: [
        { x: 10, y: 40, width: 4, height: 4 },
        { x: 40, y: 9, width: 6, height: 6 }
      ],
      delta: { x: 5, y: 4 },
      canvasWidth: 100,
      canvasHeight: 100,
      gridEnabled: false,
      smartEnabled: true,
      threshold: 2
    })
    expect(result.offset).toEqual({ x: 6, y: 5 })
    expect(result.guides).toEqual(expect.arrayContaining([
      { axis: 'x', position: 10, source: 'smart' },
      { axis: 'y', position: 9, source: 'smart' }
    ]))
  })

  it('uses a non-zero grid origin and snaps only moving edges to grid lines', () => {
    const result = resolveAlignment({
      movingBounds: [{ x: 1, y: 2, width: 3, height: 2 }],
      delta: { x: 7, y: 4 },
      canvasWidth: 64,
      canvasHeight: 64,
      grid: { x: 2, y: 3, width: 8, height: 6 },
      gridEnabled: true,
      smartEnabled: false,
      threshold: 1
    })
    expect(result.offset).toEqual({ x: 6, y: 5 })
    expect(result.guides).toEqual(expect.arrayContaining([
      { axis: 'x', position: 10, source: 'grid' },
      { axis: 'y', position: 9, source: 'grid' }
    ]))
  })

  it('does not snap outside the configured threshold', () => {
    const result = resolveAlignment({
      movingBounds: [{ x: 2, y: 3, width: 4, height: 4 }],
      targetBounds: [{ x: 20, y: 30, width: 4, height: 4 }],
      delta: { x: 8, y: 9 },
      canvasWidth: 64,
      canvasHeight: 64,
      gridEnabled: false,
      smartEnabled: true,
      threshold: 1
    })
    expect(result).toEqual({ offset: { x: 8, y: 9 }, guides: [] })
  })

  it('keeps the constrained axis locked while snapping the movable axis', () => {
    const result = resolveAlignment({
      movingBounds: [{ x: 0, y: 0, width: 4, height: 4 }],
      targetBounds: [{ x: 10, y: 10, width: 4, height: 4 }],
      delta: { x: 5, y: 0 },
      canvasWidth: 64,
      canvasHeight: 64,
      gridEnabled: false,
      smartEnabled: true,
      threshold: 6,
      lockedAxis: 'x'
    })
    expect(result.offset).toEqual({ x: 6, y: 0 })
    expect(result.guides.every((guide) => guide.axis === 'x')).toBe(true)
  })

  it('skips half-pixel center matches that cannot preserve integer document offsets', () => {
    const result = resolveAlignment({
      movingBounds: [{ x: 21, y: 20, width: 3, height: 3 }],
      targetBounds: [{ x: 30, y: 30, width: 4, height: 4 }],
      delta: { x: 2, y: 0 },
      canvasWidth: 100,
      canvasHeight: 100,
      gridEnabled: false,
      smartEnabled: true,
      threshold: 8
    })
    expect(result.offset.x).toBe(6)
    expect(result.guides).toContainEqual({ axis: 'x', position: 30, source: 'smart' })
    expect(result.guides).not.toContainEqual({ axis: 'x', position: 32, source: 'smart' })
  })

  it('unions multiple moving layer bounds and keeps the threshold screen-space stable', () => {
    expect(unionAlignmentBounds([
      { x: -2, y: 3, width: 4, height: 5 },
      { x: 5, y: -1, width: 2, height: 3 }
    ])).toEqual({ x: -2, y: -1, width: 9, height: 9 })
    expect(alignmentThresholdForZoom(6, 3)).toBe(2)
    expect(alignmentThresholdForZoom(6, 0.5)).toBe(12)
    expect(alignmentThresholdForZoom(6, 16)).toBe(1)
  })
})
