import { describe, expect, it } from 'vitest'
import { balancedStairLinePoints, constrainLineEndpoint } from './pixel-line'

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

describe('balanced stair line', () => {
  it('constrains Shift+Ctrl lines to cardinal and configurable diagonal directions', () => {
    expect(constrainLineEndpoint({ x: 0, y: 0 }, { x: 8, y: 5 }, 1)).toEqual({ x: 8, y: 8 })
    expect(constrainLineEndpoint({ x: 0, y: 0 }, { x: 8, y: 5 }, 2)).toEqual({ x: 9, y: 4 })
    expect(constrainLineEndpoint({ x: 8, y: 8 }, { x: 0, y: 4 }, 2)).toEqual({ x: -1, y: 4 })
  })

  it('keeps every constrained stair at the configured length including both ends', () => {
    const shallowEnd = constrainLineEndpoint({ x: 2, y: 3 }, { x: 20, y: 9 }, 3)
    const shallow = balancedStairLinePoints({ x: 2, y: 3 }, shallowEnd)
    expect(runLengths(shallow, 'x')).toEqual(new Array(6).fill(3))

    const steepEnd = constrainLineEndpoint({ x: 4, y: 24 }, { x: 10, y: 5 }, 3)
    const steep = balancedStairLinePoints({ x: 4, y: 24 }, steepEnd)
    expect(runLengths(steep, 'y')).toEqual(new Array(7).fill(3))

    expect(balancedStairLinePoints(shallowEnd, { x: 2, y: 3 })).toEqual([...shallow].reverse())
  })

  it('counts an existing anchor as the first pixel of a six-pixel stair', () => {
    const anchor = { x: 3, y: 4 }
    const end = constrainLineEndpoint(anchor, { x: 34, y: 10 }, 6)
    const points = balancedStairLinePoints(anchor, end)

    expect(points[0]).toEqual(anchor)
    expect(runLengths(points, 'x')).toEqual(new Array(points.at(-1)!.y - anchor.y + 1).fill(6))
  })

  it('distributes shallow-line pixels evenly across every stair', () => {
    const points = balancedStairLinePoints({ x: 0, y: 0 }, { x: 8, y: 2 })
    expect(points[0]).toEqual({ x: 0, y: 0 })
    expect(points.at(-1)).toEqual({ x: 8, y: 2 })
    expect(runLengths(points, 'x')).toEqual([3, 3, 3])
  })

  it('supports steep, reversed and negative-slope lines without changing their pixels', () => {
    const forward = balancedStairLinePoints({ x: 1, y: 8 }, { x: 4, y: 0 })
    const reverse = balancedStairLinePoints({ x: 4, y: 0 }, { x: 1, y: 8 })
    const runs = runLengths(forward, 'y')
    expect(Math.max(...runs) - Math.min(...runs)).toBeLessThanOrEqual(1)
    expect(reverse).toEqual([...forward].reverse())
  })

  it('preserves horizontal, vertical and diagonal endpoints', () => {
    expect(balancedStairLinePoints({ x: 2, y: 3 }, { x: 5, y: 3 })).toHaveLength(4)
    expect(balancedStairLinePoints({ x: 2, y: 3 }, { x: 2, y: 7 })).toHaveLength(5)
    expect(balancedStairLinePoints({ x: 1, y: 1 }, { x: 4, y: 4 })).toEqual([
      { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }, { x: 4, y: 4 }
    ])
  })
})
