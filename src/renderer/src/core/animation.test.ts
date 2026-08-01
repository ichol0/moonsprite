import { describe, expect, it } from 'vitest'
import { createDefaultAnimationTimeline, normalizeAnimationTimeline } from './animation'

describe('animation timeline boundary', () => {
  it('creates a one-frame timeline for new or legacy projects', () => {
    expect(createDefaultAnimationTimeline()).toEqual({ frames: [{ id: 'frame-1', duration: 100 }], cels: [], activeFrameId: 'frame-1', loop: true })
    expect(normalizeAnimationTimeline(undefined)).toEqual(createDefaultAnimationTimeline())
  })

  it('normalizes invalid frames and removes duplicate cel slots', () => {
    const timeline = normalizeAnimationTimeline({
      frames: [{ id: 'idle', duration: 80 }, { id: 'idle', duration: 300 }, { id: 'blink', duration: 0 }],
      activeFrameId: 'missing',
      loop: false,
      cels: [
        { id: 'cel-a', layerId: 'body', frameId: 'idle' },
        { id: 'cel-b', layerId: 'body', frameId: 'idle' },
        { id: 'cel-c', layerId: 'eyes', frameId: 'blink', linkedCelId: 'cel-a' }
      ]
    })
    expect(timeline.frames).toEqual([{ id: 'idle', duration: 80 }, { id: 'blink', duration: 1 }])
    expect(timeline.activeFrameId).toBe('idle')
    expect(timeline.cels).toEqual([{ id: 'cel-a', layerId: 'body', frameId: 'idle' }, { id: 'cel-c', layerId: 'eyes', frameId: 'blink', linkedCelId: 'cel-a' }])
    expect(timeline.loop).toBe(false)
  })
})
