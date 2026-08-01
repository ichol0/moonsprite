import type { SpriteDocument } from '@shared/types'
import { getActiveLayer, getLayer } from '@/core/document'
import { decodeProject, encodeProject } from '@/core/project-format'
import type { LayerMergeSuccess } from '@/core/layer-merge'
import type { AdjustmentSnapshot, DocumentSession } from './workspace-types'
import { touch } from './workspace-session'

export function captureAdjustmentSnapshot(session: DocumentSession): AdjustmentSnapshot {
  const layer = getActiveLayer(session.document)
  return {
    layerId: layer.id,
    pixels: layer.format === 'rgba' ? new Uint8ClampedArray(layer.pixels) : new Uint32Array(layer.pixels),
    palette: session.document.palette.map((entry) => ({ ...entry, color: { ...entry.color } })),
    nextColorId: session.document.nextColorId
  }
}

export function restoreAdjustmentSnapshot(session: DocumentSession, snapshot: AdjustmentSnapshot): void {
  const layer = getLayer(session.document, snapshot.layerId)
  if (layer.format === 'rgba' && snapshot.pixels instanceof Uint8ClampedArray) layer.pixels = new Uint8ClampedArray(snapshot.pixels)
  else if (layer.format === 'indexed' && snapshot.pixels instanceof Uint32Array) layer.pixels = new Uint32Array(snapshot.pixels)
  else throw new Error('调整预览的图层格式已发生变化。')
  session.document.palette = snapshot.palette.map((entry) => ({ ...entry, color: { ...entry.color } }))
  session.document.nextColorId = snapshot.nextColorId
}

export function restoreDocumentSnapshot(target: SpriteDocument, data: Uint8Array): void {
  const restored = decodeProject(data)
  restored.id = target.id
  restored.filePath = target.filePath
  restored.dirty = true
  Object.assign(target, restored)
}

export interface LayerUiSnapshot {
  selectedLayerIds: string[]
  selectedGroupId: string | null
  collapsedGroupIds: string[]
}

export const captureLayerUi = (session: DocumentSession): LayerUiSnapshot => ({
  selectedLayerIds: [...session.selectedLayerIds],
  selectedGroupId: session.selectedGroupId,
  collapsedGroupIds: [...session.collapsedGroupIds]
})

const restoreLayerUi = (session: DocumentSession, snapshot: LayerUiSnapshot): void => {
  session.selectedLayerIds = [...snapshot.selectedLayerIds]
  session.selectedGroupId = snapshot.selectedGroupId
  session.collapsedGroupIds = [...snapshot.collapsedGroupIds]
}

export function commitLayerMerge(session: DocumentSession, beforeDocument: Uint8Array, beforeUi: LayerUiSnapshot, result: LayerMergeSuccess, label: string): void {
  session.selectedGroupId = null
  session.selectedLayerIds = [result.layerId]
  session.collapsedGroupIds = session.collapsedGroupIds.filter((id) => !result.removedGroupIds.includes(id))
  touch(session)
  const afterDocument = encodeProject(session.document)
  const afterUi = captureLayerUi(session)
  session.history.push({
    label,
    bytes: beforeDocument.byteLength + afterDocument.byteLength,
    undo: () => { restoreDocumentSnapshot(session.document, beforeDocument); restoreLayerUi(session, beforeUi) },
    redo: () => { restoreDocumentSnapshot(session.document, afterDocument); restoreLayerUi(session, afterUi) }
  })
}
