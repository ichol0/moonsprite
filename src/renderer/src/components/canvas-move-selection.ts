import { animationCelKey, parseAnimationCelKey } from '@/core/animation'

interface CanvasMoveAnimationCellSelection {
  selectedAnimationCellKeys: readonly string[]
  selectedAnimationFrameIds: readonly string[]
  selectedLayerIds: readonly string[]
  currentFrameId: string | null | undefined
  targetLayerId: string
  moveAllSelectedLayers: boolean
}

interface CanvasMoveLayerSelection {
  selectedLayerIds: readonly string[]
  selectedGroupIds: readonly string[]
  layerIdsForGroup: (groupId: string) => readonly string[]
}

export function resolveCanvasMoveLayerIds({ selectedLayerIds, selectedGroupIds, layerIdsForGroup }: CanvasMoveLayerSelection): string[] {
  const resolved = new Set(selectedLayerIds)
  for (const groupId of selectedGroupIds) for (const layerId of layerIdsForGroup(groupId)) resolved.add(layerId)
  return [...resolved]
}

export const shouldUseFreeTileInstanceMove = (activeLayerId: string, freeTileInstanceLayerId: string | null | undefined): boolean =>
  freeTileInstanceLayerId === activeLayerId

export const animationFrameIdsForCellKeys = (keys: readonly string[]): string[] => [...new Set(keys.flatMap((key) => {
  const target = parseAnimationCelKey(key)
  return target ? [target.frameId] : []
}))]

export function resolveCanvasMoveAnimationCellKeys({
  selectedAnimationCellKeys,
  selectedAnimationFrameIds,
  selectedLayerIds,
  currentFrameId,
  targetLayerId,
  moveAllSelectedLayers
}: CanvasMoveAnimationCellSelection): string[] {
  if (!currentFrameId) return []
  const targetKey = animationCelKey(targetLayerId, currentFrameId)
  if (selectedAnimationCellKeys.includes(targetKey)) return [...selectedAnimationCellKeys]
  if (selectedAnimationFrameIds.length > 1) return selectedAnimationFrameIds.map((frameId) => animationCelKey(targetLayerId, frameId))
  if (moveAllSelectedLayers) return selectedLayerIds.map((layerId) => animationCelKey(layerId, currentFrameId))
  return [targetKey]
}
