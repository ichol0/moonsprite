import { describe, expect, it, vi } from 'vitest'
import { flushViewPreview, registerViewPreviewFlusher } from './view-preview-lifecycle'

describe('view preview lifecycle', () => {
  it('flushes the active document preview synchronously and unregisters cleanly', () => {
    const flush = vi.fn()
    const unregister = registerViewPreviewFlusher('document-1', flush)

    flushViewPreview('document-1')
    expect(flush).toHaveBeenCalledTimes(1)

    unregister()
    flushViewPreview('document-1')
    expect(flush).toHaveBeenCalledTimes(1)
  })
})
