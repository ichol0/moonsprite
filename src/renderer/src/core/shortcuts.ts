export const SHORTCUTS_KEY = 'moonsprite.shortcuts.v1'

export const DEFAULT_SHORTCUTS = {
  'tool.pencil': 'B',
  'tool.eraser': 'E',
  'tool.selection': 'M',
  'tool.move': 'V',
  'tool.shape': 'U',
  'tool.fill': 'G',
  'tool.eyedropper': 'I',
  'tool.hand': 'H',
  'tool.zoom': 'Z',
  'tool.rotate': 'R',
  lasso: 'Q',
  magic: 'W',
  canvasResize: 'C',
  transform: 'Ctrl+T',
  outline: 'Shift+O',
  flipVertical: 'Shift+V',
  flipHorizontal: 'Shift+H',
  selectAll: 'Ctrl+A',
  deselect: 'Ctrl+D',
  copy: 'Ctrl+C',
  cut: 'Ctrl+X',
  paste: 'Ctrl+V',
  save: 'Ctrl+S',
  saveAs: 'Ctrl+Shift+S',
  undo: 'Ctrl+Z',
  redo: 'Ctrl+Shift+Z',
  relativeLuminance: 'Ctrl+Y',
  advancedMode: 'Ctrl+F',
  fillForeground: 'F'
} as const

export type ShortcutId = keyof typeof DEFAULT_SHORTCUTS
export type ShortcutMap = Record<string, string>

const knownShortcutIds = new Set<string>(Object.keys(DEFAULT_SHORTCUTS))

export function parseShortcutJson(value: string | null): ShortcutMap {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return Object.fromEntries(
      Object.entries(parsed).filter(([key, shortcut]) => knownShortcutIds.has(key) && typeof shortcut === 'string')
    )
  } catch {
    return {}
  }
}

export function loadShortcuts(storage?: Storage): ShortcutMap {
  try {
    return { ...DEFAULT_SHORTCUTS, ...parseShortcutJson((storage ?? window.localStorage).getItem(SHORTCUTS_KEY)) }
  } catch {
    return { ...DEFAULT_SHORTCUTS }
  }
}

export function saveShortcuts(shortcuts: ShortcutMap, storage?: Storage): void {
  try {
    ;(storage ?? window.localStorage).setItem(SHORTCUTS_KEY, JSON.stringify(shortcuts))
  } catch {
    return
  }
}

export function keyboardEventKey(event: KeyboardEvent): string {
  if (['Process', 'Unidentified', 'Dead'].includes(event.key) && /^Key[A-Z]$/.test(event.code)) return event.code.slice(3)
  return event.key
}

export function shortcutText(event: KeyboardEvent): string {
  const key = keyboardEventKey(event)
  return `${event.ctrlKey || event.metaKey ? 'Ctrl+' : ''}${event.altKey ? 'Alt+' : ''}${event.shiftKey ? 'Shift+' : ''}${key.length === 1 ? key.toUpperCase() : key}`
}
