import { describe, expect, it } from 'vitest'
import { animationCelKey } from '@/core/animation'
import { animationFrameIdsForCellKeys, resolveCanvasMoveAnimationCellKeys, resolveCanvasMoveLayerIds, shouldUseFreeTileInstanceMove } from './canvas-move-selection'

describe('canvas move animation cell selection', () => {
  it('expands selected groups into every descendant layer for canvas movement', () => {
    expect(resolveCanvasMoveLayerIds({
      selectedLayerIds: ['outside-layer'],
      selectedGroupIds: ['group-a'],
      layerIdsForGroup: (groupId) => groupId === 'group-a' ? ['group-layer-a', 'nested-layer'] : []
    })).toEqual(['outside-layer', 'group-layer-a', 'nested-layer'])
  })

  it('preserves an explicit cross-frame cell selection', () => {
    const selectedAnimationCellKeys = [
      animationCelKey('layer-a', 'frame-a'),
      animationCelKey('layer-b', 'frame-b')
    ]

    expect(resolveCanvasMoveAnimationCellKeys({
      selectedAnimationCellKeys,
      selectedAnimationFrameIds: [],
      selectedLayerIds: ['layer-a', 'layer-b'],
      currentFrameId: 'frame-b',
      targetLayerId: 'layer-b',
      moveAllSelectedLayers: true
    })).toEqual(selectedAnimationCellKeys)
  })

  it('maps a layer-only multi-selection to the current frame', () => {
    expect(resolveCanvasMoveAnimationCellKeys({
      selectedAnimationCellKeys: [],
      selectedAnimationFrameIds: [],
      selectedLayerIds: ['layer-a', 'layer-b'],
      currentFrameId: 'frame-b',
      targetLayerId: 'layer-b',
      moveAllSelectedLayers: true
    })).toEqual([
      animationCelKey('layer-a', 'frame-b'),
      animationCelKey('layer-b', 'frame-b')
    ])
  })

  it('maps a frame multi-selection to the target layer without creating a cel selection', () => {
    expect(resolveCanvasMoveAnimationCellKeys({
      selectedAnimationCellKeys: [],
      selectedAnimationFrameIds: ['frame-a', 'frame-c'],
      selectedLayerIds: ['layer-a'],
      currentFrameId: 'frame-c',
      targetLayerId: 'layer-a',
      moveAllSelectedLayers: false
    })).toEqual([
      animationCelKey('layer-a', 'frame-a'),
      animationCelKey('layer-a', 'frame-c')
    ])
  })

  it('deduplicates animation frame ids for preview cache invalidation', () => {
    expect(animationFrameIdsForCellKeys([
      animationCelKey('layer-a', 'frame-a'),
      animationCelKey('layer-b', 'frame-a'),
      animationCelKey('layer-a', 'frame-b'),
      'invalid'
    ])).toEqual(['frame-a', 'frame-b'])
  })

  it('moves Free Tile instances only while their instance-layer view is open', () => {
    expect(shouldUseFreeTileInstanceMove('free-layer', null)).toBe(false)
    expect(shouldUseFreeTileInstanceMove('free-layer', 'other-layer')).toBe(false)
    expect(shouldUseFreeTileInstanceMove('free-layer', 'free-layer')).toBe(true)
  })
})
