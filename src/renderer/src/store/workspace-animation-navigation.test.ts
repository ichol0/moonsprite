import { beforeEach, describe, expect, it } from 'vitest'
import { createDocument } from '@/core/document'
import { ensureAnimationDocument } from '@/core/animation'
import { useWorkspace } from './workspace'

beforeEach(() => {
  localStorage.clear()
  useWorkspace.setState({ sessions: [], activeId: null, message: null, saveProgress: null, dialog: null })
})

describe('workspace animation navigation', () => {
  it('wraps keyboard frame stepping at both ends without entering history', () => {
    const document = createDocument('frame navigation', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    useWorkspace.getState().duplicateAnimationFrame()
    const timeline = ensureAnimationDocument(document)
    const [first, , last] = timeline.frames
    const session = useWorkspace.getState().sessions[0]
    session.history.clear()

    useWorkspace.getState().setActiveAnimationFrame(first.id)
    useWorkspace.getState().stepAnimationFrame(-1)
    expect(timeline.activeFrameId).toBe(last.id)

    useWorkspace.getState().stepAnimationFrame(1)
    expect(timeline.activeFrameId).toBe(first.id)
    expect(session.history.canUndo).toBe(false)
  })

  it('pauses keyboard navigation on the current frame before stepping', () => {
    const document = createDocument('frame navigation pause', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    useWorkspace.getState().duplicateAnimationFrame()
    const [first, second, third] = ensureAnimationDocument(document).frames
    const session = useWorkspace.getState().sessions[0]

    useWorkspace.getState().setAnimationLoop(true)
    useWorkspace.getState().setAnimationReturnToStart(true)
    useWorkspace.getState().selectAnimationFrame(first.id)
    useWorkspace.getState().selectAnimationFrame(third.id, 'toggle')
    useWorkspace.getState().setActiveAnimationFrame(first.id)
    document.dirty = false
    useWorkspace.getState().setAnimationPlaying(true)
    useWorkspace.getState().advanceAnimationFrame()
    expect(document.animation?.activeFrameId).toBe(second.id)

    useWorkspace.getState().pauseAnimationAtCurrentFrame()

    expect(document.animation?.activeFrameId).toBe(second.id)
    expect(session).toMatchObject({
      animationPlaying: false,
      animationPlaybackStartFrameId: null,
      animationPlaybackLoopSectionId: null,
      animationPlaybackLoopIteration: 0,
      selectedAnimationFrameIds: [second.id],
      animationFrameSelectionAnchorId: second.id,
      selectedAnimationCellKeys: [],
      selectedAnimationMaskCellKeys: []
    })
    expect(document.dirty).toBe(false)
  })
})
