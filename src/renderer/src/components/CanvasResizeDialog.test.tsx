import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CanvasResizeDialog } from './CanvasResizeDialog'

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
})
