import { describe, expect, it } from 'vitest'
import { createDocument, createLayer, getActiveLayer } from './document'
import { HistoryStack } from './history'
import { assignLayersToGroup, assignLayersToRoot, canMoveGroupInto, createLayerGroup, reorderGroup, reorderLayers, ungroupSelected, type LayerOperationState } from './layer-operations'

const group = (id: string, parentGroupId: string | null = null) => ({ id, name: id, parentGroupId, visible: true, locked: false, opacity: 1, blendMode: 'normal' as const })

const createState = (): LayerOperationState => {
  const document = createDocument('layer operations', 2, 2, 'rgba')
  return { document, selectedLayerIds: [document.activeLayerId], selectedGroupId: null }
}

describe('layer operations', () => {
  it('reorders selected layers as one undoable operation', () => {
    const state = createState()
    const bottom = getActiveLayer(state.document)
    const middle = createLayer('middle', 2, 2, 'rgba')
    const top = createLayer('top', 2, 2, 'rgba')
    state.document.layers.push(middle, top)
    const history = reorderLayers(state, [bottom.id, middle.id], top.id, true)
    expect(state.document.layers.map((layer) => layer.id)).toEqual([top.id, bottom.id, middle.id])
    expect(state.selectedLayerIds).toEqual([bottom.id, middle.id])
    expect(history?.label).toBe('拖动图层')
    history?.undo()
    expect(state.document.layers.map((layer) => layer.id)).toEqual([bottom.id, middle.id, top.id])
    history?.redo()
    expect(state.document.layers.map((layer) => layer.id)).toEqual([top.id, bottom.id, middle.id])
  })

  it('moves layers into and out of a group while preserving undo data', () => {
    const state = createState()
    const first = getActiveLayer(state.document)
    const second = createLayer('second', 2, 2, 'rgba')
    state.document.layers.push(second)
    state.document.groups.push(group('characters'))
    first.groupId = 'characters'
    const intoGroup = assignLayersToGroup(state, [second.id], 'characters', first.id, true)
    expect(second.groupId).toBe('characters')
    expect(state.document.layers.map((layer) => layer.id)).toEqual([first.id, second.id])
    intoGroup?.undo()
    expect(second.groupId).toBeNull()
    intoGroup?.redo()
    expect(second.groupId).toBe('characters')

    const toRoot = assignLayersToRoot(state, [second.id])
    expect(second.groupId).toBeNull()
    toRoot?.undo()
    expect(second.groupId).toBe('characters')
  })

  it('rejects a group drop into itself or one of its descendants', () => {
    const state = createState()
    state.document.groups.push(group('parent'), group('child', 'parent'))
    expect(canMoveGroupInto(state.document, 'parent', 'parent')).toBe(false)
    expect(canMoveGroupInto(state.document, 'parent', 'child')).toBe(false)
    expect(reorderGroup(state, 'parent', 'child')).toBeNull()
  })

  it('keeps group and member ordering reversible', () => {
    const state = createState()
    const first = getActiveLayer(state.document)
    const second = createLayer('second', 2, 2, 'rgba')
    state.document.layers.push(second)
    state.document.groups.push(group('a'), group('b'))
    first.groupId = 'a'
    second.groupId = 'b'
    const history = reorderGroup(state, 'a', 'b', true)
    expect(state.document.groups.map((item) => item.id)).toEqual(['b', 'a'])
    expect(state.document.layers.map((item) => item.id)).toEqual([second.id, first.id])
    history?.undo()
    expect(state.document.groups.map((item) => item.id)).toEqual(['a', 'b'])
    expect(state.document.layers.map((item) => item.id)).toEqual([first.id, second.id])
  })

  it('can be pushed into the shared history stack unchanged', () => {
    const state = createState()
    const first = getActiveLayer(state.document)
    const second = createLayer('second', 2, 2, 'rgba')
    state.document.layers.push(second)
    const history = new HistoryStack()
    const entry = reorderLayers(state, [first.id], second.id, true)
    if (!entry) throw new Error('expected layer operation history')
    history.push(entry)
    history.undo()
    expect(state.document.layers.map((layer) => layer.id)).toEqual([first.id, second.id])
    history.redo()
    expect(state.document.layers.map((layer) => layer.id)).toEqual([second.id, first.id])
  })

  it('creates and ungroups a selected layer with reversible structure history', () => {
    const state = createState()
    const layer = getActiveLayer(state.document)
    const create = createLayerGroup(state, 'group-created', 'Created')
    expect(layer.groupId).toBe('group-created')
    expect(state.selectedGroupId).toBe('group-created')
    create?.undo()
    expect(layer.groupId).toBeNull()
    create?.redo()
    expect(layer.groupId).toBe('group-created')

    const ungroup = ungroupSelected(state)
    expect(state.document.groups).toHaveLength(0)
    expect(layer.groupId).toBeNull()
    ungroup?.undo()
    expect(state.document.groups.map((item) => item.id)).toEqual(['group-created'])
    expect(layer.groupId).toBe('group-created')
  })
})
