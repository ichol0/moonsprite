import type { LayerGroup, SpriteDocument } from '@shared/types'
import { getActiveLayer, getDescendantGroupIds, getGroup, getLayerIdsInGroup } from './document'
import type { HistoryEntry } from './history'

export interface LayerOperationState {
  document: SpriteDocument
  selectedLayerIds: string[]
  selectedGroupId: string | null
  collapsedGroupIds?: string[]
}

const uniqueLayerIds = (layerIds: readonly string[]): string[] => [...new Set(layerIds)]

const selectLayers = (state: LayerOperationState, layerIds: string[], groupId: string | null): void => {
  if (layerIds.length > 0) state.document.activeLayerId = layerIds.at(-1)!
  state.selectedLayerIds = layerIds
  state.selectedGroupId = groupId
}

const applyLayerOrder = (document: SpriteDocument, layerById: Map<string, SpriteDocument['layers'][number]>, order: string[], activeLayerId: string): void => {
  document.layers = order.map((id) => layerById.get(id)).filter((layer): layer is SpriteDocument['layers'][number] => Boolean(layer))
  document.activeLayerId = activeLayerId
}

const applyLayerGroups = (layers: SpriteDocument['layers'], groupIds: Map<string, string | null>): void => {
  for (const layer of layers) if (groupIds.has(layer.id)) layer.groupId = groupIds.get(layer.id) ?? null
}

export const canMoveGroupInto = (document: SpriteDocument, groupId: string, parentGroupId: string): boolean =>
  groupId !== parentGroupId && !getDescendantGroupIds(document, groupId).includes(parentGroupId)

export const reorderLayers = (state: LayerOperationState, layerIds: readonly string[], targetLayerId: string, insertAfterTarget = true): HistoryEntry | null => {
  const ids = uniqueLayerIds(layerIds)
  if (ids.length === 0 || ids.includes(targetLayerId)) return null
  const { document } = state
  const dragged = document.layers.filter((layer) => ids.includes(layer.id))
  if (dragged.length === 0) return null
  const beforeOrder = document.layers.map((layer) => layer.id)
  const layerById = new Map(document.layers.map((layer) => [layer.id, layer]))
  document.layers = document.layers.filter((layer) => !ids.includes(layer.id))
  const targetIndex = document.layers.findIndex((layer) => layer.id === targetLayerId)
  if (targetIndex < 0) {
    document.layers = beforeOrder.map((id) => layerById.get(id)!).filter(Boolean)
    return null
  }
  document.layers.splice(targetIndex + (insertAfterTarget ? 1 : 0), 0, ...dragged)
  const selected = dragged.map((layer) => layer.id)
  const activeLayerId = selected.at(-1)!
  selectLayers(state, selected, null)
  const afterOrder = document.layers.map((layer) => layer.id)
  return {
    label: '拖动图层',
    bytes: (beforeOrder.length + afterOrder.length) * 8,
    undo: () => applyLayerOrder(document, layerById, beforeOrder, activeLayerId),
    redo: () => applyLayerOrder(document, layerById, afterOrder, activeLayerId)
  }
}

export const assignLayersToGroup = (state: LayerOperationState, layerIds: readonly string[], groupId: string, targetLayerId?: string, insertAfterTarget = true): HistoryEntry | null => {
  const ids = uniqueLayerIds(layerIds)
  const { document } = state
  const selectedLayers = document.layers.filter((layer) => ids.includes(layer.id))
  if (selectedLayers.length === 0) return null
  getGroup(document, groupId)
  const beforeOrder = document.layers.map((layer) => layer.id)
  const beforeGroupIds = new Map(selectedLayers.map((layer) => [layer.id, layer.groupId ?? null]))
  const layerById = new Map(document.layers.map((layer) => [layer.id, layer]))
  document.layers = document.layers.filter((layer) => !ids.includes(layer.id))
  const targetIndex = targetLayerId ? document.layers.findIndex((layer) => layer.id === targetLayerId && layer.groupId === groupId) : -1
  const lastMember = document.layers.reduce((last, layer, index) => layer.groupId === groupId ? index : last, -1)
  document.layers.splice(targetIndex >= 0 ? targetIndex + (insertAfterTarget ? 1 : 0) : lastMember + 1, 0, ...selectedLayers)
  const selected = selectedLayers.map((layer) => layer.id)
  for (const layer of selectedLayers) layer.groupId = groupId
  const activeLayerId = selected.at(-1)!
  selectLayers(state, selected, groupId)
  const afterOrder = document.layers.map((layer) => layer.id)
  const afterGroupIds = new Map(selectedLayers.map((layer) => [layer.id, groupId]))
  const apply = (order: string[], groupIds: Map<string, string | null>): void => {
    applyLayerOrder(document, layerById, order, activeLayerId)
    applyLayerGroups(selectedLayers, groupIds)
  }
  return { label: '移动到图层组', bytes: (beforeOrder.length + afterOrder.length) * 8, undo: () => apply(beforeOrder, beforeGroupIds), redo: () => apply(afterOrder, afterGroupIds) }
}

export const assignLayersToRoot = (state: LayerOperationState, layerIds: readonly string[], targetLayerId?: string, insertAfterTarget = true): HistoryEntry | null => {
  const ids = uniqueLayerIds(layerIds)
  const { document } = state
  const selectedLayers = document.layers.filter((layer) => ids.includes(layer.id))
  if (selectedLayers.length === 0) return null
  const beforeOrder = document.layers.map((layer) => layer.id)
  const beforeGroupIds = new Map(selectedLayers.map((layer) => [layer.id, layer.groupId ?? null]))
  const layerById = new Map(document.layers.map((layer) => [layer.id, layer]))
  document.layers = document.layers.filter((layer) => !ids.includes(layer.id))
  const targetIndex = targetLayerId ? document.layers.findIndex((layer) => layer.id === targetLayerId) : -1
  document.layers.splice(targetIndex >= 0 ? targetIndex + (insertAfterTarget ? 1 : 0) : 0, 0, ...selectedLayers)
  const selected = selectedLayers.map((layer) => layer.id)
  for (const layer of selectedLayers) layer.groupId = null
  const activeLayerId = selected.at(-1)!
  selectLayers(state, selected, null)
  const afterOrder = document.layers.map((layer) => layer.id)
  const rootGroupIds = new Map(selectedLayers.map((layer) => [layer.id, null]))
  const apply = (order: string[], groupIds: Map<string, string | null>): void => {
    applyLayerOrder(document, layerById, order, activeLayerId)
    applyLayerGroups(selectedLayers, groupIds)
  }
  return { label: '移到最外层', bytes: (beforeOrder.length + afterOrder.length) * 8 + selectedLayers.length * 16, undo: () => apply(beforeOrder, beforeGroupIds), redo: () => apply(afterOrder, rootGroupIds) }
}

export const assignLayersAboveGroup = (state: LayerOperationState, layerIds: readonly string[], groupId: string): HistoryEntry | null => {
  const ids = uniqueLayerIds(layerIds)
  const { document } = state
  const selectedLayers = document.layers.filter((layer) => ids.includes(layer.id))
  if (selectedLayers.length === 0) return null
  const group = getGroup(document, groupId)
  const containerGroupIds = new Set([groupId, ...getDescendantGroupIds(document, groupId)])
  const beforeOrder = document.layers.map((layer) => layer.id)
  const beforeGroupIds = new Map(selectedLayers.map((layer) => [layer.id, layer.groupId ?? null]))
  const layerById = new Map(document.layers.map((layer) => [layer.id, layer]))
  const originalIndex = new Map(document.layers.map((layer, index) => [layer.id, index]))
  const groupTopIndex = document.layers.reduce((top, layer, index) => layer.groupId && containerGroupIds.has(layer.groupId) ? Math.max(top, index) : top, -1)
  document.layers = document.layers.filter((layer) => !ids.includes(layer.id))
  const insertionIndex = groupTopIndex < 0 ? 0 : document.layers.reduce((count, layer) => (originalIndex.get(layer.id) ?? Number.POSITIVE_INFINITY) <= groupTopIndex ? count + 1 : count, 0)
  document.layers.splice(insertionIndex, 0, ...selectedLayers)
  const selected = selectedLayers.map((layer) => layer.id)
  const parentGroupId = group.parentGroupId ?? null
  for (const layer of selectedLayers) layer.groupId = parentGroupId
  const activeLayerId = selected.at(-1)!
  selectLayers(state, selected, null)
  const afterOrder = document.layers.map((layer) => layer.id)
  const afterGroupIds = new Map(selectedLayers.map((layer) => [layer.id, parentGroupId]))
  const apply = (order: string[], groupIds: Map<string, string | null>): void => {
    applyLayerOrder(document, layerById, order, activeLayerId)
    applyLayerGroups(selectedLayers, groupIds)
  }
  return { label: '移动到图层组上方', bytes: (beforeOrder.length + afterOrder.length) * 8 + selectedLayers.length * 16, undo: () => apply(beforeOrder, beforeGroupIds), redo: () => apply(afterOrder, afterGroupIds) }
}

export const reorderGroup = (state: LayerOperationState, groupId: string, targetGroupId: string, insertAfterTarget = true): HistoryEntry | null => {
  if (!canMoveGroupInto(state.document, groupId, targetGroupId)) return null
  const { document } = state
  const group = getGroup(document, groupId)
  const target = getGroup(document, targetGroupId)
  const movingGroupIds = new Set([groupId, ...getDescendantGroupIds(document, groupId)])
  const targetGroupIds = new Set([targetGroupId, ...getDescendantGroupIds(document, targetGroupId)])
  const movingLayers = document.layers.filter((layer) => layer.groupId && movingGroupIds.has(layer.groupId))
  const movingLayerIds = new Set(movingLayers.map((layer) => layer.id))
  const beforeLayerOrder = document.layers.map((layer) => layer.id)
  const beforeGroupOrder = document.groups.map((item) => item.id)
  const beforeParent = group.parentGroupId ?? null
  const activeLayerId = document.activeLayerId
  const layerById = new Map(document.layers.map((layer) => [layer.id, layer]))
  const groupById = new Map(document.groups.map((item) => [item.id, item]))
  const remainingLayers = document.layers.filter((layer) => !movingLayerIds.has(layer.id))
  const targetLayerIndexes = remainingLayers.flatMap((layer, index) => layer.groupId && targetGroupIds.has(layer.groupId) ? [index] : [])
  if (movingLayers.length > 0 && targetLayerIndexes.length > 0) {
    remainingLayers.splice(insertAfterTarget ? Math.max(...targetLayerIndexes) + 1 : Math.min(...targetLayerIndexes), 0, ...movingLayers)
    document.layers = remainingLayers
  }
  const remainingGroups = document.groups.filter((item) => item.id !== groupId)
  const targetIndex = remainingGroups.findIndex((item) => item.id === targetGroupId)
  if (targetIndex < 0) return null
  remainingGroups.splice(targetIndex + (insertAfterTarget ? 1 : 0), 0, group)
  document.groups = remainingGroups
  group.parentGroupId = target.parentGroupId ?? null
  const selected = getLayerIdsInGroup(document, group.id)
  state.selectedGroupId = group.id
  state.selectedLayerIds = selected
  const afterLayerOrder = document.layers.map((layer) => layer.id)
  const afterGroupOrder = document.groups.map((item) => item.id)
  const afterParent = group.parentGroupId ?? null
  const apply = (layerOrder: string[], groupOrder: string[], parentGroupId: string | null): void => {
    applyLayerOrder(document, layerById, layerOrder, activeLayerId)
    document.groups = groupOrder.map((id) => groupById.get(id)).filter((item): item is SpriteDocument['groups'][number] => Boolean(item))
    group.parentGroupId = parentGroupId
  }
  return { label: '移动图层组', bytes: (beforeLayerOrder.length + afterLayerOrder.length + beforeGroupOrder.length + afterGroupOrder.length) * 8 + 48, undo: () => apply(beforeLayerOrder, beforeGroupOrder, beforeParent), redo: () => apply(afterLayerOrder, afterGroupOrder, afterParent) }
}

export const assignGroupToGroup = (state: LayerOperationState, groupId: string, parentGroupId: string): HistoryEntry | null => {
  if (!canMoveGroupInto(state.document, groupId, parentGroupId)) return null
  const group = getGroup(state.document, groupId)
  getGroup(state.document, parentGroupId)
  const before = group.parentGroupId ?? null
  if (before === parentGroupId) return null
  group.parentGroupId = parentGroupId
  state.selectedGroupId = group.id
  state.selectedLayerIds = getLayerIdsInGroup(state.document, group.id)
  return { label: '移动图层组', bytes: 48, undo: () => { group.parentGroupId = before }, redo: () => { group.parentGroupId = parentGroupId } }
}

export const assignGroupToRoot = (state: LayerOperationState, groupId: string): HistoryEntry | null => {
  const group = getGroup(state.document, groupId)
  const before = group.parentGroupId ?? null
  if (!before) return null
  group.parentGroupId = null
  state.selectedGroupId = group.id
  state.selectedLayerIds = getLayerIdsInGroup(state.document, group.id)
  return { label: '移到最外层', bytes: 48, undo: () => { group.parentGroupId = before }, redo: () => { group.parentGroupId = null } }
}

export const createLayerGroup = (state: LayerOperationState, id: string, name: string): HistoryEntry | null => {
  const { document } = state
  if (document.groups.some((group) => group.id === id)) return null
  const selected = state.selectedGroupId ? [] : document.layers.filter((layer) => state.selectedLayerIds.includes(layer.id))
  const layers = selected.length > 0 ? selected : state.selectedGroupId ? [] : [getActiveLayer(document)]
  const commonParent = state.selectedGroupId ?? (layers.length > 0 && layers.every((layer) => (layer.groupId ?? null) === (layers[0].groupId ?? null)) ? layers[0].groupId ?? null : null)
  const group: LayerGroup = { id, name, parentGroupId: commonParent, visible: true, locked: false, opacity: 1, blendMode: 'normal' }
  const beforeGroupIds = new Map(layers.map((layer) => [layer.id, layer.groupId ?? null]))
  document.groups.push(group)
  for (const layer of layers) layer.groupId = group.id
  state.selectedGroupId = group.id
  state.selectedLayerIds = layers.map((layer) => layer.id)
  const applyCreate = (): void => {
    if (!document.groups.includes(group)) document.groups.push(group)
    for (const layer of layers) layer.groupId = group.id
    state.selectedGroupId = group.id
  }
  return {
    label: '新建图层组',
    bytes: 96 + layers.length * 16,
    undo: () => {
      document.groups = document.groups.filter((item) => item.id !== group.id)
      applyLayerGroups(layers, beforeGroupIds)
      state.selectedGroupId = commonParent
    },
    redo: applyCreate
  }
}

export const ungroupSelected = (state: LayerOperationState): HistoryEntry | null => {
  const { document } = state
  const groupIds = new Set<string>()
  if (state.selectedGroupId) groupIds.add(state.selectedGroupId)
  else for (const layer of document.layers) if (state.selectedLayerIds.includes(layer.id) && layer.groupId) groupIds.add(layer.groupId)
  if (groupIds.size === 0) return null
  const removedGroups = document.groups.filter((group) => groupIds.has(group.id))
  const removedById = new Map(removedGroups.map((group) => [group.id, group]))
  const beforeGroups = [...document.groups]
  const beforeLayerGroupIds = new Map(document.layers.map((layer) => [layer.id, layer.groupId ?? null]))
  const beforeParentGroupIds = new Map(document.groups.map((group) => [group.id, group.parentGroupId ?? null]))
  const survivingParent = (groupId: string): string | null => {
    let parentId = removedById.get(groupId)?.parentGroupId ?? null
    const visited = new Set<string>()
    while (parentId && groupIds.has(parentId) && !visited.has(parentId)) {
      visited.add(parentId)
      parentId = removedById.get(parentId)?.parentGroupId ?? null
    }
    return parentId
  }
  const applyUngroup = (): void => {
    for (const layer of document.layers) if (layer.groupId && groupIds.has(layer.groupId)) layer.groupId = survivingParent(layer.groupId)
    for (const group of document.groups) if (group.parentGroupId && groupIds.has(group.parentGroupId)) group.parentGroupId = survivingParent(group.parentGroupId)
    document.groups = document.groups.filter((group) => !groupIds.has(group.id))
  }
  applyUngroup()
  state.selectedGroupId = null
  state.selectedLayerIds = document.layers.filter((layer) => {
    const originalGroupId = beforeLayerGroupIds.get(layer.id)
    return Boolean(originalGroupId && groupIds.has(originalGroupId))
  }).map((layer) => layer.id)
  if (state.collapsedGroupIds) state.collapsedGroupIds = state.collapsedGroupIds.filter((id) => !groupIds.has(id))
  return {
    label: '解组图层',
    bytes: 96 + document.layers.length * 20 + document.groups.length * 16,
    undo: () => {
      document.groups = [...beforeGroups]
      applyLayerGroups(document.layers, beforeLayerGroupIds)
      for (const group of document.groups) group.parentGroupId = beforeParentGroupIds.get(group.id) ?? null
    },
    redo: applyUngroup
  }
}
