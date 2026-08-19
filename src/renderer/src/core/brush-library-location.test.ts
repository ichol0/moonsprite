import { beforeEach, describe, expect, it, vi } from 'vitest'
import { brushLibraryLocation } from './brush-library-location'

describe('brush library location', () => {
  beforeEach(() => brushLibraryLocation.set(null))

  it('shares the active folder and publishes only real changes', () => {
    const listener = vi.fn()
    const unsubscribe = brushLibraryLocation.subscribe(listener)

    brushLibraryLocation.set('Characters/Heroes')
    brushLibraryLocation.set('Characters/Heroes')

    expect(brushLibraryLocation.getSnapshot()).toBe('Characters/Heroes')
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })
})
