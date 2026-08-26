import { describe, expect, it } from 'vitest'
import { cloneShortcutBindings, DEFAULT_SHORTCUT_BINDINGS } from './shortcuts'
import { applyQuickToolTarget, resolveHeldQuickTool, type QuickToolSessionState } from './quick-tools'

const session: QuickToolSessionState = {
  tool: 'fill',
  moveKind: 'slice',
  selectionKind: 'magic',
  shapeKind: 'ellipse',
  lineKind: 'curve',
  fillKind: 'gradient'
}

describe('quick tools', () => {
  it('provides the Aseprite-style default held tools', () => {
    expect(resolveHeldQuickTool(DEFAULT_SHORTCUT_BINDINGS, new Set(['Ctrl']))?.id).toBe('tool.move.quick')
    expect(resolveHeldQuickTool(DEFAULT_SHORTCUT_BINDINGS, new Set(['Alt']))?.id).toBe('tool.eyedropper.quick')
    expect(resolveHeldQuickTool(DEFAULT_SHORTCUT_BINDINGS, new Set(['Space']))?.id).toBe('tool.hand.quick')
  })

  it('prefers the most specific held chord and falls back as keys are released', () => {
    const shortcuts = cloneShortcutBindings(DEFAULT_SHORTCUT_BINDINGS)
    shortcuts['tool.pencil.quick'] = ['Ctrl+Shift+X']
    const held = new Set(['Ctrl', 'Shift', 'X'])

    expect(resolveHeldQuickTool(shortcuts, held)?.id).toBe('tool.pencil.quick')
    held.delete('X')
    expect(resolveHeldQuickTool(shortcuts, held)?.id).toBe('tool.move.quick')
  })

  it('applies tool variants without mutating the selected tool state', () => {
    const quick = applyQuickToolTarget(session, { tool: 'selection', selectionKind: 'ellipse' })

    expect(quick).toMatchObject({ tool: 'selection', selectionKind: 'ellipse', fillKind: 'gradient' })
    expect(session).toMatchObject({ tool: 'fill', selectionKind: 'magic', fillKind: 'gradient' })
  })
})
