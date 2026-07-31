import { describe, expect, it } from 'vitest'
import { checkResourceLimit, estimateDocumentBytes } from './resource-policy'

describe('resource policy', () => {
  it('uses checked positive dimensions', () => {
    expect(() => estimateDocumentBytes(0, 16, 1, 'rgba')).toThrow('正整数')
  })

  it('accepts a normal sprite and rejects an oversized operation', () => {
    const memory = { totalBytes: 8 * 1024 ** 3, freeBytes: 4 * 1024 ** 3 }
    expect(checkResourceLimit(1024, 1024, 16, 'rgba', memory).allowed).toBe(true)
    expect(checkResourceLimit(40_000, 40_000, 1, 'rgba', memory).allowed).toBe(false)
  })
})
