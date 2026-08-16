import { describe, expect, it } from 'vitest'
import { createDocument, writeLayerColor } from './document'
import { detectDocumentPixelScale, detectRepeatedPixelScale } from './image-scale-detection'

const enlarge = (source: readonly number[], sourceWidth: number, sourceHeight: number, scale: number): Uint8ClampedArray => {
  const width = sourceWidth * scale
  const height = sourceHeight * scale
  const output = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const sourceIndex = (Math.floor(y / scale) * sourceWidth + Math.floor(x / scale)) * 4
    const targetIndex = (y * width + x) * 4
    output.set(source.slice(sourceIndex, sourceIndex + 4), targetIndex)
  }
  return output
}

describe('image scale detection', () => {
  it('detects repeated 2x pixel blocks', () => {
    const source = [
      255, 0, 0, 255, 0, 255, 0, 255,
      0, 0, 255, 255, 255, 255, 0, 255
    ]
    expect(detectRepeatedPixelScale(enlarge(source, 2, 2, 2), 4, 4)).toBe(2)
  })

  it('detects repeated 10x pixel blocks', () => {
    const source = [
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
      255, 255, 0, 255, 255, 0, 255, 255, 0, 255, 255, 255
    ]
    expect(detectRepeatedPixelScale(enlarge(source, 3, 2, 10), 30, 20)).toBe(10)
  })

  it('detects the dominant scale when a few pixels do not follow the block grid', () => {
    const source = [
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255,
      0, 255, 255, 255, 255, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255,
      255, 128, 0, 255, 128, 0, 255, 255, 128, 128, 128, 255, 255, 255, 255, 255,
      0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 255, 0, 255
    ]
    const enlarged = enlarge(source, 4, 4, 3)
    enlarged.set([17, 31, 47, 255], (5 * 12 + 5) * 4)

    expect(detectRepeatedPixelScale(enlarged, 12, 12)).toBe(3)
  })

  it('detects a cropped 4x grid when the image dimensions are not divisible by four', () => {
    const source = [
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
      255, 255, 0, 255, 255, 0, 255, 255, 0, 255, 255, 255
    ]
    const enlarged = enlarge(source, 3, 2, 4)
    const croppedWidth = 10
    const cropped = new Uint8ClampedArray(croppedWidth * 8 * 4)
    for (let y = 0; y < 8; y += 1) {
      const sourceOffset = (y * 12 + 1) * 4
      cropped.set(enlarged.subarray(sourceOffset, sourceOffset + croppedWidth * 4), y * croppedWidth * 4)
    }

    expect(detectRepeatedPixelScale(cropped, croppedWidth, 8)).toBe(4)
  })

  it('detects a shared local scale when separate sprites use different grid phases', () => {
    const width = 31
    const height = 19
    const pixels = new Uint8ClampedArray(width * height * 4)
    for (let index = 0; index < width * height; index += 1) pixels.set([128, 128, 128, 255], index * 4)
    const source = [
      255, 0, 0, 255, 0, 255, 0, 255,
      0, 0, 255, 255, 255, 255, 0, 255
    ]
    const sprite = enlarge(source, 2, 2, 4)
    const paste = (offsetX: number, offsetY: number): void => {
      for (let y = 0; y < 8; y += 1) {
        const sourceOffset = y * 8 * 4
        const targetOffset = ((offsetY + y) * width + offsetX) * 4
        pixels.set(sprite.subarray(sourceOffset, sourceOffset + 8 * 4), targetOffset)
      }
    }
    paste(1, 1)
    paste(18, 10)

    expect(detectRepeatedPixelScale(pixels, width, height)).toBe(4)
  })

  it('rejects solid and noisy images without an inferable integer scale', () => {
    const solid = new Uint8ClampedArray(8 * 8 * 4)
    solid.fill(255)
    expect(detectRepeatedPixelScale(solid, 8, 8)).toBeNull()

    const noisy = new Uint8ClampedArray(4 * 4 * 4)
    for (let index = 0; index < 16; index += 1) noisy.set([index, 255 - index, index * 3, 255], index * 4)
    expect(detectRepeatedPixelScale(noisy, 4, 4)).toBeNull()
  })

  it('ignores hidden RGB values in fully transparent pixels', () => {
    const pixels = new Uint8ClampedArray(4 * 2 * 4)
    for (let index = 0; index < 8; index += 1) pixels.set([index * 17, 255 - index, index, 0], index * 4)
    expect(detectRepeatedPixelScale(pixels, 4, 2)).toBeNull()
  })

  it('detects scale from the final document composite', () => {
    const document = createDocument('scaled composite', 4, 4, 'rgba')
    const layer = document.layers[0]
    const colors = [
      { r: 255, g: 0, b: 0, a: 255 },
      { r: 0, g: 255, b: 0, a: 255 },
      { r: 0, g: 0, b: 255, a: 255 },
      { r: 255, g: 255, b: 0, a: 255 }
    ]
    for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) {
      writeLayerColor(document, layer, y * 4 + x, colors[Math.floor(y / 2) * 2 + Math.floor(x / 2)]!)
    }

    expect(detectDocumentPixelScale(document)).toBe(2)
  })
})
