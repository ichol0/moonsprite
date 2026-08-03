import type { BrushPaintMode, BrushShape, BrushTexture, ImageBrush, ImageBrushSettings, OutlineDirection, OutlineDirections, OutlineKernel, OutlinePosition, RasterLayer, RgbaColor, SelectionMask, SelectionRect, ShapeKind, SpriteDocument } from '@shared/types'
import { compositeRegion, ensureLayerCoversCanvas, findOrAddPaletteColor, getActiveLayer, getPaletteEntry, isLayerEffectivelyLocked, layerIndexAt, readLayerColor, readLayerColorAt, readLayerPacked, readLayerPackedAt, writeLayerPacked } from './document'
import { beginPixelEdit, recordPixel, type PixelEdit } from './history'
import { blendOver, isInBounds, packColor, pixelIndex, unpackColor } from './raster'
import { rotatedSelectionBounds, selectionContains, transformedSelectionSourcePoint } from './selection'
import { proceduralBrushCoverageAt } from './brushes'
import { balancedStairLinePoints } from './pixel-line'

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
  if (!ensureLayerCoversCanvas(document, layer)) return
  const radiusBefore = Math.floor(size / 2)
  const radiusAfter = size - radiusBefore - 1
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
  patternOrigin?: { x: number; y: number }
): void {
  if (!ensureLayerCoversCanvas(document, layer)) return
  const stamp = brushStampDimensions(size, imageBrush)
  const { x: beforeX, y: beforeY } = brushStampAnchor(size, imageBrush)
  const stampX = x - beforeX
  const stampY = y - beforeY
  for (const offset of brushMaskOffsets(size, shape, texture, textureScale, stampX, stampY, imageBrush, imageBrushSettings, proceduralAntialiasStrength, brushPaintMode, patternOrigin?.x ?? stampX, patternOrigin?.y ?? stampY)) {
    const px = x - beforeX + offset.x
    const py = y - beforeY + offset.y
    if (!isInBounds(document.width, document.height, px, py)) continue
    if (selection && !insideSelection(selection, px, py)) continue
    const index = layerIndexAt(layer, px, py)
    if (index === null) continue
    if (offset.coverage === 0) continue
    const paintColor = offset.color ?? color
    if (color.a === 0) {
      if (offset.coverage === 255) recordPixel(document, layer, edit, index, 0)
      else {
        const base = readLayerColor(document, layer, index)
        const erased = { ...base, a: Math.round(base.a * (1 - offset.coverage / 255)) }
        recordPixel(document, layer, edit, index, layer.format === 'rgba' ? packColor(erased) : erased.a === 0 ? 0 : findOrAddPaletteColor(document, erased))
      }
    } else {
      const stamped = offset.coverage === 255 ? paintColor : { ...paintColor, a: Math.round(paintColor.a * offset.coverage / 255) }
      recordPixel(document, layer, edit, index, paintLayerValue(document, layer, edit, index, stamped))
    }
  }
}

export interface BrushMaskPoint { x: number; y: number; coverage: number; color?: RgbaColor }

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
  lineAlgorithm: 'raster' | 'balanced' = 'raster'
): void {
  if (lineAlgorithm === 'balanced') {
    const points = balancedStairLinePoints({ x: fromX, y: fromY }, { x: toX, y: toY })
    const stamp = brushStampDimensions(size, imageBrush)
    const stampSpacing = Math.max(1, Math.floor(Math.max(stamp.width, stamp.height) / 16))
    for (let index = 0; index < points.length; index += 1) {
      if (index % stampSpacing !== 0 && index !== points.length - 1) continue
      const point = points[index]
      paintBrush(document, layer, edit, point.x, point.y, size, color, shape, selection, texture, textureScale, imageBrush, imageBrushSettings, proceduralAntialiasStrength, brushPaintMode, patternOrigin)
    }
    return
  }
  let x = fromX
  let y = fromY
  const dx = Math.abs(toX - fromX)
  const sx = fromX < toX ? 1 : -1
  const dy = -Math.abs(toY - fromY)
  const sy = fromY < toY ? 1 : -1
  let error = dx + dy
  const stamp = brushStampDimensions(size, imageBrush)
  const stampSpacing = Math.max(1, Math.floor(Math.max(stamp.width, stamp.height) / 16))
  let step = 0
  while (true) {
    if (step % stampSpacing === 0 || (x === toX && y === toY)) paintBrush(document, layer, edit, x, y, size, color, shape, selection, texture, textureScale, imageBrush, imageBrushSettings, proceduralAntialiasStrength, brushPaintMode, patternOrigin)
    if (x === toX && y === toY) break
    const twiceError = error * 2
    if (twiceError >= dy) { error += dy; x += sx }
    if (twiceError <= dx) { error += dx; y += sy }
    step += 1
  }
}

export interface PixelPathPoint { x: number; y: number }

export function appendPerfectPixelSegment(path: PixelPathPoint[], target: PixelPathPoint): boolean {
  if (!path.length) {
    path.push({ ...target })
    return false
  }
  let x = path[path.length - 1].x
  let y = path[path.length - 1].y
  const dx = Math.abs(target.x - x)
  const sx = x < target.x ? 1 : -1
  const dy = -Math.abs(target.y - y)
  const sy = y < target.y ? 1 : -1
  let error = dx + dy
  let removedCorner = false
  while (x !== target.x || y !== target.y) {
    const twiceError = error * 2
    if (twiceError >= dy) { error += dy; x += sx }
    if (twiceError <= dx) { error += dx; y += sy }
    const point = { x, y }
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

export function paintShape(
  document: SpriteDocument,
  layer: RasterLayer,
  edit: PixelEdit,
  bounds: SelectionRect,
  kind: ShapeKind,
  color: RgbaColor,
  selection?: SelectionMask | null
): void {
  if (!ensureLayerCoversCanvas(document, layer)) return
  for (const point of shapePixelPoints(bounds, kind)) {
    const { x, y } = point
    if (!isInBounds(document.width, document.height, x, y)) continue
    if (selection && !insideSelection(selection, x, y)) continue
    const index = layerIndexAt(layer, x, y)
    if (index === null) continue
    recordPixel(document, layer, edit, index, paintLayerValue(document, layer, edit, index, color))
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

export function shapePixelPoints(bounds: SelectionRect, kind: ShapeKind): BrushMaskPoint[] {
  const width = Math.max(1, bounds.width)
  const height = Math.max(1, bounds.height)
  const centerX = (width - 1) / 2
  const centerY = (height - 1) / 2
  const radiusX = Math.max(0.5, width / 2)
  const radiusY = Math.max(0.5, height / 2)
  const ellipse = kind === 'ellipse' || kind === 'ellipse-outline'
  const outline = kind === 'rectangle-outline' || kind === 'ellipse-outline'
  const filled = new Uint8Array(width * height)
  const contains = (offsetX: number, offsetY: number): boolean => {
    if (offsetX < 0 || offsetY < 0 || offsetX >= width || offsetY >= height) return false
    if (!ellipse) return true
    const dx = (offsetX - centerX) / radiusX
    const dy = (offsetY - centerY) / radiusY
    return (dx * dx) + (dy * dy) <= 1
  }
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

const insideSelection = (selection: SelectionMask, x: number, y: number): boolean => selectionContains(selection, x, y)

export function floodFill(document: SpriteDocument, layer: RasterLayer, startX: number, startY: number, color: RgbaColor, selection?: SelectionMask | null, contiguous = true, imageBrush: ImageBrush | null = null, brushSize = 1, imageBrushSettings?: ImageBrushSettings, brushTexture: BrushTexture = 'solid', brushTextureScale = 1, proceduralAntialiasStrength = 0, brushPaintMode: BrushPaintMode = 'paint'): PixelEdit | null {
  if (!isInBounds(document.width, document.height, startX, startY) || isLayerEffectivelyLocked(document, layer) || (selection && !insideSelection(selection, startX, startY))) return null
  if (!ensureLayerCoversCanvas(document, layer)) return null
  const startLayerIndex = layerIndexAt(layer, startX, startY)
  if (startLayerIndex === null) return null
  const startIndex = pixelIndex(document.width, startX, startY)
  const target = readLayerPacked(document, layer, startLayerIndex)
  const edit = beginPixelEdit(layer.id)
  const next = paintLayerValue(document, layer, edit, startLayerIndex, color)
  if (target === next) return null
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
  const paintAtCoverage = (index: number, coverage: number): void => {
    if (coverage <= 0) return
    const x = index % document.width
    const y = Math.floor(index / document.width)
    const layerIndex = layerIndexAt(layer, x, y)
    if (layerIndex === null) return
    const fillColor = coverage === 255 ? color : { ...color, a: Math.round(color.a * coverage / 255) }
    recordPixel(document, layer, edit, layerIndex, paintLayerValue(document, layer, edit, layerIndex, fillColor))
  }
  if (!contiguous) {
    const bounds = selection ? clampSelection(document, selection) : { x: 0, y: 0, width: document.width, height: document.height }
    if (!bounds) return null
    for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
      for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
        if (selection && !selectionContains(selection, x, y)) continue
        const index = pixelIndex(document.width, x, y)
        const layerIndex = layerIndexAt(layer, x, y)
        if (layerIndex === null || readLayerPacked(document, layer, layerIndex) !== target) continue
        paintAtCoverage(index, textureCoverage(x, y))
      }
    }
    return edit.before.size > 0 ? edit : null
  }
  const stack = [startIndex]
  const visited = new Set<number>()
  while (stack.length > 0) {
    const index = stack.pop()!
    const x = index % document.width
    const y = Math.floor(index / document.width)
    const layerIndex = layerIndexAt(layer, x, y)
    if (visited.has(index) || layerIndex === null || readLayerPacked(document, layer, layerIndex) !== target) continue
    visited.add(index)
    paintAtCoverage(index, textureCoverage(x, y))
    if (x > 0 && (!selection || insideSelection(selection, x - 1, y))) stack.push(index - 1)
    if (x < document.width - 1 && (!selection || insideSelection(selection, x + 1, y))) stack.push(index + 1)
    if (y > 0 && (!selection || insideSelection(selection, x, y - 1))) stack.push(index - document.width)
    if (y < document.height - 1 && (!selection || insideSelection(selection, x, y + 1))) stack.push(index + document.width)
  }
  return edit.before.size > 0 ? edit : null
}

export function clearSelection(document: SpriteDocument, selection: SelectionMask): PixelEdit | null {
  const layer = getActiveLayer(document)
  if (isLayerEffectivelyLocked(document, layer)) return null
  if (!ensureLayerCoversCanvas(document, layer)) return null
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
  if (!ensureLayerCoversCanvas(document, layer)) return null
  const bounds = selection ? clampSelection(document, selection) : { x: 0, y: 0, width: document.width, height: document.height }
  if (!bounds) return null
  const edit = beginPixelEdit(layer.id)
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

export interface SelectionTransformSource {
  selection: SelectionMask
  values: Uint32Array
  selectedOffsets: Uint32Array
  opaqueOffsets: Uint32Array
  opaqueIndices: Uint32Array
  opaqueValues: Uint32Array
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

export function captureSelectionTransform(document: SpriteDocument, selection: SelectionMask): SelectionTransformSource | null {
  const layer = getActiveLayer(document)
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
  const layer = getActiveLayer(document)
  if (layer.id !== preview.layerId) return
  for (let offset = 0; offset < preview.count; offset += 1) writeLayerPacked(document, layer, preview.indices[offset], preview.before[offset])
}

export function applySelectionTranslationPreview(
  document: SpriteDocument,
  source: SelectionTransformSource,
  target: SelectionRect,
  copy = false,
  reusable?: SelectionTranslationPreview | null
): SelectionTranslationPreview {
  const layer = getActiveLayer(document)
  ensureLayerCoversCanvas(document, layer)
  if (reusable) restoreSelectionTranslationPreview(document, reusable)
  const visibleLeft = Math.max(0, target.x)
  const visibleTop = Math.max(0, target.y)
  const visibleRight = Math.min(document.width, target.x + target.width)
  const visibleBottom = Math.min(document.height, target.y + target.height)
  const visiblePixels = Math.max(0, visibleRight - visibleLeft) * Math.max(0, visibleBottom - visibleTop)
  const required = Math.max(1, copy ? visiblePixels : source.opaqueOffsets.length * 2)
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
    return preview
  }
  const delta = (target.y - sourceSelection.y) * document.width + target.x - sourceSelection.x
  const targetInside = target.x >= 0 && target.y >= 0 && target.x + target.width <= document.width && target.y + target.height <= document.height
  for (let offset = 0; offset < source.opaqueIndices.length; offset += 1) {
    const sourceIndex = source.opaqueIndices[offset]
    if (!copy) capture(sourceIndex)
    if (targetInside) capture(sourceIndex + delta)
    else {
      const localOffset = source.opaqueOffsets[offset]
      const x = target.x + localOffset % sourceSelection.width
      const y = target.y + Math.floor(localOffset / sourceSelection.width)
      if (isInBounds(document.width, document.height, x, y)) capture(pixelIndex(document.width, x, y))
    }
  }
  if (!copy) {
    for (let offset = 0; offset < source.opaqueIndices.length; offset += 1) writeCanvasPacked(source.opaqueIndices[offset], 0)
  }
  for (let offset = 0; offset < source.opaqueIndices.length; offset += 1) {
    if (targetInside) writeCanvasPacked(source.opaqueIndices[offset] + delta, source.opaqueValues[offset])
    else {
      const localOffset = source.opaqueOffsets[offset]
      const x = target.x + localOffset % sourceSelection.width
      const y = target.y + Math.floor(localOffset / sourceSelection.width)
      if (isInBounds(document.width, document.height, x, y)) writeCanvasPacked(pixelIndex(document.width, x, y), source.opaqueValues[offset])
    }
  }
  return preview
}

export function selectionTranslationPreviewEdit(document: SpriteDocument, preview: SelectionTranslationPreview): PixelEdit | null {
  const layer = getActiveLayer(document)
  if (layer.id !== preview.layerId || preview.count === 0) return null
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

function selectionTransformCells(document: SpriteDocument, sourceData: SelectionTransformSource, target: SelectionRect, angle: number): TransformCell[] {
  const source = sourceData.selection
  const destination = clampSelection(document, rotatedSelectionBounds(target, angle))
  if (!destination) return []
  const cells: TransformCell[] = []
  for (let y = destination.y; y < destination.y + destination.height; y += 1) {
    for (let x = destination.x; x < destination.x + destination.width; x += 1) {
      const sourcePoint = transformedSelectionSourcePoint(source, target, x, y, angle)
      if (!sourcePoint) continue
      const { x: sourceX, y: sourceY } = sourcePoint
      const sourceIndex = pixelIndex(document.width, sourceX, sourceY)
      const value = sourceData.values[(sourceY - source.y) * source.width + sourceX - source.x]
      cells.push({ x, y, sourceIndex, value })
    }
  }
  return cells
}

export function selectionTransformPreview(document: SpriteDocument, selection: SelectionMask, target: SelectionRect, angle = 0): Uint8ClampedArray {
  const output = new Uint8ClampedArray(target.width * target.height * 4)
  const layer = getActiveLayer(document)
  const source = captureSelectionTransform(document, selection)
  if (!source) return output
  for (const cell of selectionTransformCells(document, source, target, angle)) {
    const color = layer.format === 'indexed' ? getPaletteEntry(document, cell.value).color : unpackColor(cell.value)
    const localX = cell.x - target.x
    const localY = cell.y - target.y
    if (localX < 0 || localY < 0 || localX >= target.width || localY >= target.height) continue
    const offset = (localY * target.width + localX) * 4
    output[offset] = color.r
    output[offset + 1] = color.g
    output[offset + 2] = color.b
    output[offset + 3] = color.a
  }
  return output
}

export function transformSelectionCopy(document: SpriteDocument, selection: SelectionMask, target: SelectionRect, angle = 0): PixelEdit | null {
  const source = captureSelectionTransform(document, selection)
  return source ? applySelectionTransform(document, source, target, angle, true) : null
}

export function applySelectionTransform(document: SpriteDocument, source: SelectionTransformSource, target: SelectionRect, angle = 0, copy = false): PixelEdit | null {
  const layer = getActiveLayer(document)
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
  if (normalizedAngle === 0 && target.width === sourceSelection.width && target.height === sourceSelection.height && !target.flipHorizontal && !target.flipVertical) {
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
  for (const cell of selectionTransformCells(document, source, target, angle)) {
    const transparent = layer.format === 'rgba'
      ? unpackColor(cell.value).a === 0
      : cell.value === 0 || getPaletteEntry(document, cell.value).color.a === 0
    if (transparent) continue
    recordCanvasPixel(cell.x, cell.y, cell.value)
  }
  return edit.before.size > 0 ? edit : null
}

export function moveSelection(document: SpriteDocument, selection: SelectionMask, deltaX: number, deltaY: number, copy = false): PixelEdit | null {
  if (deltaX === 0 && deltaY === 0) return null
  const source = captureSelectionTransform(document, selection)
  return source ? applySelectionTransform(document, source, { ...selection, x: selection.x + deltaX, y: selection.y + deltaY }, 0, copy) : null
}

export function flipSelection(document: SpriteDocument, selection: SelectionMask, axis: 'horizontal' | 'vertical'): PixelEdit | null {
  const layer = getActiveLayer(document)
  if (isLayerEffectivelyLocked(document, layer) || !ensureLayerCoversCanvas(document, layer)) return null
  const source = captureSelectionTransform(document, selection)
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
