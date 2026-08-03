import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdjustmentDialog } from './AdjustmentDialog'
import { useWorkspace } from '@/store/workspace'
import { createDocument, createLayer } from '@/core/document'

beforeEach(() => useWorkspace.setState({ sessions: [], activeId: null, message: null, dialog: null }))
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('AdjustmentDialog', () => {
  it('keeps the curve plot styling separate from toolbar icon buttons', () => {
    render(<AdjustmentDialog kind="curves" onClose={vi.fn()} />)

    const plot = screen.getByRole('application', { name: /曲线编辑器/ })
    const removeButton = screen.getByRole('button', { name: '删除选中的控制点' })
    expect(plot).toHaveClass('curve-editor-plot')
    expect(removeButton.querySelector('svg')).not.toHaveClass('curve-editor-plot')
    expect(screen.getByRole('tablist', { name: '曲线通道' }).children).toHaveLength(4)
  })

  it('restores the preview snapshot when the global close request cancels it', () => {
    const snapshot = { layers: [{ layerId: 'layer-1', pixels: new Uint8ClampedArray(4) }], palette: [], nextColorId: 1 }
    const state = useWorkspace.getState()
    const capture = vi.spyOn(state, 'captureActiveLayerAdjustmentSnapshot').mockReturnValue(snapshot)
    const restore = vi.spyOn(state, 'restoreActiveDocumentSnapshot').mockImplementation(() => undefined)
    vi.spyOn(state, 'previewActiveLayerAdjustment').mockImplementation(() => undefined)
    const onClose = vi.fn()
    render(<AdjustmentDialog kind="brightness-contrast" onClose={onClose} />)

    window.dispatchEvent(new Event('moonsprite:close-dialog'))

    expect(capture).toHaveBeenCalled()
    expect(restore).toHaveBeenCalledWith(snapshot)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('recaptures the baseline when the selection or selected layers change', async () => {
    const document = createDocument('dynamic adjustment target', 2, 1, 'rgba')
    const second = createLayer('Second', 2, 1, 'rgba')
    document.layers.push(second)
    useWorkspace.getState().addSession(document)
    const state = useWorkspace.getState()
    const capture = vi.spyOn(state, 'captureActiveLayerAdjustmentSnapshot')
    render(<AdjustmentDialog kind="brightness-contrast" onClose={vi.fn()} />)

    act(() => state.setSelection({ x: 0, y: 0, width: 1, height: 1 }))
    await waitFor(() => expect(capture).toHaveBeenCalledTimes(2))

    act(() => {
      state.setSelection(null)
      state.selectLayer(second.id, true)
    })
    await waitFor(() => expect(capture.mock.calls.length).toBeGreaterThanOrEqual(3))
  })

  it('exposes HSL lightness separately from hue and saturation', () => {
    render(<AdjustmentDialog kind="hue-saturation" onClose={vi.fn()} />)
    expect(screen.getByText('色相')).toBeInTheDocument()
    expect(screen.getByText('饱和度')).toBeInTheDocument()
    expect(screen.getByText('明度')).toBeInTheDocument()
  })

  it('coalesces rapid slider input into one preview per animation frame', () => {
    const snapshot = { layers: [{ layerId: 'layer-1', pixels: new Uint8ClampedArray(4) }], palette: [], nextColorId: 1 }
    const state = useWorkspace.getState()
    vi.spyOn(state, 'captureActiveLayerAdjustmentSnapshot').mockReturnValue(snapshot)
    const preview = vi.spyOn(state, 'previewActiveLayerAdjustment').mockImplementation(() => undefined)
    let scheduled: FrameRequestCallback | null = null
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { scheduled = callback; return 1 })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => { scheduled = null })
    render(<AdjustmentDialog kind="brightness-contrast" onClose={vi.fn()} />)
    act(() => { scheduled?.(0); scheduled = null })
    preview.mockClear()

    const brightness = screen.getAllByRole('slider')[0]
    fireEvent.change(brightness, { target: { value: '10' } })
    fireEvent.change(brightness, { target: { value: '20' } })
    fireEvent.change(brightness, { target: { value: '30' } })

    expect(preview).not.toHaveBeenCalled()
    act(() => scheduled?.(16))
    expect(preview).toHaveBeenCalledOnce()
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({ brightness: 30 }), snapshot)
  })
})
