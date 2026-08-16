import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureAnimationDocument } from '@/core/animation'
import { createDocument, createLayer, getActiveLayer, readLayerColor, writeLayerColor } from '@/core/document'
import { useWorkspace } from '@/store/workspace'
import { ColorReplacementDialog } from './ColorReplacementDialog'
import { publishCanvasColorSample, publishCanvasColorSamplingCompleted } from './color-sampling-events'

beforeEach(() => {
  localStorage.clear()
  useWorkspace.setState({ sessions: [], activeId: null, message: null, dialog: null })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ColorReplacementDialog', () => {
  it('starts both colors at white', () => {
    useWorkspace.getState().addSession(createDocument('replace color defaults', 2, 2, 'rgba'))
    render(<ColorReplacementDialog onClose={vi.fn()} />)

    expect(screen.getAllByText('#FFFFFF')).toHaveLength(2)
  })

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
    act(() => publishCanvasColorSamplingCompleted())
    expect(screen.getAllByRole('button').filter((button) => button.getAttribute('aria-pressed') === 'true')).toHaveLength(0)
    expect(useWorkspace.getState().sessions[0].tool).toBe('pencil')

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
    const restore = vi.spyOn(useWorkspace.getState(), 'restoreColorReplacementPreview')
    render(<ColorReplacementDialog onClose={vi.fn()} />)

    const eyedroppers = screen.getAllByRole('button').filter((button) => button.hasAttribute('aria-pressed'))
    fireEvent.click(eyedroppers[0])
    act(() => publishCanvasColorSample(sourceColor, false))
    act(() => publishCanvasColorSamplingCompleted())
    fireEvent.click(eyedroppers[1])
    act(() => publishCanvasColorSample(firstReplacement, false))
    act(() => publishCanvasColorSamplingCompleted())
    await waitFor(() => expect(readLayerColor(document, getActiveLayer(document), 0)).toEqual(firstReplacement))
    fireEvent.click(eyedroppers[1])
    act(() => publishCanvasColorSample(nextReplacement, false))

    expect(restore).not.toHaveBeenCalled()
    await waitFor(() => expect(readLayerColor(document, getActiveLayer(document), 0)).toEqual(nextReplacement))
  })

  it('moves the live preview to the newly selected layer', async () => {
    const sourceColor = { r: 145, g: 21, b: 34, a: 255 }
    const replacementColor = { r: 41, g: 121, b: 255, a: 255 }
    const document = createDocument('replacement preview layer selection', 1, 1, 'rgba')
    const firstLayer = getActiveLayer(document)
    const secondLayer = createLayer('Second', 1, 1, 'rgba')
    document.layers.push(secondLayer)
    ensureAnimationDocument(document)
    writeLayerColor(document, firstLayer, 0, sourceColor)
    writeLayerColor(document, secondLayer, 0, sourceColor)
    useWorkspace.getState().addSession(document)
    render(<ColorReplacementDialog onClose={vi.fn()} />)

    const eyedroppers = screen.getAllByRole('button').filter((button) => button.hasAttribute('aria-pressed'))
    fireEvent.click(eyedroppers[0])
    act(() => publishCanvasColorSample(sourceColor, false))
    act(() => publishCanvasColorSamplingCompleted())
    fireEvent.click(eyedroppers[1])
    act(() => publishCanvasColorSample(replacementColor, false))
    act(() => publishCanvasColorSamplingCompleted())

    await waitFor(() => expect(readLayerColor(document, firstLayer, 0)).toEqual(replacementColor))
    expect(readLayerColor(document, secondLayer, 0)).toEqual(sourceColor)

    act(() => useWorkspace.getState().selectLayer(secondLayer.id))

    await waitFor(() => {
      expect(readLayerColor(document, firstLayer, 0)).toEqual(sourceColor)
      expect(readLayerColor(document, secondLayer, 0)).toEqual(replacementColor)
    })
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
