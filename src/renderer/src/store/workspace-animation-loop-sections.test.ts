import { beforeEach, describe, expect, it } from 'vitest'
import { ensureAnimationDocument } from '@/core/animation'
import { createDocument } from '@/core/document'
import { useWorkspace } from './workspace'

beforeEach(() => {
  localStorage.clear()
  useWorkspace.setState({ sessions: [], activeId: null, message: null, dialog: null })
})

describe('workspace animation loop sections', () => {
  it.each([
    ['blank frame', 'addAnimationFrame'],
    ['duplicated frame', 'duplicateAnimationFrame'],
    ['linked frame', 'addLinkedAnimationFrame']
  ] as const)('keeps a %s created at the loop end inside the loop through undo and redo', (_label, command) => {
    const document = createDocument('loop section frame creation', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    useWorkspace.getState().duplicateAnimationFrame()
    const timeline = ensureAnimationDocument(document)
    const [, secondFrame, thirdFrame] = timeline.frames
    const loopId = useWorkspace.getState().createAnimationLoopSection({
      name: 'Create inside',
      startFrameId: secondFrame.id,
      endFrameId: thirdFrame.id,
      direction: 'forward',
      repeatCount: null
    })!
    const session = useWorkspace.getState().sessions[0]
    session.history.clear()
    useWorkspace.getState().setActiveAnimationFrame(thirdFrame.id)

    useWorkspace.getState()[command]()

    const insertedFrameId = timeline.activeFrameId
    expect(timeline.loopSections?.find((section) => section.id === loopId)).toMatchObject({
      startFrameId: secondFrame.id,
      endFrameId: insertedFrameId
    })

    useWorkspace.getState().undo()
    expect(timeline.frames.some((frame) => frame.id === insertedFrameId)).toBe(false)
    expect(timeline.loopSections?.find((section) => section.id === loopId)).toMatchObject({
      startFrameId: secondFrame.id,
      endFrameId: thirdFrame.id
    })

    useWorkspace.getState().redo()
    expect(timeline.frames.some((frame) => frame.id === insertedFrameId)).toBe(true)
    expect(timeline.loopSections?.find((section) => section.id === loopId)).toMatchObject({
      startFrameId: secondFrame.id,
      endFrameId: insertedFrameId
    })
  })

  it('creates, edits, restores, and independently plays a named loop section', () => {
    const document = createDocument('animation loop section', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    useWorkspace.getState().duplicateAnimationFrame()
    const [firstFrame, secondFrame, thirdFrame] = ensureAnimationDocument(document).frames
    document.dirty = false

    const loopId = useWorkspace.getState().createAnimationLoopSection({
      name: 'Run',
      startFrameId: secondFrame.id,
      endFrameId: thirdFrame.id,
      direction: 'forward',
      repeatCount: 1
    })!

    expect(ensureAnimationDocument(document).loopSections).toEqual([expect.objectContaining({ id: loopId, name: 'Run', direction: 'forward', repeatCount: 1 })])
    expect(document.dirty).toBe(true)
    useWorkspace.getState().undo()
    expect(ensureAnimationDocument(document).loopSections).toEqual([])
    useWorkspace.getState().redo()
    expect(ensureAnimationDocument(document).loopSections).toHaveLength(1)

    useWorkspace.getState().updateAnimationLoopSection(loopId, {
      name: 'Run Backward',
      startFrameId: secondFrame.id,
      endFrameId: thirdFrame.id,
      direction: 'reverse',
      repeatCount: 2
    })
    expect(ensureAnimationDocument(document).loopSections?.[0]).toMatchObject({ name: 'Run Backward', direction: 'reverse', repeatCount: 2 })
    useWorkspace.getState().undo()
    expect(ensureAnimationDocument(document).loopSections?.[0]).toMatchObject({ name: 'Run', direction: 'forward', repeatCount: 1 })
    useWorkspace.getState().redo()

    useWorkspace.getState().deleteAnimationLoopSection(loopId)
    expect(ensureAnimationDocument(document).loopSections).toEqual([])
    useWorkspace.getState().undo()
    expect(ensureAnimationDocument(document).loopSections?.[0]).toMatchObject({ name: 'Run Backward', direction: 'reverse', repeatCount: 2 })

    useWorkspace.getState().setActiveAnimationFrame(firstFrame.id)
    document.dirty = false
    useWorkspace.getState().playAnimationLoopSection(loopId)
    expect(document.animation?.activeFrameId).toBe(thirdFrame.id)
    expect(useWorkspace.getState().sessions[0]).toMatchObject({ animationPlaying: true, animationPlaybackLoopSectionId: loopId, animationPlaybackLoopIteration: 0 })
    useWorkspace.getState().advanceAnimationFrame()
    expect(document.animation?.activeFrameId).toBe(secondFrame.id)
    useWorkspace.getState().advanceAnimationFrame()
    expect(document.animation?.activeFrameId).toBe(thirdFrame.id)
    useWorkspace.getState().advanceAnimationFrame()
    expect(document.animation?.activeFrameId).toBe(secondFrame.id)
    useWorkspace.getState().advanceAnimationFrame()
    expect(useWorkspace.getState().sessions[0]).toMatchObject({ animationPlaying: false, animationPlaybackLoopSectionId: null, animationPlaybackLoopIteration: 0 })
    expect(document.animation?.activeFrameId).toBe(secondFrame.id)
    expect(document.dirty).toBe(false)
  })

  it('repeats the innermost tag at the active frame and loops all frames outside tags', () => {
    const document = createDocument('tag repeat playback', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    for (let index = 0; index < 4; index += 1) useWorkspace.getState().duplicateAnimationFrame()
    const [firstFrame, secondFrame, thirdFrame, fourthFrame, fifthFrame] = ensureAnimationDocument(document).frames
    const outerId = useWorkspace.getState().createAnimationLoopSection({
      name: 'Outer',
      startFrameId: secondFrame.id,
      endFrameId: fourthFrame.id,
      direction: 'forward',
      repeatCount: 1
    })!
    const innerId = useWorkspace.getState().createAnimationLoopSection({
      name: 'Inner',
      startFrameId: secondFrame.id,
      endFrameId: thirdFrame.id,
      direction: 'forward',
      repeatCount: 1
    })!
    document.dirty = false

    useWorkspace.getState().setActiveAnimationFrame(thirdFrame.id)
    useWorkspace.getState().setAnimationPlaybackMode('tag')
    useWorkspace.getState().setAnimationPlaying(true)
    expect(document.animation?.activeFrameId).toBe(secondFrame.id)
    expect(useWorkspace.getState().sessions[0]).toMatchObject({
      animationPlaybackLoopSectionId: innerId,
      animationPlaybackLoopSectionRepeatIndefinitely: true
    })
    useWorkspace.getState().advanceAnimationFrame()
    expect(document.animation?.activeFrameId).toBe(thirdFrame.id)
    useWorkspace.getState().advanceAnimationFrame()
    expect(document.animation?.activeFrameId).toBe(secondFrame.id)
    expect(useWorkspace.getState().sessions[0].animationPlaying).toBe(true)

    useWorkspace.getState().selectAnimationFrame(fourthFrame.id)
    expect(document.animation?.activeFrameId).toBe(fourthFrame.id)
    expect(useWorkspace.getState().sessions[0]).toMatchObject({
      animationPlaying: true,
      animationPlaybackLoopSectionId: outerId,
      animationPlaybackLoopSectionRepeatIndefinitely: true,
      animationPlaybackLoopIteration: 0
    })
    useWorkspace.getState().advanceAnimationFrame()
    expect(document.animation?.activeFrameId).toBe(secondFrame.id)
    expect(useWorkspace.getState().sessions[0].animationPlaying).toBe(true)

    useWorkspace.getState().setAnimationPlaying(false)
    useWorkspace.getState().setActiveAnimationFrame(fifthFrame.id)
    useWorkspace.getState().setAnimationPlaying(true)
    expect(useWorkspace.getState().sessions[0].animationPlaybackLoopSectionId).toBeNull()
    useWorkspace.getState().advanceAnimationFrame()
    expect(document.animation?.activeFrameId).toBe(firstFrame.id)
    expect(useWorkspace.getState().sessions[0].animationPlaying).toBe(true)
    expect(document.dirty).toBe(false)
  })
})
