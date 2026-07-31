import type { RasterLayer, RgbaColor, SelectionMask, SpriteDocument } from '@shared/types'
import { getPaletteEntry, readLayerColor, writeLayerColor } from './document'
import { beginPixelEdit, recordPixel, type PixelEdit } from './history'
import { packColor, unpackColor } from './raster'
import { selectionContains } from './selection'

export type AdjustmentKind = 'color-balance' | 'brightness-contrast' | 'hue-saturation' | 'curves'
export interface CurvePoint { x: number; y: number }

export interface ColorAdjustment {
  kind: AdjustmentKind
  shadows?: number
  midtones?: number
  highlights?: number
  brightness?: number
  contrast?: number
  hue?: number
  saturation?: number
  /** Curve's midpoint, 0-255. 128 is the identity. */
  curveMidpoint?: number
  curvePoints?: CurvePoint[]
  shadowsCyanRed?: number
  shadowsMagentaGreen?: number
  shadowsYellowBlue?: number
  midtonesCyanRed?: number
  midtonesMagentaGreen?: number
  midtonesYellowBlue?: number
  highlightsCyanRed?: number
  highlightsMagentaGreen?: number
  highlightsYellowBlue?: number
  preserveLuminosity?: boolean
}

const clamp = (value: number): number => Math.max(0, Math.min(255, Math.round(value)))

export function buildCurveLut(points: CurvePoint[]): Uint8Array {
  const normalized = points
    .map((point) => ({ x: clamp(point.x), y: clamp(point.y) }))
    .sort((left, right) => left.x - right.x)
    .filter((point, index, entries) => index === entries.length - 1 || point.x !== entries[index + 1].x)
  if (normalized.length === 0 || normalized[0].x !== 0) normalized.unshift({ x: 0, y: normalized[0]?.y ?? 0 })
  if (normalized[normalized.length - 1].x !== 255) normalized.push({ x: 255, y: normalized[normalized.length - 1]?.y ?? 255 })
  const lut = new Uint8Array(256)
  let segment = 0
  for (let input = 0; input < 256; input += 1) {
    while (segment < normalized.length - 2 && input > normalized[segment + 1].x) segment += 1
    const left = normalized[segment]
    const right = normalized[Math.min(segment + 1, normalized.length - 1)]
    const distance = Math.max(1, right.x - left.x)
    lut[input] = clamp(left.y + (right.y - left.y) * (input - left.x) / distance)
  }
  return lut
}

const rgbToHsl = (color: RgbaColor): { h: number; s: number; l: number } => {
  const r = color.r / 255; const g = color.g / 255; const b = color.b / 255
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const delta = max - min; const l = (max + min) / 2
  if (delta === 0) return { h: 0, s: 0, l }
  const s = delta / (1 - Math.abs(2 * l - 1))
  const h = ((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60 + 360) % 360
  return { h, s, l }
}

const hslToRgb = (hue: number, saturation: number, lightness: number, alpha: number): RgbaColor => {
  const h = ((hue % 360) + 360) % 360 / 360; const s = Math.max(0, Math.min(1, saturation)); const l = Math.max(0, Math.min(1, lightness))
  if (s === 0) { const c = clamp(l * 255); return { r: c, g: c, b: c, a: alpha } }
  const q = l < .5 ? l * (1 + s) : l + s - l * s; const p = 2 * l - q
  const component = (shift: number): number => { let t = (h + shift) % 1; if (t < 0) t += 1; return clamp((p + (q - p) * (t < 1 / 6 ? 6 * t : t < .5 ? 1 : t < 2 / 3 ? (2 / 3 - t) * 6 : 0)) * 255) }
  return { r: component(1 / 3), g: component(0), b: component(-1 / 3), a: alpha }
}

export function adjustColor(color: RgbaColor, adjustment: ColorAdjustment, preparedCurve?: Uint8Array): RgbaColor {
  if (color.a === 0) return color
  if (adjustment.kind === 'brightness-contrast') {
    const brightness = (adjustment.brightness ?? 0) * 2.55
    const contrast = (adjustment.contrast ?? 0) / 100
    const transform = (value: number): number => clamp((value - 128) * (1 + contrast) + 128 + brightness)
    return { r: transform(color.r), g: transform(color.g), b: transform(color.b), a: color.a }
  }
  if (adjustment.kind === 'hue-saturation') {
    const hsl = rgbToHsl(color)
    return hslToRgb(hsl.h + (adjustment.hue ?? 0), hsl.s * (1 + (adjustment.saturation ?? 0) / 100), hsl.l, color.a)
  }
  if (adjustment.kind === 'color-balance') {
    const luminance = (color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722) / 255
    const shadowsWeight = Math.max(0, Math.min(1, (0.5 - luminance) * 2))
    const highlightsWeight = Math.max(0, Math.min(1, (luminance - 0.5) * 2))
    const midtonesWeight = 1 - shadowsWeight - highlightsWeight
    const weighted = (legacy: number | undefined, shadow: number | undefined, middle: number | undefined, highlight: number | undefined): number =>
      (shadow ?? legacy ?? 0) * shadowsWeight + (middle ?? legacy ?? 0) * midtonesWeight + (highlight ?? legacy ?? 0) * highlightsWeight
    const cyanRed = weighted(adjustment.midtones, adjustment.shadowsCyanRed ?? adjustment.shadows, adjustment.midtonesCyanRed, adjustment.highlightsCyanRed ?? adjustment.highlights)
    const magentaGreen = weighted(undefined, adjustment.shadowsMagentaGreen, adjustment.midtonesMagentaGreen, adjustment.highlightsMagentaGreen)
    const yellowBlue = weighted(undefined, adjustment.shadowsYellowBlue, adjustment.midtonesYellowBlue, adjustment.highlightsYellowBlue)
    let red = color.r + cyanRed - magentaGreen * 0.5 - yellowBlue * 0.5
    let green = color.g - cyanRed * 0.5 + magentaGreen - yellowBlue * 0.5
    let blue = color.b - cyanRed * 0.5 - magentaGreen * 0.5 + yellowBlue
    if (adjustment.preserveLuminosity !== false) {
      const nextLuminance = red * 0.2126 + green * 0.7152 + blue * 0.0722
      const correction = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722 - nextLuminance
      red += correction; green += correction; blue += correction
    }
    return { r: clamp(red), g: clamp(green), b: clamp(blue), a: color.a }
  }
  const midpoint = Math.max(1, Math.min(254, adjustment.curveMidpoint ?? 128))
  const curve = preparedCurve ?? buildCurveLut(adjustment.curvePoints ?? [{ x: 0, y: 0 }, { x: 128, y: midpoint }, { x: 255, y: 255 }])
  return { r: curve[color.r], g: curve[color.g], b: curve[color.b], a: color.a }
}

export function applyColorAdjustment(document: SpriteDocument, layer: RasterLayer, adjustment: ColorAdjustment, selection: SelectionMask | null = null): PixelEdit {
  const edit = beginPixelEdit(layer.id)
  const preparedCurve = adjustment.kind === 'curves'
    ? buildCurveLut(adjustment.curvePoints ?? [{ x: 0, y: 0 }, { x: 128, y: adjustment.curveMidpoint ?? 128 }, { x: 255, y: 255 }])
    : undefined
  const total = layer.width * layer.height
  for (let index = 0; index < total; index += 1) {
    if (selection) {
      const x = layer.offsetX + index % layer.width
      const y = layer.offsetY + Math.floor(index / layer.width)
      if (!selectionContains(selection, x, y)) continue
    }
    const current = readLayerColor(document, layer, index)
    const next = adjustColor(current, adjustment, preparedCurve)
    const packed = layer.format === 'rgba' ? packColor(next) : next.a === 0 ? 0 : (() => {
      const existing = document.palette.find((entry) => entry.color.r === next.r && entry.color.g === next.g && entry.color.b === next.b && entry.color.a === next.a)
      if (existing) return existing.id
      const id = document.nextColorId++
      document.palette.push({ id, name: `颜色 ${id}`, color: next })
      return id
    })()
    recordPixel(document, layer, edit, index, packed)
  }
  return edit
}
