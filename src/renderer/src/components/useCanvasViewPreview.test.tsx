import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRef } from 'react'
import type { ViewState } from '@shared/types'
import { createDocument } from '@/core/document'
import { useWorkspace } from '@/store/workspace'
import { useCanvasViewPreview } from './useCanvasViewPreview'

let preview: ReturnType<typeof useCanvasViewPreview> | null = null

function Harness({ documentId, view }: { documentId: string; view: ViewState }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const selectionCanvasRef = useRef<HTMLCanvasElement>(null)
  const drawRef = useRef(vi.fn())
  preview = useCanvasViewPreview({ documentId, sessionView: view, activeViewDrag: false, canvasRef, selectionCanvasRef, drawRef })
  return null
}

beforeEach(() => {
  vi.useFakeTimers()
  useWorkspace.setState({ sessions: [], activeId: null, message: null, dialog: null })
})

afterEach(() => {
  cleanup()
  preview = null
  vi.useRealTimers()
})

describe('useCanvasViewPreview', () => {
  it('keeps a pending wheel zoom alive across same-document redraws', () => {
    const document = createDocument('playing zoom', 2, 2, 'rgba')
    useWorkspace.getState().addSession(document)
    const session = useWorkspace.getState().sessions[0]
    const { rerender } = render(<Harness documentId={document.id} view={session.view} />)

    act(() => preview?.scheduleZoomPreview({ ...session.view, zoom: 24, panX: 7, panY: 9 }))
    rerender(<Harness documentId={document.id} view={session.view} />)
    act(() => vi.advanceTimersByTime(120))

    expect(session.view.zoom).toBe(24)
    expect(session.view.panX).toBe(7)
    expect(session.view.panY).toBe(9)
  })

  it('commits a pending zoom to its document when another pane is active', () => {
    const first = createDocument('first pane', 2, 2, 'rgba')
    const second = createDocument('second pane', 2, 2, 'rgba')
    useWorkspace.getState().addSession(first)
    useWorkspace.getState().addSession(second)
    const firstSession = useWorkspace.getState().sessions.find((item) => item.document.id === first.id)
    const secondSession = useWorkspace.getState().sessions.find((item) => item.document.id === second.id)
    if (!firstSession || !secondSession) throw new Error('Pane sessions were not created')
    const { rerender } = render(<Harness documentId={first.id} view={firstSession.view} />)

    act(() => {
      preview?.scheduleZoomPreview({ ...firstSession.view, zoom: 24, panX: 7, panY: 9 })
      useWorkspace.getState().setActive(second.id)
      vi.advanceTimersByTime(120)
    })
    rerender(<Harness documentId={first.id} view={firstSession.view} />)

    expect(firstSession.view).toMatchObject({ zoom: 24, panX: 7, panY: 9 })
    expect(secondSession.view).not.toMatchObject({ zoom: 24, panX: 7, panY: 9 })
  })
})
