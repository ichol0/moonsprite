import { readStoredString } from './storage'

export type WorkspacePanelId = 'color' | 'palette' | 'layers' | 'preview'

export const INSPECTOR_LAYOUT_STORAGE_KEY = 'moonsprite.inspector-layout.v2'
export const COLOR_SQUARE_DOCK_STORAGE_KEY = 'moonsprite.color-picker-square-dock'
export const COLOR_SQUARE_ANCHOR_STORAGE_KEY = 'moonsprite.color-picker-square-anchor'

export const DEFAULT_INSPECTOR_ORDER: WorkspacePanelId[] = ['color', 'palette', 'layers', 'preview']
export const DEFAULT_INSPECTOR_SIZES: Record<WorkspacePanelId, number> = { color: 370, palette: 90, layers: 230, preview: 180 }
export const MINIMUM_INSPECTOR_SIZES: Record<WorkspacePanelId, number> = { color: 128, palette: 52, layers: 180, preview: 120 }
export const DEFAULT_BOTTOM_WIDTHS: Record<WorkspacePanelId, number> = { color: 280, palette: 280, layers: 720, preview: 280 }
export const MINIMUM_BOTTOM_WIDTHS: Record<WorkspacePanelId, number> = { color: 96, palette: 180, layers: 360, preview: 180 }

export interface InspectorLayout {
  order: WorkspacePanelId[]
  verticalWeights: Record<WorkspacePanelId, number>
  bottomWeights: Record<WorkspacePanelId, number>
}

const isWorkspacePanelId = (value: unknown): value is WorkspacePanelId => typeof value === 'string' && DEFAULT_INSPECTOR_ORDER.includes(value as WorkspacePanelId)

export function loadInspectorLayout(storedValue = readStoredString(INSPECTOR_LAYOUT_STORAGE_KEY)): InspectorLayout {
  try {
    const value = JSON.parse(storedValue ?? 'null') as {
      order?: unknown[]
      verticalWeights?: Partial<Record<WorkspacePanelId, number>>
      bottomWeights?: Partial<Record<WorkspacePanelId, number>>
      sizes?: Partial<Record<WorkspacePanelId, number>>
      bottomWidths?: Partial<Record<WorkspacePanelId, number>>
    } | null
    const storedOrder = (value?.order ?? []).filter((id, index, values): id is WorkspacePanelId => isWorkspacePanelId(id) && values.indexOf(id) === index)
    const order = [...storedOrder, ...DEFAULT_INSPECTOR_ORDER.filter((id) => !storedOrder.includes(id))]
    const storedVerticalWeights = value?.verticalWeights ?? value?.sizes
    const storedBottomWeights = value?.bottomWeights ?? value?.bottomWidths
    const verticalWeights = Object.fromEntries(DEFAULT_INSPECTOR_ORDER.map((id) => {
      const stored = Number(storedVerticalWeights?.[id])
      const migrated = id === 'color' && stored === 250 ? DEFAULT_INSPECTOR_SIZES.color : stored
      return [id, Math.max(MINIMUM_INSPECTOR_SIZES[id], migrated || DEFAULT_INSPECTOR_SIZES[id])]
    })) as Record<WorkspacePanelId, number>
    const bottomWeights = Object.fromEntries(DEFAULT_INSPECTOR_ORDER.map((id) => {
      const stored = Number(storedBottomWeights?.[id])
      return [id, Math.max(MINIMUM_BOTTOM_WIDTHS[id], stored || DEFAULT_BOTTOM_WIDTHS[id])]
    })) as Record<WorkspacePanelId, number>
    return { order, verticalWeights, bottomWeights }
  } catch {
    return { order: [...DEFAULT_INSPECTOR_ORDER], verticalWeights: { ...DEFAULT_INSPECTOR_SIZES }, bottomWeights: { ...DEFAULT_BOTTOM_WIDTHS } }
  }
}

export function moveInspectorPanel(order: WorkspacePanelId[], movingId: WorkspacePanelId, targetId?: WorkspacePanelId, insertAfter = true): WorkspacePanelId[] {
  const next = order.filter((id) => id !== movingId)
  if (!targetId) { next.push(movingId); return next }
  const targetIndex = next.indexOf(targetId)
  if (targetIndex < 0) return order
  next.splice(targetIndex + (insertAfter ? 1 : 0), 0, movingId)
  return next
}

export function proportionalPanelFlex(weight: number): string {
  return `${Math.max(1, weight)} 1 0px`
}
