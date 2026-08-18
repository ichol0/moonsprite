import { describe, expect, it } from 'vitest'
import { animationFrameStepDirection, resolveCopyCommand, resolveDeleteCommand, shouldHandleAnimationPlaybackShortcut, shouldHandleGlobalSelectionEnter, shouldTriggerDeleteCommand } from './command-context'

describe('command context', () => {
  it('routes Delete to the last active editor surface', () => {
    expect(resolveDeleteCommand('canvas', true)).toBe('selection')
    expect(resolveDeleteCommand('layers', true)).toBe('layers')
    expect(resolveDeleteCommand('palette', true)).toBe('palette')
    expect(resolveDeleteCommand('tileset', true)).toBe('tileset')
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
    expect(resolveCopyCommand('tileset', true)).toBeNull()
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

  it('keeps arrow frame stepping selection-safe while reserving comma and period for explicit frame navigation', () => {
    const base = { hasSelection: false, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }
    expect(animationFrameStepDirection({ ...base, key: 'ArrowLeft' })).toBe(-1)
    expect(animationFrameStepDirection({ ...base, key: 'ArrowRight' })).toBe(1)
    expect(animationFrameStepDirection({ ...base, key: 'ArrowLeft', hasSelection: true })).toBeNull()
    expect(animationFrameStepDirection({ ...base, key: ',', hasSelection: true })).toBe(-1)
    expect(animationFrameStepDirection({ ...base, key: '.', hasSelection: true })).toBe(1)
    expect(animationFrameStepDirection({ ...base, key: '<', hasSelection: true, shiftKey: true })).toBeNull()
    expect(animationFrameStepDirection({ ...base, key: '.', ctrlKey: true })).toBeNull()
  })
})
