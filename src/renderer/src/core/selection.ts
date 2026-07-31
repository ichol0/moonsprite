import type { RasterLayer, SelectionMask, SelectionMode, SelectionRect, SpriteDocument } from '@shared/types'
import { getPaletteEntry } from './document'
import { isInBounds, packColor, pixelIndex } from './raster'

export const selectionContains = (selection: SelectionMask | null | undefined, x: number, y: number): boolean => {
  if (!selection || x < selection.x || y < selection.y || x >= selection.x + selection.width || y >= selection.y + selection.height) return false
  return !selection.mask || selection.mask[(y - selection.y) * selection.width + x - selection.x] === 1
}

export const selectionPixelCount = (selection: SelectionMask | null): number => {
  if (!selection) return 0
  if (!selection.mask) return selection.width * selection.height
  return selection.mask.reduce((count, value) => count + value, 0)
}

export const cloneSelection = (selection: SelectionMask | null | undefined): SelectionMask | null =>
  selection ? { ...selection, mask: selection.mask?.slice() } : null

export type SelectionFlipAxis = 'horizontal' | 'vertical'

export const flipSelectionMask = (selection: SelectionMask, axis: SelectionFlipAxis): SelectionMask => {
  if (!selection.mask) return { ...selection }
  const mask = new Uint8Array(selection.mask.length)
  for (let y = 0; y < selection.height; y += 1) {
    for (let x = 0; x < selection.width; x += 1) {
      if (selection.mask[y * selection.width + x] !== 1) continue
      const targetX = axis === 'horizontal' ? selection.width - 1 - x : x
      const targetY = axis === 'vertical' ? selection.height - 1 - y : y
      mask[targetY * selection.width + targetX] = 1
    }
  }
  return { ...selection, mask }
}

/** Returns merged local-space boundary segments as x1, y1, x2, y2 tuples. */
export const selectionBoundarySegments = (selection: SelectionMask): Int32Array => {
  const { width, height, mask } = selection
  if (!mask) return Int32Array.from([0, 0, width, 0, width, 0, width, height, width, height, 0, height, 0, height, 0, 0])
  const maxCoordinates = Math.max(16, width * height * 8 + (width + height) * 8)
  let segments = new Int32Array(Math.min(maxCoordinates, Math.max(256, (width + height) * 16)))
  let length = 0
  const append = (x1: number, y1: number, x2: number, y2: number): void => {
    if (length + 4 > segments.length) {
      const expanded = new Int32Array(Math.min(maxCoordinates, segments.length * 2))
      expanded.set(segments)
      segments = expanded
    }
    segments[length++] = x1
    segments[length++] = y1
    segments[length++] = x2
    segments[length++] = y2
  }

  for (let y = 0; y <= height; y += 1) {
    let start = -1
    for (let x = 0; x <= width; x += 1) {
      const above = x < width && y > 0 && mask[(y - 1) * width + x] === 1
      const below = x < width && y < height && mask[y * width + x] === 1
      const boundary = x < width && above !== below
      if (boundary && start < 0) start = x
      else if (!boundary && start >= 0) { append(start, y, x, y); start = -1 }
    }
  }

  for (let x = 0; x <= width; x += 1) {
    let start = -1
    for (let y = 0; y <= height; y += 1) {
      const left = y < height && x > 0 && mask[y * width + x - 1] === 1
      const right = y < height && x < width && mask[y * width + x] === 1
      const boundary = y < height && left !== right
      if (boundary && start < 0) start = y
      else if (!boundary && start >= 0) { append(x, start, x, y); start = -1 }
    }
  }

  return segments.slice(0, length)
}

export const rectSelection = (x: number, y: number, width: number, height: number): SelectionMask => ({ x, y, width, height })

export const ellipseSelection = (x: number, y: number, width: number, height: number): SelectionMask => {
  const normalizedWidth = Math.max(1, width)
  const normalizedHeight = Math.max(1, height)
  const centerX = (normalizedWidth - 1) / 2
  const centerY = (normalizedHeight - 1) / 2
  const radiusX = Math.max(0.5, normalizedWidth / 2)
  const radiusY = Math.max(0.5, normalizedHeight / 2)
  const mask = new Uint8Array(normalizedWidth * normalizedHeight)
  for (let offsetY = 0; offsetY < normalizedHeight; offsetY += 1) for (let offsetX = 0; offsetX < normalizedWidth; offsetX += 1) {
    const dx = (offsetX - centerX) / radiusX
    const dy = (offsetY - centerY) / radiusY
    if ((dx * dx) + (dy * dy) <= 1) mask[offsetY * normalizedWidth + offsetX] = 1
  }
  return { x, y, width: normalizedWidth, height: normalizedHeight, mask }
}

export const maskFromPoints = (points: Array<{ x: number; y: number }>): SelectionMask | null => {
  if (points.length === 0) return null
  let minX = points[0].x; let maxX = points[0].x; let minY = points[0].y; let maxY = points[0].y
  for (const point of points) { minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x); minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y) }
  const width = maxX - minX + 1
  const height = maxY - minY + 1
  const mask = new Uint8Array(width * height)
  for (const point of points) mask[(point.y - minY) * width + point.x - minX] = 1
  return { x: minX, y: minY, width, height, mask }
}

const snapRotationValue = (value: number): number => {
  const rounded = Math.round(value)
  return Math.abs(value - rounded) < 1e-9 ? rounded : value
}

export const rotatedSelectionBounds = (target: SelectionRect, angle = 0): SelectionRect => {
  if (target.width < 1 || target.height < 1) return { ...target }
  const normalizedAngle = ((angle % 360) + 360) % 360
  if (normalizedAngle === 0) return { ...target }

  const radians = normalizedAngle * Math.PI / 180
  const cosine = snapRotationValue(Math.cos(radians))
  const sine = snapRotationValue(Math.sin(radians))
  const centerX = target.x + target.width / 2
  const centerY = target.y + target.height / 2
  const corners = [
    { x: target.x, y: target.y },
    { x: target.x + target.width, y: target.y },
    { x: target.x + target.width, y: target.y + target.height },
    { x: target.x, y: target.y + target.height }
  ].map(({ x, y }) => ({
    x: snapRotationValue(centerX + (x - centerX) * cosine - (y - centerY) * sine),
    y: snapRotationValue(centerY + (x - centerX) * sine + (y - centerY) * cosine)
  }))
  const x = Math.floor(Math.min(...corners.map((corner) => corner.x)))
  const y = Math.floor(Math.min(...corners.map((corner) => corner.y)))
  const right = Math.ceil(Math.max(...corners.map((corner) => corner.x)))
  const bottom = Math.ceil(Math.max(...corners.map((corner) => corner.y)))
  return { x, y, width: right - x, height: bottom - y }
}

export const transformedSelectionSourcePoint = (
  source: SelectionMask,
  target: SelectionRect,
  x: number,
  y: number,
  angle = 0
): { x: number; y: number } | null => {
  if (target.width < 1 || target.height < 1) return null
  const radians = angle * Math.PI / 180
  const cosine = snapRotationValue(Math.cos(-radians))
  const sine = snapRotationValue(Math.sin(-radians))
  const centerX = target.x + target.width / 2
  const centerY = target.y + target.height / 2
  const offsetX = x + 0.5 - centerX
  const offsetY = y + 0.5 - centerY
  const unrotatedX = centerX + offsetX * cosine - offsetY * sine
  const unrotatedY = centerY + offsetX * sine + offsetY * cosine
  const normalizedX = (unrotatedX - target.x) / target.width
  const normalizedY = (unrotatedY - target.y) / target.height
  if (normalizedX < -1e-9 || normalizedX > 1 + 1e-9 || normalizedY < -1e-9 || normalizedY > 1 + 1e-9) return null
  const sourceX = Math.min(source.x + source.width - 1, Math.max(source.x, source.x + Math.floor(normalizedX * source.width)))
  const sourceY = Math.min(source.y + source.height - 1, Math.max(source.y, source.y + Math.floor(normalizedY * source.height)))
  return selectionContains(source, sourceX, sourceY) ? { x: sourceX, y: sourceY } : null
}

export const transformSelectionMask = (
  source: SelectionMask,
  target: SelectionRect,
  canvasWidth: number,
  canvasHeight: number,
  angle = 0
): SelectionMask | null => {
  const bounds = rotatedSelectionBounds(target, angle)
  const x = Math.max(0, bounds.x)
  const y = Math.max(0, bounds.y)
  const right = Math.min(canvasWidth, bounds.x + bounds.width)
  const bottom = Math.min(canvasHeight, bounds.y + bounds.height)
  if (right <= x || bottom <= y) return null
  const width = right - x
  const height = bottom - y
  if (!source.mask && angle === 0) return { x, y, width, height }

  const mask = new Uint8Array(width * height)
  let selected = 0
  for (let destinationY = y; destinationY < bottom; destinationY += 1) {
    for (let destinationX = x; destinationX < right; destinationX += 1) {
      if (!transformedSelectionSourcePoint(source, target, destinationX, destinationY, angle)) continue
      mask[(destinationY - y) * width + destinationX - x] = 1
      selected += 1
    }
  }
  return selected > 0 ? { x, y, width, height, mask } : null
}

export const combineSelection = (current: SelectionMask | null, incoming: SelectionMask | null, mode: SelectionMode): SelectionMask | null => {
  if (mode === 'replace') return incoming ? { ...incoming, mask: incoming.mask?.slice() } : null
  if (!current) return mode === 'add' ? (incoming ? { ...incoming, mask: incoming.mask?.slice() } : null) : null
  if (!incoming) return mode === 'subtract' ? { ...current, mask: current.mask?.slice() } : null
  const minX = Math.min(current.x, incoming.x); const minY = Math.min(current.y, incoming.y)
  const maxX = Math.max(current.x + current.width, incoming.x + incoming.width); const maxY = Math.max(current.y + current.height, incoming.y + incoming.height)
  const width = maxX - minX; const height = maxY - minY; const points: Array<{ x: number; y: number }> = []
  for (let y = minY; y < maxY; y += 1) for (let x = minX; x < maxX; x += 1) {
    const a = selectionContains(current, x, y); const b = selectionContains(incoming, x, y)
    if ((mode === 'add' && (a || b)) || (mode === 'subtract' && a && !b) || (mode === 'intersect' && a && b)) points.push({ x, y })
  }
  return maskFromPoints(points)
}

const packedColorMatches = (a: number, b: number, tolerance: number): boolean =>
  Math.max(
    Math.abs((a & 0xff) - (b & 0xff)),
    Math.abs(((a >>> 8) & 0xff) - ((b >>> 8) & 0xff)),
    Math.abs(((a >>> 16) & 0xff) - ((b >>> 16) & 0xff)),
    Math.abs((a >>> 24) - (b >>> 24))
  ) <= tolerance

export const magicWandSelection = (document: SpriteDocument, layer: RasterLayer, startX: number, startY: number, tolerance = 0, contiguous = true): SelectionMask | null => {
  if (!isInBounds(document.width, document.height, startX, startY)) return null
  const normalizedTolerance = Math.max(0, Math.min(255, Math.round(tolerance)))
  const palette = layer.format === 'indexed'
    ? new Map(document.palette.map((entry) => [entry.id, packColor(getPaletteEntry(document, entry.id).color)]))
    : null
  // The hot path is deliberately kept on packed typed-array values. Reading four
  // separate channels through readLayerPacked for every flood-fill neighbor adds
  // measurable overhead on noisy images.
  const packedPixels = layer.format === 'rgba'
    ? new Uint32Array(layer.pixels.buffer, layer.pixels.byteOffset, layer.pixels.byteLength / 4)
    : null
  const packedAt = (index: number): number => {
    const documentX = index % document.width
    const documentY = Math.floor(index / document.width)
    const localX = documentX - layer.offsetX
    const localY = documentY - layer.offsetY
    if (localX < 0 || localY < 0 || localX >= layer.width || localY >= layer.height) return 0
    const localIndex = localY * layer.width + localX
    return packedPixels ? packedPixels[localIndex] : palette!.get(layer.pixels[localIndex]) ?? 0
  }
  const target = packedAt(pixelIndex(document.width, startX, startY))
  const matches = (index: number): boolean => packedColorMatches(packedAt(index), target, normalizedTolerance)
  const total = document.width * document.height
  const selected = new Uint8Array(total)
  let minX = document.width; let maxX = -1; let minY = document.height; let maxY = -1
  const add = (index: number): void => {
    selected[index] = 1
    const x = index % document.width; const y = Math.floor(index / document.width)
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  if (!contiguous) {
    for (let index = 0; index < total; index += 1) if (matches(index)) add(index)
  } else {
    const visited = new Uint8Array(total)
    const stack = new Uint32Array(total)
    let stackSize = 0
    const push = (index: number): void => {
      if (visited[index]) return
      visited[index] = 1
      if (matches(index)) stack[stackSize++] = index
    }
    const start = pixelIndex(document.width, startX, startY)
    push(start)
    while (stackSize > 0) {
      const index = stack[--stackSize]
      add(index)
      const x = index % document.width; const y = Math.floor(index / document.width)
      if (x > 0) push(index - 1)
      if (x + 1 < document.width) push(index + 1)
      if (y > 0) push(index - document.width)
      if (y + 1 < document.height) push(index + document.width)
    }
  }
  if (maxX < minX || maxY < minY) return null
  const width = maxX - minX + 1; const height = maxY - minY + 1
  const mask = new Uint8Array(width * height)
  for (let y = minY; y <= maxY; y += 1) {
    const sourceStart = y * document.width + minX
    const targetStart = (y - minY) * width
    for (let x = 0; x < width; x += 1) mask[targetStart + x] = selected[sourceStart + x]
  }
  return { x: minX, y: minY, width, height, mask }
}

export const lassoSelection = (document: SpriteDocument, path: Array<{ x: number; y: number }>): SelectionMask | null => {
  if (path.length < 3) return null
  const minX = Math.max(0, Math.min(...path.map((point) => point.x)))
  const maxX = Math.min(document.width - 1, Math.max(...path.map((point) => point.x)))
  const minY = Math.max(0, Math.min(...path.map((point) => point.y)))
  const maxY = Math.min(document.height - 1, Math.max(...path.map((point) => point.y)))
  const points: Array<{ x: number; y: number }> = []
  for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
    let inside = false
    for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
      const a = path[i]; const b = path[j]
      if (((a.y > y) !== (b.y > y)) && x < ((b.x - a.x) * (y - a.y)) / ((b.y - a.y) || 1) + a.x) inside = !inside
    }
    if (inside) points.push({ x, y })
  }
  return maskFromPoints(points)
}

export const shiftSelection = (selection: SelectionMask | null, offsetX: number, offsetY: number, width: number, height: number): SelectionMask | null => {
  if (!selection) return null
  const points: Array<{ x: number; y: number }> = []
  for (let y = selection.y; y < selection.y + selection.height; y += 1) for (let x = selection.x; x < selection.x + selection.width; x += 1) {
    if (!selectionContains(selection, x, y)) continue
    const nextX = x + offsetX; const nextY = y + offsetY
    if (isInBounds(width, height, nextX, nextY)) points.push({ x: nextX, y: nextY })
  }
  return maskFromPoints(points)
}
