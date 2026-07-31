import { describe, expect, it } from 'vitest'
import type { BlendMode } from '@shared/types'
import { applyRelativeLuminance, blendOver, blendWithMode, hexToColor, packColor, relativeLuminanceColor, unpackColor } from './raster'

describe('raster colors', () => {
  it('packs and unpacks RGBA without loss', () => {
    const color = { r: 18, g: 52, b: 86, a: 120 }
    expect(unpackColor(packColor(color))).toEqual(color)
  })

  it('parses a CSS hex value', () => {
    expect(hexToColor('#2979FF')).toEqual({ r: 41, g: 121, b: 255, a: 255 })
  })

  it('composites alpha using normal source-over', () => {
    expect(blendOver({ r: 0, g: 0, b: 255, a: 255 }, { r: 255, g: 0, b: 0, a: 128 })).toEqual({ r: 128, g: 0, b: 127, a: 255 })
  })

  it('supports multiply layer blending', () => {
    expect(blendWithMode({ r: 100, g: 150, b: 200, a: 255 }, { r: 200, g: 100, b: 50, a: 255 }, 1, 'multiply')).toEqual({ r: 78, g: 59, b: 39, a: 255 })
  })

  it('supports the complete layer blend-mode set without invalid channels', () => {
    const modes: BlendMode[] = [
      'normal', 'darken', 'multiply', 'color-burn', 'linear-burn', 'lighten', 'screen', 'color-dodge', 'linear-dodge',
      'overlay', 'soft-light', 'hard-light', 'vivid-light', 'linear-light', 'pin-light', 'hard-mix', 'difference',
      'exclusion', 'subtract', 'divide', 'hue', 'saturation', 'color', 'luminosity'
    ]
    for (const mode of modes) {
      const result = blendWithMode({ r: 45, g: 130, b: 220, a: 210 }, { r: 230, g: 70, b: 115, a: 190 }, 0.73, mode)
      expect(Object.values(result).every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255), mode).toBe(true)
    }
  })

  it('matches representative darken, lighten and contrast formulas', () => {
    const bottom = { r: 64, g: 128, b: 192, a: 255 }
    const top = { r: 192, g: 64, b: 128, a: 255 }
    expect(blendWithMode(bottom, top, 1, 'darken')).toEqual({ r: 64, g: 64, b: 128, a: 255 })
    expect(blendWithMode(bottom, top, 1, 'lighten')).toEqual({ r: 192, g: 128, b: 192, a: 255 })
    expect(blendWithMode(bottom, top, 1, 'difference')).toEqual({ r: 128, g: 64, b: 64, a: 255 })
    expect(blendWithMode(bottom, top, 1, 'linear-dodge')).toEqual({ r: 255, g: 192, b: 255, a: 255 })
  })

  it('converts colors to linear-light perceptual grayscale and preserves alpha', () => {
    const red = relativeLuminanceColor({ r: 255, g: 0, b: 0, a: 77 })
    const green = relativeLuminanceColor({ r: 0, g: 255, b: 0, a: 77 })
    const blue = relativeLuminanceColor({ r: 0, g: 0, b: 255, a: 77 })
    expect(green.r).toBeGreaterThan(red.r)
    expect(red.r).toBeGreaterThan(blue.r)
    expect(red).toMatchObject({ g: red.r, b: red.r, a: 77 })
    const pixels = applyRelativeLuminance(new Uint8ClampedArray([255, 0, 0, 77, 0, 255, 0, 99]))
    expect(pixels[0]).toBe(pixels[1])
    expect(pixels[1]).toBe(pixels[2])
    expect(pixels[3]).toBe(77)
    expect(pixels[7]).toBe(99)
  })
})
