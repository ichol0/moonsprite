import { createPortal } from 'react-dom'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RgbaColor } from '@shared/types'
import { clampByte } from '@/core/raster'
import { colorFromValues, colorToValues, colorValueFields, displayRgbaHex, parseRgbaHex, type ColorValueMode } from '@/core/color-values'
import { NumberInput } from './NumberInput'
import { PanelResizeHandles, type ResizeDirection } from './floating-panel'
import { useI18n } from '@/components/I18nProvider'
import { loadEditorPreferences } from '@/core/file-preferences'
import { paletteMarkerColor } from '@/core/palette-layout'
import { PixelUtilityIcon } from './PixelUtilityIcon'

interface ColorValueControlProps {
  color: RgbaColor
  onChange: (color: RgbaColor) => void
  label: string
  roleLabel?: string
  className?: string
  storageKey?: string
  inPalette?: boolean
  onAddToPalette?: () => void
  fillWithColor?: boolean
}

const modeLabels: Array<{ value: ColorValueMode; label: string }> = [
  { value: 'rgb', label: 'RGB' },
  { value: 'hsv', label: 'HSV' },
  { value: 'hsl', label: 'HSL' },
  { value: 'gray', label: 'Gray' },
  { value: 'lab', label: 'LAB' },
  { value: 'cmyk', label: 'CMYK' }
]

const COLOR_EDITOR_MIN_WIDTH = 520
const COLOR_EDITOR_MIN_HEIGHT = 240
const COLOR_EDITOR_CMYK_MIN_HEIGHT = 298
const COLOR_EDITOR_MAX_WIDTH = 720
const COLOR_EDITOR_MAX_HEIGHT = 480

const cssColor = (color: RgbaColor): string => `rgb(${color.r} ${color.g} ${color.b} / ${color.a / 255})`
const copyColor = (color: RgbaColor): RgbaColor => ({ ...color })
const sameColor = (left: RgbaColor, right: RgbaColor): boolean => left.r === right.r && left.g === right.g && left.b === right.b && left.a === right.a
const copyHexToClipboard = async (color: RgbaColor): Promise<void> => {
  const value = displayRgbaHex(color)
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return
    }
  } catch {
    // Fall through to the WebView-compatible synchronous clipboard fallback.
  }
  const input = document.createElement('textarea')
  input.value = value
  input.setAttribute('readonly', '')
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.appendChild(input)
  input.select()
  try { document.execCommand('copy') } finally { input.remove() }
}
const colorGradient = (mode: ColorValueMode, values: Record<string, number>, fallback: RgbaColor, field: ReturnType<typeof colorValueFields>[number]): string => {
  const stops = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const color = colorFromValues(mode, { ...values, [field.key]: field.min + (field.max - field.min) * ratio }, fallback)
    return `${cssColor(color)} ${Math.round(ratio * 100)}%`
  })
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

export function ColorValueControl({ color, onChange, label, roleLabel, className = '', storageKey, inPalette = true, onAddToPalette, fillWithColor = false }: ColorValueControlProps) {
  const { locale, t } = useI18n()
  const [open, setOpen] = useState(false)
  const [availableModes, setAvailableModes] = useState(() => loadEditorPreferences().colorEditorModes.filter((item) => item.enabled).map((item) => item.mode))
  const [mode, setMode] = useState<ColorValueMode>(() => loadEditorPreferences().colorEditorModes.find((item) => item.enabled)?.mode ?? 'rgb')
  const modeMinHeight = mode === 'cmyk' ? COLOR_EDITOR_CMYK_MIN_HEIGHT : COLOR_EDITOR_MIN_HEIGHT
  const [hexText, setHexText] = useState(() => displayRgbaHex(color))
  const [previousColor, setPreviousColor] = useState<RgbaColor>(() => copyColor(color))
  const [workingColor, setWorkingColor] = useState<RgbaColor>(() => copyColor(color))
  const [confirmedColor, setConfirmedColor] = useState<RgbaColor>(() => copyColor(color))
  const [draftMode, setDraftMode] = useState<ColorValueMode | null>(null)
  const [draftValues, setDraftValues] = useState<Record<string, number> | null>(null)
  const [position, setPosition] = useState({ left: 8, top: 8 })
  const [size, setSize] = useState({ width: 560, height: 264 })
  const [resident, setResident] = useState(false)
  const [copiedSwatch, setCopiedSwatch] = useState<'previous' | 'current' | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerX: number; pointerY: number; left: number; top: number } | null>(null)
  const resizeRef = useRef<{ direction: ResizeDirection; pointerX: number; pointerY: number; left: number; top: number; width: number; height: number } | null>(null)
  const positionRef = useRef(position)
  const sizeRef = useRef(size)
  const residentRef = useRef(resident)
  const commitHexRef = useRef<() => void>(() => undefined)
  const emittedColorRef = useRef<RgbaColor | null>(null)
  const sizeKey = storageKey ? `moonsprite.color-editor-size.${storageKey}` : null
  const positionedRef = useRef(false)
  const copyFeedbackTimeoutRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (copyFeedbackTimeoutRef.current !== null) window.clearTimeout(copyFeedbackTimeoutRef.current)
  }, [])

  useEffect(() => {
    setHexText(displayRgbaHex(color))
    setWorkingColor(copyColor(color))
    const emitted = emittedColorRef.current
    if (emitted && sameColor(emitted, color)) {
      emittedColorRef.current = null
      return
    }
    emittedColorRef.current = null
    setConfirmedColor(copyColor(color))
    setDraftMode(null)
    setDraftValues(null)
  }, [color.r, color.g, color.b, color.a])

  useEffect(() => {
    const syncModes = (): void => {
      const next = loadEditorPreferences().colorEditorModes.filter((item) => item.enabled).map((item) => item.mode)
      setAvailableModes(next)
      setMode((current) => next.includes(current) ? current : next[0] ?? 'rgb')
    }
    window.addEventListener('moonsprite:preferences-changed', syncModes)
    return () => window.removeEventListener('moonsprite:preferences-changed', syncModes)
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    const place = (): void => {
      const trigger = triggerRef.current?.getBoundingClientRect()
      const popover = popoverRef.current?.getBoundingClientRect()
      if (!trigger || !popover) return
      let nextSize = sizeRef.current
      if (!positionedRef.current && sizeKey) {
        try {
          const stored = JSON.parse(localStorage.getItem(sizeKey) ?? 'null') as { width?: number; height?: number } | null
          if (stored && Number.isFinite(stored.width) && Number.isFinite(stored.height)) {
            nextSize = {
              width: Math.max(COLOR_EDITOR_MIN_WIDTH, Math.min(COLOR_EDITOR_MAX_WIDTH, window.innerWidth - 16, stored.width!)),
              height: Math.max(COLOR_EDITOR_MIN_HEIGHT, Math.min(COLOR_EDITOR_MAX_HEIGHT, window.innerHeight - 16, stored.height!))
            }
            sizeRef.current = nextSize
            setSize(nextSize)
          }
        } catch { localStorage.removeItem(sizeKey) }
      }
      const left = Math.max(8, Math.min(window.innerWidth - nextSize.width - 8, trigger.right - nextSize.width))
      const top = window.innerHeight - trigger.bottom >= nextSize.height + 6
        ? trigger.bottom + 5
        : Math.max(8, trigger.top - nextSize.height - 5)
      positionRef.current = { left, top }
      setPosition(positionRef.current)
      positionedRef.current = true
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, sizeKey])

  useLayoutEffect(() => {
    if (!open || sizeRef.current.height >= modeMinHeight) return
    const height = Math.min(modeMinHeight, COLOR_EDITOR_MAX_HEIGHT, Math.max(COLOR_EDITOR_MIN_HEIGHT, window.innerHeight - 16))
    if (height <= sizeRef.current.height) return
    sizeRef.current = { ...sizeRef.current, height }
    positionRef.current = {
      ...positionRef.current,
      top: Math.max(8, Math.min(positionRef.current.top, window.innerHeight - height - 8))
    }
    setSize(sizeRef.current)
    setPosition(positionRef.current)
  }, [modeMinHeight, open])

  useEffect(() => {
    if (!open) return
    const move = (event: PointerEvent): void => {
      const drag = dragRef.current
      const popover = popoverRef.current
      const resize = resizeRef.current
      if (resize) {
        const deltaX = event.clientX - resize.pointerX
        const deltaY = event.clientY - resize.pointerY
        let left = resize.left
        let top = resize.top
        let width = resize.width
        let height = resize.height
        if (resize.direction.includes('e')) width = Math.max(COLOR_EDITOR_MIN_WIDTH, Math.min(COLOR_EDITOR_MAX_WIDTH, window.innerWidth - resize.left - 8, resize.width + deltaX))
        if (resize.direction.includes('s')) height = Math.max(modeMinHeight, Math.min(COLOR_EDITOR_MAX_HEIGHT, window.innerHeight - resize.top - 8, resize.height + deltaY))
        if (resize.direction.includes('w')) { width = Math.max(COLOR_EDITOR_MIN_WIDTH, Math.min(COLOR_EDITOR_MAX_WIDTH, resize.left + resize.width - 8, resize.width - deltaX)); left = resize.left + resize.width - width }
        if (resize.direction.includes('n')) { height = Math.max(modeMinHeight, Math.min(COLOR_EDITOR_MAX_HEIGHT, resize.top + resize.height - 8, resize.height - deltaY)); top = resize.top + resize.height - height }
        positionRef.current = { left, top }
        sizeRef.current = { width, height }
        setPosition(positionRef.current)
        setSize(sizeRef.current)
        return
      }
      if (!drag || !popover) return
      const bounds = popover.getBoundingClientRect()
      if (!residentRef.current && Math.hypot(event.clientX - drag.pointerX, event.clientY - drag.pointerY) >= 3) {
        residentRef.current = true
        setResident(true)
      }
      const next = {
        left: Math.max(8, Math.min(window.innerWidth - bounds.width - 8, drag.left + event.clientX - drag.pointerX)),
        top: Math.max(8, Math.min(window.innerHeight - bounds.height - 8, drag.top + event.clientY - drag.pointerY))
      }
      positionRef.current = next
      setPosition(next)
    }
    const end = (): void => {
      if (resizeRef.current && sizeKey) localStorage.setItem(sizeKey, JSON.stringify(sizeRef.current))
      dragRef.current = null
      resizeRef.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [modeMinHeight, open, sizeKey])

  useEffect(() => {
    residentRef.current = resident
  }, [resident])

  useEffect(() => {
    if (!open || resident) return
    const closeTransient = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!popoverRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        commitHexRef.current()
        positionedRef.current = false
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', closeTransient, true)
    return () => window.removeEventListener('pointerdown', closeTransient, true)
  }, [open, resident])

  const applyHex = (value: string): boolean => {
    const next = parseRgbaHex(value, workingColor.a)
    if (!next) return false
    setWorkingColor(copyColor(next))
    setConfirmedColor(copyColor(next))
    setDraftMode(mode)
    setDraftValues(colorToValues(next, mode))
    emittedColorRef.current = copyColor(next)
    onChange(next)
    setHexText(displayRgbaHex(next))
    return true
  }
  const commitHex = (): void => {
    if (!applyHex(hexText)) setHexText(displayRgbaHex(workingColor))
  }
  const pasteHexFromClipboard = async (): Promise<void> => {
    try {
      const value = await window.moonSprite.readClipboardText()
      if (value) applyHex(value)
    } catch {
      // Clipboard access can be unavailable; preserve the current color.
    }
  }
  commitHexRef.current = commitHex

  const values = draftMode === mode && draftValues ? draftValues : colorToValues(workingColor, mode)
  const fields = colorValueFields(mode)
  const updateValue = (key: string, value: number): void => {
    const nextValues = { ...values, [key]: value }
    const next = colorFromValues(mode, nextValues, workingColor)
    setWorkingColor(copyColor(next))
    setDraftMode(mode)
    setDraftValues(nextValues)
    emittedColorRef.current = copyColor(next)
    onChange(next)
    setHexText(displayRgbaHex(next))
  }

  const confirmWorkingColor = (): void => setConfirmedColor(copyColor(workingColor))
  const copySwatch = async (kind: 'previous' | 'current', value: RgbaColor): Promise<void> => {
    await copyHexToClipboard(value)
    setCopiedSwatch(kind)
    if (copyFeedbackTimeoutRef.current !== null) window.clearTimeout(copyFeedbackTimeoutRef.current)
    copyFeedbackTimeoutRef.current = window.setTimeout(() => {
      copyFeedbackTimeoutRef.current = null
      setCopiedSwatch(null)
    }, 900)
  }

  const roleTitle = roleLabel ? (locale === 'zh-CN' && !roleLabel.endsWith('色') ? `${roleLabel}色` : roleLabel) : ''
  const editorLabel = `${t('colorEditor.title')}${roleTitle ? ` ${roleTitle}` : ''}`
  const editor = open ? <div ref={popoverRef} className={`color-editor-popover ${resident ? 'resident' : 'transient'}`} role="dialog" aria-label={editorLabel} style={{ ...position, ...size }}>
    <header className="color-editor-titlebar" onPointerDown={(event) => {
      if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
      dragRef.current = { pointerX: event.clientX, pointerY: event.clientY, left: position.left, top: position.top }
      event.preventDefault()
    }}><strong>{t('colorEditor.title')}{roleTitle ? ` ${roleTitle}` : ''}</strong><button type="button" className="icon-button" aria-label={t('colorEditor.close')} onClick={() => { positionedRef.current = false; setOpen(false) }}><PixelUtilityIcon kind="close" /></button></header>
    <div className="color-editor-toolbar">
      <div className="color-editor-tabs" role="tablist" aria-label={t('colorEditor.modes')}>
        {availableModes.map((value) => modeLabels.find((option) => option.value === value)).filter((option): option is typeof modeLabels[number] => Boolean(option)).map((option) => <button key={option.value} type="button" role="tab" aria-selected={mode === option.value} className={mode === option.value ? 'selected' : ''} onClick={() => { setMode(option.value); setDraftMode(option.value); setDraftValues(colorToValues(workingColor, option.value)) }}>{option.label}</button>)}
      </div>
      <label className="color-editor-hex"><span>#</span><input aria-label={`${label} HEX`} value={hexText.replace(/^#/, '')} onChange={(event) => setHexText(`#${event.target.value}`)} onBlur={commitHex} onContextMenu={(event) => { event.preventDefault(); void pasteHexFromClipboard() }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitHex() } }} /></label>
      <div className="color-editor-swatch-comparison" role="group" aria-label={`${t('colorEditor.previous')} / ${t('colorEditor.current')}`}><button type="button" className={`color-editor-previous-swatch ${copiedSwatch === 'previous' ? 'copied' : ''}`} title={`${t('colorEditor.previous')} · ${displayRgbaHex(previousColor)}`} aria-label={t('colorEditor.previous')} onClick={() => { void copySwatch('previous', previousColor) }}><i style={{ background: cssColor(previousColor) }} /></button><button type="button" className={`color-editor-current-swatch ${copiedSwatch === 'current' ? 'copied' : ''}`} title={`${t('colorEditor.current')} · ${displayRgbaHex(confirmedColor)}`} aria-label={t('colorEditor.current')} onClick={() => { void copySwatch('current', confirmedColor) }}><i style={{ background: cssColor(confirmedColor) }} /></button>{copiedSwatch && <span className="color-editor-copy-toast" role="status" aria-live="polite">{t('colorEditor.copied', { hex: displayRgbaHex(copiedSwatch === 'previous' ? previousColor : confirmedColor) })}</span>}</div>
    </div>
    <div className="color-editor-fields" style={{ '--color-field-count': fields.length } as React.CSSProperties}>
      {fields.map((field) => {
        const gradient = colorGradient(mode, values, color, field)
        const background = field.key === 'a' ? `${gradient}, repeating-conic-gradient(var(--theme-checker-dark) 0 25%, var(--theme-checker-light) 0 50%) 50% / 12px 12px` : gradient
        return <label key={field.key} className="color-editor-field"><span className="color-editor-field-label">{field.label}</span><input aria-label={t('colorEditor.slider', { label, field: field.label })} className="color-editor-range" style={{ background }} type="range" min={field.min} max={field.max} step={field.step} value={values[field.key] ?? 0} onChange={(event) => updateValue(field.key, Number(event.target.value))} onPointerUp={confirmWorkingColor} onBlur={confirmWorkingColor} /><NumberInput aria-label={`${label} ${field.label}`} min={field.min} max={field.max} step={field.step} value={Math.round(values[field.key] ?? 0)} onValueChange={(value) => { updateValue(field.key, value); setConfirmedColor(copyColor(colorFromValues(mode, { ...values, [field.key]: value }, workingColor))) }} /></label>
      })}
    </div>
    <PanelResizeHandles onResize={(event, direction) => {
      if (event.button !== 0 || !popoverRef.current) return
      const bounds = popoverRef.current.getBoundingClientRect()
      resizeRef.current = { direction, pointerX: event.clientX, pointerY: event.clientY, left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }
      event.preventDefault()
      event.stopPropagation()
    }} />
  </div> : null

  return <>
    <span className={`color-value-action-row ${onAddToPalette ? 'supports-palette-action' : ''} ${onAddToPalette && !inPalette ? 'has-add-action' : ''}`}><button ref={triggerRef} type="button" className={`color-value-trigger ${fillWithColor ? 'filled-color-trigger' : ''} ${className}`.trim()} style={fillWithColor ? { '--color-value-fill': `rgb(${color.r} ${color.g} ${color.b})`, '--color-value-contrast': paletteMarkerColor(color) } as React.CSSProperties : undefined} aria-label={`${label}${roleLabel ? ` ${roleLabel}` : ''}`} aria-expanded={open} onClick={() => { setPreviousColor(copyColor(color)); setWorkingColor(copyColor(color)); setConfirmedColor(copyColor(color)); setDraftMode(mode); setDraftValues(colorToValues(color, mode)); setHexText(displayRgbaHex(color)); if (open) positionedRef.current = false; else { residentRef.current = false; setResident(false) }; setOpen((value) => !value) }}>
      {!fillWithColor && <span className="color-value-swatch"><i style={{ background: `rgba(${color.r}, ${color.g}, ${color.b}, ${clampByte(color.a) / 255})` }} /></span>}
      <strong>{displayRgbaHex(color)}</strong>
      {roleLabel && <small>{roleLabel}</small>}
    </button>{onAddToPalette && !inPalette && <button type="button" className="color-value-add-button" title={t('palette.addCurrentColor')} aria-label={t('palette.addCurrentColor')} onClick={onAddToPalette}><PixelUtilityIcon kind="plus" /></button>}</span>
    {editor && createPortal(editor, document.body)}
  </>
}
