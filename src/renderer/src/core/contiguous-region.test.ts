import { describe, expect, it } from 'vitest'
import { contiguousMatchingRegion } from './contiguous-region'

const gappedOutlineMask = (gap: number): { width: number; height: number; matching: Uint8Array } => {
  const width = 10
  const height = 10
  const matching = new Uint8Array(width * height).fill(1)
  const gapStart = 4
  for (let y = 2; y <= 7; y += 1) for (let x = 2; x <= 7; x += 1) {
    if (x === 2 || x === 7 || y === 2 || y === 7) matching[y * width + x] = 0
  }
  for (let x = gapStart; x < gapStart + gap; x += 1) matching[2 * width + x] = 1
  return { width, height, matching }
}

describe('contiguous smart-closure regions', () => {
  it('bridges gaps up to the configured threshold', () => {
    const { width, height, matching } = gappedOutlineMask(2)
    const closed = contiguousMatchingRegion(width, height, 4, 4, (index) => matching[index] === 1, 2)!
    const tooSmall = contiguousMatchingRegion(width, height, 4, 4, (index) => matching[index] === 1, 1)!

    expect(closed[4 * width + 4]).toBe(1)
    expect(closed[0]).toBe(0)
    expect(closed[2 * width + 4]).toBe(1)
    expect(tooSmall[0]).toBe(1)
  })

  it('closes the staggered circular gaps from the reported artwork without flattening the interior', () => {
    const rows = [
      '.....................................',
      '.....................................',
      '..............###########............',
      '...........###..........###..........',
      '.........###..............##.........',
      '........##..................##.......',
      '.......##....................##......',
      '......##......................#......',
      '......#.......................##.....',
      '.....#.........................#.....',
      '....##.........................##....',
      '....#...........................#....',
      '...##...........................#....',
      '...#.............................#...',
      '.................................#...',
      '.................................#...',
      '..#..............................#...',
      '..#..................................',
      '..#..............................#...',
      '..#..............................#...',
      '..#..............................#...',
      '..#..............................#...',
      '..#..............................#...',
      '..#.............................#....',
      '..##............................#....',
      '...#............................#....',
      '...##..........................##....',
      '....#.........................##.....',
      '....##.......................##......',
      '.....##.....................##.......',
      '......###..................##........',
      '........##...............###.........',
      '..........###.........####...........',
      '.............#######.##..............',
      '.....................................',
      '.....................................'
    ]
    const width = rows[0].length
    const height = rows.length
    const matching = Uint8Array.from(rows.join(''), (value) => value === '#' ? 0 : 1)
    const tooSmall = contiguousMatchingRegion(width, height, 18, 18, (index) => matching[index] === 1, 1)!
    const closed = contiguousMatchingRegion(width, height, 18, 18, (index) => matching[index] === 1, 2)!
    const closedAtMaximum = contiguousMatchingRegion(width, height, 18, 18, (index) => matching[index] === 1, 16)!

    expect(tooSmall[0]).toBe(1)
    for (const region of [closed, closedAtMaximum]) {
      expect(region[0]).toBe(0)
      expect(region[18 * width + 18]).toBe(1)
      expect(region[14 * width + 4]).toBe(1)
      expect(region[17 * width + 31]).toBe(1)
      expect(region[32 * width + 18]).toBe(1)
      expect(region[14 * width + 3]).toBe(1)
      expect(region[17 * width + 33]).toBe(1)
      expect(region[33 * width + 20]).toBe(1)
    }
  })

  it('keeps working when the threshold is larger than a canvas dimension', () => {
    const width = 2
    const height = 3
    const region = contiguousMatchingRegion(width, height, 0, 0, () => true, 16)!

    expect([...region]).toEqual([1, 1, 1, 1, 1, 1])
  })
})
