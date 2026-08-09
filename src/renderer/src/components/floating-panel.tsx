import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { loadFloatingPosition, saveFloatingPosition, type FloatingPosition } from '@/core/panel-preferences'

let floatingZIndex = 40

export type PanelDock = 'right' | 'left' | 'bottom' | 'floating'
export type FixedPanelDock = Exclude<PanelDock, 'floating'>
export type ResizeDirection = 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
export interface FloatingSizeConstraints { minWidth?: number; minHeight?: number; maxWidth?: number; maxHeight?: number }

interface PanelDockZone {
  dock: FixedPanelDock
  bounds: DOMRect
  preview: CSSProperties
}

const notifyWorkspaceLayoutChanged = (): void => { window.dispatchEvent(new Event('moonsprite-workspace-layout-change')) }

export function panelDockZoneAt(clientX: number, clientY: number): PanelDockZone | null {
  const contains = (bounds: DOMRect): boolean => clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom
  const compactPreview = (dock: FixedPanelDock, bounds: DOMRect): CSSProperties => {
    if (dock === 'bottom') {
      const width = Math.min(132, Math.max(44, bounds.width - 8))
      return { position: 'fixed', left: Math.max(bounds.left + 4, Math.min(bounds.right - width - 4, clientX - width / 2)), top: bounds.top + 4, width, height: Math.min(42, Math.max(24, bounds.height - 8)) }
    }
    const height = Math.min(104, Math.max(44, bounds.height - 8))
    const width = Math.min(46, Math.max(24, bounds.width - 8))
    return { position: 'fixed', left: dock === 'left' ? bounds.right - width - 4 : bounds.left + 4, top: Math.max(bounds.top + 4, Math.min(bounds.bottom - height - 4, clientY - height / 2)), width, height }
  }
  for (const dock of ['left', 'bottom', 'right'] as FixedPanelDock[]) {
    const element = document.querySelector<HTMLElement>(`[data-panel-dock-zone="${dock}"]`)
    const bounds = element?.getBoundingClientRect()
    if (bounds && bounds.width > 0 && bounds.height > 0 && contains(bounds)) return { dock, bounds, preview: compactPreview(dock, bounds) }
  }
  const stage = document.querySelector<HTMLElement>('.stage-wrap')?.getBoundingClientRect()
  if (!stage || !contains(stage)) return null
  if (!document.querySelector('[data-panel-dock-zone="left"]') && clientX <= stage.left + Math.min(72, stage.width * .12)) {
    const bounds = new DOMRect(stage.left, stage.top, Math.min(72, stage.width), stage.height)
    return { dock: 'left', bounds, preview: compactPreview('left', bounds) }
  }
  if (!document.querySelector('[data-panel-dock-zone="bottom"]') && clientY >= stage.bottom - Math.min(72, stage.height * .18)) {
    const bounds = new DOMRect(stage.left, stage.bottom - Math.min(72, stage.height), stage.width, Math.min(72, stage.height))
    return { dock: 'bottom', bounds, preview: compactPreview('bottom', bounds) }
  }
  if (!document.querySelector('[data-panel-dock-zone="right"]') && clientX >= stage.right - Math.min(72, stage.width * .12)) {
    const bounds = new DOMRect(stage.right - Math.min(72, stage.width), stage.top, Math.min(72, stage.width), stage.height)
    return { dock: 'right', bounds, preview: compactPreview('right', bounds) }
  }
  return null
}

export function useFloatingPanel(initialPosition: FloatingPosition | null = null, followViewportRight = false, canDock = true, storageKey?: string, responsiveToViewport = false, onDock?: (dock: FixedPanelDock) => void, forceDocked = false, constraints: FloatingSizeConstraints = {}) {
  const minimumWidth = constraints.minWidth ?? 180
  const minimumHeight = constraints.minHeight ?? 120
  const maximumWidth = (): number => Math.max(minimumWidth, Math.min(constraints.maxWidth ?? window.innerWidth, window.innerWidth - 6))
  const maximumHeight = (): number => Math.max(minimumHeight, Math.min(constraints.maxHeight ?? window.innerHeight, window.innerHeight - 6))
  const ref = useRef<HTMLElement>(null)
  const [position, setPosition] = useState<FloatingPosition | null>(() => {
    const loaded = loadFloatingPosition(storageKey, initialPosition, { width: window.innerWidth, height: window.innerHeight }, responsiveToViewport, forceDocked)
    if (!loaded) return null
    return {
      ...loaded,
      width: loaded.width === undefined ? undefined : Math.max(minimumWidth, Math.min(maximumWidth(), loaded.width)),
      height: loaded.height === undefined ? undefined : Math.max(minimumHeight, Math.min(maximumHeight(), loaded.height))
    }
  })
  const [zIndex, setZIndex] = useState(() => ++floatingZIndex)
  const [dockPreview, setDockPreview] = useState<CSSProperties | null>(null)
  const dockTargetRef = useRef<FixedPanelDock | null>(null)
  const drag = useRef<{ offsetX: number; offsetY: number; width: number; height: number } | null>(null)
  const panelResize = useRef<{ direction: ResizeDirection; startX: number; startY: number; x: number; y: number; width: number; height: number } | null>(null)
  const pointerCaptureRef = useRef<{ element: HTMLElement; pointerId: number } | null>(null)
  const positionRef = useRef(position)
  const viewportRef = useRef({ width: window.innerWidth, height: window.innerHeight })
  const userPositioned = useRef(false)
  const initialRightOffset = useRef(initialPosition ? window.innerWidth - initialPosition.x : 0)

  const persistPosition = (value: FloatingPosition | null): void => {
    if (!storageKey) return
    saveFloatingPosition(storageKey, value, { width: window.innerWidth, height: window.innerHeight })
    notifyWorkspaceLayoutChanged()
  }
  const updatePosition = (updater: (current: FloatingPosition | null) => FloatingPosition | null): void => {
    setPosition((current) => {
      const next = updater(current)
      positionRef.current = next
      return next
    })
  }

  useEffect(() => {
    const move = (event: globalThis.PointerEvent): void => {
      if (panelResize.current) {
        const start = panelResize.current
        const deltaX = event.clientX - start.startX
        const deltaY = event.clientY - start.startY
        let x = start.x
        let y = start.y
        let width = start.width
        let height = start.height
        if (start.direction.includes('e')) width = Math.max(minimumWidth, Math.min(maximumWidth(), window.innerWidth - start.x, start.width + deltaX))
        if (start.direction.includes('s')) height = Math.max(minimumHeight, Math.min(maximumHeight(), window.innerHeight - start.y, start.height + deltaY))
        if (start.direction.includes('w')) { width = Math.max(minimumWidth, Math.min(maximumWidth(), start.x + start.width, start.width - deltaX)); x = start.x + start.width - width }
        if (start.direction.includes('n')) { height = Math.max(minimumHeight, Math.min(maximumHeight(), start.y + start.height, start.height - deltaY)); y = start.y + start.height - height }
        updatePosition(() => ({ x, y, width, height }))
        return
      }
      if (!drag.current || !ref.current) return
      const x = Math.max(-drag.current.width + 160, Math.min(window.innerWidth - 120, event.clientX - drag.current.offsetX))
      const headerHeight = Math.max(32, Math.min(64, ref.current.querySelector('header')?.getBoundingClientRect().height || 32))
      const y = Math.max(0, Math.min(window.innerHeight - headerHeight, event.clientY - drag.current.offsetY))
      const current = positionRef.current
      positionRef.current = { x, y, width: current?.width ?? drag.current.width, height: current?.height ?? drag.current.height }
      ref.current.style.left = `${x}px`
      ref.current.style.top = `${y}px`
      if (canDock) {
        const target = panelDockZoneAt(event.clientX, event.clientY)
        dockTargetRef.current = target?.dock ?? null
        setDockPreview(target?.preview ?? null)
      }
    }
    const up = (event: globalThis.PointerEvent): void => {
      if (drag.current && canDock && ref.current?.classList.contains('floating-panel')) {
        const dock = event.type === 'pointerup' ? panelDockZoneAt(event.clientX, event.clientY)?.dock ?? null : null
        if (dock) {
          userPositioned.current = false
          updatePosition(() => null)
          persistPosition(null)
          onDock?.(dock)
        }
      }
      setPosition(positionRef.current)
      persistPosition(positionRef.current)
      drag.current = null
      panelResize.current = null
      const capture = pointerCaptureRef.current
      if (capture) {
        try { if (capture.element.hasPointerCapture?.(capture.pointerId)) capture.element.releasePointerCapture(capture.pointerId) } catch { /* WebView may release capture when leaving the native window. */ }
      }
      pointerCaptureRef.current = null
      dockTargetRef.current = null
      setDockPreview(null)
    }
    const resize = (): void => {
      updatePosition((current) => {
        if (!current) return current
        const scaleX = responsiveToViewport ? window.innerWidth / viewportRef.current.width : 1
        const scaleY = responsiveToViewport ? window.innerHeight / viewportRef.current.height : 1
        const width = Math.max(minimumWidth, Math.min(maximumWidth(), (current.width ?? minimumWidth) * scaleX))
        const height = Math.max(minimumHeight, Math.min(maximumHeight(), (current.height ?? minimumHeight) * scaleY))
        const x = responsiveToViewport ? current.x * scaleX : followViewportRight && !userPositioned.current ? window.innerWidth - initialRightOffset.current : current.x
        const y = responsiveToViewport ? current.y * scaleY : current.y
        viewportRef.current = { width: window.innerWidth, height: window.innerHeight }
        const next = { x: Math.max(-width + 160, Math.min(window.innerWidth - 120, x)), y: Math.max(0, Math.min(window.innerHeight - 32, y)), width, height }
        window.requestAnimationFrame(() => persistPosition(positionRef.current))
        return next
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    window.addEventListener('resize', resize)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); window.removeEventListener('resize', resize) }
  }, [])

  useEffect(() => {
    const panel = ref.current
    if (!panel || !position || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (drag.current || panelResize.current) return
      const bounds = panel.getBoundingClientRect()
      updatePosition((current) => {
        if (!current) return current
        const width = current.width === undefined ? undefined : bounds.width
        const height = current.height === undefined ? undefined : bounds.height
        if ((width === undefined || Math.abs(width - current.width!) < 1) && (height === undefined || Math.abs(height - current.height!) < 1)) return current
        return { ...current, width, height }
      })
    })
    observer.observe(panel)
    return () => observer.disconnect()
  }, [position !== null])

  const startDrag = (event: ReactPointerEvent<HTMLElement>, allowMiddle = false): void => {
    if ((event.button !== 0 && (!allowMiddle || event.button !== 1)) || (event.target as HTMLElement).closest('button, input, select')) return
    const panel = ref.current
    if (!panel) return
    const bounds = panel.getBoundingClientRect()
    userPositioned.current = true
    setZIndex(++floatingZIndex)
    updatePosition((current) => current ?? { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height })
    drag.current = { offsetX: event.clientX - bounds.left, offsetY: event.clientY - bounds.top, width: bounds.width, height: bounds.height }
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId)
      pointerCaptureRef.current = { element: event.currentTarget, pointerId: event.pointerId }
    } catch { /* Pointer capture is unavailable after the native window loses focus. */ }
    event.preventDefault()
  }
  const startResize = (event: ReactPointerEvent<HTMLElement>, direction: ResizeDirection): void => {
    if (event.button !== 0 || !ref.current) return
    const bounds = ref.current.getBoundingClientRect()
    userPositioned.current = true
    setZIndex(++floatingZIndex)
    updatePosition(() => ({ x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height }))
    panelResize.current = { direction, startX: event.clientX, startY: event.clientY, x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height }
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId)
      pointerCaptureRef.current = { element: event.currentTarget, pointerId: event.pointerId }
    } catch { /* Pointer capture is unavailable after the native window loses focus. */ }
    event.preventDefault()
    event.stopPropagation()
  }
  const startDetachedDrag = (clientX: number, clientY: number, continueDrag = true): void => {
    const panel = ref.current
    if (!panel) return
    const bounds = panel.getBoundingClientRect()
    userPositioned.current = true
    setZIndex(++floatingZIndex)
    const offsetX = Math.min(80, Math.max(24, bounds.width / 2))
    const offsetY = 16
    const next = { x: Math.max(-bounds.width + 160, Math.min(window.innerWidth - 120, clientX - offsetX)), y: Math.max(0, Math.min(window.innerHeight - 32, clientY - offsetY)), width: bounds.width, height: bounds.height }
    updatePosition(() => next)
    persistPosition(next)
    drag.current = continueDrag ? { offsetX, offsetY, width: bounds.width, height: bounds.height } : null
  }
  const resizeTo = (width: number, height: number): void => {
    let nextPosition: FloatingPosition | null = null
    updatePosition((current) => {
      if (!current) return current
      nextPosition = { ...current, width: Math.max(minimumWidth, Math.min(maximumWidth(), window.innerWidth - current.x, width)), height: Math.max(minimumHeight, Math.min(maximumHeight(), window.innerHeight - current.y, height)) }
      return nextPosition
    })
    if (nextPosition) persistPosition(nextPosition)
  }
  const clearHeight = (): void => {
    updatePosition((current) => current ? { ...current, height: undefined } : current)
  }
  const style: CSSProperties | undefined = position ? { position: 'fixed', left: position.x, top: position.y, width: position.width, height: position.height, zIndex } : undefined
  return { ref, style, dockPreview, startDrag, startDetachedDrag, startResize, resizeTo, clearHeight, bringToFront: () => setZIndex(++floatingZIndex) }
}

export function PanelResizeHandles({ onResize }: { onResize: (event: ReactPointerEvent<HTMLElement>, direction: ResizeDirection) => void }) {
  return <>{(['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'] as ResizeDirection[]).map((direction) => <span key={direction} className={`floating-resize-handle resize-${direction}`} aria-hidden="true" onPointerDown={(event) => onResize(event, direction)} />)}</>
}

interface PortalResizeHandlesProps {
  onResize: (event: ReactPointerEvent<HTMLElement>, direction: ResizeDirection) => void
  position: CSSProperties | undefined
  targetRef: RefObject<HTMLElement | null>
}

export function PortalResizeHandles({ onResize, position, targetRef }: PortalResizeHandlesProps) {
  const [bounds, setBounds] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  useEffect(() => {
    const target = targetRef.current
    if (!target) return
    const sync = (): void => {
      const next = target.getBoundingClientRect()
      setBounds((current) => current && current.left === next.left && current.top === next.top && current.width === next.width && current.height === next.height
        ? current
        : { left: next.left, top: next.top, width: next.width, height: next.height })
    }
    sync()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(sync)
    observer.observe(target)
    return () => observer.disconnect()
  }, [position?.left, position?.top, position?.width, position?.height, targetRef])

  if (!bounds) return null
  const zIndex = typeof position?.zIndex === 'number' ? position.zIndex + 1 : 220
  return createPortal(
    <div className="floating-resize-portal" style={{ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height, zIndex }} aria-hidden="true">
      <PanelResizeHandles onResize={onResize} />
    </div>,
    document.body
  )
}

export function FloatingDockPreview({ style }: { style: CSSProperties | null }) {
  return style ? createPortal(<div className="inspector-dock-preview" style={style} aria-hidden="true" />, document.body) : null
}
