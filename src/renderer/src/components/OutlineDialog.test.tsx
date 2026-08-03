import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDocument, getActiveLayer, readLayerColorAt, writeLayerColor } from '@/core/document'
import { useWorkspace } from '@/store/workspace'
import { OutlineDialog } from './OutlineDialog'

beforeEach(() => useWorkspace.setState({ sessions: [], activeId: null, message: null, dialog: null }))
afterEach(cleanup)

describe('OutlineDialog', () => {
  it('confirms once and closes when Enter is pressed in the width input', async () => {
    const document = createDocument('outline enter', 3, 3, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 4, { r: 255, g: 255, b: 255, a: 255 })
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setPrimaryColor({ r: 255, g: 0, b: 0, a: 255 })
    useWorkspace.getState().setSelection({ x: 1, y: 1, width: 1, height: 1 })
    const onClose = vi.fn()
    const session = useWorkspace.getState().sessions[0]
    render(<OutlineDialog open session={session} onClose={onClose} />)

    const widthInput = screen.getByRole('spinbutton')
    fireEvent.change(widthInput, { target: { value: '2' } })
    fireEvent.keyDown(widthInput, { key: 'Enter' })

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(session.outlinePreview).toBeNull()
    expect(readLayerColorAt(document, layer, 1, 0)).toEqual({ r: 255, g: 0, b: 0, a: 255 })
    expect(session.selection).toEqual({ x: 1, y: 1, width: 1, height: 1 })
    expect(session.history.canUndo).toBe(true)
    expect(document.outlineSettings?.thickness).toBe(2)
  })

  it('owns Enter while the dialog is open even when focus remains on the canvas', async () => {
    const document = createDocument('outline canvas enter', 3, 3, 'rgba')
    const layer = getActiveLayer(document)
    writeLayerColor(document, layer, 4, { r: 255, g: 255, b: 255, a: 255 })
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 1, y: 1, width: 1, height: 1 })
    const onClose = vi.fn()
    render(<OutlineDialog open session={useWorkspace.getState().sessions[0]} onClose={onClose} />)

    fireEvent.keyDown(window, { key: 'Enter' })

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(useWorkspace.getState().sessions[0].selection).toEqual({ x: 1, y: 1, width: 1, height: 1 })
  })
})
