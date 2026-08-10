import { describe, expect, it } from 'vitest'
import { DEFAULT_SHORTCUTS, GRID_SHORTCUT_MIGRATION_KEY, POLYGON_LASSO_SHORTCUT_MIGRATION_KEY, SHORTCUTS_KEY, SHORTCUT_GROUPS, SHORTCUT_LABELS, deriveShortcutConflicts, loadShortcuts, normalizeShortcut, parseShortcutJson, saveShortcuts, shortcutText } from './shortcuts'

describe('shortcut persistence boundary', () => {
  it('only accepts known shortcut ids and string values', () => {
    expect(parseShortcutJson(JSON.stringify({ save: 'Ctrl+S', unknown: 'X', undo: 12 }))).toEqual({ save: 'Ctrl+S' })
  })

  it('keeps defaults available to callers after a malformed payload', () => {
    expect({ ...DEFAULT_SHORTCUTS, ...parseShortcutJson('{bad') }).toMatchObject({ save: 'Ctrl+S', fillForeground: 'F' })
  })

  it('migrates the old empty polygon-lasso default once without overriding later user changes', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size }
    } as Storage
    values.set(SHORTCUTS_KEY, JSON.stringify({ polygonLasso: '' }))

    expect(loadShortcuts(storage).polygonLasso).toBe('Shift+Q')
    expect(values.get(POLYGON_LASSO_SHORTCUT_MIGRATION_KEY)).toBe('done')
    saveShortcuts({ ...DEFAULT_SHORTCUTS, polygonLasso: '' }, storage)
    expect(loadShortcuts(storage).polygonLasso).toBe('')
  })

  it('migrates the old empty pixel-grid shortcut once without overriding later user changes', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size }
    } as Storage
    values.set(SHORTCUTS_KEY, JSON.stringify({ toggleGrid: '' }))

    expect(loadShortcuts(storage)).toMatchObject({ toggleGrid: "Ctrl+Shift+'", toggleCustomGrid: "Ctrl+'" })
    expect(values.get(GRID_SHORTCUT_MIGRATION_KEY)).toBe('done')
    saveShortcuts({ ...DEFAULT_SHORTCUTS, toggleGrid: '', toggleCustomGrid: '' }, storage)
    expect(loadShortcuts(storage)).toMatchObject({ toggleGrid: '', toggleCustomGrid: '' })
  })

  it('registers every configurable command in one labeled group', () => {
    const grouped = new Set(Object.values(SHORTCUT_GROUPS).flat())
    expect(grouped).toEqual(new Set(Object.keys(DEFAULT_SHORTCUTS)))
    expect(SHORTCUT_LABELS['tool.selection.ellipse']).toBe('椭圆选区')
    expect(DEFAULT_SHORTCUTS.mirrorView).toBe('Ctrl+Shift+M')
    expect(DEFAULT_SHORTCUTS.mirrorViewVertical).toBe('Ctrl+Shift+Alt+M')
    expect(DEFAULT_SHORTCUTS.lineConnectionMode).toBe('Shift')
    expect(DEFAULT_SHORTCUTS.adjustmentCurves).toBe('Ctrl+M')
    expect(DEFAULT_SHORTCUTS.adjustmentHueSaturation).toBe('Ctrl+U')
    expect(DEFAULT_SHORTCUTS.adjustmentColorBalance).toBe('')
    expect(DEFAULT_SHORTCUTS.newLayer).toBe('Shift+N')
    expect(DEFAULT_SHORTCUTS.polygonLasso).toBe('Shift+Q')
    expect(DEFAULT_SHORTCUTS['tool.fill.gradient']).toBe('Shift+G')
    expect(DEFAULT_SHORTCUTS.toggleCustomGrid).toBe("Ctrl+'")
    expect(DEFAULT_SHORTCUTS.toggleGrid).toBe("Ctrl+Shift+'")
    expect(DEFAULT_SHORTCUTS.toolRailLeft).toBe('')
    expect(DEFAULT_SHORTCUTS.swapForegroundBackground).toBe('X')
    expect(DEFAULT_SHORTCUTS.rotateViewClockwise90).toBe('')
    expect(DEFAULT_SHORTCUTS.rotateViewCounterClockwise90).toBe('')
    expect(SHORTCUT_LABELS.openPreferences).toBe('首选项')
    expect(normalizeShortcut('Ctrl+Shift+Alt+M')).toBe('Ctrl+Alt+Shift+M')
  })

  it('records a modifier key without duplicating its own modifier prefix', () => {
    expect(shortcutText({ key: 'Control', code: 'ControlLeft', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false } as KeyboardEvent)).toBe('Ctrl')
    expect(shortcutText({ key: 'Alt', code: 'AltLeft', ctrlKey: false, metaKey: false, altKey: true, shiftKey: false } as KeyboardEvent)).toBe('Alt')
    expect(shortcutText({ key: 'Shift', code: 'ShiftLeft', ctrlKey: false, metaKey: false, altKey: false, shiftKey: true } as KeyboardEvent)).toBe('Shift')
    expect(shortcutText({ key: 'Shift', code: 'ShiftLeft', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true } as KeyboardEvent)).toBe('Ctrl+Shift')
    expect(shortcutText({ key: 'm', code: 'KeyM', ctrlKey: true, metaKey: false, altKey: true, shiftKey: true } as KeyboardEvent)).toBe('Ctrl+Alt+Shift+M')
  })

  it('normalizes the quote key independently of the active Shift character', () => {
    expect(shortcutText({ key: "'", code: 'Quote', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false } as KeyboardEvent)).toBe("Ctrl+'")
    expect(shortcutText({ key: '"', code: 'Quote', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true } as KeyboardEvent)).toBe("Ctrl+Shift+'")
  })

  it('rebuilds blocked shortcut conflicts from persisted settings', () => {
    const shortcuts = { ...DEFAULT_SHORTCUTS, save: 'Ctrl+S', exportDocument: 'Ctrl+S' }
    const result = deriveShortcutConflicts(shortcuts)
    expect(result.blocked.exportDocument).toBe('save')
    expect(result.conflicts).toContainEqual({ shortcut: 'Ctrl+S', winner: 'save', conflicting: ['exportDocument'] })
  })

  it('ignores cleared shortcuts when deriving conflicts', () => {
    const result = deriveShortcutConflicts({ ...DEFAULT_SHORTCUTS, save: '', exportDocument: '' })
    expect(result.blocked.save).toBeUndefined()
    expect(result.blocked.exportDocument).toBeUndefined()
  })

  it('allows contextual modifier commands to share the same key', () => {
    const result = deriveShortcutConflicts(DEFAULT_SHORTCUTS)
    expect(result.blocked.lineConnectionMode).toBeUndefined()
    expect(result.blocked.constrainAxis).toBeUndefined()
    expect(result.conflicts.some((conflict) => conflict.shortcut === 'Shift')).toBe(false)
  })

  it('provides a configurable Shift+Ctrl line direction modifier', () => {
    expect(DEFAULT_SHORTCUTS.constrainLineDirections).toBe('Ctrl+Shift')
    expect(SHORTCUT_GROUPS.modifiers).toContain('constrainLineDirections')
  })
})
