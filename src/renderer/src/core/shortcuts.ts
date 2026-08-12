import { readStoredString, writeStoredJson, writeStoredString } from './storage'
import type { AppLocale } from './localization'
import { shortcutGroupLabelsByLocale, shortcutLabelsByLocale } from '@/locales/shortcuts'

export const SHORTCUTS_KEY = 'moonsprite.shortcuts.v1'
export const POLYGON_LASSO_SHORTCUT_MIGRATION_KEY = 'moonsprite.shortcuts.migration.polygon-lasso-shift-q'
export const GRID_SHORTCUT_MIGRATION_KEY = 'moonsprite.shortcuts.migration.grid-shortcuts'
export const REPLACE_COLOR_SHORTCUT_MIGRATION_KEY = 'moonsprite.shortcuts.migration.replace-color-ctrl-shift-k'

export const DEFAULT_SHORTCUTS = {
  openHome: '',
  newDocument: 'Ctrl+N',
  openDocument: 'Ctrl+O',
  closeDocument: 'Ctrl+W',
  openProjectFolder: '',
  exportDocument: 'Ctrl+E',
  exportSpriteSheet: '',
  openTimelapse: '',
  openProjectInfo: '',
  'tool.pencil': 'B',
  'tool.eraser': 'E',
  'tool.selection': 'M',
  'tool.selection.ellipse': 'Shift+M',
  'tool.move': 'V',
  'tool.shape': 'U',
  'tool.shape.rectangleOutline': '',
  'tool.shape.rectangle': '',
  'tool.shape.ellipseOutline': '',
  'tool.shape.ellipse': '',
  'tool.fill': 'G',
  'tool.fill.gradient': 'Shift+G',
  'tool.eyedropper': 'I',
  'tool.hand': 'H',
  'tool.zoom': 'Z',
  'tool.rotate': 'R',
  lasso: 'Q',
  polygonLasso: 'Shift+Q',
  magic: 'W',
  canvasResize: 'C',
  imageResize: 'Ctrl+Alt+I',
  transform: 'Ctrl+T',
  outline: 'Shift+O',
  adjustmentColorBalance: '',
  adjustmentBrightnessContrast: '',
  adjustmentHueSaturation: 'Ctrl+U',
  adjustmentCurves: 'Ctrl+M',
  openShortcutSettings: '',
  openPreferences: '',
  flipVertical: 'Shift+V',
  flipHorizontal: 'Shift+H',
  selectAll: 'Ctrl+A',
  invertSelection: 'Ctrl+Shift+I',
  deselect: 'Ctrl+D',
  copy: 'Ctrl+C',
  cut: 'Ctrl+X',
  paste: 'Ctrl+V',
  pasteAsNewLayer: 'Ctrl+Shift+V',
  pasteAsNewDocument: '',
  save: 'Ctrl+S',
  saveAs: 'Ctrl+Shift+S',
  undo: 'Ctrl+Z',
  redo: 'Ctrl+Shift+Z',
  relativeLuminance: 'Ctrl+Y',
  advancedMode: 'Ctrl+F',
  fillForeground: 'F',
  swapForegroundBackground: 'X',
  replaceColor: 'Ctrl+Shift+K',
  convertColorMode: '',
  createBrushFromSelection: 'Ctrl+B',
  newLayer: 'Shift+N',
  createLayerGroup: 'Ctrl+G',
  toggleClippingMask: 'Ctrl+Alt+G',
  toggleSelectedLayerVisibility: '',
  toggleSelectedLayerLock: '',
  toggleSelectedGroupCollapsed: '',
  duplicateLayer: '',
  mergeLayerDown: '',
  mergeSelectedLayers: '',
  mergeLayerGroup: '',
  mergeVisibleLayers: '',
  ungroupLayers: 'Ctrl+Shift+G',
  deleteLayer: 'Delete',
  mirrorView: 'Ctrl+Shift+M',
  mirrorViewVertical: 'Ctrl+Shift+Alt+M',
  toggleGrid: "Ctrl+Shift+'",
  toggleCustomGrid: "Ctrl+'",
  toggleSelectionOutline: 'Ctrl+H',
  rotateViewClockwise90: '',
  rotateViewCounterClockwise90: '',
  resetView: '',
  toggleColorPanel: '',
  togglePalettePanel: '',
  toggleLayersPanel: '',
  togglePreviewPanel: '',
  toggleTimeline: '',
  openGridSettings: '',
  toolRailLeft: '',
  toolRailRight: '',
  saveWorkspaceLayout: '',
  openWorkspaceManager: '',
  openComponentLibrary: '',
  openLatestRelease: '',
  openRoadmap: '',
  openAbout: '',
  brushSizeDecrease: '[',
  brushSizeIncrease: ']',
  temporaryEyedropper: 'Alt',
  copySelectionContent: 'Ctrl',
  copyLayerOnDrag: 'Alt',
  constrainAxis: 'Shift',
  addToSelection: 'Shift',
  proportionalSelectionTransform: 'Shift',
  integerSelectionScale: 'Ctrl',
  snapSelectionRotation: 'Shift',
  snapViewRotation: 'Shift',
  resetViewRotation: 'Ctrl',
  temporaryPan: 'Space',
  brushSizeAdjust: 'Ctrl+Alt',
  brushSizeWheelAdjust: 'Ctrl',
  lineConnectionMode: 'Shift',
  constrainLineDirections: 'Ctrl+Shift',
  addAnimationFrame: 'Alt+N',
  addBlankAnimationFrame: 'Alt+B',
  deleteAnimationFrame: 'Alt+C',
  copyAnimationCel: 'Ctrl+D',
  toggleAnimationPlayback: '',
  previousAnimationFrame: '',
  nextAnimationFrame: ''
} as const

export type ShortcutId = keyof typeof DEFAULT_SHORTCUTS
export type ShortcutMap = Record<string, string>

export function normalizeShortcut(value: string): string {
  const parts = value.split('+').map((part) => part.trim()).filter(Boolean)
  const modifiers = ['Ctrl', 'Alt', 'Shift'].filter((modifier) => parts.some((part) => part.toLowerCase() === modifier.toLowerCase()))
  const key = parts.find((part) => !['ctrl', 'alt', 'shift'].includes(part.toLowerCase()))
  return [...modifiers, ...(key ? [key.length === 1 ? key.toUpperCase() : key] : [])].join('+')
}

export const SHORTCUT_GROUPS = {
  file: ['openHome', 'newDocument', 'openDocument', 'closeDocument', 'openProjectInfo', 'save', 'saveAs', 'exportDocument', 'exportSpriteSheet', 'openProjectFolder', 'openTimelapse'],
  edit: ['undo', 'redo', 'copy', 'cut', 'paste', 'pasteAsNewLayer', 'pasteAsNewDocument'],
  selection: ['selectAll', 'invertSelection', 'deselect', 'transform', 'flipHorizontal', 'flipVertical', 'outline', 'toggleSelectionOutline', 'createBrushFromSelection'],
  image: ['canvasResize', 'imageResize', 'convertColorMode'],
  color: ['fillForeground', 'swapForegroundBackground', 'replaceColor', 'adjustmentColorBalance', 'adjustmentBrightnessContrast', 'adjustmentHueSaturation', 'adjustmentCurves'],
  layers: ['newLayer', 'createLayerGroup', 'toggleClippingMask', 'toggleSelectedLayerVisibility', 'toggleSelectedLayerLock', 'toggleSelectedGroupCollapsed', 'duplicateLayer', 'mergeLayerDown', 'mergeSelectedLayers', 'mergeLayerGroup', 'mergeVisibleLayers', 'ungroupLayers', 'deleteLayer'],
  animation: ['toggleAnimationPlayback', 'previousAnimationFrame', 'nextAnimationFrame', 'addAnimationFrame', 'addBlankAnimationFrame', 'deleteAnimationFrame', 'copyAnimationCel'],
  view: ['relativeLuminance', 'toggleGrid', 'toggleCustomGrid', 'openGridSettings', 'mirrorView', 'mirrorViewVertical', 'rotateViewClockwise90', 'rotateViewCounterClockwise90', 'resetView'],
  interface: ['toggleColorPanel', 'togglePalettePanel', 'toggleLayersPanel', 'togglePreviewPanel', 'toggleTimeline', 'toolRailLeft', 'toolRailRight', 'saveWorkspaceLayout', 'openWorkspaceManager', 'advancedMode', 'openShortcutSettings', 'openPreferences'],
  tools: ['tool.pencil', 'tool.eraser', 'tool.fill', 'tool.fill.gradient', 'tool.eyedropper', 'tool.selection', 'tool.selection.ellipse', 'lasso', 'polygonLasso', 'magic', 'tool.move', 'tool.shape', 'tool.shape.rectangleOutline', 'tool.shape.rectangle', 'tool.shape.ellipseOutline', 'tool.shape.ellipse', 'tool.hand', 'tool.zoom', 'tool.rotate', 'brushSizeDecrease', 'brushSizeIncrease'],
  modifiers: ['temporaryEyedropper', 'brushSizeAdjust', 'brushSizeWheelAdjust', 'lineConnectionMode', 'constrainLineDirections', 'copySelectionContent', 'addToSelection', 'proportionalSelectionTransform', 'integerSelectionScale', 'snapSelectionRotation', 'copyLayerOnDrag', 'constrainAxis', 'temporaryPan', 'snapViewRotation', 'resetViewRotation'],
  help: ['openComponentLibrary', 'openLatestRelease', 'openRoadmap', 'openAbout']
} as const satisfies Record<string, ReadonlyArray<ShortcutId>>

export type ShortcutGroupId = keyof typeof SHORTCUT_GROUPS

export const SHORTCUT_GROUP_LABELS = shortcutGroupLabelsByLocale['zh-CN']
export const SHORTCUT_LABELS = shortcutLabelsByLocale['zh-CN']
export const shortcutGroupLabels = (locale: AppLocale): Record<ShortcutGroupId, string> => shortcutGroupLabelsByLocale[locale]
export const shortcutLabels = (locale: AppLocale): Record<ShortcutId, string> => shortcutLabelsByLocale[locale]

export function modifierShortcutMatches(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, shortcut: string): boolean {
  const keys = shortcut.toLowerCase().split('+').map((key) => key.trim()).filter(Boolean)
  if (keys.length === 0 || keys.some((key) => !['ctrl', 'alt', 'shift'].includes(key))) return false
  const wantsCtrl = keys.includes('ctrl')
  const wantsAlt = keys.includes('alt')
  const wantsShift = keys.includes('shift')
  return Boolean(event.ctrlKey || event.metaKey) === wantsCtrl && Boolean(event.altKey) === wantsAlt && Boolean(event.shiftKey) === wantsShift
}

export function modifierShortcutHeld(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, shortcut: string): boolean {
  const keys = shortcut.toLowerCase().split('+').map((key) => key.trim()).filter(Boolean)
  if (keys.length === 0 || keys.some((key) => !['ctrl', 'alt', 'shift'].includes(key))) return false
  return (!keys.includes('ctrl') || Boolean(event.ctrlKey || event.metaKey))
    && (!keys.includes('alt') || Boolean(event.altKey))
    && (!keys.includes('shift') || Boolean(event.shiftKey))
}

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
  const saved = parseShortcutJson(readStoredString(SHORTCUTS_KEY, storage))
  // 旧版垂直镜像默认键与 Ctrl+Alt 调整笔刷尺寸重叠，只迁移未被用户改过的旧默认值。
  if (saved.mirrorViewVertical === 'Ctrl+Alt+M' && (saved.brushSizeAdjust === undefined || saved.brushSizeAdjust === DEFAULT_SHORTCUTS.brushSizeAdjust)) saved.mirrorViewVertical = DEFAULT_SHORTCUTS.mirrorViewVertical
  if (readStoredString(POLYGON_LASSO_SHORTCUT_MIGRATION_KEY, storage) !== 'done') {
    if (saved.polygonLasso === '') saved.polygonLasso = DEFAULT_SHORTCUTS.polygonLasso
    writeStoredString(POLYGON_LASSO_SHORTCUT_MIGRATION_KEY, 'done', storage)
  }
  if (readStoredString(GRID_SHORTCUT_MIGRATION_KEY, storage) !== 'done') {
    if (saved.toggleGrid === '') saved.toggleGrid = DEFAULT_SHORTCUTS.toggleGrid
    writeStoredString(GRID_SHORTCUT_MIGRATION_KEY, 'done', storage)
  }
  if (readStoredString(REPLACE_COLOR_SHORTCUT_MIGRATION_KEY, storage) !== 'done') {
    if (saved.replaceColor === 'Ctrl+Alt+R') saved.replaceColor = DEFAULT_SHORTCUTS.replaceColor
    writeStoredString(REPLACE_COLOR_SHORTCUT_MIGRATION_KEY, 'done', storage)
  }
  return { ...DEFAULT_SHORTCUTS, ...saved }
}

export function saveShortcuts(shortcuts: ShortcutMap, storage?: Storage): void {
  writeStoredJson(SHORTCUTS_KEY, shortcuts, storage)
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('moonsprite:shortcuts-changed'))
}

export function keyboardEventKey(event: KeyboardEvent): string {
  if (event.code === 'Quote') return "'"
  if (['Process', 'Unidentified', 'Dead'].includes(event.key) && /^Key[A-Z]$/.test(event.code)) return event.code.slice(3)
  return event.key
}

export function shortcutText(event: KeyboardEvent): string {
  const key = keyboardEventKey(event)
  const modifiers = [event.ctrlKey || event.metaKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : ''].filter(Boolean)
  const isModifier = key === 'Control' || key === 'Meta' || key === 'Alt' || key === 'Shift'
  const ordinaryKey = isModifier ? '' : key.length === 1 ? key.toUpperCase() : key
  return [...modifiers, ...(ordinaryKey ? [ordinaryKey] : [])].join('+')
}

export interface ShortcutConflict {
  shortcut: string
  winner: ShortcutId
  conflicting: ShortcutId[]
}

export function deriveShortcutConflicts(shortcuts: ShortcutMap): { conflicts: ShortcutConflict[]; blocked: Partial<Record<ShortcutId, ShortcutId>> } {
  const orderedIds = Object.values(SHORTCUT_GROUPS).flat() as ShortcutId[]
  const contextualModifiers = new Set<ShortcutId>([...SHORTCUT_GROUPS.modifiers, 'deselect', 'copyAnimationCel'])
  const byShortcut = new Map<string, ShortcutId[]>()
  for (const id of orderedIds) {
    const shortcut = (shortcuts[id] ?? DEFAULT_SHORTCUTS[id]).trim()
    if (!shortcut) continue
    const key = normalizeShortcut(shortcut).toLowerCase()
    byShortcut.set(key, [...(byShortcut.get(key) ?? []), id])
  }
  const conflicts: ShortcutConflict[] = []
  const blocked: Partial<Record<ShortcutId, ShortcutId>> = {}
  for (const ids of byShortcut.values()) {
    if (ids.length < 2) continue
    // Modifier bindings are evaluated inside their own tool/gesture context, so
    // sharing Shift or Alt is intentional and must not disable later entries.
    if (ids.every((id) => contextualModifiers.has(id))) continue
    const winner = ids[0]
    for (const id of ids.slice(1)) blocked[id] = winner
    conflicts.push({ shortcut: (shortcuts[winner] ?? DEFAULT_SHORTCUTS[winner]).trim(), winner, conflicting: ids.slice(1) })
  }
  return { conflicts, blocked }
}
