import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addBlankAnimationFrame, ensureAnimationDocument } from '@/core/animation'
import { createDocument } from '@/core/document'
import { onionSkinFrameRefs } from '@/core/onion-skin'
import { OnionSkinCompositeCache } from './onion-skin-composite-cache'

class MockOffscreenCanvas {
  static instances: MockOffscreenCanvas[] = []
  readonly context = {
    putImageData: vi.fn(),
    drawImage: vi.fn(),
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low'
  }
  constructor(public width: number, public height: number) { MockOffscreenCanvas.instances.push(this) }
  getContext() { return this.context }
}

class MockImageData {
  constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
}

const style = {
  previousColor: { r: 255, g: 0, b: 0, a: 255 },
  nextColor: { r: 0, g: 255, b: 0, a: 255 },
  previousOpacity: 40,
  nextOpacity: 40
}

describe('OnionSkinCompositeCache', () => {
  beforeEach(() => {
    MockOffscreenCanvas.instances = []
    vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas)
    vi.stubGlobal('ImageData', MockImageData)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('reuses visible tiles while panning across a large animation frame', () => {
    const document = createDocument('tiled onion skin', 1536, 512, 'rgba')
    addBlankAnimationFrame(document)
    const timeline = ensureAnimationDocument(document)
    const refs = onionSkinFrameRefs(timeline, 1, 0)
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), drawImage: vi.fn(),
      imageSmoothingEnabled: false, imageSmoothingQuality: 'low'
    }
    const cache = new OnionSkinCompositeCache()
    const draw = (fromX: number, toX: number) => cache.draw({
      context: context as never,
      document,
      refs,
      style,
      originX: -fromX,
      originY: 0,
      canvasWidth: 512,
      canvasHeight: 512,
      fromX,
      fromY: 0,
      toX,
      toY: 512,
      zoom: 1,
      revision: 1
    })

    draw(0, 512)
    expect(MockOffscreenCanvas.instances.filter((canvas) => canvas.context.putImageData.mock.calls.length > 0)).toHaveLength(1)
    draw(256, 768)
    expect(MockOffscreenCanvas.instances.filter((canvas) => canvas.context.putImageData.mock.calls.length > 0)).toHaveLength(2)
  })

  it('does not rebuild previous-frame tiles after an active-frame region edit', () => {
    const document = createDocument('stable onion skin', 512, 512, 'rgba')
    addBlankAnimationFrame(document)
    const timeline = ensureAnimationDocument(document)
    const refs = onionSkinFrameRefs(timeline, 1, 0)
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), drawImage: vi.fn(),
      imageSmoothingEnabled: false, imageSmoothingQuality: 'low'
    }
    const cache = new OnionSkinCompositeCache()
    const options = {
      context: context as never,
      document,
      refs,
      style,
      originX: 0,
      originY: 0,
      canvasWidth: 512,
      canvasHeight: 512,
      fromX: 0,
      fromY: 0,
      toX: 512,
      toY: 512,
      zoom: 1
    }

    cache.draw({ ...options, revision: 1 })
    const renderedTiles = MockOffscreenCanvas.instances.filter((canvas) => canvas.context.putImageData.mock.calls.length > 0)
    expect(renderedTiles).toHaveLength(1)
    cache.draw({ ...options, revision: 2, invalidation: { kind: 'region', fromRevision: 1, revision: 2, frameId: timeline.activeFrameId, rect: { x: 0, y: 0, width: 1, height: 1 } } })
    expect(MockOffscreenCanvas.instances.filter((canvas) => canvas.context.putImageData.mock.calls.length > 0)).toHaveLength(1)
  })

  it('rebuilds only onion-skin frames invalidated by a live animation preview', () => {
    const document = createDocument('moving onion skin', 512, 512, 'rgba')
    addBlankAnimationFrame(document)
    const timeline = ensureAnimationDocument(document)
    const refs = onionSkinFrameRefs(timeline, 1, 0)
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), drawImage: vi.fn(),
      imageSmoothingEnabled: false, imageSmoothingQuality: 'low'
    }
    const cache = new OnionSkinCompositeCache()
    const options = {
      context: context as never,
      document,
      refs,
      style,
      originX: 0,
      originY: 0,
      canvasWidth: 512,
      canvasHeight: 512,
      fromX: 0,
      fromY: 0,
      toX: 512,
      toY: 512,
      zoom: 1,
      revision: 1
    }

    cache.draw(options)
    expect(MockOffscreenCanvas.instances.filter((canvas) => canvas.context.putImageData.mock.calls.length > 0)).toHaveLength(1)

    cache.invalidateFrames([refs[0].frameId])
    cache.draw(options)

    expect(MockOffscreenCanvas.instances.filter((canvas) => canvas.context.putImageData.mock.calls.length > 0)).toHaveLength(2)
  })
})
