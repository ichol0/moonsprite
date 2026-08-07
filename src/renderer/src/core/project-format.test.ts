import { describe, expect, it } from 'vitest'
import { activateAnimationFrame, duplicateAnimationFrame, ensureAnimationDocument, syncActiveAnimationFrame } from './animation'
import { createDocument, getActiveLayer } from './document'
import { decodeProject, encodeProject, PROJECT_SCHEMA_VERSION, migrateProjectManifest } from './project-format'

describe('project manifest migration boundary', () => {
  it('accepts the current schema through the migration entry point', () => {
    const manifest = { app: 'MoonSprite', schemaVersion: PROJECT_SCHEMA_VERSION, document: { schemaVersion: PROJECT_SCHEMA_VERSION } }
    expect(migrateProjectManifest(manifest)).toMatchObject({ ...manifest, document: { ...manifest.document, animation: { activeFrameId: 'frame-1' } } })
  })

  it('migrates the v1 single-frame document into the animation-ready schema', () => {
    expect(migrateProjectManifest({ app: 'MoonSprite', schemaVersion: 1, document: { schemaVersion: 1 } })).toMatchObject({ schemaVersion: PROJECT_SCHEMA_VERSION, document: { schemaVersion: PROJECT_SCHEMA_VERSION, animation: { frames: [{ id: 'frame-1', duration: 100 }] } } })
  })

  it('rejects unknown versions without guessing their fields', () => {
    expect(() => migrateProjectManifest({ app: 'MoonSprite', schemaVersion: 3, document: { schemaVersion: 3 } })).toThrow()
    expect(() => migrateProjectManifest({ app: 'Other', schemaVersion: 1, document: { schemaVersion: 1 } })).toThrow()
  })

  it('round-trips project-owned outline settings', () => {
    const document = createDocument('outline settings', 2, 2, 'rgba')
    document.outlineSettings = {
      color: { r: 10, g: 20, b: 30, a: 255 },
      thickness: 3,
      position: 'inside',
      kernel: 'square',
      directions: { nw: true, n: false, ne: true, w: true, e: true, sw: false, s: true, se: false },
      previewEnabled: false
    }

    expect(decodeProject(encodeProject(document)).outlineSettings).toEqual(document.outlineSettings)
  })

  it('round-trips project display settings, statistics, and timelapse assets', () => {
    const document = createDocument('project metadata', 2, 2, 'rgba')
    document.displaySettings = { showPixelGrid: true, showGrid: true, grid: { x: 3, y: 4, width: 12, height: 18 } }
    document.statistics = { strokeCount: 42, operationCount: 68, drawingTimeMs: 123_456 }
    document.timelapse = {
      enabled: true,
      quality: 'high',
      fps: 24,
      speed: 16,
      snapshots: [{ id: 'timelapse-1000', capturedAt: 1000, elapsedMs: 0, width: 2, height: 2, data: new Uint8Array([137, 80, 78, 71]) }]
    }

    const restored = decodeProject(encodeProject(document))

    expect(restored.displaySettings).toEqual(document.displaySettings)
    expect(restored.statistics).toEqual(document.statistics)
    expect(restored.timelapse).toMatchObject({ enabled: true, quality: 'high', fps: 24, speed: 16 })
    expect(restored.timelapse?.snapshots[0]).toMatchObject({ id: 'timelapse-1000', capturedAt: 1000, elapsedMs: 0, width: 2, height: 2 })
    expect(Array.from(restored.timelapse?.snapshots[0].data ?? [])).toEqual([137, 80, 78, 71])
  })

  it('round-trips independent cel pixels and frame durations', () => {
    const document = createDocument('animated', 2, 2, 'rgba')
    getActiveLayer(document).pixels[3] = 255
    const second = duplicateAnimationFrame(document)
    getActiveLayer(document).pixels[3] = 64
    getActiveLayer(document).opacity = 0.4
    ensureAnimationDocument(document).frames[1].duration = 240
    syncActiveAnimationFrame(document)

    const restored = decodeProject(encodeProject(document))
    expect(restored.animation?.frames.map((frame) => frame.duration)).toEqual([100, 240])
    expect(restored.animation?.activeFrameId).toBe(second)
    expect(getActiveLayer(restored).pixels[3]).toBe(64)
    expect(getActiveLayer(restored).opacity).toBeCloseTo(0.4)
    activateAnimationFrame(restored, 'frame-1')
    expect(getActiveLayer(restored).pixels[3]).toBe(255)
    expect(getActiveLayer(restored).opacity).toBeCloseTo(1)
  })
})
