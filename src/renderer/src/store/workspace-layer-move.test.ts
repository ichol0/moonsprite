import { beforeEach, describe, expect, it } from 'vitest'
import { createDocument } from '@/core/document'
import { useWorkspace, type LayerMoveState } from './workspace'

beforeEach(() => {
  localStorage.clear()
  useWorkspace.setState({ sessions: [], activeId: null, message: null, saveProgress: null, dialog: null })
})

const baseMove = (documentId: string): LayerMoveState => {
  const session = useWorkspace.getState().sessions.find((candidate) => candidate.document.id === documentId)!
  const layer = session.document.layers[0]
  return {
    layerId: layer.id,
    layerOffset: { x: layer.offsetX, y: layer.offsetY },
    layerIds: [layer.id],
    layerOffsets: { [layer.id]: { x: layer.offsetX, y: layer.offsetY } },
    layerPreviewOffset: { x: 0, y: 0 },
    originalSelectedLayerIds: [layer.id],
    selectionStart: null
  }
}

describe('store-owned layer move transactions', () => {
  it('commits static layer offsets as one undoable operation', () => {
    const document = createDocument('move layer', 8, 8, 'rgba')
    useWorkspace.getState().addSession(document)
    const move = baseMove(document.id)
    move.layerPreviewOffset = { x: 3, y: 4 }

    expect(useWorkspace.getState().previewLayerMove(document.id, move, 3, 4)).toBe(true)
    expect(document.layers[0].offsetX).toBe(3)
    expect(document.layers[0].offsetY).toBe(4)

    useWorkspace.getState().commitLayerMove(document.id, move)
    expect(useWorkspace.getState().sessions[0].history.canUndo).toBe(true)

    useWorkspace.getState().undo()
    expect(document.layers[0].offsetX).toBe(0)
    expect(document.layers[0].offsetY).toBe(0)

    useWorkspace.getState().redo()
    expect(document.layers[0].offsetX).toBe(3)
    expect(document.layers[0].offsetY).toBe(4)
  })

  it('cancels a duplicate preview without dirtying or leaving animation cels', () => {
    const document = createDocument('cancel duplicate', 8, 8, 'rgba')
    useWorkspace.getState().addSession(document)
    const move = baseMove(document.id)
    const duplicate = useWorkspace.getState().beginLayerMoveDuplicatePreview(document.id, move.layerId!, 'Copy')!
    Object.assign(move, {
      duplicatedLayerId: duplicate.layerId,
      duplicatedLayer: duplicate.layer,
      duplicatedAnimationCels: duplicate.animationCels,
      duplicatedLayerIndex: duplicate.insertionIndex,
      layerPreviewOffset: { x: 2, y: 1 }
    })

    useWorkspace.getState().previewLayerMove(document.id, move, 2, 1)
    expect(document.layers).toHaveLength(2)

    useWorkspace.getState().cancelLayerMovePreview(document.id, move)

    expect(document.layers).toHaveLength(1)
    expect(document.activeLayerId).toBe(move.layerId)
    expect(document.animation?.cels.some((cel) => cel.layerId === duplicate.layerId)).toBe(false)
    expect(document.dirty).toBe(false)
    expect(useWorkspace.getState().sessions[0].history.canUndo).toBe(false)
  })

  it('restores a committed duplicate through undo and redo', () => {
    const document = createDocument('commit duplicate', 8, 8, 'rgba')
    useWorkspace.getState().addSession(document)
    const move = baseMove(document.id)
    const duplicate = useWorkspace.getState().beginLayerMoveDuplicatePreview(document.id, move.layerId!, 'Copy')!
    Object.assign(move, {
      duplicatedLayerId: duplicate.layerId,
      duplicatedLayer: duplicate.layer,
      duplicatedAnimationCels: duplicate.animationCels,
      duplicatedLayerIndex: duplicate.insertionIndex,
      layerPreviewOffset: { x: 5, y: 2 }
    })
    useWorkspace.getState().previewLayerMove(document.id, move, 5, 2)

    useWorkspace.getState().commitLayerMove(document.id, move)
    expect(document.layers).toHaveLength(2)
    expect(duplicate.layer.offsetX).toBe(5)

    useWorkspace.getState().undo()
    expect(document.layers).toHaveLength(1)

    useWorkspace.getState().redo()
    expect(document.layers).toHaveLength(2)
    expect(document.layers.find((layer) => layer.id === duplicate.layerId)?.offsetX).toBe(5)
    expect(document.activeLayerId).toBe(duplicate.layerId)
  })
})
