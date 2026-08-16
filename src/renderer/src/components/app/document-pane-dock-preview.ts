import type { DocumentPaneDirection } from '@/core/document-pane-layout'

export const DOCUMENT_PANE_DOCK_PREVIEW_ATTRIBUTE = 'data-document-pane-dock-preview'

export interface DocumentPaneDockPreviewUpdate {
  surface: HTMLElement | null
  visible: boolean
}

const documentPaneDockPreviewSurface = (pane: HTMLElement | null): HTMLElement | null => {
  if (!pane) return null
  if (pane.classList.contains('document-pane')) return pane.querySelector<HTMLElement>(':scope > .document-pane-canvas') ?? pane
  return pane
}

export const clearDocumentPaneDockPreview = (surface: HTMLElement | null): void => {
  surface?.removeAttribute(DOCUMENT_PANE_DOCK_PREVIEW_ATTRIBUTE)
}

export const updateDocumentPaneDockPreview = (currentSurface: HTMLElement | null, pane: HTMLElement | null, direction: DocumentPaneDirection | null): DocumentPaneDockPreviewUpdate => {
  const nextSurface = direction ? documentPaneDockPreviewSurface(pane) : null
  if (currentSurface !== nextSurface) clearDocumentPaneDockPreview(currentSurface)
  if (!nextSurface || !direction) return { surface: null, visible: false }
  nextSurface.setAttribute(DOCUMENT_PANE_DOCK_PREVIEW_ATTRIBUTE, direction)
  return {
    surface: nextSurface,
    visible: nextSurface.isConnected && nextSurface.getAttribute(DOCUMENT_PANE_DOCK_PREVIEW_ATTRIBUTE) === direction
  }
}
