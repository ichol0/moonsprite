import { describe, expect, it } from 'vitest'
import { balancedStairLinePoints } from './pixel-line'

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
