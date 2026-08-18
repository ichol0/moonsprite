import { getActiveLayer, getLayerStorageOrigin, setLayerStorageOrigin } from '@/core/document'
import { animationCelAt, ensureAnimationDocument } from '@/core/animation'
import type { LayerMergeSuccess } from '@/core/layer-merge'
import type { AdjustmentSnapshot, DocumentSession } from './workspace-types'
import { touch } from './workspace-session'
import { translateCurrent as tr } from '@/core/localization'
import { captureDocumentStructureSnapshot, documentStructureDeltaBytes, restoreDocumentStructureSnapshot, type DocumentStructureSnapshot } from './workspace-document-history'

const adjustmentTargetLayerIds = (session: DocumentSession): string[] => {
  if (session.selection) return [getActiveLayer(session.document).id]
  const selected = session.selectedLayerIds.filter((id) => session.document.layers.some((layer) => layer.id === id))
  return [...new Set(selected.length > 0 ? selected : [getActiveLayer(session.document).id])]
}

export function captureAdjustmentSnapshot(session: DocumentSession, targetLayerIds = adjustmentTargetLayerIds(session)): AdjustmentSnapshot {
  const timeline = ensureAnimationDocument(session.document)
  return {
    layers: targetLayerIds.flatMap((layerId) => {
      const layer = session.document.layers.find((candidate) => candidate.id === layerId)
      if (!layer) return []
      const storageOrigin = getLayerStorageOrigin(layer)
      return [{
        layerId,
        frameId: timeline.activeFrameId,
        width: layer.width,
        height: layer.height,
        offsetX: layer.offsetX,
        offsetY: layer.offsetY,
        storageOriginX: storageOrigin.x,
        storageOriginY: storageOrigin.y,
        pixels: layer.format === 'rgba' ? new Uint8ClampedArray(layer.pixels) : new Uint32Array(layer.pixels)
      }]
    }),
    palette: session.document.palette.map((entry) => ({ ...entry, color: { ...entry.color } })),
    nextColorId: session.document.nextColorId
  }
}

export function restoreAdjustmentSnapshot(session: DocumentSession, snapshot: AdjustmentSnapshot): void {
  const timeline = ensureAnimationDocument(session.document)
  for (const layerSnapshot of snapshot.layers) {
    const layer = session.document.layers.find((candidate) => candidate.id === layerSnapshot.layerId)
    if (!layer) continue
    const pixels = layerSnapshot.pixels instanceof Uint8ClampedArray ? new Uint8ClampedArray(layerSnapshot.pixels) : new Uint32Array(layerSnapshot.pixels)
    if ((layer.format === 'rgba') !== (pixels instanceof Uint8ClampedArray)) throw new Error(tr('core.history.adjustmentFormatChanged'))
    const frameId = layerSnapshot.frameId ?? timeline.activeFrameId
    const cel = animationCelAt(timeline, layerSnapshot.layerId, frameId)
    if (cel) cel.surface = layer.format === 'rgba' && pixels instanceof Uint8ClampedArray
      ? { format: 'rgba', width: layerSnapshot.width, height: layerSnapshot.height, offsetX: layerSnapshot.offsetX, offsetY: layerSnapshot.offsetY, storageOriginX: layerSnapshot.storageOriginX, storageOriginY: layerSnapshot.storageOriginY, pixels }
      : layer.format === 'indexed' && pixels instanceof Uint32Array
        ? { format: 'indexed', width: layerSnapshot.width, height: layerSnapshot.height, offsetX: layerSnapshot.offsetX, offsetY: layerSnapshot.offsetY, storageOriginX: layerSnapshot.storageOriginX, storageOriginY: layerSnapshot.storageOriginY, pixels }
        : undefined
    if (timeline.activeFrameId === frameId) {
      layer.width = layerSnapshot.width
      layer.height = layerSnapshot.height
      layer.offsetX = layerSnapshot.offsetX
      layer.offsetY = layerSnapshot.offsetY
      layer.pixels = pixels
      setLayerStorageOrigin(layer, { x: layerSnapshot.storageOriginX, y: layerSnapshot.storageOriginY })
      if (cel?.surface) cel.surface.pixels = layer.pixels
    }
  }
  session.document.palette = snapshot.palette.map((entry) => ({ ...entry, color: { ...entry.color } }))
  session.document.nextColorId = snapshot.nextColorId
}

export interface LayerUiSnapshot {
  selectedLayerIds: string[]
  selectedGroupId: string | null
  selectedGroupIds: string[]
  collapsedGroupIds: string[]
}

export const captureLayerUi = (session: DocumentSession): LayerUiSnapshot => ({
  selectedLayerIds: [...session.selectedLayerIds],
  selectedGroupId: session.selectedGroupId,
  selectedGroupIds: [...session.selectedGroupIds],
  collapsedGroupIds: [...session.collapsedGroupIds]
})

const restoreLayerUi = (session: DocumentSession, snapshot: LayerUiSnapshot): void => {
  session.selectedLayerIds = [...snapshot.selectedLayerIds]
  session.selectedGroupId = snapshot.selectedGroupId
  session.selectedGroupIds = [...snapshot.selectedGroupIds]
  session.collapsedGroupIds = [...snapshot.collapsedGroupIds]
}

export function commitLayerMerge(session: DocumentSession, beforeDocument: DocumentStructureSnapshot, beforeUi: LayerUiSnapshot, result: LayerMergeSuccess, label: string): void {
  session.selectedGroupId = null
  session.selectedGroupIds = []
  session.selectedLayerIds = [result.layerId]
  session.collapsedGroupIds = session.collapsedGroupIds.filter((id) => !result.removedGroupIds.includes(id))
  touch(session)
  const afterDocument = captureDocumentStructureSnapshot(session.document)
  const afterUi = captureLayerUi(session)
  session.history.push({
    label,
    bytes: documentStructureDeltaBytes(beforeDocument, afterDocument),
    undo: () => { restoreDocumentStructureSnapshot(session.document, beforeDocument); restoreLayerUi(session, beforeUi) },
    redo: () => { restoreDocumentStructureSnapshot(session.document, afterDocument); restoreLayerUi(session, afterUi) },
    invalidation: { kind: 'full' },
    requiresAnimationSync: false
  })
}
