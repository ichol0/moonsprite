import { describe, expect, it } from 'vitest'
import { animationFrameStepDirection, hasAnimationDeleteSelection, resolveCopyCommand, resolveDeleteCommand, shouldHandleAnimationPlaybackShortcut, shouldHandleGlobalSelectionEnter, shouldTriggerDeleteCommand } from './command-context'

describe('command context', () => {
  it('routes Delete to the last active editor surface', () => {
    expect(resolveDeleteCommand('canvas', true)).toBe('selection')
    expect(resolveDeleteCommand('layers', true)).toBe('layers')
    expect(resolveDeleteCommand('palette', true)).toBe('palette')
    expect(resolveDeleteCommand('tileset', true)).toBe('tileset')
    expect(resolveDeleteCommand('brushes', true)).toBe('brushes')
  })

  it('routes Delete to a timeline selection before the selected layer', () => {
    expect(resolveDeleteCommand('layers', false, true)).toBe('animation')
    expect(resolveDeleteCommand('layers', true, true)).toBe('animation')
    expect(resolveDeleteCommand('canvas', true, true)).toBe('selection')
    expect(resolveDeleteCommand('palette', false, true)).toBe('palette')
  })

  it('does not treat layer-derived cell highlights as a timeline delete selection', () => {
    const implicitCells = hasAnimationDeleteSelection({
      selectedFrameCount: 0,
      selectedCellCount: 2,
      selectedMaskCellCount: 0,
      cellSelectionExplicit: false
    })
    const explicitCells = hasAnimationDeleteSelection({
      selectedFrameCount: 0,
      selectedCellCount: 2,
      selectedMaskCellCount: 0,
      cellSelectionExplicit: true
    })

    expect(implicitCells).toBe(false)
    expect(explicitCells).toBe(true)
    expect(resolveDeleteCommand('layers', false, implicitCells)).toBe('layers')
    expect(resolveDeleteCommand('layers', false, explicitCells)).toBe('animation')
  })

  it('requires multiple explicitly selected cels while preserving frame and mask deletion', () => {
    expect(hasAnimationDeleteSelection({ selectedFrameCount: 0, selectedCellCount: 1, selectedMaskCellCount: 0, cellSelectionExplicit: true })).toBe(false)
    expect(hasAnimationDeleteSelection({ selectedFrameCount: 1, selectedCellCount: 0, selectedMaskCellCount: 0, cellSelectionExplicit: false })).toBe(true)
    expect(hasAnimationDeleteSelection({ selectedFrameCount: 0, selectedCellCount: 0, selectedMaskCellCount: 1, cellSelectionExplicit: false })).toBe(true)
  })

  it('routes Delete to the selected Free Tile instance without overriding a canvas selection', () => {
    expect(resolveDeleteCommand('layers', false, false, true)).toBe('free-tile-instance')
    expect(resolveDeleteCommand('layers', false, true, true)).toBe('free-tile-instance')
    expect(resolveDeleteCommand('canvas', false, false, true)).toBe('free-tile-instance')
    expect(resolveDeleteCommand('canvas', true, false, true)).toBe('selection')
    expect(resolveDeleteCommand('palette', false, false, true)).toBe('palette')
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
    expect(resolveCopyCommand('brushes', true)).toBeNull()
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
