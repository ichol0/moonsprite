import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { drawSelectionOutline } from './canvas-selection-renderer'

class MockPath2D {
  moveTo = vi.fn()
  lineTo = vi.fn()
}

interface StrokeSnapshot {
  lineWidth: number
  lineDash: number[]
  lineDashOffset: number
  strokeStyle: string
}

const createRecordingContext = (): { context: object; strokes: StrokeSnapshot[] } => {
  let currentLineWidth = 1
  let currentLineDash: number[] = []
  let currentLineDashOffset = 0
  let currentStrokeStyle = ''
  const strokes: StrokeSnapshot[] = []
  const context = {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    setLineDash: vi.fn((lineDash: number[]) => { currentLineDash = [...lineDash] }),
    stroke: vi.fn(() => {
      strokes.push({
        lineWidth: currentLineWidth,
        lineDash: [...currentLineDash],
        lineDashOffset: currentLineDashOffset,
        strokeStyle: currentStrokeStyle
      })
    }),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    lineCap: 'butt',
    lineJoin: 'miter',
    fillStyle: '',
    get lineWidth() { return currentLineWidth },
    set lineWidth(value: number) { currentLineWidth = value },
    get lineDashOffset() { return currentLineDashOffset },
    set lineDashOffset(value: number) { currentLineDashOffset = value },
    get strokeStyle() { return currentStrokeStyle },
    set strokeStyle(value: string) { currentStrokeStyle = value }
  }
  return { context, strokes }
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
      outlineDark: '#123456',
      outlineLight: '#abcdef',
      showOutline: false,
      showHandles: true
    })

    expect(context.stroke).not.toHaveBeenCalled()
    expect(context.fillRect).toHaveBeenCalledTimes(16)
    expect(context.strokeRect).not.toHaveBeenCalled()
  })

  it('draws transform handles at supplied rotated positions', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), translate: vi.fn(), setLineDash: vi.fn(), stroke: vi.fn(),
      fillRect: vi.fn(), strokeRect: vi.fn(), lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
      lineDashOffset: 0, strokeStyle: '', fillStyle: ''
    }
    const handlePoints = Array.from({ length: 8 }, (_, index) => ({ x: 20 + index, y: 40 + index }))

    drawSelectionOutline({
      context: context as never,
      selection: { x: 0, y: 0, width: 2, height: 2 },
      box: { x: 10, y: 20, width: 32, height: 32 },
      view: { zoom: 16, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
      viewportWidth: 200,
      viewportHeight: 200,
      rotationIndicatorPosition: 'view',
      cache: null,
      outlineDark: '#123456',
      outlineLight: '#abcdef',
      showOutline: false,
      showHandles: true,
      handlePoints
    })

    expect(context.fillRect).toHaveBeenNthCalledWith(1, 15, 35, 10, 10)
    expect(context.fillRect).toHaveBeenNthCalledWith(2, 17, 37, 6, 6)
    expect(context.fillRect).toHaveBeenNthCalledWith(15, 22, 42, 10, 10)
    expect(context.fillRect).toHaveBeenNthCalledWith(16, 24, 44, 6, 6)
  })

  it('keeps marching-ant dimensions fixed in CSS pixels across zoom levels', () => {
    const mask = new Uint8Array(100 * 80)
    for (let y = 0; y < 80; y += 1) {
      const inset = Math.floor(y / 20) * 10
      for (let x = inset; x < 100 - inset; x += 1) mask[y * 100 + x] = 1
    }
    for (const zoom of [0.05, 32]) {
      const { context, strokes } = createRecordingContext()
      drawSelectionOutline({
        context: context as never,
        selection: { x: 0, y: 0, width: 100, height: 80, mask },
        box: { x: 10, y: 20, width: 100 * zoom, height: 80 * zoom },
        view: { zoom, panX: 0, panY: 0, rotation: 0, mirrored: false, mirroredVertical: false, showGrid: false, relativeLuminance: false },
        viewportWidth: 4096,
        viewportHeight: 4096,
        rotationIndicatorPosition: 'view',
        cache: null,
        outlineDark: '#123456',
        outlineLight: '#abcdef',
        showHandles: false
      })

      expect(strokes[0]).toEqual({ lineWidth: 1, lineDash: [], lineDashOffset: 0, strokeStyle: '#abcdef' })
      expect(strokes.length).toBeGreaterThan(1)
      expect(strokes.slice(1).every((stroke) => (
        stroke.lineWidth === 1
        && stroke.lineDash[0] === 6
        && stroke.lineDash[1] === 6
        && stroke.strokeStyle === '#123456'
      ))).toBe(true)
      expect(new Set(strokes.slice(1).map((stroke) => stroke.lineDashOffset)).size).toBeGreaterThan(1)
    }
  })
})
