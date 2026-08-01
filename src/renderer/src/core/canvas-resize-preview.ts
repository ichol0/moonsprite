export interface CanvasResizePreview {
  width: number
  height: number
  offsetX: number
  offsetY: number
}

export const CANVAS_RESIZE_PREVIEW_EVENT = 'moonsprite:canvas-resize-preview'

export function publishCanvasResizePreview(documentId: string, preview: CanvasResizePreview | null): void {
  window.dispatchEvent(new CustomEvent(CANVAS_RESIZE_PREVIEW_EVENT, { detail: { documentId, preview } }))
}
