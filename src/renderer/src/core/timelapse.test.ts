import { describe, expect, it } from 'vitest'
import { resolveTimelapseMimeType, timelapseFrameDurations, timelapseFrameHoldMs, timelapseOutputDimensions, timelapseOutputScale, timelapseSourceDurationMs } from './timelapse'

describe('timelapse video encoding helpers', () => {
  it('selects the first supported MP4 MIME type', () => {
    const checked: string[] = []
    const mimeType = resolveTimelapseMimeType('mp4', (candidate) => {
      checked.push(candidate)
      return candidate === 'video/mp4'
    })

    expect(mimeType).toBe('video/mp4')
    expect(checked).toEqual(['video/mp4;codecs=avc1.42E01E', 'video/mp4'])
  })

  it('selects a supported WebM codec in preference order', () => {
    expect(resolveTimelapseMimeType('webm', (candidate) => candidate === 'video/webm;codecs=vp8'))
      .toBe('video/webm;codecs=vp8')
  })

  it('returns null when the runtime cannot encode the requested video format', () => {
    expect(resolveTimelapseMimeType('mp4', () => false)).toBeNull()
    expect(resolveTimelapseMimeType('webm', () => false)).toBeNull()
  })

  it('uses elapsed edit time while respecting the selected FPS and speed', () => {
    expect(timelapseFrameHoldMs({ elapsedMs: 800 } as never, { fps: 12, speed: 8 })).toBe(100)
    expect(timelapseFrameHoldMs({ elapsedMs: 4000 } as never, { fps: 12, speed: 1 })).toBe(1000)
    expect(timelapseFrameHoldMs({ elapsedMs: 1 } as never, { fps: 24, speed: 1 })).toBeCloseTo(1000 / 24)
  })

  it('scales a small canvas to the selected output quality', () => {
    expect(timelapseOutputScale({ quality: 'high', snapshots: [{ width: 64, height: 64 }] } as never)).toBe(37)
    expect(timelapseOutputDimensions({ quality: 'high', snapshots: [{ width: 64, height: 64 }] } as never)).toEqual({ width: 2368, height: 2368 })
    expect(timelapseOutputDimensions({ quality: 'medium', snapshots: [{ width: 4200, height: 1800 }] } as never)).toEqual({ width: 4200, height: 1800 })
    expect(timelapseOutputDimensions({ quality: 'high', snapshots: [{ width: 101, height: 77 }] } as never)).toEqual({ width: 2324, height: 1772 })
  })

  it('distributes frames to an exact requested duration or speed', () => {
    const settings = { fps: 12, speed: 4, snapshots: [{ elapsedMs: 100 }, { elapsedMs: 300 }] } as never
    expect(timelapseSourceDurationMs(settings)).toBe(400)
    expect(timelapseFrameDurations(settings, { mode: 'duration', durationSeconds: 10 })).toEqual([2500, 7500])
    expect(timelapseFrameDurations(settings, { mode: 'speed', durationSeconds: 1 })).toEqual([25, 75])
  })
})
