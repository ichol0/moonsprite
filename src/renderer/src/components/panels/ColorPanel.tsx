import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Grid2X2, Palette, Square } from 'lucide-react'
import { ColorPicker, type ColorPickerConfig, type ColorPickerScheme } from '@/components/ColorPicker'
import { FloatingDockPreview, PanelResizeHandles, useFloatingPanel } from '@/components/floating-panel'
import type { DockDragProps } from '@/components/workspace-panel-types'
import { parseColorPickerConfig, readStoredString, saveColorPickerConfig } from '@/core/panel-preferences'
import { useWorkspace, type DocumentSession } from '@/store/workspace'

export function ColorPanel({ session, docked = false, onDockDragStart, onFloatingDock, onRestoreSquare }: { session: DocumentSession } & DockDragProps) {
  const setPrimary = useWorkspace((state) => state.setPrimaryColor)
  const setSecondary = useWorkspace((state) => state.setSecondaryColor)
  const floating = useFloatingPanel(null, false, true, 'moonsprite.color-panel.v1', false, onFloatingDock, docked)
  const schemeButtonRef = useRef<HTMLButtonElement>(null)
  const schemeMenuRef = useRef<HTMLSpanElement>(null)
  const [schemeMenuOpen, setSchemeMenuOpen] = useState(false)
  const [schemeMenuPosition, setSchemeMenuPosition] = useState({ left: 8, top: 8 })
  const hueStepPresets = [
    { value: 0, label: '连续' },
    { value: 6, label: '6 段' },
    { value: 12, label: '12 段' },
    { value: 24, label: '24 段' },
    { value: 36, label: '36 段' }
  ]
  const colorStepPresets = [
    { value: 0, label: '连续' },
    { value: 5, label: '5 级' },
    { value: 9, label: '9 级' },
    { value: 15, label: '15 级' }
  ]
  const hueStepValues = hueStepPresets.map((preset) => preset.value)
  const colorStepValues = colorStepPresets.map((preset) => preset.value)
  const [pickerConfig, setPickerConfig] = useState<ColorPickerConfig>(() => {
    return parseColorPickerConfig(readStoredString('moonsprite.color-picker-config'), readStoredString('moonsprite.color-picker-scheme'), hueStepValues, colorStepValues)
  })
  const schemeOptions: Array<{ value: ColorPickerScheme; label: string }> = [
    { value: 'moon-ring', label: '月环调色盘' },
    { value: 'sv-square', label: '饱和度 / 明度' },
    { value: 'hs-square', label: '色相 / 饱和度' },
    { value: 'wheel', label: '色轮' }
  ]

  useLayoutEffect(() => {
    if (!schemeMenuOpen) return
    const button = schemeButtonRef.current?.getBoundingClientRect()
    const menu = schemeMenuRef.current?.getBoundingClientRect()
    const panel = floating.ref.current?.getBoundingClientRect()
    if (!button || !menu || !panel) return
    const leftOfPanel = panel.left - menu.width - 6
    const rightOfPanel = panel.right + 6
    const left = leftOfPanel >= 8
      ? leftOfPanel
      : rightOfPanel + menu.width <= window.innerWidth - 8
        ? rightOfPanel
        : Math.max(8, Math.min(window.innerWidth - menu.width - 8, button.right - menu.width))
    setSchemeMenuPosition({
      left,
      top: Math.max(8, Math.min(window.innerHeight - menu.height - 8, panel.top))
    })
  }, [schemeMenuOpen])

  useEffect(() => {
    if (!schemeMenuOpen) return
    const close = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!schemeButtonRef.current?.contains(target) && !schemeMenuRef.current?.contains(target)) setSchemeMenuOpen(false)
    }
    window.addEventListener('pointerdown', close, true)
    return () => window.removeEventListener('pointerdown', close, true)
  }, [schemeMenuOpen])

  const updatePickerConfig = (changes: Partial<ColorPickerConfig>): void => {
    setPickerConfig((current) => {
      const next = { ...current, ...changes }
      saveColorPickerConfig(next)
      return next
    })
  }
  const restoreSquare = (): void => {
    const panel = floating.ref.current
    const fieldSlot = panel?.querySelector<HTMLElement>('.color-field-slot')
    if (!panel || !fieldSlot) return
    if (floating.style) {
      const panelBounds = panel.getBoundingClientRect()
      if (onRestoreSquare && panelBounds.top >= window.innerHeight * 0.55 && panelBounds.bottom >= window.innerHeight - 72) {
        onRestoreSquare(true)
        return
      }
      const fieldBounds = fieldSlot.getBoundingClientRect()
      const targetHeight = Math.round(panelBounds.height - fieldBounds.height + fieldBounds.width)
      if (Math.abs(panelBounds.height - targetHeight) <= 1) return
      floating.resizeTo(panelBounds.width, targetHeight)
      return
    }
    onRestoreSquare?.()
  }

  return <><section ref={floating.ref} className={`panel color-panel ${floating.style ? 'floating-panel' : ''}`} style={floating.style} onPointerDown={floating.bringToFront}>
    <header onPointerDown={(event) => floating.style ? floating.startDrag(event) : onDockDragStart?.(event, floating.startDetachedDrag)}><Palette size={15} /><span>颜色</span><span className="panel-actions color-scheme-control" onPointerDown={(event) => event.stopPropagation()}><button type="button" title="将调色盘恢复为正方形" aria-label="将调色盘恢复为正方形" onClick={restoreSquare}><Square size={14} /></button><button ref={schemeButtonRef} type="button" className={schemeMenuOpen ? 'active' : ''} title="更换调色盘样式" aria-label="更换调色盘样式" aria-expanded={schemeMenuOpen} onClick={() => setSchemeMenuOpen((open) => !open)}><Grid2X2 size={14} /></button></span></header>
    <ColorPicker color={session.primaryColor} secondaryColor={session.secondaryColor} onChange={setPrimary} onSecondaryChange={setSecondary} config={pickerConfig} />
    {floating.style && <PanelResizeHandles onResize={floating.startResize} />}
  </section><FloatingDockPreview style={floating.dockPreview} />
  {schemeMenuOpen && createPortal(<span ref={schemeMenuRef} className="color-scheme-popover" role="menu" aria-label="调色盘样式" style={schemeMenuPosition}><span className="color-scheme-options">{schemeOptions.map((option) => <button key={option.value} type="button" role="menuitemradio" aria-checked={pickerConfig.scheme === option.value} className={pickerConfig.scheme === option.value ? 'selected' : ''} onClick={() => updatePickerConfig({ scheme: option.value })}><i className={`color-scheme-preview preview-${option.value}`} aria-hidden="true" /><span>{option.label}</span>{pickerConfig.scheme === option.value && <Check size={13} />}</button>)}</span>{pickerConfig.scheme === 'moon-ring' && <span className="color-scheme-settings"><span className="color-preset-group"><span className="color-preset-label">月环中心</span><span className="color-preset-options"><button type="button" className={pickerConfig.moonField !== 'hsl-triangle' ? 'selected' : ''} onClick={() => updatePickerConfig({ moonField: 'hsv-square' })}>HSV 方形</button><button type="button" className={pickerConfig.moonField === 'hsl-triangle' ? 'selected' : ''} onClick={() => updatePickerConfig({ moonField: 'hsl-triangle' })}>HSL 三角形</button></span></span></span>}<span className="color-scheme-settings"><span className="color-preset-group"><span className="color-preset-label color-setting-tooltip" data-tip="将色相限制到固定分段；连续表示不吸附。">色相吸附</span><span className="color-preset-options">{hueStepPresets.map((preset) => <button key={preset.value} type="button" className={pickerConfig.hueSteps === preset.value ? 'selected' : ''} aria-pressed={pickerConfig.hueSteps === preset.value} onClick={() => updatePickerConfig({ hueSteps: preset.value })}>{preset.label}</button>)}</span></span><span className="color-preset-group"><span className="color-preset-label color-setting-tooltip" data-tip="限制饱和度、明度和透明度的可选级数；栏目缩放后仍可选择同一批颜色。">颜色级数</span><span className="color-preset-options">{colorStepPresets.map((preset) => <button key={preset.value} type="button" className={pickerConfig.colorSteps === preset.value ? 'selected' : ''} aria-pressed={pickerConfig.colorSteps === preset.value} onClick={() => updatePickerConfig({ colorSteps: preset.value })}>{preset.label}</button>)}</span></span></span></span>, document.body)}
  </>
}
