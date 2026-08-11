export const LAYER_PANEL_REVEAL_EVENT = 'moonsprite:reveal-layer-in-panel'
export const ANIMATION_CELL_OPERATION_FINISHED_EVENT = 'moonsprite:animation-cell-operation-finished'

export interface LayerPanelRevealDetail {
  documentId: string
  layerId: string
}

export interface AnimationCellOperationFinishedDetail {
  documentId: string
}

export function revealLayerInPanel(documentId: string, layerId: string): void {
  window.dispatchEvent(new CustomEvent<LayerPanelRevealDetail>(LAYER_PANEL_REVEAL_EVENT, {
    detail: { documentId, layerId }
  }))
}

export function finishAnimationCellOperation(documentId: string): void {
  window.dispatchEvent(new CustomEvent<AnimationCellOperationFinishedDetail>(ANIMATION_CELL_OPERATION_FINISHED_EVENT, {
    detail: { documentId }
  }))
}
