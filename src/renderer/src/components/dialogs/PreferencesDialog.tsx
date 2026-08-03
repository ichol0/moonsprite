import { useState } from 'react'
import { Plus, RotateCcw, X } from 'lucide-react'
import {
  DEFAULT_CHECKERBOARD_PREFERENCES,
  DEFAULT_LAYER_DISPLAY_COLOR_PRESETS,
  loadEditorPreferences,
  parseDocumentSizePresets,
  parseExportScalePresets,
  parseLayerDisplayColorPresets,
  saveEditorPreferences,
  type BrushPreviewMode,
  type CheckerSize,
  type CursorScale,
  type DocumentSizePreset,
  type RelativeLuminanceScope,
  type RotationIndicatorPosition,
  type ZoomToolDragMode
} from '@/core/file-preferences'
import { clearStoredValues } from '@/core/storage'
import { ColorValueControl } from '@/components/ColorValueControl'
import { DeleteIconButton } from '@/components/DeleteIconButton'
import { ModalShell } from '@/components/ModalShell'
import { NumberInput } from '@/components/NumberInput'
import { ThemedSelect } from '@/components/ThemedSelect'
import { Tooltip } from '@/components/Tooltip'
import { useWorkspace } from '@/store/workspace'

interface PreferencesDialogProps {
  onClose: () => void
  onPresetChange: (documentSizes: DocumentSizePreset[], exportScales: number[]) => void
}

type PreferenceSection = 'general' | 'files' | 'cursor' | 'toolPreview' | 'background' | 'editing' | 'layers' | 'presets' | 'reset'

export function PreferencesDialog({ onClose, onPresetChange }: PreferencesDialogProps) {
  const [section, setSection] = useState<PreferenceSection>('general')
  const [preferences, setPreferences] = useState(() => ({ ...loadEditorPreferences(), language: 'zh-CN' as const }))
  const update = <K extends keyof typeof preferences>(key: K, value: typeof preferences[K]): void => setPreferences((current) => ({ ...current, [key]: value }))
  const updateDocumentSize = (index: number, key: keyof DocumentSizePreset, value: number): void => update('documentSizePresets', preferences.documentSizePresets.map((preset, presetIndex) => presetIndex === index ? { ...preset, [key]: value } : preset))
  const updateLayerColorPreset = (index: number, color: typeof preferences.layerDisplayColorPresets[number]): void => update('layerDisplayColorPresets', preferences.layerDisplayColorPresets.map((preset, presetIndex) => presetIndex === index ? { ...color, a: 255 } : preset))
  const recoveryValue = preferences.recovery ? String(preferences.recoveryMinutes) : 'off'
  const persist = (): void => {
    const documentSizePresets = parseDocumentSizePresets(JSON.stringify(preferences.documentSizePresets))
    const exportScalePresets = parseExportScalePresets(JSON.stringify(preferences.exportScalePresets))
    const layerDisplayColorPresets = parseLayerDisplayColorPresets(JSON.stringify(preferences.layerDisplayColorPresets))
    setPreferences((current) => ({ ...current, documentSizePresets, exportScalePresets, layerDisplayColorPresets }))
    saveEditorPreferences({ ...preferences, documentSizePresets, exportScalePresets, layerDisplayColorPresets })
    window.dispatchEvent(new Event('moonsprite:preferences-changed'))
    onPresetChange(documentSizePresets, exportScalePresets)
  }
  const resetAllSettings = async (): Promise<void> => {
    const choice = await useWorkspace.getState().requestDialog({
      title: '恢复所有初始设置',
      message: '确定恢复 MoonSprite 的所有软件设置吗？',
      detail: '将清除首选项、快捷键、工具状态、最近记录和工作区布局记录。不会删除任何用户创建的工程、笔刷、色板、工作区文件或其他磁盘文件。',
      choices: [
        { id: 'cancel', label: '取消', tone: 'quiet' },
        { id: 'reset', label: '恢复所有初始设置', tone: 'danger' }
      ]
    })
    if (choice !== 'reset') return
    clearStoredValues()
    window.location.reload()
  }
  const toggle = (label: string, checked: boolean, onChange: (checked: boolean) => void, tooltip?: string) => <label className="preference-toggle outline-preview-toggle"><Tooltip content={tooltip}><span>{label}</span></Tooltip><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className="toggle-track" aria-hidden="true"><i /></span></label>

  return <div className="modal-backdrop" role="presentation"><ModalShell storageKey="preferences" defaultWidth={720} defaultHeight={560} minWidth={620} minHeight={460} fitContent={false} className="settings-modal" role="dialog" aria-label="首选项">
    <header><div><span className="eyebrow">PREFERENCES</span><h2>首选项</h2></div><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={16} /></button></header>
    <div className="settings-layout"><nav>{([['general', '常规'], ['files', '文件'], ['cursor', '光标'], ['toolPreview', '工具预览'], ['background', '背景'], ['editing', '编辑'], ['layers', '图层'], ['presets', '预设'], ['reset', '重置']] as Array<[PreferenceSection, string]>).map(([id, label]) => <button key={id} className={section === id ? 'selected' : ''} onClick={() => setSection(id)}>{label}</button>)}</nav><main>
      {section === 'general' && <>
        <div className="preference-field"><span>语言</span><span className="preference-static-value">简体中文</span></div>
        <label className="preference-field">旋转指向标位置<ThemedSelect value={preferences.rotationIndicatorPosition} groups={[{ label: '位置', options: [{ value: 'view', label: '视图中心' }, { value: 'canvas', label: '画布中心' }] }]} label="旋转指向标位置" onChange={(value) => update('rotationIndicatorPosition', value as RotationIndicatorPosition)} /></label>
        <label className="preference-field">默认缩放模式<ThemedSelect value={preferences.zoomToolDragMode} groups={[{ label: '缩放方式', options: [{ value: 'smooth', label: '平滑缩放' }, { value: 'stepped', label: '百分比缩放' }] }]} label="默认缩放模式" onChange={(value) => update('zoomToolDragMode', value as ZoomToolDragMode)} /></label>
        <label className="preference-field">查看相对明暗作用区域<ThemedSelect value={preferences.relativeLuminanceScope} groups={[{ label: '作用区域', options: [{ value: 'canvas', label: '画布视图内' }, { value: 'app', label: '整体（整个软件）' }] }]} label="查看相对明暗作用区域" onChange={(value) => update('relativeLuminanceScope', value as RelativeLuminanceScope)} /></label>
      </>}
      {section === 'files' && <>
        <label className="preference-field">默认保存格式<ThemedSelect value={preferences.saveFormat} groups={[{ label: '保存格式', options: [{ value: 'moonsprite', label: '.moonsprite' }, { value: 'png', label: '.png' }, { value: 'jpeg', label: '.jpg / .jpeg' }, { value: 'webp', label: '.webp' }, { value: 'ase', label: '.ase' }, { value: 'aseprite', label: '.aseprite' }] }]} label="默认保存格式" onChange={(value) => update('saveFormat', value)} /></label>
        <label className="preference-field">默认导出格式<ThemedSelect value={preferences.exportFormat} groups={[{ label: '导出格式', options: [{ value: 'png', label: 'PNG' }, { value: 'jpeg', label: 'JPEG' }, { value: 'webp', label: 'WebP' }, { value: 'svg', label: 'SVG' }] }]} label="默认导出格式" onChange={(value) => update('exportFormat', value)} /></label>
        <label className="preference-field">自动保存恢复数据<ThemedSelect value={recoveryValue} groups={[{ label: '保存间隔', options: [{ value: 'off', label: '关闭' }, { value: '0.5', label: '每 30 秒' }, { value: '1', label: '每 1 分钟' }, { value: '2', label: '每 2 分钟' }, { value: '5', label: '每 5 分钟' }, { value: '10', label: '每 10 分钟' }] }]} label="自动保存恢复数据" onChange={(value) => setPreferences((current) => value === 'off' ? { ...current, recovery: false } : { ...current, recovery: true, recoveryMinutes: Number(value) })} /></label>
      </>}
      {section === 'cursor' && <>
        {toggle('使用本地指针', preferences.useLocalCursors, (value) => update('useLocalCursors', value), '开启后优先使用电脑系统指针；系统没有对应指针的特殊操作仍使用 MoonSprite 指针。')}
        <label className="preference-field">鼠标光标比例<ThemedSelect value={String(preferences.cursorScale)} groups={[{ label: '光标比例', options: [{ value: '1', label: '100%' }, { value: '1.25', label: '125%' }, { value: '1.5', label: '150%' }, { value: '2', label: '200%' }] }]} label="鼠标光标比例" onChange={(value) => update('cursorScale', Number(value) as CursorScale)} /></label>
      </>}
      {section === 'toolPreview' && <>
        <label className="preference-field">笔刷预览<ThemedSelect value={preferences.brushPreviewMode} groups={[{ label: '预览样式', options: [{ value: 'none', label: '无' }, { value: 'edge', label: '仅显示边缘' }, { value: 'full', label: '完整预览' }, { value: 'full-edge', label: '完整预览并显示边缘' }] }]} label="笔刷预览" onChange={(value) => update('brushPreviewMode', value as BrushPreviewMode)} /></label>
        {toggle('绘制期间保持笔刷预览', preferences.drawingBrushPreviewEnabled, (value) => update('drawingBrushPreviewEnabled', value))}
        {toggle('框选时显示十字指针', preferences.selectionCrosshair, (value) => update('selectionCrosshair', value))}
      </>}
      {section === 'background' && <>
        <label className="preference-field">透明背景格大小<ThemedSelect value={String(preferences.checkerboard.size)} groups={[{ label: '格子大小', options: [{ value: '4', label: '小（4 px）' }, { value: '8', label: '较小（8 px）' }, { value: '16', label: '中等（16 px）' }, { value: '32', label: '大（32 px）' }] }]} label="透明背景格大小" onChange={(value) => update('checkerboard', { ...preferences.checkerboard, size: Number(value) as CheckerSize })} /></label>
        <div className="preference-checker-colors"><div className="preference-checker-color-heading"><span>透明背景颜色</span><button type="button" className="quiet-button" onClick={() => update('checkerboard', { ...DEFAULT_CHECKERBOARD_PREFERENCES, lightColor: { ...DEFAULT_CHECKERBOARD_PREFERENCES.lightColor }, darkColor: { ...DEFAULT_CHECKERBOARD_PREFERENCES.darkColor } })}><RotateCcw size={13} />重置</button></div><div className="preference-color-value-list"><ColorValueControl color={preferences.checkerboard.lightColor} onChange={(lightColor) => update('checkerboard', { ...preferences.checkerboard, lightColor: { ...lightColor, a: 255 } })} label="透明背景颜色" roleLabel="浅色" /><ColorValueControl color={preferences.checkerboard.darkColor} onChange={(darkColor) => update('checkerboard', { ...preferences.checkerboard, darkColor: { ...darkColor, a: 255 } })} label="透明背景颜色" roleLabel="深色" /></div></div>
      </>}
      {section === 'editing' && <>
        {toggle('使用滚轮缩放', preferences.wheelZoomEnabled, (value) => update('wheelZoomEnabled', value))}
        {toggle('实时显示铅笔直线预览', preferences.shiftLinePreviewEnabled, (value) => update('shiftLinePreviewEnabled', value))}
        {toggle('直线算法优化', preferences.balancedShiftLineEnabled, (value) => update('balancedShiftLineEnabled', value), '启用后，斜线像素会均匀分配为长度相近的阶梯，使线条节奏更规整。')}
        {toggle('套索选区预览闭合', preferences.lassoPreviewClosed, (value) => update('lassoPreviewClosed', value))}
        {toggle('吸管取色后切回铅笔', preferences.eyedropperSwitchToPencil, (value) => update('eyedropperSwitchToPencil', value))}
      </>}
      {section === 'layers' && <div className="preference-checker-colors preference-layer-colors">
        <div className="preference-checker-color-heading"><span>图层属性颜色预设</span><div><button type="button" className="quiet-button" aria-label="恢复默认颜色" onClick={() => update('layerDisplayColorPresets', DEFAULT_LAYER_DISPLAY_COLOR_PRESETS.map((color) => ({ ...color })))}><RotateCcw size={13} />恢复默认</button><button type="button" className="quiet-button" disabled={preferences.layerDisplayColorPresets.length >= 12} onClick={() => update('layerDisplayColorPresets', [...preferences.layerDisplayColorPresets, { r: 117, g: 117, b: 117, a: 255 }])}><Plus size={13} />新增颜色</button></div></div>
        <div className="preference-layer-color-grid">{preferences.layerDisplayColorPresets.map((color, index) => <div className="preference-layer-color-row" key={index}><ColorValueControl color={color} onChange={(value) => updateLayerColorPreset(index, value)} label={`图层显示颜色预设 ${index + 1}`} storageKey="layer-preset" /><DeleteIconButton size="regular" aria-label={`删除图层颜色预设 ${index + 1}`} disabled={preferences.layerDisplayColorPresets.length === 1} onClick={() => update('layerDisplayColorPresets', preferences.layerDisplayColorPresets.filter((_, presetIndex) => presetIndex !== index))} /></div>)}</div>
      </div>}
      {section === 'presets' && <div className="preference-presets"><section><header><strong>新建工程尺寸</strong><button type="button" onClick={() => update('documentSizePresets', [...preferences.documentSizePresets, { width: 64, height: 64 }])}><Plus size={13} />新增尺寸</button></header><div className="preference-preset-grid">{preferences.documentSizePresets.map((preset, index) => <div className="document-size-preset-row" key={index}><NumberInput aria-label={`预设 ${index + 1} 宽度`} min={1} max={16384} suffix="px" value={preset.width} onValueChange={(value) => updateDocumentSize(index, 'width', value)} /><span>x</span><NumberInput aria-label={`预设 ${index + 1} 高度`} min={1} max={16384} suffix="px" value={preset.height} onValueChange={(value) => updateDocumentSize(index, 'height', value)} /><DeleteIconButton aria-label={`删除尺寸 ${preset.width}x${preset.height}`} disabled={preferences.documentSizePresets.length === 1} onClick={() => update('documentSizePresets', preferences.documentSizePresets.filter((_, presetIndex) => presetIndex !== index))} /></div>)}</div></section><section><header><strong>导出图片放大倍数</strong><button type="button" onClick={() => update('exportScalePresets', [...preferences.exportScalePresets, 100])}><Plus size={13} />新增倍数</button></header><div className="preference-preset-grid export-scale-preset-grid">{preferences.exportScalePresets.map((scale, index) => <div className="export-scale-preset-row" key={index}><NumberInput aria-label={`导出倍数 ${index + 1}`} min={1} max={6400} suffix="%" value={scale} onValueChange={(value) => update('exportScalePresets', preferences.exportScalePresets.map((currentScale, scaleIndex) => scaleIndex === index ? value : currentScale))} /><DeleteIconButton aria-label={`删除 ${scale}%`} disabled={preferences.exportScalePresets.length === 1} onClick={() => update('exportScalePresets', preferences.exportScalePresets.filter((_, scaleIndex) => scaleIndex !== index))} /></div>)}</div></section></div>}
      {section === 'reset' && <><p>重置只清除软件配置记录。用户创建的工程、笔刷、色板、工作区文件和其他磁盘文件不会删除。</p><button className="danger-button" onClick={() => void resetAllSettings()}>恢复所有初始设置</button></>}
    </main></div>
    <footer><button className="quiet-button" onClick={onClose}>取消</button><button className="quiet-button" onClick={persist}>应用</button><button className="primary-button" onClick={() => { persist(); onClose() }}>确定</button></footer>
  </ModalShell></div>
}
