import { createElement, useMemo, type FormEventHandler, type HTMLAttributes, type ReactElement, type ReactNode } from 'react'
import { PortalResizeHandles, useFloatingPanel } from './floating-panel'

type ModalPlacement = 'center' | 'right'

interface ModalShellProps extends Omit<HTMLAttributes<HTMLElement>, 'onSubmit'> {
  as?: 'section' | 'form'
  children: ReactNode
  className?: string
  defaultHeight?: number
  defaultWidth?: number
  fitContent?: boolean
  minHeight?: number
  minWidth?: number
  maxHeight?: number
  maxWidth?: number
  onSubmit?: FormEventHandler<HTMLFormElement>
  placement?: ModalPlacement
  storageKey: string
}

function initialModalPosition(width: number, height: number, placement: ModalPlacement, fitContent: boolean) {
  const margin = 12
  const safeWidth = Math.min(width, window.innerWidth - margin * 2)
  const safeHeight = Math.min(height, window.innerHeight - margin * 2)
  const stage = placement === 'right' ? document.querySelector<HTMLElement>('.stage-wrap')?.getBoundingClientRect() : null
  const targetCenterX = stage && stage.width > 0 ? stage.left + stage.width * 0.75 : window.innerWidth * 0.75
  const x = placement === 'right'
    ? Math.max(margin, Math.min(window.innerWidth - safeWidth - margin, Math.round(targetCenterX - safeWidth / 2)))
    : Math.max(margin, Math.round((window.innerWidth - safeWidth) / 2))
  return {
    x,
    y: Math.max(margin, Math.round((window.innerHeight - safeHeight) / 2)),
    width: safeWidth,
    height: fitContent ? undefined : safeHeight
  }
}

export function ModalShell({
  as = 'section',
  children,
  className = '',
  defaultHeight = 360,
  defaultWidth = 420,
  fitContent = true,
  minHeight = 220,
  minWidth = 300,
  maxHeight = 760,
  maxWidth = 820,
  onPointerDown,
  placement = 'center',
  storageKey,
  ...props
}: ModalShellProps): ReactElement {
  const layoutMinWidth = className.includes('settings-modal') ? Math.max(minWidth, 620)
    : className.includes('component-library') ? Math.max(minWidth, 700)
      : className.includes('outline-modal') ? Math.max(minWidth, 500)
        : minWidth
  const layoutMinHeight = className.includes('settings-modal') ? Math.max(minHeight, 440)
    : className.includes('component-library') ? Math.max(minHeight, 500)
      : className.includes('outline-modal') ? Math.max(minHeight, 400)
        : minHeight
  const initialPosition = useMemo(
    () => initialModalPosition(defaultWidth, defaultHeight, placement, fitContent),
    [defaultHeight, defaultWidth, fitContent, placement]
  )
  const floating = useFloatingPanel(
    initialPosition,
    placement === 'right',
    false,
    `moonsprite.modal.${storageKey}`,
    false,
    undefined,
    false,
    { minWidth: layoutMinWidth, minHeight: layoutMinHeight, maxWidth, maxHeight }
  )

  return createElement(as, {
    ...props,
    ref: floating.ref,
    className: `modal resizable-modal ${placement === 'right' ? 'right-modal' : ''} ${className}`.trim(),
    style: { ...floating.style, minWidth: layoutMinWidth, minHeight: layoutMinHeight, maxWidth: `min(${maxWidth}px, calc(100vw - 12px))`, maxHeight: `min(${maxHeight}px, calc(100vh - 12px))`, overflow: 'hidden' },
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      floating.bringToFront()
      if ((event.target as HTMLElement).closest('header')) floating.startDrag(event)
      onPointerDown?.(event)
    }
  }, children, createElement(PortalResizeHandles, { targetRef: floating.ref, position: floating.style, onResize: floating.startResize }))
}
