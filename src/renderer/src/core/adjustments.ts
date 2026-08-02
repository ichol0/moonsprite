import type { RasterLayer, RgbaColor, SelectionMask, SpriteDocument } from '@shared/types'
import { getPaletteEntry, readLayerColor, writeLayerColor } from './document'
import { beginPixelEdit, recordPixel, type PixelEdit } from './history'
import { packColor, unpackColor } from './raster'
import { selectionContains } from './selection'

export type AdjustmentKind = 'color-balance' | 'brightness-contrast' | 'hue-saturation' | 'curves'
export type CurveChannel = 'rgb' | 'red' | 'green' | 'blue'
export interface CurvePoint { x: number; y: number }

export interface CurveHistogram {
  rgb: Uint32Array
  red: Uint32Array
  green: Uint32Array
  blue: Uint32Array
}

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
  curveRedPoints?: CurvePoint[]
  curveGreenPoints?: CurvePoint[]
  curveBluePoints?: CurvePoint[]
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

const identityCurve: CurvePoint[] = [{ x: 0, y: 0 }, { x: 255, y: 255 }]

export function buildCurveHistogram(pixels: Uint8ClampedArray | Uint32Array, format: 'rgba' | 'indexed', palette: Array<{ id: number; color: RgbaColor }>): CurveHistogram {
  const histogram: CurveHistogram = { rgb: new Uint32Array(256), red: new Uint32Array(256), green: new Uint32Array(256), blue: new Uint32Array(256) }
  const paletteMap = format === 'indexed' ? new Map(palette.map((entry) => [entry.id, entry.color])) : null
  const add = (color: RgbaColor): void => {
    if (color.a === 0) return
    histogram.rgb[Math.round((color.r + color.g + color.b) / 3)] += 1
    histogram.red[color.r] += 1
    histogram.green[color.g] += 1
    histogram.blue[color.b] += 1
  }
  if (format === 'rgba') {
    for (let index = 0; index < pixels.length; index += 4) add({ r: pixels[index], g: pixels[index + 1], b: pixels[index + 2], a: pixels[index + 3] })
  } else {
    for (const value of pixels) {
      const color = paletteMap?.get(value)
      if (color) add(color)
    }
  }
  return histogram
}

export function buildHistogramPath(values: Uint32Array, width = 255, height = 255): string {
  const maximum = Math.max(1, ...values)
  const commands = [`M 0 ${height}`]
  for (let index = 0; index < values.length; index += 1) {
    const x = index / Math.max(1, values.length - 1) * width
    const y = height - values[index] / maximum * (height - 4)
    commands.push(`L ${x.toFixed(2)} ${y.toFixed(2)}`)
  }
  commands.push(`L ${width} ${height} Z`)
  return commands.join(' ')
}

const curveControls = (points: CurvePoint[], index: number, axis: 'x' | 'y'): number => {
  const current = points[index]
  const previous = points[Math.max(0, index - 1)]
  const next = points[Math.min(points.length - 1, index + 1)]
  return (next[axis] - previous[axis]) / Math.max(1, next.x - previous.x)
}

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
    const t = Math.max(0, Math.min(1, (input - left.x) / distance))
    const leftSlope = curveControls(normalized, segment, 'y')
    const rightSlope = curveControls(normalized, Math.min(segment + 1, normalized.length - 1), 'y')
    const controlLeft = left.y + leftSlope * distance / 3
    const controlRight = right.y - rightSlope * distance / 3
    const inverse = 1 - t
    lut[input] = clamp(inverse ** 3 * left.y + 3 * inverse ** 2 * t * controlLeft + 3 * inverse * t ** 2 * controlRight + t ** 3 * right.y)
  }
  return lut
}

export function buildCurvePath(points: CurvePoint[]): string {
  const normalized = points
    .map((point) => ({ x: clamp(point.x), y: clamp(point.y) }))
    .sort((left, right) => left.x - right.x)
  if (normalized.length < 2) return ''
  const commands = [`M ${normalized[0].x} ${255 - normalized[0].y}`]
  for (let index = 0; index < normalized.length - 1; index += 1) {
    const left = normalized[index]
    const right = normalized[index + 1]
    const distance = Math.max(1, right.x - left.x)
    const leftControlY = left.y + curveControls(normalized, index, 'y') * distance / 3
    const rightControlY = right.y - curveControls(normalized, index + 1, 'y') * distance / 3
    commands.push(`C ${left.x + distance / 3} ${255 - leftControlY} ${right.x - distance / 3} ${255 - rightControlY} ${right.x} ${255 - right.y}`)
  }
  return commands.join(' ')
}

export interface PreparedCurveLuts {
  rgb: Uint8Array
  red: Uint8Array
  green: Uint8Array
  blue: Uint8Array
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

export function adjustColor(color: RgbaColor, adjustment: ColorAdjustment, preparedCurve?: Uint8Array | PreparedCurveLuts): RgbaColor {
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
  const curves: PreparedCurveLuts = preparedCurve && !(preparedCurve instanceof Uint8Array)
    ? preparedCurve
    : {
        rgb: preparedCurve instanceof Uint8Array ? preparedCurve : buildCurveLut(adjustment.curvePoints ?? [{ x: 0, y: 0 }, { x: 128, y: midpoint }, { x: 255, y: 255 }]),
        red: buildCurveLut(adjustment.curveRedPoints ?? identityCurve),
        green: buildCurveLut(adjustment.curveGreenPoints ?? identityCurve),
        blue: buildCurveLut(adjustment.curveBluePoints ?? identityCurve)
      }
  const rgb = curves.rgb
  return { r: curves.red[rgb[color.r]], g: curves.green[rgb[color.g]], b: curves.blue[rgb[color.b]], a: color.a }
}

export function applyColorAdjustment(document: SpriteDocument, layer: RasterLayer, adjustment: ColorAdjustment, selection: SelectionMask | null = null): PixelEdit {
  const edit = beginPixelEdit(layer.id)
  const preparedCurve = adjustment.kind === 'curves'
    ? {
        rgb: buildCurveLut(adjustment.curvePoints ?? [{ x: 0, y: 0 }, { x: 128, y: adjustment.curveMidpoint ?? 128 }, { x: 255, y: 255 }]),
        red: buildCurveLut(adjustment.curveRedPoints ?? identityCurve),
        green: buildCurveLut(adjustment.curveGreenPoints ?? identityCurve),
        blue: buildCurveLut(adjustment.curveBluePoints ?? identityCurve)
      }
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
