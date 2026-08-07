export type DocumentPaneDirection = 'left' | 'right' | 'top' | 'bottom'
export type DocumentPaneOrientation = 'horizontal' | 'vertical'

export interface DocumentPanePlacement {
  documentId: string
  targetPaneId: string
  direction: DocumentPaneDirection
}

export interface DocumentPaneLeaf {
  kind: 'leaf'
  id: string
  documentId: string
}

export interface DocumentPaneSplit {
  kind: 'split'
  id: string
  orientation: DocumentPaneOrientation
  ratio: number
  first: DocumentPaneNode
  second: DocumentPaneNode
}

export type DocumentPaneNode = DocumentPaneLeaf | DocumentPaneSplit
export interface DocumentPaneRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}
export interface DocumentPanePointerPoint {
  x: number
  y: number
}

const MIN_RATIO = 0.1
const MAX_RATIO = 0.9
const MAX_DOCK_EDGE_SIZE = 80
const DOCK_EDGE_RATIO = 0.2
const DOCK_OUTER_SLOP = 22

export const clampDocumentPaneRatio = (ratio: number): number => Math.max(MIN_RATIO, Math.min(MAX_RATIO, Number.isFinite(ratio) ? ratio : 0.5))

export const createDocumentPaneLayout = (documentId: string): DocumentPaneLeaf => ({ kind: 'leaf', id: documentId, documentId })

export const documentPaneContains = (node: DocumentPaneNode, documentId: string): boolean =>
  node.kind === 'leaf' ? node.documentId === documentId : documentPaneContains(node.first, documentId) || documentPaneContains(node.second, documentId)

export const documentPaneLeafIds = (node: DocumentPaneNode): string[] =>
  node.kind === 'leaf' ? [node.id] : [...documentPaneLeafIds(node.first), ...documentPaneLeafIds(node.second)]

export const documentPaneDropDirection = (rect: DocumentPaneRect, clientX: number, clientY: number): DocumentPaneDirection => {
  const relativeX = (clientX - rect.left) / Math.max(1, rect.width)
  const relativeY = (clientY - rect.top) / Math.max(1, rect.height)
  if (relativeX <= 0.25) return 'left'
  if (relativeX >= 0.75) return 'right'
  if (relativeY <= 0.25) return 'top'
  if (relativeY >= 0.75) return 'bottom'
  const halfWidth = Math.max(1, rect.width / 2)
  const halfHeight = Math.max(1, rect.height / 2)
  const horizontal = (clientX - (rect.left + halfWidth)) / halfWidth
  const vertical = (clientY - (rect.top + halfHeight)) / halfHeight
  if (Math.abs(horizontal) >= Math.abs(vertical)) return horizontal < 0 ? 'left' : 'right'
  return vertical < 0 ? 'top' : 'bottom'
}

export const documentPaneDockDirection = (rect: DocumentPaneRect, clientX: number, clientY: number): DocumentPaneDirection | null => {
  const rawLeftDistance = clientX - rect.left
  const rawRightDistance = rect.right - clientX
  const rawTopDistance = clientY - rect.top
  const rawBottomDistance = rect.bottom - clientY
  if (rawLeftDistance < -DOCK_OUTER_SLOP || rawRightDistance < -DOCK_OUTER_SLOP || rawTopDistance < -DOCK_OUTER_SLOP || rawBottomDistance < -DOCK_OUTER_SLOP) return null
  const leftDistance = Math.max(0, rawLeftDistance)
  const rightDistance = Math.max(0, rawRightDistance)
  const topDistance = Math.max(0, rawTopDistance)
  const bottomDistance = Math.max(0, rawBottomDistance)
  const horizontalEdge = Math.min(MAX_DOCK_EDGE_SIZE, rect.width * DOCK_EDGE_RATIO)
  const verticalEdge = Math.min(MAX_DOCK_EDGE_SIZE, rect.height * DOCK_EDGE_RATIO)
  const candidates: Array<{ direction: DocumentPaneDirection; score: number }> = []
  // Outside a pane, negative raw distances made the farther edge win at a
  // corner. Compare absolute distance so moving across a corner can switch
  // from the side edge to the top/bottom edge immediately.
  if (leftDistance <= horizontalEdge) candidates.push({ direction: 'left', score: Math.abs(rawLeftDistance) })
  if (rightDistance <= horizontalEdge) candidates.push({ direction: 'right', score: Math.abs(rawRightDistance) })
  if (topDistance <= verticalEdge) candidates.push({ direction: 'top', score: Math.abs(rawTopDistance) })
  if (bottomDistance <= verticalEdge) candidates.push({ direction: 'bottom', score: Math.abs(rawBottomDistance) })
  const verticalPriority = (direction: DocumentPaneDirection): number => direction === 'top' || direction === 'bottom' ? 0 : 1
  return candidates.sort((a, b) => a.score - b.score || verticalPriority(a.direction) - verticalPriority(b.direction))[0]?.direction ?? null
}

const segmentEntryTime = (from: DocumentPanePointerPoint, to: DocumentPanePointerPoint, rect: DocumentPaneRect): number | null => {
  const dx = to.x - from.x
  const dy = to.y - from.y
  let entry = 0
  let exit = 1
  const axes = [[-dx, from.x - rect.left], [dx, rect.right - from.x], [-dy, from.y - rect.top], [dy, rect.bottom - from.y]] as const
  for (const [coefficient, distance] of axes) {
    if (coefficient === 0) {
      if (distance < 0) return null
      continue
    }
    const time = distance / coefficient
    if (coefficient > 0) exit = Math.min(exit, time)
    else entry = Math.max(entry, time)
    if (entry > exit) return null
  }
  return entry >= 0 && entry <= 1 ? entry : null
}

const documentPaneDockingStrip = (rect: DocumentPaneRect, direction: DocumentPaneDirection): DocumentPaneRect => {
  const horizontalEdge = Math.min(MAX_DOCK_EDGE_SIZE, rect.width * DOCK_EDGE_RATIO)
  const verticalEdge = Math.min(MAX_DOCK_EDGE_SIZE, rect.height * DOCK_EDGE_RATIO)
  if (direction === 'left') return { left: rect.left - DOCK_OUTER_SLOP, top: rect.top - DOCK_OUTER_SLOP, right: rect.left + horizontalEdge, bottom: rect.bottom + DOCK_OUTER_SLOP, width: horizontalEdge + DOCK_OUTER_SLOP, height: rect.height + DOCK_OUTER_SLOP * 2 }
  if (direction === 'right') return { left: rect.right - horizontalEdge, top: rect.top - DOCK_OUTER_SLOP, right: rect.right + DOCK_OUTER_SLOP, bottom: rect.bottom + DOCK_OUTER_SLOP, width: horizontalEdge + DOCK_OUTER_SLOP, height: rect.height + DOCK_OUTER_SLOP * 2 }
  if (direction === 'top') return { left: rect.left - DOCK_OUTER_SLOP, top: rect.top - DOCK_OUTER_SLOP, right: rect.right + DOCK_OUTER_SLOP, bottom: rect.top + verticalEdge, width: rect.width + DOCK_OUTER_SLOP * 2, height: verticalEdge + DOCK_OUTER_SLOP }
  return { left: rect.left - DOCK_OUTER_SLOP, top: rect.bottom - verticalEdge, right: rect.right + DOCK_OUTER_SLOP, bottom: rect.bottom + DOCK_OUTER_SLOP, width: rect.width + DOCK_OUTER_SLOP * 2, height: verticalEdge + DOCK_OUTER_SLOP }
}

const pointInsideRect = (point: DocumentPanePointerPoint, rect: DocumentPaneRect): boolean =>
  point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom

export const documentPaneDockDirectionAlongPath = (rect: DocumentPaneRect, from: DocumentPanePointerPoint, to: DocumentPanePointerPoint): DocumentPaneDirection | null => {
  const endpointDirection = documentPaneDockDirection(rect, to.x, to.y)
  if (endpointDirection) return endpointDirection
  const directions: DocumentPaneDirection[] = ['left', 'right', 'top', 'bottom']
  return directions
    .map((direction) => {
      const strip = documentPaneDockingStrip(rect, direction)
      return { direction, time: pointInsideRect(from, strip) ? null : segmentEntryTime(from, to, strip) }
    })
    .filter((candidate): candidate is { direction: DocumentPaneDirection; time: number } => candidate.time !== null)
    .sort((a, b) => a.time - b.time || (a.direction === 'top' || a.direction === 'bottom' ? -1 : 1))[0]?.direction ?? null
}

export const documentPaneDropRect = (rect: DocumentPaneRect, direction: DocumentPaneDirection): DocumentPaneRect => {
  if (direction === 'left') return { ...rect, right: rect.left + rect.width / 2, width: rect.width / 2 }
  if (direction === 'right') return { ...rect, left: rect.left + rect.width / 2, width: rect.width / 2 }
  if (direction === 'top') return { ...rect, bottom: rect.top + rect.height / 2, height: rect.height / 2 }
  return { ...rect, top: rect.top + rect.height / 2, height: rect.height / 2 }
}

export const insertDocumentPane = (node: DocumentPaneNode, targetPaneId: string, documentId: string, direction: DocumentPaneDirection): DocumentPaneNode => {
  if (documentPaneContains(node, documentId)) return node
  if (node.kind === 'leaf') {
    if (node.id !== targetPaneId) return node
    const newPane = createDocumentPaneLayout(documentId)
    const horizontal = direction === 'left' || direction === 'right'
    const newFirst = direction === 'left' || direction === 'top'
    return {
      kind: 'split',
      id: `split:${node.id}:${documentId}:${direction}`,
      orientation: horizontal ? 'horizontal' : 'vertical',
      ratio: 0.5,
      first: newFirst ? newPane : node,
      second: newFirst ? node : newPane
    }
  }
  const first = insertDocumentPane(node.first, targetPaneId, documentId, direction)
  if (first !== node.first) return { ...node, first }
  const second = insertDocumentPane(node.second, targetPaneId, documentId, direction)
  if (second !== node.second) return { ...node, second }
  return node
}

export const resizeDocumentPane = (node: DocumentPaneNode, splitId: string, ratio: number): DocumentPaneNode => {
  if (node.kind === 'leaf') return node
  if (node.id === splitId) return { ...node, ratio: clampDocumentPaneRatio(ratio) }
  const first = resizeDocumentPane(node.first, splitId, ratio)
  const second = resizeDocumentPane(node.second, splitId, ratio)
  if (first === node.first && second === node.second) return node
  return { ...node, first, second }
}

export const removeDocumentPane = (node: DocumentPaneNode, documentId: string): DocumentPaneNode | null => {
  if (node.kind === 'leaf') return node.documentId === documentId ? null : node
  const first = removeDocumentPane(node.first, documentId)
  const second = removeDocumentPane(node.second, documentId)
  if (!first) return second
  if (!second) return first
  if (first === node.first && second === node.second) return node
  return { ...node, first, second }
}

export const moveDocumentPane = (node: DocumentPaneNode, documentId: string, targetPaneId: string, direction: DocumentPaneDirection): DocumentPaneNode => {
  if (documentId === targetPaneId || !documentPaneContains(node, documentId) || !documentPaneContains(node, targetPaneId)) return node
  const remaining = removeDocumentPane(node, documentId)
  if (!remaining) return node
  return insertDocumentPane(remaining, targetPaneId, documentId, direction)
}

export const resolveDocumentPanePreviewLayout = (node: DocumentPaneNode | null, activeDocumentId: string, placement: DocumentPanePlacement | null): DocumentPaneNode | null => {
  const committed = node?.kind === 'split' && documentPaneContains(node, activeDocumentId) ? node : null
  if (!placement) return committed
  const base = node?.kind === 'split' && documentPaneContains(node, placement.targetPaneId)
    ? node
    : createDocumentPaneLayout(placement.targetPaneId)
  return insertDocumentPane(base, placement.targetPaneId, placement.documentId, placement.direction)
}
