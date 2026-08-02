import { describe, expect, it } from 'vitest'
import { buildLayerPanelTree, getLayerPanelDescendantGroupIds, resolveLayerPanelDropTarget, type LayerPanelNode } from './layer-panel-layout'

const layers = [
  { id: 'background', groupId: null },
  { id: 'body', groupId: 'characters' },
  { id: 'eyes', groupId: 'characters' },
  { id: 'highlight', groupId: 'face' }
]
const groups = [
  { id: 'characters', parentGroupId: null },
  { id: 'face', parentGroupId: 'characters' }
]

describe('layer panel layout helpers', () => {
  it('flattens nested groups in top-to-bottom display order', () => {
    expect(buildLayerPanelTree({ layers, groups })).toEqual([
      { kind: 'group', id: 'characters', depth: 0 },
      { kind: 'group', id: 'face', depth: 1 },
      { kind: 'layer', id: 'highlight', depth: 2 },
      { kind: 'layer', id: 'eyes', depth: 1 },
      { kind: 'layer', id: 'body', depth: 1 },
      { kind: 'layer', id: 'background', depth: 0 }
    ])
  })

  it('hides descendants when a group is collapsed', () => {
    expect(buildLayerPanelTree({ layers, groups, collapsedGroupIds: ['characters'] })).toEqual([
      { kind: 'group', id: 'characters', depth: 0 },
      { kind: 'layer', id: 'background', depth: 0 }
    ])
  })

  it('guards descendant checks against nested groups', () => {
    expect(getLayerPanelDescendantGroupIds(groups, 'characters')).toEqual(['face'])
  })

  it('uses the group owning a layer as the drop target for a group drag', () => {
    const nodes = buildLayerPanelTree({ layers, groups })
    expect(resolveLayerPanelDropTarget({ layers, groups, nodes, hit: { kind: 'layer', id: 'highlight', top: 20, bottom: 52, pointerY: 36 }, draggedLayerIds: [], draggedGroupId: 'other' })).toEqual({ kind: 'group', id: 'face', depth: 2 })
  })

  it('rejects dropping a group onto itself or a descendant', () => {
    const nodes = buildLayerPanelTree({ layers, groups })
    expect(resolveLayerPanelDropTarget({ layers, groups, nodes, hit: { kind: 'group', id: 'characters', top: 0, bottom: 32, pointerY: 16 }, draggedLayerIds: [], draggedGroupId: 'characters' })).toBeNull()
    expect(resolveLayerPanelDropTarget({ layers, groups, nodes, hit: { kind: 'group', id: 'face', top: 32, bottom: 64, pointerY: 48 }, draggedLayerIds: [], draggedGroupId: 'characters' })).toBeNull()
  })

  it('keeps layer insertion depth tied to the visible row', () => {
    const nodes: LayerPanelNode[] = buildLayerPanelTree({ layers, groups })
    expect(resolveLayerPanelDropTarget({ layers, groups, nodes, hit: { kind: 'layer', id: 'body', top: 96, bottom: 128, pointerY: 100 }, draggedLayerIds: ['background'] })).toEqual({ kind: 'layer', id: 'body', insertAfter: true, depth: 1 })
  })
})
