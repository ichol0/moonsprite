import { describe, expect, it } from 'vitest'
import { captureTimelapseSnapshot, createTimelapseCaptureCache, resolveTimelapseMimeType, timelapseFrameDurations, timelapseFrameHoldMs, timelapseOutputDimensions, timelapseOutputScale, timelapseSourceDurationMs } from './timelapse'
import { createDocument, getActiveLayer } from './document'

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

  it('keeps a capture cache valid while patching only a dirty region', () => {
    const document = createDocument('timelapse cache', 4, 3, 'rgba')
    const layer = getActiveLayer(document)
    const cache = createTimelapseCaptureCache()
    const first = new Uint8ClampedArray(document.width * document.height * 4)
    layer.pixels.set([255, 0, 0, 255], 0)
    document.timelapse = { enabled: true, quality: 'low', fps: 12, speed: 8, snapshots: [] }

    captureTimelapseSnapshot(document, 1000, { cache, contentRevision: 1, contentInvalidation: { kind: 'full', fromRevision: 0, revision: 1 } })
    first.set(cache.pixels ?? [])
    layer.pixels.set([0, 255, 0, 255], 0)
    captureTimelapseSnapshot(document, 2000, { cache, contentRevision: 2, contentInvalidation: { kind: 'region', fromRevision: 1, revision: 2, rect: { x: 0, y: 0, width: 1, height: 1 } } })

    expect(Array.from(cache.pixels ?? [])).not.toEqual(Array.from(first))
    expect(Array.from(cache.pixels?.slice(4) ?? [])).toEqual(Array.from(first.slice(4)))
  })
})
