import { createPortal, flushSync } from 'react-dom'
import { lazy, memo, Suspense, useEffect, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { PerformanceProfiler } from '@/components/PerformanceProfiler'
import { PixelUtilityIcon } from '@/components/PixelUtilityIcon'
import { createDocumentPaneLayout, documentPaneLeafIds, insertDocumentPane, moveDocumentPane, removeDocumentPane, resizeDocumentPane, type DocumentPaneDirection, type DocumentPaneNode, type DocumentPaneOrientation, type DocumentPanePlacement } from '@/core/document-pane-layout'
import { paneDockTargetAtPoint, type DocumentPaneDockTarget } from './document-pane-hit-test'
import { useWorkspace } from '@/store/workspace'
import { useI18n } from '@/components/I18nProvider'

const loadCanvasStage = () => import('@/components/CanvasStage').then(({ CanvasStage }) => ({ default: CanvasStage }))
const LazyCanvasStage = lazy(loadCanvasStage)
const DOCUMENT_PANE_DROP_GAP = 'clamp(18px, 5%, 56px)'

export const preloadCanvasStage = (): void => { void loadCanvasStage() }

interface EditorCanvasHostProps {
  documentPaneLayout: DocumentPaneNode | null
  documentPanePreview: DocumentPanePlacement | null
  onDocumentPaneLayoutChange: (layout: DocumentPaneNode | null) => void
  onDocumentPaneMove: (documentId: string, targetPaneId: string, direction: DocumentPaneDirection) => void
  onDocumentPaneReturnToTabs: (documentId: string, visibleIndex: number) => void
}

interface PaneTabReturnPreview {
  insertIndex: number
  left: number
  top: number
  height: number
  pointerX: number
  pointerY: number
  pointerOffsetX: number
  pointerOffsetY: number
  width: number
  ghostHeight: number
  name: string
}

const positionPaneTabReturnGhost = (preview: PaneTabReturnPreview): void => {
  const ghost = document.querySelector<HTMLElement>('[data-document-pane-return-ghost="true"]')
  if (!ghost) return
  ghost.style.left = `${preview.pointerX - preview.pointerOffsetX}px`
  ghost.style.top = `${preview.pointerY - preview.pointerOffsetY}px`
}

export const EditorCanvasHost = memo(function EditorCanvasHost({ documentPaneLayout, documentPanePreview, onDocumentPaneLayoutChange, onDocumentPaneMove, onDocumentPaneReturnToTabs }: EditorCanvasHostProps) {
  const { t } = useI18n()
  const sessions = useWorkspace((state) => state.sessions)
  const activeId = useWorkspace((state) => state.activeId)
  const paneResizeRef = useRef<{ splitId: string; orientation: DocumentPaneOrientation; pointerId: number; startX: number; startY: number; startRatio: number; container: HTMLElement; captureTarget: HTMLElement | null } | null>(null)
  const paneDragRef = useRef<{ documentId: string; pointerId: number; startX: number; startY: number; lastX: number; lastY: number; pointerOffsetX: number; pointerOffsetY: number; width: number; height: number; moved: boolean; dockTarget: DocumentPaneDockTarget | null; captureTarget: HTMLElement | null } | null>(null)
  const paneTabReturnRef = useRef<PaneTabReturnPreview | null>(null)
  const paneMovePreviewRef = useRef<DocumentPanePlacement | null>(null)
  const [paneMovePreview, setPaneMovePreview] = useState<DocumentPanePlacement | null>(null)
  const [paneTabReturnPreview, setPaneTabReturnPreview] = useState<PaneTabReturnPreview | null>(null)
  const [draggingPaneId, setDraggingPaneId] = useState<string | null>(null)
  const layoutRef = useRef(documentPaneLayout)
  const session = sessions.find((item) => item.document.id === activeId) ?? null
  useEffect(() => { layoutRef.current = documentPaneLayout }, [documentPaneLayout])

  useEffect(() => {
    const updatePaneMovePreview = (next: DocumentPanePlacement | null): void => {
      const current = paneMovePreviewRef.current
      if (current?.documentId === next?.documentId && current?.targetPaneId === next?.targetPaneId && current?.direction === next?.direction) return
      paneMovePreviewRef.current = next
      setPaneMovePreview(next)
    }
    const move = (event: PointerEvent): void => {
      const resize = paneResizeRef.current
      if (resize && resize.pointerId === event.pointerId) {
        const bounds = resize.container.getBoundingClientRect()
        const span = resize.orientation === 'horizontal' ? bounds.width : bounds.height
        if (span <= 0) return
        event.preventDefault()
        const delta = resize.orientation === 'horizontal' ? event.clientX - resize.startX : event.clientY - resize.startY
        const current = layoutRef.current
        if (!current) return
        const next = resizeDocumentPane(current, resize.splitId, resize.startRatio + delta / span)
        layoutRef.current = next
        onDocumentPaneLayoutChange(next)
        return
      }
      const drag = paneDragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 5) drag.moved = true
      if (!drag.moved) return
      event.preventDefault()
      const previousPoint = { x: drag.lastX, y: drag.lastY }
      drag.lastX = event.clientX
      drag.lastY = event.clientY
      document.documentElement.classList.add('document-pane-dragging')
      const tabStrip = document.querySelector<HTMLElement>('.tab-strip')
      const tabStripBounds = tabStrip?.getBoundingClientRect()
      const insideTabStrip = Boolean(tabStripBounds && event.clientX >= tabStripBounds.left && event.clientX <= tabStripBounds.right && event.clientY >= tabStripBounds.top && event.clientY <= tabStripBounds.bottom)
      if (insideTabStrip && tabStripBounds) {
        const tabs = [...document.querySelectorAll<HTMLButtonElement>('.document-tab')]
        const insertIndex = tabs.findIndex((tab) => event.clientX < tab.getBoundingClientRect().left + tab.getBoundingClientRect().width / 2)
        const normalizedIndex = insertIndex < 0 ? tabs.length : insertIndex
        const insertionLeft = normalizedIndex < tabs.length ? tabs[normalizedIndex].getBoundingClientRect().left : tabs.at(-1)?.getBoundingClientRect().right ?? tabStripBounds.left + 4
        const paneSession = useWorkspace.getState().sessions.find((item) => item.document.id === drag.documentId)
        const preview = { insertIndex: normalizedIndex, left: insertionLeft - 1, top: tabStripBounds.top + 3, height: Math.max(12, tabStripBounds.height - 6), pointerX: event.clientX, pointerY: event.clientY, pointerOffsetX: drag.pointerOffsetX, pointerOffsetY: drag.pointerOffsetY, width: drag.width, ghostHeight: drag.height, name: paneSession?.document.name ?? '' }
        const previousPreview = paneTabReturnRef.current
        paneTabReturnRef.current = preview
        if (!previousPreview || previousPreview.insertIndex !== preview.insertIndex || previousPreview.left !== preview.left) setPaneTabReturnPreview(preview)
        else positionPaneTabReturnGhost(preview)
        drag.dockTarget = null
        updatePaneMovePreview(null)
        return
      }
      paneTabReturnRef.current = null
      setPaneTabReturnPreview(null)
      const hit = paneDockTargetAtPoint(event.clientX, event.clientY, { currentTarget: drag.dockTarget, previousPoint, excludePaneId: drag.documentId })
      if (!hit.target || !hit.direction) {
        drag.dockTarget = null
        updatePaneMovePreview(null)
        return
      }
      drag.dockTarget = hit.target
      updatePaneMovePreview({ documentId: drag.documentId, targetPaneId: hit.target.paneId, direction: hit.direction })
    }
    const end = (event: PointerEvent, cancelled = false): void => {
      const resize = paneResizeRef.current
      if (resize && resize.pointerId === event.pointerId) {
        if (resize.captureTarget?.hasPointerCapture(event.pointerId)) resize.captureTarget.releasePointerCapture(event.pointerId)
        paneResizeRef.current = null
        return
      }
      const drag = paneDragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      if (drag.captureTarget?.hasPointerCapture(event.pointerId)) drag.captureTarget.releasePointerCapture(event.pointerId)
      document.documentElement.classList.remove('document-pane-dragging')
      const tabReturn = paneTabReturnRef.current
      if (!cancelled && drag.moved && tabReturn) {
        flushSync(() => {
          paneTabReturnRef.current = null
          setPaneMovePreview(null)
          setPaneTabReturnPreview(null)
          setDraggingPaneId(null)
        })
        onDocumentPaneReturnToTabs(drag.documentId, tabReturn.insertIndex)
        paneDragRef.current = null
        paneMovePreviewRef.current = null
        return
      }
      const movePreview = paneMovePreviewRef.current
      flushSync(() => {
        paneMovePreviewRef.current = null
        setPaneMovePreview(null)
        setPaneTabReturnPreview(null)
        setDraggingPaneId(null)
      })
      if (!cancelled && drag.moved && movePreview) onDocumentPaneMove(movePreview.documentId, movePreview.targetPaneId, movePreview.direction)
      paneDragRef.current = null
      paneTabReturnRef.current = null
    }
    window.addEventListener('pointermove', move)
    const cancel = (event: PointerEvent): void => end(event, true)
    window.addEventListener('pointerup', end, true)
    window.addEventListener('pointercancel', cancel, true)
    const mouseUp = (event: MouseEvent): void => {
      const drag = paneDragRef.current
      if (!drag) return
      end({ pointerId: drag.pointerId, clientX: event.clientX, clientY: event.clientY } as PointerEvent)
    }
    const blur = (): void => {
      const drag = paneDragRef.current
      if (!drag) return
      end({ pointerId: drag.pointerId, clientX: drag.lastX, clientY: drag.lastY } as PointerEvent, true)
    }
    window.addEventListener('mouseup', mouseUp, true)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end, true)
      window.removeEventListener('pointercancel', cancel, true)
      window.removeEventListener('mouseup', mouseUp, true)
      window.removeEventListener('blur', blur)
      document.documentElement.classList.remove('document-pane-dragging')
    }
  }, [onDocumentPaneLayoutChange, onDocumentPaneMove, onDocumentPaneReturnToTabs])

  const dropDocumentIntoWorkspace = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    const documentId = event.dataTransfer.getData('application/x-moonsprite-document')
    if (!session || !documentId || documentId === session.document.id || !sessions.some((item) => item.document.id === documentId)) return
    const current = layoutRef.current ?? createDocumentPaneLayout(session.document.id)
    const next = insertDocumentPane(current, session.document.id, documentId, 'right')
    layoutRef.current = next
    onDocumentPaneLayoutChange(next)
  }
  const beginSplitResize = (event: ReactPointerEvent<HTMLDivElement>, splitId: string, orientation: DocumentPaneOrientation, ratio: number): void => {
    if (event.button !== 0) return
    const container = event.currentTarget.parentElement
    if (!container) return
    paneResizeRef.current = { splitId, orientation, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startRatio: ratio, container, captureTarget: event.currentTarget }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }
  const beginPaneDrag = (event: ReactPointerEvent<HTMLElement>, documentId: string): void => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    const captureTarget = event.currentTarget.closest<HTMLElement>('.stage-wrap') ?? event.currentTarget
    const bounds = event.currentTarget.getBoundingClientRect()
    const width = Math.min(240, Math.max(120, bounds.width))
    const horizontalRatio = bounds.width > 0 ? (event.clientX - bounds.left) / bounds.width : 0.5
    paneDragRef.current = { documentId, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, pointerOffsetX: Math.max(0, Math.min(width, horizontalRatio * width)), pointerOffsetY: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)), width, height: bounds.height, moved: false, dockTarget: null, captureTarget }
    paneTabReturnRef.current = null
    document.documentElement.classList.add('document-pane-dragging')
    setDraggingPaneId(documentId)
    captureTarget.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }
  const renderedPaneLayout = paneMovePreview && documentPaneLayout
    ? moveDocumentPane(documentPaneLayout, paneMovePreview.documentId, paneMovePreview.targetPaneId, paneMovePreview.direction)
    : documentPaneLayout
  const livePanePreview = documentPanePreview ?? paneMovePreview
  const renderNode = (node: DocumentPaneNode): ReactNode => {
    if (node.kind === 'leaf') {
      const isPreview = livePanePreview?.documentId === node.documentId
      if (isPreview) {
        return <div key={node.id} data-document-pane-id={node.id} data-document-pane-preview="true" className={`document-pane-drop-gap ${livePanePreview.direction}`} aria-hidden="true" />
      }
      const paneSession = sessions.find((item) => item.document.id === node.documentId)
      if (!paneSession) return null
      return <section key={node.id} data-document-pane-id={node.id} className={`document-pane ${activeId === paneSession.document.id ? 'active' : ''} ${draggingPaneId === paneSession.document.id ? 'dragging' : ''}`} onPointerDownCapture={() => useWorkspace.getState().setActive(paneSession.document.id)} onWheelCapture={() => useWorkspace.getState().setActive(paneSession.document.id)}>
        <header onPointerDown={(event) => beginPaneDrag(event, paneSession.document.id)}><PixelUtilityIcon kind="project" /><span>{paneSession.document.name}</span>{paneSession.document.dirty && <i />}<button title={t('common.close')} aria-label={t('tabs.closeAria', { name: paneSession.document.name })} onClick={() => { void useWorkspace.getState().closeDocument(paneSession.document.id) }}><PixelUtilityIcon kind="close" /></button></header>
        <div className="document-pane-canvas"><LazyCanvasStage session={paneSession} /></div>
      </section>
    }
    const firstIsPreview = Boolean(livePanePreview && node.first.kind === 'leaf' && node.first.documentId === livePanePreview.documentId)
    const secondIsPreview = Boolean(livePanePreview && node.second.kind === 'leaf' && node.second.documentId === livePanePreview.documentId)
    const isPreviewSplit = firstIsPreview || secondIsPreview
    const splitStyle: CSSProperties = isPreviewSplit
      ? node.orientation === 'horizontal'
        ? { gridTemplateColumns: firstIsPreview ? `${DOCUMENT_PANE_DROP_GAP} 6px minmax(0, 1fr)` : `minmax(0, 1fr) 6px ${DOCUMENT_PANE_DROP_GAP}` }
        : { gridTemplateRows: firstIsPreview ? `${DOCUMENT_PANE_DROP_GAP} 6px minmax(0, 1fr)` : `minmax(0, 1fr) 6px ${DOCUMENT_PANE_DROP_GAP}` }
      : node.orientation === 'horizontal'
        ? { gridTemplateColumns: `minmax(0, ${node.ratio}fr) 6px minmax(0, ${1 - node.ratio}fr)` }
        : { gridTemplateRows: `minmax(0, ${node.ratio}fr) 6px minmax(0, ${1 - node.ratio}fr)` }
    return <div key={node.id} className={`document-pane-split ${node.orientation} ${isPreviewSplit ? `drop-preview-split ${livePanePreview?.direction ?? ''}` : ''}`} style={splitStyle} data-document-split-id={node.id} data-document-pane-preview-split={isPreviewSplit ? 'true' : undefined}>
      <div className="document-pane-split-child">{renderNode(node.first)}</div>
      <div className="document-pane-resizer" role="separator" aria-orientation={node.orientation === 'horizontal' ? 'vertical' : 'horizontal'} onPointerDown={(event) => beginSplitResize(event, node.id, node.orientation, node.ratio)} />
      <div className="document-pane-split-child">{renderNode(node.second)}</div>
    </div>
  }

  const content = renderedPaneLayout
    ? <div className="split-workspace">{renderNode(renderedPaneLayout)}</div>
    : session ? <div className="document-pane-target" data-document-pane-id={session.document.id}><LazyCanvasStage session={session} /></div> : null

  return <PerformanceProfiler id="EditorCanvasHost"><div className={`stage-wrap ${renderedPaneLayout ? 'has-split' : ''}`} onDragOver={(event) => { if (event.dataTransfer.types.includes('application/x-moonsprite-document')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }} onDrop={dropDocumentIntoWorkspace}><Suspense fallback={<div aria-hidden="true" />}>{content}</Suspense></div>{paneTabReturnPreview && createPortal(<div className="document-tab-drag-layer" aria-hidden="true"><div className="document-pane-tab-return-preview" style={{ left: paneTabReturnPreview.left, top: paneTabReturnPreview.top, height: paneTabReturnPreview.height }} /><div className="document-tab-drag-ghost" data-document-pane-return-ghost="true" style={{ left: paneTabReturnPreview.pointerX - paneTabReturnPreview.pointerOffsetX, top: paneTabReturnPreview.pointerY - paneTabReturnPreview.pointerOffsetY, width: paneTabReturnPreview.width, height: paneTabReturnPreview.ghostHeight }}><PixelUtilityIcon kind="project" /><span>{paneTabReturnPreview.name}</span></div></div>, document.body)}</PerformanceProfiler>
})
