import { beforeEach, describe, expect, it } from 'vitest'
import { animationCelAt, ensureAnimationDocument } from '@/core/animation'
import { createDocument, createLayer, getActiveLayer, readLayerPacked } from '@/core/document'
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

  it('exposes chronological history and jumps to a selected state through undo and redo', () => {
    const document = createDocument('history navigation', 1, 1, 'rgba')
    const layer = getActiveLayer(document)
    useWorkspace.getState().addSession(document)
    const colors = [0xff0000ff, 0xff00ff00, 0xffff0000]

    colors.forEach((color, index) => {
      const edit = beginPixelEdit(layer.id)
      recordPixel(document, layer, edit, 0, color)
      useWorkspace.getState().commitPixelEdit(edit, `edit ${index + 1}`)
    })

    let session = useWorkspace.getState().sessions[0]
    expect(session.history.timeline).toEqual({
      position: 3,
      entries: [
        { label: 'edit 1', position: 1 },
        { label: 'edit 2', position: 2 },
        { label: 'edit 3', position: 3 }
      ]
    })

    session.view.panX = 37
    useWorkspace.getState().setHistoryPosition(1)
    session = useWorkspace.getState().sessions[0]
    expect(readLayerPacked(document, layer, 0) >>> 0).toBe(colors[0])
    expect(session.history.timeline.position).toBe(1)
    expect(session.view.panX).toBe(37)

    useWorkspace.getState().setHistoryPosition(3)
    expect(readLayerPacked(document, layer, 0) >>> 0).toBe(colors[2])
    expect(useWorkspace.getState().sessions[0].history.timeline.position).toBe(3)

    useWorkspace.getState().setHistoryPosition(1)
    const branch = beginPixelEdit(layer.id)
    recordPixel(document, layer, branch, 0, 0xffffffff)
    useWorkspace.getState().commitPixelEdit(branch, 'branch edit')
    expect(useWorkspace.getState().sessions[0].history.timeline).toEqual({
      position: 2,
      entries: [
        { label: 'edit 1', position: 1 },
        { label: 'branch edit', position: 2 }
      ]
    })
  })
})
