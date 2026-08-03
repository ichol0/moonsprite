import { describe, expect, it } from 'vitest'
import { resolveCopyCommand, resolveDeleteCommand, shouldHandleGlobalSelectionEnter, shouldTriggerDeleteCommand } from './command-context'

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
})
