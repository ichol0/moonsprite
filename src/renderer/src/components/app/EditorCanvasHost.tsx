import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { FileImage, X } from 'lucide-react'
import { PerformanceProfiler } from '@/components/PerformanceProfiler'
import { useWorkspace } from '@/store/workspace'

const loadCanvasStage = () => import('@/components/CanvasStage').then(({ CanvasStage }) => ({ default: CanvasStage }))
const LazyCanvasStage = lazy(loadCanvasStage)

export const preloadCanvasStage = (): void => { void loadCanvasStage() }

interface DocumentPanePosition {
  x: number
  y: number
  width: number
  height: number
}

interface EditorCanvasHostProps {
  splitDocumentIds: [string, string] | null
  onSplitChange: (ids: [string, string] | null) => void
}

export const EditorCanvasHost = memo(function EditorCanvasHost({ splitDocumentIds, onSplitChange }: EditorCanvasHostProps) {
  const sessions = useWorkspace((state) => state.sessions)
  const activeId = useWorkspace((state) => state.activeId)
  const [panePositions, setPanePositions] = useState<Record<string, DocumentPanePosition>>({})
  const paneDragRef = useRef<{ id: string; startX: number; startY: number; originX: number; originY: number } | null>(null)
  const session = sessions.find((item) => item.document.id === activeId) ?? null
  const splitSessions = useMemo(() => splitDocumentIds
    ? splitDocumentIds.map((id, index) => ({ paneId: `${id}:${index}`, session: sessions.find((item) => item.document.id === id) })).filter((item): item is { paneId: string; session: NonNullable<typeof item.session> } => Boolean(item.session))
    : [], [sessions, splitDocumentIds])

  useEffect(() => {
    if (splitDocumentIds && splitSessions.length !== 2) onSplitChange(null)
  }, [onSplitChange, splitDocumentIds, splitSessions.length])

  useEffect(() => {
    if (!splitDocumentIds) setPanePositions({})
  }, [splitDocumentIds])

  useEffect(() => {
    const move = (event: PointerEvent): void => {
      const drag = paneDragRef.current
      const workspaceElement = document.querySelector('.split-workspace')
      if (!drag || !workspaceElement) return
      const workspaceBounds = workspaceElement.getBoundingClientRect()
      const pane = document.querySelector(`[data-document-pane-id="${drag.id}"]`)
      const paneBounds = pane?.getBoundingClientRect()
      const width = paneBounds?.width ?? workspaceBounds.width / 2
      const height = paneBounds?.height ?? workspaceBounds.height / 2
      const x = Math.max(0, Math.min(workspaceBounds.width - width, drag.originX + event.clientX - drag.startX))
      const y = Math.max(0, Math.min(workspaceBounds.height - height, drag.originY + event.clientY - drag.startY))
      setPanePositions((current) => ({ ...current, [drag.id]: { x, y, width, height } }))
    }
    const up = (): void => { paneDragRef.current = null }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [])

  const dropDocumentIntoWorkspace = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    const documentId = event.dataTransfer.getData('application/x-moonsprite-document')
    if (!session || !documentId || documentId === session.document.id || !sessions.some((item) => item.document.id === documentId)) return
    setPanePositions({})
    onSplitChange([session.document.id, documentId])
  }
  const beginPaneDrag = (event: ReactPointerEvent<HTMLElement>, paneId: string): void => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    const pane = event.currentTarget.closest('.document-pane')
    const workspaceElement = pane?.closest('.split-workspace')
    if (!pane || !workspaceElement) return
    const paneBounds = pane.getBoundingClientRect()
    const workspaceBounds = workspaceElement.getBoundingClientRect()
    paneDragRef.current = { id: paneId, startX: event.clientX, startY: event.clientY, originX: paneBounds.left - workspaceBounds.left, originY: paneBounds.top - workspaceBounds.top }
    event.preventDefault()
  }
  const rememberPaneGeometry = (paneId: string, pane: HTMLElement): void => {
    const workspaceElement = pane.closest('.split-workspace')
    if (!workspaceElement) return
    const paneBounds = pane.getBoundingClientRect()
    const workspaceBounds = workspaceElement.getBoundingClientRect()
    setPanePositions((current) => ({ ...current, [paneId]: {
      x: paneBounds.left - workspaceBounds.left,
      y: paneBounds.top - workspaceBounds.top,
      width: paneBounds.width,
      height: paneBounds.height
    } }))
  }
  const paneStyle = (paneId: string, index: number): CSSProperties => {
    const saved = panePositions[paneId]
    if (saved) return { left: saved.x, top: saved.y, width: saved.width, height: saved.height }
    return { left: index === 0 ? '0%' : '50%', top: '0%', width: '50%', height: '100%' }
  }
  const clearSplit = (): void => {
    setPanePositions({})
    onSplitChange(null)
  }

  const content = session && splitSessions.length === 2
    ? <div className="split-workspace">{splitSessions.map((pane, index) => <section key={pane.paneId} data-document-pane-id={pane.paneId} style={paneStyle(pane.paneId, index)} className={`document-pane ${activeId === pane.session.document.id ? 'active' : ''}`} onPointerDownCapture={() => useWorkspace.getState().setActive(pane.session.document.id)} onPointerUpCapture={(event) => rememberPaneGeometry(pane.paneId, event.currentTarget)}>
        <header onPointerDown={(event) => beginPaneDrag(event, pane.paneId)}><FileImage size={13} /><span>{pane.session.document.name}</span>{pane.session.document.dirty && <i />}<button title="退出分屏" aria-label={`退出 ${pane.session.document.name} 分屏`} onClick={clearSplit}><X size={13} /></button></header>
        <div className="document-pane-canvas"><LazyCanvasStage session={pane.session} /></div>
      </section>)}</div>
    : session ? <LazyCanvasStage session={session} /> : null

  return <PerformanceProfiler id="EditorCanvasHost"><div className={`stage-wrap ${splitSessions.length === 2 ? 'has-split' : ''}`} onDragOver={(event) => { if (event.dataTransfer.types.includes('application/x-moonsprite-document')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }} onDrop={dropDocumentIntoWorkspace}><Suspense fallback={<div aria-hidden="true" />}>{content}</Suspense></div></PerformanceProfiler>
})
