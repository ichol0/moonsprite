import type { ReactNode } from 'react'

interface SettingsSectionHeaderProps {
  actions?: ReactNode
  className?: string
  title: ReactNode
}

export function SettingsSectionHeader({ actions, className = '', title }: SettingsSectionHeaderProps) {
  return <div className={`settings-section-header ${className}`.trim()}>
    <strong>{title}</strong>
    {actions && <div className="settings-section-actions">{actions}</div>}
  </div>
}
