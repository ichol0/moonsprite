import { describe, expect, it, vi } from 'vitest'
import { createOpenProgressController } from './open-progress'

describe('open progress controller', () => {
  it('starts decoding before publishing and hides immediately when opening finishes', () => {
    const frames: FrameRequestCallback[] = []
    const controller = createOpenProgressController((callback) => {
      frames.push(callback)
      return frames.length
    })
    const listener = vi.fn()
    controller.subscribe(listener)

    const finish = controller.begin()
    expect(controller.getSnapshot().phase).toBe('hidden')
    expect(listener).not.toHaveBeenCalled()

    frames.shift()?.(0)
    expect(controller.getSnapshot().phase).toBe('running')
    expect(listener).toHaveBeenCalledTimes(1)

    finish()
    expect(controller.getSnapshot().phase).toBe('hidden')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('keeps one overlay visible while concurrent files are opening', () => {
    const frames: FrameRequestCallback[] = []
    const controller = createOpenProgressController((callback) => {
      frames.push(callback)
      return frames.length
    })
    const listener = vi.fn()
    controller.subscribe(listener)

    const finishFirst = controller.begin()
    frames.shift()?.(0)
    const finishSecond = controller.begin()
    finishFirst()
    expect(controller.getSnapshot().phase).toBe('running')
    expect(listener).toHaveBeenCalledTimes(1)

    finishSecond()
    expect(controller.getSnapshot().phase).toBe('hidden')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('hides immediately when the final open operation fails', () => {
    const frames: FrameRequestCallback[] = []
    const controller = createOpenProgressController((callback) => {
      frames.push(callback)
      return frames.length
    })
    const finish = controller.begin()

    finish(false)

    expect(controller.getSnapshot().phase).toBe('hidden')
    frames.shift()?.(0)
    expect(controller.getSnapshot().phase).toBe('hidden')
  })

  it('does not flash the overlay when opening finishes within one frame', () => {
    const frames: FrameRequestCallback[] = []
    const controller = createOpenProgressController((callback) => {
      frames.push(callback)
      return frames.length
    })
    const listener = vi.fn()
    controller.subscribe(listener)

    controller.begin()()
    frames.shift()?.(0)

    expect(controller.getSnapshot().phase).toBe('hidden')
    expect(listener).not.toHaveBeenCalled()
  })
})
