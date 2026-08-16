import { describe, expect, it, vi } from 'vitest'
import { createSaveProgressController } from './save-progress'

describe('save progress controller', () => {
  it('publishes only save lifecycle transitions', () => {
    const frames: FrameRequestCallback[] = []
    let time = 0
    const controller = createSaveProgressController((callback) => {
      frames.push(callback)
      return frames.length
    }, undefined, () => time)
    const listener = vi.fn()
    controller.subscribe(listener)

    const finish = controller.begin('saveAs')
    expect(controller.getSnapshot()).toEqual({ kind: 'saveAs', phase: 'running' })
    time = 150

    finish()
    expect(controller.getSnapshot()).toEqual({ kind: 'saveAs', phase: 'complete' })
    frames.shift()?.(0)
    expect(controller.getSnapshot()).toEqual({ kind: 'saveAs', phase: 'hidden' })
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('keeps a fast save visible for 100ms without waiting for animation', () => {
    const frames: FrameRequestCallback[] = []
    const delays: Array<{ callback: () => void; delayMs: number }> = []
    let time = 0
    const controller = createSaveProgressController((callback) => {
      frames.push(callback)
      return frames.length
    }, (callback, delayMs) => {
      delays.push({ callback, delayMs })
      return delays.length
    }, () => time)
    const listener = vi.fn()
    controller.subscribe(listener)

    const finish = controller.begin('save')
    expect(controller.getSnapshot()).toEqual({ kind: 'save', phase: 'running' })
    time = 20
    finish()
    expect(controller.getSnapshot()).toEqual({ kind: 'save', phase: 'complete' })
    expect(delays[0]?.delayMs).toBe(80)

    delays.shift()?.callback()
    expect(controller.getSnapshot().phase).toBe('complete')
    frames.shift()?.(100)

    expect(controller.getSnapshot().phase).toBe('hidden')
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('hides without completion when saving fails', () => {
    const frames: FrameRequestCallback[] = []
    const controller = createSaveProgressController((callback) => {
      frames.push(callback)
      return frames.length
    })
    const finish = controller.begin('save')

    finish(false)

    expect(controller.getSnapshot().phase).toBe('hidden')
  })
})
