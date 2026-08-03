import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDocument } from '@/core/document'
import { CanvasCompositeCache } from './canvas-composite-cache'

class MockOffscreenCanvas {
  readonly context = { putImageData: vi.fn() }
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
    expect(context.drawImage).toHaveBeenCalledWith(expect.any(MockOffscreenCanvas), 10, 20, 384, 384)
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
    expect(idle.drawImage).toHaveBeenCalledWith(expect.any(MockOffscreenCanvas), 12.25, 8.75, 200.32, 200.32)
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
})
