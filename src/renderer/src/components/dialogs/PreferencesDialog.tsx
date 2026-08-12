import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
  type ToolIconScale,
  type UiScale,
  type WheelZoomMode,
  type ZoomToolDragMode
} from '@/core/file-preferences'
import { PixelUtilityIcon } from '@/components/PixelUtilityIcon'
import { clearStoredValuesExcept } from '@/core/storage'
import { GALLERY_PINS_STORAGE_KEY, RECENT_PROJECTS_STORAGE_KEY } from '@/core/home-history'
import { AVAILABLE_APP_LOCALES, localeDisplayName, type AppLocale, type TranslationKey } from '@/core/localization'
import { ColorValueControl } from '@/components/ColorValueControl'
import { DeleteIconButton } from '@/components/DeleteIconButton'
import { DialogHeader } from '@/components/DialogHeader'
import { FormField } from '@/components/FormField'
import { useI18n } from '@/components/I18nProvider'
import { ModalShell } from '@/components/ModalShell'
import { NumberInput } from '@/components/NumberInput'
import { PixelCheckbox } from '@/components/PixelCheckbox'
import { PreferenceToggle } from '@/components/PreferenceToggle'
import { SettingsSectionHeader } from '@/components/SettingsSectionHeader'
import { SettingsNavigation } from '@/components/SettingsNavigation'
import { TextInput } from '@/components/TextInput'
import { ThemedSelect } from '@/components/ThemedSelect'
import { useWorkspace } from '@/store/workspace'
import { applyThemeToDocument, resolveTheme, type ThemeVisualDefaults } from '@/core/theme'
import { ThemePreferencesSection } from './ThemePreferencesSection'

interface PreferencesDialogProps {
  onClose: () => void
  onPresetChange: (documentSizes: DocumentSizePreset[], exportScales: number[]) => void
}

type PreferenceSection = 'general' | 'appearance' | 'theme' | 'input' | 'tools' | 'files' | 'colorLayers' | 'presets' | 'reset'

const PREFERENCE_SECTIONS: Array<[PreferenceSection, TranslationKey]> = [
  ['general', 'preferences.sections.general'],
  ['appearance', 'preferences.sections.appearance'],
  ['theme', 'preferences.sections.theme'],
  ['input', 'preferences.sections.input'],
  ['tools', 'preferences.sections.tools'],
  ['files', 'preferences.sections.files'],
  ['colorLayers', 'preferences.sections.colors'],
  ['presets', 'preferences.sections.presets'],
  ['reset', 'preferences.sections.reset']
]

const PREFERENCE_SEARCH_KEYS: Record<PreferenceSection, TranslationKey[]> = {
  general: ['preferences.groups.interface', 'preferences.groups.project', 'preferences.language', 'preferences.uiScale', 'preferences.toolIconScale', 'preferences.timelapseRecording'],
  appearance: ['preferences.groups.canvas', 'preferences.checkerSize', 'preferences.checkerColors', 'preferences.lightColor', 'preferences.darkColor', 'preferences.pixelGridColor', 'preferences.gridColor', 'preferences.luminanceScope'],
  theme: ['preferences.groups.theme', 'preferences.theme.available', 'preferences.theme.current'],
  input: ['preferences.groups.cursor', 'preferences.localCursor', 'preferences.cursorScale', 'preferences.groups.zoom', 'preferences.wheelZoom', 'preferences.wheelZoomMode', 'preferences.zoomMode', 'preferences.position'],
  tools: ['preferences.groups.previews', 'preferences.brushPreview', 'preferences.drawingBrushPreview', 'preferences.selectionCrosshair', 'preferences.moveLayerContentPreview', 'preferences.groups.drawing', 'preferences.shiftLinePreview', 'preferences.balancedLine', 'preferences.lineDirectionStep', 'preferences.lassoClosed', 'preferences.eyedropperPencil', 'preferences.groups.eyedropper', 'preferences.eyedropperMagnifier', 'preferences.eyedropperMagnifierStyle', 'preferences.eyedropperMagnifierDistortion'],
  files: ['preferences.groups.locations', 'preferences.saveDirectory', 'preferences.exportDirectory', 'preferences.groups.formats', 'preferences.saveFormat', 'preferences.exportFormat', 'preferences.groups.recovery', 'preferences.recovery'],
  colorLayers: ['preferences.colorModes', 'preferences.restoreDefaults'],
  presets: ['preferences.newDocumentPresets', 'preferences.addSize', 'preferences.exportScalePresets', 'preferences.addScale', 'preferences.layerColors', 'preferences.addColor', 'preferences.restoreDefaults'],
  reset: ['preferences.resetDescription', 'preferences.resetAll']
}

function PreferenceGroup({ children, className = '', title }: { children: ReactNode; className?: string; title: ReactNode }) {
  return <section className={`preference-settings-group ${className}`.trim()}>
    <SettingsSectionHeader title={title} />
    <div className="preference-settings-group-body">{children}</div>
  </section>
}

export function PreferencesDialog({ onClose, onPresetChange }: PreferencesDialogProps) {
  const { locale, t } = useI18n()
  const [section, setSection] = useState<PreferenceSection>('general')
  const [query, setQuery] = useState('')
  const [preferences, setPreferences] = useState(loadEditorPreferences)
  const [defaultDirectories, setDefaultDirectories] = useState({ saveDirectory: 'gallery', exportDirectory: 'exports' })
  const [draggedColorMode, setDraggedColorMode] = useState<string | null>(null)
  const colorModePointerDragRef = useRef<{ mode: string; pointerId: number; captureTarget: HTMLElement } | null>(null)
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
  const moveColorMode = (mode: string, targetMode: string, insertAfter: boolean): void => setPreferences((current) => {
    const index = current.colorEditorModes.findIndex((item) => item.mode === mode)
    if (index < 0 || mode === targetMode) return current
    const next = current.colorEditorModes.map((item) => ({ ...item }))
    const [item] = next.splice(index, 1)
    const target = next.findIndex((candidate) => candidate.mode === targetMode)
    if (target < 0) return current
    next.splice(target + (insertAfter ? 1 : 0), 0, item)
    if (next.every((candidate, nextIndex) => candidate.mode === current.colorEditorModes[nextIndex]?.mode)) return current
    return { ...current, colorEditorModes: next }
  })
  const beginColorModePointerDrag = (event: React.PointerEvent<HTMLElement>, mode: string): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    colorModePointerDragRef.current = { mode, pointerId: event.pointerId, captureTarget: event.currentTarget }
    setDraggedColorMode(mode)
  }
  useEffect(() => {
    setEditorPreferencesPreview(preferences)
    applyThemeToDocument(preferences.theme)
    window.dispatchEvent(new Event('moonsprite:preferences-changed'))
  }, [preferences])
  useEffect(() => {
    if (typeof window.moonSprite?.getDefaultFileDirectories !== 'function') return
    let active = true
    void window.moonSprite.getDefaultFileDirectories().then((directories) => {
      if (active) setDefaultDirectories(directories)
    }).catch(() => undefined)
    return () => { active = false }
  }, [])
  useEffect(() => () => {
    setEditorPreferencesPreview(null)
    applyThemeToDocument(loadEditorPreferences().theme)
    window.dispatchEvent(new Event('moonsprite:preferences-changed'))
  }, [])
  useEffect(() => {
    const move = (event: PointerEvent): void => {
      const drag = colorModePointerDragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      const row = (typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(event.clientX, event.clientY) : [])
        .map((element) => element.closest<HTMLElement>('[data-color-mode]'))
        .find((element): element is HTMLElement => Boolean(element))
        ?? (event.target instanceof Element ? event.target.closest<HTMLElement>('[data-color-mode]') : null)
      const targetMode = row?.dataset.colorMode
      if (!row || !targetMode || targetMode === drag.mode) return
      const bounds = row.getBoundingClientRect()
      moveColorMode(drag.mode, targetMode, event.clientY >= bounds.top + bounds.height / 2)
      event.preventDefault()
    }
    const end = (event: PointerEvent): void => {
      const drag = colorModePointerDragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      if (drag.captureTarget.hasPointerCapture(event.pointerId)) drag.captureTarget.releasePointerCapture(event.pointerId)
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
  const choosePreferenceDirectory = async (kind: 'saveDirectory' | 'exportDirectory'): Promise<void> => {
    if (typeof window.moonSprite?.chooseDirectory !== 'function') return
    const currentPath = preferences[kind] || defaultDirectories[kind]
    try {
      const result = await window.moonSprite.chooseDirectory(currentPath)
      if (!result.canceled && result.directoryPath) update(kind, result.directoryPath)
    } catch {
      useWorkspace.getState().setMessage(t('preferences.directorySelectFailed'))
    }
  }
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
  const toggle = (label: string, checked: boolean, onChange: (checked: boolean) => void, tooltip?: string) => <PreferenceToggle label={label} checked={checked} onChange={onChange} tooltip={tooltip} />
  const normalizedQuery = query.trim().toLocaleLowerCase(locale)
  const visiblePreferenceSections = useMemo(() => PREFERENCE_SECTIONS.filter(([value, labelKey]) => {
    if (!normalizedQuery) return true
    return [t(labelKey), ...PREFERENCE_SEARCH_KEYS[value].map((key) => t(key))].some((label) => label.toLocaleLowerCase(locale).includes(normalizedQuery))
  }), [locale, normalizedQuery, t])
  useEffect(() => {
    if (!normalizedQuery || visiblePreferenceSections.some(([value]) => value === section)) return
    const first = visiblePreferenceSections[0]?.[0]
    if (first) setSection(first)
  }, [normalizedQuery, section, visiblePreferenceSections])

  return <div className="modal-backdrop" role="presentation"><ModalShell storageKey="preferences" defaultWidth={720} defaultHeight={560} minWidth={620} minHeight={460} fitContent={false} className="settings-modal" role="dialog" aria-label={t('preferences.title')}>
    <DialogHeader eyebrow={t('preferences.eyebrow')} title={t('preferences.title')} closeLabel={t('common.close')} onClose={onClose} />
    <div className="settings-layout"><aside className="preference-settings-sidebar"><div className="preference-sidebar-search"><TextInput className="preference-search" placeholder={t('preferences.search')} value={query} onChange={(event) => setQuery(event.target.value)} /></div><SettingsNavigation label={t('preferences.title')} value={section} items={visiblePreferenceSections.map(([value, labelKey]) => ({ value, label: t(labelKey) }))} onChange={setSection} /></aside><main>
      {visiblePreferenceSections.length === 0 ? <p className="preference-search-empty">{t('preferences.searchNoResults')}</p> : <>
      {section === 'general' && <>
        <PreferenceGroup title={t('preferences.groups.interface')}>
          <FormField className="preference-field" label={t('preferences.language')}><ThemedSelect value={preferences.language} groups={[{ label: t('preferences.languageGroup'), options: AVAILABLE_APP_LOCALES.map((value) => ({ value, label: localeDisplayName(value, locale) })) }]} label={t('preferences.language')} onChange={(value) => update('language', value as AppLocale)} /></FormField>
          <FormField className="preference-field" label={t('preferences.uiScale')}><ThemedSelect value={String(preferences.uiScale)} groups={[{ label: t('preferences.uiScaleGroup'), options: UI_SCALE_VALUES.map((value) => ({ value: String(value), label: `${Math.round(value * 100)}%`, description: value === 0.75 ? t('preferences.uiScaleFractionalHint') : undefined })) }]} label={t('preferences.uiScale')} onChange={(value) => update('uiScale', Number(value) as UiScale)} /></FormField>
          <FormField className="preference-field" label={t('preferences.toolIconScale')}><ThemedSelect value={String(preferences.toolIconScale)} groups={[{ label: t('preferences.toolIconScaleGroup'), options: [{ value: '1', label: t('preferences.toolIconScale.normal') }, { value: '2', label: t('preferences.toolIconScale.large') }] }]} label={t('preferences.toolIconScale')} onChange={(value) => update('toolIconScale', Number(value) as ToolIconScale)} /></FormField>
        </PreferenceGroup>
        <PreferenceGroup title={t('preferences.groups.project')}>
          {toggle(t('preferences.timelapseRecording'), preferences.timelapseRecordingEnabled, (value) => update('timelapseRecordingEnabled', value), t('preferences.timelapseRecordingHint'))}
        </PreferenceGroup>
      </>}
      {section === 'appearance' && <>
        <PreferenceGroup title={t('preferences.groups.canvas')}>
          <FormField className="preference-field" label={t('preferences.checkerSize')}><NumberInput aria-label={t('preferences.checkerSize')} min={1} max={256} suffix="px" value={preferences.checkerboard.size} onValueChange={(size) => update('checkerboard', { ...preferences.checkerboard, size: Math.round(size) })} /></FormField>
          <div className="preference-checker-colors"><SettingsSectionHeader className="preference-checker-color-heading" title={t('preferences.checkerColors')} actions={<button type="button" className="quiet-button" onClick={() => clearVisualOverrides(['checkerLight', 'checkerDark'])}><PixelUtilityIcon kind="restore" />{t('preferences.theme.restore')}</button>} /><div className="preference-color-value-list"><ColorValueControl color={preferences.checkerboard.lightColor} density="regular" onChange={(lightColor) => setVisualOverride('checkerLight', { ...lightColor, a: 255 })} label={t('preferences.checkerColors')} roleLabel={t('preferences.lightColor')} fillWithColor /><ColorValueControl color={preferences.checkerboard.darkColor} density="regular" onChange={(darkColor) => setVisualOverride('checkerDark', { ...darkColor, a: 255 })} label={t('preferences.checkerColors')} roleLabel={t('preferences.darkColor')} fillWithColor /></div></div>
          <div className="preference-visual-color-grid"><div className="preference-checker-colors preference-grid-colors"><SettingsSectionHeader className="preference-checker-color-heading" title={t('preferences.pixelGridColor')} actions={<button type="button" className="quiet-button" onClick={() => clearVisualOverrides(['pixelGrid'])}><PixelUtilityIcon kind="restore" />{t('preferences.theme.restore')}</button>} /><div className="preference-grid-color-list"><ColorValueControl color={preferences.pixelGridColor} density="regular" onChange={(color) => setVisualOverride('pixelGrid', color)} label={t('preferences.pixelGridColor')} roleLabel={t('preferences.pixelGridColor')} fillWithColor inPalette={false} /></div></div><div className="preference-checker-colors preference-grid-colors"><SettingsSectionHeader className="preference-checker-color-heading" title={t('preferences.gridColor')} actions={<button type="button" className="quiet-button" onClick={() => clearVisualOverrides(['customGrid'])}><PixelUtilityIcon kind="restore" />{t('preferences.theme.restore')}</button>} /><div className="preference-grid-color-list"><ColorValueControl color={preferences.gridColor} density="regular" onChange={(color) => setVisualOverride('customGrid', color)} label={t('preferences.gridColor')} roleLabel={t('preferences.gridColor')} fillWithColor inPalette={false} /></div></div></div>
          <FormField className="preference-field" label={t('preferences.luminanceScope')}><ThemedSelect value={preferences.relativeLuminanceScope} groups={[{ label: t('preferences.luminanceScopeGroup'), options: [{ value: 'canvas', label: t('preferences.luminanceScope.canvas') }, { value: 'app', label: t('preferences.luminanceScope.app') }] }]} label={t('preferences.luminanceScope')} onChange={(value) => update('relativeLuminanceScope', value as RelativeLuminanceScope)} /></FormField>
        </PreferenceGroup>
      </>}
      {section === 'theme' && <ThemePreferencesSection preferences={preferences} onChange={setPreferences} />}
      {section === 'input' && <>
        <PreferenceGroup title={t('preferences.groups.cursor')}>
          {toggle(t('preferences.localCursor'), preferences.useLocalCursors, (value) => update('useLocalCursors', value), t('preferences.localCursorHint'))}
          <FormField className="preference-field" label={t('preferences.cursorScale')}><ThemedSelect value={String(preferences.cursorScale)} groups={[{ label: t('preferences.cursorScaleGroup'), options: [{ value: '1', label: '100%' }, { value: '1.25', label: '125%' }, { value: '1.5', label: '150%' }, { value: '2', label: '200%' }] }]} label={t('preferences.cursorScale')} disabled={preferences.useLocalCursors} onChange={(value) => update('cursorScale', Number(value) as CursorScale)} /></FormField>
        </PreferenceGroup>
        <PreferenceGroup title={t('preferences.groups.zoom')}>
          {toggle(t('preferences.wheelZoom'), preferences.wheelZoomEnabled, (value) => update('wheelZoomEnabled', value))}
          <FormField className="preference-field" label={t('preferences.wheelZoomMode')}><ThemedSelect value={preferences.wheelZoomMode} groups={[{ label: t('preferences.wheelZoomModeGroup'), options: [{ value: 'smooth', label: t('preferences.wheelZoomMode.smooth') }, { value: 'stepped', label: t('preferences.wheelZoomMode.stepped') }] }]} label={t('preferences.wheelZoomMode')} disabled={!preferences.wheelZoomEnabled} onChange={(value) => update('wheelZoomMode', value as WheelZoomMode)} /></FormField>
          <FormField className="preference-field" label={t('preferences.zoomMode')}><ThemedSelect value={preferences.zoomToolDragMode} groups={[{ label: t('preferences.zoomModeGroup'), options: [{ value: 'smooth', label: t('preferences.zoomMode.smooth') }, { value: 'stepped', label: t('preferences.zoomMode.stepped') }] }]} label={t('preferences.zoomMode')} onChange={(value) => update('zoomToolDragMode', value as ZoomToolDragMode)} /></FormField>
          <FormField className="preference-field" label={t('preferences.position')}><ThemedSelect value={preferences.rotationIndicatorPosition} groups={[{ label: t('preferences.positionGroup'), options: [{ value: 'view', label: t('preferences.position.view') }, { value: 'canvas', label: t('preferences.position.canvas') }] }]} label={t('preferences.position')} onChange={(value) => update('rotationIndicatorPosition', value as RotationIndicatorPosition)} /></FormField>
        </PreferenceGroup>
      </>}
      {section === 'tools' && <>
        <PreferenceGroup title={t('preferences.groups.previews')}>
          <FormField className="preference-field" label={t('preferences.brushPreview')}><ThemedSelect value={preferences.brushPreviewMode} groups={[{ label: t('preferences.brushPreviewGroup'), options: [{ value: 'none', label: t('preferences.brushPreview.none') }, { value: 'edge', label: t('preferences.brushPreview.edge') }, { value: 'full', label: t('preferences.brushPreview.full') }, { value: 'full-edge', label: t('preferences.brushPreview.fullEdge') }] }]} label={t('preferences.brushPreview')} onChange={(value) => update('brushPreviewMode', value as BrushPreviewMode)} /></FormField>
          {preferences.brushPreviewMode === 'full-edge' && toggle(t('preferences.drawingBrushPreview'), preferences.drawingBrushPreviewEnabled, (value) => update('drawingBrushPreviewEnabled', value))}
          {toggle(t('preferences.selectionCrosshair'), preferences.selectionCrosshair, (value) => update('selectionCrosshair', value))}
          {toggle(t('preferences.moveLayerContentPreview'), preferences.moveLayerContentPreviewEnabled, (value) => update('moveLayerContentPreviewEnabled', value), t('preferences.moveLayerContentPreviewHint'))}
        </PreferenceGroup>
        <PreferenceGroup title={t('preferences.groups.drawing')}>
          {toggle(t('preferences.shiftLinePreview'), preferences.shiftLinePreviewEnabled, (value) => update('shiftLinePreviewEnabled', value))}
          {toggle(t('preferences.balancedLine'), preferences.balancedShiftLineEnabled, (value) => update('balancedShiftLineEnabled', value), t('preferences.balancedLineHint'))}
          <FormField className="preference-field" label={t('preferences.lineDirectionStep')} tooltip={t('preferences.lineDirectionStepHint')}><NumberInput aria-label={t('preferences.lineDirectionStep')} min={1} max={16} value={preferences.lineDirectionStep} onValueChange={(value) => update('lineDirectionStep', Math.round(value))} /></FormField>
          {toggle(t('preferences.lassoClosed'), preferences.lassoPreviewClosed, (value) => update('lassoPreviewClosed', value))}
          {toggle(t('preferences.eyedropperPencil'), preferences.eyedropperSwitchToPencil, (value) => update('eyedropperSwitchToPencil', value))}
        </PreferenceGroup>
        <PreferenceGroup title={t('preferences.groups.eyedropper')}>
          {toggle(t('preferences.eyedropperMagnifier'), preferences.eyedropperMagnifierEnabled, (value) => update('eyedropperMagnifierEnabled', value), t('preferences.eyedropperMagnifierHint'))}
          <FormField className="preference-field" label={t('preferences.eyedropperMagnifierStyle')} tooltip={t('preferences.eyedropperMagnifierStyleHint')}><ThemedSelect value={preferences.eyedropperMagnifierStyle} groups={[{ label: t('preferences.eyedropperMagnifierStyleGroup'), options: [{ value: 'pixel', label: t('preferences.eyedropperMagnifierStyle.pixel') }, { value: 'line', label: t('preferences.eyedropperMagnifierStyle.line') }] }]} label={t('preferences.eyedropperMagnifierStyle')} onChange={(value) => update('eyedropperMagnifierStyle', value as EyedropperMagnifierStyle)} /></FormField>
          {toggle(t('preferences.eyedropperMagnifierDistortion'), preferences.eyedropperMagnifierDistortionEnabled, (value) => update('eyedropperMagnifierDistortionEnabled', value), t('preferences.eyedropperMagnifierDistortionHint'))}
        </PreferenceGroup>
      </>}
      {section === 'files' && <>
        <PreferenceGroup title={t('preferences.groups.locations')}>
        <FormField className="preference-field preference-path-field" label={t('preferences.saveDirectory')} hint={preferences.saveDirectory ? t('preferences.directory.custom') : t('preferences.directory.default')}><div className="preference-path-control"><TextInput readOnly value={preferences.saveDirectory || defaultDirectories.saveDirectory} title={preferences.saveDirectory || defaultDirectories.saveDirectory} /><button type="button" className="icon-button" title={t('preferences.chooseDirectory')} aria-label={t('preferences.chooseSaveDirectory')} onClick={() => void choosePreferenceDirectory('saveDirectory')}><PixelUtilityIcon kind="folderOpen" /></button><button type="button" className="icon-button" title={t('preferences.restoreDefaultDirectory')} aria-label={t('preferences.restoreDefaultSaveDirectory')} disabled={!preferences.saveDirectory} onClick={() => update('saveDirectory', '')}><PixelUtilityIcon kind="restore" /></button></div></FormField>
        <FormField className="preference-field preference-path-field" label={t('preferences.exportDirectory')} hint={preferences.exportDirectory ? t('preferences.directory.custom') : t('preferences.directory.default')}><div className="preference-path-control"><TextInput readOnly value={preferences.exportDirectory || defaultDirectories.exportDirectory} title={preferences.exportDirectory || defaultDirectories.exportDirectory} /><button type="button" className="icon-button" title={t('preferences.chooseDirectory')} aria-label={t('preferences.chooseExportDirectory')} onClick={() => void choosePreferenceDirectory('exportDirectory')}><PixelUtilityIcon kind="folderOpen" /></button><button type="button" className="icon-button" title={t('preferences.restoreDefaultDirectory')} aria-label={t('preferences.restoreDefaultExportDirectory')} disabled={!preferences.exportDirectory} onClick={() => update('exportDirectory', '')}><PixelUtilityIcon kind="restore" /></button></div></FormField>
        </PreferenceGroup>
        <PreferenceGroup title={t('preferences.groups.formats')}>
        <FormField className="preference-field" label={t('preferences.saveFormat')}><ThemedSelect value={preferences.saveFormat} groups={[{ label: t('preferences.saveFormatGroup'), options: [{ value: 'moonsprite', label: '.moonsprite' }, { value: 'png', label: '.png' }, { value: 'jpeg', label: '.jpg / .jpeg' }, { value: 'webp', label: '.webp' }, { value: 'ase', label: '.ase' }, { value: 'aseprite', label: '.aseprite' }] }]} label={t('preferences.saveFormat')} onChange={(value) => update('saveFormat', value)} /></FormField>
        <FormField className="preference-field" label={t('preferences.exportFormat')}><ThemedSelect value={preferences.exportFormat} groups={[{ label: t('preferences.exportFormatGroup'), options: [{ value: 'png', label: 'PNG' }, { value: 'jpeg', label: 'JPEG' }, { value: 'webp', label: 'WebP' }, { value: 'svg', label: 'SVG' }, { value: 'gif', label: 'GIF' }] }]} label={t('preferences.exportFormat')} onChange={(value) => update('exportFormat', value)} /></FormField>
        </PreferenceGroup>
        <PreferenceGroup title={t('preferences.groups.recovery')}>
        <FormField className="preference-field" label={t('preferences.recovery')}><ThemedSelect value={recoveryValue} groups={[{ label: t('preferences.recoveryGroup'), options: [{ value: 'off', label: t('preferences.recovery.off') }, { value: '0.5', label: t('preferences.recovery.seconds30') }, { value: '1', label: t('preferences.recovery.minutes1') }, { value: '2', label: t('preferences.recovery.minutes2') }, { value: '5', label: t('preferences.recovery.minutes5') }, { value: '10', label: t('preferences.recovery.minutes10') }] }]} label={t('preferences.recovery')} onChange={(value) => setPreferences((current) => value === 'off' ? { ...current, recovery: false } : { ...current, recovery: true, recoveryMinutes: Number(value) })} /></FormField>
        </PreferenceGroup>
      </>}
      {section === 'colorLayers' && <div className="preference-presets preference-color-layer-settings"><section className="preference-color-settings"><SettingsSectionHeader title={t('preferences.colorModes')} actions={<button type="button" className="quiet-button" onClick={() => update('colorEditorModes', DEFAULT_COLOR_EDITOR_MODES.map((item) => ({ ...item })))}><PixelUtilityIcon kind="restore" />{t('preferences.restoreDefaults')}</button>} /><div className="preference-color-mode-list">{preferences.colorEditorModes.map((item, index) => {
        const enabledCount = preferences.colorEditorModes.filter((candidate) => candidate.enabled).length
        const modeName = item.mode === 'gray' ? 'Gray' : item.mode.toUpperCase()
        return <div className={`preference-color-mode-row ${draggedColorMode === item.mode ? 'dragging' : ''}`} data-color-mode={item.mode} key={item.mode}><button type="button" className="color-mode-drag-handle" aria-label={`${modeName} ${t('home.reorderHint')}`} title={t('home.reorderHint')} onPointerDown={(event) => beginColorModePointerDrag(event, item.mode)}><PixelUtilityIcon kind="move" /></button><span className="color-mode-name">{modeName}</span><PixelCheckbox className="color-mode-visibility" aria-label={item.enabled ? `${item.mode} enabled` : `${item.mode} disabled`} checked={item.enabled} disabled={item.enabled && enabledCount === 1} onChange={() => update('colorEditorModes', preferences.colorEditorModes.map((candidate) => candidate.mode === item.mode ? { ...candidate, enabled: !candidate.enabled } : candidate))} /></div>
      })}</div></section></div>}
      {section === 'presets' && <div className="preference-presets"><section><SettingsSectionHeader title={t('preferences.newDocumentPresets')} actions={<button type="button" onClick={() => update('documentSizePresets', [...preferences.documentSizePresets, { width: 64, height: 64 }])}><PixelUtilityIcon kind="plus" />{t('preferences.addSize')}</button>} /><div className="preference-preset-grid">{preferences.documentSizePresets.map((preset, index) => <div className="document-size-preset-row" key={index}><NumberInput density="compact" aria-label={t('preferences.presetWidthAria', { index: index + 1 })} min={1} max={16384} suffix="px" value={preset.width} onValueChange={(value) => updateDocumentSize(index, 'width', value)} /><span>x</span><NumberInput density="compact" aria-label={t('preferences.presetHeightAria', { index: index + 1 })} min={1} max={16384} suffix="px" value={preset.height} onValueChange={(value) => updateDocumentSize(index, 'height', value)} /><DeleteIconButton aria-label={t('preferences.deleteSizeAria', { width: preset.width, height: preset.height })} disabled={preferences.documentSizePresets.length === 1} onClick={() => update('documentSizePresets', preferences.documentSizePresets.filter((_, presetIndex) => presetIndex !== index))} /></div>)}</div></section><section><SettingsSectionHeader title={t('preferences.exportScalePresets')} actions={<button type="button" onClick={() => update('exportScalePresets', [...preferences.exportScalePresets, 100])}><PixelUtilityIcon kind="plus" />{t('preferences.addScale')}</button>} /><div className="preference-preset-grid export-scale-preset-grid">{preferences.exportScalePresets.map((scale, index) => <div className="export-scale-preset-row" key={index}><NumberInput density="compact" aria-label={t('preferences.exportScaleAria', { index: index + 1 })} min={1} max={6400} suffix="%" value={scale} onValueChange={(value) => update('exportScalePresets', preferences.exportScalePresets.map((currentScale, scaleIndex) => scaleIndex === index ? value : currentScale))} /><DeleteIconButton aria-label={t('preferences.deleteScaleAria', { scale })} disabled={preferences.exportScalePresets.length === 1} onClick={() => update('exportScalePresets', preferences.exportScalePresets.filter((_, scaleIndex) => scaleIndex !== index))} /></div>)}</div></section><section className="preference-layer-settings preference-checker-colors"><SettingsSectionHeader title={t('preferences.layerColors')} actions={<><button type="button" className="quiet-button" aria-label={t('preferences.restoreDefaults')} onClick={() => update('layerDisplayColorPresets', DEFAULT_LAYER_DISPLAY_COLOR_PRESETS.map((color) => ({ ...color })))}><PixelUtilityIcon kind="restore" /><span>{t('preferences.restoreDefaults')}</span></button><button type="button" className="quiet-button" disabled={preferences.layerDisplayColorPresets.length >= 12} onClick={() => update('layerDisplayColorPresets', [...preferences.layerDisplayColorPresets, { r: 117, g: 117, b: 117, a: 255 }])}><PixelUtilityIcon kind="plus" /><span>{t('preferences.addColor')}</span></button></>} /><div className="preference-layer-color-grid">{preferences.layerDisplayColorPresets.map((color, index) => <div className="preference-layer-color-row" key={index}><ColorValueControl color={color} density="regular" onChange={(value) => updateLayerColorPreset(index, value)} label={t('preferences.layerColorAria', { index: index + 1 })} storageKey="layer-preset" fillWithColor /><DeleteIconButton size="regular" aria-label={t('preferences.deleteLayerColorAria', { index: index + 1 })} disabled={preferences.layerDisplayColorPresets.length === 1} onClick={() => update('layerDisplayColorPresets', preferences.layerDisplayColorPresets.filter((_, presetIndex) => presetIndex !== index))} /></div>)}</div></section></div>}
      {section === 'reset' && <><p>{t('preferences.resetDescription')}</p><button className="danger-button" onClick={() => void resetAllSettings()}>{t('preferences.resetAll')}</button></>}
      </>}
    </main></div>
    <footer><button className="quiet-button" onClick={onClose}>{t('preferences.cancel')}</button><button className="quiet-button" onClick={persist}>{t('preferences.apply')}</button><button className="primary-button" onClick={() => { persist(); onClose() }}>{t('preferences.confirm')}</button></footer>
  </ModalShell></div>
}
