import { useMemo, useState, type ReactElement } from 'react'
import { CheckCircle2, FileText, Layers2, Palette, Search } from 'lucide-react'
import type { RgbaColor } from '@shared/types'
import { ColorPicker, type ColorPickerConfig } from './ColorPicker'
import { ColorValueControl } from './ColorValueControl'
import { DeleteIconButton } from './DeleteIconButton'
import { ModalShell } from './ModalShell'
import { NumberInput } from './NumberInput'
import { TextAreaInput } from './TextAreaInput'
import { ThemedSelect, type ThemedSelectGroup } from './ThemedSelect'
import { Tooltip } from './Tooltip'
import { useI18n } from './I18nProvider'
import { PixelCloseIcon as X, PixelDownIcon as ChevronDown, PixelRightIcon as ChevronRight, PixelUtilityIcon, type PixelUtilityIconKind } from './PixelUtilityIcon'
import { PixelCheckbox } from './PixelCheckbox'
import { LivePreviewToggle } from './LivePreviewToggle'
import { BrushDynamicsSettingsPanel } from './app/EditorToolOptions'
import { FILL_KIND_ICONS, SELECTION_KIND_ICONS, fillKindDefinitions, normalEditorToolIconFor, selectionKindDefinitions, shapeKindDefinitions, toolDefinitions } from './app/editor-tools'
import { CURSOR_ICON_LIBRARY } from '@/platform/cursor-theme'
import { translate, type AppLocale, type TranslationKey, type TranslationParams } from '@/core/localization'
import type { BrushDynamicsEffect, BrushDynamicsMapping, BrushDynamicsSettings } from '@/core/pressure'

type ComponentCategory = 'all' | 'controls' | 'forms' | 'panels' | 'dialogs' | 'editor'

export interface ComponentLibraryEntry {
  id: string
  name: string
  category: Exclude<ComponentCategory, 'all'>
  description: string
  source: string
  tags: string[]
}

const categoryLabels: Record<ComponentCategory, TranslationKey> = {
  all: 'componentLibrary.category.all',
  controls: 'componentLibrary.category.controls',
  forms: 'componentLibrary.category.forms',
  panels: 'componentLibrary.category.panels',
  dialogs: 'componentLibrary.category.dialogs',
  editor: 'componentLibrary.category.editor'
}

const tagKeys: Record<string, TranslationKey> = {
  操作: 'componentLibrary.tag.operation', 状态: 'componentLibrary.tag.state', 图标: 'componentLibrary.tag.icon', 工具栏: 'componentLibrary.tag.toolbar', 删除: 'componentLibrary.tag.delete', 危险: 'componentLibrary.tag.danger', 右键: 'componentLibrary.tag.context', 菜单: 'componentLibrary.tag.menu', 模式: 'componentLibrary.tag.mode', 选中: 'componentLibrary.tag.selected', 数字: 'componentLibrary.tag.number', 步进: 'componentLibrary.tag.stepper', 文本: 'componentLibrary.tag.text', 描述: 'componentLibrary.tag.description', 输入: 'componentLibrary.tag.input', 下拉: 'componentLibrary.tag.select', 分组: 'componentLibrary.tag.group', 数值: 'componentLibrary.tag.value', 实时: 'componentLibrary.tag.live', 设置: 'componentLibrary.tag.settings', 复选: 'componentLibrary.tag.checkbox', 开关: 'componentLibrary.tag.switch', 滚动: 'componentLibrary.tag.scroll', 列表: 'componentLibrary.tag.list', 栏目: 'componentLibrary.tag.panel', 停靠: 'componentLibrary.tag.dock', 图层: 'componentLibrary.tag.layer', 拖动: 'componentLibrary.tag.drag', 颜色: 'componentLibrary.tag.color', 多选: 'componentLibrary.tag.multiple', 弹窗: 'componentLibrary.tag.dialog', 布局: 'componentLibrary.tag.layout', 缩放: 'componentLibrary.tag.resize', 提示: 'componentLibrary.tag.feedback', 悬浮: 'componentLibrary.tag.tooltip', 工具: 'componentLibrary.tag.tool', 属性: 'componentLibrary.tag.property', HEX: 'componentLibrary.tag.hex', 通道: 'componentLibrary.tag.channel'
}

const componentText = (locale: AppLocale, key: TranslationKey, params?: TranslationParams): string => translate(locale, key, params)

const pixelIconNames: Partial<Record<PixelUtilityIconKind, string>> = {
  lock: '关锁', unlock: '开锁', eye: '睁眼', eyeOff: '闭眼', properties: '调整', delete: '删除',
  newFolder: '新建文件夹', ungroupFolder: '解组文件夹', plus: '加', minus: '减', close: '叉', up: '上', down: '下',
  left: '左', right: '右', onion: '洋葱皮', more: '更多', moreLines: '更多（横线）', paletteLocal: '选择本地色板',
  paletteCenter: '居中', restore: '恢复', undo: '撤销', redo: '重做', workspace: '工作区', copy: '复制',
  mergeDown: '向下合并', mergeVisible: '合并可见图层', clippingMask: '剪贴蒙版', layerMask: '图层蒙版', folder: '文件夹', folderOpen: '展开文件夹', move: '移动',
  save: '保存', export: '导出', image: '图像', roadmapPlanned: '未完成', roadmapCompleted: '完成',
  info: '信息', canvasCenter: '居中', canvasTop: '上', canvasBottom: '下', canvasLeft: '左', canvasRight: '右',
  canvasTopLeft: '左上', canvasTopRight: '右上', canvasBottomLeft: '左下', canvasBottomRight: '右下',
  checkboxUnchecked: '复选框未选中', checkboxChecked: '复选框选中', pin: '置顶', clearRecords: '清除记录',
  refresh: '刷新', extractColors: '提取颜色', follow: '跟随', check: '选择'
}

const pixelIconNameOverrides: Partial<Record<PixelUtilityIconKind, string>> = { link: '连接', paste: '粘贴' }
const pixelIconTitle = (kind: PixelUtilityIconKind): string => `名称: ${pixelIconNameOverrides[kind] ?? pixelIconNames[kind] ?? kind} · ID: ${kind}`
const iconLibraryTitle = (name: string, id: string): string => `名称: ${name} · ID: ${id}`

const cursorNames: Record<string, { zh: string; en: string }> = {
  default: { zh: '默认指针', en: 'Default pointer' }, help: { zh: '帮助指针', en: 'Help pointer' }, progress: { zh: '进度指针', en: 'Progress pointer' }, wait: { zh: '等待指针', en: 'Wait pointer' }, project: { zh: '项目指针', en: 'Project pointer' }, crosshair: { zh: '十字指针', en: 'Crosshair pointer' }, text: { zh: '文本指针', en: 'Text pointer' }, pointer: { zh: '指向指针', en: 'Pointer' },
  'pencil-black': { zh: '铅笔指针（深色）', en: 'Pencil pointer (dark)' }, 'pencil-white': { zh: '铅笔指针（浅色）', en: 'Pencil pointer (light)' }, 'selection-black': { zh: '选区指针（深色）', en: 'Selection pointer (dark)' }, 'selection-white': { zh: '选区指针（浅色）', en: 'Selection pointer (light)' }, unavailable: { zh: '不可用指针', en: 'Unavailable pointer' }, grab: { zh: '抓取指针', en: 'Grab pointer' }, grabbing: { zh: '抓取中指针', en: 'Grabbing pointer' }, move: { zh: '移动指针', en: 'Move pointer' }, 'swatch-edge': { zh: '色格边缘指针', en: 'Swatch edge pointer' }, eyedropper: { zh: '吸管指针', en: 'Eyedropper pointer' }, 'selection-move': { zh: '选区移动指针', en: 'Selection move pointer' }, copy: { zh: '复制指针', en: 'Copy pointer' }, zoom: { zh: '缩放指针', en: 'Zoom pointer' }, rotate: { zh: '旋转指针', en: 'Rotate pointer' }, 'ns-resize': { zh: '上下调整指针', en: 'Vertical resize pointer' }, 'n-resize': { zh: '向上调整指针', en: 'North resize pointer' }, 'ew-resize': { zh: '左右调整指针', en: 'Horizontal resize pointer' }, 'nwse-resize': { zh: '左上右下调整指针', en: 'Diagonal resize pointer' }, 'nesw-resize': { zh: '右上左下调整指针', en: 'Diagonal resize pointer' }, 'selection-rotate-n': { zh: '选区上方旋转指针', en: 'Selection rotate north pointer' }, 'selection-rotate-ne': { zh: '选区右上旋转指针', en: 'Selection rotate NE pointer' }, 'selection-rotate-se': { zh: '选区右下旋转指针', en: 'Selection rotate SE pointer' }, 'selection-rotate-s': { zh: '选区下方旋转指针', en: 'Selection rotate south pointer' }, 'selection-rotate-sw': { zh: '选区左下旋转指针', en: 'Selection rotate SW pointer' }, 'selection-rotate-nw': { zh: '选区左上旋转指针', en: 'Selection rotate NW pointer' }, 'selection-shear-horizontal': { zh: '选区水平倾斜指针', en: 'Selection horizontal shear pointer' }, 'selection-shear-vertical': { zh: '选区垂直倾斜指针', en: 'Selection vertical shear pointer' }
}

const cursorLibraryItems = (locale: AppLocale) => CURSOR_ICON_LIBRARY.flatMap((item) => {
  const key = item.variable.replace('--cursor-', '')
  const names = cursorNames[key] ?? { zh: key, en: key }
  const name = locale === 'zh-CN' ? names.zh : names.en
  const base = { id: `cursor.${key}`, name, source: item.source, builtinSource: item.builtinSource }
  return item.builtinSource && item.builtinSource !== item.source
    ? [base, { ...base, id: `${base.id}.builtin`, name: `${name}${locale === 'zh-CN' ? '（内置）' : ' (built-in)'}`, source: item.builtinSource, builtinSource: item.builtinSource }]
    : [base]
})

const toolLibraryItems = (locale: AppLocale) => {
  const primaryTools = toolDefinitions(locale).filter((item) => item.id !== 'selection' && item.id !== 'shape' && item.id !== 'fill')
  const items = [
    ...primaryTools.map((item) => ({ id: `tool.${item.id}`, name: item.label, largeSource: item.icon })),
    ...selectionKindDefinitions(locale).map((item) => ({ id: `tool.selection.${item.id}`, name: item.label, largeSource: SELECTION_KIND_ICONS[item.id] })),
    ...shapeKindDefinitions(locale).map((item) => ({ id: `tool.shape.${item.id}`, name: item.label, largeSource: item.icon })),
    ...fillKindDefinitions(locale).map((item) => ({ id: `tool.fill.${item.id}`, name: item.label, largeSource: FILL_KIND_ICONS[item.id] }))
  ]
  return items.flatMap((item) => {
    const normalSource = normalEditorToolIconFor(item.largeSource)
    return normalSource ? [{ ...item, normalSource }] : []
  })
}

const localizeEntry = (entry: ComponentLibraryEntry, locale: AppLocale): ComponentLibraryEntry => ({
  ...entry,
  name: componentText(locale, `componentLibrary.entry.${entry.id}.name` as TranslationKey),
  description: componentText(locale, `componentLibrary.entry.${entry.id}.description` as TranslationKey),
  tags: entry.tags.map((tag) => componentText(locale, tagKeys[tag] ?? 'componentLibrary.tag.operation'))
})

export const COMPONENT_LIBRARY_ENTRIES: ComponentLibraryEntry[] = [
  { id: 'buttons', name: '按钮组', category: 'controls', description: '主要操作、次要操作和危险操作使用同一组尺寸与状态。', source: '.primary-button / .quiet-button / .danger-button', tags: ['操作', '状态'] },
  { id: 'icon-button', name: '图标按钮', category: 'controls', description: '工具栏和面板标题中的方形图标操作。', source: '.icon-button', tags: ['图标', '工具栏'] },
  { id: 'pixel-utility-icon', name: '像素状态图标', category: 'controls', description: '界面状态与操作使用的 5×5、6×6 或 11×11 像素图标，以整数比例显示。', source: 'PixelUtilityIcon', tags: ['图标', '状态', '操作'] },
  { id: 'tool-icons', name: '工具图标', category: 'editor', description: '工具、选区、形状、填充、渐变和不同尺寸的像素工具图标。', source: 'editor-tools.tsx / PixelAssetIcon', tags: ['图标', '工具', '工具栏'] },
  { id: 'pointer-icons', name: '指针图标', category: 'editor', description: '画布、选区、缩放、旋转和调整操作使用的像素指针。', source: 'platform/cursor-theme.ts', tags: ['图标', '工具'] },
  { id: 'delete-icon-button', name: '删除图标按钮', category: 'controls', description: '用于删除预设或列表项目的统一危险图标按钮，提供紧凑、常规和禁用状态。', source: 'DeleteIconButton', tags: ['删除', '危险', '图标'] },
  { id: 'context-menu', name: '上下文菜单', category: 'controls', description: '通过右键或更多操作打开的紧凑菜单，支持图标、禁用和危险操作状态。', source: '.context-menu / .context-menu-item', tags: ['右键', '菜单', '操作'] },
  { id: 'segmented', name: '分段选择', category: 'controls', description: '用于工具模式、视图模式和互斥选项。', source: '.segmented-control', tags: ['模式', '选中'] },
  { id: 'number-input', name: '数值输入', category: 'forms', description: '统一的数字输入、步进按钮和边界限制。', source: 'NumberInput', tags: ['数字', '步进'] },
  { id: 'text-area-input', name: '多行文本输入', category: 'forms', description: '用于描述和备注的固定尺寸多行输入，不允许用户拖动改变大小。', source: 'TextAreaInput', tags: ['文本', '描述', '输入'] },
  { id: 'themed-select', name: '主题下拉', category: 'forms', description: '带分组、选中标记和键盘导航的下拉菜单。', source: 'ThemedSelect', tags: ['下拉', '分组'] },
  { id: 'range', name: '滑块', category: 'forms', description: '适用于尺寸、不透明度、强度等连续数值。', source: '.brush-size-popover input[type=range]', tags: ['数值', '实时'] },
  { id: 'checkbox', name: '复选框', category: 'forms', description: '用于可以同时启用的独立选项。', source: 'PixelCheckbox', tags: ['设置', '复选'] },
  { id: 'switch', name: '开关', category: 'forms', description: '用于明确的开启与关闭状态。', source: '.preference-toggle / .outline-preview-toggle', tags: ['设置', '开关'] },
  { id: 'live-preview-toggle', name: '实时预览开关', category: 'forms', description: '调整类弹窗用于开启或关闭实时预览的统一开关。', source: 'LivePreviewToggle', tags: ['实时', '开关', '弹窗'] },
  { id: 'scrollbar', name: '滚动区域', category: 'forms', description: '下拉菜单和长列表使用的统一滚动条。', source: '.component-scrollbar', tags: ['滚动', '列表'] },
  { id: 'panel-header', name: '栏目标题', category: 'panels', description: '停靠栏目标题、拖动入口和右侧操作。', source: '.panel-header', tags: ['栏目', '停靠'] },
  { id: 'layer-row', name: '图层行', category: 'panels', description: '可见性、锁定、组图标、名称、混合模式和拖动状态。', source: 'LayersPanel', tags: ['图层', '拖动'] },
  { id: 'swatches', name: '颜色格', category: 'panels', description: '调色板中的居中描边、选中外框和多选状态。', source: '.swatch-grid / .swatch', tags: ['颜色', '多选'] },
  { id: 'modal-shell', name: '弹窗框架', category: 'dialogs', description: '统一标题、内容、底部操作、拖动、八向缩放和尺寸位置记忆。', source: 'ModalShell / .modal-backdrop', tags: ['弹窗', '布局', '缩放'] },
  { id: 'save-progress', name: '文件操作进度', category: 'dialogs', description: '用于导出和保存过程的进度、完成确认与顶层反馈。', source: '.save-progress-modal', tags: ['弹窗', '状态', '反馈'] },
  { id: 'status', name: '状态提示', category: 'dialogs', description: '用于操作反馈、模式提示和不可用状态。', source: '.statusbar / .advanced-mode-notice', tags: ['提示', '反馈'] },
  { id: 'tooltip', name: '悬浮提示', category: 'dialogs', description: '用于描述等较长内容的自定义悬浮提示，自动避开视口边缘。', source: 'Tooltip', tags: ['提示', '悬浮', '描述'] },
  { id: 'tool-options', name: '工具属性栏', category: 'editor', description: '工具名称、参数、模式和撤销重做操作。', source: '.tool-options', tags: ['工具', '属性'] },
  { id: 'pressure-options', name: '笔刷动态工具属性', category: 'editor', description: '铅笔与橡皮的压力/速度映射、渐变效果、实时传感器条和禁用状态。', source: 'BrushDynamicsSettingsPanel / .pressure-popover', tags: ['工具', '设置', '传感器'] },
  { id: 'color-picker', name: '颜色选择器', category: 'editor', description: '色盘、色相、透明度、前景色和背景色。', source: 'ColorPicker', tags: ['颜色', '实时'] },
  { id: 'color-value', name: '颜色值按钮', category: 'editor', description: '颜色预览、HEX 文本和 RGB/HSV/HSL/Gray 多模式编辑。', source: 'ColorValueControl', tags: ['颜色', 'HEX', '通道'] },
  { id: 'panel-dock', name: '停靠栏目', category: 'editor', description: '右侧、左侧和底部停靠区的容器行为。', source: 'InspectorPanels', tags: ['布局', '停靠'] }
]

const initialColor: RgbaColor = { r: 41, g: 121, b: 255, a: 255 }
const selectGroups: Array<{ labelKey: TranslationKey; options: Array<{ value: string; labelKey: TranslationKey }> }> = [
  { labelKey: 'blend.group.basic', options: [{ value: 'normal', labelKey: 'blend.normal' }] },
  { labelKey: 'blend.group.darken', options: [{ value: 'darken', labelKey: 'blend.darken' }, { value: 'multiply', labelKey: 'blend.multiply' }, { value: 'color-burn', labelKey: 'blend.colorBurn' }, { value: 'linear-burn', labelKey: 'blend.linearBurn' }] },
  { labelKey: 'blend.group.lighten', options: [{ value: 'lighten', labelKey: 'blend.lighten' }, { value: 'screen', labelKey: 'blend.screen' }, { value: 'color-dodge', labelKey: 'blend.colorDodge' }, { value: 'linear-dodge', labelKey: 'blend.linearDodge' }] },
  { labelKey: 'blend.group.contrast', options: [{ value: 'overlay', labelKey: 'blend.overlay' }, { value: 'soft-light', labelKey: 'blend.softLight' }, { value: 'hard-light', labelKey: 'blend.hardLight' }, { value: 'vivid-light', labelKey: 'blend.vividLight' }] },
  { labelKey: 'blend.group.compare', options: [{ value: 'difference', labelKey: 'blend.difference' }, { value: 'exclusion', labelKey: 'blend.exclusion' }, { value: 'subtract', labelKey: 'blend.subtract' }, { value: 'divide', labelKey: 'blend.divide' }] }
]

const colorPickerVariants: Array<{ id: string; labelKey: TranslationKey; config: ColorPickerConfig }> = [
  { id: 'moon-square', labelKey: 'componentLibrary.preview.variant.moonSquare', config: { scheme: 'moon-ring', hueSteps: 0, colorSteps: 0, moonField: 'hsv-square' } },
  { id: 'moon-triangle', labelKey: 'componentLibrary.preview.variant.moonTriangle', config: { scheme: 'moon-ring', hueSteps: 0, colorSteps: 0, moonField: 'hsl-triangle' } },
  { id: 'sv-square', labelKey: 'componentLibrary.preview.variant.svSquare', config: { scheme: 'sv-square', hueSteps: 0, colorSteps: 0 } },
  { id: 'hs-square', labelKey: 'componentLibrary.preview.variant.hsSquare', config: { scheme: 'hs-square', hueSteps: 0, colorSteps: 0 } },
  { id: 'wheel', labelKey: 'componentLibrary.preview.variant.wheel', config: { scheme: 'wheel', hueSteps: 0, colorSteps: 0 } }
]

function ButtonsPreview({ locale }: { locale: AppLocale }) {
  return <div className="component-preview-row"><button className="primary-button" type="button"><PixelUtilityIcon kind="plus" />{componentText(locale, 'componentLibrary.preview.new')}</button><button className="quiet-button" type="button">{componentText(locale, 'componentLibrary.preview.cancel')}</button><button className="danger-button" type="button"><PixelUtilityIcon kind="delete" />{componentText(locale, 'componentLibrary.preview.delete')}</button><button className="quiet-button" type="button" disabled>{componentText(locale, 'componentLibrary.preview.disabled')}</button></div>
}

function IconButtonPreview({ locale }: { locale: AppLocale }) {
  return <div className="component-preview-row"><button className="icon-button" type="button" aria-label={componentText(locale, 'componentLibrary.preview.copy')}><PixelUtilityIcon kind="copy" /></button><button className="icon-button active" type="button" aria-label={componentText(locale, 'componentLibrary.preview.settings')}><PixelUtilityIcon kind="properties" /></button><button className="icon-button" type="button" aria-label={componentText(locale, 'componentLibrary.preview.delete')}><PixelUtilityIcon kind="delete" /></button></div>
}

function DeleteIconButtonPreview({ locale }: { locale: AppLocale }) {
  return <div className="component-preview-row"><DeleteIconButton aria-label={componentText(locale, 'componentLibrary.preview.deletePreset')} /><DeleteIconButton aria-label={componentText(locale, 'componentLibrary.preview.deleteColor')} size="regular" /><DeleteIconButton aria-label={componentText(locale, 'componentLibrary.preview.deleteDisabled')} disabled /></div>
}

function ContextMenuPreview({ locale }: { locale: AppLocale }) {
  const [open, setOpen] = useState(true)
  return <div className="component-context-menu-preview">
    <button className="icon-button" type="button" aria-label={componentText(locale, 'componentLibrary.preview.openContext')} aria-expanded={open} onClick={() => setOpen((value) => !value)}><PixelUtilityIcon kind="more" /></button>
    {open && <div className="context-menu component-context-menu-demo" role="menu" aria-label={componentText(locale, 'componentLibrary.preview.openContext')}>
      <button className="context-menu-item" type="button" role="menuitem" onClick={() => setOpen(false)}><X size={15} /><span>{componentText(locale, 'componentLibrary.preview.close')}</span></button>
      <button className="context-menu-item" type="button" role="menuitem" onClick={() => setOpen(false)}><PixelUtilityIcon kind="copy" /><span>{componentText(locale, 'componentLibrary.preview.duplicateView')}</span></button>
      <button className="context-menu-item" type="button" role="menuitem" disabled><PixelUtilityIcon kind="folderOpen" /><span>{componentText(locale, 'componentLibrary.preview.openFolder')}</span></button>
    </div>}
  </div>
}

function SegmentedPreview({ locale }: { locale: AppLocale }) {
  const items = [componentText(locale, 'componentLibrary.preview.brush'), componentText(locale, 'componentLibrary.preview.eraser'), componentText(locale, 'componentLibrary.preview.move')]
  const [selected, setSelected] = useState(items[0])
  return <div className="segmented-control component-segmented-preview" role="group" aria-label={componentText(locale, 'componentLibrary.preview.mode')}>{items.map((item) => <button key={item} type="button" className={selected === item ? 'selected' : ''} onClick={() => setSelected(item)}>{item}</button>)}</div>
}

function NumberInputPreview({ locale }: { locale: AppLocale }) {
  const [value, setValue] = useState(16)
  const [untitledValue, setUntitledValue] = useState(8)
  const [sliderValue, setSliderValue] = useState(24)
  const [sliderOpen, setSliderOpen] = useState(false)
  return <div className="component-number-input-preview">
    <label className="component-number-input-row"><span>{componentText(locale, 'componentLibrary.preview.size')}</span><NumberInput value={value} min={1} max={128} suffix="px" onValueChange={setValue} /></label>
    <div className="component-number-input-row component-number-input-no-label"><NumberInput aria-label={componentText(locale, 'componentLibrary.preview.untitledNumber')} value={untitledValue} min={1} max={128} suffix="px" onValueChange={setUntitledValue} /></div>
    <label className="component-number-input-row"><span>{componentText(locale, 'componentLibrary.preview.hintNumber')}</span><NumberInput className="component-number-input-hint-input" aria-label={componentText(locale, 'componentLibrary.preview.hintNumber')} value="" min={1} max={128} placeholder={componentText(locale, 'componentLibrary.preview.enterNumber')} onValueChange={() => undefined} /></label>
    <label className="component-number-input-row"><span>{componentText(locale, 'componentLibrary.preview.size')}</span><div className="brush-size-control component-number-input-slider" onPointerDown={() => setSliderOpen(true)}><NumberInput aria-label={componentText(locale, 'componentLibrary.preview.sliderNumber')} value={sliderValue} min={1} max={128} suffix="px" onValueChange={setSliderValue} onFocus={() => setSliderOpen(true)} />{sliderOpen && <div className="brush-size-popover" role="dialog" aria-label={componentText(locale, 'componentLibrary.preview.adjustNumber')}><input aria-label={componentText(locale, 'componentLibrary.preview.valueSlider')} type="range" min="1" max="128" value={sliderValue} onChange={(event) => setSliderValue(Number(event.target.value))} /><strong>{sliderValue}px</strong></div>}</div></label>
  </div>
}

function TextAreaInputPreview({ locale }: { locale: AppLocale }) {
  const [value, setValue] = useState(() => componentText(locale, 'componentLibrary.preview.descriptionValue'))
  return <div className="component-preview-form"><label className="component-preview-label">{componentText(locale, 'componentLibrary.preview.description')}</label><TextAreaInput aria-label={componentText(locale, 'componentLibrary.preview.descriptionInput')} rows={4} value={value} placeholder={componentText(locale, 'componentLibrary.preview.enterDescription')} onChange={(event) => setValue(event.target.value)} /></div>
}

function SelectPreview({ locale }: { locale: AppLocale }) {
  const [value, setValue] = useState('normal')
  const groups: Array<ThemedSelectGroup<string>> = selectGroups.map((group) => ({ label: componentText(locale, group.labelKey), options: group.options.map((option) => ({ value: option.value, label: componentText(locale, option.labelKey) })) }))
  return <div className="component-preview-form"><label className="component-preview-label">{componentText(locale, 'componentLibrary.preview.blendMode')}</label><ThemedSelect value={value} groups={groups} label={componentText(locale, 'componentLibrary.preview.blendMode')} onChange={setValue} /></div>
}

function RangePreview({ locale }: { locale: AppLocale }) {
  const [value, setValue] = useState(64)
  return <div className="component-preview-stack"><label className="component-preview-label">{componentText(locale, 'componentLibrary.preview.brushSize')} <strong>{value}px</strong></label><input className="component-library-range" type="range" min="1" max="128" value={value} onChange={(event) => setValue(Number(event.target.value))} /></div>
}

function CheckboxPreview({ locale }: { locale: AppLocale }) {
  const [checked, setChecked] = useState(true)
  return <label className="tool-checkbox component-preview-checkbox"><PixelCheckbox checked={checked} onChange={(event) => setChecked(event.target.checked)} />{componentText(locale, 'componentLibrary.preview.perfectPixels')}</label>
}

function SwitchPreview({ locale }: { locale: AppLocale }) {
  const [checked, setChecked] = useState(true)
  return <label className="preference-toggle outline-preview-toggle component-library-toggle"><span>{componentText(locale, 'componentLibrary.preview.autoSelect')}</span><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} /><span className="toggle-track" aria-hidden="true"><i /></span></label>
}

function LivePreviewTogglePreview() {
  const [checked, setChecked] = useState(true)
  return <LivePreviewToggle checked={checked} onChange={setChecked} />
}

function ScrollbarPreview({ locale }: { locale: AppLocale }) {
  return <div className="component-scroll-preview component-scrollbar" tabIndex={0} aria-label={componentText(locale, 'componentLibrary.preview.scrollArea')}>{Array.from({ length: 12 }, (_, index) => <div key={index}><span>{String(index + 1).padStart(2, '0')}</span><strong>{componentText(locale, 'componentLibrary.preview.listItem', { index: index + 1 })}</strong></div>)}</div>
}

function PanelHeaderPreview({ locale }: { locale: AppLocale }) {
  return <div className="component-panel-preview"><header className="component-panel-header"><div><span className="eyebrow">PANEL</span><strong>{componentText(locale, 'componentLibrary.preview.panel')}</strong></div><div className="component-preview-row compact"><button className="icon-button" type="button" aria-label={componentText(locale, 'componentLibrary.preview.show')}><PixelUtilityIcon kind="eye" /></button><button className="icon-button" type="button" aria-label={componentText(locale, 'componentLibrary.preview.settings')}><PixelUtilityIcon kind="properties" /></button></div></header><div className="component-panel-content"><Layers2 size={18} /><span>{componentText(locale, 'componentLibrary.preview.draggablePanel')}</span></div></div>
}

function PixelUtilityIconPreview() {
  const [locked, setLocked] = useState(true)
  const [visible, setVisible] = useState(true)
    const kinds = ['properties', 'delete', 'newFolder', 'ungroupFolder', 'plus', 'minus', 'close', 'up', 'down', 'left', 'right', 'onion', 'more', 'moreLines', 'paletteLocal', 'paletteCenter', 'restore', 'undo', 'redo', 'workspace', 'copy', 'link', 'paste', 'mergeDown', 'mergeVisible', 'clippingMask', 'layerMask', 'folder', 'folderOpen', 'move', 'save', 'export', 'image', 'roadmapPlanned', 'roadmapCompleted', 'info', 'canvasCenter', 'canvasTop', 'canvasBottom', 'canvasLeft', 'canvasRight', 'canvasTopLeft', 'canvasTopRight', 'canvasBottomLeft', 'canvasBottomRight', 'checkboxUnchecked', 'checkboxChecked', 'pin', 'clearRecords', 'refresh', 'extractColors', 'follow', 'check'] as const
  return <div className="component-preview-row"><button type="button" title={pixelIconTitle(locked ? 'lock' : 'unlock')} className={locked ? 'icon-button selected' : 'icon-button'} aria-label={pixelIconTitle(locked ? 'lock' : 'unlock')} aria-pressed={locked} onClick={() => setLocked((value) => !value)}><PixelUtilityIcon kind={locked ? 'lock' : 'unlock'} /></button><button type="button" title={pixelIconTitle(visible ? 'eye' : 'eyeOff')} className={visible ? 'icon-button selected' : 'icon-button'} aria-label={pixelIconTitle(visible ? 'eye' : 'eyeOff')} aria-pressed={visible} onClick={() => setVisible((value) => !value)}><PixelUtilityIcon kind={visible ? 'eye' : 'eyeOff'} /></button>{kinds.map((kind) => <button key={kind} type="button" className="icon-button" title={pixelIconTitle(kind)} aria-label={pixelIconTitle(kind)}><PixelUtilityIcon kind={kind} /></button>)}<button type="button" className="icon-button" title={pixelIconTitle('lock')} aria-label={pixelIconTitle('lock')} disabled><PixelUtilityIcon kind="lock" /></button></div>
}

function ToolIconPreview({ locale }: { locale: AppLocale }) {
  const items = toolLibraryItems(locale)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const renderItems = (group: 'small' | 'large') => <div className={`component-icon-library-grid component-tool-icon-grid component-tool-icon-grid-${group}`}>{items.map((item) => {
    const id = group === 'small' ? `${item.id}.normal` : item.id
    const name = group === 'small' ? `${item.name}${locale === 'zh-CN' ? '（正常）' : ' (normal)'}` : item.name
    const source = group === 'small' ? item.normalSource : item.largeSource
    const title = iconLibraryTitle(name, id)
    return <button key={id} type="button" className={`component-icon-library-button ${selectedId === id ? 'selected' : ''}`} title={title} aria-label={title} aria-pressed={selectedId === id} onClick={() => setSelectedId((current) => current === id ? null : id)}><span className="pixel-asset-icon component-library-asset-icon" style={{ '--pixel-icon-source': `url("${source}")`, '--pixel-icon-normal-source': `url("${source}")` } as React.CSSProperties} aria-hidden="true" /></button>
  })}</div>
  return <div className="component-tool-icon-groups" aria-label={locale === 'zh-CN' ? '工具图标库' : 'Tool icon library'}><section><h4>{locale === 'zh-CN' ? '正常尺寸' : 'Normal size'}</h4>{renderItems('small')}</section><section><h4>{locale === 'zh-CN' ? '大号尺寸' : 'Large size'}</h4>{renderItems('large')}</section></div>
}

function PointerIconPreview({ locale }: { locale: AppLocale }) {
  const items = cursorLibraryItems(locale)
  return <div className="component-icon-library-grid component-pointer-icon-grid" aria-label={locale === 'zh-CN' ? '指针图标库' : 'Pointer icon library'}>{items.map((item) => {
    const title = iconLibraryTitle(item.name, item.id)
    return <span key={item.id} className="component-pointer-icon" title={title} aria-label={title} role="img"><img src={item.source} alt="" /></span>
  })}</div>
}

function LayerRowPreview({ locale }: { locale: AppLocale }) {
  const [selected, setSelected] = useState(true)
  const [visible, setVisible] = useState(true)
  const [locked, setLocked] = useState(false)
  return <div className="component-layer-list-preview"><button className={`layer-row ${selected ? 'selected' : ''}`} type="button" onClick={() => setSelected((value) => !value)}><span className="layer-color-stripe" style={{ backgroundColor: '#ef5350' }} aria-hidden="true" /><span className="layer-visibility" role="button" tabIndex={-1} aria-label={visible ? componentText(locale, 'componentLibrary.preview.hideLayer') : componentText(locale, 'componentLibrary.preview.showLayer')} onClick={(event) => { event.stopPropagation(); setVisible((value) => !value) }}>{visible ? <PixelUtilityIcon kind="eye" /> : <PixelUtilityIcon kind="eyeOff" />}</span><span className={`layer-lock-toggle ${locked ? 'locked' : ''}`} role="button" tabIndex={-1} aria-label={locked ? componentText(locale, 'componentLibrary.preview.unlockLayer') : componentText(locale, 'componentLibrary.preview.lockLayer')} onClick={(event) => { event.stopPropagation(); setLocked((value) => !value) }}>{locked ? <PixelUtilityIcon kind="lock" /> : <PixelUtilityIcon kind="unlock" />}</span><Tooltip className="layer-name" content={componentText(locale, 'componentLibrary.preview.layerDescription')}><span>{componentText(locale, 'componentLibrary.preview.foregroundLayer')}</span><small>{componentText(locale, 'componentLibrary.preview.normalOpacity')}</small></Tooltip></button><button className="layer-row group-row" type="button"><span className="layer-visibility" role="button" tabIndex={-1} aria-label={componentText(locale, 'componentLibrary.preview.showLayer')}><PixelUtilityIcon kind="eye" /></span><span className="layer-lock-toggle" role="button" tabIndex={-1} aria-label={componentText(locale, 'componentLibrary.preview.lockLayer')}><PixelUtilityIcon kind="unlock" /></span><span className="group-folder" role="button" tabIndex={-1} aria-label={componentText(locale, 'componentLibrary.preview.collapseGroup')}><PixelUtilityIcon kind="folderOpen" /></span><span className="layer-name"><span>{componentText(locale, 'componentLibrary.preview.group')}</span><small>{componentText(locale, 'componentLibrary.preview.normalOpacity')}</small></span></button></div>
}

function SwatchesPreview({ locale }: { locale: AppLocale }) {
  const colors = ['#2979ff', '#f1f4f8', null, '#ff6600', '#59c36a', null, '#b43f54', '#8d6cff', 'transparent', null, null, '#1f2330', null, '#ffd166', null, null]
  const [selected, setSelected] = useState<number[]>([0])
  const range = selected.length > 0 ? selected.reduce((current, index) => ({ left: Math.min(current.left, index % 8), top: Math.min(current.top, Math.floor(index / 8)), right: Math.max(current.right, index % 8), bottom: Math.max(current.bottom, Math.floor(index / 8)) }), { left: selected[0] % 8, top: Math.floor(selected[0] / 8), right: selected[0] % 8, bottom: Math.floor(selected[0] / 8) }) : null
  return <div className="swatch-grid component-scrollbar component-swatch-preview" style={{ '--swatch-size': '32px', '--palette-columns': 8 } as React.CSSProperties}>{colors.map((color, index) => <button key={index} className={`swatch palette-slot ${color === null ? 'empty' : 'occupied'} ${selected.includes(index) ? 'selected' : ''} ${index === 0 ? 'primary' : ''} ${color === 'transparent' ? 'transparent' : ''}`} type="button" aria-label={componentText(locale, 'componentLibrary.preview.color', { color: color ?? 'empty' })} aria-pressed={selected.includes(index)} style={color === null ? undefined : { '--swatch-color': color, '--swatch-corner-color': ['#f1f4f8', '#ff6600', '#59c36a'].includes(color) ? '#0f1116' : '#ffffff' } as React.CSSProperties} onClick={(event) => setSelected((current) => event.shiftKey ? current.includes(index) ? current.filter((item) => item !== index) : [...current, index] : [index])} />)}{range && <span data-palette-selection-outline className="palette-selection-box" aria-hidden="true" style={{ '--palette-selection-left': range.left, '--palette-selection-top': range.top, '--palette-selection-width': range.right - range.left + 1, '--palette-selection-height': range.bottom - range.top + 1 } as React.CSSProperties} />}</div>
}

function ModalShellPreview({ locale }: { locale: AppLocale }) {
  return <div className="component-modal-preview"><div className="component-modal-window"><header><div><span className="eyebrow">PREVIEW</span><strong>{componentText(locale, 'componentLibrary.preview.title')}</strong></div><button className="icon-button" type="button" aria-label={componentText(locale, 'componentLibrary.preview.close')}><X size={15} /></button></header><div className="component-modal-body"><PixelUtilityIcon kind="info" /><span>{componentText(locale, 'componentLibrary.preview.modalContent')}</span></div><footer><button className="quiet-button" type="button">{componentText(locale, 'componentLibrary.preview.cancel')}</button><button className="primary-button" type="button">{componentText(locale, 'componentLibrary.preview.ok')}</button></footer></div></div>
}

function SaveProgressPreview({ locale }: { locale: AppLocale }) {
  const [complete, setComplete] = useState(false)
  const value = complete ? 100 : 64
  return <div className="component-save-progress-preview"><section className={`save-progress-modal component-save-progress-card ${complete ? 'is-complete' : ''}`}>
    <header><div className="save-progress-heading"><span className="save-progress-icon" aria-hidden="true">{complete ? <CheckCircle2 size={20} /> : <span className="save-progress-animation" />}</span><div><span className="eyebrow">FILE OPERATION</span><h2>{componentText(locale, complete ? 'componentLibrary.preview.exportComplete' : 'componentLibrary.preview.exporting')}</h2></div></div></header>
    <div className="save-progress-body"><strong>{componentText(locale, complete ? 'componentLibrary.preview.videoExported' : 'componentLibrary.preview.encodingVideo')}</strong><div className="save-progress-track"><i style={{ width: `${value}%` }} /></div><div className="save-progress-meta"><span>{componentText(locale, complete ? 'app.progress.complete' : 'app.progress.processing')}</span><small>{value}%</small></div></div>
    <footer><button className={complete ? 'primary-button' : 'quiet-button'} type="button" onClick={() => setComplete((current) => !current)}>{componentText(locale, complete ? 'componentLibrary.preview.ok' : 'componentLibrary.preview.finishExport')}</button></footer>
  </section></div>
}

function StatusPreview({ locale }: { locale: AppLocale }) {
  return <div className="advanced-mode-notice component-library-status-preview" role="status"><strong>{componentText(locale, 'componentLibrary.preview.advancedEnabled')}</strong><small>{componentText(locale, 'componentLibrary.preview.restoreShortcut')}</small></div>
}

function TooltipPreview({ locale }: { locale: AppLocale }) {
  return <div className="component-tooltip-preview"><Tooltip content={componentText(locale, 'componentLibrary.preview.tooltipContent')}><button className="quiet-button" type="button">{componentText(locale, 'componentLibrary.preview.hoverDescription')}</button></Tooltip></div>
}

function ToolOptionsPreview({ locale }: { locale: AppLocale }) {
  return <div className="component-tool-options-preview"><strong>{componentText(locale, 'componentLibrary.preview.brush')}</strong><button className="quiet-button" type="button">{componentText(locale, 'componentLibrary.preview.back')}</button><label>{componentText(locale, 'componentLibrary.preview.size')} <NumberInput value={4} min={1} max={128} onValueChange={() => undefined} /></label><span className="component-preview-spacer" /><button className="tool-text-button" type="button">{componentText(locale, 'componentLibrary.preview.undo')}</button><button className="tool-text-button" type="button">{componentText(locale, 'componentLibrary.preview.redo')}</button></div>
}

function PressureOptionsPreview({ locale }: { locale: AppLocale }) {
  const [mode, setMode] = useState<'off' | 'on' | 'intrinsic'>('on')
  const [tool, setTool] = useState<'pencil' | 'eraser'>('pencil')
  const [perfectPixels, setPerfectPixels] = useState(true)
  const [panelOpen, setPanelOpen] = useState(true)
  const [settings, setSettings] = useState<BrushDynamicsSettings>({
    version: 4,
    effects: {
      size: { sensor: null, outputMin: 20, outputMax: 100, inputMin: 0, inputMax: 70, curve: 'hard', direction: 'direct' },
      strength: { sensor: null, outputMin: 25, outputMax: 100, inputMin: 50, inputMax: 2400, curve: 'linear', direction: 'inverse' },
      gradient: { sensor: 'pressure', outputMin: 0, outputMax: 100, inputMin: 0, inputMax: 70, curve: 'hard', direction: 'direct' }
    },
    gradientDither: 'bayer-4'
  })
  const selectMode = (nextMode: 'off' | 'on' | 'intrinsic'): void => {
    setMode(nextMode)
    setPanelOpen(true)
    setSettings((current) => ({
      ...current,
      effects: {
        size: { ...current.effects.size, sensor: nextMode === 'off' ? null : 'pressure', inputMin: 0, inputMax: 70, curve: 'hard' },
        strength: { ...current.effects.strength, sensor: nextMode === 'off' ? null : 'speed', inputMin: 50, inputMax: 2400, curve: 'linear' },
        gradient: { ...current.effects.gradient, sensor: nextMode === 'off' ? null : 'pressure', inputMin: 0, inputMax: 70, curve: 'hard' }
      }
    }))
  }
  const updateMapping = (effect: BrushDynamicsEffect, patch: Partial<BrushDynamicsMapping>): void => {
    setSettings((current) => ({ ...current, effects: { ...current.effects, [effect]: { ...current.effects[effect], ...patch } } }))
    if (patch.sensor) setMode((current) => current === 'intrinsic' ? current : 'on')
  }
  return <div className="component-pressure-preview">
    <div className="component-pressure-preview-modes">
      <div className="segmented-control" aria-label={componentText(locale, 'componentLibrary.preview.pressureState')}>
        <button className={mode === 'off' ? 'selected' : ''} type="button" onClick={() => selectMode('off')}>{componentText(locale, 'componentLibrary.preview.pressureOff')}</button>
        <button className={mode === 'on' ? 'selected' : ''} type="button" onClick={() => selectMode('on')}>{componentText(locale, 'componentLibrary.preview.pressureOn')}</button>
        <button className={mode === 'intrinsic' ? 'selected' : ''} type="button" onClick={() => selectMode('intrinsic')}>{componentText(locale, 'componentLibrary.preview.pressureIntrinsic')}</button>
      </div>
      <div className="segmented-control" aria-label={componentText(locale, 'componentLibrary.preview.mode')}>
        <button className={tool === 'pencil' ? 'selected' : ''} type="button" onClick={() => setTool('pencil')}>{componentText(locale, 'componentLibrary.preview.brush')}</button>
        <button className={tool === 'eraser' ? 'selected' : ''} type="button" onClick={() => setTool('eraser')}>{componentText(locale, 'componentLibrary.preview.eraser')}</button>
      </div>
    </div>
    <div className="component-pressure-toolbar">
      <strong>{componentText(locale, tool === 'pencil' ? 'componentLibrary.preview.brush' : 'componentLibrary.preview.eraser')}</strong>
      <label className="tool-checkbox"><PixelCheckbox checked={perfectPixels} onChange={(event) => setPerfectPixels(event.target.checked)} />{componentText(locale, 'componentLibrary.preview.perfectPixels')}</label>
      <button className={`pressure-trigger ${settings.effects.size.sensor || settings.effects.strength.sensor || settings.effects.gradient.sensor ? 'selected' : ''}`} type="button" aria-expanded={panelOpen} onClick={() => setPanelOpen((open) => !open)}>{componentText(locale, 'toolOptions.brushDynamics')}<ChevronDown size={14} /></button>
    </div>
    {panelOpen && <div className="component-pressure-panel"><BrushDynamicsSettingsPanel settings={settings} tool={tool} intrinsicSize={mode === 'intrinsic'} brushSize={16} documentId="component-library-brush-dynamics" primaryColor={{ r: 248, g: 91, b: 74, a: 255 }} secondaryColor={{ r: 38, g: 44, b: 58, a: 255 }} telemetryPreview={{ documentId: 'component-library-brush-dynamics', pressure: 46, speed: 1380, pointerType: 'pen', active: true }} onChange={updateMapping} onGradientDitherChange={(gradientDither) => setSettings((current) => ({ ...current, gradientDither }))} /></div>}
  </div>
}

function ColorPickerPreview({ locale }: { locale: AppLocale }) {
  const [color, setColor] = useState(initialColor)
  const [secondary, setSecondary] = useState<RgbaColor>({ r: 12, g: 14, b: 18, a: 255 })
  return <div className="component-color-picker-preview">{colorPickerVariants.map((variant) => { const label = componentText(locale, variant.labelKey); return <section key={variant.id}><header><strong>{label}</strong><code>{variant.id}</code></header><div><ColorPicker color={color} secondaryColor={secondary} onChange={setColor} onSecondaryChange={setSecondary} compact label={label} config={variant.config} /></div></section> })}</div>
}

function ColorValuePreview({ locale }: { locale: AppLocale }) {
  const [color, setColor] = useState(initialColor)
  const [transparentColor, setTransparentColor] = useState<RgbaColor>({ r: 155, g: 155, b: 159, a: 0 })
  return <div className="component-color-value-preview"><ColorValueControl color={color} onChange={setColor} label={componentText(locale, 'componentLibrary.preview.colorValue')} roleLabel={componentText(locale, 'componentLibrary.preview.foreground')} fillWithColor /><ColorValueControl color={transparentColor} onChange={setTransparentColor} label={componentText(locale, 'componentLibrary.preview.colorValue')} roleLabel={componentText(locale, 'componentLibrary.preview.background')} fillWithColor /></div>
}

function DockPreview({ locale }: { locale: AppLocale }) {
  return <div className="component-dock-preview"><div className="component-dock-rail"><span /><span /><span /></div><div className="component-dock-canvas"><div className="component-dock-drop-line" /><span>{componentText(locale, 'componentLibrary.preview.canvas')}</span></div><div className="component-dock-panel"><strong>{componentText(locale, 'componentLibrary.preview.color')}</strong><span /><span /><span /></div></div>
}

const previewRenderers: Record<string, (props: { locale: AppLocale }) => ReactElement> = {
  buttons: ButtonsPreview,
  'icon-button': IconButtonPreview,
  'pixel-utility-icon': PixelUtilityIconPreview,
  'tool-icons': ToolIconPreview,
  'pointer-icons': PointerIconPreview,
  'delete-icon-button': DeleteIconButtonPreview,
  'context-menu': ContextMenuPreview,
  segmented: SegmentedPreview,
  'number-input': NumberInputPreview,
  'text-area-input': TextAreaInputPreview,
  'themed-select': SelectPreview,
  range: RangePreview,
  checkbox: CheckboxPreview,
  switch: SwitchPreview,
  'live-preview-toggle': LivePreviewTogglePreview,
  scrollbar: ScrollbarPreview,
  'panel-header': PanelHeaderPreview,
  'layer-row': LayerRowPreview,
  swatches: SwatchesPreview,
  'modal-shell': ModalShellPreview,
  'save-progress': SaveProgressPreview,
  status: StatusPreview,
  tooltip: TooltipPreview,
  'tool-options': ToolOptionsPreview,
  'pressure-options': PressureOptionsPreview,
  'color-picker': ColorPickerPreview,
  'color-value': ColorValuePreview,
  'panel-dock': DockPreview
}

export function ComponentLibrary({ onClose }: { onClose: () => void }) {
  const { locale } = useI18n()
  const [category, setCategory] = useState<ComponentCategory>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('buttons')
  const localizedEntries = useMemo(() => COMPONENT_LIBRARY_ENTRIES.map((entry) => localizeEntry(entry, locale)), [locale])
  const filteredEntries = useMemo(() => COMPONENT_LIBRARY_ENTRIES.filter((entry) => {
    const matchesCategory = category === 'all' || entry.category === category
    const localized = localizeEntry(entry, locale)
    const haystack = `${entry.name} ${entry.description} ${entry.source} ${entry.tags.join(' ')} ${localized.name} ${localized.description} ${localized.tags.join(' ')}`.toLowerCase()
    return matchesCategory && haystack.includes(query.trim().toLowerCase())
  }), [category, locale, query])
  const selectedEntry = localizedEntries.find((entry) => entry.id === selectedId) ?? localizedEntries.find((entry) => filteredEntries.some((candidate) => candidate.id === entry.id)) ?? localizedEntries[0]
  const Preview = previewRenderers[selectedEntry.id]

  return <div className="modal-backdrop component-library-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <ModalShell storageKey="component-library" defaultWidth={920} defaultHeight={680} minWidth={700} minHeight={500} maxWidth={1200} maxHeight={900} fitContent={false} resizePortalClassName="component-library-resize-portal" className="component-library" role="dialog" aria-modal="true" aria-labelledby="component-library-title">
      <header className="component-library-header"><div><span className="eyebrow">MOONSPRITE UI</span><h2 id="component-library-title">{componentText(locale, 'componentLibrary.title')}</h2><p>{componentText(locale, 'componentLibrary.subtitle')}</p></div><button className="icon-button" type="button" aria-label={componentText(locale, 'componentLibrary.close')} onClick={onClose}><X size={16} /></button></header>
      <div className="component-library-layout">
        <aside className="component-library-sidebar">
          <label className="component-library-search"><Search size={14} /><input value={query} placeholder={componentText(locale, 'componentLibrary.search')} aria-label={componentText(locale, 'componentLibrary.search')} onChange={(event) => setQuery(event.target.value)} /></label>
          <nav aria-label={componentText(locale, 'componentLibrary.categories')}>{(Object.keys(categoryLabels) as ComponentCategory[]).map((item) => <button key={item} type="button" className={category === item ? 'selected' : ''} onClick={() => setCategory(item)}><span>{componentText(locale, categoryLabels[item])}</span><small>{item === 'all' ? COMPONENT_LIBRARY_ENTRIES.length : COMPONENT_LIBRARY_ENTRIES.filter((entry) => entry.category === item).length}</small></button>)}</nav>
          <div className="component-library-entry-list">{filteredEntries.map((entry) => { const localized = localizedEntries.find((item) => item.id === entry.id) ?? entry; return <button key={entry.id} type="button" className={entry.id === selectedId ? 'selected' : ''} onClick={() => setSelectedId(entry.id)}><span><strong>{localized.name}</strong><small>{componentText(locale, categoryLabels[entry.category])}</small></span><ChevronRight size={14} /></button> })}{filteredEntries.length === 0 && <p className="component-library-empty">{componentText(locale, 'componentLibrary.noMatch')}</p>}</div>
        </aside>
        <main className="component-library-main">
          <div className="component-library-main-heading"><div><span className="eyebrow">{componentText(locale, 'componentLibrary.eyebrow')}</span><h3>{selectedEntry.name}</h3></div><span className="component-library-id">{selectedEntry.id}</span></div>
          <div className="component-preview-stage"><Preview locale={locale} /></div>
          <div className="component-library-details"><div className="component-detail-block"><span>{componentText(locale, 'componentLibrary.details')}</span><p>{selectedEntry.description}</p></div><div className="component-detail-block"><span>{componentText(locale, 'componentLibrary.source')}</span><code>{selectedEntry.source}</code></div><div className="component-detail-block"><span>{componentText(locale, 'componentLibrary.tags')}</span><div className="component-tag-list">{selectedEntry.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></div></div>
          <div className="component-library-checklist"><strong><PixelUtilityIcon kind="check" />{componentText(locale, 'componentLibrary.checkStatus')}</strong><span><i />{componentText(locale, 'componentLibrary.interactive')}</span><span><i />{componentText(locale, 'componentLibrary.squareLayout')}</span><span><i />{componentText(locale, 'componentLibrary.blue')}</span></div>
        </main>
      </div>
      <footer className="component-library-footer"><span><FileText size={14} />{componentText(locale, 'componentLibrary.registered', { count: COMPONENT_LIBRARY_ENTRIES.length })}</span><span className="component-library-footer-note"><Palette size={14} />{componentText(locale, 'componentLibrary.footerHint')}</span><button className="primary-button" type="button" onClick={onClose}>{componentText(locale, 'componentLibrary.done')}</button></footer>
    </ModalShell>
  </div>
}
