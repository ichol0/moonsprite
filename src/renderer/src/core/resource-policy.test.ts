import { describe, expect, it } from 'vitest'
import { checkResourceLimit, checkTypedArrayLimit, estimateDocumentBytes } from './resource-policy'

describe('resource policy', () => {
  it('uses checked positive dimensions', () => {
    expect(() => estimateDocumentBytes(0, 16, 1, 'rgba')).toThrow('正整数')
  })

  it('accepts a normal sprite and rejects an oversized operation', () => {
    const memory = { totalBytes: 8 * 1024 ** 3, freeBytes: 4 * 1024 ** 3 }
    expect(checkResourceLimit(1024, 1024, 16, 'rgba', memory).allowed).toBe(true)
    expect(checkResourceLimit(40_000, 40_000, 1, 'rgba', memory).allowed).toBe(false)
  })

  it('does not treat the combined bytes of many large layers as one TypedArray', () => {
    const memory = { totalBytes: 32 * 1024 ** 3, freeBytes: 16 * 1024 ** 3 }
    const check = checkResourceLimit(4200, 1800, 72, 'rgba', memory)

    expect(check.estimate.layerBytes).toBe(30_240_000)
    expect(check.estimate.documentBytes).toBeGreaterThan(0x7fffffff)
    expect(check.allowed).toBe(true)
  })

  it('allows file opening to bypass the soft memory budget without bypassing the TypedArray limit', () => {
    const lowMemory = { totalBytes: 4 * 1024 ** 3, freeBytes: 2 * 1024 ** 3 }

    expect(checkResourceLimit(4200, 1800, 100, 'rgba', lowMemory).allowed).toBe(false)
    expect(checkTypedArrayLimit(4200, 1800, 100, 'rgba').allowed).toBe(true)
    expect(checkTypedArrayLimit(40_000, 40_000, 1, 'rgba').allowed).toBe(false)
  })
})
