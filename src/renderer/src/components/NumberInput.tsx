import { ChevronDown, ChevronUp } from 'lucide-react'
import { useLayoutEffect, useState, type CSSProperties, type InputHTMLAttributes } from 'react'
import { evaluateNumericExpression } from '@/core/numeric-expression'
import { useI18n } from './I18nProvider'

interface NumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'min' | 'max' | 'step'> {
  value: number | ''
  onValueChange(value: number): void
  live?: boolean
  min?: number
  max?: number
  step?: number
  suffix?: string
}

const filterNumericExpression = (source: string): string => {
  let filtered = ''
  for (const character of source) {
    if (/[0-9+\-*\/().\s]/.test(character)) {
      filtered += character
      continue
    }
    if (character !== 'e' && character !== 'E') continue
    const token = filtered.split(/[+\-*\/()\s]/).at(-1) ?? ''
    if (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) filtered += character
  }
  return filtered
}

export function NumberInput({ value, onValueChange, live = false, min, max, step = 1, suffix, className = '', onFocus, onBlur, onKeyDown, ...inputProps }: NumberInputProps) {
  const { t } = useI18n()
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
  const updateDraft = (source: string): void => {
    const nextDraft = filterNumericExpression(source)
    setDraft(nextDraft)
    if (!live || !nextDraft.trim()) return
    const evaluated = evaluateNumericExpression(nextDraft)
    if (evaluated === null) return
    const next = normalize(evaluated)
    if (next !== value) onValueChange(next)
  }

  const control = <span className={`number-input ${suffix ? 'has-suffix' : ''} ${className}`.trim()}>
    <span className="number-input-editor" style={suffix ? { '--number-input-value-chars': Math.max(1, draft.length) } as CSSProperties : undefined}>
      <input {...inputProps} type="text" inputMode="decimal" role="spinbutton" aria-valuemin={min} aria-valuemax={max} aria-valuenow={typeof value === 'number' ? value : undefined} value={draft} style={inputProps.style} onFocus={onFocus} onChange={(event) => updateDraft(event.target.value)} onBlur={(event) => { commit(); onBlur?.(event) }} onKeyDown={(event) => { onKeyDown?.(event); if (event.defaultPrevented || event.key !== 'Enter') return; event.preventDefault(); const form = event.currentTarget.form; commit(); if (form) window.queueMicrotask(() => form.requestSubmit()); else event.currentTarget.blur() }} />
      {suffix && <span className="number-input-suffix" aria-hidden="true">{suffix}</span>}
    </span>
    <span className="number-input-stepper">
      <button type="button" tabIndex={-1} aria-label={t('numberInput.increment')} disabled={inputProps.disabled} onClick={() => adjust(step)}><ChevronUp size={10} /></button>
      <button type="button" tabIndex={-1} aria-label={t('numberInput.decrement')} disabled={inputProps.disabled} onClick={() => adjust(-step)}><ChevronDown size={10} /></button>
    </span>
  </span>
  return control
}
