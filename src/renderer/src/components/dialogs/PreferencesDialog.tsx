import { useState } from 'react'
import { Eye, Plus, Trash2, X } from 'lucide-react'
import {
  loadEditorPreferences,
  parseDocumentSizePresets,
  parseExportScalePresets,
  saveEditorPreferences,
  type DocumentSizePreset,
  type RelativeLuminanceScope,
  type RotationIndicatorPosition,
  type ZoomToolDragMode
} from '@/core/file-preferences'
import { clearStoredValues } from '@/core/storage'
import { NumberInput } from '@/components/NumberInput'
import { ThemedSelect } from '@/components/ThemedSelect'

interface PreferencesDialogProps {
  onClose: () => void
  onPresetChange: (documentSizes: DocumentSizePreset[], exportScales: number[]) => void
}

export function PreferencesDialog({ onClose, onPresetChange }: PreferencesDialogProps) {
  const [section, setSection] = useState<'general' | 'files' | 'presets' | 'reset'>('general')
  const [initialPreferences] = useState(loadEditorPreferences)
  const [language, setLanguage] = useState(initialPreferences.language)
  const [saveFormat, setSaveFormat] = useState(initialPreferences.saveFormat)
  const [exportFormat, setExportFormat] = useState(initialPreferences.exportFormat)
  const [recovery, setRecovery] = useState(initialPreferences.recovery)
  const [recoveryMinutes, setRecoveryMinutes] = useState(initialPreferences.recoveryMinutes)
  const [documentSizePresets, setDocumentSizePresets] = useState(initialPreferences.documentSizePresets)
  const [exportScalePresets, setExportScalePresets] = useState(initialPreferences.exportScalePresets)
  const [rotationIndicatorPosition, setRotationIndicatorPosition] = useState<RotationIndicatorPosition>(initialPreferences.rotationIndicatorPosition)
  const [drawingBrushPreviewEnabled, setDrawingBrushPreviewEnabled] = useState(initialPreferences.drawingBrushPreviewEnabled)
  const [relativeLuminanceScope, setRelativeLuminanceScope] = useState<RelativeLuminanceScope>(initialPreferences.relativeLuminanceScope)
  const [zoomToolDragMode, setZoomToolDragMode] = useState<ZoomToolDragMode>(initialPreferences.zoomToolDragMode)
  const updateDocumentSize = (index: number, key: keyof DocumentSizePreset, value: number): void => setDocumentSizePresets((current) => current.map((preset, presetIndex) => presetIndex === index ? { ...preset, [key]: value } : preset))
  const persist = (): void => {
    const normalizedSizes = parseDocumentSizePresets(JSON.stringify(documentSizePresets))
    const normalizedScales = parseExportScalePresets(JSON.stringify(exportScalePresets))
    saveEditorPreferences({ language, saveFormat, exportFormat, recovery, recoveryMinutes, documentSizePresets: normalizedSizes, exportScalePresets: normalizedScales, rotationIndicatorPosition, drawingBrushPreviewEnabled, relativeLuminanceScope, zoomToolDragMode, brushShiftLineEnabled: initialPreferences.brushShiftLineEnabled })
    window.dispatchEvent(new Event('moonsprite:preferences-changed'))
    onPresetChange(normalizedSizes, normalizedScales)
  }
  return <div className="modal-backdrop" role="presentation"><section className="modal settings-modal" role="dialog" aria-label="首选项">
    <header><div><span className="eyebrow">PREFERENCES</span><h2>首选项</h2></div><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={16} /></button></header>
    <div className="settings-layout"><nav>{[['general', '常规'], ['files', '文件'], ['presets', '预设'], ['reset', '重置']].map(([id, label]) => <button key={id} className={section === id ? 'selected' : ''} onClick={() => setSection(id as typeof section)}>{label}</button>)}</nav><main>
      {section === 'general' && <><label className="preference-field">语言<ThemedSelect value={language} groups={[{ label: '语言', options: [{ value: 'zh-CN', label: '简体中文' }, { value: 'en-US', label: 'English' }] }]} label="语言" onChange={setLanguage} /></label><label className="preference-field">旋转指向标位置<ThemedSelect value={rotationIndicatorPosition} groups={[{ label: '位置', options: [{ value: 'view', label: '视图中心' }, { value: 'canvas', label: '画布中心' }] }]} label="旋转指向标位置" onChange={(value) => setRotationIndicatorPosition(value as RotationIndicatorPosition)} /></label><label className="preference-field">缩放工具按住拖动<ThemedSelect value={zoomToolDragMode} groups={[{ label: '缩放方式', options: [{ value: 'smooth', label: '平滑缩放' }, { value: 'stepped', label: '百分比缩放' }] }]} label="缩放工具按住拖动" onChange={(value) => setZoomToolDragMode(value as ZoomToolDragMode)} /></label><label className="preference-field">查看相对明暗作用区域<ThemedSelect value={relativeLuminanceScope} groups={[{ label: '作用区域', options: [{ value: 'canvas', label: '画布视图内' }, { value: 'app', label: '整体（整个软件）' }] }]} label="查看相对明暗作用区域" onChange={(value) => setRelativeLuminanceScope(value as RelativeLuminanceScope)} /></label><label className="preference-toggle outline-preview-toggle"><span className="outline-preview-label"><Eye size={15} />绘制时显示画笔预览</span><input type="checkbox" checked={drawingBrushPreviewEnabled} onChange={(event) => setDrawingBrushPreviewEnabled(event.target.checked)} /><span className="toggle-track" aria-hidden="true"><i /></span></label></>}
      {section === 'files' && <><label className="preference-field">默认保存格式<ThemedSelect value={saveFormat} groups={[{ label: '保存格式', options: [{ value: 'moonsprite', label: '.moonsprite' }, { value: 'png', label: '.png' }, { value: 'jpeg', label: '.jpg / .jpeg' }, { value: 'webp', label: '.webp' }, { value: 'ase', label: '.ase' }, { value: 'aseprite', label: '.aseprite' }] }]} label="默认保存格式" onChange={setSaveFormat} /></label><label className="preference-field">默认导出格式<ThemedSelect value={exportFormat} groups={[{ label: '导出格式', options: [{ value: 'png', label: 'PNG' }, { value: 'jpeg', label: 'JPEG' }, { value: 'webp', label: 'WebP' }, { value: 'svg', label: 'SVG' }] }]} label="默认导出格式" onChange={setExportFormat} /></label><label className="preference-toggle outline-preview-toggle"><span>启用异常恢复</span><input type="checkbox" checked={recovery} onChange={(event) => setRecovery(event.target.checked)} /><span className="toggle-track" aria-hidden="true"><i /></span></label><label className="preference-field">恢复间隔<NumberInput min={1} max={60} suffix="分钟" value={recoveryMinutes} onValueChange={setRecoveryMinutes} /></label></>}
      {section === 'presets' && <div className="preference-presets"><section><header><strong>新建工程尺寸</strong><button type="button" onClick={() => setDocumentSizePresets((current) => [...current, { width: 64, height: 64 }])}><Plus size={13} />新增尺寸</button></header><div className="preference-preset-grid">{documentSizePresets.map((preset, index) => <div className="document-size-preset-row" key={index}><NumberInput aria-label={`预设 ${index + 1} 宽度`} min={1} max={16384} suffix="px" value={preset.width} onValueChange={(value) => updateDocumentSize(index, 'width', value)} /><span>x</span><NumberInput aria-label={`预设 ${index + 1} 高度`} min={1} max={16384} suffix="px" value={preset.height} onValueChange={(value) => updateDocumentSize(index, 'height', value)} /><button type="button" className="icon-button" aria-label={`删除尺寸 ${preset.width}x${preset.height}`} disabled={documentSizePresets.length === 1} onClick={() => setDocumentSizePresets((current) => current.filter((_, presetIndex) => presetIndex !== index))}><Trash2 size={13} /></button></div>)}</div></section><section><header><strong>导出图片放大倍数</strong><button type="button" onClick={() => setExportScalePresets((current) => [...current, 100])}><Plus size={13} />新增倍数</button></header><div className="preference-preset-grid export-scale-preset-grid">{exportScalePresets.map((scale, index) => <div className="export-scale-preset-row" key={index}><NumberInput aria-label={`导出倍数 ${index + 1}`} min={1} max={6400} suffix="%" value={scale} onValueChange={(value) => setExportScalePresets((current) => current.map((currentScale, scaleIndex) => scaleIndex === index ? value : currentScale))} /><button type="button" className="icon-button" aria-label={`删除 ${scale}%`} disabled={exportScalePresets.length === 1} onClick={() => setExportScalePresets((current) => current.filter((_, scaleIndex) => scaleIndex !== index))}><Trash2 size={13} /></button></div>)}</div></section></div>}
      {section === 'reset' && <><p>重置会清空本地工作区、工具、调色盘和快捷键设置，当前打开的工程文件不会删除。</p><button className="danger-button" onClick={() => { clearStoredValues(); window.location.reload() }}>恢复所有初始设置</button></>}
    </main></div>
    <footer><button className="quiet-button" onClick={onClose}>取消</button><button className="primary-button" onClick={() => { persist(); onClose() }}>确定</button></footer>
  </section></div>
}
