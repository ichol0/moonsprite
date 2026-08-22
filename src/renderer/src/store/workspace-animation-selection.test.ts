import { beforeEach, describe, expect, it } from 'vitest'
import { animationCelKey, ensureAnimationDocument } from '@/core/animation'
import { createDocument, createLayer } from '@/core/document'
import { useWorkspace } from './workspace'

beforeEach(() => {
  localStorage.clear()
  useWorkspace.setState({ sessions: [], activeId: null, message: null, saveProgress: null, dialog: null })
})

describe('animation cell selection source', () => {
  it('marks current-frame cells derived from a layer range as implicit', () => {
    const document = createDocument('implicit layer cells', 2, 2, 'rgba')
    const bottom = document.layers[0]
    const middle = createLayer('Middle', 2, 2, 'rgba')
    const top = createLayer('Top', 2, 2, 'rgba')
    document.layers.push(middle, top)
    useWorkspace.getState().addSession(document)
    const frameId = ensureAnimationDocument(document).activeFrameId

    useWorkspace.getState().selectLayer(top.id)
    useWorkspace.getState().selectLayer(bottom.id, 'range')

    const session = useWorkspace.getState().sessions[0]
    expect(session.selectedAnimationCellKeys).toEqual([
      animationCelKey(top.id, frameId),
      animationCelKey(middle.id, frameId),
      animationCelKey(bottom.id, frameId)
    ])
    expect(session.animationCellSelectionExplicit).toBe(false)
  })

  it('marks cells selected directly on the timeline as explicit', () => {
    const document = createDocument('explicit timeline cells', 2, 2, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    const keys = ensureAnimationDocument(document).frames.map((frame) => animationCelKey(document.activeLayerId, frame.id))

    useWorkspace.getState().selectAnimationCell(keys[0])
    useWorkspace.getState().selectAnimationCell(keys[1], 'toggle')

    const session = useWorkspace.getState().sessions[0]
    expect(session.selectedAnimationCellKeys).toEqual(keys)
    expect(session.animationCellSelectionExplicit).toBe(true)
  })
})
