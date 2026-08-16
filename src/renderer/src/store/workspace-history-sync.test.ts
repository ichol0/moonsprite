import { beforeEach, describe, expect, it } from 'vitest'
import { animationCelAt, ensureAnimationDocument } from '@/core/animation'
import { createDocument, createLayer, getActiveLayer } from '@/core/document'
import { beginPixelEdit, recordPixel } from '@/core/history'
import { useWorkspace } from './workspace'

beforeEach(() => {
  localStorage.clear()
  useWorkspace.setState({ sessions: [], activeId: null, message: null, saveProgress: null, dialog: null })
})

describe('targeted pixel history synchronization', () => {
  it('undoes and redoes deselection without invalidating document content', () => {
    const document = createDocument('selection history', 4, 3, 'rgba')
    useWorkspace.getState().addSession(document)
    const selection = { x: 0, y: 0, width: 4, height: 3, mask: Uint8Array.from([1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1]) }
    useWorkspace.getState().setSelection(selection)
    const before = useWorkspace.getState().sessions[0]
    const mask = before.selection?.mask
    const revision = before.revision
    const contentRevision = before.contentRevision
    document.dirty = false

    useWorkspace.getState().commitSelectionChange(before.selection, null, 'deselect')
    useWorkspace.getState().undo()
    let session = useWorkspace.getState().sessions[0]
    expect(session.selection).toEqual(selection)
    expect(session.selection?.mask).toBe(mask)
    expect(session.revision).toBe(revision)
    expect(session.contentRevision).toBe(contentRevision)
    expect(document.dirty).toBe(false)

    useWorkspace.getState().redo()
    session = useWorkspace.getState().sessions[0]
    expect(session.selection).toBeNull()
    expect(session.revision).toBe(revision)
    expect(session.contentRevision).toBe(contentRevision)
    expect(document.dirty).toBe(false)
  })

  it('keeps unrelated animation cel surfaces untouched during undo and redo', () => {
    const document = createDocument('targeted pixel history sync', 2, 1, 'rgba')
    const editedLayer = getActiveLayer(document)
    const unrelatedLayer = createLayer('Unrelated', 2, 1, 'rgba')
    document.layers.push(unrelatedLayer)
    const timeline = ensureAnimationDocument(document)
    useWorkspace.getState().addSession(document)
    const unrelatedCel = animationCelAt(timeline, unrelatedLayer.id, timeline.activeFrameId)!
    const unrelatedSurface = unrelatedCel.surface!
    const edit = beginPixelEdit(editedLayer.id)
    recordPixel(document, editedLayer, edit, 0, 0xff0000ff)

    useWorkspace.getState().commitPixelEdit(edit, 'paint')
    useWorkspace.getState().undo()
    expect(unrelatedCel.surface).toBe(unrelatedSurface)

    useWorkspace.getState().redo()
    expect(unrelatedCel.surface).toBe(unrelatedSurface)
  })

  it('does not invalidate canvas content when only a layer lock changes', () => {
    const document = createDocument('metadata history', 2, 1, 'rgba')
    const layer = getActiveLayer(document)
    useWorkspace.getState().addSession(document)
    const beforeContentRevision = useWorkspace.getState().sessions[0].contentRevision

    useWorkspace.getState().setLayerPropertiesWithBlend(layer.id, layer.name, layer.opacity, layer.blendMode, true, layer.displayColor, layer.description)
    let session = useWorkspace.getState().sessions[0]
    expect(layer.locked).toBe(true)
    expect(session.contentRevision).toBe(beforeContentRevision)
    expect(session.document.dirty).toBe(true)

    useWorkspace.getState().undo()
    session = useWorkspace.getState().sessions[0]
    expect(layer.locked).toBe(false)
    expect(session.contentRevision).toBe(beforeContentRevision)
  })
})
