import { describe, expect, it } from 'vitest'
import { colorFromValues, colorToValues, hslToRgb, parseRgbaHex, rgbToHsl, rgbaHex } from './color-values'

describe('color value models', () => {
  it('round-trips RGB, HSV and HSL values', () => {
    const color = { r: 41, g: 121, b: 255, a: 128 }
    expect(colorFromValues('rgb', colorToValues(color, 'rgb'), color)).toEqual(color)
    expect(colorFromValues('hsv', colorToValues(color, 'hsv'), color)).toEqual(color)
    expect(colorFromValues('hsl', colorToValues(color, 'hsl'), color)).toEqual(color)
  })

  it('supports grayscale and alpha values', () => {
    expect(colorFromValues('gray', { gray: 88, a: 64 }, { r: 0, g: 0, b: 0, a: 255 })).toEqual({ r: 88, g: 88, b: 88, a: 64 })
  })

  it('formats and parses six/eight digit HEX values', () => {
    expect(rgbaHex({ r: 41, g: 121, b: 255, a: 128 })).toBe('#2979FF80')
    expect(parseRgbaHex('#2979FF', 128)).toEqual({ r: 41, g: 121, b: 255, a: 128 })
    expect(parseRgbaHex('#2979FF80')).toEqual({ r: 41, g: 121, b: 255, a: 128 })
  })

  it('keeps neutral HSL colors at zero saturation', () => {
    expect(rgbToHsl({ r: 128, g: 128, b: 128, a: 255 })).toEqual({ h: 0, s: 0, l: expect.closeTo(128 / 255, 8) })
    expect(hslToRgb(240, 0, 0.5)).toMatchObject({ r: 128, g: 128, b: 128 })
  })
})
