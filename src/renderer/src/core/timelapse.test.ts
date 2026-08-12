import { describe, expect, it } from 'vitest'
import { captureTimelapseSnapshot, captureTimelapseSnapshotAsync, commitPreparedTimelapseSnapshot, createTimelapseCaptureCache, prepareTimelapseSnapshot, resolveTimelapseMimeType, timelapseFrameDurations, timelapseFrameHoldMs, timelapseOutputDimensions, timelapseOutputScale, timelapseSourceDurationMs } from './timelapse'
import { createDocument, getActiveLayer, readLayerColor, writeLayerColor } from './document'
import { decodePng } from './png'

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

  it('gives every operation frame equal playback time at the selected FPS and speed', () => {
    expect(timelapseFrameHoldMs({ elapsedMs: 800 } as never, { fps: 12, speed: 8 })).toBeCloseTo(1000 / 96)
    expect(timelapseFrameHoldMs({ elapsedMs: 4000 } as never, { fps: 12, speed: 1 })).toBeCloseTo(1000 / 12)
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
    expect(timelapseSourceDurationMs(settings)).toBeCloseTo(1000 / 6)
    expect(timelapseFrameDurations(settings, { mode: 'duration', durationSeconds: 10 })).toEqual([5000, 5000])
    expect(timelapseFrameDurations(settings, { mode: 'speed', durationSeconds: 1 })).toEqual([1000 / 48, 1000 / 48])
  })

  it('freezes prepared frame pixels before later operations can change them', async () => {
    const document = createDocument('prepared timelapse', 2, 1, 'rgba')
    const layer = getActiveLayer(document)
    document.timelapse = { enabled: true, quality: 'low', fps: 12, speed: 8, snapshots: [] }
    writeLayerColor(document, layer, 0, { r: 255, g: 0, b: 0, a: 255 })

    const prepared = prepareTimelapseSnapshot(document, 1000)
    expect(prepared).not.toBeNull()
    writeLayerColor(document, layer, 0, { r: 0, g: 255, b: 0, a: 255 })
    await commitPreparedTimelapseSnapshot(document, prepared!)

    const decoded = decodePng(document.timelapse.snapshots[0].data)
    expect(readLayerColor(decoded, getActiveLayer(decoded), 0)).toEqual({ r: 255, g: 0, b: 0, a: 255 })
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

  it('retains only quality-sized pixels while capturing a large canvas', () => {
    const document = createDocument('large timelapse cache', 4000, 2000, 'rgba')
    const cache = createTimelapseCaptureCache()
    document.timelapse = { enabled: true, quality: 'low', fps: 12, speed: 8, snapshots: [] }

    captureTimelapseSnapshot(document, 1000, { cache, contentRevision: 1, contentInvalidation: { kind: 'full', fromRevision: 0, revision: 1 } })

    expect(cache).toMatchObject({ sourceWidth: 4000, sourceHeight: 2000, width: 640, height: 320, revision: 1 })
    expect(cache.pixels).toHaveLength(640 * 320 * 4)
    expect(document.timelapse.snapshots[0]).toMatchObject({ width: 640, height: 320 })
  })

  it('encodes a capture asynchronously without detaching the reusable pixels', async () => {
    const document = createDocument('async timelapse', 2, 1, 'rgba')
    const cache = createTimelapseCaptureCache()
    document.timelapse = { enabled: true, quality: 'low', fps: 12, speed: 8, snapshots: [] }

    await captureTimelapseSnapshotAsync(document, 1000, { cache, contentRevision: 1, contentInvalidation: { kind: 'full', fromRevision: 0, revision: 1 } })

    expect(cache.pixels).toHaveLength(8)
    expect(document.timelapse.snapshots[0].data.slice(0, 8)).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
  })

  it('discards an asynchronous capture when the document revision changes', async () => {
    const document = createDocument('stale timelapse', 128, 128, 'rgba')
    const cache = createTimelapseCaptureCache()
    let currentRevision = 1
    document.timelapse = { enabled: true, quality: 'low', fps: 12, speed: 8, snapshots: [] }

    const capture = captureTimelapseSnapshotAsync(document, 1000, {
      cache,
      contentRevision: 1,
      contentInvalidation: { kind: 'full', fromRevision: 0, revision: 1 },
      shouldCommit: () => currentRevision === 1
    })
    currentRevision = 2
    await capture

    expect(document.timelapse.snapshots).toHaveLength(0)
  })
})
