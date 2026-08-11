import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDocument, getActiveLayer, readLayerColor, writeLayerColor } from '@/core/document'
import { useWorkspace } from '@/store/workspace'
import { ColorReplacementDialog } from './ColorReplacementDialog'
import { publishCanvasColorSample } from './color-sampling-events'

beforeEach(() => {
  localStorage.clear()
  useWorkspace.setState({ sessions: [], activeId: null, message: null, dialog: null })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ColorReplacementDialog', () => {
  it('samples each color field without overwriting the other field', () => {
    const document = createDocument('replace color sampling', 2, 2, 'rgba')
    useWorkspace.getState().addSession(document)
    render(<ColorReplacementDialog onClose={vi.fn()} />)
    const source = screen.getByRole('button', { name: '初始颜色 初始颜色' })
    const replacement = screen.getByRole('button', { name: '替换为 替换为' })
    const originalSource = source.textContent

    fireEvent.click(screen.getByRole('button', { name: '从画布吸取替换颜色' }))
    expect(useWorkspace.getState().sessions[0].tool).toBe('eyedropper')
    act(() => publishCanvasColorSample({ r: 18, g: 171, b: 52, a: 255 }, false))
    expect(replacement).toHaveTextContent('#12AB34')
    expect(source.textContent).toBe(originalSource)

    fireEvent.click(screen.getByRole('button', { name: '从画布吸取初始颜色' }))
    act(() => publishCanvasColorSample({ r: 145, g: 21, b: 34, a: 255 }, false))
    expect(source).toHaveTextContent('#911522')
    expect(useWorkspace.getState().sharedPrimaryColor).toEqual({ r: 145, g: 21, b: 34, a: 255 })
  })

  it('keeps the current preview visible while the replacement color changes', async () => {
    const sourceColor = { r: 145, g: 21, b: 34, a: 255 }
    const firstReplacement = { r: 18, g: 171, b: 52, a: 255 }
    const nextReplacement = { r: 41, g: 121, b: 255, a: 255 }
    const document = createDocument('stable replacement preview', 1, 1, 'rgba')
    writeLayerColor(document, getActiveLayer(document), 0, sourceColor)
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setPrimaryColor(sourceColor)
    useWorkspace.getState().setSecondaryColor(firstReplacement)
    const restore = vi.spyOn(useWorkspace.getState(), 'restoreColorReplacementPreview')
    render(<ColorReplacementDialog onClose={vi.fn()} />)

    await waitFor(() => expect(readLayerColor(document, getActiveLayer(document), 0)).toEqual(firstReplacement))
    fireEvent.click(screen.getByRole('button', { name: '从画布吸取替换颜色' }))
    act(() => publishCanvasColorSample(nextReplacement, false))

    expect(restore).not.toHaveBeenCalled()
    await waitFor(() => expect(readLayerColor(document, getActiveLayer(document), 0)).toEqual(nextReplacement))
  })

  it('shows selection as a target without the preview description text', () => {
    const document = createDocument('selection target', 2, 2, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 0, y: 0, width: 1, height: 1, mask: new Uint8Array([1]) })
    render(<ColorReplacementDialog onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '目标' }))
    expect(screen.getByRole('option', { name: /选区/ })).toBeInTheDocument()
    expect(screen.queryByText('在画布上临时显示替换结果，取消后不保留更改。')).not.toBeInTheDocument()
  })
})
