import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRasterImagePreview, documentFromRgbaImage, rasterImageMimeType } from './raster-image'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('raster image import', () => {
  it('creates an RGBA document without changing imported pixels', () => {
    const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 128, 255, 64])
    const document = documentFromRgbaImage('photo.webp', 2, 1, pixels)
    const layer = document.layers[0]
    expect(document.width).toBe(2)
    expect(document.height).toBe(1)
    expect(document.colorMode).toBe('rgba')
    expect(layer.format).toBe('rgba')
    if (layer.format === 'rgba') expect(layer.pixels).toEqual(pixels)
    expect(document.palette.map((entry) => entry.color)).toEqual([
      { r: 255, g: 0, b: 0, a: 255 },
      { r: 0, g: 128, b: 255, a: 64 }
    ])
  })

  it('rejects mismatched pixel data', () => {
    expect(() => documentFromRgbaImage('broken.jpg', 2, 2, new Uint8ClampedArray(4))).toThrow('图像尺寸或像素数据无效。')
  })

  it('recognizes every homepage raster thumbnail format', () => {
    expect(rasterImageMimeType('sprite.png')).toBe('image/png')
    expect(rasterImageMimeType('sprite.JPEG')).toBe('image/jpeg')
    expect(rasterImageMimeType('sprite.webp')).toBe('image/webp')
    expect(rasterImageMimeType('sprite.bmp')).toBe('image/bmp')
    expect(rasterImageMimeType('sprite.gif')).toBe('image/gif')
    expect(rasterImageMimeType('sprite.aseprite')).toBeNull()
  })

  it('creates a bounded hard-edged thumbnail without copying full-size pixels into a document', async () => {
    const drawImage = vi.fn()
    const createdCanvases: TestOffscreenCanvas[] = []
    class TestOffscreenCanvas {
      context = { imageSmoothingEnabled: false, imageSmoothingQuality: 'low' as ImageSmoothingQuality, drawImage }
      constructor(public width: number, public height: number) {
        createdCanvases.push(this)
      }
      getContext() { return this.context }
      async convertToBlob() { return new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }) }
    }
    const close = vi.fn()
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4000, height: 2000, close })))

    const preview = await createRasterImagePreview(new Uint8Array([1, 2, 3]), 'image/png')

    expect(preview.width).toBe(4000)
    expect(preview.height).toBe(2000)
    expect(preview.preview).toEqual(new Uint8Array([137, 80, 78, 71]))
    const createdCanvas = createdCanvases[0]
    expect(createdCanvas).toMatchObject({ width: 512, height: 256 })
    expect(createdCanvas.context.imageSmoothingEnabled).toBe(false)
    expect(createdCanvas.context.imageSmoothingQuality).toBe('low')
    expect(drawImage).toHaveBeenCalledWith(expect.objectContaining({ width: 4000, height: 2000 }), 0, 0, 512, 256)
    expect(close).toHaveBeenCalled()
  })
})
