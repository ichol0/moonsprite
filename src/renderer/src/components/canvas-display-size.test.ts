import { describe, expect, it } from 'vitest'
import { syncCanvasDisplaySize } from './canvas-display-size'

describe('syncCanvasDisplaySize', () => {
  it('pins the rendered CSS size so a later container resize cannot stretch the previous bitmap', () => {
    const canvas = document.createElement('canvas')
    canvas.style.width = '100%'
    canvas.style.height = '100%'

    syncCanvasDisplaySize(canvas, 320.5, 180, 2)

    expect(canvas.style.width).toBe('320.5px')
    expect(canvas.style.height).toBe('180px')
    expect(canvas.width).toBe(641)
    expect(canvas.height).toBe(360)

    syncCanvasDisplaySize(canvas, 240, 180, 2)
    expect(canvas.style.width).toBe('240px')
    expect(canvas.width).toBe(480)
  })

  it('can keep logical canvas coordinates separate from the rendered CSS size', () => {
    const canvas = document.createElement('canvas')

    syncCanvasDisplaySize(canvas, 1200, 900, 1, 800, 600)

    expect(canvas.style.width).toBe('800px')
    expect(canvas.style.height).toBe('600px')
    expect(canvas.width).toBe(1200)
    expect(canvas.height).toBe(900)
  })
})
