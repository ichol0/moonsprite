import type { ReactNode } from 'react'
import { Tooltip } from './Tooltip'

interface FormFieldProps {
  children: ReactNode
  className?: string
  hint?: ReactNode
  label: ReactNode
  layout?: 'stacked' | 'inline'
  tooltip?: ReactNode
}

export function FormField({ children, className = '', hint, label, layout = 'stacked', tooltip }: FormFieldProps) {
  const copy = <span className="ui-field-label">{label}</span>
  return <div className={`ui-field ui-field-${layout} ${className}`.trim()}>
    {tooltip ? <Tooltip content={tooltip}>{copy}</Tooltip> : copy}
    <div className="ui-field-control">{children}</div>
    {hint && <small className="ui-field-hint">{hint}</small>}
  </div>
}
