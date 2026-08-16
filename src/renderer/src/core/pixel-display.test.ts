import { describe, expect, it } from 'vitest'
import { pixelSamplingMode } from './pixel-display'

describe('pixel display sampling', () => {
  it('keeps hard edges at integer magnification', () => {
    expect(pixelSamplingMode(1)).toBe('hard')
    expect(pixelSamplingMode(2)).toBe('hard')
    expect(pixelSamplingMode(16)).toBe('hard')
  })

  it('uses smooth sampling for fractional magnification and downscaling', () => {
    expect(pixelSamplingMode(1.25)).toBe('smooth')
    expect(pixelSamplingMode(1.5)).toBe('smooth')
    expect(pixelSamplingMode(0.999)).toBe('smooth')
    expect(pixelSamplingMode(0.25)).toBe('smooth')
    expect(pixelSamplingMode(0)).toBe('smooth')
  })
})
