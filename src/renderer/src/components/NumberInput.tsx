import { ChevronDown, ChevronUp } from 'lucide-react'
import type { InputHTMLAttributes } from 'react'

interface NumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'min' | 'max' | 'step'> {
  value: number | ''
  onValueChange(value: number): void
  min?: number
  max?: number
  step?: number
  suffix?: string
}

export function NumberInput({ value, onValueChange, min, max, step = 1, suffix, className = '', ...inputProps }: NumberInputProps) {
  const normalize = (next: number): number => {
    if (!Number.isFinite(next)) return typeof value === 'number' ? value : min ?? 0
    return Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, next))
  }
  const adjust = (delta: number): void => onValueChange(normalize((typeof value === 'number' ? value : min ?? 0) + delta))
  const inputWidth = suffix ? `${Math.max(2, String(value).length + 1)}ch` : undefined

  const control = <span className={`number-input ${suffix ? 'has-suffix' : ''} ${className}`.trim()}>
    <span className="number-input-editor">
      <input {...inputProps} type="number" min={min} max={max} step={step} value={value} style={{ ...inputProps.style, ...(inputWidth ? { flex: `0 0 ${inputWidth}`, width: inputWidth } : {}) }} onChange={(event) => { if (event.target.value !== '') onValueChange(normalize(Number(event.target.value))) }} />
      {suffix && <span className="number-input-suffix" aria-hidden="true">{suffix}</span>}
    </span>
    <span className="number-input-stepper">
      <button type="button" tabIndex={-1} aria-label="增加数值" onClick={() => adjust(step)}><ChevronUp size={10} /></button>
      <button type="button" tabIndex={-1} aria-label="减少数值" onClick={() => adjust(-step)}><ChevronDown size={10} /></button>
    </span>
  </span>
  return control
}
