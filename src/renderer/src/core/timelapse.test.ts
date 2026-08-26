import { describe, expect, it } from 'vitest'
import { captureTimelapseSnapshot, captureTimelapseSnapshotAsync, commitPreparedTimelapseSnapshot, createTimelapseCaptureCache, prepareTimelapseSnapshot, resolveTimelapseMimeType, TIMELAPSE_SMART_TARGET_FRAMES, timelapseFrameDurations, timelapseFrameHoldMs, timelapseImageOutputDimensions, timelapseOutputDimensions, timelapseOutputScale, timelapseSourceDurationMs, timelapseVideoFramePlan } from './timelapse'
import { createDocument, getActiveLayer, readLayerColor, writeLayerColor } from './document'
import { decodePng } from './png'
import { normalizeTimelapseSettings } from './project-metadata'

describe('timelapse video encoding helpers', () => {
  it('normalizes legacy settings to full recording mode', () => {
    expect(normalizeTimelapseSettings({ enabled: true, quality: 'low', fps: 12, speed: 8, snapshots: [] }).mode).toBe('full')
    expect(normalizeTimelapseSettings({ enabled: true, quality: 'low', fps: 12, speed: 8, mode: 'smart', snapshots: [] }).mode).toBe('smart')
  })
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

  it('samples enough distinct operation frames for short fixed-FPS exports', () => {
    const settings = { fps: 12, speed: 1, snapshots: Array.from({ length: 100 }, (_, index) => ({ elapsedMs: index * 10 })) } as never
    const oneSecond = timelapseVideoFramePlan(settings, { mode: 'duration', durationSeconds: 1 })
    const twoSeconds = timelapseVideoFramePlan(settings, { mode: 'duration', durationSeconds: 2 })

    expect(oneSecond).toHaveLength(12)
    expect(twoSeconds).toHaveLength(24)
    expect(oneSecond[0].snapshotIndex).toBe(0)
    expect(oneSecond.at(-1)?.snapshotIndex).toBe(99)
    expect(new Set(oneSecond.map((frame) => frame.snapshotIndex)).size).toBeGreaterThan(10)
    expect(timelapseImageOutputDimensions([{ width: 8, height: 4 }, { width: 16, height: 8 }] as never, 200)).toEqual({ width: 32, height: 16 })
  })

  it('freezes prepared frame pixels before later operations can change them', async () => {
    const document = createDocument('prepared timelapse', 2, 1, 'rgba')
    const layer = getActiveLayer(document)
    document.timelapse = { enabled: true, quality: 'low', fps: 12, speed: 8, mode: 'full', snapshots: [] }
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
    document.timelapse = { enabled: true, quality: 'low', fps: 12, speed: 8, mode: 'full', snapshots: [] }

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
    document.timelapse = { enabled: true, quality: 'low', fps: 12, speed: 8, mode: 'full', snapshots: [] }

    captureTimelapseSnapshot(document, 1000, { cache, contentRevision: 1, contentInvalidation: { kind: 'full', fromRevision: 0, revision: 1 } })

    expect(cache).toMatchObject({ sourceWidth: 4000, sourceHeight: 2000, width: 640, height: 320, revision: 1 })
    expect(cache.pixels).toHaveLength(640 * 320 * 4)
    expect(document.timelapse.snapshots[0]).toMatchObject({ width: 640, height: 320 })
  })

  it('retains the complete snapshot history beyond 600 captures', () => {
    const document = createDocument('unbounded timelapse', 1, 1, 'rgba')
    document.timelapse = {
      enabled: true,
      quality: 'low',
      fps: 12,
      speed: 8,
      mode: 'full',
      snapshots: Array.from({ length: 600 }, (_, index) => ({
        id: `snapshot-${index}`,
        capturedAt: index,
        elapsedMs: index,
        width: 1,
        height: 1,
        data: new Uint8Array([137, 80, 78, 71])
      }))
    }

    captureTimelapseSnapshot(document, 600)

    expect(document.timelapse.snapshots).toHaveLength(601)
    expect(document.timelapse.snapshots[0].id).toBe('snapshot-0')
    expect(document.timelapse.snapshots.at(-1)?.capturedAt).toBe(600)
  })

  it('encodes a capture asynchronously without detaching the reusable pixels', async () => {
    const document = createDocument('async timelapse', 2, 1, 'rgba')
    const cache = createTimelapseCaptureCache()
    document.timelapse = { enabled: true, quality: 'low', fps: 12, speed: 8, mode: 'full', snapshots: [] }

    await captureTimelapseSnapshotAsync(document, 1000, { cache, contentRevision: 1, contentInvalidation: { kind: 'full', fromRevision: 0, revision: 1 } })

    expect(cache.pixels).toHaveLength(8)
    expect(document.timelapse.snapshots[0].data.slice(0, 8)).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
  })

  it('discards an asynchronous capture when the document revision changes', async () => {
    const document = createDocument('stale timelapse', 128, 128, 'rgba')
    const cache = createTimelapseCaptureCache()
    let currentRevision = 1
    document.timelapse = { enabled: true, quality: 'low', fps: 12, speed: 8, mode: 'full', snapshots: [] }

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

  it('keeps every operation in full recording mode, including identical frames', () => {
    const document = createDocument('full timelapse mode', 2, 1, 'rgba')
    const cache = createTimelapseCaptureCache()
    document.timelapse = { enabled: true, quality: 'low', fps: 12, speed: 8, mode: 'full', snapshots: [] }

    captureTimelapseSnapshot(document, 1000, { cache })
    captureTimelapseSnapshot(document, 2000, { cache })

    expect(document.timelapse.snapshots).toHaveLength(2)
  })

  it('keeps the first adaptive sampling level at one frame per operation', () => {
    const document = createDocument('smart timelapse first level', 1, 1, 'rgba')
    document.timelapse = { enabled: true, quality: 'low', fps: 12, speed: 8, mode: 'smart', snapshots: [] }

    for (let index = 0; index < TIMELAPSE_SMART_TARGET_FRAMES; index += 1) captureTimelapseSnapshot(document, 1000 + index)

    expect(document.timelapse.snapshots).toHaveLength(TIMELAPSE_SMART_TARGET_FRAMES)
  })

  it('doubles the sampling interval and halves existing frames at each smart level', () => {
    const document = createDocument('smart timelapse levels', 1, 1, 'rgba')
    const cache = createTimelapseCaptureCache()
    document.timelapse = { enabled: true, quality: 'low', fps: 12, speed: 8, mode: 'smart', snapshots: [] }

    for (let index = 0; index < TIMELAPSE_SMART_TARGET_FRAMES; index += 1) captureTimelapseSnapshot(document, 1000 + index, { cache })
    captureTimelapseSnapshot(document, 2000, { cache })
    expect(document.timelapse.snapshots).toHaveLength(Math.ceil(TIMELAPSE_SMART_TARGET_FRAMES / 2) + 1)
    expect(document.timelapse.snapshots[0].capturedAt).toBe(1000)
    expect(document.timelapse.snapshots[1].capturedAt).toBe(1002)
    expect(document.timelapse.snapshots.at(-1)?.capturedAt).toBe(2000)

    captureTimelapseSnapshot(document, 2001, { cache })
    expect(document.timelapse.snapshots).toHaveLength(Math.ceil(TIMELAPSE_SMART_TARGET_FRAMES / 2) + 1)
    captureTimelapseSnapshot(document, 2002, { cache })
    expect(document.timelapse.snapshots).toHaveLength(Math.ceil(TIMELAPSE_SMART_TARGET_FRAMES / 2) + 2)

    let timestamp = 3000
    while (document.timelapse.snapshots.length < TIMELAPSE_SMART_TARGET_FRAMES) {
      captureTimelapseSnapshot(document, timestamp, { cache })
      timestamp += 1
    }
    expect(document.timelapse.snapshots).toHaveLength(TIMELAPSE_SMART_TARGET_FRAMES)
    captureTimelapseSnapshot(document, timestamp, { cache })
    expect(document.timelapse.snapshots).toHaveLength(Math.ceil(TIMELAPSE_SMART_TARGET_FRAMES / 2) + 1)
  })

  it('keeps smart recording bounded while progressively reducing sampling frequency', () => {
    const document = createDocument('smart timelapse bounded', 1, 1, 'rgba')
    const cache = createTimelapseCaptureCache()
    document.timelapse = { enabled: true, quality: 'low', fps: 12, speed: 8, mode: 'smart', snapshots: [] }

    const operationCount = TIMELAPSE_SMART_TARGET_FRAMES * 8
    for (let index = 0; index < operationCount; index += 1) captureTimelapseSnapshot(document, index, { cache })

    expect(document.timelapse.snapshots.length).toBeLessThanOrEqual(TIMELAPSE_SMART_TARGET_FRAMES + 1)
    expect(document.timelapse.snapshots.length).toBeGreaterThan(0)
  })
})
