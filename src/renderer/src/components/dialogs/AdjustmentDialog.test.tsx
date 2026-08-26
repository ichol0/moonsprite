import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdjustmentDialog } from './AdjustmentDialog'
import { useWorkspace } from '@/store/workspace'
import { createDocument, createLayer, getActiveLayer, readLayerColor, writeLayerColor } from '@/core/document'
import { beginAdjustmentPreviewEdit, endAdjustmentPreviewEdit, prepareAdjustmentPreviewEdit, renderAdjustmentPreviewEdit } from '@/core/adjustment-preview-lifecycle'
import { notifyViewPreview } from '@/core/view-preview-lifecycle'

beforeEach(() => useWorkspace.setState({ sessions: [], activeId: null, message: null, dialog: null }))
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('AdjustmentDialog', () => {
  it('keeps the curve plot styling separate from toolbar icon buttons', () => {
    render(<AdjustmentDialog kind="curves" onClose={vi.fn()} />)

    const plot = screen.getByRole('application', { name: /曲线编辑器/ })
    const removeButton = screen.getByRole('button', { name: '删除选中的控制点' })
    expect(plot).toHaveClass('curve-editor-plot')
    expect(removeButton.querySelector('svg')).not.toHaveClass('curve-editor-plot')
    expect(screen.getByRole('group', { name: '曲线通道' }).children).toHaveLength(4)
  })

  it('does not rewrite the snapshot when closing before a preview was applied', () => {
    const snapshot = { layers: [{ layerId: 'layer-1', frameId: 'frame-1', width: 1, height: 1, offsetX: 0, offsetY: 0, storageOriginX: 0, storageOriginY: 0, pixels: new Uint8ClampedArray(4) }], palette: [], nextColorId: 1 }
    const state = useWorkspace.getState()
    const capture = vi.spyOn(state, 'captureActiveLayerAdjustmentSnapshot').mockReturnValue(snapshot)
    const restore = vi.spyOn(state, 'restoreActiveDocumentSnapshot').mockImplementation(() => undefined)
    vi.spyOn(state, 'previewActiveLayerAdjustment').mockImplementation(() => undefined)
    const onClose = vi.fn()
    render(<AdjustmentDialog kind="brightness-contrast" onClose={onClose} />)

    window.dispatchEvent(new Event('moonsprite:close-dialog'))

    expect(capture).toHaveBeenCalled()
    expect(restore).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('keeps adjustment values while rebasing the preview after the selection changes', async () => {
    const document = createDocument('dynamic adjustment target', 2, 1, 'rgba')
    const second = createLayer('Second', 2, 1, 'rgba')
    document.layers.push(second)
    useWorkspace.getState().addSession(document)
    const state = useWorkspace.getState()
    render(<AdjustmentDialog kind="brightness-contrast" onClose={vi.fn()} />)

    fireEvent.change(screen.getAllByRole('slider')[0], { target: { value: '30' } })

    act(() => state.setSelection({ x: 0, y: 0, width: 1, height: 1 }))
    await waitFor(() => expect(screen.getAllByRole('slider')[0]).toHaveValue('30'))

    act(() => {
      state.setSelection(null)
      state.selectLayer(second.id, true)
    })
    await waitFor(() => expect(screen.getAllByRole('slider')[0]).toHaveValue('30'))
  })

  it('removes the temporary effect before selection edits and reapplies it only to the new selection', async () => {
    const document = createDocument('adjustment selection lifecycle', 2, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, { r: 20, g: 20, b: 20, a: 255 })
    writeLayerColor(document, layer, 1, { r: 40, g: 40, b: 40, a: 255 })
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 0, y: 0, width: 1, height: 1 })
    render(<AdjustmentDialog kind="brightness-contrast" onClose={vi.fn()} />)

    fireEvent.change(screen.getAllByRole('slider')[0], { target: { value: '40' } })
    await waitFor(() => expect(readLayerColor(document, layer, 0).r).toBeGreaterThan(20))
    expect(readLayerColor(document, layer, 1).r).toBe(40)

    act(() => {
      beginAdjustmentPreviewEdit(document.id)
      expect(readLayerColor(document, layer, 0).r).toBe(20)
      writeLayerColor(document, layer, 1, { r: 20, g: 20, b: 20, a: 255 })
      useWorkspace.getState().setSelection({ x: 1, y: 0, width: 1, height: 1 })
      endAdjustmentPreviewEdit(document.id)
    })

    await waitFor(() => expect(readLayerColor(document, layer, 1).r).toBeGreaterThan(20))
    expect(readLayerColor(document, layer, 0).r).toBe(20)
    expect(screen.getAllByRole('slider')[0]).toHaveValue('40')
  })

  it('keeps the adjustment visible on a transiently moved selection without baking it into the baseline', async () => {
    const document = createDocument('transient adjusted transform', 2, 1, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 0, { r: 20, g: 20, b: 20, a: 255 })
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 0, y: 0, width: 1, height: 1 })
    render(<AdjustmentDialog kind="brightness-contrast" onClose={vi.fn()} />)
    fireEvent.change(screen.getAllByRole('slider')[0], { target: { value: '40' } })
    await waitFor(() => expect(readLayerColor(document, layer, 0).r).toBeGreaterThan(20))

    act(() => {
      beginAdjustmentPreviewEdit(document.id)
      writeLayerColor(document, layer, 0, { r: 0, g: 0, b: 0, a: 0 })
      writeLayerColor(document, layer, 1, { r: 20, g: 20, b: 20, a: 255 })
      useWorkspace.getState().setSelection({ x: 1, y: 0, width: 1, height: 1 })
      renderAdjustmentPreviewEdit(document.id, { x: 1, y: 0, width: 1, height: 1 })
    })
    expect(readLayerColor(document, layer, 1).r).toBeGreaterThan(20)

    act(() => prepareAdjustmentPreviewEdit(document.id))
    expect(readLayerColor(document, layer, 1).r).toBe(20)
    act(() => endAdjustmentPreviewEdit(document.id))
    await waitFor(() => expect(readLayerColor(document, layer, 1).r).toBeGreaterThan(20))
  })

  it('exposes HSL lightness separately from hue and saturation', () => {
    render(<AdjustmentDialog kind="hue-saturation" onClose={vi.fn()} />)
    expect(screen.getByText('色相')).toBeInTheDocument()
    expect(screen.getByText('饱和度')).toBeInTheDocument()
    expect(screen.getByText('明度')).toBeInTheDocument()
  })

  it('coalesces rapid slider input into one preview per animation frame', async () => {
    const document = createDocument('coalesced adjustment preview', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    const state = useWorkspace.getState()
    const snapshot = state.captureActiveLayerAdjustmentSnapshot()!
    vi.spyOn(state, 'captureActiveLayerAdjustmentSnapshot').mockReturnValue(snapshot)
    const preview = vi.spyOn(state, 'previewActiveLayerAdjustment').mockImplementation(() => undefined)
    let scheduled: FrameRequestCallback | null = null
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { scheduled = callback; return 1 })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => { scheduled = null })
    render(<AdjustmentDialog kind="brightness-contrast" onClose={vi.fn()} />)
    await act(async () => { await Promise.resolve() })
    act(() => { scheduled?.(0); scheduled = null })
    preview.mockClear()

    const brightness = screen.getAllByRole('slider')[0]
    fireEvent.change(brightness, { target: { value: '10' } })
    fireEvent.change(brightness, { target: { value: '20' } })
    fireEvent.change(brightness, { target: { value: '30' } })

    expect(preview).not.toHaveBeenCalled()
    act(() => scheduled?.(16))
    expect(preview).toHaveBeenCalledOnce()
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({ brightness: 30 }), snapshot, undefined, expect.any(Object))
  })

  it('does not recompute while live pan stays inside the buffered preview region', async () => {
    vi.useFakeTimers()
    const document = createDocument('buffered adjustment preview', 200, 200, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 100 * layer.width + 100, { r: 40, g: 40, b: 40, a: 255 })
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setViewportSize({ width: 160, height: 160 })
    const state = useWorkspace.getState()
    const preview = vi.spyOn(state, 'previewActiveLayerAdjustment')
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frames.push(callback); return frames.length })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    render(<AdjustmentDialog kind="brightness-contrast" onClose={vi.fn()} />)
    await act(async () => { await Promise.resolve() })
    act(() => { while (frames.length > 0) frames.shift()!(0) })
    preview.mockClear()

    fireEvent.change(screen.getAllByRole('slider')[0], { target: { value: '30' } })
    act(() => frames.shift()?.(16))
    expect(preview).toHaveBeenCalledOnce()
    preview.mockClear()

    const view = useWorkspace.getState().sessions[0].view
    act(() => notifyViewPreview(document.id, { ...view, panX: -16 }))
    act(() => vi.advanceTimersByTime(120))
    expect(frames).toHaveLength(0)
    expect(preview).not.toHaveBeenCalled()

    act(() => notifyViewPreview(document.id, { ...view, panX: -640 }))
    act(() => vi.advanceTimersByTime(89))
    expect(frames).toHaveLength(0)
    act(() => vi.advanceTimersByTime(1))
    expect(frames).toHaveLength(1)
    act(() => frames.shift()?.(32))
    expect(preview).toHaveBeenCalledOnce()
  })
})
