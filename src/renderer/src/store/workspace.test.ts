import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MoonSpriteApi } from '@shared/types'
import { animationMaskAt, compositeDocument, createDocument, createLayer, createLayerMask, ensureLayerCoversCanvas, getActiveLayer, isLayerEffectivelyLocked, isLayerEffectivelyVisible, readLayerColor, readLayerColorAt, writeLayerColor } from '@/core/document'
import { beginPixelEdit, recordPixel, revertPixelEdit } from '@/core/history'
import { packColor, relativeLuminanceColor } from '@/core/raster'
import { applySelectionTransform, applySelectionTranslationPreview, captureSelectionTransform, selectionTranslationPreviewEdit } from '@/core/tools'
import { builtInPalettes } from '@/core/built-in-palettes'
import { createProceduralBrush } from '@/core/brushes'
import { addBlankAnimationFrame, animationCelAt, animationCelKey, ensureAnimationDocument, resolveAnimationCel } from '@/core/animation'
import { buildLayerPanelTree } from '@/core/layer-panel-layout'
import { transformSelectionMask } from '@/core/selection'
import { registerViewPreviewFlusher } from '@/core/view-preview-lifecycle'
import { RECENT_EXPORT_PATHS_STORAGE_KEY } from '@/core/export-settings'
import { decodeProject } from '@/core/project-format'
import { repositionPaletteSlots } from '@/core/palette-layout'
import { useWorkspace } from './workspace'

const transparent = { r: 0, g: 0, b: 0, a: 0 }
const red = { r: 255, g: 0, b: 0, a: 255 }
const blue = { r: 0, g: 80, b: 255, a: 255 }

function installApi(overrides: Partial<MoonSpriteApi> = {}): MoonSpriteApi {
  const api = {
    getResourceInfo: vi.fn(async () => ({ totalBytes: 8_000_000_000, freeBytes: 4_000_000_000 })),
    writeClipboardImage: vi.fn(async () => {}),
    readClipboardImage: vi.fn(async () => null),
    writeRecovery: vi.fn(async () => {}),
    deleteRecovery: vi.fn(async () => {}),
    ...overrides
  } as unknown as MoonSpriteApi
  Object.defineProperty(window, 'moonSprite', { configurable: true, writable: true, value: api })
  return api
}

beforeEach(() => {
  installApi()
  localStorage.clear()
  useWorkspace.setState({ sessions: [], activeId: null, message: null, saveProgress: null, dialog: null })
})

describe('gradient tool settings', () => {
  it('keeps gradient tolerance and contiguous mode independent from the paint bucket', () => {
    const document = createDocument('gradient settings', 2, 2, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setFillTolerance(24)
    useWorkspace.getState().setFillMode('global')
    useWorkspace.getState().setGradientTolerance(86)
    useWorkspace.getState().setGradientContiguous(false)

    expect(useWorkspace.getState().sessions[0]).toMatchObject({
      fillTolerance: 24,
      fillMode: 'global',
      gradientTolerance: 86,
      gradientContiguous: false
    })
  })
})

describe('pixel content invalidation', () => {
  it('tracks the edited document region for commit, undo, and redo', () => {
    const document = createDocument('dirty region', 8, 6, 'rgba')
    const layer = getActiveLayer(document)
    useWorkspace.getState().addSession(document)
    const edit = beginPixelEdit(layer.id)
    recordPixel(document, layer, edit, 2 + 1 * layer.width, 0xff0000ff)
    recordPixel(document, layer, edit, 5 + 4 * layer.width, 0xff0000ff)

    useWorkspace.getState().commitPixelEdit(edit, 'paint')
    let session = useWorkspace.getState().sessions[0]
    expect(session.contentInvalidation).toEqual({
      kind: 'region',
      frameId: document.animation!.activeFrameId,
      rect: { x: 2, y: 1, width: 4, height: 4 },
      fromRevision: 0,
      revision: 1
    })

    useWorkspace.getState().undo()
    session = useWorkspace.getState().sessions[0]
    expect(session.contentInvalidation).toMatchObject({ kind: 'region', rect: { x: 2, y: 1, width: 4, height: 4 }, fromRevision: 1, revision: 2 })

    useWorkspace.getState().redo()
    session = useWorkspace.getState().sessions[0]
    expect(session.contentInvalidation).toMatchObject({ kind: 'region', rect: { x: 2, y: 1, width: 4, height: 4 }, fromRevision: 2, revision: 3 })
  })

  it('creates, edits, deletes, and restores a mask owned by one animation cell', () => {
    const document = createDocument('mask history', 1, 1, 'rgba')
    getActiveLayer(document).pixels[3] = 255
    const cel = ensureAnimationDocument(document).cels[0]
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().createLayerMask(cel.id)
    const mask = cel.mask!
    useWorkspace.getState().selectAnimationMaskCell(animationCelKey(cel.layerId, cel.frameId))
    expect(readLayerColor(document, mask, 0)).toEqual(transparent)
    expect(useWorkspace.getState().sessions[0]).toMatchObject({ activeLayerMaskId: mask.id, layerMaskIsolatedView: false })
    const edit = beginPixelEdit(mask.id)
    recordPixel(document, mask, edit, 0, packColor({ r: 255, g: 0, b: 0, a: 255 }))

    useWorkspace.getState().commitPixelEdit(edit, 'paint mask')
    let session = useWorkspace.getState().sessions[0]
    expect(session.activeLayerMaskId).toBe(mask.id)
    expect(session.selectedAnimationMaskCellKeys).toEqual([])
    expect(readLayerColor(document, mask, 0)).toEqual({ r: 54, g: 54, b: 54, a: 255 })
    expect(session.contentInvalidation).toMatchObject({ kind: 'region', frameId: cel.frameId })

    useWorkspace.getState().undo()
    expect(readLayerColor(document, mask, 0)).toEqual(transparent)
    useWorkspace.getState().redo()
    expect(readLayerColor(document, mask, 0)).toEqual({ r: 54, g: 54, b: 54, a: 255 })

    useWorkspace.getState().deleteLayerMask(cel.id)
    expect(cel.mask).toBeUndefined()
    expect(useWorkspace.getState().sessions[0].activeLayerMaskId).toBeNull()
    useWorkspace.getState().undo()
    session = useWorkspace.getState().sessions[0]
    expect(cel.mask?.id).toBe(mask.id)
    expect(session.activeLayerMaskId).toBe(mask.id)
  })

  it('rejects layer-mask creation and paste targets whose cels have no visible content', () => {
    const document = createDocument('empty mask target', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    const timeline = ensureAnimationDocument(document)
    const firstCel = timeline.cels[0]

    useWorkspace.getState().createLayerMask(firstCel.id)
    expect(firstCel.mask).toBeUndefined()
    expect(useWorkspace.getState().message).toBe('图层单元格没有可见内容，无法创建或粘贴图层蒙版。')

    firstCel.surface!.pixels[3] = 255
    getActiveLayer(document).pixels[3] = 255
    useWorkspace.getState().createLayerMask(firstCel.id)
    useWorkspace.getState().copySelectedAnimationMasks()
    const emptyFrameId = addBlankAnimationFrame(document)
    const emptyCel = animationCelAt(ensureAnimationDocument(document), document.activeLayerId, emptyFrameId)!

    useWorkspace.getState().pasteAnimationMasks(document.activeLayerId, emptyFrameId)
    expect(emptyCel.mask).toBeUndefined()
  })

  it('creates, edits, and restores a frame-specific layer-group mask', () => {
    const document = createDocument('group mask history', 1, 1, 'rgba')
    const group = { id: 'group-1', name: 'Group', visible: true, locked: false, opacity: 1, blendMode: 'normal' as const }
    document.groups.push(group)
    document.layers[0].groupId = group.id
    useWorkspace.getState().addSession(document)
    const frameId = ensureAnimationDocument(document).activeFrameId

    useWorkspace.getState().createGroupMask(group.id, frameId)
    const mask = ensureAnimationDocument(document).groupMasks?.[0]?.mask
    expect(mask).toMatchObject({ ownerKind: 'group', ownerId: group.id })
    const edit = beginPixelEdit(mask!.id)
    recordPixel(document, mask!, edit, 0, packColor({ r: 0, g: 0, b: 0, a: 255 }))
    useWorkspace.getState().commitPixelEdit(edit, 'paint group mask')
    expect(useWorkspace.getState().sessions[0].activeLayerMaskId).toBe(mask!.id)
    expect(useWorkspace.getState().sessions[0].selectedAnimationMaskCellKeys).toEqual([])

    useWorkspace.getState().deleteGroupMask(group.id, frameId)
    expect(ensureAnimationDocument(document).groupMasks).toEqual([])
    useWorkspace.getState().undo()
    expect(ensureAnimationDocument(document).groupMasks?.[0]?.mask.id).toBe(mask!.id)
  })

  it('copies, links, unlinks, pastes, and moves only layer-mask cells', () => {
    const document = createDocument('mask cell operations', 1, 1, 'rgba')
    const firstFrameId = ensureAnimationDocument(document).activeFrameId
    const secondFrameId = addBlankAnimationFrame(document)
    const thirdFrameId = addBlankAnimationFrame(document)
    const timeline = ensureAnimationDocument(document)
    const cels = timeline.frames.map((frame) => animationCelAt(timeline, document.activeLayerId, frame.id)!)
    cels.forEach((cel, index) => {
      cel.surface!.pixels.set([10 + index, 20 + index, 30 + index, 255])
      cel.mask = createLayerMask(cel.id, 1, 1)
      cel.mask.pixels.set([40 + index * 80, 40 + index * 80, 40 + index * 80, 255])
    })
    const celPixelsBefore = cels.map((cel) => Array.from(cel.surface!.pixels))
    useWorkspace.getState().addSession(document)
    const firstKey = animationCelKey(document.activeLayerId, firstFrameId)
    const secondKey = animationCelKey(document.activeLayerId, secondFrameId)
    const thirdKey = animationCelKey(document.activeLayerId, thirdFrameId)

    useWorkspace.getState().selectAnimationMaskCell(firstKey)
    useWorkspace.getState().selectAnimationMaskCell(secondKey, 'toggle')
    useWorkspace.getState().connectSelectedAnimationMasks()
    expect(cels[1].mask?.linkedMaskId).toBe(cels[0].mask?.id)
    expect(animationMaskAt(timeline, document.activeLayerId, secondFrameId)?.pixels[0]).toBe(40)

    useWorkspace.getState().selectAnimationMaskCell(secondKey)
    useWorkspace.getState().disconnectSelectedAnimationMasks()
    expect(cels[1].mask?.linkedMaskId).toBeNull()
    expect(cels[1].mask?.pixels[0]).toBe(40)

    useWorkspace.getState().copySelectedAnimationMasks()
    useWorkspace.getState().pasteAnimationMasks(document.activeLayerId, thirdFrameId)
    expect(cels[2].mask?.pixels[0]).toBe(40)
    expect(cels[2].mask?.linkedMaskId).toBeNull()

    useWorkspace.getState().moveSelectedAnimationMasks(document.activeLayerId, firstFrameId, thirdKey)
    expect(cels[2].mask).toBeUndefined()
    expect(cels[0].mask?.pixels[0]).toBe(40)
    expect(cels.map((cel) => Array.from(cel.surface!.pixels))).toEqual(celPixelsBefore)
  })

  it('exits mask editing when switching to another frame', () => {
    const document = createDocument('mask frame switch', 2, 1, 'rgba')
    getActiveLayer(document).pixels[3] = 255
    useWorkspace.getState().addSession(document)
    const firstCel = ensureAnimationDocument(document).cels[0]
    useWorkspace.getState().createLayerMask(firstCel.id)
    useWorkspace.getState().duplicateAnimationFrame()
    const timeline = ensureAnimationDocument(document)

    expect(useWorkspace.getState().sessions[0].activeLayerMaskId).toBeNull()
    useWorkspace.getState().selectLayerMask(firstCel.id)
    expect(useWorkspace.getState().sessions[0].activeLayerMaskId).toBe(firstCel.mask?.id)

    useWorkspace.getState().setActiveAnimationFrame(timeline.frames[1].id)
    expect(useWorkspace.getState().sessions[0].activeLayerMaskId).toBeNull()
  })

  it('pastes external colors into the active cell mask using relative luminance', async () => {
    const source = { r: 208, g: 78, b: 41, a: 255 }
    installApi({ readClipboardImage: vi.fn(async () => ({ width: 1, height: 1, data: Uint8Array.from([source.r, source.g, source.b, source.a]) })) })
    const document = createDocument('mask paste', 1, 1, 'rgba')
    getActiveLayer(document).pixels[3] = 255
    useWorkspace.getState().addSession(document)
    const cel = ensureAnimationDocument(document).cels[0]
    useWorkspace.getState().createLayerMask(cel.id)
    const mask = cel.mask!

    await useWorkspace.getState().pasteSelection()

    expect(useWorkspace.getState().sessions[0].pendingPaste?.layerId).toBe(mask.id)
    expect(readLayerColor(document, mask, 0)).toEqual(relativeLuminanceColor(source))
    useWorkspace.getState().commitFloatingPaste()
    useWorkspace.getState().undo()
    expect(readLayerColor(document, mask, 0)).toEqual(transparent)
    useWorkspace.getState().redo()
    expect(readLayerColor(document, mask, 0)).toEqual(relativeLuminanceColor(source))
  })
})

describe('project-owned display and activity metadata', () => {
  it('restores grid visibility and settings when a project session is opened', () => {
    const document = createDocument('grid memory', 8, 8, 'rgba')
    document.displaySettings = { showPixelGrid: true, showGrid: true, grid: { x: 2, y: 3, width: 12, height: 14 } }

    useWorkspace.getState().addSession(document)

    const session = useWorkspace.getState().sessions[0]
    expect(session.view).toMatchObject({ showPixelGrid: true, showGrid: true, grid: { x: 2, y: 3, width: 12, height: 14 } })
    useWorkspace.getState().toggleGrid()
    expect(document.displaySettings?.showGrid).toBe(false)
    expect(document.dirty).toBe(true)
  })

  it('counts committed strokes and records timelapse frames while enabled', () => {
    vi.useFakeTimers()
    try {
      const document = createDocument('activity', 2, 1, 'rgba')
      const layer = getActiveLayer(document)
      useWorkspace.getState().addSession(document)
      useWorkspace.getState().setTimelapseSettings({ enabled: true, quality: 'low', fps: 12, speed: 8 })
      const initialFrames = document.timelapse?.snapshots.length ?? 0
      const first = beginPixelEdit(layer.id)
      recordPixel(document, layer, first, 0, 0xff0000ff)
      useWorkspace.getState().commitPixelEdit(first, 'paint', { stroke: true, durationMs: 250 })
      vi.advanceTimersByTime(100)
      const second = beginPixelEdit(layer.id)
      recordPixel(document, layer, second, 1, 0xffff0000)
      useWorkspace.getState().commitPixelEdit(second, 'paint again', { stroke: true, durationMs: 150 })

      expect(document.statistics).toEqual({ strokeCount: 2, operationCount: 2, drawingTimeMs: 400 })
      expect(document.timelapse?.snapshots).toHaveLength(initialFrames)
      vi.advanceTimersByTime(299)
      expect(document.timelapse?.snapshots).toHaveLength(initialFrames)
      vi.advanceTimersByTime(1)
      expect(document.timelapse?.snapshots).toHaveLength(initialFrames + 1)

      const third = beginPixelEdit(layer.id)
      recordPixel(document, layer, third, 0, 0x00ff00ff)
      useWorkspace.getState().commitPixelEdit(third, 'paint throttled', { stroke: true, durationMs: 80 })
      vi.advanceTimersByTime(999)
      expect(document.timelapse?.snapshots).toHaveLength(initialFrames + 1)
      vi.advanceTimersByTime(1)
      expect(document.timelapse?.snapshots).toHaveLength(initialFrames + 2)
    } finally {
      vi.useRealTimers()
    }
  })
})

it('stores shape ratios with at most one decimal place', () => {
  useWorkspace.getState().addSession(createDocument('shape ratio', 8, 8, 'rgba'))

  useWorkspace.getState().setShapeRatio({ width: 1.26, height: 3.94 })

  expect(useWorkspace.getState().sessions[0].shapeRatio).toEqual({ width: 1.3, height: 3.9 })
})

describe('animation workspace', () => {
  it('selects cel content and adds another cel content with undo support', () => {
    const document = createDocument('animation content selection', 3, 1, 'rgba')
    getActiveLayer(document).pixels[3] = 255
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().addAnimationFrame()
    ensureLayerCoversCanvas(document, getActiveLayer(document))
    getActiveLayer(document).pixels[11] = 255
    const timeline = ensureAnimationDocument(document)
    const [firstFrame, secondFrame] = timeline.frames
    const firstKey = animationCelKey(document.activeLayerId, firstFrame.id)
    const secondKey = animationCelKey(document.activeLayerId, secondFrame.id)

    useWorkspace.getState().selectAnimationCelContent(firstKey)
    expect(useWorkspace.getState().sessions[0].selection).toMatchObject({ x: 0, y: 0, width: 1, height: 1 })
    expect(useWorkspace.getState().sessions[0].selectedAnimationCellKeys).toEqual([firstKey])

    useWorkspace.getState().selectAnimationCelContent(secondKey, true)
    expect(Array.from(useWorkspace.getState().sessions[0].selection?.mask ?? [])).toEqual([1, 0, 1])
    expect(useWorkspace.getState().sessions[0].selectedAnimationCellKeys).toEqual([secondKey])
    useWorkspace.getState().undo()
    expect(useWorkspace.getState().sessions[0].selection).toMatchObject({ x: 0, y: 0, width: 1, height: 1 })
  })

  it('keeps every sparse cel-content pixel when rotating an Alt-selected cell', () => {
    const document = createDocument('rotate cel content selection', 8, 8, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 2 * document.width + 2, red)
    writeLayerColor(document, layer, 3 * document.width + 3, blue)
    useWorkspace.getState().addSession(document)
    const key = animationCelKey(document.activeLayerId, ensureAnimationDocument(document).activeFrameId)

    useWorkspace.getState().selectAnimationCelContent(key)
    const selection = useWorkspace.getState().sessions[0].selection!
    const source = captureSelectionTransform(document, selection)!
    applySelectionTransform(document, source, selection, 45)

    expect(readLayerColorAt(document, layer, 3, 2)).toEqual(red)
    expect([readLayerColorAt(document, layer, 2, 3), readLayerColorAt(document, layer, 3, 3)]).toContainEqual(blue)
    let opaqueCount = 0
    for (let y = 0; y < document.height; y += 1) {
      for (let x = 0; x < document.width; x += 1) {
        if (readLayerColorAt(document, layer, x, y).a > 0) opaqueCount += 1
      }
    }
    expect(opaqueCount).toBe(2)
  })

  it('keeps frame and cel multi-selection mutually exclusive', () => {
    const document = createDocument('animation selection', 2, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    const session = useWorkspace.getState().sessions[0]
    const [first, second] = document.animation!.frames
    useWorkspace.getState().selectAnimationFrame(first.id)
    useWorkspace.getState().selectAnimationFrame(second.id, 'range')
    expect(session.selectedAnimationFrameIds).toEqual([first.id, second.id])
    const layerId = document.activeLayerId
    useWorkspace.getState().selectAnimationCell(`${layerId}:${first.id}`)
    useWorkspace.getState().selectAnimationCell(`${layerId}:${second.id}`, 'toggle')
    expect(session.selectedAnimationCellKeys).toHaveLength(2)
    expect(session.selectedAnimationFrameIds).toEqual([])
    useWorkspace.getState().copySelectedAnimationCels()
    expect(session.animationCellClipboard).toHaveLength(2)
    useWorkspace.getState().selectAnimationFrame(first.id)
    expect(session.selectedAnimationCellKeys).toEqual([])
    expect(session.selectedAnimationFrameIds).toEqual([first.id])
  })

  it('uses Ctrl for cel toggles and Shift for a rectangular cel range', () => {
    const document = createDocument('animation cel range', 1, 1, 'rgba')
    const firstLayer = getActiveLayer(document)
    const secondLayer = createLayer('Second', 1, 1, 'rgba')
    document.layers.push(secondLayer)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    useWorkspace.getState().duplicateAnimationFrame()
    const timeline = ensureAnimationDocument(document)
    const [firstFrame, secondFrame, thirdFrame] = timeline.frames
    const firstKey = animationCelKey(firstLayer.id, firstFrame.id)
    const secondKey = animationCelKey(secondLayer.id, firstFrame.id)
    const rangeEndKey = animationCelKey(firstLayer.id, thirdFrame.id)

    useWorkspace.getState().selectAnimationCell(firstKey)
    useWorkspace.getState().selectAnimationCell(secondKey, 'toggle')
    expect(useWorkspace.getState().sessions[0].selectedAnimationCellKeys).toEqual([firstKey, secondKey])
    useWorkspace.getState().selectAnimationCell(rangeEndKey, 'range')

    expect(useWorkspace.getState().sessions[0].selectedAnimationCellKeys).toEqual([
      firstKey,
      secondKey,
      animationCelKey(firstLayer.id, secondFrame.id),
      animationCelKey(firstLayer.id, thirdFrame.id),
      animationCelKey(secondLayer.id, secondFrame.id),
      animationCelKey(secondLayer.id, thirdFrame.id)
    ])
  })

  it('pastes a multi-cel block across layers and frames without collapsing it into one column', () => {
    const document = createDocument('animation cel paste', 1, 1, 'rgba')
    const firstLayer = getActiveLayer(document)
    const secondLayer = createLayer('Second', 1, 1, 'rgba')
    document.layers.push(secondLayer)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    useWorkspace.getState().addAnimationFrame()
    const timeline = ensureAnimationDocument(document)
    const [firstFrame, secondFrame, thirdFrame] = timeline.frames
    const firstSourceCel = animationCelAt(timeline, firstLayer.id, firstFrame.id)!
    const secondSourceCel = animationCelAt(timeline, secondLayer.id, secondFrame.id)!
    firstSourceCel.surface!.pixels.set([255, 0, 0, 255])
    secondSourceCel.surface!.pixels.set([0, 0, 255, 255])
    firstSourceCel.mask = createLayerMask(firstSourceCel.id, 1, 1)
    secondSourceCel.mask = createLayerMask(secondSourceCel.id, 1, 1)
    writeLayerColor(document, firstSourceCel.mask, 0, { r: 64, g: 64, b: 64, a: 255 })
    writeLayerColor(document, secondSourceCel.mask, 0, { r: 128, g: 128, b: 128, a: 255 })

    useWorkspace.getState().selectAnimationCell(animationCelKey(firstLayer.id, firstFrame.id))
    useWorkspace.getState().selectAnimationCell(animationCelKey(secondLayer.id, secondFrame.id), 'toggle')
    useWorkspace.getState().copySelectedAnimationCels()
    useWorkspace.getState().selectAnimationCell(animationCelKey(firstLayer.id, secondFrame.id))
    useWorkspace.getState().pasteAnimationCels()

    const firstDestination = animationCelAt(timeline, firstLayer.id, secondFrame.id)!
    const secondDestination = animationCelAt(timeline, secondLayer.id, thirdFrame.id)!
    expect(firstDestination.surface!.pixels).toEqual(new Uint8ClampedArray([255, 0, 0, 255]))
    expect(secondDestination.surface!.pixels).toEqual(new Uint8ClampedArray([0, 0, 255, 255]))
    expect(firstDestination.mask).toMatchObject({ ownerKind: 'cel', ownerId: firstDestination.id })
    expect(secondDestination.mask).toMatchObject({ ownerKind: 'cel', ownerId: secondDestination.id })
    expect(firstDestination.mask?.pixels).toEqual(firstSourceCel.mask.pixels)
    expect(secondDestination.mask?.pixels).toEqual(secondSourceCel.mask.pixels)
    expect(firstDestination.mask?.id).not.toBe(firstSourceCel.mask.id)
    expect(secondDestination.mask?.id).not.toBe(secondSourceCel.mask.id)
  })

  it('extends the timeline when a copied cel block crosses the last frame', () => {
    const document = createDocument('animation cel paste edge', 1, 1, 'rgba')
    const layer = getActiveLayer(document)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    const timeline = ensureAnimationDocument(document)
    const [firstFrame, secondFrame] = timeline.frames
    animationCelAt(timeline, layer.id, firstFrame.id)!.surface!.pixels.set([255, 0, 0, 255])
    animationCelAt(timeline, layer.id, secondFrame.id)!.surface!.pixels.set([0, 0, 255, 255])

    useWorkspace.getState().selectAnimationCell(animationCelKey(layer.id, secondFrame.id))
    useWorkspace.getState().selectAnimationCell(animationCelKey(layer.id, firstFrame.id), 'toggle')
    useWorkspace.getState().copySelectedAnimationCels()
    useWorkspace.getState().selectAnimationCell(animationCelKey(layer.id, secondFrame.id))
    useWorkspace.getState().pasteAnimationCels()

    expect(timeline.frames).toHaveLength(3)
    expect(animationCelAt(timeline, layer.id, secondFrame.id)!.surface!.pixels).toEqual(new Uint8ClampedArray([255, 0, 0, 255]))
    expect(animationCelAt(timeline, layer.id, timeline.frames[2].id)!.surface!.pixels).toEqual(new Uint8ClampedArray([0, 0, 255, 255]))
    useWorkspace.getState().undo()
    expect(timeline.frames).toHaveLength(2)
  })

  it('moves a multi-cel block across layers and frames using the dragged cel as its anchor', () => {
    const document = createDocument('animation cel move', 1, 1, 'rgba')
    const firstLayer = getActiveLayer(document)
    const secondLayer = createLayer('Second', 1, 1, 'rgba')
    document.layers.push(secondLayer)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    useWorkspace.getState().addAnimationFrame()
    const timeline = ensureAnimationDocument(document)
    const [firstFrame, secondFrame, thirdFrame] = timeline.frames
    const firstKey = animationCelKey(firstLayer.id, firstFrame.id)
    const anchorKey = animationCelKey(secondLayer.id, secondFrame.id)
    animationCelAt(timeline, firstLayer.id, firstFrame.id)!.surface!.pixels.set([255, 0, 0, 255])
    animationCelAt(timeline, secondLayer.id, secondFrame.id)!.surface!.pixels.set([0, 0, 255, 255])

    useWorkspace.getState().selectAnimationCell(firstKey)
    useWorkspace.getState().selectAnimationCell(anchorKey, 'toggle')
    useWorkspace.getState().moveSelectedAnimationCels(secondLayer.id, thirdFrame.id, anchorKey)

    expect(animationCelAt(timeline, firstLayer.id, secondFrame.id)!.surface!.pixels).toEqual(new Uint8ClampedArray([255, 0, 0, 255]))
    expect(animationCelAt(timeline, secondLayer.id, thirdFrame.id)!.surface!.pixels).toEqual(new Uint8ClampedArray([0, 0, 255, 255]))
    expect(animationCelAt(timeline, firstLayer.id, firstFrame.id)!.surface!.pixels).toEqual(new Uint8ClampedArray(4))
    expect(animationCelAt(timeline, secondLayer.id, secondFrame.id)!.surface!.pixels).toEqual(new Uint8ClampedArray(4))

    useWorkspace.getState().undo()
    expect(animationCelAt(timeline, firstLayer.id, firstFrame.id)!.surface!.pixels).toEqual(new Uint8ClampedArray([255, 0, 0, 255]))
    expect(animationCelAt(timeline, secondLayer.id, secondFrame.id)!.surface!.pixels).toEqual(new Uint8ClampedArray([0, 0, 255, 255]))
    expect(animationCelAt(timeline, firstLayer.id, secondFrame.id)!.surface!.pixels).toEqual(new Uint8ClampedArray(4))
    expect(animationCelAt(timeline, secondLayer.id, thirdFrame.id)!.surface!.pixels).toEqual(new Uint8ClampedArray(4))
  })

  it('moves selected frames as one ordered block and restores their order with undo', () => {
    const document = createDocument('animation frame move', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    useWorkspace.getState().duplicateAnimationFrame()
    const timeline = ensureAnimationDocument(document)
    const [firstFrame, secondFrame, thirdFrame] = timeline.frames

    useWorkspace.getState().selectAnimationFrame(firstFrame.id)
    useWorkspace.getState().selectAnimationFrame(secondFrame.id, 'range')
    useWorkspace.getState().moveSelectedAnimationFrames(thirdFrame.id, true)

    expect(timeline.frames.map((frame) => frame.id)).toEqual([thirdFrame.id, firstFrame.id, secondFrame.id])
    expect(useWorkspace.getState().sessions[0].selectedAnimationFrameIds).toEqual([firstFrame.id, secondFrame.id])
    useWorkspace.getState().undo()
    expect(timeline.frames.map((frame) => frame.id)).toEqual([firstFrame.id, secondFrame.id, thirdFrame.id])
  })

  it('copies selected frames with their cels and pastes independent frames after the selection', () => {
    const document = createDocument('animation frame clipboard', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    useWorkspace.getState().addAnimationFrame()
    const timeline = ensureAnimationDocument(document)
    const [firstFrame, secondFrame, thirdFrame] = timeline.frames
    firstFrame.duration = 80
    secondFrame.duration = 140
    animationCelAt(timeline, document.activeLayerId, firstFrame.id)!.surface!.pixels.set([255, 0, 0, 255])
    animationCelAt(timeline, document.activeLayerId, secondFrame.id)!.surface!.pixels.set([0, 0, 255, 255])

    useWorkspace.getState().selectAnimationFrame(firstFrame.id)
    useWorkspace.getState().selectAnimationFrame(secondFrame.id, 'range')
    useWorkspace.getState().copySelectedAnimationFrames()
    useWorkspace.getState().selectAnimationFrame(thirdFrame.id)
    useWorkspace.getState().pasteAnimationFrames()

    expect(timeline.frames).toHaveLength(5)
    const pastedFrames = timeline.frames.slice(3)
    expect(pastedFrames.map((frame) => frame.duration)).toEqual([80, 140])
    expect(animationCelAt(timeline, document.activeLayerId, pastedFrames[0].id)!.surface!.pixels).toEqual(new Uint8ClampedArray([255, 0, 0, 255]))
    expect(animationCelAt(timeline, document.activeLayerId, pastedFrames[1].id)!.surface!.pixels).toEqual(new Uint8ClampedArray([0, 0, 255, 255]))
    animationCelAt(timeline, document.activeLayerId, pastedFrames[0].id)!.surface!.pixels[0] = 20
    expect(animationCelAt(timeline, document.activeLayerId, firstFrame.id)!.surface!.pixels[0]).toBe(255)
    expect(useWorkspace.getState().sessions[0].selectedAnimationFrameIds).toEqual(pastedFrames.map((frame) => frame.id))
    useWorkspace.getState().undo()
    expect(timeline.frames.map((frame) => frame.id)).toEqual([firstFrame.id, secondFrame.id, thirdFrame.id])
  })

  it('persists a cel opacity edit through undo', () => {
    const document = createDocument('animation cel opacity', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    const session = useWorkspace.getState().sessions[0]
    const frameId = document.animation!.activeFrameId
    useWorkspace.getState().setAnimationCelOpacity(document.activeLayerId, frameId, 0.4)
    expect(document.layers[0].opacity).toBeCloseTo(0.4)
    useWorkspace.getState().undo()
    expect(document.layers[0].opacity).toBeCloseTo(1)
  })

  it('switches frames without dirtying the project and undoes frame creation', () => {
    const document = createDocument('animation', 2, 1, 'rgba')
    writeLayerColor(document, getActiveLayer(document), 0, red)
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().addAnimationFrame()
    const session = useWorkspace.getState().sessions[0]
    const secondFrame = session.document.animation!.activeFrameId
    expect(readLayerColor(document, getActiveLayer(document), 0)).toEqual(transparent)
    ensureLayerCoversCanvas(document, getActiveLayer(document))
    writeLayerColor(document, getActiveLayer(document), 1, blue)
    document.dirty = false
    useWorkspace.getState().setActiveAnimationFrame('frame-1')
    expect(document.dirty).toBe(false)
    expect(readLayerColor(document, getActiveLayer(document), 0)).toEqual(red)
    useWorkspace.getState().setActiveAnimationFrame(secondFrame)
    expect(readLayerColor(document, getActiveLayer(document), 1)).toEqual(blue)

    useWorkspace.getState().undo()
    expect(document.animation?.frames).toHaveLength(1)
    expect(document.animation?.activeFrameId).toBe('frame-1')
  })

  it('duplicates every cel when duplicating a layer', () => {
    const document = createDocument('animation layers', 1, 1, 'rgba')
    writeLayerColor(document, getActiveLayer(document), 0, red)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    writeLayerColor(document, getActiveLayer(document), 0, blue)
    useWorkspace.getState().setActiveAnimationFrame('frame-1')

    useWorkspace.getState().duplicateActiveLayer()
    const copiedLayerId = document.activeLayerId
    expect(readLayerColor(document, getActiveLayer(document), 0)).toEqual(red)
    useWorkspace.getState().setActiveAnimationFrame(document.animation!.frames[1].id)
    expect(document.layers.find((layer) => layer.id === copiedLayerId)).toBeDefined()
    expect(readLayerColor(document, getActiveLayer(document), 0)).toEqual(blue)
  })

  it('plays once from the first frame and returns to the frame selected before playback', () => {
    const document = createDocument('animation playback settings', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    useWorkspace.getState().duplicateAnimationFrame()
    const session = useWorkspace.getState().sessions[0]
    const [firstFrame, secondFrame, thirdFrame] = document.animation!.frames
    useWorkspace.getState().setActiveAnimationFrame(thirdFrame.id)
    useWorkspace.getState().setAnimationPlaybackRate(2)
    useWorkspace.getState().setAnimationLoop(false)
    useWorkspace.getState().setAnimationReturnToStart(true)
    document.dirty = false
    useWorkspace.getState().setAnimationPlaying(true)
    expect(document.animation?.activeFrameId).toBe(firstFrame.id)
    useWorkspace.getState().advanceAnimationFrame()
    expect(document.animation?.activeFrameId).toBe(secondFrame.id)
    useWorkspace.getState().advanceAnimationFrame()
    expect(document.animation?.activeFrameId).toBe(thirdFrame.id)
    useWorkspace.getState().setAnimationPlaying(false)

    expect(document.animation?.activeFrameId).toBe(thirdFrame.id)
    expect(session.animationPlaybackRate).toBe(2)
    expect(document.dirty).toBe(false)
  })

  it('returns a completed one-shot playback to the first frame when return-to-start is disabled', () => {
    const document = createDocument('animation playback completion', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    useWorkspace.getState().duplicateAnimationFrame()
    const [firstFrame, , thirdFrame] = document.animation!.frames
    useWorkspace.getState().setActiveAnimationFrame(thirdFrame.id)
    useWorkspace.getState().setAnimationLoop(false)
    useWorkspace.getState().setAnimationReturnToStart(false)

    useWorkspace.getState().setAnimationPlaying(true)
    useWorkspace.getState().setActiveAnimationFrame(thirdFrame.id)
    useWorkspace.getState().setAnimationPlaying(false, true)

    expect(document.animation?.activeFrameId).toBe(firstFrame.id)
  })
})

describe('layer properties', () => {
  it('clears an optional display color and restores it with one undo', () => {
    const document = createDocument('layer marker', 2, 2, 'rgba')
    const layer = getActiveLayer(document)
    layer.displayColor = { ...red }
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().setLayerPropertiesWithBlend(layer.id, layer.name, layer.opacity, layer.blendMode, layer.locked, null, '说明')

    expect(layer.displayColor).toBeUndefined()
    expect(layer.description).toBe('说明')
    useWorkspace.getState().undo()
    expect(layer.displayColor).toEqual(red)
  })
})

describe('cross-document layer clipboard', () => {
  it('pastes every animation cel belonging to a copied layer', () => {
    const source = createDocument('animated layer clipboard', 1, 1, 'rgba')
    const sourceLayer = getActiveLayer(source)
    writeLayerColor(source, sourceLayer, 0, red)
    useWorkspace.getState().addSession(source)
    useWorkspace.getState().duplicateAnimationFrame()
    writeLayerColor(source, sourceLayer, 0, blue)

    useWorkspace.getState().copySelectedLayersToClipboard()
    const target = createDocument('animated layer target', 1, 1, 'rgba')
    useWorkspace.getState().addSession(target)
    expect(useWorkspace.getState().pasteLayersFromClipboard()).toBe(true)

    const timeline = ensureAnimationDocument(target)
    const pastedLayer = target.layers.find((layer) => layer.id !== target.layers[0].id)!
    expect(timeline.frames).toHaveLength(2)
    expect(animationCelAt(timeline, pastedLayer.id, timeline.frames[0].id)!.surface!.pixels).toEqual(new Uint8ClampedArray([255, 0, 0, 255]))
    expect(animationCelAt(timeline, pastedLayer.id, timeline.frames[1].id)!.surface!.pixels).toEqual(new Uint8ClampedArray([0, 80, 255, 255]))

    useWorkspace.getState().undo()
    expect(target.layers).toHaveLength(1)
    expect(timeline.frames).toHaveLength(1)
    useWorkspace.getState().redo()
    expect(target.layers.some((layer) => layer.id === pastedLayer.id)).toBe(true)
    expect(timeline.frames).toHaveLength(2)
    expect(animationCelAt(timeline, pastedLayer.id, timeline.frames[1].id)!.surface!.pixels).toEqual(new Uint8ClampedArray([0, 80, 255, 255]))
  })

  it('pastes multiple selected layers with their properties as one undo step', () => {
    const source = createDocument('source', 4, 4, 'rgba')
    const bottom = getActiveLayer(source)
    bottom.name = 'Bottom'
    bottom.offsetX = -2
    bottom.opacity = 0.5
    bottom.description = 'base note'
    const top = createLayer('Top', 2, 3, 'rgba')
    top.offsetX = 5
    top.offsetY = 6
    top.blendMode = 'multiply'
    top.clippingMask = true
    top.displayColor = { ...blue }
    source.layers.push(top)
    source.activeLayerId = top.id
    useWorkspace.getState().addSession(source)
    useWorkspace.getState().selectLayer(bottom.id)
    useWorkspace.getState().selectLayer(top.id, true)

    useWorkspace.getState().copySelectedLayersToClipboard()
    const target = createDocument('target', 4, 4, 'indexed')
    useWorkspace.getState().addSession(target)
    useWorkspace.getState().pasteLayersFromClipboard()

    const pasted = target.layers.slice(1)
    expect(pasted.map((layer) => layer.name)).toEqual(['Bottom 副本', 'Top 副本'])
    expect(pasted[0]).toMatchObject({ offsetX: -2, opacity: 0.5, description: 'base note' })
    expect(pasted[1]).toMatchObject({ offsetX: 5, offsetY: 6, blendMode: 'multiply', clippingMask: true, displayColor: blue })
    useWorkspace.getState().undo()
    expect(target.layers).toHaveLength(1)
  })

  it('preserves nested group structure and removes the whole paste with one undo', () => {
    const source = createDocument('group source', 3, 3, 'rgba')
    const childLayer = getActiveLayer(source)
    const parentLayer = createLayer('Parent layer', 3, 3, 'rgba')
    source.layers.push(parentLayer)
    source.groups.push(
      { id: 'parent', name: 'Parent', parentGroupId: null, visible: true, locked: false, opacity: 0.75, blendMode: 'multiply', clippingMask: true, cumulativeBlend: true, description: 'parent note' },
      { id: 'child', name: 'Child', parentGroupId: 'parent', visible: false, locked: true, opacity: 0.5, blendMode: 'screen', displayColor: { ...red } }
    )
    childLayer.groupId = 'child'
    parentLayer.groupId = 'parent'
    useWorkspace.getState().addSession(source)
    useWorkspace.getState().selectGroup('parent')
    useWorkspace.getState().copySelectedLayersToClipboard()

    const target = createDocument('group target', 3, 3, 'rgba')
    useWorkspace.getState().addSession(target)
    expect(useWorkspace.getState().pasteLayersFromClipboard()).toBe(true)

    const parent = target.groups.find((group) => group.name === 'Parent 副本')
    const child = target.groups.find((group) => group.name === 'Child 副本')
    expect(parent).toMatchObject({ opacity: 0.75, blendMode: 'multiply', clippingMask: true, cumulativeBlend: true, description: 'parent note' })
    expect(child).toMatchObject({ parentGroupId: parent?.id, visible: false, locked: true, opacity: 0.5, blendMode: 'screen', displayColor: red })
    expect(target.layers.find((layer) => layer.name === `${childLayer.name} 副本`)?.groupId).toBe(child?.id)
    expect(target.layers.find((layer) => layer.name === 'Parent layer 副本')?.groupId).toBe(parent?.id)

    useWorkspace.getState().undo()
    expect(target.groups).toHaveLength(0)
    expect(target.layers).toHaveLength(1)
  })

  it('copies each animation cell mask with independent pixel storage', () => {
    const source = createDocument('masked cel source', 2, 1, 'rgba')
    const sourceLayer = getActiveLayer(source)
    const sourceTimeline = ensureAnimationDocument(source)
    const firstSourceCel = sourceTimeline.cels[0]
    firstSourceCel.mask = createLayerMask(firstSourceCel.id, 2, 1)
    writeLayerColor(source, firstSourceCel.mask, 0, { r: 64, g: 64, b: 64, a: 255 })
    useWorkspace.getState().addSession(source)
    useWorkspace.getState().duplicateAnimationFrame()
    const secondSourceCel = ensureAnimationDocument(source).cels.find((cel) => cel.frameId === ensureAnimationDocument(source).activeFrameId)!
    writeLayerColor(source, secondSourceCel.mask!, 1, { r: 128, g: 128, b: 128, a: 255 })
    useWorkspace.getState().selectLayer(sourceLayer.id)
    useWorkspace.getState().copySelectedLayersToClipboard()

    const target = createDocument('masked cel target', 2, 1, 'rgba')
    useWorkspace.getState().addSession(target)
    useWorkspace.getState().duplicateAnimationFrame()
    expect(useWorkspace.getState().pasteLayersFromClipboard()).toBe(true)

    const pastedLayer = target.layers.find((layer) => layer.name.includes(sourceLayer.name) && layer.id !== target.layers[0].id)!
    const pastedCels = ensureAnimationDocument(target).cels.filter((cel) => cel.layerId === pastedLayer.id)
    expect(pastedCels).toHaveLength(2)
    expect(pastedCels[0].mask).toMatchObject({ ownerKind: 'cel', ownerId: pastedCels[0].id })
    expect(pastedCels[1].mask).toMatchObject({ ownerKind: 'cel', ownerId: pastedCels[1].id })
    expect(pastedCels[0].mask?.id).not.toBe(firstSourceCel.mask.id)
    expect(pastedCels[1].mask?.id).not.toBe(secondSourceCel.mask?.id)
    expect(pastedCels[0].mask?.pixels).toEqual(firstSourceCel.mask.pixels)
    expect(pastedCels[1].mask?.pixels).toEqual(secondSourceCel.mask?.pixels)

    pastedCels[0].mask!.pixels[0] = 255
    expect(firstSourceCel.mask.pixels[0]).toBe(64)
    expect(pastedCels[1].mask!.pixels[0]).toBe(secondSourceCel.mask!.pixels[0])
  })
})

describe('multi-layer deletion', () => {
  it('deletes a selected nested group as one structural history entry', () => {
    const document = createDocument('delete nested group', 2, 2, 'rgba')
    const childLayer = getActiveLayer(document)
    childLayer.groupId = 'child'
    const rootLayer = createLayer('Root', 2, 2, 'rgba')
    document.layers.push(rootLayer)
    document.groups.push(
      { id: 'parent', name: 'Parent', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' },
      { id: 'child', name: 'Child', parentGroupId: 'parent', visible: true, locked: false, opacity: 1, blendMode: 'normal' }
    )
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectGroup('parent')

    useWorkspace.getState().deleteSelectedLayers()

    expect(document.layers).toEqual([rootLayer])
    expect(document.groups).toEqual([])
    useWorkspace.getState().undo()
    expect(document.layers).toContain(childLayer)
    expect(document.groups.map((group) => group.id)).toEqual(['parent', 'child'])
    expect(useWorkspace.getState().sessions[0].selectedGroupId).toBe('parent')
  })

  it('does not dirty the document when deletion would remove every layer', () => {
    const document = createDocument('keep one layer', 2, 2, 'rgba')
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().deleteSelectedLayers()

    expect(document.dirty).toBe(false)
    expect(useWorkspace.getState().sessions[0].history.canUndo).toBe(false)
  })
})

describe('procedural brush settings', () => {
  it('creates a project brush from non-transparent selected pixels', () => {
    const document = createDocument('selection brush', 4, 3, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, red)
    writeLayerColor(document, layer, 2, { r: 10, g: 20, b: 30, a: 128 })
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setTool('selection')
    useWorkspace.getState().setSelection({ x: 0, y: 0, width: 3, height: 1 })

    useWorkspace.getState().createBrushFromSelection()

    const session = useWorkspace.getState().sessions[0]
    expect(session).toMatchObject({ tool: 'pencil', brushImageTemporary: false, brushPaintMode: 'pattern-source', selection: null })
    expect(session.brushImage).toMatchObject({ name: '选区笔刷', width: 3, height: 1, sourceX: 0, sourceY: 0 })
    expect(session.brushImage?.coverage).toEqual(Uint8Array.from([255, 0, 128]))
    expect(session.brushImageId).toMatch(/^project-brush-/)
    expect(session.document.customBrushes).toHaveLength(1)
  })

  it('persists pattern alignment without persisting a temporary brush id', () => {
    vi.useFakeTimers()
    try {
      const document = createDocument('temporary persistence', 2, 2, 'rgba')
      writeLayerColor(document, getActiveLayer(document), 0, red)
      useWorkspace.getState().addSession(document)
      useWorkspace.getState().setSelection({ x: 0, y: 0, width: 1, height: 1 })
      useWorkspace.getState().createBrushFromSelection()
      useWorkspace.getState().setBrushPaintMode('pattern-target')
      vi.advanceTimersByTime(101)

      useWorkspace.setState({ sessions: [], activeId: null, message: null, dialog: null })
      useWorkspace.getState().addSession(createDocument('restored settings', 2, 2, 'rgba'))
      const restored = useWorkspace.getState().sessions[0]
      expect(restored.brushPaintMode).toBe('pattern-target')
      expect(restored.brushImageId).toBeTruthy()
      expect(restored.brushImage).toBeNull()
      expect(restored.brushImageTemporary).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps brush settings independent across tools and restores every profile', () => {
    vi.useFakeTimers()
    try {
      useWorkspace.getState().addSession(createDocument('brush mode', 8, 8, 'rgba'))
      useWorkspace.getState().setBrushSize(73)

      useWorkspace.getState().setTool('shape')
      useWorkspace.getState().setTool('fill')
      expect(useWorkspace.getState().sessions[0]).toMatchObject({ tool: 'fill', brushSize: 1 })
      useWorkspace.getState().setBrushSize(29)
      useWorkspace.getState().setBrushShape('line')
      useWorkspace.getState().setTool('pencil')
      expect(useWorkspace.getState().sessions[0]).toMatchObject({ tool: 'pencil', brushSize: 73 })

      vi.advanceTimersByTime(101)
      useWorkspace.setState({ sessions: [], activeId: null, message: null, dialog: null })
      useWorkspace.getState().addSession(createDocument('restored brush mode', 8, 8, 'rgba'))
      expect(useWorkspace.getState().sessions[0]).toMatchObject({ brushSize: 73 })
      useWorkspace.getState().setTool('fill')
      expect(useWorkspace.getState().sessions[0]).toMatchObject({ brushSize: 29, brushShape: 'line' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('migrates the previous implicit antialias default to off without dropping other settings', () => {
    localStorage.setItem('moonsprite.tool-settings.v1', JSON.stringify({ brushSize: 37, proceduralAntialias: true }))
    useWorkspace.getState().addSession(createDocument('migrated antialias', 8, 8, 'rgba'))

    const session = useWorkspace.getState().sessions[0]
    expect(session.brushSize).toBe(37)
    expect(session.proceduralAntialias).toBe(false)
    expect(session.brushPaintMode).toBe('pattern-source')
  })

  it('disables procedural texture antialiasing by default and persists an explicit choice', () => {
    vi.useFakeTimers()
    try {
      useWorkspace.getState().addSession(createDocument('default antialias', 8, 8, 'rgba'))
      expect(useWorkspace.getState().sessions[0].proceduralAntialias).toBe(false)

      useWorkspace.getState().setProceduralAntialias(true)
      vi.advanceTimersByTime(101)
      useWorkspace.setState({ sessions: [], activeId: null, message: null, dialog: null })
      useWorkspace.getState().addSession(createDocument('persisted antialias', 8, 8, 'rgba'))
      expect(useWorkspace.getState().sessions[0].proceduralAntialias).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('remembers separate settings for each texture and persists them for new sessions', () => {
    vi.useFakeTimers()
    try {
      useWorkspace.getState().addSession(createDocument('procedural settings', 8, 8, 'rgba'))
      useWorkspace.getState().setBrushImage(createProceduralBrush('procedural:noise'))
      useWorkspace.getState().setProceduralBrushSettings({ scale: 7, detail: 76, seed: 412 })
      useWorkspace.getState().setBrushImage(createProceduralBrush('procedural:clouds'))
      useWorkspace.getState().setProceduralBrushSettings({ scale: 43, detail: 2, seed: 913 })
      useWorkspace.getState().setBrushImage(createProceduralBrush('procedural:noise'))

      let session = useWorkspace.getState().sessions[0]
      expect(session.brushImage?.proceduralSettings).toMatchObject({ scale: 7, detail: 76, seed: 412 })
      expect(session.proceduralBrushSettings['procedural:clouds']).toMatchObject({ scale: 43, detail: 2, seed: 913 })

      vi.advanceTimersByTime(101)
      useWorkspace.setState({ sessions: [], activeId: null, message: null, dialog: null })
      useWorkspace.getState().addSession(createDocument('restored settings', 8, 8, 'rgba'))
      session = useWorkspace.getState().sessions[0]
      expect(session.proceduralBrushSettings['procedural:noise']).toMatchObject({ scale: 7, detail: 76, seed: 412 })
      expect(session.proceduralBrushSettings['procedural:clouds']).toMatchObject({ scale: 43, detail: 2, seed: 913 })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('workspace history', () => {
  it('does not dirty a clean document when undo or redo history is empty', () => {
    const document = createDocument('empty history', 3, 2, 'rgba')
    document.dirty = false
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().undo()
    expect(document.dirty).toBe(false)

    useWorkspace.getState().redo()
    expect(document.dirty).toBe(false)
  })

  it('never lets project undo or redo change the current view', () => {
    const document = createDocument('view history isolation', 3, 2, 'rgba')
    useWorkspace.getState().addSession(document)
    const session = useWorkspace.getState().sessions[0]
    useWorkspace.getState().setView({ zoom: 9, panX: 34, panY: -18, rotation: 45 })
    useWorkspace.getState().pushHistory({
      label: 'malformed view history',
      bytes: 8,
      undo: () => Object.assign(session.view, { zoom: 1, panX: 0, panY: 0, rotation: 0 }),
      redo: () => Object.assign(session.view, { zoom: 2, panX: 4, panY: 6, rotation: 90 })
    })

    useWorkspace.getState().undo()
    expect(session.view).toMatchObject({ zoom: 9, panX: 34, panY: -18, rotation: 45 })
    useWorkspace.getState().redo()
    expect(session.view).toMatchObject({ zoom: 9, panX: 34, panY: -18, rotation: 45 })
  })

  it('flushes a pending zoom preview before preserving the view for undo', () => {
    const document = createDocument('pending zoom history isolation', 3, 2, 'rgba')
    useWorkspace.getState().addSession(document)
    const session = useWorkspace.getState().sessions[0]
    useWorkspace.getState().setView({ zoom: 9, panX: 12, panY: -6 })
    useWorkspace.getState().pushHistory({ label: 'pixel operation', bytes: 1, undo: () => {}, redo: () => {} })
    const unregister = registerViewPreviewFlusher(document.id, () => {
      useWorkspace.getState().setView({ zoom: 14, panX: 28, panY: -10 })
    })

    try {
      useWorkspace.getState().undo()
      expect(session.view).toMatchObject({ zoom: 14, panX: 28, panY: -10 })
    } finally {
      unregister()
    }
  })
})

describe('foreground fill command', () => {
  it('shares foreground and background colors across open documents', () => {
    const first = createDocument('first colors', 1, 1, 'rgba')
    const second = createDocument('second colors', 1, 1, 'rgba')
    useWorkspace.getState().addSession(first)
    useWorkspace.getState().addSession(second)

    useWorkspace.getState().setPrimaryColor(red)
    useWorkspace.getState().setSecondaryColor(blue)
    useWorkspace.getState().setActive(first.id)

    for (const session of useWorkspace.getState().sessions) {
      expect(session.primaryColor).toEqual(red)
      expect(session.secondaryColor).toEqual(blue)
    }
  })

  it('shares a palette swatch selection with every open document', () => {
    const first = createDocument('first palette', 1, 1, 'rgba')
    const second = createDocument('second palette', 1, 1, 'rgba')
    useWorkspace.getState().addSession(first)
    useWorkspace.getState().addSession(second)
    useWorkspace.getState().setActive(first.id)
    let redId = first.palette.find((entry) => entry.color.r === red.r && entry.color.g === red.g && entry.color.b === red.b)?.id
    if (redId === undefined) {
      redId = 9001
      first.palette.push({ id: redId, name: 'Red', color: red })
    }
    if (!first.paletteOrder.includes(redId)) first.paletteOrder.push(redId)

    useWorkspace.getState().selectPaletteColor(redId)

    expect(useWorkspace.getState().sessions.every((session) => session.primaryColor.r === red.r && session.primaryColor.g === red.g && session.primaryColor.b === red.b)).toBe(true)
  })

  it('swaps foreground and background colors as one state update', () => {
    const document = createDocument('swap colors', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setPrimaryColor(red)
    useWorkspace.getState().setSecondaryColor(blue)

    useWorkspace.getState().swapPrimarySecondaryColors()

    const session = useWorkspace.getState().sessions[0]
    expect(session.primaryColor).toEqual(blue)
    expect(session.secondaryColor).toEqual(red)
  })

  it('fills the active selection and supports undo and redo', () => {
    const document = createDocument('fill command', 3, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setPrimaryColor(blue)
    useWorkspace.getState().setSelection({ x: 1, y: 0, width: 1, height: 1 })

    useWorkspace.getState().fillForeground()
    const layer = getActiveLayer(document)
    expect(readLayerColor(document, layer, 0).a).toBe(0)
    expect(readLayerColor(document, layer, 1)).toEqual(blue)

    useWorkspace.getState().undo()
    expect(readLayerColor(document, layer, 1).a).toBe(0)
    useWorkspace.getState().redo()
    expect(readLayerColor(document, layer, 1)).toEqual(blue)
  })

  it('fills an uncovered canvas area on a cropped layer and remains undoable', () => {
    const document = createDocument('cropped fill command', 4, 3, 'rgba')
    const layer = getActiveLayer(document)
    if (layer.format !== 'rgba') throw new Error('wrong layer mode')
    layer.width = 1
    layer.height = 1
    layer.offsetX = 1
    layer.offsetY = 1
    layer.pixels = new Uint8ClampedArray(4)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setPrimaryColor(blue)

    useWorkspace.getState().fillForeground()
    expect(readLayerColorAt(document, layer, 3, 2)).toEqual(blue)

    useWorkspace.getState().undo()
    expect(readLayerColorAt(document, layer, 3, 2).a).toBe(0)
    useWorkspace.getState().redo()
    expect(readLayerColorAt(document, layer, 3, 2)).toEqual(blue)
  })
})

describe('layer duplication', () => {
  it('duplicates all requested layers and removes them together on undo', () => {
    const document = createDocument('duplicate layers', 2, 2, 'rgba')
    document.layers.push(createLayer('second', 2, 2, 'rgba'))
    useWorkspace.getState().addSession(document)
    const originals = document.layers.map((layer) => layer.id)

    const copies = useWorkspace.getState().duplicateLayers(originals)

    expect(copies).toHaveLength(2)
    expect(document.layers.filter((layer) => copies.includes(layer.id))).toHaveLength(2)
    useWorkspace.getState().undo()
    expect(document.layers.map((layer) => layer.id)).toEqual(originals)
    useWorkspace.getState().redo()
    expect(document.layers.filter((layer) => copies.includes(layer.id))).toHaveLength(2)
  })
})

describe('selection clipboard', () => {
  it('nudges selection content by one pixel and restores both pixels and bounds on undo', () => {
    const document = createDocument('selection nudge', 4, 2, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 1, red)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 1, y: 0, width: 1, height: 1 })

    useWorkspace.getState().moveActiveSelectionWithSelectionHistory(1, 0)

    const session = useWorkspace.getState().sessions[0]
    expect(session.selection).toEqual({ x: 2, y: 0, width: 1, height: 1 })
    expect(readLayerColorAt(document, layer, 1, 0).a).toBe(0)
    expect(readLayerColorAt(document, layer, 2, 0)).toEqual(red)
    useWorkspace.getState().undo()
    expect(session.selection).toEqual({ x: 1, y: 0, width: 1, height: 1 })
    expect(readLayerColorAt(document, layer, 1, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, 2, 0).a).toBe(0)
  })

  it('starts layer transform around the selected layer content', () => {
    const document = createDocument('layer transform', 8, 6, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 1 + 2 * layer.width, red)
    writeLayerColor(document, layer, 5 + 4 * layer.width, blue)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setTool('pencil')

    useWorkspace.getState().beginLayerTransform()

    const session = useWorkspace.getState().sessions[0]
    expect(session.tool).toBe('selection')
    expect(session.selectionKind).toBe('rectangle')
    expect(session.selectionMode).toBe('replace')
    expect(session.selection).toEqual({ x: 1, y: 2, width: 5, height: 3 })
    expect(document.dirty).toBe(false)
  })

  it('does not start layer transform for an empty layer', () => {
    const document = createDocument('empty transform', 4, 4, 'rgba')
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().beginLayerTransform()

    expect(useWorkspace.getState().sessions[0].selection).toBeNull()
    expect(useWorkspace.getState().message).toContain('没有可变换的内容')
  })

  it('keeps irregular selection masks interactive without dirtying an empty document', () => {
    const document = createDocument('masked selection', 4, 4, 'rgba')
    document.dirty = false
    useWorkspace.getState().addSession(document)
    const before = { x: 0, y: 0, width: 2, height: 2, mask: Uint8Array.from([0, 1, 1, 1]) }
    const after = { x: 1, y: 1, width: 2, height: 2, mask: Uint8Array.from([1, 1, 1, 0]) }
    useWorkspace.getState().setSelection(before)

    useWorkspace.getState().commitSelectionTransform(null, before, after, 'move masked selection')

    const session = useWorkspace.getState().sessions[0]
    expect(session.selection).toEqual(after)
    expect(document.dirty).toBe(false)
    session.history.undo()
    expect(session.selection).toEqual(before)
    session.history.redo()
    expect(session.selection).toEqual(after)
  })

  it('keeps the original destination background across repeated floating moves', () => {
    const document = createDocument('floating selection background', 4, 1, 'rgba')
    const layer = getActiveLayer(document)
    const darkBlue = { r: 12, g: 38, b: 86, a: 255 }
    writeLayerColor(document, layer, 0, red)
    writeLayerColor(document, layer, 2, darkBlue)
    useWorkspace.getState().addSession(document)
    const before = { x: 0, y: 0, width: 1, height: 1 }
    const firstTarget = { x: 2, y: 0, width: 1, height: 1 }
    const source = captureSelectionTransform(document, before)!
    const firstPreview = applySelectionTranslationPreview(document, source, firstTarget, false)

    useWorkspace.getState().beginFloatingSelectionTransform(source, null, before, firstTarget, false, '移动选区内容', firstPreview)
    expect(readLayerColorAt(document, layer, 2, 0)).toEqual(red)

    const pending = useWorkspace.getState().sessions[0].pendingPaste!
    expect(pending.previewEdit).toBeNull()
    expect(pending.translationPreview).toBe(firstPreview)
    const secondTarget = { x: 3, y: 0, width: 1, height: 1 }
    const secondPreview = applySelectionTranslationPreview(document, pending.source, secondTarget, pending.copy, pending.translationPreview)
    expect(secondPreview).toBe(firstPreview)
    useWorkspace.getState().updateFloatingPastePreview(null, secondTarget, secondPreview)

    expect(readLayerColorAt(document, layer, 2, 0)).toEqual(darkBlue)
    expect(readLayerColorAt(document, layer, 3, 0)).toEqual(red)
    useWorkspace.getState().commitFloatingPaste()
    useWorkspace.getState().undo()
    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, 2, 0)).toEqual(darkBlue)
  })

  it('commits each repeated Ctrl copy from the current floating selection position', () => {
    const document = createDocument('repeated floating copies', 4, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, red)
    useWorkspace.getState().addSession(document)

    const copySelectionTo = (before: { x: number; y: number; width: number; height: number }, targetX: number): void => {
      const target = { ...before, x: targetX }
      const source = captureSelectionTransform(document, before)!
      const preview = applySelectionTranslationPreview(document, source, target, true)
      const edit = selectionTranslationPreviewEdit(document, preview)!
      useWorkspace.getState().beginFloatingSelectionTransform(source, edit, before, target, true, '复制选区内容')
      useWorkspace.getState().commitFloatingPaste()
    }

    copySelectionTo({ x: 0, y: 0, width: 1, height: 1 }, 1)
    copySelectionTo({ x: 1, y: 0, width: 1, height: 1 }, 2)

    expect([0, 1, 2].map((x) => readLayerColorAt(document, layer, x, 0))).toEqual([red, red, red])
    useWorkspace.getState().undo()
    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, 1, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, 2, 0)).toEqual(transparent)
  })

  it('retains one source rectangle across rotate, move, and rotate again', () => {
    const document = createDocument('repeated floating rotation', 9, 9, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 4 * document.width + 3, red)
    writeLayerColor(document, layer, 4 * document.width + 4, red)
    writeLayerColor(document, layer, 4 * document.width + 5, red)
    useWorkspace.getState().addSession(document)
    const selection = { x: 3, y: 4, width: 3, height: 1 }
    const source = captureSelectionTransform(document, selection)!
    const firstEdit = applySelectionTransform(document, source, selection, 45, true)!
    const rotated = transformSelectionMask(source.selection, selection, document.width, document.height, 45, undefined, false)!

    useWorkspace.getState().beginFloatingSelectionTransform(source, firstEdit, selection, rotated, true, 'copy', null, selection, 45)
    let pending = useWorkspace.getState().sessions[0].pendingPaste!

    expect(pending.transformTarget).toEqual(selection)
    expect(pending.transformAngle).toBe(45)
    expect(transformSelectionMask(pending.source.selection, pending.transformTarget!, document.width, document.height, pending.transformAngle, undefined, false)).toEqual(rotated)

    const movedTarget = { ...selection, x: selection.x + 1, y: selection.y - 1 }
    const moved = transformSelectionMask(source.selection, movedTarget, document.width, document.height, 45, undefined, false)!
    useWorkspace.getState().updateFloatingPastePreview(firstEdit, moved, null, movedTarget, 45)
    pending = useWorkspace.getState().sessions[0].pendingPaste!
    expect(pending.transformTarget).toEqual(movedTarget)
    expect(pending.transformAngle).toBe(45)

    const rotatedAgain = transformSelectionMask(source.selection, movedTarget, document.width, document.height, 90, undefined, false)!
    useWorkspace.getState().updateFloatingPastePreview(firstEdit, rotatedAgain, null, movedTarget, 90)
    pending = useWorkspace.getState().sessions[0].pendingPaste!
    expect(pending.source).toBe(source)
    expect(pending.transformTarget).toEqual(movedTarget)
    expect(pending.transformTarget?.width).toBe(selection.width)
    expect(pending.transformTarget?.height).toBe(selection.height)
    expect(pending.transformAngle).toBe(90)
    expect(pending.target).toEqual(rotatedAgain)
  })

  it('commits an empty floating selection rotation without creating a pixel edit', () => {
    const document = createDocument('empty floating selection rotation', 12, 12, 'rgba')
    useWorkspace.getState().addSession(document)
    const selection = { x: 3, y: 4, width: 6, height: 3 }
    const source = captureSelectionTransform(document, selection)!
    const rotated = transformSelectionMask(source.selection, selection, document.width, document.height, 45, undefined, false)!

    expect(applySelectionTransform(document, source, selection, 45)).toBeNull()
    useWorkspace.getState().beginFloatingSelectionTransform(source, null, selection, rotated, false, '变换选区', null, selection, 45)
    expect(useWorkspace.getState().sessions[0].pendingPaste?.transformAngle).toBe(45)

    useWorkspace.getState().commitFloatingPaste()
    expect(useWorkspace.getState().sessions[0].pendingPaste).toBeNull()
    expect(useWorkspace.getState().sessions[0].selection).toEqual(rotated)
    expect(document.dirty).toBe(false)

    useWorkspace.getState().undo()
    expect(useWorkspace.getState().sessions[0].selection).toEqual(selection)
    useWorkspace.getState().redo()
    expect(useWorkspace.getState().sessions[0].selection).toEqual(rotated)
  })

  it('preserves rotation and shear while moving a floating transform', () => {
    const document = createDocument('floating rotated shear', 12, 12, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 4 * document.width + 4, red)
    useWorkspace.getState().addSession(document)
    const selection = { x: 4, y: 4, width: 2, height: 2 }
    const source = captureSelectionTransform(document, selection)!
    const shear = { axis: 'x' as const, edge: 's' as const, amount: 2 }
    const transformed = transformSelectionMask(source.selection, selection, document.width, document.height, 30, shear, false)!
    const edit = applySelectionTransform(document, source, selection, 30, true, shear)!

    useWorkspace.getState().beginFloatingSelectionTransform(source, edit, selection, transformed, true, 'copy', null, selection, 30, shear)
    const movedTarget = { ...selection, x: 6, y: 3 }
    const moved = transformSelectionMask(source.selection, movedTarget, document.width, document.height, 30, shear, false)!
    useWorkspace.getState().updateFloatingPastePreview(edit, moved, null, movedTarget, 30, shear)

    const pending = useWorkspace.getState().sessions[0].pendingPaste!
    expect(pending.source).toBe(source)
    expect(pending.transformTarget).toEqual(movedTarget)
    expect(pending.transformAngle).toBe(30)
    expect(pending.transformShear).toEqual(shear)
    expect(pending.target).toEqual(moved)
  })

  it('keeps transformed geometry when flipping a rotated floating selection', () => {
    const document = createDocument('floating rotated flip', 10, 10, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 3 * document.width + 3, red)
    writeLayerColor(document, layer, 3 * document.width + 4, blue)
    useWorkspace.getState().addSession(document)
    const selection = { x: 3, y: 3, width: 2, height: 1 }
    const source = captureSelectionTransform(document, selection)!
    const rotated = transformSelectionMask(source.selection, selection, document.width, document.height, 45, undefined, false)!
    const edit = applySelectionTransform(document, source, selection, 45, true)!
    useWorkspace.getState().beginFloatingSelectionTransform(source, edit, selection, rotated, true, 'copy', null, selection, 45)

    useWorkspace.getState().flipActiveSelection('horizontal')

    const pending = useWorkspace.getState().sessions[0].pendingPaste!
    expect(pending.transformTarget).toEqual(selection)
    expect(pending.transformAngle).toBe(45)
    expect(pending.target).toEqual(transformSelectionMask(pending.source.selection, selection, document.width, document.height, 45, undefined, false))
  })

  it('keeps an original visible paste position floating until confirmation', async () => {
    const document = createDocument('clipboard', 4, 2, 'rgba')
    const source = getActiveLayer(document)
    if (source.format !== 'rgba') throw new Error('wrong layer mode')
    source.pixels.set([red.r, red.g, red.b, red.a], 0)
    source.pixels.set([0, 0, 0, 0], 4)
    writeLayerColor(document, source, 2, blue)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 0, y: 0, width: 2, height: 1 })

    useWorkspace.getState().copySelection()
    useWorkspace.getState().setSelection({ x: 1, y: 0, width: 2, height: 1 })
    await useWorkspace.getState().pasteSelection()

    expect(document.layers).toHaveLength(1)
    const pasted = getActiveLayer(document)
    expect(pasted.id).toBe(source.id)
    expect(readLayerColor(document, pasted, 0)).toEqual(red)
    expect(readLayerColor(document, pasted, 1)).toEqual(transparent)
    expect(readLayerColor(document, pasted, 2)).toEqual(blue)
    expect(readLayerColor(document, source, 0)).toEqual(red)
    expect(useWorkspace.getState().sessions[0].selection?.mask).toEqual(Uint8Array.from([1, 0]))
    expect(useWorkspace.getState().sessions[0].pendingPaste).not.toBeNull()
    expect(useWorkspace.getState().sessions[0].tool).toBe('selection')

    useWorkspace.getState().commitFloatingPaste()
    expect(useWorkspace.getState().sessions[0].pendingPaste).toBeNull()

    useWorkspace.getState().undo()
    expect(document.layers).toHaveLength(1)
    expect(readLayerColor(document, source, 0)).toEqual(red)
    expect(readLayerColor(document, source, 1)).toEqual(transparent)
    expect(readLayerColor(document, source, 2)).toEqual(blue)

    useWorkspace.getState().redo()
    expect(document.layers).toHaveLength(1)
    expect(readLayerColor(document, getActiveLayer(document), 1)).toEqual(transparent)
    expect(readLayerColor(document, source, 0)).toEqual(red)
    expect(readLayerColor(document, source, 2)).toEqual(blue)
  })

  it('rejects pixel paste when no layer or mask is selected', async () => {
    const readClipboardImage = vi.fn(async () => ({ width: 1, height: 1, data: Uint8Array.from([red.r, red.g, red.b, red.a]) }))
    installApi({ readClipboardImage })
    const document = createDocument('paste without target', 2, 2, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().clearLayerSelection()

    await useWorkspace.getState().pasteSelection()

    expect(readClipboardImage).not.toHaveBeenCalled()
    expect(useWorkspace.getState().sessions[0].pendingPaste).toBeNull()
    expect(useWorkspace.getState().message).toBeTruthy()
  })

  it('cancels an external floating paste without pixels or undo history remaining', async () => {
    installApi({ readClipboardImage: vi.fn(async () => ({ width: 1, height: 1, data: Uint8Array.from([red.r, red.g, red.b, red.a]) })) })
    const document = createDocument('cancel external paste', 2, 2, 'rgba')
    const layer = getActiveLayer(document)
    useWorkspace.getState().addSession(document)

    await useWorkspace.getState().pasteSelection()
    expect(readLayerColor(document, layer, 0)).toEqual(red)
    expect(useWorkspace.getState().sessions[0].history.canUndo).toBe(false)

    useWorkspace.getState().cancelFloatingPaste()

    expect(readLayerColor(document, layer, 0)).toEqual(transparent)
    expect(useWorkspace.getState().sessions[0].pendingPaste).toBeNull()
    expect(useWorkspace.getState().sessions[0].history.canUndo).toBe(false)
  })

  it('pastes a copied selection as an undoable new layer at its visible origin', async () => {
    const document = createDocument('paste layer', 8, 8, 'rgba')
    const source = getActiveLayer(document)
    writeLayerColor(document, source, 3 * document.width + 2, red)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 2, y: 3, width: 1, height: 1 })
    useWorkspace.getState().copySelection()

    expect(await useWorkspace.getState().pasteAsNewLayer()).toBe(true)

    const pasted = getActiveLayer(document)
    expect(document.layers).toHaveLength(2)
    expect(pasted).toMatchObject({ offsetX: 2, offsetY: 3, width: 1, height: 1 })
    expect(readLayerColor(document, pasted, 0)).toEqual(red)
    useWorkspace.getState().undo()
    expect(document.layers).toHaveLength(1)
  })

  it('moves a floating paste without clearing its old destination and cancels cleanly', async () => {
    const document = createDocument('floating paste', 4, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, red)
    writeLayerColor(document, layer, 1, blue)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 0, y: 0, width: 1, height: 1 })
    useWorkspace.getState().copySelection()
    useWorkspace.getState().setSelection({ x: 1, y: 0, width: 1, height: 1 })
    await useWorkspace.getState().pasteSelection()

    const pending = useWorkspace.getState().sessions[0].pendingPaste
    if (!pending) throw new Error('missing floating paste')
    revertPixelEdit(document, pending.previewEdit)
    const target = { ...pending.target, x: 2 }
    const moved = applySelectionTransform(document, pending.source, target, 0, true)
    if (!moved) throw new Error('missing floating move')
    useWorkspace.getState().updateFloatingPastePreview(moved, target)

    expect(readLayerColor(document, layer, 1)).toEqual(blue)
    expect(readLayerColor(document, layer, 2)).toEqual(red)
    useWorkspace.getState().cancelFloatingPaste()
    expect(readLayerColor(document, layer, 1)).toEqual(blue)
    expect(readLayerColor(document, layer, 2)).toEqual(transparent)
    expect(useWorkspace.getState().sessions[0].selection).toEqual({ x: 1, y: 0, width: 1, height: 1 })
  })

  it('prefers an image currently copied by another application', async () => {
    installApi({ readClipboardImage: vi.fn(async () => ({
      width: 2,
      height: 1,
      data: Uint8Array.from([0, 0, 0, 0, blue.r, blue.g, blue.b, blue.a])
    })) })
    const document = createDocument('system clipboard', 4, 1, 'rgba')
    useWorkspace.getState().addSession(document)

    await useWorkspace.getState().pasteSelection()

    const layer = getActiveLayer(document)
    expect(useWorkspace.getState().sessions[0].tool).toBe('selection')
    expect(useWorkspace.getState().sessions[0].selection?.mask).toEqual(Uint8Array.from([0, 1]))
    expect(readLayerColor(document, layer, 1).a).toBe(0)
    expect(readLayerColor(document, layer, 2)).toEqual(blue)
  })

  it('retains an oversized pasted image so hidden pixels can be moved into view', async () => {
    const colors = [red, blue, red, blue, red, blue]
    const data = new Uint8Array(colors.length * 4)
    for (let index = 0; index < colors.length; index += 1) {
      const offset = index * 4
      data[offset] = colors[index].r
      data[offset + 1] = colors[index].g
      data[offset + 2] = colors[index].b
      data[offset + 3] = colors[index].a
    }
    installApi({ readClipboardImage: vi.fn(async () => ({ width: 6, height: 1, data })) })
    const document = createDocument('oversized system clipboard', 3, 1, 'rgba')
    useWorkspace.getState().addSession(document)

    await useWorkspace.getState().pasteSelection()

    const pending = useWorkspace.getState().sessions[0].pendingPaste
    if (!pending) throw new Error('missing floating paste')
    expect(pending.source.selection).toMatchObject({ x: 0, y: 0, width: 6, height: 1 })
    revertPixelEdit(document, pending.previewEdit)
    const target = { ...pending.target, x: -3 }
    const moved = applySelectionTransform(document, pending.source, target, 0, true)
    if (!moved) throw new Error('missing moved paste')
    useWorkspace.getState().updateFloatingPastePreview(moved, target)

    const layer = getActiveLayer(document)
    expect(readLayerColor(document, layer, 0)).toEqual(blue)
    expect(readLayerColor(document, layer, 1)).toEqual(red)
    expect(readLayerColor(document, layer, 2)).toEqual(blue)
  })
})

describe('visible palette independence', () => {
  it('synchronizes unlocked foreground and background palette entries from color edits', () => {
    localStorage.setItem('moonsprite.palette-edit-locked', 'false')
    const document = createDocument('palette edit sync', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    const entry = document.palette.find((candidate) => candidate.id !== 0)!
    const foreground = { r: 17, g: 33, b: 49, a: 255 }
    const background = { r: 201, g: 203, b: 205, a: 255 }

    useWorkspace.getState().setPrimaryColor(entry.color)
    useWorkspace.getState().setPrimaryColor(foreground)
    expect(document.palette.find((candidate) => candidate.id === entry.id)?.color).toEqual(foreground)

    useWorkspace.getState().selectSecondaryPaletteColor(entry.id)
    useWorkspace.getState().setSecondaryColor(background)
    expect(document.palette.find((candidate) => candidate.id === entry.id)?.color).toEqual(background)
  })

  it('keeps palette editing attached to the selected swatch when colors are duplicated', () => {
    localStorage.setItem('moonsprite.palette-edit-locked', 'false')
    const document = createDocument('duplicate palette edit sync', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    const [duplicate, selected] = document.palette.filter((candidate) => candidate.id !== 0).slice(0, 2)
    duplicate.color = { ...selected.color }
    const replacement = { r: 13, g: 57, b: 91, a: 255 }

    useWorkspace.getState().selectPaletteColor(selected.id)
    useWorkspace.getState().setPrimaryColor(replacement)

    expect(document.palette.find((candidate) => candidate.id === selected.id)?.color).toEqual(replacement)
    expect(document.palette.find((candidate) => candidate.id === duplicate.id)?.color).not.toEqual(replacement)
    expect(useWorkspace.getState().sessions[0].paletteSelectionId).toBe(selected.id)
  })

  it('keeps the current color and visible palette selection synchronized', () => {
    const document = createDocument('palette selection', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().setPrimaryColor({ ...document.palette[1].color })
    expect(useWorkspace.getState().sessions[0].paletteSelectionId).toBe(document.palette[1].id)
    expect(useWorkspace.getState().sessions[0].selectedPaletteIds).toEqual([document.palette[1].id])

    useWorkspace.getState().setPrimaryColor(red)
    expect(useWorkspace.getState().sessions[0].paletteSelectionId).toBeNull()
    expect(useWorkspace.getState().sessions[0].selectedPaletteIds).toEqual([])

    useWorkspace.getState().selectPaletteColor(document.palette[0].id)
    expect(useWorkspace.getState().sessions[0].primaryColor).toEqual(document.palette[0].color)
  })

  it('keeps indexed pixels and internal colors when visible swatches are removed', () => {
    const document = createDocument('palette', 2, 1, 'indexed')
    const layer = getActiveLayer(document)
    if (layer.format !== 'indexed') throw new Error('wrong layer mode')
    layer.pixels[0] = 1
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectPaletteColor(1)
    useWorkspace.getState().deletePaletteColor(1)

    expect(document.palette.some((entry) => entry.id === 1)).toBe(true)
    expect(document.paletteOrder.includes(1)).toBe(false)
    expect(layer.pixels[0]).toBe(1)
    expect(readLayerColor(document, layer, 0)).toEqual({ r: 24, g: 27, b: 33, a: 255 })
  })

  it('does not append a newly painted indexed color to visible swatches', () => {
    const document = createDocument('painted palette', 1, 1, 'indexed')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, red)

    expect(document.palette.some((entry) => entry.color.r === 255 && entry.color.g === 0 && entry.color.b === 0)).toBe(true)
    expect(document.paletteOrder).toEqual([0, 1, 2])
  })

  it('reorders and deletes multiple palette colors as one history step', () => {
    const document = createDocument('multi palette', 1, 1, 'indexed')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectPaletteColor(1)
    useWorkspace.getState().selectPaletteColor(2, true)
    expect(document.paletteOrder).toEqual([0, 1, 2])
    expect(useWorkspace.getState().sessions[0].selectedPaletteIds).toEqual([1, 2])

    const reordered = repositionPaletteSlots(document.paletteSlots ?? [], [1, 2], 0, 1, document.paletteColumns)
    useWorkspace.getState().reorderPaletteColors([1, 2], reordered, document.paletteColumns ?? 8)
    expect(document.paletteOrder).toEqual([1, 2, 0])
    useWorkspace.getState().deletePaletteColors([1, 2])
    expect(document.paletteOrder).toEqual([0])

    useWorkspace.getState().undo()
    expect(document.paletteOrder).toEqual([1, 2, 0])
    useWorkspace.getState().redo()
    expect(document.paletteOrder).toEqual([0])
  })

  it('moves a palette color into an empty fixed slot and restores the layout through undo', () => {
    const document = createDocument('palette empty slot', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)

    const reordered = repositionPaletteSlots(document.paletteSlots ?? [], [1], 12, 1, document.paletteColumns)
    useWorkspace.getState().reorderPaletteColors([1], reordered, document.paletteColumns ?? 8)

    expect(document.paletteSlots?.[0]).toBeNull()
    expect(document.paletteSlots?.[12]).toBe(1)
    expect(document.paletteOrder).toEqual([2, 1])

    useWorkspace.getState().undo()
    expect(document.paletteSlots?.slice(0, 3)).toEqual([1, 2, null])
    expect(document.paletteOrder).toEqual([1, 2])
  })

  it('applies a built-in palette without changing indexed pixels or removing internal colors', () => {
    const document = createDocument('built in palette', 1, 1, 'indexed')
    const layer = getActiveLayer(document)
    if (layer.format !== 'indexed') throw new Error('wrong layer mode')
    layer.pixels[0] = 1
    const originalOrder = [...document.paletteOrder]
    const originalColor = readLayerColor(document, layer, 0)
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().applyPalette(builtInPalettes[0].colors)

    expect(document.paletteOrder[0]).toBe(0)
    expect(document.paletteOrder).toHaveLength(builtInPalettes[0].colors.length + 1)
    expect(layer.pixels[0]).toBe(1)
    expect(readLayerColor(document, layer, 0)).toEqual(originalColor)
    expect(document.palette.some((entry) => entry.id === 1)).toBe(true)
    useWorkspace.getState().undo()
    expect(document.paletteOrder).toEqual(originalOrder)
    useWorkspace.getState().redo()
    expect(document.paletteOrder).toHaveLength(builtInPalettes[0].colors.length + 1)
  })

  it('applies and restores a saved two-dimensional palette layout', () => {
    const document = createDocument('positioned saved palette', 1, 1, 'rgba')
    const colors = document.paletteOrder.map((id) => ({ ...document.palette.find((entry) => entry.id === id)!.color }))
    const originalColumns = document.paletteColumns
    const originalSlots = [...(document.paletteSlots ?? [])]
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().applyPalette(colors, { columns: 4, slots: [null, 0, null, 1] })

    expect(document.paletteColumns).toBe(4)
    expect(document.paletteSlots).toEqual([null, 1, null, 2])
    expect(document.paletteOrder).toEqual([1, 2])

    useWorkspace.getState().undo()
    expect(document.paletteColumns).toBe(originalColumns)
    expect(document.paletteSlots).toEqual(originalSlots)

    useWorkspace.getState().redo()
    expect(document.paletteColumns).toBe(4)
    expect(document.paletteSlots).toEqual([null, 1, null, 2])
  })
})

describe('nested layer groups', () => {
  it('duplicates a mixed selection of nested groups and direct layers with one undo step', () => {
    const document = createDocument('duplicate selected rows', 2, 2, 'rgba')
    const nestedMember = getActiveLayer(document)
    nestedMember.name = 'Nested member'
    nestedMember.groupId = 'child'
    const directLayer = createLayer('Direct layer', 2, 2, 'rgba')
    document.layers.push(directLayer)
    document.groups.push(
      { id: 'parent', name: 'Parent', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' },
      { id: 'child', name: 'Child', parentGroupId: 'parent', visible: true, locked: false, opacity: 1, blendMode: 'normal' },
      { id: 'empty-child', name: 'Empty child', parentGroupId: 'parent', visible: true, locked: false, opacity: 1, blendMode: 'normal' }
    )
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectLayerRows([directLayer.id], ['parent'])

    const copies = useWorkspace.getState().duplicateSelectedLayerRows()

    expect(copies.groupIds).toHaveLength(1)
    expect(copies.layerIds).toHaveLength(1)
    const parentCopy = document.groups.find((group) => group.id === copies.groupIds[0])!
    const childCopy = document.groups.find((group) => group.parentGroupId === parentCopy.id && group.name.startsWith('Child '))!
    const emptyChildCopy = document.groups.find((group) => group.parentGroupId === parentCopy.id && group.name.startsWith('Empty child '))!
    expect(childCopy).toBeDefined()
    expect(emptyChildCopy).toBeDefined()
    expect(document.layers.some((layer) => layer.groupId === childCopy.id && layer.name.startsWith('Nested member '))).toBe(true)
    expect(document.layers.find((layer) => layer.id === copies.layerIds[0])?.groupId ?? null).toBeNull()
    expect(useWorkspace.getState().sessions[0].selectedGroupIds).toEqual(copies.groupIds)
    const copiedRows = new Set([...copies.groupIds, ...copies.layerIds])
    expect(buildLayerPanelTree(document).filter((node) => node.depth === 0).slice(0, 2).every((node) => copiedRows.has(node.id))).toBe(true)

    useWorkspace.getState().undo()
    expect(document.groups.map((group) => group.id)).toEqual(['parent', 'child', 'empty-child'])
    expect(document.layers.map((layer) => layer.id)).toEqual([nestedMember.id, directLayer.id])
    expect(useWorkspace.getState().sessions[0].selectedGroupIds).toEqual(['parent'])

    useWorkspace.getState().redo()
    expect(document.groups.some((group) => group.id === parentCopy.id)).toBe(true)
    expect(document.layers.some((layer) => layer.id === copies.layerIds[0])).toBe(true)
  })

  it('creates an empty group when the layer panel has no selection', () => {
    const document = createDocument('empty group', 2, 2, 'rgba')
    const layer = getActiveLayer(document)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().clearLayerSelection()

    useWorkspace.getState().createLayerGroup()

    expect(document.groups).toHaveLength(1)
    expect(layer.groupId ?? null).toBeNull()
  })

  it('creates an empty sibling group immediately above a directly selected group', () => {
    const document = createDocument('group above group', 2, 2, 'rgba')
    document.groups.push({ id: 'selected-group', name: 'Selected', parentGroupId: null, panelOrder: 1, visible: true, locked: false, opacity: 1, blendMode: 'normal' })
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectGroup('selected-group')

    useWorkspace.getState().createLayerGroup()

    const created = document.groups.find((group) => group.id !== 'selected-group')!
    const tree = buildLayerPanelTree(document)
    expect(created.parentGroupId ?? null).toBeNull()
    expect(tree.findIndex((node) => node.id === created.id)).toBeLessThan(tree.findIndex((node) => node.id === 'selected-group'))
  })

  it('creates a new layer inside a selected member group but outside a directly selected group', async () => {
    const document = createDocument('grouped new layer', 2, 2, 'rgba')
    const member = getActiveLayer(document)
    document.groups.push({ id: 'group', name: '组', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' })
    member.groupId = 'group'
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().selectLayer(member.id)
    await useWorkspace.getState().addLayer()
    expect(getActiveLayer(document).groupId).toBe('group')

    useWorkspace.getState().selectGroup('group')
    await useWorkspace.getState().addLayer()
    expect(getActiveLayer(document).groupId ?? null).toBeNull()
  })

  it('blocks deleting a parent group when any descendant is explicitly locked', () => {
    const document = createDocument('descendant lock deletion', 2, 2, 'rgba')
    const layer = getActiveLayer(document)
    document.groups.push(
      { id: 'parent', name: '父组', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' },
      { id: 'child', name: '子组', parentGroupId: 'parent', visible: true, locked: true, opacity: 1, blendMode: 'normal' }
    )
    layer.groupId = 'child'
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectGroup('parent')

    useWorkspace.getState().deleteSelectedLayers()

    expect(document.groups.map((group) => group.id)).toEqual(['parent', 'child'])
  })

  it('does not allow a child layer to unlock while an ancestor group is locked', () => {
    const document = createDocument('ancestor lock editing', 2, 2, 'rgba')
    const layer = getActiveLayer(document)
    layer.locked = true
    document.groups.push({ id: 'parent', name: '父组', parentGroupId: null, visible: true, locked: true, opacity: 1, blendMode: 'normal' })
    layer.groupId = 'parent'
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().setLayerPropertiesWithBlend(layer.id, layer.name, layer.opacity, layer.blendMode, false)

    expect(layer.locked).toBe(true)
  })
  it('deletes an empty selected group and restores it with one undo', () => {
    const document = createDocument('empty group deletion', 2, 2, 'rgba')
    document.groups.push({ id: 'empty', name: '空组', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' })
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectGroup('empty')

    useWorkspace.getState().deleteSelectedLayers()
    expect(document.groups).toHaveLength(0)
    useWorkspace.getState().undo()
    expect(document.groups.map((group) => group.id)).toEqual(['empty'])
  })

  it('rejects deleting or moving locked layers and groups', () => {
    const document = createDocument('locked structure', 2, 2, 'rgba')
    const layer = getActiveLayer(document)
    document.groups.push({ id: 'locked-group', name: '锁定组', parentGroupId: null, visible: true, locked: true, opacity: 1, blendMode: 'normal' })
    layer.groupId = 'locked-group'
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectGroup('locked-group')

    useWorkspace.getState().deleteSelectedLayers()
    expect(document.groups.map((group) => group.id)).toEqual(['locked-group'])
    expect(document.layers.map((candidate) => candidate.id)).toEqual([layer.id])
    useWorkspace.getState().moveGroupToRootEdge('locked-group', 'bottom')
    expect(useWorkspace.getState().sessions[0].history.canUndo).toBe(false)
  })

  it('uses Ctrl for discrete selection and Shift for the visible layer range', () => {
    const document = createDocument('layer range selection', 2, 2, 'rgba')
    const bottom = getActiveLayer(document)
    const middle = createLayer('Middle', 2, 2, 'rgba')
    const top = createLayer('Top', 2, 2, 'rgba')
    document.layers.push(middle, top)
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().selectLayer(top.id)
    useWorkspace.getState().selectLayer(bottom.id, 'range')
    expect(useWorkspace.getState().sessions[0].selectedLayerIds).toEqual([top.id, middle.id, bottom.id])

    useWorkspace.getState().selectLayer(middle.id, 'toggle')
    expect(useWorkspace.getState().sessions[0].selectedLayerIds).toEqual([top.id, bottom.id])
  })

  it('includes groups in a Shift range and deletes the mixed selection in one step', () => {
    const document = createDocument('mixed layer range', 2, 2, 'rgba')
    const bottom = getActiveLayer(document)
    bottom.name = 'Bottom'
    const member = createLayer('Member', 2, 2, 'rgba')
    member.groupId = 'group'
    const outside = createLayer('Outside', 2, 2, 'rgba')
    document.layers.push(member, outside)
    document.groups.push({ id: 'group', name: 'Group', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' })
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().selectGroup('group')
    useWorkspace.getState().selectLayer(bottom.id, 'range')
    const selected = useWorkspace.getState().sessions[0]
    expect(selected.selectedGroupIds).toEqual(['group'])
    expect(selected.selectedLayerIds).toEqual([member.id, bottom.id])

    useWorkspace.getState().deleteSelectedLayers()
    expect(document.groups).toHaveLength(0)
    expect(document.layers.map((layer) => layer.id)).toEqual([outside.id])

    useWorkspace.getState().undo()
    expect(document.groups.map((group) => group.id)).toEqual(['group'])
    expect(document.layers.map((layer) => layer.id)).toEqual([bottom.id, member.id, outside.id])
    expect(useWorkspace.getState().sessions[0].selectedGroupIds).toEqual(['group'])
  })

  it('selects descendant layers and prevents moving a parent into its child', () => {
    const document = createDocument('nested groups', 2, 2, 'rgba')
    const layer = getActiveLayer(document)
    document.groups.push(
      { id: 'parent', name: '父组', parentGroupId: null, visible: true, locked: true, opacity: 1, blendMode: 'normal' },
      { id: 'child', name: '子组', parentGroupId: 'parent', visible: true, locked: false, opacity: 1, blendMode: 'normal' }
    )
    layer.groupId = 'child'
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().selectGroup('parent')
    expect(useWorkspace.getState().sessions[0].selectedLayerIds).toEqual([layer.id])
    expect(isLayerEffectivelyLocked(document, layer)).toBe(true)
    expect(isLayerEffectivelyVisible(document, layer)).toBe(true)
    document.groups.find((group) => group.id === 'parent')!.visible = false
    expect(isLayerEffectivelyVisible(document, layer)).toBe(false)

    useWorkspace.getState().assignGroupToGroup('parent', 'child')
    expect(document.groups.find((group) => group.id === 'parent')?.parentGroupId).toBeNull()
  })

  it('ungroups only the selected level and promotes its child groups', () => {
    const document = createDocument('ungroup nested', 2, 2, 'rgba')
    const layer = getActiveLayer(document)
    document.groups.push(
      { id: 'parent', name: '父组', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' },
      { id: 'child', name: '子组', parentGroupId: 'parent', visible: true, locked: false, opacity: 1, blendMode: 'normal' }
    )
    layer.groupId = 'child'
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectGroup('parent')

    useWorkspace.getState().ungroupSelected()

    expect(document.groups.map((group) => group.id)).toEqual(['child'])
    expect(document.groups[0].parentGroupId).toBeNull()
    expect(layer.groupId).toBe('child')
  })

  it('moves grouped layers back to the root and restores their group on undo', () => {
    const document = createDocument('move to root', 2, 2, 'rgba')
    const layer = getActiveLayer(document)
    document.groups.push({ id: 'group', name: '组', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' })
    layer.groupId = 'group'
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().assignLayersToRoot([layer.id])
    expect(layer.groupId).toBeNull()

    useWorkspace.getState().undo()
    expect(layer.groupId).toBe('group')
    useWorkspace.getState().redo()
    expect(layer.groupId).toBeNull()
  })

  it('moves root layers between group members and can place a member above its group', async () => {
    const document = createDocument('group drop positions', 2, 2, 'rgba')
    const first = getActiveLayer(document)
    document.groups.push({ id: 'group', name: 'Group', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' })
    first.groupId = 'group'
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().addLayer()
    const second = getActiveLayer(document)

    useWorkspace.getState().assignLayersToGroup([second.id], 'group', first.id, true)
    expect(second.groupId).toBe('group')
    expect(document.layers.map((layer) => layer.id)).toEqual([first.id, second.id])

    useWorkspace.getState().assignLayersAboveGroup([second.id], 'group')
    expect(second.groupId).toBeNull()
    expect(document.layers.map((layer) => layer.id)).toEqual([first.id, second.id])
    useWorkspace.getState().undo()
    expect(second.groupId).toBe('group')
  })

  it('creates new layers above the selected row and at root top without a selection', async () => {
    const document = createDocument('new layers on top', 2, 2, 'rgba')
    const original = getActiveLayer(document)
    useWorkspace.getState().addSession(document)

    await useWorkspace.getState().addLayer()
    const firstCreated = getActiveLayer(document)
    useWorkspace.getState().selectLayer(original.id)
    await useWorkspace.getState().addLayer()
    const latestCreated = getActiveLayer(document)

    expect(document.layers.map((layer) => layer.id)).toEqual([original.id, latestCreated.id, firstCreated.id])

    useWorkspace.getState().clearLayerSelection()
    await useWorkspace.getState().addLayer()
    const withoutSelection = getActiveLayer(document)
    expect(document.layers.at(-1)?.id).toBe(withoutSelection.id)
  })

  it('reorders a complete group relative to another group and restores it on undo', async () => {
    const document = createDocument('reorder groups', 2, 2, 'rgba')
    const first = getActiveLayer(document)
    document.groups.push(
      { id: 'group-a', name: 'Group A', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' },
      { id: 'group-b', name: 'Group B', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' }
    )
    first.groupId = 'group-a'
    useWorkspace.getState().addSession(document)
    await useWorkspace.getState().addLayer()
    const second = getActiveLayer(document)
    second.groupId = 'group-b'

    useWorkspace.getState().reorderGroup('group-a', 'group-b', true)

    expect(document.layers.map((layer) => layer.id)).toEqual([second.id, first.id])
    expect(document.groups.map((group) => group.id)).toEqual(['group-b', 'group-a'])
    useWorkspace.getState().undo()
    expect(document.layers.map((layer) => layer.id)).toEqual([first.id, second.id])
    expect(document.groups.map((group) => group.id)).toEqual(['group-a', 'group-b'])
  })

  it('pastes a copied group beside the currently selected object', () => {
    const document = createDocument('nested group paste', 2, 2, 'rgba')
    const layer = getActiveLayer(document)
    layer.groupId = 'child'
    document.groups.push(
      { id: 'parent', name: 'Parent', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' },
      { id: 'child', name: 'Child', parentGroupId: 'parent', visible: true, locked: false, opacity: 1, blendMode: 'normal' },
      { id: 'sibling', name: 'Sibling', parentGroupId: 'parent', visible: true, locked: false, opacity: 1, blendMode: 'normal' }
    )
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectGroup('child')

    useWorkspace.getState().copySelectedLayersToClipboard()
    useWorkspace.getState().selectGroup('sibling')
    expect(useWorkspace.getState().pasteLayersFromClipboard()).toBe(true)

    const copy = document.groups.find((group) => group.name === 'Child 副本')
    expect(copy?.parentGroupId).toBe('parent')
  })

  it('pastes plain layers immediately above the selected row or at root top', () => {
    const source = createDocument('plain layer source', 2, 2, 'rgba')
    getActiveLayer(source).name = 'Source'
    useWorkspace.getState().addSession(source)
    useWorkspace.getState().copySelectedLayersToClipboard()

    const target = createDocument('plain layer target', 2, 2, 'rgba')
    const member = getActiveLayer(target)
    member.name = 'Member'
    member.groupId = 'target-group'
    const rootBottom = createLayer('Root Bottom', 2, 2, 'rgba')
    const rootTop = createLayer('Root Top', 2, 2, 'rgba')
    target.layers.push(rootBottom, rootTop)
    target.groups.push({ id: 'target-group', name: 'Target Group', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' })
    useWorkspace.getState().addSession(target)
    useWorkspace.getState().setActive(target.id)

    useWorkspace.getState().selectGroup('target-group')
    expect(useWorkspace.getState().pasteLayersFromClipboard()).toBe(true)
    const copyAboveGroup = target.layers.find((layer) => layer.name === 'Source 副本' && !layer.groupId)!
    const treeAfterGroupPaste = buildLayerPanelTree(target)
    expect(treeAfterGroupPaste.findIndex((node) => node.id === copyAboveGroup.id)).toBeLessThan(treeAfterGroupPaste.findIndex((node) => node.id === 'target-group'))

    useWorkspace.getState().selectLayer(rootBottom.id)
    expect(useWorkspace.getState().pasteLayersFromClipboard()).toBe(true)
    const rootCopies = target.layers.filter((layer) => layer.name === 'Source 副本' && !layer.groupId)
    const copyAboveLayer = rootCopies.at(-1)!
    expect(target.layers.indexOf(copyAboveLayer)).toBe(target.layers.indexOf(rootBottom) + 1)

    useWorkspace.getState().clearLayerSelection()
    expect(useWorkspace.getState().pasteLayersFromClipboard()).toBe(true)
    const latestRootCopy = target.layers.filter((layer) => layer.name === 'Source 副本' && !layer.groupId).at(-1)!
    expect(target.layers.indexOf(latestRootCopy)).toBe(Math.max(...target.layers.filter((layer) => !layer.groupId).map((layer) => target.layers.indexOf(layer))))
  })

  it('pastes a copied group immediately above the selected object in its parent', () => {
    const source = createDocument('group source', 2, 2, 'rgba')
    getActiveLayer(source).groupId = 'source-group'
    source.groups.push({ id: 'source-group', name: 'Source Group', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' })
    useWorkspace.getState().addSession(source)
    useWorkspace.getState().selectGroup('source-group')
    useWorkspace.getState().copySelectedLayersToClipboard()

    const target = createDocument('group target', 2, 2, 'rgba')
    const childAMember = getActiveLayer(target)
    childAMember.groupId = 'child-a'
    const childBMember = createLayer('Child B member', 2, 2, 'rgba')
    childBMember.groupId = 'child-b'
    target.layers.push(childBMember)
    target.groups.push(
      { id: 'parent', name: 'Parent', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' },
      { id: 'child-a', name: 'Child A', parentGroupId: 'parent', visible: true, locked: false, opacity: 1, blendMode: 'normal' },
      { id: 'child-b', name: 'Child B', parentGroupId: 'parent', visible: true, locked: false, opacity: 1, blendMode: 'normal' }
    )
    useWorkspace.getState().addSession(target)
    useWorkspace.getState().setActive(target.id)
    useWorkspace.getState().selectGroup('child-a')

    expect(useWorkspace.getState().pasteLayersFromClipboard()).toBe(true)
    const copiedGroup = target.groups.find((group) => group.name === 'Source Group 副本')!
    const copiedMember = target.layers.find((layer) => layer.groupId === copiedGroup.id)!
    expect(copiedGroup.parentGroupId).toBe('parent')
    const tree = buildLayerPanelTree(target)
    expect(tree.findIndex((node) => node.id === copiedGroup.id)).toBeLessThan(tree.findIndex((node) => node.id === 'child-a'))
    expect(copiedMember).toBeDefined()
    expect(useWorkspace.getState().sessions.at(-1)?.selectedGroupId).toBeNull()
    expect(useWorkspace.getState().sessions.at(-1)?.selectedGroupIds).toEqual([copiedGroup.id])
    expect(useWorkspace.getState().sessions.at(-1)?.selectedLayerIds).toEqual([copiedMember.id])

    useWorkspace.getState().undo()
    expect(useWorkspace.getState().sessions.at(-1)?.selectedGroupId).toBe('child-a')
    useWorkspace.getState().redo()
    expect(useWorkspace.getState().sessions.at(-1)?.selectedGroupIds).toEqual([copiedGroup.id])
    expect(useWorkspace.getState().sessions.at(-1)?.selectedLayerIds).toEqual([copiedMember.id])
  })

  it('allows locked layer metadata edits but preserves opacity and blend mode', () => {
    const document = createDocument('locked metadata', 1, 1, 'rgba')
    const layer = getActiveLayer(document)
    layer.locked = true
    layer.opacity = 0.5
    layer.blendMode = 'multiply'
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().setLayerPropertiesWithBlend(layer.id, '已重命名', 0.9, 'screen', true, red, '可编辑描述')

    expect(layer).toMatchObject({ name: '已重命名', opacity: 0.5, blendMode: 'multiply', description: '可编辑描述' })
    expect(layer.displayColor).toEqual(red)
  })

  it('commits cumulative group blending with undo and redo', () => {
    const document = createDocument('cumulative group property', 1, 1, 'rgba')
    document.groups.push({ id: 'group', name: 'Group', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'multiply' })
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().setGroupProperties('group', 'Group', 1, 'multiply', false, undefined, undefined, true)
    expect(document.groups[0].cumulativeBlend).toBe(true)

    useWorkspace.getState().undo()
    expect(document.groups[0].cumulativeBlend).toBe(false)

    useWorkspace.getState().redo()
    expect(document.groups[0].cumulativeBlend).toBe(true)
  })

  it('commits clipping masks for layers and groups with undo and redo', () => {
    const document = createDocument('clipping mask property', 1, 1, 'rgba')
    const layer = getActiveLayer(document)
    document.groups.push({ id: 'group', name: 'Group', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' })
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().setClippingMask('layer', layer.id, true)
    expect(layer.clippingMask).toBe(true)
    useWorkspace.getState().undo()
    expect(layer.clippingMask).toBeUndefined()
    useWorkspace.getState().redo()
    expect(layer.clippingMask).toBe(true)

    useWorkspace.getState().setClippingMask('group', 'group', true)
    expect(document.groups[0].clippingMask).toBe(true)
    useWorkspace.getState().undo()
    expect(document.groups[0].clippingMask).toBeUndefined()
  })

  it('toggles clipping masks on the selected group or active layer', () => {
    const document = createDocument('active clipping mask target', 1, 1, 'rgba')
    const layer = getActiveLayer(document)
    document.groups.push({ id: 'group', name: 'Group', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' })
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().toggleActiveClippingMask()
    expect(layer.clippingMask).toBe(true)

    useWorkspace.getState().selectGroup('group')
    useWorkspace.getState().toggleActiveClippingMask()
    expect(document.groups[0].clippingMask).toBe(true)
    expect(layer.clippingMask).toBe(true)
  })

  it('preserves locked opacity through compatibility property setters', () => {
    const document = createDocument('locked compatibility setters', 1, 1, 'rgba')
    const layer = getActiveLayer(document)
    layer.locked = true
    layer.opacity = 0.5
    useWorkspace.getState().addSession(document)

    useWorkspace.getState().setLayerOpacity(layer.id, 0.9)
    expect(document.dirty).toBe(false)
    expect(useWorkspace.getState().sessions[0].history.canUndo).toBe(false)

    useWorkspace.getState().setLayerProperties(layer.id, '已重命名', 0.8)

    expect(layer.name).toBe('已重命名')
    expect(layer.opacity).toBe(0.5)
  })
})

describe('selection view commands', () => {
  it('inverts the active mask with undo while outline visibility stays view-only', () => {
    const document = createDocument('selection commands', 3, 2, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 0, y: 0, width: 1, height: 1 })

    useWorkspace.getState().invertSelection()
    const session = useWorkspace.getState().sessions[0]
    expect(session.selection?.mask?.reduce((total, value) => total + value, 0)).toBe(5)
    expect(document.dirty).toBe(false)

    const undoBeforeToggle = session.history.canUndo
    useWorkspace.getState().toggleSelectionOutline()
    expect(session.view.showSelectionOutline).toBe(false)
    expect(session.history.canUndo).toBe(undoBeforeToggle)

    useWorkspace.getState().undo()
    expect(session.selection).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })

  it('keeps Ctrl+H view-only while a pasted selection remains cancelable', async () => {
    installApi({ readClipboardImage: vi.fn(async () => ({ width: 1, height: 1, data: Uint8Array.from([red.r, red.g, red.b, red.a]) })) })
    const document = createDocument('floating paste outline', 3, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 0, y: 0, width: 1, height: 1 })

    await useWorkspace.getState().pasteSelection()
    const session = useWorkspace.getState().sessions[0]
    const pastedX = session.pendingPaste?.target.x
    expect(pastedX).toBeTypeOf('number')
    expect(readLayerColorAt(document, getActiveLayer(document), pastedX!, 0)).toEqual(red)

    const revisionBeforeToggle = session.revision
    useWorkspace.getState().toggleSelectionOutline()
    expect(session.pendingPaste).not.toBeNull()
    expect(session.revision).toBeGreaterThan(revisionBeforeToggle)

    useWorkspace.getState().undo()
    expect(session.pendingPaste).toBeNull()
    expect(readLayerColorAt(document, getActiveLayer(document), pastedX!, 0)).toEqual(transparent)
  })

  it('restores the exact floating paste background after outline and mirror operations', async () => {
    installApi({ readClipboardImage: vi.fn(async () => ({ width: 1, height: 1, data: Uint8Array.from([red.r, red.g, red.b, red.a]) })) })
    const document = createDocument('floating mirror cleanup', 4, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 1, blue)
    writeLayerColor(document, layer, 3, { r: 12, g: 38, b: 86, a: 255 })
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 0, y: 0, width: 1, height: 1 })
    useWorkspace.getState().copySelection()
    useWorkspace.getState().setSelection({ x: 1, y: 0, width: 1, height: 1 })
    await useWorkspace.getState().pasteSelection()
    useWorkspace.getState().toggleSelectionOutline()
    useWorkspace.getState().flipActiveSelection('horizontal')
    const pending = useWorkspace.getState().sessions[0].pendingPaste!
    revertPixelEdit(document, pending.previewEdit)
    const movedTarget = { ...pending.target, x: 2 }
    const moved = applySelectionTransform(document, pending.source, movedTarget, 0, true)!
    useWorkspace.getState().updateFloatingPastePreview(moved, movedTarget)
    useWorkspace.getState().cancelFloatingPaste()

    expect(readLayerColorAt(document, layer, 0, 0)).toEqual(transparent)
    expect(readLayerColorAt(document, layer, 1, 0)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 2, 0)).toEqual(transparent)
    expect(readLayerColorAt(document, layer, 3, 0)).toEqual({ r: 12, g: 38, b: 86, a: 255 })
  })

  it('keeps the current floating pixels after mirroring, moving, and mirroring again', async () => {
    const document = createDocument('floating mirror after move', 6, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, red)
    writeLayerColor(document, layer, 1, blue)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 0, y: 0, width: 2, height: 1 })
    useWorkspace.getState().copySelection()
    useWorkspace.getState().setSelection({ x: 2, y: 0, width: 2, height: 1 })
    await useWorkspace.getState().pasteSelection()

    useWorkspace.getState().flipActiveSelection('horizontal')
    const pending = useWorkspace.getState().sessions[0].pendingPaste!
    revertPixelEdit(document, pending.previewEdit)
    const movedTarget = { ...pending.target, x: Math.min(document.width - pending.target.width, pending.target.x + 1) }
    const moved = applySelectionTransform(document, pending.source, movedTarget, 0, true)!
    useWorkspace.getState().updateFloatingPastePreview(moved, movedTarget)
    useWorkspace.getState().flipActiveSelection('horizontal')

    expect(readLayerColorAt(document, layer, movedTarget.x, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, movedTarget.x + 1, 0)).toEqual(blue)
  })

  it('moves a pasted floating selection after every repeated mirror without corrupting its background', async () => {
    const document = createDocument('pasted repeated mirror moves', 10, 1, 'rgba')
    const layer = getActiveLayer(document)
    const background = Array.from({ length: 10 }, (_, index) => ({ r: 8 + index, g: 20 + index, b: 40 + index, a: 255 }))
    background.forEach((color, index) => writeLayerColor(document, layer, index, color))
    installApi({ readClipboardImage: vi.fn(async () => ({ width: 2, height: 1, data: Uint8Array.from([red.r, red.g, red.b, red.a, blue.r, blue.g, blue.b, blue.a]) })) })
    useWorkspace.getState().addSession(document)
    background.forEach((color, index) => expect(readLayerColorAt(document, layer, index, 0)).toEqual(color))
    await useWorkspace.getState().pasteSelection()

    const moveFloating = (x: number): void => {
      const pending = useWorkspace.getState().sessions[0].pendingPaste!
      revertPixelEdit(document, pending.previewEdit)
      const target = { ...pending.target, x }
      const preview = applySelectionTranslationPreview(document, pending.source, target, false)
      useWorkspace.getState().updateFloatingPastePreview(selectionTranslationPreviewEdit(document, preview)!, target)
    }
    useWorkspace.getState().flipActiveSelection('horizontal')
    moveFloating(4)
    useWorkspace.getState().flipActiveSelection('horizontal')
    moveFloating(7)
    useWorkspace.getState().flipActiveSelection('horizontal')

    expect(readLayerColorAt(document, layer, 7, 0)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 8, 0)).toEqual(red)
    background.forEach((color, index) => {
      if (index !== 7 && index !== 8) expect(readLayerColorAt(document, layer, index, 0)).toEqual(color)
    })
    useWorkspace.getState().cancelFloatingPaste()
    background.forEach((color, index) => expect(readLayerColorAt(document, layer, index, 0)).toEqual(color))
  })

  it('keeps a moved selection mirrored through repeated mirrors and later moves', () => {
    const document = createDocument('repeated floating mirror moves', 8, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, red)
    writeLayerColor(document, layer, 1, blue)
    useWorkspace.getState().addSession(document)
    const original = { x: 0, y: 0, width: 2, height: 1 }
    const source = captureSelectionTransform(document, original)!
    const firstTarget = { ...original, x: 2 }
    const firstEdit = applySelectionTransform(document, source, firstTarget)!
    useWorkspace.getState().beginFloatingSelectionTransform(source, firstEdit, original, firstTarget, false, 'move')

    useWorkspace.getState().flipActiveSelection('horizontal')
    let pending = useWorkspace.getState().sessions[0].pendingPaste!
    revertPixelEdit(document, pending.previewEdit)
    const secondTarget = { ...pending.target, x: 4 }
    const secondPreview = applySelectionTranslationPreview(document, pending.source, secondTarget)
    useWorkspace.getState().updateFloatingPastePreview(selectionTranslationPreviewEdit(document, secondPreview)!, secondTarget)

    expect(readLayerColorAt(document, layer, 4, 0)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 5, 0)).toEqual(red)

    useWorkspace.getState().flipActiveSelection('horizontal')
    pending = useWorkspace.getState().sessions[0].pendingPaste!
    revertPixelEdit(document, pending.previewEdit)
    const thirdTarget = { ...pending.target, x: 6 }
    const thirdPreview = applySelectionTranslationPreview(document, pending.source, thirdTarget)
    useWorkspace.getState().updateFloatingPastePreview(selectionTranslationPreviewEdit(document, thirdPreview)!, thirdTarget)

    expect(readLayerColorAt(document, layer, 4, 0)).toEqual(transparent)
    expect(readLayerColorAt(document, layer, 5, 0)).toEqual(transparent)
    expect(readLayerColorAt(document, layer, 6, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, 7, 0)).toEqual(blue)
  })

  it('keeps sparse drawn pixels mirrored after move, repeated mirror, and another move', () => {
    const document = createDocument('drawn repeated mirror moves', 10, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, red)
    writeLayerColor(document, layer, 2, blue)
    useWorkspace.getState().addSession(document)
    const original = { x: 0, y: 0, width: 4, height: 1 }
    useWorkspace.getState().setSelection(original)

    useWorkspace.getState().flipActiveSelection('horizontal')
    const mirroredSelection = useWorkspace.getState().sessions[0].selection!
    const source = captureSelectionTransform(document, mirroredSelection)!
    const firstTarget = { ...mirroredSelection, x: 3 }
    const firstEdit = applySelectionTransform(document, source, firstTarget)!
    useWorkspace.getState().beginFloatingSelectionTransform(source, firstEdit, mirroredSelection, firstTarget, false, 'move')

    useWorkspace.getState().flipActiveSelection('horizontal')
    const pending = useWorkspace.getState().sessions[0].pendingPaste!
    revertPixelEdit(document, pending.previewEdit)
    const secondTarget = { ...pending.target, x: 6 }
    const secondPreview = applySelectionTranslationPreview(document, pending.source, secondTarget)
    useWorkspace.getState().updateFloatingPastePreview(selectionTranslationPreviewEdit(document, secondPreview)!, secondTarget)

    expect(readLayerColorAt(document, layer, 6, 0)).toEqual(red)
    expect(readLayerColorAt(document, layer, 7, 0)).toEqual(transparent)
    expect(readLayerColorAt(document, layer, 8, 0)).toEqual(blue)
    expect(readLayerColorAt(document, layer, 9, 0)).toEqual(transparent)
  })
})

describe('animation keyboard navigation', () => {
  it('steps left and right through animation frames without entering document history', () => {
    const document = createDocument('frame navigation', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    const session = useWorkspace.getState().sessions[0]
    const first = document.animation!.frames[0].id
    const second = document.animation!.frames[1].id
    expect(document.animation!.activeFrameId).toBe(second)

    useWorkspace.getState().stepAnimationFrame(-1)
    expect(document.animation!.activeFrameId).toBe(first)
    useWorkspace.getState().stepAnimationFrame(1)
    expect(document.animation!.activeFrameId).toBe(second)
    expect(session.history.canUndo).toBe(true)
  })
})

describe('linked animation cel history', () => {
  it('connects selected cels and restores links with undo and redo', () => {
    const document = createDocument('linked cel history', 1, 1, 'rgba')
    getActiveLayer(document).pixels[3] = 255
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    const timeline = ensureAnimationDocument(document)
    const layerId = document.activeLayerId
    const keys = timeline.frames.map((frame) => animationCelKey(layerId, frame.id))
    useWorkspace.getState().selectAnimationCell(keys[0])
    useWorkspace.getState().selectAnimationCell(keys[1], 'toggle')
    useWorkspace.getState().connectSelectedAnimationCels()

    const linked = ensureAnimationDocument(document).cels.filter((cel) => keys.includes(animationCelKey(cel.layerId, cel.frameId)))
    expect(linked[1].linkedCelId).toBe(linked[0].id)
    useWorkspace.getState().undo()
    expect(ensureAnimationDocument(document).cels.find((cel) => cel.id === linked[1].id)?.linkedCelId).toBeUndefined()
    useWorkspace.getState().redo()
    expect(ensureAnimationDocument(document).cels.find((cel) => cel.id === linked[1].id)?.linkedCelId).toBe(linked[0].id)
  })

  it('disconnects selected linked cels and supports undo and redo', () => {
    const document = createDocument('unlink linked cel history', 1, 1, 'rgba')
    getActiveLayer(document).pixels[3] = 255
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    const timeline = ensureAnimationDocument(document)
    const keys = timeline.frames.map((frame) => animationCelKey(document.activeLayerId, frame.id))
    useWorkspace.getState().selectAnimationCell(keys[0])
    useWorkspace.getState().selectAnimationCell(keys[1], 'toggle')
    useWorkspace.getState().connectSelectedAnimationCels()
    const linked = ensureAnimationDocument(document).cels.filter((cel) => keys.includes(animationCelKey(cel.layerId, cel.frameId)))

    useWorkspace.getState().selectAnimationCell(keys[1])
    useWorkspace.getState().disconnectSelectedAnimationCels()
    expect(ensureAnimationDocument(document).cels.find((cel) => cel.id === linked[1].id)?.linkedCelId).toBeNull()
    useWorkspace.getState().undo()
    expect(ensureAnimationDocument(document).cels.find((cel) => cel.id === linked[1].id)?.linkedCelId).toBe(linked[0].id)
    useWorkspace.getState().redo()
    expect(ensureAnimationDocument(document).cels.find((cel) => cel.id === linked[1].id)?.linkedCelId).toBeNull()
  })

  it('pastes into the shared source of a linked cel without breaking the link', () => {
    const document = createDocument('paste into linked cel', 1, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, red)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    useWorkspace.getState().duplicateAnimationFrame()
    const timeline = ensureAnimationDocument(document)
    const keys = timeline.frames.map((frame) => animationCelKey(layer.id, frame.id))
    useWorkspace.getState().selectAnimationCell(keys[0])
    useWorkspace.getState().selectAnimationCell(keys[1], 'toggle')
    useWorkspace.getState().connectSelectedAnimationCels()
    const linkedSource = resolveAnimationCel(timeline, animationCelAt(timeline, layer.id, timeline.frames[1].id))!
    const linkedTarget = animationCelAt(timeline, layer.id, timeline.frames[1].id)!
    const originalLinkId = linkedTarget.linkedCelId
    const clipboardCel = animationCelAt(timeline, layer.id, timeline.frames[2].id)!
    if (!clipboardCel.surface || clipboardCel.surface.format !== 'rgba') throw new Error('missing rgba cel')
    clipboardCel.surface.pixels.set([blue.r, blue.g, blue.b, blue.a])
    useWorkspace.getState().selectAnimationCell(keys[2])
    useWorkspace.getState().copySelectedAnimationCels()
    useWorkspace.getState().selectAnimationCell(keys[1])

    useWorkspace.getState().pasteAnimationCels()

    expect(linkedTarget.linkedCelId).toBe(originalLinkId)
    expect(Array.from(linkedSource.surface!.pixels)).toEqual([blue.r, blue.g, blue.b, blue.a])
    expect(resolveAnimationCel(timeline, linkedTarget)).toBe(linkedSource)
    useWorkspace.getState().undo()
    let restoredTarget = animationCelAt(timeline, layer.id, timeline.frames[1].id)!
    expect(restoredTarget.linkedCelId).toBe(originalLinkId)
    expect(Array.from(resolveAnimationCel(timeline, restoredTarget)!.surface!.pixels)).toEqual([red.r, red.g, red.b, red.a])
    useWorkspace.getState().redo()
    restoredTarget = animationCelAt(timeline, layer.id, timeline.frames[1].id)!
    expect(restoredTarget.linkedCelId).toBe(originalLinkId)
    expect(Array.from(resolveAnimationCel(timeline, restoredTarget)!.surface!.pixels)).toEqual([blue.r, blue.g, blue.b, blue.a])
  })

  it('breaks a cel link before clearing content and restores the whole link group with undo', () => {
    const document = createDocument('clear linked cel', 1, 1, 'rgba')
    getActiveLayer(document).pixels.set([20, 40, 60, 255])
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    useWorkspace.getState().duplicateAnimationFrame()
    const timeline = ensureAnimationDocument(document)
    const keys = timeline.frames.map((frame) => animationCelKey(document.activeLayerId, frame.id))
    for (const [index, key] of keys.entries()) useWorkspace.getState().selectAnimationCell(key, index === 0 ? 'replace' : 'toggle')
    useWorkspace.getState().connectSelectedAnimationCels()

    const linked = ensureAnimationDocument(document).cels.filter((cel) => keys.includes(animationCelKey(cel.layerId, cel.frameId)))
    const sourceId = linked[0].id
    useWorkspace.getState().selectAnimationCell(keys[1])
    useWorkspace.getState().deleteSelectedAnimationItems()

    const cleared = ensureAnimationDocument(document).cels.filter((cel) => keys.includes(animationCelKey(cel.layerId, cel.frameId)))
    expect(cleared.every((cel) => cel.linkedCelId == null)).toBe(true)
    expect(cleared[1].surface?.pixels[3]).toBe(0)
    expect(cleared[2].surface?.pixels[3]).toBe(255)

    useWorkspace.getState().undo()
    const restored = ensureAnimationDocument(document).cels.filter((cel) => keys.includes(animationCelKey(cel.layerId, cel.frameId)))
    expect(restored[1].linkedCelId).toBe(sourceId)
    expect(restored[2].linkedCelId).toBe(sourceId)
    expect(restored[1].surface).toBe(restored[0].surface)
  })
})

describe('multi-layer adjustments', () => {
  it('undoes a later pixel operation before undoing the earlier adjustment', () => {
    const document = createDocument('ordered adjustment history', 2, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, { r: 20, g: 20, b: 20, a: 255 })
    writeLayerColor(document, layer, 1, { r: 40, g: 40, b: 40, a: 255 })
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 0, y: 0, width: 1, height: 1 })
    const baseline = useWorkspace.getState().captureActiveLayerAdjustmentSnapshot()!
    useWorkspace.getState().applyActiveLayerAdjustmentFromSnapshot({ kind: 'brightness-contrast', brightness: 40, contrast: 0 }, baseline)
    const adjusted = readLayerColor(document, layer, 0)

    const edit = beginPixelEdit(layer.id)
    recordPixel(document, layer, edit, 1, 0xff0000ff)
    useWorkspace.getState().commitPixelEdit(edit, 'later paint')
    expect(readLayerColor(document, layer, 1)).toEqual(red)

    useWorkspace.getState().undo()
    expect(readLayerColor(document, layer, 0)).toEqual(adjusted)
    expect(readLayerColor(document, layer, 1).r).toBe(40)
    useWorkspace.getState().undo()
    expect(readLayerColor(document, layer, 0).r).toBe(20)
  })

  it('undoes a committed adjustment in both the active layer and its animation cel', () => {
    const document = createDocument('animation adjustment undo', 1, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, red)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    writeLayerColor(document, layer, 0, blue)
    const timeline = ensureAnimationDocument(document)
    const activeFrameId = timeline.activeFrameId
    const baseline = useWorkspace.getState().captureActiveLayerAdjustmentSnapshot()!

    useWorkspace.getState().applyActiveLayerAdjustmentFromSnapshot({ kind: 'brightness-contrast', brightness: 40, contrast: 0 }, baseline)
    expect(readLayerColor(document, layer, 0).r).toBeGreaterThan(blue.r)
    useWorkspace.getState().undo()

    expect(readLayerColor(document, layer, 0)).toEqual(blue)
    expect(animationCelAt(timeline, layer.id, activeFrameId)!.surface!.pixels).toEqual(new Uint8ClampedArray([0, 80, 255, 255]))
  })

  it('adjusts every selected layer without a selection and undoes them together', () => {
    const document = createDocument('multi adjustment', 1, 1, 'rgba')
    const first = getActiveLayer(document)
    const second = createLayer('Second', 1, 1, 'rgba')
    writeLayerColor(document, first, 0, { r: 20, g: 20, b: 20, a: 255 })
    writeLayerColor(document, second, 0, { r: 40, g: 40, b: 40, a: 255 })
    document.layers.push(second)
    document.activeLayerId = second.id
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectLayer(first.id)
    useWorkspace.getState().selectLayer(second.id, true)

    useWorkspace.getState().applyActiveLayerAdjustment({ kind: 'brightness-contrast', brightness: 20, contrast: 0 })

    expect(readLayerColor(document, first, 0).r).toBeGreaterThan(20)
    expect(readLayerColor(document, second, 0).r).toBeGreaterThan(40)
    useWorkspace.getState().undo()
    expect(readLayerColor(document, first, 0).r).toBe(20)
    expect(readLayerColor(document, second, 0).r).toBe(40)
  })
})

describe('resize history', () => {
  it('keeps canvas resize guide previews outside document history', () => {
    const document = createDocument('resize preview history', 2, 2, 'rgba')
    useWorkspace.getState().addSession(document)
    const session = useWorkspace.getState().sessions[0]

    useWorkspace.getState().setCanvasResizePreview({ width: 4, height: 4, offsetX: 1, offsetY: 1 })
    useWorkspace.getState().setCanvasResizePreview({ width: 5, height: 4, offsetX: 2, offsetY: 1 })
    useWorkspace.getState().setCanvasResizePreview(null)

    expect(session.history.canUndo).toBe(false)
    expect(document.dirty).toBe(false)
  })

  it('undoes and redoes canvas and image size adjustments with their selection', async () => {
    const document = createDocument('resize history', 2, 2, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, red)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 0, y: 0, width: 1, height: 1, mask: new Uint8Array([1]) })

    await useWorkspace.getState().resizeActiveCanvas(3, 3, 'center')
    expect(document.width).toBe(3)
    expect(useWorkspace.getState().sessions[0].selection).toMatchObject({ x: 0, y: 0, width: 1, height: 1 })
    useWorkspace.getState().undo()
    expect(document.width).toBe(2)
    expect(useWorkspace.getState().sessions[0].selection).toMatchObject({ x: 0, y: 0, width: 1, height: 1 })
    useWorkspace.getState().redo()
    expect(document.width).toBe(3)

    await useWorkspace.getState().resizeActiveImage(4, 4, 'nearest')
    expect(document.width).toBe(4)
    useWorkspace.getState().undo()
    expect(document.width).toBe(3)
    useWorkspace.getState().redo()
    expect(document.width).toBe(4)
  })

  it('keeps every animation cel aligned through canvas resize undo and redo', async () => {
    const document = createDocument('animated canvas resize', 2, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, red)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    const [firstFrame, secondFrame] = ensureAnimationDocument(document).frames
    writeLayerColor(document, layer, 0, transparent)
    writeLayerColor(document, layer, 1, blue)
    useWorkspace.getState().setActiveAnimationFrame(firstFrame.id)

    await useWorkspace.getState().resizeActiveCanvas(4, 3, 'center')
    let timeline = ensureAnimationDocument(document)
    expect(animationCelAt(timeline, layer.id, firstFrame.id)!.surface).toMatchObject({ offsetX: 1, offsetY: 1 })
    expect(animationCelAt(timeline, layer.id, secondFrame.id)!.surface).toMatchObject({ offsetX: 1, offsetY: 1 })

    useWorkspace.getState().undo()
    timeline = ensureAnimationDocument(document)
    expect(document).toMatchObject({ width: 2, height: 1 })
    expect(animationCelAt(timeline, layer.id, firstFrame.id)!.surface).toMatchObject({ offsetX: 0, offsetY: 0 })
    expect(animationCelAt(timeline, layer.id, secondFrame.id)!.surface).toMatchObject({ offsetX: 0, offsetY: 0 })

    useWorkspace.getState().redo()
    timeline = ensureAnimationDocument(document)
    expect(document).toMatchObject({ width: 4, height: 3 })
    expect(animationCelAt(timeline, layer.id, firstFrame.id)!.surface).toMatchObject({ offsetX: 1, offsetY: 1 })
    expect(animationCelAt(timeline, layer.id, secondFrame.id)!.surface).toMatchObject({ offsetX: 1, offsetY: 1 })
  })
})

describe('layer merge history', () => {
  it('merges selected layers as one undoable structural operation', () => {
    const document = createDocument('merge history', 1, 1, 'rgba')
    const bottom = getActiveLayer(document)
    writeLayerColor(document, bottom, 0, blue)
    const top = createLayer('Top', 1, 1, 'rgba')
    writeLayerColor(document, top, 0, red)
    document.layers.push(top)
    document.activeLayerId = top.id
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectLayer(bottom.id)
    useWorkspace.getState().selectLayer(top.id, true)

    useWorkspace.getState().mergeSelectedLayers()
    expect(document.layers).toHaveLength(1)
    expect(useWorkspace.getState().sessions[0].selectedLayerIds).toEqual([document.layers[0].id])

    useWorkspace.getState().undo()
    expect(document.layers).toHaveLength(2)
    expect(document.layers.map((layer) => layer.id)).toEqual([bottom.id, top.id])
    expect(useWorkspace.getState().sessions[0].selectedLayerIds).toEqual([bottom.id, top.id])

    useWorkspace.getState().redo()
    expect(document.layers).toHaveLength(1)
  })

  it('does not dirty the document when a locked merge is rejected', () => {
    const document = createDocument('locked merge', 1, 1, 'rgba')
    const bottom = getActiveLayer(document)
    const top = createLayer('Top', 1, 1, 'rgba')
    top.locked = true
    document.layers.push(top)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectLayer(bottom.id)
    useWorkspace.getState().selectLayer(top.id, true)

    useWorkspace.getState().mergeSelectedLayers()

    expect(document.layers).toHaveLength(2)
    expect(document.dirty).toBe(false)
    expect(useWorkspace.getState().message).toContain('锁定')
  })

  it('merges selected layers with blend modes', () => {
    const document = createDocument('blend merge command', 1, 1, 'rgba')
    const bottom = getActiveLayer(document)
    writeLayerColor(document, bottom, 0, blue)
    const top = createLayer('Multiply', 1, 1, 'rgba')
    writeLayerColor(document, top, 0, red)
    top.blendMode = 'multiply'
    document.layers.push(top)
    document.activeLayerId = top.id
    const before = compositeDocument(document)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectLayer(bottom.id)
    useWorkspace.getState().selectLayer(top.id, true)

    useWorkspace.getState().mergeSelectedLayers()

    expect(document.layers).toHaveLength(1)
    expect(Array.from(compositeDocument(document))).toEqual(Array.from(before))
  })
})

describe('recovery cleanup', () => {
  it('waits for an in-flight autosave before deleting a discarded recovery and suppresses recreation', async () => {
    const deferred: { resolve?: () => void } = {}
    let writeCount = 0
    const writeRecovery = vi.fn(() => {
      writeCount += 1
      return writeCount === 1 ? new Promise<void>((resolve) => { deferred.resolve = resolve }) : Promise.resolve()
    })
    const deleteRecovery = vi.fn(async () => {})
    installApi({ writeRecovery, deleteRecovery })
    const document = createDocument('draft', 2, 2, 'rgba')
    document.dirty = true
    useWorkspace.getState().addSession(document)

    const autosave = useWorkspace.getState().autosaveDirty()
    await vi.waitFor(() => expect(writeRecovery).toHaveBeenCalledTimes(1))
    const discard = useWorkspace.getState().discardRecovery(document.id)
    expect(deleteRecovery).not.toHaveBeenCalled()
    deferred.resolve?.()
    await Promise.all([autosave, discard])

    expect(writeRecovery).toHaveBeenCalledTimes(1)
    expect(deleteRecovery).toHaveBeenCalledWith(document.id)
    await useWorkspace.getState().autosaveDirty()
    expect(writeRecovery).toHaveBeenCalledTimes(1)

    useWorkspace.getState().mutateActive(() => {})
    await useWorkspace.getState().autosaveDirty()
    expect(writeRecovery).toHaveBeenCalledTimes(2)
  })
})

describe('save concurrency', () => {
  it('shows progress for an ordinary save and closes it after success', async () => {
    vi.useFakeTimers()
    try {
      const write: { resolve?: () => void } = {}
      const writeBinaryAtomic = vi.fn(() => new Promise<void>((resolve) => { write.resolve = resolve }))
      installApi({ writeBinaryAtomic })
      const document = createDocument('ordinary save progress', 2, 2, 'rgba')
      document.filePath = 'D:/gallery/ordinary-save-progress.moonsprite'
      document.dirty = true
      useWorkspace.getState().addSession(document)

      const saving = useWorkspace.getState().saveActive()
      await vi.waitFor(() => expect(writeBinaryAtomic).toHaveBeenCalledTimes(1))
      expect(useWorkspace.getState().saveProgress).toMatchObject({ value: 72 })

      write.resolve?.()
      await expect(saving).resolves.toBe(true)
      expect(useWorkspace.getState().saveProgress).toMatchObject({ value: 100 })
      await vi.advanceTimersByTimeAsync(180)
      expect(useWorkspace.getState().saveProgress).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows Save As progress only after the native file dialog confirms a path', async () => {
    const dialog: { resolve?: (result: { canceled: boolean; filePath?: string }) => void } = {}
    const write: { resolve?: () => void } = {}
    const saveProject = vi.fn(() => new Promise<{ canceled: boolean; filePath?: string }>((resolve) => { dialog.resolve = resolve }))
    const writeBinaryAtomic = vi.fn(() => new Promise<void>((resolve) => { write.resolve = resolve }))
    installApi({ saveProject, writeBinaryAtomic })
    useWorkspace.getState().addSession(createDocument('save progress', 2, 2, 'rgba'))

    const saving = useWorkspace.getState().saveActive(true, { name: 'save progress', format: 'moonsprite', scalePercent: 100 })
    await vi.waitFor(() => expect(saveProject).toHaveBeenCalledTimes(1))
    expect(useWorkspace.getState().saveProgress).toBeNull()

    dialog.resolve?.({ canceled: false, filePath: 'D:/gallery/save-progress.moonsprite' })
    await vi.waitFor(() => expect(writeBinaryAtomic).toHaveBeenCalledTimes(1))
    expect(useWorkspace.getState().saveProgress).toMatchObject({ title: '正在另存为' })
    useWorkspace.getState().dismissSaveProgress()
    write.resolve?.()
    await expect(saving).resolves.toBe(true)
    expect(useWorkspace.getState().saveProgress).toBeNull()
  })

  it('shows export progress only after the native export dialog confirms a path', async () => {
    const dialog: { resolve?: (result: { canceled: boolean; filePath?: string }) => void } = {}
    const write: { resolve?: () => void } = {}
    const exportImage = vi.fn(() => new Promise<{ canceled: boolean; filePath?: string }>((resolve) => { dialog.resolve = resolve }))
    const writeBinaryAtomic = vi.fn(() => new Promise<void>((resolve) => { write.resolve = resolve }))
    installApi({ exportImage, writeBinaryAtomic })
    useWorkspace.getState().addSession(createDocument('export progress', 2, 2, 'rgba'))

    const exporting = useWorkspace.getState().exportActive({ name: 'export progress', format: 'png-rgba', scalePercent: 100 })
    await vi.waitFor(() => expect(exportImage).toHaveBeenCalledTimes(1))
    expect(useWorkspace.getState().saveProgress).toBeNull()

    dialog.resolve?.({ canceled: false, filePath: 'D:/gallery/export-progress.png' })
    await vi.waitFor(() => expect(writeBinaryAtomic).toHaveBeenCalledTimes(1))
    expect(useWorkspace.getState().saveProgress).toMatchObject({ title: '正在导出' })
    useWorkspace.getState().dismissSaveProgress()
    write.resolve?.()
    await expect(exporting).resolves.toBe(true)
    expect(useWorkspace.getState().saveProgress).toBeNull()
  })

  it('uses the preferred image format when saving an unsaved document', async () => {
    localStorage.setItem('moonsprite.preference.save-format', 'png')
    const saveProject = vi.fn(async () => ({ canceled: false, filePath: 'D:/gallery/preferred.png' }))
    const exportImage = vi.fn()
    const writeBinaryAtomic = vi.fn(async () => {})
    installApi({ saveProject, exportImage, writeBinaryAtomic })
    useWorkspace.getState().addSession(createDocument('preferred', 2, 2, 'rgba'))

    await expect(useWorkspace.getState().saveActive()).resolves.toBe(true)
    expect(saveProject).toHaveBeenCalledWith('preferred.png', 'png')
    expect(exportImage).not.toHaveBeenCalled()
    expect(writeBinaryAtomic).toHaveBeenCalledTimes(1)
  })

  it('uses custom save and export directories for new file dialogs', async () => {
    localStorage.setItem('moonsprite.preference.save-directory', 'D:\\MoonSprite\\gallery')
    localStorage.setItem('moonsprite.preference.export-directory', 'D:/MoonSprite/exports')
    const saveProject = vi.fn(async () => ({ canceled: false, filePath: 'D:/MoonSprite/gallery/custom.moonsprite' }))
    const exportImage = vi.fn(async () => ({ canceled: false, filePath: 'D:/MoonSprite/exports/custom.png' }))
    const writeBinaryAtomic = vi.fn(async () => {})
    installApi({ saveProject, exportImage, writeBinaryAtomic })
    useWorkspace.getState().addSession(createDocument('custom', 2, 2, 'rgba'))

    await expect(useWorkspace.getState().saveActive()).resolves.toBe(true)
    expect(saveProject).toHaveBeenCalledWith('D:\\MoonSprite\\gallery\\custom.moonsprite')
    await expect(useWorkspace.getState().exportActive({ name: 'custom', format: 'png-rgba', scalePercent: 100 })).resolves.toBe(true)
    expect(exportImage).toHaveBeenCalledWith('D:/MoonSprite/exports/custom.png', 'png')
  })

  it('lets the export dialog directory override the default export directory', async () => {
    localStorage.setItem('moonsprite.preference.export-directory', 'D:/MoonSprite/exports')
    const exportImage = vi.fn(async () => ({ canceled: false, filePath: 'E:/delivery/custom.png' }))
    const writeBinaryAtomic = vi.fn(async () => {})
    installApi({ exportImage, writeBinaryAtomic })
    useWorkspace.getState().addSession(createDocument('custom', 2, 2, 'rgba'))

    await expect(useWorkspace.getState().exportActive({ name: 'custom.png', format: 'png-rgba', scalePercent: 100, directory: 'E:/delivery' })).resolves.toBe(true)
    expect(exportImage).toHaveBeenCalledWith('E:/delivery/custom.png', 'png')
    expect(localStorage.getItem(RECENT_EXPORT_PATHS_STORAGE_KEY)).toContain('E:/delivery/custom.png')
  })

  it('uses Aseprite as the preferred save format without exposing it as image export', async () => {
    localStorage.setItem('moonsprite.preference.save-format', 'aseprite')
    const saveProject = vi.fn(async () => ({ canceled: false, filePath: 'D:/gallery/preferred.aseprite' }))
    const exportImage = vi.fn()
    const writeBinaryAtomic = vi.fn(async () => {})
    installApi({ saveProject, exportImage, writeBinaryAtomic })
    const document = createDocument('preferred', 2, 2, 'rgba')
    useWorkspace.getState().addSession(document)

    await expect(useWorkspace.getState().saveActive()).resolves.toBe(true)
    expect(saveProject).toHaveBeenCalledWith('preferred.aseprite', 'aseprite')
    expect(exportImage).not.toHaveBeenCalled()
    expect(writeBinaryAtomic).toHaveBeenCalledTimes(1)
    expect(document.filePath).toBe('D:/gallery/preferred.aseprite')
  })

  it('keeps the selected .ase extension in Save As', async () => {
    const saveProject = vi.fn(async () => ({ canceled: false, filePath: 'D:/gallery/copy.ase' }))
    const exportImage = vi.fn()
    const writeBinaryAtomic = vi.fn(async () => {})
    installApi({ saveProject, exportImage, writeBinaryAtomic })
    const document = createDocument('copy', 2, 2, 'rgba')
    useWorkspace.getState().addSession(document)

    await expect(useWorkspace.getState().saveActive(true, { name: 'copy', format: 'ase', scalePercent: 100 })).resolves.toBe(true)
    expect(saveProject).toHaveBeenCalledWith('copy.ase', 'ase')
    expect(exportImage).not.toHaveBeenCalled()
    expect(document.filePath).toBe('D:/gallery/copy.ase')
  })

  it('normalizes a mismatched native dialog extension to the selected Aseprite format', async () => {
    const saveProject = vi.fn(async () => ({ canceled: false, filePath: 'D:/gallery/copy.png' }))
    const exportImage = vi.fn()
    const writeBinaryAtomic = vi.fn(async () => {})
    installApi({ saveProject, exportImage, writeBinaryAtomic })
    const document = createDocument('copy', 2, 2, 'rgba')
    useWorkspace.getState().addSession(document)

    await expect(useWorkspace.getState().saveActive(true, { name: 'copy', format: 'ase', scalePercent: 100 })).resolves.toBe(true)
    expect(saveProject).toHaveBeenCalledWith('copy.ase', 'ase')
    expect(writeBinaryAtomic).toHaveBeenCalledWith('D:/gallery/copy.ase', expect.any(Uint8Array))
    expect(document.filePath).toBe('D:/gallery/copy.ase')
  })

  it('serializes repeated saves and writes the newest revision last', async () => {
    const writes: Array<{ data: Uint8Array; resolve: () => void }> = []
    const writeBinaryAtomic = vi.fn((_filePath: string, data: Uint8Array) => new Promise<void>((resolve) => {
      writes.push({ data, resolve })
    }))
    installApi({ writeBinaryAtomic })

    const document = createDocument('save latest', 2, 2, 'rgba')
    document.filePath = 'D:/gallery/save-latest.moonsprite'
    document.dirty = true
    useWorkspace.getState().addSession(document)

    const firstSave = useWorkspace.getState().saveActive()
    await vi.waitFor(() => expect(writeBinaryAtomic).toHaveBeenCalledTimes(1))
    useWorkspace.getState().mutateActive((session) => {
      writeLayerColor(session.document, getActiveLayer(session.document), 0, red)
    })
    const secondSave = useWorkspace.getState().saveActive()
    expect(writeBinaryAtomic).toHaveBeenCalledTimes(1)

    writes[0].resolve()
    await vi.waitFor(() => expect(writeBinaryAtomic).toHaveBeenCalledTimes(2))
    const oldest = decodeProject(writes[0].data)
    expect(readLayerColor(oldest, getActiveLayer(oldest), 0)).toEqual(transparent)
    const newest = decodeProject(writes[1].data)
    expect(readLayerColor(newest, getActiveLayer(newest), 0)).toEqual(red)
    writes[1].resolve()
    await expect(Promise.all([firstSave, secondSave])).resolves.toEqual([true, true])
    expect(document.dirty).toBe(false)
  })

  it('keeps newer edits dirty and preserves recovery data when an older save finishes', async () => {
    const deferred: { resolve?: () => void } = {}
    const writeBinaryAtomic = vi.fn(() => new Promise<void>((resolve) => { deferred.resolve = resolve }))
    const writeRecovery = vi.fn(async () => {})
    const deleteRecovery = vi.fn(async () => {})
    installApi({ writeBinaryAtomic, writeRecovery, deleteRecovery })

    const document = createDocument('save revision', 2, 2, 'rgba')
    document.filePath = 'D:/gallery/save-revision.moonsprite'
    document.dirty = true
    useWorkspace.getState().addSession(document)

    const saving = useWorkspace.getState().saveActive()
    await vi.waitFor(() => expect(writeBinaryAtomic).toHaveBeenCalledTimes(1))
    useWorkspace.getState().mutateActive((session) => {
      writeLayerColor(session.document, getActiveLayer(session.document), 0, blue)
    })
    deferred.resolve?.()

    await expect(saving).resolves.toBe(true)
    expect(document.dirty).toBe(true)
    expect(writeRecovery).toHaveBeenCalledTimes(1)
    expect(deleteRecovery).not.toHaveBeenCalled()
    expect(useWorkspace.getState().message).toBe('工程已写入磁盘，但保存期间产生的新修改仍未保存。')
  })

  it('does not write after the document is closed while Save As is open', async () => {
    const deferred: { resolve?: (result: { canceled: boolean; filePath?: string }) => void } = {}
    const saveProject = vi.fn(() => new Promise<{ canceled: boolean; filePath?: string }>((resolve) => { deferred.resolve = resolve }))
    const writeBinaryAtomic = vi.fn(async () => {})
    installApi({ saveProject, writeBinaryAtomic })

    const document = createDocument('close while saving', 2, 2, 'rgba')
    document.dirty = false
    useWorkspace.getState().addSession(document)

    const save = useWorkspace.getState().saveActive(true)
    await vi.waitFor(() => expect(saveProject).toHaveBeenCalledTimes(1))
    await useWorkspace.getState().closeDocument(document.id)
    deferred.resolve?.({ canceled: false, filePath: 'D:/gallery/closed.moonsprite' })

    await expect(save).resolves.toBe(false)
    expect(writeBinaryAtomic).not.toHaveBeenCalled()
    expect(useWorkspace.getState().sessions).toHaveLength(0)
  })

  it('updates only the document that started the save when the active document changes', async () => {
    const deferred: { resolve?: () => void } = {}
    const writeBinaryAtomic = vi.fn(() => new Promise<void>((resolve) => { deferred.resolve = resolve }))
    installApi({ writeBinaryAtomic })

    const first = createDocument('first', 2, 2, 'rgba')
    first.filePath = 'D:/gallery/first.moonsprite'
    first.dirty = true
    const second = createDocument('second', 2, 2, 'rgba')
    second.filePath = 'D:/gallery/second.moonsprite'
    second.dirty = true
    useWorkspace.getState().addSession(first)
    useWorkspace.getState().addSession(second)
    useWorkspace.getState().setActive(first.id)

    const save = useWorkspace.getState().saveActive()
    await vi.waitFor(() => expect(writeBinaryAtomic).toHaveBeenCalledTimes(1))
    useWorkspace.getState().setActive(second.id)
    deferred.resolve?.()

    await expect(save).resolves.toBe(true)
    expect(first.dirty).toBe(false)
    expect(second.dirty).toBe(true)
  })
})

describe('layer group clipboard ui state', () => {
  it('selects every pasted descendant and preserves collapsed groups through undo and redo', () => {
    const source = createDocument('collapsed source', 2, 2, 'rgba')
    const member = getActiveLayer(source)
    member.groupId = 'child'
    source.groups.push(
      { id: 'root', name: 'Root', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' },
      { id: 'child', name: 'Child', parentGroupId: 'root', visible: true, locked: false, opacity: 1, blendMode: 'normal' }
    )
    useWorkspace.getState().addSession(source)
    useWorkspace.getState().selectLayerRows([], ['root'])
    useWorkspace.getState().toggleGroupCollapsed('root')
    useWorkspace.getState().copySelectedLayersToClipboard()

    const target = createDocument('paste target', 2, 2, 'rgba')
    useWorkspace.getState().addSession(target)
    expect(useWorkspace.getState().pasteLayersFromClipboard()).toBe(true)

    let session = useWorkspace.getState().sessions.at(-1)!
    const pastedGroups = target.groups.filter((group) => group.id !== 'root' && group.id !== 'child')
    const pastedLayers = target.layers.filter((layer) => layer.id !== target.layers[0].id)
    expect(session.selectedGroupIds).toEqual(expect.arrayContaining(pastedGroups.map((group) => group.id)))
    expect(session.selectedLayerIds).toEqual(expect.arrayContaining(pastedLayers.map((layer) => layer.id)))
    const pastedRoot = pastedGroups.find((group) => group.parentGroupId === null)!
    expect(session.collapsedGroupIds).toContain(pastedRoot.id)

    useWorkspace.getState().undo()
    expect(useWorkspace.getState().sessions.at(-1)!.collapsedGroupIds).not.toContain(pastedRoot.id)
    useWorkspace.getState().redo()
    session = useWorkspace.getState().sessions.at(-1)!
    expect(session.collapsedGroupIds).toContain(pastedRoot.id)
    expect(session.selectedLayerIds).toEqual(expect.arrayContaining(pastedLayers.map((layer) => layer.id)))
  })

  it('selects every descendant created by duplicating a selected group', () => {
    const document = createDocument('duplicate descendants', 2, 2, 'rgba')
    const member = getActiveLayer(document)
    member.groupId = 'group'
    document.groups.push({ id: 'group', name: 'Group', parentGroupId: null, visible: true, locked: false, opacity: 1, blendMode: 'normal' })
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().selectLayerRows([], ['group'])

    useWorkspace.getState().duplicateSelectedLayerRows()

    const session = useWorkspace.getState().sessions[0]
    const copiedGroup = document.groups.find((group) => group.id !== 'group')!
    const copiedLayer = document.layers.find((layer) => layer.id !== member.id)!
    expect(session.selectedGroupIds).toContain(copiedGroup.id)
    expect(session.selectedLayerIds).toContain(copiedLayer.id)
  })
})
