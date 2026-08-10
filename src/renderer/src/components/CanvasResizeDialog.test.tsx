import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CanvasResizeDialog } from './CanvasResizeDialog'

afterEach(() => cleanup())

describe('CanvasResizeDialog', () => {
  it('submits the trim-outside option to the resize command', () => {
    const resize = vi.fn(async () => {})
    render(
      <CanvasResizeDialog
        open
        currentWidth={32}
        currentHeight={32}
        onClose={vi.fn()}
        onResize={resize}
        onPreview={vi.fn()}
        preview={null}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '完成' }))

    expect(resize).toHaveBeenCalledWith(32, 32, 'center', 0, 0, true)
  })

  it('keeps edited dimensions when the preview callback changes during a parent render', () => {
    const firstPreview = vi.fn()
    const resize = vi.fn(async () => {})
    const view = render(
      <CanvasResizeDialog
        open
        currentWidth={32}
        currentHeight={32}
        onClose={vi.fn()}
        onResize={resize}
        onPreview={firstPreview}
        preview={null}
      />
    )
    const widthInput = screen.getAllByRole('spinbutton')[0]
    fireEvent.change(widthInput, { target: { value: '64' } })
    expect(widthInput).toHaveValue('64')

    const nextPreview = vi.fn()
    view.rerender(
      <CanvasResizeDialog
        open
        currentWidth={32}
        currentHeight={32}
        onClose={vi.fn()}
        onResize={resize}
        onPreview={nextPreview}
        preview={null}
      />
    )

    expect(screen.getAllByRole('spinbutton')[0]).toHaveValue('64')
    expect(nextPreview).not.toHaveBeenCalled()
  })

  it('selects the first dimension when opened', () => {
    render(
      <CanvasResizeDialog
        open
        currentWidth={32}
        currentHeight={32}
        onClose={vi.fn()}
        onResize={vi.fn(async () => {})}
        onPreview={vi.fn()}
        preview={null}
      />
    )

    expect(screen.getAllByRole('spinbutton')[0]).toHaveFocus()
  })

  it('updates the canvas guide for every valid dimension typed', () => {
    const preview = vi.fn()
    let scheduled: FrameRequestCallback | null = null
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { scheduled = callback; return 1 })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => { scheduled = null })
    render(
      <CanvasResizeDialog
        open
        currentWidth={32}
        currentHeight={32}
        onClose={vi.fn()}
        onResize={vi.fn(async () => {})}
        onPreview={preview}
        preview={null}
      />
    )
    preview.mockClear()

    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '48' } })
    act(() => { scheduled?.(0); scheduled = null })

    expect(preview).toHaveBeenCalledWith({ width: 48, height: 32, offsetX: 8, offsetY: 0 })
  })

  it('undoes a complete live dimension edit instead of one browser character', () => {
    const preview = vi.fn()
    render(
      <CanvasResizeDialog
        open
        currentWidth={32}
        currentHeight={32}
        onClose={vi.fn()}
        onResize={vi.fn(async () => {})}
        onPreview={preview}
        preview={null}
      />
    )
    const width = screen.getAllByRole('spinbutton')[0]
    fireEvent.focus(width)
    fireEvent.change(width, { target: { value: '54' } })
    expect(width).toHaveValue('54')

    fireEvent.keyDown(width, { key: 'z', ctrlKey: true })

    expect(width).toHaveValue('32')
  })

  it('undoes a canvas guide dragged outside the dialog without touching document history', () => {
    const props = {
      open: true,
      currentWidth: 32,
      currentHeight: 32,
      onClose: vi.fn(),
      onResize: vi.fn(async () => {}),
      onPreview: vi.fn()
    }
    const view = render(<CanvasResizeDialog {...props} preview={null} />)
    view.rerender(<CanvasResizeDialog {...props} preview={{ width: 40, height: 36, offsetX: 4, offsetY: 2 }} />)
    expect(screen.getAllByRole('spinbutton')[0]).toHaveValue('40')

    fireEvent.keyDown(screen.getAllByRole('spinbutton')[0], { key: 'z', ctrlKey: true })

    expect(screen.getAllByRole('spinbutton')[0]).toHaveValue('32')
  })
})
