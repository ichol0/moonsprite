import { Trash2 } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'

export interface DeleteIconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  size?: 'compact' | 'regular'
}

export function DeleteIconButton({ className = '', size = 'compact', title = '删除', ...props }: DeleteIconButtonProps) {
  return <button
    {...props}
    type={props.type ?? 'button'}
    className={`icon-button delete-icon-button ${size === 'regular' ? 'regular' : 'compact'} ${className}`.trim()}
    title={title}
  ><Trash2 size={size === 'regular' ? 15 : 13} /></button>
}
