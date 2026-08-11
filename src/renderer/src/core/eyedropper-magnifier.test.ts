import { describe, expect, it } from 'vitest'
import { eyedropperMagnifierPixelScale } from './eyedropper-magnifier'

describe('eyedropper magnifier scale', () => {
  it('keeps the baseline hard-edge scale for small canvas zoom levels', () => {
    expect(eyedropperMagnifierPixelScale(1)).toBe(12)
    expect(eyedropperMagnifierPixelScale(8)).toBe(12)
  })

  it('stays magnified relative to a highly zoomed canvas', () => {
    expect(eyedropperMagnifierPixelScale(16)).toBe(24)
    expect(eyedropperMagnifierPixelScale(100)).toBe(150)
  })
})
