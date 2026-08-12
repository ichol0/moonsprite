import type { SpriteDocument } from '@shared/types'
import { createDocument } from './document'
import { applyImportedRgbaPalette } from './imported-palette'
import { translateCurrent as tr } from './localization'

export const browserRasterImageExtensions = ['jpg', 'jpeg', 'webp', 'bmp', 'gif'] as const

export function documentFromRgbaImage(name: string, width: number, height: number, pixels: Uint8ClampedArray): SpriteDocument {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || pixels.length !== width * height * 4) {
    throw new Error(tr('core.raster.invalidData'))
  }
  const document = createDocument(name, width, height, 'rgba')
  const layer = document.layers[0]
  if (layer.format !== 'rgba') throw new Error(tr('core.raster.createRgba'))
  layer.pixels.set(pixels)
  applyImportedRgbaPalette(document)
  return document
}

export async function decodeBrowserRasterImage(input: Uint8Array, name: string, mimeType: string): Promise<SpriteDocument> {
  if (typeof createImageBitmap !== 'function') throw new Error(tr('core.raster.unsupportedFormat'))
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(new Blob([new Uint8Array(input)], { type: mimeType }))
  } catch {
    throw new Error(tr('core.raster.readFailed'))
  }
  try {
    if (!bitmap.width || !bitmap.height) throw new Error(tr('core.raster.invalidImageSize'))
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error(tr('core.raster.decoderCanvas'))
    context.drawImage(bitmap, 0, 0)
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height)
    return documentFromRgbaImage(name, bitmap.width, bitmap.height, image.data)
  } finally {
    bitmap?.close()
  }
}
