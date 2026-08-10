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
  contentRevision?: number
  layersPanelRevision?: number
  animationPlaying?: boolean
  animationPlaybackRate?: number
  animationReturnToStart?: boolean
  selectedAnimationFrameIds?: string[]
  selectedAnimationCellKeys?: string[]
  selectedAnimationMaskCellKeys?: string[]
  activeLayerMaskId?: string | null
  view: { relativeLuminance: boolean }
}

const colorKey = (color: RgbaColor): string => `${color.r},${color.g},${color.b},${color.a}`

export const colorPanelRenderKey = (session: PanelSessionState): string =>
  `${session.document.id}:${colorKey(session.primaryColor)}:${colorKey(session.secondaryColor)}:${session.document.paletteOrder.join(',')}:${session.document.palette.map((entry) => `${entry.id}:${colorKey(entry.color)}`).join('|')}`

export const palettePanelRenderKey = (session: PanelSessionState): string => [
  session.document.id,
  session.document.name,
  session.document.paletteOrder.join(','),
  session.document.paletteColumns ?? '',
  session.document.paletteSlots?.map((id) => id ?? '').join(',') ?? '',
  session.document.palette.map((entry) => `${entry.id}:${entry.name}:${colorKey(entry.color)}`).join('|'),
  session.selectedPaletteIds.join(','),
  colorKey(session.primaryColor)
].join(';')

export const layersPanelRenderKey = (session: PanelSessionState): string => [
  session.document.id,
  session.animationPlaying ? 'playing' : session.document.animation?.activeFrameId ?? '',
  session.document.animation?.frames.map((frame) => `${frame.id}:${frame.duration}`).join(',') ?? '',
  session.document.animation?.cels.filter((cel) => cel.mask).map((cel) => `${cel.layerId}:${cel.frameId}:${cel.mask!.id}:${cel.mask!.visible ? 1 : 0}`).join(',') ?? '',
  session.document.animation?.groupMasks?.map((entry) => `${entry.groupId}:${entry.frameId}:${entry.mask.id}:${entry.mask.visible ? 1 : 0}`).join(',') ?? '',
  session.animationPlaying ? 1 : 0,
  session.animationPlaybackRate ?? 1,
  session.animationReturnToStart ? 1 : 0,
  session.selectedAnimationFrameIds?.join(',') ?? '',
  session.selectedAnimationCellKeys?.join(',') ?? '',
  session.selectedAnimationMaskCellKeys?.join(',') ?? '',
  session.activeLayerMaskId ?? '',
  session.layersPanelRevision ?? session.revision,
  session.document.layers.map((layer) => `${layer.id}:${layer.name}:${layer.groupId ?? ''}:${layer.visible ? 1 : 0}:${layer.locked ? 1 : 0}:${layer.opacity}:${layer.blendMode}`).join('|'),
  session.document.groups.map((group) => `${group.id}:${group.name}:${group.parentGroupId ?? ''}:${group.visible ? 1 : 0}:${group.locked ? 1 : 0}:${group.opacity}:${group.blendMode}:${group.cumulativeBlend === true ? 1 : 0}`).join('|'),
  session.selectedLayerIds.join(','),
  session.selectedGroupId ?? '',
  session.selectedGroupIds.join(','),
  session.collapsedGroupIds.join(',')
].join(';')

export const previewPanelRenderKey = (session: PanelSessionState): string =>
  `${session.document.id}:${session.contentRevision ?? session.revision}:${session.view.relativeLuminance ? 1 : 0}:${session.animationPlaying ? 1 : 0}:${session.animationPlaybackRate ?? 1}:${session.animationReturnToStart ? 1 : 0}:${session.document.animation?.loop === false ? 0 : 1}`
