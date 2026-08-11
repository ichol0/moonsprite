import { describe, expect, it } from 'vitest'
import { animationCelKey } from '@/core/animation'
import { resolveCanvasMoveAnimationCellKeys } from './canvas-move-selection'

describe('canvas move animation cell selection', () => {
  it('preserves an explicit cross-frame cell selection', () => {
    const selectedAnimationCellKeys = [
      animationCelKey('layer-a', 'frame-a'),
      animationCelKey('layer-b', 'frame-b')
    ]

    expect(resolveCanvasMoveAnimationCellKeys({
      selectedAnimationCellKeys,
      selectedLayerIds: ['layer-a', 'layer-b'],
      currentFrameId: 'frame-b',
      targetLayerId: 'layer-b',
      moveAllSelectedLayers: true
    })).toEqual(selectedAnimationCellKeys)
  })

  it('maps a layer-only multi-selection to the current frame', () => {
    expect(resolveCanvasMoveAnimationCellKeys({
      selectedAnimationCellKeys: [],
      selectedLayerIds: ['layer-a', 'layer-b'],
      currentFrameId: 'frame-b',
      targetLayerId: 'layer-b',
      moveAllSelectedLayers: true
    })).toEqual([
      animationCelKey('layer-a', 'frame-b'),
      animationCelKey('layer-b', 'frame-b')
    ])
  })
})
