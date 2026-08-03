import type { RgbaColor, SpriteDocument } from '@shared/types'

interface PanelSessionState {
  document: SpriteDocument
  primaryColor: RgbaColor
  secondaryColor: RgbaColor
  selectedPaletteIds: number[]
  selectedLayerIds: string[]
  selectedGroupId: string | null
  selectedGroupIds: string[]
  collapsedGroupIds: string[]
  revision: number
  view: { relativeLuminance: boolean }
}

const colorKey = (color: RgbaColor): string => `${color.r},${color.g},${color.b},${color.a}`

export const colorPanelRenderKey = (session: PanelSessionState): string =>
  `${session.document.id}:${colorKey(session.primaryColor)}:${colorKey(session.secondaryColor)}`

export const palettePanelRenderKey = (session: PanelSessionState): string => [
  session.document.id,
  session.document.name,
  session.document.paletteOrder.join(','),
  session.document.palette.map((entry) => `${entry.id}:${entry.name}:${colorKey(entry.color)}`).join('|'),
  session.selectedPaletteIds.join(','),
  colorKey(session.primaryColor)
].join(';')

export const layersPanelRenderKey = (session: PanelSessionState): string => [
  session.document.id,
  session.document.layers.map((layer) => `${layer.id}:${layer.name}:${layer.groupId ?? ''}:${layer.visible ? 1 : 0}:${layer.locked ? 1 : 0}:${layer.opacity}:${layer.blendMode}`).join('|'),
  session.document.groups.map((group) => `${group.id}:${group.name}:${group.parentGroupId ?? ''}:${group.visible ? 1 : 0}:${group.locked ? 1 : 0}:${group.opacity}:${group.blendMode}`).join('|'),
  session.selectedLayerIds.join(','),
  session.selectedGroupId ?? '',
  session.selectedGroupIds.join(','),
  session.collapsedGroupIds.join(',')
].join(';')

export const previewPanelRenderKey = (session: PanelSessionState): string =>
  `${session.document.id}:${session.revision}:${session.view.relativeLuminance ? 1 : 0}`
