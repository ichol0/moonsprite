import { describe, expect, it, vi } from 'vitest'
import { drawCanvasResizePreviewLayers } from './canvas-resize-preview'

describe('canvas resize preview', () => {
  it('dims old-canvas-external content after drawing it', () => {
    const draw = vi.fn()
    drawCanvasResizePreviewLayers(draw)
    expect(draw.mock.calls.map(([layer]) => layer)).toEqual(['checker', 'content', 'outside-mask', 'bounds'])
  })
})
