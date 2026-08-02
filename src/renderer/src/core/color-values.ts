import type { RgbaColor } from '@shared/types'
import { clampByte, hsvToRgb, rgbToHsv } from './raster'

export type ColorValueMode = 'rgb' | 'hsv' | 'hsl' | 'gray'

export interface HslColor {
  h: number
  s: number
  l: number
}

export interface ColorValueField {
  key: 'r' | 'g' | 'b' | 'h' | 's' | 'v' | 'l' | 'gray' | 'a'
  label: string
  min: number
  max: number
  step: number
}

export const colorValueFields = (mode: ColorValueMode): ColorValueField[] => {
  if (mode === 'rgb') return [{ key: 'r', label: 'R', min: 0, max: 255, step: 1 }, { key: 'g', label: 'G', min: 0, max: 255, step: 1 }, { key: 'b', label: 'B', min: 0, max: 255, step: 1 }, { key: 'a', label: 'A', min: 0, max: 255, step: 1 }]
  if (mode === 'hsv') return [{ key: 'h', label: 'H', min: 0, max: 360, step: 1 }, { key: 's', label: 'S', min: 0, max: 100, step: 1 }, { key: 'v', label: 'V', min: 0, max: 100, step: 1 }, { key: 'a', label: 'A', min: 0, max: 255, step: 1 }]
  if (mode === 'hsl') return [{ key: 'h', label: 'H', min: 0, max: 360, step: 1 }, { key: 's', label: 'S', min: 0, max: 100, step: 1 }, { key: 'l', label: 'L', min: 0, max: 100, step: 1 }, { key: 'a', label: 'A', min: 0, max: 255, step: 1 }]
  return [{ key: 'gray', label: 'Gray', min: 0, max: 255, step: 1 }, { key: 'a', label: 'A', min: 0, max: 255, step: 1 }]
}

export const rgbaHex = (color: RgbaColor): string => `#${[color.r, color.g, color.b, color.a].map((channel) => clampByte(channel).toString(16).padStart(2, '0')).join('').toUpperCase()}`

export const parseRgbaHex = (value: string, fallbackAlpha = 255): RgbaColor | null => {
  const match = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value.trim())
  if (!match) return null
  const rgb = Number.parseInt(match[1], 16)
  return { r: rgb >>> 16, g: (rgb >>> 8) & 0xff, b: rgb & 0xff, a: match[2] ? Number.parseInt(match[2], 16) : fallbackAlpha }
}

export const rgbToHsl = (color: RgbaColor): HslColor => {
  const r = color.r / 255
  const g = color.g / 255
  const b = color.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  const l = (max + min) / 2
  if (delta === 0) return { h: 0, s: 0, l }
  const s = delta / (1 - Math.abs(2 * l - 1))
  const h = ((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60 + 360) % 360
  return { h, s, l }
}

export const hslToRgb = (hue: number, saturation: number, lightness: number, alpha = 255): RgbaColor => {
  const h = ((hue % 360) + 360) % 360 / 360
  const s = Math.max(0, Math.min(1, saturation))
  const l = Math.max(0, Math.min(1, lightness))
  if (s === 0) {
    const value = Math.round(l * 255)
    return { r: value, g: value, b: value, a: alpha }
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (position: number): number => {
    let x = (h + position) % 1
    if (x < 0) x += 1
    return x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p
  }
  return { r: Math.round(channel(1 / 3) * 255), g: Math.round(channel(0) * 255), b: Math.round(channel(-1 / 3) * 255), a: alpha }
}

export const colorToValues = (color: RgbaColor, mode: ColorValueMode): Record<string, number> => {
  if (mode === 'rgb') return { r: color.r, g: color.g, b: color.b, a: color.a }
  if (mode === 'gray') return { gray: Math.round(color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722), a: color.a }
  if (mode === 'hsv') {
    const hsv = rgbToHsv(color)
    return { h: hsv.h, s: hsv.s * 100, v: hsv.v * 100, a: color.a }
  }
  const hsl = rgbToHsl(color)
  return { h: hsl.h, s: hsl.s * 100, l: hsl.l * 100, a: color.a }
}

export const colorFromValues = (mode: ColorValueMode, values: Record<string, number>, fallback: RgbaColor): RgbaColor => {
  const alpha = clampByte(values.a ?? fallback.a)
  if (mode === 'rgb') return { r: clampByte(values.r), g: clampByte(values.g), b: clampByte(values.b), a: alpha }
  if (mode === 'gray') {
    const gray = clampByte(values.gray)
    return { r: gray, g: gray, b: gray, a: alpha }
  }
  if (mode === 'hsv') return hsvToRgb({ h: values.h ?? 0, s: (values.s ?? 0) / 100, v: (values.v ?? 0) / 100 }, alpha)
  return hslToRgb(values.h ?? 0, (values.s ?? 0) / 100, (values.l ?? 0) / 100, alpha)
}
