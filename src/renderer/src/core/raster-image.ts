import type { SpriteDocument } from '@shared/types'
import { createDocument } from './document'

export const browserRasterImageExtensions = ['jpg', 'jpeg', 'webp', 'bmp', 'gif'] as const

export function documentFromRgbaImage(name: string, width: number, height: number, pixels: Uint8ClampedArray): SpriteDocument {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || pixels.length !== width * height * 4) {
    throw new Error('图像尺寸或像素数据无效。')
  }
  const document = createDocument(name, width, height, 'rgba')
  const layer = document.layers[0]
  if (layer.format !== 'rgba') throw new Error('无法创建 RGBA 图层。')
  layer.pixels.set(pixels)
  return document
}

export async function decodeBrowserRasterImage(input: Uint8Array, name: string, mimeType: string): Promise<SpriteDocument> {
  if (typeof createImageBitmap !== 'function') throw new Error('当前系统不支持读取此图片格式。')
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(new Blob([new Uint8Array(input)], { type: mimeType }))
    if (!bitmap.width || !bitmap.height) throw new Error('图片尺寸无效。')
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('当前系统无法创建图片解码画布。')
    context.drawImage(bitmap, 0, 0)
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height)
    return documentFromRgbaImage(name, bitmap.width, bitmap.height, image.data)
  } catch (error) {
    if (error instanceof Error && /尺寸|系统/.test(error.message)) throw error
    throw new Error('无法读取图片文件。')
  } finally {
    bitmap?.close()
  }
}
