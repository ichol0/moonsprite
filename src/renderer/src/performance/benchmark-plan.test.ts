import { describe, expect, it } from 'vitest'
import { largeProjectPlan, MAX_LARGE_PROJECT_PIXEL_BYTES } from './benchmark-plan'

describe('large performance project plan', () => {
  it('covers 800 through 4000 without exceeding the pixel allocation ceiling', () => {
    const plans = [800, 2048, 4000].map(largeProjectPlan)
    expect(plans.map((plan) => plan.localLayers)).toEqual([24, 48, 64])
    expect(plans.every((plan) => plan.uniquePixelBytes <= MAX_LARGE_PROJECT_PIXEL_BYTES)).toBe(true)
    expect(plans[2].uniquePixelBytes).toBeGreaterThan(plans[1].uniquePixelBytes)
  })
})
