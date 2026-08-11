import { animationCelKey } from '@/core/animation'

interface CanvasMoveAnimationCellSelection {
  selectedAnimationCellKeys: readonly string[]
  selectedLayerIds: readonly string[]
  currentFrameId: string | null | undefined
  targetLayerId: string
  moveAllSelectedLayers: boolean
}

export function resolveCanvasMoveAnimationCellKeys({
  selectedAnimationCellKeys,
  selectedLayerIds,
  currentFrameId,
  targetLayerId,
  moveAllSelectedLayers
}: CanvasMoveAnimationCellSelection): string[] {
  if (!currentFrameId) return []
  const targetKey = animationCelKey(targetLayerId, currentFrameId)
  if (selectedAnimationCellKeys.includes(targetKey)) return [...selectedAnimationCellKeys]
  if (moveAllSelectedLayers) return selectedLayerIds.map((layerId) => animationCelKey(layerId, currentFrameId))
  return [targetKey]
}
