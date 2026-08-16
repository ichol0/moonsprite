import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MoonSpriteApi } from '@shared/types'
import { createDocument, getActiveLayer, writeLayerColor } from '@/core/document'
import { activateAnimationFrame, animationCelAt, duplicateAnimationFrame, ensureAnimationDocument } from '@/core/animation'
import { useWorkspace } from './workspace'

const red = { r: 255, g: 0, b: 0, a: 255 }
const blue = { r: 0, g: 80, b: 255, a: 255 }

beforeEach(() => {
  const api = {
    getResourceInfo: vi.fn(async () => ({ totalBytes: 8_000_000_000, freeBytes: 4_000_000_000 }))
  } as unknown as MoonSpriteApi
  Object.defineProperty(window, 'moonSprite', { configurable: true, writable: true, value: api })
  localStorage.clear()
  useWorkspace.setState({ sessions: [], activeId: null, message: null, saveProgress: null, dialog: null })
})

describe('image resize history', () => {
  it('swaps raster buffers across animation frames during undo and redo', async () => {
    const document = createDocument('animated image resize history', 4, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 2, red)
    const timeline = ensureAnimationDocument(document)
    const firstFrameId = timeline.activeFrameId
    const secondFrameId = duplicateAnimationFrame(document)
    writeLayerColor(document, layer, 2, blue)
    activateAnimationFrame(document, firstFrameId)
    const firstCel = animationCelAt(timeline, layer.id, firstFrameId)!
    const secondCel = animationCelAt(timeline, layer.id, secondFrameId)!
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 1, y: 0, width: 2, height: 1, mask: new Uint8Array([1, 0]) })
    const beforeLayerPixels = layer.pixels
    const beforeFirstPixels = firstCel.surface!.pixels
    const beforeSecondPixels = secondCel.surface!.pixels
    const beforeSelectionMask = useWorkspace.getState().sessions[0].selection!.mask!

    await useWorkspace.getState().resizeActiveImage(2, 1, 'nearest')
    const afterLayerPixels = layer.pixels
    const afterFirstPixels = firstCel.surface!.pixels
    const afterSecondPixels = secondCel.surface!.pixels
    const afterSelectionMask = useWorkspace.getState().sessions[0].selection!.mask!
    expect(afterLayerPixels).not.toBe(beforeLayerPixels)
    expect(firstCel.surface).toMatchObject({ width: 2, height: 1 })
    expect(secondCel.surface).toMatchObject({ width: 2, height: 1 })

    useWorkspace.getState().undo()
    expect(document).toMatchObject({ width: 4, height: 1 })
    expect(layer.pixels).toBe(beforeLayerPixels)
    expect(firstCel.surface!.pixels).toBe(beforeFirstPixels)
    expect(secondCel.surface!.pixels).toBe(beforeSecondPixels)
    expect(useWorkspace.getState().sessions[0].selection!.mask).toBe(beforeSelectionMask)

    useWorkspace.getState().redo()
    expect(document).toMatchObject({ width: 2, height: 1 })
    expect(layer.pixels).toBe(afterLayerPixels)
    expect(firstCel.surface!.pixels).toBe(afterFirstPixels)
    expect(secondCel.surface!.pixels).toBe(afterSecondPixels)
    expect(useWorkspace.getState().sessions[0].selection!.mask).toBe(afterSelectionMask)
  })
})
