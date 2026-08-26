export interface CanvasResizePreview {
  width: number
  height: number
  offsetX: number
  offsetY: number
}

export interface CanvasResizePreviewHistoryController {
  undo: () => void
  redo: () => void
}

const historyControllers = new Map<string, CanvasResizePreviewHistoryController>()

export const CANVAS_RESIZE_PREVIEW_EVENT = 'moonsprite:canvas-resize-preview'

export const CANVAS_RESIZE_PREVIEW_LAYERS = ['checker', 'content', 'outside-mask', 'bounds'] as const
export type CanvasResizePreviewLayer = typeof CANVAS_RESIZE_PREVIEW_LAYERS[number]

export function drawCanvasResizePreviewLayers(draw: (layer: CanvasResizePreviewLayer) => void): void {
  for (const layer of CANVAS_RESIZE_PREVIEW_LAYERS) draw(layer)
}

export function publishCanvasResizePreview(documentId: string, preview: CanvasResizePreview | null): void {
  window.dispatchEvent(new CustomEvent(CANVAS_RESIZE_PREVIEW_EVENT, { detail: { documentId, preview } }))
}

export function registerCanvasResizePreviewHistory(documentId: string, controller: CanvasResizePreviewHistoryController): () => void {
  historyControllers.set(documentId, controller)
  return () => {
    if (historyControllers.get(documentId) === controller) historyControllers.delete(documentId)
  }
}

export function consumeCanvasResizePreviewHistory(documentId: string, direction: 'undo' | 'redo'): boolean {
  const controller = historyControllers.get(documentId)
  if (!controller) return false
  controller[direction]()
  return true
}
