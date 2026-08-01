import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Palette, Square } from 'lucide-react'
import type { DocumentSession } from '@/store/workspace'
import { ColorPanel } from '@/components/panels/ColorPanel'
import { LayersPanel } from '@/components/panels/LayersPanel'
import { PalettePanel } from '@/components/panels/PalettePanel'
import { PreviewPanel } from '@/components/panels/PreviewPanel'
import type { DockDragProps } from '@/components/workspace-panel-types'
import { readStoredString, removeStoredValue, writeStoredString } from '@/core/panel-preferences'
import { COLOR_SQUARE_ANCHOR_STORAGE_KEY, COLOR_SQUARE_DOCK_STORAGE_KEY, DEFAULT_BOTTOM_WIDTHS, DEFAULT_INSPECTOR_ORDER, DEFAULT_INSPECTOR_SIZES, INSPECTOR_LAYOUT_STORAGE_KEY, MINIMUM_BOTTOM_WIDTHS, MINIMUM_INSPECTOR_SIZES, loadInspectorLayout, moveInspectorPanel, type WorkspacePanelId } from '@/core/panel-layout'
import { FloatingDockPreview, panelDockZoneAt } from './floating-panel'
import type { FixedPanelDock, PanelDock } from './floating-panel'

export type { PanelDock } from './floating-panel'
export type { WorkspacePanelId } from '@/core/panel-layout'
const notifyWorkspaceLayoutChanged = (): void => { window.dispatchEvent(new Event('moonsprite-workspace-layout-change')) }

type InspectorDockTarget =
  | { kind: 'dock'; dock: FixedPanelDock; id?: WorkspacePanelId; insertAfter: boolean }
  | { kind: 'floating' }
type SquareAnchor = 'start' | 'end'

export function InspectorPanels({ session, previewOpen, onClosePreview, panelDocks, leftDockHost, bottomDockHost, onPanelDockChange, relativeLuminanceInPreview = true }: {
  session: DocumentSession
  previewOpen: boolean
  onClosePreview: () => void
  panelDocks: Record<WorkspacePanelId, PanelDock>
  leftDockHost: HTMLElement | null
  bottomDockHost: HTMLElement | null
  onPanelDockChange: (id: WorkspacePanelId, dock: PanelDock) => void
  relativeLuminanceInPreview?: boolean
}) {
  const initialLayout = useMemo(loadInspectorLayout, [])
  const [order, setOrder] = useState<WorkspacePanelId[]>(initialLayout.order)
  const [sizes, setSizes] = useState<Record<WorkspacePanelId, number>>(initialLayout.sizes)
  const [bottomWidths, setBottomWidths] = useState<Record<WorkspacePanelId, number>>(initialLayout.bottomWidths)
  const [colorSquareDock, setColorSquareDock] = useState<FixedPanelDock | null>(() => {
    const stored = readStoredString(COLOR_SQUARE_DOCK_STORAGE_KEY)
    return stored === 'left' || stored === 'right' || stored === 'bottom' ? stored : null
  })
  const [colorSquareAnchor, setColorSquareAnchor] = useState<SquareAnchor>(() => readStoredString(COLOR_SQUARE_ANCHOR_STORAGE_KEY) === 'start' ? 'start' : 'end')
  const [draggingPanel, setDraggingPanel] = useState<WorkspacePanelId | null>(null)
  const [detachPreview, setDetachPreview] = useState<React.CSSProperties | null>(null)
  const [dockDropTarget, setDockDropTarget] = useState<InspectorDockTarget | null>(null)
  const sizesRef = useRef(sizes)
  const bottomWidthsRef = useRef(bottomWidths)
  const orderRef = useRef(order)
  const colorSquareDockRef = useRef<FixedPanelDock | null>(colorSquareDock)
  const detachPreviewRef = useRef<React.CSSProperties | null>(null)
  const dockDropTargetRef = useRef<InspectorDockTarget | null>(null)
  const resizeRef = useRef<{ upper: WorkspacePanelId; dock: 'left' | 'right'; startY: number; startSizes: Record<WorkspacePanelId, number> } | null>(null)
  const bottomResizeRef = useRef<{ leading: WorkspacePanelId; trailing: WorkspacePanelId; startX: number; startWidths: Record<WorkspacePanelId, number> } | null>(null)
  const dockDragRef = useRef<{ id: WorkspacePanelId; startX: number; startY: number; detach: (clientX: number, clientY: number, continueDrag?: boolean) => void; moved: boolean } | null>(null)
  sizesRef.current = sizes
  bottomWidthsRef.current = bottomWidths
  orderRef.current = order
  colorSquareDockRef.current = colorSquareDock
  const dockFor = (id: WorkspacePanelId): PanelDock => panelDocks[id] ?? (id === 'preview' ? 'floating' : 'right')

  const persistLayout = (nextOrder = order, nextSizes = sizesRef.current, nextBottomWidths = bottomWidthsRef.current): void => {
    try {
      writeStoredString(INSPECTOR_LAYOUT_STORAGE_KEY, JSON.stringify({ order: nextOrder, sizes: nextSizes, bottomWidths: nextBottomWidths }))
      notifyWorkspaceLayoutChanged()
    } catch { /* Ignore unavailable renderer storage. */ }
  }
  const setSquareDock = (dock: FixedPanelDock | null, anchor: SquareAnchor = colorSquareAnchor): void => {
    setColorSquareDock(dock)
    if (dock) {
      setColorSquareAnchor(anchor)
      writeStoredString(COLOR_SQUARE_DOCK_STORAGE_KEY, dock)
      writeStoredString(COLOR_SQUARE_ANCHOR_STORAGE_KEY, anchor)
    } else {
      removeStoredValue(COLOR_SQUARE_DOCK_STORAGE_KEY)
      removeStoredValue(COLOR_SQUARE_ANCHOR_STORAGE_KEY)
    }
    notifyWorkspaceLayoutChanged()
  }
  const setDockTarget = (target: InspectorDockTarget | null): void => {
    dockDropTargetRef.current = target
    setDockDropTarget(target)
  }
  useEffect(() => {
    const move = (event: PointerEvent): void => {
      const bottomResize = bottomResizeRef.current
      if (bottomResize) {
        if (Math.abs(event.clientX - bottomResize.startX) > 1 && colorSquareDockRef.current === 'bottom') setSquareDock(null)
        const total = bottomResize.startWidths[bottomResize.leading] + bottomResize.startWidths[bottomResize.trailing]
        const minimumLeading = MINIMUM_BOTTOM_WIDTHS[bottomResize.leading]
        const minimumTrailing = MINIMUM_BOTTOM_WIDTHS[bottomResize.trailing]
        const leading = Math.max(minimumLeading, Math.min(total - minimumTrailing, bottomResize.startWidths[bottomResize.leading] + event.clientX - bottomResize.startX))
        const next = { ...bottomResize.startWidths, [bottomResize.leading]: leading, [bottomResize.trailing]: total - leading }
        bottomWidthsRef.current = next
        setBottomWidths(next)
        return
      }
      const drag = resizeRef.current
      if (drag) {
        if (Math.abs(event.clientY - drag.startY) > 1 && colorSquareDockRef.current === drag.dock) setSquareDock(null)
        const start = drag.startSizes
        const desired = Math.max(MINIMUM_INSPECTOR_SIZES[drag.upper], start[drag.upper] + event.clientY - drag.startY)
        const delta = desired - start[drag.upper]
        const next = { ...start, [drag.upper]: desired }
        const dockOrder = orderRef.current.filter((id) => dockFor(id) === drag.dock && (id !== 'preview' || previewOpen))
        const upperIndex = dockOrder.indexOf(drag.upper)
        const lowerPanels = dockOrder.slice(upperIndex + 1)
        if (delta > 0) {
          let remaining = delta
          for (const id of lowerPanels) {
            const available = Math.max(0, next[id] - MINIMUM_INSPECTOR_SIZES[id])
            const consumed = Math.min(available, remaining)
            next[id] -= consumed
            remaining -= consumed
            if (remaining <= 0) break
          }
        } else if (delta < 0 && lowerPanels[0]) {
          next[lowerPanels[0]] += -delta
        }
        sizesRef.current = next
        setSizes(next)
        return
      }
      const dockDrag = dockDragRef.current
      if (!dockDrag) return
      if (!dockDrag.moved && Math.hypot(event.clientX - dockDrag.startX, event.clientY - dockDrag.startY) < 4) return
      dockDrag.moved = true
      setDraggingPanel(dockDrag.id)
      const zone = panelDockZoneAt(event.clientX, event.clientY)
      if (zone) {
        const slots = [...document.querySelectorAll<HTMLElement>(`[data-panel-dock-zone="${zone.dock}"] [data-inspector-panel-id]`)].filter((slot) => slot.dataset.inspectorPanelId !== dockDrag.id)
        let targetSlot = slots.find((slot) => {
          const bounds = slot.getBoundingClientRect()
          return event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom
        })
        if (!targetSlot && slots.length > 0) {
          const pointer = zone.dock === 'bottom' ? event.clientX : event.clientY
          targetSlot = slots.reduce((closest, slot) => {
            const closestBounds = closest.getBoundingClientRect()
            const slotBounds = slot.getBoundingClientRect()
            const closestCenter = zone.dock === 'bottom' ? closestBounds.left + closestBounds.width / 2 : closestBounds.top + closestBounds.height / 2
            const slotCenter = zone.dock === 'bottom' ? slotBounds.left + slotBounds.width / 2 : slotBounds.top + slotBounds.height / 2
            return Math.abs(pointer - slotCenter) < Math.abs(pointer - closestCenter) ? slot : closest
          })
        }
        const target = targetSlot?.dataset.inspectorPanelId as WorkspacePanelId | undefined
        const bounds = targetSlot?.getBoundingClientRect()
        const insertAfter = bounds ? (zone.dock === 'bottom' ? event.clientX >= bounds.left + bounds.width / 2 : event.clientY >= bounds.top + bounds.height / 2) : true
        detachPreviewRef.current = target ? null : zone.preview
        setDetachPreview(target ? null : zone.preview)
        setDockTarget({ kind: 'dock', dock: zone.dock, id: target, insertAfter })
        return
      }
      {
        const source = document.querySelector<HTMLElement>(`[data-inspector-panel-id="${dockDrag.id}"]`)?.getBoundingClientRect()
        const width = source?.width ?? 280
        const height = source?.height ?? sizesRef.current[dockDrag.id]
        const preview = {
          position: 'fixed',
          left: Math.max(0, Math.min(window.innerWidth - Math.min(width, 120), event.clientX - Math.min(80, width / 2))),
          top: Math.max(0, Math.min(window.innerHeight - 32, event.clientY - 16)),
          width,
          height
        } satisfies React.CSSProperties
        detachPreviewRef.current = preview
        setDetachPreview(preview)
        setDockTarget({ kind: 'floating' })
        return
      }
    }
    const up = (event: PointerEvent): void => {
      if (resizeRef.current) persistLayout(orderRef.current, sizesRef.current)
      if (bottomResizeRef.current) persistLayout(orderRef.current, sizesRef.current, bottomWidthsRef.current)
      const dockDrag = dockDragRef.current
      const target = dockDropTargetRef.current
      if (dockDrag?.moved && target?.kind === 'dock') {
        const nextOrder = moveInspectorPanel(orderRef.current, dockDrag.id, target.id, target.insertAfter)
        orderRef.current = nextOrder
        setOrder(nextOrder)
        persistLayout(nextOrder, sizesRef.current)
        onPanelDockChange(dockDrag.id, target.dock)
        if (dockDrag.id === 'color') setSquareDock(null)
      } else if (dockDrag?.moved && target?.kind === 'floating') {
        dockDrag.detach(event.clientX, event.clientY, false)
        onPanelDockChange(dockDrag.id, 'floating')
        if (dockDrag.id === 'color') setSquareDock(null)
      } else if (dockDrag?.moved) persistLayout(orderRef.current, sizesRef.current)
      resizeRef.current = null
      bottomResizeRef.current = null
      dockDragRef.current = null
      detachPreviewRef.current = null
      setDetachPreview(null)
      setDockTarget(null)
      setDraggingPanel(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [onPanelDockChange, panelDocks, previewOpen])

  const restoreColorSquare = (preferBottom = false): void => {
    const currentDock = dockFor('color')
    const targetDock: FixedPanelDock = preferBottom ? 'bottom' : currentDock === 'left' || currentDock === 'right' || currentDock === 'bottom' ? currentDock : 'bottom'
    // A docked panel keeps its current order. The edge only decides which
    // boundary remains fixed while the square size consumes sibling space.
    const nextOrder = currentDock === targetDock ? orderRef.current : moveInspectorPanel(orderRef.current, 'color')
    const dockOrder = nextOrder.filter((id) => id !== 'preview' || previewOpen).filter((id) => (id === 'color' ? targetDock : dockFor(id)) === targetDock)
    const colorIndex = dockOrder.indexOf('color')
    const anchor: SquareAnchor = colorIndex >= 0 && colorIndex === dockOrder.length - 1 ? 'end' : 'start'
    if (currentDock === targetDock) {
      const currentPanel = document.querySelector<HTMLElement>(`[data-panel-dock-content="${targetDock}"] [data-inspector-panel-id="color"] .color-panel`)
      const currentField = currentPanel?.querySelector<HTMLElement>('.color-field-slot')
      const currentFieldBounds = currentField?.getBoundingClientRect()
      if (currentFieldBounds && Math.abs(currentFieldBounds.width - currentFieldBounds.height) <= 1) {
        // The visible geometry is already correct. Re-locking here would
        // change flex distribution and cause a one-frame layout flash.
        return
      }
    }

    orderRef.current = nextOrder
    setOrder(nextOrder)
    if (targetDock !== currentDock) onPanelDockChange('color', targetDock)
    setSquareDock(null)
    persistLayout(nextOrder, sizesRef.current, bottomWidthsRef.current)

    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const slot = document.querySelector<HTMLElement>(`[data-panel-dock-content="${targetDock}"] [data-inspector-panel-id="color"]`)
      const panel = slot?.querySelector<HTMLElement>('.color-panel')
      const fieldSlot = panel?.querySelector<HTMLElement>('.color-field-slot')
      const host = slot?.closest<HTMLElement>(`[data-panel-dock-content="${targetDock}"]`)
      if (!slot || !panel || !fieldSlot || !host) return
      const panelBounds = panel.getBoundingClientRect()
      const fieldBounds = fieldSlot.getBoundingClientRect()
      const hostBounds = host.getBoundingClientRect()
      const activeSiblings = nextOrder.filter((id) => id !== 'color' && (id !== 'preview' || previewOpen) && dockFor(id) === targetDock)

      if (targetDock === 'bottom') {
        const reservedWidth = activeSiblings.reduce((total, id) => total + MINIMUM_BOTTOM_WIDTHS[id], 0) + activeSiblings.length * 7
        const maximumWidth = Math.max(MINIMUM_BOTTOM_WIDTHS.color, hostBounds.width - reservedWidth)
        const targetWidth = Math.max(MINIMUM_BOTTOM_WIDTHS.color, Math.min(maximumWidth, Math.round(panelBounds.width - fieldBounds.width + fieldBounds.height)))
        const next = { ...bottomWidthsRef.current, color: targetWidth }
        bottomWidthsRef.current = next
        setBottomWidths(next)
        setSquareDock('bottom', anchor)
        persistLayout(nextOrder, sizesRef.current, next)
        return
      }

      const reservedHeight = activeSiblings.reduce((total, id) => total + MINIMUM_INSPECTOR_SIZES[id], 0) + activeSiblings.length * 7
      const maximumHeight = Math.max(MINIMUM_INSPECTOR_SIZES.color, hostBounds.height - reservedHeight)
      const dockOrder = nextOrder.filter((id) => id !== 'preview' || previewOpen).filter((id) => dockFor(id) === targetDock)
      const colorHasFollowingPanel = dockOrder.indexOf('color') < dockOrder.length - 1
      const separatorAllowance = colorHasFollowingPanel ? 7 : 0
      const targetHeight = Math.max(MINIMUM_INSPECTOR_SIZES.color, Math.min(maximumHeight, Math.round(panelBounds.height - fieldBounds.height + fieldBounds.width + separatorAllowance)))
      const next = { ...sizesRef.current, color: targetHeight }
      sizesRef.current = next
      setSizes(next)
      setSquareDock(targetDock, anchor)
      persistLayout(nextOrder, next, bottomWidthsRef.current)
    }))
  }

  const panelFor = (id: WorkspacePanelId, docked: boolean) => {
    const dockProps: DockDragProps = { docked, onFloatingDock: (dock) => onPanelDockChange(id, dock), onDockDragStart: (event, detach) => {
      if (event.button !== 0 || (event.target as HTMLElement).closest('button, input, select')) return
      dockDragRef.current = { id, startX: event.clientX, startY: event.clientY, detach, moved: false }
      event.preventDefault()
    } }
    if (id === 'color') return <ColorPanel session={session} onRestoreSquare={restoreColorSquare} {...dockProps} />
    if (id === 'palette') return <PalettePanel session={session} {...dockProps} />
    if (id === 'layers') return <LayersPanel session={session} {...dockProps} />
    return <PreviewPanel session={session} onClose={onClosePreview} relativeLuminanceInPreview={relativeLuminanceInPreview} {...dockProps} />
  }

  const completeOrder = [...order, ...DEFAULT_INSPECTOR_ORDER.filter((id) => !order.includes(id))]
  const activeOrder = completeOrder.filter((id) => id !== 'preview' || previewOpen)
  const renderDock = (dock: FixedPanelDock) => {
    const dockOrder = activeOrder.filter((id) => dockFor(id) === dock)
    const horizontal = dock === 'bottom'
    const squareIndex = colorSquareDock === dock ? dockOrder.indexOf('color') : -1
    const squareAtStart = colorSquareDock === dock && colorSquareAnchor === 'start' && squareIndex === 0
    const squareAtEnd = colorSquareDock === dock && colorSquareAnchor === 'end' && squareIndex >= 0 && squareIndex === dockOrder.length - 1
    return <div className={horizontal ? 'bottom-panel-stack' : 'inspector-stack'} data-panel-dock-content={dock}>{dockOrder.map((id, index) => {
      const dropPreview = dockDropTarget?.kind === 'dock' && dockDropTarget.dock === dock && dockDropTarget.id === id ? dockDropTarget : null
      const nextId = dockOrder[index + 1]
      const squareLocked = id === 'color' && colorSquareDock === dock
      const fillsSpaceBeforeSquare = colorSquareDock === dock && ((squareAtEnd && index === squareIndex - 1) || (squareAtStart && index === squareIndex + 1))
      return <Fragment key={id}><div className={`${horizontal ? 'bottom-panel-group' : 'inspector-panel-group'} ${draggingPanel === id ? 'dock-dragging' : ''} ${squareLocked ? 'square-locked' : ''}`} data-inspector-panel-id={id} style={horizontal ? { flex: squareLocked ? `0 0 ${bottomWidths[id]}px` : fillsSpaceBeforeSquare ? `1 1 ${bottomWidths[id]}px` : index === dockOrder.length - 1 ? `1 1 ${bottomWidths[id]}px` : `0 1 ${bottomWidths[id]}px`, minWidth: MINIMUM_BOTTOM_WIDTHS[id], '--locked-size': `${bottomWidths[id]}px` } as React.CSSProperties : { flex: squareLocked ? `0 0 ${sizes[id]}px` : fillsSpaceBeforeSquare ? `1 1 ${sizes[id]}px` : index === dockOrder.length - 1 ? `1 1 ${sizes[id]}px` : `0 1 ${sizes[id] + 7}px`, minHeight: MINIMUM_INSPECTOR_SIZES[id] + (index < dockOrder.length - 1 ? 7 : 0), '--locked-size': `${sizes[id]}px` } as React.CSSProperties}>
        <div className="inspector-panel-slot">{panelFor(id, true)}</div>
        {!horizontal && index < dockOrder.length - 1 && <div className="panel-resizer" role="separator" aria-orientation="horizontal" aria-label={`调整${id}面板高度`} onPointerDown={(event) => {
          const measured = { ...sizesRef.current }
          for (const panelSlot of document.querySelectorAll<HTMLElement>(`[data-panel-dock-content="${dock}"] [data-inspector-panel-id]`)) {
            const slotId = panelSlot.dataset.inspectorPanelId as WorkspacePanelId | undefined
            const content = panelSlot.querySelector<HTMLElement>(':scope > .inspector-panel-slot')
            if (slotId && content) measured[slotId] = content.getBoundingClientRect().height
          }
          resizeRef.current = { upper: id, dock, startY: event.clientY, startSizes: measured }
          event.currentTarget.setPointerCapture?.(event.pointerId)
          event.preventDefault()
        }}><span /></div>}
        {dropPreview && <span className={`inspector-drop-indicator ${horizontal ? 'vertical' : ''} ${dropPreview.insertAfter ? 'below' : 'above'}`} aria-hidden="true" />}
      </div>{horizontal && nextId && <div className="bottom-panel-resizer" role="separator" aria-orientation="vertical" aria-label={`调整${id}和${nextId}栏目宽度`} onPointerDown={(event) => {
        const measured = { ...bottomWidthsRef.current }
        for (const slot of document.querySelectorAll<HTMLElement>('[data-panel-dock-content="bottom"] [data-inspector-panel-id]')) {
          const slotId = slot.dataset.inspectorPanelId as WorkspacePanelId | undefined
          if (slotId) measured[slotId] = slot.getBoundingClientRect().width
        }
        bottomResizeRef.current = { leading: id, trailing: nextId, startX: event.clientX, startWidths: measured }
        event.currentTarget.setPointerCapture?.(event.pointerId)
        event.preventDefault()
      }}><span /></div>}</Fragment>
    })}</div>
  }

  return <>
    {renderDock('right')}
    {leftDockHost && createPortal(renderDock('left'), leftDockHost)}
    {bottomDockHost && createPortal(renderDock('bottom'), bottomDockHost)}
    {createPortal(<>{activeOrder.filter((id) => dockFor(id) === 'floating').map((id) => <span className="floating-panel-host" key={id}>{panelFor(id, false)}</span>)}</>, document.body)}
    <FloatingDockPreview style={detachPreview} />
  </>
}
