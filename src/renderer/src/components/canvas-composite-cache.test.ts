import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { compositeRegion, createDocument, createLayer, createLayerMask, createSparseLayer, DocumentCompositeCache, readLayerColor, writeLayerColor } from '@/core/document'
import { applySelectionTransform, applySelectionTranslationCommit, brushStrokeInvalidationRects, captureSelectionTransform, paintBrush } from '@/core/tools'
import { beginPixelEdit, revertPixelEdit } from '@/core/history'
import { addBlankAnimationFrame, ensureAnimationDocument } from '@/core/animation'
import { CanvasCompositeCache, shouldCacheFullCompositeSurface } from './canvas-composite-cache'
import { canPrepareInitialDocumentComposite, registerInitialDocumentComposite, registerPendingInitialDocumentComposite } from '@/core/initial-document-composite'
import { createDefaultLayerStyles } from '@/core/layer-styles'

class MockOffscreenCanvas {
  static instances: MockOffscreenCanvas[] = []
  readonly context = {
    putImageData: vi.fn(),
    drawImage: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low'
  }
  constructor(public width: number, public height: number) { MockOffscreenCanvas.instances.push(this) }
  getContext() { return this.context }
}

class MockImageData {
  constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
}

describe('CanvasCompositeCache', () => {
  beforeEach(() => {
    MockOffscreenCanvas.instances = []
    vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas)
    vi.stubGlobal('ImageData', MockImageData)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the exact composite prepared during document decode for the first surface', () => {
    const document = createDocument('initial composite', 2, 1, 'rgba')
    const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255])
    registerInitialDocumentComposite(document, pixels)
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
    }

    new CanvasCompositeCache().draw({
      context: context as never,
      document,
      view: { zoom: 1, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      originX: 0,
      originY: 0,
      canvasWidth: 2,
      canvasHeight: 1,
      fromX: 0,
      fromY: 0,
      toX: 2,
      toY: 1,
      revision: 0,
      contentRevision: 0
    })

    expect(MockOffscreenCanvas.instances).toHaveLength(1)
    expect(MockOffscreenCanvas.instances[0].context.putImageData).toHaveBeenCalledWith(expect.objectContaining({ data: pixels }), 0, 0)
    expect(context.drawImage).toHaveBeenCalled()

    const secondContext = { ...context, drawImage: vi.fn() }
    new CanvasCompositeCache().draw({
      context: secondContext as never,
      document,
      view: { zoom: 1, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      originX: 0, originY: 0, canvasWidth: 2, canvasHeight: 1,
      fromX: 0, fromY: 0, toX: 2, toY: 1, revision: 0, contentRevision: 0
    })
    expect(MockOffscreenCanvas.instances).toHaveLength(1)
    expect(secondContext.drawImage.mock.calls[0][0]).toBe(MockOffscreenCanvas.instances[0])
  })

  it('shares the first exact surface between independent canvas caches', () => {
    const document = createDocument('shared initial surface', 2, 1, 'rgba')
    const draw = (cache: CanvasCompositeCache) => {
      const context = {
        save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
        translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
      }
      cache.draw({
        context: context as never,
        document,
        view: { zoom: 1, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
        originX: 0, originY: 0, canvasWidth: 2, canvasHeight: 1,
        fromX: 0, fromY: 0, toX: 2, toY: 1, revision: 0, contentRevision: 0
      })
      return context
    }

    const firstContext = draw(new CanvasCompositeCache())
    const firstSurface = firstContext.drawImage.mock.calls[0][0]
    const secondContext = draw(new CanvasCompositeCache())

    expect(MockOffscreenCanvas.instances).toHaveLength(1)
    expect(secondContext.drawImage.mock.calls[0][0]).toBe(firstSurface)
  })

  it('does not reuse the initial composite after animation playback switches frames', () => {
    const document = createDocument('animated initial composite', 1, 1, 'rgba')
    const layer = document.layers[0]
    writeLayerColor(document, layer, 0, { r: 255, g: 0, b: 0, a: 255 })
    const firstFrameId = ensureAnimationDocument(document).activeFrameId
    registerInitialDocumentComposite(document, new Uint8ClampedArray([255, 0, 0, 255]), firstFrameId)
    const secondFrameId = addBlankAnimationFrame(document)
    writeLayerColor(document, layer, 0, { r: 0, g: 0, b: 255, a: 255 })
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
    }

    new CanvasCompositeCache().draw({
      context: context as never,
      document,
      view: { zoom: 1, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      originX: 0, originY: 0, canvasWidth: 1, canvasHeight: 1,
      fromX: 0, fromY: 0, toX: 1, toY: 1,
      revision: 0,
      contentRevision: 0,
      frameId: secondFrameId
    })

    const rendered = MockOffscreenCanvas.instances[0].context.putImageData.mock.calls[0][0] as MockImageData
    expect(Array.from(rendered.data)).toEqual([0, 0, 255, 255])
  })

  it('prepares initial composites only within the exact surface budget', () => {
    expect(canPrepareInitialDocumentComposite(4596, 1767)).toBe(true)
    expect(canPrepareInitialDocumentComposite(9000, 1767)).toBe(false)
    expect(canPrepareInitialDocumentComposite(8192, 8192)).toBe(false)
  })

  it('keeps a 4200 by 1800 document in the reusable full-surface cache', () => {
    expect(shouldCacheFullCompositeSurface(4200, 1800)).toBe(true)
    expect(shouldCacheFullCompositeSurface(9000, 1800)).toBe(false)
    expect(shouldCacheFullCompositeSurface(4200, 1800, 16 * 1024 * 1024)).toBe(false)
  })

  it('draws only the exact visible region while a large initial surface is still pending', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
    }
    const document = createDocument('pending initial composite', 1536, 512, 'rgba')
    registerPendingInitialDocumentComposite(document, new Promise<void>(() => undefined))

    new CanvasCompositeCache(16 * 1024 * 1024).draw({
      context: context as never,
      document,
      view: { zoom: 1, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      originX: 0,
      originY: 0,
      canvasWidth: 1536,
      canvasHeight: 512,
      fromX: 512,
      fromY: 0,
      toX: 768,
      toY: 512,
      revision: 0,
      contentRevision: 0
    })

    expect(MockOffscreenCanvas.instances.at(-1)).toMatchObject({ width: 256, height: 512 })
  })

  it('reuses one exact full-resolution surface while a large-canvas viewport pans', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
    }
    const document = createDocument('tiled viewport', 1536, 512, 'rgba')
    const cache = new CanvasCompositeCache(16 * 1024 * 1024)
    const draw = (fromX: number, toX: number) => cache.draw({
      context: context as never,
      document,
      view: { zoom: 1, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      originX: -fromX,
      originY: 0,
      canvasWidth: 512,
      canvasHeight: 512,
      fromX,
      fromY: 0,
      toX,
      toY: 512,
      revision: 1,
      contentRevision: 1
    })

    draw(0, 512)
    const surface = context.drawImage.mock.calls.at(-1)?.[0]
    draw(256, 768)
    expect(context.drawImage.mock.calls.at(-1)?.[0]).toBe(surface)
  })

  it('patches only the dirty region of a large exact surface', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
    }
    const document = createDocument('tiled dirty region', 1536, 512, 'rgba')
    const cache = new CanvasCompositeCache(16 * 1024 * 1024)
    const draw = (contentRevision: number, contentInvalidation: Parameters<CanvasCompositeCache['draw']>[0]['contentInvalidation']) => cache.draw({
      context: context as never,
      document,
      view: { zoom: 1, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      originX: 0,
      originY: 0,
      canvasWidth: 1024,
      canvasHeight: 512,
      fromX: 0,
      fromY: 0,
      toX: 1024,
      toY: 512,
      revision: contentRevision,
      contentRevision,
      contentInvalidation
    })

    draw(1, null)
    const surface = context.drawImage.mock.calls.at(-1)?.[0] as MockOffscreenCanvas
    draw(2, { kind: 'region', fromRevision: 1, revision: 2, rect: { x: 700, y: 20, width: 4, height: 4 } })
    expect(context.drawImage.mock.calls.at(-1)?.[0]).toBe(surface)
    expect(surface.context.putImageData).toHaveBeenLastCalledWith(expect.objectContaining({ width: 4, height: 4 }), 700, 20)
  })

  it('clips a full-layer move patch to the zoomed viewport and defers offscreen pixels', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
    }
    const document = createDocument('zoomed moved layer', 1024, 1024, 'rgba')
    const cache = new CanvasCompositeCache()
    const draw = (fromX: number, fromY: number) => cache.draw({
      context: context as never,
      document,
      view: { zoom: 32, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      originX: -fromX * 32,
      originY: -fromY * 32,
      canvasWidth: document.width * 32,
      canvasHeight: document.height * 32,
      fromX,
      fromY,
      toX: fromX + 16,
      toY: fromY + 12,
      revision: 1,
      contentRevision: 1
    })

    draw(400, 500)
    const surface = context.drawImage.mock.calls.at(-1)?.[0] as MockOffscreenCanvas
    surface.context.putImageData.mockClear()

    cache.invalidateRect({ x: 0, y: 0, width: 1023, height: 1024 }, document.width, document.height)
    cache.invalidateRect({ x: 1, y: 0, width: 1023, height: 1024 }, document.width, document.height)
    draw(400, 500)

    expect(surface.context.putImageData).toHaveBeenCalledTimes(1)
    expect(surface.context.putImageData).toHaveBeenLastCalledWith(expect.objectContaining({ width: 16, height: 12 }), 400, 500)

    draw(700, 800)
    expect(surface.context.putImageData).toHaveBeenLastCalledWith(expect.objectContaining({ width: 16, height: 12 }), 700, 800)
  })

  it('reuses the exact static backdrop while recompositing top moved layers', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
    }
    const document = createDocument('moving preview segments', 64, 64, 'rgba')
    const bottom = document.layers[0]
    const moving = createDocument('moving', 64, 64, 'rgba').layers[0]
    moving.id = 'moving'
    document.layers.push(moving)
    writeLayerColor(document, bottom, 1 + bottom.width, { r: 0, g: 255, b: 0, a: 255 })
    writeLayerColor(document, moving, 2 + 2 * moving.width, { r: 255, g: 0, b: 0, a: 128 })
    const cache = new CanvasCompositeCache()
    const draw = () => cache.draw({
      context: context as never,
      document,
      view: { zoom: 4, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      originX: 0, originY: 0, canvasWidth: 256, canvasHeight: 256,
      fromX: 0, fromY: 0, toX: 16, toY: 16,
      revision: 1, contentRevision: 1, movingLayerIds: [moving.id]
    })

    draw()
    const previewCanvas = context.drawImage.mock.calls.at(-1)?.[0] as MockOffscreenCanvas
    const initialCanvasCount = MockOffscreenCanvas.instances.length
    moving.offsetX = 1
    cache.invalidateRect({ x: 0, y: 0, width: 64, height: 64 }, document.width, document.height)
    draw()

    expect(context.drawImage.mock.calls.at(-1)?.[0]).toBe(previewCanvas)
    expect(MockOffscreenCanvas.instances).toHaveLength(initialCanvasCount)
    const rendered = previewCanvas.context.putImageData.mock.calls.at(-1)?.[0] as MockImageData
    expect(Array.from(rendered.data)).toEqual(Array.from(compositeRegion(document, 0, 0, 16, 16)))
  })

  it('keeps move preview enabled when a visible opacity group is empty', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
    }
    const document = createDocument('moving beside empty opacity group', 64, 64, 'rgba')
    const moving = createLayer('moving', 64, 64, 'rgba')
    document.layers.push(moving)
    document.groups.push({ id: 'empty-group', name: 'Empty', parentGroupId: null, visible: true, locked: false, opacity: 0.3, blendMode: 'normal' })
    const timeline = ensureAnimationDocument(document)
    const mask = createLayerMask('empty-group', document.width, document.height, 'group')
    writeLayerColor(document, mask, 0, { r: 0, g: 0, b: 0, a: 255 })
    timeline.groupMasks = [{ groupId: 'empty-group', frameId: timeline.activeFrameId, mask }]
    writeLayerColor(document, moving, 2 + 2 * moving.width, { r: 255, g: 0, b: 0, a: 255 })
    const cache = new CanvasCompositeCache()
    const draw = () => cache.draw({
      context: context as never,
      document,
      view: { zoom: 4, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      originX: 0, originY: 0, canvasWidth: 256, canvasHeight: 256,
      fromX: 0, fromY: 0, toX: 16, toY: 16,
      revision: 1, contentRevision: 1, movingLayerIds: [moving.id]
    })

    draw()
    const previewCanvas = context.drawImage.mock.calls.at(-1)?.[0] as MockOffscreenCanvas
    expect(previewCanvas.width).toBe(16)
    moving.offsetX = 1
    draw()
    expect(context.drawImage.mock.calls.at(-1)?.[0]).toBe(previewCanvas)
  })

  it('shows moved layer pixels across enabled tile-repeat boundaries', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
    }
    const document = createDocument('repeated moved layer', 4, 1, 'rgba')
    const moving = createLayer('moving', 4, 1, 'rgba')
    document.layers.push(moving)
    writeLayerColor(document, moving, 3, { r: 255, g: 0, b: 0, a: 255 })
    moving.offsetX = 1
    const cache = new CanvasCompositeCache()
    const draw = (tileRepeatMode: 'off' | 'x') => cache.draw({
      context: context as never,
      document,
      view: { zoom: 8, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false, tileRepeatMode },
      originX: 0, originY: 0, canvasWidth: 32, canvasHeight: 8,
      fromX: 0, fromY: 0, toX: 4, toY: 1,
      revision: 1, contentRevision: 1, movingLayerIds: [moving.id]
    })

    draw('off')
    const clippedCanvas = context.drawImage.mock.calls.at(-1)?.[0] as MockOffscreenCanvas
    const clipped = clippedCanvas.context.putImageData.mock.calls.at(-1)?.[0] as MockImageData
    expect(Array.from(clipped.data)).toEqual(new Array(16).fill(0))

    draw('x')
    const repeatedCanvas = context.drawImage.mock.calls.at(-1)?.[0] as MockOffscreenCanvas
    const repeated = repeatedCanvas.context.putImageData.mock.calls.at(-1)?.[0] as MockImageData
    expect(Array.from(repeated.data.slice(0, 4))).toEqual([255, 0, 0, 255])
  })

  it('reuses the exact static backdrop while moving a supported styled top layer', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
    }
    const document = createDocument('styled moving preview', 12, 10, 'rgba')
    const moving = createLayer('styled moving', 6, 5, 'rgba')
    document.layers.push(moving)
    writeLayerColor(document, document.layers[0], 4 * 12 + 5, { r: 20, g: 40, b: 60, a: 255 })
    writeLayerColor(document, moving, 2 * moving.width + 2, { r: 255, g: 0, b: 0, a: 255 })
    const styles = createDefaultLayerStyles()
    styles.shadow = { ...styles.shadow, enabled: true, blur: 3 }
    styles.innerGlow = { ...styles.innerGlow, enabled: true, size: 2 }
    moving.layerStyles = styles
    const cache = new CanvasCompositeCache()
    const draw = () => cache.draw({
      context: context as never,
      document,
      view: { zoom: 4, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      originX: 0, originY: 0, canvasWidth: 48, canvasHeight: 40,
      fromX: 0, fromY: 0, toX: 12, toY: 10,
      revision: 1, contentRevision: 1, movingLayerIds: [moving.id]
    })

    draw()
    const previewCanvas = context.drawImage.mock.calls.at(-1)?.[0] as MockOffscreenCanvas
    moving.offsetX = 2
    moving.offsetY = 1
    draw()

    const rendered = previewCanvas.context.putImageData.mock.calls.at(-1)?.[0] as MockImageData
    expect(Array.from(rendered.data)).toEqual(Array.from(compositeRegion(document, 0, 0, 12, 10)))
  })

  it('renders a moved selection patch without mutating document pixels', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
    }
    const document = createDocument('selection patch', 6, 2, 'rgba')
    const bottom = document.layers[0]
    const active = createLayer('active', 6, 2, 'rgba')
    const top = createLayer('top', 6, 2, 'rgba')
    document.layers.push(active, top)
    document.activeLayerId = active.id
    writeLayerColor(document, bottom, 4, { r: 0, g: 255, b: 0, a: 255 })
    writeLayerColor(document, active, 1, { r: 255, g: 0, b: 0, a: 128 })
    writeLayerColor(document, top, 4, { r: 0, g: 0, b: 255, a: 128 })
    const source = captureSelectionTransform(document, { x: 1, y: 0, width: 1, height: 1 }, active)!
    const before = readLayerColor(document, active, 1)

    new CanvasCompositeCache().draw({
      context: context as never,
      document,
      view: { zoom: 16, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      originX: 0, originY: 0, canvasWidth: 96, canvasHeight: 32,
      fromX: 0, fromY: 0, toX: 6, toY: 2,
      revision: 1, contentRevision: 1,
      selectionPreview: { layerId: active.id, source, target: { x: 4, y: 0, width: 1, height: 1 }, angle: 0, copy: false }
    })

    expect(readLayerColor(document, active, 1)).toEqual(before)
    const previewCanvas = context.drawImage.mock.calls.at(-1)?.[0] as MockOffscreenCanvas
    const patches = previewCanvas.context.putImageData.mock.calls.map(([patch, patchX, patchY]) => ({
      patch: patch as MockImageData,
      patchX,
      patchY
    }))
    applySelectionTransform(document, source, { x: 4, y: 0, width: 1, height: 1 }, 0, false, undefined, undefined, undefined, active)
    const expected = compositeRegion(document, 0, 0, 6, 2)
    expect(patches).toHaveLength(2)
    expect(patches.map(({ patch, patchX, patchY }) => ({ width: patch.width, height: patch.height, patchX, patchY }))).toEqual([
      { width: 1, height: 1, patchX: 1, patchY: 0 },
      { width: 1, height: 1, patchX: 4, patchY: 0 }
    ])
    expect(Array.from(patches[0].patch.data)).toEqual(Array.from(expected.slice(4, 8)))
    expect(Array.from(patches[1].patch.data)).toEqual(Array.from(expected.slice(16, 20)))
    expect(context.drawImage).toHaveBeenCalledTimes(1)
    expect(context.drawImage).toHaveBeenCalledWith(previewCanvas, 0, 0, 6, 2, 0, 0, 96, 32)
    expect(MockOffscreenCanvas.instances.filter((canvas) => canvas.width === 6 && canvas.height === 2)).toHaveLength(2)
  })

  it('shows selection transform pixels across enabled tile-repeat boundaries', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
    }
    const document = createDocument('repeated selection transform', 4, 1, 'rgba')
    const layer = document.layers[0]
    writeLayerColor(document, layer, 3, { r: 255, g: 0, b: 0, a: 255 })
    const source = captureSelectionTransform(document, { x: 3, y: 0, width: 1, height: 1 }, layer)!

    new CanvasCompositeCache().draw({
      context: context as never,
      document,
      view: { zoom: 8, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false, tileRepeatMode: 'x' },
      originX: 0, originY: 0, canvasWidth: 32, canvasHeight: 8,
      fromX: 0, fromY: 0, toX: 4, toY: 1,
      revision: 1, contentRevision: 1,
      selectionPreview: { layerId: layer.id, source, target: { x: 4, y: 0, width: 1, height: 1 }, angle: 0, copy: false }
    })

    const previewCanvas = context.drawImage.mock.calls.at(-1)?.[0] as MockOffscreenCanvas
    const patches = previewCanvas.context.putImageData.mock.calls.map(([patch, patchX, patchY]) => ({
      patch: patch as MockImageData,
      patchX,
      patchY
    }))
    const wrappedPatch = patches.find(({ patchX, patchY }) => patchX === 0 && patchY === 0)
    const clearedSourcePatch = patches.find(({ patchX, patchY }) => patchX === 3 && patchY === 0)
    expect(Array.from(wrappedPatch?.patch.data ?? [])).toEqual([255, 0, 0, 255])
    expect(Array.from(clearedSourcePatch?.patch.data ?? [])).toEqual([0, 0, 0, 0])
  })

  it('matches the final tiled commit while an irregular selection crosses both canvas seams', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
    }
    const document = createDocument('repeated irregular selection preview', 4, 4, 'rgba')
    const layer = document.layers[0]
    const selected = [
      0, 1, 4, 5,
      7, 10, 11, 14, 15
    ]
    for (const index of selected) writeLayerColor(document, layer, index, { r: 41, g: 121, b: 255, a: 255 })
    const selection = {
      x: 0,
      y: 0,
      width: 4,
      height: 4,
      mask: Uint8Array.from(Array.from({ length: 16 }, (_, index) => selected.includes(index) ? 1 : 0))
    }
    const initialTarget = { ...selection }
    const target = { ...selection, x: 5, y: 5 }
    const source = captureSelectionTransform(document, selection, layer)!
    const cache = new CanvasCompositeCache()
    const drawPreview = (previewTarget: typeof target, fromX: number, fromY: number, toX: number, toY: number) => cache.draw({
      context: context as never,
      document,
      view: { zoom: 8, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false, tileRepeatMode: 'both' },
      originX: 0, originY: 0, canvasWidth: 32, canvasHeight: 32,
      fromX, fromY, toX, toY,
      revision: 1, contentRevision: 1,
      selectionPreview: { layerId: layer.id, source, target: previewTarget, angle: 0, copy: false }
    })

    drawPreview(initialTarget, 0, 0, 4, 4)
    drawPreview(target, 2, 2, 4, 4)

    const previewCanvas = context.drawImage.mock.calls.at(-1)?.[0] as MockOffscreenCanvas
    const previewPatchCall = previewCanvas.context.putImageData.mock.calls.at(-1)
    expect(previewPatchCall?.slice(1)).toEqual([0, 0])
    const previewPatch = previewPatchCall?.[0] as MockImageData
    applySelectionTranslationCommit(document, source, target, false, layer, 'both')
    expect(Array.from(previewPatch.data)).toEqual(Array.from(compositeRegion(document, 0, 0, 4, 4)))
  })

  it('uploads an Aseprite-style clipboard patch once and reuses it while zooming', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
    }
    const document = createDocument('clipboard zoom preview', 64, 64, 'rgba')
    const layer = document.layers[0]
    const selection = { x: 8, y: 8, width: 32, height: 32 }
    const source = {
      selection,
      values: new Uint32Array(selection.width * selection.height).fill(0xff0000ff),
      selectedOffsets: new Uint32Array(0),
      opaqueOffsets: new Uint32Array(0),
      opaqueIndices: new Uint32Array(0),
      opaqueValues: new Uint32Array(0),
      origin: 'clipboard' as const
    }
    const cache = new CanvasCompositeCache()
    const draw = (zoom: number, fromX: number, fromY: number, toX: number, toY: number) => cache.draw({
      context: context as never,
      document,
      view: { zoom, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      originX: -fromX * zoom,
      originY: -fromY * zoom,
      canvasWidth: (toX - fromX) * zoom,
      canvasHeight: (toY - fromY) * zoom,
      fromX,
      fromY,
      toX,
      toY,
      revision: 1,
      contentRevision: 1,
      selectionPreview: { layerId: layer.id, source, target: selection, angle: 0, copy: true }
    })

    draw(1, 0, 0, 64, 64)
    const previewCanvas = context.drawImage.mock.calls.at(-1)?.[0] as MockOffscreenCanvas
    expect(previewCanvas.context.putImageData).toHaveBeenCalledTimes(1)
    previewCanvas.context.putImageData.mockClear()
    context.drawImage.mockClear()

    draw(4, 16, 16, 32, 32)

    expect(previewCanvas.context.putImageData).not.toHaveBeenCalled()
    expect(context.drawImage).toHaveBeenLastCalledWith(previewCanvas, 0, 0, 32, 32, -32, -32, 128, 128)
  })

  it('matches the committed composite when a moved selection overlaps its source', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
    }
    const document = createDocument('overlapping selection patch', 8, 4, 'rgba')
    const bottom = document.layers[0]
    const active = createLayer('active', 8, 4, 'rgba')
    const top = createLayer('top', 8, 4, 'rgba')
    document.layers.push(active, top)
    document.activeLayerId = active.id
    for (let y = 0; y < document.height; y += 1) for (let x = 0; x < document.width; x += 1) {
      writeLayerColor(document, bottom, y * bottom.width + x, { r: x * 20, g: y * 40, b: 32, a: 255 })
    }
    writeLayerColor(document, active, 1 + active.width, { r: 255, g: 0, b: 0, a: 255 })
    writeLayerColor(document, active, 2 + active.width, { r: 0, g: 255, b: 0, a: 192 })
    writeLayerColor(document, active, 1 + 2 * active.width, { r: 0, g: 0, b: 255, a: 128 })
    writeLayerColor(document, active, 3 + 2 * active.width, { r: 255, g: 255, b: 0, a: 255 })
    writeLayerColor(document, active, 4 + active.width, { r: 255, g: 0, b: 255, a: 255 })
    writeLayerColor(document, top, 3 + active.width, { r: 255, g: 255, b: 255, a: 96 })
    const selection = { x: 1, y: 1, width: 3, height: 2 }
    const target = { ...selection, x: 2, y: 1 }
    const source = captureSelectionTransform(document, selection, active)!

    new CanvasCompositeCache().draw({
      context: context as never,
      document,
      view: { zoom: 16, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      originX: 0, originY: 0, canvasWidth: 128, canvasHeight: 64,
      fromX: 0, fromY: 0, toX: 8, toY: 4,
      revision: 1, contentRevision: 1,
      selectionPreview: { layerId: active.id, source, target, angle: 0, copy: false }
    })

    const previewCanvas = context.drawImage.mock.calls.at(-1)?.[0] as MockOffscreenCanvas
    const previewPatchCall = previewCanvas.context.putImageData.mock.calls.at(-1)
    expect(previewPatchCall?.slice(1)).toEqual([1, 1])
    const previewPatch = previewPatchCall?.[0] as MockImageData

    applySelectionTransform(document, source, target, 0, false, undefined, undefined, undefined, active)
    const expected = compositeRegion(document, 1, 1, 4, 2)
    expect(Array.from(previewPatch.data)).toEqual(Array.from(expected))
  })

  it('keeps distant source and target selection patches independent while dragging', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
    }
    const document = createDocument('incremental selection patch', 32, 8, 'rgba')
    const layer = document.layers[0]
    writeLayerColor(document, layer, 1 + layer.width, { r: 255, g: 0, b: 0, a: 255 })
    const source = captureSelectionTransform(document, { x: 1, y: 1, width: 1, height: 1 }, layer)!
    const cache = new CanvasCompositeCache()
    const draw = (targetX: number) => cache.draw({
      context: context as never,
      document,
      view: { zoom: 32, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      originX: 0, originY: 0, canvasWidth: 1024, canvasHeight: 256,
      fromX: 0, fromY: 0, toX: 32, toY: 8,
      revision: 1, contentRevision: 1,
      selectionPreview: { layerId: layer.id, source, target: { x: targetX, y: 1, width: 1, height: 1 }, angle: 0, copy: false }
    })

    draw(20)
    const previewCanvas = context.drawImage.mock.calls.at(-1)?.[0] as MockOffscreenCanvas
    previewCanvas.context.putImageData.mockClear()
    previewCanvas.context.clearRect.mockClear()
    previewCanvas.context.drawImage.mockClear()
    context.drawImage.mockClear()
    draw(21)

    expect(previewCanvas.context.clearRect.mock.calls).toEqual([
      [1, 1, 1, 1],
      [20, 1, 1, 1]
    ])
    expect(previewCanvas.context.drawImage.mock.calls.map((call) => call.slice(1))).toEqual([
      [1, 1, 1, 1, 1, 1, 1, 1],
      [20, 1, 1, 1, 20, 1, 1, 1]
    ])
    expect(previewCanvas.context.putImageData.mock.calls.map(([, patchX, patchY]) => ({ patchX, patchY }))).toEqual([
      { patchX: 1, patchY: 1 },
      { patchX: 21, patchY: 1 }
    ])
    expect(context.drawImage).toHaveBeenCalledOnce()
    expect(context.drawImage.mock.calls[0][0]).toBe(previewCanvas)
    expect(MockOffscreenCanvas.instances.filter((canvas) => canvas.width === 32 && canvas.height === 8)).toHaveLength(2)
  })

  it('refreshes the previous floating target before a second selection drag', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
    }
    const document = createDocument('floating selection restart', 8, 1, 'rgba')
    const layer = document.layers[0]
    writeLayerColor(document, layer, 1, { r: 255, g: 0, b: 0, a: 255 })
    const source = captureSelectionTransform(document, { x: 1, y: 0, width: 1, height: 1 }, layer)!
    const cache = new CanvasCompositeCache()
    const draw = (contentRevision: number, selectionPreview?: Parameters<CanvasCompositeCache['draw']>[0]['selectionPreview']) => cache.draw({
      context: context as never,
      document,
      view: { zoom: 16, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      originX: 0, originY: 0, canvasWidth: 128, canvasHeight: 16,
      fromX: 0, fromY: 0, toX: 8, toY: 1,
      revision: contentRevision,
      contentRevision,
      selectionPreview
    })

    draw(1)
    const surface = MockOffscreenCanvas.instances.find((canvas) => canvas.width === 8 && canvas.height === 1)!
    const floatingEdit = applySelectionTransform(document, source, { x: 4, y: 0, width: 1, height: 1 }, 0, false, undefined, undefined, undefined, layer)!
    cache.invalidateRect({ x: 1, y: 0, width: 1, height: 1 }, document.width, document.height)
    cache.invalidateRect({ x: 4, y: 0, width: 1, height: 1 }, document.width, document.height)
    draw(2)

    revertPixelEdit(document, floatingEdit)
    cache.invalidateRect({ x: 1, y: 0, width: 1, height: 1 }, document.width, document.height)
    cache.invalidateRect({ x: 4, y: 0, width: 1, height: 1 }, document.width, document.height)
    surface.context.putImageData.mockClear()
    draw(2, { layerId: layer.id, source, target: { x: 5, y: 0, width: 1, height: 1 }, angle: 0, copy: false })

    expect(surface.context.putImageData.mock.calls.map(([, patchX, patchY]) => ({ patchX, patchY }))).toEqual([
      { patchX: 1, patchY: 0 },
      { patchX: 4, patchY: 0 }
    ])
  })

  it('repairs only visible pixels after a full invalidation and repairs newly revealed pixels before drawing', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
    }
    const document = createDocument('deferred full invalidation', 1536, 512, 'rgba')
    const cache = new CanvasCompositeCache(16 * 1024 * 1024)
    const draw = (fromX: number, toX: number, contentRevision: number, contentInvalidation: Parameters<CanvasCompositeCache['draw']>[0]['contentInvalidation']) => cache.draw({
      context: context as never,
      document,
      view: { zoom: 128, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      originX: -fromX * 128,
      originY: 0,
      canvasWidth: document.width * 128,
      canvasHeight: document.height * 128,
      fromX,
      fromY: 20,
      toX,
      toY: 24,
      revision: contentRevision,
      contentRevision,
      contentInvalidation
    })

    draw(700, 704, 1, null)
    const surface = context.drawImage.mock.calls.at(-1)?.[0] as MockOffscreenCanvas
    const initialSurfaceCount = MockOffscreenCanvas.instances.length
    draw(700, 704, 2, { kind: 'full', fromRevision: 1, revision: 2 })

    expect(context.drawImage.mock.calls.at(-1)?.[0]).toBe(surface)
    expect(MockOffscreenCanvas.instances).toHaveLength(initialSurfaceCount)
    expect(surface.context.putImageData).toHaveBeenLastCalledWith(expect.objectContaining({ width: 4, height: 4 }), 700, 20)

    draw(100, 104, 2, null)
    expect(context.drawImage.mock.calls.at(-1)?.[0]).toBe(surface)
    expect(surface.context.putImageData).toHaveBeenLastCalledWith(expect.objectContaining({ width: 4, height: 4 }), 100, 20)
  })

  it('draws an active layer mask as an isolated white-backed grayscale surface', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
    }
    const document = createDocument('isolated mask', 2, 1, 'rgba')
    const cel = ensureAnimationDocument(document).cels[0]
    const mask = createLayerMask(cel.id, 2, 1)
    cel.mask = mask
    writeLayerColor(document, mask, 1, { r: 255, g: 0, b: 0, a: 255 })

    new CanvasCompositeCache().draw({
      context: context as never,
      document,
      view: { zoom: 2, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      originX: 0,
      originY: 0,
      canvasWidth: 4,
      canvasHeight: 2,
      fromX: 0,
      fromY: 0,
      toX: 2,
      toY: 1,
      revision: 1,
      isolatedLayerMask: mask
    })

    const surface = context.drawImage.mock.calls[0][0] as MockOffscreenCanvas
    const rendered = surface.context.putImageData.mock.calls[0][0] as MockImageData
    expect(Array.from(rendered.data)).toEqual([255, 255, 255, 255, 54, 54, 54, 255])
  })

  it('patches an isolated linked mask when its source frame differs from the active frame', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
    }
    const document = createDocument('linked isolated mask', 2, 1, 'rgba')
    const timeline = ensureAnimationDocument(document)
    const sourceFrameId = timeline.activeFrameId
    const activeFrameId = 'frame-linked-target'
    timeline.frames.push({ id: activeFrameId, duration: 100 })
    timeline.activeFrameId = activeFrameId
    const sourceCel = timeline.cels[0]
    const mask = createLayerMask(sourceCel.id, 2, 1)
    sourceCel.mask = mask
    const cache = new CanvasCompositeCache()
    const draw = (contentRevision: number, contentInvalidation: Parameters<CanvasCompositeCache['draw']>[0]['contentInvalidation'] = null): void => cache.draw({
      context: context as never,
      document,
      view: { zoom: 2, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      originX: 0,
      originY: 0,
      canvasWidth: 4,
      canvasHeight: 2,
      fromX: 0,
      fromY: 0,
      toX: 2,
      toY: 1,
      revision: contentRevision,
      contentRevision,
      contentInvalidation,
      frameId: activeFrameId,
      isolatedLayerMask: mask
    })

    draw(0)
    const surface = context.drawImage.mock.calls[0][0] as MockOffscreenCanvas
    writeLayerColor(document, mask, 0, { r: 0, g: 0, b: 0, a: 255 })
    draw(1, { kind: 'region', fromRevision: 0, revision: 1, frameId: sourceFrameId, rect: { x: 0, y: 0, width: 1, height: 1 } })

    expect(surface.context.putImageData).toHaveBeenCalledTimes(2)
    const patch = surface.context.putImageData.mock.calls[1][0] as MockImageData
    expect(Array.from(patch.data)).toEqual([0, 0, 0, 255])
  })

  it('draws a fractional-zoom canvas as one continuous surface while painting', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
    }
    const document = createDocument('continuous surface', 256, 256, 'rgba')
    new CanvasCompositeCache().draw({
      context: context as never,
      document,
      view: { zoom: 1.5, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      originX: 10,
      originY: 20,
      canvasWidth: 384,
      canvasHeight: 384,
      fromX: 0,
      fromY: 0,
      toX: 256,
      toY: 256,
      revision: 1
    })
    expect(context.drawImage).toHaveBeenCalledTimes(1)
    expect(context.drawImage).toHaveBeenCalledWith(expect.any(MockOffscreenCanvas), 0, 0, 256, 256, 10, 20, 384, 384)
    expect(context.translate).not.toHaveBeenCalled()
    expect(context.scale).not.toHaveBeenCalled()
  })

  it('keeps idle and drawing frames on the same continuous surface path', () => {
    const createContext = () => ({
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
    })
    const document = createDocument('fractional', 64, 64, 'rgba')
    const cache = new CanvasCompositeCache()
    const draw = (activeDrag?: 'draw') => {
      const context = createContext()
      cache.draw({
        context: context as never,
        document,
        view: { zoom: 3.13, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
        originX: 12.25,
        originY: 8.75,
        canvasWidth: 200.32,
        canvasHeight: 200.32,
        fromX: 0,
        fromY: 0,
        toX: 64,
        toY: 64,
        revision: 1
      })
      return context
    }

    const idle = draw()
    const drawing = draw('draw')

    expect(idle.drawImage).toHaveBeenCalledTimes(1)
    expect(drawing.drawImage).toHaveBeenCalledTimes(1)
    expect(idle.drawImage.mock.calls[0][0]).toBe(drawing.drawImage.mock.calls[0][0])
    expect(idle.drawImage).toHaveBeenCalledWith(expect.any(MockOffscreenCanvas), 0, 0, 64, 64, 12.25, 8.75, 200.32, 200.32)
  })

  it('draws below 100 percent zoom directly from the exact source surface', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high'
    }
    const document = createDocument('large overview', 4000, 4000, 'rgba')
    const cache = new CanvasCompositeCache()
    const draw = (originX: number) => cache.draw({
      context: context as never,
      document,
      view: { zoom: 0.125, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      originX,
      originY: 0,
      canvasWidth: 500,
      canvasHeight: 500,
      fromX: 0,
      fromY: 0,
      toX: 4000,
      toY: 4000,
      revision: 1,
      contentRevision: 1,
      imageSmoothingEnabled: true
    })

    draw(10)
    const exactSurface = context.drawImage.mock.calls.at(-1)?.[0] as MockOffscreenCanvas
    expect(exactSurface.width).toBe(4000)
    expect(exactSurface.height).toBe(4000)
    expect(context.drawImage).toHaveBeenLastCalledWith(exactSurface, 0, 0, 4000, 4000, 10, 0, 500, 500)

    draw(24)
    expect(context.drawImage.mock.calls.at(-1)?.[0]).toBe(exactSurface)
    expect(context.drawImage).toHaveBeenLastCalledWith(exactSurface, 0, 0, 4000, 4000, 24, 0, 500, 500)
  })

  it('keeps the exact source surface after a dirty-region update below 100 percent zoom', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high'
    }
    const document = createDocument('overview update', 64, 64, 'rgba')
    const cache = new CanvasCompositeCache()
    const options = {
      context: context as never,
      document,
      view: { zoom: 0.5, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      originX: 0,
      originY: 0,
      canvasWidth: 32,
      canvasHeight: 32,
      fromX: 0,
      fromY: 0,
      toX: 64,
      toY: 64,
      revision: 1,
      contentRevision: 1,
      imageSmoothingEnabled: true
    }

    cache.draw(options)
    const exactSurface = context.drawImage.mock.calls.at(-1)?.[0]
    cache.invalidateRect({ x: 2, y: 3, width: 1, height: 1 }, 64, 64)
    cache.draw(options)
    expect(context.drawImage.mock.calls.at(-1)?.[0]).toBe(exactSurface)
    expect((exactSurface as MockOffscreenCanvas).context.putImageData).toHaveBeenLastCalledWith(expect.objectContaining({ width: 1, height: 1 }), 2, 3)
  })

  it('patches a dirty rectangle without splitting the final display surface', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
    }
    const document = createDocument('dirty surface', 256, 256, 'rgba')
    const cache = new CanvasCompositeCache()
    const options = {
      context: context as never,
      document,
      view: { zoom: 1.5, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      originX: 0,
      originY: 0,
      canvasWidth: 384,
      canvasHeight: 384,
      fromX: 0,
      fromY: 0,
      toX: 256,
      toY: 256,
      revision: 1,
      activeDrag: 'draw' as const
    }
    cache.draw(options)
    const surface = context.drawImage.mock.calls[0][0] as MockOffscreenCanvas

    cache.invalidateRect({ x: 127, y: 127, width: 3, height: 3 }, document.width, document.height)
    cache.draw(options)

    expect(context.drawImage).toHaveBeenCalledTimes(2)
    expect(context.drawImage.mock.calls[1][0]).toBe(surface)
    expect(surface.context.putImageData).toHaveBeenLastCalledWith(expect.objectContaining({ width: 3, height: 3 }), 127, 127)
  })

  it('keeps the composite surface while a moved layer patches its old and new bounds', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
    }
    const document = createDocument('moved layer dirty bounds', 256, 256, 'rgba')
    const layer = document.layers[0]
    writeLayerColor(document, layer, 10 + 10 * layer.width, { r: 255, g: 0, b: 0, a: 255 })
    const cache = new CanvasCompositeCache()
    const options = {
      context: context as never,
      document,
      view: { zoom: 1, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      originX: 0, originY: 0, canvasWidth: 256, canvasHeight: 256,
      fromX: 0, fromY: 0, toX: 256, toY: 256, revision: 1, contentRevision: 1
    }
    cache.draw(options)
    const surface = context.drawImage.mock.calls.at(-1)?.[0] as MockOffscreenCanvas

    layer.offsetX = 20
    cache.invalidateRect({ x: 10, y: 10, width: 1, height: 1 }, document.width, document.height)
    cache.invalidateRect({ x: 30, y: 10, width: 1, height: 1 }, document.width, document.height)
    cache.draw(options)

    expect(context.drawImage.mock.calls.at(-1)?.[0]).toBe(surface)
    expect(surface.context.putImageData).toHaveBeenCalledWith(expect.objectContaining({ width: 1, height: 1 }), 10, 10)
    expect(surface.context.putImageData).toHaveBeenCalledWith(expect.objectContaining({ width: 1, height: 1 }), 30, 10)
  })

  it('reuses cached frame surfaces while only the active frame revision changes', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
    }
    const document = createDocument('animation cache', 64, 64, 'rgba')
    const cache = new CanvasCompositeCache()
    const draw = (frameId: string, revision: number) => cache.draw({
      context: context as never,
      document,
      view: { zoom: 2, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      originX: 0,
      originY: 0,
      canvasWidth: 128,
      canvasHeight: 128,
      fromX: 0,
      fromY: 0,
      toX: 64,
      toY: 64,
      revision,
      contentRevision: 1,
      frameId
    })

    draw('frame-1', 1)
    const firstFrameSurface = context.drawImage.mock.calls.at(-1)?.[0]
    draw('frame-2', 2)
    expect(context.drawImage.mock.calls.at(-1)?.[0]).not.toBe(firstFrameSurface)
    draw('frame-1', 3)
    expect(context.drawImage.mock.calls.at(-1)?.[0]).toBe(firstFrameSurface)
  })

  it('evicts old frame surfaces when the byte budget is reached', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
    }
    const document = createDocument('budgeted animation cache', 8, 8, 'rgba')
    const cache = new CanvasCompositeCache(8 * 8 * 4 * 2)
    const draw = (frameId: string) => cache.draw({
      context: context as never,
      document,
      view: { zoom: 1, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      originX: 0,
      originY: 0,
      canvasWidth: 8,
      canvasHeight: 8,
      fromX: 0,
      fromY: 0,
      toX: 8,
      toY: 8,
      revision: 1,
      contentRevision: 1,
      frameId
    })

    draw('frame-1')
    const firstSurface = context.drawImage.mock.calls.at(-1)?.[0]
    draw('frame-2')
    draw('frame-3')
    draw('frame-1')
    expect(context.drawImage.mock.calls.at(-1)?.[0]).not.toBe(firstSurface)
  })

  it('patches a pixel-edit region across content revisions and reuses the exact surface for full changes', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
    }
    const document = createDocument('revision invalidation', 64, 64, 'rgba')
    const frameId = document.animation!.activeFrameId
    const cache = new CanvasCompositeCache()
    const draw = (contentRevision: number, contentInvalidation: Parameters<CanvasCompositeCache['draw']>[0]['contentInvalidation']) => cache.draw({
      context: context as never,
      document,
      view: { zoom: 2, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      originX: 0,
      originY: 0,
      canvasWidth: 128,
      canvasHeight: 128,
      fromX: 0,
      fromY: 0,
      toX: 64,
      toY: 64,
      revision: contentRevision,
      contentRevision,
      contentInvalidation,
      frameId
    })

    draw(1, null)
    const firstSurface = context.drawImage.mock.calls.at(-1)?.[0] as MockOffscreenCanvas
    draw(2, { kind: 'region', fromRevision: 1, revision: 2, frameId, rect: { x: 8, y: 9, width: 3, height: 2 } })

    expect(context.drawImage.mock.calls.at(-1)?.[0]).toBe(firstSurface)
    expect(firstSurface.context.putImageData).toHaveBeenLastCalledWith(expect.objectContaining({ width: 3, height: 2 }), 8, 9)

    draw(3, { kind: 'full', fromRevision: 2, revision: 3 })
    expect(context.drawImage.mock.calls.at(-1)?.[0]).toBe(firstSurface)
    expect(firstSurface.context.putImageData).toHaveBeenLastCalledWith(expect.objectContaining({ width: 64, height: 64 }), 0, 0)
  })

  it('refreshes the current stroke region instead of reusing the previous committed invalidation', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
    }
    const document = createDocument('live stroke invalidation', 64, 64, 'rgba')
    document.layers.push(createLayer('top', 64, 64, 'rgba'))
    const frameId = document.animation!.activeFrameId
    const cache = new CanvasCompositeCache()
    const staleInvalidation = { kind: 'region' as const, fromRevision: 0, revision: 1, frameId, rect: { x: 2, y: 3, width: 1, height: 1 } }
    const draw = () => cache.draw({
      context: context as never,
      document,
      view: { zoom: 4, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      originX: 0,
      originY: 0,
      canvasWidth: 256,
      canvasHeight: 256,
      fromX: 0,
      fromY: 0,
      toX: 64,
      toY: 64,
      revision: 1,
      contentRevision: 1,
      contentInvalidation: staleInvalidation,
      frameId
    })

    draw()
    const rowsFor = vi.spyOn(DocumentCompositeCache.prototype, 'rowsFor')
    const dirtyRect = { x: 30, y: 31, width: 1, height: 1 }
    writeLayerColor(document, document.layers[0], dirtyRect.y * document.width + dirtyRect.x, { r: 255, g: 0, b: 0, a: 255 })
    cache.invalidateRect(dirtyRect, document.width, document.height, frameId)
    rowsFor.mockClear()
    draw()

    expect(rowsFor).toHaveBeenCalledWith(document.layers[0], document.palette, 1, dirtyRect)
    const surface = context.drawImage.mock.calls.at(-1)?.[0] as MockOffscreenCanvas
    expect(surface.context.putImageData).toHaveBeenLastCalledWith(expect.objectContaining({ width: 1, height: 1 }), dirtyRect.x, dirtyRect.y)
  })

  it('patches the complete reflected edge of an even brush on a sparse new layer', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
    }
    const document = createDocument('sparse symmetric live stroke', 32, 32, 'rgba')
    const layer = createSparseLayer('top', 'rgba')
    document.layers.push(layer)
    document.activeLayerId = layer.id
    const frameId = ensureAnimationDocument(document).activeFrameId
    const cache = new CanvasCompositeCache()
    const draw = () => cache.draw({
      context: context as never,
      document,
      view: { zoom: 4, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      originX: 0,
      originY: 0,
      canvasWidth: 128,
      canvasHeight: 128,
      fromX: 0,
      fromY: 0,
      toX: 32,
      toY: 32,
      revision: 1,
      contentRevision: 1,
      frameId
    })

    draw()
    const surface = context.drawImage.mock.calls.at(-1)?.[0] as MockOffscreenCanvas
    surface.context.putImageData.mockClear()
    const point = { x: 8, y: 8 }
    const axes = { horizontal: true, vertical: false, diagonalUp: false, diagonalDown: false }
    const center = { x: 16, y: 16 }
    paintBrush(document, layer, beginPixelEdit(layer.id), point.x, point.y, 8, { r: 41, g: 121, b: 255, a: 255 }, 'square', null, 'solid', 1, null, undefined, 0, 'paint', undefined, axes, center)
    for (const rect of brushStrokeInvalidationRects(point, point, 8, null, document.width, document.height, axes, center)) {
      cache.invalidateDocumentRect(rect, document, frameId, [layer.id])
    }

    draw()

    const targetX = 4
    const targetY = 27
    const patchCall = surface.context.putImageData.mock.calls.find(([data, x, y]) => {
      const patch = data as MockImageData
      return targetX >= x && targetX < x + patch.width && targetY >= y && targetY < y + patch.height
    })
    expect(patchCall).toBeDefined()
    const patch = patchCall![0] as MockImageData
    const patchX = patchCall![1] as number
    const patchY = patchCall![2] as number
    const offset = ((targetY - patchY) * patch.width + targetX - patchX) * 4
    expect(Array.from(patch.data.slice(offset, offset + 4))).toEqual([41, 121, 255, 255])
  })

  it('expands live pixel invalidation to refresh non-destructive layer styles', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
    }
    const document = createDocument('styled live stroke', 8, 8, 'rgba')
    const layer = document.layers[0]
    const styles = createDefaultLayerStyles()
    styles.stroke.enabled = true
    layer.layerStyles = styles
    writeLayerColor(document, layer, 2 * document.width + 2, { r: 41, g: 121, b: 255, a: 255 })
    const frameId = document.animation!.activeFrameId
    const cache = new CanvasCompositeCache()
    const draw = () => cache.draw({
      context: context as never,
      document,
      view: { zoom: 4, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      originX: 0,
      originY: 0,
      canvasWidth: 32,
      canvasHeight: 32,
      fromX: 0,
      fromY: 0,
      toX: 8,
      toY: 8,
      revision: 1,
      contentRevision: 1,
      frameId
    })

    draw()
    writeLayerColor(document, layer, 2 * document.width + 3, { r: 41, g: 121, b: 255, a: 255 })
    cache.invalidateDocumentRect({ x: 3, y: 2, width: 1, height: 1 }, document, frameId, [layer.id])
    draw()

    const surface = context.drawImage.mock.calls.at(-1)?.[0] as MockOffscreenCanvas
    const patch = surface.context.putImageData.mock.calls.at(-1)
    expect(patch?.[1]).toBe(2)
    expect(patch?.[2]).toBe(1)
    expect(patch?.[0]).toMatchObject({ width: 3, height: 3 })
    expect(Array.from((patch?.[0] as MockImageData).data)).toEqual(Array.from(compositeRegion(document, 2, 1, 3, 3)))
  })

  it('refreshes pasted pixels when a revision change arrives with stale invalidation metadata', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
    }
    const document = createDocument('paste invalidation', 64, 64, 'rgba')
    document.layers.push(createLayer('top', 64, 64, 'rgba'))
    const frameId = document.animation!.activeFrameId
    const cache = new CanvasCompositeCache()
    const draw = (contentRevision: number, contentInvalidation: Parameters<CanvasCompositeCache['draw']>[0]['contentInvalidation']) => cache.draw({
      context: context as never,
      document,
      view: { zoom: 4, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      originX: 0,
      originY: 0,
      canvasWidth: 256,
      canvasHeight: 256,
      fromX: 0,
      fromY: 0,
      toX: 64,
      toY: 64,
      revision: contentRevision,
      contentRevision,
      contentInvalidation,
      frameId
    })

    draw(1, null)
    const pastedX = 40
    const pastedY = 41
    writeLayerColor(document, document.layers[0], pastedY * document.width + pastedX, { r: 0, g: 96, b: 255, a: 255 })
    draw(2, { kind: 'region', fromRevision: 0, revision: 1, frameId, rect: { x: 1, y: 1, width: 1, height: 1 } })

    const surface = context.drawImage.mock.calls.at(-1)?.[0] as MockOffscreenCanvas
    const rendered = surface.context.putImageData.mock.calls.at(-1)?.[0] as MockImageData
    const offset = (pastedY * document.width + pastedX) * 4
    expect(Array.from(rendered.data.slice(offset, offset + 4))).toEqual([0, 96, 255, 255])
  })

  it('passes dirty regions through the shared row cache on the visible-region path', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
    }
    const document = createDocument('region row cache', 64, 64, 'rgba')
    document.layers.push(createLayer('top', 64, 64, 'rgba'))
    const frameId = document.animation!.activeFrameId
    const cache = new CanvasCompositeCache(1)
    const rowsFor = vi.spyOn(DocumentCompositeCache.prototype, 'rowsFor')
    const draw = (contentRevision: number, contentInvalidation: Parameters<CanvasCompositeCache['draw']>[0]['contentInvalidation']) => cache.draw({
      context: context as never,
      document,
      view: { zoom: 4, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      originX: 0,
      originY: 0,
      canvasWidth: 64,
      canvasHeight: 64,
      fromX: 8,
      fromY: 8,
      toX: 24,
      toY: 24,
      revision: contentRevision,
      contentRevision,
      contentInvalidation,
      frameId
    })

    draw(1, null)
    rowsFor.mockClear()
    writeLayerColor(document, document.layers[0], 10 * document.width + 11, { r: 255, g: 0, b: 0, a: 255 })
    const dirtyRect = { x: 11, y: 10, width: 1, height: 1 }
    draw(2, { kind: 'region', fromRevision: 1, revision: 2, frameId, rect: dirtyRect })

    expect(rowsFor).toHaveBeenCalledWith(document.layers[0], document.palette, 2, dirtyRect)
    const regionSurface = context.drawImage.mock.calls.at(-1)?.[0] as MockOffscreenCanvas
    expect(regionSurface.context.putImageData).toHaveBeenLastCalledWith(expect.objectContaining({ width: 1, height: 1 }), 3, 2)
  })
})
