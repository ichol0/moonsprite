import { describe, expect, it } from 'vitest'
import { autoSliceCount, autoSliceRects, clampSliceRect, MAX_AUTO_SLICES, moveSliceRect, moveSliceRects, normalizeDocumentSlices, sliceAtPoint, sliceExportFileName } from './slices'

describe('document slices', () => {
  it('normalizes valid slices and rejects malformed or duplicate entries', () => {
    expect(normalizeDocumentSlices([
      { id: 'a', name: ' Head ', x: 2, y: 3, width: 5, height: 4 },
      { id: 'a', name: 'duplicate', x: 0, y: 0, width: 1, height: 1 },
      { id: 'b', name: '', x: 9, y: 9, width: 20, height: 20 },
      { id: 'bad', x: 0, y: 0, width: 0, height: 1 }
    ], 12, 10)).toEqual([
      { id: 'a', name: 'Head', x: 2, y: 3, width: 5, height: 4 },
      { id: 'b', name: 'Slice 2', x: 9, y: 9, width: 3, height: 1 }
    ])
  })

  it('clamps creation, movement, hit testing, and unique export names', () => {
    expect(clampSliceRect({ x: -4, y: 8, width: 20, height: 5 }, 10, 10)).toEqual({ x: 0, y: 8, width: 10, height: 2 })
    const slice = { id: 'one', name: 'Body', x: 2, y: 2, width: 4, height: 3 }
    expect(moveSliceRect(slice, 99, -9, 10, 10)).toEqual({ ...slice, x: 6, y: 0 })
    expect(sliceAtPoint([slice], 5, 4)?.id).toBe('one')
    expect(sliceAtPoint([slice], 6, 4)).toBeNull()
    const used = new Set<string>()
    expect(sliceExportFileName(slice, 'png', used)).toBe('Body.png')
    expect(sliceExportFileName(slice, 'png', used)).toBe('Body-2.png')
  })

  it('moves multiple slices as one bounded group', () => {
    expect(moveSliceRects([
      { x: 1, y: 2, width: 3, height: 2 },
      { x: 6, y: 5, width: 2, height: 3 }
    ], 9, -9, 10, 10)).toEqual([
      { x: 3, y: 0, width: 3, height: 2 },
      { x: 8, y: 3, width: 2, height: 3 }
    ])
  })

  it('lays out complete slices from the configured origin with independent gaps', () => {
    const settings = { width: 8, height: 6, gapX: 2, gapY: 1, startX: 1, startY: 2 }
    expect(autoSliceCount(35, 22, settings)).toBe(9)
    expect(autoSliceRects(35, 22, settings)).toEqual([
      { x: 1, y: 2, width: 8, height: 6 },
      { x: 11, y: 2, width: 8, height: 6 },
      { x: 21, y: 2, width: 8, height: 6 },
      { x: 1, y: 9, width: 8, height: 6 },
      { x: 11, y: 9, width: 8, height: 6 },
      { x: 21, y: 9, width: 8, height: 6 },
      { x: 1, y: 16, width: 8, height: 6 },
      { x: 11, y: 16, width: 8, height: 6 },
      { x: 21, y: 16, width: 8, height: 6 }
    ])
  })

  it('rejects out-of-bounds and excessive automatic slice layouts', () => {
    expect(autoSliceCount(12, 10, { width: 4, height: 4, gapX: 0, gapY: 0, startX: 10, startY: 0 })).toBe(0)
    const excessive = { width: 1, height: 1, gapX: 0, gapY: 0, startX: 0, startY: 0 }
    expect(autoSliceCount(101, 101, excessive)).toBeGreaterThan(MAX_AUTO_SLICES)
    expect(autoSliceRects(101, 101, excessive)).toEqual([])
  })
})
