import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearBrushDynamicsTelemetry,
  getBrushDynamicsTelemetry,
  publishBrushDynamicsTelemetry,
  subscribeBrushDynamicsTelemetry
} from './brush-dynamics-telemetry'

describe('brush dynamics telemetry', () => {
  let frames: FrameRequestCallback[]

  beforeEach(() => {
    frames = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    clearBrushDynamicsTelemetry()
    frames.shift()?.(0)
  })

  afterEach(() => {
    clearBrushDynamicsTelemetry()
    frames.shift()?.(0)
    vi.unstubAllGlobals()
  })

  it('coalesces publishes to the latest snapshot once per frame', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeBrushDynamicsTelemetry(listener)
    publishBrushDynamicsTelemetry({ documentId: 'doc', pressure: 12, speed: 120, pointerType: 'pen', active: true })
    publishBrushDynamicsTelemetry({ documentId: 'doc', pressure: 35, speed: 480, pointerType: 'pen', active: true })

    expect(frames).toHaveLength(1)
    expect(listener).not.toHaveBeenCalled()
    frames.shift()?.(16)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(getBrushDynamicsTelemetry()).toEqual({ documentId: 'doc', pressure: 35, speed: 480, pointerType: 'pen', active: true })
    unsubscribe()
  })

  it('clears without retaining session or document state', () => {
    publishBrushDynamicsTelemetry({ documentId: 'doc', pressure: null, speed: 0, pointerType: 'mouse', active: false })
    frames.shift()?.(16)
    expect(getBrushDynamicsTelemetry()?.active).toBe(false)
    clearBrushDynamicsTelemetry()
    frames.shift()?.(32)
    expect(getBrushDynamicsTelemetry()).toBeNull()
  })
})
