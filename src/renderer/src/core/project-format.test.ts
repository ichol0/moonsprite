import { describe, expect, it } from 'vitest'
import { unzipSync, zipSync } from 'fflate'
import { activateAnimationFrame, addBlankAnimationFrame, duplicateAnimationFrame, ensureAnimationDocument, syncActiveAnimationFrame } from './animation'
import { animationMaskAt, createDocument, createLayerMask, getActiveLayer, writeLayerColor } from './document'
import { decodeProject, encodeProject, PROJECT_SCHEMA_VERSION, migrateProjectManifest } from './project-format'

describe('project manifest migration boundary', () => {
  it('accepts the current schema through the migration entry point', () => {
    const manifest = { app: 'MoonSprite', schemaVersion: PROJECT_SCHEMA_VERSION, document: { schemaVersion: PROJECT_SCHEMA_VERSION } }
    expect(migrateProjectManifest(manifest)).toMatchObject({ ...manifest, document: { ...manifest.document, animation: { activeFrameId: 'frame-1' } } })
  })

  it('migrates the v1 single-frame document into the animation-ready schema', () => {
    expect(migrateProjectManifest({ app: 'MoonSprite', schemaVersion: 1, document: { schemaVersion: 1 } })).toMatchObject({ schemaVersion: PROJECT_SCHEMA_VERSION, document: { schemaVersion: PROJECT_SCHEMA_VERSION, animation: { frames: [{ id: 'frame-1', duration: 100 }] } } })
  })

  it('migrates v2 projects to the layer-mask schema without inventing masks', () => {
    const migrated = migrateProjectManifest({ app: 'MoonSprite', schemaVersion: 2, document: { schemaVersion: 2, groups: [], animation: { frames: [{ id: 'frame-1', duration: 100 }], cels: [], activeFrameId: 'frame-1', loop: true } } })
    expect(migrated).toMatchObject({ schemaVersion: PROJECT_SCHEMA_VERSION, document: { schemaVersion: PROJECT_SCHEMA_VERSION, groups: [] } })
  })

  it('rejects unknown versions without guessing their fields', () => {
    expect(() => migrateProjectManifest({ app: 'MoonSprite', schemaVersion: 5, document: { schemaVersion: 5 } })).toThrow()
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

  it('round-trips fixed palette slots including empty positions', () => {
    const document = createDocument('palette slots', 2, 2, 'rgba')
    document.paletteColumns = 16
    document.paletteSlots = new Array(64).fill(null)
    document.paletteSlots[9] = document.paletteOrder[0]
    document.paletteSlots[23] = document.paletteOrder[1]

    const restored = decodeProject(encodeProject(document))

    expect(restored.paletteColumns).toBe(16)
    expect(restored.paletteSlots).toHaveLength(64)
    expect(restored.paletteSlots?.[9]).toBe(document.paletteOrder[0])
    expect(restored.paletteSlots?.[23]).toBe(document.paletteOrder[1])
    expect(restored.paletteOrder).toEqual(document.paletteOrder)
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

  it('round-trips transparent cell masks with independent ownership', () => {
    const document = createDocument('cell masks', 2, 1, 'rgba')
    const firstCel = ensureAnimationDocument(document).cels[0]
    firstCel.mask = createLayerMask(firstCel.id, 2, 1)
    writeLayerColor(document, firstCel.mask, 0, { r: 32, g: 32, b: 32, a: 255 })
    const secondFrameId = duplicateAnimationFrame(document)
    const secondCel = ensureAnimationDocument(document).cels.find((cel) => cel.frameId === secondFrameId)!
    writeLayerColor(document, secondCel.mask!, 1, { r: 96, g: 96, b: 96, a: 255 })

    const restored = decodeProject(encodeProject(document))
    const restoredTimeline = ensureAnimationDocument(restored)
    const restoredFirst = restoredTimeline.cels.find((cel) => cel.frameId === restoredTimeline.frames[0].id)!
    const restoredSecond = restoredTimeline.cels.find((cel) => cel.frameId === restoredTimeline.frames[1].id)!

    expect(restoredFirst.mask).toMatchObject({ ownerKind: 'cel', ownerId: restoredFirst.id, format: 'rgba' })
    expect(restoredFirst.mask?.pixels).toEqual(new Uint8ClampedArray([32, 32, 32, 255, 0, 0, 0, 0]))
    expect(restoredSecond.mask).toMatchObject({ ownerKind: 'cel', ownerId: restoredSecond.id, format: 'rgba' })
    expect(restoredSecond.mask?.pixels).toEqual(new Uint8ClampedArray([32, 32, 32, 255, 96, 96, 96, 255]))
    expect(restored.layers[0]).not.toHaveProperty('dataFile')
  })

  it('migrates v3 projects and round-trips frame-specific layer-group masks', () => {
    expect(migrateProjectManifest({ app: 'MoonSprite', schemaVersion: 3, document: { schemaVersion: 3 } })).toMatchObject({ schemaVersion: PROJECT_SCHEMA_VERSION, document: { schemaVersion: PROJECT_SCHEMA_VERSION } })
    const document = createDocument('group masks', 1, 1, 'rgba')
    const group = { id: 'group-1', name: 'Group', visible: true, locked: false, opacity: 1, blendMode: 'normal' as const }
    document.groups.push(group)
    document.layers[0].groupId = group.id
    const timeline = ensureAnimationDocument(document)
    const mask = createLayerMask(group.id, 1, 1, 'group')
    writeLayerColor(document, mask, 0, { r: 96, g: 96, b: 96, a: 255 })
    timeline.groupMasks = [{ groupId: group.id, frameId: timeline.activeFrameId, mask }]

    const restored = decodeProject(encodeProject(document))
    const restoredMask = ensureAnimationDocument(restored).groupMasks?.[0]
    expect(restoredMask).toMatchObject({ groupId: group.id, frameId: timeline.activeFrameId, mask: { ownerKind: 'group', ownerId: group.id } })
    expect(restoredMask?.mask.pixels).toEqual(new Uint8ClampedArray([96, 96, 96, 255]))
  })

  it('round-trips independent layer-mask links', () => {
    const document = createDocument('linked masks', 1, 1, 'rgba')
    const timeline = ensureAnimationDocument(document)
    const firstFrameId = timeline.activeFrameId
    const secondFrameId = addBlankAnimationFrame(document)
    const first = timeline.cels.find((cel) => cel.frameId === firstFrameId)!
    const second = timeline.cels.find((cel) => cel.frameId === secondFrameId)!
    first.mask = createLayerMask(first.id, 1, 1)
    first.mask.pixels.set([72, 72, 72, 255])
    second.mask = createLayerMask(second.id, 1, 1)
    second.mask.linkedMaskId = first.mask.id

    const restored = decodeProject(encodeProject(document))
    const restoredTimeline = ensureAnimationDocument(restored)
    const restoredFirst = restoredTimeline.cels.find((cel) => cel.frameId === firstFrameId)!
    const restoredSecond = restoredTimeline.cels.find((cel) => cel.frameId === secondFrameId)!

    expect(restoredSecond.mask?.linkedMaskId).toBe(restoredFirst.mask?.id)
    expect(animationMaskAt(restoredTimeline, restored.activeLayerId, secondFrameId)?.pixels[0]).toBe(72)
  })

  it('rejects missing or corrupt cell-mask data', () => {
    const document = createDocument('corrupt mask', 1, 1, 'rgba')
    const cel = ensureAnimationDocument(document).cels[0]
    cel.mask = createLayerMask(cel.id, 1, 1)
    const files = unzipSync(encodeProject(document))
    const maskFile = Object.keys(files).find((name) => name.startsWith('masks/'))!
    files[maskFile] = new Uint8Array(0)

    expect(() => decodeProject(zipSync(files))).toThrow('图层蒙版')
  })
})
