import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDocument } from '@/core/document'
import { publishSelectionSizePreview } from '@/components/selection-size-preview-events'
import { useWorkspace } from '@/store/workspace'
import { EditorStatusBar } from './EditorStatusBar'

beforeEach(() => {
  useWorkspace.setState({ sessions: [], activeId: null, message: null, dialog: null })
})

afterEach(() => {
  cleanup()
})

describe('EditorStatusBar', () => {
  it('shows live marquee dimensions and restores the committed selection afterward', () => {
    const document = createDocument('status selection preview', 32, 32, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 1, y: 2, width: 5, height: 4 })
    render(<EditorStatusBar homeOpen={false} resourceLabel="" />)

    expect(screen.getByText('选区 5 x 4')).toBeInTheDocument()
    act(() => publishSelectionSizePreview({ documentId: document.id, size: { width: 22, height: 16 } }))
    expect(screen.getByText('选区 22 x 16')).toBeInTheDocument()

    act(() => publishSelectionSizePreview({ documentId: document.id, size: null }))
    expect(screen.getByText('选区 5 x 4')).toBeInTheDocument()
  })
})
