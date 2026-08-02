type ViewPreviewFlusher = () => void

const flushers = new Map<string, Set<ViewPreviewFlusher>>()

export const registerViewPreviewFlusher = (documentId: string, flusher: ViewPreviewFlusher): (() => void) => {
  const documentFlushers = flushers.get(documentId) ?? new Set<ViewPreviewFlusher>()
  documentFlushers.add(flusher)
  flushers.set(documentId, documentFlushers)
  return () => {
    documentFlushers.delete(flusher)
    if (documentFlushers.size === 0) flushers.delete(documentId)
  }
}

export const flushViewPreview = (documentId: string): void => {
  for (const flusher of [...(flushers.get(documentId) ?? [])]) flusher()
}
