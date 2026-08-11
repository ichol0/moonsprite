import { describe, expect, it } from 'vitest'
import { activateAnimationFrame, addBlankAnimationFrame, animationCelAt, animationCelContentSelection, animationCelHasContent, animationCelKey, animationCelOffsetsForKeys, connectAnimationCels, createAnimationCelLookup, createDefaultAnimationTimeline, deleteAnimationFrame, disconnectAnimationCels, duplicateAnimationFrame, ensureAnimationDocument, nextAnimationFrameId, normalizeAnimationTimeline, resizeAnimationCelsAt, setAnimationCelOffsets, setAnimationCelOffsetsForKeys, syncActiveAnimationFrame } from './animation'
import { animationMaskAt, compositeDocument, createDocument, createLayer, createLayerMask, ensureLayerCoversCanvas, getActiveLayer, resizeDocumentAt, writeLayerColor } from './document'
import { beginPixelEdit, commitPixelEdit, HistoryStack, recordPixel } from './history'

describe('animation timeline boundary', () => {
  it('creates the first layer cel together with a new document', () => {
    const document = createDocument('initial cel', 2, 2, 'rgba')
    const timeline = document.animation!
    const cel = timeline.cels.find((candidate) => candidate.layerId === document.activeLayerId && candidate.frameId === timeline.activeFrameId)

    expect(cel).toBeDefined()
    expect(cel?.surface?.pixels).toBe(getActiveLayer(document).pixels)
    expect(cel?.surface).toMatchObject({ width: 2, height: 2, offsetX: 0, offsetY: 0 })
  })

  it('distinguishes transparent cels from cels with visible pixels', () => {
    const document = createDocument('cel content', 2, 2, 'rgba')
    const timeline = ensureAnimationDocument(document)
    const cel = timeline.cels.find((candidate) => candidate.layerId === document.activeLayerId && candidate.frameId === timeline.activeFrameId)!
    expect(animationCelHasContent(cel)).toBe(false)
    cel.surface!.pixels[3] = 255
    expect(animationCelHasContent(cel)).toBe(true)
  })

  it('builds a tight canvas-clipped selection from visible cel pixels', () => {
    const document = createDocument('cel selection', 3, 2, 'rgba')
    const cel = animationCelAt(ensureAnimationDocument(document), document.activeLayerId, document.animation!.activeFrameId)!
    cel.surface = { format: 'rgba', width: 4, height: 2, offsetX: -1, offsetY: 0, pixels: new Uint8ClampedArray(4 * 2 * 4) }
    for (const index of [0, 1, 3, 6]) cel.surface.pixels[index * 4 + 3] = 255

    const selection = animationCelContentSelection(cel, document.palette, document.width, document.height)

    expect(selection).toMatchObject({ x: 0, y: 0, width: 3, height: 2 })
    expect(Array.from(selection?.mask ?? [])).toEqual([1, 0, 1, 0, 1, 0])
  })

  it('does not connect a selection when every selected cel is empty', () => {
    const document = createDocument('empty cels', 1, 1, 'rgba')
    const firstFrame = ensureAnimationDocument(document).activeFrameId
    const secondFrame = addBlankAnimationFrame(document)
    const timeline = ensureAnimationDocument(document)
    const first = animationCelAt(timeline, document.activeLayerId, firstFrame)!
    const second = animationCelAt(timeline, document.activeLayerId, secondFrame)!

    expect(connectAnimationCels(document, [first.id, second.id])).toBe(false)
    expect(first.linkedCelId).toBeUndefined()
    expect(second.linkedCelId).toBeUndefined()
  })

  it('keeps cel opacity independent per frame when activating frames', () => {
    const document = createDocument('cel opacity', 1, 1, 'rgba')
    const first = ensureAnimationDocument(document)
    const firstCel = first.cels.find((cel) => cel.frameId === first.activeFrameId && cel.layerId === document.activeLayerId)!
    firstCel.opacity = 0.25
    document.layers[0].opacity = 0.25
    const secondId = addBlankAnimationFrame(document)
    const secondCel = ensureAnimationDocument(document).cels.find((cel) => cel.frameId === secondId && cel.layerId === document.activeLayerId)!
    secondCel.opacity = 0.8
    document.layers[0].opacity = 0.8
    activateAnimationFrame(document, 'frame-1')
    expect(document.layers[0].opacity).toBeCloseTo(0.25)
    activateAnimationFrame(document, secondId)
    expect(document.layers[0].opacity).toBeCloseTo(0.8)
  })
  it('creates a one-frame timeline for new or legacy projects', () => {
    expect(createDefaultAnimationTimeline()).toEqual({ frames: [{ id: 'frame-1', duration: 100 }], cels: [], groupMasks: [], activeFrameId: 'frame-1', loop: true })
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

  it('creates an independent cel for every layer and frame', () => {
    const document = createDocument('animation', 2, 2, 'rgba')
    getActiveLayer(document).pixels[3] = 255
    ensureAnimationDocument(document)
    const secondFrame = addBlankAnimationFrame(document)
    expect(getActiveLayer(document).pixels[3]).toBe(0)
    ensureLayerCoversCanvas(document, getActiveLayer(document))
    getActiveLayer(document).pixels[7] = 255
    syncActiveAnimationFrame(document)
    expect(activateAnimationFrame(document, 'frame-1')).toBe(true)
    expect(getActiveLayer(document).pixels[3]).toBe(255)
    expect(getActiveLayer(document).pixels[7]).toBe(0)
    expect(activateAnimationFrame(document, secondFrame)).toBe(true)
    expect(getActiveLayer(document).pixels[3]).toBe(0)
    expect(getActiveLayer(document).pixels[7]).toBe(255)
  })

  it('fills a large layer and frame grid without duplicate cel slots or ids', () => {
    const document = createDocument('animation grid', 1, 1, 'rgba')
    for (let index = 1; index < 40; index += 1) document.layers.push(createLayer(`Layer ${index}`, 1, 1, 'rgba'))
    document.animation = {
      frames: Array.from({ length: 60 }, (_, index) => ({ id: `frame-${index + 1}`, duration: 100 })),
      cels: [],
      activeFrameId: 'frame-1',
      loop: true
    }

    const timeline = ensureAnimationDocument(document)
    expect(timeline.cels).toHaveLength(40 * 60)
    expect(new Set(timeline.cels.map((cel) => cel.id)).size).toBe(timeline.cels.length)
    expect(new Set(timeline.cels.map((cel) => `${cel.layerId}:${cel.frameId}`)).size).toBe(timeline.cels.length)
    const lookup = createAnimationCelLookup(timeline)
    for (const layer of document.layers) for (const frame of timeline.frames) {
      const cel = lookup.at(layer.id, frame.id)
      expect(cel).not.toBeNull()
      expect(lookup.resolve(cel)).toBe(cel)
    }
  })

  it('duplicates pixels without linking the copied frame', () => {
    const document = createDocument('animation', 2, 2, 'rgba')
    getActiveLayer(document).pixels[3] = 255
    const duplicateId = duplicateAnimationFrame(document)
    getActiveLayer(document).pixels[3] = 10
    syncActiveAnimationFrame(document)
    activateAnimationFrame(document, 'frame-1')
    expect(getActiveLayer(document).pixels[3]).toBe(255)
    activateAnimationFrame(document, duplicateId)
    expect(getActiveLayer(document).pixels[3]).toBe(10)
  })

  it('links selected cels per layer and shares the foremost non-empty surface', () => {
    const document = createDocument('linked cels', 2, 1, 'rgba')
    const layer = getActiveLayer(document)
    const firstFrame = ensureAnimationDocument(document).activeFrameId
    const secondFrame = addBlankAnimationFrame(document)
    const thirdFrame = addBlankAnimationFrame(document)
    const timeline = ensureAnimationDocument(document)
    const first = animationCelAt(timeline, layer.id, firstFrame)!
    const second = animationCelAt(timeline, layer.id, secondFrame)!
    const third = animationCelAt(timeline, layer.id, thirdFrame)!
    first.surface!.pixels[3] = 255

    expect(connectAnimationCels(document, [third.id, second.id, first.id])).toBe(true)
    expect(second.linkedCelId).toBe(first.id)
    expect(third.linkedCelId).toBe(first.id)
    expect(second.surface).toBe(first.surface)
    expect(third.surface).toBe(first.surface)

    activateAnimationFrame(document, thirdFrame)
    getActiveLayer(document).pixels[0] = 73
    syncActiveAnimationFrame(document)
    activateAnimationFrame(document, firstFrame)
    expect(getActiveLayer(document).pixels[0]).toBe(73)
  })

  it('links the source layer mask with linked cels and restores an independent mask on disconnect', () => {
    const document = createDocument('linked cel masks', 2, 1, 'rgba')
    const layer = getActiveLayer(document)
    const firstFrame = ensureAnimationDocument(document).activeFrameId
    const secondFrame = addBlankAnimationFrame(document)
    const timeline = ensureAnimationDocument(document)
    const first = animationCelAt(timeline, layer.id, firstFrame)!
    const second = animationCelAt(timeline, layer.id, secondFrame)!
    first.surface!.pixels[3] = 255
    first.mask = createLayerMask(first.id, 2, 1)
    first.mask.pixels.set([64, 64, 64, 255])

    expect(connectAnimationCels(document, [first.id, second.id])).toBe(true)
    expect(second.mask).toMatchObject({ linkedMaskId: first.mask.id, ownerId: second.id })
    expect(animationMaskAt(timeline, layer.id, secondFrame)).toBe(first.mask)
    activateAnimationFrame(document, secondFrame)
    expect(compositeDocument(document)[3]).toBe(64)

    expect(disconnectAnimationCels(document, [second.id])).toBe(true)
    expect(second.mask).toBeDefined()
    expect(second.mask).not.toBe(first.mask)
    expect(second.mask?.pixels[0]).toBe(64)
    second.mask!.pixels[0] = 192
    expect(first.mask.pixels[0]).toBe(64)
  })

  it('disconnects selected linked cels into independent surfaces', () => {
    const document = createDocument('disconnect linked cels', 1, 1, 'rgba')
    const layer = getActiveLayer(document)
    const firstFrame = ensureAnimationDocument(document).activeFrameId
    const secondFrame = addBlankAnimationFrame(document)
    const timeline = ensureAnimationDocument(document)
    const first = animationCelAt(timeline, layer.id, firstFrame)!
    const second = animationCelAt(timeline, layer.id, secondFrame)!
    first.surface!.pixels.set([20, 40, 60, 255])
    connectAnimationCels(document, [first.id, second.id])

    expect(disconnectAnimationCels(document, [second.id])).toBe(true)
    expect(second.linkedCelId).toBeNull()
    expect(second.surface).not.toBe(first.surface)
    second.surface!.pixels[0] = 200
    expect(first.surface!.pixels[0]).toBe(20)
  })

  it('disconnects the complete link group when its source cel is selected', () => {
    const document = createDocument('disconnect source cel', 1, 1, 'rgba')
    getActiveLayer(document).pixels[3] = 255
    duplicateAnimationFrame(document)
    duplicateAnimationFrame(document)
    const timeline = ensureAnimationDocument(document)
    const cels = timeline.frames.map((frame) => animationCelAt(timeline, document.activeLayerId, frame.id)!)
    expect(connectAnimationCels(document, cels.map((cel) => cel.id))).toBe(true)

    expect(disconnectAnimationCels(document, [cels[0].id])).toBe(true)
    expect(cels.every((cel) => !cel.linkedCelId)).toBe(true)
    expect(new Set(cels.map((cel) => cel.surface)).size).toBe(cels.length)
  })

  it('keeps at least one frame and advances according to loop mode', () => {
    const document = createDocument('animation', 1, 1, 'rgba')
    const second = addBlankAnimationFrame(document)
    const timeline = ensureAnimationDocument(document)
    expect(nextAnimationFrameId(timeline, second)).toBe('frame-1')
    timeline.loop = false
    expect(nextAnimationFrameId(timeline, second)).toBe(second)
    expect(deleteAnimationFrame(document, second)).toBe(true)
    expect(deleteAnimationFrame(document, 'frame-1')).toBe(false)
    expect(timeline.frames).toHaveLength(1)
  })

  it('undoes a pixel edit in its original frame after switching frames', () => {
    const document = createDocument('animation', 1, 1, 'rgba')
    ensureAnimationDocument(document)
    const edit = beginPixelEdit(document.activeLayerId)
    recordPixel(document, getActiveLayer(document), edit, 0, 0xff)
    const history = new HistoryStack()
    history.push(commitPixelEdit(document, edit, 'draw')!)
    const second = addBlankAnimationFrame(document)
    expect(ensureAnimationDocument(document).activeFrameId).toBe(second)
    history.undo()
    expect(getActiveLayer(document).pixels[0]).toBe(0)
    activateAnimationFrame(document, 'frame-1')
    expect(getActiveLayer(document).pixels[0]).toBe(0)
  })

  it('updates cel offsets in the operation frame without moving the active frame', () => {
    const document = createDocument('frame-scoped offsets', 2, 2, 'rgba')
    const firstFrame = ensureAnimationDocument(document).activeFrameId
    const secondFrame = addBlankAnimationFrame(document)
    const layerId = document.activeLayerId

    getActiveLayer(document).offsetX = 7
    getActiveLayer(document).offsetY = 9
    syncActiveAnimationFrame(document)
    setAnimationCelOffsets(document, firstFrame, { [layerId]: { x: 3, y: 4 } })

    expect(ensureAnimationDocument(document).activeFrameId).toBe(secondFrame)
    expect(getActiveLayer(document)).toMatchObject({ offsetX: 7, offsetY: 9 })
    activateAnimationFrame(document, firstFrame)
    expect(getActiveLayer(document)).toMatchObject({ offsetX: 3, offsetY: 4 })
  })

  it('moves selected cel surfaces across different layers and frames as one offset set', () => {
    const document = createDocument('multi cel offsets', 2, 2, 'rgba')
    const firstLayer = getActiveLayer(document)
    const secondLayer = createLayer('Second', 2, 2, 'rgba')
    document.layers.push(secondLayer)
    const timeline = ensureAnimationDocument(document)
    const firstFrame = timeline.activeFrameId
    const secondFrame = addBlankAnimationFrame(document)
    const keys = [animationCelKey(firstLayer.id, firstFrame), animationCelKey(secondLayer.id, secondFrame)]
    const before = animationCelOffsetsForKeys(document, keys)

    setAnimationCelOffsetsForKeys(document, Object.fromEntries(keys.map((key) => [key, { x: before[key].x + 5, y: before[key].y - 3 }])))

    expect(animationCelAt(timeline, firstLayer.id, firstFrame)?.surface).toMatchObject({ offsetX: 5, offsetY: -3 })
    expect(animationCelAt(timeline, secondLayer.id, secondFrame)?.surface).toMatchObject({ offsetX: 5, offsetY: -3 })
    expect(animationCelAt(timeline, secondLayer.id, firstFrame)?.surface).toMatchObject({ offsetX: 0, offsetY: 0 })
    expect(animationCelAt(timeline, firstLayer.id, secondFrame)?.surface).toMatchObject({ offsetX: 0, offsetY: 0 })
  })

  it('moves every animation cel with the canvas without changing its world position', () => {
    const document = createDocument('resize animation cels', 4, 3, 'rgba')
    const firstFrame = document.animation!.activeFrameId
    writeLayerColor(document, getActiveLayer(document), 0, { r: 255, g: 0, b: 0, a: 255 })
    syncActiveAnimationFrame(document)
    const secondFrame = addBlankAnimationFrame(document)
    const activeLayer = getActiveLayer(document)
    ensureLayerCoversCanvas(document, activeLayer)
    writeLayerColor(document, activeLayer, 1, { r: 0, g: 0, b: 255, a: 255 })
    syncActiveAnimationFrame(document)
    activateAnimationFrame(document, firstFrame)
    const firstCel = animationCelAt(ensureAnimationDocument(document), document.activeLayerId, firstFrame)!
    const secondCel = animationCelAt(ensureAnimationDocument(document), document.activeLayerId, secondFrame)!
    expect(firstCel.surface?.offsetX).toBe(0)
    expect(secondCel.surface?.offsetX).toBe(0)

    const resized = resizeDocumentAt(document, 7, 6, 2, 3)
    resizeAnimationCelsAt(document, resized.offsetX, resized.offsetY)

    const resizedFirstCel = animationCelAt(ensureAnimationDocument(document), document.activeLayerId, firstFrame)!
    const resizedSecondCel = animationCelAt(ensureAnimationDocument(document), document.activeLayerId, secondFrame)!
    expect(resizedFirstCel.surface).toMatchObject({ offsetX: 2, offsetY: 3 })
    expect(resizedSecondCel.surface).toMatchObject({ offsetX: 2, offsetY: 3 })
    expect(getActiveLayer(document)).toMatchObject({ offsetX: 2, offsetY: 3 })
    expect(resizedFirstCel.surface?.pixels[3]).toBe(255)
    expect(resizedSecondCel.surface?.pixels[3]).toBe(0)
    expect(resizedSecondCel.surface?.pixels[7]).toBe(255)
  })
})
