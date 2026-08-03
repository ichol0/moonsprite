import { ChevronDown, ChevronUp } from 'lucide-react'
import { useLayoutEffect, useState, type CSSProperties, type InputHTMLAttributes } from 'react'
import { evaluateNumericExpression } from '@/core/numeric-expression'

interface NumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'min' | 'max' | 'step'> {
  value: number | ''
  onValueChange(value: number): void
  min?: number
  max?: number
  step?: number
  suffix?: string
}

export function NumberInput({ value, onValueChange, min, max, step = 1, suffix, className = '', onFocus, onKeyDown, ...inputProps }: NumberInputProps) {
  const [draft, setDraft] = useState(String(value))
  useLayoutEffect(() => setDraft(String(value)), [value])
  const normalize = (next: number): number => {
    if (!Number.isFinite(next)) return typeof value === 'number' ? value : min ?? 0
    return Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, next))
  }
  const adjust = (delta: number): void => onValueChange(normalize((typeof value === 'number' ? value : min ?? 0) + delta))
  const commit = (): void => {
    if (!draft.trim()) { setDraft(String(value)); return }
    const evaluated = evaluateNumericExpression(draft)
    if (evaluated === null) { setDraft(String(value)); return }
    const next = normalize(evaluated)
    setDraft(String(next))
    if (next !== value) onValueChange(next)
  }

  const control = <span className={`number-input ${suffix ? 'has-suffix' : ''} ${className}`.trim()}>
    <span className="number-input-editor" style={suffix ? { '--number-input-value-chars': Math.max(1, draft.length) } as CSSProperties : undefined}>
      <input {...inputProps} type="text" inputMode="decimal" role="spinbutton" aria-valuemin={min} aria-valuemax={max} aria-valuenow={typeof value === 'number' ? value : undefined} value={draft} style={inputProps.style} onFocus={onFocus} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { onKeyDown?.(event); if (event.defaultPrevented || event.key !== 'Enter') return; event.preventDefault(); const form = event.currentTarget.form; commit(); if (form) window.queueMicrotask(() => form.requestSubmit()); else event.currentTarget.blur() }} />
      {suffix && <span className="number-input-suffix" aria-hidden="true">{suffix}</span>}
    </span>
    <span className="number-input-stepper">
      <button type="button" tabIndex={-1} aria-label="增加数值" disabled={inputProps.disabled} onClick={() => adjust(step)}><ChevronUp size={10} /></button>
      <button type="button" tabIndex={-1} aria-label="减少数值" disabled={inputProps.disabled} onClick={() => adjust(-step)}><ChevronDown size={10} /></button>
    </span>
  </span>
  return control
}
