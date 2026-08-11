import type { PaletteSlotLayout, RgbaColor } from '@shared/types'
import { findOrAddPaletteColor } from '@/core/document'
import { colorEquals } from '@/core/raster'
import { loadEditorPreferences } from '@/core/file-preferences'
import { translate, type TranslationKey, type TranslationParams } from '@/core/localization'
import { normalizePaletteColumns, normalizePaletteSlots, paletteOrderFromSlots } from '@/core/palette-layout'
import { remapSelectionBrushColors } from './workspace-session'
import type { DocumentSession } from './workspace-types'

const tr = (key: TranslationKey, params?: TranslationParams): string => translate(loadEditorPreferences().language, key, params)

const currentPaletteLayout = (session: DocumentSession): { slots: Array<number | null>; columns: number } => {
  const columns = normalizePaletteColumns(session.document.paletteColumns)
  return {
    columns,
    slots: normalizePaletteSlots(
      session.document.palette.map((entry) => entry.id),
      session.document.paletteOrder,
      session.document.paletteSlots,
      columns
    )
  }
}

const applyPaletteSlots = (session: DocumentSession, slots: readonly (number | null)[], columns: number): void => {
  session.document.paletteSlots = [...slots]
  session.document.paletteColumns = normalizePaletteColumns(columns)
  session.document.paletteOrder = paletteOrderFromSlots(slots)
}

export function selectPaletteColors(session: DocumentSession, ids: number[], primaryId: number): void {
  const available = new Set(session.document.paletteOrder)
  session.selectedPaletteIds = [...new Set(ids.filter((id) => available.has(id)))]
  session.paletteSelectionId = session.selectedPaletteIds.includes(primaryId) ? primaryId : session.selectedPaletteIds.at(-1) ?? null
  const active = session.document.palette.find((candidate) => candidate.id === session.paletteSelectionId)
  if (!active) return
  session.primaryColor = { ...active.color }
  if (session.brushImage?.intrinsicSize) session.brushImage = remapSelectionBrushColors(session.brushImage, session.primaryColor, session.secondaryColor)
}

export function selectPaletteColor(session: DocumentSession, id: number, additive = false): void {
  const entry = session.document.palette.find((candidate) => candidate.id === id)
  if (!entry) return
  const selected = !additive
    ? [id]
    : session.selectedPaletteIds.includes(id)
      ? session.selectedPaletteIds.filter((entryId) => entryId !== id)
      : [...session.selectedPaletteIds, id]
  selectPaletteColors(session, selected, id)
}

export function addPaletteColor(session: DocumentSession, color: RgbaColor = session.primaryColor): void {
  const id = findOrAddPaletteColor(session.document, color, true)
  session.paletteSelectionId = id
  session.selectedPaletteIds = [id]
}

export function updatePaletteColor(session: DocumentSession, id: number, color: RgbaColor): void {
  const entry = session.document.palette.find((candidate) => candidate.id === id)
  if (!entry || colorEquals(entry.color, color)) return
  const beforeColor = { ...entry.color }
  const beforePrimary = { ...session.primaryColor }
  const beforeSecondary = { ...session.secondaryColor }
  const apply = (next: RgbaColor): void => {
    entry.color = { ...next }
    if (colorEquals(session.primaryColor, beforeColor)) session.primaryColor = { ...next }
    if (colorEquals(session.secondaryColor, beforeColor)) session.secondaryColor = { ...next }
  }
  apply(color)
  session.history.push({
    label: tr('palette.history.updated'),
    bytes: 32,
    undo: () => {
      entry.color = { ...beforeColor }
      session.primaryColor = { ...beforePrimary }
      session.secondaryColor = { ...beforeSecondary }
    },
    redo: () => apply(color)
  })
}

export function applyPalette(session: DocumentSession, colors: RgbaColor[], layout?: PaletteSlotLayout): void {
  const document = session.document
  const beforeOrder = [...document.paletteOrder]
  const beforeLayout = currentPaletteLayout(session)
  const beforeSlots = beforeLayout.slots
  const beforeColumns = beforeLayout.columns
  const beforeSelected = [...session.selectedPaletteIds]
  const beforePrimary = session.paletteSelectionId
  const colorIds = colors.map((color) => findOrAddPaletteColor(document, color, false))
  const requestedOrder = [...new Set(document.colorMode === 'indexed' ? [0, ...colorIds] : colorIds)]
  const afterColumns = layout ? normalizePaletteColumns(layout.columns) : beforeColumns
  const requestedSlots = layout?.slots.map((colorIndex) => colorIndex === null ? null : colorIds[colorIndex] ?? null)
  const afterSlots = normalizePaletteSlots(document.palette.map((entry) => entry.id), requestedOrder, requestedSlots, afterColumns)
  const afterOrder = paletteOrderFromSlots(afterSlots)
  if (afterColumns === beforeColumns && afterSlots.length === beforeSlots.length && afterSlots.every((id, index) => id === beforeSlots[index])) return
  const matchingCurrent = afterOrder.find((id) => {
    const entry = document.palette.find((candidate) => candidate.id === id)
    return Boolean(entry && colorEquals(entry.color, session.primaryColor))
  })
  const afterSelected = matchingCurrent === undefined ? [] : [matchingCurrent]
  const afterPrimary = matchingCurrent ?? null
  const apply = (order: number[], slots: Array<number | null>, columns: number, selected: number[], primary: number | null): void => {
    document.paletteOrder = [...order]
    document.paletteSlots = [...slots]
    document.paletteColumns = columns
    session.selectedPaletteIds = [...selected]
    session.paletteSelectionId = primary
  }
  apply(afterOrder, afterSlots, afterColumns, afterSelected, afterPrimary)
  session.history.push({
    label: tr('palette.history.changed'),
    bytes: (beforeOrder.length + afterOrder.length + beforeSlots.length + afterSlots.length + beforeSelected.length + afterSelected.length) * 4 + 32,
    undo: () => apply(beforeOrder, beforeSlots, beforeColumns, beforeSelected, beforePrimary),
    redo: () => apply(afterOrder, afterSlots, afterColumns, afterSelected, afterPrimary)
  })
}

export function deletePaletteColors(session: DocumentSession, ids: number[]): void {
  const document = session.document
  const removed = new Set(ids.filter((id) => document.paletteOrder.includes(id)))
  if (removed.size === 0) return
  const beforeOrder = [...document.paletteOrder]
  const beforeLayout = currentPaletteLayout(session)
  const beforeSlots = beforeLayout.slots
  const beforeColumns = beforeLayout.columns
  const afterSlots = beforeSlots.map((id) => id !== null && removed.has(id) ? null : id)
  const afterOrder = paletteOrderFromSlots(afterSlots)
  const beforeSelected = [...session.selectedPaletteIds]
  const beforePrimary = session.paletteSelectionId
  const afterSelected = beforeSelected.filter((id) => !removed.has(id))
  const afterPrimary = afterSelected.includes(beforePrimary ?? -1) ? beforePrimary : afterSelected.at(-1) ?? null
  document.paletteOrder = afterOrder
  document.paletteSlots = afterSlots
  document.paletteColumns = beforeColumns
  session.selectedPaletteIds = afterSelected
  session.paletteSelectionId = afterPrimary
  session.history.push({
    label: removed.size > 1 ? tr('palette.history.deletedMany') : tr('palette.history.deleted'),
    bytes: (beforeOrder.length + afterOrder.length + beforeSlots.length + afterSlots.length + beforeSelected.length + afterSelected.length) * 4 + 32,
    undo: () => { document.paletteOrder = [...beforeOrder]; document.paletteSlots = [...beforeSlots]; document.paletteColumns = beforeColumns; session.selectedPaletteIds = [...beforeSelected]; session.paletteSelectionId = beforePrimary },
    redo: () => { document.paletteOrder = [...afterOrder]; document.paletteSlots = [...afterSlots]; document.paletteColumns = beforeColumns; session.selectedPaletteIds = [...afterSelected]; session.paletteSelectionId = afterPrimary }
  })
}

export function movePaletteColor(session: DocumentSession, direction: -1 | 1): void {
  const layout = currentPaletteLayout(session)
  const slots = layout.slots
  const currentIndex = slots.indexOf(session.paletteSelectionId ?? -1)
  const targetIndex = currentIndex + direction
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= slots.length) return
  const before = [...slots]
  const after = [...slots]
  ;[after[currentIndex], after[targetIndex]] = [after[targetIndex], after[currentIndex]]
  applyPaletteSlots(session, after, layout.columns)
  session.history.push({ label: tr('palette.history.reordered'), bytes: (before.length + after.length) * 4, undo: () => applyPaletteSlots(session, before, layout.columns), redo: () => applyPaletteSlots(session, after, layout.columns) })
}

export function reorderPaletteColors(session: DocumentSession, ids: number[], targetSlots: Array<number | null>, targetColumns: number): void {
  const beforeLayout = currentPaletteLayout(session)
  const before = beforeLayout.slots
  const afterColumns = normalizePaletteColumns(targetColumns)
  const after = normalizePaletteSlots(session.document.palette.map((entry) => entry.id), session.document.paletteOrder, targetSlots, afterColumns)
  if (afterColumns === beforeLayout.columns && after.length === before.length && after.every((id, index) => id === before[index])) return
  const movingCount = ids.filter((id) => before.includes(id)).length
  applyPaletteSlots(session, after, afterColumns)
  session.history.push({
    label: movingCount > 1 ? tr('palette.history.reorderedMany') : tr('palette.history.reordered'),
    bytes: (before.length + after.length) * 4,
    undo: () => applyPaletteSlots(session, before, beforeLayout.columns),
    redo: () => applyPaletteSlots(session, after, afterColumns)
  })
}
