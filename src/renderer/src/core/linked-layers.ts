import type { AnimationCelSurface, RasterLayer, SpriteDocument } from '@shared/types'
import { getLayerStorageOrigin, setLayerStorageOrigin } from './document'
import { assignRasterStorage } from './runtime-raster'

type LinkedRasterSurface = RasterLayer | AnimationCelSurface

const surfaceStorageOrigin = (surface: LinkedRasterSurface): { x: number; y: number } =>
  'id' in surface
    ? getLayerStorageOrigin(surface)
    : { x: surface.storageOriginX ?? 0, y: surface.storageOriginY ?? 0 }

const setSurfaceStorageOrigin = (surface: LinkedRasterSurface, x: number, y: number): void => {
  if ('id' in surface) setLayerStorageOrigin(surface, { x, y })
  else {
    surface.storageOriginX = Math.trunc(x)
    surface.storageOriginY = Math.trunc(y)
  }
}

export const isLinkableRasterLayer = (layer: RasterLayer | null | undefined): layer is RasterLayer =>
  Boolean(layer && !layer.kind && !layer.background)

export const normalizeLinkedLayerMetadata = (document: SpriteDocument): void => {
  for (const layer of document.layers) {
    if (typeof layer.linkedContentId === 'string' && layer.linkedContentId.trim() && isLinkableRasterLayer(layer)) continue
    delete layer.linkedContentId
  }
}

export const linkedLayerMembers = (document: SpriteDocument, linkedContentId: string): RasterLayer[] =>
  document.layers.filter((layer) => isLinkableRasterLayer(layer) && layer.linkedContentId === linkedContentId)

export const linkedLayerMemberCount = (document: SpriteDocument, linkedContentId: string | null | undefined): number =>
  linkedContentId ? linkedLayerMembers(document, linkedContentId).length : 0

export const linkedLayerGroups = (document: SpriteDocument): Map<string, RasterLayer[]> => {
  normalizeLinkedLayerMetadata(document)
  const groups = new Map<string, RasterLayer[]>()
  for (const layer of document.layers) {
    if (!layer.linkedContentId) continue
    const members = groups.get(layer.linkedContentId) ?? []
    members.push(layer)
    groups.set(layer.linkedContentId, members)
  }
  return groups
}

/** Shares editable storage while preserving the target layer or cel's independent canvas placement. */
export const shareLinkedRasterContent = (target: LinkedRasterSurface, source: LinkedRasterSurface): void => {
  if (target === source || target.format !== source.format) return
  const targetOrigin = surfaceStorageOrigin(target)
  const sourceOrigin = surfaceStorageOrigin(source)
  const anchorX = target.offsetX - targetOrigin.x
  const anchorY = target.offsetY - targetOrigin.y
  target.width = source.width
  target.height = source.height
  target.offsetX = anchorX + sourceOrigin.x
  target.offsetY = anchorY + sourceOrigin.y
  setSurfaceStorageOrigin(target, sourceOrigin.x, sourceOrigin.y)
  assignRasterStorage(target, source)
}
