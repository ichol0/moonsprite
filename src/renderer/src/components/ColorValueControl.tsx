import { createPortal } from 'react-dom'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RgbaColor } from '@shared/types'
import { clampByte } from '@/core/raster'
import { colorFromValues, colorToValues, colorValueFields, parseRgbaHex, rgbaHex, type ColorValueMode } from '@/core/color-values'
import { NumberInput } from './NumberInput'

interface ColorValueControlProps {
  color: RgbaColor
  onChange: (color: RgbaColor) => void
  label: string
  roleLabel?: string
  className?: string
}

const modeLabels: Array<{ value: ColorValueMode; label: string }> = [
  { value: 'rgb', label: 'RGB' },
  { value: 'hsv', label: 'HSV' },
  { value: 'hsl', label: 'HSL' },
  { value: 'gray', label: 'Gray' }
]

const cssColor = (color: RgbaColor): string => `rgb(${color.r} ${color.g} ${color.b} / ${color.a / 255})`
const colorGradient = (mode: ColorValueMode, values: Record<string, number>, fallback: RgbaColor, field: ReturnType<typeof colorValueFields>[number]): string => {
  const stops = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const color = colorFromValues(mode, { ...values, [field.key]: field.min + (field.max - field.min) * ratio }, fallback)
    return `${cssColor(color)} ${Math.round(ratio * 100)}%`
  })
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

export function ColorValueControl({ color, onChange, label, roleLabel, className = '' }: ColorValueControlProps) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<ColorValueMode>('rgb')
  const [hexText, setHexText] = useState(() => rgbaHex(color))
  const [position, setPosition] = useState({ left: 8, top: 8 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => setHexText(rgbaHex(color)), [color.r, color.g, color.b, color.a])

  useLayoutEffect(() => {
    if (!open) return
    const place = (): void => {
      const trigger = triggerRef.current?.getBoundingClientRect()
      const popover = popoverRef.current?.getBoundingClientRect()
      if (!trigger || !popover) return
      const left = Math.max(8, Math.min(window.innerWidth - popover.width - 8, trigger.right - popover.width))
      const top = window.innerHeight - trigger.bottom >= popover.height + 6
        ? trigger.bottom + 5
        : Math.max(8, trigger.top - popover.height - 5)
      setPosition({ left, top })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, mode])

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!triggerRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false)
    }
    window.addEventListener('pointerdown', close, true)
    return () => window.removeEventListener('pointerdown', close, true)
  }, [open])

  const commitHex = (): void => {
    const next = parseRgbaHex(hexText, color.a)
    if (next) {
      onChange(next)
      setHexText(rgbaHex(next))
    } else setHexText(rgbaHex(color))
  }

  const values = colorToValues(color, mode)
  const updateValue = (key: string, value: number): void => {
    const next = colorFromValues(mode, { ...values, [key]: value }, color)
    onChange(next)
    setHexText(rgbaHex(next))
  }

  const editor = open ? <div ref={popoverRef} className="color-editor-popover" role="dialog" aria-label={`${label}颜色编辑`} style={position}>
    <div className="color-editor-toolbar">
      <div className="color-editor-tabs" role="tablist" aria-label="颜色模式">
        {modeLabels.map((option) => <button key={option.value} type="button" role="tab" aria-selected={mode === option.value} className={mode === option.value ? 'selected' : ''} onClick={() => setMode(option.value)}>{option.label}</button>)}
      </div>
      <label className="color-editor-hex"><span>#</span><input aria-label={`${label} HEX`} value={hexText.replace(/^#/, '')} onChange={(event) => setHexText(`#${event.target.value}`)} onBlur={commitHex} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitHex() } }} /></label>
      <span className="color-editor-current-swatch" aria-label="当前颜色"><i style={{ background: cssColor(color) }} /></span>
    </div>
    <div className="color-editor-fields">
      {colorValueFields(mode).map((field) => {
        const gradient = colorGradient(mode, values, color, field)
        const background = field.key === 'a' ? `${gradient}, repeating-conic-gradient(#686d76 0 25%, #aeb3bc 0 50%) 50% / 12px 12px` : gradient
        return <label key={field.key} className="color-editor-field"><span className="color-editor-field-label">{field.label}</span><input aria-label={`${label} ${field.label}滑块`} className="color-editor-range" style={{ background }} type="range" min={field.min} max={field.max} step={field.step} value={values[field.key] ?? 0} onChange={(event) => updateValue(field.key, Number(event.target.value))} /><NumberInput aria-label={`${label} ${field.label}`} min={field.min} max={field.max} step={field.step} value={Math.round(values[field.key] ?? 0)} onValueChange={(value) => updateValue(field.key, value)} /></label>
      })}
    </div>
  </div> : null

  return <>
    <button ref={triggerRef} type="button" className={`color-value-trigger ${className}`} aria-label={`${label}${roleLabel ? ` ${roleLabel}` : ''}`} aria-expanded={open} onClick={() => { setHexText(rgbaHex(color)); setOpen((value) => !value) }}>
      <span className="color-value-swatch"><i style={{ background: `rgba(${color.r}, ${color.g}, ${color.b}, ${clampByte(color.a) / 255})` }} /></span>
      <strong>{rgbaHex(color)}</strong>
      {roleLabel && <small>{roleLabel}</small>}
    </button>
    {editor && createPortal(editor, document.body)}
  </>
}
