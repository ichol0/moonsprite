import { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_COLOR_EDITOR_MODES,
  DEFAULT_LAYER_DISPLAY_COLOR_PRESETS,
  UI_SCALE_VALUES,
  loadEditorPreferences,
  parseDocumentSizePresets,
  parseExportScalePresets,
  parseLayerDisplayColorPresets,
  saveEditorPreferences,
  setEditorPreferencesPreview,
  type BrushPreviewMode,
  type CursorScale,
  type DocumentSizePreset,
  type EyedropperMagnifierStyle,
  type RelativeLuminanceScope,
  type RotationIndicatorPosition,
  type UiScale,
  type ZoomToolDragMode
} from '@/core/file-preferences'
import { PixelUtilityIcon } from '@/components/PixelUtilityIcon'
import { clearStoredValuesExcept } from '@/core/storage'
import { GALLERY_PINS_STORAGE_KEY, RECENT_PROJECTS_STORAGE_KEY } from '@/core/home-history'
import { AVAILABLE_APP_LOCALES, localeDisplayName, type AppLocale } from '@/core/localization'
import { ColorValueControl } from '@/components/ColorValueControl'
import { DeleteIconButton } from '@/components/DeleteIconButton'
import { useI18n } from '@/components/I18nProvider'
import { ModalShell } from '@/components/ModalShell'
import { NumberInput } from '@/components/NumberInput'
import { ThemedSelect } from '@/components/ThemedSelect'
import { Tooltip } from '@/components/Tooltip'
import { useWorkspace } from '@/store/workspace'
import { applyThemeToDocument, resolveTheme, type ThemeVisualDefaults } from '@/core/theme'
import { ThemePreferencesSection } from './ThemePreferencesSection'

interface PreferencesDialogProps {
  onClose: () => void
  onPresetChange: (documentSizes: DocumentSizePreset[], exportScales: number[]) => void
}

type PreferenceSection = 'general' | 'theme' | 'files' | 'cursor' | 'toolPreview' | 'background' | 'editing' | 'colors' | 'layers' | 'presets' | 'reset'

export function PreferencesDialog({ onClose, onPresetChange }: PreferencesDialogProps) {
  const { locale, t } = useI18n()
  const [section, setSection] = useState<PreferenceSection>('general')
  const [preferences, setPreferences] = useState(loadEditorPreferences)
  const [draggedColorMode, setDraggedColorMode] = useState<number | null>(null)
  const colorModePointerDragRef = useRef<{ index: number } | null>(null)
  const update = <K extends keyof typeof preferences>(key: K, value: typeof preferences[K]): void => setPreferences((current) => ({ ...current, [key]: value }))
  const updateDocumentSize = (index: number, key: keyof DocumentSizePreset, value: number): void => update('documentSizePresets', preferences.documentSizePresets.map((preset, presetIndex) => presetIndex === index ? { ...preset, [key]: value } : preset))
  const updateLayerColorPreset = (index: number, color: typeof preferences.layerDisplayColorPresets[number]): void => update('layerDisplayColorPresets', preferences.layerDisplayColorPresets.map((preset, presetIndex) => presetIndex === index ? { ...color, a: 255 } : preset))
  const setVisualOverride = (key: keyof ThemeVisualDefaults, color: typeof preferences.pixelGridColor): void => setPreferences((current) => {
    const theme = { ...current.theme, visualOverrides: { ...current.theme.visualOverrides, [key]: { ...color } } }
    if (key === 'checkerLight') return { ...current, theme, checkerboard: { ...current.checkerboard, lightColor: { ...color, a: 255 } } }
    if (key === 'checkerDark') return { ...current, theme, checkerboard: { ...current.checkerboard, darkColor: { ...color, a: 255 } } }
    if (key === 'pixelGrid') return { ...current, theme, pixelGridColor: { ...color } }
    if (key === 'customGrid') return { ...current, theme, gridColor: { ...color } }
    return { ...current, theme }
  })
  const clearVisualOverrides = (keys: Array<keyof ThemeVisualDefaults>): void => setPreferences((current) => {
    const visualOverrides = { ...(current.theme.visualOverrides ?? {}) }
    for (const key of keys) delete visualOverrides[key]
    const theme = { ...current.theme, visualOverrides }
    const visual = resolveTheme(theme).visualDefaults
    return {
      ...current,
      theme,
      checkerboard: { ...current.checkerboard, lightColor: keys.includes('checkerLight') ? { ...visual.checkerLight } : current.checkerboard.lightColor, darkColor: keys.includes('checkerDark') ? { ...visual.checkerDark } : current.checkerboard.darkColor },
      pixelGridColor: keys.includes('pixelGrid') ? { ...visual.pixelGrid } : current.pixelGridColor,
      gridColor: keys.includes('customGrid') ? { ...visual.customGrid } : current.gridColor
    }
  })
  const moveColorMode = (index: number, target: number): void => setPreferences((current) => {
    if (target < 0 || target >= current.colorEditorModes.length || index === target) return current
    const next = current.colorEditorModes.map((item) => ({ ...item }))
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    return { ...current, colorEditorModes: next }
  })
  const beginColorModePointerDrag = (event: React.PointerEvent<HTMLElement>, index: number): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    colorModePointerDragRef.current = { index }
    setDraggedColorMode(index)
  }
  const moveColorModePointerTo = (target: number): void => {
    const drag = colorModePointerDragRef.current
    if (!drag || target < 0 || target === drag.index) return
    moveColorMode(drag.index, target)
    drag.index = target
    setDraggedColorMode(target)
  }
  useEffect(() => {
    setEditorPreferencesPreview(preferences)
    applyThemeToDocument(preferences.theme)
    window.dispatchEvent(new Event('moonsprite:preferences-changed'))
  }, [preferences])
  useEffect(() => () => {
    setEditorPreferencesPreview(null)
    applyThemeToDocument(loadEditorPreferences().theme)
    window.dispatchEvent(new Event('moonsprite:preferences-changed'))
  }, [])
  useEffect(() => {
    const move = (event: PointerEvent): void => {
      const drag = colorModePointerDragRef.current
      if (!drag) return
      const pointed = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(event.clientX, event.clientY) : null
      const row = (pointed instanceof Element ? pointed.closest<HTMLElement>('[data-color-mode-index]') : null)
        ?? (event.target instanceof Element ? event.target.closest<HTMLElement>('[data-color-mode-index]') : null)
      const target = row ? Number(row.dataset.colorModeIndex) : -1
      if (!Number.isInteger(target) || target < 0) return
      moveColorModePointerTo(target)
      event.preventDefault()
    }
    const end = (event: PointerEvent): void => {
      const drag = colorModePointerDragRef.current
      if (!drag) return
      colorModePointerDragRef.current = null
      setDraggedColorMode(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [])
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
      title: t('preferences.resetDialog.title'),
      message: t('preferences.resetDialog.message'),
      detail: t('preferences.resetDialog.detail'),
      choices: [
        { id: 'cancel', label: t('preferences.cancel'), tone: 'quiet' },
        { id: 'reset', label: t('preferences.resetAll'), tone: 'danger' }
      ]
    })
    if (choice !== 'reset') return
    clearStoredValuesExcept([RECENT_PROJECTS_STORAGE_KEY, GALLERY_PINS_STORAGE_KEY])
    window.location.reload()
  }
  const toggle = (label: string, checked: boolean, onChange: (checked: boolean) => void, tooltip?: string) => <label className="preference-toggle outline-preview-toggle"><Tooltip content={tooltip}><span>{label}</span></Tooltip><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className="toggle-track" aria-hidden="true"><i /></span></label>

  return <div className="modal-backdrop" role="presentation"><ModalShell storageKey="preferences" defaultWidth={720} defaultHeight={560} minWidth={620} minHeight={460} fitContent={false} className="settings-modal" role="dialog" aria-label={t('preferences.title')}>
    <header><div><span className="eyebrow">{t('preferences.eyebrow')}</span><h2>{t('preferences.title')}</h2></div><button className="icon-button" aria-label={t('common.close')} onClick={onClose}><PixelUtilityIcon kind="close" /></button></header>
    <div className="settings-layout"><nav>{([['general', 'preferences.sections.general'], ['theme', 'preferences.sections.theme'], ['files', 'preferences.sections.files'], ['cursor', 'preferences.sections.cursor'], ['toolPreview', 'preferences.sections.toolPreview'], ['background', 'preferences.sections.background'], ['editing', 'preferences.sections.editing'], ['colors', 'preferences.sections.colors'], ['layers', 'preferences.sections.layers'], ['presets', 'preferences.sections.presets'], ['reset', 'preferences.sections.reset']] as Array<[PreferenceSection, Parameters<typeof t>[0]]>).map(([id, labelKey]) => <button key={id} className={section === id ? 'selected' : ''} onClick={() => setSection(id)}>{t(labelKey)}</button>)}</nav><main>
      {section === 'general' && <>
        <label className="preference-field">{t('preferences.language')}<ThemedSelect value={preferences.language} groups={[{ label: t('preferences.languageGroup'), options: AVAILABLE_APP_LOCALES.map((value) => ({ value, label: localeDisplayName(value, locale) })) }]} label={t('preferences.language')} onChange={(value) => update('language', value as AppLocale)} /></label>
        <label className="preference-field">{t('preferences.uiScale')}<ThemedSelect value={String(preferences.uiScale)} groups={[{ label: t('preferences.uiScaleGroup'), options: UI_SCALE_VALUES.map((value) => ({ value: String(value), label: `${Math.round(value * 100)}%` })) }]} label={t('preferences.uiScale')} onChange={(value) => update('uiScale', Number(value) as UiScale)} /></label>
        {toggle(t('preferences.timelapseRecording'), preferences.timelapseRecordingEnabled, (value) => update('timelapseRecordingEnabled', value), t('preferences.timelapseRecordingHint'))}
        <label className="preference-field">{t('preferences.position')}<ThemedSelect value={preferences.rotationIndicatorPosition} groups={[{ label: t('preferences.positionGroup'), options: [{ value: 'view', label: t('preferences.position.view') }, { value: 'canvas', label: t('preferences.position.canvas') }] }]} label={t('preferences.position')} onChange={(value) => update('rotationIndicatorPosition', value as RotationIndicatorPosition)} /></label>
        <label className="preference-field">{t('preferences.zoomMode')}<ThemedSelect value={preferences.zoomToolDragMode} groups={[{ label: t('preferences.zoomModeGroup'), options: [{ value: 'smooth', label: t('preferences.zoomMode.smooth') }, { value: 'stepped', label: t('preferences.zoomMode.stepped') }] }]} label={t('preferences.zoomMode')} onChange={(value) => update('zoomToolDragMode', value as ZoomToolDragMode)} /></label>
        <label className="preference-field">{t('preferences.luminanceScope')}<ThemedSelect value={preferences.relativeLuminanceScope} groups={[{ label: t('preferences.luminanceScopeGroup'), options: [{ value: 'canvas', label: t('preferences.luminanceScope.canvas') }, { value: 'app', label: t('preferences.luminanceScope.app') }] }]} label={t('preferences.luminanceScope')} onChange={(value) => update('relativeLuminanceScope', value as RelativeLuminanceScope)} /></label>
      </>}
      {section === 'theme' && <ThemePreferencesSection preferences={preferences} onChange={setPreferences} />}
      {section === 'files' && <>
        <label className="preference-field">{t('preferences.saveFormat')}<ThemedSelect value={preferences.saveFormat} groups={[{ label: t('preferences.saveFormatGroup'), options: [{ value: 'moonsprite', label: '.moonsprite' }, { value: 'png', label: '.png' }, { value: 'jpeg', label: '.jpg / .jpeg' }, { value: 'webp', label: '.webp' }, { value: 'ase', label: '.ase' }, { value: 'aseprite', label: '.aseprite' }] }]} label={t('preferences.saveFormat')} onChange={(value) => update('saveFormat', value)} /></label>
        <label className="preference-field">{t('preferences.exportFormat')}<ThemedSelect value={preferences.exportFormat} groups={[{ label: t('preferences.exportFormatGroup'), options: [{ value: 'png', label: 'PNG' }, { value: 'jpeg', label: 'JPEG' }, { value: 'webp', label: 'WebP' }, { value: 'svg', label: 'SVG' }, { value: 'gif', label: 'GIF' }] }]} label={t('preferences.exportFormat')} onChange={(value) => update('exportFormat', value)} /></label>
        <label className="preference-field">{t('preferences.recovery')}<ThemedSelect value={recoveryValue} groups={[{ label: t('preferences.recoveryGroup'), options: [{ value: 'off', label: t('preferences.recovery.off') }, { value: '0.5', label: t('preferences.recovery.seconds30') }, { value: '1', label: t('preferences.recovery.minutes1') }, { value: '2', label: t('preferences.recovery.minutes2') }, { value: '5', label: t('preferences.recovery.minutes5') }, { value: '10', label: t('preferences.recovery.minutes10') }] }]} label={t('preferences.recovery')} onChange={(value) => setPreferences((current) => value === 'off' ? { ...current, recovery: false } : { ...current, recovery: true, recoveryMinutes: Number(value) })} /></label>
      </>}
      {section === 'cursor' && <>
        {toggle(t('preferences.localCursor'), preferences.useLocalCursors, (value) => update('useLocalCursors', value), t('preferences.localCursorHint'))}
        <label className="preference-field">{t('preferences.cursorScale')}<ThemedSelect value={String(preferences.cursorScale)} groups={[{ label: t('preferences.cursorScaleGroup'), options: [{ value: '1', label: '100%' }, { value: '1.25', label: '125%' }, { value: '1.5', label: '150%' }, { value: '2', label: '200%' }] }]} label={t('preferences.cursorScale')} disabled={preferences.useLocalCursors} onChange={(value) => update('cursorScale', Number(value) as CursorScale)} /></label>
      </>}
      {section === 'toolPreview' && <>
        <label className="preference-field">{t('preferences.brushPreview')}<ThemedSelect value={preferences.brushPreviewMode} groups={[{ label: t('preferences.brushPreviewGroup'), options: [{ value: 'none', label: t('preferences.brushPreview.none') }, { value: 'edge', label: t('preferences.brushPreview.edge') }, { value: 'full', label: t('preferences.brushPreview.full') }, { value: 'full-edge', label: t('preferences.brushPreview.fullEdge') }] }]} label={t('preferences.brushPreview')} onChange={(value) => update('brushPreviewMode', value as BrushPreviewMode)} /></label>
        {preferences.brushPreviewMode === 'full-edge' && toggle(t('preferences.drawingBrushPreview'), preferences.drawingBrushPreviewEnabled, (value) => update('drawingBrushPreviewEnabled', value))}
        {toggle(t('preferences.selectionCrosshair'), preferences.selectionCrosshair, (value) => update('selectionCrosshair', value))}
        {toggle(t('preferences.moveLayerContentPreview'), preferences.moveLayerContentPreviewEnabled, (value) => update('moveLayerContentPreviewEnabled', value), t('preferences.moveLayerContentPreviewHint'))}
        {toggle(t('preferences.eyedropperMagnifier'), preferences.eyedropperMagnifierEnabled, (value) => update('eyedropperMagnifierEnabled', value), t('preferences.eyedropperMagnifierHint'))}
        <label className="preference-field"><Tooltip content={t('preferences.eyedropperMagnifierStyleHint')}><span>{t('preferences.eyedropperMagnifierStyle')}</span></Tooltip><ThemedSelect value={preferences.eyedropperMagnifierStyle} groups={[{ label: t('preferences.eyedropperMagnifierStyleGroup'), options: [{ value: 'pixel', label: t('preferences.eyedropperMagnifierStyle.pixel') }, { value: 'line', label: t('preferences.eyedropperMagnifierStyle.line') }] }]} label={t('preferences.eyedropperMagnifierStyle')} onChange={(value) => update('eyedropperMagnifierStyle', value as EyedropperMagnifierStyle)} /></label>
        {toggle(t('preferences.eyedropperMagnifierDistortion'), preferences.eyedropperMagnifierDistortionEnabled, (value) => update('eyedropperMagnifierDistortionEnabled', value), t('preferences.eyedropperMagnifierDistortionHint'))}
      </>}
      {section === 'background' && <>
        <label className="preference-field">{t('preferences.checkerSize')}<NumberInput aria-label={t('preferences.checkerSize')} min={1} max={256} suffix="px" value={preferences.checkerboard.size} onValueChange={(size) => update('checkerboard', { ...preferences.checkerboard, size: Math.round(size) })} /></label>
        <div className="preference-checker-colors"><div className="preference-checker-color-heading"><span>{t('preferences.checkerColors')}</span><button type="button" className="quiet-button" onClick={() => clearVisualOverrides(['checkerLight', 'checkerDark'])}><PixelUtilityIcon kind="restore" />{t('preferences.theme.restore')}</button></div><div className="preference-color-value-list"><ColorValueControl color={preferences.checkerboard.lightColor} onChange={(lightColor) => setVisualOverride('checkerLight', { ...lightColor, a: 255 })} label={t('preferences.checkerColors')} roleLabel={t('preferences.lightColor')} /><ColorValueControl color={preferences.checkerboard.darkColor} onChange={(darkColor) => setVisualOverride('checkerDark', { ...darkColor, a: 255 })} label={t('preferences.checkerColors')} roleLabel={t('preferences.darkColor')} /></div></div>
        <div className="preference-checker-colors preference-grid-colors"><div className="preference-checker-color-heading"><span>{t('preferences.pixelGridColor')}</span><button type="button" className="quiet-button" onClick={() => clearVisualOverrides(['pixelGrid'])}><PixelUtilityIcon kind="restore" />{t('preferences.theme.restore')}</button></div><div className="preference-grid-color-list"><ColorValueControl color={preferences.pixelGridColor} onChange={(color) => setVisualOverride('pixelGrid', color)} label={t('preferences.pixelGridColor')} roleLabel={t('preferences.pixelGridColor')} inPalette={false} /></div></div>
        <div className="preference-checker-colors preference-grid-colors"><div className="preference-checker-color-heading"><span>{t('preferences.gridColor')}</span><button type="button" className="quiet-button" onClick={() => clearVisualOverrides(['customGrid'])}><PixelUtilityIcon kind="restore" />{t('preferences.theme.restore')}</button></div><div className="preference-grid-color-list"><ColorValueControl color={preferences.gridColor} onChange={(color) => setVisualOverride('customGrid', color)} label={t('preferences.gridColor')} roleLabel={t('preferences.gridColor')} inPalette={false} /></div></div>
      </>}
      {section === 'editing' && <>
        {toggle(t('preferences.wheelZoom'), preferences.wheelZoomEnabled, (value) => update('wheelZoomEnabled', value))}
        {toggle(t('preferences.shiftLinePreview'), preferences.shiftLinePreviewEnabled, (value) => update('shiftLinePreviewEnabled', value))}
        {toggle(t('preferences.balancedLine'), preferences.balancedShiftLineEnabled, (value) => update('balancedShiftLineEnabled', value), t('preferences.balancedLineHint'))}
        <label className="preference-field"><Tooltip content={t('preferences.lineDirectionStepHint')}><span>{t('preferences.lineDirectionStep')}</span></Tooltip><NumberInput aria-label={t('preferences.lineDirectionStep')} min={1} max={16} value={preferences.lineDirectionStep} onValueChange={(value) => update('lineDirectionStep', Math.round(value))} /></label>
        {toggle(t('preferences.lassoClosed'), preferences.lassoPreviewClosed, (value) => update('lassoPreviewClosed', value))}
        {toggle(t('preferences.eyedropperPencil'), preferences.eyedropperSwitchToPencil, (value) => update('eyedropperSwitchToPencil', value))}
      </>}
      {section === 'colors' && <div className="preference-presets preference-color-settings"><section><header><strong>{t('preferences.colorModes')}</strong><button type="button" className="quiet-button" onClick={() => update('colorEditorModes', DEFAULT_COLOR_EDITOR_MODES.map((item) => ({ ...item })))}><PixelUtilityIcon kind="restore" />{t('preferences.restoreDefaults')}</button></header><div className="preference-color-mode-list">{preferences.colorEditorModes.map((item, index) => {
        const enabledCount = preferences.colorEditorModes.filter((candidate) => candidate.enabled).length
        return <div className={`preference-color-mode-row ${draggedColorMode === index ? 'dragging' : ''}`} data-color-mode-index={index} key={item.mode} onPointerDown={(event) => { if ((event.target as Element).closest('.color-mode-drag-handle')) beginColorModePointerDrag(event, index) }} onPointerEnter={() => moveColorModePointerTo(index)} onPointerMove={() => moveColorModePointerTo(index)}><span className="color-mode-drag-handle" aria-hidden="true"><PixelUtilityIcon kind="move" /></span><span className="color-mode-name">{item.mode === 'gray' ? 'Gray' : item.mode.toUpperCase()}</span><button type="button" className="icon-button color-mode-visibility" aria-label={item.enabled ? `${item.mode} enabled` : `${item.mode} disabled`} aria-pressed={item.enabled} disabled={item.enabled && enabledCount === 1} onClick={() => update('colorEditorModes', preferences.colorEditorModes.map((candidate) => candidate.mode === item.mode ? { ...candidate, enabled: !candidate.enabled } : candidate))}>{item.enabled ? <PixelUtilityIcon kind="eye" /> : <PixelUtilityIcon kind="eyeOff" />}</button></div>
      })}</div></section></div>}
      {section === 'layers' && <div className="preference-presets preference-layer-settings preference-checker-colors"><section><header><strong>{t('preferences.layerColors')}</strong><div><button type="button" className="quiet-button" aria-label={t('preferences.restoreDefaults')} onClick={() => update('layerDisplayColorPresets', DEFAULT_LAYER_DISPLAY_COLOR_PRESETS.map((color) => ({ ...color })))}><PixelUtilityIcon kind="restore" /><span>{t('preferences.restoreDefaults')}</span></button><button type="button" className="quiet-button" disabled={preferences.layerDisplayColorPresets.length >= 12} onClick={() => update('layerDisplayColorPresets', [...preferences.layerDisplayColorPresets, { r: 117, g: 117, b: 117, a: 255 }])}><PixelUtilityIcon kind="plus" /><span>{t('preferences.addColor')}</span></button></div></header>
        <div className="preference-layer-color-grid">{preferences.layerDisplayColorPresets.map((color, index) => <div className="preference-layer-color-row" key={index}><ColorValueControl color={color} onChange={(value) => updateLayerColorPreset(index, value)} label={t('preferences.layerColorAria', { index: index + 1 })} storageKey="layer-preset" /><DeleteIconButton size="regular" aria-label={t('preferences.deleteLayerColorAria', { index: index + 1 })} disabled={preferences.layerDisplayColorPresets.length === 1} onClick={() => update('layerDisplayColorPresets', preferences.layerDisplayColorPresets.filter((_, presetIndex) => presetIndex !== index))} /></div>)}</div>
      </section></div>}
      {section === 'presets' && <div className="preference-presets"><section><header><strong>{t('preferences.newDocumentPresets')}</strong><button type="button" onClick={() => update('documentSizePresets', [...preferences.documentSizePresets, { width: 64, height: 64 }])}><PixelUtilityIcon kind="plus" />{t('preferences.addSize')}</button></header><div className="preference-preset-grid">{preferences.documentSizePresets.map((preset, index) => <div className="document-size-preset-row" key={index}><NumberInput aria-label={t('preferences.presetWidthAria', { index: index + 1 })} min={1} max={16384} suffix="px" value={preset.width} onValueChange={(value) => updateDocumentSize(index, 'width', value)} /><span>x</span><NumberInput aria-label={t('preferences.presetHeightAria', { index: index + 1 })} min={1} max={16384} suffix="px" value={preset.height} onValueChange={(value) => updateDocumentSize(index, 'height', value)} /><DeleteIconButton aria-label={t('preferences.deleteSizeAria', { width: preset.width, height: preset.height })} disabled={preferences.documentSizePresets.length === 1} onClick={() => update('documentSizePresets', preferences.documentSizePresets.filter((_, presetIndex) => presetIndex !== index))} /></div>)}</div></section><section><header><strong>{t('preferences.exportScalePresets')}</strong><button type="button" onClick={() => update('exportScalePresets', [...preferences.exportScalePresets, 100])}><PixelUtilityIcon kind="plus" />{t('preferences.addScale')}</button></header><div className="preference-preset-grid export-scale-preset-grid">{preferences.exportScalePresets.map((scale, index) => <div className="export-scale-preset-row" key={index}><NumberInput aria-label={t('preferences.exportScaleAria', { index: index + 1 })} min={1} max={6400} suffix="%" value={scale} onValueChange={(value) => update('exportScalePresets', preferences.exportScalePresets.map((currentScale, scaleIndex) => scaleIndex === index ? value : currentScale))} /><DeleteIconButton aria-label={t('preferences.deleteScaleAria', { scale })} disabled={preferences.exportScalePresets.length === 1} onClick={() => update('exportScalePresets', preferences.exportScalePresets.filter((_, scaleIndex) => scaleIndex !== index))} /></div>)}</div></section></div>}
      {section === 'reset' && <><p>{t('preferences.resetDescription')}</p><button className="danger-button" onClick={() => void resetAllSettings()}>{t('preferences.resetAll')}</button></>}
    </main></div>
    <footer><button className="quiet-button" onClick={onClose}>{t('preferences.cancel')}</button><button className="quiet-button" onClick={persist}>{t('preferences.apply')}</button><button className="primary-button" onClick={() => { persist(); onClose() }}>{t('preferences.confirm')}</button></footer>
  </ModalShell></div>
}
