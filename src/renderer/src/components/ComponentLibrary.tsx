import { useMemo, useState, type ReactElement } from 'react'
import { Check, ChevronRight, Copy, Eye, EyeOff, FileText, FolderOpen, Info, Layers2, Lock, LockOpen, MoreHorizontal, Palette, Plus, Search, Settings2, Trash2, X } from 'lucide-react'
import type { RgbaColor } from '@shared/types'
import { ColorPicker, type ColorPickerConfig } from './ColorPicker'
import { ColorValueControl } from './ColorValueControl'
import { DeleteIconButton } from './DeleteIconButton'
import { ModalShell } from './ModalShell'
import { NumberInput } from './NumberInput'
import { TextAreaInput } from './TextAreaInput'
import { ThemedSelect, type ThemedSelectGroup } from './ThemedSelect'
import { Tooltip } from './Tooltip'

type ComponentCategory = 'all' | 'controls' | 'forms' | 'panels' | 'dialogs' | 'editor'

export interface ComponentLibraryEntry {
  id: string
  name: string
  category: Exclude<ComponentCategory, 'all'>
  description: string
  source: string
  tags: string[]
}

const categoryLabels: Record<ComponentCategory, string> = {
  all: '全部',
  controls: '控件',
  forms: '表单',
  panels: '面板',
  dialogs: '弹窗',
  editor: '编辑器'
}

export const COMPONENT_LIBRARY_ENTRIES: ComponentLibraryEntry[] = [
  { id: 'buttons', name: '按钮组', category: 'controls', description: '主要操作、次要操作和危险操作使用同一组尺寸与状态。', source: '.primary-button / .quiet-button / .danger-button', tags: ['操作', '状态'] },
  { id: 'icon-button', name: '图标按钮', category: 'controls', description: '工具栏和面板标题中的方形图标操作。', source: '.icon-button', tags: ['图标', '工具栏'] },
  { id: 'delete-icon-button', name: '删除图标按钮', category: 'controls', description: '用于删除预设或列表项目的统一危险图标按钮，提供紧凑、常规和禁用状态。', source: 'DeleteIconButton', tags: ['删除', '危险', '图标'] },
  { id: 'context-menu', name: '上下文菜单', category: 'controls', description: '通过右键或更多操作打开的紧凑菜单，支持图标、禁用和危险操作状态。', source: '.context-menu / .context-menu-item', tags: ['右键', '菜单', '操作'] },
  { id: 'segmented', name: '分段选择', category: 'controls', description: '用于工具模式、视图模式和互斥选项。', source: '.segmented-control', tags: ['模式', '选中'] },
  { id: 'number-input', name: '数值输入', category: 'forms', description: '统一的数字输入、步进按钮和边界限制。', source: 'NumberInput', tags: ['数字', '步进'] },
  { id: 'text-area-input', name: '多行文本输入', category: 'forms', description: '用于描述和备注的固定尺寸多行输入，不允许用户拖动改变大小。', source: 'TextAreaInput', tags: ['文本', '描述', '输入'] },
  { id: 'themed-select', name: '主题下拉', category: 'forms', description: '带分组、选中标记和键盘导航的下拉菜单。', source: 'ThemedSelect', tags: ['下拉', '分组'] },
  { id: 'range', name: '滑块', category: 'forms', description: '适用于尺寸、不透明度、强度等连续数值。', source: '.brush-size-popover input[type=range]', tags: ['数值', '实时'] },
  { id: 'checkbox', name: '复选框', category: 'forms', description: '用于可以同时启用的独立选项。', source: '.tool-checkbox', tags: ['设置', '复选'] },
  { id: 'switch', name: '开关', category: 'forms', description: '用于明确的开启与关闭状态。', source: '.preference-toggle / .outline-preview-toggle', tags: ['设置', '开关'] },
  { id: 'scrollbar', name: '滚动区域', category: 'forms', description: '下拉菜单和长列表使用的统一滚动条。', source: '.themed-select-popover scrollbar', tags: ['滚动', '列表'] },
  { id: 'panel-header', name: '栏目标题', category: 'panels', description: '停靠栏目标题、拖动入口和右侧操作。', source: '.panel-header', tags: ['栏目', '停靠'] },
  { id: 'layer-row', name: '图层行', category: 'panels', description: '可见性、锁定、组图标、名称、混合模式和拖动状态。', source: 'LayersPanel', tags: ['图层', '拖动'] },
  { id: 'swatches', name: '颜色格', category: 'panels', description: '调色板中的选中、悬浮和多选状态。', source: '.swatch-grid / .swatch', tags: ['颜色', '多选'] },
  { id: 'modal-shell', name: '弹窗框架', category: 'dialogs', description: '统一标题、内容、底部操作、拖动、八向缩放和尺寸位置记忆。', source: 'ModalShell / .modal-backdrop', tags: ['弹窗', '布局', '缩放'] },
  { id: 'status', name: '状态提示', category: 'dialogs', description: '用于操作反馈、模式提示和不可用状态。', source: '.statusbar / .advanced-mode-notice', tags: ['提示', '反馈'] },
  { id: 'tooltip', name: '悬浮提示', category: 'dialogs', description: '用于描述等较长内容的自定义悬浮提示，自动避开视口边缘。', source: 'Tooltip', tags: ['提示', '悬浮', '描述'] },
  { id: 'tool-options', name: '工具属性栏', category: 'editor', description: '工具名称、参数、模式和撤销重做操作。', source: '.tool-options', tags: ['工具', '属性'] },
  { id: 'color-picker', name: '颜色选择器', category: 'editor', description: '色盘、色相、透明度、前景色和背景色。', source: 'ColorPicker', tags: ['颜色', '实时'] },
  { id: 'color-value', name: '颜色值按钮', category: 'editor', description: '颜色预览、HEX 文本和 RGB/HSV/HSL/Gray 多模式编辑。', source: 'ColorValueControl', tags: ['颜色', 'HEX', '通道'] },
  { id: 'panel-dock', name: '停靠栏目', category: 'editor', description: '右侧、左侧和底部停靠区的容器行为。', source: 'InspectorPanels', tags: ['布局', '停靠'] }
]

const initialColor: RgbaColor = { r: 41, g: 121, b: 255, a: 255 }
const selectGroups: Array<ThemedSelectGroup<string>> = [
  { label: '基础', options: [{ value: 'normal', label: '正常' }, { value: 'dissolve', label: '溶解' }, { value: 'behind', label: '背后' }] },
  { label: '变暗', options: [{ value: 'darken', label: '变暗' }, { value: 'multiply', label: '正片叠底' }, { value: 'color-burn', label: '颜色加深' }, { value: 'linear-burn', label: '线性加深' }] },
  { label: '变亮', options: [{ value: 'lighten', label: '变亮' }, { value: 'screen', label: '滤色' }, { value: 'color-dodge', label: '颜色减淡' }, { value: 'linear-dodge', label: '线性减淡' }] },
  { label: '对比', options: [{ value: 'overlay', label: '叠加' }, { value: 'soft-light', label: '柔光' }, { value: 'hard-light', label: '强光' }, { value: 'vivid-light', label: '亮光' }] },
  { label: '比较', options: [{ value: 'difference', label: '差值' }, { value: 'exclusion', label: '排除' }, { value: 'subtract', label: '减去' }, { value: 'divide', label: '划分' }] }
]

const colorPickerVariants: Array<{ id: string; label: string; config: ColorPickerConfig }> = [
  { id: 'moon-square', label: '月环 · HSV 方形', config: { scheme: 'moon-ring', hueSteps: 0, colorSteps: 0, moonField: 'hsv-square' } },
  { id: 'moon-triangle', label: '月环 · HSL 三角', config: { scheme: 'moon-ring', hueSteps: 0, colorSteps: 0, moonField: 'hsl-triangle' } },
  { id: 'sv-square', label: 'HSV 方形', config: { scheme: 'sv-square', hueSteps: 0, colorSteps: 0 } },
  { id: 'hs-square', label: 'HS 方形', config: { scheme: 'hs-square', hueSteps: 0, colorSteps: 0 } },
  { id: 'wheel', label: '色轮', config: { scheme: 'wheel', hueSteps: 0, colorSteps: 0 } }
]

function ButtonsPreview() {
  return <div className="component-preview-row"><button className="primary-button" type="button"><Plus size={14} />新建</button><button className="quiet-button" type="button">取消</button><button className="danger-button" type="button"><Trash2 size={14} />删除</button><button className="quiet-button" type="button" disabled>禁用</button></div>
}

function IconButtonPreview() {
  return <div className="component-preview-row"><button className="icon-button" type="button" aria-label="复制"><Copy size={16} /></button><button className="icon-button active" type="button" aria-label="设置"><Settings2 size={16} /></button><button className="icon-button" type="button" aria-label="删除"><Trash2 size={16} /></button></div>
}

function DeleteIconButtonPreview() {
  return <div className="component-preview-row"><DeleteIconButton aria-label="删除预设" /><DeleteIconButton aria-label="删除颜色预设" size="regular" /><DeleteIconButton aria-label="删除已禁用" disabled /></div>
}

function ContextMenuPreview() {
  const [open, setOpen] = useState(true)
  return <div className="component-context-menu-preview">
    <button className="icon-button" type="button" aria-label="打开上下文菜单" aria-expanded={open} onClick={() => setOpen((value) => !value)}><MoreHorizontal size={17} /></button>
    {open && <div className="context-menu component-context-menu-demo" role="menu" aria-label="上下文菜单预览">
      <button className="context-menu-item" type="button" role="menuitem" onClick={() => setOpen(false)}><X size={15} /><span>关闭</span></button>
      <button className="context-menu-item" type="button" role="menuitem" onClick={() => setOpen(false)}><Copy size={15} /><span>复制视图</span></button>
      <button className="context-menu-item" type="button" role="menuitem" disabled><FolderOpen size={15} /><span>在文件夹中打开</span></button>
    </div>}
  </div>
}

function SegmentedPreview() {
  const [selected, setSelected] = useState('画笔')
  return <div className="segmented-control component-segmented-preview" role="group" aria-label="预览模式">{['画笔', '橡皮', '移动'].map((item) => <button key={item} type="button" className={selected === item ? 'selected' : ''} onClick={() => setSelected(item)}>{item}</button>)}</div>
}

function NumberInputPreview() {
  const [value, setValue] = useState(16)
  const [untitledValue, setUntitledValue] = useState(8)
  const [sliderValue, setSliderValue] = useState(24)
  const [sliderOpen, setSliderOpen] = useState(false)
  return <div className="component-number-input-preview">
    <label className="component-number-input-row"><span>尺寸</span><NumberInput value={value} min={1} max={128} suffix="px" onValueChange={setValue} /></label>
    <div className="component-number-input-row component-number-input-no-label"><NumberInput aria-label="无标题数值输入" value={untitledValue} min={1} max={128} suffix="px" onValueChange={setUntitledValue} /></div>
    <label className="component-number-input-row"><span>提示</span><NumberInput className="component-number-input-hint-input" aria-label="带提示文本的数值输入" value="" min={1} max={128} placeholder="输入数值" onValueChange={() => undefined} /></label>
    <label className="component-number-input-row"><span>尺寸</span><div className="brush-size-control component-number-input-slider" onPointerDown={() => setSliderOpen(true)}><NumberInput aria-label="带滑块的数值输入" value={sliderValue} min={1} max={128} suffix="px" onValueChange={setSliderValue} onFocus={() => setSliderOpen(true)} />{sliderOpen && <div className="brush-size-popover" role="dialog" aria-label="调整数值"><input aria-label="数值滑块" type="range" min="1" max="128" value={sliderValue} onChange={(event) => setSliderValue(Number(event.target.value))} /><strong>{sliderValue}px</strong></div>}</div></label>
  </div>
}

function TextAreaInputPreview() {
  const [value, setValue] = useState('用于记录图层用途、绘制要求或协作备注。')
  return <div className="component-preview-form"><label className="component-preview-label">描述</label><TextAreaInput aria-label="描述输入预览" rows={4} value={value} placeholder="输入描述" onChange={(event) => setValue(event.target.value)} /></div>
}

function SelectPreview() {
  const [value, setValue] = useState('normal')
  return <div className="component-preview-form"><label className="component-preview-label">混合模式</label><ThemedSelect value={value} groups={selectGroups} label="混合模式" onChange={setValue} /></div>
}

function RangePreview() {
  const [value, setValue] = useState(64)
  return <div className="component-preview-stack"><label className="component-preview-label">笔刷尺寸 <strong>{value}px</strong></label><input className="component-library-range" type="range" min="1" max="128" value={value} onChange={(event) => setValue(Number(event.target.value))} /></div>
}

function CheckboxPreview() {
  const [checked, setChecked] = useState(true)
  return <label className="tool-checkbox component-preview-checkbox"><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />完美像素</label>
}

function SwitchPreview() {
  const [checked, setChecked] = useState(true)
  return <label className="preference-toggle outline-preview-toggle component-library-toggle"><span>自动选择图层</span><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} /><span className="toggle-track" aria-hidden="true"><i /></span></label>
}

function ScrollbarPreview() {
  return <div className="component-scroll-preview" tabIndex={0} aria-label="滚动区域预览">{Array.from({ length: 12 }, (_, index) => <div key={index}><span>{String(index + 1).padStart(2, '0')}</span><strong>列表项目 {index + 1}</strong></div>)}</div>
}

function PanelHeaderPreview() {
  return <div className="component-panel-preview"><header className="component-panel-header"><div><span className="eyebrow">PANEL</span><strong>图层</strong></div><div className="component-preview-row compact"><button className="icon-button" type="button" aria-label="显示"><Eye size={14} /></button><button className="icon-button" type="button" aria-label="设置"><Settings2 size={14} /></button></div></header><div className="component-panel-content"><Layers2 size={18} /><span>可拖动栏目标题</span></div></div>
}

function LayerRowPreview() {
  const [selected, setSelected] = useState(true)
  const [visible, setVisible] = useState(true)
  const [locked, setLocked] = useState(false)
  return <div className="component-layer-list-preview"><button className={`layer-row ${selected ? 'selected' : ''}`} type="button" onClick={() => setSelected((value) => !value)}><span className="layer-color-stripe" style={{ backgroundColor: '#ef5350' }} aria-hidden="true" /><span className="layer-visibility" role="button" tabIndex={-1} aria-label={visible ? '隐藏图层' : '显示图层'} onClick={(event) => { event.stopPropagation(); setVisible((value) => !value) }}>{visible ? <Eye size={14} /> : <EyeOff size={14} />}</span><span className={`layer-lock-toggle ${locked ? 'locked' : ''}`} role="button" tabIndex={-1} aria-label={locked ? '解除图层锁定' : '锁定图层'} onClick={(event) => { event.stopPropagation(); setLocked((value) => !value) }}>{locked ? <Lock size={14} /> : <LockOpen size={14} />}</span><Tooltip className="layer-name" content="角色主体与服装的前景像素"><span>前景图层</span><small>正常 · 100%</small></Tooltip></button><button className="layer-row group-row" type="button"><span className="layer-visibility" role="button" tabIndex={-1} aria-label="显示图层组"><Eye size={14} /></span><span className="layer-lock-toggle" role="button" tabIndex={-1} aria-label="锁定图层组"><LockOpen size={14} /></span><span className="group-folder" role="button" tabIndex={-1} aria-label="收起图层组"><FolderOpen size={16} /></span><span className="layer-name"><span>角色</span><small>正常 · 100%</small></span></button></div>
}

function SwatchesPreview() {
  const colors = ['#2979ff', '#f1f4f8', '#ff6600', '#59c36a', '#b43f54', '#8d6cff', 'transparent']
  const [selected, setSelected] = useState<number[]>([0])
  return <div className="swatch-grid component-swatch-preview" style={{ '--swatch-size': '32px' } as React.CSSProperties}>{colors.map((color, index) => { const active = selected.includes(index) || index === 0; return <button key={color} className={`swatch ${selected.includes(index) ? 'selected' : ''} ${index === 0 ? 'primary' : ''} ${color === 'transparent' ? 'transparent' : ''}`} type="button" aria-label={`颜色 ${color}`} aria-pressed={selected.includes(index)} style={{ '--swatch-color': color, '--swatch-corner-color': ['#f1f4f8', '#ff6600', '#59c36a'].includes(color) ? '#0f1116' : '#ffffff' } as React.CSSProperties} onClick={(event) => setSelected((current) => event.shiftKey ? current.includes(index) ? current.filter((item) => item !== index) : [...current, index] : [index])}>{active && <span className="swatch-drag-edges" aria-hidden="true"><i className="swatch-drag-edge edge-n" /><i className="swatch-drag-edge edge-e" /><i className="swatch-drag-edge edge-s" /><i className="swatch-drag-edge edge-w" /></span>}</button> })}</div>
}

function ModalShellPreview() {
  return <div className="component-modal-preview"><div className="component-modal-window"><header><div><span className="eyebrow">PREVIEW</span><strong>弹窗标题</strong></div><button className="icon-button" type="button" aria-label="关闭"><X size={15} /></button></header><div className="component-modal-body"><Info size={18} /><span>标题、内容和底部操作保持统一。</span></div><footer><button className="quiet-button" type="button">取消</button><button className="primary-button" type="button">确定</button></footer></div></div>
}

function StatusPreview() {
  return <div className="advanced-mode-notice component-library-status-preview" role="status"><strong>高级模式已开启</strong><small>CTRL+F 恢复</small></div>
}

function TooltipPreview() {
  return <div className="component-tooltip-preview"><Tooltip content="这是使用 MoonSprite 统一样式显示的图层描述。"><button className="quiet-button" type="button">悬停查看描述</button></Tooltip></div>
}

function ToolOptionsPreview() {
  return <div className="component-tool-options-preview"><strong>画笔</strong><button className="quiet-button" type="button">返回</button><label>尺寸 <NumberInput value={4} min={1} max={128} onValueChange={() => undefined} /></label><span className="component-preview-spacer" /><button className="tool-text-button" type="button">撤销</button><button className="tool-text-button" type="button">重做</button></div>
}

function ColorPickerPreview() {
  const [color, setColor] = useState(initialColor)
  const [secondary, setSecondary] = useState<RgbaColor>({ r: 12, g: 14, b: 18, a: 255 })
  return <div className="component-color-picker-preview">{colorPickerVariants.map((variant) => <section key={variant.id}><header><strong>{variant.label}</strong><code>{variant.id}</code></header><div><ColorPicker color={color} secondaryColor={secondary} onChange={setColor} onSecondaryChange={setSecondary} compact label={variant.label} config={variant.config} /></div></section>)}</div>
}

function ColorValuePreview() {
  const [color, setColor] = useState(initialColor)
  return <div className="component-color-value-preview"><ColorValueControl color={color} onChange={setColor} label="颜色值" roleLabel="前景" /><ColorValueControl color={{ r: 155, g: 155, b: 159, a: 255 }} onChange={() => undefined} label="颜色值" roleLabel="背景" /></div>
}

function DockPreview() {
  return <div className="component-dock-preview"><div className="component-dock-rail"><span /><span /><span /></div><div className="component-dock-canvas"><div className="component-dock-drop-line" /><span>画布</span></div><div className="component-dock-panel"><strong>颜色</strong><span /><span /><span /></div></div>
}

const previewRenderers: Record<string, () => ReactElement> = {
  buttons: ButtonsPreview,
  'icon-button': IconButtonPreview,
  'delete-icon-button': DeleteIconButtonPreview,
  'context-menu': ContextMenuPreview,
  segmented: SegmentedPreview,
  'number-input': NumberInputPreview,
  'text-area-input': TextAreaInputPreview,
  'themed-select': SelectPreview,
  range: RangePreview,
  checkbox: CheckboxPreview,
  switch: SwitchPreview,
  scrollbar: ScrollbarPreview,
  'panel-header': PanelHeaderPreview,
  'layer-row': LayerRowPreview,
  swatches: SwatchesPreview,
  'modal-shell': ModalShellPreview,
  status: StatusPreview,
  tooltip: TooltipPreview,
  'tool-options': ToolOptionsPreview,
  'color-picker': ColorPickerPreview,
  'color-value': ColorValuePreview,
  'panel-dock': DockPreview
}

export function ComponentLibrary({ onClose }: { onClose: () => void }) {
  const [category, setCategory] = useState<ComponentCategory>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('buttons')
  const filteredEntries = useMemo(() => COMPONENT_LIBRARY_ENTRIES.filter((entry) => {
    const matchesCategory = category === 'all' || entry.category === category
    const haystack = `${entry.name} ${entry.description} ${entry.source} ${entry.tags.join(' ')}`.toLowerCase()
    return matchesCategory && haystack.includes(query.trim().toLowerCase())
  }), [category, query])
  const selectedEntry = filteredEntries.find((entry) => entry.id === selectedId) ?? filteredEntries[0] ?? COMPONENT_LIBRARY_ENTRIES[0]
  const Preview = previewRenderers[selectedEntry.id]

  return <div className="modal-backdrop component-library-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <ModalShell storageKey="component-library" defaultWidth={920} defaultHeight={680} fitContent={false} className="component-library" role="dialog" aria-modal="true" aria-labelledby="component-library-title">
      <header className="component-library-header"><div><span className="eyebrow">MOONSPRITE UI</span><h2 id="component-library-title">组件库</h2><p>可复用组件与交互状态</p></div><button className="icon-button" type="button" aria-label="关闭组件库" onClick={onClose}><X size={16} /></button></header>
      <div className="component-library-layout">
        <aside className="component-library-sidebar">
          <label className="component-library-search"><Search size={14} /><input value={query} placeholder="搜索组件" aria-label="搜索组件" onChange={(event) => setQuery(event.target.value)} /></label>
          <nav aria-label="组件分类">{(Object.keys(categoryLabels) as ComponentCategory[]).map((item) => <button key={item} type="button" className={category === item ? 'selected' : ''} onClick={() => setCategory(item)}><span>{categoryLabels[item]}</span><small>{item === 'all' ? COMPONENT_LIBRARY_ENTRIES.length : COMPONENT_LIBRARY_ENTRIES.filter((entry) => entry.category === item).length}</small></button>)}</nav>
          <div className="component-library-entry-list">{filteredEntries.map((entry) => <button key={entry.id} type="button" className={entry.id === selectedId ? 'selected' : ''} onClick={() => setSelectedId(entry.id)}><span><strong>{entry.name}</strong><small>{categoryLabels[entry.category]}</small></span><ChevronRight size={14} /></button>)}{filteredEntries.length === 0 && <p className="component-library-empty">没有匹配组件</p>}</div>
        </aside>
        <main className="component-library-main">
          <div className="component-library-main-heading"><div><span className="eyebrow">COMPONENT PREVIEW</span><h3>{selectedEntry.name}</h3></div><span className="component-library-id">{selectedEntry.id}</span></div>
          <div className="component-preview-stage"><Preview /></div>
          <div className="component-library-details"><div className="component-detail-block"><span>说明</span><p>{selectedEntry.description}</p></div><div className="component-detail-block"><span>复用来源</span><code>{selectedEntry.source}</code></div><div className="component-detail-block"><span>标签</span><div className="component-tag-list">{selectedEntry.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></div></div>
          <div className="component-library-checklist"><strong><Check size={14} />检查状态</strong><span><i />预览可交互</span><span><i />遵循方角布局</span><span><i />使用统一蓝色</span></div>
        </main>
      </div>
      <footer className="component-library-footer"><span><FileText size={14} />{COMPONENT_LIBRARY_ENTRIES.length} 个已登记组件</span><span className="component-library-footer-note"><Palette size={14} />新建 UI 前先从这里选择</span><button className="primary-button" type="button" onClick={onClose}>完成</button></footer>
    </ModalShell>
  </div>
}
