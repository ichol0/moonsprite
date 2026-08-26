import { describe, expect, it } from 'vitest'
import { ANIMATION_PLAYBACK_SHORTCUT_MIGRATION_KEY, BRUSH_PANEL_SHORTCUT_MIGRATION_KEY, DEFAULT_SHORTCUT_BINDINGS, DEFAULT_SHORTCUTS, GRID_SHORTCUT_MIGRATION_KEY, POLYGON_LASSO_SHORTCUT_MIGRATION_KEY, POPUP_PANEL_SHORTCUT_MIGRATION_KEY, QUICK_TOOL_SHORTCUT_IDS, REPLACE_COLOR_SHORTCUT_MIGRATION_KEY, SHORTCUTS_KEY, SHORTCUTS_V2_KEY, SHORTCUT_GROUPS, SHORTCUT_LABELS, assignShortcutBinding, cloneShortcutBindings, createShortcutSettingsFile, deriveShortcutConflicts, dispatchMouseShortcutInput, dispatchWheelShortcutInput, formatShortcutBindingsForLocale, importShortcutBindings, loadShortcutBindings, loadShortcuts, mouseShortcutText, normalizeShortcut, parseShortcutJson, resetShortcutBindings, saveShortcutBindings, saveShortcuts, shortcutBindingBlocked, shortcutHeldByKeyParts, shortcutKeyPart, shortcutMatchesAnyEvent, shortcutMatchesEvent, shortcutReleasedByEvent, shortcutText, wheelShortcutText } from './shortcuts'

describe('shortcut persistence boundary', () => {
  it('only accepts known shortcut ids and string values', () => {
    expect(parseShortcutJson(JSON.stringify({ save: 'Ctrl+S', unknown: 'X', undo: 12 }))).toEqual({ save: 'Ctrl+S' })
  })

  it('migrates legacy temporary tool ids without overriding explicit quick-tool values', () => {
    expect(parseShortcutJson(JSON.stringify({ temporaryMove: 'Alt+V', temporaryEyedropper: '', temporaryPan: 'P' }))).toEqual({
      'tool.move.quick': 'Alt+V',
      'tool.eyedropper.quick': '',
      'tool.hand.quick': 'P'
    })
    expect(parseShortcutJson(JSON.stringify({ temporaryMove: 'Alt+V', 'tool.move.quick': 'Ctrl+V' }))).toEqual({
      'tool.move.quick': 'Ctrl+V'
    })
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

  it('migrates the old replace-color shortcut without overriding custom shortcuts', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size }
    } as Storage
    values.set(SHORTCUTS_KEY, JSON.stringify({ replaceColor: 'Ctrl+Alt+R' }))

    expect(loadShortcuts(storage).replaceColor).toBe('Ctrl+Shift+K')
    expect(values.get(REPLACE_COLOR_SHORTCUT_MIGRATION_KEY)).toBe('done')
    saveShortcuts({ ...DEFAULT_SHORTCUTS, replaceColor: 'Alt+K' }, storage)
    expect(loadShortcuts(storage).replaceColor).toBe('Alt+K')
  })

  it('migrates empty popup panel shortcuts to the default number keys once', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size }
    } as Storage
    values.set(SHORTCUTS_KEY, JSON.stringify({ popupColorPanel: '', popupPalettePanel: '', popupLayersPanel: '', popupPreviewPanel: 'Alt+4', popupTilesetPanel: '', popupBrushLibraryPanel: '' }))

    expect(loadShortcuts(storage)).toMatchObject({ popupColorPanel: '1', popupPalettePanel: '2', popupLayersPanel: '3', popupPreviewPanel: 'Alt+4', popupTilesetPanel: '5', popupBrushLibraryPanel: '6' })
    expect(values.get(POPUP_PANEL_SHORTCUT_MIGRATION_KEY)).toBe('done')
    expect(values.get(BRUSH_PANEL_SHORTCUT_MIGRATION_KEY)).toBe('done')
    saveShortcuts({ ...DEFAULT_SHORTCUTS, popupColorPanel: '' }, storage)
    expect(loadShortcuts(storage).popupColorPanel).toBe('')
  })

  it('migrates the old empty animation playback shortcut to Enter once', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size }
    } as Storage
    values.set(SHORTCUTS_KEY, JSON.stringify({ toggleAnimationPlayback: '' }))

    expect(loadShortcuts(storage).toggleAnimationPlayback).toBe('Enter')
    expect(values.get(ANIMATION_PLAYBACK_SHORTCUT_MIGRATION_KEY)).toBe('done')
    saveShortcuts({ ...DEFAULT_SHORTCUTS, toggleAnimationPlayback: '' }, storage)
    expect(loadShortcuts(storage).toggleAnimationPlayback).toBe('')
  })

  it('registers every configurable command in one labeled group', () => {
    const grouped = new Set(Object.values(SHORTCUT_GROUPS).flat())
    expect(grouped).toEqual(new Set(Object.keys(DEFAULT_SHORTCUTS)))
    expect(SHORTCUT_LABELS['tool.selection.ellipse']).toBe('椭圆选区')
    expect(DEFAULT_SHORTCUTS.mirrorView).toBe('Ctrl+Shift+M')
    expect(DEFAULT_SHORTCUTS.mirrorViewVertical).toBe('Ctrl+Shift+Alt+M')
    expect(DEFAULT_SHORTCUTS.lineConnectionMode).toBe('Shift')
    expect(DEFAULT_SHORTCUTS['tool.move.quick']).toBe('Ctrl')
    expect(DEFAULT_SHORTCUTS['tool.eyedropper.quick']).toBe('Alt')
    expect(DEFAULT_SHORTCUTS['tool.hand.quick']).toBe('Space')
    expect(SHORTCUT_GROUPS.modifiers).not.toContain('tool.move.quick')
    expect(SHORTCUT_LABELS['tool.pencil.quick']).toBe('画笔（快速选择）')
    expect(DEFAULT_SHORTCUTS.adjustmentCurves).toBe('Ctrl+M')
    expect(DEFAULT_SHORTCUTS.adjustmentHueSaturation).toBe('Ctrl+U')
    expect(DEFAULT_SHORTCUTS.adjustmentColorBalance).toBe('')
    expect(DEFAULT_SHORTCUTS.newLayer).toBe('Shift+N')
    expect(DEFAULT_SHORTCUTS.toggleClippingMask).toBe('Ctrl+Alt+G')
    expect(DEFAULT_SHORTCUTS.polygonLasso).toBe('Shift+Q')
    expect(DEFAULT_SHORTCUTS['tool.fill.gradient']).toBe('Shift+G')
    expect(DEFAULT_SHORTCUTS.toggleCustomGrid).toBe("Ctrl+'")
    expect(DEFAULT_SHORTCUTS.toggleGrid).toBe("Ctrl+Shift+'")
    expect(DEFAULT_SHORTCUTS.toolRailLeft).toBe('')
    expect(DEFAULT_SHORTCUTS.toolRailTop).toBe('')
    expect(DEFAULT_SHORTCUTS.toolRailBottom).toBe('')
    expect(DEFAULT_SHORTCUTS.swapForegroundBackground).toBe('X')
    expect(DEFAULT_SHORTCUTS.addForegroundToPalette).toBe('Alt+S')
    expect(SHORTCUT_GROUPS.color).toContain('addForegroundToPalette')
    expect(DEFAULT_SHORTCUTS.replaceColor).toBe('Ctrl+Shift+K')
    expect(SHORTCUT_GROUPS.color).toContain('replaceColor')
    expect(SHORTCUT_GROUPS.selection).toContain('toggleSelectionOutline')
    expect(SHORTCUT_GROUPS.file).toContain('exportSpriteSheet')
    expect(SHORTCUT_GROUPS.animation).toContain('toggleAnimationPlayback')
    expect(SHORTCUT_GROUPS.animation).toEqual(expect.arrayContaining(['copyAnimationFrames', 'pasteAnimationCels', 'createAnimationLoopSection', 'openAnimationCelProperties']))
    expect(DEFAULT_SHORTCUTS.toggleAnimationPlayback).toBe('Enter')
    expect(DEFAULT_SHORTCUTS.addLinkedAnimationFrame).toBe('Alt+M')
    expect(SHORTCUT_GROUPS.animation).toContain('addLinkedAnimationFrame')
    expect(SHORTCUT_GROUPS.interface).toContain('toggleColorPanel')
    expect(SHORTCUT_GROUPS.interface).toEqual(expect.arrayContaining(['popupColorPanel', 'popupPalettePanel', 'popupLayersPanel', 'popupPreviewPanel', 'popupTilesetPanel', 'popupBrushLibraryPanel']))
    expect(SHORTCUT_GROUPS.interface.slice(0, 6)).toEqual(['popupColorPanel', 'popupPalettePanel', 'popupLayersPanel', 'popupPreviewPanel', 'popupTilesetPanel', 'popupBrushLibraryPanel'])
    expect(DEFAULT_SHORTCUTS.popupColorPanel).toBe('1')
    expect(DEFAULT_SHORTCUTS.popupPalettePanel).toBe('2')
    expect(DEFAULT_SHORTCUTS.popupLayersPanel).toBe('3')
    expect(DEFAULT_SHORTCUTS.popupPreviewPanel).toBe('4')
    expect(DEFAULT_SHORTCUTS.popupTilesetPanel).toBe('5')
    expect(DEFAULT_SHORTCUTS.popupBrushLibraryPanel).toBe('6')
    expect(SHORTCUT_GROUPS.interface).toContain('toggleTimeline')
    expect(SHORTCUT_GROUPS.tools).toContain('tool.shape.rectangle')
    expect(SHORTCUT_GROUPS.tools).toEqual(expect.arrayContaining(['tool.shape.freeform', 'tool.shape.polygon', 'toggleMoveAutoSelect', 'resetSymmetryCenter']))
    for (const quickId of QUICK_TOOL_SHORTCUT_IDS) {
      const index = SHORTCUT_GROUPS.tools.indexOf(quickId)
      expect(index).toBeGreaterThan(0)
      expect(quickId).toBe(`${SHORTCUT_GROUPS.tools[index - 1]}.quick`)
    }
    expect(SHORTCUT_GROUPS.tiles).toEqual(expect.arrayContaining(['tilemapModeEdit', 'tilemapModePaint', 'freeTileModeEdit', 'addFreeTileSource', 'openFreeTileInstanceProperties']))
    expect(SHORTCUT_GROUPS.brushes).toEqual(expect.arrayContaining(['importBrushImage', 'createBrushFolder', 'openBrushFolder', 'deleteBrushSelection']))
    expect(SHORTCUT_GROUPS.image).toEqual(expect.arrayContaining(['convertColorModeRgba', 'convertColorModeIndexed', 'convertColorModeGrayscale', 'cropCanvas', 'trimCanvas']))
    expect(SHORTCUT_GROUPS.view).toEqual(expect.arrayContaining(['toggleSliceOutlines', 'tileRepeatOff', 'tileRepeatBoth', 'tileRepeatX', 'tileRepeatY']))
    expect(SHORTCUT_GROUPS.layers).toEqual(expect.arrayContaining(['newTilemapLayer', 'newFreeTileLayer', 'createLinkedLayer', 'openLayerProperties', 'openLayerStyles']))
    expect(SHORTCUT_GROUPS.selection).toEqual(expect.arrayContaining(['deleteSelection', 'selectionModeReplace', 'selectAllSlices', 'openAutoSlice', 'openSliceProperties']))
    expect(DEFAULT_SHORTCUTS.toggleTimeline).toBe('')
    expect(DEFAULT_SHORTCUTS.rotateViewClockwise90).toBe('')
    expect(DEFAULT_SHORTCUTS.rotateViewCounterClockwise90).toBe('')
    expect(SHORTCUT_LABELS.openPreferences).toBe('首选项')
    expect(SHORTCUT_LABELS.openScriptFolder).toBe('打开脚本文件夹')
    expect(DEFAULT_SHORTCUTS.newTilemapLayer).toBe('')
    expect(DEFAULT_SHORTCUTS.importBrushImage).toBe('')
    expect(DEFAULT_SHORTCUTS['tool.airbrush']).toBe('J')
    expect(DEFAULT_SHORTCUTS['tool.slice']).toBe('Shift+C')
    expect(normalizeShortcut('Ctrl+Shift+Alt+M')).toBe('Ctrl+Alt+Shift+M')
  })

  it('records a modifier key without duplicating its own modifier prefix', () => {
    expect(shortcutText({ key: 'Control', code: 'ControlLeft', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false } as KeyboardEvent)).toBe('Ctrl')
    expect(shortcutText({ key: 'Alt', code: 'AltLeft', ctrlKey: false, metaKey: false, altKey: true, shiftKey: false } as KeyboardEvent)).toBe('Alt')
    expect(shortcutText({ key: 'Shift', code: 'ShiftLeft', ctrlKey: false, metaKey: false, altKey: false, shiftKey: true } as KeyboardEvent)).toBe('Shift')
    expect(shortcutText({ key: 'Shift', code: 'ShiftLeft', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true } as KeyboardEvent)).toBe('Ctrl+Shift')
    expect(shortcutText({ key: 'm', code: 'KeyM', ctrlKey: true, metaKey: false, altKey: true, shiftKey: true } as KeyboardEvent)).toBe('Ctrl+Alt+Shift+M')
  })

  it('tracks press and release for a held command shortcut', () => {
    const pressed = { key: 's', code: 'KeyS', ctrlKey: false, metaKey: false, altKey: true, shiftKey: false } as KeyboardEvent
    const releasedKey = { key: 's', code: 'KeyS', ctrlKey: false, metaKey: false, altKey: true, shiftKey: false } as KeyboardEvent
    const releasedModifier = { key: 'Alt', code: 'AltLeft', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false } as KeyboardEvent

    expect(shortcutMatchesEvent(pressed, 'Alt+S')).toBe(true)
    expect(shortcutReleasedByEvent(releasedKey, 'Alt+S')).toBe(true)
    expect(shortcutReleasedByEvent(releasedModifier, 'Alt+S')).toBe(true)
  })

  it('keeps a command active while all of its physical keys remain held', () => {
    const held = new Set<string>()
    held.add(shortcutKeyPart({ key: 'Alt', code: 'AltLeft' } as KeyboardEvent))
    held.add(shortcutKeyPart({ key: 's', code: 'KeyS' } as KeyboardEvent))

    expect(shortcutHeldByKeyParts(held, 'Alt+S')).toBe(true)
    held.delete('S')
    expect(shortcutHeldByKeyParts(held, 'Alt+S')).toBe(false)
  })

  it('normalizes the quote key independently of the active Shift character', () => {
    expect(shortcutText({ key: "'", code: 'Quote', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false } as KeyboardEvent)).toBe("Ctrl+'")
    expect(shortcutText({ key: '"', code: 'Quote', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true } as KeyboardEvent)).toBe("Ctrl+Shift+'")
  })

  it('records wheel directions with modifiers and localizes their display', () => {
    const modifiers = { ctrlKey: true, metaKey: false, altKey: true, shiftKey: true }

    expect(wheelShortcutText(modifiers, -120)).toBe('Ctrl+Alt+Shift+WheelUp')
    expect(wheelShortcutText(modifiers, 120)).toBe('Ctrl+Alt+Shift+WheelDown')
    expect(wheelShortcutText(modifiers, 0)).toBe('')
    expect(formatShortcutBindingsForLocale(['Ctrl+Alt+Shift+WheelUp', 'WheelDown'], 'zh-CN')).toBe('Ctrl+Alt+Shift+滚轮向上 / 滚轮向下')
    expect(formatShortcutBindingsForLocale(['Ctrl+Alt+Shift+WheelUp', 'WheelDown'], 'en-US')).toBe('Ctrl+Alt+Shift+Wheel Up / Wheel Down')
  })

  it('dispatches a wheel binding as a consumable keyboard press and release', () => {
    const target = document.createElement('div')
    const phases: string[] = []
    target.addEventListener('keydown', (event) => {
      phases.push(`${event.type}:${event.key}`)
      if (shortcutMatchesEvent(event, 'Ctrl+WheelUp')) event.preventDefault()
    })
    target.addEventListener('keyup', (event) => phases.push(`${event.type}:${event.key}`))

    expect(dispatchWheelShortcutInput(target, { ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }, -120)).toBe(true)
    expect(phases).toEqual(['keydown:WheelUp', 'keyup:WheelUp'])
    expect(dispatchWheelShortcutInput(target, { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }, 0)).toBe(false)
  })

  it('records and dispatches middle and side mouse buttons with modifiers', () => {
    const modifiers = { ctrlKey: true, metaKey: false, altKey: true, shiftKey: false }
    expect(mouseShortcutText({ ...modifiers, button: 1 })).toBe('Ctrl+Alt+MouseMiddle')
    expect(mouseShortcutText({ ...modifiers, button: 3 })).toBe('Ctrl+Alt+MouseBack')
    expect(mouseShortcutText({ ...modifiers, button: 4 })).toBe('Ctrl+Alt+MouseForward')
    expect(mouseShortcutText({ ...modifiers, button: 0 })).toBe('')
    expect(formatShortcutBindingsForLocale(['MouseMiddle', 'MouseBack', 'MouseForward'], 'zh-CN')).toBe('鼠标中键 / 鼠标侧键 1 / 鼠标侧键 2')

    const target = document.createElement('div')
    const phases: string[] = []
    target.addEventListener('keydown', (event) => {
      phases.push(`${event.type}:${event.key}`)
      if (shortcutMatchesEvent(event, 'Ctrl+Alt+MouseBack')) event.preventDefault()
    })
    target.addEventListener('keyup', (event) => phases.push(`${event.type}:${event.key}`))

    expect(dispatchMouseShortcutInput(target, { ...modifiers, button: 3 }, 'keydown')).toBe(true)
    expect(dispatchMouseShortcutInput(target, { ...modifiers, button: 3 }, 'keyup')).toBe(false)
    expect(phases).toEqual(['keydown:MouseBack', 'keyup:MouseBack'])
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

  it('allows a quick tool to share its hold key with contextual modifier commands', () => {
    const result = deriveShortcutConflicts(DEFAULT_SHORTCUTS)
    expect(result.blocked['tool.move.quick']).toBeUndefined()
    expect(result.blocked.copySelectionContent).toBeUndefined()
    expect(result.conflicts.some((conflict) => conflict.shortcut === 'Ctrl')).toBe(false)
  })

  it('provides a configurable Shift+Ctrl line direction modifier', () => {
    expect(DEFAULT_SHORTCUTS.constrainLineDirections).toBe('Ctrl+Shift')
    expect(SHORTCUT_GROUPS.modifiers).toContain('constrainLineDirections')
  })

  it('loads legacy v1 values into the multi-binding model', () => {
    const values = new Map<string, string>([[SHORTCUTS_KEY, JSON.stringify({ save: 'Ctrl+J' })]])
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size }
    } as Storage

    const shortcuts = loadShortcutBindings(storage)

    expect(shortcuts.save).toEqual(['Ctrl+J'])
    expect(shortcuts.undo).toEqual(['Ctrl+Z'])
    expect(JSON.parse(values.get(SHORTCUTS_V2_KEY)!).version).toBe(2)
  })

  it('persists multiple bindings as v2 user differences and keeps a v1 primary fallback', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size }
    } as Storage
    const shortcuts = cloneShortcutBindings(DEFAULT_SHORTCUT_BINDINGS)
    shortcuts.save = ['Ctrl+S', 'F2']
    shortcuts.exportDocument = []

    saveShortcutBindings(shortcuts, storage)

    expect(JSON.parse(values.get(SHORTCUTS_V2_KEY)!)).toEqual({
      format: 'moonsprite-shortcuts',
      version: 2,
      bindings: { exportDocument: [], save: ['Ctrl+S', 'F2'] }
    })
    expect(JSON.parse(values.get(SHORTCUTS_KEY)!).save).toBe('Ctrl+S')
    expect(loadShortcutBindings(storage).save).toEqual(['Ctrl+S', 'F2'])
  })

  it('moves a conflicting binding to the newly assigned command', () => {
    const result = assignShortcutBinding(DEFAULT_SHORTCUT_BINDINGS, 'exportDocument', 'Ctrl+S')

    expect(result.shortcuts.save).toEqual([])
    expect(result.shortcuts.exportDocument).toEqual(['Ctrl+E', 'Ctrl+S'])
    expect(result.displaced).toContain('save')
  })

  it('allows tools to share a binding for repeated-key cycling', () => {
    const result = assignShortcutBinding(DEFAULT_SHORTCUT_BINDINGS, 'tool.airbrush', 'B')

    expect(result.shortcuts['tool.pencil']).toEqual(['B'])
    expect(result.shortcuts['tool.airbrush']).toEqual(['J', 'B'])
    expect(result.displaced).not.toContain('tool.pencil')
    expect(deriveShortcutConflicts(result.shortcuts).conflicts.some((item) => item.shortcut === 'B')).toBe(false)
  })

  it('restores one command default and transfers any new conflict', () => {
    const shortcuts = cloneShortcutBindings(DEFAULT_SHORTCUT_BINDINGS)
    shortcuts.save = []
    shortcuts.exportDocument = ['Ctrl+S']

    const reset = resetShortcutBindings(shortcuts, 'save')

    expect(reset.save).toEqual(['Ctrl+S'])
    expect(reset.exportDocument).toEqual([])
  })

  it('imports v2 differences and legacy flat maps through the same boundary', () => {
    const v2 = importShortcutBindings(JSON.stringify({ format: 'moonsprite-shortcuts', version: 2, bindings: { save: ['F2', 'Ctrl+S'], undo: [] } }))
    const legacy = importShortcutBindings(JSON.stringify({ save: 'F3' }))

    expect(v2?.save).toEqual(['F2', 'Ctrl+S'])
    expect(v2?.undo).toEqual([])
    expect(v2?.redo).toEqual(['Ctrl+Shift+Z'])
    expect(legacy?.save).toEqual(['F3'])
    expect(legacy?.undo).toEqual(['Ctrl+Z'])
  })

  it('imports cleared and customized legacy temporary tools into quick-tool bindings', () => {
    const v2 = importShortcutBindings(JSON.stringify({
      format: 'moonsprite-shortcuts',
      version: 2,
      bindings: { temporaryMove: [], temporaryEyedropper: ['E'], temporaryPan: ['Shift+P'] }
    }))

    expect(v2?.['tool.move.quick']).toEqual([])
    expect(v2?.['tool.eyedropper.quick']).toEqual(['E'])
    expect(v2?.['tool.hand.quick']).toEqual(['Shift+P'])
  })

  it('blocks only the conflicting binding when another binding is still usable', () => {
    const shortcuts = cloneShortcutBindings(DEFAULT_SHORTCUT_BINDINGS)
    shortcuts.save = ['Ctrl+S', 'F2']
    shortcuts.exportDocument = ['Ctrl+S']
    const state = deriveShortcutConflicts(shortcuts)
    const f2 = { key: 'F2', code: 'F2', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false } as KeyboardEvent

    expect(shortcutBindingBlocked(state, 'exportDocument', 'Ctrl+S')).toBe(true)
    expect(shortcutBindingBlocked(state, 'save', 'F2')).toBe(false)
    expect(shortcutMatchesAnyEvent(f2, shortcuts.save)).toBe(true)
  })

  it('exports only values that differ from the current defaults', () => {
    const shortcuts = cloneShortcutBindings(DEFAULT_SHORTCUT_BINDINGS)
    shortcuts.save = ['F2']

    expect(createShortcutSettingsFile(shortcuts)).toEqual({
      format: 'moonsprite-shortcuts',
      version: 2,
      bindings: { save: ['F2'] }
    })
  })
})
