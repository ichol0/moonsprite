import { describe, expect, it } from 'vitest'
import { pixelSamplingMode } from './pixel-display'

describe('pixel display sampling', () => {
  it('keeps hard edges while every source pixel has at least one display pixel', () => {
    expect(pixelSamplingMode(1)).toBe('hard')
    expect(pixelSamplingMode(1.25)).toBe('hard')
    expect(pixelSamplingMode(16)).toBe('hard')
  })

  it('uses smooth sampling when downscaling would discard source pixels', () => {
    expect(pixelSamplingMode(0.999)).toBe('smooth')
    expect(pixelSamplingMode(0.25)).toBe('smooth')
    expect(pixelSamplingMode(0)).toBe('smooth')
  })
})
