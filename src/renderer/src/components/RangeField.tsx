import type { ReactNode } from 'react'
import { NumberInput } from './NumberInput'

interface RangeFieldProps {
  autoFocus?: boolean
  className?: string
  density?: 'compact' | 'regular'
  disabled?: boolean
  label: ReactNode
  max: number
  min: number
  onChange: (value: number) => void
  step?: number
  suffix?: string
  value: number
}

export function RangeField({ autoFocus = false, className = '', density = 'regular', disabled = false, label, max, min, onChange, step = 1, suffix, value }: RangeFieldProps) {
  return <label className={`range-field range-field-${density} ${className}`.trim()}>
    <span className="range-field-label">{label}</span>
    <input aria-label={typeof label === 'string' ? label : undefined} type="range" disabled={disabled} min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    <NumberInput aria-label={typeof label === 'string' ? label : undefined} autoFocus={autoFocus} density={density} disabled={disabled} min={min} max={max} step={step} suffix={suffix} value={value} onValueChange={onChange} />
  </label>
}
