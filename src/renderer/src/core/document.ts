import type { AnimationCel, AnimationTimeline, BlendMode, CanvasAnchor, ColorMode, ImageResizeInterpolation, IndexedLayer, LayerGroup, LayerMask, PaletteEntry, RasterLayer, RgbaColor, RgbaLayer, SelectionRect, SpriteDocument } from '@shared/types'
import { blendWithMode, colorEquals, packColor, pixelIndex, readRgbaPixel, TRANSPARENT, unpackColor, writeRgbaPixel } from './raster'
import { translateCurrent as tr } from './localization'
import { loadEditorPreferences } from './file-preferences'
import { DEFAULT_PROJECT_DISPLAY_SETTINGS, DEFAULT_PROJECT_STATISTICS, DEFAULT_TIMELAPSE_SETTINGS } from './project-metadata'
import { buildLayerPanelTree } from './layer-panel-layout'
import { addPaletteIdToSlots, normalizePaletteColumns, normalizePaletteSlots, paletteOrderFromSlots, PALETTE_GRID_COLUMNS } from './palette-layout'

let sequence = 0
const layerStorageOrigins = new WeakMap<RasterLayer, { x: number; y: number }>()
const layerContentRevisions = new WeakMap<RasterLayer, number>()
export const createId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${(++sequence).toString(36)}`
const transparentEntry = (): PaletteEntry => ({ id: 0, name: tr('core.document.transparentColor'), color: TRANSPARENT })

const maskGray = (color: RgbaColor): number => Math.max(0, Math.min(255, Math.round((color.r * 2126 + color.g * 7152 + color.b * 722) / 10000)))
const maskCoverageFromColor = (color: RgbaColor): number => color.a === 0 ? 255 : Math.round(255 + (maskGray(color) - 255) * color.a / 255)
const normalizedMaskColor = (color: RgbaColor): RgbaColor => color.a === 0
  ? TRANSPARENT
  : { r: maskCoverageFromColor(color), g: maskCoverageFromColor(color), b: maskCoverageFromColor(color), a: 255 }
export const layerMaskDisplayColor = (color: RgbaColor): RgbaColor => {
  const value = maskCoverageFromColor(color)
  return { r: value, g: value, b: value, a: 255 }
}
const maskPacked = (color: RgbaColor): number => {
  const normalized = normalizedMaskColor(color)
  return (normalized.r | (normalized.g << 8) | (normalized.b << 16) | (normalized.a << 24)) >>> 0
}

export function createLayerMask(ownerId: string, width: number, height: number, ownerKind: LayerMask['ownerKind'] = 'cel'): LayerMask {
  const pixels = new Uint8ClampedArray(width * height * 4)
  return {
    id: createId('mask'),
    name: tr(ownerKind === 'group' ? 'core.document.layerGroupMask' : 'core.document.layerMask'),
    description: '',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    width,
    height,
    offsetX: 0,
    offsetY: 0,
    format: 'rgba',
    pixels,
    ownerKind,
    ownerId
  }
}

export const isLayerMask = (surface: RasterLayer): surface is LayerMask => 'ownerKind' in surface && 'ownerId' in surface
export const layerMasks = (document: SpriteDocument): LayerMask[] => document.animation
  ? [...document.animation.cels.flatMap((cel) => cel.mask ? [cel.mask] : []), ...(document.animation.groupMasks ?? []).map((entry) => entry.mask)]
  : []
export const findLayerMask = (document: SpriteDocument, id: string): LayerMask | null => layerMasks(document).find((mask) => mask.id === id) ?? null
export const animationMaskSlotAt = (timeline: AnimationTimeline, ownerId: string, frameId: string): LayerMask | null => {
  const cel = timeline.cels.find((candidate) => candidate.layerId === ownerId && candidate.frameId === frameId)
  if (cel?.mask) return cel.mask
  if (cel?.linkedCelId) {
    const source = timeline.cels.find((candidate) => candidate.id === cel.linkedCelId)
    if (source?.mask) return source.mask
  }
  return (timeline.groupMasks ?? []).find((entry) => entry.groupId === ownerId && entry.frameId === frameId)?.mask ?? null
}
export const resolveAnimationMask = (timeline: AnimationTimeline, mask: LayerMask | null): LayerMask | null => {
  if (!mask?.linkedMaskId) return mask
  const byId = new Map([...timeline.cels.flatMap((cel) => cel.mask ? [cel.mask] : []), ...(timeline.groupMasks ?? []).map((entry) => entry.mask)].map((candidate) => [candidate.id, candidate]))
  const visited = new Set<string>()
  let current = mask
  while (current.linkedMaskId) {
    if (visited.has(current.id)) return mask
    visited.add(current.id)
    const linked = byId.get(current.linkedMaskId)
    if (!linked) return mask
    current = linked
  }
  return current
}
export const animationMaskAt = (timeline: AnimationTimeline, ownerId: string, frameId: string): LayerMask | null =>
  resolveAnimationMask(timeline, animationMaskSlotAt(timeline, ownerId, frameId))
export type LayerMaskOwner =
  | { kind: 'cel'; frameId: string; layerId: string; cel: AnimationCel }
  | { kind: 'group'; frameId: string; groupId: string; group: LayerGroup }
export const getLayerMaskOwner = (document: SpriteDocument, mask: LayerMask): LayerMaskOwner | null => {
  if (mask.ownerKind === 'group') {
    const entry = document.animation?.groupMasks?.find((candidate) => candidate.mask.id === mask.id)
    const group = entry ? document.groups.find((candidate) => candidate.id === entry.groupId) : null
    return entry && group ? { kind: 'group', frameId: entry.frameId, groupId: group.id, group } : null
  }
  const cel = document.animation?.cels.find((candidate) => candidate.id === mask.ownerId)
  return cel ? { kind: 'cel', frameId: cel.frameId, layerId: cel.layerId, cel } : null
}

export const readLayerMaskDisplayColorAt = (mask: LayerMask, x: number, y: number): RgbaColor => {
  const index = layerIndexAt(mask, x, y)
  return index === null ? { r: 255, g: 255, b: 255, a: 255 } : layerMaskDisplayColor(readRgbaPixel(mask.pixels, index))
}

/** Renders a mask as an isolated white-backed grayscale surface for mask editing. */
export const renderLayerMaskRegion = (mask: LayerMask, x: number, y: number, width: number, height: number): Uint8ClampedArray => {
  const outputWidth = Math.max(0, Math.trunc(width))
  const outputHeight = Math.max(0, Math.trunc(height))
  const output = new Uint8ClampedArray(outputWidth * outputHeight * 4)
  for (let localY = 0; localY < outputHeight; localY += 1) for (let localX = 0; localX < outputWidth; localX += 1) {
    const color = readLayerMaskDisplayColorAt(mask, Math.trunc(x) + localX, Math.trunc(y) + localY)
    const offset = (localY * outputWidth + localX) * 4
    output[offset] = color.r
    output[offset + 1] = color.g
    output[offset + 2] = color.b
    output[offset + 3] = 255
  }
  return output
}

const activeCelMasksByLayer = (document: SpriteDocument): Map<string, LayerMask> => {
  const timeline = document.animation
  if (!timeline) return new Map()
  return new Map(timeline.cels
    .filter((cel) => cel.frameId === timeline.activeFrameId)
    .map((cel) => [cel.layerId, animationMaskAt(timeline, cel.layerId, cel.frameId)] as const)
    .filter((entry): entry is readonly [string, LayerMask] => {
      const mask = entry[1]
      if (!mask) return false
      return mask.visible !== false
    }))
}

const activeGroupMasksByGroup = (document: SpriteDocument): Map<string, LayerMask> => {
  const timeline = document.animation
  if (!timeline) return new Map()
  return new Map((timeline.groupMasks ?? [])
    .filter((entry) => entry.frameId === timeline.activeFrameId)
    .map((entry) => [entry.groupId, resolveAnimationMask(timeline, entry.mask)] as const)
    .filter((entry): entry is readonly [string, LayerMask] => Boolean(entry[1] && entry[1].visible !== false)))
}

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
    schemaVersion: 4,
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
    paletteSlots: normalizePaletteSlots(palette.map((entry) => entry.id), palette.map((entry) => entry.id)),
    paletteColumns: PALETTE_GRID_COLUMNS,
    nextColorId: 3,
    customBrushes: [],
    animation: { frames: [{ id: frameId, duration: 100 }], cels: [{ id: createId('cel'), layerId: layer.id, frameId, opacity: layer.opacity, surface: initialSurface }], groupMasks: [], activeFrameId: frameId, loop: true },
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
  for (const mask of layerMasks(document)) {
    mask.offsetX += horizontal
    mask.offsetY += vertical
  }
  document.width = width
  document.height = height
  if (trimOutside) cropLayersToCanvas(document)
  return { offsetX: horizontal, offsetY: vertical }
}

/** Permanently discards every stored layer pixel outside the current canvas. */
export function cropLayersToCanvas(document: SpriteDocument): void {
  for (const layer of [...document.layers, ...layerMasks(document)]) {
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
      layer.pixels = isLayerMask(layer)
        ? new Uint8ClampedArray(4)
        : layer.format === 'rgba' ? new Uint8ClampedArray(4) : new Uint32Array(1)
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
  for (const layer of [...document.layers, ...layerMasks(document)]) {
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
        if (isLayerMask(layer)) {
          const normalized = normalizedMaskColor(color)
          target[offset] = normalized.r; target[offset + 1] = normalized.g; target[offset + 2] = normalized.b; target[offset + 3] = normalized.a
        } else {
          target[offset] = color.r; target[offset + 1] = color.g; target[offset + 2] = color.b; target[offset + 3] = color.a
        }
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
  const layer = document.layers.find((candidate) => candidate.id === id) ?? findLayerMask(document, id)
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

export const isGroupEffectivelyVisible = (document: SpriteDocument, group: LayerGroup): boolean => {
  if (!group.visible) return false
  const visited = new Set<string>([group.id])
  let groupId = group.parentGroupId ?? null
  while (groupId && !visited.has(groupId)) {
    visited.add(groupId)
    const parent = document.groups.find((candidate) => candidate.id === groupId)
    if (!parent) return true
    if (!parent.visible) return false
    groupId = parent.parentGroupId ?? null
  }
  return true
}
export const isLayerEffectivelyLocked = (document: SpriteDocument, layer: RasterLayer): boolean => {
  if (!isLayerMask(layer)) return layer.locked || Boolean(getLayerLockingGroup(document, layer))
  const owner = getLayerMaskOwner(document, layer)
  if (owner?.kind === 'group') return isGroupEffectivelyLocked(document, owner.group)
  const ownerLayer = owner ? document.layers.find((candidate) => candidate.id === owner.layerId) : null
  return !ownerLayer || isLayerEffectivelyLocked(document, ownerLayer)
}
export const isGroupEffectivelyLocked = (document: SpriteDocument, group: LayerGroup): boolean => group.locked || Boolean(getGroupLockingAncestor(document, group))
export const isLayerEffectivelyVisible = (document: SpriteDocument, layer: RasterLayer): boolean => {
  if (isLayerMask(layer)) {
    const owner = getLayerMaskOwner(document, layer)
    if (owner?.kind === 'group') return isGroupEffectivelyVisible(document, owner.group)
    const ownerLayer = owner ? document.layers.find((candidate) => candidate.id === owner.layerId) : null
    return Boolean(ownerLayer && isLayerEffectivelyVisible(document, ownerLayer))
  }
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
  const addVisibleColor = (id: number): void => {
    const columns = normalizePaletteColumns(document.paletteColumns)
    const currentSlots = normalizePaletteSlots(document.palette.map((entry) => entry.id), document.paletteOrder, document.paletteSlots, columns)
    const slots = document.paletteOrder.includes(id) ? currentSlots : addPaletteIdToSlots(currentSlots, id, columns)
    document.paletteSlots = slots
    document.paletteColumns = columns
    document.paletteOrder = paletteOrderFromSlots(slots)
  }
  if (color.a === 0) {
    if (!document.palette.some((entry) => entry.id === 0)) document.palette.unshift(transparentEntry())
    if (addToVisiblePalette) addVisibleColor(0)
    return 0
  }
  const existing = document.palette.find((entry) => colorEquals(entry.color, color))
  if (existing) {
    if (addToVisiblePalette) addVisibleColor(existing.id)
    return existing.id
  }
  const id = document.nextColorId++
  document.palette.push({ id, name: tr('core.document.colorName', { id }), color: { ...color } })
  if (addToVisiblePalette) addVisibleColor(id)
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

export const getLayerContentRevision = (layer: RasterLayer): number => layerContentRevisions.get(layer) ?? 0

export const markLayerContentChanged = (layer: RasterLayer): void => {
  layerContentRevisions.set(layer, getLayerContentRevision(layer) + 1)
}

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
  markLayerContentChanged(layer)
  if (isLayerMask(layer)) {
    writeRgbaPixel(layer.pixels, index, normalizedMaskColor(color))
  } else if (layer.format === 'rgba') writeRgbaPixel(layer.pixels, index, color)
  else layer.pixels[index] = findOrAddPaletteColor(document, color)
}
export function readLayerPacked(_document: SpriteDocument, layer: RasterLayer, index: number): number {
  if (layer.format === 'indexed') return layer.pixels[index]
  const offset = index * 4
  return (layer.pixels[offset] | (layer.pixels[offset + 1] << 8) | (layer.pixels[offset + 2] << 16) | (layer.pixels[offset + 3] << 24)) >>> 0
}
export function writeLayerPacked(_document: SpriteDocument, layer: RasterLayer, index: number, value: number): void {
  if (isLayerMask(layer)) {
    value = maskPacked(unpackColor(value))
  }
  if (layer.format === 'indexed') { layer.pixels[index] = value; return }
  const offset = index * 4
  layer.pixels[offset] = value & 0xff
  layer.pixels[offset + 1] = (value >>> 8) & 0xff
  layer.pixels[offset + 2] = (value >>> 16) & 0xff
  layer.pixels[offset + 3] = (value >>> 24) & 0xff
}

/** Writes a packed value across one local bitmap row without per-pixel dispatch. */
export function writeLayerPackedRun(document: SpriteDocument, layer: RasterLayer, start: number, length: number, value: number): void {
  const count = Math.min(layer.width - (start % layer.width), length)
  if (count <= 0) return
  if (isLayerMask(layer)) {
    value = maskPacked(unpackColor(value))
  } else if (layer.format === 'indexed') {
    layer.pixels.fill(value, start, start + count)
    return
  }
  if (layer.pixels.byteOffset % 4 === 0) {
    const words = new Uint32Array(layer.pixels.buffer as ArrayBuffer, layer.pixels.byteOffset, layer.pixels.byteLength / 4)
    words.fill(value, start, start + count)
    return
  }
  for (let index = start; index < start + count; index += 1) writeLayerPacked(document, layer, index, value)
}

export function duplicateLayer(document: SpriteDocument, layerId: string): RasterLayer {
  const source = getLayer(document, layerId)
  const copyId = createId('layer')
  const copy = source.format === 'rgba'
    ? { ...source, id: copyId, name: `${source.name} ${tr('core.document.copySuffix')}`, pixels: new Uint8ClampedArray(source.pixels) } as RgbaLayer
    : { ...source, id: copyId, name: `${source.name} ${tr('core.document.copySuffix')}`, pixels: new Uint32Array(source.pixels) } as IndexedLayer
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
    document.paletteColumns = PALETTE_GRID_COLUMNS
    document.paletteSlots = normalizePaletteSlots(document.palette.map((entry) => entry.id), document.paletteOrder, undefined, document.paletteColumns)
    document.nextColorId = nextId
  } else {
    for (const layer of document.layers) {
      const rgba = new Uint8ClampedArray(layer.width * layer.height * 4)
      for (let index = 0; index < layer.width * layer.height; index += 1) writeRgbaPixel(rgba, index, readLayerColor(document, layer, index))
      Object.assign(layer, { format: 'rgba', pixels: rgba })
    }
    document.palette = document.palette.filter((entry) => entry.id !== 0)
    document.paletteOrder = document.palette.map((entry) => entry.id)
    document.paletteColumns = PALETTE_GRID_COLUMNS
    document.paletteSlots = normalizePaletteSlots(document.palette.map((entry) => entry.id), document.paletteOrder, undefined, document.paletteColumns)
  }
  document.colorMode = target
}

type CompositeStackItem =
  | { kind: 'layer'; layer: RasterLayer }
  | { kind: 'group'; group: LayerGroup; children: CompositeStackItem[] }

/** Uses the visible layer-panel order as the single source of truth for compositing order. */
const buildCompositeStack = (document: SpriteDocument): CompositeStackItem[] => {
  const layerById = new Map(document.layers.map((layer) => [layer.id, layer]))
  const groupById = new Map(document.groups.map((group) => [group.id, group]))
  const root: CompositeStackItem[] = []
  const containers: CompositeStackItem[][] = [root]

  for (const node of buildLayerPanelTree({ layers: document.layers, groups: document.groups })) {
    const container = containers[node.depth]
    if (!container) continue
    containers.length = node.depth + 1
    if (node.kind === 'layer') {
      const layer = layerById.get(node.id)
      if (layer) container.push({ kind: 'layer', layer })
      continue
    }
    const group = groupById.get(node.id)
    if (!group) continue
    const item: CompositeStackItem = { kind: 'group', group, children: [] }
    container.push(item)
    containers[node.depth + 1] = item.children
  }

  const reverseContainers = (items: CompositeStackItem[]): void => {
    items.reverse()
    for (const item of items) if (item.kind === 'group') reverseContainers(item.children)
  }
  reverseContainers(root)
  return root
}

const normalCompositeLayers = (document: SpriteDocument): RasterLayer[] | null => {
  if (document.layers.some((layer) => layer.blendMode !== 'normal' || layer.clippingMask === true) || activeCelMasksByLayer(document).size > 0) return null
  if (document.groups.some((group) => group.blendMode !== 'normal' || group.opacity !== 1 || group.cumulativeBlend === true || group.clippingMask === true) || activeGroupMasksByGroup(document).size > 0) return null

  const flatten = (items: readonly CompositeStackItem[]): RasterLayer[] => {
    const layers: RasterLayer[] = []
    for (const item of items) {
      if (item.kind === 'layer') {
        if (item.layer.visible && item.layer.opacity > 0) layers.push(item.layer)
        continue
      }
      if (item.group.visible) layers.push(...flatten(item.children))
    }
    return layers
  }
  return flatten(buildCompositeStack(document))
}

export class DocumentCompositeCache {
  private rowRanges = new WeakMap<object, Map<string, Int32Array>>()

  rowsFor(layer: RasterLayer, palette: readonly PaletteEntry[], _revision: number): Int32Array {
    const paletteKey = layer.format === 'rgba' ? 'rgba' : palette.map((entry) => `${entry.id}:${entry.color.a}`).join(',')
    const key = `${layer.format}:${layer.width}:${layer.height}:${getLayerContentRevision(layer)}:${paletteKey}`
    const entries = this.rowRanges.get(layer.pixels) ?? new Map<string, Int32Array>()
    const cached = entries.get(key)
    if (cached) return cached
    const ranges = new Int32Array(layer.height * 2)
    const opaqueIds = layer.format === 'indexed' ? new Set(palette.filter((entry) => entry.color.a > 0).map((entry) => entry.id)) : null
    for (let y = 0; y < layer.height; y += 1) {
      let left = layer.width
      let right = 0
      for (let x = 0; x < layer.width; x += 1) {
        const index = y * layer.width + x
        const visible = layer.format === 'rgba' ? layer.pixels[index * 4 + 3] > 0 : opaqueIds!.has(layer.pixels[index])
        if (!visible) continue
        left = Math.min(left, x)
        right = x + 1
      }
      ranges[y * 2] = left
      ranges[y * 2 + 1] = right
    }
    entries.set(key, ranges)
    this.rowRanges.set(layer.pixels, entries)
    return ranges
  }
}

const compositeNormalLayers = (document: SpriteDocument, layers: readonly RasterLayer[], startX: number, startY: number, width: number, height: number, cache?: DocumentCompositeCache, revision = 0): Uint8ClampedArray => {
  const output = new Uint8ClampedArray(width * height * 4)
  const paletteById = new Map(document.palette.map((entry) => [entry.id, entry.color]))
  for (const layer of layers) {
    const layerLeft = Math.max(startX, layer.offsetX)
    const top = Math.max(startY, layer.offsetY)
    const layerRight = Math.min(startX + width, layer.offsetX + layer.width)
    const bottom = Math.min(startY + height, layer.offsetY + layer.height)
    if (layerRight <= layerLeft || bottom <= top) continue
    const opacity = layer.opacity
    const rowRanges = cache?.rowsFor(layer, document.palette, revision)
    for (let documentY = top; documentY < bottom; documentY += 1) {
      const localY = documentY - layer.offsetY
      const left = rowRanges ? Math.max(layerLeft, layer.offsetX + rowRanges[localY * 2]) : layerLeft
      const right = rowRanges ? Math.min(layerRight, layer.offsetX + rowRanges[localY * 2 + 1]) : layerRight
      if (right <= left) continue
      let sourceIndex = (documentY - layer.offsetY) * layer.width + left - layer.offsetX
      let outputOffset = ((documentY - startY) * width + left - startX) * 4
      for (let documentX = left; documentX < right; documentX += 1, sourceIndex += 1, outputOffset += 4) {
        let sourceR: number
        let sourceG: number
        let sourceB: number
        let sourceA: number
        if (layer.format === 'rgba') {
          const sourceOffset = sourceIndex * 4
          sourceR = layer.pixels[sourceOffset]
          sourceG = layer.pixels[sourceOffset + 1]
          sourceB = layer.pixels[sourceOffset + 2]
          sourceA = layer.pixels[sourceOffset + 3]
        } else {
          const source = paletteById.get(layer.pixels[sourceIndex]) ?? TRANSPARENT
          sourceR = source.r
          sourceG = source.g
          sourceB = source.b
          sourceA = source.a
        }
        if (sourceA === 0) continue
        const bottomA = output[outputOffset + 3]
        if (opacity === 1 && (bottomA === 0 || sourceA === 255)) {
          output[outputOffset] = sourceR
          output[outputOffset + 1] = sourceG
          output[outputOffset + 2] = sourceB
          output[outputOffset + 3] = sourceA
          continue
        }
        const topAlpha = sourceA / 255 * opacity
        const bottomAlpha = bottomA / 255
        const outputAlpha = topAlpha + bottomAlpha * (1 - topAlpha)
        if (outputAlpha <= 0) continue
        output[outputOffset] = Math.round((sourceR * topAlpha + output[outputOffset] * bottomAlpha * (1 - topAlpha)) / outputAlpha)
        output[outputOffset + 1] = Math.round((sourceG * topAlpha + output[outputOffset + 1] * bottomAlpha * (1 - topAlpha)) / outputAlpha)
        output[outputOffset + 2] = Math.round((sourceB * topAlpha + output[outputOffset + 2] * bottomAlpha * (1 - topAlpha)) / outputAlpha)
        output[outputOffset + 3] = Math.round(outputAlpha * 255)
      }
    }
  }
  return output
}

export function compositeRegion(document: SpriteDocument, startX: number, startY: number, width: number, height: number, cache?: DocumentCompositeCache, revision = 0): Uint8ClampedArray {
  const output = new Uint8ClampedArray(width * height * 4)
  const activeMasks = activeCelMasksByLayer(document)
  if (document.groups.length === 0 && document.layers.length === 1) {
    const layer = document.layers[0]
    if (!layer.visible || layer.opacity <= 0) return output
    if (!activeMasks.has(layer.id) && layer.opacity === 1 && layer.format === 'rgba') {
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
    if (!activeMasks.has(layer.id) && layer.opacity === 1 && layer.format === 'indexed') {
      const palette = new Map(document.palette.map((entry) => [entry.id, entry.color]))
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        const index = layerIndexAt(layer, startX + x, startY + y)
        const color = index === null ? TRANSPARENT : (palette.get(layer.pixels[index]) ?? TRANSPARENT)
        writeRgbaPixel(output, y * width + x, color)
      }
      return output
    }
  }
  const normalLayers = normalCompositeLayers(document)
  if (normalLayers) return compositeNormalLayers(document, normalLayers, startX, startY, width, height, cache, revision)
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
  const compileContainer = (items: readonly CompositeStackItem[]): CompiledItem[] => items.map((item) => item.kind === 'layer'
    ? compileLayer(item.layer)
    : { kind: 'group', group: item.group, children: compileContainer(item.children) })

  const root = compileContainer(buildCompositeStack(document))
  const activeMasks = activeCelMasksByLayer(document)
  const activeGroupMasks = activeGroupMasksByGroup(document)
  const itemMask = (item: CompiledItem): LayerMask | undefined => item.kind === 'layer' ? activeMasks.get(item.layer.id) : activeGroupMasks.get(item.group.id)
  const readMaskCoverage = (mask: LayerMask, x: number, y: number): number => {
    if (mask.id === layerId && replacement) return maskCoverageFromColor(replacement)
    const index = layerIndexAt(mask, x, y)
    if (index === null) return 255
    const offset = index * 4
    return mask.pixels[offset + 3] === 0 ? 255 : mask.pixels[offset]
  }
  const applyItemMask = (item: CompiledItem, source: RgbaColor, x: number, y: number): RgbaColor => {
    const mask = itemMask(item)
    if (!mask || source.a === 0) return source
    return { ...source, a: Math.round(source.a * readMaskCoverage(mask, x, y) / 255) }
  }
  const clipsToLowerSibling = (item: CompiledItem): boolean => item.kind === 'layer' ? item.layer.clippingMask === true : item.group.clippingMask === true
  const itemVisible = (item: CompiledItem): boolean => item.kind === 'layer' ? item.layer.visible : item.group.visible
  const itemOpacity = (item: CompiledItem): number => item.kind === 'layer' ? item.layer.opacity : item.group.opacity
  const itemBlendMode = (item: CompiledItem): BlendMode => item.kind === 'layer' ? item.layer.blendMode : item.group.blendMode
  function isolatedItemColor(item: CompiledItem, x: number, y: number): RgbaColor {
    if (!itemVisible(item)) return TRANSPARENT
    return applyItemMask(item, item.kind === 'layer' ? item.read(x, y) : compositeContainer(item.children, x, y), x, y)
  }
  function compositeIsolatedSource(backdrop: RgbaColor, item: CompiledItem, source: RgbaColor): RgbaColor {
    const opacity = itemOpacity(item)
    if (source.a === 0 || opacity <= 0) return backdrop
    const blendMode = itemBlendMode(item)
    return opacity === 1 && (backdrop.a === 0 || (blendMode === 'normal' && source.a === 255))
      ? source
      : blendWithMode(backdrop, source, opacity, blendMode)
  }
  function compositeRegularItem(backdrop: RgbaColor, item: CompiledItem, x: number, y: number): RgbaColor {
    if (!itemVisible(item) || itemOpacity(item) <= 0) return backdrop
    if (item.kind === 'layer') return compositeIsolatedSource(backdrop, item, isolatedItemColor(item, x, y))
    if (item.group.cumulativeBlend === true) {
      const isolatedColor = isolatedItemColor(item, x, y)
      if (isolatedColor.a === 0) return backdrop
      const cumulativeColor = applyItemMask(item, compositeContainer(item.children, x, y, backdrop), x, y)
      return blendWithMode(backdrop, cumulativeColor, item.group.opacity, item.group.blendMode)
    }
    if (item.group.blendMode === 'normal' && item.group.opacity === 1 && !itemMask(item)) return compositeContainer(item.children, x, y, backdrop)
    return compositeIsolatedSource(backdrop, item, isolatedItemColor(item, x, y))
  }
  function compositeClippedMember(backdrop: RgbaColor, item: CompiledItem, x: number, y: number): RgbaColor {
    if (!itemVisible(item) || itemOpacity(item) <= 0) return backdrop
    if (item.kind === 'layer') return compositeIsolatedSource(backdrop, item, isolatedItemColor(item, x, y))
    if (item.group.cumulativeBlend === true) {
      const isolatedColor = isolatedItemColor(item, x, y)
      if (isolatedColor.a === 0) return backdrop
      const cumulativeColor = applyItemMask(item, compositeContainer(item.children, x, y, backdrop), x, y)
      return blendWithMode(backdrop, cumulativeColor, item.group.opacity, item.group.blendMode)
    }
    return compositeIsolatedSource(backdrop, item, isolatedItemColor(item, x, y))
  }
  function compositeContainer(items: CompiledItem[], x: number, y: number, backdrop: RgbaColor = TRANSPARENT): RgbaColor {
    let color = backdrop
    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const item = items[itemIndex]
      if (items[itemIndex + 1] && clipsToLowerSibling(items[itemIndex + 1])) {
        let lastClippedIndex = itemIndex
        while (items[lastClippedIndex + 1] && clipsToLowerSibling(items[lastClippedIndex + 1])) lastClippedIndex += 1
        const baseSource = isolatedItemColor(item, x, y)
        if (baseSource.a > 0 && itemVisible(item) && itemOpacity(item) > 0) {
          let stackColor: RgbaColor = { ...baseSource, a: 255 }
          for (let clippedIndex = itemIndex + 1; clippedIndex <= lastClippedIndex; clippedIndex += 1) {
            stackColor = compositeClippedMember(stackColor, items[clippedIndex], x, y)
          }
          color = compositeIsolatedSource(color, item, { ...stackColor, a: baseSource.a })
        }
        itemIndex = lastClippedIndex
      } else {
        color = compositeRegularItem(color, item, x, y)
      }
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
