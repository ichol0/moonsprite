import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearBrushDynamicsTelemetry, getBrushDynamicsTelemetry } from '@/core/brush-dynamics-telemetry'
import { BrushDynamicsTelemetryCapture } from './BrushDynamicsTelemetryCapture'
import { nearestBrushDynamicsRangeEndpoint } from './EditorToolOptions'

const pointerEvent = (type: string, values: Partial<PointerEvent> = {}): PointerEvent => {
  const event = new Event(type) as PointerEvent
  for (const [key, value] of Object.entries(values)) Object.defineProperty(event, key, { configurable: true, value })
  return event
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0))
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => window.clearTimeout(handle))
  clearBrushDynamicsTelemetry()
  vi.runOnlyPendingTimers()
})

afterEach(() => {
  cleanup()
  clearBrushDynamicsTelemetry()
  vi.runOnlyPendingTimers()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('brush dynamics range endpoint selection', () => {
  it('selects the nearest endpoint', () => {
    expect(nearestBrushDynamicsRangeEndpoint(18, 20, 80, 'max')).toBe('min')
    expect(nearestBrushDynamicsRangeEndpoint(82, 20, 80, 'min')).toBe('max')
  })

  it('alternates ties, including overlapping endpoints', () => {
    expect(nearestBrushDynamicsRangeEndpoint(50, 20, 80, 'min')).toBe('max')
    expect(nearestBrushDynamicsRangeEndpoint(50, 20, 80, 'max')).toBe('min')
    expect(nearestBrushDynamicsRangeEndpoint(40, 40, 40, 'min')).toBe('max')
    expect(nearestBrushDynamicsRangeEndpoint(40, 40, 40, 'max')).toBe('min')
  })
})

describe('BrushDynamicsTelemetryCapture', () => {
  it('captures global samples, settles speed, and clears inactive lifecycle state', () => {
    const view = render(<BrushDynamicsTelemetryCapture documentId="doc-a" />)
    window.dispatchEvent(pointerEvent('pointerdown', { clientX: 0, clientY: 0, timeStamp: 0, pressure: 0.5, pointerType: 'pen' }))
    window.dispatchEvent(pointerEvent('pointermove', { clientX: 20, clientY: 0, timeStamp: 20, pressure: 0.5, pointerType: 'pen' }))
    vi.advanceTimersByTime(0)
    expect(getBrushDynamicsTelemetry()).toMatchObject({ documentId: 'doc-a', active: true, pointerType: 'pen' })
    expect(getBrushDynamicsTelemetry()!.pressure).toBeGreaterThan(0)
    expect(getBrushDynamicsTelemetry()!.speed).toBeGreaterThan(0)

    vi.advanceTimersByTime(160)
    vi.runOnlyPendingTimers()
    expect(getBrushDynamicsTelemetry()).toMatchObject({ documentId: 'doc-a', active: true, speed: 0 })

    window.dispatchEvent(pointerEvent('pointerup', { clientX: 20, clientY: 0, timeStamp: 24, pressure: 0, pointerType: 'pen' }))
    vi.advanceTimersByTime(0)
    expect(getBrushDynamicsTelemetry()).toMatchObject({ documentId: 'doc-a', pressure: 0, speed: 0, active: true })

    window.dispatchEvent(pointerEvent('pointercancel', { pointerType: 'pen' }))
    vi.advanceTimersByTime(0)
    expect(getBrushDynamicsTelemetry()).toMatchObject({ documentId: 'doc-a', pressure: null, speed: 0, active: false })

    view.rerender(<BrushDynamicsTelemetryCapture documentId="doc-b" />)
    vi.advanceTimersByTime(0)
    expect(getBrushDynamicsTelemetry()).toMatchObject({ documentId: 'doc-b', pressure: null, speed: 0, active: false })
  })

  it.each(['mouse', 'touch'])('publishes null pressure when a %s pointer ends', (pointerType) => {
    render(<BrushDynamicsTelemetryCapture documentId="doc-a" />)
    window.dispatchEvent(pointerEvent('pointerdown', { clientX: 0, clientY: 0, timeStamp: 0, pressure: 0.5, pointerType }))
    window.dispatchEvent(pointerEvent('pointerup', { clientX: 0, clientY: 0, timeStamp: 8, pressure: 0, pointerType }))
    vi.advanceTimersByTime(0)

    expect(getBrushDynamicsTelemetry()).toMatchObject({ documentId: 'doc-a', pressure: null, speed: 0, pointerType, active: true })
  })
})
