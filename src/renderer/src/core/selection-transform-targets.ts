import type { SelectionMask, SelectionRect, SpriteDocument } from '@shared/types'
import { animationLayerAtFrame, createAnimationCelLookup, ensureAnimationDocument, syncAnimationLayerAtFrame } from './animation'
import type { PixelEdit } from './history'
import type { SelectionShearTransform } from './selection'
import type { SymmetryAxes, SymmetryCenter, SymmetryPoint } from './symmetry'
import { applySelectionTransform, captureSelectionTransform, type SelectionTransformLayerState } from './tools'

export const captureAnimationFrameSelectionTransformStates = (
  document: SpriteDocument,
  selectedFrameIds: readonly string[],
  selectedLayerIds: readonly string[],
  selection: SelectionMask
): SelectionTransformLayerState[] => {
  if (selectedFrameIds.length < 2 || selectedLayerIds.length === 0) return []
  const timeline = ensureAnimationDocument(document)
  const selectedFrames = new Set(selectedFrameIds)
  const selectedLayers = new Set(selectedLayerIds)
  const orderedFrameIds = [
    ...(selectedFrames.has(timeline.activeFrameId) ? [timeline.activeFrameId] : []),
    ...timeline.frames.map((frame) => frame.id).filter((frameId) => frameId !== timeline.activeFrameId && selectedFrames.has(frameId))
  ]
  const orderedLayerIds = [
    ...(selectedLayers.has(document.activeLayerId) ? [document.activeLayerId] : []),
    ...document.layers.map((layer) => layer.id).filter((layerId) => layerId !== document.activeLayerId && selectedLayers.has(layerId))
  ]
  const lookup = createAnimationCelLookup(timeline)
  const capturedSourceIds = new Set<string>()
  const states: SelectionTransformLayerState[] = []
  for (const frameId of orderedFrameIds) {
    for (const layerId of orderedLayerIds) {
      const layerDefinition = document.layers.find((layer) => layer.id === layerId)
      if (!layerDefinition || layerDefinition.kind) continue
      const cel = lookup.at(layerId, frameId)
      const sourceCel = lookup.resolve(cel)
      const sourceKey = sourceCel ? `${layerId}:${sourceCel.id}` : null
      if (!sourceCel?.surface || !sourceKey || capturedSourceIds.has(sourceKey)) continue
      const layer = frameId === timeline.activeFrameId
        ? layerDefinition
        : animationLayerAtFrame(document, layerId, frameId)
      if (!layer || layer.kind) continue
      const source = captureSelectionTransform(document, selection, layer)
      if (!source) continue
      capturedSourceIds.add(sourceKey)
      states.push({ layerId, frameId, source, previewEdit: null, translationPreview: null })
    }
  }
  return states
}

export const selectionTransformLayerForState = (
  document: SpriteDocument,
  state: Pick<SelectionTransformLayerState, 'layerId' | 'frameId'>
) => {
  if (!state.frameId || document.animation?.activeFrameId === state.frameId) {
    return document.layers.find((candidate) => candidate.id === state.layerId) ?? null
  }
  return animationLayerAtFrame(document, state.layerId, state.frameId)
}

export const applySelectionTransformLayerState = (
  document: SpriteDocument,
  state: SelectionTransformLayerState,
  target: SelectionRect,
  angle = 0,
  copy = false,
  shear?: SelectionShearTransform,
  symmetryAxes?: SymmetryAxes,
  symmetryCenter?: SymmetryCenter,
  symmetryStartPoint?: SymmetryPoint
): PixelEdit | null => {
  const layer = selectionTransformLayerForState(document, state)
  if (!layer || layer.kind) return null
  const edit = applySelectionTransform(document, state.source, target, angle, copy, shear, symmetryAxes, symmetryCenter, layer, symmetryStartPoint)
  if (state.frameId) {
    if (edit) edit.frameId = state.frameId
    syncAnimationLayerAtFrame(document, layer, state.frameId)
  }
  return edit
}
