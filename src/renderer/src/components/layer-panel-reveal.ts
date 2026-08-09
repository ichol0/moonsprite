export const LAYER_PANEL_REVEAL_EVENT = 'moonsprite:reveal-layer-in-panel'

export interface LayerPanelRevealDetail {
  documentId: string
  layerId: string
}

export function revealLayerInPanel(documentId: string, layerId: string): void {
  window.dispatchEvent(new CustomEvent<LayerPanelRevealDetail>(LAYER_PANEL_REVEAL_EVENT, {
    detail: { documentId, layerId }
  }))
}
