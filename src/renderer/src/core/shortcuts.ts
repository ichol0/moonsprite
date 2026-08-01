import { readStoredString, writeStoredJson } from './storage'

export const SHORTCUTS_KEY = 'moonsprite.shortcuts.v1'

export const DEFAULT_SHORTCUTS = {
  newDocument: 'Ctrl+N',
  openDocument: 'Ctrl+O',
  closeDocument: 'Ctrl+W',
  exportDocument: 'Ctrl+E',
  'tool.pencil': 'B',
  'tool.eraser': 'E',
  'tool.selection': 'M',
  'tool.selection.ellipse': 'Shift+M',
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
  imageResize: 'Ctrl+Alt+I',
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
  fillForeground: 'F',
  createBrushFromSelection: 'Ctrl+B',
  createLayerGroup: 'Ctrl+G',
  ungroupLayers: 'Ctrl+Shift+G',
  deleteLayer: 'Delete',
  mirrorView: 'Ctrl+Shift+M',
  mirrorViewVertical: 'Ctrl+Shift+Alt+M',
  brushSizeDecrease: '[',
  brushSizeIncrease: ']',
  temporaryEyedropper: 'Alt',
  copySelectionContent: 'Ctrl',
  copyLayerOnDrag: 'Alt',
  constrainAxis: 'Shift',
  addToSelection: 'Shift',
  snapViewRotation: 'Shift',
  resetViewRotation: 'Ctrl',
  temporaryPan: 'Space',
  brushSizeAdjust: 'Ctrl+Alt',
  lineConnectionMode: 'Shift'
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
  file: ['newDocument', 'openDocument', 'closeDocument', 'save', 'saveAs', 'exportDocument'],
  tools: ['tool.pencil', 'tool.eraser', 'tool.selection', 'tool.selection.ellipse', 'tool.move', 'tool.shape', 'tool.fill', 'tool.eyedropper', 'tool.hand', 'tool.zoom', 'tool.rotate', 'brushSizeDecrease', 'brushSizeIncrease'],
  selection: ['lasso', 'magic', 'selectAll', 'deselect', 'transform', 'outline', 'flipVertical', 'flipHorizontal', 'createBrushFromSelection'],
  image: ['canvasResize', 'imageResize', 'fillForeground'],
  layers: ['createLayerGroup', 'ungroupLayers', 'deleteLayer'],
  view: ['relativeLuminance', 'advancedMode', 'mirrorView', 'mirrorViewVertical'],
  modifiers: ['temporaryEyedropper', 'copySelectionContent', 'copyLayerOnDrag', 'constrainAxis', 'addToSelection', 'snapViewRotation', 'resetViewRotation', 'temporaryPan', 'brushSizeAdjust', 'lineConnectionMode'],
  commands: ['copy', 'cut', 'paste', 'undo', 'redo']
} as const

export const SHORTCUT_GROUP_LABELS: Record<keyof typeof SHORTCUT_GROUPS, string> = {
  file: '文件',
  tools: '工具',
  selection: '选区',
  image: '图像',
  layers: '图层',
  view: '视图',
  commands: '编辑',
  modifiers: '修饰键'
}

export const SHORTCUT_LABELS: Record<ShortcutId, string> = {
  newDocument: '新建工程', openDocument: '打开工程', closeDocument: '关闭工程', exportDocument: '导出',
  'tool.pencil': '画笔', 'tool.eraser': '橡皮擦', 'tool.selection': '矩形选区', 'tool.selection.ellipse': '椭圆选区', 'tool.move': '移动工具', 'tool.shape': '形状工具', 'tool.fill': '油漆桶', 'tool.eyedropper': '吸管', 'tool.hand': '抓手', 'tool.zoom': '缩放工具', 'tool.rotate': '旋转视图',
  lasso: '套索选区', magic: '魔棒选区', canvasResize: '调整画布大小', imageResize: '调整图像大小', transform: '变换', outline: '描边', flipVertical: '垂直翻转', flipHorizontal: '水平翻转', selectAll: '全选', deselect: '取消选择', createBrushFromSelection: '从选区创建笔刷',
  copy: '复制', cut: '剪切', paste: '粘贴', save: '保存', saveAs: '另存为', undo: '撤销', redo: '重做', relativeLuminance: '查看相对明暗', advancedMode: '高级模式', fillForeground: '填充前景色', createLayerGroup: '新建图层组', ungroupLayers: '解组', deleteLayer: '删除图层或选区', mirrorView: '水平镜像视图', mirrorViewVertical: '垂直镜像视图',
  brushSizeDecrease: '减小笔刷尺寸', brushSizeIncrease: '增大笔刷尺寸', temporaryEyedropper: '临时吸色', copySelectionContent: '复制选区内容', copyLayerOnDrag: '拖动复制图层', constrainAxis: '水平或垂直约束', addToSelection: '加选', snapViewRotation: '八方向旋转', resetViewRotation: '旋转视图复位', temporaryPan: '临时抓手', brushSizeAdjust: '拖动调整笔刷尺寸', lineConnectionMode: '直线连接模式'
}

export function modifierShortcutMatches(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, shortcut: string): boolean {
  const keys = shortcut.toLowerCase().split('+').map((key) => key.trim()).filter(Boolean)
  if (keys.length === 0 || keys.some((key) => !['ctrl', 'alt', 'shift'].includes(key))) return false
  const wantsCtrl = keys.includes('ctrl')
  const wantsAlt = keys.includes('alt')
  const wantsShift = keys.includes('shift')
  return Boolean(event.ctrlKey || event.metaKey) === wantsCtrl && Boolean(event.altKey) === wantsAlt && Boolean(event.shiftKey) === wantsShift
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
  return { ...DEFAULT_SHORTCUTS, ...saved }
}

export function saveShortcuts(shortcuts: ShortcutMap, storage?: Storage): void {
  writeStoredJson(SHORTCUTS_KEY, shortcuts, storage)
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('moonsprite:shortcuts-changed'))
}

export function keyboardEventKey(event: KeyboardEvent): string {
  if (['Process', 'Unidentified', 'Dead'].includes(event.key) && /^Key[A-Z]$/.test(event.code)) return event.code.slice(3)
  return event.key
}

export function shortcutText(event: KeyboardEvent): string {
  const key = keyboardEventKey(event)
  if (key === 'Control' || key === 'Meta') return 'Ctrl'
  if (key === 'Alt') return 'Alt'
  if (key === 'Shift') return 'Shift'
  return `${event.ctrlKey || event.metaKey ? 'Ctrl+' : ''}${event.altKey ? 'Alt+' : ''}${event.shiftKey ? 'Shift+' : ''}${key.length === 1 ? key.toUpperCase() : key}`
}

export interface ShortcutConflict {
  shortcut: string
  winner: ShortcutId
  conflicting: ShortcutId[]
}

export function deriveShortcutConflicts(shortcuts: ShortcutMap): { conflicts: ShortcutConflict[]; blocked: Partial<Record<ShortcutId, ShortcutId>> } {
  const orderedIds = Object.values(SHORTCUT_GROUPS).flat() as ShortcutId[]
  const contextualModifiers = new Set<ShortcutId>(SHORTCUT_GROUPS.modifiers)
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
