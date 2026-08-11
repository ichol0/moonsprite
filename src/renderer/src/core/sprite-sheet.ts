import type { SpriteDocument } from '@shared/types'
import { ensureAnimationDocument } from './animation'
import { createDocument, getActiveLayer } from './document'
import { compositeAnimationFrame } from './onion-skin'

export interface SpriteSheetDocumentNames {
  document: string
  layer: string
}

export function createHorizontalSpriteSheetDocument(
  source: SpriteDocument,
  names: SpriteSheetDocumentNames
): SpriteDocument {
  const frames = ensureAnimationDocument(source).frames
  if (frames.length === 0) throw new Error('Cannot create a sprite sheet without animation frames.')

  const width = source.width * frames.length
  if (!Number.isSafeInteger(width)) throw new Error('Sprite sheet dimensions exceed the supported range.')

  const sheet = createDocument(names.document, width, source.height, 'rgba')
  const layer = getActiveLayer(sheet)
  if (layer.format !== 'rgba') throw new Error('Sprite sheet layer must use RGBA pixels.')
  layer.name = names.layer

  const sourceRowBytes = source.width * 4
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const framePixels = compositeAnimationFrame(source, frames[frameIndex].id)
    for (let y = 0; y < source.height; y += 1) {
      const sourceOffset = y * sourceRowBytes
      const targetOffset = (y * width + frameIndex * source.width) * 4
      layer.pixels.set(framePixels.subarray(sourceOffset, sourceOffset + sourceRowBytes), targetOffset)
    }
  }

  return sheet
}
