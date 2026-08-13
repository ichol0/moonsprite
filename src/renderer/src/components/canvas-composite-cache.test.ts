import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDocument, createLayerMask, writeLayerColor } from '@/core/document'
import { addBlankAnimationFrame, ensureAnimationDocument } from '@/core/animation'
import { CanvasCompositeCache, shouldCacheFullCompositeSurface } from './canvas-composite-cache'
import { canPrepareInitialDocumentComposite, registerInitialDocumentComposite, registerPendingInitialDocumentComposite } from '@/core/initial-document-composite'

class MockOffscreenCanvas {
  static instances: MockOffscreenCanvas[] = []
  readonly context = {
    putImageData: vi.fn(),
    drawImage: vi.fn(),
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
})
