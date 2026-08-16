import { beforeEach, describe, expect, it } from 'vitest'
import { createDocument } from '@/core/document'
import { captureSelectionTransform } from '@/core/tools'
import { transformSelectionMask } from '@/core/selection'
import { useWorkspace } from './workspace'

beforeEach(() => {
  localStorage.clear()
  useWorkspace.setState({ sessions: [], activeId: null, message: null, saveProgress: null, dialog: null })
})

describe('selection pivot session state', () => {
  it('restores the custom pivot when a floating transform is canceled', () => {
    const document = createDocument('floating selection pivot', 12, 12, 'rgba')
    useWorkspace.getState().addSession(document)
    const selection = { x: 2, y: 3, width: 4, height: 2 }
    const pivot = { x: 3.5, y: 4.5 }
    useWorkspace.getState().setSelection(selection)
    useWorkspace.getState().setSelectionPivot(pivot)
    const source = captureSelectionTransform(document, selection)!
    const target = { ...selection, x: 5, y: 4 }
    const moved = transformSelectionMask(source.selection, target, document.width, document.height, 0, undefined, false)!

    useWorkspace.getState().beginFloatingSelectionTransform(source, null, selection, moved, false, 'move', null, target)
    useWorkspace.getState().setSelectionPivot({ x: 6.5, y: 5.5 })
    expect(useWorkspace.getState().sessions[0].pendingPaste?.beforeSelectionPivot).toEqual(pivot)

    useWorkspace.getState().cancelFloatingPaste()
    expect(useWorkspace.getState().sessions[0].selection).toEqual(selection)
    expect(useWorkspace.getState().sessions[0].selectionPivot).toEqual(pivot)
  })

  it('returns to the derived center when the selection is replaced', () => {
    const document = createDocument('selection pivot reset', 8, 8, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().setSelection({ x: 1, y: 1, width: 2, height: 2 })
    useWorkspace.getState().setSelectionPivot({ x: 0, y: 0 })

    useWorkspace.getState().setSelection({ x: 4, y: 4, width: 2, height: 2 })

    expect(useWorkspace.getState().sessions[0].selectionPivot).toBeNull()
  })

  it('keeps pivot visibility in view state without dirtying the document or history', () => {
    const document = createDocument('selection pivot visibility', 8, 8, 'rgba')
    useWorkspace.getState().addSession(document)
    const session = useWorkspace.getState().sessions[0]
    const canUndo = session.history.canUndo

    expect(session.view.showSelectionPivot).toBe(false)
    useWorkspace.getState().setView({ showSelectionPivot: true })

    expect(session.view.showSelectionPivot).toBe(true)
    expect(session.history.canUndo).toBe(canUndo)
    expect(document.dirty).toBe(false)
  })
})
