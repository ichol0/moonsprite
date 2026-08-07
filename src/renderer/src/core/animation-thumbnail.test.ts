import { describe, expect, it } from 'vitest'
import { animationCelContentBounds, animationCelThumbnailLayout, pixelPerfectThumbnailScale, renderAnimationCelThumbnailPixels } from './animation-thumbnail'

describe('animation cel thumbnail layout', () => {
  it('quantizes thumbnail scale without changing pixel aspect ratio', () => {
    expect(pixelPerfectThumbnailScale(5.2)).toBe(5)
    expect(pixelPerfectThumbnailScale(0.64)).toBe(0.5)
  })
  it('fits the complete non-square canvas into a square thumbnail', () => {
    const layout = animationCelThumbnailLayout(64, 32, 32, {
      format: 'rgba', width: 8, height: 8, offsetX: 48, offsetY: 20, pixels: new Uint8ClampedArray(8 * 8 * 4)
    })

    expect(layout.canvas).toEqual({ x: 0, y: 8, width: 32, height: 16 })
    expect(layout.surface).toEqual({ x: 24, y: 18, width: 4, height: 4 })
  })

  it('keeps canvas-exterior cel pixels outside the thumbnail viewport', () => {
    const layout = animationCelThumbnailLayout(16, 16, 32, {
      format: 'rgba', width: 8, height: 8, offsetX: 16, offsetY: 0, pixels: new Uint8ClampedArray(8 * 8 * 4)
    })

    expect(layout.canvas).toEqual({ x: 0, y: 0, width: 32, height: 32 })
    expect(layout.surface.x).toBe(32)
  })

  it('finds visible RGBA pixels and enlarges their bounds around the thumbnail center', () => {
    const pixels = new Uint8ClampedArray(100 * 100 * 4)
    for (let y = 20; y < 30; y += 1) for (let x = 40; x < 50; x += 1) pixels[(y * 100 + x) * 4 + 3] = 255
    const surface = { format: 'rgba' as const, width: 100, height: 100, offsetX: 0, offsetY: 0, pixels }
    const bounds = animationCelContentBounds(surface)
    const layout = animationCelThumbnailLayout(100, 100, 64, surface, bounds)

    expect(bounds).toEqual({ x: 40, y: 20, width: 10, height: 10 })
    expect(layout.content.width).toBe(50)
    expect(layout.content.height).toBe(50)
    expect(layout.content.x + layout.content.width / 2).toBe(32)
    expect(layout.content.y + layout.content.height / 2).toBe(32)
  })

  it('treats transparent indexed palette entries as empty', () => {
    const surface = { format: 'indexed' as const, width: 3, height: 2, offsetX: 0, offsetY: 0, pixels: new Uint32Array([1, 1, 1, 1, 2, 1]) }
    const bounds = animationCelContentBounds(surface, [
      { id: 1, name: 'transparent', color: { r: 0, g: 0, b: 0, a: 0 } },
      { id: 2, name: 'visible', color: { r: 10, g: 20, b: 30, a: 255 } }
    ])

    expect(bounds).toEqual({ x: 1, y: 1, width: 1, height: 1 })
  })

  it('renders visible pixels at enlarged density without an intermediate source canvas', () => {
    const pixels = new Uint8ClampedArray(64 * 64 * 4)
    const sourceIndex = (32 * 64 + 32) * 4
    pixels[sourceIndex] = 41
    pixels[sourceIndex + 1] = 121
    pixels[sourceIndex + 2] = 255
    pixels[sourceIndex + 3] = 255

    const thumbnail = renderAnimationCelThumbnailPixels(64, 64, 120, {
      format: 'rgba', width: 64, height: 64, offsetX: 0, offsetY: 0, pixels
    })

    let bluePixels = 0
    for (let index = 0; index < thumbnail.length; index += 4) {
      if (thumbnail[index] === 41 && thumbnail[index + 1] === 121 && thumbnail[index + 2] === 255 && thumbnail[index + 3] === 255) bluePixels += 1
    }
    expect(bluePixels).toBeGreaterThan(0)
  })

  it('keeps a sparse cel visible when its source surface is much larger than the thumbnail', () => {
    const pixels = new Uint8ClampedArray(1024 * 1024 * 4)
    const sourceIndex = (512 * 1024 + 512) * 4
    pixels[sourceIndex] = 220
    pixels[sourceIndex + 1] = 40
    pixels[sourceIndex + 2] = 80
    pixels[sourceIndex + 3] = 255

    const thumbnail = renderAnimationCelThumbnailPixels(1024, 1024, 128, {
      format: 'rgba', width: 1024, height: 1024, offsetX: 0, offsetY: 0, pixels
    })

    expect(Array.from(thumbnail)).toContain(220)
    expect(Array.from(thumbnail)).toContain(40)
    expect(Array.from(thumbnail)).toContain(80)
  })
})
