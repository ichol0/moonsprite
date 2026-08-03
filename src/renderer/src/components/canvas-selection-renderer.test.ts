import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { drawSelectionOutline } from './canvas-selection-renderer'

class MockPath2D {
  moveTo = vi.fn()
  lineTo = vi.fn()
}

describe('drawSelectionOutline', () => {
  beforeEach(() => {
    vi.stubGlobal('Path2D', MockPath2D)
    vi.spyOn(performance, 'now').mockReturnValue(0)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('hides only the marching ants while keeping all transform handles', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), translate: vi.fn(), setLineDash: vi.fn(), stroke: vi.fn(),
      fillRect: vi.fn(), strokeRect: vi.fn(), lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
      lineDashOffset: 0, strokeStyle: '', fillStyle: ''
    }

    drawSelectionOutline({
      context: context as never,
      selection: { x: 0, y: 0, width: 2, height: 2 },
      box: { x: 10, y: 20, width: 32, height: 32 },
      view: { zoom: 16, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      viewportWidth: 200,
      viewportHeight: 200,
      rotationIndicatorPosition: 'view',
      cache: null,
      showOutline: false,
      showHandles: true
    })

    expect(context.stroke).not.toHaveBeenCalled()
    expect(context.fillRect).toHaveBeenCalledTimes(8)
    expect(context.strokeRect).toHaveBeenCalledTimes(8)
  })
})
