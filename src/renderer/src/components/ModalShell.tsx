import { createElement, useLayoutEffect, useMemo, type FormEventHandler, type HTMLAttributes, type ReactElement, type ReactNode } from 'react'
import { PortalResizeHandles, useFloatingPanel } from './floating-panel'

type ModalPlacement = 'center' | 'right'

interface ModalShellProps extends Omit<HTMLAttributes<HTMLElement>, 'onSubmit'> {
  as?: 'section' | 'form'
  children: ReactNode
  className?: string
  defaultHeight?: number
  defaultWidth?: number
  fitContent?: boolean
  fitContentKey?: string
  minHeight?: number
  minWidth?: number
  maxHeight?: number
  maxWidth?: number
  onSubmit?: FormEventHandler<HTMLFormElement>
  placement?: ModalPlacement
  resizable?: boolean
  resizePortalClassName?: string
  storageKey: string
}

function initialModalPosition(width: number, height: number, placement: ModalPlacement, fitContent: boolean) {
  const margin = 12
  const viewportTop = document.querySelector<HTMLElement>('.app-window-titlebar')?.getBoundingClientRect().bottom ?? 0
  const safeWidth = Math.min(width, window.innerWidth - margin * 2)
  const availableHeight = Math.max(1, window.innerHeight - viewportTop)
  const safeHeight = Math.min(height, Math.max(1, availableHeight - margin * 2))
  const stage = placement === 'right' ? document.querySelector<HTMLElement>('.stage-wrap')?.getBoundingClientRect() : null
  const targetCenterX = stage && stage.width > 0 ? stage.left + stage.width * 0.75 : window.innerWidth * 0.75
  const x = placement === 'right'
    ? Math.max(margin, Math.min(window.innerWidth - safeWidth - margin, Math.round(targetCenterX - safeWidth / 2)))
    : Math.max(margin, Math.round((window.innerWidth - safeWidth) / 2))
  return {
    x,
    y: viewportTop + Math.max(margin, Math.round((availableHeight - safeHeight) / 2)),
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
  fitContentKey,
  minHeight = 220,
  minWidth = 300,
  maxHeight = 760,
  maxWidth = 820,
  onPointerDown,
  placement = 'center',
  resizable = true,
  resizePortalClassName,
  storageKey,
  ...props
}: ModalShellProps): ReactElement {
  const classNames = new Set(className.split(/\s+/).filter(Boolean))
  const fullSettingsDialog = classNames.has('settings-modal')
  const effectiveFitContent = fullSettingsDialog ? false : fitContent
  const layoutMinWidth = fullSettingsDialog ? Math.max(minWidth, 620)
    : classNames.has('component-library') ? Math.max(minWidth, 700)
      : classNames.has('outline-modal') ? Math.max(minWidth, 500)
        : minWidth
  const layoutMinHeight = fullSettingsDialog ? Math.max(minHeight, 440)
    : classNames.has('component-library') ? Math.max(minHeight, 500)
      : classNames.has('outline-modal') ? Math.max(minHeight, 400)
        : minHeight
  const viewportTop = document.querySelector<HTMLElement>('.app-window-titlebar')?.getBoundingClientRect().bottom ?? 0
  const viewportMaxWidth = Math.min(maxWidth, Math.max(1, window.innerWidth - 24))
  const viewportMaxHeight = Math.min(maxHeight, Math.max(1, window.innerHeight - viewportTop - 24))
  const viewportMinWidth = Math.min(layoutMinWidth, Math.max(1, window.innerWidth - 12))
  const viewportMinHeight = Math.min(layoutMinHeight, viewportMaxHeight)
  const initialPosition = useMemo(
    () => initialModalPosition(defaultWidth, defaultHeight, placement, effectiveFitContent),
    [defaultHeight, defaultWidth, effectiveFitContent, placement]
  )
  const floating = useFloatingPanel(
    initialPosition,
    placement === 'right',
    false,
    `moonsprite.modal.${storageKey}`,
    true,
    undefined,
    false,
    { minWidth: layoutMinWidth, minHeight: layoutMinHeight, maxWidth, maxHeight }
  )
  useLayoutEffect(() => {
    if (effectiveFitContent && fitContentKey !== undefined) floating.clearHeight()
  }, [effectiveFitContent, fitContentKey])

  return createElement(as, {
    ...props,
    ref: floating.ref,
    className: `modal resizable-modal ${placement === 'right' ? 'right-modal' : ''} ${className}`.trim(),
    style: {
      ...floating.style,
      top: typeof floating.style?.top === 'number' ? Math.max(viewportTop + 6, floating.style.top) : floating.style?.top,
      minWidth: viewportMinWidth,
      minHeight: viewportMinHeight,
      maxWidth: viewportMaxWidth,
      maxHeight: viewportMaxHeight,
      overflow: 'hidden'
    },
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.target as Node)) return
      floating.bringToFront()
      const header = (event.target as HTMLElement).closest('header')
      if (header && event.currentTarget.contains(header) && header.closest('.modal') === event.currentTarget) floating.startDrag(event)
      onPointerDown?.(event)
    }
  }, children, resizable
    ? createElement(PortalResizeHandles, { targetRef: floating.ref, position: floating.style, onResize: floating.startResize, className: resizePortalClassName })
    : null)
}
