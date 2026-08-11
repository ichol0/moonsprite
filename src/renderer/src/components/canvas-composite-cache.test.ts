import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDocument, createLayerMask, writeLayerColor } from '@/core/document'
import { ensureAnimationDocument } from '@/core/animation'
import { CanvasCompositeCache, shouldCacheFullCompositeSurface } from './canvas-composite-cache'

class MockOffscreenCanvas {
  readonly context = {
    putImageData: vi.fn(),
    drawImage: vi.fn(),
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low'
  }
  constructor(public width: number, public height: number) {}
  getContext() { return this.context }
}

class MockImageData {
  constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
}

describe('CanvasCompositeCache', () => {
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas)
    vi.stubGlobal('ImageData', MockImageData)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps a 4200 by 1800 document in the reusable full-surface cache', () => {
    expect(shouldCacheFullCompositeSurface(4200, 1800)).toBe(true)
    expect(shouldCacheFullCompositeSurface(9000, 1800)).toBe(false)
    expect(shouldCacheFullCompositeSurface(4200, 1800, 16 * 1024 * 1024)).toBe(false)
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
      revision: 1,
      activeDrag: 'draw'
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
        revision: 1,
        activeDrag
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

  it('reuses the downscaled surface while panning below 100 percent zoom', () => {
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
    const scaledSurface = context.drawImage.mock.calls.at(-1)?.[0] as MockOffscreenCanvas
    expect(scaledSurface.width).toBe(500)
    expect(scaledSurface.height).toBe(500)
    expect(scaledSurface.context.drawImage).toHaveBeenCalledTimes(1)
    expect(context.drawImage).toHaveBeenLastCalledWith(scaledSurface, 10, 0, 500, 500)

    draw(24)
    expect(context.drawImage.mock.calls.at(-1)?.[0]).toBe(scaledSurface)
    expect(scaledSurface.context.drawImage).toHaveBeenCalledTimes(1)
    expect(context.drawImage).toHaveBeenLastCalledWith(scaledSurface, 24, 0, 500, 500)
  })

  it('rebuilds the downscaled surface after a dirty-region update', () => {
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
    const firstScaledSurface = context.drawImage.mock.calls.at(-1)?.[0]
    cache.invalidateRect({ x: 2, y: 3, width: 1, height: 1 }, 64, 64)
    cache.draw(options)
    expect(context.drawImage.mock.calls.at(-1)?.[0]).not.toBe(firstScaledSurface)
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

  it('patches a pixel-edit region across content revisions and rebuilds for full changes', () => {
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
    expect(context.drawImage.mock.calls.at(-1)?.[0]).not.toBe(firstSurface)
  })
})
