import { createPortal } from 'react-dom'
import { memo, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Copy, FileImage, FolderOpen, Plus, X } from 'lucide-react'
import { PerformanceProfiler } from '@/components/PerformanceProfiler'
import { documentTabsRenderKey } from '@/core/app-render-keys'
import { useWorkspace } from '@/store/workspace'

interface DocumentTabsProps {
  homeOpen: boolean
  onNew: () => void
  onActivate: (documentId: string) => void
  onContextActivate: (documentId: string) => void
  onSplit: (documentId: string) => void
}

export const DocumentTabs = memo(function DocumentTabs({ homeOpen, onNew, onActivate, onContextActivate, onSplit }: DocumentTabsProps) {
  const renderKey = useWorkspace(documentTabsRenderKey)
  const [contextMenu, setContextMenu] = useState<{ documentId: string; x: number; y: number } | null>(null)
  const dragRef = useRef<{ id: string; startX: number; startY: number; moved: boolean } | null>(null)
  const suppressClickRef = useRef(false)
  const state = useWorkspace.getState()

  useEffect(() => {
    const move = (event: PointerEvent): void => {
      const drag = dragRef.current
      if (!drag || drag.moved) return
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 5) drag.moved = true
    }
    const up = (event: PointerEvent): void => {
      const drag = dragRef.current
      dragRef.current = null
      if (!drag?.moved) return
      const overWorkspace = document.elementFromPoint(event.clientX, event.clientY)?.closest('.stage-wrap')
      if (overWorkspace) onSplit(drag.id)
      suppressClickRef.current = true
      window.setTimeout(() => { suppressClickRef.current = false }, 0)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [onSplit])

  useEffect(() => {
    const closeOutside = (event: PointerEvent): void => {
      if (event.target instanceof Element && !event.target.closest('.document-tab, .document-tab-context-menu')) setContextMenu(null)
    }
    const close = (event?: Event): void => {
      const target = (event as CustomEvent<{ target?: string }> | undefined)?.detail?.target
      if (!target || target === 'popover') setContextMenu(null)
    }
    window.addEventListener('pointerdown', closeOutside, true)
    window.addEventListener('blur', close)
    window.addEventListener('moonsprite:close-dialog', close)
    return () => {
      window.removeEventListener('pointerdown', closeOutside, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('moonsprite:close-dialog', close)
    }
  }, [])

  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>, documentId: string): void => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('.tab-close')) return
    dragRef.current = { id: documentId, startX: event.clientX, startY: event.clientY, moved: false }
  }
  const openProjectFolder = (documentId: string): void => {
    const workspace = useWorkspace.getState()
    const target = workspace.sessions.find((item) => item.document.id === documentId)
    const sourcePath = target?.document.filePath ?? target?.document.sourceFilePath
    setContextMenu(null)
    if (!sourcePath) {
      workspace.setMessage('该工程尚未保存到本地文件。')
      return
    }
    void window.moonSprite.openProjectInFolder(sourcePath).then(() => {
      workspace.setMessage('已打开工程所在文件夹。')
    }).catch((error) => {
      workspace.setMessage(error instanceof Error ? error.message : '无法打开工程所在文件夹。')
    })
  }
  const duplicateDocumentView = async (documentId: string): Promise<void> => {
    const workspace = useWorkspace.getState()
    const target = workspace.sessions.find((item) => item.document.id === documentId)
    const sourcePath = target?.document.filePath ?? target?.document.sourceFilePath
    setContextMenu(null)
    if (!sourcePath) {
      workspace.setMessage('该工程没有可重新打开的本地路径。')
      return
    }
    onContextActivate(documentId)
    const opened = await workspace.openPath(sourcePath, { duplicate: true })
    if (!opened) workspace.setMessage('无法复制打开该工程。')
  }

  return <PerformanceProfiler id="DocumentTabs"><>
    {state.sessions.map((item) => <button
      key={item.document.id}
      className={`document-tab ${item.document.id === state.activeId && !homeOpen ? 'active' : ''}`}
      onPointerDown={(event) => { if (event.button === 1) { event.preventDefault(); return }; beginDrag(event, item.document.id) }}
      onAuxClick={(event) => { if (event.button !== 1) return; event.preventDefault(); event.stopPropagation(); setContextMenu(null); void useWorkspace.getState().closeDocument(item.document.id) }}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onContextActivate(item.document.id); setContextMenu({ documentId: item.document.id, x: event.clientX, y: event.clientY }) }}
      onClick={(event) => { if (suppressClickRef.current) { event.preventDefault(); return }; onActivate(item.document.id) }}
    >
      <FileImage size={14} />
      <span>{item.document.name}</span>
      {item.document.dirty && <i />}
      <span className="tab-close" role="button" tabIndex={0} aria-label={`关闭 ${item.document.name}`} onClick={(event) => { event.stopPropagation(); void useWorkspace.getState().closeDocument(item.document.id) }}><X size={12} /></span>
    </button>)}
    <button className="new-tab-button" aria-label="新建作品" title="新建作品" onClick={onNew}><Plus size={16} /></button>
    {contextMenu && createPortal(<div className="context-menu document-tab-context-menu" role="menu" aria-label="项目标签操作" style={{ left: Math.min(contextMenu.x, Math.max(8, window.innerWidth - 232)), top: Math.min(contextMenu.y, Math.max(8, window.innerHeight - 150)) }}>
      <button className="context-menu-item" role="menuitem" onClick={() => { void useWorkspace.getState().closeDocument(contextMenu.documentId); setContextMenu(null) }}><X size={15} /><span>关闭</span></button>
      <button className="context-menu-item" role="menuitem" onClick={() => { void duplicateDocumentView(contextMenu.documentId) }}><Copy size={15} /><span>复制视图</span></button>
      <button className="context-menu-item" role="menuitem" onClick={() => openProjectFolder(contextMenu.documentId)}><FolderOpen size={15} /><span>在文件夹中打开</span></button>
    </div>, document.body)}
  </></PerformanceProfiler>
})
