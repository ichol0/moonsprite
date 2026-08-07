import { useEffect } from 'react'
import { ensureAnimationDocument, nextAnimationFrameId } from '@/core/animation'
import { useWorkspace } from '@/store/workspace'

/** Owns the single animation timer shared by the canvas, layer panel, and preview panel. */
export const useAnimationPlaybackClock = (documentId: string): void => {
  const playbackKey = useWorkspace((state) => {
    const session = state.sessions.find((item) => item.document.id === documentId)
    if (!session?.animationPlaying) return `${documentId}:idle`
    const timeline = ensureAnimationDocument(session.document)
    const frame = timeline.frames.find((candidate) => candidate.id === timeline.activeFrameId)
    return `${documentId}:${frame?.id ?? ''}:${frame?.duration ?? 0}:${session.animationPlaybackRate}:${timeline.loop ? 1 : 0}`
  })

  useEffect(() => {
    const state = useWorkspace.getState()
    const session = state.sessions.find((item) => item.document.id === documentId)
    if (!session?.animationPlaying) return
    const timeline = ensureAnimationDocument(session.document)
    const activeFrame = timeline.frames.find((frame) => frame.id === timeline.activeFrameId)
    if (!activeFrame) return
    const activeFrameId = activeFrame.id
    const nextFrameId = nextAnimationFrameId(timeline, activeFrameId)
    const timer = window.setTimeout(() => {
      const currentState = useWorkspace.getState()
      const current = currentState.sessions.find((item) => item.document.id === documentId)
      if (!current?.animationPlaying || current.document.animation?.activeFrameId !== activeFrameId) return
      if (!timeline.loop && nextFrameId === activeFrameId) currentState.setAnimationPlaying(false, true)
      else currentState.advanceAnimationFrame()
    }, activeFrame.duration / Math.max(0.01, session.animationPlaybackRate || 1))
    return () => window.clearTimeout(timer)
  }, [documentId, playbackKey])
}
