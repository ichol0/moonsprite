import type { AnimationTimeline, RgbaColor, SpriteDocument } from '@shared/types'
import { animationLayerAtFrame, ensureAnimationDocument } from './animation'
import { compositeDocument } from './document'

export interface OnionSkinFrameRef { frameId: string; distance: number; side: 'previous' | 'next' }

export const onionSkinFrameRefs = (timeline: AnimationTimeline, previousFrames: number, nextFrames: number): OnionSkinFrameRef[] => {
  const activeIndex = timeline.frames.findIndex((frame) => frame.id === timeline.activeFrameId)
  if (activeIndex < 0) return []
  const result: OnionSkinFrameRef[] = []
  for (let distance = Math.min(8, Math.max(0, Math.round(previousFrames))); distance >= 1; distance -= 1) {
    const frame = timeline.frames[activeIndex - distance]
    if (frame) result.push({ frameId: frame.id, distance, side: 'previous' })
  }
  for (let distance = Math.min(8, Math.max(0, Math.round(nextFrames))); distance >= 1; distance -= 1) {
    const frame = timeline.frames[activeIndex + distance]
    if (frame) result.push({ frameId: frame.id, distance, side: 'next' })
  }
  return result
}

export const compositeAnimationFrame = (document: SpriteDocument, frameId: string): Uint8ClampedArray => {
  ensureAnimationDocument(document)
  const layers = document.layers.map((layer) => animationLayerAtFrame(document, layer.id, frameId) ?? layer)
  return compositeDocument({ ...document, layers })
}

export const tintOnionSkinPixels = (source: Uint8ClampedArray, tint: RgbaColor, opacityPercent: number, distance: number): Uint8ClampedArray => {
  const output = new Uint8ClampedArray(source.length)
  const opacity = Math.max(0, Math.min(1, opacityPercent / 100)) / Math.max(1, distance)
  for (let offset = 0; offset < source.length; offset += 4) {
    if (source[offset + 3] === 0) continue
    output[offset] = tint.r
    output[offset + 1] = tint.g
    output[offset + 2] = tint.b
    output[offset + 3] = Math.round(source[offset + 3] * opacity * tint.a / 255)
  }
  return output
}
