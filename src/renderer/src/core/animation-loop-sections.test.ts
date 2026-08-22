import { describe, expect, it } from 'vitest'
import type { AnimationFrame, AnimationLoopSection } from '@shared/types'
import {
  advanceAnimationLoopSectionPlayback,
  animationLoopSectionAtFrame,
  animationLoopSectionStartFrameId,
  normalizeAnimationLoopSections,
  reconcileAnimationLoopSectionsAfterFrameDeletion,
  reconcileAnimationLoopSectionsAfterFrameInsertion,
  resolveAnimationLoopSectionRange
} from './animation-loop-sections'

const frames: AnimationFrame[] = [
  { id: 'frame-a', duration: 100 },
  { id: 'frame-b', duration: 100 },
  { id: 'frame-c', duration: 100 },
  { id: 'frame-d', duration: 100 }
]

const section = (changes: Partial<AnimationLoopSection> = {}): AnimationLoopSection => ({
  id: 'loop-1',
  name: 'Walk',
  startFrameId: 'frame-b',
  endFrameId: 'frame-d',
  direction: 'forward',
  repeatCount: 2,
  ...changes
})

describe('animation loop sections', () => {
  it('normalizes ranges, names, directions, repeat counts, and duplicate ids', () => {
    expect(normalizeAnimationLoopSections([
      section({ name: '  Walk  ', startFrameId: 'frame-d', endFrameId: 'frame-b', repeatCount: 20_000 }),
      section({ name: 'Duplicate' }),
      section({ id: 'loop-2', name: '', direction: 'reverse', repeatCount: 0 }),
      section({ id: 'missing', startFrameId: 'unknown' })
    ], frames)).toEqual([
      section({ name: 'Walk', startFrameId: 'frame-b', endFrameId: 'frame-d', repeatCount: 9_999 }),
      section({ id: 'loop-2', name: 'Loop 2', direction: 'reverse', repeatCount: 1 })
    ])
  })

  it('plays finite forward ranges for the configured number of passes', () => {
    const target = section({ startFrameId: 'frame-b', endFrameId: 'frame-c', repeatCount: 2 })
    expect(animationLoopSectionStartFrameId({ frames }, target)).toBe('frame-b')
    expect(advanceAnimationLoopSectionPlayback({ frames }, target, 'frame-b', 0)).toEqual({ frameId: 'frame-c', completedIterations: 0, completed: false })
    expect(advanceAnimationLoopSectionPlayback({ frames }, target, 'frame-c', 0)).toEqual({ frameId: 'frame-b', completedIterations: 1, completed: false })
    expect(advanceAnimationLoopSectionPlayback({ frames }, target, 'frame-b', 1)).toEqual({ frameId: 'frame-c', completedIterations: 1, completed: false })
    expect(advanceAnimationLoopSectionPlayback({ frames }, target, 'frame-c', 1)).toEqual({ frameId: 'frame-c', completedIterations: 2, completed: true })
  })

  it('plays reverse ranges indefinitely and restarts from the range end', () => {
    const target = section({ direction: 'reverse', repeatCount: null })
    expect(animationLoopSectionStartFrameId({ frames }, target)).toBe('frame-d')
    expect(advanceAnimationLoopSectionPlayback({ frames }, target, 'frame-d', 0)).toEqual({ frameId: 'frame-c', completedIterations: 0, completed: false })
    expect(advanceAnimationLoopSectionPlayback({ frames }, target, 'frame-c', 0)).toEqual({ frameId: 'frame-b', completedIterations: 0, completed: false })
    expect(advanceAnimationLoopSectionPlayback({ frames }, target, 'frame-b', 0)).toEqual({ frameId: 'frame-d', completedIterations: 1, completed: false })
  })

  it('resolves the innermost loop section containing the active frame', () => {
    const outer = section({ id: 'outer', name: 'Outer', startFrameId: 'frame-a', endFrameId: 'frame-d' })
    const inner = section({ id: 'inner', name: 'Inner', startFrameId: 'frame-b', endFrameId: 'frame-c' })
    const timeline = { frames, loopSections: [outer, inner] }

    expect(animationLoopSectionAtFrame(timeline, 'frame-b')).toBe(inner)
    expect(animationLoopSectionAtFrame(timeline, 'frame-d')).toBe(outer)
    expect(animationLoopSectionAtFrame(timeline, 'missing')).toBeNull()
  })

  it('keeps stable endpoints through reordering and shrinks or removes ranges after deletion', () => {
    const target = section({ startFrameId: 'frame-a', endFrameId: 'frame-d' })
    const reordered = [...frames].reverse()
    expect(resolveAnimationLoopSectionRange({ frames: reordered }, target)).toMatchObject({ startIndex: 0, endIndex: 3, startFrameId: 'frame-d', endFrameId: 'frame-a' })

    const withoutStart = frames.slice(1)
    expect(reconcileAnimationLoopSectionsAfterFrameDeletion([target], frames, withoutStart, 'frame-a')).toEqual([
      section({ startFrameId: 'frame-b', endFrameId: 'frame-d' })
    ])
    expect(reconcileAnimationLoopSectionsAfterFrameDeletion([
      section({ startFrameId: 'frame-c', endFrameId: 'frame-c' })
    ], frames, frames.filter((frame) => frame.id !== 'frame-c'), 'frame-c')).toEqual([])
  })

  it('extends every loop section whose right edge receives a new frame', () => {
    const insertedFrameId = 'frame-new'
    expect(reconcileAnimationLoopSectionsAfterFrameInsertion([
      section({ id: 'ending', startFrameId: 'frame-a', endFrameId: 'frame-b' }),
      section({ id: 'containing', startFrameId: 'frame-a', endFrameId: 'frame-d' }),
      section({ id: 'reversed', startFrameId: 'frame-b', endFrameId: 'frame-a' })
    ], frames, 'frame-b', insertedFrameId)).toEqual([
      section({ id: 'ending', startFrameId: 'frame-a', endFrameId: insertedFrameId }),
      section({ id: 'containing', startFrameId: 'frame-a', endFrameId: 'frame-d' }),
      section({ id: 'reversed', startFrameId: insertedFrameId, endFrameId: 'frame-a' })
    ])
  })
})
