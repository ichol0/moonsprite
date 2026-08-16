import type { InputHTMLAttributes, ReactNode } from 'react'
import { Tooltip } from './Tooltip'

interface PreferenceToggleProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'checked' | 'onChange'> {
  checked: boolean
  copyClassName?: string
  label: ReactNode
  onChange: (checked: boolean) => void
  tooltip?: ReactNode
}

export function PreferenceToggle({ checked, className = '', copyClassName = '', label, onChange, tooltip, ...inputProps }: PreferenceToggleProps) {
  const copy = <span className={copyClassName || undefined}>{label}</span>
  return <label className={`preference-toggle ${className}`.trim()}>
    {tooltip ? <Tooltip content={tooltip}>{copy}</Tooltip> : copy}
    <input {...inputProps} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    <span className="toggle-track" aria-hidden="true"><i /></span>
  </label>
}
