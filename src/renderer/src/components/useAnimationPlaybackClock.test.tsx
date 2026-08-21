import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDocument } from '@/core/document'
import { useWorkspace } from '@/store/workspace'
import { useAnimationPlaybackClock } from './useAnimationPlaybackClock'

function PlaybackClock({ documentId }: { documentId: string }) {
  useAnimationPlaybackClock(documentId)
  return null
}

beforeEach(() => {
  vi.useFakeTimers()
  useWorkspace.setState({ sessions: [], activeId: null, message: null, dialog: null })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useAnimationPlaybackClock', () => {
  it('plays every frame once and returns to the first frame after completion', () => {
    const document = createDocument('playback clock', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    useWorkspace.getState().duplicateAnimationFrame()
    const [firstFrame, secondFrame, thirdFrame] = document.animation!.frames
    useWorkspace.getState().setAnimationLoop(false)
    useWorkspace.getState().setAnimationReturnToStart(false)
    useWorkspace.getState().setActiveAnimationFrame(thirdFrame.id)
    useWorkspace.getState().setAnimationPlaying(true)
    render(<PlaybackClock documentId={document.id} />)

    expect(document.animation?.activeFrameId).toBe(firstFrame.id)
    act(() => vi.advanceTimersByTime(100))
    expect(document.animation?.activeFrameId).toBe(secondFrame.id)
    act(() => vi.advanceTimersByTime(100))
    expect(document.animation?.activeFrameId).toBe(thirdFrame.id)
    act(() => vi.advanceTimersByTime(100))
    expect(document.animation?.activeFrameId).toBe(firstFrame.id)
    expect(useWorkspace.getState().sessions[0].animationPlaying).toBe(false)
  })

  it('does not rewind when one-shot playback is paused manually', () => {
    const document = createDocument('manual pause', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    const [, secondFrame] = document.animation!.frames
    useWorkspace.getState().setAnimationLoop(false)
    useWorkspace.getState().setAnimationPlaying(true)
    render(<PlaybackClock documentId={document.id} />)

    act(() => vi.advanceTimersByTime(100))
    expect(document.animation?.activeFrameId).toBe(secondFrame.id)
    act(() => useWorkspace.getState().setAnimationPlaying(false))
    expect(document.animation?.activeFrameId).toBe(secondFrame.id)
  })

  it('stops a finite loop section after its last frame has displayed for its duration', () => {
    const document = createDocument('loop section clock', 1, 1, 'rgba')
    useWorkspace.getState().addSession(document)
    useWorkspace.getState().duplicateAnimationFrame()
    useWorkspace.getState().duplicateAnimationFrame()
    const [, secondFrame, thirdFrame] = document.animation!.frames
    const loopId = useWorkspace.getState().createAnimationLoopSection({
      name: 'Impact',
      startFrameId: secondFrame.id,
      endFrameId: thirdFrame.id,
      direction: 'forward',
      repeatCount: 1
    })!
    useWorkspace.getState().playAnimationLoopSection(loopId)
    render(<PlaybackClock documentId={document.id} />)

    expect(document.animation?.activeFrameId).toBe(secondFrame.id)
    act(() => vi.advanceTimersByTime(100))
    expect(document.animation?.activeFrameId).toBe(thirdFrame.id)
    expect(useWorkspace.getState().sessions[0].animationPlaying).toBe(true)
    act(() => vi.advanceTimersByTime(100))
    expect(document.animation?.activeFrameId).toBe(thirdFrame.id)
    expect(useWorkspace.getState().sessions[0]).toMatchObject({ animationPlaying: false, animationPlaybackLoopSectionId: null })
  })
})
