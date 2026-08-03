export interface LayerPanelLayerRef {
  id: string
  groupId?: string | null
}

export interface LayerPanelGroupRef {
  id: string
  parentGroupId?: string | null
  panelOrder?: number
}

export type LayerPanelNode =
  | { kind: 'layer'; id: string; depth: number }
  | { kind: 'group'; id: string; depth: number }

export type LayerPanelDropTarget =
  | { kind: 'layer'; id: string; insertAfter: boolean; depth: number }
  | { kind: 'group'; id: string; depth: number }
  | { kind: 'above-group'; id: string; insertAfter: boolean; depth: number }

export type LayerPanelEdgeDropTarget = { kind: 'edge'; edge: 'top' | 'bottom' }

export const resolveLayerPanelEdgeDropTarget = (clientY: number, top: number, bottom: number, inset = 10): LayerPanelEdgeDropTarget | null => {
  if (clientY <= top + inset) return { kind: 'edge', edge: 'top' }
  if (clientY >= bottom - inset) return { kind: 'edge', edge: 'bottom' }
  return null
}

export interface LayerPanelRowHit {
  kind: 'layer' | 'group'
  id: string
  top: number
  bottom: number
  pointerY: number
}

export interface LayerPanelDropInput {
  layers: readonly LayerPanelLayerRef[]
  groups: readonly LayerPanelGroupRef[]
  nodes: readonly LayerPanelNode[]
  hit: LayerPanelRowHit
  draggedLayerIds: readonly string[]
  draggedGroupId?: string
}

/** 返回组的所有后代组，遇到损坏的循环关系时停止继续遍历。 */
export const getLayerPanelDescendantGroupIds = (groups: readonly LayerPanelGroupRef[], groupId: string): string[] => {
  const descendants: string[] = []
  const visited = new Set<string>([groupId])
  const queue = [groupId]
  while (queue.length > 0) {
    const parentId = queue.shift()!
    for (const group of groups) {
      if ((group.parentGroupId ?? null) !== parentId || visited.has(group.id)) continue
      visited.add(group.id)
      descendants.push(group.id)
      queue.push(group.id)
    }
  }
  return descendants
}

const normalizedParent = (group: LayerPanelGroupRef, groupById: Map<string, LayerPanelGroupRef>): string | null => {
  const parentId = group.parentGroupId ?? null
  return parentId && groupById.has(parentId) && parentId !== group.id ? parentId : null
}

/** 按当前图层栏的显示顺序展平图层和图层组，动画帧不会参与此排序。 */
export const buildLayerPanelTree = ({ layers, groups, collapsedGroupIds = [] }: {
  layers: readonly LayerPanelLayerRef[]
  groups: readonly LayerPanelGroupRef[]
  collapsedGroupIds?: readonly string[]
}): LayerPanelNode[] => {
  const nodes: LayerPanelNode[] = []
  const groupById = new Map(groups.map((group) => [group.id, group]))
  const layerOrder = new Map(layers.map((layer, index) => [layer.id, index]))
  const groupOrder = new Map(groups.map((group, index) => [group.id, index]))
  const anchorCache = new Map<string, number>()

  const groupAnchor = (groupId: string, visiting = new Set<string>()): number => {
    const cached = anchorCache.get(groupId)
    if (cached !== undefined) return cached
    const savedOrder = groupById.get(groupId)?.panelOrder
    if (typeof savedOrder === 'number' && Number.isFinite(savedOrder)) {
      anchorCache.set(groupId, savedOrder)
      return savedOrder
    }
    if (visiting.has(groupId)) return Number.NEGATIVE_INFINITY
    const nextVisiting = new Set(visiting).add(groupId)
    let anchor = Number.NEGATIVE_INFINITY
    for (const layer of layers) if ((layer.groupId ?? null) === groupId) anchor = Math.max(anchor, layerOrder.get(layer.id) ?? anchor)
    for (const group of groups) if (normalizedParent(group, groupById) === groupId) anchor = Math.max(anchor, groupAnchor(group.id, nextVisiting))
    // 旧工程的空组没有排序锚点时，仍按组数组顺序置于容器顶部。
    if (anchor === Number.NEGATIVE_INFINITY) {
      anchor = Number.POSITIVE_INFINITY
    }
    anchorCache.set(groupId, anchor)
    return anchor
  }

  const renderedGroups = new Set<string>()
  const appendContainer = (parentGroupId: string | null, depth: number, visiting = new Set<string>()): void => {
    const items: Array<{ kind: 'layer'; id: string; order: number; tie: number } | { kind: 'group'; id: string; order: number; tie: number }> = []
    for (const layer of layers) {
      const parent = layer.groupId && groupById.has(layer.groupId) ? layer.groupId : null
      if (parent === parentGroupId) items.push({ kind: 'layer', id: layer.id, order: layerOrder.get(layer.id) ?? 0, tie: 0 })
    }
    for (const group of groups) {
      if (normalizedParent(group, groupById) === parentGroupId) items.push({ kind: 'group', id: group.id, order: groupAnchor(group.id), tie: groupOrder.get(group.id) ?? 0 })
    }
    items.sort((left, right) => right.order - left.order || right.tie - left.tie)
    for (const item of items) {
      if (item.kind === 'layer') {
        nodes.push({ kind: 'layer', id: item.id, depth })
        continue
      }
      if (renderedGroups.has(item.id) || visiting.has(item.id)) continue
      renderedGroups.add(item.id)
      nodes.push({ kind: 'group', id: item.id, depth })
      if (!collapsedGroupIds.includes(item.id)) appendContainer(item.id, depth + 1, new Set(visiting).add(item.id))
    }
  }

  appendContainer(null, 0)
  return nodes
}

const nodeDepth = (nodes: readonly LayerPanelNode[], kind: LayerPanelNode['kind'], id: string): number =>
  nodes.find((node) => node.kind === kind && node.id === id)?.depth ?? 0

/** 根据已经由 DOM 命中的一行，统一计算插入线和最终拖放目标。 */
export const resolveLayerPanelDropTarget = ({ layers, groups, nodes, hit, draggedLayerIds, draggedGroupId }: LayerPanelDropInput): LayerPanelDropTarget | null => {
  const descendants = draggedGroupId ? new Set(getLayerPanelDescendantGroupIds(groups, draggedGroupId)) : new Set<string>()
  const dragged = new Set(draggedLayerIds)
  const midpoint = hit.top + (hit.bottom - hit.top) / 2

  if (hit.kind === 'layer') {
    const targetLayer = layers.find((layer) => layer.id === hit.id)
    if (!targetLayer) return null
    if (draggedGroupId) {
      if (targetLayer.groupId && targetLayer.groupId !== draggedGroupId && !descendants.has(targetLayer.groupId)) {
        return { kind: 'group', id: targetLayer.groupId, depth: nodeDepth(nodes, 'group', targetLayer.groupId) + 1 }
      }
      if (!targetLayer.groupId) return { kind: 'layer', id: targetLayer.id, insertAfter: hit.pointerY < midpoint, depth: 0 }
      return null
    }
    if (dragged.has(hit.id)) return null
    return { kind: 'layer', id: hit.id, insertAfter: hit.pointerY < midpoint, depth: nodeDepth(nodes, 'layer', hit.id) }
  }

  if (hit.id === draggedGroupId || descendants.has(hit.id)) return null
  const targetDepth = nodeDepth(nodes, 'group', hit.id)
  if (draggedGroupId) {
    const edge = Math.min(5, (hit.bottom - hit.top) * 0.15)
    if (hit.pointerY <= hit.top + edge) return { kind: 'above-group', id: hit.id, insertAfter: true, depth: targetDepth }
    if (hit.pointerY >= hit.bottom - edge) return { kind: 'above-group', id: hit.id, insertAfter: false, depth: targetDepth }
  } else if (hit.pointerY <= hit.top + Math.min(11, (hit.bottom - hit.top) * 0.3)) {
    return { kind: 'above-group', id: hit.id, insertAfter: true, depth: targetDepth }
  }
  return { kind: 'group', id: hit.id, depth: targetDepth + 1 }
}
