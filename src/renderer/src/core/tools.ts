import type { BrushPaintMode, BrushShape, BrushTexture, GradientDither, ImageBrush, ImageBrushSettings, OutlineDirection, OutlineDirections, OutlineKernel, OutlinePosition, RasterLayer, RgbaColor, SelectionMask, SelectionRect, ShapeKind, SpriteDocument } from '@shared/types'
import { compositeRegion, ensureLayerCoversCanvas, expandLayerToRect, findOrAddPaletteColor, getActiveLayer, getLayer, getLayerStorageOrigin, getPaletteEntry, isLayerEffectivelyLocked, layerIndexAt, layerIndexAtStoragePoint, markLayerContentChanged, readLayerColor, readLayerColorAt, readLayerPacked, readLayerPackedAt, writeLayerPacked, writeLayerPackedRun } from './document'
import { beginPixelEdit, preparePixelEdit, recordPixel, recordPixelKnownCurrent, type PixelEdit } from './history'
import { blendOver, isInBounds, packColor, pixelIndex, unpackColor } from './raster'
import { flipSelectionMask, lassoSelection, packedColorMatchesTolerance, rasterLinePoints, rotatedEllipseSelection, rotatedRectSelection, selectionContains, transformedSelectionBounds, transformedSelectionDestinationPoint, transformedSelectionSourcePoint, type SelectionFlipAxis, type SelectionShearTransform } from './selection'
import { proceduralBrushCoverageAt } from './brushes'
import { balancedStairLinePoints } from './pixel-line'
import { hasSymmetry, symmetryPoints, type SymmetryAxes, type SymmetryCenter } from './symmetry'
import { gradientColorForAmount, interpolateRgbaColor } from './gradient'

const paintLayerValue = (document: SpriteDocument, layer: RasterLayer, edit: PixelEdit, index: number, color: RgbaColor): number => {
  if (color.a === 0) return layer.format === 'rgba' ? packColor(color) : 0
  if (color.a === 255) return layer.format === 'rgba' ? packColor(color) : findOrAddPaletteColor(document, color)
  const original = edit.before.get(index)
  const base = original === undefined
    ? readLayerColor(document, layer, index)
    : layer.format === 'rgba'
      ? unpackColor(original)
      : getPaletteEntry(document, original).color
  const blended = blendOver(base, color)
  return layer.format === 'rgba' ? packColor(blended) : findOrAddPaletteColor(document, blended)
}

const layerColorBeforeEdit = (document: SpriteDocument, layer: RasterLayer, edit: PixelEdit, index: number): RgbaColor => {
  const original = edit.before.get(index)
  if (original === undefined) return readLayerColor(document, layer, index)
  return layer.format === 'rgba' ? unpackColor(original) : getPaletteEntry(document, original).color
}

interface BrushCoverageChunks {
  chunks: Map<number, Uint16Array>
}

interface BrushStampState {
  key: string
  stampX: number
  stampY: number
  width: number
  height: number
  occupied: Uint8Array
}

const BRUSH_COVERAGE_CHUNK_BITS = 12
const BRUSH_COVERAGE_CHUNK_SIZE = 1 << BRUSH_COVERAGE_CHUNK_BITS
const BRUSH_COVERAGE_CHUNK_MASK = BRUSH_COVERAGE_CHUNK_SIZE - 1
const brushCoverageByEdit = new WeakMap<PixelEdit, Map<string, BrushCoverageChunks>>()
const lastBrushStampByEdit = new WeakMap<PixelEdit, BrushStampState>()
const EDIT_EXPANSION_PADDING = 64

const remapPixelEditAfterLayerExpansion = (layer: RasterLayer, edit: PixelEdit, oldWidth: number, oldOrigin: { x: number; y: number }): void => {
  const remap = (index: number): number | null => layerIndexAtStoragePoint(layer, index % oldWidth + oldOrigin.x, Math.floor(index / oldWidth) + oldOrigin.y)
  const remapValues = (values: Map<number, number>): void => {
    const entries = [...values]
    values.clear()
    for (const [index, value] of entries) {
      const nextIndex = remap(index)
      if (nextIndex !== null) values.set(nextIndex, value)
    }
  }
  remapValues(edit.before)
  remapValues(edit.after)
  const coverageByKey = brushCoverageByEdit.get(edit)
  if (coverageByKey) for (const coverage of coverageByKey.values()) {
    const remapped = new Map<number, number>()
    for (const [chunkIndex, chunk] of coverage.chunks) for (let offset = 0; offset < chunk.length; offset += 1) {
      const stored = chunk[offset]
      if (stored === 0) continue
      const nextIndex = remap((chunkIndex << BRUSH_COVERAGE_CHUNK_BITS) + offset)
      if (nextIndex !== null) remapped.set(nextIndex, stored)
    }
    coverage.chunks.clear()
    for (const [index, stored] of remapped) {
      const chunkIndex = index >> BRUSH_COVERAGE_CHUNK_BITS
      let chunk = coverage.chunks.get(chunkIndex)
      if (!chunk) { chunk = new Uint16Array(BRUSH_COVERAGE_CHUNK_SIZE); coverage.chunks.set(chunkIndex, chunk) }
      chunk[index & BRUSH_COVERAGE_CHUNK_MASK] = stored
    }
  }
  lastBrushStampByEdit.delete(edit)
}

const ensureLayerCoversEditRect = (document: SpriteDocument, layer: RasterLayer, edit: PixelEdit, rect: SelectionRect, padding = EDIT_EXPANSION_PADDING): boolean => {
  const left = Math.max(0, Math.floor(rect.x) - padding)
  const top = Math.max(0, Math.floor(rect.y) - padding)
  const right = Math.min(document.width, Math.ceil(rect.x + rect.width) + padding)
  const bottom = Math.min(document.height, Math.ceil(rect.y + rect.height) + padding)
  if (right <= left || bottom <= top) return false
  if (left >= layer.offsetX && top >= layer.offsetY && right <= layer.offsetX + layer.width && bottom <= layer.offsetY + layer.height) return true
  if (edit.runs?.length || edit.denseRegion?.count) return false
  const oldWidth = layer.width
  const oldOrigin = getLayerStorageOrigin(layer)
  if (!expandLayerToRect(layer, left, top, right, bottom)) return false
  if (edit.before.size > 0 || edit.after.size > 0 || brushCoverageByEdit.has(edit)) remapPixelEditAfterLayerExpansion(layer, edit, oldWidth, oldOrigin)
  return true
}

const symmetricRect = (document: SpriteDocument, rect: SelectionRect, axes?: SymmetryAxes, center?: SymmetryCenter): SelectionRect => {
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width - 1, y: rect.y },
    { x: rect.x, y: rect.y + rect.height - 1 },
    { x: rect.x + rect.width - 1, y: rect.y + rect.height - 1 }
  ]
  const points = corners.flatMap((point) => symmetryPoints(point, document.width, document.height, axes, center))
  if (points.length === 0) return rect
  const left = Math.min(...points.map((point) => point.x))
  const top = Math.min(...points.map((point) => point.y))
  const right = Math.max(...points.map((point) => point.x)) + 1
  const bottom = Math.max(...points.map((point) => point.y)) + 1
  return { x: left, y: top, width: right - left, height: bottom - top }
}

const claimBrushCoverage = (edit: PixelEdit, key: string, index: number, coverageValue: number, replaceEqual = false): boolean => {
  let coverageByKey = brushCoverageByEdit.get(edit)
  if (!coverageByKey) {
    coverageByKey = new Map()
    brushCoverageByEdit.set(edit, coverageByKey)
  }
  let coverageRecord = coverageByKey.get(key)
  if (!coverageRecord) {
    coverageRecord = { chunks: new Map() }
    coverageByKey.set(key, coverageRecord)
  }
  const chunkIndex = index >> BRUSH_COVERAGE_CHUNK_BITS
  let chunk = coverageRecord.chunks.get(chunkIndex)
  if (!chunk) { chunk = new Uint16Array(BRUSH_COVERAGE_CHUNK_SIZE); coverageRecord.chunks.set(chunkIndex, chunk) }
  const offset = index & BRUSH_COVERAGE_CHUNK_MASK
  const previousCoverage = chunk[offset] - 1
  if (previousCoverage > coverageValue || (!replaceEqual && previousCoverage === coverageValue)) return false
  chunk[offset] = coverageValue + 1
  return true
}

export const normalizeSelection = (startX: number, startY: number, endX: number, endY: number): SelectionRect => ({
  x: Math.min(startX, endX),
  y: Math.min(startY, endY),
  width: Math.abs(endX - startX) + 1,
  height: Math.abs(endY - startY) + 1
})

export const clampSelection = (document: SpriteDocument, selection: SelectionRect): SelectionRect | null => {
  const x = Math.max(0, selection.x)
  const y = Math.max(0, selection.y)
  const right = Math.min(document.width, selection.x + selection.width)
  const bottom = Math.min(document.height, selection.y + selection.height)
  if (right <= x || bottom <= y) return null
  return { x, y, width: right - x, height: bottom - y }
}

export const clampSelectionMask = (document: SpriteDocument, selection: SelectionMask): SelectionMask | null => {
  const bounds = clampSelection(document, selection)
  if (!bounds) return null
  if (!selection.mask) return bounds
  const mask = new Uint8Array(bounds.width * bounds.height)
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      if (selectionContains(selection, x, y)) mask[(y - bounds.y) * bounds.width + x - bounds.x] = 1
    }
  }
  return { ...bounds, mask }
}

export function paintSquare(
  document: SpriteDocument,
  layer: RasterLayer,
  edit: PixelEdit,
  x: number,
  y: number,
  size: number,
  color: RgbaColor,
  selection?: SelectionMask | null
): void {
  const radiusBefore = Math.floor(size / 2)
  const radiusAfter = size - radiusBefore - 1
  if (!ensureLayerCoversEditRect(document, layer, edit, { x: x - radiusBefore, y: y - radiusBefore, width: size, height: size })) return
  for (let py = y - radiusBefore; py <= y + radiusAfter; py += 1) {
    for (let px = x - radiusBefore; px <= x + radiusAfter; px += 1) {
      if (!isInBounds(document.width, document.height, px, py)) continue
      if (selection && !insideSelection(selection, px, py)) continue
      const index = layerIndexAt(layer, px, py)
      if (index === null) continue
      recordPixel(document, layer, edit, index, paintLayerValue(document, layer, edit, index, color))
    }
  }
}

export interface BrushGradientSample {
  startColor: RgbaColor
  endColor: RgbaColor
  gradientAmount: number
  dither: GradientDither
}

export interface BrushLineGradient {
  startColor: RgbaColor
  endColor: RgbaColor
  fromAmount: number
  toAmount: number
  dither: GradientDither
}

const brushGradientCoverageKey = (gradient: BrushGradientSample): string => {
  const start = gradient.startColor
  const end = gradient.endColor
  return `paint:brush-gradient:${start.r},${start.g},${start.b},${start.a}:${end.r},${end.g},${end.b},${end.a}:${gradient.dither}`
}

export function paintBrush(
  document: SpriteDocument,
  layer: RasterLayer,
  edit: PixelEdit,
  x: number,
  y: number,
  size: number,
  color: RgbaColor,
  shape: BrushShape,
  selection?: SelectionMask | null,
  texture: BrushTexture = 'solid',
  textureScale = 1,
  imageBrush: ImageBrush | null = null,
  imageBrushSettings?: ImageBrushSettings,
  proceduralAntialiasStrength = 0,
  brushPaintMode: BrushPaintMode = 'paint',
  patternOrigin?: { x: number; y: number },
  symmetryAxes?: SymmetryAxes,
  symmetryCenter?: SymmetryCenter,
  colorReplacement?: { source: RgbaColor; target: RgbaColor },
  opacityScale = 1,
  coverageKey?: string,
  overrideImageBrushColor = false,
  gradient?: BrushGradientSample
): void {
  const normalizedOpacityScale = Math.max(0, Math.min(1, Number.isFinite(opacityScale) ? opacityScale : 1))
  if (normalizedOpacityScale <= 0) return
  const recordedPixelCount = edit.before.size
  const stamp = brushStampDimensions(size, imageBrush)
  const { x: beforeX, y: beforeY } = brushStampAnchor(size, imageBrush)
  const stampX = x - beforeX
  const stampY = y - beforeY
  const footprint = symmetricRect(document, { x: stampX, y: stampY, width: stamp.width, height: stamp.height }, symmetryAxes, symmetryCenter)
  if (!ensureLayerCoversEditRect(document, layer, edit, footprint)) return
  const offsets = brushMaskOffsets(size, shape, texture, textureScale, stampX, stampY, imageBrush, imageBrushSettings, proceduralAntialiasStrength, brushPaintMode, patternOrigin?.x ?? stampX, patternOrigin?.y ?? stampY)
  const solidStampKey = !selection && !imageBrush && texture === 'solid' && normalizedOpacityScale === 1 && !colorReplacement && !gradient && !coverageKey && !hasSymmetry(symmetryAxes) && (color.a === 0 || color.a === 255)
    ? `${shape}:${stamp.width}x${stamp.height}:${color.a === 0 ? 'erase' : packColor(color)}`
    : null
  let occupancy: Uint8Array | null = null
  const previousStamp = solidStampKey ? lastBrushStampByEdit.get(edit) : undefined
  if (solidStampKey) {
    const occupancyKey = `${shape}:${stamp.width}x${stamp.height}`
    occupancy = solidBrushOccupancyCache.get(occupancyKey) ?? null
    if (!occupancy) {
      occupancy = new Uint8Array(stamp.width * stamp.height)
      for (const offset of offsets) occupancy[offset.y * stamp.width + offset.x] = 1
      if (solidBrushOccupancyCache.size >= 16) solidBrushOccupancyCache.delete(solidBrushOccupancyCache.keys().next().value!)
      solidBrushOccupancyCache.set(occupancyKey, occupancy)
    }
  }
  for (const offset of offsets) {
    const scaledCoverage = Math.round(offset.coverage * normalizedOpacityScale)
    if (scaledCoverage === 0) continue
    const sourcePoint = { x: x - beforeX + offset.x, y: y - beforeY + offset.y }
    if (solidStampKey && previousStamp?.key === solidStampKey) {
      const previousLocalX = sourcePoint.x - previousStamp.stampX
      const previousLocalY = sourcePoint.y - previousStamp.stampY
      if (previousLocalX >= 0 && previousLocalY >= 0 && previousLocalX < previousStamp.width && previousLocalY < previousStamp.height && previousStamp.occupied[previousLocalY * previousStamp.width + previousLocalX]) continue
    }
    for (const { x: px, y: py } of symmetryPoints(sourcePoint, document.width, document.height, symmetryAxes, symmetryCenter)) {
      if (selection && !insideSelection(selection, px, py)) continue
      const index = layerIndexAt(layer, px, py)
      if (index === null) continue
      if (colorReplacement) {
        const current = layerColorBeforeEdit(document, layer, edit, index)
        const source = colorReplacement.source
        if (current.r !== source.r || current.g !== source.g || current.b !== source.b || current.a !== source.a) continue
        const target = colorReplacement.target
        const coverageKey = `replace:${source.r},${source.g},${source.b},${source.a}:${target.r},${target.g},${target.b},${target.a}`
        if (!claimBrushCoverage(edit, coverageKey, index, scaledCoverage)) continue
        const coverage = scaledCoverage / 255
        const replacement = scaledCoverage === 255 ? target : {
          r: Math.round(current.r + (target.r - current.r) * coverage),
          g: Math.round(current.g + (target.g - current.g) * coverage),
          b: Math.round(current.b + (target.b - current.b) * coverage),
          a: Math.round(current.a + (target.a - current.a) * coverage)
        }
        recordPixel(document, layer, edit, index, layer.format === 'rgba'
          ? packColor(replacement)
          : replacement.a === 0 ? 0 : findOrAddPaletteColor(document, replacement))
        continue
      }
      const resolvedColor = gradient
        ? gradientColorForAmount(gradient.startColor, gradient.endColor, gradient.gradientAmount, px, py, gradient.dither)
        : color
      const paintColor = offset.color && !overrideImageBrushColor && !gradient
        ? offset.color
        : offset.color
          ? { ...resolvedColor, a: Math.round(resolvedColor.a * offset.color.a / 255) }
          : resolvedColor
      const paintCoverageKey = coverageKey ?? (gradient
        ? brushGradientCoverageKey(gradient)
        : color.a === 0
        ? 'erase'
        : `paint:${paintColor.r},${paintColor.g},${paintColor.b},${paintColor.a}`)
      if (!claimBrushCoverage(edit, paintCoverageKey, index, scaledCoverage, coverageKey !== undefined || gradient !== undefined)) continue
      const eraseResolvedColor = gradient ? resolvedColor.a === 0 : color.a === 0
      if (eraseResolvedColor) {
        const eraseCoverage = offset.color && gradient ? Math.round(scaledCoverage * offset.color.a / 255) : scaledCoverage
        if (eraseCoverage === 0) continue
        if (eraseCoverage === 255) recordPixel(document, layer, edit, index, 0)
        else {
          const base = layerColorBeforeEdit(document, layer, edit, index)
          const erased = { ...base, a: Math.round(base.a * (1 - eraseCoverage / 255)) }
          recordPixel(document, layer, edit, index, layer.format === 'rgba' ? packColor(erased) : erased.a === 0 ? 0 : findOrAddPaletteColor(document, erased))
        }
      } else {
        const stamped = scaledCoverage === 255 ? paintColor : { ...paintColor, a: Math.round(paintColor.a * scaledCoverage / 255) }
        recordPixel(document, layer, edit, index, paintLayerValue(document, layer, edit, index, stamped))
      }
    }
  }
  if (solidStampKey && occupancy) lastBrushStampByEdit.set(edit, { key: solidStampKey, stampX, stampY, width: stamp.width, height: stamp.height, occupied: occupancy })
  else lastBrushStampByEdit.delete(edit)
  if (edit.before.size > recordedPixelCount) markLayerContentChanged(layer)
}

export interface BrushLineDynamics {
  fromSize?: number
  toSize?: number
  fromOpacityScale?: number
  toOpacityScale?: number
  fromColor?: RgbaColor
  toColor?: RgbaColor
  gradient?: BrushLineGradient
  coverageKey?: string
  overrideImageBrushColor?: boolean
}

export interface BrushMaskPoint { x: number; y: number; coverage: number; color?: RgbaColor }

/** Selects the brush centers shared by geometric-path previews and commits. */
export function brushPathStampPoints(
  points: readonly { x: number; y: number }[],
  size: number,
  imageBrush: ImageBrush | null = null
): Array<{ x: number; y: number }> {
  if (points.length === 0) return []
  const stamp = brushStampDimensions(size, imageBrush)
  const stampSpacing = Math.max(1, Math.floor(Math.max(stamp.width, stamp.height) / 16))
  const centers: Array<{ x: number; y: number }> = []
  let stepsSinceStamp = 0
  for (let index = 0; index < points.length; index += 1) {
    if (index > 0) stepsSinceStamp += 1
    if (index !== 0 && index !== points.length - 1 && stepsSinceStamp < stampSpacing) continue
    centers.push({ x: Math.round(points[index].x), y: Math.round(points[index].y) })
    stepsSinceStamp = 0
  }
  return centers
}

/** The footprint shared by painting and the canvas preview. */
export function brushStampDimensions(size: number, imageBrush: ImageBrush | null = null): { width: number; height: number } {
  if (imageBrush?.intrinsicSize) return { width: Math.max(1, imageBrush.width), height: Math.max(1, imageBrush.height) }
  const normalizedSize = Math.max(1, Math.round(size))
  return { width: normalizedSize, height: normalizedSize }
}

/** The pointer pixel inside a brush stamp. Even dimensions use the lower-right center pixel. */
export function brushStampAnchor(size: number, imageBrush: ImageBrush | null = null): { x: number; y: number } {
  const stamp = brushStampDimensions(size, imageBrush)
  return { x: Math.floor(stamp.width / 2), y: Math.floor(stamp.height / 2) }
}

const orderedDither4x4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5
]

// Image brushes are deliberately one-color stamps. Gray changes the density of
// painted pixels rather than the selected color's alpha or RGB values.
const defaultImageBrushSettings: ImageBrushSettings = { mode: 'dither', threshold: 128, blackPoint: 0, whitePoint: 255, invert: false }
const imageBrushMaskCache = new WeakMap<ImageBrush, Map<string, BrushMaskPoint[]>>()
const solidBrushMaskCache = new Map<string, BrushMaskPoint[]>()
const solidBrushOccupancyCache = new Map<string, Uint8Array>()
const wrappedIndex = (value: number, length: number): number => ((value % length) + length) % length

const imageBrushCoverage = (sourceCoverage: number, x: number, y: number, settings: ImageBrushSettings = defaultImageBrushSettings, antialiasStrength = 0): number => {
  const source = settings.invert ? 255 - sourceCoverage : sourceCoverage
  const range = Math.max(1, settings.whitePoint - settings.blackPoint)
  const coverage = Math.max(0, Math.min(255, Math.round((source - settings.blackPoint) * 255 / range)))
  if (antialiasStrength <= 0) {
    if (settings.mode === 'threshold') return coverage >= settings.threshold ? 255 : 0
    return coverage > orderedDither4x4[(y & 3) * 4 + (x & 3)] * 16 ? 255 : 0
  }
  if (coverage === 0) return 0
  if (coverage === 255) return 255
  const boundary = settings.mode === 'threshold' ? settings.threshold : orderedDither4x4[(y & 3) * 4 + (x & 3)] * 16
  const band = Math.max(1, Math.round(Math.min(100, antialiasStrength) * 0.64))
  if (coverage >= boundary + band) return 255
  if (coverage >= boundary - band) return 128
  return 0
}

const imageBrushCacheKey = (imageBrush: ImageBrush, size: number, settings: ImageBrushSettings = defaultImageBrushSettings, antialiasStrength = 0, paintMode: BrushPaintMode = 'paint', originX = 0, originY = 0, patternOriginX = originX, patternOriginY = originY): string => {
  const procedural = imageBrush.proceduralSettings
  const proceduralKey = procedural ? `${procedural.seed}:${procedural.scale}:${procedural.detail}:${procedural.variation}:${procedural.angle}` : ''
  const dimensions = brushStampDimensions(size, imageBrush)
  const originKey = paintMode !== 'paint'
    ? `${wrappedIndex(originX, imageBrush.width)}:${wrappedIndex(originY, imageBrush.height)}:${wrappedIndex(patternOriginX, imageBrush.width)}:${wrappedIndex(patternOriginY, imageBrush.height)}`
    : ''
  return `${dimensions.width}x${dimensions.height}:${settings.mode}:${settings.threshold}:${settings.blackPoint}:${settings.whitePoint}:${settings.invert ? 1 : 0}:${antialiasStrength}:${paintMode}:${originKey}:${proceduralKey}`
}

export function imageBrushCoverageAt(imageBrush: ImageBrush, x: number, y: number, size: number, settings?: ImageBrushSettings, proceduralAntialiasStrength = 0): number {
  const stamp = brushStampDimensions(size, imageBrush)
  const localX = wrappedIndex(x, stamp.width)
  const localY = wrappedIndex(y, stamp.height)
  const strength = imageBrush.id.startsWith('procedural:') ? proceduralAntialiasStrength : 0
  const sourceCoverage = imageBrush.id.startsWith('procedural:')
    ? proceduralBrushCoverageAt(imageBrush.id, localX, localY, Math.max(stamp.width, stamp.height), imageBrush.proceduralSettings)
    : (() => {
        const sourceX = imageBrush.intrinsicSize ? localX : Math.min(imageBrush.width - 1, Math.floor(localX * imageBrush.width / stamp.width))
        const sourceY = imageBrush.intrinsicSize ? localY : Math.min(imageBrush.height - 1, Math.floor(localY * imageBrush.height / stamp.height))
        return imageBrush.coverage[sourceY * imageBrush.width + sourceX] ?? 0
      })()
  return imageBrush.intrinsicSize ? sourceCoverage : imageBrushCoverage(sourceCoverage, localX, localY, settings, strength)
}

export const imageBrushContainsAt = (imageBrush: ImageBrush, x: number, y: number, size: number, settings?: ImageBrushSettings): boolean => imageBrushCoverageAt(imageBrush, x, y, size, settings) > 0

const texturePatterns: Record<Exclude<BrushTexture, 'solid'>, readonly string[]> = {
  cracks: ['10000000', '01000100', '00101100', '00011000', '00100100', '01000010', '10000001', '00000000'],
  wood: ['11101110', '11011101', '10111011', '01110111', '11101110', '11011101', '10111011', '01110111'],
  grain: ['10100110', '01011001', '10001010', '00110100', '11001001', '01100010', '10010110', '01001001']
}

export const brushTextureContains = (texture: BrushTexture, x: number, y: number, textureScale = 1): boolean => {
  if (texture === 'solid') return true
  const pattern = texturePatterns[texture]
  const scale = Math.max(1, Math.min(16, Math.round(textureScale)))
  const row = pattern[wrappedIndex(Math.floor(y / scale), pattern.length)]
  return row[wrappedIndex(Math.floor(x / scale), row.length)] === '1'
}

export function brushMaskOffsets(size: number, shape: BrushShape, texture: BrushTexture = 'solid', textureScale = 1, originX = 0, originY = 0, imageBrush: ImageBrush | null = null, imageBrushSettings?: ImageBrushSettings, proceduralAntialiasStrength = 0, brushPaintMode: BrushPaintMode = 'paint', patternOriginX = originX, patternOriginY = originY): BrushMaskPoint[] {
  const normalizedSize = Math.max(1, Math.round(size))
  const points: BrushMaskPoint[] = []
  if (imageBrush) {
    const stamp = brushStampDimensions(normalizedSize, imageBrush)
    const strength = imageBrush.id.startsWith('procedural:') ? proceduralAntialiasStrength : 0
    const cacheKey = imageBrushCacheKey(imageBrush, normalizedSize, imageBrushSettings, strength, brushPaintMode, originX, originY, patternOriginX, patternOriginY)
    let cache = imageBrushMaskCache.get(imageBrush)
    const cached = cache?.get(cacheKey)
    if (cached) return cached
    for (let y = 0; y < stamp.height; y += 1) for (let x = 0; x < stamp.width; x += 1) {
      // Source-aligned brushes preserve the pixels captured when the brush was
      // created. Target-aligned brushes restart the tile at the current stamp.
      const canvasX = originX + x
      const canvasY = originY + y
      const sampleX = brushPaintMode === 'pattern-source'
        ? canvasX - (imageBrush.sourceX ?? 0)
        : brushPaintMode === 'pattern-target'
          ? canvasX - patternOriginX
          : x
      const sampleY = brushPaintMode === 'pattern-source'
        ? canvasY - (imageBrush.sourceY ?? 0)
        : brushPaintMode === 'pattern-target'
          ? canvasY - patternOriginY
          : y
      const sourceCoverage = imageBrush.id.startsWith('procedural:')
        ? proceduralBrushCoverageAt(imageBrush.id, sampleX, sampleY, brushPaintMode === 'paint' ? stamp.width : Math.max(imageBrush.width, imageBrush.height), imageBrush.proceduralSettings)
        : brushPaintMode === 'paint'
          ? imageBrush.coverage[(imageBrush.intrinsicSize ? y : Math.min(imageBrush.height - 1, Math.floor(y * imageBrush.height / stamp.height))) * imageBrush.width + (imageBrush.intrinsicSize ? x : Math.min(imageBrush.width - 1, Math.floor(x * imageBrush.width / stamp.width)))] ?? 0
          : (() => {
              const sourceX = wrappedIndex(sampleX, imageBrush.width)
              const sourceY = wrappedIndex(sampleY, imageBrush.height)
              return imageBrush.coverage[sourceY * imageBrush.width + sourceX] ?? 0
            })()
      const colorSource = imageBrush.paintColors ?? imageBrush.colors
      const colorIndex = brushPaintMode === 'paint'
        ? (imageBrush.intrinsicSize ? y : Math.min(imageBrush.height - 1, Math.floor(y * imageBrush.height / stamp.height))) * imageBrush.width
          + (imageBrush.intrinsicSize ? x : Math.min(imageBrush.width - 1, Math.floor(x * imageBrush.width / stamp.width)))
        : wrappedIndex(sampleY, imageBrush.height) * imageBrush.width + wrappedIndex(sampleX, imageBrush.width)
      const sourceColor = colorSource?.length === imageBrush.width * imageBrush.height ? unpackColor(colorSource[colorIndex] ?? 0) : undefined
      const coverage = sourceColor
        ? sourceColor.a > 0 ? 255 : 0
        : imageBrush.intrinsicSize ? sourceCoverage : imageBrushCoverage(sourceCoverage, sampleX, sampleY, imageBrushSettings, strength)
      if (coverage > 0) points.push({ x, y, coverage, color: sourceColor })
    }
    if (!cache) { cache = new Map(); imageBrushMaskCache.set(imageBrush, cache) }
    if (cache.size >= 4) cache.delete(cache.keys().next().value!)
    cache.set(cacheKey, points)
    return points
  }
  const solidCacheKey = texture === 'solid' ? `${shape}:${normalizedSize}` : null
  const cachedSolid = solidCacheKey ? solidBrushMaskCache.get(solidCacheKey) : null
  if (cachedSolid) return cachedSolid
  if (shape === 'line') {
    const row = Math.floor(normalizedSize / 2)
    for (let x = 0; x < normalizedSize; x += 1) if (brushTextureContains(texture, originX + x, originY + row, textureScale)) points.push({ x, y: row, coverage: 255 })
    return points
  }
  if (shape === 'square' || normalizedSize <= 1) {
    for (let y = 0; y < normalizedSize; y += 1) for (let x = 0; x < normalizedSize; x += 1) if (brushTextureContains(texture, originX + x, originY + y, textureScale)) points.push({ x, y, coverage: 255 })
    if (solidCacheKey) {
      if (solidBrushMaskCache.size >= 4) solidBrushMaskCache.delete(solidBrushMaskCache.keys().next().value!)
      solidBrushMaskCache.set(solidCacheKey, points)
    }
    return points
  }
  const center = (normalizedSize - 1) / 2
  const radius = normalizedSize / 2
  for (let y = 0; y < normalizedSize; y += 1) {
    for (let x = 0; x < normalizedSize; x += 1) {
      const dx = x - center
      const dy = y - center
      const distanceSquared = (dx * dx) + (dy * dy)
      if (distanceSquared <= radius * radius && brushTextureContains(texture, originX + x, originY + y, textureScale)) points.push({ x, y, coverage: 255 })
    }
  }
  if (solidCacheKey) {
    if (solidBrushMaskCache.size >= 4) solidBrushMaskCache.delete(solidBrushMaskCache.keys().next().value!)
    solidBrushMaskCache.set(solidCacheKey, points)
  }
  return points
}

export function paintLine(
  document: SpriteDocument,
  layer: RasterLayer,
  edit: PixelEdit,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  size: number,
  color: RgbaColor,
  selection?: SelectionMask | null,
  shape: BrushShape = 'square',
  texture: BrushTexture = 'solid',
  textureScale = 1,
  imageBrush: ImageBrush | null = null,
  imageBrushSettings?: ImageBrushSettings,
  proceduralAntialiasStrength = 0,
  brushPaintMode: BrushPaintMode = 'paint',
  patternOrigin?: { x: number; y: number },
  lineAlgorithm: 'raster' | 'balanced' = 'raster',
  symmetryAxes?: SymmetryAxes,
  symmetryCenter?: SymmetryCenter,
  colorReplacement?: { source: RgbaColor; target: RgbaColor },
  dynamics?: BrushLineDynamics
): void {
  const dynamicValue = (from: number | undefined, to: number | undefined, fallback: number, progress: number): number => {
    const start = Number.isFinite(from) ? from! : fallback
    const end = Number.isFinite(to) ? to! : fallback
    return start + (end - start) * progress
  }
  const paintPoint = (pointX: number, pointY: number, progress: number): void => {
    const pointSize = Math.max(1, Math.round(dynamicValue(dynamics?.fromSize, dynamics?.toSize, size, progress)))
    const opacityScale = dynamicValue(dynamics?.fromOpacityScale, dynamics?.toOpacityScale, 1, progress)
    const pointColor = dynamics?.fromColor || dynamics?.toColor
      ? interpolateRgbaColor(dynamics.fromColor ?? dynamics.toColor ?? color, dynamics.toColor ?? dynamics.fromColor ?? color, progress)
      : color
    const gradient = dynamics?.gradient
      ? {
          startColor: dynamics.gradient.startColor,
          endColor: dynamics.gradient.endColor,
          gradientAmount: dynamicValue(dynamics.gradient.fromAmount, dynamics.gradient.toAmount, 0, progress),
          dither: dynamics.gradient.dither
        }
      : undefined
    paintBrush(document, layer, edit, pointX, pointY, pointSize, pointColor, shape, selection, texture, textureScale, imageBrush, imageBrushSettings, proceduralAntialiasStrength, brushPaintMode, patternOrigin, symmetryAxes, symmetryCenter, colorReplacement, opacityScale, dynamics?.coverageKey, dynamics?.overrideImageBrushColor, gradient)
  }
  const points = lineAlgorithm === 'balanced'
    ? balancedStairLinePoints({ x: fromX, y: fromY }, { x: toX, y: toY })
    : rasterLinePoints({ x: fromX, y: fromY }, { x: toX, y: toY })
  if (points.length === 0) return
  const maximumSize = Math.max(1, Math.round(Math.max(size, dynamics?.fromSize ?? size, dynamics?.toSize ?? size)))
  const maximumStamp = brushStampDimensions(maximumSize, imageBrush)
  const maximumAnchor = brushStampAnchor(maximumSize, imageBrush)
  const lineLeft = Math.min(fromX, toX) - maximumAnchor.x
  const lineTop = Math.min(fromY, toY) - maximumAnchor.y
  const lineRight = Math.max(fromX, toX) - maximumAnchor.x + maximumStamp.width
  const lineBottom = Math.max(fromY, toY) - maximumAnchor.y + maximumStamp.height
  const footprint = symmetricRect(document, { x: lineLeft, y: lineTop, width: lineRight - lineLeft, height: lineBottom - lineTop }, symmetryAxes, symmetryCenter)
  if (!ensureLayerCoversEditRect(document, layer, edit, footprint)) return
  let stepsSinceStamp = 0
  let lastStampedSize: number | null = null
  for (let index = 0; index < points.length; index += 1) {
    const progress = points.length <= 1 ? 1 : index / (points.length - 1)
    const pointSize = Math.max(1, Math.round(dynamicValue(dynamics?.fromSize, dynamics?.toSize, size, progress)))
    const stamp = brushStampDimensions(pointSize, imageBrush)
    const stampSpacing = Math.max(1, Math.floor(Math.max(stamp.width, stamp.height) / 16))
    if (index > 0) stepsSinceStamp += 1
    const sizeChanged = lastStampedSize !== null && pointSize !== lastStampedSize
    const mustPaint = index === 0 || index === points.length - 1 || sizeChanged || stepsSinceStamp >= stampSpacing
    if (!mustPaint) continue
    const point = points[index]
    paintPoint(point.x, point.y, progress)
    stepsSinceStamp = 0
    lastStampedSize = pointSize
  }
}

export function paintBrushPath(
  document: SpriteDocument,
  layer: RasterLayer,
  edit: PixelEdit,
  points: readonly { x: number; y: number }[],
  size: number,
  color: RgbaColor,
  selection?: SelectionMask | null,
  shape: BrushShape = 'square',
  texture: BrushTexture = 'solid',
  textureScale = 1,
  imageBrush: ImageBrush | null = null,
  imageBrushSettings?: ImageBrushSettings,
  proceduralAntialiasStrength = 0,
  brushPaintMode: BrushPaintMode = 'paint',
  patternOrigin?: { x: number; y: number },
  symmetryAxes?: SymmetryAxes,
  symmetryCenter?: SymmetryCenter
): void {
  const centers = brushPathStampPoints(points, size, imageBrush)
  if (centers.length === 0) return
  const stamp = brushStampDimensions(size, imageBrush)
  const anchor = brushStampAnchor(size, imageBrush)
  const left = Math.min(...centers.map((point) => point.x)) - anchor.x
  const top = Math.min(...centers.map((point) => point.y)) - anchor.y
  const right = Math.max(...centers.map((point) => point.x)) - anchor.x + stamp.width
  const bottom = Math.max(...centers.map((point) => point.y)) - anchor.y + stamp.height
  const footprint = symmetricRect(document, { x: left, y: top, width: right - left, height: bottom - top }, symmetryAxes, symmetryCenter)
  if (!ensureLayerCoversEditRect(document, layer, edit, footprint)) return
  for (const center of centers) {
    paintBrush(document, layer, edit, center.x, center.y, size, color, shape, selection, texture, textureScale, imageBrush, imageBrushSettings, proceduralAntialiasStrength, brushPaintMode, patternOrigin, symmetryAxes, symmetryCenter)
  }
}

export interface PixelPathPoint { x: number; y: number; size?: number; opacityScale?: number; color?: RgbaColor; gradient?: BrushGradientSample; coverageKey?: string; overrideImageBrushColor?: boolean }

export function appendPerfectPixelSegment(path: PixelPathPoint[], target: PixelPathPoint): boolean {
  if (!path.length) {
    path.push({ ...target })
    return false
  }
  const segmentStart = path[path.length - 1]
  let x = segmentStart.x
  let y = segmentStart.y
  const dx = Math.abs(target.x - x)
  const sx = x < target.x ? 1 : -1
  const dy = -Math.abs(target.y - y)
  const sy = y < target.y ? 1 : -1
  let error = dx + dy
  const totalSteps = Math.max(dx, Math.abs(dy))
  let step = 0
  let removedCorner = false
  while (x !== target.x || y !== target.y) {
    const twiceError = error * 2
    if (twiceError >= dy) { error += dy; x += sx }
    if (twiceError <= dx) { error += dx; y += sy }
    step += 1
    const progress = totalSteps === 0 ? 1 : step / totalSteps
    const point: PixelPathPoint = { x, y }
    if (segmentStart.size !== undefined || target.size !== undefined) {
      point.size = (segmentStart.size ?? target.size ?? 1) + ((target.size ?? segmentStart.size ?? 1) - (segmentStart.size ?? target.size ?? 1)) * progress
    }
    if (segmentStart.opacityScale !== undefined || target.opacityScale !== undefined) {
      point.opacityScale = (segmentStart.opacityScale ?? target.opacityScale ?? 1) + ((target.opacityScale ?? segmentStart.opacityScale ?? 1) - (segmentStart.opacityScale ?? target.opacityScale ?? 1)) * progress
    }
    if (segmentStart.color || target.color) point.color = interpolateRgbaColor(segmentStart.color ?? target.color!, target.color ?? segmentStart.color!, progress)
    if (segmentStart.gradient || target.gradient) {
      const startGradient = segmentStart.gradient ?? target.gradient!
      const endGradient = target.gradient ?? segmentStart.gradient!
      point.gradient = {
        startColor: interpolateRgbaColor(startGradient.startColor, endGradient.startColor, progress),
        endColor: interpolateRgbaColor(startGradient.endColor, endGradient.endColor, progress),
        gradientAmount: startGradient.gradientAmount + (endGradient.gradientAmount - startGradient.gradientAmount) * progress,
        dither: endGradient.dither
      }
    }
    if (segmentStart.coverageKey || target.coverageKey) point.coverageKey = target.coverageKey ?? segmentStart.coverageKey
    if (segmentStart.overrideImageBrushColor || target.overrideImageBrushColor) point.overrideImageBrushColor = true
    if (path.length >= 2) {
      const previous = path[path.length - 1]
      const before = path[path.length - 2]
      const diagonalEndpoints = Math.abs(point.x - before.x) === 1 && Math.abs(point.y - before.y) === 1
      const previousFormsCorner = (previous.x === before.x && previous.y === point.y)
        || (previous.y === before.y && previous.x === point.x)
      if (diagonalEndpoints && previousFormsCorner) {
        path.pop()
        removedCorner = true
      }
    }
    const last = path[path.length - 1]
    if (!last || last.x !== point.x || last.y !== point.y) path.push(point)
  }
  return removedCorner
}

export function perfectPixelPathPoints(points: readonly { x: number; y: number }[]): PixelPathPoint[] {
  const path: PixelPathPoint[] = []
  for (const point of points) appendPerfectPixelSegment(path, point)
  return path
}

export function paintShape(
  document: SpriteDocument,
  layer: RasterLayer,
  edit: PixelEdit,
  bounds: SelectionRect,
  kind: ShapeKind,
  color: RgbaColor,
  selection?: SelectionMask | null,
  symmetryAxes?: SymmetryAxes,
  symmetryCenter?: SymmetryCenter,
  angle = 0
): void {
  const points = [...rotatedShapePixelPoints(bounds, kind, document.width, document.height, angle)]
  if (points.length === 0) return
  const destinations = points.flatMap((point) => symmetryPoints(point, document.width, document.height, symmetryAxes, symmetryCenter))
  const left = Math.min(...destinations.map((point) => point.x))
  const top = Math.min(...destinations.map((point) => point.y))
  const right = Math.max(...destinations.map((point) => point.x)) + 1
  const bottom = Math.max(...destinations.map((point) => point.y)) + 1
  if (!ensureLayerCoversEditRect(document, layer, edit, { x: left, y: top, width: right - left, height: bottom - top })) return
  for (const point of points) {
    for (const { x, y } of symmetryPoints(point, document.width, document.height, symmetryAxes, symmetryCenter)) {
      if (selection && !insideSelection(selection, x, y)) continue
      const index = layerIndexAt(layer, x, y)
      if (index === null) continue
      recordPixel(document, layer, edit, index, paintLayerValue(document, layer, edit, index, color))
    }
  }
}

const uniquePixelPoints = (points: Iterable<{ x: number; y: number }>): BrushMaskPoint[] => {
  const result: BrushMaskPoint[] = []
  const seen = new Set<string>()
  for (const point of points) {
    const x = Math.round(point.x)
    const y = Math.round(point.y)
    const key = `${x}:${y}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ x, y, coverage: 255 })
  }
  return result
}

export function filledShapePathPixelPoints(document: SpriteDocument, path: readonly { x: number; y: number }[]): BrushMaskPoint[] {
  const filled = lassoSelection(document, path.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) })))
  if (!filled) return []
  const points: BrushMaskPoint[] = []
  for (let y = filled.y; y < filled.y + filled.height; y += 1) {
    for (let x = filled.x; x < filled.x + filled.width; x += 1) {
      if (selectionContains(filled, x, y)) points.push({ x, y, coverage: 255 })
    }
  }
  return points
}

export function lineShapePixelPoints(start: { x: number; y: number }, end: { x: number; y: number }, balanced = false): BrushMaskPoint[] {
  return uniquePixelPoints((balanced ? balancedStairLinePoints : rasterLinePoints)(start, end))
}

export function bezierCurvePixelPoints(
  start: { x: number; y: number },
  controls: readonly { x: number; y: number }[],
  end: { x: number; y: number }
): BrushMaskPoint[] {
  const curvePoints = [start, ...controls, end]
  const baselineLength = Math.hypot(end.x - start.x, end.y - start.y)
  const steps = Math.min(4096, Math.max(16, Math.ceil(baselineLength * 2), curvePoints.length * 12))
  const points: Array<{ x: number; y: number }> = []
  let previous = { x: Math.round(start.x), y: Math.round(start.y) }
  points.push(previous)
  for (let step = 1; step <= steps; step += 1) {
    const amount = step / steps
    const working = curvePoints.map((point) => ({ x: point.x, y: point.y }))
    for (let level = working.length - 1; level > 0; level -= 1) {
      for (let index = 0; index < level; index += 1) {
        working[index] = {
          x: working[index].x + (working[index + 1].x - working[index].x) * amount,
          y: working[index].y + (working[index + 1].y - working[index].y) * amount
        }
      }
    }
    const current = { x: Math.round(working[0].x), y: Math.round(working[0].y) }
    points.push(...rasterLinePoints(previous, current))
    previous = current
  }
  return uniquePixelPoints(points)
}

export function paintShapePixelPoints(
  document: SpriteDocument,
  layer: RasterLayer,
  edit: PixelEdit,
  points: readonly { x: number; y: number }[],
  color: RgbaColor,
  selection?: SelectionMask | null,
  symmetryAxes?: SymmetryAxes,
  symmetryCenter?: SymmetryCenter
): void {
  const destinations = uniquePixelPoints(points.flatMap((point) => symmetryPoints(point, document.width, document.height, symmetryAxes, symmetryCenter)))
  if (destinations.length === 0) return
  const left = Math.min(...destinations.map((point) => point.x))
  const top = Math.min(...destinations.map((point) => point.y))
  const right = Math.max(...destinations.map((point) => point.x)) + 1
  const bottom = Math.max(...destinations.map((point) => point.y)) + 1
  if (!ensureLayerCoversEditRect(document, layer, edit, { x: left, y: top, width: right - left, height: bottom - top })) return
  for (const { x, y } of destinations) {
    if (selection && !insideSelection(selection, x, y)) continue
    const index = layerIndexAt(layer, x, y)
    if (index !== null) recordPixel(document, layer, edit, index, paintLayerValue(document, layer, edit, index, color))
  }
}

const defaultOutlineDirections: OutlineDirections = { nw: true, n: true, ne: true, w: true, e: true, sw: true, s: true, se: true }
const outlineDirection = (dx: number, dy: number): OutlineDirection | null => {
  if (dx === 0 && dy === 0) return null
  if (dy < 0) return dx < 0 ? 'nw' : dx > 0 ? 'ne' : 'n'
  if (dy > 0) return dx < 0 ? 'sw' : dx > 0 ? 'se' : 's'
  return dx < 0 ? 'w' : 'e'
}

const outlineKernelContains = (dx: number, dy: number, radius: number, kernel: OutlineKernel): boolean => {
  if (dx === 0 && dy === 0) return false
  if (kernel === 'horizontal') return dy === 0 && Math.abs(dx) <= radius
  if (kernel === 'vertical') return dx === 0 && Math.abs(dy) <= radius
  if (kernel === 'round') return dx * dx + dy * dy <= radius * radius
  return Math.max(Math.abs(dx), Math.abs(dy)) <= radius
}

/** Returns the exact pixels that a preview and the committed outline will paint. */
export function outlinePixelIndices(
  document: SpriteDocument,
  layer: RasterLayer,
  selection: SelectionMask,
  thickness: number,
  position: OutlinePosition,
  directions: OutlineDirections = defaultOutlineDirections,
  kernel: OutlineKernel = 'square'
): number[] {
  const radius = Math.max(1, Math.min(64, Math.round(thickness)))
  const left = Math.max(0, selection.x - radius)
  const top = Math.max(0, selection.y - radius)
  const right = Math.min(document.width, selection.x + selection.width + radius)
  const bottom = Math.min(document.height, selection.y + selection.height + radius)
  const width = right - left
  const height = bottom - top
  const isSource = (x: number, y: number): boolean =>
    x >= left && y >= top && x < right && y < bottom && selectionContains(selection, x, y) && readLayerColorAt(document, layer, x, y).a > 0
  const result = new Set<number>()
  const boundary: Array<{ x: number; y: number }> = []
  for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) {
    if (!isSource(x, y)) continue
    let edge = false
    for (let dy = -1; dy <= 1 && !edge; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      if ((dx !== 0 || dy !== 0) && !isSource(x + dx, y + dy)) { edge = true; break }
    }
    if (edge) boundary.push({ x, y })
  }

  if (position !== 'inside') {
    const clipped = new Set<number>()
    const unclipped = new Set<number>()
    for (const source of boundary) for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
      if (!outlineKernelContains(dx, dy, radius, kernel)) continue
      const direction = outlineDirection(dx, dy)
      if (!direction || !directions[direction]) continue
      const targetX = source.x + dx
      const targetY = source.y + dy
      if (targetX < 0 || targetY < 0 || targetX >= document.width || targetY >= document.height || isSource(targetX, targetY)) continue
      const index = pixelIndex(document.width, targetX, targetY)
      if (readLayerColorAt(document, layer, targetX, targetY).a !== 0) continue
      unclipped.add(index)
      if (selectionContains(selection, targetX, targetY)) clipped.add(index)
    }
    // Prefer clipping to the selection. A tight content selection has no room for an
    // outside stroke, so fall back to adjacent canvas pixels instead of doing nothing.
    for (const index of clipped.size > 0 ? clipped : unclipped) result.add(index)
  }

  if (position !== 'outside' && boundary.length > 0) {
    const innerRadius = Math.max(0, radius - 1)
    for (const source of boundary) {
      let allowedEdge = false
      for (let dy = -1; dy <= 1 && !allowedEdge; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0 || isSource(source.x + dx, source.y + dy) || !outlineKernelContains(dx, dy, 1, kernel)) continue
        const direction = outlineDirection(dx, dy)
        if (direction && directions[direction]) { allowedEdge = true; break }
      }
      if (!allowedEdge) continue
      for (let dy = -innerRadius; dy <= innerRadius; dy += 1) for (let dx = -innerRadius; dx <= innerRadius; dx += 1) {
        if (dx !== 0 || dy !== 0) {
          if (!outlineKernelContains(dx, dy, innerRadius, kernel)) continue
          const direction = outlineDirection(-dx, -dy)
          if (!direction || !directions[direction]) continue
        }
        const targetX = source.x + dx
        const targetY = source.y + dy
        if (targetX < left || targetY < top || targetX >= right || targetY >= bottom || !isSource(targetX, targetY)) continue
        result.add(pixelIndex(document.width, targetX, targetY))
      }
    }
  }
  return [...result]
}

export function outlineSelection(
  document: SpriteDocument,
  layer: RasterLayer,
  selection: SelectionMask,
  color: RgbaColor,
  thickness: number,
  position: OutlinePosition,
  directions: OutlineDirections = defaultOutlineDirections,
  kernel: OutlineKernel = 'square'
): PixelEdit | null {
  if (isLayerEffectivelyLocked(document, layer)) return null
  if (!ensureLayerCoversCanvas(document, layer)) return null
  const edit = beginPixelEdit(layer.id)
  for (const documentIndex of outlinePixelIndices(document, layer, selection, thickness, position, directions, kernel)) {
    const x = documentIndex % document.width
    const y = Math.floor(documentIndex / document.width)
    const index = layerIndexAt(layer, x, y)
    if (index !== null) recordPixel(document, layer, edit, index, paintLayerValue(document, layer, edit, index, color))
  }
  return edit.before.size > 0 ? edit : null
}

const shapeContainsOffset = (width: number, height: number, ellipse: boolean, offsetX: number, offsetY: number): boolean => {
  if (offsetX < 0 || offsetY < 0 || offsetX >= width || offsetY >= height) return false
  if (!ellipse) return true
  const centerX = (width - 1) / 2
  const centerY = (height - 1) / 2
  const radiusX = Math.max(0.5, width / 2)
  const radiusY = Math.max(0.5, height / 2)
  const dx = (offsetX - centerX) / radiusX
  const dy = (offsetY - centerY) / radiusY
  return (dx * dx) + (dy * dy) <= 1
}

export function shapeContainsPixel(bounds: SelectionRect, kind: ShapeKind, x: number, y: number): boolean {
  if (kind === 'freeform' || kind === 'polygon') return false
  const width = Math.max(1, bounds.width)
  const height = Math.max(1, bounds.height)
  return shapeContainsOffset(width, height, kind === 'ellipse' || kind === 'ellipse-outline', x - bounds.x, y - bounds.y)
}

export function shapePixelPoints(bounds: SelectionRect, kind: ShapeKind): BrushMaskPoint[] {
  if (kind === 'freeform' || kind === 'polygon') return []
  const width = Math.max(1, bounds.width)
  const height = Math.max(1, bounds.height)
  const ellipse = kind === 'ellipse' || kind === 'ellipse-outline'
  const outline = kind === 'rectangle-outline' || kind === 'ellipse-outline'
  const filled = new Uint8Array(width * height)
  const contains = (offsetX: number, offsetY: number): boolean => shapeContainsOffset(width, height, ellipse, offsetX, offsetY)
  for (let offsetY = 0; offsetY < height; offsetY += 1) for (let offsetX = 0; offsetX < width; offsetX += 1) if (contains(offsetX, offsetY)) filled[offsetY * width + offsetX] = 1
  const points: BrushMaskPoint[] = []
  for (let offsetY = 0; offsetY < height; offsetY += 1) {
    for (let offsetX = 0; offsetX < width; offsetX += 1) {
      if (!filled[offsetY * width + offsetX]) continue
      if (outline && contains(offsetX - 1, offsetY) && contains(offsetX + 1, offsetY) && contains(offsetX, offsetY - 1) && contains(offsetX, offsetY + 1)) continue
      points.push({ x: bounds.x + offsetX, y: bounds.y + offsetY, coverage: 255 })
    }
  }
  return points
}

export function rotatedShapePixelPoints(
  bounds: SelectionRect,
  kind: ShapeKind,
  canvasWidth: number,
  canvasHeight: number,
  angle = 0
): BrushMaskPoint[] {
  if (kind === 'freeform' || kind === 'polygon') return []
  const normalizedAngle = ((angle % 360) + 360) % 360
  if (normalizedAngle < 1e-9 || Math.abs(normalizedAngle - 360) < 1e-9) return shapePixelPoints(bounds, kind)
  const ellipse = kind === 'ellipse' || kind === 'ellipse-outline'
  const outline = kind === 'rectangle-outline' || kind === 'ellipse-outline'
  const filled = ellipse
    ? rotatedEllipseSelection(bounds, canvasWidth, canvasHeight, angle)
    : rotatedRectSelection(bounds, canvasWidth, canvasHeight, angle)
  if (!filled) return []

  const points: BrushMaskPoint[] = []
  for (let y = filled.y; y < filled.y + filled.height; y += 1) {
    for (let x = filled.x; x < filled.x + filled.width; x += 1) {
      if (!selectionContains(filled, x, y)) continue
      if (outline
        && selectionContains(filled, x - 1, y)
        && selectionContains(filled, x + 1, y)
        && selectionContains(filled, x, y - 1)
        && selectionContains(filled, x, y + 1)) continue
      points.push({ x, y, coverage: 255 })
    }
  }
  return points
}

const insideSelection = (selection: SelectionMask, x: number, y: number): boolean => selectionContains(selection, x, y)
const COMPACT_FILL_MIN_PIXELS = 512 * 512

const floodFillSolidRuns = (document: SpriteDocument, layer: RasterLayer, startX: number, startY: number, target: number, next: number, selection: SelectionMask | null | undefined, contiguous: boolean): PixelEdit | null => {
  const edit = beginPixelEdit(layer.id)
  preparePixelEdit(document, edit)
  const runs = [] as NonNullable<PixelEdit['runs']>
  const rgbaWords = layer.format === 'rgba' && layer.pixels.byteOffset % 4 === 0
    ? new Uint32Array(layer.pixels.buffer as ArrayBuffer, layer.pixels.byteOffset, layer.pixels.byteLength / 4)
    : null
  const layerIndexAtCanvas = (x: number, y: number): number | null => {
    const localX = x - layer.offsetX
    const localY = y - layer.offsetY
    return localX < 0 || localY < 0 || localX >= layer.width || localY >= layer.height ? null : localY * layer.width + localX
  }
  const selected = (x: number, y: number): boolean => {
    if (!selection) return true
    if (x < selection.x || y < selection.y || x >= selection.x + selection.width || y >= selection.y + selection.height) return false
    return !selection.mask || selection.mask[(y - selection.y) * selection.width + x - selection.x] === 1
  }
  const matches = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= document.width || y >= document.height || !selected(x, y)) return false
    const index = layerIndexAtCanvas(x, y)
    if (index === null) return false
    return layer.format === 'indexed' ? layer.pixels[index] === target : rgbaWords ? rgbaWords[index] === target : readLayerPacked(document, layer, index) === target
  }
  let dirtyLeft = document.width
  let dirtyTop = document.height
  let dirtyRight = 0
  let dirtyBottom = 0
  const fillSpan = (left: number, right: number, y: number): void => {
    const index = layerIndexAtCanvas(left, y)
    if (index === null) return
    const length = right - left + 1
    if (runs.length === 0) markLayerContentChanged(layer)
    writeLayerPackedRun(document, layer, index, length, next)
    runs.push({ index, length, before: target, after: next })
    dirtyLeft = Math.min(dirtyLeft, left)
    dirtyTop = Math.min(dirtyTop, y)
    dirtyRight = Math.max(dirtyRight, right + 1)
    dirtyBottom = Math.max(dirtyBottom, y + 1)
  }

  if (!contiguous) {
    const bounds = selection ? clampSelection(document, selection) : { x: 0, y: 0, width: document.width, height: document.height }
    if (!bounds) return null
    for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
      let x = bounds.x
      while (x < bounds.x + bounds.width) {
        while (x < bounds.x + bounds.width && !matches(x, y)) x += 1
        if (x >= bounds.x + bounds.width) break
        const left = x
        while (x + 1 < bounds.x + bounds.width && matches(x + 1, y)) x += 1
        fillSpan(left, x, y)
        x += 1
      }
    }
  } else {
    let stack = new Int32Array(1024)
    let stackLength = 0
    const push = (x: number, y: number): void => {
      if (stackLength === stack.length) {
        const expanded = new Int32Array(stack.length * 2)
        expanded.set(stack)
        stack = expanded
      }
      stack[stackLength++] = pixelIndex(document.width, x, y)
    }
    const scanNeighbor = (left: number, right: number, y: number): void => {
      if (y < 0 || y >= document.height) return
      let x = left
      while (x <= right) {
        while (x <= right && !matches(x, y)) x += 1
        if (x > right) break
        push(x, y)
        x += 1
        while (x <= right && matches(x, y)) x += 1
      }
    }
    push(startX, startY)
    while (stackLength > 0) {
      const seed = stack[--stackLength]
      const x = seed % document.width
      const y = Math.floor(seed / document.width)
      if (!matches(x, y)) continue
      let left = x
      let right = x
      while (matches(left - 1, y)) left -= 1
      while (matches(right + 1, y)) right += 1
      fillSpan(left, right, y)
      scanNeighbor(left, right, y - 1)
      scanNeighbor(left, right, y + 1)
    }
  }
  if (runs.length === 0) return null
  edit.runs = runs
  edit.dirtyRect = { x: dirtyLeft, y: dirtyTop, width: dirtyRight - dirtyLeft, height: dirtyBottom - dirtyTop }
  return edit
}

export function floodFill(document: SpriteDocument, layer: RasterLayer, startX: number, startY: number, color: RgbaColor, selection?: SelectionMask | null, contiguous = true, imageBrush: ImageBrush | null = null, brushSize = 1, imageBrushSettings?: ImageBrushSettings, brushTexture: BrushTexture = 'solid', brushTextureScale = 1, proceduralAntialiasStrength = 0, brushPaintMode: BrushPaintMode = 'paint', tolerance = 0): PixelEdit | null {
  if (!isInBounds(document.width, document.height, startX, startY) || isLayerEffectivelyLocked(document, layer) || (selection && !insideSelection(selection, startX, startY))) return null
  const startWasOutsideLayer = layerIndexAt(layer, startX, startY) === null
  if (startWasOutsideLayer && !ensureLayerCoversCanvas(document, layer)) return null
  const startLayerIndex = layerIndexAt(layer, startX, startY)
  if (startLayerIndex === null) return null
  const target = readLayerPacked(document, layer, startLayerIndex)
  const normalizedTolerance = Math.max(0, Math.min(255, Math.round(tolerance) || 0))
  const paletteColors = layer.format === 'indexed'
    ? new Map(document.palette.map((entry) => [entry.id, packColor(getPaletteEntry(document, entry.id).color)]))
    : null
  const targetColor = layer.format === 'rgba' ? target : paletteColors!.get(target) ?? 0
  const matchesValue = (value: number): boolean => normalizedTolerance === 0
    ? value === target
    : packedColorMatchesTolerance(layer.format === 'rgba' ? value : paletteColors!.get(value) ?? 0, targetColor, normalizedTolerance)
  if (!startWasOutsideLayer && matchesValue(0)) {
    const bounds = selection ? clampSelection(document, selection) : { x: 0, y: 0, width: document.width, height: document.height }
    const layerLeft = layer.offsetX
    const layerTop = layer.offsetY
    const layerRight = layer.offsetX + layer.width
    const layerBottom = layer.offsetY + layer.height
    const boundsExtendOutsideLayer = Boolean(bounds && (bounds.x < layerLeft || bounds.y < layerTop || bounds.x + bounds.width > layerRight || bounds.y + bounds.height > layerBottom))
    const contiguousRegionCanEscapeLayer = (): boolean => {
      if (!contiguous || !boundsExtendOutsideLayer) return boundsExtendOutsideLayer
      const startLocalX = startX - layerLeft
      const startLocalY = startY - layerTop
      const visited = new Uint8Array(layer.width * layer.height)
      let stack = new Int32Array(Math.min(layer.width * layer.height, 1024))
      let stackLength = 0
      const matchesLocal = (localX: number, localY: number): boolean => {
        if (localX < 0 || localY < 0 || localX >= layer.width || localY >= layer.height) return false
        const index = localY * layer.width + localX
        if (visited[index]) return false
        const canvasX = layerLeft + localX
        const canvasY = layerTop + localY
        return (!selection || insideSelection(selection, canvasX, canvasY)) && matchesValue(readLayerPacked(document, layer, index))
      }
      const push = (localX: number, localY: number): void => {
        if (!matchesLocal(localX, localY)) return
        const index = localY * layer.width + localX
        visited[index] = 1
        if (stackLength === stack.length) {
          const expanded = new Int32Array(Math.min(layer.width * layer.height, Math.max(stack.length * 2, 1024)))
          expanded.set(stack)
          stack = expanded
        }
        stack[stackLength++] = index
      }
      const outsideSelected = (canvasX: number, canvasY: number): boolean => canvasX >= 0 && canvasY >= 0 && canvasX < document.width && canvasY < document.height && (!selection || insideSelection(selection, canvasX, canvasY))
      const scanNeighbor = (left: number, right: number, localY: number): void => {
        if (localY < 0 || localY >= layer.height) return
        let localX = left
        while (localX <= right) {
          while (localX <= right && !matchesLocal(localX, localY)) localX += 1
          if (localX > right) break
          push(localX, localY)
          localX += 1
          while (localX <= right && matchesLocal(localX, localY)) localX += 1
        }
      }
      push(startLocalX, startLocalY)
      while (stackLength > 0) {
        const index = stack[--stackLength]
        const localX = index % layer.width
        const localY = Math.floor(index / layer.width)
        let left = localX
        let right = localX
        while (matchesLocal(left - 1, localY)) left -= 1
        while (matchesLocal(right + 1, localY)) right += 1
        visited.fill(1, localY * layer.width + left, localY * layer.width + right + 1)
        const canvasY = layerTop + localY
        if ((left === 0 && outsideSelected(layerLeft - 1, canvasY))
          || (right === layer.width - 1 && outsideSelected(layerRight, canvasY))) return true
        if (localY === 0 || localY === layer.height - 1) {
          const outsideY = localY === 0 ? layerTop - 1 : layerBottom
          for (let x = left; x <= right; x += 1) if (outsideSelected(layerLeft + x, outsideY)) return true
        }
        scanNeighbor(left, right, localY - 1)
        scanNeighbor(left, right, localY + 1)
      }
      return false
    }
    const mayReachOutsideLayer = contiguousRegionCanEscapeLayer()
    if (mayReachOutsideLayer && !ensureLayerCoversCanvas(document, layer)) return null
  }
  const edit = beginPixelEdit(layer.id)
  preparePixelEdit(document, edit)
  const next = paintLayerValue(document, layer, edit, startLayerIndex, color)
  if (target === next) return null
  if (normalizedTolerance === 0 && document.width * document.height >= COMPACT_FILL_MIN_PIXELS && !imageBrush && brushTexture === 'solid') {
    return floodFillSolidRuns(document, layer, startX, startY, target, next, selection, contiguous)
  }
  const textureCoverage = (x: number, y: number): number => {
    if (!imageBrush) return brushTextureContains(brushTexture, x, y, brushTextureScale) ? 255 : 0
    const originX = brushPaintMode === 'pattern-source' ? imageBrush.sourceX ?? 0 : brushPaintMode === 'pattern-target' ? startX : 0
    const originY = brushPaintMode === 'pattern-source' ? imageBrush.sourceY ?? 0 : brushPaintMode === 'pattern-target' ? startY : 0
    const sampleX = x - originX
    const sampleY = y - originY
    const sampleSize = brushPaintMode === 'paint' ? brushSize : Math.max(imageBrush.width, imageBrush.height)
    if (imageBrush.id.startsWith('procedural:')) return imageBrushCoverage(proceduralBrushCoverageAt(imageBrush.id, sampleX, sampleY, sampleSize, imageBrush.proceduralSettings), sampleX, sampleY, imageBrushSettings, proceduralAntialiasStrength)
    return imageBrush.intrinsicSize ? imageBrush.coverage[wrappedIndex(sampleY, imageBrush.height) * imageBrush.width + wrappedIndex(sampleX, imageBrush.width)] ?? 0 : imageBrushCoverageAt(imageBrush, sampleX, sampleY, sampleSize, imageBrushSettings)
  }
  const constantFillValue = color.a === 0
    ? layer.format === 'rgba' ? packColor(color) : 0
    : color.a === 255
      ? layer.format === 'rgba' ? packColor(color) : findOrAddPaletteColor(document, color)
      : null
  const layerIndexAtCanvas = (x: number, y: number): number | null => {
    const localX = x - layer.offsetX
    const localY = y - layer.offsetY
    return localX < 0 || localY < 0 || localX >= layer.width || localY >= layer.height
      ? null
      : localY * layer.width + localX
  }
  const paintAtCoverage = (layerIndex: number, coverage: number, current: number): void => {
    if (coverage <= 0) return
    const nextValue = coverage === 255 && constantFillValue !== null
      ? constantFillValue
      : paintLayerValue(document, layer, edit, layerIndex, coverage === 255 ? color : { ...color, a: Math.round(color.a * coverage / 255) })
    recordPixelKnownCurrent(document, layer, edit, layerIndex, current, nextValue)
  }
  if (!contiguous) {
    const bounds = selection ? clampSelection(document, selection) : { x: 0, y: 0, width: document.width, height: document.height }
    if (!bounds) return null
    for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
      for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
        if (selection && !selectionContains(selection, x, y)) continue
        const layerIndex = layerIndexAtCanvas(x, y)
        if (layerIndex === null) continue
        const current = readLayerPacked(document, layer, layerIndex)
        if (!matchesValue(current)) continue
        paintAtCoverage(layerIndex, textureCoverage(x, y), current)
      }
    }
    return edit.before.size > 0 ? edit : null
  }
  const maxPixels = document.width * document.height
  const visited = new Uint8Array(maxPixels)
  let stack = new Int32Array(Math.min(maxPixels, 1024))
  let stackLength = 0
  const enqueueIfMatching = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= document.width || y >= document.height) return
    const index = pixelIndex(document.width, x, y)
    if (visited[index] || (selection && !insideSelection(selection, x, y))) return
    const layerIndex = layerIndexAtCanvas(x, y)
    if (layerIndex === null || !matchesValue(readLayerPacked(document, layer, layerIndex))) return
    visited[index] = 1
    if (stackLength === stack.length) {
      const expanded = new Int32Array(Math.min(maxPixels, Math.max(stack.length * 2, 1024)))
      expanded.set(stack)
      stack = expanded
    }
    stack[stackLength++] = index
  }
  enqueueIfMatching(startX, startY)
  while (stackLength > 0) {
    const index = stack[--stackLength]
    const x = index % document.width
    const y = Math.floor(index / document.width)
    const layerIndex = layerIndexAtCanvas(x, y)
    if (layerIndex === null) continue
    paintAtCoverage(layerIndex, textureCoverage(x, y), readLayerPacked(document, layer, layerIndex))
    enqueueIfMatching(x - 1, y)
    enqueueIfMatching(x + 1, y)
    enqueueIfMatching(x, y - 1)
    enqueueIfMatching(x, y + 1)
  }
  return edit.before.size > 0 ? edit : null
}

export function floodFillSymmetric(document: SpriteDocument, layer: RasterLayer, startX: number, startY: number, color: RgbaColor, selection: SelectionMask | null | undefined, contiguous: boolean, imageBrush: ImageBrush | null, brushSize: number, imageBrushSettings: ImageBrushSettings | undefined, brushTexture: BrushTexture, brushTextureScale: number, proceduralAntialiasStrength: number, brushPaintMode: BrushPaintMode, symmetryAxes?: SymmetryAxes, symmetryCenter?: SymmetryCenter, tolerance = 0): PixelEdit | null {
  const merged = beginPixelEdit(layer.id)
  for (const seed of symmetryPoints({ x: startX, y: startY }, document.width, document.height, symmetryAxes, symmetryCenter)) {
    const edit = floodFill(document, layer, seed.x, seed.y, color, selection, contiguous, imageBrush, brushSize, imageBrushSettings, brushTexture, brushTextureScale, proceduralAntialiasStrength, brushPaintMode, tolerance)
    if (!edit) continue
    merged.frameId ??= edit.frameId
    if (edit.runs?.length) (merged.runs ??= []).push(...edit.runs)
    for (const [index, value] of edit.before) if (!merged.before.has(index)) merged.before.set(index, value)
    for (const [index, value] of edit.after) merged.after.set(index, value)
    if (edit.dirtyRect) {
      if (!merged.dirtyRect) merged.dirtyRect = { ...edit.dirtyRect }
      else {
        const left = Math.min(merged.dirtyRect.x, edit.dirtyRect.x)
        const top = Math.min(merged.dirtyRect.y, edit.dirtyRect.y)
        const right = Math.max(merged.dirtyRect.x + merged.dirtyRect.width, edit.dirtyRect.x + edit.dirtyRect.width)
        const bottom = Math.max(merged.dirtyRect.y + merged.dirtyRect.height, edit.dirtyRect.y + edit.dirtyRect.height)
        merged.dirtyRect = { x: left, y: top, width: right - left, height: bottom - top }
      }
    }
  }
  return merged.before.size > 0 || merged.runs?.length ? merged : null
}

export function clearSelection(document: SpriteDocument, selection: SelectionMask, targetLayer?: RasterLayer): PixelEdit | null {
  const layer = targetLayer ?? getActiveLayer(document)
  if (isLayerEffectivelyLocked(document, layer)) return null
  const clamped = clampSelection(document, selection)
  if (!clamped) return null
  const edit = beginPixelEdit(layer.id)
  for (let y = clamped.y; y < clamped.y + clamped.height; y += 1) {
    for (let x = clamped.x; x < clamped.x + clamped.width; x += 1) {
      if (!selectionContains(selection, x, y)) continue
      const index = layerIndexAt(layer, x, y)
      if (index !== null) recordPixel(document, layer, edit, index, 0)
    }
  }
  return edit
}

export function fillSelectionOrCanvas(document: SpriteDocument, layer: RasterLayer, color: RgbaColor, selection: SelectionMask | null = null): PixelEdit | null {
  if (isLayerEffectivelyLocked(document, layer)) return null
  const bounds = selection ? clampSelection(document, selection) : { x: 0, y: 0, width: document.width, height: document.height }
  if (!bounds) return null
  const edit = beginPixelEdit(layer.id)
  if (!ensureLayerCoversEditRect(document, layer, edit, bounds, selection ? EDIT_EXPANSION_PADDING : 0)) return null
  const value = layer.format === 'rgba' ? packColor(color) : findOrAddPaletteColor(document, color)
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      if (selection && !selectionContains(selection, x, y)) continue
      const index = layerIndexAt(layer, x, y)
      if (index === null) continue
      recordPixel(document, layer, edit, index, value)
    }
  }
  return edit.before.size > 0 ? edit : null
}

export function replaceLayerColor(document: SpriteDocument, layer: RasterLayer, source: RgbaColor, replacement: RgbaColor, selection: SelectionMask | null = null): PixelEdit | null {
  const sourceValue = packColor(source)
  if (sourceValue === packColor(replacement)) return null
  const indexedSourceIds = layer.format === 'indexed'
    ? new Set(document.palette.filter((entry) => packColor(entry.color) === sourceValue).map((entry) => entry.id))
    : null
  if (indexedSourceIds?.size === 0) return null
  const edit = beginPixelEdit(layer.id)
  let replacementValue: number | null = layer.format === 'rgba' ? packColor(replacement) : null
  const replaceIndex = (index: number): void => {
    const current = readLayerPacked(document, layer, index)
    if (layer.format === 'rgba' ? current !== sourceValue : !indexedSourceIds!.has(current)) return
    replacementValue ??= findOrAddPaletteColor(document, replacement)
    recordPixelKnownCurrent(document, layer, edit, index, current, replacementValue)
  }
  if (selection) {
    const bounds = clampSelection(document, selection)
    if (!bounds) return null
    for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
      for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
        if (!selectionContains(selection, x, y)) continue
        const index = layerIndexAt(layer, x, y)
        if (index !== null) replaceIndex(index)
      }
    }
  } else {
    for (let index = 0; index < layer.width * layer.height; index += 1) replaceIndex(index)
  }
  return edit.before.size > 0 ? edit : null
}

export interface SelectionTransformSource {
  selection: SelectionMask
  values: Uint32Array
  selectedOffsets: Uint32Array
  opaqueOffsets: Uint32Array
  opaqueIndices: Uint32Array
  opaqueValues: Uint32Array
}

const flippedSelectionOffset = (offset: number, width: number, height: number, axis: SelectionFlipAxis): number => {
  const x = offset % width
  const y = Math.floor(offset / width)
  return axis === 'horizontal' ? y * width + width - 1 - x : (height - 1 - y) * width + x
}

export function flipSelectionTransformSource(source: SelectionTransformSource, axis: SelectionFlipAxis): SelectionTransformSource {
  const { width, height } = source.selection
  const values = new Uint32Array(source.values.length)
  for (let offset = 0; offset < source.values.length; offset += 1) values[flippedSelectionOffset(offset, width, height, axis)] = source.values[offset]
  const selectedOffsets = Uint32Array.from(source.selectedOffsets, (offset) => flippedSelectionOffset(offset, width, height, axis))
  const opaque = Array.from(source.opaqueOffsets, (offset, index) => ({
    offset: flippedSelectionOffset(offset, width, height, axis),
    value: source.opaqueValues[index]
  })).sort((left, right) => left.offset - right.offset)
  return {
    selection: flipSelectionMask(source.selection, axis),
    values,
    selectedOffsets,
    opaqueOffsets: Uint32Array.from(opaque, (item) => item.offset),
    // These indices remain tied to the original clear region while the
    // destination offsets and values follow the mirrored floating content.
    opaqueIndices: source.opaqueIndices.slice(),
    opaqueValues: Uint32Array.from(opaque, (item) => item.value)
  }
}

export interface SelectionTranslationPreview {
  layerId: string
  marks: Uint8Array
  canvasIndices: Uint32Array
  indices: Uint32Array
  before: Uint32Array
  count: number
}

interface TransformCell { x: number; y: number; sourceIndex: number; value: number }

export function captureSelectionTransform(document: SpriteDocument, selection: SelectionMask, targetLayer?: RasterLayer): SelectionTransformSource | null {
  const layer = targetLayer ?? getActiveLayer(document)
  const source = clampSelectionMask(document, selection)
  if (!source) return null
  const values = new Uint32Array(source.width * source.height)
  const selectedOffsets: number[] = []
  const opaqueOffsets: number[] = []
  const opaqueIndices: number[] = []
  const opaqueValues: number[] = []
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const offset = y * source.width + x
      values[offset] = readLayerPackedAt(document, layer, source.x + x, source.y + y) ?? 0
      if (selectionContains(selection, source.x + x, source.y + y)) {
        selectedOffsets.push(offset)
        const value = values[offset]
        const opaque = layer.format === 'rgba' ? (value >>> 24) !== 0 : value !== 0 && getPaletteEntry(document, value).color.a !== 0
        if (opaque) {
          opaqueOffsets.push(offset)
          opaqueIndices.push(pixelIndex(document.width, source.x + x, source.y + y))
          opaqueValues.push(value)
        }
      }
    }
  }
  return {
    selection: { ...source, mask: selection.mask?.slice() },
    values,
    selectedOffsets: Uint32Array.from(selectedOffsets),
    opaqueOffsets: Uint32Array.from(opaqueOffsets),
    opaqueIndices: Uint32Array.from(opaqueIndices),
    opaqueValues: Uint32Array.from(opaqueValues)
  }
}

export function restoreSelectionTranslationPreview(document: SpriteDocument, preview: SelectionTranslationPreview): void {
  const layer = getLayer(document, preview.layerId)
  if (preview.count > 0) markLayerContentChanged(layer)
  for (let offset = 0; offset < preview.count; offset += 1) writeLayerPacked(document, layer, preview.indices[offset], preview.before[offset])
}

export function applySelectionTranslationPreview(
  document: SpriteDocument,
  source: SelectionTransformSource,
  target: SelectionRect,
  copy = false,
  reusable?: SelectionTranslationPreview | null,
  targetLayer?: RasterLayer
): SelectionTranslationPreview {
  const layer = targetLayer ?? getActiveLayer(document)
  ensureLayerCoversCanvas(document, layer)
  if (reusable) restoreSelectionTranslationPreview(document, reusable)
  const visibleLeft = Math.max(0, target.x)
  const visibleTop = Math.max(0, target.y)
  const visibleRight = Math.min(document.width, target.x + target.width)
  const visibleBottom = Math.min(document.height, target.y + target.height)
  const visiblePixels = Math.max(0, visibleRight - visibleLeft) * Math.max(0, visibleBottom - visibleTop)
  // A clipboard source has no opaqueOffsets by design. Its visible
  // destination can still contain many pixels, so size the reusable arrays
  // from both the destination and the normal source/target fast path.
  const required = Math.max(1, visiblePixels, source.opaqueOffsets.length * 2)
  const preview: SelectionTranslationPreview = reusable && reusable.layerId === layer.id && reusable.marks.length === document.width * document.height
    ? reusable
    : {
        layerId: layer.id,
        marks: new Uint8Array(document.width * document.height),
        canvasIndices: new Uint32Array(required),
        indices: new Uint32Array(required),
        before: new Uint32Array(required),
        count: 0
      }
  for (let offset = 0; offset < preview.count; offset += 1) preview.marks[preview.canvasIndices[offset]] = 0
  preview.count = 0
  if (preview.indices.length < required) {
    preview.canvasIndices = new Uint32Array(required)
    preview.indices = new Uint32Array(required)
    preview.before = new Uint32Array(required)
  }
  const finishPreview = (): SelectionTranslationPreview => {
    if (preview.count > 0) markLayerContentChanged(layer)
    return preview
  }
  const capture = (canvasIndex: number): void => {
    if (preview.marks[canvasIndex] === 1) return
    const x = canvasIndex % document.width
    const y = Math.floor(canvasIndex / document.width)
    const index = layerIndexAt(layer, x, y)
    if (index === null) return
    preview.marks[canvasIndex] = 1
    preview.canvasIndices[preview.count] = canvasIndex
    preview.indices[preview.count] = index
    preview.before[preview.count] = readLayerPacked(document, layer, index)
    preview.count += 1
  }
  const writeCanvasPacked = (canvasIndex: number, value: number): void => {
    const x = canvasIndex % document.width
    const y = Math.floor(canvasIndex / document.width)
    const index = layerIndexAt(layer, x, y)
    if (index !== null) writeLayerPacked(document, layer, index, value)
  }
  const sourceSelection = source.selection
  // Floating pastes are copies. Walk the visible destination rectangle instead
  // of every source pixel so a large pasted image stays responsive on a small
  // canvas, while still retaining its off-canvas pixels for later movement.
  if (copy) {
    for (let y = visibleTop; y < visibleBottom; y += 1) {
      const localY = y - target.y
      for (let x = visibleLeft; x < visibleRight; x += 1) {
        const localX = x - target.x
        const sourceX = sourceSelection.x + localX
        const sourceY = sourceSelection.y + localY
        if (!selectionContains(sourceSelection, sourceX, sourceY)) continue
        const value = source.values[localY * sourceSelection.width + localX]
        const transparent = layer.format === 'rgba'
          ? (value >>> 24) === 0
          : value === 0 || getPaletteEntry(document, value).color.a === 0
        if (transparent) continue
        const index = pixelIndex(document.width, x, y)
        capture(index)
        writeCanvasPacked(index, value)
      }
    }
    return finishPreview()
  }
  // Clipboard sources intentionally omit index arrays for large off-canvas
  // pastes. Their previous preview has already been reverted before this
  // path runs, so the stable document contains no source pixels to clear.
  // Only capture and redraw the destination; clearing sourceSelection here
  // writes transparent pixels into the next preview baseline.
  if (source.opaqueIndices.length === 0 && source.opaqueOffsets.length === 0) {
    const isTransparent = (value: number): boolean => layer.format === 'rgba'
      ? (value >>> 24) === 0
      : value === 0 || getPaletteEntry(document, value).color.a === 0
    for (let localY = 0; localY < sourceSelection.height; localY += 1) for (let localX = 0; localX < sourceSelection.width; localX += 1) {
      const sourceOffset = localY * sourceSelection.width + localX
      const sourceX = sourceSelection.x + localX
      const sourceY = sourceSelection.y + localY
      if (!selectionContains(sourceSelection, sourceX, sourceY) || isTransparent(source.values[sourceOffset])) continue
      const targetX = target.x + localX
      const targetY = target.y + localY
      if (isInBounds(document.width, document.height, targetX, targetY)) capture(pixelIndex(document.width, targetX, targetY))
    }
    for (let localY = 0; localY < sourceSelection.height; localY += 1) for (let localX = 0; localX < sourceSelection.width; localX += 1) {
      const sourceOffset = localY * sourceSelection.width + localX
      const sourceX = sourceSelection.x + localX
      const sourceY = sourceSelection.y + localY
      if (!selectionContains(sourceSelection, sourceX, sourceY) || isTransparent(source.values[sourceOffset])) continue
      const targetX = target.x + localX
      const targetY = target.y + localY
      if (isInBounds(document.width, document.height, targetX, targetY)) writeCanvasPacked(pixelIndex(document.width, targetX, targetY), source.values[sourceOffset])
    }
    return finishPreview()
  }
  for (let offset = 0; offset < source.opaqueIndices.length; offset += 1) {
    const sourceIndex = source.opaqueIndices[offset]
    if (!copy) capture(sourceIndex)
    const localOffset = source.opaqueOffsets[offset]
    const x = target.x + localOffset % sourceSelection.width
    const y = target.y + Math.floor(localOffset / sourceSelection.width)
    if (isInBounds(document.width, document.height, x, y)) capture(pixelIndex(document.width, x, y))
  }
  if (!copy) {
    for (let offset = 0; offset < source.opaqueIndices.length; offset += 1) writeCanvasPacked(source.opaqueIndices[offset], 0)
  }
  for (let offset = 0; offset < source.opaqueIndices.length; offset += 1) {
    const localOffset = source.opaqueOffsets[offset]
    const x = target.x + localOffset % sourceSelection.width
    const y = target.y + Math.floor(localOffset / sourceSelection.width)
    if (isInBounds(document.width, document.height, x, y)) writeCanvasPacked(pixelIndex(document.width, x, y), source.opaqueValues[offset])
  }
  return finishPreview()
}

export function selectionTranslationPreviewEdit(document: SpriteDocument, preview: SelectionTranslationPreview): PixelEdit | null {
  const layer = getLayer(document, preview.layerId)
  if (preview.count === 0) return null
  const edit = beginPixelEdit(layer.id)
  for (let offset = 0; offset < preview.count; offset += 1) {
    const index = preview.indices[offset]
    const before = preview.before[offset]
    const after = readLayerPacked(document, layer, index)
    if (before === after) continue
    edit.before.set(index, before)
    edit.after.set(index, after)
  }
  return edit.before.size > 0 ? edit : null
}

function selectionTransformCells(document: SpriteDocument, sourceData: SelectionTransformSource, target: SelectionRect, angle: number, shear?: SelectionShearTransform, targetLayer?: RasterLayer): TransformCell[] {
  const source = sourceData.selection
  const destination = clampSelection(document, transformedSelectionBounds(target, angle, shear))
  if (!destination) return []
  const cells = new Map<number, TransformCell>()
  const layer = targetLayer ?? getActiveLayer(document)
  const isOpaqueValue = (value: number): boolean => layer.format === 'rgba'
    ? (value >>> 24) !== 0
    : value !== 0 && getPaletteEntry(document, value).color.a !== 0
  const normalizedAngle = ((angle % 360) + 360) % 360
  const pixelPreservingRotation = Boolean(
    normalizedAngle !== 0
    && !shear
    && !target.flipHorizontal
    && !target.flipVertical
    && target.width === source.width
    && target.height === source.height
  )
  if (pixelPreservingRotation) {
    const candidateOffsets = sourceData.selectedOffsets.length > 0
      ? sourceData.selectedOffsets
      : Uint32Array.from(
          { length: source.width * source.height },
          (_, offset) => offset
        ).filter((sourceOffset) => {
          const localX = sourceOffset % source.width
          const localY = Math.floor(sourceOffset / source.width)
          return selectionContains(source, source.x + localX, source.y + localY)
        })
    const opaqueOffsets = sourceData.opaqueOffsets.length > 0
      ? sourceData.opaqueOffsets
      : candidateOffsets.filter((sourceOffset) => isOpaqueValue(sourceData.values[sourceOffset]))
    for (const sourceOffset of opaqueOffsets) {
      const localX = sourceOffset % source.width
      const localY = Math.floor(sourceOffset / source.width)
      const mapped = transformedSelectionDestinationPoint(source, target, source.x + localX, source.y + localY, angle)
      const x = Math.floor(mapped.x)
      const y = Math.floor(mapped.y)
      if (x < destination.x || y < destination.y || x >= destination.x + destination.width || y >= destination.y + destination.height) continue
      const destinationIndex = pixelIndex(document.width, x, y)
      if (cells.has(destinationIndex)) continue
      cells.set(destinationIndex, {
        x,
        y,
        sourceIndex: pixelIndex(document.width, source.x + localX, source.y + localY),
        value: sourceData.values[sourceOffset]
      })
    }

    const inverseCandidates = new Map<number, TransformCell>()
    for (let y = destination.y; y < destination.y + destination.height; y += 1) {
      for (let x = destination.x; x < destination.x + destination.width; x += 1) {
        const sourcePoint = transformedSelectionSourcePoint(source, target, x, y, angle)
        if (!sourcePoint) continue
        const sourceOffset = (sourcePoint.y - source.y) * source.width + sourcePoint.x - source.x
        const value = sourceData.values[sourceOffset]
        if (!isOpaqueValue(value)) continue
        const destinationIndex = pixelIndex(document.width, x, y)
        if (cells.has(destinationIndex)) continue
        inverseCandidates.set(destinationIndex, {
          x,
          y,
          sourceIndex: pixelIndex(document.width, sourcePoint.x, sourcePoint.y),
          value
        })
      }
    }

    // Forward mapping keeps thin pixel-art contours from growing. Fill only
    // inverse-sampled points enclosed by the existing result so solid areas do
    // not develop checkerboard holes while isolated edge duplicates stay out.
    let added = true
    while (added && inverseCandidates.size > 0) {
      added = false
      const additions: Array<[number, TransformCell]> = []
      for (const [destinationIndex, cell] of inverseCandidates) {
        const neighbors = [
          [cell.x - 1, cell.y],
          [cell.x + 1, cell.y],
          [cell.x, cell.y - 1],
          [cell.x, cell.y + 1]
        ]
        let occupiedNeighbors = 0
        for (const [neighborX, neighborY] of neighbors) {
          if (!isInBounds(document.width, document.height, neighborX, neighborY)) continue
          if (cells.has(pixelIndex(document.width, neighborX, neighborY))) occupiedNeighbors += 1
        }
        if (occupiedNeighbors >= 2) additions.push([destinationIndex, cell])
      }
      for (const [destinationIndex, cell] of additions) {
        cells.set(destinationIndex, cell)
        inverseCandidates.delete(destinationIndex)
        added = true
      }
    }
    return [...cells.values()]
  }
  for (let y = destination.y; y < destination.y + destination.height; y += 1) {
    for (let x = destination.x; x < destination.x + destination.width; x += 1) {
      const sourcePoint = transformedSelectionSourcePoint(source, target, x, y, angle, shear)
      if (!sourcePoint) continue
      const { x: sourceX, y: sourceY } = sourcePoint
      const sourceIndex = pixelIndex(document.width, sourceX, sourceY)
      const sourceOffset = (sourceY - source.y) * source.width + sourceX - source.x
      cells.set(pixelIndex(document.width, x, y), { x, y, sourceIndex, value: sourceData.values[sourceOffset] })
    }
  }
  return [...cells.values()]
}

const isSymmetryRepresentative = (point: { x: number; y: number }, selection: SelectionMask, document: SpriteDocument, axes?: SymmetryAxes, center?: SymmetryCenter): boolean => {
  if (!hasSymmetry(axes)) return true
  const candidates = symmetryPoints(point, document.width, document.height, axes, center).filter((candidate) => selectionContains(selection, candidate.x, candidate.y))
  const currentKey = point.y * document.width + point.x
  return candidates.every((candidate) => currentKey <= candidate.y * document.width + candidate.x)
}

export function selectionTransformPreview(document: SpriteDocument, selection: SelectionMask, target: SelectionRect, angle = 0, shear?: SelectionShearTransform, symmetryAxes?: SymmetryAxes, symmetryCenter?: SymmetryCenter, targetLayer?: RasterLayer): Uint8ClampedArray {
  const output = new Uint8ClampedArray(target.width * target.height * 4)
  const layer = targetLayer ?? getActiveLayer(document)
  const source = captureSelectionTransform(document, selection, layer)
  if (!source) return output
  for (const cell of selectionTransformCells(document, source, target, angle, shear, layer)) {
    const sourcePoint = { x: cell.sourceIndex % document.width, y: Math.floor(cell.sourceIndex / document.width) }
    if (!isSymmetryRepresentative(sourcePoint, source.selection, document, symmetryAxes, symmetryCenter)) continue
    const color = layer.format === 'indexed' ? getPaletteEntry(document, cell.value).color : unpackColor(cell.value)
    for (const destination of symmetryPoints({ x: cell.x, y: cell.y }, document.width, document.height, symmetryAxes, symmetryCenter)) {
      const localX = destination.x - target.x
      const localY = destination.y - target.y
      if (localX < 0 || localY < 0 || localX >= target.width || localY >= target.height) continue
      const offset = (localY * target.width + localX) * 4
      output[offset] = color.r
      output[offset + 1] = color.g
      output[offset + 2] = color.b
      output[offset + 3] = color.a
    }
  }
  return output
}

export function transformSelectionCopy(document: SpriteDocument, selection: SelectionMask, target: SelectionRect, angle = 0, shear?: SelectionShearTransform, symmetryAxes?: SymmetryAxes, symmetryCenter?: SymmetryCenter, targetLayer?: RasterLayer): PixelEdit | null {
  const layer = targetLayer ?? getActiveLayer(document)
  const source = captureSelectionTransform(document, selection, layer)
  return source ? applySelectionTransform(document, source, target, angle, true, shear, symmetryAxes, symmetryCenter, layer) : null
}

export function applySelectionTransform(document: SpriteDocument, source: SelectionTransformSource, target: SelectionRect, angle = 0, copy = false, shear?: SelectionShearTransform, symmetryAxes?: SymmetryAxes, symmetryCenter?: SymmetryCenter, targetLayer?: RasterLayer): PixelEdit | null {
  const layer = targetLayer ?? getActiveLayer(document)
  if (isLayerEffectivelyLocked(document, layer)) return null
  if (!ensureLayerCoversCanvas(document, layer)) return null
  const edit = beginPixelEdit(layer.id)
  const sourceSelection = source.selection
  const normalizedAngle = ((angle % 360) + 360) % 360
  const recordCanvasPixel = (x: number, y: number, value: number): void => {
    const index = layerIndexAt(layer, x, y)
    if (index !== null) recordPixel(document, layer, edit, index, value)
  }

  // Moving an unscaled selection is the common interactive path. Iterate its
  // captured offsets directly instead of allocating a TransformCell per pixel.
  if (!hasSymmetry(symmetryAxes) && normalizedAngle === 0 && !shear && target.width === sourceSelection.width && target.height === sourceSelection.height && !target.flipHorizontal && !target.flipVertical) {
    if (!copy) {
      for (const offset of source.selectedOffsets) {
        const localX = offset % sourceSelection.width
        const localY = Math.floor(offset / sourceSelection.width)
        recordCanvasPixel(sourceSelection.x + localX, sourceSelection.y + localY, 0)
      }
    }
    if (copy) {
      const left = Math.max(0, target.x)
      const top = Math.max(0, target.y)
      const right = Math.min(document.width, target.x + target.width)
      const bottom = Math.min(document.height, target.y + target.height)
      for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) {
        const localX = x - target.x
        const localY = y - target.y
        const sourceX = sourceSelection.x + localX
        const sourceY = sourceSelection.y + localY
        if (!selectionContains(sourceSelection, sourceX, sourceY)) continue
        const value = source.values[localY * sourceSelection.width + localX]
        const transparent = layer.format === 'rgba'
          ? (value >>> 24) === 0
          : value === 0 || getPaletteEntry(document, value).color.a === 0
        if (!transparent) recordCanvasPixel(x, y, value)
      }
    } else for (const offset of source.selectedOffsets) {
      const localX = offset % sourceSelection.width
      const localY = Math.floor(offset / sourceSelection.width)
      const x = target.x + localX
      const y = target.y + localY
      if (!isInBounds(document.width, document.height, x, y)) continue
      const value = source.values[offset]
      const transparent = layer.format === 'rgba'
        ? unpackColor(value).a === 0
        : value === 0 || getPaletteEntry(document, value).color.a === 0
      if (!transparent) recordCanvasPixel(x, y, value)
    }
    return edit.before.size > 0 ? edit : null
  }

  if (!copy) {
    const selection = sourceSelection
    for (let y = selection.y; y < selection.y + selection.height; y += 1) {
      for (let x = selection.x; x < selection.x + selection.width; x += 1) {
        if (!selectionContains(selection, x, y)) continue
        recordCanvasPixel(x, y, 0)
      }
    }
  }
  for (const cell of selectionTransformCells(document, source, target, angle, shear, layer)) {
    const sourcePoint = { x: cell.sourceIndex % document.width, y: Math.floor(cell.sourceIndex / document.width) }
    if (!isSymmetryRepresentative(sourcePoint, sourceSelection, document, symmetryAxes, symmetryCenter)) continue
    const transparent = layer.format === 'rgba'
      ? unpackColor(cell.value).a === 0
      : cell.value === 0 || getPaletteEntry(document, cell.value).color.a === 0
    if (transparent) continue
    for (const destination of symmetryPoints({ x: cell.x, y: cell.y }, document.width, document.height, symmetryAxes, symmetryCenter)) recordCanvasPixel(destination.x, destination.y, cell.value)
  }
  return edit.before.size > 0 ? edit : null
}

export function moveSelection(document: SpriteDocument, selection: SelectionMask, deltaX: number, deltaY: number, copy = false, targetLayer?: RasterLayer): PixelEdit | null {
  if (deltaX === 0 && deltaY === 0) return null
  const layer = targetLayer ?? getActiveLayer(document)
  const source = captureSelectionTransform(document, selection, layer)
  return source ? applySelectionTransform(document, source, { ...selection, x: selection.x + deltaX, y: selection.y + deltaY }, 0, copy, undefined, undefined, undefined, layer) : null
}

export function flipSelection(document: SpriteDocument, selection: SelectionMask, axis: 'horizontal' | 'vertical', targetLayer?: RasterLayer): PixelEdit | null {
  const layer = targetLayer ?? getActiveLayer(document)
  if (isLayerEffectivelyLocked(document, layer) || !ensureLayerCoversCanvas(document, layer)) return null
  const source = captureSelectionTransform(document, selection, layer)
  if (!source || source.selectedOffsets.length === 0) return null
  const edit = beginPixelEdit(layer.id)
  const recordCanvasPacked = (x: number, y: number, value: number): void => {
    if (!isInBounds(document.width, document.height, x, y)) return
    const index = layerIndexAt(layer, x, y)
    if (index !== null) recordPixel(document, layer, edit, index, value)
  }

  for (const offset of source.selectedOffsets) {
    const localX = offset % source.selection.width
    const localY = Math.floor(offset / source.selection.width)
    recordCanvasPacked(source.selection.x + localX, source.selection.y + localY, 0)
  }
  for (const offset of source.selectedOffsets) {
    const localX = offset % source.selection.width
    const localY = Math.floor(offset / source.selection.width)
    const targetX = axis === 'horizontal' ? source.selection.width - 1 - localX : localX
    const targetY = axis === 'vertical' ? source.selection.height - 1 - localY : localY
    recordCanvasPacked(source.selection.x + targetX, source.selection.y + targetY, source.values[offset])
  }
  return edit.before.size > 0 ? edit : null
}

export function flipLayer(document: SpriteDocument, axis: 'horizontal' | 'vertical'): PixelEdit | null {
  const layer = getActiveLayer(document)
  if (isLayerEffectivelyLocked(document, layer) || layer.width < 1 || layer.height < 1) return null
  const edit = beginPixelEdit(layer.id)
  const swap = (first: number, second: number): void => {
    const firstValue = readLayerPacked(document, layer, first)
    const secondValue = readLayerPacked(document, layer, second)
    recordPixel(document, layer, edit, first, secondValue)
    recordPixel(document, layer, edit, second, firstValue)
  }
  if (axis === 'horizontal') {
    for (let y = 0; y < layer.height; y += 1) for (let x = 0; x < Math.floor(layer.width / 2); x += 1) {
      swap(y * layer.width + x, y * layer.width + layer.width - 1 - x)
    }
  } else {
    for (let y = 0; y < Math.floor(layer.height / 2); y += 1) for (let x = 0; x < layer.width; x += 1) {
      swap(y * layer.width + x, (layer.height - 1 - y) * layer.width + x)
    }
  }
  return edit.before.size > 0 ? edit : null
}

export const sampleCompositeColor = (document: SpriteDocument, x: number, y: number): RgbaColor => {
  if (!isInBounds(document.width, document.height, x, y)) return { r: 0, g: 0, b: 0, a: 0 }
  const pixels = compositeRegion(document, x, y, 1, 1)
  return { r: pixels[0], g: pixels[1], b: pixels[2], a: pixels[3] }
}
