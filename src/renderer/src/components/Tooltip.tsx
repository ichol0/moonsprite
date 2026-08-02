import { createPortal } from 'react-dom'
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

interface TooltipProps {
  children: ReactNode
  content?: ReactNode
  className?: string
}

export function Tooltip({ children, content, className = '' }: TooltipProps) {
  const id = useId()
  const anchorRef = useRef<HTMLSpanElement>(null)
  const tooltipRef = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 8, top: 8 })

  useLayoutEffect(() => {
    if (!open) return
    const anchor = anchorRef.current?.getBoundingClientRect()
    const tooltip = tooltipRef.current?.getBoundingClientRect()
    if (!anchor || !tooltip) return
    const left = Math.max(8, Math.min(window.innerWidth - tooltip.width - 8, anchor.left))
    const top = anchor.bottom + tooltip.height + 6 <= window.innerHeight
      ? anchor.bottom + 5
      : Math.max(8, anchor.top - tooltip.height - 5)
    setPosition({ left, top })
  }, [open, content])

  return <span ref={anchorRef} className={`moon-tooltip-anchor ${className}`.trim()} aria-describedby={open && content ? id : undefined} onPointerEnter={() => setOpen(Boolean(content))} onPointerLeave={() => setOpen(false)} onFocus={() => setOpen(Boolean(content))} onBlur={() => setOpen(false)}>
    {children}
    {open && content && createPortal(<span ref={tooltipRef} id={id} className="moon-tooltip" role="tooltip" style={position}>{content}</span>, document.body)}
  </span>
}
