import { Trash2 } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'
import { useI18n } from './I18nProvider'

export interface DeleteIconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  size?: 'compact' | 'regular'
}

export function DeleteIconButton({ className = '', size = 'compact', title, ...props }: DeleteIconButtonProps) {
  const { t } = useI18n()
  return <button
    {...props}
    type={props.type ?? 'button'}
    className={`icon-button delete-icon-button ${size === 'regular' ? 'regular' : 'compact'} ${className}`.trim()}
    title={title ?? t('common.delete')}
  ><Trash2 size={size === 'regular' ? 15 : 13} /></button>
}
