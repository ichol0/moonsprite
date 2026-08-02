import type { TextareaHTMLAttributes } from 'react'

export function TextAreaInput({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`text-area-input ${className}`.trim()} />
}
