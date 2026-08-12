import { afterEach, describe, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { activateAnimationFrame, addBlankAnimationFrame, connectAnimationCels, duplicateAnimationFrame, ensureAnimationDocument, syncActiveAnimationFrame } from './animation'
import { animationMaskAt, createDocument, createLayerMask, getActiveLayer, getLayerStorageOrigin, readLayerColorAt, writeLayerColor } from './document'
import { applySelectionTranslationPreview, captureSelectionTransform, restoreSelectionTranslationPreview } from './tools'
import { acceptProjectSaveBaseline, compactProjectRasterStorage, decodeProject, encodeProject, encodeProjectAsync, encodeProjectSaveAsync, PROJECT_SCHEMA_VERSION, migrateProjectManifest, readProjectGalleryMetadata, registerProjectSaveBaseline } from './project-format'

const zipCompressionMethods = (data: Uint8Array): Map<string, number> => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let eocd = data.byteLength - 22
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd -= 1
  if (eocd < 0) throw new Error('ZIP end record missing')
  const entries = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  const decoder = new TextDecoder()
  const methods = new Map<string, number>()
  for (let index = 0; index < entries; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('ZIP central entry missing')
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const name = decoder.decode(data.subarray(offset + 46, offset + 46 + nameLength))
    methods.set(name, view.getUint16(offset + 10, true))
    offset += 46 + nameLength + extraLength + commentLength
  }
  return methods
}

describe('project manifest migration boundary', () => {
  afterEach(() => vi.unstubAllGlobals())

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

  it('round-trips normalized layer panel context without keeping stale ids', () => {
    const document = createDocument('layer panel state', 2, 2, 'rgba')
    const activeLayerId = document.activeLayerId
    document.groups.push({ id: 'group-1', name: 'Group', parentGroupId: null, visible: false, locked: true, opacity: 1, blendMode: 'normal' })
    document.layerPanelState = {
      activeLayerId,
      selectedLayerIds: [activeLayerId, 'missing-layer'],
      selectedGroupIds: ['group-1', 'missing-group'],
      selectedGroupId: 'group-1',
      layerSelectionAnchorId: 'missing-layer',
      collapsedGroupIds: ['group-1', 'missing-group']
    }

    const restored = decodeProject(encodeProject(document))

    expect(restored.layerPanelState).toEqual({
      activeLayerId,
      selectedLayerIds: [activeLayerId],
      selectedGroupIds: ['group-1'],
      selectedGroupId: 'group-1',
      layerSelectionAnchorId: 'group-1',
      collapsedGroupIds: ['group-1']
    })
    expect(restored.groups[0]).toMatchObject({ visible: false, locked: true })
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

    const encoded = encodeProject(document)
    const restored = decodeProject(encoded)
    const methods = zipCompressionMethods(encoded)

    expect(restored.displaySettings).toEqual(document.displaySettings)
    expect(restored.statistics).toEqual(document.statistics)
    expect(restored.timelapse).toMatchObject({ enabled: true, quality: 'high', fps: 24, speed: 16 })
    expect(restored.timelapse?.snapshots[0]).toMatchObject({ id: 'timelapse-1000', capturedAt: 1000, elapsedMs: 0, width: 2, height: 2 })
    expect(Array.from(restored.timelapse?.snapshots[0].data ?? [])).toEqual([137, 80, 78, 71])
    expect(methods.get('timelapse/timelapse-1000.png')).toBe(0)
    expect(methods.get(`layers/${document.layers[0].id}.rgba`)).toBe(8)
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

  it('stores shared active and linked cel pixels only once', () => {
    const document = createDocument('deduplicated animation', 2, 1, 'rgba')
    getActiveLayer(document).pixels.set([255, 0, 0, 255, 0, 0, 0, 0])
    const timeline = ensureAnimationDocument(document)
    const secondFrameId = duplicateAnimationFrame(document)
    const first = timeline.cels.find((cel) => cel.frameId === timeline.frames[0].id)!
    const second = timeline.cels.find((cel) => cel.frameId === secondFrameId)!
    connectAnimationCels(document, [first.id, second.id])

    const files = unzipSync(encodeProject(document))
    const manifest = JSON.parse(strFromU8(files['manifest.json'])) as { document: { animation: { cels: Array<{ id: string; linkedCelId?: string; dataFile?: string }> } } }
    const storedCels = manifest.document.animation.cels
    const linked = storedCels.find((cel) => cel.id === second.id)!
    const pixelFiles = Object.keys(files).filter((name) => name.startsWith('layers/') || name.startsWith('cels/'))

    expect(linked).toMatchObject({ linkedCelId: first.id })
    expect(linked.dataFile).toBeUndefined()
    expect(pixelFiles).toHaveLength(1)

    const restored = decodeProject(zipSync(files))
    const restoredTimeline = ensureAnimationDocument(restored)
    const restoredFirst = restoredTimeline.cels.find((cel) => cel.id === first.id)!
    const restoredSecond = restoredTimeline.cels.find((cel) => cel.id === second.id)!
    expect(restoredSecond.linkedCelId).toBe(restoredFirst.id)
    expect(restoredSecond.surface).toBe(restoredFirst.surface)
    expect(restored.layers[0].pixels).toBe(restoredFirst.surface?.pixels)
  })

  it('round-trips the async archive and reports monotonic progress', async () => {
    const document = createDocument('async archive', 320, 256, 'rgba')
    writeLayerColor(document, getActiveLayer(document), 42, { r: 25, g: 50, b: 75, a: 255 })
    const progress: number[] = []

    const restored = decodeProject(await encodeProjectAsync(document, { onProgress: (value) => progress.push(value) }))

    expect(readLayerColorAt(restored, getActiveLayer(restored), 42, 0)).toEqual({ r: 25, g: 50, b: 75, a: 255 })
    expect(progress[0]).toBe(0)
    expect(progress.at(-1)).toBe(1)
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1])).toBe(true)
  })

  it('encodes only the changed cel and reuses unchanged compressed project blocks', async () => {
    const document = createDocument('incremental cel save', 4, 4, 'rgba')
    const secondFrameId = duplicateAnimationFrame(document)
    activateAnimationFrame(document, 'frame-1')
    document.timelapse!.snapshots = [{ id: 'snapshot-1', capturedAt: 1, elapsedMs: 0, width: 1, height: 1, data: new Uint8Array([137, 80, 78, 71]) }]
    const initial = encodeProject(document)
    registerProjectSaveBaseline(document, 'D:/gallery/incremental.moonsprite', initial)
    const initialFiles = unzipSync(initial)
    const initialManifest = JSON.parse(strFromU8(initialFiles['manifest.json'])) as { document: { animation: { cels: Array<{ frameId: string; dataFile?: string }> } } }
    const firstDataFile = initialManifest.document.animation.cels.find((cel) => cel.frameId === 'frame-1')!.dataFile!
    const secondDataFile = initialManifest.document.animation.cels.find((cel) => cel.frameId === secondFrameId)!.dataFile!

    writeLayerColor(document, getActiveLayer(document), 0, { r: 255, g: 0, b: 0, a: 255 })
    const encoded = await encodeProjectSaveAsync(document)
    const patch = unzipSync(encoded.data)
    const plan = JSON.parse(strFromU8(patch['.moonsprite-save-plan.json'])) as { entries: Array<{ path: string }> }

    expect(patch[firstDataFile]).toBeDefined()
    expect(patch[secondDataFile]).toBeUndefined()
    expect(patch['timelapse/snapshot-1.png']).toBeUndefined()
    expect(plan.entries.map((entry) => entry.path)).toEqual(expect.arrayContaining([secondDataFile, 'timelapse/snapshot-1.png']))
    expect(encoded.sourcePath).toBe('D:/gallery/incremental.moonsprite')
  })

  it('does not reuse a cel restored after an incremental save captured a floating preview', async () => {
    const document = createDocument('incremental floating preview', 4, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, { r: 255, g: 0, b: 0, a: 255 })
    const initial = encodeProject(document)
    const filePath = 'D:/gallery/floating-preview.moonsprite'
    registerProjectSaveBaseline(document, filePath, initial)
    const initialFiles = unzipSync(initial)
    const manifest = JSON.parse(strFromU8(initialFiles['manifest.json'])) as { document: { animation: { cels: Array<{ dataFile?: string }> } } }
    const dataFile = manifest.document.animation.cels[0].dataFile!
    const selection = { x: 0, y: 0, width: 1, height: 1 }
    const source = captureSelectionTransform(document, selection)!
    const preview = applySelectionTranslationPreview(document, source, { ...selection, x: 2 })
    const previewSave = await encodeProjectSaveAsync(document)
    acceptProjectSaveBaseline(document, filePath, previewSave)

    restoreSelectionTranslationPreview(document, preview)
    const restoredSave = await encodeProjectSaveAsync(document)
    const restoredPatch = unzipSync(restoredSave.data)

    expect(restoredPatch[dataFile]).toBeDefined()
  })

  it('reuses one project encode worker without detaching document pixels', async () => {
    const workers: FakeEncodeWorker[] = []
    class FakeEncodeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null
      constructor() { workers.push(this) }
      postMessage(message: { id: number; files: Zippable; compressionLevel: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }): void {
        const data = zipSync(message.files, { level: message.compressionLevel })
        this.onmessage?.({ data: { id: message.id, data } } as MessageEvent)
      }
      terminate(): void {}
    }
    vi.stubGlobal('Worker', FakeEncodeWorker)
    const first = createDocument('first worker save', 16, 16, 'rgba')
    const second = createDocument('second worker save', 16, 16, 'rgba')
    const firstPixels = first.layers[0].pixels

    expect(decodeProject(await encodeProjectAsync(first)).name).toBe('first worker save')
    expect(decodeProject(await encodeProjectAsync(second)).name).toBe('second worker save')
    expect(workers).toHaveLength(1)
    expect(first.layers[0].pixels).toBe(firstPixels)
    expect(firstPixels.byteLength).toBeGreaterThan(0)
  })

  it('skips the redundant layer copy in legacy single-frame archives', async () => {
    const document = createDocument('legacy duplicate', 2, 1, 'rgba')
    document.layers[0].pixels.set([255, 0, 0, 255, 0, 0, 0, 0])
    const files = unzipSync(encodeProject(document))
    const manifest = JSON.parse(strFromU8(files['manifest.json'])) as {
      document: {
        layers: Array<{ dataFile: string }>
        animation: { cels: Array<{ dataFile?: string }> }
      }
    }
    const celFile = manifest.document.animation.cels[0].dataFile!
    manifest.document.layers[0].dataFile = 'layers/legacy-duplicate.rgba'
    files['layers/legacy-duplicate.rgba'] = new Uint8Array([0, 255, 0, 255, 0, 0, 0, 0])
    files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest))

    const legacyArchive = zipSync(files)
    const restored = decodeProject(legacyArchive)

    expect(Array.from(restored.layers[0].pixels)).toEqual(Array.from(files[celFile]))
    expect(restored.layers[0].pixels).toBe(restored.animation?.cels[0].surface?.pixels)

    registerProjectSaveBaseline(restored, 'D:/gallery/legacy-duplicate.moonsprite', legacyArchive)
    const incremental = await encodeProjectSaveAsync(restored)
    const patch = unzipSync(incremental.data)
    const plan = JSON.parse(strFromU8(patch['.moonsprite-save-plan.json'])) as { entries: Array<{ path: string }> }
    expect(plan.entries.map((entry) => entry.path)).toContain(celFile)
    expect(plan.entries.map((entry) => entry.path)).not.toContain('layers/legacy-duplicate.rgba')
  })

  it('compacts transparent margins while preserving shared active cel coordinates', () => {
    const document = createDocument('sparse project', 8, 6, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 2 * layer.width + 3, { r: 255, g: 0, b: 0, a: 255 })
    writeLayerColor(document, layer, 3 * layer.width + 4, { r: 0, g: 0, b: 255, a: 255 })

    compactProjectRasterStorage(document, 0)

    expect(layer).toMatchObject({ width: 2, height: 2, offsetX: 3, offsetY: 2 })
    expect(getLayerStorageOrigin(layer)).toEqual({ x: 3, y: 2 })
    expect(layer.pixels).toBe(document.animation?.cels[0].surface?.pixels)
    expect(readLayerColorAt(document, layer, 3, 2)).toEqual({ r: 255, g: 0, b: 0, a: 255 })
    expect(readLayerColorAt(document, layer, 4, 3)).toEqual({ r: 0, g: 0, b: 255, a: 255 })

    const restored = decodeProject(encodeProject(document))
    expect(getActiveLayer(restored)).toMatchObject({ width: 2, height: 2, offsetX: 3, offsetY: 2 })
    expect(readLayerColorAt(restored, getActiveLayer(restored), 4, 3)).toEqual({ r: 0, g: 0, b: 255, a: 255 })
  })

  it('limits gallery previews for large projects to thumbnail dimensions', () => {
    const files = unzipSync(encodeProject(createDocument('large preview', 1024, 512, 'rgba')))
    const preview = files['preview.png']
    const view = new DataView(preview.buffer, preview.byteOffset, preview.byteLength)
    expect(view.getUint32(16)).toBe(512)
    expect(view.getUint32(20)).toBe(256)
  })

  it('generates a bounded gallery preview when the archive omitted preview.png', () => {
    const document = createDocument('generated preview', 1024, 512, 'rgba')
    writeLayerColor(document, document.layers[0], 0, { r: 255, g: 0, b: 0, a: 255 })
    const archive = encodeProject(document, { includePreview: false, compressionLevel: 1 })

    expect(() => readProjectGalleryMetadata(archive)).toThrow()
    const metadata = readProjectGalleryMetadata(archive, { generateMissingPreview: true })
    const view = new DataView(metadata.preview.buffer, metadata.preview.byteOffset, metadata.preview.byteLength)

    expect(metadata).toMatchObject({ name: 'generated preview', width: 1024, height: 512, colorMode: 'rgba' })
    expect([...metadata.preview.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(view.getUint32(16)).toBe(512)
    expect(view.getUint32(20)).toBe(256)
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
