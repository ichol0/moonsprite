import type { CanvasAnchor, ColorMode, ImageResizeInterpolation, IndexedLayer, LayerGroup, PaletteEntry, RasterLayer, RgbaColor, RgbaLayer, SelectionRect, SpriteDocument } from '@shared/types'
import { blendWithMode, colorEquals, packColor, pixelIndex, readRgbaPixel, TRANSPARENT, unpackColor, writeRgbaPixel } from './raster'
import { translateCurrent as tr } from './localization'
import { loadEditorPreferences } from './file-preferences'
import { DEFAULT_PROJECT_DISPLAY_SETTINGS, DEFAULT_PROJECT_STATISTICS, DEFAULT_TIMELAPSE_SETTINGS } from './project-metadata'

let sequence = 0
const layerStorageOrigins = new WeakMap<RasterLayer, { x: number; y: number }>()
export const createId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${(++sequence).toString(36)}`
const transparentEntry = (): PaletteEntry => ({ id: 0, name: tr('core.document.transparentColor'), color: TRANSPARENT })

export function createLayer(name: string, width: number, height: number, mode: ColorMode): RasterLayer {
  const common = { id: createId('layer'), name, description: '', visible: true, locked: false, opacity: 1, blendMode: 'normal' as const, width, height, offsetX: 0, offsetY: 0 }
  return mode === 'rgba'
    ? { ...common, format: 'rgba', pixels: new Uint8ClampedArray(width * height * 4) }
    : { ...common, format: 'indexed', pixels: new Uint32Array(width * height) }
}

export function createDocument(name: string, width: number, height: number, colorMode: ColorMode): SpriteDocument {
  const layer = createLayer(tr('core.document.defaultLayer', { index: 1 }), width, height, colorMode)
  const palette = colorMode === 'indexed'
    ? [transparentEntry(), { id: 1, name: tr('core.document.inkBlack'), color: { r: 24, g: 27, b: 33, a: 255 } }, { id: 2, name: tr('core.document.moonBlue'), color: { r: 41, g: 121, b: 255, a: 255 } }]
    : [{ id: 1, name: tr('core.document.inkBlack'), color: { r: 24, g: 27, b: 33, a: 255 } }, { id: 2, name: tr('core.document.moonBlue'), color: { r: 41, g: 121, b: 255, a: 255 } }]
  const now = new Date().toISOString()
  const frameId = 'frame-1'
  const initialSurface = layer.format === 'rgba'
    ? { format: 'rgba' as const, width, height, offsetX: 0, offsetY: 0, pixels: layer.pixels }
    : { format: 'indexed' as const, width, height, offsetX: 0, offsetY: 0, pixels: layer.pixels }
  return {
    schemaVersion: 2,
    id: createId('doc'),
    name,
    width,
    height,
    colorMode,
    layers: [layer],
    groups: [],
    activeLayerId: layer.id,
    palette,
    paletteOrder: palette.map((entry) => entry.id),
    nextColorId: 3,
    customBrushes: [],
    animation: { frames: [{ id: frameId, duration: 100 }], cels: [{ id: createId('cel'), layerId: layer.id, frameId, opacity: layer.opacity, surface: initialSurface }], activeFrameId: frameId, loop: true },
    displaySettings: { ...DEFAULT_PROJECT_DISPLAY_SETTINGS, grid: { ...DEFAULT_PROJECT_DISPLAY_SETTINGS.grid } },
    statistics: { ...DEFAULT_PROJECT_STATISTICS },
    timelapse: { ...DEFAULT_TIMELAPSE_SETTINGS, enabled: loadEditorPreferences().timelapseRecordingEnabled, snapshots: [] },
    filePath: null,
    dirty: false,
    createdAt: now,
    updatedAt: now
  }
}

export function resizeDocumentAt(document: SpriteDocument, width: number, height: number, offsetX: number, offsetY: number, trimOutside = false): { offsetX: number; offsetY: number } {
  const horizontal = Math.trunc(offsetX)
  const vertical = Math.trunc(offsetY)
  for (const layer of document.layers) {
    // Layers are independent bitmaps. Changing the canvas only changes the
    // viewport; keeping their local pixels preserves content beyond its edges.
    layer.offsetX += horizontal
    layer.offsetY += vertical
  }
  document.width = width
  document.height = height
  if (trimOutside) cropLayersToCanvas(document)
  return { offsetX: horizontal, offsetY: vertical }
}

/** Permanently discards every stored layer pixel outside the current canvas. */
export function cropLayersToCanvas(document: SpriteDocument): void {
  for (const layer of document.layers) {
    const left = Math.max(0, layer.offsetX)
    const top = Math.max(0, layer.offsetY)
    const right = Math.min(document.width, layer.offsetX + layer.width)
    const bottom = Math.min(document.height, layer.offsetY + layer.height)
    const sourceX = left - layer.offsetX
    const sourceY = top - layer.offsetY
    const nextWidth = right - left
    const nextHeight = bottom - top
    const storageOrigin = layerStorageOrigins.get(layer) ?? { x: 0, y: 0 }
    if (nextWidth <= 0 || nextHeight <= 0) {
      layer.pixels = layer.format === 'rgba' ? new Uint8ClampedArray(4) : new Uint32Array(1)
      layer.width = 1
      layer.height = 1
      layer.offsetX = 0
      layer.offsetY = 0
      layerStorageOrigins.set(layer, { x: storageOrigin.x + sourceX, y: storageOrigin.y + sourceY })
      continue
    }
    if (left === layer.offsetX && top === layer.offsetY && nextWidth === layer.width && nextHeight === layer.height) continue
    if (layer.format === 'rgba') {
      const pixels = new Uint8ClampedArray(nextWidth * nextHeight * 4)
      for (let y = 0; y < nextHeight; y += 1) {
        const sourceOffset = ((sourceY + y) * layer.width + sourceX) * 4
        pixels.set(layer.pixels.subarray(sourceOffset, sourceOffset + nextWidth * 4), y * nextWidth * 4)
      }
      layer.pixels = pixels
    } else {
      const pixels = new Uint32Array(nextWidth * nextHeight)
      for (let y = 0; y < nextHeight; y += 1) {
        const sourceOffset = (sourceY + y) * layer.width + sourceX
        pixels.set(layer.pixels.subarray(sourceOffset, sourceOffset + nextWidth), y * nextWidth)
      }
      layer.pixels = pixels
    }
    layer.width = nextWidth
    layer.height = nextHeight
    layer.offsetX = left
    layer.offsetY = top
    layerStorageOrigins.set(layer, { x: storageOrigin.x + sourceX, y: storageOrigin.y + sourceY })
  }
}

export function resizeDocument(document: SpriteDocument, width: number, height: number, anchor: CanvasAnchor): { offsetX: number; offsetY: number } {
  const horizontal = anchor === 'nw' || anchor === 'w' || anchor === 'sw' ? 0 : anchor === 'ne' || anchor === 'e' || anchor === 'se' ? width - document.width : Math.floor((width - document.width) / 2)
  const vertical = anchor === 'nw' || anchor === 'n' || anchor === 'ne' ? 0 : anchor === 'sw' || anchor === 's' || anchor === 'se' ? height - document.height : Math.floor((height - document.height) / 2)
  return resizeDocumentAt(document, width, height, horizontal, vertical)
}

const clampIndex = (value: number, maximum: number): number => Math.max(0, Math.min(maximum - 1, value))

export function resizeDocumentImage(document: SpriteDocument, width: number, height: number, interpolation: ImageResizeInterpolation = 'nearest'): void {
  const sourceWidth = document.width
  const sourceHeight = document.height
  const scaleX = width / sourceWidth
  const scaleY = height / sourceHeight
  for (const layer of document.layers) {
    const sourceLayerWidth = layer.width
    const sourceLayerHeight = layer.height
    const sourceOffsetX = layer.offsetX
    const sourceOffsetY = layer.offsetY
    const targetOffsetX = Math.floor(sourceOffsetX * scaleX)
    const targetOffsetY = Math.floor(sourceOffsetY * scaleY)
    const targetRight = Math.ceil((sourceOffsetX + sourceLayerWidth) * scaleX)
    const targetBottom = Math.ceil((sourceOffsetY + sourceLayerHeight) * scaleY)
    const targetWidth = Math.max(1, targetRight - targetOffsetX)
    const targetHeight = Math.max(1, targetBottom - targetOffsetY)
    if (layer.format === 'indexed') {
      const source = new Uint32Array(layer.pixels)
      const target = new Uint32Array(targetWidth * targetHeight)
      for (let y = 0; y < targetHeight; y += 1) for (let x = 0; x < targetWidth; x += 1) {
        const worldX = targetOffsetX + x
        const worldY = targetOffsetY + y
        const sourceX = clampIndex(Math.floor((worldX + 0.5) / scaleX - sourceOffsetX), sourceLayerWidth)
        const sourceY = clampIndex(Math.floor((worldY + 0.5) / scaleY - sourceOffsetY), sourceLayerHeight)
        target[y * targetWidth + x] = source[sourceY * sourceLayerWidth + sourceX] ?? 0
      }
      layer.pixels = target
    } else {
      const source = new Uint8ClampedArray(layer.pixels)
      const target = new Uint8ClampedArray(targetWidth * targetHeight * 4)
      const read = (x: number, y: number): RgbaColor => {
        const offset = (clampIndex(y, sourceLayerHeight) * sourceLayerWidth + clampIndex(x, sourceLayerWidth)) * 4
        return { r: source[offset] ?? 0, g: source[offset + 1] ?? 0, b: source[offset + 2] ?? 0, a: source[offset + 3] ?? 0 }
      }
      for (let y = 0; y < targetHeight; y += 1) for (let x = 0; x < targetWidth; x += 1) {
        const sourceX = (targetOffsetX + x + 0.5) / scaleX - sourceOffsetX - 0.5
        const sourceY = (targetOffsetY + y + 0.5) / scaleY - sourceOffsetY - 0.5
        let color: RgbaColor
        if (interpolation === 'smooth') {
          const left = Math.floor(sourceX); const top = Math.floor(sourceY)
          const right = left + 1; const bottom = top + 1
          const fx = sourceX - left; const fy = sourceY - top
          const topLeft = read(left, top); const topRight = read(right, top); const bottomLeft = read(left, bottom); const bottomRight = read(right, bottom)
          const mix = (a: number, b: number, t: number): number => a + (b - a) * t
          color = {
            r: Math.round(mix(mix(topLeft.r, topRight.r, fx), mix(bottomLeft.r, bottomRight.r, fx), fy)),
            g: Math.round(mix(mix(topLeft.g, topRight.g, fx), mix(bottomLeft.g, bottomRight.g, fx), fy)),
            b: Math.round(mix(mix(topLeft.b, topRight.b, fx), mix(bottomLeft.b, bottomRight.b, fx), fy)),
            a: Math.round(mix(mix(topLeft.a, topRight.a, fx), mix(bottomLeft.a, bottomRight.a, fx), fy))
          }
        } else color = read(Math.floor(sourceX + 0.5), Math.floor(sourceY + 0.5))
        const offset = (y * targetWidth + x) * 4
        target[offset] = color.r; target[offset + 1] = color.g; target[offset + 2] = color.b; target[offset + 3] = color.a
      }
      layer.pixels = target
    }
    layer.width = targetWidth
    layer.height = targetHeight
    layer.offsetX = targetOffsetX
    layer.offsetY = targetOffsetY
  }
  document.width = width
  document.height = height
}

export const getActiveLayer = (document: SpriteDocument): RasterLayer => {
  const layer = document.layers.find((candidate) => candidate.id === document.activeLayerId)
  if (!layer) throw new Error(tr('core.document.activeLayerMissing'))
  return layer
}
export const getLayer = (document: SpriteDocument, id: string): RasterLayer => {
  const layer = document.layers.find((candidate) => candidate.id === id)
  if (!layer) throw new Error(tr('core.document.layerMissing'))
  return layer
}
export const getGroup = (document: SpriteDocument, id: string): LayerGroup => {
  const group = document.groups.find((candidate) => candidate.id === id)
  if (!group) throw new Error(tr('core.document.groupMissing'))
  return group
}
export const getDescendantGroupIds = (document: SpriteDocument, groupId: string): string[] => {
  const descendants: string[] = []
  const pending = [groupId]
  const visited = new Set<string>(pending)
  while (pending.length > 0) {
    const parentId = pending.shift()!
    for (const group of document.groups) {
      if (group.parentGroupId !== parentId || visited.has(group.id)) continue
      visited.add(group.id)
      descendants.push(group.id)
      pending.push(group.id)
    }
  }
  return descendants
}
export const getLayerIdsInGroup = (document: SpriteDocument, groupId: string): string[] => {
  const groupIds = new Set([groupId, ...getDescendantGroupIds(document, groupId)])
  return document.layers.filter((layer) => Boolean(layer.groupId && groupIds.has(layer.groupId))).map((layer) => layer.id)
}
export const getLayerLockingGroup = (document: SpriteDocument, layer: RasterLayer): LayerGroup | null => {
  const visited = new Set<string>()
  let groupId = layer.groupId ?? null
  while (groupId && !visited.has(groupId)) {
    visited.add(groupId)
    const group = document.groups.find((candidate) => candidate.id === groupId)
    if (!group) return null
    if (group.locked) return group
    groupId = group.parentGroupId ?? null
  }
  return null
}

export const getGroupLockingAncestor = (document: SpriteDocument, group: LayerGroup): LayerGroup | null => {
  const visited = new Set<string>([group.id])
  let groupId = group.parentGroupId ?? null
  while (groupId && !visited.has(groupId)) {
    visited.add(groupId)
    const parent = document.groups.find((candidate) => candidate.id === groupId)
    if (!parent) return null
    if (parent.locked) return parent
    groupId = parent.parentGroupId ?? null
  }
  return null
}

export const isLayerEffectivelyLocked = (document: SpriteDocument, layer: RasterLayer): boolean => layer.locked || Boolean(getLayerLockingGroup(document, layer))
export const isGroupEffectivelyLocked = (document: SpriteDocument, group: LayerGroup): boolean => group.locked || Boolean(getGroupLockingAncestor(document, group))
export const isLayerEffectivelyVisible = (document: SpriteDocument, layer: RasterLayer): boolean => {
  if (!layer.visible) return false
  const visited = new Set<string>()
  let groupId = layer.groupId ?? null
  while (groupId && !visited.has(groupId)) {
    visited.add(groupId)
    const group = document.groups.find((candidate) => candidate.id === groupId)
    if (!group) return true
    if (!group.visible) return false
    groupId = group.parentGroupId ?? null
  }
  return true
}
export const getPaletteEntry = (document: SpriteDocument, id: number): PaletteEntry => document.palette.find((entry) => entry.id === id) ?? transparentEntry()

export function findOrAddPaletteColor(document: SpriteDocument, color: RgbaColor, addToVisiblePalette = false): number {
  if (color.a === 0) {
    if (!document.palette.some((entry) => entry.id === 0)) document.palette.unshift(transparentEntry())
    if (addToVisiblePalette && !document.paletteOrder.includes(0)) document.paletteOrder.unshift(0)
    return 0
  }
  const existing = document.palette.find((entry) => colorEquals(entry.color, color))
  if (existing) {
    if (addToVisiblePalette && !document.paletteOrder.includes(existing.id)) document.paletteOrder.push(existing.id)
    return existing.id
  }
  const id = document.nextColorId++
  document.palette.push({ id, name: tr('core.document.colorName', { id }), color: { ...color } })
  if (addToVisiblePalette) document.paletteOrder.push(id)
  return id
}

export function readLayerColor(document: SpriteDocument, layer: RasterLayer, index: number): RgbaColor {
  return layer.format === 'rgba' ? readRgbaPixel(layer.pixels, index) : getPaletteEntry(document, layer.pixels[index]).color
}

/** Converts canvas coordinates to an index in a layer's private bitmap. */
export function layerIndexAt(layer: RasterLayer, x: number, y: number): number | null {
  const localX = x - layer.offsetX
  const localY = y - layer.offsetY
  if (localX < 0 || localY < 0 || localX >= layer.width || localY >= layer.height) return null
  return localY * layer.width + localX
}

/** Expands a layer bitmap without discarding pixels that currently sit outside the canvas. */
export function expandLayerToRect(layer: RasterLayer, left: number, top: number, right: number, bottom: number): boolean {
  const nextLeft = Math.min(layer.offsetX, Math.trunc(left))
  const nextTop = Math.min(layer.offsetY, Math.trunc(top))
  const nextRight = Math.max(layer.offsetX + layer.width, Math.trunc(right))
  const nextBottom = Math.max(layer.offsetY + layer.height, Math.trunc(bottom))
  const nextWidth = nextRight - nextLeft
  const nextHeight = nextBottom - nextTop
  if (nextWidth === layer.width && nextHeight === layer.height && nextLeft === layer.offsetX && nextTop === layer.offsetY) return true
  const pixelCount = nextWidth * nextHeight
  if (!Number.isSafeInteger(pixelCount) || pixelCount <= 0 || pixelCount > 64 * 1024 * 1024) return false
  const shiftX = layer.offsetX - nextLeft
  const shiftY = layer.offsetY - nextTop
  try {
    if (layer.format === 'rgba') {
      const pixels = new Uint8ClampedArray(pixelCount * 4)
      const destinationX = layer.offsetX - nextLeft
      const destinationY = layer.offsetY - nextTop
      for (let y = 0; y < layer.height; y += 1) {
        const sourceOffset = y * layer.width * 4
        const destinationOffset = ((destinationY + y) * nextWidth + destinationX) * 4
        pixels.set(layer.pixels.subarray(sourceOffset, sourceOffset + layer.width * 4), destinationOffset)
      }
      layer.pixels = pixels
    } else {
      const pixels = new Uint32Array(pixelCount)
      const destinationX = layer.offsetX - nextLeft
      const destinationY = layer.offsetY - nextTop
      for (let y = 0; y < layer.height; y += 1) {
        const sourceOffset = y * layer.width
        const destinationOffset = (destinationY + y) * nextWidth + destinationX
        pixels.set(layer.pixels.subarray(sourceOffset, sourceOffset + layer.width), destinationOffset)
      }
      layer.pixels = pixels
    }
  } catch {
    return false
  }
  layer.width = nextWidth
  layer.height = nextHeight
  layer.offsetX = nextLeft
  layer.offsetY = nextTop
  const storageOrigin = layerStorageOrigins.get(layer) ?? { x: 0, y: 0 }
  layerStorageOrigins.set(layer, { x: storageOrigin.x - shiftX, y: storageOrigin.y - shiftY })
  return true
}

export const ensureLayerCoversCanvas = (document: SpriteDocument, layer: RasterLayer): boolean =>
  expandLayerToRect(layer, 0, 0, document.width, document.height)

/** Stable bitmap coordinates used by history entries across layer expansion. */
export function layerStoragePoint(layer: RasterLayer, index: number): { x: number; y: number } {
  const origin = layerStorageOrigins.get(layer) ?? { x: 0, y: 0 }
  return { x: index % layer.width + origin.x, y: Math.floor(index / layer.width) + origin.y }
}

export const getLayerStorageOrigin = (layer: RasterLayer): { x: number; y: number } => ({ ...(layerStorageOrigins.get(layer) ?? { x: 0, y: 0 }) })

export const setLayerStorageOrigin = (layer: RasterLayer, origin: { x: number; y: number }): void => {
  layerStorageOrigins.set(layer, { x: Math.trunc(origin.x), y: Math.trunc(origin.y) })
}

export function layerIndexAtStoragePoint(layer: RasterLayer, x: number, y: number): number | null {
  const origin = layerStorageOrigins.get(layer) ?? { x: 0, y: 0 }
  const localX = x - origin.x
  const localY = y - origin.y
  if (localX < 0 || localY < 0 || localX >= layer.width || localY >= layer.height) return null
  return localY * layer.width + localX
}

export function readLayerColorAt(document: SpriteDocument, layer: RasterLayer, x: number, y: number): RgbaColor {
  const index = layerIndexAt(layer, x, y)
  return index === null ? TRANSPARENT : readLayerColor(document, layer, index)
}

/** Returns the canvas-space bounds of every non-transparent pixel stored by a layer. */
export function layerContentBounds(document: SpriteDocument, layer: RasterLayer): SelectionRect | null {
  let minX = layer.width
  let minY = layer.height
  let maxX = -1
  let maxY = -1
  const opaquePaletteIds = layer.format === 'indexed'
    ? new Set(document.palette.filter((entry) => entry.color.a > 0).map((entry) => entry.id))
    : null
  for (let y = 0; y < layer.height; y += 1) {
    for (let x = 0; x < layer.width; x += 1) {
      const index = y * layer.width + x
      const opaque = layer.format === 'rgba'
        ? layer.pixels[index * 4 + 3] > 0
        : opaquePaletteIds!.has(layer.pixels[index])
      if (!opaque) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  if (maxX < minX || maxY < minY) return null
  return {
    x: layer.offsetX + minX,
    y: layer.offsetY + minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  }
}

export function readLayerPackedAt(document: SpriteDocument, layer: RasterLayer, x: number, y: number): number | null {
  const index = layerIndexAt(layer, x, y)
  return index === null ? null : readLayerPacked(document, layer, index)
}
export function writeLayerColor(document: SpriteDocument, layer: RasterLayer, index: number, color: RgbaColor): void {
  if (layer.format === 'rgba') writeRgbaPixel(layer.pixels, index, color)
  else layer.pixels[index] = findOrAddPaletteColor(document, color)
}
export function readLayerPacked(_document: SpriteDocument, layer: RasterLayer, index: number): number {
  if (layer.format === 'indexed') return layer.pixels[index]
  const offset = index * 4
  return (layer.pixels[offset] | (layer.pixels[offset + 1] << 8) | (layer.pixels[offset + 2] << 16) | (layer.pixels[offset + 3] << 24)) >>> 0
}
export function writeLayerPacked(_document: SpriteDocument, layer: RasterLayer, index: number, value: number): void {
  if (layer.format === 'indexed') { layer.pixels[index] = value; return }
  const offset = index * 4
  layer.pixels[offset] = value & 0xff
  layer.pixels[offset + 1] = (value >>> 8) & 0xff
  layer.pixels[offset + 2] = (value >>> 16) & 0xff
  layer.pixels[offset + 3] = (value >>> 24) & 0xff
}

export function duplicateLayer(document: SpriteDocument, layerId: string): RasterLayer {
  const source = getLayer(document, layerId)
  const copy = source.format === 'rgba'
    ? { ...source, id: createId('layer'), name: `${source.name} ${tr('core.document.copySuffix')}`, pixels: new Uint8ClampedArray(source.pixels) } as RgbaLayer
    : { ...source, id: createId('layer'), name: `${source.name} ${tr('core.document.copySuffix')}`, pixels: new Uint32Array(source.pixels) } as IndexedLayer
  document.layers.splice(document.layers.findIndex((layer) => layer.id === layerId) + 1, 0, copy)
  document.activeLayerId = copy.id
  return copy
}

export function convertDocumentColorMode(document: SpriteDocument, target: ColorMode): void {
  if (document.colorMode === target) return
  if (target === 'indexed') {
    const palette: PaletteEntry[] = [transparentEntry()]
    const colorIds = new Map<number, number>()
    let nextId = 1
    for (const layer of document.layers) {
      const indexed = new Uint32Array(layer.width * layer.height)
      for (let index = 0; index < indexed.length; index += 1) {
        const color = readLayerColor(document, layer, index)
        if (color.a === 0) continue
        const packed = packColor(color)
        let id = colorIds.get(packed)
        if (!id) { id = nextId++; colorIds.set(packed, id); palette.push({ id, name: tr('core.document.colorName', { id }), color }) }
        indexed[index] = id
      }
      Object.assign(layer, { format: 'indexed', pixels: indexed })
    }
    document.palette = palette
    document.paletteOrder = palette.map((entry) => entry.id)
    document.nextColorId = nextId
  } else {
    for (const layer of document.layers) {
      const rgba = new Uint8ClampedArray(layer.width * layer.height * 4)
      for (let index = 0; index < layer.width * layer.height; index += 1) writeRgbaPixel(rgba, index, readLayerColor(document, layer, index))
      Object.assign(layer, { format: 'rgba', pixels: rgba })
    }
    document.palette = document.palette.filter((entry) => entry.id !== 0)
    document.paletteOrder = document.palette.map((entry) => entry.id)
  }
  document.colorMode = target
}

export function compositeRegion(document: SpriteDocument, startX: number, startY: number, width: number, height: number): Uint8ClampedArray {
  const output = new Uint8ClampedArray(width * height * 4)
  if (document.groups.length === 0 && document.layers.length === 1) {
    const layer = document.layers[0]
    if (!layer.visible || layer.opacity <= 0) return output
    if (layer.opacity === 1 && layer.format === 'rgba') {
      for (let y = 0; y < height; y += 1) {
        const localY = startY + y - layer.offsetY
        const localStartX = startX - layer.offsetX
        const fromX = Math.max(0, localStartX)
        const toX = Math.min(layer.width, localStartX + width)
        if (localY < 0 || localY >= layer.height || toX <= fromX) continue
        const destinationX = fromX - localStartX
        const sourceOffset = (localY * layer.width + fromX) * 4
        output.set(layer.pixels.subarray(sourceOffset, sourceOffset + (toX - fromX) * 4), (y * width + destinationX) * 4)
      }
      return output
    }
    if (layer.opacity === 1 && layer.format === 'indexed') {
      const palette = new Map(document.palette.map((entry) => [entry.id, entry.color]))
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        const index = layerIndexAt(layer, startX + x, startY + y)
        const color = index === null ? TRANSPARENT : (palette.get(layer.pixels[index]) ?? TRANSPARENT)
        writeRgbaPixel(output, y * width + x, color)
      }
      return output
    }
  }
  const sample = createCompositePointSampler(document)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    writeRgbaPixel(output, y * width + x, sample(startX + x, startY + y))
  }
  return output
}

export function compositePixel(document: SpriteDocument, index: number): RgbaColor {
  return compositePixelWithLayerColor(document, index)
}

/** Composites a pixel while optionally substituting one layer's source color. */
export function createCompositePointSampler(document: SpriteDocument, layerId?: string, replacement?: RgbaColor): (x: number, y: number) => RgbaColor {
  const groupById = new Map(document.groups.map((group) => [group.id, group]))
  const layerOrder = new Map(document.layers.map((layer, order) => [layer.id, order]))
  const groupOrder = new Map(document.groups.map((group, order) => [group.id, order]))
  const anchorCache = new Map<string, number>()
  const groupAnchor = (groupId: string, visiting = new Set<string>()): number => {
    const cached = anchorCache.get(groupId)
    if (cached !== undefined) return cached
    if (visiting.has(groupId)) return Number.POSITIVE_INFINITY
    const nextVisiting = new Set(visiting).add(groupId)
    let anchor = Number.POSITIVE_INFINITY
    for (const layer of document.layers) if (layer.groupId === groupId) anchor = Math.min(anchor, layerOrder.get(layer.id) ?? anchor)
    for (const child of document.groups) if (child.parentGroupId === groupId) anchor = Math.min(anchor, groupAnchor(child.id, nextVisiting))
    anchorCache.set(groupId, anchor)
    return anchor
  }

  const paletteById = new Map(document.palette.map((entry) => [entry.id, entry.color]))
  type CompiledItem = { kind: 'layer'; layer: RasterLayer; read: (x: number, y: number) => RgbaColor } | { kind: 'group'; group: LayerGroup; children: CompiledItem[] }
  const compileLayer = (layer: RasterLayer): CompiledItem => {
    const readIndex = (x: number, y: number): number | null => layerIndexAt(layer, x, y)
    if (layer.id === layerId && replacement) {
      return {
        kind: 'layer',
        layer,
        read: (x, y) => x >= 0 && y >= 0 && x < document.width && y < document.height ? replacement : TRANSPARENT
      }
    }
    if (layer.format === 'rgba') {
      const pixels = layer.pixels
      return { kind: 'layer', layer, read: (x, y) => { const local = readIndex(x, y); return local === null ? TRANSPARENT : readRgbaPixel(pixels, local) } }
    }
    const pixels = layer.pixels
    return { kind: 'layer', layer, read: (x, y) => { const local = readIndex(x, y); return local === null ? TRANSPARENT : (paletteById.get(pixels[local]) ?? TRANSPARENT) } }
  }
  const compileContainer = (parentGroupId: string | null, visiting: Set<string>): CompiledItem[] => {
    const items: Array<
      | { kind: 'layer'; layer: RasterLayer; order: number; tie: number }
      | { kind: 'group'; group: LayerGroup; order: number; tie: number }
    > = []
    for (const layer of document.layers) {
      const directParent = layer.groupId && groupById.has(layer.groupId) ? layer.groupId : null
      if (directParent === parentGroupId) items.push({ kind: 'layer', layer, order: layerOrder.get(layer.id) ?? 0, tie: 0 })
    }
    for (const group of document.groups) {
      const directParent = group.parentGroupId && groupById.has(group.parentGroupId) && group.parentGroupId !== group.id ? group.parentGroupId : null
      if (directParent === parentGroupId) items.push({ kind: 'group', group, order: groupAnchor(group.id), tie: groupOrder.get(group.id) ?? 0 })
    }
    items.sort((left, right) => left.order - right.order || left.tie - right.tie)
    return items.flatMap((item): CompiledItem[] => {
      if (item.kind === 'layer') return [compileLayer(item.layer)]
      if (visiting.has(item.group.id)) return []
      return [{ kind: 'group', group: item.group, children: compileContainer(item.group.id, new Set(visiting).add(item.group.id)) }]
    })
  }

  const root = compileContainer(null, new Set())
  const compositeContainer = (items: CompiledItem[], x: number, y: number): RgbaColor => {
    let color = TRANSPARENT
    for (const item of items) {
      if (item.kind === 'layer') {
        if (!item.layer.visible || item.layer.opacity <= 0) continue
        const source = item.read(x, y)
        if (source.a === 0) continue
        color = item.layer.opacity === 1 && (color.a === 0 || (item.layer.blendMode === 'normal' && source.a === 255))
          ? source
          : blendWithMode(color, source, item.layer.opacity, item.layer.blendMode)
        continue
      }
      if (!item.group.visible || item.group.opacity <= 0) continue
      const groupColor = compositeContainer(item.children, x, y)
      if (groupColor.a === 0) continue
      color = item.group.opacity === 1 && (color.a === 0 || (item.group.blendMode === 'normal' && groupColor.a === 255))
        ? groupColor
        : blendWithMode(color, groupColor, item.group.opacity, item.group.blendMode)
    }
    return color
  }
  return (x, y) => compositeContainer(root, x, y)
}

/** Composites document coordinates through the same compiled layer tree. */
export function createCompositeSampler(document: SpriteDocument, layerId?: string, replacement?: RgbaColor): (index: number) => RgbaColor {
  const samplePoint = createCompositePointSampler(document, layerId, replacement)
  return (index) => samplePoint(index % document.width, Math.floor(index / document.width))
}

export function compositePixelWithLayerColor(document: SpriteDocument, index: number, layerId?: string, replacement?: RgbaColor): RgbaColor {
  return createCompositeSampler(document, layerId, replacement)(index)
}
export const compositeDocument = (document: SpriteDocument): Uint8ClampedArray => compositeRegion(document, 0, 0, document.width, document.height)
