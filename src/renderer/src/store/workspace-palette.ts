import type { RgbaColor } from '@shared/types'
import { findOrAddPaletteColor } from '@/core/document'
import { colorEquals } from '@/core/raster'
import { remapSelectionBrushColors } from './workspace-session'
import type { DocumentSession } from './workspace-types'

export function selectPaletteColor(session: DocumentSession, id: number, additive = false): void {
  const entry = session.document.palette.find((candidate) => candidate.id === id)
  if (!entry) return
  if (!additive) session.selectedPaletteIds = [id]
  else if (session.selectedPaletteIds.includes(id)) session.selectedPaletteIds = session.selectedPaletteIds.filter((entryId) => entryId !== id)
  else session.selectedPaletteIds = [...session.selectedPaletteIds, id]
  session.paletteSelectionId = session.selectedPaletteIds.includes(id) ? id : session.selectedPaletteIds.at(-1) ?? null
  const active = session.document.palette.find((candidate) => candidate.id === session.paletteSelectionId)
  if (!active) return
  session.primaryColor = { ...active.color }
  if (session.brushImage?.intrinsicSize) session.brushImage = remapSelectionBrushColors(session.brushImage, session.primaryColor, session.secondaryColor)
}

export function addPaletteColor(session: DocumentSession): void {
  const id = findOrAddPaletteColor(session.document, session.primaryColor, true)
  session.paletteSelectionId = id
  session.selectedPaletteIds = [id]
}

export function applyPalette(session: DocumentSession, colors: RgbaColor[]): void {
  const document = session.document
  const beforeOrder = [...document.paletteOrder]
  const beforeSelected = [...session.selectedPaletteIds]
  const beforePrimary = session.paletteSelectionId
  const colorIds = colors.map((color) => findOrAddPaletteColor(document, color, false))
  const afterOrder = [...new Set(document.colorMode === 'indexed' ? [0, ...colorIds] : colorIds)]
  if (afterOrder.length === beforeOrder.length && afterOrder.every((id, index) => id === beforeOrder[index])) return
  const matchingCurrent = afterOrder.find((id) => {
    const entry = document.palette.find((candidate) => candidate.id === id)
    return Boolean(entry && colorEquals(entry.color, session.primaryColor))
  })
  const afterSelected = matchingCurrent === undefined ? [] : [matchingCurrent]
  const afterPrimary = matchingCurrent ?? null
  const apply = (order: number[], selected: number[], primary: number | null): void => {
    document.paletteOrder = [...order]
    session.selectedPaletteIds = [...selected]
    session.paletteSelectionId = primary
  }
  apply(afterOrder, afterSelected, afterPrimary)
  session.history.push({
    label: '切换调色板',
    bytes: (beforeOrder.length + afterOrder.length + beforeSelected.length + afterSelected.length) * 4 + 32,
    undo: () => apply(beforeOrder, beforeSelected, beforePrimary),
    redo: () => apply(afterOrder, afterSelected, afterPrimary)
  })
}

export function deletePaletteColors(session: DocumentSession, ids: number[]): void {
  const document = session.document
  const removed = new Set(ids.filter((id) => document.paletteOrder.includes(id)))
  if (removed.size === 0) return
  const beforeOrder = [...document.paletteOrder]
  const afterOrder = beforeOrder.filter((id) => !removed.has(id))
  const beforeSelected = [...session.selectedPaletteIds]
  const beforePrimary = session.paletteSelectionId
  const afterSelected = beforeSelected.filter((id) => !removed.has(id))
  const afterPrimary = afterSelected.includes(beforePrimary ?? -1) ? beforePrimary : afterSelected.at(-1) ?? null
  document.paletteOrder = afterOrder
  session.selectedPaletteIds = afterSelected
  session.paletteSelectionId = afterPrimary
  session.history.push({
    label: removed.size > 1 ? '批量移除调色板颜色' : '从调色板移除颜色',
    bytes: (beforeOrder.length + afterOrder.length + beforeSelected.length + afterSelected.length) * 4 + 32,
    undo: () => { document.paletteOrder = [...beforeOrder]; session.selectedPaletteIds = [...beforeSelected]; session.paletteSelectionId = beforePrimary },
    redo: () => { document.paletteOrder = [...afterOrder]; session.selectedPaletteIds = [...afterSelected]; session.paletteSelectionId = afterPrimary }
  })
}

export function movePaletteColor(session: DocumentSession, direction: -1 | 1): void {
  const document = session.document
  const order = document.paletteOrder
  const currentIndex = order.indexOf(session.paletteSelectionId ?? -1)
  const targetIndex = currentIndex + direction
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= order.length) return
  ;[order[currentIndex], order[targetIndex]] = [order[targetIndex], order[currentIndex]]
  const swap = (): void => { ;[document.paletteOrder[currentIndex], document.paletteOrder[targetIndex]] = [document.paletteOrder[targetIndex], document.paletteOrder[currentIndex]] }
  session.history.push({ label: '调整调色板顺序', bytes: 16, undo: swap, redo: swap })
}

export function reorderPaletteColors(session: DocumentSession, ids: number[], targetId: number, insertAfter = false): void {
  const document = session.document
  const selected = new Set(ids.filter((id) => document.paletteOrder.includes(id)))
  if (selected.size === 0 || selected.has(targetId)) return
  const before = [...document.paletteOrder]
  const moving = before.filter((id) => selected.has(id))
  const remaining = before.filter((id) => !selected.has(id))
  const targetIndex = remaining.indexOf(targetId)
  if (targetIndex < 0) return
  remaining.splice(targetIndex + (insertAfter ? 1 : 0), 0, ...moving)
  if (remaining.every((id, index) => id === before[index])) return
  const after = [...remaining]
  document.paletteOrder = after
  session.history.push({
    label: moving.length > 1 ? '批量调整调色板顺序' : '调整调色板顺序',
    bytes: (before.length + after.length) * 4,
    undo: () => { document.paletteOrder = [...before] },
    redo: () => { document.paletteOrder = [...after] }
  })
}
