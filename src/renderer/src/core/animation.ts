import type { AnimationCel, AnimationCelSurface, AnimationFrame, AnimationGroupMask, AnimationTimeline, LayerMask, PaletteEntry, RasterLayer, SelectionMask, SpriteDocument } from '@shared/types'
import { animationMaskAt, createId, getLayerStorageOrigin, resolveAnimationMask, setLayerStorageOrigin } from './document'

export const DEFAULT_FRAME_DURATION = 100
export const MAX_ANIMATION_FRAME_DURATION = 60_000

export const createDefaultAnimationTimeline = (): AnimationTimeline => ({
  frames: [{ id: 'frame-1', duration: DEFAULT_FRAME_DURATION }],
  cels: [],
  groupMasks: [],
  activeFrameId: 'frame-1',
  loop: true
})

const normalizeFrame = (value: unknown, index: number, seen: Set<string>): AnimationFrame | null => {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<AnimationFrame>
  const id = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id : `frame-${index + 1}`
  if (seen.has(id)) return null
  seen.add(id)
  const duration = Number.isFinite(candidate.duration)
    ? Math.max(1, Math.min(MAX_ANIMATION_FRAME_DURATION, Math.trunc(Number(candidate.duration))))
    : DEFAULT_FRAME_DURATION
  return { id, duration }
}

const normalizeSurface = (value: unknown): AnimationCelSurface | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<AnimationCelSurface>
  const width = Number(candidate.width)
  const height = Number(candidate.height)
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) return undefined
  const offsetX = Number.isFinite(candidate.offsetX) ? Math.trunc(Number(candidate.offsetX)) : 0
  const offsetY = Number.isFinite(candidate.offsetY) ? Math.trunc(Number(candidate.offsetY)) : 0
  if (candidate.format === 'rgba' && candidate.pixels instanceof Uint8ClampedArray && candidate.pixels.length === width * height * 4) {
    return { format: 'rgba', width, height, offsetX, offsetY, pixels: candidate.pixels }
  }
  if (candidate.format === 'indexed' && candidate.pixels instanceof Uint32Array && candidate.pixels.length === width * height) {
    return { format: 'indexed', width, height, offsetX, offsetY, pixels: candidate.pixels }
  }
  return undefined
}

const normalizeLayerMask = (value: unknown, ownerId: string, ownerKind: LayerMask['ownerKind'] = 'cel'): LayerMask | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<LayerMask>
  const width = Number(candidate.width)
  const height = Number(candidate.height)
  if (typeof candidate.id !== 'string' || !candidate.id || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) return undefined
  if (!(candidate.pixels instanceof Uint8ClampedArray) || candidate.pixels.length !== width * height * 4) return undefined
  return {
    id: candidate.id,
    name: typeof candidate.name === 'string' ? candidate.name : '',
    description: typeof candidate.description === 'string' ? candidate.description : '',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    width,
    height,
    offsetX: Number.isFinite(candidate.offsetX) ? Math.trunc(Number(candidate.offsetX)) : 0,
    offsetY: Number.isFinite(candidate.offsetY) ? Math.trunc(Number(candidate.offsetY)) : 0,
    format: 'rgba',
    pixels: candidate.pixels,
    ownerKind,
    ownerId,
    ...(typeof candidate.linkedMaskId === 'string' ? { linkedMaskId: candidate.linkedMaskId } : {})
  }
}

const normalizeGroupMasks = (value: unknown, frameIds: Set<string>): AnimationGroupMask[] => {
  if (!Array.isArray(value)) return []
  const result: AnimationGroupMask[] = []
  const slots = new Set<string>()
  const maskIds = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as Partial<AnimationGroupMask>
    if (typeof candidate.groupId !== 'string' || !candidate.groupId || typeof candidate.frameId !== 'string' || !frameIds.has(candidate.frameId)) continue
    const slot = `${candidate.groupId}\u0000${candidate.frameId}`
    if (slots.has(slot)) continue
    const mask = normalizeLayerMask(candidate.mask, candidate.groupId, 'group')
    if (!mask || maskIds.has(mask.id)) continue
    slots.add(slot)
    maskIds.add(mask.id)
    result.push({ groupId: candidate.groupId, frameId: candidate.frameId, mask })
  }
  return result
}

const cloneLayerMaskForCel = (mask: LayerMask, ownerId: string, id = mask.id): LayerMask => ({
  ...mask,
  id,
  ownerKind: 'cel',
  ownerId,
  linkedMaskId: id === mask.id ? mask.linkedMaskId : null,
  pixels: new Uint8ClampedArray(mask.pixels)
})

export const cloneAnimationGroupMask = (entry: AnimationGroupMask, groupId = entry.groupId, frameId = entry.frameId, maskId = entry.mask.id): AnimationGroupMask => ({
  groupId,
  frameId,
  mask: { ...entry.mask, id: maskId, ownerKind: 'group', ownerId: groupId, linkedMaskId: maskId === entry.mask.id ? entry.mask.linkedMaskId : null, pixels: new Uint8ClampedArray(entry.mask.pixels) }
})

const normalizeCels = (value: unknown, frameIds: Set<string>): AnimationCel[] => {
  if (!Array.isArray(value)) return []
  const result: AnimationCel[] = []
  const ids = new Set<string>()
  const slots = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as Partial<AnimationCel>
    if (typeof candidate.id !== 'string' || !candidate.id || ids.has(candidate.id)) continue
    if (typeof candidate.layerId !== 'string' || !candidate.layerId || typeof candidate.frameId !== 'string' || !frameIds.has(candidate.frameId)) continue
    const slot = `${candidate.layerId}:${candidate.frameId}`
    if (slots.has(slot)) continue
    ids.add(candidate.id)
    slots.add(slot)
    const surface = normalizeSurface(candidate.surface)
    const mask = normalizeLayerMask(candidate.mask, candidate.id)
    result.push({
      id: candidate.id,
      layerId: candidate.layerId,
      frameId: candidate.frameId,
      ...(typeof candidate.linkedCelId === 'string' ? { linkedCelId: candidate.linkedCelId } : {}),
      ...(Number.isFinite(candidate.opacity) ? { opacity: Math.max(0, Math.min(1, Number(candidate.opacity))) } : {}),
      ...(surface ? { surface } : {}),
      ...(mask ? { mask } : {})
    })
  }
  return result
}

/** 旧工程没有动画字段时会被视为单帧工程。 */
export const normalizeAnimationTimeline = (value: unknown): AnimationTimeline => {
  if (!value || typeof value !== 'object') return createDefaultAnimationTimeline()
  const candidate = value as Partial<AnimationTimeline>
  const seen = new Set<string>()
  const frames = Array.isArray(candidate.frames)
    ? candidate.frames.map((frame, index) => normalizeFrame(frame, index, seen)).filter((frame): frame is AnimationFrame => Boolean(frame))
    : []
  if (frames.length === 0) return createDefaultAnimationTimeline()
  const frameIds = new Set(frames.map((frame) => frame.id))
  return {
    frames,
    cels: normalizeCels(candidate.cels, frameIds),
    groupMasks: normalizeGroupMasks(candidate.groupMasks, frameIds),
    activeFrameId: typeof candidate.activeFrameId === 'string' && frameIds.has(candidate.activeFrameId) ? candidate.activeFrameId : frames[0].id,
    loop: candidate.loop !== false
  }
}

export const animationFrameAt = (timeline: AnimationTimeline, frameId: string): AnimationFrame | null =>
  timeline.frames.find((frame) => frame.id === frameId) ?? null

export const animationCelAt = (timeline: AnimationTimeline, layerId: string, frameId: string): AnimationCel | null =>
  timeline.cels.find((cel) => cel.layerId === layerId && cel.frameId === frameId) ?? null

export const animationGroupMaskAt = (timeline: AnimationTimeline, groupId: string, frameId: string): LayerMask | null =>
  animationMaskAt(timeline, groupId, frameId)

export interface AnimationCelLookup {
  at: (layerId: string, frameId: string) => AnimationCel | null
  resolve: (cel: AnimationCel | null) => AnimationCel | null
}

/** Builds the cel indexes once for batch timeline work such as playback and panel rendering. */
export const createAnimationCelLookup = (timeline: AnimationTimeline): AnimationCelLookup => {
  const bySlot = new Map(timeline.cels.map((candidate) => [celSlotKey(candidate.layerId, candidate.frameId), candidate]))
  let byId: Map<string, AnimationCel> | null = null
  const resolved = new Map<string, AnimationCel>()
  const resolve = (cel: AnimationCel | null): AnimationCel | null => {
    if (!cel || !cel.linkedCelId) return cel
    const cached = resolved.get(cel.id)
    if (cached) return cached
    const visited = new Set<string>()
    const path: AnimationCel[] = []
    let current = cel
    while (current.linkedCelId) {
      const known = resolved.get(current.id)
      if (known) {
        for (const member of path) resolved.set(member.id, known)
        return known
      }
      if (visited.has(current.id)) return cel
      visited.add(current.id)
      path.push(current)
      byId ??= new Map(timeline.cels.map((candidate) => [candidate.id, candidate]))
      const linked = byId.get(current.linkedCelId)
      if (!linked || linked.layerId !== cel.layerId) return cel
      current = linked
    }
    resolved.set(current.id, current)
    for (const member of path) resolved.set(member.id, current)
    return current
  }
  return {
    at: (layerId, frameId) => bySlot.get(celSlotKey(layerId, frameId)) ?? null,
    resolve
  }
}

export const resolveAnimationCel = (timeline: AnimationTimeline, cel: AnimationCel | null): AnimationCel | null =>
  !cel?.linkedCelId ? cel : createAnimationCelLookup(timeline).resolve(cel)

/** 判断 cel 是否包含至少一个可见像素，而不是只判断是否存在 surface。 */
export const animationCelHasContent = (cel: AnimationCel | null, palette: readonly PaletteEntry[] = []): boolean => {
  if (!cel?.surface) return false
  if (cel.surface.format === 'rgba') {
    for (let index = 3; index < cel.surface.pixels.length; index += 4) if (cel.surface.pixels[index] > 0) return true
    return false
  }
  if (palette.length === 0) return cel.surface.pixels.some((pixel) => pixel !== 0)
  const opaqueIds = new Set(palette.filter((entry) => entry.color.a > 0).map((entry) => entry.id))
  return cel.surface.pixels.some((pixel) => opaqueIds.has(pixel))
}

/** Builds a canvas-clipped selection from every visible pixel in one cel. */
export const animationCelContentSelection = (cel: AnimationCel | null, palette: readonly PaletteEntry[], canvasWidth: number, canvasHeight: number): SelectionMask | null => {
  const surface = cel?.surface
  const documentWidth = Math.max(0, Math.trunc(canvasWidth))
  const documentHeight = Math.max(0, Math.trunc(canvasHeight))
  if (!surface || documentWidth < 1 || documentHeight < 1) return null
  const sourceLeft = Math.max(0, -surface.offsetX)
  const sourceTop = Math.max(0, -surface.offsetY)
  const sourceRight = Math.min(surface.width, documentWidth - surface.offsetX)
  const sourceBottom = Math.min(surface.height, documentHeight - surface.offsetY)
  if (sourceRight <= sourceLeft || sourceBottom <= sourceTop) return null

  const opaquePaletteIds = surface.format === 'indexed'
    ? new Set(palette.filter((entry) => entry.color.a > 0).map((entry) => entry.id))
    : null
  const opaqueAt = surface.format === 'rgba'
    ? (x: number, y: number): boolean => surface.pixels[(y * surface.width + x) * 4 + 3] > 0
    : palette.length === 0
      ? (x: number, y: number): boolean => surface.pixels[y * surface.width + x] !== 0
      : (x: number, y: number): boolean => opaquePaletteIds!.has(surface.pixels[y * surface.width + x])

  let minX = sourceRight
  let minY = sourceBottom
  let maxX = -1
  let maxY = -1
  for (let y = sourceTop; y < sourceBottom; y += 1) for (let x = sourceLeft; x < sourceRight; x += 1) {
    if (!opaqueAt(x, y)) continue
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  if (maxX < minX || maxY < minY) return null

  const width = maxX - minX + 1
  const height = maxY - minY + 1
  const mask = new Uint8Array(width * height)
  let selected = 0
  for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
    if (!opaqueAt(x, y)) continue
    mask[(y - minY) * width + x - minX] = 1
    selected += 1
  }
  const selection = { x: surface.offsetX + minX, y: surface.offsetY + minY, width, height }
  return selected === width * height ? selection : { ...selection, mask }
}

export const animationCelKey = (layerId: string, frameId: string): string => `${layerId}:${frameId}`

export const parseAnimationCelKey = (key: string): { layerId: string; frameId: string } | null => {
  const separator = key.lastIndexOf(':')
  if (separator <= 0 || separator === key.length - 1) return null
  return { layerId: key.slice(0, separator), frameId: key.slice(separator + 1) }
}

export interface AnimationCelPlacement {
  source: AnimationCel
  target: AnimationCel
}

/** 按拖拽锚点保留多选 cel 在图层和帧网格中的相对位置。 */
export const mapAnimationCelBlock = (
  timeline: AnimationTimeline,
  layerIds: readonly string[],
  sourceCels: readonly AnimationCel[],
  sourceAnchorKey: string,
  targetLayerId: string,
  targetFrameId: string
): AnimationCelPlacement[] => {
  const anchor = parseAnimationCelKey(sourceAnchorKey)
  const sourceLayerIndex = anchor ? layerIds.indexOf(anchor.layerId) : -1
  const sourceFrameIndex = anchor ? timeline.frames.findIndex((frame) => frame.id === anchor.frameId) : -1
  const targetLayerIndex = layerIds.indexOf(targetLayerId)
  const targetFrameIndex = timeline.frames.findIndex((frame) => frame.id === targetFrameId)
  if (sourceLayerIndex < 0 || sourceFrameIndex < 0 || targetLayerIndex < 0 || targetFrameIndex < 0) return []

  const layerIndexById = new Map(layerIds.map((id, index) => [id, index]))
  const frameIndexById = new Map(timeline.frames.map((frame, index) => [frame.id, index]))
  const celBySlot = new Map(timeline.cels.map((cel) => [animationCelKey(cel.layerId, cel.frameId), cel]))
  return sourceCels.flatMap((source) => {
    const layerIndex = layerIndexById.get(source.layerId)
    const frameIndex = frameIndexById.get(source.frameId)
    if (layerIndex === undefined || frameIndex === undefined) return []
    const destinationLayerId = layerIds[targetLayerIndex + layerIndex - sourceLayerIndex]
    const destinationFrame = timeline.frames[targetFrameIndex + frameIndex - sourceFrameIndex]
    if (!destinationLayerId || !destinationFrame) return []
    const target = celBySlot.get(animationCelKey(destinationLayerId, destinationFrame.id))
    return target ? [{ source, target }] : []
  })
}

const celSlotKey = (layerId: string, frameId: string): string => `${layerId}\u0000${frameId}`

const createAnimationIdAllocator = (timeline: AnimationTimeline, prefix: 'frame' | 'cel'): (() => string) => {
  const used = new Set(prefix === 'frame' ? timeline.frames.map((frame) => frame.id) : timeline.cels.map((cel) => cel.id))
  let index = used.size + 1
  return () => {
    while (used.has(`${prefix}-${index}`)) index += 1
    const id = `${prefix}-${index}`
    used.add(id)
    index += 1
    return id
  }
}

const uniqueAnimationId = (timeline: AnimationTimeline, prefix: 'frame' | 'cel'): string => createAnimationIdAllocator(timeline, prefix)()

const surfaceFromLayer = (layer: RasterLayer, copyPixels = false): AnimationCelSurface => {
  const storageOrigin = getLayerStorageOrigin(layer)
  return layer.format === 'rgba'
    ? { format: 'rgba', width: layer.width, height: layer.height, offsetX: layer.offsetX, offsetY: layer.offsetY, storageOriginX: storageOrigin.x, storageOriginY: storageOrigin.y, pixels: copyPixels ? layer.pixels.slice() : layer.pixels }
    : { format: 'indexed', width: layer.width, height: layer.height, offsetX: layer.offsetX, offsetY: layer.offsetY, storageOriginX: storageOrigin.x, storageOriginY: storageOrigin.y, pixels: copyPixels ? layer.pixels.slice() : layer.pixels }
}

const blankSurfaceFromLayer = (layer: RasterLayer): AnimationCelSurface => layer.format === 'rgba'
  ? { format: 'rgba', width: 1, height: 1, offsetX: 0, offsetY: 0, pixels: new Uint8ClampedArray(4) }
  : { format: 'indexed', width: 1, height: 1, offsetX: 0, offsetY: 0, pixels: new Uint32Array(1) }

export const cloneAnimationCelSurface = (surface: AnimationCelSurface): AnimationCelSurface => surface.format === 'rgba'
  ? { ...surface, pixels: surface.pixels.slice() }
  : { ...surface, pixels: surface.pixels.slice() }

const shareAnimationCelSurface = (surface: AnimationCelSurface): AnimationCelSurface => surface.format === 'rgba'
  ? { ...surface, pixels: surface.pixels }
  : { ...surface, pixels: surface.pixels }

const cropAnimationCelSurface = (surface: AnimationCelSurface, canvasWidth: number, canvasHeight: number): void => {
  const left = Math.max(0, surface.offsetX)
  const top = Math.max(0, surface.offsetY)
  const right = Math.min(canvasWidth, surface.offsetX + surface.width)
  const bottom = Math.min(canvasHeight, surface.offsetY + surface.height)
  const sourceX = left - surface.offsetX
  const sourceY = top - surface.offsetY
  const nextWidth = right - left
  const nextHeight = bottom - top
  const storageOriginX = surface.storageOriginX ?? 0
  const storageOriginY = surface.storageOriginY ?? 0
  if (nextWidth <= 0 || nextHeight <= 0) {
    surface.width = 1
    surface.height = 1
    surface.offsetX = 0
    surface.offsetY = 0
    surface.storageOriginX = storageOriginX + sourceX
    surface.storageOriginY = storageOriginY + sourceY
    surface.pixels = surface.format === 'rgba' ? new Uint8ClampedArray(4) : new Uint32Array(1)
    return
  }
  if (left === surface.offsetX && top === surface.offsetY && nextWidth === surface.width && nextHeight === surface.height) return
  if (surface.format === 'rgba') {
    const pixels = new Uint8ClampedArray(nextWidth * nextHeight * 4)
    for (let y = 0; y < nextHeight; y += 1) {
      const sourceOffset = ((sourceY + y) * surface.width + sourceX) * 4
      pixels.set(surface.pixels.subarray(sourceOffset, sourceOffset + nextWidth * 4), y * nextWidth * 4)
    }
    surface.pixels = pixels
  } else {
    const pixels = new Uint32Array(nextWidth * nextHeight)
    for (let y = 0; y < nextHeight; y += 1) {
      const sourceOffset = (sourceY + y) * surface.width + sourceX
      pixels.set(surface.pixels.subarray(sourceOffset, sourceOffset + nextWidth), y * nextWidth)
    }
    surface.pixels = pixels
  }
  surface.width = nextWidth
  surface.height = nextHeight
  surface.offsetX = left
  surface.offsetY = top
  surface.storageOriginX = storageOriginX + sourceX
  surface.storageOriginY = storageOriginY + sourceY
}

/** 将画布坐标偏移同步到所有动画 cel，不改变 cel 在画布中的世界位置。 */
export const resizeAnimationCelsAt = (document: SpriteDocument, offsetX: number, offsetY: number, trimOutside = false): void => {
  const timeline = ensureAnimationDocument(document)
  const horizontal = Math.trunc(offsetX)
  const vertical = Math.trunc(offsetY)
  const resized = new Set<AnimationCelSurface>()
  for (const cel of timeline.cels) {
    const source = resolveAnimationCel(timeline, cel)
    if (cel.frameId === timeline.activeFrameId || !source?.surface || resized.has(source.surface)) continue
    resized.add(source.surface)
    source.surface.offsetX += horizontal
    source.surface.offsetY += vertical
    if (trimOutside) cropAnimationCelSurface(source.surface, document.width, document.height)
  }
  syncActiveAnimationFrame(document)
}

export const cloneAnimationCel = (cel: AnimationCel): AnimationCel => ({
  ...cel,
  surface: cel.surface ? cloneAnimationCelSurface(cel.surface) : undefined,
  mask: cel.mask ? cloneLayerMaskForCel(cel.mask, cel.id) : undefined
})

/** Create an isolated document snapshot for read-only animation previewing. */
export const cloneDocumentForAnimationFrame = (document: SpriteDocument, frameId: string): SpriteDocument => {
  const layers = document.layers.map((layer) => {
    const clone = { ...layer, pixels: layer.pixels } as RasterLayer
    setLayerStorageOrigin(clone, getLayerStorageOrigin(layer))
    return clone
  })
  const preview: SpriteDocument = {
    ...document,
    layers,
    groups: document.groups.map((group) => ({ ...group })),
    palette: document.palette.map((entry) => ({ ...entry, color: { ...entry.color } })),
    paletteOrder: [...document.paletteOrder],
    paletteSlots: document.paletteSlots ? [...document.paletteSlots] : undefined,
    paletteColumns: document.paletteColumns,
    customBrushes: document.customBrushes?.map((brush) => ({ ...brush, coverage: brush.coverage.slice(), colors: brush.colors?.slice() })),
    animation: document.animation
      ? {
          ...document.animation,
          frames: document.animation.frames.map((frame) => ({ ...frame })),
          cels: document.animation.cels.map((cel) => ({ ...cel, surface: cel.surface ? shareAnimationCelSurface(cel.surface) : undefined, mask: cel.mask ? { ...cel.mask, pixels: cel.mask.pixels } : undefined })),
          groupMasks: (document.animation.groupMasks ?? []).map((entry) => ({ ...entry, mask: { ...entry.mask, pixels: entry.mask.pixels } }))
        }
      : undefined
  }
  const timeline = ensureAnimationDocument(preview)
  if (timeline.frames.some((frame) => frame.id === frameId)) activateAnimationFrame(preview, frameId)
  return preview
}

const applySurfaceToLayer = (layer: RasterLayer, surface: AnimationCelSurface, opacity?: number): void => {
  if (layer.format !== surface.format) throw new Error('动画 cel 与图层颜色模式不一致')
  layer.width = surface.width
  layer.height = surface.height
  layer.offsetX = surface.offsetX
  layer.offsetY = surface.offsetY
  if (layer.format === 'rgba' && surface.format === 'rgba') layer.pixels = surface.pixels
  if (layer.format === 'indexed' && surface.format === 'indexed') layer.pixels = surface.pixels
  if (Number.isFinite(opacity)) layer.opacity = Math.max(0, Math.min(1, opacity!))
  setLayerStorageOrigin(layer, { x: surface.storageOriginX ?? 0, y: surface.storageOriginY ?? 0 })
}

const celsByLayerForFrame = (timeline: AnimationTimeline, frameId: string): Map<string, AnimationCel> => {
  const result = new Map<string, AnimationCel>()
  for (const cel of timeline.cels) if (cel.frameId === frameId) result.set(cel.layerId, cel)
  return result
}

const syncFrameSurfaces = (document: SpriteDocument, timeline: AnimationTimeline): void => {
  const activeCels = celsByLayerForFrame(timeline, timeline.activeFrameId)
  const lookup = createAnimationCelLookup(timeline)
  const membersBySource = new Map<string, AnimationCel[]>()
  for (const candidate of timeline.cels) {
    if (!candidate.linkedCelId) continue
    const source = lookup.resolve(candidate)
    if (!source) continue
    const members = membersBySource.get(source.id) ?? []
    members.push(candidate)
    membersBySource.set(source.id, members)
  }
  for (const layer of document.layers) {
    const cel = activeCels.get(layer.id)
    if (cel) {
      const source = lookup.resolve(cel) ?? cel
      source.surface = surfaceFromLayer(layer)
      source.opacity = layer.opacity
      for (const candidate of membersBySource.get(source.id) ?? []) {
        candidate.surface = source.surface
        candidate.opacity = source.opacity
      }
    }
  }
}

const applyFrameSurfaces = (document: SpriteDocument, timeline: AnimationTimeline): void => {
  const activeCels = celsByLayerForFrame(timeline, timeline.activeFrameId)
  const lookup = createAnimationCelLookup(timeline)
  for (const layer of document.layers) {
    const cel = lookup.resolve(activeCels.get(layer.id) ?? null)
    if (cel?.surface) applySurfaceToLayer(layer, cel.surface, cel.opacity)
  }
}

const normalizeAnimationCelLinks = (timeline: AnimationTimeline): void => {
  const byId = new Map(timeline.cels.map((cel) => [cel.id, cel]))
  for (const cel of timeline.cels) {
    if (!cel.linkedCelId) continue
    const linked = byId.get(cel.linkedCelId)
    if (!linked || linked.id === cel.id || linked.layerId !== cel.layerId) cel.linkedCelId = null
  }
  for (const cel of timeline.cels) {
    if (!cel.linkedCelId) continue
    const visited = new Set<string>()
    let current: AnimationCel | undefined = cel
    while (current?.linkedCelId) {
      if (visited.has(current.id)) {
        cel.linkedCelId = null
        current = undefined
        break
      }
      visited.add(current.id)
      current = byId.get(current.linkedCelId)
    }
    if (!current || current === cel) continue
    cel.linkedCelId = current.id
    cel.surface = current.surface
    cel.opacity = current.opacity
    if (!current.mask && cel.mask) current.mask = cloneLayerMaskForCel(cel.mask, current.id, `mask-${current.id}`)
    if (current.mask) {
      if (!cel.mask) cel.mask = cloneLayerMaskForCel(current.mask, cel.id, `mask-${cel.id}`)
      cel.mask.linkedMaskId = current.mask.id
    } else delete cel.mask
  }
}

const normalizeAnimationMaskLinks = (timeline: AnimationTimeline): void => {
  const masks = [...timeline.cels.flatMap((cel) => cel.mask ? [cel.mask] : []), ...(timeline.groupMasks ?? []).map((entry) => entry.mask)]
  const byId = new Map(masks.map((mask) => [mask.id, mask]))
  for (const mask of masks) {
    if (!mask.linkedMaskId) continue
    const linked = byId.get(mask.linkedMaskId)
    if (!linked || linked.id === mask.id) mask.linkedMaskId = null
  }
  for (const mask of masks) {
    if (!mask.linkedMaskId) continue
    const resolved = resolveAnimationMask(timeline, mask)
    if (!resolved || resolved === mask) mask.linkedMaskId = null
    else mask.linkedMaskId = resolved.id
  }
}

/** 为旧工程或新图层补齐每个帧槽位，并让活动帧引用当前图层像素。 */
export const ensureAnimationDocument = (document: SpriteDocument): AnimationTimeline => {
  const timeline = document.animation ?? createDefaultAnimationTimeline()
  document.animation = timeline
  const frameIds = new Set(timeline.frames.map((frame) => frame.id))
  const layers = new Map(document.layers.map((layer) => [layer.id, layer]))
  const groups = new Set(document.groups.map((group) => group.id))
  timeline.cels = timeline.cels.filter((cel) => frameIds.has(cel.frameId) && layers.has(cel.layerId))
  timeline.groupMasks = (timeline.groupMasks ?? []).filter((entry) => frameIds.has(entry.frameId) && groups.has(entry.groupId))
  const celsBySlot = new Map(timeline.cels.map((cel) => [celSlotKey(cel.layerId, cel.frameId), cel]))
  const nextCelId = createAnimationIdAllocator(timeline, 'cel')
  for (const layer of document.layers) {
    for (const frame of timeline.frames) {
      const slot = celSlotKey(layer.id, frame.id)
      let cel = celsBySlot.get(slot)
      if (!cel) {
        cel = {
          id: nextCelId(),
          layerId: layer.id,
          frameId: frame.id,
          opacity: layer.opacity,
          surface: frame.id === timeline.activeFrameId ? surfaceFromLayer(layer) : blankSurfaceFromLayer(layer)
        }
        timeline.cels.push(cel)
        celsBySlot.set(slot, cel)
      } else if (!cel.surface || cel.surface.format !== layer.format) {
        cel.surface = frame.id === timeline.activeFrameId ? surfaceFromLayer(layer) : blankSurfaceFromLayer(layer)
      }
      if (frame.id === timeline.activeFrameId && cel.surface?.pixels === layer.pixels) {
        cel.surface = surfaceFromLayer(layer)
        cel.opacity = layer.opacity
      }
      if (!Number.isFinite(cel.opacity)) cel.opacity = layer.opacity
    }
  }
  normalizeAnimationCelLinks(timeline)
  normalizeAnimationMaskLinks(timeline)
  return timeline
}

export const connectAnimationCels = (document: SpriteDocument, celIds: readonly string[]): boolean => {
  const timeline = ensureAnimationDocument(document)
  syncFrameSurfaces(document, timeline)
  const selected = new Set(celIds)
  const frameIndex = new Map(timeline.frames.map((frame, index) => [frame.id, index]))
  const byLayer = new Map<string, AnimationCel[]>()
  for (const cel of timeline.cels) {
    if (!selected.has(cel.id)) continue
    const group = byLayer.get(cel.layerId) ?? []
    group.push(cel)
    byLayer.set(cel.layerId, group)
  }
  let changed = false
  for (const cels of byLayer.values()) {
    if (cels.length < 2) continue
    cels.sort((left, right) => (frameIndex.get(left.frameId) ?? 0) - (frameIndex.get(right.frameId) ?? 0))
    const firstContent = cels.find((cel) => animationCelHasContent(resolveAnimationCel(timeline, cel), document.palette))
    if (!firstContent) continue
    const source = resolveAnimationCel(timeline, firstContent) ?? firstContent
    const sourceMask = source.mask ?? cels.map((cel) => animationMaskAt(timeline, cel.layerId, cel.frameId)).find((mask): mask is LayerMask => Boolean(mask))
    if (!source.mask && sourceMask) source.mask = cloneLayerMaskForCel(sourceMask, source.id, `mask-${source.id}`)
    for (const cel of cels) {
      if (cel.id === source.id) {
        if (cel.linkedCelId) changed = true
        cel.linkedCelId = null
        continue
      }
      if (cel.linkedCelId !== source.id || cel.surface !== source.surface || cel.opacity !== source.opacity || cel.mask?.linkedMaskId !== source.mask?.id) changed = true
      cel.linkedCelId = source.id
      cel.surface = source.surface
      cel.opacity = source.opacity
      if (source.mask) {
        if (!cel.mask) cel.mask = cloneLayerMaskForCel(source.mask, cel.id, `mask-${cel.id}`)
        cel.mask.linkedMaskId = source.mask.id
      } else delete cel.mask
    }
  }
  normalizeAnimationCelLinks(timeline)
  applyFrameSurfaces(document, timeline)
  return changed
}

/** Break links only for the requested cels while preserving their current pixels. */
export const disconnectAnimationCels = (document: SpriteDocument, celIds: readonly string[]): boolean => {
  const timeline = ensureAnimationDocument(document)
  syncFrameSurfaces(document, timeline)
  const selected = new Set(celIds)
  const selectedSourceIds = new Set<string>()
  for (const cel of timeline.cels) {
    if (!selected.has(cel.id)) continue
    const source = resolveAnimationCel(timeline, cel)
    if (source?.id === cel.id && timeline.cels.some((candidate) => candidate.id !== source.id && resolveAnimationCel(timeline, candidate)?.id === source.id)) {
      selectedSourceIds.add(source.id)
    }
  }
  let changed = false
  for (const cel of timeline.cels) {
    const resolved = resolveAnimationCel(timeline, cel)
    const selectedThroughSource = Boolean(resolved && selectedSourceIds.has(resolved.id))
    if ((!selected.has(cel.id) && !selectedThroughSource) || !cel.linkedCelId) continue
    const source = resolveAnimationCel(timeline, cel)
    if (!source) continue
    const resolvedMask = animationMaskAt(timeline, cel.layerId, cel.frameId)
    cel.surface = source.surface ? cloneAnimationCelSurface(source.surface) : undefined
    cel.opacity = source.opacity
    cel.mask = resolvedMask ? cloneLayerMaskForCel(resolvedMask, cel.id, `mask-${cel.id}`) : undefined
    cel.linkedCelId = null
    changed = true
  }
  normalizeAnimationCelLinks(timeline)
  applyFrameSurfaces(document, timeline)
  return changed
}

export const syncActiveAnimationFrame = (document: SpriteDocument): void => {
  const timeline = ensureAnimationDocument(document)
  syncFrameSurfaces(document, timeline)
}

export const refreshActiveAnimationFrame = (document: SpriteDocument): void => {
  const timeline = ensureAnimationDocument(document)
  applyFrameSurfaces(document, timeline)
}

export const activateAnimationFrame = (document: SpriteDocument, frameId: string): boolean => {
  const timeline = ensureAnimationDocument(document)
  if (timeline.activeFrameId === frameId) return true
  if (!timeline.frames.some((frame) => frame.id === frameId)) return false
  syncFrameSurfaces(document, timeline)
  timeline.activeFrameId = frameId
  applyFrameSurfaces(document, timeline)
  return true
}

export const addBlankAnimationFrame = (document: SpriteDocument): string => {
  const timeline = ensureAnimationDocument(document)
  syncFrameSurfaces(document, timeline)
  const activeIndex = Math.max(0, timeline.frames.findIndex((frame) => frame.id === timeline.activeFrameId))
  const id = uniqueAnimationId(timeline, 'frame')
  timeline.frames.splice(activeIndex + 1, 0, { id, duration: DEFAULT_FRAME_DURATION })
  const nextCelId = createAnimationIdAllocator(timeline, 'cel')
  for (const layer of document.layers) timeline.cels.push({ id: nextCelId(), layerId: layer.id, frameId: id, opacity: layer.opacity, surface: blankSurfaceFromLayer(layer) })
  timeline.activeFrameId = id
  applyFrameSurfaces(document, timeline)
  return id
}

export const duplicateAnimationFrame = (document: SpriteDocument): string => {
  const timeline = ensureAnimationDocument(document)
  syncFrameSurfaces(document, timeline)
  const sourceId = timeline.activeFrameId
  const sourceIndex = Math.max(0, timeline.frames.findIndex((frame) => frame.id === sourceId))
  const id = uniqueAnimationId(timeline, 'frame')
  timeline.frames.splice(sourceIndex + 1, 0, { id, duration: timeline.frames[sourceIndex]?.duration ?? DEFAULT_FRAME_DURATION })
  const sourceCels = celsByLayerForFrame(timeline, sourceId)
  const nextCelId = createAnimationIdAllocator(timeline, 'cel')
  for (const layer of document.layers) {
    const sourceCel = sourceCels.get(layer.id)
    const resolvedSourceCel = resolveAnimationCel(timeline, sourceCel ?? null)
    const source = resolvedSourceCel?.surface ?? blankSurfaceFromLayer(layer)
    const celId = nextCelId()
    const sourceMask = animationMaskAt(timeline, layer.id, sourceId)
    timeline.cels.push({ id: celId, layerId: layer.id, frameId: id, opacity: resolvedSourceCel?.opacity ?? layer.opacity, surface: cloneAnimationCelSurface(source), mask: sourceMask ? cloneLayerMaskForCel(sourceMask, celId, `mask-${celId}`) : undefined })
  }
  for (const entry of (timeline.groupMasks ?? []).filter((candidate) => candidate.frameId === sourceId)) {
    timeline.groupMasks!.push(cloneAnimationGroupMask(entry, entry.groupId, id, createId('mask')))
  }
  timeline.activeFrameId = id
  applyFrameSurfaces(document, timeline)
  return id
}

export const deleteAnimationFrame = (document: SpriteDocument, frameId = document.animation?.activeFrameId): boolean => {
  const timeline = ensureAnimationDocument(document)
  if (!frameId || timeline.frames.length <= 1) return false
  const index = timeline.frames.findIndex((frame) => frame.id === frameId)
  if (index < 0) return false
  syncFrameSurfaces(document, timeline)
  timeline.frames.splice(index, 1)
  timeline.cels = timeline.cels.filter((cel) => cel.frameId !== frameId)
  timeline.groupMasks = (timeline.groupMasks ?? []).filter((entry) => entry.frameId !== frameId)
  if (timeline.activeFrameId === frameId) {
    timeline.activeFrameId = timeline.frames[Math.min(index, timeline.frames.length - 1)].id
    applyFrameSurfaces(document, timeline)
  }
  return true
}

export const setAnimationFrameDuration = (document: SpriteDocument, frameId: string, duration: number): boolean => {
  const frame = animationFrameAt(ensureAnimationDocument(document), frameId)
  if (!frame) return false
  frame.duration = Math.max(1, Math.min(MAX_ANIMATION_FRAME_DURATION, Math.trunc(duration) || DEFAULT_FRAME_DURATION))
  return true
}

export const setAnimationLoop = (document: SpriteDocument, loop: boolean): void => {
  ensureAnimationDocument(document).loop = loop
}

export const nextAnimationFrameId = (timeline: AnimationTimeline, frameId: string): string => {
  const index = timeline.frames.findIndex((frame) => frame.id === frameId)
  if (index < 0) return timeline.frames[0]?.id ?? frameId
  if (index + 1 < timeline.frames.length) return timeline.frames[index + 1].id
  return timeline.loop ? timeline.frames[0].id : frameId
}

export const cloneAnimationCelsForLayer = (document: SpriteDocument, sourceLayerId: string, targetLayer: RasterLayer): void => {
  const timeline = ensureAnimationDocument(document)
  timeline.cels = timeline.cels.filter((cel) => cel.layerId !== targetLayer.id)
  const sourceCels = new Map(timeline.cels.filter((cel) => cel.layerId === sourceLayerId).map((cel) => [cel.frameId, cel]))
  const nextCelId = createAnimationIdAllocator(timeline, 'cel')
  for (const frame of timeline.frames) {
    const sourceCel = sourceCels.get(frame.id)
    const resolvedSourceCel = resolveAnimationCel(timeline, sourceCel ?? null)
    const source = resolvedSourceCel?.surface
    const celId = nextCelId()
    timeline.cels.push({
      id: celId,
      layerId: targetLayer.id,
      frameId: frame.id,
      opacity: sourceCel?.opacity ?? targetLayer.opacity,
      surface: source ? cloneAnimationCelSurface(source) : blankSurfaceFromLayer(targetLayer),
      mask: animationMaskAt(timeline, sourceLayerId, frame.id) ? cloneLayerMaskForCel(animationMaskAt(timeline, sourceLayerId, frame.id)!, celId, `mask-${celId}`) : undefined
    })
  }
  const active = animationCelAt(timeline, targetLayer.id, timeline.activeFrameId)
  if (active?.surface) applySurfaceToLayer(targetLayer, active.surface, active.opacity)
}

export const removeAnimationCelsForLayers = (document: SpriteDocument, layerIds: readonly string[]): AnimationCel[] => {
  const timeline = ensureAnimationDocument(document)
  const ids = new Set(layerIds)
  const removed = timeline.cels.filter((cel) => ids.has(cel.layerId))
  timeline.cels = timeline.cels.filter((cel) => !ids.has(cel.layerId))
  return removed
}

export const restoreAnimationCels = (document: SpriteDocument, cels: readonly AnimationCel[]): void => {
  const timeline = ensureAnimationDocument(document)
  const incomingSlots = new Set(cels.map((cel) => `${cel.layerId}:${cel.frameId}`))
  timeline.cels = timeline.cels.filter((cel) => !incomingSlots.has(`${cel.layerId}:${cel.frameId}`))
  for (const cel of cels) {
    timeline.cels.push(cloneAnimationCel(cel))
  }
  refreshActiveAnimationFrame(document)
}

const layerFromAnimationCel = (layer: RasterLayer | undefined, cel: AnimationCel | null): RasterLayer | null => {
  const surface = cel?.surface
  if (!layer || !surface || layer.format !== surface.format) return null
  const target: RasterLayer | null = layer.format === 'rgba' && surface.format === 'rgba'
    ? { ...layer, width: surface.width, height: surface.height, offsetX: surface.offsetX, offsetY: surface.offsetY, pixels: surface.pixels }
    : layer.format === 'indexed' && surface.format === 'indexed'
      ? { ...layer, width: surface.width, height: surface.height, offsetX: surface.offsetX, offsetY: surface.offsetY, pixels: surface.pixels }
      : null
  if (target) setLayerStorageOrigin(target, { x: surface.storageOriginX ?? 0, y: surface.storageOriginY ?? 0 })
  if (target && Number.isFinite(cel?.opacity)) target.opacity = cel!.opacity!
  return target
}

/** Resolves every layer for one frame with a single cel index build. */
export const animationLayersAtFrame = (document: SpriteDocument, frameId: string): RasterLayer[] => {
  const timeline = ensureAnimationDocument(document)
  const lookup = createAnimationCelLookup(timeline)
  return document.layers.map((layer) => layerFromAnimationCel(layer, lookup.resolve(lookup.at(layer.id, frameId))) ?? layer)
}

/** 供撤销系统在非活动帧中原位写回像素。 */
export const animationLayerAtFrame = (document: SpriteDocument, layerId: string, frameId: string): RasterLayer | null => {
  const layer = document.layers.find((candidate) => candidate.id === layerId)
  const timeline = ensureAnimationDocument(document)
  const lookup = createAnimationCelLookup(timeline)
  return layerFromAnimationCel(layer, lookup.resolve(lookup.at(layerId, frameId)))
}
