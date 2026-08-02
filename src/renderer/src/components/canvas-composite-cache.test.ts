import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDocument } from '@/core/document'
import { CanvasCompositeCache } from './canvas-composite-cache'

class MockOffscreenCanvas {
  constructor(public width: number, public height: number) {}
  getContext() { return { putImageData: vi.fn() } }
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

  it('applies the tile transform once per draw instead of once per tile', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: true
    }
    const document = createDocument('tiles', 256, 256, 'rgba')
    new CanvasCompositeCache().draw({
      context: context as never,
      document,
      view: { zoom: 2, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      originX: 10,
      originY: 20,
      canvasWidth: 512,
      canvasHeight: 512,
      fromX: 0,
      fromY: 0,
      toX: 256,
      toY: 256,
      revision: 1,
      activeDrag: 'draw'
    })
    expect(context.drawImage).toHaveBeenCalledTimes(4)
    expect(context.translate).toHaveBeenCalledTimes(1)
    expect(context.scale).toHaveBeenCalledTimes(1)
    expect(context.save).toHaveBeenCalledTimes(2)
    expect(context.restore).toHaveBeenCalledTimes(2)
  })
})
