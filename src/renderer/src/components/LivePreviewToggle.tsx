import { PixelUtilityIcon } from './PixelUtilityIcon'
import { useI18n } from './I18nProvider'

interface LivePreviewToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  className?: string
  description?: string
  label?: string
}

export function LivePreviewToggle({ checked, onChange, className = '', description, label }: LivePreviewToggleProps) {
  const { t } = useI18n()
  return <label className={`live-preview-toggle ${className}`.trim()}>
    <span className="live-preview-copy">
      <span className="live-preview-label"><PixelUtilityIcon kind="eye" />{label ?? t('common.livePreview')}</span>
      {description && <small>{description}</small>}
    </span>
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    <span className="toggle-track" aria-hidden="true"><i /></span>
  </label>
}
