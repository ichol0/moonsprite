import { describe, expect, it } from 'vitest'
import { resolveCopyCommand, resolveDeleteCommand, shouldHandleAnimationPlaybackShortcut, shouldHandleGlobalSelectionEnter, shouldTriggerDeleteCommand } from './command-context'

describe('command context', () => {
  it('routes Delete to the last active editor surface', () => {
    expect(resolveDeleteCommand('canvas', true)).toBe('selection')
    expect(resolveDeleteCommand('layers', true)).toBe('layers')
    expect(resolveDeleteCommand('palette', true)).toBe('palette')
  })

  it('adds Backspace as an alias without bypassing the configured Delete shortcut', () => {
    expect(shouldTriggerDeleteCommand(true, 'Delete')).toBe(true)
    expect(shouldTriggerDeleteCommand(false, 'Backspace')).toBe(true)
    expect(shouldTriggerDeleteCommand(false, 'Delete')).toBe(false)
    expect(shouldTriggerDeleteCommand(false, 'Enter')).toBe(false)
  })

  it('routes Copy to layers even while a canvas selection remains', () => {
    expect(resolveCopyCommand('layers', true)).toBe('layers')
    expect(resolveCopyCommand('canvas', true)).toBe('selection')
    expect(resolveCopyCommand('palette', true)).toBeNull()
  })

  it('gives an open outline dialog exclusive ownership of Enter', () => {
    expect(shouldHandleGlobalSelectionEnter(true, true)).toBe(false)
    expect(shouldHandleGlobalSelectionEnter(false, true)).toBe(true)
    expect(shouldHandleGlobalSelectionEnter(false, false)).toBe(false)
  })

  it('uses animation playback as an Enter fallback only when no editor surface owns the key', () => {
    const available = {
      defaultPrevented: false,
      repeat: false,
      hasSession: true,
      frameCount: 2,
      homeOpen: false,
      timelineHidden: false,
      hasSelection: false,
      hasTextBoxTransform: false,
      isInteractiveTarget: false,
      hasBlockingSurface: false
    }
    expect(shouldHandleAnimationPlaybackShortcut(available)).toBe(true)
    expect(shouldHandleAnimationPlaybackShortcut({ ...available, hasSelection: true })).toBe(false)
    expect(shouldHandleAnimationPlaybackShortcut({ ...available, hasTextBoxTransform: true })).toBe(false)
    expect(shouldHandleAnimationPlaybackShortcut({ ...available, isInteractiveTarget: true })).toBe(false)
    expect(shouldHandleAnimationPlaybackShortcut({ ...available, hasBlockingSurface: true })).toBe(false)
    expect(shouldHandleAnimationPlaybackShortcut({ ...available, defaultPrevented: true })).toBe(false)
  })
})
