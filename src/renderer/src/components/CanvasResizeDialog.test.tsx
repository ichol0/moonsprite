import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDocument } from '@/core/document'
import { useWorkspace } from '@/store/workspace'
import { CanvasResizeDialog } from './CanvasResizeDialog'

afterEach(() => {
  cleanup()
  useWorkspace.setState({ sessions: [], activeId: null, message: null, saveProgress: null, dialog: null })
})

describe('CanvasResizeDialog', () => {
  const documentId = 'canvas-resize-document'

  it('submits the trim-outside option to the resize command', () => {
    const resize = vi.fn(async () => {})
    render(
      <CanvasResizeDialog
        open
        documentId={documentId}
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
        documentId={documentId}
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
        documentId={documentId}
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
        documentId={documentId}
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
        documentId={documentId}
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

  it('updates all four bounds after edge synchronization is enabled', () => {
    render(
      <CanvasResizeDialog
        open
        documentId={documentId}
        currentWidth={32}
        currentHeight={32}
        onClose={vi.fn()}
        onResize={vi.fn(async () => {})}
        onPreview={vi.fn()}
        preview={null}
      />
    )

    fireEvent.click(screen.getByRole('checkbox', { name: '同步四边' }))
    const bounds = screen.getAllByRole('spinbutton').slice(2)
    fireEvent.change(bounds[2], { target: { value: '4' } })

    for (const bound of bounds) expect(bound).toHaveValue('4')
  })

  it('undoes a complete live dimension edit instead of one browser character', () => {
    const preview = vi.fn()
    const bubbledKeyDown = vi.fn()
    render(
      <div onKeyDown={bubbledKeyDown}>
        <CanvasResizeDialog
          open
          documentId={documentId}
          currentWidth={32}
          currentHeight={32}
          onClose={vi.fn()}
          onResize={vi.fn(async () => {})}
          onPreview={preview}
          preview={null}
        />
      </div>
    )
    const width = screen.getAllByRole('spinbutton')[0]
    fireEvent.focus(width)
    fireEvent.change(width, { target: { value: '54' } })
    expect(width).toHaveValue('54')

    fireEvent.keyDown(width, { key: 'z', ctrlKey: true })

    expect(width).toHaveValue('32')
    expect(bubbledKeyDown).not.toHaveBeenCalled()
  })

  it('undoes a canvas guide dragged outside the dialog without touching document history', () => {
    const props = {
      open: true,
      documentId,
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

  it('keeps document history locked while canvas guide positions undo and redo', () => {
    const document = createDocument('canvas resize history lock', 32, 32, 'rgba')
    useWorkspace.getState().addSession(document)
    const session = useWorkspace.getState().sessions[0]
    let documentUndo = 0
    let documentRedo = 0
    session.history.push({
      label: 'earlier document edit',
      bytes: 0,
      undo: () => { documentUndo += 1 },
      redo: () => { documentRedo += 1 },
      documentChanged: false
    })
    const props = {
      open: true,
      documentId: document.id,
      currentWidth: 32,
      currentHeight: 32,
      onClose: vi.fn(),
      onResize: vi.fn(async () => {}),
      onPreview: vi.fn()
    }
    const view = render(<CanvasResizeDialog {...props} preview={null} />)
    view.rerender(<CanvasResizeDialog {...props} preview={{ width: 40, height: 36, offsetX: 4, offsetY: 2 }} />)

    act(() => useWorkspace.getState().undo())
    expect(screen.getAllByRole('spinbutton')[0]).toHaveValue('32')
    expect(documentUndo).toBe(0)

    act(() => useWorkspace.getState().undo())
    expect(documentUndo).toBe(0)

    act(() => useWorkspace.getState().redo())
    expect(screen.getAllByRole('spinbutton')[0]).toHaveValue('40')
    expect(documentRedo).toBe(0)
  })
})
